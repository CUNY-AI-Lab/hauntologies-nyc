import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createCunyIdentity, cunyReadiness, CUNY_ISSUER, CUNY_AUDIENCE, CUNY_ORIGIN, CUNY_SESSION_COOKIE as SESSION, CUNY_LOGIN_COOKIE as LOGIN } from '../deployment/cuny-identity.mjs';

// Local synthetic keys, subjects and RPC doubles only. No live CUNY session,
// production identity, grants, keys, network requests or database writes.
const NOW = Date.parse('2026-10-22T12:00:00Z');
const SUBJECT = 'cail-' + '1'.repeat(32), OTHER = 'cail-' + '2'.repeat(32);
const keyPair = await generateKeyPair('RS256');
const publicKey = { ...await exportJWK(keyPair.publicKey), kid: 'synthetic', alg: 'RS256', use: 'sig' };
const JWKS = JSON.stringify({ keys: [publicKey] });
const proof = char => char.repeat(43);
const token = () => crypto.randomUUID() + '.' + proof('a');
const sha = value => createHash('sha256').update(value).digest('base64url');
const body = async response => ({ status: response.status, json: await response.json() });
async function signed(overrides = {}, header = {}, key = keyPair.privateKey) {
  const payload = { iss: CUNY_ISSUER, aud: CUNY_AUDIENCE, sub: SUBJECT, iat: NOW / 1000, exp: NOW / 1000 + 300, log_sub: 'cail-v1-' + '3'.repeat(32), ...overrides };
  for (const name of Object.keys(payload)) if (payload[name] === undefined) delete payload[name];
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'synthetic', ...header }).sign(key);
}
function request(path = '/api/contributions/session', options = {}) {
  return new Request(CUNY_ORIGIN + path, options);
}
const withSession = (value, more = {}) => ({ headers: { cookie: `${SESSION}=${value}`, ...more } });
const setCookies = response => response.headers.getSetCookie();
const savedCookie = (response, name) => setCookies(response).find(value => value.startsWith(name + '='))?.split(';')[0];
const cookieValue = pair => pair.slice(pair.indexOf('=') + 1);
const hasSessionInstall = response => setCookies(response).some(value => value.startsWith(SESSION + '=') && !value.includes('Max-Age=0'));
function harness(options = {}) {
  let current = NOW;
  const calls = { begin: [], redeem: [], identities: [], revoke: [] }, codes = new Map(), sessions = new Set();
  const active = token(); sessions.add(active);
  const identity = {
    async begin(challenge, state) {
      calls.begin.push({ challenge, state });
      const id = crypto.randomUUID(); codes.set(id, { challenge, state, used: false });
      return { url: `https://tools.ailab.gc.cuny.edu/worker-login?request=${id}` };
    },
    async redeem(code, verifier) {
      calls.redeem.push({ code, verifier });
      const saved = codes.get(code);
      if (!saved || saved.used || saved.challenge !== sha(verifier)) return { ok: false, status: 401 };
      saved.used = true;
      const next = token(); sessions.add(next);
      return { ok: true, token: next, expiresAt: current + 3600000 };
    },
    async identities(value) {
      calls.identities.push(value);
      return sessions.has(value) ? { ok: true, appJwt: await signed(options.claims), gatewayJwt: 'must-not-be-used' } : { ok: false, status: 401 };
    },
    async revoke(value) { calls.revoke.push(value); sessions.delete(value); return { revoked: true }; }
  };
  const env = { CONTRIBUTIONS_CUNY_ENABLED: 'true', IDENTITY: identity, CAIL_IDENTITY_JWKS: JWKS };
  const adapter = createCunyIdentity({ now: () => current, rpcTimeoutMs: 30 });
  return { adapter, env, identity, calls, codes, sessions, active, advance: ms => { current += ms; } };
}
async function begin(h, path = '/auth/start') {
  const response = await h.adapter.handleAuth(request(path), h.env);
  assert.equal(response.status, 303);
  const pair = savedCookie(response, LOGIN), saved = JSON.parse(decodeURIComponent(cookieValue(pair)));
  const code = new URL(response.headers.get('location')).searchParams.get('request');
  return { response, pair, saved, code, path: `/auth/callback?code=${code}&state=${saved.state}` };
}
const callback = (h, started, cookie = started.pair, path = started.path) => h.adapter.handleAuth(request(path, { headers: { cookie, 'sec-fetch-site': 'cross-site' } }), h.env);

