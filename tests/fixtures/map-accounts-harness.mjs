import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { MAP_ORIGIN } from '../../deployment/map-accounts.mjs';

export const password = 'Synthetic-local-password-482!';
export const replacement = 'Synthetic-replacement-password-293!';
const root = path.resolve(import.meta.dirname, '../..');
let bundle;
export async function harness(t, {mailFailure = false, eligibilityEnabled = false, guestCode} = {}) {
  if (!bundle) {
    const compiled = await build({ stdin: { contents: `
      import { createDemoWorker } from './deployment/demo-gate.mjs';
      import { handleRegistration } from './server/registration.mjs';
      import { createWorkflowService } from './server/workflow-service.mjs';
      import { createWorkflowStore } from './server/workflow-store.mjs';
      import { reviewAuthorization } from './server/review-authorization.mjs';
      export default { async fetch(request, env, ctx) {
        env.ACCOUNT_MAIL = { async send(input) {
          if (env.MAIL_FAILURE === 'true') return {status:'delivery_unknown'};
          await env.DB.prepare('INSERT INTO hny_test_mail (email,kind,token,expires_at) VALUES (?,?,?,?)').bind(input.email,input.kind,input.token,input.expiresAt).run();
          return { status:'accepted' };
        }};
        const handler = {fetch: req => createWorkflowService({store:createWorkflowStore(env.DB), taskSeeds:{tasks:[]}, authorization:reviewAuthorization(env.CONTRIBUTIONS_REVIEWER_IDS), geography:{boundaries:${await readFile(path.join(root,'public/data/nyc-borough-boundaries.geojson'),'utf8')}}, staticRecords:[{id:'second-avenue-deli',title:'Synthetic existing place',latitude:40.75,longitude:-73.98}]}).handle(req)};
        return createDemoWorker(handler, handleRegistration).fetch(request,env,ctx);
      }};
    `, resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node', conditions: ['workerd', 'node'], target: 'es2022' });
    bundle = compiled.outputFiles[0].text;
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'hny-auth-test-'));
  const baseOptions = { modules: [{type:'ESModule',path:'worker.mjs',contents:bundle}], compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], d1Persist: directory, bindings: { MAP_ACCOUNTS_ENABLED:'true', MAP_AUTH_SECRET:'local-fixture-secret-only-12345678901234567890', MAIL_FAILURE: String(mailFailure), REGISTRATION_ELIGIBILITY_ENABLED:String(eligibilityEnabled), ...(guestCode === undefined ? {} : {REGISTRATION_GUEST_CODE:guestCode}) } };
  const mf = new Miniflare(baseOptions);
  t.after(async () => { await mf.dispose(); await rm(directory,{recursive:true,force:true}); });
  let db = await mf.getD1Database('DB');
  for (const file of (await readdir(path.join(root,'drizzle'))).filter(name=>name.endsWith('.sql')).sort()) {
    const sql = await readFile(path.join(root,'drizzle',file),'utf8');
    // D1 exec accepts one statement per line, including trigger bodies.
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (!statement.trim()) continue;
      // Execute full SQL via Miniflare's D1 batch when migrations contain several statements.
      const statements = splitSql(statement);
      await db.batch(statements.map(s=>db.prepare(s)));
    }
  }
  await db.prepare('CREATE TABLE hny_test_mail (email TEXT, kind TEXT, token TEXT, expires_at TEXT)').run();
  let ip = 1;
  const call = async (route, body, cookie='', extras={}) => {
    const response = await mf.dispatchFetch(MAP_ORIGIN+route, {method:body===undefined?'GET':'POST',headers:{origin:MAP_ORIGIN,'content-type':'application/json','cf-connecting-ip':'192.0.2.'+(ip++), ...(cookie?{cookie}:{}), ...extras}, ...(body===undefined?{}:{body:JSON.stringify(body)})});
    let value; try{value=await response.json()}catch{value={}};
    return {status:response.status,body:value,headers:response.headers,cookie:response.headers.getSetCookie().map(s=>s.split(';',1)[0]).join('; ')};
  };
  const token = async (email,kind='verify_email') => (await db.prepare('SELECT token FROM hny_test_mail WHERE email=? AND kind=? ORDER BY rowid DESC LIMIT 1').bind(email,kind).first())?.token;
  const register = async (email, access_code) => {
    assert.equal((await call('/api/auth/register',{email, ...(access_code ? {access_code} : {})})).status,200);
    const result=await call('/api/auth/verify',{token:await token(email),password, ...(access_code ? {access_code} : {})});
    assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.cookie);return result.cookie;
  };
  // Reconfigure the local Worker after observing a registered actor, preserving D1
  // and the remaining bindings as a production configuration update would.
  let bindings = {...baseOptions.bindings};
  const configure = async changes => {
    bindings = {...bindings, ...changes};
    await mf.setOptions({...baseOptions, bindings});
    db = await mf.getD1Database('DB');
  };
  const configureReviewers = ids => configure({CONTRIBUTIONS_REVIEWER_IDS:JSON.stringify(ids)});
  const configureEligibility = (enabled, code) => configure({REGISTRATION_ELIGIBILITY_ENABLED:String(enabled),REGISTRATION_GUEST_CODE:code || ''});
  return {mf,get db(){return db;},call,token,register,configureReviewers,configureEligibility};
}
function splitSql(sql) {
  const lines=sql.split('\n'); const statements=[]; let current=''; let trigger=false;
  for(const line of lines){if(line.trim().startsWith('--'))continue; current+=line+'\n'; if(/CREATE TRIGGER/i.test(line))trigger=true; if(trigger? /END\s*;/i.test(line): /;\s*$/.test(line)){statements.push(current.trim());current='';trigger=false;}}
  if(current.trim())statements.push(current.trim()); return statements;
}

