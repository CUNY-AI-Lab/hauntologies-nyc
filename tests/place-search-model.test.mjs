import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/place-search-model.js';

const M = globalThis.PlaceSearchModel;
const near = (actual, expected, places = 4) => assert.ok(Math.abs(actual - expected) < 10 ** -places, `${actual} ≉ ${expected}`);
const point = (result, lat, lon) => { assert.equal(result.status, 'ok'); near(result.latitude, lat); near(result.longitude, lon); };

test('reads coordinates in decimal, DMS, hemisphere and map-link forms', () => {
  point(M.parseCoordinates('40.7484, -73.9857'), 40.7484, -73.9857);
  point(M.parseCoordinates('40°44\'54.2"N 73°59\'08.5"W'), 40.748389, -73.985694);
  point(M.parseCoordinates('N 40 44.9 W 73 59.1'), 40.748333, -73.985);
  point(M.parseCoordinates('40.7484N, 73.9857W'), 40.7484, -73.9857);
  point(M.parseCoordinates('lat: 40.7 lon: -74.0'), 40.7, -74);
  point(M.parseCoordinates('geo:40.7,-73.95'), 40.7, -73.95);
  point(M.parseCoordinates('https://www.openstreetmap.org/?mlat=40.7128&mlon=-74.006#map=18/40.7/-74'), 40.7128, -74.006);
  point(M.parseCoordinates('https://www.openstreetmap.org/#map=18/40.7128/-74.006'), 40.7128, -74.006);
  // The dropped pin wins over the viewport centre.
  point(M.parseCoordinates('https://www.google.com/maps/place/X/@40.7484,-73.9857,17z/data=!3m1!8m2!3d40.748817!4d-73.985428'), 40.748817, -73.985428);
});

test('repairs reversed order, a dropped minus sign and a dropped decimal point', () => {
  const swapped = M.parseCoordinates('-73.9857, 40.7484');
  point(swapped, 40.7484, -73.9857);
  assert.deepEqual(swapped.corrections, ['swapped']);
  assert.deepEqual(M.parseCoordinates('40.7484, 73.9857').corrections, ['west']);
  assert.deepEqual(M.parseCoordinates('73.9857 40.7484').corrections, ['swapped', 'west']);
  const decimal = M.parseCoordinates('407484, -739857');
  point(decimal, 40.7484, -73.9857);
  assert.deepEqual(decimal.notes, ['Restored the decimal point']);
  // Explicit hemispheres settle the order without counting as a correction.
  assert.deepEqual(M.parseCoordinates('73.9857W 40.7484N').corrections, []);
});

test('ranks readings that land in a borough above water or the box edges', () => {
  const locate = (lat, lon) => lat > 40.74 && lat < 40.76 && lon > -74 && lon < -73.97 ? 'Manhattan' : null;
  const result = M.parseCoordinates('40.7484, -73.9857', {locate});
  assert.equal(result.borough, 'Manhattan');
});

test('leaves addresses alone and reports coordinates outside the map', () => {
  for (const text of ['420 South 5th Street', '11211', 'Empire State Building', '', 'N2838353308']) assert.equal(M.parseCoordinates(text), null);
  const london = M.parseCoordinates('51.5, -0.12');
  assert.equal(london.status, 'outside');
  assert.equal(london.deliberate, true);
  // Bare integers may be a half-typed address, so the UI stays quiet.
  assert.equal(M.parseCoordinates('420 5').deliberate, false);
});

test('normalizes spelled-out street ordinals and pasted finding addresses', () => {
  assert.equal(M.normalizeQuery('420 South Fifth Street'), '420 South 5th Street');
  assert.equal(M.normalizeQuery('Twenty-Third Street'), '23rd Street');
  assert.equal(M.normalizeQuery('fifth ave'), '5th ave');
  assert.equal(M.normalizeQuery('First Presbyterian Church'), 'First Presbyterian Church');
  assert.equal(M.normalizeQuery('Address 420 South Fifth Street\n Brooklyn , NY 11211\n United States'), '420 South 5th Street Brooklyn, NY 11211');
});

test('splits intersections and marks the unambiguous separators', () => {
  assert.deepEqual(M.splitIntersection('Broadway & W 4th St'), {streets: ['Broadway', 'W 4th St'], explicit: true});
  assert.deepEqual(M.splitIntersection('Bleecker at Thompson'), {streets: ['Bleecker', 'Thompson'], explicit: false});
  assert.equal(M.splitIntersection('Empire State Building'), null);
});