test('configuration is closed by default and readiness reveals only booleans', () => {
  const h = harness();
  assert.deepEqual(cunyReadiness(h.env), { configured: true, ownerConfigured: false });
  assert.deepEqual(cunyReadiness({ ...h.env, CONTRIBUTIONS_CUNY_OWNER_SUBJECT: SUBJECT }), { configured: true, ownerConfigured: true });
  for (const env of [{}, { ...h.env, CONTRIBUTIONS_CUNY_ENABLED: true }, { ...h.env, CONTRIBUTIONS_CUNY_ENABLED: 'false' },
    { ...h.env, IDENTITY: {} }, { ...h.env, CAIL_IDENTITY_JWKS: undefined }, { ...h.env, CAIL_IDENTITY_JWKS: '{' }]) {
    assert.deepEqual(cunyReadiness(env), { configured: false, ownerConfigured: false });
  }
  for (const owner of [null, {}, 'zach.muhlbauer', 'admin', SUBJECT + '\n', SUBJECT.toUpperCase()]) {
    assert.equal(cunyReadiness({ ...h.env, CONTRIBUTIONS_CUNY_OWNER_SUBJECT: owner }).ownerConfigured, false);
  }
});

test('only bounded public RSA verification keys are accepted', () => {
  const h = harness();
  for (const keys of [[], [null], [publicKey, publicKey], [{ ...publicKey, d: 'private-material' }],
    [{ ...publicKey, kty: 'oct', k: 'secret' }], [{ ...publicKey, alg: 'HS256' }], [{ ...publicKey, use: 'enc' }],
    [{ ...publicKey, key_ops: ['sign'] }], [{ ...publicKey, x5u: 'https://attacker.test/key' }],
    [{ ...publicKey, n: 'AQAB' }], [{ ...publicKey, n: publicKey.n + '\n' }],
    Array.from({ length: 9 }, (_, i) => ({ ...publicKey, kid: String(i) }))]) {
    assert.equal(cunyReadiness({ ...h.env, CAIL_IDENTITY_JWKS: JSON.stringify({ keys }) }).configured, false);
  }
  assert.equal(cunyReadiness({ ...h.env, CAIL_IDENTITY_JWKS: JSON.stringify({ keys: [publicKey], extra: true }) }).configured, false);
  assert.equal(cunyReadiness({ ...h.env, CAIL_IDENTITY_JWKS: ' '.repeat(32769) }).configured, false);
});

