import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleRegistrationDashboard } from '../server/registration-dashboard.mjs';
import { REGISTRATION_EVENT } from '../server/registration.mjs';

const ownerSubject = 'cail-' + 'a'.repeat(32);
const principal = { subject: ownerSubject, actor_id: 'synthetic-owner' };
const otherSubject = 'cail-' + 'b'.repeat(32);
const createdAt = '2026-10-22T12:00:00.000Z';
const identifier = n => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const cursorFor = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function fixture(t) {
  const native = new DatabaseSync(':memory:');
  native.exec(readFileSync(new URL('../drizzle/0004_registration.sql', import.meta.url), 'utf8'));
  t.after(() => native.close());
  const db = { native, reads: [], failure: null };
  function prepare(sql, values = []) {
    if (db.failure === 'prepare') throw Error('synthetic failure with private context');
    return {
      bind(...params) { return prepare(sql, params); },
      async all() {
        db.reads.push({ sql, values });
        if (db.failure === 'throw') throw Error('synthetic failure with private context');
        if (db.failure === 'unsuccessful') return { success: false, results: [] };
        if (db.failure === 'missing') return { success: true };
        if (db.failure === 'malformed') return { success: true, results: [{ name: 'Private', email: 'hidden@example.test' }] };
        return { success: true, results: native.prepare(sql).all(...values) };
      },
    };
  }
  db.prepare = prepare;
  db.insert = (n, { event = REGISTRATION_EVENT.id, at = createdAt, name = 'Synthetic Guest ' + n, email = 'guest' + n + '@example.test' } = {}) => {
    native.prepare('INSERT INTO event_registrations VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(identifier(n), event, 'synthetic-key-' + n, 'synthetic-payload-' + n, name, email, at);
  };
  return db;
}

async function call(DB, options = {}) {
  const request = new Request('https://map.test' + (options.path ?? '/api/admin/registrations') + (options.query ?? ''), {
    method: options.method ?? 'GET', headers: options.headers,
  });
  const response = await handleRegistrationDashboard(request, { DB, principal, ownerSubject, ...options.context });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test('missing, unverified-shaped, and wrong-owner callers are rejected before database access', async () => {
  let access = 0;
  const DB = new Proxy({}, { get() { access++; throw Error('DB must not be touched'); } });
  for (const value of [undefined, null, false, [], {}, { subject: 'owner' }, { subject: ownerSubject.toUpperCase() }, { subject: ' ' + ownerSubject }, { subject: ownerSubject + '\n' }, { verified: true }]) {
    const result = await call(DB, { context: { principal: value } });
    assert.equal(result.status, 401); assert.deepEqual(result.body, { ok: false, error: 'authentication_required' });
  }
  for (const value of [undefined, null, '', ' ' + ownerSubject, ownerSubject + '\n', ownerSubject.toUpperCase(), otherSubject]) {
    const result = await call(DB, { context: { ownerSubject: value } });
    assert.equal(result.status, 403); assert.deepEqual(result.body, { ok: false, error: 'forbidden' });
  }
  assert.equal((await call(DB, { context: { principal: { subject: otherSubject, actor_id: 'other' } } })).status, 403);
  // Request headers do not supply the trusted adapter result.
  assert.equal((await call(DB, { headers: { 'x-authenticated-user-id': ownerSubject, 'cf-access-authenticated-user-email': 'owner@example.test' }, context: { principal: null } })).status, 401);
  assert.equal(access, 0);
});

test('exact GET route only, with private no-store responses and no DB on rejected paths', async () => {
  let touched = false;
  const DB = new Proxy({}, { get() { touched = true; throw Error('unexpected DB access'); } });
  for (const method of ['HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const result = await call(DB, { method });
    assert.equal(result.status, 405); assert.equal(result.headers.get('allow'), 'GET');
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  }
  for (const path of ['/api/register', '/api/admin/registrations/', '/api/admin/registrations/all']) assert.equal((await call(DB, { path })).status, 404);
  assert.equal(touched, false);
});

test('owner sees only current event and minimal fields with exact stored text preserved', async t => {
  const db = fixture(t), name = "Zoë <script>inert</script> O’Test", email = 'Original.Case@example.test';
  db.insert(1, { name, email }); db.insert(2, { event: 'another-event', name: 'Other private guest' });
  const result = await call(db);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { registrations: [{ name, email, created_at: createdAt }], next_cursor: null });
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(db.reads[0].values, [REGISTRATION_EVENT.id, 26]);
  assert.doesNotMatch(db.reads[0].sql, /hash|SELECT\s+\*/i);
  assert.equal(db.native.prepare('SELECT COUNT(*) AS n FROM event_registrations').get().n, 2);
  assert.equal(db.native.prepare('SELECT COUNT(*) AS n FROM event_registration_limits').get().n, 0);
});

test('empty event returns an empty list and no cursor', async t => {
  const db = fixture(t);
  assert.deepEqual((await call(db)).body, { registrations: [], next_cursor: null });
});

test('default and maximum page limits are bounded and final exact-size page has no cursor', async t => {
  const db = fixture(t);
  for (let n = 1; n <= 60; n++) db.insert(n);
  const first = await call(db);
  assert.equal(first.body.registrations.length, 25); assert.equal(typeof first.body.next_cursor, 'string');
  const maximum = await call(db, { query: '?limit=50' });
  assert.equal(maximum.body.registrations.length, 50); assert.equal(db.reads.at(-1).values.at(-1), 51);
  const last = await call(db, { query: '?limit=10&cursor=' + maximum.body.next_cursor });
  assert.equal(last.body.registrations.length, 10); assert.equal(last.body.next_cursor, null);
});

test('created_at/id keyset is stable through ties, deleted cursor rows and newer insertions', async t => {
  const db = fixture(t);
  for (let n = 1; n <= 5; n++) db.insert(n);
  db.insert(6, { at: '2026-10-23T00:00:00.000Z' });
  db.insert(7, { at: '2026-10-21T00:00:00.000Z' });
  const first = await call(db, { query: '?limit=3' });
  assert.deepEqual(first.body.registrations.map(row => row.name), ['Synthetic Guest 6', 'Synthetic Guest 5', 'Synthetic Guest 4']);
  assert.match(first.body.next_cursor, /^[A-Za-z0-9_-]+$/);
  db.native.prepare('DELETE FROM event_registrations WHERE id = ?').run(identifier(4));
  db.insert(8, { at: '2026-10-24T00:00:00.000Z' });
  const second = await call(db, { query: '?limit=3&cursor=' + first.body.next_cursor });
  assert.deepEqual(second.body.registrations.map(row => row.name), ['Synthetic Guest 3', 'Synthetic Guest 2', 'Synthetic Guest 1']);
  const last = await call(db, { query: '?limit=3&cursor=' + second.body.next_cursor });
  assert.deepEqual(last.body.registrations.map(row => row.name), ['Synthetic Guest 7']);
  assert.equal(last.body.next_cursor, null);
});

test('query, limit and strict cursor errors fail before DB; inputs never become SQL', async t => {
  const db = fixture(t), cursor = { v: 1, created_at: createdAt, id: identifier(1) };
  for (const query of ['?event_id=other', '?limit=1&limit=2', '?cursor=x&cursor=y', '?sql=DROP%20TABLE']) {
    const result = await call(db, { query }); assert.equal(result.status, 400); assert.equal(result.body.error, 'invalid_query');
  }
  for (const limit of ['', '0', '-1', '51', '100', '01', '1.5', '1e1', 'NaN', 'Infinity', '1%20', '1%3BSELECT']) {
    const result = await call(db, { query: '?limit=' + limit }); assert.equal(result.status, 400); assert.equal(result.body.error, 'invalid_limit');
  }
  const badCursors = ['', 'a'.repeat(257), 'abc=', '%2B/', 'not-json',
    ...[null, [], {}, { ...cursor, extra: true }, { ...cursor, v: 2 }, { ...cursor, v: '1' }, { ...cursor, id: "x'; SELECT *" }, { ...cursor, id: cursor.id + '\n' },
      { ...cursor, created_at: '2026-02-30T00:00:00.000Z' }, { ...cursor, created_at: '2026-10-22T12:00:00Z' }].map(cursorFor),
    cursorFor({ id: cursor.id, created_at: cursor.created_at, v: 1 }),
  ];
  for (const value of badCursors) {
    const result = await call(db, { query: '?cursor=' + value }); assert.equal(result.status, 400, value); assert.equal(result.body.error, 'invalid_cursor');
  }
  assert.equal(db.reads.length, 0);
});

test('a syntactically valid cursor cannot change the fixed event scope or query', async t => {
  const db = fixture(t); db.insert(1); db.insert(2, { event: 'another-event' });
  const cursor = cursorFor({ v: 1, created_at: '2027-01-01T00:00:00.000Z', id: identifier(99) });
  const result = await call(db, { query: '?limit=1&cursor=' + cursor });
  assert.equal(result.status, 200); assert.deepEqual(result.body.registrations.map(row => row.name), ['Synthetic Guest 1']);
  assert.deepEqual(db.reads[0].values, [REGISTRATION_EVENT.id, '2027-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', identifier(99), 2]);
});

test('missing DB, read failures and malformed D1 results return no private data or success', async t => {
  const db = fixture(t);
  for (const missing of [null, undefined, {}, { prepare: true }]) {
    const result = await call(missing); assert.equal(result.status, 503); assert.deepEqual(result.body, { ok: false, error: 'registrations_unavailable' });
  }
  for (const failure of ['prepare', 'throw', 'unsuccessful', 'missing', 'malformed']) {
    db.failure = failure;
    const result = await call(db); assert.equal(result.status, 503); assert.deepEqual(result.body, { ok: false, error: 'registrations_unavailable' });
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  }
});
