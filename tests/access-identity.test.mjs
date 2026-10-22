import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { accessConfiguration, createAccessIdentity } from '../deployment/access-identity.mjs';
import { createDemoWorker } from '../deployment/demo-gate.mjs';

// Ephemeral synthetic test keys only; no account credentials or external calls.
const { publicKey, privateKey } = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const epoch = 1800000000;
const config = {
  CONTRIBUTIONS_ACCESS_ENABLED: 'true', ACCESS_TEAM_DOMAIN: 'https://synthetic-team.cloudflareaccess.com',
  ACCESS_AUDIENCE: 'a'.repeat(64), ACCESS_ALLOWED_EMAILS: 'owner@example.test'
};
async function token(overrides = {}, key = privateKey) {
  return new SignJWT({ type: 'app', email: 'owner@example.test', sub: 'synthetic-user', iss: config.ACCESS_TEAM_DOMAIN, aud: [config.ACCESS_AUDIENCE], iat: epoch - 10, exp: epoch + 300, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).sign(key);
}
const request = (jwt, path = '/api/contributions/dashboard', extra = {}) => new Request('https://map.example.test' + path, { headers: { ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}), ...extra } });
function verifier() {
  const calls = [];
  const authenticate = createAccessIdentity({ resolveKeys: url => { calls.push(url.href); return publicKey; }, currentDate: () => new Date(epoch * 1000) });
  return { authenticate, calls };
}

test('missing or malformed configuration stays closed without fetching keys', async () => {
  const { authenticate, calls } = verifier();
  const jwt = await token();
  for (const env of [{}, { ...config, CONTRIBUTIONS_ACCESS_ENABLED: 'false' }, { ...config, ACCESS_TEAM_DOMAIN: 'https://arbitrary.example.test' }, { ...config, ACCESS_TEAM_DOMAIN: config.ACCESS_TEAM_DOMAIN + '/' }, { ...config, ACCESS_TEAM_DOMAIN: 'https://user:pass@synthetic-team.cloudflareaccess.com' }, { ...config, ACCESS_AUDIENCE: '' }, { ...config, ACCESS_ALLOWED_EMAILS: '' }, { ...config, ACCESS_ALLOWED_EMAILS: '*' }]) {
    assert.equal(accessConfiguration(env), null);
    assert.equal(await authenticate(request(jwt), env), null);
  }
  assert.deepEqual(calls, []);
});

test('valid signature and application claims yield a stable opaque actor', async () => {
  const { authenticate, calls } = verifier();
  const actor = await authenticate(request(await token()), config);
  assert.match(actor, /^access_[a-f0-9]{64}$/);
  assert.equal(await authenticate(request(await token({ email: 'OWNER@example.test' })), config), actor);
  assert.notEqual(await authenticate(request(await token({ sub: 'different-user' })), config), actor);
  assert.deepEqual(calls, [config.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs']);
});

test('expired, future, wrong audience, issuer, identity and signature assertions are rejected', async () => {
  const { authenticate } = verifier();
  for (const claims of [{ exp: epoch }, { iat: epoch + 60 }, { nbf: epoch + 60 }, { aud: ['b'.repeat(64)] }, { iss: 'https://other.cloudflareaccess.com' }, { email: 'other@example.test' }, { email: null }, { sub: '' }, { sub: 'bad\nidentity' }, { type: 'service' }]) assert.equal(await authenticate(request(await token(claims)), config), null, JSON.stringify(claims));
  assert.equal(await authenticate(request(await token({}, other.privateKey)), config), null);
  assert.equal(await authenticate(request('not-a-jwt'), config), null);
  assert.equal(await authenticate(request('x'.repeat(16385)), config), null);
  assert.equal(await authenticate(request(null), config), null);
});

test('no missing required claim can fall back to an identity header', async () => {
  const { authenticate } = verifier();
  for (const field of ['iss','aud','sub','email','exp','iat','type']) assert.equal(await authenticate(request(await token({ [field]: undefined }), undefined, { 'oai-authenticated-user-id': 'forged' }), config), null, field);
});

test('gate replaces identity only on exact contribution paths and never grants other APIs', async () => {
  const { authenticate } = verifier();
  const seen = [];
  const worker = createDemoWorker({ fetch: req => { seen.push(req); return new Response('private', { headers: { 'Cache-Control': 'public,max-age=86400' } }); } }, undefined, authenticate);
  const jwt = await token();
  const response = await worker.fetch(request(jwt, undefined, { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'fake', 'cf-access-authenticated-user-email': 'fake', 'x-authenticated-user-id': 'fake' }), config, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(seen[0].headers.get('oai-authenticated-user-id'), /^access_[a-f0-9]{64}$/);
  for (const name of ['cf-access-jwt-assertion','cf-access-authenticated-user-email','oai-authenticated-user-email','x-authenticated-user-id']) assert.equal(seen[0].headers.get(name), null);
  for (const path of ['/api/contributions','/api/contributions/','/api//contributions/dashboard','/API/contributions/dashboard','/%61pi/contributions/dashboard','/api/contributions/%64ashboard','/api/contributions/submission/extra','/api/review','/api/records']) assert.equal((await worker.fetch(request(jwt, path), config, {})).status, 401, path);
  assert.equal(seen.length, 1);
});

test('disabled gate cannot be opened by valid JWT or spoofed headers', async () => {
  const { authenticate, calls } = verifier();
  const worker = createDemoWorker({ fetch: () => { throw Error('must stay closed'); } }, undefined, authenticate);
  assert.equal((await worker.fetch(request(await token(), undefined, { 'oai-authenticated-user-id': 'forged' }), {}, {})).status, 401);
  assert.deepEqual(calls, []);
});

test('key service failures fail closed', async () => {
  const authenticate = createAccessIdentity({ resolveKeys: () => { throw Error('synthetic unavailable key service'); } });
  assert.equal(await authenticate(request(await token()), config), null);
});

test('public access status exposes only readiness and a fixed same-origin path', async () => {
  const worker = createDemoWorker({fetch:()=>{throw Error('No application route expected');}});
  for(const [env,enabled] of [[{},false],[config,true]]) {
    const response=await worker.fetch(request(null,'/api/access-status'),env,{});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{enabled,sign_in_url:enabled?'/api/contributions/sign-in':null});
  }
  assert.equal((await worker.fetch(new Request('https://map.example.test/api/access-status',{method:'POST'}),config,{})).status,401);
  for(const path of ['/API/access-status','/%61pi/access-status','/api//access-status'])assert.equal((await worker.fetch(request(null,path),config,{})).status,401);
});

test('sign-in and session routes require verified identity and cannot redirect externally', async () => {
  const {authenticate}=verifier();
  const worker=createDemoWorker({fetch:()=>{throw Error('No application route expected');}},undefined,authenticate);
  for(const path of ['/api/contributions/sign-in','/api/contributions/session'])assert.equal((await worker.fetch(request(null,path),config,{})).status,401);
  const jwt=await token(),response=await worker.fetch(request(jwt,'/api/contributions/sign-in?returnTo=https://untrusted.example'),config,{});
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/');assert.equal(response.headers.get('cache-control'),'no-store');
  const session=await worker.fetch(request(jwt,'/api/contributions/session'),config,{}),body=await session.json();
  assert.deepEqual(Object.keys(body),['actor_id']);assert.match(body.actor_id,/^access_[a-f0-9]{64}$/);
  const denied=await worker.fetch(new Request('https://map.example.test/api/contributions/sign-in',{method:'POST',headers:{'cf-access-jwt-assertion':jwt}}),config,{});
  assert.equal(denied.status,405);
});
