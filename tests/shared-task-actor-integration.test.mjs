import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { createDemoWorker } from '../deployment/demo-gate.mjs';
const repo=new URL('../',import.meta.url);
test('lost shared-task response cannot be replayed under a changed account',async t=>{
const native=new DatabaseSync(':memory:');t.after(()=>native.close());
for(const f of readdirSync(new URL('drizzle/',repo)).filter(f=>f.endsWith('.sql')).sort())native.exec(readFileSync(new URL('drizzle/'+f,repo),'utf8'));
const prepare=(sql,params=[])=>({bind(...values){return prepare(sql,values);},async first(column){const row=native.prepare(sql).get(...params)||null;return column&&row?row[column]:row;},async all(){return{results:native.prepare(sql).all(...params)};},async run(){return{success:true,meta:{changes:Number(native.prepare(sql).run(...params).changes)}};}});
const db={prepare,async batch(statements){native.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());native.exec('COMMIT');return results;}catch(e){native.exec('ROLLBACK');throw e;}}};
const service=createWorkflowService({store:createWorkflowStore(db),taskSeeds:{tasks:[]}});
let verifiedActor='synthetic_actor_a',dropResponse=true;const requests=[];
const worker=createDemoWorker({fetch:request=>service.handle(request)},undefined,async()=>verifiedActor);
const context=vm.createContext({identityGeneration:1,privateActor:verifiedActor,apiRoot:'/api/contributions',window:{HauntologiesAccount:{snapshot:()=>({actor:verifiedActor}),canContribute:()=>true,invalidate(){throw Error('Unexpected invalidation');}}},AbortController,setTimeout,clearTimeout,
  clearPrivateView(){throw Error('Unexpected auth denial');},accessActions(){},byId(){},fetch:async(path,options)=>{
    requests.push({header:options.headers['X-Hauntologies-Actor'],body:JSON.parse(options.body)});
    const req=new Request('https://map.test'+path,{...options,headers:{...options.headers,origin:'https://map.test','sec-fetch-site':'same-origin'}});
    const response=await worker.fetch(req,{},{});assert.ok([200,201,409].includes(response.status));
    if(dropResponse){dropResponse=false;throw new TypeError('Synthetic connection lost after commit');}return response;
  }});
vm.runInContext(readFileSync(new URL('public/shared-tasks.js',repo),'utf8'),context);
const app=readFileSync(new URL('public/contributions.js',repo),'utf8');
vm.runInContext(app.slice(app.indexOf('  async function api('),app.indexOf('  function empty(',app.indexOf('  async function api(')))+';globalThis.request=api;',context);
const rows=new Map(),storage={getItem:key=>rows.get(key)||null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};
const client=context.window.SharedTasks.createClient({request:context.request,storage,identity:()=>({actor:context.privateActor,generation:context.identityGeneration}),newKey:()=> 'synthetic_idempotency_task_1234'});
const task={bounded_task:'Synthetic actor ownership check',description:'Synthetic local-only reproduction.',section:'Research and sources',skill_level:'beginner',status:'proposed'};
await assert.rejects(client.create(task),/Synthetic connection/);
assert.equal(native.prepare('SELECT COUNT(*) AS n FROM workflow_task_events').get().n,1);
assert.equal(client.pendingTask().bounded_task,task.bounded_task);
const originalBody=requests[0].body;
// Normal gate protection: an explicitly retained old-owner assertion is rejected.
verifiedActor='synthetic_actor_b';
const mismatch=await worker.fetch(new Request('https://map.test/api/contributions/task-create',{method:'POST',headers:{origin:'https://map.test','content-type':'application/json','X-Hauntologies-Actor':'synthetic_actor_a'},body:JSON.stringify(originalBody)}),{},{});
assert.equal(mismatch.status,409);
// If another tab switches the server session before local identity updates, the original-owner header is still rejected.
await assert.rejects(client.create(task),e=>e.status===409);
assert.equal(native.prepare('SELECT COUNT(*) AS n FROM workflow_task_events').get().n,1);
// Once the local account switches, the old pending request is not displayed or resent as B.
context.privateActor=verifiedActor;context.identityGeneration++;
assert.equal(client.pendingTask(),null);
const requestsBefore=requests.length;
await assert.rejects(client.create(task),e=>e.status===409);
assert.equal(requests.length,requestsBefore);
// A returns and confirms the original task using its original key; no duplicate is created.
verifiedActor='synthetic_actor_a';context.privateActor=verifiedActor;context.identityGeneration++;
const recovered=await client.create(task);assert.ok(recovered.task_id);
const persisted=native.prepare('SELECT actor_id,task_id FROM workflow_task_events').all();
assert.equal(persisted.length,1);assert.equal(persisted[0].actor_id,'synthetic_actor_a');
assert.ok(requests.every(r=>r.header==='synthetic_actor_a'));
assert.ok(requests.every(r=>r.body.idempotency_key===originalBody.idempotency_key));
assert.equal(rows.size,0);
});
