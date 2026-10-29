import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const code=slice('  function showOpenReference(){','  function resetOpenContext(){')+slice('  let previewInFlight=false;','  async function submitPreview(){');
function fixture(){
 const ids=['freeformRecordContext','freeformRecordLabel','contributionPlaceMode','contributionSummary','freeformDescription','contributionDescriptionOptional','freeformPlacePicker','freeformLocation','newPlaceLocation','contributionPlacePlate','freeformTitle','contributionChangeSummary','previewContribution'];
 const controls=Object.fromEntries(ids.map(id=>[id,{value:'',hidden:false,disabled:false,required:false,dataset:{},setAttribute(){}}]));
 const label={textContent:''};controls.contributionSummary.closest=()=>({querySelector:()=>label});
 controls.contributionPlaceMode.value='existing';controls.contributionChangeSummary.value='Add a fact';
 let errors=[],facts=[],sources='',calls=0,saves=0;
 const context=vm.createContext({byId:id=>controls[id],openRequestedRecordId:'synthetic_place',openTargets:[{record_id:'synthetic_place'}],openTargetLabel:'Synthetic place',openTargetPending:false,openTargetFailed:false,openTargetStatus:0,revisionOriginal:null,revisionOf:null,draftRevisionBlocked:null,
   isOpenForm:()=>!context.revisionOriginal||context.revisionOriginal.type==='open_proposal',pointForm:()=>controls.contributionPlaceMode.value==='new',populatePlaceChoices(){},showPoint(){},
   window:{HauntologiesAccount:{canContribute:()=>true,snapshot:()=>({actor:'synthetic-actor',generation:1}),isCurrent:()=>true}},
   imageProcessing:false,imageBusy:false,busy:false,pendingWrite:null,imageBatch:null,identityGeneration:1,privateActor:'synthetic-actor',preview:null,
   attributeValues:()=>facts,sourceText:()=>sources,pointError:()=>null,readPoint:()=>null,renderErrors:value=>{errors=value;},buildEnvelope:()=>({type:'open_proposal'}),
   api:async()=>{calls++;return {preview:{validation:{valid:true}}};},sessionActor:async()=>'synthetic-actor',caps:()=>({can_submit:true}),submitPreview:async()=>{saves++;},renderPreview(){},serviceFailure(){}});
 vm.runInContext(code+';globalThis.out={showOpenReference,previewForm};',context);
 return {controls,label,context,show:()=>context.out.showOpenReference(),run:()=>context.out.previewForm({preventDefault(){}}),errors:()=>errors,calls:()=>calls,saves:()=>saves,setFacts:v=>{facts=v;},setSources:v=>{sources=v;}};
}
test('the existing-place description is labeled optional, and a new-place description stays required',()=>{
 const f=fixture();f.show();assert.equal(f.controls.contributionSummary.required,false);assert.equal(f.controls.contributionDescriptionOptional.hidden,false);assert.equal(f.controls.freeformDescription.dataset.hint,'');assert.equal(f.label.textContent,'Description (optional)');
 f.context.openRequestedRecordId='';f.context.openTargets=[];f.controls.contributionPlaceMode.value='new';f.show();
 assert.equal(f.controls.contributionSummary.required,true);assert.equal(f.controls.contributionDescriptionOptional.hidden,true);assert.equal(f.controls.freeformDescription.dataset.hint,'required');assert.equal(f.label.textContent,'Description');
});
test('existing-place facts and sources can proceed without a description, but an empty contribution cannot',async()=>{
 for(const kind of ['fact','source']){const f=fixture();f.show();if(kind==='fact')f.setFacts([{name:'Opening date',value:'1901'}]);else f.setSources('Synthetic source');await f.run();assert.equal(f.calls(),1);assert.equal(f.saves(),1);}
 const empty=fixture();empty.show();await empty.run();assert.equal(empty.calls(),0);assert.match(empty.errors()[0].message,/description, a source or a fact/);
 const incomplete=fixture();incomplete.show();incomplete.setFacts([{name:'Date',value:''}]);await incomplete.run();assert.equal(incomplete.calls(),0);assert.ok(incomplete.errors().some(error=>/Add a value/.test(error.message)));
});
test('the change-history explanation and new-place description remain required',async()=>{
 const existing=fixture();existing.show();existing.setSources('Synthetic source');existing.controls.contributionChangeSummary.value='';await existing.run();assert.equal(existing.calls(),0);assert.ok(existing.errors().some(error=>/describe your change/i.test(error.message)));
 const fresh=fixture();fresh.context.openRequestedRecordId='';fresh.context.openTargets=[];fresh.controls.contributionPlaceMode.value='new';fresh.setSources('Synthetic source');fresh.show();await fresh.run();assert.equal(fresh.calls(),0);assert.ok(fresh.errors().some(error=>/Describe what you would like to contribute/.test(error.message)));
});
