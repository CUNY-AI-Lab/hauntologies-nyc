import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/place-input.js';
const {point,matches}=globalThis.PlaceInput;
test('local place input accepts coordinate pairs and exact OpenStreetMap coordinate links',()=>{
 for(const text of ['40.7128, -74.006','https://www.openstreetmap.org/?mlat=40.7128&mlon=-74.006#map=18/40.7/-74','https://www.openstreetmap.org/#map=18/40.7128/-74.006'])assert.deepEqual(point(text),{latitude:40.7128,longitude:-74.006});
 for(const text of ['https://openstreetmap.org.evil.test/#map=18/40.7/-74','https://user:password@openstreetmap.org/#map=18/40.7/-74','https://openstreetmap.org/?mlat=&mlon=','https://openstreetmap.org/node/1','91,0','0,181','NaN,0'])assert.equal(point(text),null);
});
test('canonical selection matches names and nearby coordinates without sending a search externally',()=>{
 const record={title:'Synthetic Hall',latitude:40.7128,longitude:-74.006};assert.equal(matches(record,'SYNTHETIC'),true);assert.equal(matches(record,'40.7128, -74.006'),true);assert.equal(matches(record,'41,-74'),false);assert.equal(matches({...record,latitude:null},'40.7128,-74.006'),false);
});
