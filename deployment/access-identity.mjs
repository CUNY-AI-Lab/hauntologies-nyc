import { createRemoteJWKSet, jwtVerify } from 'jose';

// This adapter remains off until an explicitly approved Access application and
// owner allowlist are configured. It never creates accounts, policies or roles.
export function accessConfiguration(env = {}) {
  if (env.CONTRIBUTIONS_ACCESS_ENABLED !== 'true') return null;
  const issuer = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUDIENCE;
  const rawEmails = env.ACCESS_ALLOWED_EMAILS;
  if (typeof issuer !== 'string' || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer)) return null;
  if (typeof audience !== 'string' || !/^[a-f0-9]{64}$/i.test(audience)) return null;
  if (typeof rawEmails !== 'string' || rawEmails.length > 4000) return null;
  const emails = rawEmails.split(',').map(value => value.trim().toLowerCase());
  if (!emails.length || emails.length > 20 || emails.some(value => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value))) return null;
  return { issuer, audience, emails: new Set(emails) };
}

export function stripIdentityHeaders(request) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('oai-authenticated-') || name.startsWith('cf-access-') || name === 'x-authenticated-user-id') headers.delete(name);
  }
  return headers;
}

export function createAccessIdentity({ resolveKeys = url => createRemoteJWKSet(url), currentDate } = {}) {
  const keySets = new Map();
  return async function authenticate(request, env) {
    const config = accessConfiguration(env);
    if (!config) return null;
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token || token.length > 16384) return null;
    try {
      let keys = keySets.get(config.issuer);
      if (!keys) {
        keys = resolveKeys(new URL(config.issuer + '/cdn-cgi/access/certs'));
        keySets.set(config.issuer, keys);
      }
      const { payload } = await jwtVerify(token, keys, {
        issuer: config.issuer, audience: config.audience, algorithms: ['RS256'],
        requiredClaims: ['iss', 'aud', 'sub', 'email', 'exp', 'iat', 'type'],
        ...(currentDate ? { currentDate: currentDate() } : {})
      });
      if (payload.type !== 'app' || typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(payload.sub)) return null;
      if (typeof payload.email !== 'string' || !config.emails.has(payload.email.toLowerCase())) return null;
      const now = (currentDate ? currentDate() : new Date()).getTime() / 1000;
      if (!Number.isFinite(payload.iat) || payload.iat > now || !Number.isFinite(payload.exp) || payload.exp <= payload.iat) return null;
      // Include the issuer in the identity so a future team change cannot claim
      // ownership of a previous team's submissions with the same subject.
      const bytes = new TextEncoder().encode(config.issuer + '\n' + payload.sub);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      return 'access_' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  };
}

export const authenticateAccess = createAccessIdentity();
