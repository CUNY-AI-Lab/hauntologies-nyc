import { hasGuestAdmission, rememberGuestAdmission, normalizeRegistrationEmail, registrationAllowed, registrationAttemptAllowed, registrationRestricted } from './registration-eligibility.mjs';
// Public event intake only. No attendee reads, identity claims, email sends or map writes.
export const REGISTRATION_EVENT = Object.freeze({
  id: 'hauntologies-2026-10-30', date: '2026-10-30', start_time: '15:00', end_time: '18:30',
  time_zone: 'America/New_York', location: 'DH Lounge 5307',
});
export const REGISTRATION_LIMITS = Object.freeze({ body_bytes: 2048, window_seconds: 900, per_client: 10, global: 200 });

function reply(status, value, headers = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
const reject = (status, error, headers) => reply(status, { ok: false, error }, headers);
const sha256 = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
async function readBody(request) {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > REGISTRATION_LIMITS.body_bytes)) throw 'body_too_large';
  if (!request.body) throw 'invalid_json';
  const reader = request.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > REGISTRATION_LIMITS.body_bytes) { await reader.cancel(); throw 'body_too_large'; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw 'invalid_json'; }
}
function receipt(row, payloadHash, status) {
  if (row.payload_hash !== payloadHash) return reject(409, 'idempotency_conflict');
  return reply(status, { ok: true, receipt_id: row.id, event: REGISTRATION_EVENT });
}

/** Call only for the public registration route, with the existing env.DB binding. */
export async function handleRegistration(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/register') return reject(404, 'not_found');
  if (request.method !== 'POST') return reject(405, 'method_not_allowed', { Allow: 'POST' });
  const site = request.headers.get('sec-fetch-site');
  if (request.headers.get('origin') !== url.origin || (site && site !== 'same-origin' && site !== 'none')) return reject(403, 'origin_not_allowed');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reject(415, 'unsupported_content_type');
  if (request.headers.has('content-encoding')) return reject(415, 'unsupported_content_encoding');
  const key = request.headers.get('idempotency-key');
  if (!key || !/^[A-Za-z0-9_-][A-Za-z0-9._:-]{15,127}$/.test(key)) return reject(400, 'invalid_idempotency_key');
  let body;
  try { body = await readBody(request); }
  catch (error) { return reject(error === 'body_too_large' ? 413 : 400, error === 'body_too_large' ? error : 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['name', 'email', 'website', 'access_code'].includes(k))
      || (Object.hasOwn(body, 'website') && (typeof body.website !== 'string' || body.website !== ''))) return reject(400, 'invalid_request');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120 || /[\u0000-\u001f\u007f]/u.test(body.name)) return reject(400, 'invalid_name');
  const canonicalEmail = normalizeRegistrationEmail(body.email);
  if (!canonicalEmail) return reject(400, 'invalid_email');
  const name = body.name.trim();
  if (!env?.DB?.prepare || !env.DB.batch) return reject(503, 'registration_unavailable');
  try {
    const db = env.DB, event = REGISTRATION_EVENT.id;
    const keyHash = await sha256(event + ':' + key), payloadHash = await sha256(JSON.stringify({ name, email: canonicalEmail }));
    const find = () => db.prepare('SELECT id, payload_hash FROM event_registrations WHERE event_id = ? AND idempotency_hash = ?').bind(event, keyHash).first();
    const existing = await find();
    if (existing) return receipt(existing, payloadHash, 200);
    if (registrationRestricted(env)) {
      if (!await registrationAttemptAllowed(request, env)) return reject(429, 'rate_limited', { 'Retry-After': '900' });
      if (!await hasGuestAdmission(env, canonicalEmail) && !await registrationAllowed(canonicalEmail, body.access_code, env)) return reject(403, 'registration_restricted');
      await rememberGuestAdmission(env, canonicalEmail);
    }
    const now = Date.now(), seconds = Math.floor(now / 1000), windowStart = Math.floor(seconds / REGISTRATION_LIMITS.window_seconds) * REGISTRATION_LIMITS.window_seconds;
    // Cloudflare overwrites this header on its public edge. It is a rate hint, never an identity.
    const ip = request.headers.get('cf-connecting-ip'), client = ip && ip.length <= 64 && /^[0-9a-f:.]+$/i.test(ip) ? ip : 'unknown';
    const clientKey = 'client:' + await sha256(event + ':' + windowStart + ':' + client), globalKey = 'global:' + event;
    const id = crypto.randomUUID(), createdAt = new Date(now).toISOString();
    // D1 batch is transactional. Only a newly inserted registration consumes either budget.
    // Use database time at insertion: a queued request must not reopen a window
    // whose counters a newer transaction has already pruned.
    const result = await db.batch([
      db.prepare("DELETE FROM event_registration_limits WHERE window_start < CAST(CAST(strftime('%s', 'now') AS INTEGER) / ? AS INTEGER) * ?")
        .bind(REGISTRATION_LIMITS.window_seconds, REGISTRATION_LIMITS.window_seconds),
      db.prepare(`INSERT INTO event_registrations (id, event_id, idempotency_hash, payload_hash, name, email, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((SELECT attempts FROM event_registration_limits WHERE rate_key = ? AND window_start = ?), 0) < ?
          AND COALESCE((SELECT attempts FROM event_registration_limits WHERE rate_key = ? AND window_start = ?), 0) < ?
          AND CAST(strftime('%s', 'now') AS INTEGER) >= ?
          AND CAST(strftime('%s', 'now') AS INTEGER) < ?
        ON CONFLICT(event_id, idempotency_hash) DO NOTHING`).bind(id, event, keyHash, payloadHash, name, canonicalEmail, createdAt,
        globalKey, windowStart, REGISTRATION_LIMITS.global, clientKey, windowStart, REGISTRATION_LIMITS.per_client,
        windowStart, windowStart + REGISTRATION_LIMITS.window_seconds),
      ...[globalKey, clientKey].map(rateKey => db.prepare(`INSERT INTO event_registration_limits (rate_key, window_start, attempts)
        SELECT ?, ?, 1 WHERE EXISTS (SELECT 1 FROM event_registrations WHERE id = ?)
        ON CONFLICT(rate_key, window_start) DO UPDATE SET attempts = attempts + 1`).bind(rateKey, windowStart, id)),
    ]);
    if (!Array.isArray(result) || result.length !== 4 || result.some(item => item.success !== true)) return reject(503, 'registration_unavailable');
    // Return success only after the committed row is read back. Retrying an uncertain save is safe.
    const saved = await find();
    if (saved) return receipt(saved, payloadHash, saved.id === id ? 201 : 200);
    if (Number(result[1].meta?.changes) !== 0) return reject(503, 'registration_unavailable');
    const retrySeconds = Math.floor(Date.now() / 1000);
    return reject(429, 'rate_limited', { 'Retry-After': String(Math.max(1, windowStart + REGISTRATION_LIMITS.window_seconds - retrySeconds)) });
  } catch { return reject(503, 'registration_unavailable'); }
}
