import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { boroughAt } from '../server/core.mjs';

const source = fs.readFileSync(new URL('../public/nyc-geometry.js',import.meta.url),'utf8');
const boundaries = JSON.parse(fs.readFileSync(new URL('../public/data/nyc-borough-boundaries.geojson',import.meta.url),'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const centers = [
  ['Manhattan',40.75,-73.99], ['Bronx',40.8448,-73.8648],
  ['Brooklyn',40.6782,-73.9442], ['Queens',40.7282,-73.7949],
  ['Staten Island',40.5795,-74.1502]
];

function load(responseFactory = async () => ({ok:true,json:async () => clone(boundaries)})) {
  const requests = [];
  const context = vm.createContext({window:{},fetch:async url => {
    requests.push(url); return responseFactory();
  }});
  vm.runInContext(source,context);
  return {geometry:context.window.NycGeometry,requests};
}

test('loads only the bundled boundary once and exposes an explicit readiness state', async () => {
  const {geometry,requests} = load();
  assert.equal(geometry.available,false);
  assert.equal(geometry.findBorough(40.75,-73.99),null);
  assert.equal(await geometry.ready,true);
  assert.equal(geometry.available,true);
  assert.deepEqual(requests,['data/nyc-borough-boundaries.geojson']);
  assert.equal(await geometry.ready,true);
  assert.equal(requests.length,1);
});

test('rejects the real Jersey City fixture that passes the old NYC rectangle', async () => {
  const {geometry} = load(); await geometry.ready;
  const lat=40.7178,lon=-74.0431;
  assert.ok(lat>=40.45&&lat<=40.98&&lon>=-74.30&&lon<=-73.65);
  assert.equal(geometry.findBorough(lat,lon),null);
  assert.equal(geometry.findBorough(lat,lon),boroughAt(lat,lon,boundaries));
});

test('finds actual interior points in each of the five boroughs', async () => {
  const {geometry} = load(); await geometry.ready;
  for (const [expected,lat,lon] of centers) {
    assert.equal(geometry.findBorough(lat,lon),expected);
    assert.equal(geometry.findBorough(lat,lon),boroughAt(lat,lon,boundaries));
  }
});

test('missing, non-finite, string, swapped and outside pairs cannot acquire a borough', async () => {
  const {geometry} = load(); await geometry.ready;
  for (const [lat,lon] of [[null,null],[undefined,undefined],['',''],['40.75','-73.99'],
    [NaN,-73.99],[40.75,Infinity],[true,-73.99],[40.75,null],[-73.99,40.75],[0,0],[51.5,-0.1]]) {
    assert.equal(geometry.findBorough(lat,lon),null,String([lat,lon]));
    assert.equal(geometry.findBorough(lat,lon),boroughAt(lat,lon,boundaries));
  }
});

test('matches server semantics across the real boundary area and exact ring vertices', async () => {
  const {geometry} = load(); await geometry.ready;
  let compared=0;
  for (let lat=40.45;lat<=40.98;lat+=0.025) {
    for (let lon=-74.30;lon<=-73.65;lon+=0.025) {
      assert.equal(geometry.findBorough(lat,lon),boroughAt(lat,lon,boundaries),`${lat},${lon}`);
      compared++;
    }
  }
  for (const feature of boundaries.features) {
    const polygons = feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[feature.geometry.coordinates];
    for (const polygon of polygons) {
      const [lon,lat]=polygon[0][0];
      assert.equal(geometry.findBorough(lat,lon),boroughAt(lat,lon,boundaries));
      compared++;
    }
  }
  assert.ok(compared>500);
});

test('excludes polygon holes while preserving the real exterior boundary', async () => {
  // The supplied water-inclusive boundary file has no holes. Add one synthetic
  // interior ring to the real Manhattan polygon to exercise hole semantics.
  const withHole=clone(boundaries),lat=40.75,lon=-73.99;
  const manhattan=withHole.features.find(f=>f.properties.boroname==='Manhattan');
  const polygon=manhattan.geometry.coordinates.find(p=>boroughAt(lat,lon,{features:[{
    properties:{boroname:'Manhattan'},geometry:{type:'Polygon',coordinates:p}
  }]}));
  assert.ok(polygon);
  polygon.push([[lon-.0001,lat-.0001],[lon+.0001,lat-.0001],[lon+.0001,lat+.0001],
    [lon-.0001,lat+.0001],[lon-.0001,lat-.0001]]);
  const {geometry}=load(async()=>({ok:true,json:async()=>withHole}));
  assert.equal(await geometry.ready,true);
  assert.equal(geometry.findBorough(lat,lon),null);
  assert.equal(geometry.findBorough(lat,lon),boroughAt(lat,lon,withHole));
  assert.equal(geometry.findBorough(lat+.001,lon),'Manhattan');
});

test('network, HTTP, JSON and malformed-boundary errors fail closed without unhandled rejection', async () => {
  const variants=[
    async()=>{throw Error('offline')},
    async()=>({ok:false,json:async()=>boundaries}),
    async()=>({ok:true,json:async()=>{throw Error('bad json')}}),
    async()=>({ok:true,json:async()=>({type:'FeatureCollection',features:[]})}),
    async()=>({ok:true,json:async()=>({...boundaries,features:boundaries.features.map(f=>({...f,geometry:null}))})}),
    async()=>({ok:true,json:async()=>({...boundaries,features:boundaries.features.map(f=>({...f,properties:{boroname:'Manhattan'}}))})})
  ];
  for (const factory of variants) {
    const {geometry}=load(factory);
    assert.equal(await geometry.ready,false);
    assert.equal(geometry.available,false);
    assert.equal(geometry.findBorough(40.75,-73.99),null);
  }
});
