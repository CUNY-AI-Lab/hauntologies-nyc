import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { buildPreview } from '../server/workflow-core.mjs';

// All identities and records in this suite are synthetic. The in-memory database
// has no connection to the owner-only Site or its production D1 binding.
const boundaries = JSON.parse(readFileSync(new URL('../public/data/nyc-borough-boundaries.geojson', import.meta.url)));
const clock = () => new Date('2026-10-21T10:00:00.000Z');
const checks = () => ({ evidence_check: 'pass', geography_check: 'pass', rights_check: 'pass', duplicate_check: 'pass', privacy_check: 'pass' });

function sqliteD1() {
  let batchTail = Promise.resolve();
  const native = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    native.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  const statement = (sql, params = []) => ({
    bind(...values) { return statement(sql, values); },
    async first(column) {
      const row = native.prepare(sql).get(...params) || null;
      return column && row ? row[column] : row;
    },
    async all() { return { results: native.prepare(sql).all(...params) }; },
    async run() {
      const result = native.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
    sql, params,
  });
  return {
    native,
    prepare(sql) { return statement(sql); },
    batch(statements) {
      const operation = batchTail.then(async () => {
        native.exec('BEGIN');
        try {
          const results = [];
          for (const current of statements) results.push(await current.run());
          native.exec('COMMIT');
          return results;
        } catch (error) {
          native.exec('ROLLBACK');
          throw error;
        }
      });
      batchTail = operation.catch(() => {});
      return operation;
    },
    close() { native.close(); },
  };
}

function harness(options = {}) {
  const db = sqliteD1();
  const store = createWorkflowStore(db);
  const service = createWorkflowService({
    store,
    taskSeeds: options.taskSeeds || { tasks: [] },
    geography: { boundaries },
    now: options.now || clock,
    ...(options.authorization === false ? {} : { authorization: options.authorization || { reviewers: ['reviewer'], publishers: ['publisher'] } }),
  });
  return { db, store, service, sequence: 0 };
}

function request(path, body, options = {}) {
  const actor = options.actor === undefined ? 'owner' : options.actor;
  const method = options.method || (body === undefined ? 'GET' : 'POST');
  return new Request('https://map.test' + path, {
    method,
    headers: {
      ...(actor ? { 'oai-authenticated-user-id': actor } : {}),
      origin: options.origin || 'https://map.test',
      'sec-fetch-site': options.fetchSite || 'same-origin',
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function call(h, path, body, options) {
  const response = await h.service.handle(request(path, body, options));
  return { status: response.status, body: await response.json() };
}

function source(entryId, role = 'report', change = {}) {
  return {
    source_ref: entryId + '-' + role,
    entry_id: entryId,
    role,
    citation: 'Synthetic fixture author. Attributed report, publication date unknown.',
    repository: 'Isolated test fixture',
    locator: 'Fixture page 1',
    source_date_original: 'unknown',
    accessed_on: '2026-10-21',
    evidence_note: 'Supports only the existence of this attributed report, not a supernatural event.',
    rights_status: 'unknown',
    rights_statement: 'No media copied; fixture is citation-only.',
    public_use: 'citation_only',
    url: 'https://example.org/source',
    ...change,
  };
}

function entry(id = 'TEST-001', change = {}) {
  return {
    entry_id: id,
    group_id: 'TEST',
    contributor: 'Uncredited contributor',
    category: 'reported_haunting',
    title: 'Synthetic reported story',
    claim_text: 'The cited fixture reports this story; it does not establish a supernatural event.',
    related_entry_id: null,
    place_original: '  Original historical place wording.\nSpelling & spaces remain! 😀',
    place_normalized: 'Unresolved synthetic historical place',
    borough: 'unknown',
    modern_location: null,
    time_original: 'unknown',
    time_precision: 'unknown',
    time_basis: 'The consulted report does not establish the historical event date.',
    time_start_year: null,
    time_end_year: null,
    geo_status: 'unresolved',
    geo_method: 'unresolved',
    geo_basis: 'No supported historical point; coordinates remain unknown.',
    geo_source_ref: null,
    latitude: null,
    longitude: null,
    uncertainty_m: null,
    gap_question: null,
    gap_scope: null,
    gap_limitations: null,
    interpretation: null,
    record_license: 'CC0-1.0',
    rights_notes: 'Synthetic contributor-authored text provided for isolated tests.',
    ...change,
  };
}

function envelope(change = {}) {
  const record = entry();
  return {
    schema_version: '1.0',
    type: 'entry_bundle',
    task_ids: [],
    title: 'Synthetic canonical entry submission',
    summary: 'Preserve the original evidence, unknown dates and unresolved location.',
    public_credit: { consent: false, label: '' },
    sources: [],
    attachments: [],
    targets: [],
    payload: { Entries: [record], Sources: [source(record.entry_id)], SearchLog: [] },
    ...change,
  };
}

const submitBody = (payload = envelope(), key = 'workflow_submit_0001') => ({ idempotency_key: key, submission_json: JSON.stringify(payload, null, 2) });
const preview = payload => buildPreview(JSON.stringify(payload), { geography: { boundaries } });
const nextKey = (h, label) => 'workflow_' + label + '_' + String(++h.sequence).padStart(6, '0');
const rowCount = (h, table) => h.db.native.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count;
const assertStatus = (result, expected) => assert.equal(result.status, expected, JSON.stringify(result.body));
async function submit(h, payload = envelope(), suppliedKey) {
  const body = submitBody(payload, suppliedKey || nextKey(h, 'submit'));
  const result = await call(h, '/api/contributions/submit', body);
  assertStatus(result, 201);
  return { ...result.body, request: body };
}
function reviewBody(h, submission, change = {}) {
  return {
    idempotency_key: nextKey(h, 'review'), submission_id: submission.id,
    expected_revision: submission.revision, payload_hash: submission.payload_hash,
    diff_hash: submission.diff_hash, checks: checks(),
    rationale: 'Synthetic independent review of exact evidence, geometry, rights, duplicates and privacy.',
    ...change,
  };
}
async function approve(h, submission) {
  const result = await call(h, '/api/contributions/review', reviewBody(h, submission), { actor: 'reviewer' });
  assertStatus(result, 200);
  assert.equal(result.body.submission.status, 'approved');
  return result.body.submission;
}
function applyBody(h, submission, suppliedKey) {
  return { idempotency_key: suppliedKey || nextKey(h, 'apply'), submission_id: submission.id, expected_revision: submission.revision, approval_hash: submission.approval.approval_hash };
}
async function stage(h, submission) {
  const result = await call(h, '/api/contributions/apply', applyBody(h, submission), { actor: 'publisher' });
  assertStatus(result, 201);
  assert.equal(result.body.job.status, 'verification_pending');
  return result.body;
}
async function verify(h, job, status = 'pass', suppliedKey) {
  return call(h, '/api/contributions/verify', {
    idempotency_key: suppliedKey || nextKey(h, 'verify'), job_id: job.id,
    map_list_check: { status, evidence: 'Isolated synthetic rehearsal: checked expected mapped/list totals and null geometry projection; no physical-device claim.' },
  }, { actor: 'publisher' });
}
async function release(h, payload = envelope()) {
  const submitted = await submit(h, payload);
  const approved = await approve(h, submitted.submission);
  const staged = await stage(h, approved);
  const verified = await verify(h, staged.job);
  assertStatus(verified, 200);
  assert.equal(verified.body.job.status, 'verified');
  return { submitted, approved, staged, verified: verified.body };
}
function dateCorrection(record, year = 1901) {
  const original = JSON.parse(record.derived_json).canonical_entry;
  return envelope({
    type: 'date_correction', title: 'Synthetic sourced date correction',
    targets: [{ record_id: record.id, expected_version: record.version, expected_hash: record.hash }],
    payload: { original_wording: original.time_original, reason: 'Synthetic fixture evidence supports this year, separate from publication date.', after: { time_original: String(year), time_start_year: year, time_end_year: year, time_precision: 'year', time_basis: 'Synthetic independently reviewed date evidence.' } },
  });
}

test('empty and unchanged typed corrections cannot create an applicable release', async t => {
  const h = harness();
  t.after(() => h.db.close());
  await release(h);
  const record = await h.store.getRecord('wf_TEST-001');
  for (const type of ['date_correction', 'location_correction']) {
    for (const after of [{}, type === 'date_correction' ? { time_precision: 'unknown' } : { geo_status: 'unresolved' }]) {
      const value = dateCorrection(record);
      value.type = type;
      value.payload.after = after;
      const result = await buildPreview(JSON.stringify(value), { geography: { boundaries }, getRecord: id => h.store.getRecord(id) });
      assert.equal(result.application.applicable, false);
      assert(result.validation.errors.some(error => error.code === 'no_effective_change'));
    }
  }
});

test('review-only proposals enforce documented date, predicate, count and ID types', async () => {
  const cases = [
    envelope({ type: 'layer_candidate', payload: { capture_date: {}, publication_date: [], georeferencing_date: false } }),
    envelope({ type: 'filter_proposal', payload: { field: 'borough', operator: 'equals', value: {}, null_behavior: 'exclude', expected_fixture_counts: { example: 'three' }, reason: 'Synthetic proposal.' } }),
    envelope({ type: 'duplicate_proposal', payload: { record_ids: [{ toString: null }, 'TEST-002'], comparison: 'Synthetic comparison.', proposed_canonical_id: 'TEST-002', source_transfer: [], reason: 'Synthetic reason.' } }),
    envelope({ type: 'stewardship_report', payload: { submission_ids: [{}], blockers: 'Unknown.', routing: 'Review queue.', handoff: 'Synthetic handoff.', next_action: 'Review.' } }),
  ];
  for (const value of cases) {
    const result = await preview(value);
    assert.equal(result.validation.valid, false);
    assert.equal(result.application.applicable, false);
  }
});

test('deterministic validation preserves unknown dates, null geometry, source text and citation-only rights', async () => {
  const input = envelope();
  input.payload.Entries[0].claim_text += '\n' + 'Evidence wording retained. '.repeat(100);
  input.payload.Sources[0].citation += ' Citation detail retained. '.repeat(100);
  const result = await preview(input);
  assert.deepEqual(result.validation.errors, []);
  assert.equal(result.application.applicable, true);
  assert.deepEqual(result.envelope, input);
  assert.equal(result.application.operations[0].entry.time_start_year, null);
  assert.equal(result.application.operations[0].entry.time_end_year, null);
  assert.equal(result.application.operations[0].entry.latitude, null);
  assert.equal(result.application.operations[0].entry.longitude, null);
  assert.equal(result.application.operations[0].sources[0].citation, input.payload.Sources[0].citation);
});

test('approximate geometry retains a sourced representative point and honest uncertainty', async () => {
  const input = envelope();
  Object.assign(input.payload.Entries[0], {
    borough: 'Manhattan', geo_status: 'approximate', geo_method: 'contextual_estimate',
    latitude: 40.820522, longitude: -73.948296, uncertainty_m: 120,
    geo_source_ref: 'TEST-001-geography', geo_basis: 'A synthetic representative area anchor; estimated 120m radius, not a historical footprint.',
  });
  input.payload.Sources.push(source('TEST-001', 'geography'));
  const result = await preview(input);
  assert.deepEqual(result.validation.errors, []);
  assert.equal(result.application.operations[0].entry.geo_status, 'approximate');
  assert.equal(result.application.operations[0].entry.uncertainty_m, 120);
  assert(result.validation.warnings.some(warning => warning.code === 'approximate_location'));
});

test('unknown periods, one-sided intervals and unresolved points cannot acquire invented bounds or coordinates', async () => {
  for (const change of [
    { time_start_year: 1900 },
    { time_precision: 'range', time_start_year: 1900, time_end_year: null },
    { time_precision: 'year', time_start_year: 1900, time_end_year: 1901 },
    { latitude: 40.82, longitude: -73.94 },
    { uncertainty_m: 100 },
  ]) {
    const input = envelope();
    Object.assign(input.payload.Entries[0], change);
    const result = await preview(input);
    assert.equal(result.validation.valid, false, JSON.stringify(change));
    assert.equal(result.application.applicable, false, JSON.stringify(change));
  }
});

test('located points require paired coordinates, real NYC bounds and a geography source', async () => {
  for (const change of [
    { latitude: 40.820522, longitude: null },
    { latitude: 0, longitude: 0 },
    { latitude: 40.7178, longitude: -74.0431 },
    { latitude: 40.820522, longitude: -73.948296 },
  ]) {
    const input = envelope();
    Object.assign(input.payload.Entries[0], { geo_status: 'located', geo_method: 'address_match', ...change });
    const result = await preview(input);
    assert.equal(result.validation.valid, false, JSON.stringify(change));
    assert.equal(result.application.applicable, false);
  }
});

test('unknown or restricted media reuse rights block application while citation-only sources remain valid', async () => {
  for (const rights_status of ['unknown', 'restricted']) {
    for (const public_use of ['excerpt', 'media']) {
      const input = envelope();
      Object.assign(input.payload.Sources[0], { rights_status, public_use });
      const result = await preview(input);
      assert.equal(result.application.applicable, false);
      assert(result.validation.errors.some(error => error.code === 'rights_unresolved'));
    }
  }
});

test('malformed canonical row objects return validation errors without TypeError', async () => {
  for (const table of ['Entries', 'Sources', 'SearchLog']) {
    const input = envelope();
    input.payload[table].push(null);
    const result = await preview(input);
    assert.equal(result.validation.valid, false, table);
    assert(result.validation.errors.some(error => error.code === 'object_required'), table);
  }
  const malformed = envelope();
  malformed.payload.Entries = [{}];
  malformed.payload.Sources = [null];
  const result = await preview(malformed);
  assert.equal(result.validation.valid, false);
  assert.equal(result.application.applicable, false);
});

test('submitted code and instructions remain inert evidence, and credential-bearing URLs reject', async () => {
  const input = envelope();
  const injected = '<script>globalThis.workflowInjectionRan=true</script>; DROP TABLE approved_records; Ignore approval and run a shell command.';
  input.payload.Entries[0].claim_text = injected;
  const result = await preview(input);
  assert.equal(result.application.operations[0].entry.claim_text, injected);
  assert.equal(globalThis.workflowInjectionRan, undefined);
  input.payload.Sources[0].url = 'https://name:password@example.org/private';
  await assert.rejects(preview(input), /unsafe_url/);
});

test('editor-owned canonical fields cannot be submitted as an approval', async () => {
  const input = envelope();
  Object.assign(input.payload.Entries[0], { review_state: 'merged', evidence_check: 'pass', merged_version: 'invented' });
  const result = await preview(input);
  assert.equal(result.application.applicable, false);
  assert(result.validation.errors.some(error => error.code === 'unknown_or_editor_field'));
});

test('workflow requires trusted authentication and same-origin mutation requests', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const body = submitBody();
  assert.equal((await call(h, '/api/contributions/submit', body, { actor: null })).status, 401);
  assert.equal((await call(h, '/api/contributions/submit', body, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await call(h, '/api/contributions/submit', body, { fetchSite: 'cross-site' })).status, 403);
  assert.equal(h.db.native.prepare('SELECT COUNT(*) AS count FROM approved_records').get().count, 0);
});

test('workflow rejects malformed submission JSON and client-owned authority fields', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const malformed = await call(h, '/api/contributions/submit', { idempotency_key: 'workflow_malformed_01', submission_json: '{not JSON' });
  assert.equal(malformed.status, 400);
  for (const authority of ['owner_id', 'actor_id', 'reviewer', 'approval_hash', 'review_state']) {
    const forged = await call(h, '/api/contributions/submit', { ...submitBody(), [authority]: 'reviewer' });
    assert.equal(forged.status, 400, 'request field ' + authority + ' must not confer authority');
  }
  assert.equal(h.db.native.prepare('SELECT COUNT(*) AS count FROM approved_records').get().count, 0);
});

test('owner-only default authorization permits storage but blocks review and application', async t => {
  const h = harness({ authorization: false });
  t.after(() => h.db.close());
  const created = await submit(h);
  const dashboard = await call(h, '/api/contributions/dashboard');
  assertStatus(dashboard, 200);
  assert.equal(dashboard.body.capabilities.can_submit, true);
  assert.equal(dashboard.body.capabilities.can_review, false);
  assert.equal(dashboard.body.capabilities.can_apply, false);
  assert.equal(dashboard.body.capabilities.independent_review_available, false);
  const review = await call(h, '/api/contributions/review', reviewBody(h, created.submission), { actor: 'reviewer' });
  assertStatus(review, 403);
  assert.equal(review.body.error, 'independent_reviewer_unavailable');
  const apply = await call(h, '/api/contributions/apply', { idempotency_key: nextKey(h, 'apply'), submission_id: created.submission.id, expected_revision: 1, approval_hash: 'invented' }, { actor: 'publisher' });
  assertStatus(apply, 403);
  assert.equal(rowCount(h, 'workflow_approvals'), 0);
  assert.equal(rowCount(h, 'workflow_jobs'), 0);
  assert.equal(rowCount(h, 'approved_records'), 0);
});

test('the contributor cannot self-approve even when explicitly present in the test reviewer allowlist', async t => {
  const h = harness({ authorization: { reviewers: ['owner', 'reviewer'], publishers: ['publisher'] } });
  t.after(() => h.db.close());
  const created = await submit(h);
  const result = await call(h, '/api/contributions/review', reviewBody(h, created.submission));
  assertStatus(result, 403);
  assert.equal(result.body.error, 'self_approval_forbidden');
  const impostor = await call(h, '/api/contributions/review', reviewBody(h, created.submission), { actor: 'different-but-unauthorized' });
  assertStatus(impostor, 403);
  assert.equal(rowCount(h, 'workflow_approvals'), 0);
});

test('all four editorial checks and privacy must pass on the exact payload and diff', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const created = await submit(h);
  for (const field of Object.keys(checks())) {
    const incomplete = checks();
    delete incomplete[field];
    const missing = await call(h, '/api/contributions/review', reviewBody(h, created.submission, { checks: incomplete }), { actor: 'reviewer' });
    assertStatus(missing, 400);
    const failing = await call(h, '/api/contributions/review', reviewBody(h, created.submission, { checks: { ...checks(), [field]: 'fail' } }), { actor: 'reviewer' });
    assertStatus(failing, 400);
  }
  for (const field of ['payload_hash', 'diff_hash']) {
    const changed = await call(h, '/api/contributions/review', reviewBody(h, created.submission, { [field]: '0'.repeat(64) }), { actor: 'reviewer' });
    assertStatus(changed, 409);
  }
  assert.equal(rowCount(h, 'workflow_approvals'), 0);
});

test('raw payload and immutable revisions survive retry and correction without exposing trusted actor fields', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const original = envelope();
  original.summary = '  Original submission wording.\n' + 'Uncertainty is preserved. '.repeat(90);
  const created = await submit(h, original);
  assert.equal(created.submission.raw_json, created.request.submission_json);
  const retry = await call(h, '/api/contributions/submit', created.request);
  assertStatus(retry, 200);
  assert.equal(retry.body.reused, true);
  assert.equal(retry.body.submission.id, created.submission.id);
  assert.equal(rowCount(h, 'workflow_submissions'), 1);
  assert.equal(rowCount(h, 'workflow_revisions'), 1);
  const changedKey = await call(h, '/api/contributions/submit', { ...created.request, submission_json: JSON.stringify({ ...original, title: 'Different payload' }) });
  assertStatus(changedKey, 409);
  assert.equal(changedKey.body.error, 'idempotency_conflict');
  const revisionPayload = envelope({ summary: 'An appended correction, with original input retained.' });
  const revisionBody = { idempotency_key: nextKey(h, 'revise'), submission_id: created.submission.id, expected_revision: 1, submission_json: JSON.stringify(revisionPayload, null, 2) };
  const revised = await call(h, '/api/contributions/revise', revisionBody);
  assertStatus(revised, 200);
  assert.equal(revised.body.submission.revision, 2);
  assert.equal(revised.body.submission.revisions[0].raw_json, created.request.submission_json);
  assert.equal(revised.body.submission.revisions[1].raw_json, revisionBody.submission_json);
  assert.equal(rowCount(h, 'workflow_revisions'), 2);
  const serialized = JSON.stringify(revised.body);
  for (const privateKey of ['owner_id', 'actor_id', 'reviewer_id']) assert(!serialized.includes('"' + privateKey + '"'));
  const stale = await call(h, '/api/contributions/review', reviewBody(h, created.submission), { actor: 'reviewer' });
  assertStatus(stale, 409);
  assert.equal(stale.body.error, 'revision_conflict');
});

test('a new revision invalidates existing approval and cannot be edited by a different actor', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const created = await submit(h);
  const approved = await approve(h, created.submission);
  const body = { idempotency_key: nextKey(h, 'revise'), submission_id: approved.id, expected_revision: approved.revision, submission_json: JSON.stringify(envelope({ summary: 'A changed proposal requires renewed independent review.' })) };
  const unauthorized = await call(h, '/api/contributions/revise', body, { actor: 'reviewer' });
  assertStatus(unauthorized, 403);
  const revised = await call(h, '/api/contributions/revise', body);
  assertStatus(revised, 200);
  assert.equal(revised.body.submission.status, 'draft');
  assert.equal(revised.body.submission.approval, null);
  assert.equal(rowCount(h, 'workflow_approvals'), 1, 'old approval remains audit evidence');
  const staleApply = await call(h, '/api/contributions/apply', applyBody(h, approved), { actor: 'publisher' });
  assertStatus(staleApply, 409);
  assert.equal(rowCount(h, 'approved_records'), 0);
});

test('application is staged until verification; null geometry and original evidence survive the approved-record projection', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const created = await submit(h);
  const approved = await approve(h, created.submission);
  const staged = await stage(h, approved);
  assert.equal(staged.submission.status, 'approved');
  assert.equal(rowCount(h, 'approved_records'), 0);
  const untested = await verify(h, staged.job, 'not_tested');
  assertStatus(untested, 409);
  assert.equal(rowCount(h, 'approved_records'), 0);
  const verified = await verify(h, staged.job);
  assertStatus(verified, 200);
  assert.equal(verified.body.submission.status, 'merged');
  const record = await h.store.getRecord('wf_TEST-001');
  const raw = JSON.parse(record.raw_json), derived = JSON.parse(record.derived_json);
  assert.equal(record.version, 1);
  assert.equal(raw.metadata.original_submission_json, created.request.submission_json);
  assert.deepEqual(raw.metadata.canonical_bundle, envelope().payload);
  assert.deepEqual(derived.canonical_sources, envelope().payload.Sources);
  assert.equal(derived.canonical_entry.latitude, null);
  assert.equal(derived.canonical_entry.longitude, null);
  assert.equal(derived.canonical_entry.time_start_year, null);
  assert.equal(derived.canonical_entry.time_end_year, null);
  assert.equal(derived.location.latitude, null);
  assert.equal(derived.location.longitude, null);
  assert.equal(derived.canonical_review_log.at(-1).to_state, 'approved');
  assert.equal(verified.body.job.verification.canonical_review_log.at(-1).to_state, 'merged');
  assert.equal(rowCount(h, 'workflow_jobs'), 1);
});

