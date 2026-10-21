import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const context = vm.createContext({window: {}});
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
vm.runInContext(read('public/atlas-model.js'), context);
vm.runInContext(read('public/inventory.js'), context);
const model = context.window.AtlasModel;
const inventory = context.window.NYC_INVENTORY.records;
const sourceCategories = JSON.parse(read('tests/fixtures/source-categories.json')); 
const ids = records => Array.from(records, r => r.id || r.properties?.entry_id);
const plain = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(freeze);
  }
  return value;
};

test('exported catalog retains 208 unique inventory records', () => {
  assert.equal(inventory.length, 208);
  assert.equal(new Set(inventory.map(record => record.id)).size, 208);
});

test('normalization is presentation-only and never mutates descriptions, citations or geometry', () => {
  const record = freeze({id:'immutable', title:'A <place>', category:'reported_haunting',
    claim_text:'A source reports this.', borough:'Queens', latitude:null, longitude:null,
    sources:[{citation:'A & B, p. 3',url:'https://example.test/record'}],
    time_precision:'unknown', time_start_year:null, time_end_year:null});
  const before = JSON.stringify(record);
  const result = model.normalize(record);
  assert.equal(result.original, record);
  assert.equal(model.filter([record], {query:'A & B'})[0], record);
  model.facets([record]);
  assert.equal(JSON.stringify(record), before);
});

test('place types use every actual source-list category, including multiple types at one place', () => {
  for (const source of sourceCategories) {
    const record = inventory.find(r => r.id === source.id);
    assert.ok(record, source.id);
    assert.deepEqual(plain(model.normalize(record).placeTypes).sort(), [...(source.categories || [source.category])].sort());
  }
  const types = model.facets(inventory).placeTypes;
  assert.ok(types.find(t => t.value === 'Theatres').count > 0);
  assert.ok(types.find(t => t.value === 'Unknown').count >= 16);
  assert.ok(ids(model.filter(inventory, {placeType:'Banks, financial buildings'})).includes('demolished-nyc-053'));
});

test('all facet combinations intersect and results preserve original references/order', () => {
  const target = inventory.find(r => r.id === 'demolished-nyc-001');
  const filters = {query:'Brooklyn Savings Bank', borough:'Brooklyn', placeType:'Banks, financial buildings',
    category:'vanished_place', evidence:'source_list', review:'legacy', geoStatus:'approximate',
    period:'range', fromYear:1900, toYear:1901};
  const match = model.filter(inventory, filters);
  assert.deepEqual(ids(match), [target.id]);
  assert.equal(match[0], target);
  for (const [key,value] of Object.entries({borough:'Bronx',placeType:'Forts',category:'reported_haunting',evidence:'reported_story',review:'approved',geoStatus:'unresolved',fromYear:2000})) {
    assert.equal(model.filter(inventory, {...filters,[key]:value}).length, 0, key);
  }
  assert.deepEqual(ids(model.filter(inventory, {})), ids(inventory));
  const both = model.filter(inventory, {borough:['Bronx','Queens']});
  assert.equal(both.length, model.filter(inventory,{borough:'Bronx'}).length + model.filter(inventory,{borough:'Queens'}).length);
});

test('period overlap is inclusive; unknown, partial and uncertain prose are not fabricated bounds', () => {
  const samples = [
    {id:'bounds',time_start_year:1890,time_end_year:1910,time_precision:'range'},
    {id:'single',time_start_year:1910,time_end_year:1910,time_precision:'year'},
    {id:'circa',time_start_year:1885,time_end_year:1895,time_precision:'circa',time_basis:'Defined source range'},
    {id:'missing-end',event_date_start:'1900',event_date_end:''},
    {id:'uncertain',event_date_start:'c. 1880',event_date_end:'1900'},
    {id:'open',event_date_start:'before 1847',event_date_end:'1854 (?)'},
    {id:'inverted',time_start_year:1910,time_end_year:1890},
    {id:'explicit-unknown',time_start_year:1900,time_end_year:1910,time_precision:'unknown'}
  ];
  assert.deepEqual(ids(model.filter(samples,{period:{start:1910,end:1910}})), ['bounds','single']);
  assert.deepEqual(ids(model.filter(samples,{period:'unknown'})), ['missing-end','uncertain','open','inverted','explicit-unknown']);
  assert.deepEqual(ids(model.filter(samples,{period:'known'})), ['bounds','single','circa']);
  assert.equal(model.filter(samples,{fromYear:2000,toYear:1900}).length,0);
  assert.equal(model.filter(samples,{fromYear:'not-a-year'}).length,0);
  assert.equal(model.normalize(samples[4]).period.original,'c. 1880 – 1900');
  assert.equal(model.normalize(samples[4]).period.start,null);
});

test('haunting periods never borrow building, context, record or source publication dates', () => {
  const record = {category:'haunting',built:'1880',historical_context:'The building opened in 1880.',
    record_date:'2026-10-07',source_date_original:'1998',checked_date:'2026-10-07',
    sources:[{source_date_original:'1998'}]};
  assert.equal(model.normalize(record).period.unknown,true);
  const hauntings = inventory.filter(r => r.category === 'haunting');
  assert.equal(hauntings.length,16);
  assert.equal(model.filter(hauntings,{period:'unknown'}).length,16);
  assert.equal(model.filter(hauntings,{fromYear:1800,toYear:2026}).length,0);
});

