import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { buildPreview, hash } from '../server/workflow-core.mjs';
import { validateAreaGeometry } from '../server/area-geometry.mjs';
import { parseStaticRecords } from '../server/static-targets.mjs';

// Isolated synthetic submissions use existing migration SQL in memory. These
// tests never connect to the private Site, production D1, or an external URL.
const boundaries = JSON.parse(readFileSync(new URL('../public/data/nyc-borough-boundaries.geojson', import.meta.url)));
const inventoryText = readFileSync(new URL('../public/inventory.js', import.meta.url), 'utf8');
const inventory = JSON.parse(inventoryText.replace(/^window\.NYC_INVENTORY\s*=\s*/, '').replace(/;\s*$/, ''));
const actualStaticRecord = inventory.records[0];
const now = () => new Date('2026-10-21T16:00:00.000Z');
const allChecks = () => ({ evidence_check: 'pass', geography_check: 'pass', rights_check: 'pass', duplicate_check: 'pass', privacy_check: 'pass' });

function sqliteD1() {
  let tail = Promise.resolve();
  const native = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    native.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  const prepare = (sql, params = []) => ({
    bind(...values) { return prepare(sql, values); },
    async first(column) { const row = native.prepare(sql).get(...params) || null; return column && row ? row[column] : row; },
    async all() { return { results: native.prepare(sql).all(...params) }; },
    async run() { const result = native.prepare(sql).run(...params); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
  });
  return {
    native, prepare,
    batch(statements) {
      const operation = tail.then(async () => {
        native.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          native.exec('COMMIT');
          return results;
        } catch (error) { native.exec('ROLLBACK'); throw error; }
      });
      tail = operation.catch(() => {});
      return operation;
    },
    close() { native.close(); },
  };
}

function harness(options = {}) {
  const db = sqliteD1(), store = createWorkflowStore(db);
  const staticRecords = structuredClone(options.staticRecords || [actualStaticRecord]);
  const service = createWorkflowService({
    store, staticRecords, taskSeeds: { tasks: [] }, geography: { boundaries }, now,
    ...(options.authorization === false ? {} : { authorization: options.authorization || { reviewers: ['reviewer'], publishers: ['publisher'] } }),
  });
  return { db, store, service, staticRecords, sequence: 0 };
}

