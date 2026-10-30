import test from 'node:test';
import assert from 'node:assert/strict';
import {contributorsHarness,proposal} from './fixtures/contributors-harness.mjs';
import {LEGACY_SNAPSHOT_SQL,planLegacyTransition,decodeLegacySnapshot,legacyImageMayPublish} from '../scripts/lib/legacy-transition.mjs';
import {releaseCreditSQL,LEGACY_TRANSITION_POLICY} from '../server/public-attribution.mjs';
import {hash} from '../server/workflow-core.mjs';
import {readPublicContributions} from '../server/public-contributions.mjs';

const actor='map_10000000-0000-4000-8000-000000000001';
test('legacy image selection requires an affirmative rights statement',()=>{
 for(const value of ['unknown','New York Public Library','Synthetic artist',''])assert.equal(legacyImageMayPublish(value),false);
 for(const value of ['CC0','CC BY-SA 4.0','Public domain','Used with permission from the photographer'])assert.equal(legacyImageMayPublish(value),true);
});
async function fixture(t){
 const h=contributorsHarness(t,{publicationMode:'legacy'});
 h.db.native.prepare('INSERT INTO hny_auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(actor.slice(4),'Never public name','night.owl@example.test',1,'2026-10-29','2026-10-29');
 const envelope={...proposal(),public_credit:{consent:false,label:''}};
 const response=await h.call('submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(envelope)},actor);assert.equal(response.status,201);
 const id=response.body.submission.id;h.db.native.prepare("UPDATE workflow_submissions SET review_state='approved',created_at='2026-10-29T00:00:00.000Z' WHERE id=?").run(id);
 return{...h,id,snapshot:()=>decodeLegacySnapshot(h.db.native.prepare(LEGACY_SNAPSHOT_SQL).all())};
}
test('offline transition uses verified prefix, preserves original revision, and proves forward/rollback replay',async t=>{
 const h=await fixture(t),snapshot=h.snapshot();assert.ok(!JSON.stringify(snapshot).includes('@example.test'));assert.ok(!JSON.stringify(snapshot).includes('Never public name'));
 const plan=await planLegacyTransition(snapshot,{at:'2026-10-30T08:00:00.000Z'});
 assert.equal(plan.report.publications,1);assert.equal(plan.report.new_places,1);assert.equal(plan.report.skipped.length,0);
 assert.equal(plan.after.workflow_revisions.length,plan.before.workflow_revisions.length+1);
 const event=plan.after.workflow_events.find(e=>e.kind==='direct_publish'),data=JSON.parse(event.event_json);assert.equal(data.moniker,'night.owl');assert.equal(data.migration.initiated_by,'authorized_operator');assert.equal(data.migration.attribution,'verified_owner');
 assert.equal(h.db.native.prepare('SELECT review_state FROM workflow_submissions WHERE id=?').get(h.id).review_state,'approved','planner did not change its source');
 assert.match(plan.forward_sql,/emailVerified=1/);assert.match(plan.rollback_sql,/legacy_transition_rollback/);
});
test('unverified owners and missing explicit review submission evidence stay unchanged',async t=>{
 const h=await fixture(t);h.db.native.prepare('UPDATE hny_auth_user SET emailVerified=0').run();
 let plan=await planLegacyTransition(h.snapshot());assert.equal(plan.report.publications,0);assert.equal(plan.report.skipped[0].reason,'missing_or_invalid_verified_owner_prefix');
 h.db.native.prepare('UPDATE hny_auth_user SET emailVerified=1').run();h.db.native.prepare("UPDATE workflow_events SET event_json='{}' WHERE kind='submit'").run();
 plan=await planLegacyTransition(h.snapshot());assert.equal(plan.report.publications,0);assert.equal(plan.report.skipped[0].reason,'owner_publication_intent_unproven');
});
test('drafts, withheld, revoked and rejected submissions are absent from the bounded snapshot',async t=>{
 const h=await fixture(t);
 for(const state of ['draft','withheld','revoked','rejected','changes_requested']){h.db.native.prepare('UPDATE workflow_submissions SET review_state=? WHERE id=?').run(state,h.id);assert.equal(h.snapshot().length,0);}
});
test('hidden attribution blocks prefix publication and chosen public monikers are preserved',async t=>{
 const h=await fixture(t);h.db.native.prepare('INSERT INTO contributor_roster_hidden(user_id,created_at) VALUES (?,?)').run(actor.slice(4),'2026-10-29');
 let plan=await planLegacyTransition(h.snapshot());assert.equal(plan.report.publications,0);assert.equal(plan.report.skipped[0].reason,'public_attribution_withheld');
 h.db.native.prepare('DELETE FROM contributor_roster_hidden').run();
 const snapshot=await Promise.all(h.snapshot().map(async row=>{if(row.section!=='workflow_revisions')return row;const r=JSON.parse(row.data),e=JSON.parse(r.raw_json);e.public_credit={consent:true,label:'Chosen name',identity:'moniker'};r.raw_json=JSON.stringify(e);r.raw_hash=await hash(r.raw_json);return{...row,data:JSON.stringify(r)};}));
 plan=await planLegacyTransition(snapshot);assert.equal(JSON.parse(plan.after.workflow_events.find(e=>e.kind==='direct_publish').event_json).moniker,'Chosen name');
});
test('attribution overlay is bound to owner, policy and revision; it cannot overwrite a chosen label',async t=>{
 const h=await fixture(t),head=h.db.native.prepare('SELECT * FROM workflow_submissions WHERE id=?').get(h.id);
 const event={policy:LEGACY_TRANSITION_POLICY,public_credit:{consent:true,label:'night.owl',identity:'email_prefix'}};
 h.db.native.prepare('INSERT INTO workflow_events(id,submission_id,job_id,revision,actor_id,kind,event_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run('synthetic_attribution',h.id,null,head.current_revision,actor,'public_attribution',JSON.stringify(event),'2026-10-30');
 const read=()=>JSON.parse(h.db.native.prepare(`SELECT ${releaseCreditSQL()} AS credit FROM workflow_submissions s JOIN workflow_revisions r ON r.submission_id=s.id AND r.revision=s.current_revision WHERE s.id=?`).get(h.id).credit).public_credit;
 assert.equal(read().label,'night.owl');
 h.db.native.prepare("UPDATE workflow_events SET actor_id='wrong_owner' WHERE id='synthetic_attribution'").run();assert.equal(read(),null);
 h.db.native.prepare("UPDATE workflow_events SET actor_id=? WHERE id='synthetic_attribution'").run(actor);
 h.db.native.prepare("UPDATE workflow_revisions SET raw_json=json_set(raw_json,'$.public_credit',json(?)) WHERE submission_id=?").run(JSON.stringify({consent:true,label:'Chosen name',identity:'moniker'}),h.id);assert.equal(read().label,'Chosen name');
});
test('SQL replay counts once; rollback refuses a later writer and cannot replay over subsequent work',async t=>{
 const h=await fixture(t),plan=await planLegacyTransition(h.snapshot());
 h.db.native.exec(plan.forward_sql);h.db.native.exec(plan.forward_sql);
 assert.equal(h.db.native.prepare("SELECT COUNT(*) AS n FROM workflow_events WHERE kind='direct_publish'").get().n,1);
 const record=h.db.native.prepare('SELECT * FROM approved_records').get();
 h.db.native.prepare("UPDATE approved_records SET raw_json=json_set(raw_json,'$.title','Later writer') WHERE id=?").run(record.id);
 h.db.native.exec(plan.rollback_sql);assert.equal(h.db.native.prepare('SELECT raw_json FROM approved_records WHERE id=?').get(record.id).raw_json.includes('Later writer'),true);
 assert.equal(h.db.native.prepare('SELECT review_state FROM workflow_submissions WHERE id=?').get(h.id).review_state,'published');
 h.db.native.prepare('UPDATE approved_records SET raw_json=? WHERE id=?').run(record.raw_json,record.id);
 h.db.native.exec(plan.rollback_sql);assert.equal(h.db.native.prepare('SELECT review_state FROM workflow_submissions WHERE id=?').get(h.id).review_state,'approved');
 assert.equal(h.db.native.prepare("SELECT COUNT(*) AS n FROM workflow_events WHERE kind='direct_publish'").get().n,0);
 h.db.native.prepare("UPDATE workflow_submissions SET review_state='draft' WHERE id=?").run(h.id);
 h.db.native.exec(plan.rollback_sql);h.db.native.exec(plan.forward_sql);assert.equal(h.db.native.prepare('SELECT review_state FROM workflow_submissions WHERE id=?').get(h.id).review_state,'draft');
});
test('matching email prefixes remain separate attribution identities and are audited as a collision',async t=>{
 const h=await fixture(t),other='map_20000000-0000-4000-8000-000000000002';
 h.db.native.prepare('INSERT INTO hny_auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(other.slice(4),'Private second name','night.owl@other.test',1,'2026-10-29','2026-10-29');
 const response=await h.call('submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify({...proposal('Second place'),public_credit:{consent:false,label:''}})},other);assert.equal(response.status,201);
 h.db.native.prepare("UPDATE workflow_submissions SET review_state='approved',created_at='2026-10-29T00:00:00.000Z'").run();
 const plan=await planLegacyTransition(h.snapshot());assert.equal(plan.report.colliding_prefix_groups,1);assert.equal(plan.report.publications,2);
 h.db.native.exec(plan.forward_sql);const summary=await readPublicContributions(h.db,h.staticRecords);
 assert.equal(summary.contributors.length,2);assert.notEqual(summary.contributors[0].id,summary.contributors[1].id);assert.equal(summary.contributors[0].name,'night.owl');assert.equal(summary.contributors[1].name,'night.owl');
 assert.ok(!JSON.stringify(summary).includes('@other.test'));assert.ok(!JSON.stringify(summary).includes(actor));
});
