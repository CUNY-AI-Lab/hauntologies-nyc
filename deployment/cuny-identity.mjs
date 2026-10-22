import { createLocalJWKSet, jwtVerify } from 'jose';

// Protocol source: CUNY-AI-Lab/cail-tools-admission, commit
// eea53688b026a8916355a981d23b080e106fb09c, apps/doorway/docs/WORKER-SIGN-IN.md
// and apps/doorway/src/{worker-sessions,identity}.ts. Cookie/PKCE handling also
// follows the existing Systems Mapping cloudflare/login.ts receiver. No keys,
// identity values, role grants or session storage are copied from either app.
export const CUNY_ISSUER = 'https://tools.ailab.gc.cuny.edu/cail-sso';
export const CUNY_AUDIENCE = 'cail:hauntologies-nyc';
export const CUNY_ORIGIN = 'https://hauntologies-nyc.ailab-452.workers.dev';
export const CUNY_SESSION_COOKIE = '__Host-hauntologies-cuny-session';
export const CUNY_LOGIN_COOKIE = '__Host-hauntologies-cuny-login';
const TOOLS_ORIGIN = 'https://tools.ailab.gc.cuny.edu';
const LOGIN_MS = 600000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const subjectValid = value => typeof value === 'string' && value.length === 37 && /^cail-[a-f0-9]{32}$/.test(value);
const proofValid = value => typeof value === 'string' && value.length === 43 && PROOF.test(value);
const uuidValid = value => typeof value === 'string' && value.length === 36 && UUID.test(value);
const sessionValid = value => typeof value === 'string' && value.length === 80 && uuidValid(value.slice(0, 36)) && value[36] === '.' && proofValid(value.slice(37));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => plain(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

function publicKeys(raw) {
  if (typeof raw !== 'string' || raw.length > 32768) return null;
  try {
    const jwks = JSON.parse(raw);
    if (!exact(jwks, ['keys']) || !Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.length > 8) return null;
    const seen = new Set();
    for (const key of jwks.keys) {
      if (!plain(key) || key.kty !== 'RSA' || typeof key.kid !== 'string' || !key.kid.length || key.kid.length > 128 ||
          seen.has(key.kid) || (key.alg !== undefined && key.alg !== 'RS256') || (key.use !== undefined && key.use !== 'sig') ||
          Object.keys(key).some(name => !['kty', 'kid', 'n', 'e', 'alg', 'use', 'key_ops'].includes(name)) ||
          (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify'))) return null;
      for (const name of ['n', 'e']) {
        if (typeof key[name] !== 'string' || !key[name].length || key[name].length > 1366 || !/^[A-Za-z0-9_-]+$/.test(key[name])) return null;
        const decoded = atob(key[name].replaceAll('-', '+').replaceAll('_', '/'));
        if (base64(new Uint8Array([...decoded].map(char => char.charCodeAt(0)))) !== key[name]) return null;
        if (name === 'n' && (decoded.length < 256 || decoded.length > 1024)) return null;
        if (name === 'e' && (decoded.length < 1 || decoded.length > 8)) return null;
      }
      seen.add(key.kid);
    }
    return jwks;
  } catch { return null; }
}

function configuration(env = {}) {
  if (env.CONTRIBUTIONS_CUNY_ENABLED !== 'true' || !env.IDENTITY ||
      ['begin', 'redeem', 'identities', 'revoke'].some(name => typeof env.IDENTITY[name] !== 'function')) return null;
  const keys = publicKeys(env.CAIL_IDENTITY_JWKS);
  return keys ? { identity: env.IDENTITY, keys, rawKeys: env.CAIL_IDENTITY_JWKS } : null;
}

// Readiness intentionally contains no keys, canonical subjects or identities.
export function cunyReadiness(env = {}) {
  const configured = configuration(env) !== null;
  return { configured, ownerConfigured: configured && subjectValid(env.CONTRIBUTIONS_CUNY_OWNER_SUBJECT) };
}

function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const cookie = (name, value, seconds) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
const clearLogin = () => cookie(CUNY_LOGIN_COOKIE, '', 0);
const clearSession = () => cookie(CUNY_SESSION_COOKIE, '', 0);
function cookieValue(request, name) {
  const raw = request.headers.get('cookie') || '';
  if (raw.length > 8192) return '';
  const matches = raw.split(';').map(part => part.trim()).filter(part => part.split('=', 1)[0].trim() === name);
  if (!matches.length) return null;
  if (matches.length !== 1 || !matches[0].startsWith(name + '=')) return '';
  return matches[0].slice(name.length + 1);
}
const responseHeaders = () => new Headers({
  'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
});
function failure(status, cookies = [], allow) {
  const headers = responseHeaders();
  headers.set('content-type', 'application/json');
  if (allow) headers.set('allow', allow);
  for (const value of cookies) headers.append('set-cookie', value);
  const error = status === 503 ? 'identity_unavailable' : status === 403 ? 'sign_in_not_permitted' : status === 405 ? 'method_not_allowed' : status === 400 ? 'invalid_request' : 'sign_in_required';
  return new Response(JSON.stringify({ error }), { status, headers });
}
function redirect(location, cookies) {
  const headers = responseHeaders();
  headers.set('location', location);
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 303, headers });
}
function requestUrl(request) {
  const url = new URL(request.url);
  return url.origin === CUNY_ORIGIN && !url.username && !url.password && !url.hash && request.url.length <= 2048 ? url : null;
}
function exactParams(params, allowed, required = []) {
  return [...params.keys()].every(key => allowed.includes(key) && params.getAll(key).length === 1) && required.every(key => params.getAll(key).length === 1);
}
function transaction(raw, params, at) {
  if (typeof raw !== 'string' || !raw.length || raw.length > 1500 || !exactParams(params, ['code', 'state'], ['code', 'state'])) return null;
  try {
    const saved = JSON.parse(decodeURIComponent(raw));
    if (!exact(saved, ['verifier', 'state', 'returnTo', 'expiresAt']) || !proofValid(saved.verifier) || !proofValid(saved.state) ||
        saved.state !== params.get('state') || !uuidValid(params.get('code')) || !['/', '/dashboard'].includes(saved.returnTo) ||
        !Number.isSafeInteger(saved.expiresAt) || saved.expiresAt <= at || saved.expiresAt > at + LOGIN_MS) return null;
    return saved;
  } catch { return null; }
}

export function createCunyIdentity({ now = Date.now, rpcTimeoutMs = 5000 } = {}) {
  if (typeof now !== 'function' || !Number.isInteger(rpcTimeoutMs) || rpcTimeoutMs < 1 || rpcTimeoutMs > 10000) throw new TypeError('invalid_adapter_options');
  const verified = new WeakMap();
  async function rpc(request, run) {
    if (request.signal.aborted) throw new Error('identity_unavailable');
    let timer, abort;
    const bound = new Promise((_, reject) => {
      const fail = () => reject(new Error('identity_unavailable'));
      timer = setTimeout(fail, rpcTimeoutMs);
      abort = fail;
      request.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([bound, Promise.resolve().then(() => {
        if (request.signal.aborted) throw new Error('identity_unavailable');
        return run();
      })]);
    } finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); }
  }
  async function principalForToken(request, config, token) {
    const grants = await rpc(request, () => config.identity.identities(token));
    // Deliberately never read, forward, verify or return Gateway/workspace legs.
    if (!plain(grants) || grants.ok !== true || typeof grants.appJwt !== 'string' || !grants.appJwt.length || grants.appJwt.length > 16384) return null;
    const at = now();
    const { payload, protectedHeader } = await jwtVerify(grants.appJwt, createLocalJWKSet(config.keys), {
      issuer: CUNY_ISSUER, audience: CUNY_AUDIENCE, algorithms: ['RS256'],
      requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp'], currentDate: new Date(at)
    });
    if (protectedHeader.alg !== 'RS256' || payload.iss !== CUNY_ISSUER || payload.aud !== CUNY_AUDIENCE || !subjectValid(payload.sub) ||
        !Number.isSafeInteger(payload.iat) || payload.iat <= 0 || payload.iat > at / 1000 || !Number.isSafeInteger(payload.exp) ||
        payload.exp <= at / 1000 || payload.exp <= payload.iat || payload.exp - payload.iat > 300 ||
        (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || payload.nbf > at / 1000 || payload.nbf >= payload.exp)) ||
        (payload.log_sub !== undefined && (typeof payload.log_sub !== 'string' || payload.log_sub.length !== 40 || !/^cail-v1-[a-f0-9]{32}$/.test(payload.log_sub))) ||
        payload.tool !== undefined || request.signal.aborted) return null;
    const hash = Array.from(await digest(CUNY_ISSUER + '\n' + payload.sub), byte => byte.toString(16).padStart(2, '0')).join('');
    if (request.signal.aborted) return null;
    const principal = Object.freeze({ subject: payload.sub, actor_id: 'cuny_' + hash });
    verified.set(principal, { expiresAt: payload.exp * 1000, rawKeys: config.rawKeys, identity: config.identity });
    return principal;
  }
  async function authenticate(request, env = {}) {
    try {
      const config = configuration(env), token = cookieValue(request, CUNY_SESSION_COOKIE);
      if (!requestUrl(request) || !config || !sessionValid(token)) return null;
      return await principalForToken(request, config, token);
    } catch { return null; }
  }
  function isOwner(principal, env = {}) {
    const proof = principal && typeof principal === 'object' ? verified.get(principal) : null;
    const config = configuration(env);
    return Boolean(proof && config && proof.expiresAt > now() && proof.rawKeys === config.rawKeys && proof.identity === config.identity &&
      subjectValid(env.CONTRIBUTIONS_CUNY_OWNER_SUBJECT) && principal.subject === env.CONTRIBUTIONS_CUNY_OWNER_SUBJECT);
  }
  async function revoke(request, identity, token) {
    const result = await rpc(request, () => identity.revoke(token));
    if (!plain(result) || result.revoked !== true) throw new Error('identity_unavailable');
  }
  async function handleAuth(request, env = {}) {
    const originalUrl = new URL(request.url);
    if (!['/auth/start', '/auth/callback', '/auth/logout'].includes(originalUrl.pathname)) return null;
    const url = requestUrl(request);
    if (!url) return failure(400);
    const logout = url.pathname === '/auth/logout';
    if (request.method !== (logout ? 'POST' : 'GET')) return failure(405, [], logout ? 'POST' : 'GET');
    if (logout && (url.search || request.headers.get('origin') !== CUNY_ORIGIN ||
        ![null, 'same-origin'].includes(request.headers.get('sec-fetch-site')))) return failure(403);
    if (url.pathname === '/auth/start' && ((request.headers.has('origin') && request.headers.get('origin') !== CUNY_ORIGIN) ||
        ![null, 'none', 'same-origin'].includes(request.headers.get('sec-fetch-site')))) return failure(403);
    const config = configuration(env);
    if (logout) {
      const token = cookieValue(request, CUNY_SESSION_COOKIE), cleared = [clearSession(), clearLogin()];
      try {
        if (token !== null && !sessionValid(token)) return failure(503, cleared);
        if (sessionValid(token)) { if (!config) return failure(503, cleared); await revoke(request, config.identity, token); }
        const headers = responseHeaders();
        for (const value of cleared) headers.append('set-cookie', value);
        return new Response(null, { status: 204, headers });
      } catch { return failure(503, cleared); }
    }
    if (!config) return failure(503, url.pathname === '/auth/callback' ? [clearLogin()] : []);
    if (url.pathname === '/auth/start') {
      if (!exactParams(url.searchParams, ['returnTo']) || (url.searchParams.has('returnTo') && !['/', '/dashboard'].includes(url.searchParams.get('returnTo')))) return failure(400);
      try {
        const verifier = random(), state = random(), challenge = base64(await digest(verifier));
        const result = await rpc(request, () => config.identity.begin(challenge, state));
        if (!plain(result) || typeof result.url !== 'string' || result.url.length > 500) return failure(503);
        const target = new URL(result.url);
        if (target.origin !== TOOLS_ORIGIN || target.pathname !== '/worker-login' || target.username || target.password || target.hash ||
            !exactParams(target.searchParams, ['request'], ['request']) || !uuidValid(target.searchParams.get('request'))) return failure(503);
        const saved = encodeURIComponent(JSON.stringify({ verifier, state, returnTo: url.searchParams.get('returnTo') || '/dashboard', expiresAt: now() + LOGIN_MS }));
        const cookies = [cookie(CUNY_LOGIN_COOKIE, saved, 600)];
        const previous = cookieValue(request, CUNY_SESSION_COOKIE);
        if (previous !== null && !sessionValid(previous)) cookies.push(clearSession());
        return redirect(target.href, cookies);
      } catch { return failure(503); }
    }
    const saved = transaction(cookieValue(request, CUNY_LOGIN_COOKIE), url.searchParams, now());
    const previous = cookieValue(request, CUNY_SESSION_COOKIE);
    if (!saved || (previous !== null && !sessionValid(previous))) return failure(401, [clearLogin()]);
    let newToken;
    try {
      const result = await rpc(request, () => config.identity.redeem(url.searchParams.get('code'), saved.verifier));
      if (!plain(result) || result.ok !== true || !sessionValid(result.token) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= now()) return failure(401, [clearLogin()]);
      newToken = result.token;
      if (!await principalForToken(request, config, newToken)) throw new Error('identity_unavailable');
      if (previous && previous !== newToken) await revoke(request, config.identity, previous);
      const seconds = Math.min(86400, Math.floor((result.expiresAt - now()) / 1000));
      if (seconds < 1 || request.signal.aborted) throw new Error('identity_unavailable');
      return redirect(saved.returnTo, [cookie(CUNY_SESSION_COOKIE, newToken, seconds), clearLogin()]);
    } catch {
      if (newToken) { try { await revoke(request, config.identity, newToken); } catch { /* Never install an unconfirmed session. */ } }
      return failure(503, [clearLogin()]);
    }
  }
  return Object.freeze({ handleAuth, authenticate, isOwner, readiness: cunyReadiness });
}

export const cunyIdentity = createCunyIdentity();