function request(path, body, options = {}) {
  const actor = options.actor === undefined ? 'owner' : options.actor;
  return new Request('https://map.test/api/contributions/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(actor ? { 'oai-authenticated-user-id': actor } : {}), origin: options.origin || 'https://map.test', 'sec-fetch-site': options.fetchSite || 'same-origin', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function call(h, path, body, options) {
  const response = await h.service.handle(request(path, body, options));
  return { status: response.status, body: await response.json() };
}
const key = (h, action) => 'embedded_' + action + '_' + String(++h.sequence).padStart(6, '0');
const assertStatus = (response, status) => assert.equal(response.status, status, JSON.stringify(response.body));
const count = (h, table) => h.db.native.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count;
const preview = payload => buildPreview(JSON.stringify(payload), { geography: { boundaries } });

async function seedHosted(h) {
  const rawJson = JSON.stringify({ schema_version: '2.0', title: 'Synthetic hosted record', description: '  Original wording\nand unresolved uncertainty remain. 😀', metadata: { sources: [{ citation: 'Synthetic citation with unknown rights.', url: 'https://example.org/fixture' }], original_submission_json: '{"original":"spacing retained"}' } });
  const row = { id: 'r_hosted_fixture_001', owner_id: 'owner', preview_id: 'p_hosted_fixture_001', raw_json: rawJson, raw_hash: await hash(rawJson), derived_json: JSON.stringify({ location: { status: 'missing', latitude: null, longitude: null, reason: 'No supported point.' } }), preview_hash: 'synthetic-preview-hash', approved_at: now().toISOString() };
  h.db.native.prepare('INSERT INTO approved_records (id,owner_id,preview_id,raw_json,raw_hash,derived_json,preview_hash,approved_at) VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(row));
  return row;
}

function envelope(type, payload, changes = {}) {
  return { schema_version: '1.0', type, task_ids: [], title: 'Synthetic embedded contribution', summary: 'A bounded proposal with original wording and uncertainty preserved.', public_credit: { consent: false, label: '' }, sources: [], attachments: [], targets: [], payload, ...changes };
}

async function submit(h, input, suppliedKey) {
  const body = { idempotency_key: suppliedKey || key(h, 'submit'), submission_json: JSON.stringify(input, null, 2) };
  const result = await call(h, 'submit', body);
  assertStatus(result, 201);
  return { ...result.body, request: body };
}

function reviewBody(h, submission, changes = {}) {
  return { idempotency_key: key(h, 'review'), submission_id: submission.id, expected_revision: submission.revision, payload_hash: submission.payload_hash, diff_hash: submission.diff_hash, checks: allChecks(), rationale: 'Synthetic independent review; this remains a proposal and does not activate map content.', ...changes };
}

const areaRing = () => [[-73.949, 40.820], [-73.948, 40.820], [-73.948, 40.821], [-73.949, 40.821], [-73.949, 40.820]];
const unknownDates = () => ({ time_original: 'unknown', time_precision: 'unknown', time_start_year: null, time_end_year: null, time_basis: 'The cited fixture does not establish historical date bounds.' });
const evidenceSource = () => ({ citation: 'Synthetic historical map fixture; creator and date unknown.', locator: 'Fixture sheet 1', url: 'https://example.org/fixture-map', accessed_on: '2026-10-21', rights_status: 'unknown', rights_statement: 'Citation only; no source media copied.', public_use: 'citation_only', source_type: 'historical map' });
function areaEnvelope(change = {}) {
  return envelope('area_proposal', {
    category: 'reported_haunting',
    description: 'The fixture records an attributed story within a proposed area; it does not establish a supernatural event.',
    place_original: '  Original area wording\nwith uncertainty preserved. 😀',
    borough: 'Manhattan', dates: unknownDates(), geometry_status: 'proposed',
    geometry: { type: 'Polygon', coordinates: [areaRing()] },
    geometry_basis: 'A bounded synthetic tracing proposal from fixture sheet 1, subject to independent geographic review.',
    uncertainty_note: 'This proposed outline is not a surveyed historical footprint.',
    record_license: 'CC0-1.0', rights_notes: 'Synthetic contributor-authored proposal; source media rights remain unknown.',
    ...change,
  }, { sources: [evidenceSource()] });
}
function annotationEnvelope(target, change = {}) {
  return envelope('record_annotation', {
    annotation_kind: 'clarification',
    text: 'A bounded synthetic note that retains the original claim and its limitations.',
    original_wording: target.record?.description || target.record?.evidence_summary || 'Original wording is retained in the target snapshot.',
    uncertainty_note: 'This note does not resolve unknown historical dates or locations.',
    dates: null,
    ...change,
  }, { targets: [{ record_id: target.record_id, expected_version: target.expected_version, expected_hash: target.expected_hash }], sources: [evidenceSource()] });
}

async function invalidPreview(input, options = {}) {
  let result;
  try { result = await buildPreview(JSON.stringify(input), { geography: { boundaries }, ...options }); }
  catch (error) { assert.notEqual(error.name, 'TypeError'); assert.equal(typeof error.code, 'string'); return; }
  assert.equal(result.validation.valid, false, JSON.stringify(result));
  assert.equal(result.application.applicable, false);
}

test('a sourced NYC polygon is a review-only proposal with exact original coordinates and null dates', async () => {
  const input = areaEnvelope();
  const result = await preview(input);
  assert.deepEqual(result.validation.errors, []);
  assert.equal(result.application.applicable, false);
  assert.deepEqual(result.application.operations, []);
  assert.deepEqual(result.envelope, input);
  assert.deepEqual(result.proposal.geometry, input.payload.geometry);
  assert.deepEqual(result.proposal.bounds, [[-73.949, 40.820], [-73.948, 40.821]]);
  assert.equal(result.proposal.dates.time_start_year, null);
  assert.equal(result.proposal.dates.time_end_year, null);
});

test('unresolved area geography remains null rather than becoming a point, box or centroid', async () => {
  const input = areaEnvelope({ borough: 'unknown', geometry_status: 'unresolved', geometry: null, geometry_basis: 'No defensible historical outline is known.' });
  const result = await preview(input);
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation));
  assert.equal(result.application.applicable, false);
  assert.equal(result.proposal.geometry, null);
  assert.equal(result.proposal.bounds, null);
  assert.deepEqual(result.envelope.payload, input.payload);
  await invalidPreview(areaEnvelope({ geometry_status: 'unresolved' }));
  await invalidPreview(areaEnvelope({ geometry: null }));
});