test('reads OpenStreetMap object references from details links, osm.org links and ids', () => {
  const node = {type: 'N', id: 2838353308};
  assert.deepEqual(M.parseOsmReference('https://nominatim.openstreetmap.org/ui/details.html?osmtype=N&osmid=2838353308&class=place'), node);
  assert.deepEqual(M.parseOsmReference('https://www.openstreetmap.org/node/2838353308'), node);
  assert.deepEqual(M.parseOsmReference('N2838353308'), node);
  assert.deepEqual(M.parseOsmReference('node/2838353308'), node);
  assert.deepEqual(M.parseOsmReference('way 12345'), {type: 'W', id: 12345});
  for (const text of ['N 40', 'https://noveltytheater.net/buildings/thomas-shoe-factory', 'https://openstreetmap.org.evil.test/node/1', 'x123']) assert.equal(M.parseOsmReference(text), null);
  assert.match(M.lookupUrl(node), /osm_ids=N2838353308/);
});

const records = [
  {id: 'near', title: 'Brooklyn Savings Bank', borough: 'Brooklyn', point: [40.695, -73.991]},
  {id: 'far', title: 'Bank of the Manhattan Company', borough: 'Manhattan', point: [40.86, -73.93]},
  {id: 'ghost', title: 'Merchant’s House Museum', aliases: ['Old Merchant’s House'], location_text: '29 East Fourth Street', borough: 'Manhattan', point: [40.7276, -73.9925]},
  {id: 'lost', title: 'Unplaced Mansion', borough: 'Queens', point: null}
];
const index = M.buildIndex(records, {point: r => r.point, labels: r => r.id === 'ghost' ? ['Ghost story'] : []});

test('collection search matches titles, aliases, locations, labels and near misses', () => {
  const ids = query => M.searchIndex(index, query).map(row => row.record.id);
  assert.deepEqual(ids('merchant'), ['ghost']);
  assert.deepEqual(ids('east 4th street'), ['ghost']);
  assert.deepEqual(ids('east fourth'), ['ghost']);
  assert.deepEqual(ids('ghost story'), ['ghost']);
  assert.deepEqual(ids('brookyln savings'), ['near']);
  assert.deepEqual(ids('mansoin'), ['lost']);
  assert.deepEqual(ids('nowhere at all'), []);
});

test('collection search weighs matches by distance from the middle of the map', () => {
  const at = center => M.searchIndex(index, 'bank', {center, radius: 1500}).map(row => row.record.id);
  assert.deepEqual(at([40.695, -73.99]), ['near', 'far']);
  assert.deepEqual(at([40.86, -73.93]), ['far', 'near']);
  assert.ok(M.attenuation(0, 1000) > M.attenuation(5000, 1000));
  assert.ok(M.attenuation(1e7, 1000) >= 0.35, 'distant strong matches still surface');
});

test('lists collection places along a route in the order it passes them', () => {
  const line = [[-73.995, 40.69], [-73.99, 40.70], [-73.99, 40.73]];
  const hits = M.alongRoute(index, line, {meters: 300});
  assert.deepEqual(hits.map(hit => hit.record.id), ['near', 'ghost']);
  assert.ok(hits[0].along < hits[1].along);
  assert.ok(hits.every(hit => hit.distance <= 300));
});

