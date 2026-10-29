import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

// This contract is intentionally specific to the existing Hauntologies Worker.
// Requiring a reviewed change for a new binding also prevents resource creation
// or an automatic migration from being smuggled into a code-only release.
const expectedVars = {
  CAIL_ENABLED: 'false',
  MAP_ACCOUNTS_ENABLED: 'true',
  REGISTRATION_ELIGIBILITY_ENABLED: 'true',
  CONTRIBUTIONS_OPEN_REVIEW: 'true',
};
const allowedKeys = new Set('account_id ai_search ai_search_namespaces analytics_engine_datasets artifacts assets build cloudchamber compatibility_date compatibility_flags d1_databases define dev dispatch_namespaces durable_objects flagship hyperdrive jsx_factory jsx_fragment kv_namespaces legacy_env logfwdr main migrations mtls_certificates name no_bundle observability pipelines preview_urls python_modules queues r2_buckets ratelimits rules secrets_store_secrets send_email services topLevelName triggers unsafe_hello_world vars vectorize vpc_networks vpc_services worker_loaders workers_dev workflows'.split(' '));
const emptyArrays = 'ai_search ai_search_namespaces analytics_engine_datasets artifacts dispatch_namespaces flagship hyperdrive kv_namespaces migrations mtls_certificates pipelines r2_buckets ratelimits secrets_store_secrets send_email unsafe_hello_world vectorize vpc_networks vpc_services worker_loaders workflows'.split(' ');
const dbId = 'df7f1e92-e339-4e25-ac30-989dd68d8dfc';
const accountId = '452c33847cf5cb1e46f391fca32fd1b5';
const fail = message => { throw new Error(message); };
const equal = (actual, expected, message) => { if (!isDeepStrictEqual(actual, expected)) fail(message); };
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));

function checkConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('Prepared configuration is invalid.');
  if (Object.keys(config).some(key => !allowedKeys.has(key))) fail('Prepared configuration contains an unreviewed setting.');
  if (config.name !== 'hauntologies-nyc' || config.account_id !== accountId || config.main !== 'demo-worker.mjs' || config.no_bundle !== true || config.workers_dev !== true || config.preview_urls !== false) fail('Prepared Worker identity or route settings do not match the code-only contract.');
  equal(config.vars, expectedVars, 'Prepared variables do not match the code-only contract.');
  equal(config.d1_databases, [{binding:'DB',database_name:'hauntologies-nyc',database_id:dbId}], 'Prepared database binding or migration settings do not match the code-only contract.');
  equal(config.services, [{binding:'ACCOUNT_MAIL',service:'cail-tools-admission',entrypoint:'AdmissionHauntologiesAccountMail',props:{app:'hauntologies-nyc',origin:'https://hauntologies-nyc.ailab-452.workers.dev'}}], 'Prepared service binding does not match the code-only contract.');
  equal(config.assets, {directory:'../client',run_worker_first:['/api','/api/*','/auth','/auth/*','/data/source-inventory.json']}, 'Prepared asset binding or routes do not match the code-only contract.');
  equal(config.topLevelName, 'hauntologies-nyc', 'Prepared top-level Worker name differs from the contract.');
  equal(config.compatibility_date, '2026-05-15', 'Compatibility settings need separate review.');
  equal(config.compatibility_flags, ['nodejs_compat'], 'Compatibility settings need separate review.');
  equal(config.dev, {ip:'localhost',local_protocol:'http',upstream_protocol:'http',enable_containers:true,generate_types:false}, 'Development settings need separate review.');
  equal(config.legacy_env, true, 'Environment settings need separate review.');
  equal(config.jsx_factory, 'React.createElement', 'JSX settings need separate review.');
  equal(config.jsx_fragment, 'React.Fragment', 'JSX settings need separate review.');
  equal(config.rules, [{type:'ESModule',globs:['**/*.js','**/*.mjs']}], 'Module rules need separate review.');
  equal(config.observability, {enabled:true}, 'Observability settings need separate review.');
  equal(config.define, {}, 'Compile-time definitions need separate review.');
  for (const key of emptyArrays) equal(config[key] ?? [], [], 'Prepared configuration contains an unreviewed binding or migration.');
  equal(config.durable_objects ?? {bindings:[]}, {bindings:[]}, 'Durable Object bindings or migrations need separate review.');
  equal(config.queues ?? {producers:[],consumers:[]}, {producers:[],consumers:[]}, 'Queue bindings need separate review.');
  equal(config.logfwdr ?? {bindings:[]}, {bindings:[]}, 'Log bindings need separate review.');
  equal(config.cloudchamber ?? {}, {}, 'Cloudchamber settings need separate review.');
  equal(config.triggers ?? {}, {}, 'Triggers need separate review.');
  equal(config.python_modules ?? {exclude:['**/*.pyc']}, {exclude:['**/*.pyc']}, 'Python module settings need separate review.');
  equal(config.build, {watch_dir:'./src'}, 'Custom deploy-time build commands need separate review.');
}