test('area proposals reject unsupported geometry types, holes, open rings and malformed positions', async () => {
  const geometries = [
    { type: 'Point', coordinates: [-73.949, 40.820] },
    { type: 'MultiPolygon', coordinates: [[areaRing()]] },
    { type: 'GeometryCollection', geometries: [] },
    { type: 'Polygon', coordinates: [areaRing(), areaRing()] },
    { type: 'Polygon', coordinates: [areaRing().slice(0, -1)] },
    { type: 'Polygon', coordinates: [] },
    { type: 'Polygon', coordinates: [null] },
    { type: 'Polygon', coordinates: [[[-73.949, 40.820], null, [-73.948, 40.821], [-73.949, 40.820]]] },
    { type: 'Polygon', coordinates: [[[-73.949, 40.820], ['-73.948', 40.820], [-73.948, 40.821], [-73.949, 40.820]]] },
    { type: 'Polygon', coordinates: [[[-73.949, 40.820], [-73.948, 40.820, 50], [-73.948, 40.821], [-73.949, 40.820]]] },
  ];
  for (const geometry of geometries) await invalidPreview(areaEnvelope({ geometry }));
});

test('area topology rejects crossing, repeated and zero-area rings', async () => {
  const rings = [
    [[-73.949, 40.820], [-73.948, 40.821], [-73.948, 40.820], [-73.949, 40.821], [-73.949, 40.820]],
    [[-73.949, 40.820], [-73.948, 40.820], [-73.948, 40.820], [-73.948, 40.821], [-73.949, 40.820]],
    [[-73.949, 40.820], [-73.948, 40.820], [-73.947, 40.820], [-73.949, 40.820]],
    [[-73.949, 40.820], [-73.948, 40.820], [-73.948, 40.821], [-73.949, 40.820], [-73.949, 40.821], [-73.949, 40.820]],
  ];
  for (const ring of rings) await invalidPreview(areaEnvelope({ geometry: { type: 'Polygon', coordinates: [ring] } }));
});

test('area coordinates are finite WGS84, bounded in count, inside NYC and consistent with a named borough', async () => {
  for (const position of [[0, 0], [181, 40.820], [-73.949, 91], [40.820, -73.949], [-74.0431, 40.7178], [null, 40.820]]) {
    const ring = areaRing();
    ring[1] = position;
    await invalidPreview(areaEnvelope({ geometry: { type: 'Polygon', coordinates: [ring] } }));
  }
  await invalidPreview(areaEnvelope({ borough: 'Queens' }));
  const ring = Array.from({ length: 101 }, (_, index) => {
    const angle = index * Math.PI * 2 / 101;
    return [-73.9485 + Math.cos(angle) * 0.0002, 40.8205 + Math.sin(angle) * 0.0002];
  });
  ring.push([...ring[0]]);
  await invalidPreview(areaEnvelope({ geometry: { type: 'Polygon', coordinates: [ring] } }));
  const nonFiniteJson = JSON.stringify(areaEnvelope()).replace('-73.949', '1e999');
  await assert.rejects(buildPreview(nonFiniteJson, { geography: { boundaries } }), error => error.name !== 'TypeError' && typeof error.code === 'string');
});