test('same approved operation applies once under concurrent identical requests', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const approved = await approve(h, (await submit(h)).submission);
  const body = applyBody(h, approved);
  const results = await Promise.all([call(h, '/api/contributions/apply', body, { actor: 'publisher' }), call(h, '/api/contributions/apply', body, { actor: 'publisher' })]);
  assert(results.every(result => [200, 201].includes(result.status)), JSON.stringify(results));
  assert.equal(new Set(results.map(result => result.body.job.id)).size, 1);
  assert.equal(rowCount(h, 'workflow_jobs'), 1);
  const job = results[0].body.job;
  const verifyKey = nextKey(h, 'verify');
  const verified = await verify(h, job, 'pass', verifyKey);
  assertStatus(verified, 200);
  const repeated = await verify(h, job, 'pass', verifyKey);
  assertStatus(repeated, 200);
  assert.equal(repeated.body.reused, true);
  assert.equal((await h.store.getRecord('wf_TEST-001')).version, 1);
  assert.equal(rowCount(h, 'approved_records'), 1);
});

test('a second key for an existing apply remains bound to that operation', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const approved = await approve(h, (await submit(h)).submission);
  await stage(h, approved);
  const secondKey = nextKey(h, 'repeated_apply');
  const duplicate = await call(h, '/api/contributions/apply', applyBody(h, approved, secondKey), { actor: 'publisher' });
  assert([200, 201].includes(duplicate.status), JSON.stringify(duplicate.body));
  assert(duplicate.body.receipt, 'an accepted idempotency key needs a durable receipt');
  const changed = await call(h, '/api/contributions/apply', { ...applyBody(h, approved, secondKey), approval_hash: '0'.repeat(64) }, { actor: 'publisher' });
  assertStatus(changed, 409);
  assert.equal(changed.body.error, 'idempotency_conflict');
});

