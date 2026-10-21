import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleRegistration, REGISTRATION_EVENT, REGISTRATION_LIMITS } from '../server/registration.mjs';

// Synthetic local SQLite behind the D1 interface; no network, mail or hosted data.
function database() {
  const native = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(x => x.endsWith('.sql')).sort()) native.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  const db = { native, failBatch: false, failReadAfterCommit: false, committed: false };
  function prepare(sql, params = []) {
    return {
      bind(...values) { return prepare(sql, values); },
      async first() { if (db.committed && db.failReadAfterCommit) throw Error('synthetic read failure'); return native.prepare(sql).get(...params) || null; },
      async run() { const result = native.prepare(sql).run(...params); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  }
  let tail = Promise.resolve();
  Object.assign(db, { prepare, batch(statements) {
    const operation = tail.then(async () => {
      native.exec('BEGIN');
      try {
        const results = [];
        for (let i = 0; i < statements.length; i++) { results.push(await statements[i].run()); if (db.failBatch && i === 1) throw Error('synthetic transactional failure'); }
        native.exec('COMMIT'); db.committed = true; return results;
      } catch (error) { native.exec('ROLLBACK'); throw error; }
    });
    tail = operation.catch(() => {}); return operation;
  } });
  return db;
}
function fixture(t) { const db = database(); t.after(() => db.native.close()); return db; }
function request(body = { name: 'Synthetic Guest', email: 'synthetic@example.test' }, options = {}) {
  const headers = new Headers({ 'content-type': 'application/json', origin: 'https://map.test', 'sec-fetch-site': 'same-origin', 'idempotency-key': options.key || crypto.randomUUID(), 'cf-connecting-ip': options.ip || '192.0.2.10' });
  for (const [key, value] of Object.entries(options.headers || {})) value === null ? headers.delete(key) : headers.set(key, value);
  const method = options.method || 'POST';
  return new Request(options.url || 'https://map.test/api/register', { method, headers, ...(['GET', 'HEAD'].includes(method) ? {} : { body: options.raw ?? JSON.stringify(body) }) });
}
async function call(db, body, options) { const response = await handleRegistration(request(body, options), { DB: db }); return { status: response.status, headers: response.headers, body: await response.json() }; }
const count = db => db.native.prepare('SELECT COUNT(*) AS n FROM event_registrations').get().n;
const rates = db => db.native.prepare('SELECT * FROM event_registration_limits').all();
const status = (result, expected) => assert.equal(result.status, expected, JSON.stringify(result.body));

test('migration coexists with existing schema and success follows durable readback', async t => {
  const db = fixture(t), input = { name: '  Synthetic Zoë O’Test  ', email: 'Guest@EXAMPLE.TEST' };
  const result = await call(db, input); status(result, 201);
  assert.match(result.body.receipt_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result.body.event, REGISTRATION_EVENT);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(result.body).sort(), ['event', 'ok', 'receipt_id']);
  const row = db.native.prepare('SELECT * FROM event_registrations WHERE id = ?').get(result.body.receipt_id);
  assert.equal(row.name, 'Synthetic Zoë O’Test'); assert.equal(row.email, 'Guest@example.test');
  assert.equal(row.event_id, 'hauntologies-2026-10-30'); assert.ok(Number.isFinite(Date.parse(row.created_at)));
  assert.equal(db.native.prepare('SELECT COUNT(*) AS n FROM workflow_submissions').get().n, 0);
  assert.equal(db.native.prepare('SELECT COUNT(*) AS n FROM approved_records').get().n, 0);
});