test('full-footprint containment rejects an edge crossing outside a concave boundary even when every vertex is inside', async () => {
  const concaveBoundary = {
    type: 'FeatureCollection', features: [{ type: 'Feature', properties: { boroname: 'Manhattan' }, geometry: { type: 'Polygon', coordinates: [[[-73.950, 40.820], [-73.940, 40.820], [-73.940, 40.830], [-73.944, 40.830], [-73.944, 40.824], [-73.946, 40.824], [-73.946, 40.830], [-73.950, 40.830], [-73.950, 40.820]]] } }],
  };
  const geometry = { type: 'Polygon', coordinates: [[[-73.949, 40.829], [-73.941, 40.829], [-73.945, 40.821], [-73.949, 40.829]]] };
  await invalidPreview(areaEnvelope({ geometry }), { geography: { boundaries: concaveBoundary } });
});

test('geometry validation fails closed for nonfinite numbers, malformed values and unavailable boundaries', () => {
  for (const geometry of [undefined, null, [], {}, true, 4, 'Polygon', { type: 'Polygon', coordinates: [{ toString: null }] }]) {
    const result = validateAreaGeometry(geometry, { status: 'proposed', borough: 'Manhattan', boundaries });
    assert.equal(result.valid, false);
    assert(result.errors.length > 0);
  }
  for (const number of [NaN, Infinity, -Infinity]) {
    const ring = areaRing();
    ring[1][0] = number;
    const result = validateAreaGeometry({ type: 'Polygon', coordinates: [ring] }, { status: 'proposed', borough: 'Manhattan', boundaries });
    assert.equal(result.valid, false);
    assert(result.errors.some(error => error.code === 'invalid_polygon_coordinate'));
  }
  for (const missing of [undefined, null, {}, { type: 'FeatureCollection', features: [] }]) {
    const result = validateAreaGeometry({ type: 'Polygon', coordinates: [areaRing()] }, { status: 'proposed', borough: 'Manhattan', boundaries: missing });
    assert.equal(result.valid, false);
    assert(result.errors.some(error => error.code === 'boundary_unavailable'));
  }
});

test('full-footprint containment rejects a complete excluded boundary hole inside the proposal', () => {
  const holedBoundary = {
    type: 'FeatureCollection', features: [{ type: 'Feature', properties: { boroname: 'Manhattan' }, geometry: { type: 'Polygon', coordinates: [
      [[-73.950, 40.819], [-73.947, 40.819], [-73.947, 40.822], [-73.950, 40.822], [-73.950, 40.819]],
      [[-73.94875, 40.82025], [-73.94825, 40.82025], [-73.94825, 40.82075], [-73.94875, 40.82075], [-73.94875, 40.82025]],
    ] } }],
  };
  const result = validateAreaGeometry({ type: 'Polygon', coordinates: [areaRing()] }, { status: 'proposed', borough: 'Manhattan', boundaries: holedBoundary });
  assert.equal(result.valid, false);
  assert(result.errors.some(error => error.code === 'area_outside_nyc'));
});

test('an area may span the verified city union without falsely claiming one borough', () => {
  const region = (name, west, east) => ({ type: 'Feature', properties: { boroname: name }, geometry: { type: 'Polygon', coordinates: [[[west, 40.819], [east, 40.819], [east, 40.822], [west, 40.822], [west, 40.819]]] } });
  const joinedBoundary = { type: 'FeatureCollection', features: [region('Manhattan', -73.950, -73.9485), region('Queens', -73.9485, -73.947)] };
  const geometry = { type: 'Polygon', coordinates: [areaRing()] };
  const unknown = validateAreaGeometry(geometry, { status: 'proposed', borough: 'unknown', boundaries: joinedBoundary });
  assert.equal(unknown.valid, true, JSON.stringify(unknown.errors));
  assert.deepEqual(unknown.geometry, geometry);
  const named = validateAreaGeometry(geometry, { status: 'proposed', borough: 'Manhattan', boundaries: joinedBoundary });
  assert.equal(named.valid, false);
  assert(named.errors.some(error => error.code === 'area_borough_mismatch'));
});

test('area proposals preserve source distinctions and reject missing citations, unsafe links and unsupported media rights', async () => {
  for (const sources of [[], [null], [{ ...evidenceSource(), citation: '' }], [{ ...evidenceSource(), url: 'https://user:password@example.org/x' }], [{ ...evidenceSource(), public_use: 'media', rights_status: 'unknown' }]]) {
    const input = areaEnvelope();
    input.sources = sources;
    await invalidPreview(input);
  }
  for (const dates of [{ ...unknownDates(), time_start_year: 1890 }, { ...unknownDates(), time_precision: 'range', time_start_year: 1890, time_end_year: null }]) {
    await invalidPreview(areaEnvelope({ dates }));
  }
});

