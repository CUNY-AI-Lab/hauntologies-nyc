import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

test('the prepared production Worker starts and enforces signed-out access', async t => {
  // Load the shipped modules without rebundling source: a source-only test would
  // miss imports that preparation left outside the deployed module root.
  const root = fileURLToPath(new URL('../dist/server/', import.meta.url));
  const files = (await readdir(root, { recursive: true })).filter(name => /\.(?:mjs|js)$/.test(name));
  const worker = new Miniflare({
    // Match Wrangler's explicit ES module upload, including dynamic imports.
    modules: ['demo-worker.mjs', ...files.filter(name => name !== 'demo-worker.mjs')]
      .map(name => ({ type: 'ESModule', path: path.join(root, name) })),
    modulesRoot: root,
    compatibilityDate: '2026-05-15',
    compatibilityFlags: ['nodejs_compat'],
    bindings: { REGISTRATION_ELIGIBILITY_ENABLED: 'true' },
    outboundService: () => { throw new Error('The prepared Worker smoke test must not contact external services.'); },
  });
  t.after(() => worker.dispose());

  const policy = await worker.dispatchFetch('https://map.example.test/api/registration-policy');
  assert.equal(policy.status, 200);
  assert.deepEqual(await policy.json(), { restricted: true });

  const roster = await worker.dispatchFetch('https://map.example.test/api/contributor-roster');
  assert.equal(roster.status, 401);
  assert.deepEqual(await roster.json(), { error: 'sign_in_required' });

  const pending = await worker.dispatchFetch('https://map.example.test/api/pending-places');
  assert.equal(pending.status, 200);
  assert.deepEqual(await pending.json(), { places: [] });
});