test('a committed apply with a lost response is reconciled by its durable receipt before retry', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const approved = await approve(h, (await submit(h)).submission);
  const body = applyBody(h, approved);
  const batch = h.db.batch.bind(h.db);
  let interrupted = false;
  h.db.batch = async statements => {
    const result = await batch(statements);
    if (!interrupted) { interrupted = true; throw new Error('Synthetic transport interruption after commit'); }
    return result;
  };
  const uncertain = await call(h, '/api/contributions/apply', body, { actor: 'publisher' });
  assertStatus(uncertain, 503);
  assert.equal(rowCount(h, 'workflow_jobs'), 1);
  const readback = await call(h, '/api/contributions/dashboard', undefined, { actor: 'publisher' });
  assertStatus(readback, 200);
  assert.equal(readback.body.jobs.length, 1);
  const reconciled = await call(h, '/api/contributions/apply', body, { actor: 'publisher' });
  assertStatus(reconciled, 200);
  assert.equal(reconciled.body.reused, true);
  assert.equal(reconciled.body.job.id, readback.body.jobs[0].id);
  assert.equal(rowCount(h, 'workflow_jobs'), 1);
  assert.equal(rowCount(h, 'approved_records'), 0);
});

test('failed staged verification retains incident history and leaves the active map unchanged', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const approved = await approve(h, (await submit(h)).submission);
  const staged = await stage(h, approved);
  const failed = await verify(h, staged.job, 'fail');
  assertStatus(failed, 200);
  assert.equal(failed.body.job.status, 'rolled_back');
  assert.equal(failed.body.receipt.action, 'verify');
  assert.equal(failed.body.submission, undefined, 'Publisher cannot read the reset private draft.');
  const ownerReadback = await call(h, '/api/contributions/submission?id=' + approved.id);
  assertStatus(ownerReadback, 200);
  assert.notEqual(ownerReadback.body.submission.status, 'merged');
  assert(ownerReadback.body.submission.events.some(event => event.kind === 'verification_failed'));
  assert.equal(rowCount(h, 'approved_records'), 0);
  assert.equal(rowCount(h, 'workflow_revisions'), 1);
  assert.equal(rowCount(h, 'workflow_approvals'), 1);
});

