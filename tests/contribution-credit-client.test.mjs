import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// The Contribute form's public credit: sent only with the box checked and a name typed, remembered
// per account on this device, and carried through revisions. Synthetic controls and storage only.
const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
const part=source.slice(source.indexOf('  const creditStorageKey='),source.indexOf('  function buildEnvelope(){'));
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
function fixture({consent=true,label='',prior=null,actor='map_synthetic',stored={}}={}){
 const controls={publicCreditConsent:{checked:consent},publicCreditLabel:{value:label,disabled:false},contributionSummary:{value:'A lantern moves at night.'},contributionObjectTitle:{value:'Lantern'},freeformTitle:{hidden:false},contributionPlaceName:{textContent:'Kreischer Street'}};
 const storage=new Map(Object.entries(stored));
 const context=vm.createContext({byId:id=>controls[id]||{value:'',hidden:true,textContent:''},text:v=>String(v??''),revisionOriginal:prior,openExplanationDisplayInitial:'',openExplanationInitial:'',pointForm:()=>true,pointGeometry:()=>({type:'Point',coordinates:[-74.2391,40.5365]}),sourceText:()=>'',openSourcesDisplayInitial:'',attributeValues:()=>[],openTargets:[],openRequestedRecordId:'',openTaskIds:[],privateActor:actor,structuredClone,JSON,placeTyped:()=>'',
  localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,v)},fetch:async()=>{throw new Error('no network in this test');}});
 vm.runInContext(part+';globalThis.out={creditValue,buildIntakeEnvelope,setCreditFields,rememberCredit,restoreCreditFields};',context);
 // Values cross the vm realm, so they are compared as plain JSON.
 const plain=fn=>(...args)=>JSON.parse(JSON.stringify(fn(...args)));
 return {controls,storage,...context.out,creditValue:plain(context.out.creditValue),buildIntakeEnvelope:plain(context.out.buildIntakeEnvelope)};
}
test('the credit controls sit in the visible form, checked by default, not in the inert legacy block',()=>{
 const legacy=html.slice(html.indexOf('id="typedCompatibilityFields"'),html.indexOf('id="previewContribution"'));
 assert.ok(!legacy.includes('publicCreditConsent')&&!legacy.includes('publicCreditLabel'));
 const details=html.slice(html.indexOf('id="contributionDetails"'),html.indexOf('id="typedCompatibilityFields"'));
 assert.match(details,/<input id="publicCreditConsent" type="checkbox" checked>/);assert.match(details,/id="publicCreditLabel"[^>]*maxlength="120"/);
 assert.ok(!details.includes('id="publicCreditLabel"') || !/id="publicCreditLabel"[^>]*\sdisabled/.test(details),'the name field starts enabled');
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
 assert.deepEqual(JSON.parse(f.storage.get('hauntologies-public-credit:map_synthetic')),{consent:true,label:'Ada Example'});
 f.controls.publicCreditConsent.checked=false;f.controls.publicCreditLabel.value='';f.restoreCreditFields();
 assert.equal(f.controls.publicCreditConsent.checked,true);assert.equal(f.controls.publicCreditLabel.value,'Ada Example');assert.equal(f.controls.publicCreditLabel.disabled,false);
 const other=fixture({actor:'map_other',stored:Object.fromEntries(f.storage)});other.controls.publicCreditLabel.value='';other.restoreCreditFields();
 assert.equal(other.controls.publicCreditLabel.value,'','another account does not inherit the name');
 const declined=fixture({stored:{'hauntologies-public-credit:map_synthetic':JSON.stringify({consent:false,label:''})}});declined.restoreCreditFields();
 assert.equal(declined.controls.publicCreditConsent.checked,false);assert.equal(declined.controls.publicCreditLabel.disabled,true,'a remembered opt-out stays opted out');
});
