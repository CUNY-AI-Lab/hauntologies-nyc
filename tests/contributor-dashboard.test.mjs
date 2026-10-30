import test from 'node:test';
import assert from 'node:assert/strict';
import { contributorsHarness, basePlace, proposal, publish, target } from './fixtures/contributors-harness.mjs';
import { RecordEditModel as Model } from '../server/record-update.mjs';
import { CHECKS } from '../server/workflow-core.mjs';
import { projectPublicContributions, readPublicContributions, placeCompleteness, handlePublicContributions } from '../server/public-contributions.mjs';

function edit(resolved, changes={title:'Lantern house corrected',description:'Synthetic corrected description',borough:'Manhattan',place_type:'house',source_citation:'Synthetic offline archive'}) {
 const before=Model.snapshot(resolved.record),after={...before,...changes};
 return {...proposal('Edit'),type:'record_update',targets:[{record_id:resolved.record_id,expected_version:resolved.expected_version,expected_hash:resolved.expected_hash}],summary:'A synthetic edit',payload:{change_message:'A synthetic edit',changes:Model.changes(before,after)}};
}
const note = resolved => ({...proposal('Note'),summary:'An independently owned note',targets:[{record_id:resolved.record_id,expected_version:resolved.expected_version,expected_hash:resolved.expected_hash}],payload:{explanation:'An independently owned note',sources_text:'A synthetic citation'}});
const output = h => readPublicContributions(h.db,h.staticRecords);

test('real SQLite publication, five-field edit, note, undo and retry use event units',async t=>{
 const h=contributorsHarness(t),key=crypto.randomUUID(),created=await publish(h,proposal(),undefined,{idempotency_key:key});assert.equal(created.status,200);
 const retry=await publish(h,proposal(),undefined,{idempotency_key:key});assert.equal(retry.body.reused,true);assert.deepEqual(retry.body.receipt,created.body.receipt);
 const id=created.body.receipt.result.record_id;
 const e=await publish(h,edit(await target(h,id)));assert.equal(e.status,200,JSON.stringify(e.body));
 assert.equal((await publish(h,note(await target(h,id)))).status,200);
 const current=await target(h,id),undone=await h.call('undo',{idempotency_key:crypto.randomUUID(),event_id:e.body.receipt.result.event_id,expected_version:current.expected_version,expected_hash:current.expected_hash,moniker:'Night Owl',change_summary:'Undo the synthetic edit'});assert.equal(undone.status,200);
 const result=await output(h);assert.deepEqual(result.totals,{published:4,added:1,edits:1,notes:1,undo:1,unclassified:0,legacy:0,unique_places_edited:1,unattributed:0,unattributed_legacy:0,places:2});
 assert.equal(result.contributors.length,1);assert.equal(result.metrics.edits.unit,'events');assert.equal(result.metrics.added.unit,'places');
 assert.equal(result.places.find(p=>p.id===id).contributions.edits.value,1);
 assert.equal(result.places.find(p=>p.id===id).title,'Lantern house');
 assert.ok(!JSON.stringify(result).includes('synthetic_actor'));assert.ok(!JSON.stringify(result).includes('workflow_'));assert.ok(!JSON.stringify(result).includes('receipt'));
});

test('same-name actors remain distinct; aliases and unknown authors are not silently linked',async t=>{
 const h=contributorsHarness(t);await publish(h,proposal('House A'));await publish(h,proposal('House B'),'synthetic_actor_B');
 await publish(h,proposal('House C'),'synthetic_actor_A',{moniker:'Another name'});
 await publish(h,proposal('House D'),'synthetic_actor_A',{moniker:' NIGHT   OWL '});
 let result=await output(h);assert.equal(result.contributors.length,3);assert.equal(result.contributors.filter(p=>p.name.toLowerCase()==='night owl').length,2);assert.equal(result.contributors.find(p=>p.published===2).identity_basis,'actor_and_moniker');
 const again=await output(h);assert.notEqual(result.contributors[0].id,again.contributors[0].id);assert.equal(result.snapshot_token,again.snapshot_token);
 h.db.native.prepare("UPDATE workflow_revisions SET raw_json=json_set(raw_json,'$.public_credit.consent',json('false')) WHERE actor_id='synthetic_actor_B'").run();
 result=await output(h);assert.equal(result.totals.unattributed,1);assert.equal(result.contributors.length,2);
});