test('same key and normalized payload replay one receipt; changed input conflicts without disclosure', async t => {
  const db = fixture(t), key = crypto.randomUUID();
  const first = await call(db, { name: ' Guest ', email: 'guest@EXAMPLE.TEST' }, { key }); status(first, 201);
  const replay = await call(db, { email: 'guest@example.test', name: 'Guest' }, { key }); status(replay, 200);
  assert.deepEqual(replay.body, first.body);
  const conflict = await call(db, { name: 'Different', email: 'guest@example.test' }, { key }); status(conflict, 409);
  assert.deepEqual(conflict.body, { ok: false, error: 'idempotency_conflict' }); assert.equal(count(db), 1);
  assert.ok(rates(db).every(row => row.attempts === 1));
  // Distinct requests never reveal whether the supplied email is already registered.
  const next = await call(db, { name: 'Other guest', email: 'guest@example.test' }); status(next, 201);
  assert.notEqual(next.body.receipt_id, first.body.receipt_id); assert.equal(count(db), 2);
});

test('parallel same-key requests yield one durable row; conflicting parallel payload cannot replace it', async t => {
  const db = fixture(t), key = crypto.randomUUID();
  const same = await Promise.all(Array.from({ length: 8 }, () => call(db, undefined, { key })));
  assert.equal(same.filter(r => r.status === 201).length, 1); assert.ok(same.every(r => [200, 201].includes(r.status)));
  assert.equal(new Set(same.map(r => r.body.receipt_id)).size, 1); assert.equal(count(db), 1);
  const otherKey = crypto.randomUUID();
  const conflicting = await Promise.all(['First', 'Second'].map(name => call(db, { name, email: 'race@example.test' }, { key: otherKey })));
  assert.deepEqual(conflicting.map(r => r.status).sort(), [201, 409]); assert.equal(count(db), 2);
  assert.ok(rates(db).every(row => row.attempts === 2));
});

