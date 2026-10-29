import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('saved legacy work is described as private and direct publications do not get a private marker',()=>{
 const source=read('public/contributions.js'),start=source.indexOf('  function ownPlaces('),end=source.indexOf('  let dashboardLoadedAt=',start),nextStart=source.indexOf('  function nextStep('),nextEnd=source.indexOf('  function submissionProgress(',nextStart);
 const context=vm.createContext({});vm.runInContext(source.slice(start,end)+source.slice(nextStart,nextEnd)+';globalThis.own=ownPlaces;globalThis.next=nextStep;',context);
 const item=status=>({is_own:true,status,title:'Synthetic',raw_json:JSON.stringify({payload:{geometry:{type:'Point',coordinates:[-74,40.7]}}})});
 assert.equal(context.own(['draft','submitted','approved','published','merged','revoked','withheld'].map(item)).length,3);
 assert.match(context.next({status:'approved'}),/Saved privately/);assert.doesNotMatch(context.next({status:'approved'}),/review|verif/i);
 assert.doesNotMatch(source,/Approved\. Another participant verifies the map and list preview before publication\./);
 const ownMarker=read('public/app.js').match(/function renderOwnPlaces\(\)\{[^]*?\n\}/)[0];assert.doesNotMatch(ownMarker,/Waiting for review|Approved, not yet/);assert.match(ownMarker,/Saved privately/);
});
test('place-card attribution accepts chosen labels but does not render email or markup',()=>{
 const source=read('public/app.js'),moniker=source.slice(source.indexOf('function publicMoniker('),source.indexOf('const pendingBy=')),start=source.indexOf('function placeFacts('),end=source.indexOf('function appendPlaceRecord(',start);
 const context=vm.createContext({PlaceSummary:{view:()=>({description:'',location:'',latitude:null,longitude:null})},vicinityOf:()=>null,esc:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),link:()=>''});
 vm.runInContext(moniker+source.slice(start,end)+';globalThis.render=placeFacts;',context);
 const html=context.render({contributors:['  night <owl> ','nobody@example.test','other\nname']});assert.match(html,/night &lt;owl&gt;/);assert.doesNotMatch(html,/nobody@example|other\nname|<owl>/);
});
