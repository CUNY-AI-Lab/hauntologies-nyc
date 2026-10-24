import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { buildPreview } from '../server/workflow-core.mjs';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { publishedRecords } from '../server/published-edits.mjs';

// Synthetic proposals, actors and an in-memory database only; no production data.
const boundaries = JSON.parse(readFileSync(new URL('../public/data/nyc-borough-boundaries.geojson', import.meta.url)));
const ctx = vm.createContext({ window: {} });
vm.runInContext(readFileSync(new URL('../public/promote-entry-model.js', import.meta.url), 'utf8'), ctx);
const model = ctx.window.PromoteEntryModel;
const today = '2026-10-24';
const plain = value => JSON.parse(JSON.stringify(value));

const proposal = (payload = {}, credit = { consent: true, label: 'A. Contributor' }) => ({
  schema_version: '1.0', type: 'open_proposal', task_ids: [], title: 'Shepard Hall stairwell',
  summary: 'Footsteps on the north stair after closing.', public_credit: credit, sources: [], attachments: [], targets: [],
  payload: { explanation: 'Footsteps on the north stair after closing.', sources_text: 'The Campus, 12 March 1962, p. 3.', attributes: [],
    geometry: { type: 'Point', coordinates: [-73.9497, 40.8197] }, ...payload },
});
const approvedSubmission = (envelope = proposal()) => ({ id: 'ws_synthetic', revision: 1, type: 'open_proposal', status: 'approved',
  raw_json: JSON.stringify(envelope), approval: { independent: true, revision: 1 } });

// What a publisher completes in the dialog; everything else comes from the proposal.
function complete(form) {
  const next = plain(form);
  Object.assign(next, { place_original: 'Shepard Hall, north stair', place_normalized: 'Shepard Hall, City College of New York',
    record_license: 'CC-BY-4.0', rights_notes: 'Contributor-authored summary; citation only.' });
  for (const row of next.sources.filter(row => row.role !== 'geography')) Object.assign(row, {
    citation: 'The Campus, 12 March 1962, p. 3.', repository: 'City College Archives', locator: 'Vol. 110, no. 9, p. 3',
    evidence_note: 'Reports the story; does not establish a supernatural event.', rights_statement: 'Citation only.' });
  return next;
}
const check = form => buildPreview(JSON.stringify(model.envelope(form)), { geography: { boundaries } });

test('a pinned proposal prefills an approximate entry cited to the proposal, without changing it', () => {
  const submission = approvedSubmission(), before = JSON.stringify(submission);
  const form = plain(model.draft(submission, { today, entryId: 'HNY-20261024-ABC123', borough: 'Manhattan' }));
  assert.equal(JSON.stringify(submission), before);
  assert.equal(form.title, 'Shepard Hall stairwell');
  assert.equal(form.claim_text, 'Footsteps on the north stair after closing.');
  assert.deepEqual([form.geo_status, form.geo_method, form.latitude, form.longitude], ['approximate', 'contextual_estimate', 40.8197, -73.9497]);
  assert.deepEqual(form.sources.map(row => row.role), ['report', 'geography']);
  assert.match(form.sources[1].citation, /contribution ws_synthetic, revision 1/);
  assert.equal(form.reference.sources_text, 'The Campus, 12 March 1962, p. 3.');
  assert.equal(model.envelope(form).payload.Entries[0].contributor, 'A. Contributor');
});

test('the prefilled draft alone does not pass; the completed entry is valid and applicable', async () => {
  const form = model.draft(approvedSubmission(), { today, entryId: 'HNY-20261024-ABC123', borough: 'Manhattan' });
  const incomplete = await check(form);
  assert.equal(incomplete.validation.valid, false);
  const done = await check(complete(form));
  assert.deepEqual(done.validation.errors, []);
  assert.equal(done.application.applicable, true);
});

test('a vanished place gets existence and disappearance rows in place of an untouched report', async () => {
  const form = model.withRequiredSources({ ...plain(model.draft(approvedSubmission(), { today, entryId: 'HNY-20261024-VAN001', borough: 'Manhattan' })), category: 'vanished_place' }, today);
  assert.deepEqual(plain(form.sources.map(row => row.role)), ['existence', 'disappearance', 'geography']);
  const done = complete(form);
  assert.deepEqual((await check(done)).validation.errors, []);
});

test('switching category drops untouched rows it no longer needs but keeps started ones', () => {
  const start = plain(model.draft(approvedSubmission(), { today, entryId: 'HNY-20261024-SW0001', borough: 'Manhattan' }));
  const vanished = plain(model.withRequiredSources({ ...start, category: 'vanished_place' }, today));
  vanished.sources[0].citation = 'Started existence citation';
  const back = plain(model.withRequiredSources({ ...vanished, category: 'reported_haunting' }, today));
  assert.deepEqual(back.sources.map(row => row.role), ['existence', 'report', 'geography']);
  assert.equal(back.sources[0].citation, 'Started existence citation');
});