test('revocation removes identities and counts while later owned edits and notes survive; snapshots are fenced',async t=>{
 const h=contributorsHarness(t),created=await publish(h,proposal('Private after withdrawal')),id=created.body.receipt.result.record_id;
 await publish(h,note(await target(h,id)),'synthetic_actor_B',{moniker:'Second Owl'});
 await publish(h,edit(await target(h,id),{title:'Surviving title'}),'synthetic_actor_B',{moniker:'Second Owl'});
 const before=await output(h),request={idempotency_key:crypto.randomUUID(),submission_id:created.body.submission.id,expected_revision:created.body.submission.revision};
 assert.equal((await h.call('revoke',request)).status,200);
 const after=await output(h);assert.equal(after.totals.published,2);assert.equal(after.totals.added,0);assert.equal(after.contributors.length,1);assert.equal(after.contributors[0].name,'Second Owl');assert.ok(!JSON.stringify(after).includes('Private after withdrawal'));assert.notEqual(before.snapshot_token,after.snapshot_token);
 const stale=await handlePublicContributions(new Request('https://map.test/api/place-completeness?place='+id+'&snapshot='+before.snapshot_token),{db:h.db,staticRecords:h.staticRecords});assert.equal(stale.status,409);
 assert.equal((await h.call('delete',{...request,idempotency_key:crypto.randomUUID()})).status,200);assert.equal((await output(h)).totals.published,2);
});