test('null geometry, invalid coordinate pairs and unresolved places are never plotted', () => {
  const base = {latitude:40.7,longitude:-73.9};
  for (const record of [
    {...base,geometry:null}, {...base,geo_status:'unresolved'},
    {latitude:null,longitude:null}, {latitude:'',longitude:''}, {latitude:0,longitude:0},
    {latitude:40.7,longitude:null}, {latitude:NaN,longitude:-73.9},
    {latitude:-73.9,longitude:40.7}, {latitude:true,longitude:-73.9},
    {latitude:51.5,longitude:-0.1}, {geometry:{type:'Point',coordinates:[null,null]}},
    {geometry:{type:'Polygon',coordinates:[]}}
  ]) {
    const normalized = model.normalize(record);
    assert.equal(normalized.geometry,null,JSON.stringify(record));
    assert.equal(normalized.geoStatus,'unresolved');
    assert.equal(normalized.uncertaintyM,null);
  }
  const feature = {type:'Feature',properties:{entry_id:'f',geo_status:'approximate'},geometry:{type:'Point',coordinates:[-73.9,40.7]}};
  assert.deepEqual(plain(model.normalize(feature).geometry),feature.geometry);
  assert.equal(model.normalize(feature).original,feature);
  assert.equal(model.normalize(feature).id,'f');
});

test('approximate markers and uncertainty radii require explicit supporting values', () => {
  const anchor = {latitude:40.7,longitude:-73.9,location_precision:'Approximately 75 m'};
  assert.equal(model.normalize(anchor).geoStatus,'approximate');
  assert.equal(model.normalize(anchor).uncertaintyM,null);
  assert.equal(model.normalize({...anchor,uncertainty_m:75}).uncertaintyM,null);
  assert.equal(model.normalize({...anchor,uncertainty_m:-75,geo_basis:'Source bounds'}).uncertaintyM,null);
  assert.equal(model.normalize({...anchor,uncertainty_m:75,geo_basis:'Source bounds'}).uncertaintyM,75);
  assert.equal(model.normalize({...anchor,geo_status:'located'}).geoStatus,'located');
  assert.equal(model.normalize({...anchor,geo_status:'located',proxy:true}).geoStatus,'approximate');
  assert.equal(model.normalize({...anchor,geo_status:'unresolved',uncertainty_m:75,geo_basis:'Source bounds'}).uncertaintyM,null);
});

test('legacy and owner approval states do not impersonate canonical editorial review', () => {
  assert.equal(model.filter(inventory,{review:'approved'}).length,0);
  assert.equal(model.filter(inventory,{review:'legacy'}).length,208);
  const ownerApproved = {status:'approved',source_type:'hosted-submission'};
  assert.equal(model.normalize(ownerApproved).review,'owner_approved');
  assert.equal(model.normalize({...ownerApproved,review_state:'approved'}).review,'approved');
  assert.equal(model.normalize({status:'draft'}).review,'draft');
  assert.equal(model.normalize({status:'sourced',review_state:'withheld'}).review,'withheld');
});

test('map and list counts partition the same filtered collection without dropping the unlocated record', () => {
  for (const filters of [{},{borough:'Brooklyn'},{category:'reported_haunting'},{period:'unknown'},{geoStatus:'unresolved'},{placeType:'Theatres',fromYear:1900,toYear:1950}]) {
    const rows = model.filter(inventory,filters);
    const mapped = rows.filter(r => model.normalize(r).geometry !== null);
    const unlocated = rows.filter(r => model.normalize(r).geometry === null);
    assert.equal(mapped.length+unlocated.length,rows.length);
    assert.equal(new Set(ids([...mapped,...unlocated])).size,rows.length);
  }
  assert.equal(model.filter(inventory,{geoStatus:'unresolved'}).length,1);
  const sums = model.facets(inventory);
  for (const dimension of ['categories','evidence','reviews','geoStatuses','periods']) {
    assert.equal(sums[dimension].reduce((sum,f)=>sum+f.count,0),inventory.length,dimension);
  }
});

test('distinct building generations sharing coordinates retain separate IDs and historical spans', () => {
  const generations = model.filter(inventory,{query:'Trinity Court Building'});
  assert.deepEqual(ids(generations),['demolished-nyc-057','demolished-nyc-058']);
  assert.deepEqual(plain(model.normalize(generations[0]).geometry),plain(model.normalize(generations[1]).geometry));
  assert.deepEqual(ids(model.filter(generations,{fromYear:1900,toYear:1900})),['demolished-nyc-057']);
  assert.deepEqual(ids(model.filter(generations,{fromYear:2000,toYear:2000})),['demolished-nyc-058']);
  assert.equal(model.filter(generations,{geoStatus:'approximate'}).length,2);
});
