import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { CHECKS } from '../server/workflow-core.mjs';
import { pendingPlaces } from '../server/pending-places.mjs';
import { createDemoWorker } from '../deployment/demo-gate.mjs';
import { reviewAuthorization } from '../server/review-authorization.mjs';
import { publishedEdits } from '../server/published-edits.mjs';

// Places sent for review appear publicly as their own layer. Synthetic records and actors only.
const boundaries = JSON.parse(readFileSync(new URL('../public/data/nyc-borough-boundaries.geojson', import.meta.url)));
const place = { id: 'synthetic_place', title: 'Original title', description: 'Original description.', category: 'reported_haunting', borough: 'Manhattan', latitude: 40.72, longitude: -74, geo_status: 'approximate' };

function sqliteD1() {
  const native = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) native.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  const prepare = (sql, params = []) => ({ bind(...values) { return prepare(sql, values); },
    async first(column) { const row = native.prepare(sql).get(...params) || null; return column && row ? row[column] : row; },
    async all() { return { results: native.prepare(sql).all(...params) }; },
    async run() { return { success: true, meta: { changes: Number(native.prepare(sql).run(...params).changes) } }; } });
  let tail = Promise.resolve();
  return { native, prepare, batch(statements) {
    const operation = tail.then(async () => { native.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); native.exec('COMMIT'); return out; } catch (error) { native.exec('ROLLBACK'); throw error; } });
    tail = operation.catch(() => {}); return operation; } };
}
function harness(t, authorization = { reviewers: ['reviewer'], publishers: ['publisher'] }) {
  const db = sqliteD1(); t.after(() => db.native.close());
  const service = createWorkflowService({ store: createWorkflowStore(db), staticRecords: [place], taskSeeds: { tasks: [] }, geography: { boundaries }, authorization });
  return { db, service };
}
async function call(h, path, body, actor = 'author') {
  const response = await h.service.handle(new Request('https://map.test/api/contributions/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'oai-authenticated-user-id': actor, origin: 'https://map.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: response.status, body: await response.json() };
}
const ok = (response, expected) => { assert.equal(response.status, expected, JSON.stringify(response.body)); return response.body; };
const key = () => crypto.randomUUID();
function proposal({ title = 'Lantern in the brickworks', explanation = 'A lantern moves through the old brickworks at night.', geometry = { type: 'Point', coordinates: [-74.2391, 40.5365] }, targets = [], extra = {} } = {}) {
  return { schema_version: '1.0', type: 'open_proposal', task_ids: [], title, summary: explanation, public_credit: { consent: false, label: '' }, sources: [], attachments: [], targets,
    payload: { explanation, geometry, sources_text: 'Private note: told to me by a neighbour', ...extra } };
}
const submit = async (h, value, actor = 'author') => ok(await call(h, 'submit', { idempotency_key: key(), submission_json: JSON.stringify(value) }, actor), 201).submission;
const triage = (h, s, action, actor) => call(h, 'triage', { idempotency_key: key(), submission_id: s.id, expected_revision: s.revision, action, rationale: 'Synthetic triage.' }, actor);

test('a new place sent for review is on the public pending layer at once, with no private fields', async t => {
  const h = harness(t), s = await submit(h, proposal({ extra: { location_text: 'Kreischer Street' } }));
  const { places } = await pendingPlaces(h.db);
  assert.equal(places.length, 1);
  assert.deepEqual(places[0], { id: s.id, status: 'submitted', submitted_at: places[0].submitted_at, title: 'Lantern in the brickworks',
    description: 'A lantern moves through the old brickworks at night.', location_text: 'Kreischer Street', latitude: 40.5365, longitude: -74.2391 });
  const text = JSON.stringify(places);
  for (const secret of ['author', 'owner', 'Private note', 'sources', 'attachments']) assert.ok(!text.includes(secret), secret);
});

test('a consented public credit names the contributor on the pending layer; nothing else does', async t => {
  const h = harness(t), run = (sql, ...v) => h.db.native.prepare(sql).run(...v);
  const credited = await submit(h, { ...proposal({ title: 'Named lantern' }), public_credit: { consent: true, label: '  Ada   Example ' } }, 'map_u1');
  const unnamed = await submit(h, proposal({ title: 'Unnamed lantern' }), 'map_u2');
  const emailish = await submit(h, { ...proposal({ title: 'Address lantern' }), public_credit: { consent: true, label: 'ada@example.test' } }, 'map_u3');
  const hidden = await submit(h, { ...proposal({ title: 'Hidden lantern' }), public_credit: { consent: true, label: 'Bo Example' } }, 'map_u4');
  run('INSERT INTO hny_auth_user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)', 'u4', '', 'bo@example.test', 1, '2026-10-22', '2026-10-22');
  run('INSERT INTO contributor_roster_hidden (user_id,created_at) VALUES (?,?)', 'u4', '2026-10-22T00:00:00Z');
  const { places } = await pendingPlaces(h.db), byId = Object.fromEntries(places.map(p => [p.id, p]));
  assert.equal(byId[credited.id].contributor, 'Ada Example', 'label is trimmed and whitespace collapsed');
  for (const s of [unnamed, emailish, hidden]) assert.ok(!Object.hasOwn(byId[s.id], 'contributor'), s.id + ' carries no name');
  const text = JSON.stringify(places);
  for (const secret of ['map_u', 'owner', '@', 'Bo Example']) assert.ok(!text.includes(secret), secret);
});

test('leaving the roster hides a published credit from every public feed at once; rejoining restores it', async t => {
  const { contributorCredits, publishedEdits, setRosterListing } = await import('../server/published-edits.mjs');
  const h = harness(t), run = (sql, ...v) => h.db.native.prepare(sql).run(...v), author = 'map_u1';
  run('INSERT INTO hny_auth_user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)', 'u1', '', 'ada@example.test', 1, '2026-10-22', '2026-10-22');
  const s = await submit(h, { ...proposal({ title: 'Credited lantern' }), public_credit: { consent: true, label: 'Ada Example' } }, author);
  const approved = ok(await call(h, 'review', { idempotency_key: key(), submission_id: s.id, expected_revision: s.revision, payload_hash: s.payload_hash, diff_hash: s.diff_hash,
    checks: Object.fromEntries(CHECKS.map(k => [k, 'pass'])), rationale: 'Synthetic independent review.' }, 'reviewer'), 200).submission;
  const staged = ok(await call(h, 'apply', { idempotency_key: key(), submission_id: approved.id, expected_revision: approved.revision, approval_hash: approved.approval.approval_hash }, 'publisher'), 201);
  ok(await call(h, 'verify', { idempotency_key: key(), job_id: staged.job.id, map_list_check: { status: 'pass', evidence: 'Synthetic check of the map point and list entry.' } }, 'publisher'), 200);
  // Every public credit projection, read through the deployed gate with no session.
  const worker = createDemoWorker({ fetch: async () => new Response('app') }), env = { DB: h.db };
  const feeds = async () => {
    const out = {};
    for (const path of ['/api/published-edits', '/api/published-records', '/api/contributor-credits', '/api/pending-places']) {
      const response = await worker.fetch(new Request('https://map.test' + path), env, {});
      assert.equal(response.status, 200, path); out[path] = await response.json();
    }
    return out;
  };
  const credited = async () => {
    const f = await feeds();
    assert.equal(f['/api/published-edits'].items.length, 1);
    assert.equal(f['/api/published-edits'].items[0].credit, 'Ada Example');
    assert.deepEqual(f['/api/contributor-credits'], { contributors: [{ name: 'Ada Example', count: 1 }], total: 1 });
    assert.deepEqual(f['/api/published-records'].records.find(r => r.title === 'Credited lantern')?.contributors, ['Ada Example']);
    assert.deepEqual(f['/api/pending-places'].places, [], 'published, so no longer pending');
  };
  await credited();
  assert.deepEqual(await setRosterListing(h.db, author, false), { listed: false });
  const hidden = await feeds();
  assert.ok(!JSON.stringify(hidden).includes('Ada Example'), 'no public feed names an opted-out contributor');
  // The release itself stays public and still counts; only the name is withheld.
  assert.equal(hidden['/api/published-edits'].items.length, 1);
  assert.ok(!Object.hasOwn(hidden['/api/published-edits'].items[0], 'credit'));
  assert.deepEqual(hidden['/api/contributor-credits'], { contributors: [], total: 1 });
  assert.equal(hidden['/api/published-records'].records.filter(r => r.title === 'Credited lantern').length, 1);
  assert.deepEqual((await publishedEdits(h.db))[0].credit, undefined);
  assert.deepEqual((await contributorCredits(h.db)).contributors, []);
  assert.deepEqual(await setRosterListing(h.db, author, true), { listed: true });
  await credited();
});

test('a contribution to a mapped place is drawn at that place; one with nowhere to draw is left out', async t => {
  const h = harness(t), target = ok(await call(h, 'target?id=' + place.id), 200).target;
  const added = await submit(h, proposal({ geometry: null, targets: [{ record_id: target.record_id, expected_version: target.expected_version, expected_hash: target.expected_hash }] }));
  await submit(h, proposal({ title: 'Somewhere', geometry: null }));
  const { places } = await pendingPlaces(h.db);
  assert.deepEqual(places.map(p => [p.id, p.record_id, p.latitude]), [[added.id, place.id, undefined]]);
});

test('withheld and published places leave the pending layer; returned ones stay, marked', async t => {
  const h = harness(t);
  const kept = await submit(h, proposal({ title: 'Sent back' })), gone = await submit(h, proposal({ title: 'Withdrawn' }), 'author2');
  ok(await triage(h, kept, 'request_information', 'reviewer'), 200);
  ok(await triage(h, gone, 'withhold', 'author2'), 200);
  let { places } = await pendingPlaces(h.db);
  assert.deepEqual(places.map(p => [p.title, p.status]), [['Sent back', 'changes_requested']]);

  const live = await submit(h, proposal({ title: 'Published soon' }), 'author3');
  const approved = ok(await call(h, 'review', { idempotency_key: key(), submission_id: live.id, expected_revision: live.revision, payload_hash: live.payload_hash, diff_hash: live.diff_hash,
    checks: Object.fromEntries(CHECKS.map(k => [k, 'pass'])), rationale: 'Synthetic independent review.' }, 'reviewer'), 200).submission;
  ({ places } = await pendingPlaces(h.db));
  assert.equal(places.find(p => p.id === live.id)?.status, 'approved');
  const staged = ok(await call(h, 'apply', { idempotency_key: key(), submission_id: approved.id, expected_revision: approved.revision, approval_hash: approved.approval.approval_hash }, 'publisher'), 201);
  ok(await call(h, 'verify', { idempotency_key: key(), job_id: staged.job.id, map_list_check: { status: 'pass', evidence: 'Synthetic check of the map point and list entry.' } }, 'publisher'), 200);
  ({ places } = await pendingPlaces(h.db));
  assert.ok(!places.some(p => p.id === live.id), 'published place is drawn by the published layer instead');
});

test('a configured reviewer alone takes a new place from approval to the map, as Review does on Approve', async t => {
  const author = 'map_00000000-0000-4000-8000-000000000001', reviewer = 'map_00000000-0000-4000-8000-000000000002';
  const h = harness(t, reviewAuthorization(JSON.stringify([reviewer]))), s = await submit(h, proposal({ title: 'Lantern on Sullivan' }), author);
  const approved = ok(await call(h, 'review', { idempotency_key: key(), submission_id: s.id, expected_revision: s.revision, payload_hash: s.payload_hash, diff_hash: s.diff_hash,
    checks: Object.fromEntries(CHECKS.map(k => [k, 'pass'])), rationale: 'Approved.' }, reviewer), 200).submission;
  const staged = ok(await call(h, 'apply', { idempotency_key: key(), submission_id: approved.id, expected_revision: approved.revision, approval_hash: approved.approval.approval_hash }, reviewer), 201);
  ok(await call(h, 'verify', { idempotency_key: key(), job_id: staged.job.id, map_list_check: { status: 'pass', evidence: 'Published from Review on approval.' } }, reviewer), 200);
  assert.ok(!(await pendingPlaces(h.db)).places.some(p => p.id === s.id), 'no longer pending');
  assert.ok((await publishedEdits(h.db)).some(e => JSON.stringify(e).includes('Lantern on Sullivan')), 'published');
});

test('the direct-publication gate keeps legacy saved work private', async t => {
  const h = harness(t), s = await submit(h, proposal());
  let forwarded = 0;
  const worker = createDemoWorker({ fetch: () => { forwarded++; return new Response('map'); } });
  const env = { DB: h.db };
  const response = await worker.fetch(new Request('https://map.test/api/pending-places'), env, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await response.json()).places, []);
  assert.equal((await worker.fetch(new Request('https://map.test/api/pending-places?owner=author'), env, {})).status, 400);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await worker.fetch(new Request('https://map.test/api/pending-places', { method }), env, {})).status, 401);
  assert.equal((await worker.fetch(new Request('https://map.test/api/pending-places'), { DB: { prepare() { throw new Error('down'); } } }, {})).status, 200);
  assert.equal(forwarded, 0);
});

