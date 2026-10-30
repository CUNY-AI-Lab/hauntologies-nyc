import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/contributors-dropdown.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
class Element {
 constructor(){this.children=[];this.listeners={};this._text='';this.open=false;this.style={setProperty(){}};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 set textContent(text){this._text=String(text);this.children=[];}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 set innerHTML(_){throw Error('Untrusted text must not be HTML');}
 addEventListener(type,fn){this.listeners[type]=fn;}
 fire(type,event={}){this.listeners[type]?.(event);}
 getBoundingClientRect(){return {top:100};}
 focus(){}
}
function mount(){
 const nodes=Object.fromEntries(['contributorsDropdown','contributorsPanel','contributorsList','contributorsStatus','refreshContributors','contributorsToggle','contributorsButton'].map(id=>[id,new Element()])),pending=[],handlers={};
 const document={hidden:false,getElementById:id=>nodes[id],createElement:()=>new Element(),addEventListener:(type,fn)=>handlers[type]=fn};
 const window={addEventListener:(type,fn)=>handlers[type]=fn,HauntologiesPublicReads:{json:path=>new Promise((resolve,reject)=>pending.push({path,resolve,reject}))}};
 vm.runInNewContext(source,{document,window,location:{hash:''},setInterval:()=>1,clearInterval(){}});
 const toggle=open=>{nodes.contributorsDropdown.open=open;nodes.contributorsDropdown.fire('toggle');};
 const reply=(index,contributors)=>pending[index].resolve({schema_version:'1.0',contributors});
 return {nodes,pending,handlers,document,toggle,reply,list:nodes.contributorsList,status:nodes.contributorsStatus};
}
const person=(name,published=1)=>({name,published,legacy:0});
test('dropdown reads only public summary and preserves separate people with a shared username',async()=>{
 const m=mount();m.toggle(true);m.reply(0,[person('NightOwl',2),person('NightOwl')]);await flush();
 assert.deepEqual(m.pending.map(item=>item.path),['/api/contributors-summary']);assert.equal(m.list.children.length,2);assert.match(m.list.textContent,/Shared username, separate contributor/);
});
test('closing or changing account invalidates responses and clears names',async()=>{
 const m=mount();m.toggle(true);m.toggle(false);m.reply(0,[person('OldName')]);await flush();assert.equal(m.list.children.length,0);
 m.toggle(true);m.handlers['contributions-session-ended']();m.reply(2,[person('CurrentName')]);m.reply(1,[person('StaleName')]);await flush();assert.match(m.list.textContent,/CurrentName/);assert.doesNotMatch(m.list.textContent,/StaleName/);
});
test('hidden tab clears public names and pending responses cannot restore them',async()=>{
 const m=mount();m.toggle(true);m.document.hidden=true;m.handlers.visibilitychange();m.reply(0,[person('OldName')]);await flush();assert.equal(m.list.children.length,0);
 m.document.hidden=false;m.handlers.visibilitychange();m.reply(1,[person('FreshName')]);await flush();assert.match(m.list.textContent,/FreshName/);
});
test('malformed identities and counts clear prior rows and show retry state',async()=>{
 for(const invalid of [person('person@example.test'),person('BadCount',-1),{...person('Fraction'),legacy:0.5}]){
  const m=mount();m.toggle(true);m.reply(0,[person('Previous')]);await flush();m.nodes.refreshContributors.fire('click');assert.equal(m.list.children.length,0);m.reply(1,[invalid]);await flush();assert.equal(m.list.children.length,0);assert.match(m.status.textContent,/unavailable/);
 }
});
test('public usernames render literally and an offline refresh clears them',async()=>{
 const m=mount(),name='<img src=x onerror=alert(1)>';m.toggle(true);m.reply(0,[person(name)]);await flush();assert.equal(m.list.children[0].children[0].textContent,name);assert.equal(m.list.children[0].children[0].children.length,0);
 m.nodes.refreshContributors.fire('click');m.pending[1].reject(Error('offline'));await flush();assert.equal(m.list.children.length,0);assert.match(m.status.textContent,/unavailable/);
});