async function target(h, id) {
  const result = await call(h, 'target?id=' + encodeURIComponent(id));
  assertStatus(result, 200);
  return result.body.target;
}

test('target resolver returns the actual static record, stable hash and immutable version without creating hosted records', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const original = JSON.stringify(h.staticRecords);
  const resolved = await target(h, actualStaticRecord.id);
  assert.equal(resolved.record_id, actualStaticRecord.id);
  assert.equal(resolved.origin, 'static_inventory');
  assert.equal(resolved.expected_version, 1);
  assert.match(resolved.expected_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(resolved.record, actualStaticRecord);
  assert.deepEqual(await target(h, actualStaticRecord.id), resolved);
  assert.equal(JSON.stringify(h.staticRecords), original);
  assert.equal(count(h, 'approved_records'), 0);
  assert.equal(count(h, 'workflow_targets'), 0);
  assertStatus(await call(h, 'target?id=unknown-fixture-id'), 404);
  assertStatus(await call(h, 'target?id=' + encodeURIComponent(actualStaticRecord.id), undefined, { actor: null }), 401);
});

test('target resolver binds hosted records to current version and hash while retaining original raw and derived evidence', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const hosted = await seedHosted(h);
  const resolved = await target(h, hosted.id);
  const record = await h.store.getRecord(hosted.id);
  assert.equal(resolved.record_id, hosted.id);
  assert.equal(resolved.expected_version, record.version);
  assert.equal(resolved.expected_hash, record.hash);
  assert.notEqual(resolved.origin, 'static_inventory');
  assert.equal(resolved.record.raw_json, hosted.raw_json);
  assert.deepEqual(resolved.record.raw, JSON.parse(hosted.raw_json));
  assert.deepEqual(resolved.record.derived, JSON.parse(hosted.derived_json));
  const serialized = JSON.stringify(resolved);
  assert(!serialized.includes('"owner_id"'));
  assert.equal((await h.store.getRecord(hosted.id)).raw_json, hosted.raw_json);
  assert.equal((await h.store.getRecord(hosted.id)).derived_json, hosted.derived_json);
});

test('annotation submission binds an actual static target and preserves originals through revision and idempotent replay', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const resolved = await target(h, actualStaticRecord.id);
  const staticBefore = JSON.stringify(h.staticRecords);
  const input = annotationEnvelope(resolved);
  input.payload.text = '  Original annotation wording.\n' + 'Uncertainty is retained. '.repeat(80);
  const created = await submit(h, input);
  assert.equal(created.submission.validation.valid, true, JSON.stringify(created.submission.validation));
  assert.equal(created.submission.application.applicable, false);
  assert.deepEqual(created.submission.targets, input.targets);
  assert.equal(created.submission.raw_json, created.request.submission_json);
  assert.deepEqual(created.submission.proposal.target.record, actualStaticRecord);
  const repeated = await call(h, 'submit', created.request);
  assertStatus(repeated, 200);
  assert.equal(repeated.body.reused, true);
  assert.equal(repeated.body.receipt.id, created.receipt.id);
  assert.equal(repeated.body.submission.id, created.submission.id);
  assert.equal(count(h, 'workflow_submissions'), 1);
  assert.equal(count(h, 'workflow_revisions'), 1);
  const changed = await call(h, 'submit', { ...created.request, submission_json: JSON.stringify(annotationEnvelope(resolved, { text: 'A different proposal.' })) });
  assertStatus(changed, 409);
  assert.equal(changed.body.error, 'idempotency_conflict');
  const revisedPayload = annotationEnvelope(resolved, { text: 'A corrected annotation is a new immutable revision.' });
  const revisedJson = JSON.stringify(revisedPayload, null, 2);
  const revised = await call(h, 'revise', { idempotency_key: key(h, 'revise'), submission_id: created.submission.id, expected_revision: 1, submission_json: revisedJson });
  assertStatus(revised, 200);
  assert.equal(revised.body.submission.revision, 2);
  assert.equal(revised.body.submission.revisions[0].raw_json, created.request.submission_json);
  assert.equal(revised.body.submission.revisions[1].raw_json, revisedJson);
  assert.equal(JSON.stringify(h.staticRecords), staticBefore);
  assert.equal(count(h, 'approved_records'), 0);
});

