import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sha = 'a'.repeat(40);
const releaseScript = path.resolve('scripts/ci-release.sh');
const checkScript = path.resolve('scripts/check-code-only-release.mjs');
const expectedConfig = () => ({
  name:'hauntologies-nyc', account_id:'452c33847cf5cb1e46f391fca32fd1b5', main:'demo-worker.mjs', no_bundle:true,
  workers_dev:true, preview_urls:false, build:{watch_dir:'./src'}, migrations:[],
  topLevelName:'hauntologies-nyc',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],
  dev:{ip:'localhost',local_protocol:'http',upstream_protocol:'http',enable_containers:true,generate_types:false},
  legacy_env:true,jsx_factory:'React.createElement',jsx_fragment:'React.Fragment',
  rules:[{type:'ESModule',globs:['**/*.js','**/*.mjs']}],observability:{enabled:true},define:{},
  vars:{CAIL_ENABLED:'false',MAP_ACCOUNTS_ENABLED:'true',REGISTRATION_ELIGIBILITY_ENABLED:'true',CONTRIBUTIONS_OPEN_REVIEW:'true'},
  d1_databases:[{binding:'DB',database_name:'hauntologies-nyc',database_id:'df7f1e92-e339-4e25-ac30-989dd68d8dfc'}],
  services:[{binding:'ACCOUNT_MAIL',service:'cail-tools-admission',entrypoint:'AdmissionHauntologiesAccountMail',props:{app:'hauntologies-nyc',origin:'https://hauntologies-nyc.ailab-452.workers.dev'}}],
  assets:{directory:'../client',run_worker_first:['/api','/api/*','/auth','/auth/*','/data/source-inventory.json']},
});
const fake = String.raw`#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const name = path.basename(process.argv[1]), args = process.argv.slice(2), sha = process.env.EXPECTED_MAIN_SHA;
const state = process.env.CI_MOCK_STATE;
fs.appendFileSync(process.env.CI_MOCK_LOG, name+' '+args.join(' ')+'\n');
if (name === 'gh') {
  const file=process.env.CI_MOCK_GH_COUNT, count=(fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0)+1;
  fs.writeFileSync(file,String(count));
  console.log(process.env.CI_MOCK_MAIN_CHANGED || (process.env.CI_MOCK_MAIN_CHANGES_ON_CALL && count>=Number(process.env.CI_MOCK_MAIN_CHANGES_ON_CALL)) ? 'b'.repeat(40) : sha);
}
else if (name === 'git') {
  if (args[0] === 'rev-parse') {
    if(args[1]==='--verify' && process.env.CI_MOCK_UNKNOWN_TAG)process.exit(1);
    console.log(args[1] === 'HEAD' ? (process.env.CI_MOCK_WRONG_CHECKOUT ? 'b'.repeat(40) : sha) : '1234567');
  }
  if (args[0] === 'diff' && args.includes('drizzle') && process.env.CI_MOCK_MIGRATION_DIFF) process.exit(1);
  if (args[0] === 'diff' && !args.includes('drizzle') && process.env.CI_MOCK_DIRTY_SOURCE) process.exit(1);
} else if (name === 'sleep') process.exit(0);
else if (name === 'curl') {
  const url = args.find(x => x.startsWith('https://')) || '', output = args.indexOf('-o');
  if (url.endsWith('/api/access-status')) console.log(JSON.stringify({enabled:true,account_mode:'map',dashboard_enabled:false}));
  else if (url.endsWith('/api/contributor-roster')) { fs.writeFileSync(args[output+1], '{}'); process.stdout.write(process.env.CI_MOCK_ROSTER_OPEN?'200':'401'); }
  else { const asset = path.basename(url); if(process.env.CI_MOCK_ASSET_CHANGED)fs.writeFileSync(args[output+1],'wrong');else fs.copyFileSync(path.join('dist','client',asset), args[output+1]); }
} else if (name === 'wrangler') {
  if (args[0] === 'deploy') { fs.writeFileSync(state, 'deployed'); if(process.env.CI_MOCK_DEPLOY_ERROR)process.exit(1); console.log('synthetic deploy'); }
  else if (args[0] === 'deployments') console.log(JSON.stringify({versions:[{version_id:fs.existsSync(state)?'after':'before',percentage:100}]}));
  else if (args[0] === 'versions') {
    const after=args[2]==='after';
    const vars={CAIL_ENABLED:'false',MAP_ACCOUNTS_ENABLED:'true',REGISTRATION_ELIGIBILITY_ENABLED:'true',CONTRIBUTIONS_OPEN_REVIEW:'true',EXTRA_VARIABLE:'original'};
    if(after && process.env.CI_MOCK_CHANGED_VAR)vars.EXTRA_VARIABLE='changed';
    const bindings=[{type:'d1',name:'DB',database_id:process.env.CI_MOCK_WRONG_DB?'wrong':'df7f1e92-e339-4e25-ac30-989dd68d8dfc'},
      {type:'service',name:'ACCOUNT_MAIL',service:'cail-tools-admission',entrypoint:'AdmissionHauntologiesAccountMail',environment:'production'},
      {type:'secret_text',name:'MAP_AUTH_SECRET'},{type:'secret_text',name:'REGISTRATION_GUEST_CODE'},
      ...Object.entries(vars).map(([name,text])=>({type:'plain_text',name,text}))];
    if(after&&process.env.CI_MOCK_REMOVED_SECRET)bindings.splice(bindings.findIndex(x=>x.name==='MAP_AUTH_SECRET'),1);
    if(process.env.CI_MOCK_UNKNOWN_BINDING)bindings.push({type:'kv_namespace',name:'SURPRISE',namespace_id:'other'});
    console.log(JSON.stringify({annotations:{'workers/tag':!after || process.env.CI_MOCK_WRONG_TAG ? '1234567' : sha},resources:{bindings}}));
  } else process.exit(91); // A D1 call is never part of this release.
} else process.exit(2);
`;
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'haunt-release-code-only-'));
  for(const p of ['bin','node_modules/.bin','dist/client','dist/server','scripts']) mkdirSync(path.join(dir,p),{recursive:true});
  for(const name of ['gh','git','curl','sleep']) writeFileSync(path.join(dir,'bin',name),fake,{mode:0o755});
  writeFileSync(path.join(dir,'node_modules/.bin/wrangler'),fake,{mode:0o755});
  copyFileSync(checkScript,path.join(dir,'scripts/check-code-only-release.mjs'));
  for(const asset of ['app.js','contributions.js','place-history.js']) writeFileSync(path.join(dir,'dist/client',asset),asset);
  const config=path.join(dir,'dist/server/wrangler.live.json');writeFileSync(config,JSON.stringify(expectedConfig()));
  const state=path.join(dir,'deployed'),summary=path.join(dir,'summary'),log=path.join(dir,'calls');
  const env={...process.env,PATH:`${path.join(dir,'bin')}:${process.env.PATH}`,GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,EXPECTED_MAIN_SHA:sha,GH_TOKEN:'synthetic',CLOUDFLARE_API_TOKEN:'synthetic-token',RUNNER_TEMP:dir,GITHUB_STEP_SUMMARY:summary,CI_MOCK_STATE:state,CI_MOCK_LOG:log,CI_MOCK_GH_COUNT:path.join(dir,'gh-count')};
  return {dir,config,state,summary,log,run:overrides=>spawnSync('bash',[releaseScript],{cwd:dir,encoding:'utf8',env:{...env,...overrides}}),cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test('wrong revision or missing credential stops before any service call',()=>{
  const f=fixture();try{
    for(const [env,pattern] of [[{CLOUDFLARE_API_TOKEN:''},/No CI deployment credential/],[{EXPECTED_MAIN_SHA:'b'.repeat(40)},/workflow revision differs/],[{GITHUB_REF:'refs/heads/other'},/Release must run from main/]]){
      const r=f.run(env);assert.notEqual(r.status,0);assert.match(r.stderr,pattern);
    }
    assert.equal(existsSync(f.log),false);
  }finally{f.cleanup();}
});

test('code-only release checks versions, bindings, variables and assets without D1 calls',()=>{
  const f=fixture();try{
    const r=f.run({});assert.equal(r.status,0,r.stderr);
    const calls=readFileSync(f.log,'utf8'),summary=readFileSync(f.summary,'utf8');
    assert.match(calls,/git diff --quiet .* -- drizzle :\(glob\)\*\*\/migrations\/\*\*/);
    assert.match(calls,/wrangler deploy .*--keep-vars/);assert.doesNotMatch(calls,/wrangler d1 /);
    assert.match(summary,/No D1 schema, table counts, or Time Travel bookmark were checked/);
    assert.match(summary,/Serving Worker version: `after`/);assert.doesNotMatch(summary,/synthetic-token|original/);
  }finally{f.cleanup();}
});

test('migration drift, changed main, wrong checkout or binding stop before deploy',()=>{
  for(const [env,pattern] of [[{CI_MOCK_MIGRATION_DIFF:'1'},/Migration changes need separate review/],[{CI_MOCK_MAIN_CHANGED:'1'},/Main changed before preflight/],[{CI_MOCK_MAIN_CHANGES_ON_CALL:'2'},/Main changed before deployment/],[{CI_MOCK_WRONG_CHECKOUT:'1'},/Checkout differs/],[{CI_MOCK_DIRTY_SOURCE:'1'},/Tracked source changed/],[{CI_MOCK_UNKNOWN_TAG:'1'},/no resolvable source tag/],[{CI_MOCK_WRONG_DB:'1'},/database binding does not match/],[{CI_MOCK_UNKNOWN_BINDING:'1'},/unreviewed binding type/]]){
    const f=fixture();try{const r=f.run(env);assert.notEqual(r.status,0);assert.match(r.stderr,pattern);assert.equal(existsSync(f.state),false);}finally{f.cleanup();}
  }
});

test('deploy-time build, resource additions and migrations fail closed',()=>{
  const changes=[
    config=>{config.build.command='node migrate.mjs';},
    config=>{config.migrations=[{tag:'v1',new_sqlite_classes:['Example']}];},
    config=>{config.d1_databases[0].migrations_dir='drizzle';},
    config=>{config.kv_namespaces=[{binding:'OTHER',id:'x'}];},
    config=>{config.vars.MAP_ACCOUNTS_ENABLED='false';},
    config=>{config.observability={enabled:true,head_sampling_rate:1};},
    config=>{config.rules.push({type:'CommonJS',globs:['**/*.cjs']});},
    config=>{config.unsafe={bindings:[{name:'EXTRA',type:'custom'}]};},
  ];
  for(const change of changes){const f=fixture();try{const config=expectedConfig();change(config);writeFileSync(f.config,JSON.stringify(config));const r=f.run({});assert.notEqual(r.status,0);assert.equal(existsSync(f.state),false);}finally{f.cleanup();}}
});

test('uncertain deploy or failed readback requires inspection before retry',()=>{
  for(const [env,pattern] of [[{CI_MOCK_DEPLOY_ERROR:'1'},/Deployment outcome uncertain/],[{CI_MOCK_WRONG_TAG:'1'},/Inspect the deployment before retrying/],[{CI_MOCK_CHANGED_VAR:'1'},/bindings or variables changed/],[{CI_MOCK_REMOVED_SECRET:'1'},/Inspect the deployment before retrying/],[{CI_MOCK_ROSTER_OPEN:'1'},/Signed-out roster protection/],[{CI_MOCK_ASSET_CHANGED:'1'},/Delivered app.js differs/],[{CI_MOCK_MAIN_CHANGES_ON_CALL:'3'},/Main changed during the release/]]){
    const f=fixture();try{const r=f.run(env);assert.notEqual(r.status,0);assert.match(r.stderr,pattern);assert.equal(existsSync(f.state),true);assert.doesNotMatch(r.stderr,/synthetic-token|original/);}finally{f.cleanup();}
  }
});