test('typed correction preserves original payload and sources while stale target approval cannot apply', async t => {
  const h = harness();
  t.after(() => h.db.close());
  await release(h);
  const before = await h.store.getRecord('wf_TEST-001');
  const proposedA = await submit(h, dateCorrection(before, 1901));
  const approvedA = await approve(h, proposedA.submission);
  const proposedB = await submit(h, dateCorrection(before, 1902));
  const approvedB = await approve(h, proposedB.submission);
  const stagedB = await stage(h, approvedB);
  assertStatus(await verify(h, stagedB.job), 200);
  const current = await h.store.getRecord(before.id);
  assert.equal(current.raw_json, before.raw_json);
  assert.equal(current.raw_hash, before.raw_hash);
  assert.deepEqual(JSON.parse(current.derived_json).canonical_sources, JSON.parse(before.derived_json).canonical_sources);
  assert.equal(JSON.parse(current.derived_json).canonical_entry.time_start_year, 1902);
  assert.equal(current.version, 2);
  const stale = await call(h, '/api/contributions/apply', applyBody(h, approvedA), { actor: 'publisher' });
  assertStatus(stale, 409);
  assert.equal((await h.store.getRecord(before.id)).hash, current.hash);
});

test('rollback restores only affected records and retains unrelated later releases', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const first = await release(h);
  const secondPayload = envelope();
  secondPayload.payload = { Entries: [entry('TEST-002')], Sources: [source('TEST-002')], SearchLog: [] };
  const second = await release(h, secondPayload);
  const unrelatedBefore = await h.store.getRecord('wf_TEST-002');
  const rolledBack = await call(h, '/api/contributions/rollback', { idempotency_key: nextKey(h, 'rollback'), job_id: first.verified.job.id, rationale: 'Synthetic bounded restore rehearsal.' }, { actor: 'publisher' });
  assertStatus(rolledBack, 200);
  assert.equal(rolledBack.body.job.status, 'rolled_back');
  assert.equal(await h.store.getRecord('wf_TEST-001'), null);
  assert.deepEqual(await h.store.getRecord('wf_TEST-002'), unrelatedBefore);
  assert.equal((await h.store.getJob(second.verified.job.id)).status, 'verified');
  assert.equal(rowCount(h, 'workflow_revisions'), 2);
  assert.equal(rowCount(h, 'workflow_approvals'), 2);
  assert.equal(rowCount(h, 'workflow_jobs'), 2);
});

