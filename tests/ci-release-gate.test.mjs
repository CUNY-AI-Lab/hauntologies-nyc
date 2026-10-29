import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('release refuses missing credentials or a mismatched revision before contacting services', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'haunt-release-gate-'));
  try {
    const marker = path.join(dir, 'contacted');
    writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\nprintf called > "$CI_GATE_PROBE"\n', { mode: 0o755 });
    const sha = 'a'.repeat(40);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, CI_GATE_PROBE: marker,
      GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, EXPECTED_MAIN_SHA: sha,
      RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: path.join(dir, 'summary'), CLOUDFLARE_API_TOKEN: '' };
    const run = overrides => spawnSync('bash', ['scripts/ci-release.sh'], { encoding: 'utf8', env: { ...env, ...overrides } });
    const noCredential = run({});
    assert.notEqual(noCredential.status, 0);
    assert.match(noCredential.stderr, /No CI deployment credential/);
    const wrongRevision = run({ EXPECTED_MAIN_SHA: 'b'.repeat(40), CLOUDFLARE_API_TOKEN: 'synthetic' });
    assert.notEqual(wrongRevision.status, 0);
    assert.match(wrongRevision.stderr, /workflow revision differs/);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
