import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { buildPreview, hash, stable, LIMITS } from '../server/workflow-core.mjs';
import { publishedRecords } from '../server/published-edits.mjs';

// Local, synthetic fixtures only. This suite never contacts a hosted service.
const boundaries = JSON.parse(readFileSync(new URL('../public/data/nyc-borough-boundaries.geojson', import.meta.url)));
const staticRecord = { id: 'synthetic_static_context', title: 'Existing synthetic context', description: 'Original record wording stays intact.', latitude: null, longitude: null };
const now = () => new Date('2026-10-21T18:00:00.000Z');
const checks = () => ({ evidence_check: 'pass', geography_check: 'pass', rights_check: 'pass', duplicate_check: 'pass', privacy_check: 'pass' });
const wording = '  I remember this place — is there a source?\nUncertain date; 😀 e\u0301.  ';
const ring = () => [[-73.949, 40.820], [-73.948, 40.820], [-73.948, 40.821], [-73.949, 40.821], [-73.949, 40.820]];
const point = () => ({ type: 'Point', coordinates: [-73.9485, 40.8205] });

function sqliteD1() {
  const native = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(x => x.endsWith('.sql')).sort()) native.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  const prepare = (sql, params = []) => ({
    bind(...values) { return prepare(sql, values); },
    async first(column) { const row = native.prepare(sql).get(...params) || null; return column && row ? row[column] : row; },
    async all() { return { results: native.prepare(sql).all(...params) }; },
    async run() { const result = native.prepare(sql).run(...params); return { success: true, meta: { changes: Number(result.changes) } }; },
  });
  let tail = Promise.resolve();
  return { native, prepare, batch(statements) {
    const operation = tail.then(async () => {
      native.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); native.exec('COMMIT'); return results; }
      catch (error) { native.exec('ROLLBACK'); throw error; }
    });
    tail = operation.catch(() => {}); return operation;
  }, close() { native.close(); } };
}
function harness(options = {}) {
  const db = sqliteD1(), store = createWorkflowStore(db);
  const serviceOptions = { store, taskSeeds: { tasks: [] }, geography: { boundaries }, staticRecords: [staticRecord], now, ...options };
  return { db, store, service: createWorkflowService(serviceOptions), serviceOptions, seq: 0 };
}
const key = (h, action) => 'freeform_' + action + '_' + String(++h.seq).padStart(6, '0');
const count = (h, table) => h.db.native.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
function envelope(payload = {}, overrides = {}) {
  return { schema_version: '1.0', type: 'open_proposal', task_ids: [], title: 'Contribution', summary: wording, public_credit: { consent: false, label: '' }, sources: [], attachments: [], targets: [], payload: { explanation: wording, ...payload }, ...overrides };
}
async function call(h, path, body, options = {}) {
  const actor = options.actor === undefined ? 'contributor' : options.actor;
  const response = await h.service.handle(new Request('https://map.test/api/contributions/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(actor ? { 'oai-authenticated-user-id': actor } : {}), origin: options.origin || 'https://map.test', 'sec-fetch-site': options.site || 'same-origin', 'content-type': options.contentType || 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: response.status, body: await response.json() };
}
const status = (r, n) => assert.equal(r.status, n, JSON.stringify(r.body));
const preview = (value, extra = {}) => buildPreview(JSON.stringify(value), { geography: { boundaries }, ...extra });
async function submit(h, value = envelope()) {
  const request = { idempotency_key: key(h, 'submit'), submission_json: JSON.stringify(value, null, 2) };
  const response = await call(h, 'submit', request); status(response, 201); return { ...response.body, request };
}
async function context(h) {
  const response = await call(h, 'target?id=' + staticRecord.id); status(response, 200);
  const { record_id, expected_version, expected_hash } = response.body.target;
  return { record_id, expected_version, expected_hash };
}
function review(h, s, overrides = {}) { return { idempotency_key: key(h, 'review'), submission_id: s.id, expected_revision: s.revision, payload_hash: s.payload_hash, diff_hash: s.diff_hash, checks: checks(), rationale: 'Synthetic independent review of the contribution only; publication remains separate.', ...overrides }; }
async function invalid(value, options = {}) {
  let p;
  try { p = await preview(value, options); }
  catch (error) { assert.notEqual(error.name, 'TypeError'); assert.equal(typeof error.code, 'string'); return; }
  assert.equal(p.validation.valid, false, JSON.stringify(p));
  assert.equal(p.application.applicable, false);
}

test('explanation alone is valid, explicitly unverified, unknown and review-only', async () => {
  const value = envelope(), p = await preview(value);
  assert.deepEqual(p.validation.errors, []);
  assert.equal(p.proposal.explanation, wording);
  assert.equal(p.proposal.evidence_status, 'unverified');
  assert.equal(p.proposal.geometry, null);
  assert.equal(p.proposal.geometry_status, 'unresolved');
  assert.equal(p.proposal.dates, null);
  assert.deepEqual(p.targets, []);
  assert.deepEqual(p.envelope, value);
  assert.deepEqual(p.application, { applicable: false, reason: 'open_proposal_review_only', operations: [] });
  assert.ok(p.validation.warnings.some(x => x.code === 'sources_not_provided'));
  assert.equal(p.diff[0].operation, 'propose_contribution');
});

test('optional freeform text, nulls, omission and original raw bytes are retained', async t => {
  const h = harness(); t.after(() => h.db.close());
  for (const payload of [{}, { location_text: '', sources_text: '', geometry: null }, { location_text: null, sources_text: null, geometry: null }, { location_text: '  west side?\r\nunknown  ', sources_text: '  Notebook p. 4; URL unconfirmed.\nhttps://example.org/?q=é  ' }]) {
    const value = envelope(payload), created = await submit(h, value);
    assert.equal(created.submission.status, 'submitted');
    assert.equal(created.submission.raw_json, created.request.submission_json);
    const row = await h.store.getRevision(created.submission.id, 1);
    assert.equal(row.raw_json, created.request.submission_json);
    assert.equal(row.raw_hash, await hash(created.request.submission_json));
    assert.deepEqual(JSON.parse(row.raw_json), value);
    assert.equal(row.actor_id, 'contributor');
    assert.ok(created.receipt.id.startsWith('wrc_'));
  }
  assert.equal(count(h, 'workflow_submissions'), 4);
  assert.equal(count(h, 'workflow_receipts'), 4);
  assert.equal(count(h, 'approved_records'), 0);
});

test('receipt replay is idempotent and changed request bytes conflict', async t => {
  const h = harness(); t.after(() => h.db.close());
  const created = await submit(h);
  const replay = await call(h, 'submit', created.request); status(replay, 200);
  assert.equal(replay.body.reused, true);
  assert.equal(replay.body.receipt.id, created.receipt.id);
  const changed = await call(h, 'submit', { ...created.request, submission_json: created.request.submission_json + '\n' });
  status(changed, 409); assert.equal(changed.body.error, 'idempotency_conflict');
  assert.equal(count(h, 'workflow_submissions'), 1);
  assert.equal(count(h, 'workflow_revisions'), 1);
});

test('revisions keep old raw wording immutable and require the current revision', async t => {
  const h = harness(); t.after(() => h.db.close());
  const created = await submit(h), nextText = wording + '\nA correction, not an overwritten original.';
  const next = envelope({ explanation: nextText }, { summary: nextText });
  const request = { idempotency_key: key(h, 'revise'), submission_id: created.submission.id, expected_revision: 1, submission_json: JSON.stringify(next, null, 2) };
  const updated = await call(h, 'revise', request); status(updated, 200);
  assert.equal(updated.body.submission.revision, 2);
  assert.equal((await h.store.getRevision(created.submission.id, 1)).raw_json, created.request.submission_json);
  assert.equal((await h.store.getRevision(created.submission.id, 2)).raw_json, request.submission_json);
  status(await call(h, 'revise', { ...request, idempotency_key: key(h, 'stale') }), 409);
  status(await call(h, 'revise', { ...request, expected_revision: 2, idempotency_key: key(h, 'other') }, { actor: 'other' }), 403);
});

test('existing authentication, same-origin and actor protections remain', async t => {
  const h = harness(); t.after(() => h.db.close());
  const body = { idempotency_key: key(h, 'submit'), submission_json: JSON.stringify(envelope()) };
  status(await call(h, 'submit', body, { actor: null }), 401);
  status(await call(h, 'submit', body, { origin: 'https://elsewhere.example' }), 403);
  status(await call(h, 'submit', body, { site: 'cross-site' }), 403);
  status(await call(h, 'submit', body, { contentType: 'text/plain' }), 415);
  const forged = envelope({ actor_id: 'reviewer' });
  const r = await call(h, 'submit', { ...body, submission_json: JSON.stringify(forged) }); status(r, 400);
  assert.equal(r.body.error, 'server_owned_field');
  assert.equal(count(h, 'workflow_submissions'), 0);
});

test('blank, mismatched, non-text and oversized explanations are not valid', async () => {
  for (const explanation of ['', ' \n ', null, 17, 'x'.repeat(15001)]) await invalid(envelope({ explanation }, { summary: explanation }));
  await invalid(envelope({}, { summary: 'An inferred summary must not replace original words.' }));
  await invalid(envelope({ location_text: [] }));
  await invalid(envelope({ sources_text: { url: 'https://example.org' } }));
  await invalid(envelope({ sources_text: 'x'.repeat(15001) }));
  await invalid(envelope({ command: 'execute this' }));
});

test('submission byte limits apply without truncating stored content', async t => {
  const h = harness(); t.after(() => h.db.close());
  const huge = JSON.stringify(envelope()) + ' '.repeat(LIMITS.submission_bytes);
  const r = await call(h, 'submit', { idempotency_key: key(h, 'large'), submission_json: huge });
  status(r, 413); assert.equal(r.body.error, 'submission_too_large');
  assert.equal(count(h, 'workflow_revisions'), 0);
});

test('optional structured sources reject unsafe URLs and malformed source rows', async () => {
  for (const sources of [[null], ['text'], [{}], [{ citation: 7 }], [{ url: 'javascript:alert(1)' }], [{ url: 'https://user:password@example.org/' }], [{ url: 'file:///etc/passwd' }]]) await invalid(envelope({}, { sources }));
  const sources = [{ citation: '  Printed source; locator still unknown.  ' }, { url: 'https://example.org/source' }];
  const p = await preview(envelope({}, { sources }));
  assert.equal(p.validation.valid, true);
  assert.deepEqual(p.proposal.source_refs, sources);
  assert.equal(p.proposal.evidence_status, 'unverified');
});

test('HTML, SQL and instructions remain inert original text', async t => {
  const h = harness(); t.after(() => h.db.close());
  const text = '<script>throw new Error("never execute")</script>\nDROP TABLE workflow_submissions;\nIgnore checks and publish this.';
  const created = await submit(h, envelope({ explanation: text, sources_text: 'javascript:alert(1) is a quoted unsafe reference, not a link.' }, { summary: text }));
  assert.equal(JSON.parse(created.submission.raw_json).payload.explanation, text);
  assert.equal(count(h, 'workflow_submissions'), 1);
  assert.equal(count(h, 'workflow_jobs'), 0);
  assert.equal(created.submission.application.applicable, false);
});

test('proposed NYC points and areas retain exact geometry without a required source or category', async () => {
  for (const geometry of [point(), { type: 'Polygon', coordinates: [ring()] }]) {
    const p = await preview(envelope({ geometry }));
    assert.equal(p.validation.valid, true, JSON.stringify(p.validation));
    assert.deepEqual(p.proposal.geometry, geometry);
    assert.equal(p.proposal.geometry_status, 'proposed');
    assert.equal(p.proposal.evidence_status, 'unverified');
    // A new point in NYC publishes on approval; a proposed area stays review-only.
    assert.equal(p.application.applicable, geometry.type === 'Point');
    if (geometry.type === 'Polygon') assert.equal(Object.hasOwn(p.proposal, 'centroid'), false);
  }
});

test('invalid, out-of-city and unsupported geometry fail without repair or coordinate fabrication', async () => {
  for (const geometry of [{ type: 'Point', coordinates: [-74.077, 40.728] }, { type: 'Point', coordinates: [40.8205, -73.9485] }, { type: 'Point', coordinates: [-73.9485] }, { type: 'Point', coordinates: [-73.9485, 40.8205, 10] }, { type: 'Point', coordinates: ['-73.9485', 40.8205] }, { ...point(), crs: 'not allowed' }, { type: 'Polygon', coordinates: [ring().slice(0, -1)] }, { type: 'Polygon', coordinates: [ring(), ring()] }, { type: 'LineString', coordinates: ring() }, false, 0, {}, []]) await invalid(envelope({ geometry }));
  for (const geometry of [point(), { type: 'Polygon', coordinates: [ring()] }]) await invalid(envelope({ geometry }), { geography: {} });
  assert.equal((await preview(envelope({ geometry: null }), { geography: {} })).validation.valid, true);
});

test('100 distinct polygon vertices plus closure remain within the bounded geometry contract', async () => {
  const coordinates = Array.from({ length: 100 }, (_, i) => [-73.9485 + Math.cos(i * Math.PI / 50) * 0.0002, 40.8205 + Math.sin(i * Math.PI / 50) * 0.0002]);
  coordinates.push([...coordinates[0]]);
  const geometry = { type: 'Polygon', coordinates: [coordinates] }, p = await preview(envelope({ geometry }));
  assert.equal(p.validation.valid, true, JSON.stringify(p.validation));
  assert.deepEqual(p.proposal.geometry, geometry);
});

test('optional stable record context resolves to an exact immutable before snapshot', async t => {
  const h = harness(); t.after(() => h.db.close());
  const selected = await context(h), created = await submit(h, envelope({}, { targets: [selected] }));
  assert.equal(created.submission.validation.valid, true);
  assert.deepEqual(created.submission.targets, [selected]);
  assert.deepEqual(created.submission.diff[0].before, staticRecord);
  assert.deepEqual(created.submission.proposal.target.record, staticRecord);
  assert.equal(count(h, 'approved_records'), 0);
});

test('unknown, stale and multiple record contexts cannot pass validation', async t => {
  const h = harness(); t.after(() => h.db.close());
  const selected = await context(h);
  for (const targets of [[{ ...selected, record_id: 'missing' }], [{ ...selected, expected_hash: '0'.repeat(64) }], [{ ...selected, expected_version: 999 }], [selected, { ...selected, record_id: 'another' }]]) {
    const r = await call(h, 'preview', { submission_json: JSON.stringify(envelope({}, { targets })) });
    status(r, 200); assert.equal(r.body.preview.validation.valid, false);
  }
});

test('context change after submission blocks independent review and preserves original submitted bytes', async t => {
  const h = harness({ authorization: { reviewers: ['reviewer'], publishers: ['publisher'] } }); t.after(() => h.db.close());
  const selected = await context(h), created = await submit(h, envelope({}, { targets: [selected] }));
  h.service = createWorkflowService({ ...h.serviceOptions, staticRecords: [{ ...staticRecord, description: 'Later authoritative record.' }] });
  const r = await call(h, 'review', review(h, created.submission), { actor: 'reviewer' });
  status(r, 409); assert.equal(r.body.error, 'validation_failed');
  assert.equal((await h.store.getRevision(created.submission.id, 1)).raw_json, created.request.submission_json);
  assert.equal(count(h, 'workflow_approvals'), 0);
});

test('no reviewer grants or self-approval are introduced for freeform contributions', async t => {
  const h = harness(); t.after(() => h.db.close());
  const created = await submit(h);
  const self = await call(h, 'review', review(h, created.submission)); status(self, 403); assert.equal(self.body.error, 'self_approval_forbidden');
  const other = await call(h, 'review', review(h, created.submission), { actor: 'reviewer' }); status(other, 403); assert.equal(other.body.error, 'independent_reviewer_unavailable');
  const dashboard = await call(h, 'dashboard'); status(dashboard, 200);
  assert.equal(dashboard.body.capabilities.can_review, false);
  assert.equal(dashboard.body.capabilities.can_apply, false);
  assert.equal(count(h, 'workflow_approvals'), 0);
});

test('an approved new point and an approved note on an existing place are both publishable', async t => {
  const h = harness({ authorization: { reviewers: ['reviewer'], publishers: ['publisher'] } }); t.after(() => h.db.close());
  const selected = await context(h);
  for (const targets of [[], [selected]]) {
    const created = await submit(h, envelope({ geometry: targets.length ? null : point() }, { targets }));
    assert.equal(created.submission.application.applicable, true);
    const incomplete = checks(); delete incomplete.privacy_check;
    status(await call(h, 'review', review(h, created.submission, { checks: incomplete }), { actor: 'reviewer' }), 400);
    const approved = await call(h, 'review', review(h, created.submission), { actor: 'reviewer' }); status(approved, 200);
    assert.equal(approved.body.submission.status, 'approved');
    assert.equal(approved.body.submission.proposal.evidence_status, 'unverified');
    const r = await call(h, 'apply', { idempotency_key: key(h, 'apply'), submission_id: created.submission.id, expected_revision: 1, approval_hash: approved.body.submission.approval.approval_hash }, { actor: 'publisher' });
    status(r, 201); assert.equal(r.body.job.status, 'verification_pending');
  }
  assert.equal(count(h, 'workflow_jobs'), 2);
  assert.equal(count(h, 'approved_records'), 0, 'nothing public before verify');
});

test('a contributor deletes an unpublished contribution outright; published ones and other people\'s stay', async t => {
  const h = harness({ authorization: { reviewers: ['reviewer'], publishers: ['publisher'] } }); t.after(() => h.db.close());
  const own = await submit(h, envelope({ geometry: point() }));
  const other = await submit(h, envelope({ geometry: point() }));
  const del = s => ({ idempotency_key: key(h, 'delete'), submission_id: s.id, expected_revision: s.revision });
  status(await call(h, 'delete', del(own.submission), { actor: 'someone-else' }), 404);
  status(await call(h, 'delete', { ...del(own.submission), expected_revision: 2 }), 409);
  const request=del(own.submission); const gone = await call(h, 'delete', request); status(gone, 200);
  assert.equal(gone.body.receipt.result.deleted_submission_id, own.submission.id);
  assert.equal(Object.hasOwn(gone.body, 'submission'), false);
  const replayed=await call(h,'delete',request);status(replayed,200);assert.equal(replayed.body.reused,true);assert.deepEqual(replayed.body.receipt,gone.body.receipt);
  status(await call(h, 'submission?id=' + own.submission.id), 404);
  assert.equal(count(h, 'workflow_submissions'), 1); assert.equal(count(h, 'workflow_revisions'), 1); assert.equal(count(h, 'workflow_events'), 1);
  const edits = await call(h, 'edits'); status(edits, 200); assert.deepEqual(edits.body.items.map(i => i.id), [other.submission.id]);
  // A listed reviewer may remove someone else's unpublished contribution; a published one cannot go.
  const approved = await call(h, 'review', review(h, other.submission), { actor: 'reviewer' }); status(approved, 200);
  const staged = await call(h, 'apply', { idempotency_key: key(h, 'apply'), submission_id: other.submission.id, expected_revision: 1, approval_hash: approved.body.submission.approval.approval_hash }, { actor: 'publisher' }); status(staged, 201);
  status(await call(h, 'delete', del(approved.body.submission), { actor: 'reviewer' }), 409);
  const third = await submit(h, envelope({ geometry: point() }));
  status(await call(h, 'delete', del(third.submission), { actor: 'reviewer' }), 200);
  assert.equal(count(h, 'workflow_submissions'), 1);
});

test('a revised approved proposal cannot inherit its earlier approval', async t => {
  const h = harness({ authorization: { reviewers: ['reviewer'], publishers: ['publisher'] } }); t.after(() => h.db.close());
  const created = await submit(h), approved = await call(h, 'review', review(h, created.submission), { actor: 'reviewer' }); status(approved, 200);
  const next = wording + '\nChanged wording requires new review.';
  const r = await call(h, 'revise', { idempotency_key: key(h, 'revise'), submission_id: created.submission.id, expected_revision: 1, submission_json: JSON.stringify(envelope({ explanation: next }, { summary: next })) }); status(r, 200);
  assert.equal(r.body.submission.status, 'draft');
  assert.equal(r.body.submission.approval, null);
  const attempt = await call(h, 'apply', { idempotency_key: key(h, 'apply'), submission_id: created.submission.id, expected_revision: 2, approval_hash: approved.body.submission.approval.approval_hash }, { actor: 'publisher' });
  status(attempt, 409); assert.equal(attempt.body.error, 'approval_required');
  assert.equal(count(h, 'workflow_jobs'), 0);
});

test('an admin place approved before approval could publish reaches the map after revise, Start review and approve', async t => {
  const admin = 'contributor', h = harness({ authorization: { reviewers: [admin], publishers: [admin], admins: [admin] } }); t.after(() => h.db.close());
  const created = await submit(h, envelope({ geometry: point() }, { title: 'Thomas Shoe Factory' }));
  status(await call(h, 'review', review(h, created.submission)), 200);
  // The approval as an earlier operator recorded it: review-only, so it can never publish.
  const row = h.db.native.prepare('SELECT id,binding_json FROM workflow_approvals').get(), binding = { ...JSON.parse(row.binding_json), application_applicable: false };
  h.db.native.prepare('UPDATE workflow_approvals SET binding_json=?,approval_hash=? WHERE id=?').run(JSON.stringify(binding), await hash(stable(binding)), row.id);
  const stuck = await call(h, 'apply', { idempotency_key: key(h, 'apply'), submission_id: created.submission.id, expected_revision: 1, approval_hash: await hash(stable(binding)) });
  status(stuck, 409); assert.equal(stuck.body.error, 'approval_predates_application');
  const revised = await call(h, 'revise', { idempotency_key: key(h, 'revise'), submission_id: created.submission.id, expected_revision: 1, submission_json: created.request.submission_json }); status(revised, 200);
  assert.equal(revised.body.submission.status, 'draft');
  const queued = await call(h, 'triage', { idempotency_key: key(h, 'triage'), submission_id: created.submission.id, expected_revision: 2, action: 'ready_for_review', rationale: 'Revision ready for review.' }); status(queued, 200);
  assert.equal(queued.body.submission.status, 'submitted');
  const approved = await call(h, 'review', review(h, queued.body.submission)); status(approved, 200);
  assert.equal(approved.body.submission.application.applicable, true);
  const staged = await call(h, 'apply', { idempotency_key: key(h, 'apply'), submission_id: created.submission.id, expected_revision: 2, approval_hash: approved.body.submission.approval.approval_hash }); status(staged, 201);
  status(await call(h, 'verify', { idempotency_key: key(h, 'verify'), job_id: staged.body.job.id, map_list_check: { status: 'pass', evidence: 'Published from Review on approval.' } }), 200);
  assert.deepEqual((await publishedRecords(h.db)).map(r => r.title), ['Thomas Shoe Factory']);
});

test('open review: any map account approves and publishes another person\'s place, never its own', async t => {
  const { reviewAuthorization } = await import('../server/review-authorization.mjs');
  const A = 'map_00000000-0000-4000-8000-00000000000a', B = 'map_00000000-0000-4000-8000-00000000000b';
  const h = harness({ authorization: reviewAuthorization(undefined, undefined, JSON.stringify([A]), 'true') }); t.after(() => h.db.close());
  const as = actor => ({ actor });
  const sent = await call(h, 'submit', { idempotency_key: key(h, 'submit'), submission_json: JSON.stringify(envelope({ geometry: point() }, { title: 'Open review place' }), null, 2) }, as(A)); status(sent, 201);
  const s = sent.body.submission;
  // Even an admin cannot approve their own work under open review.
  const caps = (await call(h, 'dashboard', undefined, as(A))).body.capabilities;
  assert.equal(caps.can_self_approve, false); assert.equal(caps.can_review, true); assert.equal(caps.can_apply, true);
  const own = await call(h, 'review', review(h, s), as(A)); status(own, 403); assert.equal(own.body.error, 'self_approval_forbidden');
  // Another account sends it back; the owner's revision goes straight back for review.
  const raw = JSON.stringify(envelope({ geometry: point() }, { title: 'Open review place' }), null, 2);
  status(await call(h, 'triage', { idempotency_key: key(h, 'triage'), submission_id: s.id, expected_revision: 1, action: 'request_information', rationale: 'Add the year.' }, as(B)), 200);
  const resent = await call(h, 'revise', { idempotency_key: key(h, 'revise'), submission_id: s.id, expected_revision: 1, submission_json: raw }, as(A)); status(resent, 200);
  assert.equal(resent.body.submission.status, 'submitted');
  // Others see the version up for review, without the revision history.
  const seen = await call(h, 'submission?id=' + s.id, undefined, as(B)); status(seen, 200);
  assert.deepEqual(seen.body.submission.revisions.map(r => r.revision), [2]);
  const first = await call(h, 'review', review(h, seen.body.submission), as(B)); status(first, 200);
  // Changing an approved place makes a draft, which stays the owner's until they send it for review.
  status(await call(h, 'revise', { idempotency_key: key(h, 'revise'), submission_id: s.id, expected_revision: 2, submission_json: raw }, as(A)), 200);
  status(await call(h, 'submission?id=' + s.id, undefined, as(B)), 404);
  assert.ok(!(await call(h, 'dashboard', undefined, as(B))).body.submissions.some(x => x.id === s.id));
  status(await call(h, 'triage', { idempotency_key: key(h, 'triage'), submission_id: s.id, expected_revision: 3, action: 'ready_for_review', rationale: 'Not mine.' }, as(B)), 404);
  const queued = await call(h, 'triage', { idempotency_key: key(h, 'triage'), submission_id: s.id, expected_revision: 3, action: 'ready_for_review', rationale: 'Revision ready for review.' }, as(A)); status(queued, 200);
  // B approves, and the approval can publish: B applies and verifies.
  const approved = await call(h, 'review', review(h, queued.body.submission), as(B)); status(approved, 200);
  assert.equal(approved.body.submission.approval.independent, true); assert.equal(approved.body.submission.application.applicable, true);
  const staged = await call(h, 'apply', { idempotency_key: key(h, 'apply'), submission_id: s.id, expected_revision: 3, approval_hash: approved.body.submission.approval.approval_hash }, as(B)); status(staged, 201);
  status(await call(h, 'verify', { idempotency_key: key(h, 'verify'), job_id: staged.body.job.id, map_list_check: { status: 'pass', evidence: 'Published from Review on approval.' } }, as(B)), 200);
  assert.deepEqual((await publishedRecords(h.db)).map(r => r.title), ['Open review place']);
  // Accounts that are not map accounts get no review role from open review.
  const outsider = await call(h, 'review', review(h, queued.body.submission), as('access_' + 'a'.repeat(64))); assert.ok([403, 404, 409].includes(outsider.status));
});

test('a stale saved preview is displayed fresh before approval and old publication effects are rejected', async t => {
  const A = 'map_00000000-0000-4000-8000-00000000000a', B = 'map_00000000-0000-4000-8000-00000000000b';
  const { reviewAuthorization } = await import('../server/review-authorization.mjs');
  const h = harness({ authorization: reviewAuthorization(undefined, undefined, undefined, 'true') }); t.after(() => h.db.close());
  const sent = await call(h, 'submit', { idempotency_key: key(h, 'submit'), submission_json: JSON.stringify(envelope({ geometry: point() }, { title: 'Older preview place' }), null, 2) }, { actor: A }); status(sent, 201);
  const id = sent.body.submission.id, fresh = h.db.native.prepare('SELECT diff_hash,preview_json FROM workflow_revisions WHERE submission_id=?').get(id);
  // As an older operator saved it: a different diff hash and a review-only application.
  const old = { ...JSON.parse(fresh.preview_json), diff_hash: 'f'.repeat(64), application: { applicable: false, reason: 'open_proposal_review_only', operations: [] } };
  h.db.native.prepare('UPDATE workflow_revisions SET diff_hash=?,preview_json=? WHERE submission_id=?').run(old.diff_hash, JSON.stringify(old), id);
  const shown = (await call(h, 'submission?id=' + id, undefined, { actor: B })).body.submission;
  assert.equal(shown.diff_hash, fresh.diff_hash);
  const staleRequest={...review(h,shown),diff_hash:old.diff_hash};
  status(await call(h,'review',staleRequest,{actor:B}),409);
  assert.equal(h.db.native.prepare('SELECT COUNT(*) n FROM workflow_approvals WHERE submission_id=?').get(id).n,0);
  assert.equal(h.db.native.prepare('SELECT preview_json FROM workflow_revisions WHERE submission_id=?').get(id).preview_json,JSON.stringify(old));
  const approved = await call(h, 'review', review(h, shown), { actor: B }); status(approved, 200);
  assert.equal(h.db.native.prepare('SELECT diff_hash FROM workflow_revisions WHERE submission_id=?').get(id).diff_hash,old.diff_hash,'historical saved preview stays intact');
  assert.equal(approved.body.submission.diff_hash, fresh.diff_hash); assert.equal(approved.body.submission.application.applicable, true);
  const staged = await call(h, 'apply', { idempotency_key: key(h, 'apply'), submission_id: id, expected_revision: 1, approval_hash: approved.body.submission.approval.approval_hash }, { actor: B }); status(staged, 201);
  status(await call(h, 'verify', { idempotency_key: key(h, 'verify'), job_id: staged.body.job.id, map_list_check: { status: 'pass', evidence: 'Published from Review on approval.' } }, { actor: B }), 200);
  assert.deepEqual((await publishedRecords(h.db)).map(r => r.title), ['Older preview place']);
  // Changed content is still refused.
  const other = await call(h, 'submit', { idempotency_key: key(h, 'submit'), submission_json: JSON.stringify(envelope({ geometry: point() }, { title: 'Second place' }), null, 2) }, { actor: A });
  const changed = await call(h, 'review', review(h, { ...other.body.submission, payload_hash: 'e'.repeat(64) }), { actor: B }); status(changed, 409); assert.equal(changed.body.error, 'proposal_changed');
});
