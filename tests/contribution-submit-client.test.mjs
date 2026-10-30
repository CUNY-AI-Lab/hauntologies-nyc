import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('  let previewInFlight=false;'),source.indexOf('  async function submitPreview(){'));
function fixture(){
 let calls=0,saves=0,resolve,reject;
 const control={value:'Synthetic note',disabled:false},deferred=new Promise((a,b)=>{resolve=a;reject=b;});
 const context=vm.createContext({imageProcessing:false,imageBusy:false,busy:false,pendingWrite:null,imageBatch:null,stagedImages:[],revisionOf:null,draftRevisionBlocked:false,openRequestedRecordId:'',openTargets:[],openTargetFailed:false,openTargetPending:false,identityGeneration:1,privateActor:'synthetic-actor',preview:null,window:{HauntologiesAccount:{canContribute:()=>true,snapshot:()=>({actor:'synthetic-actor',generation:1}),isCurrent:()=>true}},
 byId:()=>control,renderErrors:()=>{},isOpenForm:()=>false,attributeValues:()=>[],pointError:()=>null,pointForm:()=>false,buildEnvelope:()=>({synthetic:true}),api:async()=>{calls++;return deferred;},sessionActor:async()=>'synthetic-actor',caps:()=>({can_submit:true}),submitPreview:async()=>{saves++;},renderPreview:()=>{},serviceFailure:()=>{}});
 vm.runInContext(handler+';globalThis.run=previewForm;',context);
 return {run:()=>context.run({preventDefault(){}}),resolve,reject,calls:()=>calls,saves:()=>saves,control};
}
test('one-step submit holds a synchronous lock through delayed preview and save',async()=>{
 const f=fixture(),first=f.run(),second=f.run();await second;
 assert.equal(f.calls(),1,'repeated Enter cannot launch a second delayed preview');
 f.resolve({preview:{validation:{valid:true}}});await first;
 assert.equal(f.saves(),1);
 await f.run();assert.equal(f.calls(),2,'a later explicit submission is available');assert.equal(f.saves(),2);
});
test('failed preview releases the submit lock without creating a submission',async()=>{
 const f=fixture(),first=f.run();f.reject(Object.assign(new Error('Synthetic unavailable'),{status:503}));await first;
 assert.equal(f.saves(),0);assert.equal(f.control.disabled,false);
 await f.run();assert.equal(f.calls(),2);assert.equal(f.saves(),0);
});
