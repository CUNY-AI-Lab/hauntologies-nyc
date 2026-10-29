import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// The Contribute form's public credit: sent only with the box checked and a name typed, remembered
// per account on this device, carried through revisions, and described by a hint that states the
// effective result only after a valid answer for the current account. Synthetic controls, storage
// and network only; every fetch is a controlled promise.
const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
const part=source.slice(source.indexOf('  const creditStorageKey='),source.indexOf('  function buildEnvelope(){'));
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture({consent=true,label='',prior=null,actor='map_a',stored={}}={}){
 const hint={children:[],dataset:{},replaceChildren(){this.children=[];this._text='';},append(...n){this.children.push(...n);},set textContent(v){this._text=String(v);this.children=[];},get textContent(){return (this._text||'')+this.children.map(n=>n.textContent||'').join('');},button(){return this.children.find(n=>n.tagName==='button');}};
 const controls={publicCreditHint:hint,publicCreditConsent:{checked:consent},publicCreditLabel:{value:label,disabled:false},contributionSummary:{value:'A lantern moves at night.'},contributionObjectTitle:{value:'Lantern'},freeformTitle:{hidden:false},contributionPlaceName:{textContent:'Kreischer Street'}};
 const storage=new Map(Object.entries(stored));
 // The account primitive as account-state.js exposes it: a frozen snapshot and a generation that moves on every change.
 let account={actor,generation:1};
 const switchAccount=next=>{account={actor:next,generation:account.generation+1};context.privateActor=next;};
 const fetches=[],handlers={},events=[];
 const fetch=(path,init={})=>new Promise((resolve,reject)=>{fetches.push({path,method:init.method||'GET',body:init.body,resolve,reject});});
 const reply=(index,body,ok=true)=>fetches[index].resolve({ok,status:ok?200:503,json:async()=>body});
 const context=vm.createContext({byId:id=>controls[id]||{value:'',hidden:true,textContent:''},text:v=>String(v??''),revisionOriginal:prior,openExplanationDisplayInitial:'',openExplanationInitial:'',pointForm:()=>true,pointGeometry:()=>({type:'Point',coordinates:[-74.2391,40.5365]}),sourceText:()=>'',openSourcesDisplayInitial:'',attributeValues:()=>[],openTargets:[],openRequestedRecordId:'',openTaskIds:[],privateActor:actor,structuredClone,JSON,placeTyped:()=>'',
  localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,v)},fetch,
  window:{HauntologiesAccount:{snapshot:()=>account,isCurrent:expected=>!!expected&&expected.actor===account.actor&&expected.generation===account.generation},addEventListener:(type,fn)=>{handlers[type]=fn;},dispatchEvent:e=>events.push(e)},
  CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},
  document:{createTextNode:t=>({textContent:String(t)})},button:(label,action,className)=>({tagName:'button',textContent:label,className,action,disabled:false})});
 vm.runInContext(part+';globalThis.out={creditValue,buildIntakeEnvelope,setCreditFields,rememberCredit,restoreCreditFields,renderCreditHint,syncCreditState,resetCreditState};',context);
 // Values cross the vm realm, so they are compared as plain JSON.
 const plain=fn=>(...args)=>JSON.parse(JSON.stringify(fn(...args)));
 return {controls,storage,hint,fetches,events,handlers,switchAccount,reply,...context.out,creditValue:plain(context.out.creditValue),buildIntakeEnvelope:plain(context.out.buildIntakeEnvelope)};
}
test('the credit controls sit in the visible form, checked by default, not in the inert legacy block',()=>{
 const legacy=html.slice(html.indexOf('id="typedCompatibilityFields"'),html.indexOf('id="previewContribution"'));
 assert.ok(!legacy.includes('publicCreditConsent')&&!legacy.includes('publicCreditLabel'));
 const details=html.slice(html.indexOf('id="contributionDetails"'),html.indexOf('id="typedCompatibilityFields"'));
 assert.match(details,/<input id="publicCreditConsent" type="checkbox" checked>/);assert.match(details,/id="publicCreditLabel"[^>]*maxlength="120"/);
 assert.ok(!/id="publicCreditLabel"[^>]*\sdisabled/.test(details),'the name field starts enabled');
});
test('a checked box with a name sends consent and the trimmed name; otherwise no consent and no label',()=>{
 assert.deepEqual(fixture({label:'  Ada   Example '}).creditValue(),{consent:true,label:'Ada Example'});
 assert.deepEqual(fixture({label:''}).creditValue(),{consent:false,label:''},'checked but blank is not consent');
 assert.deepEqual(fixture({consent:false,label:'Ada Example'}).creditValue(),{consent:false,label:''},'unchecked drops the typed name');
 assert.equal(fixture({label:'x'.repeat(200)}).creditValue().label.length,120);
});
test('a new contribution and a revision both carry the credit chosen in the form',()=>{
 const fresh=fixture({label:'Ada Example'}).buildIntakeEnvelope();
 assert.equal(fresh.type,'open_proposal');assert.deepEqual(fresh.public_credit,{consent:true,label:'Ada Example'});
 const prior={schema_version:'1.0',type:'open_proposal',task_ids:[],title:'Lantern',summary:'Old',public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{explanation:'Old',geometry:null}};
 const revised=fixture({label:'Ada Example',prior}).buildIntakeEnvelope();
 assert.deepEqual(revised.public_credit,{consent:true,label:'Ada Example'});assert.equal(revised.payload.explanation,'A lantern moves at night.');
 assert.deepEqual(fixture({consent:false,label:'Ada Example',prior}).buildIntakeEnvelope().public_credit,{consent:false,label:''},'a name can be taken off while revising');
});
test('the choice is remembered per account on this device and restored after a form reset',()=>{
 const f=fixture({label:'Ada Example'});f.rememberCredit();
 assert.deepEqual(JSON.parse(f.storage.get('hauntologies-public-credit:map_a')),{consent:true,label:'Ada Example'});
 f.controls.publicCreditConsent.checked=false;f.controls.publicCreditLabel.value='';f.restoreCreditFields();
 assert.equal(f.controls.publicCreditConsent.checked,true);assert.equal(f.controls.publicCreditLabel.value,'Ada Example');assert.equal(f.controls.publicCreditLabel.disabled,false);
 const other=fixture({actor:'map_other',stored:Object.fromEntries(f.storage)});other.controls.publicCreditLabel.value='';other.restoreCreditFields();
 assert.equal(other.controls.publicCreditLabel.value,'','another account does not inherit the name');
 const declined=fixture({stored:{'hauntologies-public-credit:map_a':JSON.stringify({consent:false,label:''})}});declined.restoreCreditFields();
 assert.equal(declined.controls.publicCreditConsent.checked,false);assert.equal(declined.controls.publicCreditLabel.disabled,true,'a remembered opt-out stays opted out');
});
test('the hint reports visibility only after a valid answer for the current account, with its own loading copy',async()=>{
 const f=fixture({label:'Ada Example'});
 f.renderCreditHint();assert.equal(f.hint.dataset.state,'unknown','nothing has been checked yet');
 const sync=f.syncCreditState();
 assert.equal(f.hint.dataset.state,'loading');assert.equal(f.hint.textContent,'Checking whether your name is shown on the map…');
 assert.equal(f.fetches.length,1);assert.equal(f.fetches[0].path,'/api/contributor-roster');assert.equal(f.fetches[0].method,'GET');
 f.reply(0,{registrants:[],you:{listed:false}});await sync;
 assert.equal(f.hint.dataset.state,'hidden');
 assert.ok(f.hint.textContent.startsWith('Your name is hidden on the map right now, so this contribution shows no name until you turn it back on. Turning it on shows your name on every contribution you consented to, earlier ones included.'));
 assert.equal(f.hint.button().textContent,'Show my name on the map');
 f.controls.publicCreditConsent.checked=false;f.renderCreditHint();
 assert.equal(f.hint.dataset.state,undefined);assert.equal(f.hint.textContent,'This contribution shows no name. Check the box and enter a name to be credited.');
});
test('with no name typed the hint says so until the registration name is offered, then states the effective result',async()=>{
 const f=fixture();
 f.renderCreditHint();assert.equal(f.hint.textContent,'This contribution shows no name. Check the box and enter a name to be credited.');
 const sync=f.syncCreditState();assert.equal(f.hint.textContent,'This contribution shows no name. Check the box and enter a name to be credited.','a blank name is the bigger fact while loading');
 f.reply(0,{registrants:[],you:{listed:true,name:'Ada Example'}});await sync;
 assert.equal(f.controls.publicCreditLabel.value,'Ada Example','the registration name is offered once');
 assert.equal(f.hint.dataset.state,undefined);assert.ok(f.hint.textContent.startsWith('Shown with this contribution'));
});
test('a failed or malformed roster read says visibility is unknown and offers to check again',async()=>{
 const f=fixture({label:'Ada Example'});
 const first=f.syncCreditState();f.fetches[0].reject(new TypeError('network'));await first;
 assert.equal(f.hint.dataset.state,'unknown');
 assert.ok(f.hint.textContent.startsWith('Whether your name is shown on the map could not be checked, so this contribution may stay unnamed.'));
 assert.equal(f.hint.button().textContent,'Check again');
 f.hint.button().action();await flush();assert.equal(f.fetches.length,2,'Check again reads the roster again');
 f.reply(1,{registrants:[],you:{}});await flush();
 assert.equal(f.hint.dataset.state,'unknown','a 200 without a boolean listed is not an answer');
 f.hint.button().action();await flush();f.reply(2,{registrants:[]},false);await flush();
 assert.equal(f.hint.dataset.state,'unknown','a 503 is not an answer');
 f.hint.button().action();await flush();f.reply(3,{registrants:[],you:{listed:true}});await flush();
 assert.equal(f.hint.dataset.state,undefined);assert.ok(f.hint.textContent.startsWith('Shown with this contribution'));
});
test('an answer that arrives after the account changed touches nothing of the next account',async()=>{
 const f=fixture({label:'Ada Example'});
 const forA=f.syncCreditState();
 f.switchAccount('map_b');
 const forB=f.syncCreditState();
 assert.equal(f.fetches.length,2);assert.equal(f.hint.dataset.state,'loading');
 // A's read finishes first, saying A is hidden. B's hint must not become A's.
 f.reply(0,{registrants:[],you:{listed:false,name:'Ada Example'}});await forA;
 assert.equal(f.hint.dataset.state,'loading','still waiting on B');assert.equal(f.controls.publicCreditLabel.value,'Ada Example','B typed this name; A\'s answer did not rewrite it');
 f.reply(1,{registrants:[],you:{listed:true}});await forB;
 assert.equal(f.hint.dataset.state,undefined);assert.ok(f.hint.textContent.startsWith('Shown with this contribution'));
 // A write started for one account cannot answer for the next one either.
 f.switchAccount('map_c');const forC=f.syncCreditState();f.reply(2,{registrants:[],you:{listed:false}});await forC;
 assert.equal(f.hint.dataset.state,'hidden');
 const write=f.hint.button().action();await flush();
 assert.equal(f.fetches[3].method,'POST');assert.deepEqual(JSON.parse(f.fetches[3].body),{listed:true});
 f.switchAccount('map_d');const forD=f.syncCreditState();
 f.reply(3,{listed:true});await write;
 assert.equal(f.events.length,0,'no listing event for an account that is no longer current');
 assert.equal(f.hint.dataset.state,'loading','D is still being checked');
 f.reply(4,{registrants:[],you:{listed:false}});await forD;assert.equal(f.hint.dataset.state,'hidden');
 // The same write, for the current account, lands and tells the Contributors dialog.
 const ok=f.hint.button().action();await flush();f.reply(5,{listed:true});await ok;
 assert.equal(f.hint.dataset.state,undefined);assert.deepEqual(JSON.parse(JSON.stringify(f.events.map(e=>[e.type,e.detail]))),[['contributor-listing-changed',{listed:true,actor:'map_d'}]]);
});
test('a listing change from the Contributors dialog applies only when it names the current account',async()=>{
 const f=fixture({label:'Ada Example'});const sync=f.syncCreditState();f.reply(0,{registrants:[],you:{listed:true}});await sync;
 f.handlers['contributor-listing-changed']({detail:{listed:false,actor:'map_someone_else'}});
 assert.equal(f.hint.dataset.state,undefined,'another account\'s change is ignored');
 f.handlers['contributor-listing-changed']({detail:{listed:false,actor:'map_a'}});
 assert.equal(f.hint.dataset.state,'hidden');
 // Teardown forgets the answer, so a later sign-in starts from unknown.
 f.resetCreditState();f.renderCreditHint();assert.equal(f.hint.dataset.state,'unknown');
});
