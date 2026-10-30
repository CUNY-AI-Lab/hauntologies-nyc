import test from 'node:test';
import assert from 'node:assert/strict';
import {contributorsHarness,proposal} from './fixtures/contributors-harness.mjs';
import {harness} from './fixtures/map-accounts-harness.mjs';
import {planLegacyTransition,decodeLegacySnapshot,LEGACY_SNAPSHOT_SQL} from '../scripts/lib/legacy-transition.mjs';

test('D1 executes the bounded snapshot and atomic publication/rollback batches with replay protection',async t=>{
 const local=contributorsHarness(t,{publicationMode:'legacy'}),runtime=await harness(t,{publicationMode:'direct'}),actor='map_10000000-0000-4000-8000-000000000001';
 local.db.native.prepare('INSERT INTO hny_auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(actor.slice(4),'Synthetic name','prefix@example.test',1,'2026-10-29','2026-10-29');
 const saved=await local.call('submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify({...proposal(),public_credit:{consent:false,label:''}})},actor);assert.equal(saved.status,201);
 local.db.native.prepare("UPDATE workflow_submissions SET review_state='approved',created_at='2026-10-29T00:00:00.000Z'").run();
 for(const table of ['hny_auth_user','workflow_submissions','workflow_revisions','workflow_events','workflow_receipts'])for(const row of local.db.native.prepare('SELECT * FROM '+table).all())await runtime.db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
 const snapshot=decodeLegacySnapshot((await runtime.db.prepare(LEGACY_SNAPSHOT_SQL).all()).results),plan=await planLegacyTransition(snapshot);
 assert.equal(plan.report.publications,1);
 const batch=sql=>runtime.db.batch(sql.map(statement=>runtime.db.prepare(statement)));
 await batch(plan.forward_statements);await batch(plan.forward_statements);
 assert.equal((await runtime.db.prepare("SELECT COUNT(*) AS n FROM workflow_events WHERE kind='direct_publish'").first()).n,1);
 assert.equal((await runtime.call('/api/published-records')).body.records[0].contributors[0],'prefix');
 await batch(plan.rollback_statements);await batch(plan.rollback_statements);await batch(plan.forward_statements);
 assert.deepEqual((await runtime.call('/api/published-records')).body.records,[]);
 assert.equal((await runtime.db.prepare('SELECT review_state FROM workflow_submissions WHERE id=?').bind(saved.body.submission.id).first()).review_state,'approved');
});