function snapshot(version, config) {
  const tag = version?.annotations?.['workers/tag'];
  if (typeof tag !== 'string' || !/^[0-9a-f]{7,40}$/.test(tag)) fail('The Worker version has no resolvable source tag.');
  const bindings = version?.resources?.bindings;
  if (!Array.isArray(bindings)) fail('Worker binding metadata is unavailable.');
  const names = new Set(), plain = new Map(), out = [];
  for (const b of bindings) {
    if (!b || typeof b.name !== 'string' || !b.name || names.has(b.name)) fail('Worker binding metadata is invalid.');
    names.add(b.name);
    if (b.type === 'plain_text') {
      if (typeof b.text !== 'string') fail('Worker variable metadata is unavailable.');
      plain.set(b.name, b.text);
      out.push({type:b.type,name:b.name,sha256:createHash('sha256').update(b.text).digest('hex')});
    } else if (b.type === 'secret_text') {
      // Cloudflare does not return secret values. Record the binding's name only.
      out.push({type:b.type,name:b.name});
    } else if (b.type === 'd1') {
      if (b.name !== 'DB' || b.database_id !== dbId) fail('The serving database binding does not match the intended database.');
      out.push({type:b.type,name:b.name,database_id:b.database_id});
    } else if (b.type === 'service') {
      if (b.name !== 'ACCOUNT_MAIL' || b.service !== 'cail-tools-admission' || b.entrypoint !== 'AdmissionHauntologiesAccountMail' || b.environment !== 'production') fail('The serving mail binding does not match the intended service.');
      out.push({type:b.type,name:b.name,service:b.service,entrypoint:b.entrypoint,environment:b.environment});
    } else fail('The Worker has an unreviewed binding type.');
  }
  if (bindings.filter(b => b.type === 'd1').length !== 1 || bindings.filter(b => b.type === 'service').length !== 1 || !names.has('MAP_AUTH_SECRET') || !names.has('REGISTRATION_GUEST_CODE')) fail('A required Worker binding is missing.');
  for (const [name,value] of Object.entries(config.vars)) if (plain.get(name) !== value) fail('A serving variable differs from the prepared release.');
  if (!bindings.some(b => b.name === 'MAP_AUTH_SECRET' && b.type === 'secret_text') || !bindings.some(b => b.name === 'REGISTRATION_GUEST_CODE' && b.type === 'secret_text')) fail('Required Worker secrets are not present as secret bindings.');
  out.sort((a,b) => a.name.localeCompare(b.name));
  return {tag,bindings:out};
}

try {
  const [mode, configPath] = process.argv.slice(2);
  const config = readJSON(configPath);
  checkConfig(config);
  if (mode === 'snapshot') process.stdout.write(JSON.stringify(snapshot(readJSON(0), config)) + '\n');
  else if (mode !== 'config') fail('Invalid code-only release check.');
} catch (error) {
  // Never print a configuration, binding value, or raw provider response.
  const safe = error instanceof SyntaxError ? 'A required JSON document is invalid.' : error.message;
  console.error(safe);
  process.exitCode = 1;
}
