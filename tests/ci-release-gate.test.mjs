import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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

test('synthetic release checks the serving tag and reports an uncertain readback', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'haunt-release-flow-'));
  const sha = 'a'.repeat(40);
  try {
    mkdirSync(path.join(dir, 'bin'));
    mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(path.join(dir, 'dist', 'client'), { recursive: true });
    const fake = String.raw`#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const name = path.basename(process.argv[1]), args = process.argv.slice(2), sha = process.env.EXPECTED_MAIN_SHA;
const state = process.env.CI_MOCK_STATE;
if (name === 'gh') console.log(sha);
else if (name === 'git') { if (args[0] === 'rev-parse') console.log(args[1] === 'HEAD' ? sha : '1234567'); }
else if (name === 'sleep') process.exit(0);
else if (name === 'curl') {
  const url = args.find(x => x.startsWith('https://')) || '', output = args.indexOf('-o');
  if (url.endsWith('/api/access-status')) console.log(JSON.stringify({enabled:true,account_mode:'map',dashboard_enabled:false}));
  else if (url.endsWith('/api/contributor-roster')) { fs.writeFileSync(args[output+1], '{}'); process.stdout.write('401'); }
  else { const asset = path.basename(url); fs.copyFileSync(path.join('dist','client',asset), args[output+1]); }
} else if (name === 'wrangler') {
  if (args[0] === 'deploy') { fs.writeFileSync(state, 'deployed'); console.log('synthetic deploy'); }
  else if (args[0] === 'deployments') console.log(JSON.stringify({versions:[{version_id:fs.existsSync(state)?'after':'before',percentage:100}]}));
  else if (args[0] === 'versions') console.log(JSON.stringify({annotations:{'workers/tag':args[2] === 'before' || process.env.CI_MOCK_WRONG_TAG ? '1234567' : sha},resources:{bindings:[{type:'d1',name:'DB',database_id:'df7f1e92-e339-4e25-ac30-989dd68d8dfc'},{type:'service',name:'ACCOUNT_MAIL',service:'cail-tools-admission',entrypoint:'AdmissionHauntologiesAccountMail',environment:'production'}]}}));
  else if (args[0] === 'd1' && args[1] === 'time-travel') console.log(JSON.stringify({bookmark:'synthetic-bookmark'}));
  else if (args[0] === 'd1' && args[1] === 'execute') console.log(JSON.stringify([{results:args.includes("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?[{name:'test_table'}]:[{n:0}]}]));
  else process.exit(2);
} else process.exit(2);
`;
    for (const name of ['gh', 'git', 'curl', 'sleep']) writeFileSync(path.join(dir, 'bin', name), fake, { mode: 0o755 });
    writeFileSync(path.join(dir, 'node_modules', '.bin', 'wrangler'), fake, { mode: 0o755 });
    for (const asset of ['app.js', 'contributions.js', 'place-history.js']) writeFileSync(path.join(dir, 'dist', 'client', asset), asset);
    const state = path.join(dir, 'deployed'), summary = path.join(dir, 'summary');
    const env = { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, GITHUB_REF:'refs/heads/main',
      GITHUB_SHA:sha, EXPECTED_MAIN_SHA:sha, GH_TOKEN:'synthetic', CLOUDFLARE_API_TOKEN:'synthetic',
      RUNNER_TEMP:dir, GITHUB_STEP_SUMMARY:summary, CI_MOCK_STATE:state };
    const script = path.resolve('scripts/ci-release.sh');
    const run = overrides => spawnSync('bash', [script], { cwd:dir, encoding:'utf8', env:{...env,...overrides} });
    const success = run({});
    assert.equal(success.status, 0, success.stderr);
    assert.match(readFileSync(summary, 'utf8'), /Serving Worker version: `after`/);
    rmSync(state);
    const uncertain = run({CI_MOCK_WRONG_TAG:'1'});
    assert.notEqual(uncertain.status, 0);
    assert.match(uncertain.stderr, /Inspect the deployment before retrying/);
    assert.equal(existsSync(state), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
