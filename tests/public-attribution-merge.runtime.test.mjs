import test from 'node:test';
import assert from 'node:assert/strict';
import { contributorsHarness, proposal, publish } from './fixtures/contributors-harness.mjs';
import { harness } from './fixtures/map-accounts-harness.mjs';
import { attributionMergePlan, attributionMergeRollback } from '../scripts/lib/public-attribution-merge.mjs';
import { readPublicContributions } from '../server/public-contributions.mjs';

test('actual Worker/D1 applies and reverses only one actor attribution event with safe replay',async t=>{
  const local=contributorsHarness(t),runtime=await harness(t,{publicationMode:'direct'}),actor='map_synthetic_merge_runtime';
  local.db.native.prepare('INSERT INTO hny_auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(actor.slice(4),'Private fixture','private@example.test',1,0,0);
  for(const moniker of ['cen','cliu5'])assert.equal((await publish(local,proposal('Synthetic '+moniker),actor,{moniker})).status,200);
  for(const table of ['hny_auth_user','workflow_submissions','workflow_revisions','workflow_events','workflow_receipts','approved_records'])for(const row of local.db.native.prepare('SELECT * FROM '+table).all())await runtime.db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
  const p=attributionMergePlan({id:'synthetic_runtime_merge',actor,aliases:['cen','cliu5'],name:'Cen',at:'2026-10-30T21:00:00.000Z'});
  await runtime.db.prepare(p.sql).run();await runtime.db.prepare(p.sql).run();
  const result=await readPublicContributions(runtime.db,local.staticRecords);assert.equal(result.contributors.length,1);assert.equal(result.contributors[0].name,'Cen');assert.equal(result.contributors[0].published,2);
  const records=await runtime.call('/api/published-records');assert.equal(records.status,200);assert.ok(records.body.records.every(record=>record.contributors[0]==='Cen'));
  assert.ok(!JSON.stringify(result).includes(actor));
  const rollback=attributionMergeRollback(p,{id:'synthetic_runtime_rollback',at:'2026-10-30T21:01:00.000Z'});
  await runtime.db.prepare(rollback).run();await runtime.db.prepare(rollback).run();await runtime.db.prepare(p.sql).run();
  const restored=await readPublicContributions(runtime.db,local.staticRecords);assert.equal(restored.contributors.length,2);assert.equal(restored.totals.published,2);
  assert.equal((await runtime.db.prepare("SELECT count(*) n FROM workflow_events WHERE kind='public_attribution_merge'").first()).n,2);
});
