import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './fixtures/map-accounts-harness.mjs';
const proposal={schema_version:'1.0',type:'open_proposal',task_ids:[],title:'Synthetic direct Worker place',summary:'Synthetic description.',public_credit:{consent:true,label:'night.owl',identity:'moniker'},sources:[],attachments:[],targets:[],payload:{explanation:'Synthetic description.',geometry:{type:'Point',coordinates:[-74,40.72]}}};
const key=()=>crypto.randomUUID();
test('actual account gate and Workers/D1 publish, replay, revoke and delete with private legacy work',async t=>{
 const h=await harness(t,{publicationMode:'direct'}),owner=await h.register('direct-owner@example.test'),other=await h.register('direct-other@example.test'),actor=(await h.call('/api/auth/session',undefined,owner)).body.actor_id;
 const body={idempotency_key:key(),submission_json:JSON.stringify(proposal),change_summary:'Add a synthetic place'};
 assert.equal((await h.call('/api/contributions/publish',body,'',{'oai-authenticated-user-id':actor})).status,401);
 assert.equal((await h.call('/api/contributions/publish',body,other,{'X-Hauntologies-Actor':actor})).status,409);
 const legacy=await h.call('/api/contributions/submit',{idempotency_key:key(),submission_json:JSON.stringify({...proposal,title:'Private saved legacy'})},owner);assert.equal(legacy.status,201);
 assert.deepEqual((await h.call('/api/pending-places')).body,{places:[]});assert.equal((await h.call('/api/contributions/submission?id='+legacy.body.submission.id,undefined,other)).status,404);
 const published=await h.call('/api/contributions/publish',body,owner,{'oai-authenticated-user-id':'forged-owner'});assert.equal(published.status,200,JSON.stringify(published.body));
 const retry=await h.call('/api/contributions/publish',body,owner);assert.equal(retry.status,200);assert.equal(retry.body.reused,true);assert.deepEqual(retry.body.receipt,published.body.receipt);
 const id=published.body.receipt.result.record_id,s=published.body.submission;
 for(const path of ['/api/published-records','/api/published-edits','/api/contributor-credits','/api/place-history?id='+id]){const data=await h.call(path);assert.equal(data.status,200);assert.ok(!JSON.stringify(data.body).includes('@example.test'));assert.ok(!JSON.stringify(data.body).includes('Private saved legacy'));}
 const mutation={idempotency_key:key(),submission_id:s.id,expected_revision:s.revision};
 assert.equal((await h.call('/api/contributions/delete',mutation,owner)).status,409);assert.equal((await h.call('/api/contributions/revoke',mutation,other)).status,404);
 const revoked=await h.call('/api/contributions/revoke',mutation,owner);assert.equal(revoked.status,200,JSON.stringify(revoked.body));assert.equal((await h.call('/api/contributions/revoke',mutation,owner)).body.reused,true);
 assert.deepEqual((await h.call('/api/published-records')).body.records,[]);assert.deepEqual((await h.call('/api/place-history?id='+id)).body.items,[]);assert.deepEqual((await h.call('/api/published-edits')).body.items,[]);
 assert.equal((await h.call('/api/contributions/submission?id='+s.id,undefined,other)).status,404);assert.equal((await h.call('/api/contributions/submission?id='+s.id,undefined,owner)).body.submission.status,'revoked');
 const deletion={...mutation,idempotency_key:key()};assert.equal((await h.call('/api/contributions/delete',deletion,owner)).status,200);assert.equal((await h.call('/api/contributions/delete',deletion,owner)).body.reused,true);
 assert.equal((await h.call('/api/contributions/submission?id='+s.id,undefined,owner)).status,404);
 const publishLegacy=await h.call('/api/contributions/publish',{idempotency_key:key(),submission_id:legacy.body.submission.id,expected_revision:1,moniker:'night.owl',change_summary:'Explicitly publish my saved work'},owner);assert.equal(publishLegacy.status,200,JSON.stringify(publishLegacy.body));assert.equal((await h.call('/api/published-records')).body.records.length,1);
 for(const action of ['review','apply','verify','rollback'])assert.equal((await h.call('/api/contributions/'+action,{idempotency_key:key()},owner)).status,404);
});