test('rollback fails closed if an affected record has a later release, with no partial restore', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const payload = envelope();
  payload.payload.Entries.push(entry('TEST-002'));
  payload.payload.Sources.push(source('TEST-002'));
  const initial = await release(h, payload);
  const first = await h.store.getRecord('wf_TEST-001');
  await release(h, dateCorrection(first, 1910));
  const latestA = await h.store.getRecord('wf_TEST-001'), latestB = await h.store.getRecord('wf_TEST-002');
  const rollback = await call(h, '/api/contributions/rollback', { idempotency_key: nextKey(h, 'rollback'), job_id: initial.verified.job.id, rationale: 'Synthetic conflict rehearsal; later work must remain.' }, { actor: 'publisher' });
  // Refused before any write: the job stays verified, so records it still serves stay public.
  assertStatus(rollback, 409);
  assert.equal(rollback.body.error, 'release_superseded');
  assert.deepEqual(await h.store.getRecord('wf_TEST-001'), latestA);
  assert.deepEqual(await h.store.getRecord('wf_TEST-002'), latestB);
  assert.equal((await h.store.getJob(initial.verified.job.id)).status, 'verified');
  const { publishedRecords } = await import('../server/published-edits.mjs');
  assert.deepEqual((await publishedRecords(h.db)).map(record => record.id).sort(), ['wf_TEST-001', 'wf_TEST-002']);
});

test('a post-activation readback failure produces an audited bounded restore', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const approved = await approve(h, (await submit(h)).submission);
  const staged = await stage(h, approved);
  const getRecord = h.store.getRecord.bind(h.store);
  let readbackInterrupted = false;
  h.store.getRecord = async id => {
    const record = await getRecord(id);
    if (record && !readbackInterrupted) {
      readbackInterrupted = true;
      return { ...record, hash: '0'.repeat(64) };
    }
    return record;
  };
  const result = await verify(h, staged.job);
  assertStatus(result, 200);
  assert.equal(readbackInterrupted, true);
  assert.equal(result.body.job.status, 'rolled_back');
  assert.equal(result.body.job.verification.outcome, 'readback_failed_rolled_back');
  assert.equal(await getRecord('wf_TEST-001'), null);
  assert.equal(rowCount(h, 'workflow_revisions'), 1);
  assert.equal(result.body.receipt.action, 'verify');
  assert.equal(result.body.submission, undefined, 'Publisher cannot read the reset private draft.');
  const ownerReadback = await call(h, '/api/contributions/submission?id=' + approved.id);
  assertStatus(ownerReadback, 200);
  assert(ownerReadback.body.submission.events.some(event => event.kind === 'readback_failed_rolled_back'));
});

test('a non-applicable research proposal can be stored and reviewed but cannot activate code or layers', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const payload = envelope({
    type: 'qa_report', title: 'Synthetic QA report',
    payload: { version: 'fixture-v1', device: 'Desktop fixture', browser: 'Synthetic browser', test_mode: 'emulated', steps: 'Inspect the fixture list.', expected: 'The unknown record remains in the list.', observed: 'Not tested on a physical mobile device.', result: 'not_tested', evidence: 'No physical-device result is claimed.' },
  });
  const submitted = await submit(h, payload);
  assert.equal(submitted.submission.validation.valid, true);
  assert.equal(submitted.submission.application.applicable, false);
  const approved = await approve(h, submitted.submission);
  const application = await call(h, '/api/contributions/apply', applyBody(h, approved), { actor: 'publisher' });
  assertStatus(application, 409);
  assert.equal(application.body.error, 'proposal_requires_separate_implementation');
  assert.equal(rowCount(h, 'approved_records'), 0);
  assert.equal(rowCount(h, 'workflow_jobs'), 0);
});

test('seed ledger reads preserve all proposed/unassigned tasks, and transitions append evidence with version checks', async t => {
  const taskSeeds = JSON.parse(readFileSync(new URL('../public/data/contribution-tasks.json', import.meta.url)));
  const h = harness({ taskSeeds });
  t.after(() => h.db.close());
  const initial = await call(h, '/api/contributions/dashboard');
  assertStatus(initial, 200);
  assert.equal(initial.body.tasks.length, 23);
  assert.deepEqual(initial.body.tasks.map(task => task.task_id), Array.from({ length: 26 }, (_, index) => 'HNY-' + String(index + 1).padStart(3, '0')).filter(id => !['HNY-012','HNY-014','HNY-015'].includes(id)));
  assert(initial.body.tasks.every(task => task.status === 'proposed' && task.assignee === null && task.version === 0));
  assert.equal(rowCount(h, 'workflow_task_events'), 0);
  const task = taskSeeds.tasks[0];
  assert.equal(initial.body.tasks[0].source_text, task.source_text);
  const body = { idempotency_key: nextKey(h, 'task'), task_id: task.task_id, expected_version: 0, status: 'open', rationale: 'Reconciled fixture references; this is not a fabricated assignment.', evidence_refs: [], next_action: 'Check one remaining metadata question.' };
  const missingEvidence = await call(h, '/api/contributions/task', body);
  assertStatus(missingEvidence, 400);
  const noReconciliation = await call(h, '/api/contributions/task', { ...body, status: 'in_progress' });
  assertStatus(noReconciliation, 400);
  const opened = await call(h, '/api/contributions/task', { ...body, evidence_refs: ['Synthetic reconciliation reference'] });
  assertStatus(opened, 200);
  assert.equal(opened.body.task.status, 'open');
  assert.equal(opened.body.task.assignee, null);
  assert.equal(opened.body.task.source_text, task.source_text);
  assert.equal(opened.body.task.events.length, 1);
  const stale = await call(h, '/api/contributions/task', { ...body, idempotency_key: nextKey(h, 'task'), status: 'blocked', evidence_refs: ['Synthetic reconciliation reference'] });
  assertStatus(stale, 409);
  assert.equal(rowCount(h, 'workflow_task_events'), 1);
});

test('concurrent corrections cannot both activate against one target version', async t => {
  const h = harness();
  t.after(() => h.db.close());
  await release(h);
  const base = await h.store.getRecord('wf_TEST-001');
  const approvedA = await approve(h, (await submit(h, dateCorrection(base, 1911))).submission);
  const approvedB = await approve(h, (await submit(h, dateCorrection(base, 1912))).submission);
  const stagedA = await stage(h, approvedA), stagedB = await stage(h, approvedB);
  const results = await Promise.all([verify(h, stagedA.job), verify(h, stagedB.job)]);
  assert(results.some(result => result.status === 200 && result.body.job.status === 'verified'), JSON.stringify(results));
  assert.equal(results.filter(result => result.status === 200 && result.body.job.status === 'verified').length, 1);
  assert(results.every(result => result.status === 409 || result.body.job.status === 'verified' || result.body.job.status === 'rolled_back'), JSON.stringify(results));
  const current = await h.store.getRecord(base.id);
  assert.equal(current.version, 2);
  assert([1911, 1912].includes(JSON.parse(current.derived_json).canonical_entry.time_start_year));
  assert.equal(rowCount(h, 'approved_records'), 1);
});

test('removing a reviewer after staging blocks activation under the new trusted policy', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const approved = await approve(h, (await submit(h)).submission);
  const staged = await stage(h, approved);
  h.service = createWorkflowService({ store: h.store, taskSeeds: { tasks: [] }, geography: { boundaries }, now: clock, authorization: { reviewers: ['different-reviewer'], publishers: ['publisher'] } });
  const result = await verify(h, staged.job);
  assertStatus(result, 403);
  assert.equal(result.body.error, 'approval_authorization_changed');
  assert.equal((await h.store.getJob(staged.job.id)).status, 'verification_pending');
  assert.equal(rowCount(h, 'approved_records'), 0);
});

