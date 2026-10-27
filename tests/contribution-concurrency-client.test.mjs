import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
const watchSource=source.slice(source.indexOf('  let statusWatch=null;'),source.indexOf('  function showReceipt('));
function watchFixture(){
  let poll,resolve,calls=0,renders=0;const root={isConnected:true,hidden:false,dataset:{submissionId:'one'},querySelector:()=>({replaceWith(){renders++;}})};
  const context=vm.createContext({identityGeneration:1,privateActor:'actor-a',document:{visibilityState:'visible'},setInterval:fn=>{poll=fn;return 1;},clearInterval(){},api:()=>{calls++;return new Promise(r=>{resolve=r;});},submissionProgress:s=>s});
  vm.runInContext(watchSource+';globalThis.start=watchSubmission;',context);context.start('one',root,'submitted');
  return{context,root,poll:()=>poll(),resolve:status=>resolve({submission:{status}}),calls:()=>calls,renders:()=>renders};
}
test('submission status polling is single-flight and applies current results',async()=>{
  const h=watchFixture(),first=h.poll();await h.poll();assert.equal(h.calls(),1);h.resolve('approved');await first;assert.equal(h.renders(),1);
});
test('an older poll cannot replace a terminal receipt for the same submission',async()=>{
  const h=watchFixture(),pending=h.poll();h.context.start('one',h.root,'merged');h.resolve('approved');await pending;assert.equal(h.renders(),0);
});
for(const change of ['submission','identity'])test(`late status result cannot update a changed ${change}`,async()=>{
  const h=watchFixture(),pending=h.poll();if(change==='submission')h.root.dataset.submissionId='two';else{h.context.identityGeneration++;h.context.privateActor='actor-b';}
  h.resolve('approved');await pending;assert.equal(h.renders(),0);
});
const mutationSource=source.slice(source.indexOf('  async function safeMutation('),source.indexOf('  const reviewKeys='));
function mutationFixture(){
  let resolve,writes=0;const context=vm.createContext({identityGeneration:1,privateActor:'actor-a',pendingWrite:null,
    sessionActor:()=>new Promise(r=>{resolve=r;}),retainWrite:request=>{context.pendingWrite=request;},api:async()=>{writes++;return{};},requireReceipt:r=>r,requireOriginalActor:async()=>{},showReconciliation(){}});
  vm.runInContext(mutationSource+';globalThis.run=safeMutation;',context);
  return{context,run:()=>context.run('/review',{idempotency_key:'synthetic'}),resolve:actor=>resolve(actor),writes:()=>writes};
}
test('account change during review preflight sends no mutation under the new account',async()=>{
  const h=mutationFixture(),pending=h.run();h.context.identityGeneration++;h.context.privateActor='actor-b';h.resolve('actor-b');
  await assert.rejects(pending,e=>e.status===409);assert.equal(h.writes(),0);assert.equal(h.context.pendingWrite,null);
});
test('out-of-order session result cannot authorize an action for a different owner',async()=>{
  const h=mutationFixture(),pending=h.run();h.resolve('actor-b');await assert.rejects(pending,e=>e.status===409);assert.equal(h.writes(),0);
});
test('unchanged owner can make the one intended review request',async()=>{
  const h=mutationFixture(),pending=h.run();h.resolve('actor-a');await pending;assert.equal(h.writes(),1);assert.equal(h.context.pendingWrite,null);
});
test('an old in-flight mutation cannot clear a newer account pending write',async()=>{
  const h=mutationFixture();let complete,started;const ready=new Promise(resolve=>{started=resolve;});
  h.context.api=()=>new Promise(resolve=>{complete=resolve;started();});
  const pending=h.run();h.resolve('actor-a');await ready;
  h.context.identityGeneration++;h.context.privateActor='actor-b';const newer={actor_id:'actor-b',path:'/review'};h.context.pendingWrite=newer;
  complete({});await assert.rejects(pending,e=>e.status===409);assert.equal(h.context.pendingWrite,newer);
});
const apiSource=source.slice(source.indexOf('  async function api('),source.indexOf('  function empty(',source.indexOf('  async function api(')));
test('a delayed old-account 401 cannot clear the new account UI',async()=>{
  let complete,clears=0;const context=vm.createContext({identityGeneration:1,privateActor:'actor-a',apiRoot:'/api/contributions',AbortController,setTimeout:()=>1,clearTimeout(){},
    fetch:()=>new Promise(r=>{complete=r;}),clearPrivateView(){clears++;},accessActions(){},byId(){}});
  vm.runInContext(apiSource+';globalThis.run=api;',context);const pending=context.run('/submission?id=synthetic');
  context.identityGeneration++;context.privateActor='actor-b';complete({ok:false,status:401,json:async()=>({error:'sign_in_required'})});
  await assert.rejects(pending,e=>e.status===401);assert.equal(clears,0);
});
