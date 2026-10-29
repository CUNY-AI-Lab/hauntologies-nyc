import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// The Contributors dialog's "Show my name on the map" switch, driven as a person would: the whole
// script runs against a small DOM, every fetch is a controlled promise, and the account can change
// while a write is in flight. Synthetic accounts and names only.
const source=readFileSync(new URL('../public/contributors.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.hidden=false;this.disabled=false;this.checked=false;this.open=false;this._text='';this.className='';}
 append(...nodes){for(const n of nodes)this.children.push(typeof n==='string'?{textContent:n}:n);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 set textContent(v){this._text=String(v);this.children=[];}
 get textContent(){return this._text+this.children.map(n=>n.textContent||'').join('');}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(k,v){this.listeners[k]=v;}
 focus(){}showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
 getBoundingClientRect(){return {left:0,top:0,right:100,bottom:100};}
}
function mount({actor='map_a'}={}){
 const byId=new Map();const toolsMenu=new Element('nav');byId.set('toolsMenu',toolsMenu);
 const fetches=[],handlers={},events=[];
 let account={actor,generation:1};
 const document={readyState:'complete',body:new Element('body'),visibilityState:'visible',
  createElement(tag){const el=new Element(tag);const set=el.setAttribute.bind(el);Object.defineProperty(el,'id',{get(){return el._id;},set(v){el._id=v;byId.set(v,el);}});return el;},
  createTextNode:t=>({textContent:String(t)}),getElementById:id=>byId.get(id)||null,addEventListener(){}};
 const context=vm.createContext({document,fetch:(path,init={})=>new Promise((resolve,reject)=>{fetches.push({path,method:init.method||'GET',body:init.body,resolve,reject});}),
  setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},AbortController,
  window:{HauntologiesAccount:{snapshot:()=>account,isCurrent:expected=>!!expected&&expected.actor===account.actor&&expected.generation===account.generation},addEventListener:(type,fn)=>{handlers[type]=fn;},dispatchEvent:e=>events.push(e)},
  CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}}});
 vm.runInContext(source,context);
 const dialog=byId.get('contributorsDialog'),listed=byId.get('contributorListed'),listing=listed&&findParent(dialog,findParent(dialog,listed));
 const reply=(index,body,ok=true)=>fetches[index].resolve({ok,status:ok?200:503,json:async()=>body});
 return {dialog,listed,listing,fetches,events,handlers,reply,switchAccount:next=>{account={actor:next,generation:account.generation+1};},status:()=>dialog.children[1].children.find(n=>n.className==='contributors-status').textContent};
}
function findParent(root,target){for(const child of root.children||[]){if(child===target)return root;const hit=findParent(child,target);if(hit)return hit;}return null;}
test('the switch says what it governs, in the dialog as rendered',()=>{
 const m=mount();assert.ok(m.listed,'the switch exists');
 const label=m.listing.children[0],help=m.listing.children[1];
 assert.equal(label.tagName,'label');assert.equal(label.textContent,' Show my name on the map');
 assert.ok(!label.textContent.includes('in this list'));
 assert.equal(help.textContent,'This applies everywhere your name appears: places under review, published places, Published edits and this list, including your earlier contributions. Off takes your name off every public list; on shows it again.');
 assert.equal(m.listed.attributes['aria-describedby'],help._id);
});
test('a write that finishes after the account changed touches nothing; the next sign-in releases the switch',async()=>{
 const m=mount({actor:'map_a'});
 m.listed.checked=false;const write=m.listed.listeners.change();
 assert.equal(m.listed.disabled,true);assert.equal(m.fetches[0].method,'POST');assert.deepEqual(JSON.parse(m.fetches[0].body),{listed:false});
 m.switchAccount('map_b');
 m.reply(0,{listed:false});await write;
 assert.equal(m.events.length,0,'no listing event reaches the form for an account that is no longer current');
 assert.equal(m.listed.checked,false,'nothing re-rendered from the stale answer');assert.equal(m.fetches.length,1,'no stale refresh of the list');
 assert.equal(m.listed.disabled,true,'the stale write leaves the control alone');
 m.handlers['contributions-session-started']({detail:{actor:'map_b'}});
 assert.equal(m.listed.disabled,false,'the next account\'s load decides what the switch shows');assert.equal(m.listing.hidden,true);
});
test('a write for the current account lands, tells the form which account changed, and refreshes the list',async()=>{
 const m=mount({actor:'map_a'});
 m.listed.checked=false;const write=m.listed.listeners.change();
 m.reply(0,{listed:false});await write;await flush();
 assert.equal(m.listed.disabled,false);assert.equal(m.listed.checked,false);
 assert.deepEqual(JSON.parse(JSON.stringify(m.events.map(e=>[e.type,e.detail]))),[['contributor-listing-changed',{listed:false,actor:'map_a'}]]);
 assert.equal(m.fetches[1]?.method,'GET');assert.equal(m.fetches[1]?.path,'/api/contributor-roster');
});
test('an interrupted write is checked against the server before failure is declared, for the current account only',async()=>{
 const m=mount({actor:'map_a'});const last=()=>m.fetches.length-1;
 // The write fails; the reread says it did not land: reverted and explained.
 m.listed.checked=false;let write=m.listed.listeners.change();m.reply(last(),{},false);await flush();
 assert.equal(m.fetches.at(-1).method,'GET','the server is asked before failure is declared');
 m.reply(last(),{registrants:[],you:{listed:true}});await write;
 assert.equal(m.listed.checked,true,'reverted');assert.equal(m.listed.disabled,false);assert.equal(m.status(),'That did not save. Try again in a moment.');assert.equal(m.events.length,0);
 // The write fails, but the reread shows it landed: treated as saved.
 m.listed.checked=false;write=m.listed.listeners.change();m.fetches.at(-1).reject(new TypeError('network'));await flush();
 m.reply(last(),{registrants:[],you:{listed:false}});await write;await flush();
 assert.equal(m.listed.checked,false);assert.equal(m.listed.disabled,false);
 assert.deepEqual(JSON.parse(JSON.stringify(m.events.map(e=>[e.type,e.detail]))),[['contributor-listing-changed',{listed:false,actor:'map_a'}]]);
 // A 200 without a boolean is not a saved change either; the reread decides.
 m.listed.checked=true;write=m.listed.listeners.change();m.reply(last(),{listed:'yes'});await flush();m.reply(last(),{registrants:[],you:{listed:false}});await write;
 assert.equal(m.listed.checked,false);assert.equal(m.status(),'That did not save. Try again in a moment.');
 // A stale failure neither reverts nor rereads for the old account.
 m.listed.checked=true;write=m.listed.listeners.change();const stale=last();m.switchAccount('map_b');m.reply(stale,{},false);await write;await flush();
 assert.equal(m.listed.checked,true,'untouched');assert.equal(m.listed.disabled,true);assert.equal(m.fetches.at(-1).method,'POST','no reread for an account that is no longer current');
});
