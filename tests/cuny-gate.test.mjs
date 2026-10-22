import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoWorker} from '../deployment/demo-gate.mjs';
const owner='cail-'+'a'.repeat(32),other='cail-'+'b'.repeat(32);
const env={CONTRIBUTIONS_CUNY_ENABLED:'true',CONTRIBUTIONS_CUNY_OWNER_SUBJECT:owner,DB:{}};
const request=(path,options={})=>new Request('https://hauntologies-nyc.ailab-452.workers.dev'+path,options);
function fixture(subject=owner){
 const seen={app:[],admin:[],auth:[],legacy:0};
 const principal=subject?{subject,actor_id:'cuny_'+(subject===owner?'a':'b').repeat(64)}:null;
 const cuny={
  readiness:e=>({configured:e?.CONTRIBUTIONS_CUNY_ENABLED==='true',ownerConfigured:e?.CONTRIBUTIONS_CUNY_ENABLED==='true'&&e.CONTRIBUTIONS_CUNY_OWNER_SUBJECT===owner}),
  authenticate:async()=>principal,
  isOwner:(p,e)=>p?.subject===e?.CONTRIBUTIONS_CUNY_OWNER_SUBJECT,
  handleAuth:async r=>{seen.auth.push(r.url);return new Response(null,{status:204})}
 };
 const worker=createDemoWorker({fetch:r=>{seen.app.push(r);return new Response('application')}},async()=>Response.json({ok:true}),async()=>{seen.legacy++;return 'legacy_actor'},{cuny,registrationDashboard:async(r,options)=>{seen.admin.push({r,options});return Response.json({registrations:[],next_cursor:null},{headers:{'Cache-Control':'no-store'}})}});
 return{worker,seen,principal};
}
test('private attendee API requires configured CUNY owner before any handler or database access',async()=>{
 for(const [subject,settings,expected] of [[null,env,401],[other,env,403],[owner,{},401],[owner,{...env,CONTRIBUTIONS_CUNY_OWNER_SUBJECT:undefined},403]]){
  const {worker,seen}=fixture(subject);const r=await worker.fetch(request('/api/admin/registrations',{headers:{'oai-authenticated-user-id':owner,'x-authenticated-user-id':owner}}),settings,{});
  assert.equal(r.status,expected);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(seen.admin.length,0);assert.equal(seen.app.length,0);assert.equal(seen.legacy,0);
 }
});
test('verified owner principal is passed directly to the private reader',async()=>{
 const {worker,seen,principal}=fixture();const r=await worker.fetch(request('/api/admin/registrations?limit=25'),env,{});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{registrations:[],next_cursor:null});assert.equal(seen.admin[0].options.principal,principal);assert.equal(seen.admin[0].options.DB,env.DB);assert.equal(seen.admin[0].options.ownerSubject,owner);
});
test('CUNY session subject is available only to that signed-in person and grants no dashboard access',async()=>{
 const {worker,seen}=fixture(other);const r=await worker.fetch(request('/auth/session'),env,{});
 assert.deepEqual(await r.json(),{subject:other,actor_id:'cuny_'+'b'.repeat(64)});assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(seen.admin.length,0);
 assert.equal((await worker.fetch(request('/auth/session',{method:'POST'}),env,{})).status,405);
 assert.equal((await fixture(null).worker.fetch(request('/auth/session'),env,{})).status,401);
 assert.equal((await worker.fetch(request('/auth/session'),{},{})).status,401);
});
test('readiness reveals only booleans and fixed sign-in path, with no owner identity',async()=>{
 for(const [settings,enabled] of [[env,true],[{},false],[{...env,CONTRIBUTIONS_CUNY_OWNER_SUBJECT:undefined},false]]){
  const r=await fixture().worker.fetch(request('/api/access-status'),settings,{});
  assert.deepEqual(await r.json(),{enabled,sign_in_url:enabled?'/api/contributions/sign-in':null,dashboard_enabled:enabled});
 }
});
test('CUNY contributions require the owner and cannot fall back to the legacy verifier',async()=>{
 for(const subject of [null,other]){const {worker,seen}=fixture(subject);assert.equal((await worker.fetch(request('/api/contributions/dashboard'),env,{})).status,subject?403:401);assert.equal(seen.legacy,0);assert.equal(seen.app.length,0);}
 const {worker,seen}=fixture();const r=await worker.fetch(request('/api/contributions/dashboard',{headers:{cookie:'private-session-value','cf-access-jwt-assertion':'forged','oai-authenticated-user-id':'forged'}}),env,{});
 assert.equal(r.status,200);assert.equal(seen.legacy,0);assert.equal(seen.app[0].headers.get('oai-authenticated-user-id'),'cuny_'+'a'.repeat(64));assert.equal(seen.app[0].headers.get('cookie'),null);assert.equal(seen.app[0].headers.get('cf-access-jwt-assertion'),null);
 const session=await worker.fetch(request('/api/contributions/session'),env,{});assert.deepEqual(await session.json(),{actor_id:'cuny_'+'a'.repeat(64)});
});
test('CUNY sign-in uses a fixed return path and only read methods',async()=>{
 const {worker,seen}=fixture();const r=await worker.fetch(request('/api/contributions/sign-in?returnTo=https://evil.test'),env,{});
 assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/auth/start?returnTo=%2F');assert.equal(seen.app.length,0);
 assert.equal((await worker.fetch(request('/api/contributions/sign-in',{method:'POST'}),env,{})).status,405);
});
test('encoded and nonexact private paths cannot reach either identity or attendee service',async()=>{
 const {worker,seen}=fixture();
 for(const path of ['/api/admin/registrations/','/api//admin/registrations','/API/admin/registrations','/%61pi/admin/registrations','/api/admin/%72egistrations','/%61uth/session','/AUTH/session','/auth//session'])assert.equal((await worker.fetch(request(path),env,{})).status,401,path);
 assert.equal(seen.admin.length,0);assert.equal(seen.auth.length,0);assert.equal(seen.app.length,0);
});
test('map and public registration remain independent of private identity configuration',async()=>{
 const {worker,seen}=fixture(null);assert.equal((await worker.fetch(request('/register'),{},{})).status,200);
 const r=await worker.fetch(request('/api/register',{method:'POST'}),{},{});assert.equal(r.status,200);assert.equal(seen.legacy,0);assert.equal(seen.admin.length,0);
});
