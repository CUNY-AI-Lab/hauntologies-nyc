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
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 focus(){this.focused=true;}
 setAttribute(){}
 addEventListener(event,fn){this.handlers[event]=fn;}
 querySelector(tag){return this.find(e=>e.tag===tag);}
 find(fn){for(const child of this.children){if(fn(child))return child;const found=child.find(fn);if(found)return found;}}
 emit(event){return this.handlers[event]?.({preventDefault(){}});}
}
function fixture(respond,record={id:'synthetic-place'},history){
 const values=new Map(),posts=[],targets=[],events=[],listeners=new Map(),account={actor:'synthetic-a',generation:1};let uuid=0;
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const window={HauntologiesAccount:{snapshot:()=>({...account}),canContribute:()=>true,isCurrent:a=>a.actor===account.actor&&a.generation===account.generation},addEventListener:(event,fn)=>{if(!listeners.has(event)){const callbacks=new Set(),dispatch=()=>{for(const callback of [...callbacks])callback();};dispatch.callbacks=callbacks;listeners.set(event,dispatch);}listeners.get(event).callbacks.add(fn);},removeEventListener:(event,fn)=>{const callbacks=listeners.get(event)?.callbacks;callbacks?.delete(fn);if(!callbacks?.size)listeners.delete(event);},dispatchEvent:event=>events.push(event.type)};
 const document={createElement:tag=>new Element(tag)},context=vm.createContext({document,window,sessionStorage:storage,localStorage:{getItem:()=>null},crypto:{randomUUID:()=>`request-${++uuid}`},AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(type){this.type=type;}},fetch:async(path,options)=>{
  if(path.startsWith('/api/place-history'))return history?history():Response.json({items:[{id:'event-1',summary:'Synthetic change',moniker:'night.owl',created_at:'2026-10-29T00:00:00Z',changes:[]}]});
  if(path.startsWith('/api/contributions/target')){const target={expected_version:targets.length+1,expected_hash:'hash-'+(targets.length+1)};targets.push(target);return Response.json({target});}
  const body=JSON.parse(options.body);posts.push(body);return respond(body,posts.length);
 }});
 vm.runInContext(source,context);const card=new Element('div');card.root=true;window.PlaceHistory.append(card,record);
 const details=card.find(e=>e.className==='workflow-details place-history');
 return {card,values,posts,targets,events,storage,account,listeners,document,details,async open(index=0,reload=true){details.open=true;if(reload){await details.emit('toggle');await new Promise(setImmediate);}const row=details.children[2].children[index];await row.find(e=>e.tag==='button'&&e.textContent==='Undo').emit('click');const form=row.querySelector('form'),inputs=form.children.filter(e=>e.tag==='label').map(e=>e.children[0]);inputs[0].value='night.owl';inputs[1].value='Undo this change';return{form,name:inputs[0],summary:inputs[1],send:form.find(e=>e.tag==='button'&&e.type==='submit'),notice:form.children.at(-1),submit:()=>form.emit('submit')};}};
}
const success=()=>Response.json({receipt:{action:'undo',result:{published:true}}});

test('confirmed Undo and Cancel remove the form, release its account listener and return keyboard focus to History',async()=>{
 for(const publish of [true,false]){
  const h=fixture(success),f=await h.open();h.document.activeElement=f.send;
  if(publish)await f.submit();else await f.form.find(e=>e.tag==='button'&&e.textContent==='Cancel').emit('click');
  assert.equal(f.form.isConnected,false);assert.equal(h.listeners.has('hauntologies-auth-changed'),false);assert.equal(h.details.children[0].focused,true);
  assert.equal(h.posts.length,publish?1:0);
 }
});

test('a note without description still displays its source, fact and attribution without an empty paragraph',()=>{
 const h=fixture(success,{id:'synthetic-place',notes:[{text:'',moniker:'night.owl',sources:'Synthetic archive',attributes:[{name:'Opening date',value:'1901'}]}]});
 const section=h.card.find(e=>e.className==='workflow-details place-notes').find(e=>e.tag==='section');
 assert.deepEqual(section.children.map(e=>[e.tag,e.textContent]),[['small','night.owl'],['p','Sources: Synthetic archive'],['p','Opening date: 1901']]);
});

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

test('a delayed History read and another confirmed Undo preserve a second unsent form',async()=>{
 const data={items:[1,2].map(n=>({id:'event-'+n,moniker:'night.owl',created_at:'2026-10-29T00:00:00Z',changes:[]}))};let answer,hold=false;
 const h=fixture(success,undefined,()=>hold?new Promise(resolve=>answer=resolve):Response.json(data));
 const first=await h.open(),second=await h.open(1,false);second.name.value='unsent.owl';second.summary.value='Keep this other Undo';
 hold=true;const reading=h.details.emit('toggle');await new Promise(setImmediate);answer(Response.json(data));await reading;
 assert.equal(second.form.isConnected,true);assert.equal(second.summary.value,'Keep this other Undo');
 hold=false;await first.submit();assert.equal(first.form.isConnected,false);assert.equal(second.form.isConnected,true);assert.equal(second.name.value,'unsent.owl');assert.equal(h.listeners.get('hauntologies-auth-changed').callbacks.size,1);
 await second.form.find(e=>e.tag==='button'&&e.textContent==='Cancel').emit('click');await new Promise(setImmediate);
 assert.equal(h.details.find(e=>e.tag==='form'),undefined);assert.equal(h.posts.length,1);assert.equal(h.listeners.has('hauntologies-auth-changed'),false);
});
