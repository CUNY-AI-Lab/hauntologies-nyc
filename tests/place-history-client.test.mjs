import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/place-history.js',import.meta.url),'utf8');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.textContent='';}
 get isConnected(){return this.root||!!this.parent?.isConnected;}
 append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
 replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
 remove(){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
 setAttribute(){}
 addEventListener(event,fn){this.handlers[event]=fn;}
 querySelector(tag){return this.find(e=>e.tag===tag);}
 find(fn){for(const child of this.children){if(fn(child))return child;const found=child.find(fn);if(found)return found;}}
 emit(event){return this.handlers[event]?.({preventDefault(){}});}
}
function fixture(respond){
 const values=new Map(),posts=[],targets=[],events=[],listeners=new Map(),account={actor:'synthetic-a',generation:1};let uuid=0;
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const window={HauntologiesAccount:{snapshot:()=>({...account}),canContribute:()=>true,isCurrent:a=>a.actor===account.actor&&a.generation===account.generation},addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event),dispatchEvent:event=>events.push(event.type)};
 const context=vm.createContext({document:{createElement:tag=>new Element(tag)},window,sessionStorage:storage,localStorage:{getItem:()=>null},crypto:{randomUUID:()=>`request-${++uuid}`},AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(type){this.type=type;}},fetch:async(path,options)=>{
  if(path.startsWith('/api/place-history'))return Response.json({items:[{id:'event-1',summary:'Synthetic change',moniker:'night.owl',created_at:'2026-10-29T00:00:00Z',changes:[]}]});
  if(path.startsWith('/api/contributions/target')){const target={expected_version:targets.length+1,expected_hash:'hash-'+(targets.length+1)};targets.push(target);return Response.json({target});}
  const body=JSON.parse(options.body);posts.push(body);return respond(body,posts.length);
 }});
 vm.runInContext(source,context);const card=new Element('div');card.root=true;window.PlaceHistory.append(card,{id:'synthetic-place'});
 const details=card.find(e=>e.className==='workflow-details place-history');
 return {values,posts,targets,events,storage,account,listeners,async open(){details.open=true;await details.emit('toggle');await new Promise(setImmediate);const row=details.find(e=>e.className==='history-entry');await row.find(e=>e.tag==='button'&&e.textContent==='Undo').emit('click');const form=row.querySelector('form'),inputs=form.children.filter(e=>e.tag==='label').map(e=>e.children[0]);inputs[0].value='night.owl';inputs[1].value='Undo this change';return{form,name:inputs[0],summary:inputs[1],send:form.find(e=>e.tag==='button'&&e.type==='submit'),notice:form.children.at(-1),submit:()=>form.emit('submit')};}};
}
const success=()=>Response.json({receipt:{action:'undo',result:{published:true}}});

for(const [status,error,reopen] of [[400,'public_moniker_required',false],[400,'public_moniker_required',true],[409,'stale_target',false],[409,'undo_conflict',true]])test(`Undo ${error} (${reopen?'reopened History':'same form'}) permits a corrected new request`,async()=>{
 const h=fixture((body,n)=>n===1?Response.json({error},{status}):success());let f=await h.open();f.name.value='invalid@example.test';await f.submit();
 assert.equal(h.values.size,0);assert.equal(f.send.textContent,'Publish undo');assert.equal(f.send.disabled,false);
 if(reopen)f=await h.open();f.name.value='corrected.owl';f.summary.value='A corrected description';await f.submit();
 assert.equal(h.posts.length,2);assert.notEqual(h.posts[0].idempotency_key,h.posts[1].idempotency_key);assert.equal(h.posts[1].moniker,'corrected.owl');assert.equal(h.posts[1].change_summary,'A corrected description');assert.equal(h.posts[1].expected_version,2);assert.equal(h.posts[1].expected_hash,'hash-2');assert.equal(h.values.size,0);assert.deepEqual(h.events,['contributions-records-changed']);
});
for(const [name,response] of [
 ['network loss',()=>{throw new TypeError('Failed to fetch');}],
 ['unreadable response',()=>new Response('{',{status:200})],
 ['unverified success receipt',()=>Response.json({unexpected:true})],
 ['unverified 400 response',()=>Response.json({unexpected:true},{status:400})],
 ['unreadable 409 response',()=>new Response('{',{status:409})],
 ['server failure',()=>Response.json({error:'internal_error'},{status:500})],
])test(`Undo ${name} retains the exact request across History reopening`,async()=>{
 const h=fixture((body,n)=>n===1?response():success());let f=await h.open();await f.submit();assert.equal(h.values.size,1);assert.equal(f.send.textContent,'Retry / confirm');
 f=await h.open();f.name.value='different.owl';f.summary.value='Changed fields must not change an uncertain request';await f.submit();
 assert.deepEqual(h.posts[1],h.posts[0]);assert.equal(h.targets.length,1);assert.equal(h.values.size,0);assert.deepEqual(h.events,['contributions-records-changed']);
});
for(const [outcome,response] of [['rejection',()=>Response.json({error:'stale_target'},{status:409})],['success',success]])test(`late ${outcome} clears only its own saved request after an account switch`,async()=>{
 let resolve,arrive;const arrived=new Promise(r=>arrive=r),held=new Promise(r=>resolve=r),h=fixture(()=>{arrive();return held;}),f=await h.open(),submitted=f.submit();await arrived;
 const [storage]=h.values.keys();h.account.actor='synthetic-b';h.account.generation++;h.listeners.get('hauntologies-auth-changed')();
 const newer={idempotency_key:'other-request'};h.storage.setItem('hauntologies-pending-undo:synthetic-b:event-1',JSON.stringify(newer));resolve(response());await submitted;
 assert.equal(h.storage.getItem(storage),null);assert.equal(h.storage.getItem('hauntologies-pending-undo:synthetic-b:event-1'),JSON.stringify(newer));assert.deepEqual(h.events,[]);
});
test('an obsolete response cannot clear a newer saved request for the same event',async()=>{
 let resolve,arrive;const arrived=new Promise(r=>arrive=r),held=new Promise(r=>resolve=r),h=fixture(()=>{arrive();return held;}),f=await h.open(),submitted=f.submit();await arrived;
 const [storage]=h.values.keys(),newer={...h.posts[0],idempotency_key:'newer-request'};h.storage.setItem(storage,JSON.stringify(newer));resolve(Response.json({error:'stale_target'},{status:409}));await submitted;assert.equal(h.storage.getItem(storage),JSON.stringify(newer));
});
