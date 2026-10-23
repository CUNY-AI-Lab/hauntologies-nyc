import { normalizeRegistrationEmail, registrationAllowed } from '../server/registration-eligibility.mjs';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins/magic-link';
import { getIP } from '@better-auth/core/utils/ip';

export const MAP_ORIGIN = 'https://hauntologies-nyc.ailab-452.workers.dev';
const COOKIE = '__Host-hauntologies-session';
const cache = new WeakMap();
const tokenPattern = /^[A-Za-z0-9_-]{24,128}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const failure = (code, status) => Object.assign(new Error(code), { code, status });
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export const privateJson = (body, status = 200, cookies = []) => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
};

export function mapAccountsReady(env) {
  return env.MAP_ACCOUNTS_ENABLED === 'true' && typeof env.MAP_AUTH_SECRET === 'string' && env.MAP_AUTH_SECRET.length >= 32 && Boolean(env.DB && env.ACCOUNT_MAIL?.send);
}

export function accountOptions(env) {
  async function send(kind, email, token) {
    const result = await env.ACCOUNT_MAIL.send({ kind, email, token, requestId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
    if (result?.status !== 'accepted') throw failure('mail_unavailable', 503);
  }
  return {
    appName: 'Hauntologies of New York', baseURL: MAP_ORIGIN, basePath: '/api/auth',
    secret: env.MAP_AUTH_SECRET, database: env.DB, trustedOrigins: [MAP_ORIGIN],
    user: { modelName: 'hny_auth_user' },
    account: { modelName: 'hny_auth_account', accountLinking: { enabled: false } },
    session: { modelName: 'hny_auth_session', expiresIn: 3600, disableSessionRefresh: true, cookieCache: { enabled: false } },
    // Setup links remain stored until used. The wrapper cleans expired reset
    // challenges separately so Better Auth cannot remove an unused setup link.
    verification: { modelName: 'hny_auth_verification', storeIdentifier: 'hashed', disableCleanup: true },
    emailAndPassword: {
      enabled: true, disableSignUp: true, requireEmailVerification: true, minPasswordLength: 12, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true, resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: ({ user, token }) => send('reset_password', user.email, token),
    },
    plugins: [magicLink({ expiresIn: 1800, storeToken: 'hashed', generateToken: randomToken, sendMagicLink: ({ email, token }) => send('verify_email', email, token) })],
    // The public wrapper below owns durable rate limits, including server API calls.
    rateLimit: { enabled: false },
    advanced: {
      // Disable Better Auth's automatic __Secure- name prefix so the explicit
      // __Host- name below keeps its browser-enforced host-only semantics.
      // Secure remains mandatory for every cookie through these attributes.
      useSecureCookies: false, defaultCookieAttributes: { secure: true }, database: { generateId: 'uuid' },
      cookies: { session_token: { name: COOKIE, attributes: { path: '/', secure: true, httpOnly: true, sameSite: 'lax', maxAge: 3600 } } },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    logger: { disabled: true }, telemetry: { enabled: false },
  };
}

function authFor(env) {
  let saved = cache.get(env.DB);
  if (!saved || saved.secret !== env.MAP_AUTH_SECRET) {
    saved = { secret: env.MAP_AUTH_SECRET, auth: betterAuth(accountOptions(env)) };
    cache.set(env.DB, saved);
  }
  return saved.auth;
}

async function credential(env, userId) {
  return env.DB.prepare('SELECT id FROM hny_auth_account WHERE userId = ? AND providerId = ? AND password IS NOT NULL LIMIT 1').bind(userId, 'credential').first();
}

async function clearSetupLinks(env, email) {
  await env.DB.prepare("DELETE FROM hny_auth_verification WHERE json_valid(value) AND json_extract(value, '$.type') = 'magic-link' AND lower(json_extract(value, '$.email')) = ?").bind(email.toLowerCase()).run();
}

export async function mapSession(request, env, requirePassword = true) {
  if (!mapAccountsReady(env)) return null;
  const session = await authFor(env).api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session?.user?.emailVerified || new Date(session.session.expiresAt).getTime() <= Date.now()) return null;
  const hasPassword = Boolean(await credential(env, session.user.id));
  if (requirePassword && !hasPassword) return null;
  return { actor_id: 'map_' + session.user.id, email: session.user.email, password_required: !hasPassword };
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function rate(env, key, limit, windowSeconds) {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const bucket = await digest('hny-auth:' + key);
  const row = await env.DB.prepare('INSERT INTO hny_auth_limits (bucket, window, count, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT(bucket, window) DO UPDATE SET count = count + 1 RETURNING count').bind(bucket, window, (window + 1) * windowSeconds * 1000).first();
  if (!row || row.count > limit) throw failure('rate_limited', 429);
}

async function bodyOf(request, allowed) {
  if (request.headers.get('origin') !== MAP_ORIGIN || (request.headers.get('sec-fetch-site') || 'same-origin') !== 'same-origin') throw failure('same_origin_required', 403);
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw failure('json_required', 415);
  const reader = request.body?.getReader();
  if (!reader) throw failure('invalid_request', 400);
  let size = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > 4096) { await reader.cancel(); throw failure('request_too_large', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw failure('invalid_request', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw failure('invalid_request', 400);
  return body;
}

const fields = {
  register: ['email', 'access_code'], 'sign-in': ['email', 'password'], 'request-reset': ['email'],
  verify: ['token', 'password', 'access_code'], 'set-password': ['password', 'access_code'], reset: ['token', 'password', 'access_code'], 'sign-out': [],
};
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
function cookieHeaders(response) { return response.headers.getSetCookie(); }
function sessionCookieRequest(request, response) {
  const headers = new Headers(request.headers);
  headers.set('cookie', cookieHeaders(response).map(value => value.split(';', 1)[0]).join('; '));
  return new Request(request.url, { headers });
}

export async function handleMapAccount(request, env) {
  if (!mapAccountsReady(env)) return privateJson({ error: 'accounts_unavailable' }, 503);
  const url = new URL(request.url), action = url.pathname.slice('/api/auth/'.length);
  if (url.origin !== MAP_ORIGIN || url.search || url.pathname !== '/api/auth/' + action) return privateJson({ error: 'invalid_request' }, 400);
  try {
    if (action === 'session' && request.method === 'GET') {
      const session = await mapSession(request, env, false);
      return session ? privateJson(session) : privateJson({ error: 'sign_in_required' }, 401);
    }
    if (!Object.hasOwn(fields, action)) return privateJson({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return privateJson({ error: 'method_not_allowed' }, 405);
    const body = await bodyOf(request, fields[action]);
    await env.DB.prepare('DELETE FROM hny_auth_limits WHERE expires_at < ?').bind(Date.now() - 3600000).run();
    await env.DB.prepare("DELETE FROM hny_auth_verification WHERE (CASE WHEN json_valid(value) THEN json_extract(value, '$.type') END) IS NOT 'magic-link' AND (CASE WHEN typeof(expiresAt) IN ('integer','real') THEN expiresAt/1000 ELSE unixepoch(expiresAt) END) < ?").bind(Math.floor(Date.now()/1000)).run();
    await rate(env, 'all-mutations', 3000, 3600);
    const ip = getIP(request, { advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'], ipv6Subnet: 64 } } }) || 'unknown';
    // Account and global limits remain effective across addresses and Worker isolates.
    // Campus participants may share one network address. Recipient and global
    // limits still bound email volume independently of this shared-IP allowance.
    await rate(env, 'ip:' + ip, 120, 900);
    if (fields[action].includes('email')) {
      if (action === 'register') {
        body.email = normalizeRegistrationEmail(body.email, true);
        if (!body.email) throw failure('invalid_email', 400);
      }
      if (typeof body.email !== 'string' || body.email.length > 254 || !emailPattern.test(body.email)) throw failure('invalid_email', 400);
      body.email = body.email.toLowerCase();
      await rate(env, 'account:' + body.email, 12, 900);
    }
    if (action === 'register' && !await registrationAllowed(body.email, body.access_code, env)) throw failure('registration_restricted', 403);
    if (['register', 'request-reset'].includes(action)) {
      await rate(env, 'mail-global', 60, 3600);
      await rate(env, 'mail:' + body.email, 3, 3600);
      await rate(env, 'mail-ip:' + ip, 60, 3600);
    }
    if (fields[action].includes('password') && !validPassword(body.password)) throw failure('password_length', 400);
    if (fields[action].includes('token') && (typeof body.token !== 'string' || !tokenPattern.test(body.token))) throw failure('invalid_token', 400);
    const auth = authFor(env), headers = request.headers;
    const context = await auth.$context;
    // Finish initialization within this request, including when admission or
    // an existing account makes the wrapper return before calling an auth API.
    await context.checkSchema?.();
    if (action === 'register') {
      const existing = await env.DB.prepare('SELECT id FROM hny_auth_user WHERE email = ? LIMIT 1').bind(body.email).first();
      if (!existing || !await credential(env, existing.id)) await auth.api.signInMagicLink({ headers, body: { email: body.email } });
      return privateJson({ status: 'check_email' });
    }
    if (action === 'request-reset') {
      await auth.api.requestPasswordReset({ headers, body: { email: body.email } });
      return privateJson({ status: 'check_email' });
    }
    if (action === 'reset') {
      const pending = await context.internalAdapter.findVerificationValue('reset-password:' + body.token);
      if (!pending || new Date(pending.expiresAt).getTime() <= Date.now()) throw failure('invalid_token', 400);
      const user = await env.DB.prepare('SELECT id, email FROM hny_auth_user WHERE id = ? LIMIT 1').bind(pending.value).first();
      if (!user) throw failure('invalid_token', 400);
      // A reset can create a first credential. Preserve ordinary password resets,
      // while applying admission to accounts whose setup is still unfinished.
      if (!await credential(env, user.id) && !await registrationAllowed(user.email, body.access_code, env)) throw failure('registration_restricted', 403);
      await auth.api.resetPassword({ headers, body: { token: body.token, newPassword: body.password } });
      await clearSetupLinks(env, user.email);
      return privateJson({ status: 'password_reset' }, 200, [`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`]);
    }
    if (action === 'sign-in') {
      const response = await auth.api.signInEmail({ headers, body: { email: body.email, password: body.password }, asResponse: true });
      if (!response.ok) return privateJson({ error: 'invalid_credentials' }, 401);
      return privateJson({ status: 'signed_in' }, 200, cookieHeaders(response));
    }
    if (action === 'sign-out') {
      const response = await auth.api.signOut({ headers, asResponse: true });
      if (!response.ok) throw failure('account_unavailable', 503);
      return privateJson({ status: 'signed_out' }, 200, cookieHeaders(response));
    }
    let verifiedRequest = request, cookies = [];
    if (action === 'verify') {
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.token)));
      const key = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
      // Setup proof has no time limit. Better Auth still owns identifier hashing
      // and atomic consumption; a deleted proof can never be recreated here.
      const pending = await context.internalAdapter.findVerificationValue('magic-link:' + key);
      let value; try { value = JSON.parse(pending?.value); } catch {}
      if (!pending || value?.type !== 'magic-link' || typeof value.email !== 'string') throw failure('invalid_token', 400);
      if (!await registrationAllowed(value.email, body.access_code, env)) throw failure('registration_restricted', 403);
      const existing = await env.DB.prepare('SELECT id FROM hny_auth_user WHERE email = ? LIMIT 1').bind(value.email.toLowerCase()).first();
      if (existing && await credential(env, existing.id)) {
        await clearSetupLinks(env, value.email);
        throw failure('password_already_set', 409);
      }
      // This timestamp bounds Better Auth's processing of the current request,
      // not the lifetime of the emailed invitation. Only an existing, validated
      // setup record is updated, after admission and before atomic consumption.
      const refreshed = await env.DB.prepare('UPDATE hny_auth_verification SET expiresAt = ?, updatedAt = ? WHERE id = ? AND identifier = ? AND value = ? RETURNING id')
        .bind(new Date(Date.now() + 30 * 60 * 1000).toISOString(), new Date().toISOString(), pending.id, pending.identifier, pending.value).first();
      if (!refreshed) throw failure('invalid_token', 400);
      const response = await auth.api.magicLinkVerify({ headers, query: { token: body.token }, asResponse: true });
      if (!response.ok) throw failure('invalid_token', 400);
      cookies = cookieHeaders(response); verifiedRequest = sessionCookieRequest(request, response);
    }
    const session = await mapSession(verifiedRequest, env, false);
    if (!session) throw failure('sign_in_required', 401);
    if (!session.password_required) return privateJson({ error: 'password_already_set' }, 409);
    if (!await registrationAllowed(session.email, body.access_code, env)) throw failure('registration_restricted', 403);
    await auth.api.setPassword({ headers: verifiedRequest.headers, body: { newPassword: body.password } });
    await clearSetupLinks(env, session.email);
    return privateJson({ status: 'signed_in' }, 200, cookies);
  } catch (error) {
    if (error?.code && Number.isInteger(error.status)) return privateJson({ error: error.code }, error.status);
    const status = error?.statusCode;
    return privateJson({ error: status === 400 || status === 401 ? 'invalid_token' : 'account_unavailable' }, status === 400 || status === 401 ? 400 : 503);
  }
}