test('an older attempt at a place the same contributor sent again drops out; others stay', async t => {
  const h = harness(t);
  const first = await submit(h, proposal({ title: 'Thomas Shoe Factory' }));
  const second = await submit(h, proposal({ title: 'thomas shoe factory ' }));
  const other = await submit(h, proposal({ title: 'Thomas Shoe Factory' }), 'someone-else');
  const untitledA = await submit(h, proposal({ title: 'Contribution' })), untitledB = await submit(h, proposal({ title: 'Contribution' }));
  h.db.native.prepare('UPDATE workflow_submissions SET created_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z', first.id);
  const ids = (await pendingPlaces(h.db)).places.map(p => p.id);
  assert.ok(!ids.includes(first.id), 'older same-title attempt hidden');
  for (const id of [second.id, other.id, untitledA.id, untitledB.id]) assert.ok(ids.includes(id), id);
  // The newer attempt leaving review (a draft again, or published) does not bring the older one back.
  for (const state of ['draft', 'merged']) {
    h.db.native.prepare('UPDATE workflow_submissions SET review_state=? WHERE id=?').run(state, second.id);
    const now = (await pendingPlaces(h.db)).places.map(p => p.id);
    assert.ok(!now.includes(first.id) && !now.includes(second.id), state);
  }
});

