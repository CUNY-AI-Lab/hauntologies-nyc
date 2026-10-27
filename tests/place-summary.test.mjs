import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{}};vm.createContext(context);
for(const file of ['inventory.js','pilot.js','atlas-model.js','place-summary.js'])vm.runInContext(fs.readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),context);
const {NYC_INVENTORY,HAUNT_PILOT,PlaceSummary}=context.window;
const records=[HAUNT_PILOT,...NYC_INVENTORY.records];
test('all209 places have a short neutral description without altering originals',()=>{const original=JSON.stringify(records);for(const record of records){const p=PlaceSummary.view(record);assert(p.description.length<=50,record.id);assert(!/\b(supply|supplied|notes|sources|haunted)\b/i.test(p.description),record.id);assert(p.location);assert.equal(p.title,record.title);}assert.equal(JSON.stringify(records),original);});
test('map links use unchanged coordinates and null geometry gets no link',()=>{let mapped=0;for(const r of records){const p=PlaceSummary.view(r);if(p.mapUrl){mapped++;const url=new URL(p.mapUrl);assert.equal(Number(url.searchParams.get('mlat')),Number(r.latitude));assert.equal(Number(url.searchParams.get('mlon')),Number(r.longitude));}else{assert.equal(p.latitude,null);assert.equal(p.longitude,null);}}assert.equal(mapped,208);});
test('WSIA remains a current approximate location without historical incident assertions',()=>{const p=PlaceSummary.view(records.find(r=>r.id==='featured-csi-wsia'));assert.equal(p.description,'Ghost story');assert.equal(p.sourceUrl,'https://www.theshadowlands.net/places/newyork.htm');assert.equal(p.current,true);assert.equal(p.approximate,true);assert.equal(p.latitude,40.60183);assert.equal(p.longitude,-74.14851);});

test('every inclusion reason is at most two words and links to its original source',()=>{for(const record of records){const p=PlaceSummary.view(record);assert(p.description.split(/\s+/).length<=2,record.id);assert.equal(p.sourceUrl,record.source_url);assert.match(p.sourceUrl,/^https?:\/\//);}});
test('St. Paul has its demolition category, direct article and address without repeated coordinates',()=>{const r=records.find(r=>r.title==='St. Paul Building'),before=JSON.stringify(r),p=PlaceSummary.view(r);assert.equal(p.description,'Demolished building');assert.equal(p.sourceUrl,'https://en.wikipedia.org/wiki/St._Paul_Building');assert.equal(p.location,'220 Broadway, New York City, United States');assert.equal(p.latitude,40.71111);assert.equal(p.longitude,-74.00861);assert.equal(JSON.stringify(r),before);});
test('known surviving or unresolved cases do not acquire a definite demolition claim',()=>{const expected={'008':'Altered building','009':'Former synagogue','010':'Partial demolition','049':'Unverified demolition','066':'Altered building','076':'Unidentified building','086':'Destroyed building','106':'Former facility','111':'Converted terminal','167':'Former gardens'};for(const [suffix,label] of Object.entries(expected)){assert.equal(PlaceSummary.view(records.find(r=>r.id==='demolished-nyc-'+suffix)).description,label)}});

test('known imported image label uses the existing borough without editing source data',()=>{
 const record=records.find(r=>r.id==='demolished-nyc-106'),before=JSON.stringify(record);assert.equal(record.location_text,'Image: Map');assert.equal(PlaceSummary.view(record).location,'Bronx');assert.equal(JSON.stringify(record),before);
 assert.equal(PlaceSummary.view({...record,location_text:'A supplied address'}).location,'A supplied address');
 assert.equal(PlaceSummary.view({...record,id:'synthetic',location_text:'Image: Map'}).location,'Image: Map');
});