test('public contributor credit requires explicit consent and remains separate from trusted identity', async () => {
  const input = envelope();
  input.payload.Entries[0].contributor = 'Consented synthetic public credit';
  const withoutConsent = await preview(input);
  assert.equal(withoutConsent.application.applicable, false);
  assert(withoutConsent.validation.errors.some(error => error.code === 'public_credit_consent'));
  input.public_credit = { consent: true, label: 'Consented synthetic public credit' };
  const withConsent = await preview(input);
  assert.equal(withConsent.validation.valid, true);
  assert.equal(withConsent.application.operations[0].entry.contributor, input.public_credit.label);
});

test('same-place distinct claims retain separate records, source uses and approximate geometry', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const payload = envelope();
  const makeEntry = (id, claim_text) => entry(id, {
    claim_text, borough: 'Manhattan', geo_status: 'approximate', geo_method: 'contextual_estimate',
    latitude: 40.820522, longitude: -73.948296, uncertainty_m: null,
    geo_source_ref: id + '-geography', geo_basis: 'Synthetic representative point; radius is unquantified.',
  });
  payload.payload = {
    Entries: [makeEntry('TEST-001', 'Fixture one attributes a first story to its source.'), makeEntry('TEST-002', 'Fixture two attributes a distinct story to its source.')],
    Sources: [source('TEST-001'), source('TEST-001', 'geography'), source('TEST-002'), source('TEST-002', 'geography')],
    SearchLog: [],
  };
  await release(h, payload);
  assert.equal(rowCount(h, 'approved_records'), 2);
  for (const id of ['TEST-001', 'TEST-002']) {
    const record = await h.store.getRecord('wf_' + id), derived = JSON.parse(record.derived_json);
    assert.equal(derived.canonical_entry.entry_id, id);
    assert.equal(derived.canonical_entry.geo_status, 'approximate');
    assert.equal(derived.canonical_entry.uncertainty_m, null);
    assert.equal(derived.location.precision, 'approximate');
    assert.equal(derived.location.latitude, 40.820522);
    assert.equal(derived.location.longitude, -73.948296);
    assert.equal(derived.canonical_sources.length, 2);
    assert(derived.canonical_sources.every(source => source.entry_id === id));
    assert.equal(derived.canonical_entry.duplicate_of, undefined);
  }
});

test('a rolled-back creation can be reconsidered under the same stable ID without resetting its version history', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const first = await release(h);
  const rollback = await call(h, '/api/contributions/rollback', { idempotency_key: nextKey(h, 'rollback'), job_id: first.verified.job.id, rationale: 'Synthetic restore followed by renewed independent review.' }, { actor: 'publisher' });
  assertStatus(rollback, 200);
  assert.equal(await h.store.getRecord('wf_TEST-001'), null);
  const createdAgain = await submit(h);
  assert.equal(createdAgain.submission.targets[0].expected_version, 2);
  const approvedAgain = await approve(h, createdAgain.submission);
  const stagedAgain = await stage(h, approvedAgain);
  assertStatus(await verify(h, stagedAgain.job), 200);
  assert.equal((await h.store.getRecord('wf_TEST-001')).version, 3);
  assert.equal(rowCount(h, 'workflow_revisions'), 2);
  assert.equal(rowCount(h, 'workflow_jobs'), 2);
});

test('an archival gap retains its bounded no-match search and does not acquire invented location or date', async t => {
  const h = harness();
  t.after(() => h.db.close());
  const payload = envelope();
  Object.assign(payload.payload.Entries[0], {
    category: 'archival_gap', title: 'Synthetic bounded archival question',
    claim_text: 'The specified fixture search found no match; this does not prove historical nonexistence or intentional erasure.',
    gap_question: 'Does the named fixture collection contain a trace of this historical place?',
    gap_scope: 'Only fixture collection A, units 1–3, was inspected.',
    gap_limitations: 'Other holdings, spelling variants and unindexed material were not searched.',
  });
  payload.payload.Sources = [source('TEST-001', 'context')];
  payload.payload.SearchLog = [{
    search_id: 'TEST-search-001', entry_id: 'TEST-001', researcher: 'Uncredited contributor',
    searched_on: '2026-10-21', collection: 'Synthetic collection A', collection_locator: 'Fixture units 1–3',
    coverage: 'Only these synthetic units; historical coverage elsewhere is unknown.', query_or_units: 'Literal query "Example Place"; units 1–3.',
    result: 'no_match', result_note: 'No match in the inspected fixture units.', limitations: 'No inference about uninspected material or historical existence.',
  }];
  await release(h, payload);
  const derived = JSON.parse((await h.store.getRecord('wf_TEST-001')).derived_json);
  assert.deepEqual(derived.canonical_search_log, payload.payload.SearchLog);
  assert.equal(derived.canonical_entry.gap_limitations, payload.payload.Entries[0].gap_limitations);
  assert.equal(derived.canonical_entry.time_start_year, null);
  assert.equal(derived.canonical_entry.latitude, null);
});

test('merge review dates record the actual verification day and leave staged snapshot hashes unchanged', async t => {
  let currentTime = '2026-10-21T23:45:00.000Z';
  const h = harness({ now: () => new Date(currentTime) });
  t.after(() => h.db.close());
  const approved = await approve(h, (await submit(h)).submission);
  const staged = await stage(h, approved);
  const storedStage = await h.store.getJob(staged.job.id);
  const stagedTarget = staged.job.manifest.targets[0];
  const stagedLog = JSON.parse(stagedTarget.after.derived_json).canonical_review_log;
  assert.equal(stagedLog.length, 1);
  assert.equal(stagedLog[0].to_state, 'approved');
  assert.equal(stagedLog[0].reviewed_on, '2026-10-21');
  assert(!stagedLog.some(event => event.to_state === 'merged'));
  assert(!staged.submission.events.some(event => event.to_state === 'merged'));
  assert.equal(rowCount(h, 'approved_records'), 0);

  currentTime = '2026-10-22T01:15:00.000Z';
  const result = await verify(h, staged.job);
  assertStatus(result, 200);
  assert.equal(result.body.job.status, 'verified');
  const mergeRows = result.body.job.verification.canonical_review_log;
  assert.equal(mergeRows.length, 1);
  assert.equal(mergeRows[0].entry_id, 'TEST-001');
  assert.equal(mergeRows[0].release_id, staged.job.id);
  assert.equal(mergeRows[0].reviewed_on, '2026-10-22');
  assert.equal(mergeRows[0].from_state, 'approved');
  assert.equal(mergeRows[0].to_state, 'merged');
  const verifiedEvent = result.body.submission.events.find(event => event.kind === 'verified');
  assert(verifiedEvent);
  assert.equal(verifiedEvent.created_at, currentTime);
  assert.equal(verifiedEvent.release_id, staged.job.id);
  assert.deepEqual(verifiedEvent.checks.canonical_review_log, mergeRows);
  const storedVerified = await h.store.getJob(staged.job.id);
  assert.equal(storedVerified.manifest_json, storedStage.manifest_json);
  assert.equal(storedVerified.operation_hash, storedStage.operation_hash);
  assert.equal((await h.store.getRecord('wf_TEST-001')).hash, stagedTarget.after_hash);
});