test('the roster endpoint is for signed-in accounts only', async () => {
  const worker = createDemoWorker({ fetch: async () => new Response('app') });
  const response = await worker.fetch(new Request('https://map.test/api/contributor-roster'), { DB: {} }, {});
  assert.equal(response.status, 401);
});

test('leaving the roster needs a signed-in account', async () => {
  const worker = createDemoWorker({ fetch: async () => new Response('app') });
  const response = await worker.fetch(new Request('https://map.test/api/contributor-roster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"listed":false}' }), { DB: {} }, {});
  assert.equal(response.status, 401);
});



test('roster attribution is chosen monikers only, never registration or account names/email',async t=>{
 const {contributorRoster,setRosterListing}=await import('../server/published-edits.mjs');
 const h=harness(t),run=(sql,...v)=>h.db.native.prepare(sql).run(...v);
 run('INSERT INTO hny_auth_user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)','u1','Private Account Name','private@example.test',1,'2026-10-22','2026-10-22');
 run('INSERT INTO event_registrations (id,event_id,idempotency_hash,payload_hash,name,email,created_at) VALUES (?,?,?,?,?,?,?)','reg','event','idem','payload','Private Registration Name','private@example.test','2026-10-22');
 assert.deepEqual(await contributorRoster(h.db,'map_u1'),{registrants:[],you:{listed:true}});
 await setRosterListing(h.db,'map_u1',false);
 await submit(h,{...proposal({title:'Legacy hidden'}),public_credit:{consent:true,label:'Earlier private name'}},'map_u1');
 await submit(h,{...proposal({title:'Chosen username'}),public_credit:{consent:true,label:'night.owl',identity:'moniker'}},'map_u1');
 const roster=await contributorRoster(h.db,'map_u1');assert.deepEqual(roster.registrants,[]);assert.deepEqual(roster.you,{listed:false});
 const places=await pendingPlaces(h.db);assert.equal(places.places.find(p=>p.title==='Chosen username').contributor,'night.owl');assert.equal(places.places.find(p=>p.title==='Legacy hidden').contributor,undefined);
 for(const secret of ['Private Account','Private Registration','private@example.test','Earlier private name'])assert.ok(!JSON.stringify({roster,places}).includes(secret));
 const bad=await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify({...proposal(),public_credit:{consent:true,label:'private@example.test',identity:'moniker'}})},'map_u1');ok(bad,400);
});
