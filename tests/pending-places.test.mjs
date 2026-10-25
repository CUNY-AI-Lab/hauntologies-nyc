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

test('the deployed gate serves the pending layer to anyone, read-only', async t => {
  const h = harness(t), s = await submit(h, proposal());
  let forwarded = 0;
  const worker = createDemoWorker({ fetch: () => { forwarded++; return new Response('map'); } });
  const env = { DB: h.db };
  const response = await worker.fetch(new Request('https://map.test/api/pending-places'), env, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await response.json()).places.map(p => p.id), [s.id]);
  assert.equal((await worker.fetch(new Request('https://map.test/api/pending-places?owner=author'), env, {})).status, 400);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await worker.fetch(new Request('https://map.test/api/pending-places', { method }), env, {})).status, 401);
  assert.equal((await worker.fetch(new Request('https://map.test/api/pending-places'), { DB: { prepare() { throw new Error('down'); } } }, {})).status, 503);
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

test('the signed-in roster names every registrant with their counts and never an email', async t => {
  const { contributorRoster } = await import('../server/published-edits.mjs');
  const h = harness(t), run = (sql, ...v) => h.db.native.prepare(sql).run(...v);
  const register = (name, email) => run('INSERT INTO event_registrations (id,event_id,idempotency_hash,payload_hash,name,email,created_at) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), 'e', crypto.randomUUID(), 'p', name, email, '2026-10-22T00:00:00Z');
  register('Ada Example', 'ada@example.test'); register('Ada Example', 'ADA.alt@example.test'); register('Bo Example', 'bo@example.test');
  run('INSERT INTO hny_auth_user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)', 'u1', '', 'Ada@Example.test', 1, '2026-10-22', '2026-10-22');
  await submit(h, proposal({ title: 'One' }), 'map_u1'); await submit(h, proposal({ title: 'Two' }), 'map_u1');
  // The same place sent again counts once; two untitled contributions stay two.
  await submit(h, proposal({ title: 'two ' }), 'map_u1'); await submit(h, proposal({ title: 'Contribution' }), 'map_u1'); await submit(h, proposal({ title: 'Contribution' }), 'map_u1');
  const roster = await contributorRoster(h.db);
  assert.deepEqual(roster, { registrants: [{ name: 'Ada Example', contributions: 4, published: 0, account: true }, { name: 'Bo Example', contributions: 0, published: 0, account: false }] });
  assert.ok(!JSON.stringify(roster).includes('@'));
});

test('the roster endpoint is for signed-in accounts only', async () => {
  const worker = createDemoWorker({ fetch: async () => new Response('app') });
  const response = await worker.fetch(new Request('https://map.test/api/contributor-roster'), { DB: {} }, {});
  assert.equal(response.status, 401);
});
