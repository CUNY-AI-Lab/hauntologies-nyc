import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
const part=source.slice(source.indexOf('  const creditStorageKey='),source.indexOf('  function buildEnvelope(){'));
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
function fixture({label='',prior=null,actor='map_a',stored={}}={}){
 const controls={publicCreditHint:{textContent:''},publicCreditLabel:{value:label},contributionSummary:{value:'A lantern moves at night.'},contributionObjectTitle:{value:'Lantern'},freeformTitle:{hidden:false},contributionPlaceName:{textContent:'Kreischer Street'}};
 const storage=new Map(Object.entries(stored)),fetches=[];
 const context=vm.createContext({byId:id=>controls[id]||{value:'',hidden:true,textContent:''},text:v=>String(v??''),revisionOriginal:prior,openExplanationDisplayInitial:'',openExplanationInitial:'',pointForm:()=>true,pointGeometry:()=>({type:'Point',coordinates:[-74.2391,40.5365]}),sourceText:()=>'',openSourcesDisplayInitial:'',attributeValues:()=>[],openTargets:[],openRequestedRecordId:'',openTaskIds:[],privateActor:actor,structuredClone,JSON,placeTyped:()=>'',localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch:(...args)=>{fetches.push(args);return Promise.resolve({ok:true,json:async()=>({you:{name:'Account Name',email:'private@example.test'}})});}});
 vm.runInContext(part+';globalThis.out={creditValue,buildIntakeEnvelope,setCreditFields,rememberCredit,restoreCreditFields,renderCreditHint,syncCreditState,resetCreditState};',context);
 const plain=fn=>(...args)=>JSON.parse(JSON.stringify(fn(...args)));
 return {controls,storage,fetches,switchAccount:actor=>{context.privateActor=actor;},...context.out,creditValue:plain(context.out.creditValue),buildIntakeEnvelope:plain(context.out.buildIntakeEnvelope)};
}
test('the visible form requires a chosen public username without an attribution opt-out',()=>{
 assert.ok(!html.includes('publicCreditConsent'));
 const details=html.slice(html.indexOf('id="contributionDetails"'),html.indexOf('id="typedCompatibilityFields"'));
 assert.match(details,/id="publicCreditLabel"[^>]*maxlength="120"/);
 assert.ok(!/id="publicCreditLabel"[^>]*autocomplete="(?:name|email)"/.test(details));
 const f=fixture();f.renderCreditHint();assert.match(f.controls.publicCreditHint.textContent,/username is public/);assert.match(f.controls.publicCreditHint.textContent,/not your email/);
});
test('chosen usernames are normalized and explicitly marked as monikers',()=>{
 assert.deepEqual(fixture({label:'  Lantern   Keeper '}).creditValue(),{consent:true,label:'Lantern Keeper',identity:'moniker'});
 assert.equal(fixture({label:'x'.repeat(200)}).creditValue().label.length,120);
});
for(const label of ['', '   ', 'private@example.test', 'Name <private@example.test>', 'bad\u0000name'])test(`invalid username ${JSON.stringify(label)} cannot become a new submission`,()=>{
 const f=fixture({label});assert.throws(()=>f.creditValue(),e=>e.field==='public_credit.label');assert.throws(()=>f.buildIntakeEnvelope(),/username or moniker/);
});
test('fresh and revised open proposals use the explicitly chosen moniker',()=>{
 const prior={schema_version:'1.0',type:'open_proposal',task_ids:[],title:'Lantern',summary:'Old',public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{explanation:'Old',geometry:null}};
 for(const original of [null,prior]){
  const result=fixture({label:'LanternKeeper',prior:original}).buildIntakeEnvelope();
  assert.deepEqual(result.public_credit,{consent:true,label:'LanternKeeper',identity:'moniker'});assert.equal(result.summary,'A lantern moves at night.');
 }
 assert.deepEqual(prior.public_credit,{consent:false,label:''});
});
test('summary-only typed revisions preserve legacy credit and all other original fields',()=>{
 const prior={type:'record_annotation',title:'Old',summary:'Old summary',public_credit:{consent:false,label:''},sources:[{ref:'source'}],payload:{text:'Original annotation'}};
 const revised=fixture({label:'DifferentMoniker',prior}).buildIntakeEnvelope();
 assert.deepEqual(revised,{...prior,summary:'A lantern moves at night.'});assert.equal(prior.summary,'Old summary');
});
test('usernames are remembered separately for each account and reset without leaking across accounts',()=>{
 const f=fixture({label:'LanternKeeper'});f.rememberCredit();
 assert.deepEqual(JSON.parse(f.storage.get('hauntologies-public-moniker:map_a')),{label:'LanternKeeper'});
 f.resetCreditState();assert.equal(f.controls.publicCreditLabel.value,'');f.restoreCreditFields();assert.equal(f.controls.publicCreditLabel.value,'LanternKeeper');
 f.switchAccount('map_b');f.restoreCreditFields();assert.equal(f.controls.publicCreditLabel.value,'');
 f.controls.publicCreditLabel.value='NightOwl';f.rememberCredit();f.switchAccount('map_a');f.restoreCreditFields();assert.equal(f.controls.publicCreditLabel.value,'LanternKeeper');
 f.switchAccount(null);f.resetCreditState();f.rememberCredit();assert.equal(f.storage.has('hauntologies-public-moniker:anonymous'),false);
});
test('old credit preferences and account or registration identity never prefill a username',async()=>{
 for(const label of ['Account Name','private@example.test']){
  const f=fixture({label:'Old visible value',stored:{'hauntologies-public-credit:map_a':JSON.stringify({consent:true,label})}});
  f.restoreCreditFields();await f.syncCreditState();assert.equal(f.controls.publicCreditLabel.value,'');assert.equal(f.fetches.length,0,'username selection does not fetch account identity');
 }
});
test('malformed remembered values do not become username defaults',()=>{
 for(const value of ['{','null','{"label":42}']){const f=fixture({stored:{'hauntologies-public-moniker:map_a':value}});f.restoreCreditFields();assert.equal(f.controls.publicCreditLabel.value,'');}
});
test('opening a revision never promotes a legacy name or email into an explicitly chosen moniker',()=>{
 const load=source.slice(source.indexOf('  function loadRevision(submission){'),source.indexOf('  // The queue is for recent work first:'));
 for(const credit of [{consent:true,label:'Legacy Account Name'},{consent:true,label:'private@example.test'},{consent:true,label:'ChosenMoniker',identity:'moniker'}]){
  const nodes=new Map(),byId=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,replaceChildren(){},focus(){}});return nodes.get(id);};
  const context=vm.createContext({byId,JSON,structuredClone,imageBatch:null,clearRevision(){},resetContributionForm(){byId('publicCreditLabel').value='';},resetOpenContext(){},setCreditFields(value){byId('publicCreditLabel').value=value?.label||'';},restoreCreditFields(){byId('publicCreditLabel').value='';},addAttribute(){},showOpenReference(){},el(){return {};},invalidatePreview(){},switchView(){}});
  vm.runInContext(load+';globalThis.load=loadRevision;',context);
  context.load({id:'synthetic',revision:1,title:'Lantern',raw_json:JSON.stringify({type:'open_proposal',title:'Lantern',summary:'Old',public_credit:credit,payload:{explanation:'Old'},targets:[],task_ids:[]})});
  assert.equal(byId('publicCreditLabel').value,credit.identity==='moniker'?'ChosenMoniker':'');assert.equal(byId('freeformCredit').hidden,false);
 }
});
