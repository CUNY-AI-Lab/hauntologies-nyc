import {directHistory} from '../server/direct-publication.mjs';
// Local map with testing accounts. Serves web/ and public/ with the real
// workflow service on SQLite, behind a stand-in for map accounts: two fixed
// accounts sign in through the map's own Sign in dialog. Nothing here reaches
// D1, email or production. Data lives in .local/ (gitignored); --fresh starts over.
//
//   npm run local            # http://127.0.0.1:8790
//   npm run local -- --port 8800 --fresh
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { parseStaticRecords } from '../server/static-targets.mjs';
import { contributorCredits, contributorRoster, publishedEdits, publishedRecordPage, setRosterListing } from '../server/published-edits.mjs';
import { handlePublicContributions } from '../server/public-contributions.mjs';
import { handlePublicImage } from '../server/public-images.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 8790;
const PASSWORD = 'haunted-local-only';
// Synthetic verified accounts exercise the same direct-publication mode as the candidate runtime.
const ACCOUNTS = [
  { email: 'contributor@local.test', actor_id: 'map_00000000-0000-4000-8000-000000000001' },
  { email: 'reviewer@local.test', actor_id: 'map_00000000-0000-4000-8000-000000000002' },
];

const dir = path.join(repo, '.local'), file = path.join(dir, 'hauntologies-local.sqlite');
mkdirSync(dir, { recursive: true });
if (args.includes('--fresh')) rmSync(file, { force: true });
const fresh = !existsSync(file);
const native = new DatabaseSync(file);
if (fresh) for (const f of readdirSync(path.join(repo, 'drizzle')).filter(x => x.endsWith('.sql')).sort()) native.exec(readFileSync(path.join(repo, 'drizzle', f), 'utf8'));
// D1's prepared-statement surface over node:sqlite.
const prepare = (sql, params = []) => ({
  bind(...values) { return prepare(sql, values); },
  async first(column) { const row = native.prepare(sql).get(...params) || null; return column && row ? row[column] : row; },
  async all() { return { results: native.prepare(sql).all(...params) }; },
  async run() { const r = native.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
});
let tail = Promise.resolve();
const db = { prepare, batch(statements) {
  const operation = tail.then(async () => { native.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); native.exec('COMMIT'); return out; } catch (error) { native.exec('ROLLBACK'); throw error; } });
  tail = operation.catch(() => {}); return operation;
} };

const read = p => readFileSync(path.join(repo, p), 'utf8');
const staticRecords = parseStaticRecords(read('public/inventory.js'), read('public/pilot.js'));
const service = createWorkflowService({
  publicationMode: 'direct',
  store: createWorkflowStore(db),
  taskSeeds: JSON.parse(read('public/data/contribution-tasks.json')),
  geography: { boundaries: JSON.parse(read('public/data/nyc-borough-boundaries.geojson')), gazetteer: JSON.parse(read('server/gazetteer.json')) },
  staticRecords,
  authorization: { reviewers: [], publishers: [], everyone: true },
});

const sessions = new Map(), COOKIE = 'hny_local';
const sessionOf = req => { const token = /(?:^|;\s*)hny_local=([\w-]+)/.exec(req.headers.cookie || '')?.[1]; return token ? sessions.get(token) || null : null; };
const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2' };

async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); }