test('a verified subject produces a stable opaque actor but no first-login ownership', async () => {
  const h = harness(), req = request(undefined, withSession(h.active));
  const principal = await h.adapter.authenticate(req, h.env);
  assert.equal(principal.subject, SUBJECT);
  assert.match(principal.actor_id, /^cuny_[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(principal), ['subject', 'actor_id']);
  assert.equal(h.adapter.isOwner(principal, h.env), false);
  const ownerEnv = { ...h.env, CONTRIBUTIONS_CUNY_OWNER_SUBJECT: SUBJECT };
  assert.equal(h.adapter.isOwner(principal, ownerEnv), true);
  assert.equal(h.adapter.isOwner({ ...principal }, ownerEnv), false);
  assert.equal(h.adapter.isOwner(principal, { ...ownerEnv, CONTRIBUTIONS_CUNY_OWNER_SUBJECT: OTHER }), false);
  assert.equal(h.adapter.isOwner(principal, { ...ownerEnv, CONTRIBUTIONS_CUNY_ENABLED: 'false' }), false);
  assert.equal(h.adapter.isOwner(principal, { ...ownerEnv, IDENTITY: { ...h.identity } }), false);
  assert.equal(h.adapter.isOwner(principal, { ...ownerEnv, CAIL_IDENTITY_JWKS: JWKS + ' ' }), false);
  const again = await createCunyIdentity({ now: () => NOW }).authenticate(req, h.env);
  assert.deepEqual(again, principal);
  h.advance(300000);
  assert.equal(h.adapter.isOwner(principal, ownerEnv), false);
});

test('Gateway/workspace tokens and role-like claims confer no authority', async () => {
  const h = harness(), appJwt = await signed({ role: 'admin', email: 'untrusted@example.test' });
  h.identity.identities = async () => {
    const result = { ok: true, appJwt };
    Object.defineProperties(result, { gatewayJwt: { get() { throw new Error('Gateway must not be read'); } }, workspaceJwt: { get() { throw new Error('Workspace must not be read'); } } });
    return result;
  };
  const principal = await h.adapter.authenticate(request(undefined, withSession(h.active)), h.env);
  assert.equal(principal.subject, SUBJECT);
  assert.equal(h.adapter.isOwner(principal, h.env), false);
});

test('wrong issuer, audience, subject, times and app claims fail closed', async () => {
  const h = harness(), req = request(undefined, withSession(h.active));
  const invalid = [{ iss: 'https://attacker.test' }, { aud: 'cail:gateway' }, { aud: [CUNY_AUDIENCE] },
    { aud: [CUNY_AUDIENCE, 'cail:gateway'] }, { sub: 'zach.muhlbauer' }, { sub: SUBJECT + '\n' }, { sub: SUBJECT.toUpperCase() },
    { iat: undefined }, { exp: undefined }, { sub: undefined }, { iat: NOW / 1000 + 1 }, { exp: NOW / 1000 },
    { exp: NOW / 1000 + 301 }, { exp: NOW / 1000 + 299.5 }, { iat: NOW / 1000 - 0.5 },
    { nbf: NOW / 1000 + 1 }, { nbf: NOW / 1000 - 0.5 }, { log_sub: 'invalid' }, { tool: 'agent-studio' }];
  for (const claims of invalid) {
    const appJwt = await signed(claims);
    h.identity.identities = async () => ({ ok: true, appJwt });
    assert.equal(await h.adapter.authenticate(req, h.env), null, JSON.stringify(claims));
  }
});

test('signature, key ID, algorithm and unsigned tokens are verified', async () => {
  const h = harness(), req = request(undefined, withSession(h.active));
  const otherKeys = await generateKeyPair('RS256');
  const tokens = [await signed({}, {}, otherKeys.privateKey), await signed({}, { kid: 'other' }),
    await signed({}, { alg: 'HS256' }, new Uint8Array(32)), 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.', 'x'.repeat(16385)];
  for (const appJwt of tokens) {
    h.identity.identities = async () => ({ ok: true, appJwt });
    assert.equal(await h.adapter.authenticate(req, h.env), null);
  }
});

test('cookies are exact and unique; client identity headers never authenticate', async () => {
  const h = harness();
  for (const value of [undefined, `${SESSION}=`, `${SESSION}=${h.active}; ${SESSION}=${h.active}`, `${SESSION} =${h.active}`,
    `${SESSION}=${h.active}; ${SESSION} =${h.active}`, `${SESSION}=${h.active}x`, `${SESSION}=not-a-token`, 'x'.repeat(8193)]) {
    const headers = { ...(value === undefined ? {} : { cookie: value }), 'oai-authenticated-user-id': SUBJECT, 'cf-access-jwt-assertion': 'forged', 'x-cail-identity': await signed() };
    assert.equal(await h.adapter.authenticate(request(undefined, { headers }), h.env), null);
  }
  assert.equal(h.calls.identities.length, 0);
  assert.equal(await h.adapter.authenticate(new Request('https://other.test/api/contributions/session', withSession(h.active)), h.env), null);
});

test('revoked sessions, RPC failures, deadlines and aborted requests deny access', async () => {
  const h = harness(), req = request(undefined, withSession(h.active));
  for (const result of [null, {}, { ok: false, status: 403 }, { ok: false, status: 401 }, { ok: true }, { ok: true, appJwt: 5 }]) {
    h.identity.identities = async () => result;
    assert.equal(await h.adapter.authenticate(req, h.env), null);
  }
  h.identity.identities = async () => { throw new Error('DO NOT EXPOSE THIS'); };
  assert.equal(await h.adapter.authenticate(req, h.env), null);
  h.identity.identities = () => new Promise(() => {});
  const started = Date.now();
  assert.equal(await h.adapter.authenticate(req, h.env), null);
  assert.ok(Date.now() - started < 1000);
  let called = 0; h.identity.identities = async () => { called++; return { ok: true, appJwt: await signed() }; };
  const controller = new AbortController(); controller.abort();
  assert.equal(await h.adapter.authenticate(request(undefined, { ...withSession(h.active), signal: controller.signal }), h.env), null);
  assert.equal(called, 0);
});

test('login routes are fixed, default off, and reject unsafe methods, origins and redirects', async () => {
  const h = harness();
  assert.equal(await h.adapter.handleAuth(request('/'), h.env), null);
  assert.equal((await h.adapter.handleAuth(request('/auth/start'), {})).status, 503);
  for (const path of ['/auth/start?returnTo=https://evil.test', '/auth/start?returnTo=//evil.test', '/auth/start?returnTo=%2F%5Cevil.test',
    '/auth/start?returnTo=/', '/auth/start?returnTo=/dashboard']) {
    const response = await h.adapter.handleAuth(request(path), h.env);
    assert.equal(response.status, path.endsWith('=/') || path.endsWith('=/dashboard') ? 303 : 400);
  }
  for (const path of ['/auth/start?returnTo=/&returnTo=/', '/auth/start?extra=1']) assert.equal((await h.adapter.handleAuth(request(path), h.env)).status, 400);
  assert.equal((await h.adapter.handleAuth(request('/auth/start', { method: 'POST' }), h.env)).status, 405);
  assert.equal((await h.adapter.handleAuth(request('/auth/callback', { method: 'HEAD' }), h.env)).status, 405);
  assert.equal((await h.adapter.handleAuth(request('/auth/start', { headers: { origin: 'https://evil.test' } }), h.env)).status, 403);
  assert.equal((await h.adapter.handleAuth(request('/auth/start', { headers: { 'sec-fetch-site': 'cross-site' } }), h.env)).status, 403);
  assert.equal((await h.adapter.handleAuth(new Request('http://hauntologies-nyc.ailab-452.workers.dev/auth/start'), h.env)).status, 400);
});

test('PKCE starts with a bounded secure host-only cookie and an exact Doorway URL', async () => {
  const h = harness(), start = await begin(h);
  assert.equal(start.saved.returnTo, '/dashboard');
  assert.equal(start.saved.expiresAt, NOW + 600000);
  assert.equal(h.calls.begin[0].challenge, sha(start.saved.verifier));
  assert.equal(h.calls.begin[0].state, start.saved.state);
  assert.notEqual(start.saved.verifier, start.saved.state);
  const header = setCookies(start.response)[0];
  for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Max-Age=600']) assert.ok(header.includes(attribute));
  assert.equal(header.includes('Domain='), false);
  assert.equal(start.response.headers.get('cache-control'), 'private, no-store');
  assert.equal(start.response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await start.response.text(), '');
});

test('untrusted Doorway redirect shapes never reach the browser', async () => {
  const h = harness(), id = crypto.randomUUID();
  for (const url of [`https://evil.test/worker-login?request=${id}`, `https://tools.ailab.gc.cuny.edu/other?request=${id}`,
    `https://user:pass@tools.ailab.gc.cuny.edu/worker-login?request=${id}`, `https://tools.ailab.gc.cuny.edu/worker-login?request=${id}#x`,
    `https://tools.ailab.gc.cuny.edu/worker-login?request=${id}&request=${id}`, `https://tools.ailab.gc.cuny.edu/worker-login?request=${id}&next=evil`,
    'https://tools.ailab.gc.cuny.edu/worker-login?request=invalid', 'not-a-url']) {
    h.identity.begin = async () => ({ url });
    const response = await h.adapter.handleAuth(request('/auth/start'), h.env);
    assert.equal(response.status, 503); assert.equal(response.headers.get('location'), null); assert.deepEqual(setCookies(response), []);
  }
});

test('valid callback installs only the opaque session and consumes its one-use code', async () => {
  const h = harness(), start = await begin(h), response = await callback(h, start);
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/dashboard');
  assert.equal(hasSessionInstall(response), true);
  assert.ok(savedCookie(response, LOGIN).endsWith('='));
  const pair = savedCookie(response, SESSION);
  assert.match(cookieValue(pair), /^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.ok(setCookies(response).some(value => value.includes('Max-Age=3600')));
  const principal = await h.adapter.authenticate(request(undefined, { headers: { cookie: pair } }), h.env);
  assert.equal(principal.subject, SUBJECT);
  assert.equal(h.adapter.isOwner(principal, h.env), false);
  assert.equal((await callback(h, start)).status, 401);
  const home = await begin(h, '/auth/start?returnTo=/');
  assert.equal((await callback(h, home)).headers.get('location'), '/');
});

test('callback rejects duplicate/unknown params and invalid state/code before redemption', async () => {
  const h = harness(), start = await begin(h);
  for (const path of ['/auth/callback', start.path + '&state=' + start.saved.state, start.path + '&code=' + start.code,
    start.path + '&returnTo=/dashboard', start.path.replace(start.saved.state, proof('z')),
    start.path.replace(start.code, 'invalid'), start.path.replace(start.code, start.code + '%0A')]) {
    const response = await callback(h, start, start.pair, path);
    assert.equal(response.status, 401); assert.equal(hasSessionInstall(response), false);
    assert.ok(setCookies(response)[0].includes('Max-Age=0'));
  }
  assert.equal(h.calls.redeem.length, 0);
});

test('callback requires one intact unexpired login cookie and a safe return destination', async () => {
  const h = harness(), start = await begin(h);
  const encode = value => `${LOGIN}=${encodeURIComponent(JSON.stringify(value))}`;
  const invalid = ['', `${start.pair}; ${start.pair}`, `${LOGIN}=%`, encode({ ...start.saved, expiresAt: NOW }),
    encode({ ...start.saved, expiresAt: NOW + 600001 }), encode({ ...start.saved, returnTo: '//evil.test' }),
    encode({ ...start.saved, extra: true }), encode({ ...start.saved, verifier: start.saved.verifier + '\n' }),
    `${start.pair}; ${SESSION}=${h.active}; ${SESSION}=${h.active}`];
  for (const value of invalid) {
    const response = await callback(h, start, value);
    assert.equal(response.status, 401); assert.equal(hasSessionInstall(response), false);
  }
  assert.equal(h.calls.redeem.length, 0);
});

test('a concurrent callback can install a session only once', async () => {
  const h = harness(), start = await begin(h);
  const responses = await Promise.all([callback(h, start), callback(h, start)]);
  assert.deepEqual(responses.map(value => value.status).sort(), [303, 401]);
  assert.equal(responses.filter(hasSessionInstall).length, 1);
});

test('callback verifies the app identity and never installs invalid or uncertain redemption results', async () => {
  const h = harness(), start = await begin(h);
  h.identity.identities = async () => ({ ok: true, appJwt: await signed({ aud: 'cail:gateway' }) });
  const invalidJwt = await callback(h, start);
  assert.equal(invalidJwt.status, 503); assert.equal(hasSessionInstall(invalidJwt), false); assert.equal(h.calls.revoke.length, 1);
  for (const result of [null, { ok: false, status: 401 }, { ok: true, token: 'bad', expiresAt: NOW + 1000 }, { ok: true, token: token(), expiresAt: NOW }]) {
    const next = await begin(h); h.identity.redeem = async () => result;
    const response = await callback(h, next);
    assert.equal(response.status, 401); assert.equal(hasSessionInstall(response), false);
  }
});

test('session replacement retires the old token before installation and rejects uncertain retirement', async () => {
  const h = harness(), start = await begin(h);
  const response = await callback(h, start, `${start.pair}; ${SESSION}=${h.active}`);
  assert.equal(response.status, 303); assert.deepEqual(h.calls.revoke, [h.active]); assert.equal(h.sessions.has(h.active), false);
  const next = await begin(h), previous = cookieValue(savedCookie(response, SESSION));
  const attempts = [];
  h.identity.revoke = async value => { attempts.push(value); if (value === previous) throw new Error('uncertain'); return { revoked: true }; };
  const failed = await callback(h, next, `${next.pair}; ${SESSION}=${previous}`);
  assert.equal(failed.status, 503); assert.equal(hasSessionInstall(failed), false); assert.equal(attempts.length, 2);
  assert.equal(attempts[0], previous); assert.notEqual(attempts[1], previous);
});

test('logout confirms revocation with 204 and clears both cookies', async () => {
  const h = harness();
  const response = await h.adapter.handleAuth(request('/auth/logout', { method: 'POST', headers: { cookie: `${SESSION}=${h.active}`, origin: CUNY_ORIGIN, 'sec-fetch-site': 'same-origin' } }), h.env);
  assert.equal(response.status, 204); assert.equal(await response.text(), ''); assert.deepEqual(h.calls.revoke, [h.active]);
  assert.equal(setCookies(response).length, 2); assert.ok(setCookies(response).every(value => value.includes('Max-Age=0')));
  assert.equal(await h.adapter.authenticate(request(undefined, withSession(h.active)), h.env), null);
});

test('logout rejects CSRF and reports uncertain revocation honestly while clearing browser cookies', async () => {
  const h = harness();
  for (const headers of [{}, { origin: 'https://evil.test' }, { origin: CUNY_ORIGIN, 'sec-fetch-site': 'cross-site' }, { origin: CUNY_ORIGIN, 'sec-fetch-site': 'same-site' }]) {
    const response = await h.adapter.handleAuth(request('/auth/logout', { method: 'POST', headers: { cookie: `${SESSION}=${h.active}`, ...headers } }), h.env);
    assert.equal(response.status, 403); assert.deepEqual(setCookies(response), []);
  }
  assert.equal(h.calls.revoke.length, 0);
  assert.equal((await h.adapter.handleAuth(request('/auth/logout'), h.env)).status, 405);
  h.identity.revoke = async () => { throw new Error('PRIVATE RPC FAILURE'); };
  const failed = await h.adapter.handleAuth(request('/auth/logout', { method: 'POST', headers: { cookie: `${SESSION}=${h.active}`, origin: CUNY_ORIGIN } }), h.env);
  assert.equal(failed.status, 503); assert.ok(setCookies(failed).every(value => value.includes('Max-Age=0')));
  assert.deepEqual(await failed.json(), { error: 'identity_unavailable' });
});

test('timed-out login RPCs cannot install late sessions or leak diagnostics', async () => {
  const h = harness();
  h.identity.begin = () => new Promise(() => {});
  const response = await h.adapter.handleAuth(request('/auth/start'), h.env);
  assert.deepEqual(await body(response), { status: 503, json: { error: 'identity_unavailable' } });
  assert.deepEqual(setCookies(response), []);
  const fresh = harness(), start = await begin(fresh);
  fresh.identity.redeem = () => new Promise(() => {});
  const result = await callback(fresh, start);
  assert.equal(result.status, 503); assert.equal(hasSessionInstall(result), false);
});
