import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {validateProposalAttributes} from '../server/proposal-attributes.mjs';

const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
function fixture(values){
 const rows=values.map(value=>{
  const controls=Object.fromEntries(Object.entries(value).map(([key,text])=>[key,{value:text}]));
  return {controls,originalValue:{...value},originalDisplay:{...value},querySelector:selector=>controls[selector.includes('name')?'name':'value']};
 });
 const context=vm.createContext({byId:()=>({children:rows}),isOpenForm:()=>true});
 vm.runInContext(slice('  function attributeRows(){','  function addAttribute(')+slice('  function errorControl(path){','  function renderErrors(')+';globalThis.out={attributeValues,errorControl};',context);
 return {rows,values:includeEmpty=>JSON.parse(JSON.stringify(context.out.attributeValues(includeEmpty))),control:context.out.errorControl};
}
test('untouched and whitespace-only facts are omitted while meaningful text is preserved verbatim',()=>{
 const fact={name:'Archive box',value:'  Box 3\nFolder 12 — not yet checked  '};
 const f=fixture([{name:'',value:''},{name:'  ',value:'\n'},fact,{name:'Count',value:'0'}]);
 assert.deepEqual(f.values(),[fact,{name:'Count',value:'0'}]);
 assert.equal(validateProposalAttributes(f.values()).valid,true);
 assert.equal(f.rows.length,4,'reading the payload does not delete form controls');
 assert.deepEqual(f.values(true),[{name:'',value:''},{name:'  ',value:'\n'},fact,{name:'Count',value:'0'}],'draft storage keeps every row and its original wording');
});
test('fact errors focus the matching row even when empty optional rows precede it',()=>{
 const f=fixture([{name:'',value:''},{name:'Opening date',value:'1901'},{name:' ',value:''},{name:'Former use',value:''}]);
 assert.equal(f.control('payload.attributes.0.name'),f.rows[1].controls.name);
 assert.equal(f.control('payload.attributes.1.value'),f.rows[3].controls.value);
 assert.deepEqual(f.values()[1],{name:'Former use',value:''},'an unfinished fact is preserved for correction');
 assert.equal(validateProposalAttributes(f.values()).valid,false,'partially entered facts are not silently discarded');
 f.rows[0].controls.name.value='Archive';
 f.rows[0].controls.value.value='Collection 12';
 assert.equal(f.control('payload.attributes.0.value'),f.rows[0].controls.value);
 assert.deepEqual(f.values()[0],{name:'Archive',value:'Collection 12'});
});