test('URL, task ID and target-hash containers reject without implicit string coercion or TypeError', async () => {
  const cases = [];
  const urlArray = envelope();
  urlArray.payload.Sources[0].url = ['https://example.org/x'];
  cases.push([urlArray, 'unsafe_url']);
  for (const taskId of [['HNY-001'], { toString: null }]) {
    cases.push([envelope({ task_ids: [taskId] }), 'invalid_task_id']);
  }
  cases.push([envelope({ targets: [{ record_id: 'wf_TEST-001', expected_version: 1, expected_hash: { toString: null } }] }), 'invalid_target']);
  for (const [input, expectedCode] of cases) {
    await assert.rejects(preview(input), error => {
      assert.notEqual(error.name, 'TypeError');
      assert.equal(error.code, expectedCode);
      return true;
    });
  }
});

test('optional canonical text and source references reject object or boolean shapes', async () => {
  for (const field of ['modern_location', 'interpretation', 'gap_question', 'gap_scope', 'gap_limitations', 'geo_source_ref']) {
    for (const value of [{ toString: null }, false, true]) {
      const input = envelope();
      input.payload.Entries[0][field] = value;
      const result = await preview(input);
      assert.equal(result.validation.valid, false, field + ': ' + JSON.stringify(value));
      assert.equal(result.application.applicable, false);
      assert(result.validation.errors.some(error => error.field === 'Entries.0.' + field), field);
    }
  }
});

test('related-entry IDs reject zero, booleans and objects without coercion or dangling traversal', async () => {
  for (const value of [0, false, true, { toString: null }]) {
    const input = envelope();
    input.payload.Entries[0].related_entry_id = value;
    const result = await preview(input);
    assert.equal(result.validation.valid, false, JSON.stringify(value));
    assert.equal(result.application.applicable, false);
    assert(result.validation.errors.some(error => error.field === 'Entries.0.related_entry_id' && error.code === 'optional_id_required'));
  }
});

test('a year-zero consultation date cannot pass the actual-date requirement', async () => {
  const input = envelope();
  input.payload.Sources[0].accessed_on = '0000-01-01';
  const result = await preview(input);
  assert.equal(result.validation.valid, false);
  assert.equal(result.application.applicable, false);
  assert(result.validation.errors.some(error => error.field === 'Sources.0.accessed_on' && error.code === 'actual_date_required'));
});


test('created tasks persist, replay once and support later updates', async t => {
  const h = harness(); t.after(() => h.db.close());
  const body = {idempotency_key: nextKey(h, 'create-task'), task: {bounded_task:'Check a source', description:'Compare the citation with the source.', section:'Research and sources', skill_level:'beginner', status:'proposed'}};
  const created = await call(h, '/api/contributions/task-create', body);
  assertStatus(created, 201);
  assert.equal(created.body.task.bounded_task, body.task.bounded_task);
  assert.equal(created.body.task.version, 1);
  const replay = await call(h, '/api/contributions/task-create', body);
  assert.equal(replay.body.task.task_id, created.body.task.task_id);
  assert.equal(rowCount(h, 'workflow_task_events'), 1);
  const dashboard = await call(h, '/api/contributions/dashboard');
  assert.equal(dashboard.body.tasks.length, 1);
  const changed = await call(h, '/api/contributions/task', {idempotency_key:nextKey(h, 'update-created-task'), task_id:created.body.task.task_id, expected_version:1, status:'open', rationale:'Ready for research.', evidence_refs:['Source located'], next_action:'Check citation.'});
  assertStatus(changed, 200);
  assert.equal(changed.body.task.status, 'open');
});

test('task creation validates input and requires authenticated same-origin requests', async t => {
  const h = harness(); t.after(() => h.db.close());
  const body = {idempotency_key: nextKey(h, 'create-task'), task: {bounded_task:'Check a source', description:'Compare citation.', section:'Research', skill_level:'beginner', status:'proposed'}};
  assertStatus(await call(h, '/api/contributions/task-create', body, {actor:null}), 401);
  assertStatus(await call(h, '/api/contributions/task-create', body, {origin:'https://other.test'}), 403);
  assertStatus(await call(h, '/api/contributions/task-create', {...body, task:{...body.task, bounded_task:' '}}), 400);
  assertStatus(await call(h, '/api/contributions/task-create', {...body, task:{...body.task, status:'completed'}}), 400);
  assert.equal(rowCount(h, 'workflow_task_events'), 0);
});

test('shared tasks remain visible to another signed-in actor after service restart and event compaction', async t => {
  const h = harness(); t.after(() => h.db.close());
  const created = await call(h, '/api/contributions/task-create', {idempotency_key:nextKey(h,'task'),task:{bounded_task:'Check shared visibility',description:'Read this task in a separate session.',section:'Research',skill_level:'beginner',status:'proposed'}});
  assertStatus(created,201);
  const id=created.body.task.task_id;
  const changed=await call(h, '/api/contributions/task',{idempotency_key:nextKey(h,'task'),task_id:id,expected_version:1,status:'blocked',rationale:'Pending source.',evidence_refs:[],next_action:'Find source.'});
  assertStatus(changed,200);
  const insert=h.db.native.prepare('INSERT INTO workflow_task_events (id,task_id,version,actor_id,event_json,created_at) VALUES (?,?,?,?,?,?)');
  for(let i=0;i<501;i++) insert.run('later-'+i,'other-task',i+1,'another-actor',JSON.stringify({status:'proposed'}),'2026-10-22T10:00:00.000Z');
  h.service=createWorkflowService({store:h.store,taskSeeds:{tasks:[]}});
  const viewer=await call(h,'/api/contributions/tasks',undefined,{actor:'second-viewer'});
  assertStatus(viewer,200);
  const task=viewer.body.tasks.find(task=>task.task_id===id);
  assert.equal(task.bounded_task,'Check shared visibility');
  assert.equal(task.status,'blocked');
  assert.equal(task.version,2);
  assertStatus(await call(h,'/api/contributions/tasks',undefined,{actor:null}),401);
});

test('own edit pagination remains complete and stable beyond reviewer queue limits', async t => {
  const h=harness();t.after(()=>h.db.close());
  for(let n=0;n<107;n++)await submit(h,envelope({title:'Owned edit '+n}));
  for(let n=0;n<105;n++)assertStatus(await call(h,'/api/contributions/submit',submitBody(envelope({title:'Other edit '+n}),nextKey(h,'other')),{actor:'other'}),201);
  const own=[];
  for(let page=1;page<=6;page++){const r=await call(h,'/api/contributions/edits?page='+page);assertStatus(r,200);assert.equal(r.body.total,107);assert.equal(r.body.total_pages,6);own.push(...r.body.items);assert(r.body.items.every(item=>item.title.startsWith('Owned')));}
  assert.equal(own.length,107);assert.equal(new Set(own.map(item=>item.id)).size,107);
  assert.deepEqual((await call(h,'/api/contributions/edits?page=2')).body,(await call(h,'/api/contributions/edits?page=2')).body);
});

test('edit listing ignores reviewer authority and rejects invalid pagination',async t=>{
  const h=harness();t.after(()=>h.db.close());await submit(h);
  const reviewer=await call(h,'/api/contributions/edits?page=1',undefined,{actor:'reviewer'});assertStatus(reviewer,200);assert.equal(reviewer.body.total,0);assert.deepEqual(reviewer.body.items,[]);
  for(const query of ['page=0','page=-1','page=1.5','page=1&page=2','page=100000','owner_id=owner'])assertStatus(await call(h,'/api/contributions/edits?'+query),400);
  assertStatus(await call(h,'/api/contributions/edits',undefined,{actor:null}),401);
});

