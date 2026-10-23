// Admission is independent of authentication and never assigns application roles.
export const ADMISSION_NOTICE = 'CUNY students, faculty and staff only. Guests need an access code.';
export const registrationRestricted = env => env?.REGISTRATION_ELIGIBILITY_ENABLED === 'true';

export function normalizeRegistrationEmail(value, lowercaseLocal = false) {
  if (typeof value !== 'string' || /[^\x20-\x7e]/.test(value)) return null;
  const email = value.trim();
  if (email.length > 254 || /[^\x21-\x7e]/.test(email)) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts, labels = domain.split('.');
  if (!local || local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
    || local.startsWith('.') || local.endsWith('.') || local.includes('..') || labels.length < 2
    || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    || !/[a-z]/i.test(labels.at(-1))) return null;
  return (lowercaseLocal ? local.toLowerCase() : local) + '@' + domain.toLowerCase();
}
export function isCunyEmail(email) {
  const normalized = normalizeRegistrationEmail(email);
  if (!normalized) return false;
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  return domain === 'cuny.edu' || domain.endsWith('.cuny.edu');
}
const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
export async function registrationAllowed(email, code, env) {
  if (!registrationRestricted(env)) return true;
  if (!normalizeRegistrationEmail(email)) return false;
  if (isCunyEmail(email)) return true;
  const expected = env.REGISTRATION_GUEST_CODE;
  if (typeof expected !== 'string' || !expected.length || expected.length > 256
    || typeof code !== 'string' || !code.length || code.length > 256) return false;
  const [actualHash, expectedHash] = await Promise.all([hash(code), hash(expected)]);
  let difference = 0;
  for (let i = 0; i < actualHash.length; i++) difference |= actualHash[i] ^ expectedHash[i];
  return difference === 0;
}

// The event's existing counters count saved RSVPs, so code guesses need a separate
// attempt budget. Use the existing durable auth-limit table, with separate keys.
export async function registrationAttemptAllowed(request, env) {
  const now = Date.now(), window = Math.floor(now / 900000);
  const rawIp = request.headers.get('cf-connecting-ip');
  const ip = rawIp && rawIp.length <= 64 && /^[0-9a-f:.]+$/i.test(rawIp) ? rawIp : 'unknown';
  await env.DB.prepare('DELETE FROM hny_auth_limits WHERE expires_at < ?').bind(now - 3600000).run();
  for (const [key, limit] of [['event-admission:all', 1000], ['event-admission:ip:' + ip, 30]]) {
    const bucket = Array.from(await hash(key), byte => byte.toString(16).padStart(2, '0')).join('');
    const row = await env.DB.prepare('INSERT INTO hny_auth_limits (bucket, window, count, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT(bucket, window) DO UPDATE SET count = count + 1 RETURNING count').bind(bucket, window, (window + 1) * 900000).first();
    if (!row || row.count > limit) return false;
  }
  return true;
}