test('area submissions retain the exact polygon and raw input without publishing a map record', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const input = areaEnvelope();
  const created = await submit(h, input);
  assert.equal(created.submission.validation.valid, true);
  assert.equal(created.submission.application.applicable, false);
  assert.equal(created.submission.raw_json, created.request.submission_json);
  const stored = await h.store.getRevision(created.submission.id, 1);
  assert.equal(stored.raw_json, created.request.submission_json);
  assert.deepEqual(JSON.parse(stored.raw_json).payload.geometry, input.payload.geometry);
  const repeated = await call(h, 'submit', created.request);
  assertStatus(repeated, 200);
  assert.equal(repeated.body.receipt.id, created.receipt.id);
  assert.equal(count(h, 'approved_records'), 0);
  assert.equal(count(h, 'workflow_jobs'), 0);
});

test('new embedded proposal types preserve default owner-only and independent-review restrictions', async t => {
  const h = harness({ authorization: false });
  t.after(() => h.db.close());
  const resolved = await target(h, actualStaticRecord.id);
  for (const input of [areaEnvelope(), annotationEnvelope(resolved)]) {
    const body = { idempotency_key: key(h, 'submit'), submission_json: JSON.stringify(input) };
    assertStatus(await call(h, 'submit', body, { actor: null }), 401);
    assertStatus(await call(h, 'submit', body, { origin: 'https://untrusted.example' }), 403);
    const created = await submit(h, input);
    const self = await call(h, 'review', reviewBody(h, created.submission));
    assertStatus(self, 403);
    assert.equal(self.body.error, 'self_approval_forbidden');
    const other = await call(h, 'review', reviewBody(h, created.submission), { actor: 'reviewer' });
    assertStatus(other, 403);
    assert.equal(other.body.error, 'independent_reviewer_unavailable');
    const forged = await call(h, 'review', { ...reviewBody(h, created.submission), reviewer_id: 'reviewer' });
    assertStatus(forged, 400);
  }
  assert.equal(count(h, 'workflow_approvals'), 0);
  assert.equal(count(h, 'workflow_jobs'), 0);
  assert.equal(count(h, 'approved_records'), 0);
});

test('independently reviewed area and annotation proposals cannot activate records or alter static evidence', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const resolved = await target(h, actualStaticRecord.id);
  const staticBefore = JSON.stringify(h.staticRecords);
  for (const input of [areaEnvelope(), annotationEnvelope(resolved)]) {
    const created = await submit(h, input);
    const missingPrivacy = allChecks();
    delete missingPrivacy.privacy_check;
    assertStatus(await call(h, 'review', reviewBody(h, created.submission, { checks: missingPrivacy }), { actor: 'reviewer' }), 400);
    const approved = await call(h, 'review', reviewBody(h, created.submission), { actor: 'reviewer' });
    assertStatus(approved, 200);
    assert.equal(approved.body.submission.status, 'approved');
    const application = await call(h, 'apply', { idempotency_key: key(h, 'apply'), submission_id: created.submission.id, expected_revision: 1, approval_hash: approved.body.submission.approval.approval_hash }, { actor: 'publisher' });
    assertStatus(application, 409);
    assert.equal(count(h, 'workflow_jobs'), 0);
  }
  assert.equal(JSON.stringify(h.staticRecords), staticBefore);
  assert.equal(count(h, 'approved_records'), 0);
});

