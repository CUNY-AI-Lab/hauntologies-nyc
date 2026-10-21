import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const scope=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../public/shared-tasks.js',import.meta.url),'utf8'),scope);
const {createClient}=scope.SharedTasks;
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

test('authorization errors retain no claimed local task and a later retry can succeed',async()=>{
 const local=storage();
 const client=createClient({storage:local,newKey:()=> 'denied_task_12345',request:async()=>{throw Object.assign(new Error('Sign in required'),{status:401});}});
 await assert.rejects(client.create(sample),/Sign in required/);
 assert.equal(local.rows.size,0);
 assert.equal(client.pendingTask(),null);
});

test('task lists come from the shared endpoint and malformed saves remain pending',async()=>{
 const local=storage(),calls=[];
 const client=createClient({storage:local,newKey:()=> 'malformed_1234567',request:async(path)=>{calls.push(path);return path==='/tasks'?{tasks:[{...sample,task_id:'HNY-shared'}]}:{};}});
 assert.equal((await client.list())[0].task_id,'HNY-shared');
 await assert.rejects(client.create(sample),/could not be confirmed/);
 assert.equal(calls[0],'/tasks');
 assert.equal(client.pendingTask().bounded_task,sample.bounded_task);
});
