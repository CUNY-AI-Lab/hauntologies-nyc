import { REGISTRATION_EVENT } from './registration.mjs';

const SUBJECT = /^cail-[a-f0-9]{32}$/;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const subject = value => typeof value === 'string' && value.length === 37 && SUBJECT.test(value);
const identifier = value => typeof value === 'string' && value.length === 36 && ID.test(value);
const reply = (status, body, headers = {}) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
const reject = (status, error, headers) => reply(status, { ok: false, error }, headers);

function encodeCursor(row) {
  return btoa(JSON.stringify({ v: 1, created_at: row.created_at, id: row.id }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw Error('invalid_cursor');
  const parsed = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 'created_at,id,v' || parsed.v !== 1
    || !timestamp(parsed.created_at) || !identifier(parsed.id)
    || encodeCursor(parsed) !== value) throw Error('invalid_cursor');
  return parsed;
}

/** principal must come from the verified server identity adapter, never request data. */
export async function handleRegistrationDashboard(request, { DB, principal, ownerSubject } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/admin/registrations') return reject(404, 'not_found');
  if (request.method !== 'GET') return reject(405, 'method_not_allowed', { Allow: 'GET' });
  if (!principal || typeof principal !== 'object' || Array.isArray(principal) || !subject(principal.subject)) return reject(401, 'authentication_required');
  if (!subject(ownerSubject) || principal.subject !== ownerSubject) return reject(403, 'forbidden');

  const params = url.searchParams;
  if ([...params.keys()].some(key => key !== 'limit' && key !== 'cursor')
    || params.getAll('limit').length > 1 || params.getAll('cursor').length > 1) return reject(400, 'invalid_query');
  const rawLimit = params.get('limit');
  if (rawLimit !== null && (!/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > 50)) return reject(400, 'invalid_limit');
  const limit = rawLimit === null ? 25 : Number(rawLimit);
  let cursor = null;
  if (params.has('cursor')) {
    try { cursor = decodeCursor(params.get('cursor')); }
    catch { return reject(400, 'invalid_cursor'); }
  }

  try {
    if (!DB || typeof DB.prepare !== 'function') return reject(503, 'registrations_unavailable');
    const sql = `SELECT id, name, email, created_at FROM event_registrations WHERE event_id = ?${cursor
      ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`;
    const values = cursor
      ? [REGISTRATION_EVENT.id, cursor.created_at, cursor.created_at, cursor.id, limit + 1]
      : [REGISTRATION_EVENT.id, limit + 1];
    const result = await DB.prepare(sql).bind(...values).all();
    if (result?.success !== true || !Array.isArray(result.results) || result.results.length > limit + 1
      || result.results.some(row => !row || typeof row.name !== 'string' || typeof row.email !== 'string'
        || !identifier(row.id) || !timestamp(row.created_at))) return reject(503, 'registrations_unavailable');
    const rows = result.results.slice(0, limit);
    return reply(200, {
      registrations: rows.map(({ name, email, created_at }) => ({ name, email, created_at })),
      next_cursor: result.results.length > limit ? encodeCursor(rows.at(-1)) : null,
    });
  } catch { return reject(503, 'registrations_unavailable'); }
}
