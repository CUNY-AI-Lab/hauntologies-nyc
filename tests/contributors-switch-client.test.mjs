import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/contributors.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.open=false;this._text='';this.className='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 set textContent(v){this._text=String(v);this.children=[];}
 get textContent(){return this._text+this.children.map(n=>n.textContent||'').join('');}
 set innerHTML(_){throw Error('Untrusted username must be rendered as text');}
 get childElementCount(){return this.children.length;}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(k,v){(this.listeners[k]??=[]).push(v);}
 fire(k,event={}){for(const fn of this.listeners[k]||[])fn(event);}
 focus(){}showModal(){this.open=true;}close(){this.open=false;this.fire('close');}
 getBoundingClientRect(){return {left:0,top:0,right:100,bottom:100};}
}
function mount(){
 const byId=new Map([['toolsMenu',new Element('nav')]]),fetches=[],handlers={};
 const document={readyState:'complete',body:new Element('body'),visibilityState:'visible',createElement(tag){const el=new Element(tag);Object.defineProperty(el,'id',{get(){return el._id;},set(v){el._id=v;byId.set(v,el);}});return el;},getElementById:id=>byId.get(id)||null,addEventListener(){}};
 const context=vm.createContext({document,fetch:(path,init={})=>new Promise((resolve,reject)=>fetches.push({path,method:init.method||'GET',resolve,reject})),setInterval:()=>0,clearInterval(){},window:{addEventListener:(type,fn)=>{handlers[type]=fn;}}});
 vm.runInContext(source,context);
 const dialog=byId.get('contributorsDialog'),list=dialog.children[1].children.find(n=>n.tagName==='ol'),status=dialog.children[1].children.find(n=>n.className==='contributors-status');
 return {byId,dialog,list,status,fetches,handlers,open:()=>byId.get('contributorsButton').fire('click'),reply:(index,body,status=200)=>fetches[index].resolve({ok:status===200,status,json:async()=>body})};
}
test('Contributors has no separate attribution toggle and makes only reads',async()=>{
 const m=mount();assert.equal(m.byId.has('contributorListed'),false);assert.ok(!m.dialog.textContent.includes('Show my name'));
 m.open();m.reply(0,{registrants:[{name:'NightOwl',contributions:2,published:1,account:true}]});await flush();
 assert.equal(m.list.children.length,1);assert.match(m.list.textContent,/NightOwl/);assert.deepEqual(m.fetches.map(f=>f.method),['GET']);
});
test('an account change clears prior rows and stale roster responses cannot replace the new list',async()=>{
 const m=mount();m.open();m.reply(0,{registrants:[{name:'OldAccount',contributions:1,account:true}]});await flush();
 m.open();m.handlers['contributions-session-started']({detail:{actor:'map_b'}});assert.equal(m.list.children.length,0);
 m.reply(2,{registrants:[{name:'NewAccount',contributions:2,account:true}]});await flush();
 m.reply(1,{registrants:[{name:'LateOldAccount',contributions:3,account:true}]});await flush();
 assert.match(m.list.textContent,/NewAccount/);assert.ok(!m.list.textContent.includes('OldAccount'));
});
test('sign-out invalidates a pending roster read and uses published credits after a 401',async()=>{
 const m=mount();m.open();m.handlers['contributions-session-ended']({detail:{}});
 m.reply(0,{registrants:[{name:'PrivateAccountView',contributions:1,account:true}]});await flush();assert.equal(m.list.children.length,0);
 m.reply(1,{},401);await flush();assert.equal(m.fetches[2].path,'/api/contributor-credits');
 m.reply(2,{contributors:[{name:'PublicMoniker',count:1}],total:1});await flush();assert.equal(m.list.children[0].children[0].textContent,'PublicMoniker');
});
test('a stale published-credit fallback cannot render after a new sign-in',async()=>{
 const m=mount();m.open();m.reply(0,{},401);await flush();
 m.handlers['contributions-session-started']({detail:{actor:'map_b'}});m.reply(2,{registrants:[{name:'CurrentMoniker',contributions:1,account:true}]});await flush();
 m.reply(1,{contributors:[{name:'StaleMoniker',count:1}],total:1});await flush();assert.equal(m.list.children[0].children[0].textContent,'CurrentMoniker');
});
test('untrusted usernames are literal text in both roster and public-credit responses',async()=>{
 const name='<img src=x onerror=alert(1)>';
 const m=mount();m.open();m.reply(0,{registrants:[{name,contributions:1,account:true}]});await flush();
 assert.equal(m.list.children[0].children[0].textContent,name);assert.equal(m.list.children[0].children[0].children.length,0);
 m.open();m.reply(1,{},401);await flush();m.reply(2,{contributors:[{name,count:1}],total:1});await flush();assert.equal(m.list.children[0].children[0].textContent,name);
});
test('a failed initial roster read explains unavailability without leaking prior rows',async()=>{
 const m=mount();m.open();m.fetches[0].reject(Error('offline'));await flush();assert.equal(m.list.children.length,0);assert.match(m.status.textContent,/unavailable/);
});
