import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { reviewAuthorization } from '../server/review-authorization.mjs';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { CHECKS } from '../server/workflow-core.mjs';

// Synthetic actors and an isolated local SQLite database; no Access grants.
const actor = n => 'access_' + n.toString(16).padStart(64, '0');
const owner = actor(1), reviewer = actor(2), stranger = actor(3);
const mapActor = n => 'map_00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const empty = { reviewers: [], publishers: [], stewards: [] };

test('absent configuration and an explicit empty list grant no roles', () => {
  assert.deepEqual(reviewAuthorization(undefined), empty);
  assert.deepEqual(reviewAuthorization('[]'), empty);
});

test('only JSON arrays of canonical verified actor IDs are accepted', () => {
  const ids = [owner, reviewer];
  assert.deepEqual(reviewAuthorization(JSON.stringify(ids)), { ...empty, reviewers: ids, publishers: ids });
  const invalid = [null, false, 1, ids, {}, '', ' ', '[', 'null', 'false', '42',
    JSON.stringify(owner), JSON.stringify({ reviewers: ids, publishers: ids }),
    JSON.stringify([null]), JSON.stringify([false]), JSON.stringify([42]),
    JSON.stringify([{}]), JSON.stringify([{ toString: null }]), JSON.stringify([[owner]]),
    JSON.stringify(['owner@example.org']), JSON.stringify(['Owner']),
    JSON.stringify(['access_' + 'a'.repeat(63)]), JSON.stringify(['access_' + 'a'.repeat(65)]),
    JSON.stringify(['access_' + 'A'.repeat(64)]), JSON.stringify(['access_' + 'g'.repeat(64)]),
    JSON.stringify(['ACCESS_' + 'a'.repeat(64)]), JSON.stringify([owner + '\n']),
    JSON.stringify([owner + '\r']), JSON.stringify([owner + '\u2028']), JSON.stringify([owner + '\u2029']),
    JSON.stringify([' ' + owner]), JSON.stringify([owner + ' '])];
  for (const raw of invalid) assert.deepEqual(reviewAuthorization(raw), empty);
});

test('map reviewer IDs use exact canonical UUIDv4 identities and preserve whole-list rejection', () => {
  const id = mapActor(1), ids = [reviewer, id];
  assert.deepEqual(reviewAuthorization(JSON.stringify(ids)), { ...empty, reviewers: ids, publishers: ids });
  const invalid = [id.toUpperCase(), id.replace('-4000-', '-1000-'), id.replace('-8000-', '-7000-'),
    id.replace('-4000-', '-0000-'), id.slice(0, -1), id + '0', id + '\n', id + '\r',
    id + '\u2028', id + '\u2029', ' ' + id, id + ' ', id.replace('map_', 'cuny_'),
    'map_owner@example.test'];
  for (const bad of invalid) assert.deepEqual(reviewAuthorization(JSON.stringify([reviewer, bad])), empty);
  assert.deepEqual(reviewAuthorization(JSON.stringify([id, id])), empty);
});

test('one invalid ID or duplicate denies the entire list without partial grants', () => {
  for (const ids of [[owner, 'invalid'], ['invalid', owner], [owner, owner]]) {
    assert.deepEqual(reviewAuthorization(JSON.stringify(ids)), empty);
  }
  const escapedDuplicate = '["' + owner + '","\\u0061' + owner.slice(1) + '"]';
  assert.deepEqual(reviewAuthorization(escapedDuplicate), empty);
});

test('the reviewer limit is inclusive at 20 and denies all 21 entries', () => {
  const ids = Array.from({ length: 20 }, (_, i) => actor(i + 1));
  assert.deepEqual(reviewAuthorization(JSON.stringify(ids)).reviewers, ids);
  assert.deepEqual(reviewAuthorization(JSON.stringify([...ids, actor(21)])), empty);
});

test('configuration cannot mutate shared defaults or add steward roles', () => {
  const config = reviewAuthorization(JSON.stringify([reviewer]));
  assert.throws(() => config.reviewers.push(owner), TypeError);
  assert.throws(() => config.publishers.push(owner), TypeError);
  assert.throws(() => { config.stewards = [owner]; }, TypeError);
  assert.deepEqual(reviewAuthorization(undefined), empty);
  assert.deepEqual(config.publishers, [reviewer]);
  assert.deepEqual(config.stewards, []);
});

