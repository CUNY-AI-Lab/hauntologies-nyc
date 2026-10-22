import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createDemoWorker} from '../deployment/demo-gate.mjs';
import {createCunyIdentity,CUNY_ISSUER,CUNY_AUDIENCE,CUNY_ORIGIN,CUNY_SESSION_COOKIE} from '../deployment/cuny-identity.mjs';
import {handleRegistration} from '../server/registration.mjs';
import {handleRegistrationDashboard} from '../server/registration-dashboard.mjs';
const {publicKey,privateKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'local-synthetic-only',alg:'RS256',use:'sig'};
const owner='cail-'+'a'.repeat(32),other='cail-'+'b'.repeat(32);
const token=crypto.randomUUID()+'.'+'A'.repeat(43);
const epoch=1800000000;
const req=(path,options={})=>new Request(CUNY_ORIGIN+path,options);
function database(t){
 const native=new DatabaseSync(':memory:');native.exec(readFileSync(new URL('../drizzle/0004_registration.sql',import.meta.url),'utf8'));t.after(()=>native.close());
 let calls=0;
 function prepare(sql,values=[]){calls++;return{bind:(...v)=>prepare(sql,v),first:async()=>native.prepare(sql).get(...values)||null,all:async()=>({success:true,results:native.prepare(sql).all(...values)}),run:async()=>({success:true,meta:{changes:Number(native.prepare(sql).run(...values).changes)}})};}return{native,prepare,get calls(){return calls},batch:async statements=>{native.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());native.exec('COMMIT');return r}catch(e){native.exec('ROLLBACK');throw e}}};
}
async function setup(t){
 const DB=database(t);let claims={sub:owner};
 const identity={begin:async()=>{throw Error('not used')},redeem:async()=>{throw Error('not used')},revoke:async()=>({revoked:true}),identities:async supplied=>{assert.equal(supplied,token);return{ok:true,appJwt:await new SignJWT({iss:CUNY_ISSUER,aud:CUNY_AUDIENCE,iat:epoch-1,exp:epoch+120,...claims}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(privateKey),gatewayJwt:'never-consumed'}}};
 const env={DB,IDENTITY:identity,CAIL_IDENTITY_JWKS:JSON.stringify({keys:[jwk]}),CONTRIBUTIONS_CUNY_ENABLED:'true',CONTRIBUTIONS_CUNY_OWNER_SUBJECT:owner};
 const cuny=createCunyIdentity({now:()=>epoch*1000});
 const worker=createDemoWorker({fetch:()=>new Response('data-free shell')},handleRegistration,undefined,{cuny,registrationDashboard:handleRegistrationDashboard});
 return{DB,env,worker,setClaims:value=>{claims=value},call:request=>worker.fetch(request,env,{})};
}
const headers={cookie:CUNY_SESSION_COOKIE+'='+token};
test('real local SQLite registration persists then exact verified owner reads minimum fields',async t=>{
 const f=await setup(t);const input={name:'Synthetic <script>attendee</script>',email:'local-only@example.test'};
 const saved=await f.call(req('/api/register',{method:'POST',headers:{origin:CUNY_ORIGIN,'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify(input)}));
 assert.equal(saved.status,201);const receipt=await saved.json();assert.ok(receipt.receipt_id);
 const r=await f.call(req('/api/admin/registrations',{headers}));assert.equal(r.status,200);const body=await r.json();assert.equal(body.registrations.length,1);assert.deepEqual(Object.keys(body.registrations[0]).sort(),['created_at','email','name']);assert.equal(body.registrations[0].name,input.name);assert.equal(body.registrations[0].email,input.email);assert.equal(body.next_cursor,null);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.equal(f.DB.native.prepare('SELECT COUNT(*) AS n FROM event_registrations').get().n,1);
});
test('signed different owner, wrong audience, expired identity and forged headers cannot read SQLite',async t=>{
 const f=await setup(t);
 for(const [claims,status] of [[{sub:other},403],[{sub:owner,aud:'cail:another-app'},401],[{sub:owner,exp:epoch},401]]){
  f.setClaims(claims);const before=f.DB.calls;const r=await f.call(req('/api/admin/registrations',{headers}));assert.equal(r.status,status);assert.equal(f.DB.calls,before);
 }
 f.setClaims({sub:owner});const before=f.DB.calls;const r=await f.call(req('/api/admin/registrations',{headers:{'oai-authenticated-user-id':owner,'x-authenticated-user-id':owner,'cf-access-jwt-assertion':'forged'}}));assert.equal(r.status,401);assert.equal(f.DB.calls,before);
});
test('missing owner configuration and mutation attempts cannot read or change attendee rows',async t=>{
 const f=await setup(t);delete f.env.CONTRIBUTIONS_CUNY_OWNER_SUBJECT;let before=f.DB.calls;assert.equal((await f.call(req('/api/admin/registrations',{headers}))).status,403);assert.equal(f.DB.calls,before);
 f.env.CONTRIBUTIONS_CUNY_OWNER_SUBJECT=owner;
 for(const method of ['POST','PUT','DELETE']){before=f.DB.calls;assert.equal((await f.call(req('/api/admin/registrations',{method,headers}))).status,405);assert.equal(f.DB.calls,before)}
 assert.equal(f.DB.native.prepare('SELECT COUNT(*) AS n FROM event_registrations').get().n,0);
});