test('annotation targets must exist and match their exact snapshot version and hash', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const resolved = await target(h, actualStaticRecord.id);
  for (const targetChange of [{ record_id: 'missing-record' }, { expected_version: 0 }, { expected_hash: '0'.repeat(64) }]) {
    const input = annotationEnvelope(resolved);
    Object.assign(input.targets[0], targetChange);
    const result = await call(h, 'preview', { submission_json: JSON.stringify(input) });
    assertStatus(result, 200);
    assert.equal(result.body.preview.validation.valid, false, JSON.stringify(result.body));
    assert.equal(result.body.preview.application.applicable, false);
  }
  const noTarget = annotationEnvelope(resolved);
  noTarget.targets = [];
  const missing = await call(h, 'preview', { submission_json: JSON.stringify(noTarget) });
  assertStatus(missing, 200);
  assert.equal(missing.body.preview.validation.valid, false);
});

test('a changed hosted target prevents approval of an old annotation and leaves the latest original intact', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const hosted = await seedHosted(h);
  const resolved = await target(h, hosted.id);
  const created = await submit(h, annotationEnvelope(resolved));
  assert.equal(created.submission.validation.valid, true);
  const changedRaw = JSON.stringify({ ...JSON.parse(hosted.raw_json), description: 'A later authoritative original update must not be overwritten.' });
  h.db.native.prepare('UPDATE approved_records SET raw_json=?,raw_hash=? WHERE id=?').run(changedRaw, await hash(changedRaw), hosted.id);
  const changedTarget = await target(h, hosted.id);
  assert.notEqual(changedTarget.expected_hash, resolved.expected_hash);
  const stale = await call(h, 'review', reviewBody(h, created.submission), { actor: 'reviewer' });
  assertStatus(stale, 409);
  assert.equal((await h.store.getRecord(hosted.id)).raw_json, changedRaw);
  assert.equal((await h.store.getRevision(created.submission.id, 1)).raw_json, created.request.submission_json);
  assert.equal(count(h, 'workflow_approvals'), 0);
  assert.equal(count(h, 'workflow_jobs'), 0);
});

test('the advertised 100 distinct polygon vertices plus closure pass preview and persist byte-for-byte', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const ring = Array.from({ length: 100 }, (_, index) => {
    const angle = index * Math.PI * 2 / 100;
    return [-73.9485 + Math.cos(angle) * 0.0002, 40.8205 + Math.sin(angle) * 0.0002];
  });
  ring.push([...ring[0]]);
  assert.equal(ring.length, 101);
  const input = areaEnvelope({ geometry: { type: 'Polygon', coordinates: [ring] } });
  const validated = await preview(input);
  assert.equal(validated.validation.valid, true, JSON.stringify(validated.validation));
  assert.deepEqual(validated.proposal.geometry, input.payload.geometry);
  const created = await submit(h, input);
  assert.equal(created.submission.validation.valid, true, JSON.stringify(created.submission.validation));
  assert(created.receipt.id);
  assert.equal(created.submission.raw_json, created.request.submission_json);
  assert.deepEqual(created.submission.proposal.geometry.coordinates[0], ring);
  const stored = await h.store.getRevision(created.submission.id, 1);
  assert.equal(stored.raw_json, created.request.submission_json);
  assert.equal(JSON.parse(stored.raw_json).payload.geometry.coordinates[0].length, 101);
  assert.equal(count(h, 'approved_records'), 0);
  const oversizedOtherArray = areaEnvelope();
  oversizedOtherArray.sources = Array.from({ length: 101 }, evidenceSource);
  await assert.rejects(preview(oversizedOtherArray), error => error.code === 'too_many_rows');
});