test('every reviewer publishes; the publisher list adds more and needs a valid reviewer list', () => {
  const publisher = actor(4), mapPublisher = mapActor(4);
  const config = reviewAuthorization(JSON.stringify([reviewer]), JSON.stringify([publisher, mapPublisher]));
  assert.deepEqual(config, { ...empty, reviewers: [reviewer], publishers: [reviewer, publisher, mapPublisher] });
  assert.throws(() => config.publishers.push(owner), TypeError);
  for (const reviewers of [undefined, '[]', JSON.stringify([reviewer, 'invalid'])]) {
    assert.deepEqual(reviewAuthorization(reviewers, JSON.stringify([publisher])), empty);
  }
});

test('an invalid publisher list adds no publishers and keeps reviewers', () => {
  const many = Array.from({ length: 21 }, (_, i) => actor(i + 10));
  for (const raw of [undefined, '', '[', JSON.stringify(actor(4)), JSON.stringify([actor(4), 'invalid']),
    JSON.stringify([actor(4), actor(4)]), JSON.stringify([actor(4).toUpperCase()]), JSON.stringify(many)]) {
    assert.deepEqual(reviewAuthorization(JSON.stringify([reviewer]), raw), { ...empty, reviewers: [reviewer], publishers: [reviewer] });
  }
  assert.equal(reviewAuthorization(JSON.stringify([reviewer]), JSON.stringify(many.slice(0, 20))).publishers.length, 21);
});

function harness(t, raw, rawPublishers) {
  const native = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
    native.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  t.after(() => native.close());
  const prepare = (sql, args = []) => ({
    bind(...values) { return prepare(sql, values); },
    async first() { return native.prepare(sql).get(...args) || null; },
    async all() { return { results: native.prepare(sql).all(...args) }; },
    async run() { return { success: true, meta: { changes: Number(native.prepare(sql).run(...args).changes) } }; }
  });
  const db = { prepare, async batch(statements) {
    native.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); native.exec('COMMIT'); return results; }
    catch (error) { native.exec('ROLLBACK'); throw error; }
  } };
  return createWorkflowService({ store: createWorkflowStore(db), authorization: reviewAuthorization(raw, rawPublishers) });
}