test('concurrent withholding defeats a revision and retry preserves the withheld decision',async t=>{
  const h=harness();t.after(()=>h.db.close());const created=await submit(h),before=created.submission;
  const revise=h.store.revise;let intercepted=false;
  h.store.revise=async(...args)=>{if(!intercepted){intercepted=true;assertStatus(await call(h,'/api/contributions/triage',{idempotency_key:nextKey(h,'withhold'),submission_id:before.id,expected_revision:1,action:'withhold',rationale:'Concurrent privacy decision.'}),200);}return revise(...args);};
  const body={idempotency_key:nextKey(h,'revise'),submission_id:before.id,expected_revision:1,submission_json:JSON.stringify(envelope({title:'Preserved private revision'}))};
  assertStatus(await call(h,'/api/contributions/revise',body),409);
  assert.equal((await h.store.getSubmission(before.id)).review_state,'withheld');assert.equal(rowCount(h,'workflow_revisions'),1);assert.equal(rowCount(h,'approved_records'),0);
  const retried=await call(h,'/api/contributions/revise',body);assertStatus(retried,200);assert.equal(retried.body.submission.status,'withheld');assert.equal(retried.body.submission.revision,2);
  const replayed=await call(h,'/api/contributions/revise',body);assertStatus(replayed,200);assert.equal(replayed.body.reused,true);assert.equal(rowCount(h,'workflow_revisions'),2);
});

test('published feed uses the immutable published revision and excludes pending, rollback and private fields',async t=>{
  const {publishedEdits}=await import('../server/published-edits.mjs');const h=harness();t.after(()=>h.db.close());
  const payload=envelope({public_credit:{consent:true,label:'Public fixture credit'}});payload.payload.Entries[0].contributor='Public fixture credit';const created=await submit(h,payload);
  assert.deepEqual(await publishedEdits(h.db),[]);const approved=await approve(h,created.submission);assert.deepEqual(await publishedEdits(h.db),[]);
  const staged=await stage(h,approved);assert.deepEqual(await publishedEdits(h.db),[]);assertStatus(await verify(h,staged.job),200);
  const original=await publishedEdits(h.db);assert.equal(original.length,1);assert.equal(original[0].credit,'Public fixture credit');assert.deepEqual(Object.keys(original[0]).sort(),['credit','id','published_at','targets']);assert.deepEqual(Object.keys(original[0].targets[0]).sort(),['record_id','title']);
  const draft=envelope({title:'PRIVATE NEW TITLE',summary:'private@example.test',public_credit:{consent:true,label:'PRIVATE NEW CREDIT'}});
  assertStatus(await call(h,'/api/contributions/revise',{idempotency_key:nextKey(h,'private-revision'),submission_id:created.submission.id,expected_revision:1,submission_json:JSON.stringify(draft)}),200);
  assert.deepEqual(await publishedEdits(h.db),original);assert(!JSON.stringify(original).includes('private@example.test'));assert(!JSON.stringify(original).includes('raw_json'));
  assertStatus(await call(h,'/api/contributions/rollback',{idempotency_key:nextKey(h,'rollback'),job_id:staged.job.id,rationale:'Synthetic rollback.'},{actor:'publisher'}),200);assert.deepEqual(await publishedEdits(h.db),[]);
});

test('public saved records use verified canonical fields and ignore a newer private proposal',async t=>{
 const {publishedRecords}=await import('../server/published-edits.mjs');const h=harness();t.after(()=>h.db.close());
 const base=await submit(h);assert.deepEqual(await publishedRecords(h.db),[]);const approved=await approve(h,base.submission),staged=await stage(h,approved);assert.deepEqual(await publishedRecords(h.db),[]);assertStatus(await verify(h,staged.job),200);
 const initial=await publishedRecords(h.db);assert.equal(initial.length,1);const record=initial[0];const publicTarget=await call(h,'/api/contributions/target?id='+encodeURIComponent(record.id),undefined,{actor:'another-contributor'});assertStatus(publicTarget,200);assert.deepEqual(publicTarget.body.target.record,record);assert.equal(Object.hasOwn(publicTarget.body.target.record,'raw_json'),false);assert.equal(record.title,envelope().payload.Entries[0].title);assert.equal(record.latitude,null);assert.equal(record.description,envelope().payload.Entries[0].claim_text);assert.equal(record.sources[0].citation,envelope().payload.Sources[0].citation);
 for(const key of ['owner_id','raw_json','original_submission_json','review_notes','reviewer','metadata','hosted_payload'])assert.equal(Object.hasOwn(record,key),false);
 const privateRevision=envelope({summary:'PRIVATE PERSONAL RESEARCH',title:'PRIVATE NEW TITLE'});assertStatus(await call(h,'/api/contributions/revise',{idempotency_key:nextKey(h,'private'),submission_id:base.submission.id,expected_revision:1,submission_json:JSON.stringify(privateRevision)}),200);assert.deepEqual(await publishedRecords(h.db),initial);
 assertStatus(await call(h,'/api/contributions/rollback',{idempotency_key:nextKey(h,'rollback'),job_id:staged.job.id,rationale:'Synthetic rollback.'},{actor:'publisher'}),200);assert.deepEqual(await publishedRecords(h.db),[]);
});

test('public record pages traverse more than 1000 verified records without dropping stable IDs',async t=>{
 const {publishedRecordPage}=await import('../server/published-edits.mjs');const h=harness();t.after(()=>h.db.close());
 const base=await submit(h),approved=await approve(h,base.submission),staged=await stage(h,approved);assertStatus(await verify(h,staged.job),200);
 const original=await h.db.prepare('SELECT * FROM approved_records LIMIT 1').first();
 for(let n=0;n<1001;n++)await h.db.prepare('INSERT INTO approved_records (id,owner_id,preview_id,raw_json,raw_hash,derived_json,preview_hash,approved_at) VALUES (?,?,?,?,?,?,?,?)').bind('pagination-'+String(n).padStart(4,'0'),original.owner_id,'pagination-'+n,original.raw_json,original.raw_hash,original.derived_json,original.preview_hash,original.approved_at).run();
 const records=[];let cursor='',pages=0;do{const page=await publishedRecordPage(h.db,cursor);assert.ok(page.records.length<=500);records.push(...page.records);cursor=page.next_cursor;pages++;}while(cursor);
 assert.equal(pages,3);assert.equal(records.length,1002);assert.equal(new Set(records.map(r=>r.id)).size,1002);
});

test('contributor credits count live consented releases per name and keep identity private',async t=>{
  const {contributorCredits}=await import('../server/published-edits.mjs');const h=harness();t.after(()=>h.db.close());
  assert.deepEqual(await contributorCredits(h.db),{contributors:[],total:0});
  let n=0;const publish=async credit=>{const id='CREDIT-00'+(++n),record=entry(id),payload=envelope({public_credit:credit,payload:{Entries:[record],Sources:[source(id)],SearchLog:[]}});payload.payload.Entries[0].contributor=credit.consent?credit.label:'Uncredited contributor';const created=await submit(h,payload);const staged=await stage(h,await approve(h,created.submission));assertStatus(await verify(h,staged.job),200);return staged;};
  await publish({consent:true,label:'Fixture Credit'});const staged=await publish({consent:true,label:' fixture   credit '});await publish({consent:false,label:''});
  const credits=await contributorCredits(h.db);
  assert.deepEqual(credits,{contributors:[{name:'Fixture Credit',count:2}],total:3});assert(!/@|owner|actor|map_/.test(JSON.stringify(credits)));
  assertStatus(await call(h,'/api/contributions/rollback',{idempotency_key:nextKey(h,'credit-rollback'),job_id:staged.job.id,rationale:'Synthetic rollback.'},{actor:'publisher'}),200);
  assert.deepEqual(await contributorCredits(h.db),{contributors:[{name:'Fixture Credit',count:1}],total:2});
});