async function auth(req, action) {
  const account = sessionOf(req);
  if (action === 'session') return account ? json({ actor_id: account.actor_id, email: account.email, password_required: false }) : json({ error: 'sign_in_required' }, 401);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (action === 'sign-in') {
    let value = {}; try { value = JSON.parse(await body(req)); } catch {}
    const match = ACCOUNTS.find(a => a.email === String(value.email || '').trim().toLowerCase());
    if (!match || value.password !== PASSWORD) return json({ error: 'invalid_credentials' }, 401);
    const token = randomUUID(); sessions.set(token, match);
    return json({ status: 'signed_in' }, 200, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` });
  }
  if (action === 'sign-out') {
    const token = /(?:^|;\s*)hny_local=([\w-]+)/.exec(req.headers.cookie || '')?.[1]; if (token) sessions.delete(token);
    return json({ status: 'signed_out' }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
  }
  // Registration and resets send email; locally, use a testing account instead.
  return json({ error: 'mail_unavailable' }, 503);
}

async function contributions(req, url) {
  const account = sessionOf(req);
  if (url.pathname === '/api/contributions/sign-in') return new Response(null, { status: 303, headers: { Location: '/#sign-in' } });
  if (!account) return json({ error: 'sign_in_required' }, 401);
  if (url.pathname === '/api/contributions/session') return json({ actor_id: account.actor_id });
  const expected = req.headers['x-hauntologies-actor'];
  if (!['GET', 'HEAD'].includes(req.method) && expected && expected !== account.actor_id) return json({ error: 'account_changed' }, 409);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string' && !['cookie', 'x-hauntologies-actor'].includes(key)) headers.set(key, value);
  headers.set('oai-authenticated-user-id', account.actor_id);
  return service.handle(new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await body(req) }));
}

function file404(pathname) {
  if (pathname === '/contributors') return new Response(null, {status:302,headers:{location:'/#contributors'}});
  const target = pathname === '/' ? path.join(repo, 'web/index.html') : pathname === '/activity' ? path.join(repo, 'web/activity.html') : pathname === '/register' ? path.join(repo, 'web/registration.html') : path.join(repo, 'public', decodeURIComponent(pathname));
  if (!target.startsWith(repo) || !existsSync(target) || statSync(target).isDirectory()) return new Response('Not found', { status: 404 });
  return new Response(readFileSync(target), { headers: { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' } });
}

async function route(req) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`), p = url.pathname;
  if(p==='/api/public-image')return handlePublicImage(new Request(url,{method:req.method}),db);
  if (['/api/activity','/api/contributors-summary','/api/place-completeness'].includes(p)) return handlePublicContributions(new Request(url, {method:req.method}), {db,staticRecords});
  if (p.startsWith('/api/auth/')) return auth(req, p.slice('/api/auth/'.length));
  if (p === '/api/access-status') return json({ enabled: true, sign_in_url: '/api/contributions/sign-in', account_mode: 'map', dashboard_enabled: false });
  if (p === '/api/registration-policy') return json({ restricted: false });
  if (p === '/api/place-history') return json(await directHistory(db,url.searchParams.get('id')));
  if (p === '/api/published-edits') return json({ items: await publishedEdits(db) });
  if (p === '/api/published-records') return json(await publishedRecordPage(db, url.searchParams.get('after') || ''));
  if (p === '/api/pending-places') return json({places:[]});
  if (p === '/api/contributor-credits') return json(await contributorCredits(db));
  if (p === '/api/contributor-roster') {
    const account = sessionOf(req);
    if (!account) return json({ error: 'sign_in_required' }, 401);
    if (req.method !== 'POST') return json(await contributorRoster(db, account.actor_id));
    let listed; try { listed = JSON.parse(await body(req)).listed; } catch {}
    return typeof listed === 'boolean' ? json(await setRosterListing(db, account.actor_id, listed)) : json({ error: 'invalid_request' }, 400);
  }
  if (/^\/api\/contributions\/[a-z][a-z0-9-]*$/.test(p)) return contributions(req, url);
  if (p.startsWith('/api/')) return json({ error: 'sign_in_required' }, 401);
  return file404(p);
}

http.createServer(async (req, res) => {
  try {
    const response = await route(req);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); res.writeHead(500); res.end('Local server error'); }
}).listen(port, '127.0.0.1', () => {
  console.log(`Hauntologies local map: http://127.0.0.1:${port}  (data: ${path.relative(repo, file)}${fresh ? ', new' : ''})`);
  console.log(`Sign in with ${ACCOUNTS.map(a => a.email).join(' or ')}, password ${PASSWORD}`);
  console.log('Each account can publish its own contributions directly. Registration and password resets are off here.');
});