async function call(service, path, body, identity = owner) {
  const response = await service.handle(new Request('https://map.test/api/contributions/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'oai-authenticated-user-id': identity, origin: 'https://map.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }));
  return { status: response.status, body: await response.json() };
}
const checkStatus = (response, expected) => assert.equal(response.status, expected, JSON.stringify(response.body));
async function submit(service, identity = owner) {
  const original = JSON.stringify({ schema_version: '1.0', type: 'open_proposal', task_ids: [], title: 'Synthetic proposal', summary: 'Exact private wording.', public_credit: { consent: false, label: '' }, sources: [], attachments: [], targets: [], payload: { explanation: 'Exact private wording.' } });
  const response = await call(service, 'submit', { idempotency_key: crypto.randomUUID(), submission_json: original }, identity);
  checkStatus(response, 201);
  assert.equal(response.body.submission.raw_json, original);
  return response.body.submission;
}
const reviewBody = submission => ({ idempotency_key: crypto.randomUUID(), submission_id: submission.id, expected_revision: submission.revision, payload_hash: submission.payload_hash, diff_hash: submission.diff_hash, checks: Object.fromEntries(CHECKS.map(key => [key, 'pass'])), rationale: 'Independent synthetic review.' });

test('configured reviewer may inspect, independently review and publish', async t => {
  const service = harness(t, JSON.stringify([reviewer])), submission = await submit(service);
  checkStatus(await call(service, 'submission?id=' + submission.id, undefined, stranger), 404);
  checkStatus(await call(service, 'submission?id=' + submission.id, undefined, reviewer), 200);
  const dashboard = await call(service, 'dashboard', undefined, reviewer);
  assert.equal(dashboard.body.capabilities.can_review, true);
  assert.equal(dashboard.body.capabilities.can_triage, true);
  assert.equal(dashboard.body.capabilities.can_apply, true);
  const approved = await call(service, 'review', reviewBody(submission), reviewer);
  checkStatus(approved, 200);
  assert.equal(approved.body.submission.status, 'approved');
  // Authorized to publish; a proposal with no map point still cannot change the map.
  const apply = await call(service, 'apply', { idempotency_key: crypto.randomUUID(), submission_id: submission.id, expected_revision: 1, approval_hash: approved.body.submission.approval.approval_hash }, reviewer);
  checkStatus(apply, 409);
  assert.equal(apply.body.error, 'open_proposal_review_only');
});

test('explicit reviewer membership never permits self-approval', async t => {
  const service = harness(t, JSON.stringify([owner])), submission = await submit(service);
  const response = await call(service, 'review', reviewBody(submission));
  checkStatus(response, 403);
  assert.equal(response.body.error, 'self_approval_forbidden');
  const unchanged = await call(service, 'submission?id=' + submission.id);
  assert.equal(unchanged.body.submission.status, 'submitted');
  assert.equal(unchanged.body.submission.approval, null);
});

test('malformed configuration leaves submission available but all reviewer rights disabled', async t => {
  for (const raw of [undefined, JSON.stringify([reviewer, 'invalid']), JSON.stringify([reviewer, reviewer])]) {
    const service = harness(t, raw), submission = await submit(service);
    const dashboard = await call(service, 'dashboard', undefined, reviewer);
    assert.equal(dashboard.body.capabilities.can_review, false);
    assert.equal(dashboard.body.capabilities.can_triage, false);
    assert.equal(dashboard.body.capabilities.can_apply, false);
    assert.deepEqual(dashboard.body.submissions, []);
    checkStatus(await call(service, 'submission?id=' + submission.id, undefined, reviewer), 404);
    const response = await call(service, 'review', reviewBody(submission), reviewer);
    checkStatus(response, 403);
    assert.equal(response.body.error, 'independent_reviewer_unavailable');
  }
});

test('configured map reviewer retains private inspection, independent review and self-review boundaries', async t => {
  const mapOwner = mapActor(1), mapReviewer = mapActor(2), mapStranger = mapActor(3);
  const service = harness(t, JSON.stringify([mapReviewer]));
  const submission = await submit(service, mapOwner);
  checkStatus(await call(service, 'submission?id=' + submission.id, undefined, mapStranger), 404);
  checkStatus(await call(service, 'submission?id=' + submission.id, undefined, mapReviewer), 200);
  const approved = await call(service, 'review', reviewBody(submission), mapReviewer);
  checkStatus(approved, 200);
  assert.equal(approved.body.submission.status, 'approved');
  const apply = await call(service, 'apply', { idempotency_key: crypto.randomUUID(), submission_id: submission.id, expected_revision: 1, approval_hash: approved.body.submission.approval.approval_hash }, mapReviewer);
  checkStatus(apply, 409);
  assert.equal(apply.body.error, 'open_proposal_review_only');
  const own = await submit(service, mapReviewer);
  const self = await call(service, 'review', reviewBody(own), mapReviewer);
  checkStatus(self, 403);
  assert.equal(self.body.error, 'self_approval_forbidden');
  const unchanged = await call(service, 'submission?id=' + own.id, undefined, mapReviewer);
  assert.equal(unchanged.body.submission.status, 'submitted');
  assert.equal(unchanged.body.submission.approval, null);
});

test('a configured publisher reaches apply; freeform proposals stay review-only', async t => {
  const publisher = mapActor(4);
  const service = harness(t, JSON.stringify([reviewer]), JSON.stringify([publisher])), submission = await submit(service);
  const dashboard = await call(service, 'dashboard', undefined, publisher);
  assert.equal(dashboard.body.capabilities.can_apply, true);
  assert.equal(dashboard.body.capabilities.can_review, false);
  const approved = await call(service, 'review', reviewBody(submission), reviewer);
  checkStatus(approved, 200);
  const body = { idempotency_key: crypto.randomUUID(), submission_id: submission.id, expected_revision: 1, approval_hash: approved.body.submission.approval.approval_hash };
  checkStatus(await call(service, 'apply', body, stranger), 403);
  // Authorized, but an open proposal must first become a structured entry before it can change the map.
  const byPublisher = await call(service, 'apply', { ...body, idempotency_key: crypto.randomUUID() }, publisher);
  checkStatus(byPublisher, 409);
  assert.equal(byPublisher.body.error, 'open_proposal_review_only');
});

test('admins hold reviewer and publisher roles and are listed separately', () => {
  const admin = mapActor(9);
  const config = reviewAuthorization(JSON.stringify([reviewer]), undefined, JSON.stringify([admin]));
  assert.deepEqual(config, { reviewers: [reviewer, admin], publishers: [reviewer, admin], stewards: [], admins: [admin] });
  assert.deepEqual(reviewAuthorization(undefined, undefined, JSON.stringify([admin])), { reviewers: [admin], publishers: [admin], stewards: [], admins: [admin] });
  assert.deepEqual(reviewAuthorization(JSON.stringify([reviewer]), undefined, JSON.stringify([admin, 'invalid'])), { ...empty, reviewers: [reviewer], publishers: [reviewer] });
  assert.deepEqual(reviewAuthorization(undefined, undefined, undefined), empty);
});
