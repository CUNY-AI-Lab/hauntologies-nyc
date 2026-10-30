import test from 'node:test';
import assert from 'node:assert/strict';
import { contributorsHarness, proposal, publish, target } from './fixtures/contributors-harness.mjs';
import { readPublicContributions } from '../server/public-contributions.mjs';
import { contributorCredits, publishedEdits, publishedRecords } from '../server/published-edits.mjs';
import { directHistory } from '../server/direct-publication.mjs';
import { RecordEditModel as Model } from '../server/record-update.mjs';
import { attributionMergePlan, attributionMergeRollback } from '../scripts/lib/public-attribution-merge.mjs';

const actor='map_synthetic_merge';
function account(h) { h.db.native.prepare('INSERT INTO hny_auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(actor.slice(4),'Private fixture','private@example.test',1,0,0); }
function plan() { return attributionMergePlan({id:'synthetic_merge',actor,aliases:['cen','cliu5'],name:'Cen',at:'2026-10-30T21:00:00.000Z'}); }
const read=h=>readPublicContributions(h.db,h.staticRecords);
const snapshots=h=>['workflow_submissions','workflow_revisions','workflow_receipts','approved_records'].map(table=>JSON.stringify(h.db.native.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()));
async function fixture(t) {
  const h=contributorsHarness(t);account(h);
  const first=await publish(h,proposal('First place'),actor,{moniker:'cen'});assert.equal(first.status,200,JSON.stringify(first.body));
  const id=first.body.receipt.result.record_id,resolved=await target(h,id);
  const note={...proposal('Note'),summary:'Synthetic independent note',targets:[{record_id:id,expected_version:resolved.expected_version,expected_hash:resolved.expected_hash}],payload:{explanation:'Synthetic independent note'}};
  const second=await publish(h,note,actor,{moniker:'cliu5'});assert.equal(second.status,200,JSON.stringify(second.body));
  return {h,id,first,second};
}

test('one explicit actor/alias merge combines counts across public views without rewriting work',async t=>{
  const {h,id}=await fixture(t),before=await read(h),stored=snapshots(h),resolved=await target(h,id),p=plan();
  const events=JSON.stringify(h.db.native.prepare("SELECT * FROM workflow_events WHERE kind<>'public_attribution_merge' ORDER BY id").all());
  h.db.native.exec(p.sql);h.db.native.exec(p.sql);
  const after=await read(h);assert.deepEqual(after.totals,before.totals);assert.equal(after.contributors.length,1);assert.equal(after.contributors[0].name,'Cen');assert.equal(after.contributors[0].published,2);
  assert.notEqual(after.snapshot_token,before.snapshot_token);assert.ok(after.activity.every(item=>item.contributor==='Cen'));
  assert.deepEqual((await contributorCredits(h.db)).contributors,[{name:'Cen',count:2}]);
  assert.ok((await publishedEdits(h.db)).every(item=>item.credit==='Cen'));
  const [record]=await publishedRecords(h.db);assert.deepEqual(record.contributors,['Cen']);assert.equal(record.notes[0].moniker,'Cen');
  assert.ok((await directHistory(h.db,id)).items.every(item=>item.moniker==='Cen'));
  assert.deepEqual(snapshots(h),stored);assert.deepEqual(await target(h,id),resolved);
  assert.equal(JSON.stringify(h.db.native.prepare("SELECT * FROM workflow_events WHERE kind<>'public_attribution_merge' ORDER BY id").all()),events);
  assert.equal(h.db.native.prepare("SELECT count(*) n FROM workflow_events WHERE kind='public_attribution_merge'").get().n,1);
  for(const secret of [actor,'private@example.test','Private fixture','public_attribution_merge'])assert.ok(!JSON.stringify(after).includes(secret));
  // A form opened before the merge can still publish with its original target.
  const fields=Model.snapshot(resolved.record),changes=Model.changes(fields,{...fields,description:'Saved from an already open form'});
  const edited=await publish(h,{...proposal('Edit'),type:'record_update',summary:'Existing form',targets:[{record_id:id,expected_version:resolved.expected_version,expected_hash:resolved.expected_hash}],payload:{change_message:'Existing form',changes}},actor,{moniker:'cliu5'});
  assert.equal(edited.status,200,JSON.stringify(edited.body));assert.equal((await read(h)).contributors[0].published,3);assert.equal((await read(h)).contributors[0].edits,1);
});

test('same-name accounts and unapproved aliases stay separate; revocation and privacy remain effective',async t=>{
  const {h,second}=await fixture(t);h.db.native.exec(plan().sql);
  await publish(h,proposal('Another person'),'map_another_actor',{moniker:'cliu5'});
  await publish(h,proposal('Different chosen name'),actor,{moniker:'Other name'});
  let result=await read(h);assert.equal(result.contributors.length,3);assert.equal(result.contributors.find(p=>p.name==='Cen').published,2);
  assert.equal(result.contributors.find(p=>p.name==='cliu5').published,1);assert.equal(result.contributors.find(p=>p.name==='Other name').published,1);
  const revoked=await h.call('revoke',{idempotency_key:crypto.randomUUID(),submission_id:second.body.submission.id,expected_revision:second.body.submission.revision},actor);assert.equal(revoked.status,200);
  result=await read(h);assert.equal(result.contributors.find(p=>p.name==='Cen').published,1);
  h.db.native.prepare('INSERT INTO contributor_roster_hidden(user_id,created_at) VALUES (?,?)').run(actor.slice(4),'2026-10-30');
  result=await read(h);assert.equal(result.contributors.length,1);assert.equal(result.contributors[0].name,'cliu5');assert.equal(result.totals.unattributed,2);
});

test('append-only rollback is idempotent and does not change publication totals or resurrect withdrawn work',async t=>{
  const {h}=await fixture(t),before=await read(h),p=plan();h.db.native.exec(p.sql);
  const rollback=attributionMergeRollback(p,{id:'synthetic_rollback',at:'2026-10-30T21:01:00.000Z'});
  h.db.native.exec(rollback);h.db.native.exec(rollback);h.db.native.exec(p.sql);
  const after=await read(h);assert.deepEqual(after.totals,before.totals);assert.deepEqual(after.contributors.map(p=>p.name),['cen','cliu5']);assert.equal(after.snapshot_token,before.snapshot_token);
  assert.equal(h.db.native.prepare("SELECT count(*) n FROM workflow_events WHERE kind='public_attribution_merge'").get().n,2);
});

test('merge guards refuse unverified accounts, missing consent, missing aliases and conflicting mappings',async t=>{
  const {h}=await fixture(t),p=plan(),count=()=>h.db.native.prepare("SELECT count(*) n FROM workflow_events WHERE kind='public_attribution_merge'").get().n;
  h.db.native.exec('UPDATE hny_auth_user SET emailVerified=0');h.db.native.exec(p.sql);assert.equal(count(),0);
  h.db.native.exec('UPDATE hny_auth_user SET emailVerified=1');
  h.db.native.exec("UPDATE workflow_revisions SET raw_json=json_set(raw_json,'$.public_credit.consent',json('false'))");h.db.native.exec(p.sql);assert.equal(count(),0);
  h.db.native.exec("UPDATE workflow_revisions SET raw_json=json_set(raw_json,'$.public_credit.consent',json('true'))");
  const missing=attributionMergePlan({...p,aliases:['cen','missing']});h.db.native.exec(missing.sql);assert.equal(count(),0);
  h.db.native.exec(p.sql);const conflict=attributionMergePlan({...p,id:'another_merge',name:'CLiu5'});h.db.native.exec(conflict.sql);assert.equal(count(),1);
  assert.throws(()=>attributionMergePlan({...p,name:'private@example.test'}));assert.throws(()=>attributionMergePlan({...p,aliases:['cen',{}]}));
});

test('malformed alias entries cannot expose private names or broaden grouping',async t=>{
  const {h}=await fixture(t),p=plan();h.db.native.exec(p.sql);
  for(const name of ['private@example.test','Bad\nName',{},null]){
    h.db.native.prepare('UPDATE workflow_events SET event_json=json_set(event_json,\'$.name\',json(?)) WHERE id=?').run(JSON.stringify(name),p.id);
    const result=await read(h);assert.deepEqual(result.contributors.map(p=>p.name),['cen','cliu5']);assert.ok(!JSON.stringify(result).includes('private@example.test'));
  }
});
