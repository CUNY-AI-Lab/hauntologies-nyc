import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const scope=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../public/shared-tasks.js',import.meta.url),'utf8'),scope);
const createClient=options=>scope.SharedTasks.createClient({identity:()=>({actor:'synthetic_actor_a',generation:1}),...options});
const sample={bounded_task:'Check shared task visibility',description:'Open the shared list in another session.',section:'Research and sources',skill_level:'beginner',status:'proposed'};
const storage=()=>{const rows=new Map();return{getItem:key=>rows.get(key)||null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key),rows};};

test('create always writes to the service and returns a server-confirmed task',async()=>{
 const local=storage(),calls=[];
 const client=createClient({storage:local,newKey:()=> 'confirmed_task_123',request:async(path,body)=>{calls.push({path,body});return{task:{...body.task,task_id:'HNY-server-id'}};}});
 assert.equal((await client.create(sample)).task_id,'HNY-server-id');
 assert.equal(calls[0].path,'/task-create');
 assert.equal(local.rows.size,0);
});

test('an interrupted save reuses its key after a new browser session',async()=>{
 const local=storage(),calls=[];
 const first=createClient({storage:local,newKey:()=> 'retry_task_123456',request:async(path,body)=>{calls.push(body);throw new Error('Connection interrupted');}});
 await assert.rejects(first.create(sample),/interrupted/);
 const second=createClient({storage:local,newKey:()=> 'different_task_123',request:async(path,body)=>{calls.push(body);return {task:{...body.task,task_id:'HNY-saved'}};}});
 assert.equal(second.pendingTask().bounded_task,sample.bounded_task);
 assert.equal((await second.create(sample)).task_id,'HNY-saved');
 assert.equal(calls[0].idempotency_key,calls[1].idempotency_key);
 assert.equal(local.rows.size,0);
});

test('authorization errors preserve the owner-bound pending request without claiming a saved task',async()=>{
 const local=storage();
 const client=createClient({storage:local,newKey:()=> 'denied_task_12345',request:async()=>{throw Object.assign(new Error('Sign in required'),{status:401});}});
 await assert.rejects(client.create(sample),/Sign in required/);
 assert.equal(local.rows.size,1);
 assert.equal(client.pendingTask().bounded_task,sample.bounded_task);
 assert.equal(JSON.parse([...local.rows.values()][0]).actor_id,'synthetic_actor_a');
});

test('task lists come from the shared endpoint and malformed saves remain pending',async()=>{
 const local=storage(),calls=[];
 const client=createClient({storage:local,newKey:()=> 'malformed_1234567',request:async(path)=>{calls.push(path);return path==='/tasks'?{tasks:[{...sample,task_id:'HNY-shared'}]}:{};}});
 assert.equal((await client.list())[0].task_id,'HNY-shared');
 await assert.rejects(client.create(sample),/could not be confirmed/);
 assert.equal(calls[0],'/tasks');
 assert.equal(client.pendingTask().bounded_task,sample.bounded_task);
});

test('same-owner concurrent creates share one promise and one write',async()=>{
 let resolve,calls=0;const client=createClient({storage:storage(),newKey:()=> 'single_flight_1234',request:()=>{calls++;return new Promise(r=>{resolve=r;});}});
 const a=client.create(sample),b=client.create(sample);assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);
 resolve({task:{...sample,task_id:'HNY-single'}});await a;assert.equal(client.pendingTask(),null);
});
test('account change before dispatch sends nothing and retains the original actor request',async()=>{
 let actor='synthetic_actor_a',generation=1,calls=0;const local=storage();
 const client=createClient({storage:local,identity:()=>({actor,generation}),newKey:()=> 'preflight_actor_1234',request:async()=>{calls++;return{task:{task_id:'never'}};}});
 const promise=client.create(sample);actor='synthetic_actor_b';generation++;
 await assert.rejects(promise,e=>e.status===409);assert.equal(calls,0);assert.equal(client.pendingTask(),null);
 assert.ok(local.rows.has('hauntologies-pending-task:synthetic_actor_a'));
});
test('a late save cannot clear another account pending request or expose its receipt',async()=>{
 let actor='synthetic_actor_a',generation=1,resolve;const local=storage();
 const client=createClient({storage:local,identity:()=>({actor,generation}),newKey:()=> 'late_actor_123456',request:()=>new Promise(r=>{resolve=r;})});
 const promise=client.create(sample);await Promise.resolve();actor='synthetic_actor_b';generation++;
 resolve({task:{...sample,task_id:'HNY-old'}});await assert.rejects(promise,e=>e.status===409);
 assert.equal(client.pendingTask(),null);assert.ok(local.rows.has('hauntologies-pending-task:synthetic_actor_a'));
});
test('legacy unowned requests remain untouched and cannot be adopted or retried',async()=>{
 const local=storage(),legacy={idempotency_key:'legacy_unowned_123',task:sample};local.setItem('hauntologies-pending-task',JSON.stringify(legacy));
 let calls=0;const client=createClient({storage:local,request:async()=>{calls++;}});
 assert.equal(client.pendingTask(),null);assert.equal(client.hasUnownedPendingTask(),true);
 await assert.rejects(client.create(sample),/no confirmed owner/);assert.equal(calls,0);
 assert.equal(local.getItem('hauntologies-pending-task'),JSON.stringify(legacy));
});
test('restored scoped entries must themselves name the same owner',()=>{
 const local=storage();local.setItem('hauntologies-pending-task:synthetic_actor_a',JSON.stringify({actor_id:'synthetic_actor_b',idempotency_key:'wrong_actor_12345',task:sample}));
 const client=createClient({storage:local,request:async()=>{}});assert.equal(client.pendingTask(),null);
});
