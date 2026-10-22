import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDemoWorker} from '../deployment/demo-gate.mjs';
const origin='https://hauntologies-nyc.ailab-452.workers.dev';
const request=(path,options={})=>new Request(origin+path,options);
const obsolete={CONTRIBUTIONS_CUNY_ENABLED:'true',CONTRIBUTIONS_CUNY_OWNER_SUBJECT:'cail-'+'a'.repeat(32),IDENTITY:new Proxy({},{get(){throw Error('withdrawn identity was accessed')}})};
const access={CONTRIBUTIONS_ACCESS_ENABLED:'true',ACCESS_TEAM_DOMAIN:'https://synthetic-team.cloudflareaccess.com',ACCESS_AUDIENCE:'a'.repeat(64),ACCESS_ALLOWED_EMAILS:'owner@example.test'};
function fixture(){
 const seen={app:[],registration:0,legacy:0};
 const worker=createDemoWorker({fetch:r=>{seen.app.push(r);return new Response('public map')}},async()=>{seen.registration++;return Response.json({ok:true})},async()=>{seen.legacy++;return 'access_'+'b'.repeat(64)});
 return {worker,seen};
}
test('withdrawn CUNY settings cannot activate sign-in or fall back to Access',async()=>{
 for(const settings of [obsolete,{...obsolete,...access}]){
  const {worker,seen}=fixture();
  const status=await worker.fetch(request('/api/access-status'),settings,{});
  assert.deepEqual(await status.json(),{enabled:false,sign_in_url:null,dashboard_enabled:false});
  for(const path of ['/api/contributions/sign-in','/api/contributions/session','/api/contributions/dashboard'])assert.equal((await worker.fetch(request(path),settings,{})).status,401,path);
  assert.equal(seen.legacy,0);assert.equal(seen.app.length,0);
 }
});
test('all withdrawn auth and attendee routes stay closed before any identity or app access',async()=>{
 const {worker,seen}=fixture();
 for(const settings of [{},obsolete,access,{...access,...obsolete}])for(const path of ['/auth','/auth/start','/auth/callback?code=ignored','/auth/session','/auth/logout','/AUTH/session','/%61uth/session','/auth//session','/api/admin/registrations','/API/admin/registrations','/api//admin/registrations','/%61pi/admin/registrations','/api/admin/%72egistrations'])for(const method of ['GET','HEAD','POST']){
  const r=await worker.fetch(request(path,{method,headers:{cookie:'__Host-hauntologies-cuny-session=old','oai-authenticated-user-id':'forged','cf-access-jwt-assertion':'forged'}}),settings,{});
  assert.equal(r.status,401,path+' '+method);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('location'),null);
 }
 assert.equal(seen.legacy,0);assert.equal(seen.app.length,0);
});
test('public map and event RSVP remain independent of withdrawn sign-in',async()=>{
 const {worker,seen}=fixture();
 for(const path of ['/','/register','/app.js'])assert.equal((await worker.fetch(request(path,{headers:{'oai-authenticated-user-id':'forged'}}),obsolete,{})).status,200);
 assert.ok(seen.app.every(r=>r.headers.get('oai-authenticated-user-id')===null));
 assert.equal((await worker.fetch(request('/api/register',{method:'POST'}),obsolete,{})).status,200);
 assert.equal(seen.registration,1);assert.equal(seen.legacy,0);
});
test('account UI and Worker build no longer reference CUNY sign-in or recovery',()=>{
 const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 const build=readFileSync(new URL('../scripts/prepare-worker-demo.mjs',import.meta.url),'utf8');
 const gate=readFileSync(new URL('../deployment/demo-gate.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(html,/managelogin[.]cuny|Reset CUNY password|accountSignInHelp/);
 assert.doesNotMatch(build,/cuny-identity|cail-doorway|WorkerIdentity|handleRegistrationDashboard/);
 assert.doesNotMatch(gate,/import.*cuny-identity|cuny[.]/);
 assert.match(html,/href="\/register"/);
});
