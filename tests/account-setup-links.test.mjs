import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, password, replacement } from './fixtures/map-accounts-harness.mjs';

const oldDate = '2000-01-01T00:00:00.000Z';
const code = 'SYNTHETIC-LOCAL-INVITATION';
const daysAgo = days => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

test('unused verification survives its old deadline and reset cleanup while reset links still expire', async t => {
  const h = await harness(t), email = 'later@gc.cuny.edu', existing = 'reset@gc.cuny.edu';
  await h.register(existing);
  assert.equal((await h.call('/api/auth/register', { email })).status, 200);
  assert.equal((await h.db.prepare('SELECT expires_at FROM hny_test_mail WHERE email=?').bind(email).first()).expires_at, null);
  const setup = await h.token(email);
  assert.equal((await h.call('/api/auth/request-reset', { email: existing })).status, 200);
  const reset = await h.token(existing, 'reset_password');
  const resetExpiry = Date.parse((await h.db.prepare("SELECT expires_at FROM hny_test_mail WHERE email=? AND kind='reset_password'").bind(existing).first()).expires_at);
  assert.ok(resetExpiry > Date.now() && resetExpiry <= Date.now() + 30 * 60 * 1000);
  // A 29-day-old invitation, opened long after Better Auth's 30-minute deadline.
  await h.db.prepare('UPDATE hny_auth_verification SET createdAt=?, expiresAt=?').bind(daysAgo(29), oldDate).run();
  const rejected = await h.call('/api/auth/reset', { token: reset, password: replacement });
  assert.equal(rejected.status, 400); assert.equal(rejected.cookie, '');
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_auth_verification').first()).n, 1);
  const completed = await h.call('/api/auth/verify', { token: setup, password });
  assert.equal(completed.status, 200, JSON.stringify(completed.body)); assert.ok(completed.cookie);
  assert.equal((await h.call('/api/auth/verify', { token: setup, password })).status, 400);
  assert.equal((await h.call('/api/auth/sign-in', { email: existing, password })).status, 200);
});

test('an old guest invitation requires current admission and rejected guesses preserve the proof', async t => {
  const h = await harness(t), email = 'guest@example.test';
  await h.call('/api/auth/register', { email });
  const token = await h.token(email);
  await h.db.prepare('UPDATE hny_auth_verification SET expiresAt=?').bind(oldDate).run();
  await h.configureEligibility(true, code);
  for (const access_code of [undefined, 'wrong']) {
    const result = await h.call('/api/auth/verify', { token, password, ...(access_code ? { access_code } : {}) });
    assert.equal(result.status, 403); assert.equal(result.cookie, '');
    assert.equal((await h.db.prepare('SELECT expiresAt FROM hny_auth_verification').first()).expiresAt, oldDate);
  }
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_auth_user').first()).n, 0);
  assert.equal((await h.call('/api/auth/verify', { token, password, access_code: code })).status, 200);
  assert.equal((await h.call('/api/auth/verify', { token, password, access_code: code })).status, 400);
});

test('creating a password invalidates every earlier setup link for that address', async t => {
  const h = await harness(t), email = 'several@gc.cuny.edu';
  await h.call('/api/auth/register', { email }); const first = await h.token(email);
  await h.call('/api/auth/register', { email }); const second = await h.token(email);
  const preserved = await h.db.prepare('SELECT * FROM hny_auth_verification ORDER BY createdAt DESC LIMIT 1').first();
  const complete = await h.call('/api/auth/verify', { token: first, password });
  assert.equal(complete.status, 200);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_auth_verification').first()).n, 0);
  assert.equal((await h.call('/api/auth/verify', { token: second, password: replacement })).status, 400);
  // A residual historical proof must also fail before issuing another session.
  await h.db.prepare('INSERT INTO hny_auth_verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)')
    .bind(preserved.id, preserved.identifier, preserved.value, oldDate, daysAgo(1), oldDate).run();
  const residual = await h.call('/api/auth/verify', { token: second, password: replacement });
  assert.equal(residual.status, 409); assert.equal(residual.cookie, '');
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_auth_session').first()).n, 1);
  assert.equal((await h.call('/api/auth/sign-in', { email, password })).status, 200);
  assert.equal((await h.call('/api/auth/sign-in', { email, password: replacement })).status, 401);
});

test('setup links expire 30 days after issue and expired rows are removed', async t => {
  const h = await harness(t), email = 'month@gc.cuny.edu', unreadable = 'unreadable@gc.cuny.edu';
  await h.call('/api/auth/register', { email }); const stale = await h.token(email);
  await h.db.prepare('UPDATE hny_auth_verification SET createdAt=?, expiresAt=?').bind(daysAgo(31), oldDate).run();
  const expired = await h.call('/api/auth/verify', { token: stale, password });
  assert.equal(expired.status, 400); assert.equal(expired.cookie, '');
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_auth_verification').first()).n, 0);
  // An issue time the cleanup cannot read still fails closed at verification.
  await h.call('/api/auth/register', { email: unreadable }); const odd = await h.token(unreadable);
  await h.db.prepare('UPDATE hny_auth_verification SET createdAt=?').bind('not-a-date').run();
  assert.equal((await h.call('/api/auth/verify', { token: odd, password })).status, 400);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_auth_user').first()).n, 0);
  // A fresh link for the same address works.
  await h.call('/api/auth/register', { email }); const fresh = await h.token(email);
  assert.notEqual(fresh, stale);
  assert.equal((await h.call('/api/auth/verify', { token: fresh, password })).status, 200);
});
