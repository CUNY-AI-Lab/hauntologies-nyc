import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function fixture(){
 const events=[],listeners=new Map(),controls=[{hidden:false}],documentListeners={},saved=new Map();let observe;
 const window={addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)||[])fn(event);}};
 const document={documentElement:{dataset:{}},body:{},querySelectorAll:()=>controls,addEventListener:(type,fn)=>{documentListeners[type]=fn;}};
 const context=vm.createContext({window,document,Date,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)},MutationObserver:class{constructor(fn){observe=fn;}observe(){}}});
 vm.runInContext(read('public/account-state.js'),context);
 return{window,document,context,controls,events,documentListeners,saved,api:window.HauntologiesAccount,observe:()=>observe()};
}
const signIn=(h,actor='actor-a')=>h.api.resolve({actor_id:actor,password_required:false});
test('unknown, anonymous, password-incomplete and malformed sessions cannot expose contribution controls',()=>{
 const h=fixture();assert.equal(h.api.snapshot().status,'unknown');assert.equal(h.controls[0].hidden,true);
 for(const session of [null,{}, {actor_id:'a'}, {actor_id:'a',password_required:true},{actor_id:'',password_required:false}]){h.api.resolve(session);assert.equal(h.api.canContribute(),false);assert.equal(h.controls[0].hidden,true);}
});
test('signin, expiry, return and account switch publish ordered state before private lifecycle events',()=>{
 const h=fixture(),seen=[];h.window.addEventListener('contributions-session-started',()=>seen.push(h.api.snapshot().actor));
 signIn(h);const first=h.api.snapshot();assert.equal(h.controls[0].hidden,false);assert.equal(h.api.isCurrent(first),true);
 h.api.invalidate(first);assert.equal(h.controls[0].hidden,true);assert.equal(h.api.isCurrent(first),false);
 signIn(h);signIn(h,'actor-b');assert.deepEqual(seen,['actor-a','actor-a','actor-b']);assert.equal(h.api.snapshot().actor,'actor-b');
 const recent=h.events.slice(-3).map(e=>e.type);assert.deepEqual(recent,['hauntologies-auth-changed','contributions-session-ended','contributions-session-started']);
});
test('late old-account failure cannot invalidate a new account or a restored session of the same owner',()=>{
 const h=fixture();signIn(h);const old=h.api.snapshot();signIn(h,'actor-b');h.api.invalidate(old);assert.equal(h.api.snapshot().actor,'actor-b');
 signIn(h);h.api.invalidate(old);assert.equal(h.api.snapshot().actor,'actor-a');assert.notEqual(h.api.snapshot().generation,old.generation);
});
test('hidden/page-restored state fails closed without changing Event details or the map view',()=>{
 const h=fixture();signIn(h);h.api.suspend();assert.equal(h.api.snapshot().status,'unknown');assert.equal(h.controls[0].hidden,true);
 signIn(h);assert.equal(h.controls[0].hidden,false);
 assert.doesNotMatch(read('public/account-state.js'),/setView|setZoom|eventDetails/);
});
test('a temporarily hidden tab pauses access without ending the same account session',()=>{
 const h=fixture();signIn(h);const before=h.api.snapshot(),ends=()=>h.events.filter(e=>e.type==='contributions-session-ended').length,starts=()=>h.events.filter(e=>e.type==='contributions-session-started').length;
 h.api.pause();assert.equal(h.api.snapshot().status,'unknown');assert.equal(h.api.snapshot().actor,'actor-a');assert.equal(h.api.canContribute(),false);assert.equal(h.api.isCurrent(before),false);assert.equal(h.controls[0].hidden,true);assert.equal(ends(),0);
 signIn(h);assert.equal(h.api.snapshot().actor,'actor-a');assert.equal(h.api.canContribute(),true);assert.equal(h.controls[0].hidden,false);assert.equal(ends(),0);assert.equal(starts(),1);
 h.api.pause();signIn(h,'actor-b');assert.equal(ends(),1);assert.equal(starts(),2);assert.equal(h.api.snapshot().actor,'actor-b');
});
test('navigation and explicit sign-out still end a paused account',()=>{
 const h=fixture();signIn(h);h.api.pause();h.api.suspend();assert.equal(h.api.snapshot().actor,null);assert.equal(h.api.snapshot().status,'unknown');assert.equal(h.events.filter(e=>e.type==='contributions-session-ended').length,1);
 signIn(h);h.api.pause();h.window.dispatchEvent({type:'contributions-session-ended',detail:{signedOut:true}});assert.equal(h.api.snapshot().status,'signed_out');assert.equal(h.api.snapshot().actor,null);assert.ok(h.saved.has('hauntologies-signed-out:actor-a'));
});
test('dynamic controls and programmatic click/submit attempts remain blocked while signed out',()=>{
 const h=fixture();const dynamic={hidden:false};h.controls.push(dynamic);h.observe();assert.equal(dynamic.hidden,true);
 let prevented=0,stopped=0;const event={target:{closest:()=>dynamic},preventDefault(){prevented++;},stopImmediatePropagation(){stopped++;}};
 h.documentListeners.click(event);h.documentListeners.submit(event);assert.equal(prevented,2);assert.equal(stopped,2);
 signIn(h);h.documentListeners.click(event);assert.equal(prevented,2);assert.equal(dynamic.hidden,false);
});
test('explicit logout broadcasts the original account marker but does not delete its saved draft',()=>{
 const h=fixture();signIn(h);h.window.dispatchEvent({type:'contributions-session-ended',detail:{signedOut:true}});
 assert.ok(h.saved.has('hauntologies-signed-out:actor-a'));assert.equal(h.api.snapshot().status,'signed_out');
 const source=read('public/contributions.js');assert.match(source,/if\(privateActor\).*saveDraft\(\);privateImages/s);assert.doesNotMatch(source,/signedOut\)forgetDraft|signedOut&&accountKey\)\{forgetDraft/);
});
test('missing auth helper leaves all contribution entry points fail-closed in static markup',()=>{
 const html=read('web/index.html');for(const id of ['toolsButton','plotPlaceButton','contributionWorkspace'])assert.match(html,new RegExp('id="'+id+'" data-requires-account hidden'));
 assert.ok(html.indexOf('src="account-state.js"')<html.indexOf('src="app.js"'));assert.match(read('public/app.js'),/function requestContributionPoint[^]*?if\(!window\.HauntologiesAccount\?\.canContribute\(\)\)return false/);
});
test('Event details is collapsed before scripts run; other disclosures retain their intended defaults',()=>{
 const html=read('web/index.html');assert.doesNotMatch(html.match(/<details[^>]*id="eventDetails"[^>]*>/)[0],/\bopen\b/);assert.match(html,/<details id="filterDetails"[^>]* open>/);
});
test('jack-o-lantern retains review semantics and 44px target with reduced-motion steady glow',()=>{
 const html=read('web/index.html'),css=read('public/map-controls.css');assert.match(html,/review-lantern" aria-label="Under review"/);assert.match(html,/class="lantern-eyes"/);assert.match(css,/review-hourglass\{width:44px;min-height:44px/);assert.match(css,/@media\(prefers-reduced-motion:reduce\).*animation:none/);
});
test('failed contribution session confirmation invalidates only its captured account',async()=>{
 const source=read('public/contributions.js'),part=source.slice(source.indexOf('  async function sessionActor(){'),source.indexOf('  async function requireOriginalActor('));
 const h=fixture();signIn(h);let reject;h.context.api=()=>new Promise((_,r)=>reject=r);vm.runInContext(part+';globalThis.confirm=sessionActor;',h.context);
 const pending=h.context.confirm();signIn(h,'actor-b');reject(new Error('Synthetic timeout'));await assert.rejects(pending);assert.equal(h.api.snapshot().actor,'actor-b');
 const next=h.context.confirm();reject(new Error('Synthetic unavailable'));await assert.rejects(next);assert.equal(h.api.snapshot().status,'signed_out');
});
function accountFixture(){
 const h=fixture(),nodes=new Map(),requests=[],intervals=[];
 class Node{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.hidden=false;this.open=false;this.value='';this.textContent='';this.isConnected=true;this.attributes={};}
  append(...children){for(const child of children){if(typeof child==='object')child.parentElement=this;this.children.push(child);}}
  after(child){if(child.id)nodes.set(child.id,child);} replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  async emit(type,event={}){for(const fn of this.listeners[type]||[])await fn({preventDefault(){},...event});}
  focus(){} reportValidity(){return true;} showModal(){this.open=true;} close(){this.open=false;this.emit('close');}
 }
 h.document.getElementById=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};h.document.createElement=tag=>new Node(tag);
 h.document.visibilityState='visible';h.document.hidden=false;h.document.activeElement=null;
 Object.assign(h.context,{AbortController,URL,URLSearchParams,location:new URL('https://synthetic.test/'),history:{replaceState(){}},sessionStorage:{getItem(){},setItem(){},removeItem(){}},setTimeout:()=>1,clearTimeout(){},setInterval:fn=>intervals.push(fn),FormData:class{*[Symbol.iterator](){yield ['email','synthetic@example.test'];yield ['password','synthetic-password-only'];}},fetch:(path,options)=>new Promise(resolve=>requests.push({path,options,resolve}))});
 vm.runInContext(read('public/account.js'),h.context);
 const answer=(request,value,status=200)=>request.resolve({ok:status===200,status,json:async()=>value});
 const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
 return{...h,nodes,requests,intervals,answer,settle,node:id=>h.document.getElementById(id)};
}
test('closing account during session check still updates identity without reopening its dialog',async()=>{
 const h=accountFixture();h.node('accountDialog').open=true;h.node('accountDialog').close();h.answer(h.requests[0],{actor_id:'actor-a',password_required:false});await h.settle();assert.equal(h.api.snapshot().actor,'actor-a');assert.equal(h.node('accountDialog').open,false);assert.equal(h.node('accountButton').textContent,'Account');
});
test('focus/pageshow bursts coalesce one account check; periodic checks do not erase open auth forms',async()=>{
 const h=accountFixture();h.window.dispatchEvent({type:'focus'});h.window.dispatchEvent({type:'pageshow'});assert.equal(h.requests.length,1);
 h.node('accountDialog').open=true;h.answer(h.requests[0],{error:'sign_in_required'},401);await h.settle();
 const form=h.node('accountActions').children;assert.ok(form.length);const existing=h.node('accountActions').children;
 h.intervals[0]();h.documentListeners.visibilitychange();await h.settle();assert.equal(h.requests.length,1);assert.equal(h.node('accountActions').children,existing);
});
test('tab visibility keeps the same session and open feed until a fresh check succeeds',async()=>{
 const h=accountFixture();h.answer(h.requests[0],{actor_id:'actor-a',password_required:false,email:'synthetic@example.test'});await h.settle();
 const feed=h.node('publishedEditsFeed');feed.open=true;feed.hidden=false;const ended=()=>h.events.filter(e=>e.type==='contributions-session-ended').length;
 h.document.hidden=true;h.document.visibilityState='hidden';h.documentListeners.visibilitychange();assert.equal(h.api.snapshot().status,'unknown');assert.equal(h.api.snapshot().actor,'actor-a');assert.equal(feed.open,true);assert.equal(feed.hidden,true);assert.equal(ended(),0);
 h.window.dispatchEvent({type:'focus'});assert.equal(h.requests.length,1,'focus on a hidden tab does not start a session check');
 h.document.hidden=false;h.document.visibilityState='visible';h.documentListeners.visibilitychange();assert.equal(h.requests.length,2);h.answer(h.requests[1],{actor_id:'actor-a',password_required:false,email:'synthetic@example.test'});await h.settle();
 assert.equal(h.api.snapshot().status,'signed_in');assert.equal(feed.open,true);assert.equal(feed.hidden,false);assert.equal(ended(),0);
});
test('a stale pre-hide session answer cannot restore the wrong account after a tab switch',async()=>{
 const h=accountFixture();h.answer(h.requests[0],{actor_id:'actor-a',password_required:false,email:'synthetic@example.test'});await h.settle();
 h.window.dispatchEvent({type:'focus'});assert.equal(h.requests.length,2);
 h.document.hidden=true;h.document.visibilityState='hidden';h.documentListeners.visibilitychange();
 h.document.hidden=false;h.document.visibilityState='visible';h.documentListeners.visibilitychange();assert.equal(h.requests.length,3);
 h.answer(h.requests[2],{actor_id:'actor-b',password_required:false,email:'other@example.test'});await h.settle();
 h.answer(h.requests[1],{actor_id:'actor-a',password_required:false,email:'synthetic@example.test'});await h.settle();
 assert.equal(h.api.snapshot().actor,'actor-b');assert.equal(h.events.filter(e=>e.type==='contributions-session-ended').length,1);
});
test('a temporary session-check failure keeps the draft paused until verification can retry',async()=>{
 const h=accountFixture();h.answer(h.requests[0],{actor_id:'actor-a',password_required:false,email:'synthetic@example.test'});await h.settle();
 h.document.hidden=true;h.document.visibilityState='hidden';h.documentListeners.visibilitychange();
 h.document.hidden=false;h.document.visibilityState='visible';h.documentListeners.visibilitychange();
 h.answer(h.requests[1],{error:'unavailable'},503);await h.settle();assert.equal(h.api.snapshot().status,'unknown');assert.equal(h.api.snapshot().actor,'actor-a');assert.equal(h.api.canContribute(),false);
 h.window.dispatchEvent({type:'focus'});assert.equal(h.requests.length,3);h.answer(h.requests[2],{actor_id:'actor-a',password_required:false,email:'synthetic@example.test'});await h.settle();
 assert.equal(h.api.snapshot().status,'signed_in');assert.equal(h.events.filter(e=>e.type==='contributions-session-ended').length,0);
});
test('signin starts a fresh check and ignores an older in-flight anonymous result',async()=>{
 const h=accountFixture();h.node('accountDialog').open=true;h.answer(h.requests[0],{error:'sign_in_required'},401);await h.settle();
 // A bfcache session check begins while the sign-in form remains on screen.
 h.window.dispatchEvent({type:'pageshow',persisted:true});assert.equal(h.requests.length,2);
 const form=h.node('accountFormHost').children[0],saving=form.emit('submit');await h.settle();
 assert.equal(h.requests[2].path,'/api/auth/sign-in');h.answer(h.requests[2],{});await h.settle();
 assert.equal(h.requests[3].path,'/api/auth/session','successful sign-in must not reuse the older check');
 h.answer(h.requests[3],{actor_id:'actor-a',password_required:false,email:'synthetic@example.test'});await h.settle();
 h.answer(h.requests[1],{error:'sign_in_required'},401);await h.settle();assert.equal(h.api.snapshot().actor,'actor-a');
 assert.equal(h.requests[4].path,'/api/contributions/edits?page=1');h.answer(h.requests[4],{total:0});await saving;
 assert.equal(h.api.snapshot().actor,'actor-a');
});
test('ambiguous sign-out fails closed without claiming a confirmed logout or deleting drafts',async()=>{
 const h=accountFixture();h.node('accountDialog').open=true;h.answer(h.requests[0],{actor_id:'actor-a',password_required:false,email:'synthetic@example.test'});await h.settle();h.answer(h.requests[1],{total:0});await h.settle();
 const control=h.node('accountActions').children.find(n=>n.textContent==='Sign out'),leaving=control.emit('click');await h.settle();assert.equal(h.requests[2].path,'/api/auth/sign-out');h.answer(h.requests[2],{error:'account_unavailable'},503);await leaving;
 assert.equal(h.api.canContribute(),false);assert.equal(h.controls[0].hidden,true);assert.match(h.node('accountStatus').textContent,/Sign-out could not be confirmed/);assert.equal(h.saved.has('hauntologies-signed-out:actor-a'),false);
});
test('a signed-in poll that fails on a dropped connection pauses and retries instead of signing out',async()=>{
 const h=accountFixture(),timers=[];h.context.setTimeout=(fn,delay)=>{if(delay===5000)timers.push(fn);return 1;};
 const ended=()=>h.events.filter(e=>e.type==='contributions-session-ended').length,session={actor_id:'actor-a',password_required:false,email:'synthetic@example.test'};
 h.answer(h.requests[0],session);await h.settle();assert.equal(h.api.snapshot().status,'signed_in');
 h.intervals[0]();assert.equal(h.requests.length,2);h.answer(h.requests[1],{error:'unavailable'},503);await h.settle();
 assert.equal(h.api.snapshot().status,'unknown');assert.equal(h.api.snapshot().actor,'actor-a');assert.equal(h.api.canContribute(),false);assert.equal(ended(),0);assert.equal(h.node('accountButton').textContent,'Account');
 assert.equal(timers.length,1,'a quick retry is scheduled');timers[0]();assert.equal(h.requests.length,3);h.answer(h.requests[2],session);await h.settle();
 assert.equal(h.api.snapshot().status,'signed_in');assert.equal(ended(),0);
 // A platform error page is not JSON; it pauses the account and never surfaces a parser message.
 h.intervals[0]();h.requests[3].resolve({ok:false,status:502,json:async()=>{throw new SyntaxError('Unexpected token <');}});await h.settle();
 assert.equal(h.api.snapshot().status,'unknown');assert.equal(h.api.snapshot().actor,'actor-a');assert.equal(ended(),0);assert.doesNotMatch(h.node('accountStatus').textContent,/Unexpected token/);
 // An expired session still ends the account.
 h.window.dispatchEvent({type:'focus'});h.answer(h.requests[4],{error:'sign_in_required'},401);await h.settle();
 assert.equal(h.api.snapshot().status,'signed_out');assert.equal(h.api.snapshot().actor,null);assert.ok(ended()>=1);
});
test('a failed poll behind an open modal keeps the sign-out path so a hidden modal cannot block the page',async()=>{
 const h=accountFixture(),timers=[];h.context.setTimeout=(fn,delay)=>{if(delay===5000)timers.push(fn);return 1;};
 h.answer(h.requests[0],{actor_id:'actor-a',password_required:false,email:'synthetic@example.test'});await h.settle();
 h.node('ownEditsDialog').open=true;h.intervals[0]();h.answer(h.requests[1],{error:'unavailable'},503);await h.settle();
 assert.equal(h.api.snapshot().status,'signed_out');assert.equal(h.document.documentElement.dataset.accountPaused,'false');assert.equal(timers.length,0);
});
