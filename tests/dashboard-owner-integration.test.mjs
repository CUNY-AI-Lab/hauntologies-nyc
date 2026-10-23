import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createDemoWorker} from '../deployment/demo-gate.mjs';
import {handleRegistration} from '../server/registration.mjs';
const origin='https://hauntologies-nyc.ailab-452.workers.dev';
const req=(path,options={})=>new Request(origin+path,options);
function database(t){
 const native=new DatabaseSync(':memory:');native.exec(readFileSync(new URL('../drizzle/0004_registration.sql',import.meta.url),'utf8'));t.after(()=>native.close());
 let calls=0;
 function prepare(sql,values=[]){calls++;return{bind:(...v)=>prepare(sql,v),first:async()=>native.prepare(sql).get(...values)||null,all:async()=>({success:true,results:native.prepare(sql).all(...values)}),run:async()=>({success:true,meta:{changes:Number(native.prepare(sql).run(...values).changes)}})};}
 return{native,prepare,get calls(){return calls},batch:async statements=>{native.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());native.exec('COMMIT');return r}catch(e){native.exec('ROLLBACK');throw e}}};
}
test('three synthetic RSVP rows persist unchanged while withdrawn identity cannot read attendees',async t=>{
 const DB=database(t),env={DB,CONTRIBUTIONS_CUNY_ENABLED:'true',CONTRIBUTIONS_CUNY_OWNER_SUBJECT:'cail-'+'a'.repeat(32)};
 const worker=createDemoWorker({fetch:()=>new Response('data-free shell')},handleRegistration);
 for(let i=0;i<3;i++){
  const payload={name:'Synthetic attendee '+i,email:'local-only-'+i+'@example.test'},key=crypto.randomUUID();
  const request=()=>req('/api/register',{method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(payload)});
  const first=await worker.fetch(request(),env,{});assert.equal(first.status,201);const receipt=await first.json();assert.ok(receipt.receipt_id);
  const retry=await worker.fetch(request(),env,{});assert.equal(retry.status,200);assert.equal((await retry.json()).receipt_id,receipt.receipt_id);
 }
 const snapshot=DB.native.prepare('SELECT * FROM event_registrations ORDER BY id').all();assert.equal(snapshot.length,3);
 const calls=DB.calls;
 for(const path of ['/auth/session','/api/admin/registrations','/api/contributions/dashboard'])for(const method of ['GET','POST','DELETE']){
  const response=await worker.fetch(req(path,{method,headers:{cookie:'__Host-hauntologies-cuny-session=forged','oai-authenticated-user-id':env.CONTRIBUTIONS_CUNY_OWNER_SUBJECT,'x-authenticated-user-id':'forged'}}),env,{});
  assert.equal(response.status,401);assert.equal(DB.calls,calls);
 }
 assert.deepEqual(DB.native.prepare('SELECT * FROM event_registrations ORDER BY id').all(),snapshot);
});