test('only POST with same-origin JSON is accepted; there is no public attendee read', async t => {
  const db = fixture(t);
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) status(await call(db, undefined, { method }), 405);
  for (const headers of [{ origin: null }, { origin: 'null' }, { origin: 'https://other.test' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) status(await call(db, undefined, { headers }), 403);
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': null }, { 'content-encoding': 'gzip' }]) status(await call(db, undefined, { headers }), 415);
  status(await call(db, undefined, { url: 'https://map.test/api/register/list' }), 404);
  assert.equal(count(db), 0); assert.equal(rates(db).length, 0);
});

test('strict name, email, shape and honeypot validation never stores rejected content', async t => {
  const db = fixture(t), valid = { name: 'Guest', email: 'guest@example.test' };
  const invalid = [null, [], 5, 'string', {}, { ...valid, actor: 'owner' }, { ...valid, website: 'bot' }, { ...valid, website: null },
    ...['', '  ', null, 5, [], 'x'.repeat(121), 'Name\nInjected', 'Name\u0000'].map(name => ({ ...valid, name })),
    ...['', null, 7, [], 'a', 'a@@b.test', 'a@localhost', 'a b@c.test', '.a@b.test', 'a..b@c.test', 'a@-b.test', 'a@b-.test', 'a@b..test', 'a@b.test\nBCC:test@example.test', 'x'.repeat(65) + '@b.test', 'a@' + 'x'.repeat(64) + '.test'].map(email => ({ ...valid, email }))];
  for (const body of invalid) { const result = await call(db, body); status(result, 400); assert.equal(result.body.ok, false); assert.equal('receipt_id' in result.body, false); }
  for (const key of ['', 'short', 'x'.repeat(129), 'has spaces in token']) status(await call(db, valid, { headers: { 'idempotency-key': key } }), 400);
  assert.equal(count(db), 0); assert.equal(rates(db).length, 0);
  status(await call(db, { ...valid, website: '' }), 201);
});

test('stream byte limit applies without trusting Content-Length and invalid UTF-8 is rejected', async t => {
  const db = fixture(t);
  status(await call(db, undefined, { headers: { 'content-length': String(REGISTRATION_LIMITS.body_bytes + 1) } }), 413);
  status(await call(db, undefined, { raw: ' '.repeat(REGISTRATION_LIMITS.body_bytes + 1), headers: { 'content-length': '1' } }), 413);
  status(await call(db, undefined, { raw: JSON.stringify({ name: '😀'.repeat(600), email: 'a@b.test' }) }), 413);
  status(await call(db, undefined, { raw: '{bad json' }), 400);
  status(await call(db, undefined, { raw: new Uint8Array([0xff, 0xfe]) }), 400);
  status(await call(db, undefined, { raw: '{"name":"Guest","email":"guest@example.test","__proto__":{}}' }), 400);
  assert.equal(count(db), 0);
});

test('parameterized fields remain inert text and receipt contains no personal fields', async t => {
  const db = fixture(t), name = "<script>test</script>'; DROP TABLE event_registrations; --";
  const result = await call(db, { name, email: 'synthetic+test@example.test' }); status(result, 201);
  assert.equal(db.native.prepare('SELECT name FROM event_registrations').get().name, name);
  assert.ok(!JSON.stringify(result.body).includes(name)); assert.ok(!JSON.stringify(result.body).includes('synthetic+test'));
});

test('per-client rate budget is atomic, replay does not consume it, and raw IP is not stored', async t => {
  const db = fixture(t), key = crypto.randomUUID();
  const first = await call(db, undefined, { key }); status(first, 201);
  const results = await Promise.all(Array.from({ length: 15 }, () => call(db)));
  assert.equal(results.filter(r => r.status === 201).length, REGISTRATION_LIMITS.per_client - 1);
  assert.ok(results.filter(r => r.status !== 201).every(r => r.status === 429 && Number(r.headers.get('retry-after')) > 0));
  assert.equal(count(db), REGISTRATION_LIMITS.per_client);
  const replay = await call(db, undefined, { key }); status(replay, 200); assert.equal(replay.body.receipt_id, first.body.receipt_id);
  status(await call(db, undefined, { ip: '192.0.2.11' }), 201);
  assert.ok(!JSON.stringify(rates(db)).includes('192.0.2.'));
});

test('global rate budget caps accepted writes and bounds current rate-counter rows', async t => {
  const db = fixture(t);
  const results = await Promise.all(Array.from({ length: REGISTRATION_LIMITS.global + 5 }, (_, i) => call(db, undefined, { ip: '2001:db8::' + i.toString(16) })));
  assert.equal(results.filter(r => r.status === 201).length, REGISTRATION_LIMITS.global);
  assert.equal(results.filter(r => r.status === 429).length, 5);
  assert.equal(count(db), REGISTRATION_LIMITS.global);
  assert.equal(rates(db).length, REGISTRATION_LIMITS.global + 1);
});

test('expired counter rows are pruned and absent IPs share one bounded fallback', async t => {
  const db = fixture(t);
  db.native.prepare('INSERT INTO event_registration_limits VALUES (?, ?, ?)').run('expired', 1, 99);
  for (let i = 0; i < REGISTRATION_LIMITS.per_client; i++) status(await call(db, undefined, { headers: { 'cf-connecting-ip': null } }), 201);
  status(await call(db, undefined, { headers: { 'cf-connecting-ip': 'invalid supplied value' } }), 429);
  assert.equal(rates(db).length, 2); assert.ok(rates(db).every(row => row.window_start > 1));
});

test('transaction failure rolls back registration and counters before returning unavailable', async t => {
  const db = fixture(t); db.failBatch = true;
  const result = await call(db); status(result, 503);
  assert.deepEqual(result.body, { ok: false, error: 'registration_unavailable' }); assert.equal(count(db), 0); assert.equal(rates(db).length, 0);
  status(await call(null), 503);
});

test('uncertain post-commit read failure gives no success; exact retry recovers committed receipt', async t => {
  const db = fixture(t), key = crypto.randomUUID(); db.failReadAfterCommit = true;
  const result = await call(db, undefined, { key }); status(result, 503); assert.equal('receipt_id' in result.body, false);
  assert.equal(count(db), 1); const id = db.native.prepare('SELECT id FROM event_registrations').get().id;
  db.failReadAfterCommit = false;
  const retry = await call(db, undefined, { key }); status(retry, 200); assert.equal(retry.body.receipt_id, id);
  assert.equal(count(db), 1); assert.ok(rates(db).every(row => row.attempts === 1));
});