test('a proposal without a point stays unresolved and needs no geography source', async () => {
  const envelope = proposal({ geometry: null }, { consent: false, label: '' });
  const form = model.draft(approvedSubmission(envelope), { today, entryId: 'HNY-20261024-UNR001' });
  assert.deepEqual([form.geo_status, form.latitude, form.sources.length], ['unresolved', null, 1]);
  const result = await check(complete(form));
  assert.deepEqual(result.validation.errors, []);
  assert.equal(model.envelope(form).payload.Entries[0].contributor, 'Uncredited contributor');
});

test('only an independently approved current freeform proposal is promotable, and only by a publisher', () => {
  const submission = approvedSubmission();
  assert.equal(model.promotable(submission, { can_apply: true }), true);
  assert.equal(model.promotable(submission, { can_apply: false }), false);
  assert.equal(model.promotable({ ...submission, status: 'submitted' }, { can_apply: true }), false);
  assert.equal(model.promotable({ ...submission, revision: 2 }, { can_apply: true }), false);
  assert.equal(model.promotable({ ...submission, type: 'entry_bundle' }, { can_apply: true }), false);
  assert.throws(() => model.draft({ ...submission, type: 'entry_bundle' }, { today, entryId: 'HNY-X' }));
});

function harness(t) {
  const native = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) native.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  t.after(() => native.close());
  const prepare = (sql, args = []) => ({
    bind(...values) { return prepare(sql, values); },
    async first() { return native.prepare(sql).get(...args) || null; },
    async all() { return { results: native.prepare(sql).all(...args) }; },
    async run() { return { success: true, meta: { changes: Number(native.prepare(sql).run(...args).changes) } }; },
  });
  const db = { prepare, async batch(statements) {
    native.exec('BEGIN');
    try { const out = []; for (const s of statements) out.push(await s.run()); native.exec('COMMIT'); return out; } catch (error) { native.exec('ROLLBACK'); throw error; }
  } };
  const service = createWorkflowService({ store: createWorkflowStore(db), geography: { boundaries }, authorization: { reviewers: ['reviewer'], publishers: ['publisher'] } });
  const call = async (path, body, actor) => {
    const response = await service.handle(new Request('https://map.test/api/contributions/' + path, { method: body ? 'POST' : 'GET',
      headers: { 'oai-authenticated-user-id': actor, origin: 'https://map.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() };
  };
  return { db, call };
}
const key = () => crypto.randomUUID();
const passing = { evidence_check: 'pass', geography_check: 'pass', rights_check: 'pass', duplicate_check: 'pass', privacy_check: 'pass' };
const review = s => ({ idempotency_key: key(), submission_id: s.id, expected_revision: s.revision, payload_hash: s.payload_hash, diff_hash: s.diff_hash, checks: passing, rationale: 'Synthetic independent review.' });

test('a promoted entry reaches the public map only after its own independent review, apply and verify', async t => {
  const { db, call } = harness(t);
  const submitted = await call('submit', { idempotency_key: key(), submission_json: JSON.stringify(proposal()) }, 'contributor');
  assert.equal(submitted.status, 201);
  const approved = await call('review', review(submitted.body.submission), 'reviewer');
  assert.equal(approved.status, 200);
  const source = approved.body.submission;
  assert.equal(model.promotable(source, { can_apply: true }), true);

  const form = complete(model.draft(source, { today, entryId: 'HNY-20261024-E2E001', borough: 'Manhattan' }));
  const entry = await call('submit', { idempotency_key: key(), submission_json: JSON.stringify(model.envelope(form)) }, 'publisher');
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  const self = await call('review', review(entry.body.submission), 'publisher');
  assert.equal(self.status, 403);
  const entryApproved = await call('review', review(entry.body.submission), 'reviewer');
  assert.equal(entryApproved.status, 200, JSON.stringify(entryApproved.body));
  const s = entryApproved.body.submission;
  const staged = await call('apply', { idempotency_key: key(), submission_id: s.id, expected_revision: s.revision, approval_hash: s.approval.approval_hash }, 'publisher');
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  assert.deepEqual(await publishedRecords(db), []);
  const verified = await call('verify', { idempotency_key: key(), job_id: staged.body.job.id, map_list_check: { status: 'pass', evidence: 'Synthetic check of the mapped point and list entry.' } }, 'publisher');
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  const records = await publishedRecords(db);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Shepard Hall stairwell');
  assert.deepEqual([records[0].latitude, records[0].longitude], [40.8197, -73.9497]);
});