test('located points also fail closed when NYC boundary data is unavailable', async () => {
  const record = {
    entry_id: 'POINT-FIXTURE', group_id: 'POINT', contributor: 'Uncredited contributor', category: 'reported_haunting',
    title: 'Synthetic point regression', claim_text: 'The cited fixture attributes a story without proving a supernatural event.',
    place_original: 'Synthetic original location', place_normalized: 'Synthetic point', borough: 'Manhattan',
    ...unknownDates(), geo_status: 'located', geo_method: 'historic_map', geo_basis: 'A synthetic source supports this point.',
    latitude: 40.8205, longitude: -73.9485, geo_source_ref: 'POINT-geography', uncertainty_m: null,
    record_license: 'CC0-1.0', rights_notes: 'Synthetic authored text with citation-only source uses.',
  };
  const source = role => ({ ...evidenceSource(), source_ref: 'POINT-' + role, entry_id: record.entry_id, role, repository: 'Synthetic fixture', source_date_original: 'unknown', evidence_note: 'Supports this bounded synthetic source use.' });
  const report = source('report'), geography = source('geography');
  delete report.source_type;
  delete geography.source_type;
  const input = envelope('entry_bundle', { Entries: [record], Sources: [report, geography], SearchLog: [] });
  const available = await preview(input);
  assert.equal(available.validation.valid, true, JSON.stringify(available.validation));
  for (const invalid of [undefined, null, {}, { type: 'FeatureCollection', features: [] }]) {
    const result = await buildPreview(JSON.stringify(input), { geography: { boundaries: invalid } });
    assert.equal(result.validation.valid, false);
    assert.equal(result.application.applicable, false);
    assert(result.validation.errors.some(error => error.code === 'boundary_unavailable'));
  }
});

test('the actual checked-in inventory and pilot parse as data with all original records preserved', () => {
  const pilotText = readFileSync(new URL('../public/pilot.js', import.meta.url), 'utf8');
  const pilot = JSON.parse(pilotText.replace(/^window\.HAUNT_PILOT\s*=\s*/, '').replace(/;\s*$/, ''));
  const records = parseStaticRecords(inventoryText, pilotText);
  assert.equal(records.length, inventory.records.length + 1);
  assert.equal(records.length, 209);
  assert.deepEqual(records[0], { ...pilot, category: 'pilot', borough: 'Manhattan' });
  assert.deepEqual(records.slice(1), inventory.records);
  assert.equal(new Set(records.map(record => record.id)).size, records.length);
  assert.throws(() => parseStaticRecords(inventoryText, pilotText + '\nglobalThis.embeddedStaticCodeRan=true;'));
  assert.equal(globalThis.embeddedStaticCodeRan, undefined);
  assert.throws(() => parseStaticRecords(inventoryText, 'window.HAUNT_PILOT=' + JSON.stringify({ id: actualStaticRecord.id }) + ';'), /invalid_static_record_id/);
});

test('a rebuilt static asset invalidates an old annotation review while keeping its immutable source snapshot', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const originalTarget = await target(h, actualStaticRecord.id);
  const created = await submit(h, annotationEnvelope(originalTarget));
  const changedRecord = { ...structuredClone(actualStaticRecord), evidence_summary: actualStaticRecord.evidence_summary + ' Synthetic catalog update.' };
  h.service = createWorkflowService({ store: h.store, staticRecords: [changedRecord], taskSeeds: { tasks: [] }, geography: { boundaries }, now, authorization: { reviewers: ['reviewer'], publishers: ['publisher'] } });
  const newTarget = await target(h, actualStaticRecord.id);
  assert.equal(newTarget.expected_version, originalTarget.expected_version);
  assert.notEqual(newTarget.expected_hash, originalTarget.expected_hash);
  const review = await call(h, 'review', reviewBody(h, created.submission), { actor: 'reviewer' });
  assertStatus(review, 409);
  assert.equal(count(h, 'workflow_approvals'), 0);
  const immutableRevision = await h.store.getRevision(created.submission.id, 1);
  assert.equal(immutableRevision.raw_json, created.request.submission_json);
  assert.deepEqual(JSON.parse(immutableRevision.preview_json).proposal.target.record, actualStaticRecord);
  assert.deepEqual((await target(h, actualStaticRecord.id)).record, changedRecord);
  assert.equal(count(h, 'approved_records'), 0);
});

test('an ID collision between static and hosted records fails closed instead of selecting an arbitrary target', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const hosted = await seedHosted(h);
  h.db.native.prepare('UPDATE approved_records SET id=? WHERE id=?').run(actualStaticRecord.id, hosted.id);
  const result = await call(h, 'target?id=' + encodeURIComponent(actualStaticRecord.id));
  assertStatus(result, 409);
  assert.equal(result.body.error, 'ambiguous_target_id');
  assert.equal(count(h, 'workflow_submissions'), 0);
  assert.equal(count(h, 'approved_records'), 1);
});
