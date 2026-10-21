import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const context = vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(new URL('public/map-layers.js',root),'utf8'),context);
const layers = Array.from(context.window.HAUNT_LAYERS);

// Independent read-only ArcGIS MapServer metadata observations, 2026-10-21.
// Coordinates below are the published EPSG:3857 fullExtent, not UI bounds.
// These snapshots keep tests reproducible without external service availability.
const NYC = 'https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/';
const observations = [
 ['1924','Ortho_1924_Mosaic','NYC OTI',[-8266554.715751423,4937840.522769637,-8202973.066952735,5000211.010433499]],
 ['1951','NYC_Orthos_1951','NYS DOS',[-8294567.300391741,4909684.320119186,-8165052.407169518,5023544.906221118]],
 ['1996','Ortho_1996_Mosaic','NYC',[-8267369.658384282,4938246.146609066,-8204188.464221696,5000765.944005135]],
 ['2001-2','NYC_Orthos_2001_2','NYP DOS',[-8274463.372905547,4935122.118983775,-8196093.062599356,5003890.027614579]],
 ['2004','NYC_Ortho_2004','NYC OTI (DoITT)',[-8267391.044330178,4937241.790930099,-8204177.976523971,5000766.653137721]],
 ['2006','NYC_Orthos_2006','SOURCE: New York State Orthoimagery Program - 2006',[-8268383.195464104,4937244.758090132,-8203187.2623165995,5001778.212110857]],
 ['2008','NYC_Orthos_2008','SOURCE: New York State Orthoimagery Program - 2008',[-8268383.195464104,4937244.758090132,-8203187.2623165995,5001778.212110857]],
 ['2010','NYC_Orthos_2010','SOURCE: New York State Orthoimagery Program - 2010',[-8300664.982211238,4912275.434605789,-8170905.47556947,5026747.516933816]],
 ['2012','NYC_Orthos_2012','SOURCE: New York State Orthoimagery Program - 2012',[-8378997.6338448115,4875585.66104013,-8092572.805274509,5063437.290499475]],
 ['2014','NYC_Orthos_2014','SOURCE: New York State Orthoimagery Program - 2014',[-8315626.765376745,4911179.9367280835,-8123922.698496176,5037912.529586131]],
 ['2016','NYC_Orthos_2016','SOURCE: New York State Orthoimagery Program - 2016',[-8268383.195464104,4937244.758090132,-8203187.2623165995,5001778.212110857]],
 ['2018','NYC_Orthos_2018','SOURCE: New York State Orthoimagery Program - 2018',[-8378936.49915131,4875585.66104013,-8092633.958629396,5063437.290499475]],
 ['2020','NYC_Orthos_-_2020','',[-8311695.6328998115,4912672.716806634,-8158974.450432755,5039405.309664682]],
 ['2022','NYC_Orthos_2022','NYC OTI',[-8268383.195464104,4937244.758090132,-8203187.243655216,5001778.212110857]],
 ['2024','NYC_Orthos_2024','NYC OTI',[-8268383.195464104,4937244.758090132,-8203187.2623165995,5001778.212110857]]
].map(([id,service,credit,extent])=>({id,sourceUrl:NYC+service+'/MapServer',credit,extent,maxServiceLevel:23}));
observations.unshift({id:'1836-colton',sourceUrl:'https://tiles.arcgis.com/tiles/IEuSomXfi6iB7a25/arcgis/rest/services/New_York_City_1836/MapServer',credit:'David Rumsey Historical Map Collection',extent:[-8248765.341902356,4960423.9810206285,-8216593.007187683,4998221.860862377],maxServiceLevel:19});
const longitude = x => x / 6378137 * 180 / Math.PI;
const latitude = y => (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI;

test('registry has exactly the 15 verified NYC aerial services and the 1836 Colton map',()=>{
 assert.equal(layers.length,16);
 assert.equal(new Set(layers.map(x=>x.id)).size,16);
 assert.deepEqual(layers.map(x=>x.id).sort(),observations.map(x=>x.id).sort());
 assert.equal(layers.filter(x=>x.kind==='aerial').length,15);
 assert.equal(layers.filter(x=>x.kind==='cartographic').length,1);
 assert.ok(layers.every(x=>!x.url.includes('mapwarper')),'Unreviewed community georeferences must not become enabled layers');
});

test('tile routes use exact institutional service names and ArcGIS z/y/x order',()=>{
 for(const observed of observations){
  const layer=layers.find(x=>x.id===observed.id);
  assert.equal(layer.url,observed.sourceUrl+'/tile/{z}/{y}/{x}',observed.id);
  assert.match(layer.sourceUrl,/^https:\/\//);
  assert.match(layer.url,/^https:\/\/tiles\.arcgis\.com\//);
  if(observed.id!=='1836-colton')assert.equal(layer.sourceUrl,observed.sourceUrl);
 }
 assert.equal(layers.find(x=>x.id==='1836-colton').sourceUrl,'https://www.arcgis.com/home/item.html?id=0fcf0bd879b84a01bd596aee72111e49');
});

test('Leaflet latitude/longitude bounds match independently retrieved Web Mercator full extents',()=>{
 for(const observed of observations){
  const layer=layers.find(x=>x.id===observed.id);
  const [xmin,ymin,xmax,ymax]=observed.extent;
  const expected=[[latitude(ymin),longitude(xmin)],[latitude(ymax),longitude(xmax)]];
  assert.equal(layer.bounds.length,2);
  assert.ok(layer.bounds[0][0]<layer.bounds[1][0]);
  assert.ok(layer.bounds[0][1]<layer.bounds[1][1]);
  for(let corner=0;corner<2;corner++)for(let axis=0;axis<2;axis++)assert.ok(Math.abs(layer.bounds[corner][axis]-expected[corner][axis])<0.000001,observed.id+' bounds axis '+axis);
 }
});

test('configured tile zooms never exceed the provider advertised native levels',()=>{
 for(const observed of observations){
  const layer=layers.find(x=>x.id===observed.id);
  assert.ok(Number.isInteger(layer.maxNativeZoom));
  assert.ok(layer.maxNativeZoom>=0&&layer.maxNativeZoom<=observed.maxServiceLevel,observed.id);
 }
 // Rumsey's actual native maximum is 19; requesting higher would create gaps.
 assert.equal(layers.find(x=>x.id==='1836-colton').maxNativeZoom,19);
});

test('credits preserve service spelling and disclose the blank 2020 copyright field',()=>{
 for(const observed of observations.filter(x=>x.id!=='1836-colton'&&x.credit))assert.ok(layers.find(x=>x.id===observed.id).attributionHtml.includes(observed.credit),observed.id);
 const layer2020=layers.find(x=>x.id==='2020');
 assert.match(layer2020.notes,/copyright field is blank/);
 assert.ok(layers.filter(x=>x.kind==='aerial').every(x=>x.attributionHtml.includes('https://www.nyc.gov/home/terms-of-use.page')));
 const colton=layers.find(x=>x.id==='1836-colton');
 for(const credit of ['David Rumsey Map Collection','David Rumsey Map Center','Stanford University Libraries'])assert.ok(colton.attributionHtml.includes(credit),credit);
 assert.ok(colton.attributionHtml.includes('https://www.davidrumsey.com/about/copyright-and-permissions'));
});

test('coverage cautions keep partial historical cartography distinct from citywide imagery',()=>{
 const colton=layers.find(x=>x.id==='1836-colton');
 assert.match(colton.coverage,/not citywide/);
 assert.match(colton.notes,/not align exactly/);
 assert.ok(layers.filter(x=>x.kind==='aerial').every(x=>/gaps.*remain/i.test(x.coverage)));
 assert.equal(layers.find(x=>x.id==='2001-2').yearLabel,'2001–02');
});