test('private saved work, approved-but-unpublished work, imports and failed attempts do not become contributions',async t=>{
 const h=contributorsHarness(t),saved=await h.call('submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(proposal('Private saved name'))});assert.equal(saved.status,201);
 h.db.native.prepare("UPDATE workflow_submissions SET review_state='approved' WHERE id=?").run(saved.body.submission.id);
 const rejected=await publish(h,proposal(),undefined,{moniker:'email@example.test'});assert.notEqual(rejected.status,200);
 const result=await output(h);assert.equal(result.totals.published,0);assert.equal(result.totals.added,0);assert.equal(result.totals.places,1);assert.equal(result.metrics.published.coverage,'complete');assert.equal(result.contributors.length,0);assert.ok(!JSON.stringify(result).includes('Private saved'));
});

test('legacy jobs deduplicate separately and unknown event kinds stay partial',()=>{
 const record={section:'record',id:'synthetic_public',raw_json:JSON.stringify({id:'synthetic_public',title:'Public legacy place'}),derived_json:JSON.stringify({publication_mode:'direct'})};
 const legacy={section:'legacy',id:'legacy_one',actor_id:'private_legacy_actor',credit_json:JSON.stringify({public_credit:{consent:true,label:'Older Owl',identity:'moniker'}}),manifest_json:JSON.stringify({targets:[{record_id:record.id,after:{}}]})};
 const unknown={section:'event',id:'event_unknown',actor_id:'private_unknown',credit_json:'{}',event_json:JSON.stringify({kind:'unknown_legacy_kind',record_id:record.id,moniker:'Unused'})};
 const result=projectPublicContributions({rows:[record,legacy,legacy,unknown,unknown]});
 assert.equal(result.totals.legacy,1);assert.equal(result.totals.unclassified,1);assert.equal(result.totals.published,1);assert.equal(result.metrics.edits.coverage,'partial');assert.equal(result.contributors[0].published,0);assert.equal(result.contributors[0].legacy,1);
});

test('roster hidden is the stricter outcome even for explicit moniker consent',async t=>{
 const h=contributorsHarness(t);await publish(h,proposal(),'map_syntheticHidden');
 h.db.native.prepare(`INSERT INTO hny_auth_user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('syntheticHidden','Private fixture name','private-fixture@example.test',1,0,0)`).run();
 h.db.native.prepare("INSERT INTO contributor_roster_hidden (user_id,created_at) VALUES ('syntheticHidden',?)").run(new Date().toISOString());
 const result=await output(h);assert.equal(result.contributors.length,0);assert.equal(result.totals.unattributed,1);
});

test('verified legacy SQL requires live authorized publication and excludes its revoked history',async t=>{
 const h=contributorsHarness(t,{publicationMode:'legacy',authorization:{reviewers:['reviewer'],publishers:['publisher']}});
 const e=edit(await target(h,basePlace.id),{title:'Older edited place'});
 const submitted=await h.call('submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(e)});assert.equal(submitted.status,201);const s=submitted.body.submission;
 const approval=await h.call('review',{idempotency_key:crypto.randomUUID(),submission_id:s.id,expected_revision:s.revision,payload_hash:s.payload_hash,diff_hash:s.diff_hash,checks:Object.fromEntries(CHECKS.map(key=>[key,'pass'])),rationale:'Synthetic independent review'},'reviewer');assert.equal(approval.status,200);
 const staged=await h.call('apply',{idempotency_key:crypto.randomUUID(),submission_id:s.id,expected_revision:s.revision,approval_hash:approval.body.submission.approval.approval_hash},'publisher');assert.equal(staged.status,201);
 assert.equal((await output(h)).totals.legacy,0);
 const verified=await h.call('verify',{idempotency_key:crypto.randomUUID(),job_id:staged.body.job.id,map_list_check:{status:'pass',evidence:'Synthetic map check'}},'publisher');assert.equal(verified.status,200);
 let result=await output(h);assert.equal(result.totals.legacy,1);assert.equal(result.totals.published,0);assert.equal(result.contributors[0].name,'Night Owl');assert.equal(result.contributors[0].metrics.legacy.unit,'releases');
 const revoked=await h.call('revoke',{idempotency_key:crypto.randomUUID(),submission_id:s.id,expected_revision:s.revision});assert.equal(revoked.status,200);
 result=await output(h);assert.equal(result.totals.legacy,0);assert.equal(result.contributors.length,0);assert.ok(!JSON.stringify(result).includes('Older edited place'));
});

test('completeness preserves optional descriptions, offline sources, unknowns, valid zero and invalid geometry',()=>{
 const fixture={...basePlace,description:' ',latitude:0,longitude:0,geo_status:'located',image:null,place_type:'garden',time_precision:'unknown',time_start_year:null,time_end_year:null};
 const result=placeCompleteness(fixture),field=key=>result.fields.find(f=>f.key===key);
 assert.equal(field('description').state,'optional');assert.equal(field('image_url').state,'optional');assert.equal(field('image_alt').state,'not_applicable');assert.equal(field('source_reference').state,'present');assert.equal(field('coordinates').state,'present');assert.equal(field('date_wording').state,'unknown');assert.equal(field('built').state,'optional');
 assert.equal(result.fields.some(f=>f.key==='sources.0.title'),false);
 assert.equal(placeCompleteness({...fixture,latitude:null}).fields.find(f=>f.key==='coordinates').state,'invalid');
 assert.equal(placeCompleteness({...fixture,latitude:'0'}).fields.find(f=>f.key==='coordinates').state,'invalid');
 assert.equal(placeCompleteness({...fixture,latitude:null,longitude:null,geo_status:'unresolved'}).fields.find(f=>f.key==='coordinates').state,'unknown');
 const withImage=placeCompleteness({...fixture,image:{url:'https://example.test/photo.jpg',license:'unknown'}});
 assert.equal(withImage.fields.find(f=>f.key==='image_license').state,'unknown');assert.equal(withImage.fields.find(f=>f.key==='image_alt').state,'missing');
 assert.equal(placeCompleteness({...fixture,title:'Untitled place'}).fields.find(f=>f.key==='title').value_origin,'display_default');
 assert.equal(placeCompleteness({...fixture,description:{secret:'not scalar'}}).fields.find(f=>f.key==='description').state,'invalid');
});

test('more than 500 places are included exactly once and bounds fail closed',async t=>{
 const records=Array.from({length:620},(_,i)=>({...basePlace,id:'synthetic_'+i,title:'Place '+i}));
 const h=contributorsHarness(t,{staticRecords:records});const result=await output(h);assert.equal(result.totals.places,620);assert.equal(new Set(result.places.map(p=>p.id)).size,620);
 const override={section:'record',id:records[0].id,raw_json:JSON.stringify({...records[0],title:'Edited title'}),derived_json:JSON.stringify({publication_mode:'direct'})};
 const projected=projectPublicContributions({staticRecords:records,rows:[override]});assert.equal(projected.places.length,620);assert.equal(projected.places.find(p=>p.id===records[0].id).title,'Edited title');
 assert.throws(()=>projectPublicContributions({staticRecords:Array(5001).fill(basePlace)}),/limit/);
});

test('read API is public, no-store and validates methods, repeated parameters and generic not-found',async t=>{
 const h=contributorsHarness(t);await publish(h,proposal());
 const call=(path,init)=>handlePublicContributions(new Request('https://map.test'+path,init),{db:h.db,staticRecords:h.staticRecords});
 const normal=await call('/api/contributors-summary'),signed=await call('/api/contributors-summary',{headers:{cookie:'synthetic-session','oai-authenticated-user-id':'private'}});
 const a=await normal.json(),b=await signed.json();assert.deepEqual(a.totals,b.totals);assert.equal(a.snapshot_token,b.snapshot_token);assert.equal(normal.headers.get('cache-control'),'no-store');
 for(const path of ['/api/contributors-summary?after=x','/api/place-completeness?place=x&place=y','/api/place-completeness?place=x&secret=y','/api/place-completeness?place=%3Cbad%3E'])assert.equal((await call(path)).status,400);
 assert.equal((await call('/api/place-completeness?place=synthetic_private')).status,404);
 assert.equal((await call('/api/contributors-summary',{method:'POST'})).status,405);
 assert.equal(await (await call('/api/contributors-summary',{method:'HEAD'})).text(),'');
 assert.equal((await handlePublicContributions(new Request('https://map.test/api/contributors-summary'),{db:null,staticRecords:[]})).status,503);
});
