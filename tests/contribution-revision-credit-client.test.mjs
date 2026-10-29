import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// A typed revision (entry bundle, area proposal, record annotation) edits its summary alone and
// keeps its original credit, so its credit editor is hidden; a fresh or open proposal shows the
// editor and sends what it says. The real loadRevision, resetOpenContext and envelope code run
// against synthetic controls.
const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const part=slice('  function resetOpenContext(){','  function populatePlaceChoices(){')+slice('  const creditStorageKey=','  function buildEnvelope(){')+slice('  function clearRevision(){','  // The queue is for recent work first');
function fixture(){
 const node=()=>({value:'',hidden:false,open:false,checked:false,disabled:false,children:[],dataset:{},replaceChildren(...n){this.children=n;},append(...n){this.children.push(...n);},reset(){},focus(){},get textContent(){return this._t||'';},set textContent(v){this._t=String(v);this.children=[];}});
 const ids=['contributionSummary','contributionObjectTitle','extraSources','freeformSources','contributionAttributes','addContributionAttribute','freeformContext','freeformLocation','contributionPlaceMode','freeformImages','freeformDetails','freeformPlaceChoice','freeformCredit','freeformRecordContext','revisionContext','cancelRevision','freeformDescription','publicCreditConsent','publicCreditLabel','publicCreditHint','freeformTitle','contributionPlaceName','contributionLatitude','contributionLongitude'];
 const controls=Object.fromEntries(ids.map(id=>[id,node()]));controls.contributionPlaceMode.value='new';controls.publicCreditConsent.checked=true;
 const storage=new Map();
 const context=vm.createContext({byId:id=>controls[id]||node(),el:(tag,text)=>({tag,text}),text:v=>String(v??''),structuredClone,JSON,
  window:{HauntologiesAccount:{snapshot:()=>({actor:'map_a',generation:1}),isCurrent:()=>true},addEventListener(){},dispatchEvent(){}},document:{activeElement:null,createTextNode:t=>({textContent:String(t)})},
  CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},button:(label,action,className)=>({label,action,className}),
  localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,v)},fetch:()=>new Promise(()=>{}),
  imageBatch:null,imageStatus(){},invalidatePreview(){},switchView(){},addAttribute(){},setPointFields(){},showOpenReference(){},privateActor:'map_a',
  revisionOriginal:null,revisionOf:null,draftRevisionBlocked:null,openTargets:[],openRequestedRecordId:'',openTargetLabel:'',openTaskIds:[],openRequest:0,openTargetPending:false,openTargetFailed:false,
  openSourcesInitial:'',openSourcesDisplayInitial:'',openExplanationInitial:'',openExplanationDisplayInitial:'',
  pointForm:()=>true,pointGeometry:()=>({type:'Point',coordinates:[-74.2391,40.5365]}),sourceText:()=>'',attributeValues:()=>[],placeTyped:()=>''});
 vm.runInContext(part+';globalThis.out={loadRevision,resetOpenContext,clearRevision,buildIntakeEnvelope,restoreCreditFields,creditValue};',context);
 context.resetContributionForm=()=>{controls.publicCreditConsent.checked=true;controls.publicCreditLabel.value='';context.out.restoreCreditFields();};
 const envelope=()=>JSON.parse(JSON.stringify(context.out.buildIntakeEnvelope()));
 const cancelRevision=()=>{context.out.clearRevision();context.resetContributionForm();context.out.resetOpenContext();};
 return {controls,envelope,cancelRevision,...context.out};
}
const typed=(type,extra={})=>({id:'s1',revision:2,title:'Cold spot',raw_json:JSON.stringify({schema_version:'1.0',type,task_ids:[],title:'Cold spot',summary:'Original summary.',public_credit:{consent:true,label:'Ada Example'},sources:[],attachments:[],targets:[{record_id:'synthetic_place',expected_version:0,expected_hash:null}],payload:{annotation_kind:'addition',text:'A draft moves through the hall.',original_wording:'',uncertainty_note:'Reported.',dates:null,...extra}})});
test('a fresh form shows the credit editor and sends what it says',()=>{
 const f=fixture();f.resetOpenContext();f.controls.publicCreditLabel.value='Ada Example';
 assert.equal(f.controls.freeformCredit.hidden,false);
 const e=f.envelope();assert.equal(e.type,'open_proposal');assert.deepEqual(e.public_credit,{consent:true,label:'Ada Example'});
});
for(const type of ['record_annotation','entry_bundle','area_proposal'])test(`a ${type} revision hides the credit editor and keeps its original credit`,()=>{
 const f=fixture();f.resetOpenContext();f.controls.publicCreditLabel.value='Ada Example';
 f.loadRevision(typed(type));
 assert.equal(f.controls.freeformCredit.hidden,true,'no box to uncheck');
 assert.equal(f.controls.revisionContext.hidden,false);
 // Even if the hidden box were changed, the envelope is the original with only its summary edited.
 f.controls.publicCreditConsent.checked=false;f.controls.contributionSummary.value='Revised summary.';
 const e=f.envelope();assert.equal(e.type,type);assert.equal(e.summary,'Revised summary.');assert.deepEqual(e.public_credit,{consent:true,label:'Ada Example'});
 // Returning to a fresh proposal brings the editor back and the fresh envelope follows it.
 f.cancelRevision();
 assert.equal(f.controls.freeformCredit.hidden,false);assert.equal(f.controls.revisionContext.hidden,true);
 f.controls.publicCreditConsent.checked=false;
 assert.deepEqual(f.envelope().public_credit,{consent:false,label:''});
 f.controls.publicCreditConsent.checked=true;f.controls.publicCreditLabel.value='Ada Example';
 assert.deepEqual(f.envelope().public_credit,{consent:true,label:'Ada Example'});
});
test('an open proposal revision shows the editor, restores its credit, and sends a change to it',()=>{
 const f=fixture();f.resetOpenContext();
 f.loadRevision({id:'s2',revision:1,title:'Lantern',raw_json:JSON.stringify({schema_version:'1.0',type:'open_proposal',task_ids:[],title:'Lantern',summary:'Old.',public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{explanation:'Old.',geometry:null}})});
 assert.equal(f.controls.freeformCredit.hidden,false);assert.equal(f.controls.publicCreditConsent.checked,false);
 f.controls.publicCreditConsent.checked=true;f.controls.publicCreditLabel.value='Ada Example';
 const e=f.envelope();assert.equal(e.type,'open_proposal');assert.deepEqual(e.public_credit,{consent:true,label:'Ada Example'});
 f.controls.publicCreditConsent.checked=false;assert.deepEqual(f.envelope().public_credit,{consent:false,label:''});
});
