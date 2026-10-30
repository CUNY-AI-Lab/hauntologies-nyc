import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const app=read('public/app.js'),editor=read('public/record-editor.js');
const appStart=app.indexOf("window.addEventListener('hauntologies-auth-changed',event=>{editRequest++");
const appListener=app.slice(appStart,app.indexOf('renderPendingPlaces();});',appStart)+'renderPendingPlaces();});'.length);
const focusListener=editor.slice(editor.indexOf("  window.addEventListener('focus',async()=>{if(current&&window.HauntologiesAccount"),editor.indexOf("  byId('recordPublicMoniker').addEventListener"));
function fixture(panel){
 const listeners=new Map(),events=[],workspace={hidden:false,value:'Unsent synthetic contribution'},dialog={open:true,inert:false,value:'Unsent synthetic field'},sidecar={hidden:false},tools={hidden:true};let closes=0,clears=0,checks=0,resolve,reject;
 const window={addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)||[])fn(event);}};
 const document={documentElement:{dataset:{}},body:{},querySelectorAll:()=>[workspace],getElementById:id=>id==='recordEditorDialog'?dialog:null,addEventListener(){}};
 const nodes={toolsMenu:tools,draftPanel:{classList:{contains:value=>value==='active'&&panel==='contribute'}}};
 const context=vm.createContext({window,document,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},MutationObserver:class{observe(){}},localStorage:{setItem(){}},
  $:id=>nodes[id],editRequest:0,selectingContributionPlace:false,stopContributionPicking(){},clearProposedPoint(){},renderPendingPlaces(){},closeTools(){closes++;sidecar.hidden=true;},
  current:{actor_id:'actor-a'},api:()=>{checks++;return new Promise((a,b)=>{resolve=a;reject=b;});},hidePrivateEditor(){clears++;context.current=null;dialog.open=false;dialog.value='';}});
 vm.runInContext(read('public/account-state.js'),context);vm.runInContext(appListener,context);vm.runInContext("window.addEventListener('contributions-session-ended',hidePrivateEditor);"+focusListener,context);
 const signIn=actor=>window.HauntologiesAccount.resolve({actor_id:actor,password_required:false});
 signIn('actor-a');sidecar.hidden=false;closes=0;clears=0;return {window,document,context,workspace,dialog,sidecar,signIn,closes:()=>closes,clears:()=>clears,checks:()=>checks,resolve:value=>resolve(value),reject:error=>reject(error)};
}
for(const panel of ['contribute','places'])test(`${panel} panel and editor draft survive a temporary tab switch`,async()=>{
 const h=fixture(panel),account=h.window.HauntologiesAccount,before=account.snapshot();account.pause();
 assert.equal(h.sidecar.hidden,false);assert.equal(h.dialog.open,true);assert.equal(h.dialog.inert,true);assert.equal(h.workspace.hidden,true);assert.equal(account.isCurrent(before),false);
 h.window.dispatchEvent({type:'focus'});assert.equal(h.checks(),0,'an unresolved account does not start the editor session check');
 h.signIn('actor-a');assert.equal(h.sidecar.hidden,false);assert.equal(h.dialog.open,true);assert.equal(h.dialog.inert,false);assert.equal(h.workspace.hidden,false);assert.equal(h.workspace.value,'Unsent synthetic contribution');assert.equal(h.dialog.value,'Unsent synthetic field');assert.equal(h.closes(),0);assert.equal(h.clears(),0);
 h.window.dispatchEvent({type:'focus'});assert.equal(h.checks(),1);h.resolve({actor_id:'actor-a'});await Promise.resolve();assert.equal(h.dialog.open,true);
});
test('a real account switch ends the private editor, and an intentionally closed panel stays closed',()=>{
 const h=fixture('contribute');h.window.HauntologiesAccount.pause();h.sidecar.hidden=true;h.signIn('actor-a');assert.equal(h.sidecar.hidden,true,'resume does not reopen a deliberately closed panel');
 h.window.HauntologiesAccount.pause();h.signIn('actor-b');assert.equal(h.dialog.open,false);assert.equal(h.dialog.value,'');assert.ok(h.clears()>0);assert.ok(h.closes()>0);
});
test('a late failed focus check from before suspension cannot close the restored editor',async()=>{
 const h=fixture('places');h.window.dispatchEvent({type:'focus'});assert.equal(h.checks(),1);h.window.HauntologiesAccount.pause();h.signIn('actor-a');h.reject(new Error('synthetic timeout'));await Promise.resolve();await Promise.resolve();assert.equal(h.dialog.open,true);assert.equal(h.dialog.value,'Unsent synthetic field');assert.equal(h.clears(),0);
});
