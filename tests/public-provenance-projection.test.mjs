import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const read=(directory)=>{const context={window:{}};vm.createContext(context);for(const name of ['inventory.js','pilot.js'])vm.runInContext(fs.readFileSync(path.join(directory,name),'utf8'),context);return JSON.parse(JSON.stringify([context.window.HAUNT_PILOT,...context.window.NYC_INVENTORY.records]));};
test('public provenance retains reference and image metadata without private notes or audit fields',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'haunt-provenance-'));
 const sourceFiles=['public/inventory.js','public/pilot.js'],originals=sourceFiles.map(name=>fs.readFileSync(path.join(root,name)));
 try{
  execFileSync(process.execPath,['scripts/prepare-public-catalog.mjs',temporary],{cwd:root,stdio:'pipe'});
  const full=read(path.join(root,'public')),published=read(temporary);
  assert.equal(published.length,209);assert.equal(published.flatMap(r=>r.sources||[]).length,637);assert.equal(published.filter(r=>r.image).length,5);
  const sourceKeys=new Set(['url','title','citation','repository','locator','source_date_original','accessed_on','rights_status','rights_statement','public_use','credit','license']);
  const imageKeys=new Set(['url','sourceUrl','creator','credit','license','licenseUrl','caption','alt']);
  for(let i=0;i<full.length;i++){
   assert.equal(published[i].id,full[i].id);
   for(const key of ['source_url','source_title','source_type','source_citation','source_locator','source_date'])if(Object.hasOwn(full[i],key)&&(typeof full[i][key]==='string'||full[i][key]===null))assert.equal(published[i][key],full[i][key]);
   for(const forbidden of ['original_submission','original_text','historical_context','interpretation','evidence_summary','source_quality','data_quality_flags','checked_date','rights_or_license'])assert.equal(Object.hasOwn(published[i],forbidden),false,full[i].id+' '+forbidden);
   for(const [index,source]of (published[i].sources||[]).entries()){
    assert(Object.keys(source).every(k=>sourceKeys.has(k)));assert.equal(source.url,full[i].sources[index].url);assert.equal(source.title,full[i].sources[index].title);assert.equal(Object.hasOwn(source,'note'),false);
   }
   if(published[i].image){assert(Object.keys(published[i].image).every(k=>imageKeys.has(k)));assert.equal(published[i].image.creator,full[i].image.creator);assert.equal(published[i].image.license,full[i].image.license);}
  }
  assert.equal(fs.existsSync(path.join(temporary,'data/source-inventory.json')),false);
  sourceFiles.forEach((name,index)=>assert(fs.readFileSync(path.join(root,name)).equals(originals[index]),name+' original changed'));
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
