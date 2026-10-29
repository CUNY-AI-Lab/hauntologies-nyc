import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../public/public-reads.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function setup(fetch){
  let now=0,id=0;const timers=new Map(),calls=[],delays=[];
  const context=vm.createContext({window:{},navigator:{onLine:true},AbortController,TypeError,
    Date:{now:()=>now,parse:Date.parse},fetch:(...args)=>{calls.push(args);return fetch(...args);},
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});delays.push(ms);return id;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(source,context);
  return {context,api:context.window.HauntologiesPublicReads,calls,delays,timers,
    async next(){await flush();const item=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(item,'expected scheduled work');timers.delete(item[0]);now=item[1].at;item[1].fn();await flush();},now:()=>now,advance:ms=>{now+=ms;}};
}
const response=(status=200,body={ok:true},retry=null)=>({ok:status>=200&&status<300,status,headers:{get:()=>retry},json:async()=>body});
test('overlapping refresh triggers share one read and commit its delayed result',async()=>{
  let resolve,loads=0,applied=0;const h=setup(()=>{});
  const run=h.api.singleFlight(async()=>{loads++;const data=await new Promise(r=>{resolve=r;});applied=data;});
  const a=run(),b=run(),c=run();assert.equal(a,b);assert.equal(b,c);await flush();assert.equal(loads,1);
  resolve(7);await a;assert.equal(applied,7);
  const d=run();await flush();assert.equal(loads,2);resolve(8);await d;assert.equal(applied,8);
});
test('failure releases single-flight lock for a later explicit retry',async()=>{
  let count=0;const h=setup(()=>{}),run=h.api.singleFlight(()=>{if(++count===1)throw Error('failed');return 2;});
  await assert.rejects(run());assert.equal(await run(),2);
});
test('transient GET failures use finite backoff and succeed without replaying mutations',async()=>{
  let attempt=0;const h=setup(async()=>response(++attempt<3?503:200));const p=h.api.json('/api/pending-places');
  await h.next();await h.next();assert.deepEqual(await p,{ok:true});
  assert.equal(h.calls.length,3);assert.ok(h.delays.includes(500));assert.ok(h.delays.includes(1000));
  assert.ok(h.calls.every(([,options])=>options.method==='GET'&&!options.body));assert.equal(h.timers.size,0);
});
for(const code of [401,403,404,409])test(`HTTP ${code} is never retried`,async()=>{
  const h=setup(async()=>response(code));await assert.rejects(h.api.json('/api/pending-places'),e=>e.status===code);
  assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
test('429 honors Retry-After within budget, never retries early beyond budget',async()=>{
  let count=0;const h=setup(async()=>response(++count===1?429:200,{},'2'));const p=h.api.json('/api/pending-places');
  await h.next();assert.equal(h.now(),2000);await p;assert.equal(h.calls.length,2);
  const long=setup(async()=>response(429,{},'60'));await assert.rejects(long.api.json('/api/pending-places'));
  assert.equal(long.calls.length,1);assert.equal(long.timers.size,0);
});
for(const [status,header] of [[429,'60'],[503,new Date(60000).toUTCString()]])test(`${status} Retry-After survives later focus/poll cycles`,async()=>{
  let count=0;const h=setup(async()=>response(++count===1?status:200,{},header));
  await assert.rejects(h.api.json('/api/pending-places'));
  await assert.rejects(h.api.json('/api/pending-places'));h.advance(30000);
  await assert.rejects(h.api.json('/api/pending-places'));assert.equal(h.calls.length,1);
  h.advance(30000);await h.api.json('/api/pending-places');assert.equal(h.calls.length,2);
});
test('a fetch that never completes settles within the total deadline and aborts attempts',async()=>{
  const h=setup(()=>new Promise(()=>{})),p=h.api.json('/api/pending-places');const rejected=assert.rejects(p,/timed out/);
  for(let i=0;i<5;i++)await h.next();await rejected;
  assert.equal(h.calls.length,3);assert.equal(h.now(),24000);assert.equal(h.timers.size,0);
  assert.ok(h.calls.every(([,o])=>o.signal.aborted));
});
test('a body that never completes has the same bounded deadline',async()=>{
  const h=setup(async()=>({...response(),json:()=>new Promise(()=>{})})),p=h.api.json('/api/pending-places');
  const rejected=assert.rejects(p,/timed out/);for(let i=0;i<5;i++)await h.next();await rejected;
  assert.equal(h.now(),24000);
});
test('offline avoids requests and malformed JSON is not blindly retried',async()=>{
  const h=setup(async()=>response());h.context.navigator.onLine=false;await assert.rejects(h.api.json('/api/pending-places'),/Offline/);assert.equal(h.calls.length,0);
  const bad=setup(async()=>({...response(),json:async()=>{throw new SyntaxError('bad JSON');}}));await assert.rejects(bad.api.json('/api/pending-places'));
  assert.equal(bad.calls.length,1);
});
test('actual pending refresh coalesces bursts and preserves current records on failure',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>{resolve=r;}));
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  Object.assign(h.context,{pendingRequest:0,pendingSignature:'',pendingPlaces:[],pendingUnavailable:false,pendingLoaded:false,publicReads:h.api,renderPendingPlaces:()=>{h.context.renders++;},renders:0,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}}});h.context.window.dispatchEvent=()=>{};
  const part=app.slice(app.indexOf('async function loadPendingPlaces(){'),app.indexOf("window.addEventListener('contributions-records-changed',renderPendingPlaces);"));
  vm.runInContext(part+';globalThis.refresh=refreshPendingPlaces;',h.context);
  const a=h.context.refresh(),b=h.context.refresh(),c=h.context.refresh();await flush();assert.equal(h.calls.length,1);
  resolve(response(200,{places:[{id:'synthetic',title:'Synthetic'}]}));await Promise.all([a,b,c]);assert.equal(h.context.renders,1);
  const next=h.context.refresh();await flush();resolve(response(403));await next;
  assert.equal(h.context.pendingPlaces[0].id,'synthetic');
  // The failure is shown (one redraw of the status) while the loaded places stay.
  assert.equal(h.context.renders,2);assert.equal(h.context.pendingUnavailable,true);assert.equal(h.context.pendingLoaded,true);
  const again=h.context.refresh();await flush();resolve(response(200,{places:[{id:'synthetic',title:'Synthetic'}]}));await again;
  assert.equal(h.context.pendingUnavailable,false);assert.equal(h.context.renders,3,'recovery clears the status even when the list is unchanged');
  // A 200 whose body has no places array is as unusable as a failure: the loaded list stays, marked stale.
  for(const body of [{},{places:null},{places:'x'}]){
    const malformed=h.context.refresh();await flush();resolve(response(200,body));await malformed;
    assert.equal(h.context.pendingUnavailable,true,JSON.stringify(body));assert.equal(h.context.pendingPlaces[0].id,'synthetic');
    const recover=h.context.refresh();await flush();resolve(response(200,{places:[{id:'synthetic',title:'Synthetic'}]}));await recover;
    assert.equal(h.context.pendingUnavailable,false);
  }
});