test('keeps only New York State Nominatim rows inside the map area', () => {
  const row = (state, lat, lon, extra = {}) => ({osm_type: 'node', osm_id: 1, lat: String(lat), lon: String(lon), category: 'place', type: 'house', addresstype: 'place', name: '',
    display_name: '420, South 5th Street', address: {house_number: '420', road: 'South 5th Street', quarter: 'Williamsburg', suburb: 'Brooklyn', city: 'New York', 'ISO3166-2-lvl4': state},
    boundingbox: [lat - 1e-4, lat + 1e-4, lon - 1e-4, lon + 1e-4].map(String), ...extra});
  const rows = M.fromNominatim([row('US-NY', 40.7071, -73.9524), row('US-NJ', 40.66, -74.21), row('US-NY', 42.65, -73.75)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'Address');
  assert.equal(rows[0].title, '420 South 5th Street');
  assert.equal(rows[0].subtitle, 'Williamsburg, Brooklyn');
  assert.match(rows[0].links.details, /osmtype=N&osmid=1$/);
  // A station, its platform and its stop collapse into one row.
  const station = extra => row('US-NY', 40.7174, -73.957, {category: 'railway', type: 'station', name: 'Bedford Avenue', ...extra});
  const stations = M.fromNominatim([station(), station({type: 'platform'}), station({type: 'stop', lat: '40.7169'})]);
  assert.equal(stations.length, 1);
  assert.equal(stations[0].kind, 'Transit');
});

test('scopes Nominatim to the map area and the requested bounds', () => {
  const url = new URL(M.nominatimUrl('420 South Fifth Street'));
  assert.equal(url.searchParams.get('q'), '420 South 5th Street');
  assert.equal(url.searchParams.get('bounded'), '1');
  assert.equal(url.searchParams.get('countrycodes'), 'us');
  assert.equal(url.searchParams.get('viewbox'), '-74.33,40.99,-73.61,40.43');
  const narrow = new URL(M.nominatimUrl('Broadway', {bounds: [[40.72, -74.01], [40.74, -73.99]], dedupe: false}));
  assert.equal(narrow.searchParams.get('viewbox'), '-74.01,40.74,-73.99,40.72');
  assert.equal(narrow.searchParams.get('dedupe'), '0');
});

test('cleans NYC GeoSearch labels', () => {
  const feature = (name, borough, lon = -73.95, lat = 40.707) => ({properties: {name, borough}, geometry: {coordinates: [lon, lat]}});
  const rows = M.fromGeosearch({features: [feature('420 SOUTH 5 STREET', 'Brooklyn'), feature('420 SOUTH 5 STREET', 'Brooklyn'), feature('THE CUNY GRADUATE CENTER', 'Manhattan'), feature('100 AVENUE A', 'Manhattan'), feature('FAR AWAY', 'Albany', -73.75, 42.65)]});
  assert.deepEqual(rows.map(row => row.title), ['420 South 5th Street', 'The CUNY Graduate Center', '100 Avenue A']);
  assert.deepEqual(rows.map(row => row.kind), ['Address', 'Landmark', 'Address']);
});

test('finds where two streets meet, including crossings between simplified vertices', () => {
  const ns = {type: 'LineString', coordinates: [[-73.958, 40.712], [-73.957, 40.724]]};
  const ew = {type: 'LineString', coordinates: [[-73.965, 40.7175], [-73.950, 40.7185]]};
  const meet = M.intersectLines([ns], [ew]);
  assert.equal(meet.gap, 0);
  near(meet.latitude, 40.7178, 3);
  near(meet.longitude, -73.9576, 3);
  const parallel = {type: 'LineString', coordinates: [[-73.94, 40.712], [-73.939, 40.724]]};
  assert.equal(M.intersectLines([ns], [parallel]), null);
});

test('clusters a street name by where it occurs', () => {
  const box = (s, w) => ({bounds: [[s, w], [s + 0.002, w + 0.002]]});
  const clusters = M.streetClusters([box(40.731, -74.003), box(40.733, -74.001), box(40.728, -73.996), box(40.59, -73.98)]);
  assert.equal(clusters.length, 2);
  assert.ok(clusters[0][0][0] < 40.728 && clusters[0][1][0] > 40.735, 'Village segments join into the larger cluster');
});

test('builds route requests and reads their results', () => {
  const url = M.routeUrl('foot', {latitude: 40.7484, longitude: -73.9857}, {latitude: 40.7063, longitude: -73.9532});
  assert.equal(url, 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/-73.985700,40.748400;-73.953200,40.706300?overview=full&geometries=geojson&steps=false&alternatives=false');
  assert.throws(() => M.routeUrl('boat', {latitude: 0, longitude: 0}, {latitude: 0, longitude: 0}));
  assert.deepEqual(M.fromRoute({code: 'Ok', routes: [{distance: 6600, duration: 4200, geometry: {coordinates: [[0, 0], [1, 1]]}}]}), {distance: 6600, duration: 4200, line: [[0, 0], [1, 1]]});
  assert.equal(M.fromRoute({code: 'NoRoute'}), null);
  assert.equal(M.formatDistance(6600), '4.1 mi');
  assert.equal(M.formatDistance(100), '330 ft');
  assert.equal(M.formatDuration(4200), '1 h 10 min');
});

test('builds reverse lookups for a pinned point', () => {
  const url = new URL(M.reverseUrl(40.706274, -73.953182));
  assert.equal(url.pathname, '/reverse');
  assert.equal(url.searchParams.get('lat'), '40.706274');
  assert.equal(url.searchParams.get('lon'), '-73.953182');
  assert.equal(url.searchParams.get('zoom'), '18');
});

test('names a spot by its two nearest cross streets and neighbourhood, merging PAD spellings', () => {
  const at = (street, distance, neighbourhood = 'Greenwich Village') => ({ properties: { street, distance, neighbourhood, borough: 'Manhattan' } });
  const vicinity = M.describeVicinity({ features: [at('BLEEKER STREET', 0.022), at('BLEECKER STREET', 0.019), at('BLEECKER STREET', 0.02),
    at('MAC DOUGAL STREET', 0.022), at('MACDOUGAL STREET', 0.023), at('MACDOUGAL STREET', 0.024), at('WEST 3 STREET', 0.05)] });
  assert.deepEqual(vicinity, { streets: ['Bleecker St', 'Macdougal St'], near: 'Bleecker St & Macdougal St', area: 'Greenwich Village, Manhattan',
    borough: 'Manhattan', label: 'Bleecker St & Macdougal St · Greenwich Village, Manhattan' });
  assert.equal(M.describeVicinity({ features: [at('WEST 36 STREET', 0.01, 'Midtown West')] }).label, 'West 36th St · Midtown West, Manhattan');
  assert.equal(M.describeVicinity({ features: [] }), null);
  assert.match(M.reverseGeosearchUrl(40.72917, -74.00119), /^https:\/\/geosearch\.planninglabs\.nyc\/v2\/reverse\?point\.lat=40\.729170&point\.lon=-74\.001190/);
});
