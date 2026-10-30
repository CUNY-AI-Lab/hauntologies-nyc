import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { CHECKS } from '../server/workflow-core.mjs';
import { RecordEditModel as Model } from '../server/record-update.mjs';
import { directHistory } from '../server/direct-publication.mjs';
import { publishedRecords, publishedEdits } from '../server/published-edits.mjs';

// Live edits on real SQLite with D1's single-writer batch semantics. Synthetic records and actors only.
const boundaries = JSON.parse(readFileSync(new URL('../public/data/nyc-borough-boundaries.geojson', import.meta.url)));
const place = { id: 'synthetic_place', title: 'Original title', description: 'Original description.', category: 'reported_haunting', borough: 'Manhattan',
  location_text: 'Original address', latitude: 40.72, longitude: -74, geo_status: 'approximate', uncertainty_m: null, built: 'c. 1890',
  image: { url: 'https://example.org/i.jpg', creator: 'Original credit' }, sources: [{ url: 'https://example.org/one', title: 'First source' }] };

function sqliteD1() {
  const native = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) native.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  const prepare = (sql, params = []) => ({ bind(...values) { return prepare(sql, values); },
    async first(column) { const row = native.prepare(sql).get(...params) || null; return column && row ? row[column] : row; },
    async all() { return { results: native.prepare(sql).all(...params) }; },
    async run() { return { success: true, meta: { changes: Number(native.prepare(sql).run(...params).changes) } }; } });
  // D1 applies one batch at a time, each as a transaction; concurrent callers queue.
  let tail = Promise.resolve();
  return { native, prepare, batch(statements) {
    const operation = tail.then(async () => { native.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); native.exec('COMMIT'); return out; } catch (error) { native.exec('ROLLBACK'); throw error; } });
    tail = operation.catch(() => {}); return operation; } };
}
function harness(t, authorization = { reviewers: ['reviewer', 'reviewer2'], publishers: ['publisher'] }) {
  const db = sqliteD1(); t.after(() => db.native.close());
  const store=createWorkflowStore(db),service = createWorkflowService({ publicationMode:'direct',store, staticRecords: [place], taskSeeds: { tasks: [] }, geography: { boundaries }, authorization });
  return { db, store, service };
}
async function call(h, path, body, actor = 'author') {
  const response = await h.service.handle(new Request('https://map.test/api/contributions/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'oai-authenticated-user-id': actor, origin: 'https://map.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: response.status, body: await response.json() };
}
const ok = (response, expected) => { assert.equal(response.status, expected, JSON.stringify(response.body)); return response.body; };
const key = () => crypto.randomUUID();
const count = (h, table) => h.db.native.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
const target = async h => ok(await call(h, 'target?id=' + place.id), 200).target;
function edit(resolved, updates) {
  const before = Model.snapshot(resolved.record), after = { ...before, ...updates }, message = 'Synthetic correction.';
  return { schema_version: '1.0', type: 'record_update', task_ids: [], title: 'Record update', summary: message, public_credit: { consent: false, label: '' }, sources: [], attachments: [],
    targets: [{ record_id: resolved.record_id, expected_version: resolved.expected_version, expected_hash: resolved.expected_hash }], payload: { change_message: message, changes: Model.changes(before, after) } };
}
const moniker='night.owl';
const proposal=(title='New place')=>({schema_version:'1.0',type:'open_proposal',task_ids:[],title,summary:'A synthetic description.',public_credit:{consent:true,label:moniker,identity:'moniker'},sources:[],attachments:[],targets:[],payload:{explanation:'A synthetic description.',geometry:{type:'Point',coordinates:[-74,40.72]}}});
const publish=async(h,envelope,actor='author',extra={})=>ok(await call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(envelope),moniker,change_summary:'Describe this synthetic change.',...extra},actor),200);
const getTarget=async(h,id,actor='author')=>ok(await call(h,'target?id='+id,undefined,actor),200).target;
const body=s=>({idempotency_key:key(),submission_id:s.id,expected_revision:s.revision});

test('new place is immediately public with stable ID, moniker, history and no manufactured review',async t=>{
 const h=harness(t),request={idempotency_key:key(),submission_json:JSON.stringify(proposal()),moniker,change_summary:'Add a place'};
 const first=ok(await call(h,'publish',request),200),again=ok(await call(h,'publish',request),200);
 assert.equal(first.submission.status,'published');assert.equal(again.reused,true);assert.deepEqual(first.receipt,again.receipt);
 const records=await publishedRecords(h.db);assert.equal(records.length,1);assert.match(records[0].id,/^place_/);assert.equal(records[0].title,'New place');assert.deepEqual(records[0].contributors,[moniker]);assert.equal(records[0].canonical_reviewed,undefined);
 const history=await directHistory(h.db,records[0].id);assert.equal(history.items.length,1);assert.equal(history.items[0].summary,'Add a place');assert.ok(!JSON.stringify(history).includes('author'));assert.equal(count(h,'workflow_approvals'),0);assert.equal(count(h,'workflow_jobs'),0);
});
test('separate notes and typed source/field edits publish and preserve unrelated values',async t=>{
 const h=harness(t),base=await publish(h,proposal()),id=base.receipt.result.record_id,target=await getTarget(h,id);
 const note={...proposal('Note'),summary:'An independently owned note.',targets:[{record_id:id,expected_version:target.expected_version,expected_hash:target.expected_hash}],payload:{explanation:'An independently owned note.',sources_text:'Notebook citation'}};
 await publish(h,note,'other');
 let resolved=await getTarget(h,id);const e=edit(resolved,{title:'New title'});e.payload.source_additions=[{title:'New source',url:'https://example.org/new'}];
 await publish(h,e,'other');
 const [record]=await publishedRecords(h.db);assert.equal(record.title,'New title');assert.equal(record.description,'A synthetic description.');assert.equal(record.notes[0].text,'An independently owned note.');assert.equal(record.sources[0].title,'New source');
});
test('existing places accept facts or sources without a description and keep their original wording and history',async t=>{
 const h=harness(t);
 const factTarget=await target(h),fact={...proposal('Fact'),summary:'',targets:[{record_id:factTarget.record_id,expected_version:factTarget.expected_version,expected_hash:factTarget.expected_hash}],payload:{explanation:'',attributes:[{name:'Opening date',value:'1901'}]}};
 await publish(h,fact,'author',{change_summary:'Add opening date'});
 let [record]=await publishedRecords(h.db);assert.equal(record.description,place.description);assert.deepEqual(record.notes[0].attributes,[{name:'Opening date',value:'1901'}]);assert.equal(record.notes[0].text,'');
 const sourceTarget=await target(h),source={...proposal('Source'),targets:[{record_id:sourceTarget.record_id,expected_version:sourceTarget.expected_version,expected_hash:sourceTarget.expected_hash}],sources:[{citation:'Synthetic archive',url:'https://example.org/archive'}],payload:{}};
 delete source.summary;
 await publish(h,source,'other',{change_summary:'Add a source'});
 [record]=await publishedRecords(h.db);assert.equal(record.description,place.description);assert.equal(record.notes[1].text,'');assert.equal(record.notes[1].source_references[0].citation,'Synthetic archive');
 const textTarget=await target(h),freeform={...proposal('Source text'),summary:null,targets:[{record_id:textTarget.record_id,expected_version:textTarget.expected_version,expected_hash:textTarget.expected_hash}],payload:{explanation:null,sources_text:'Synthetic notebook'}};
 await publish(h,freeform,'author',{change_summary:'Add notebook'});
 [record]=await publishedRecords(h.db);assert.equal(record.description,place.description);assert.equal(record.notes[2].sources,'Synthetic notebook');
 const history=await directHistory(h.db,place.id);assert.deepEqual(history.items.map(item=>item.summary),['Add notebook','Add a source','Add opening date']);assert.deepEqual(history.items.map(item=>item.moniker),[moniker,moniker,moniker]);
});
test('empty existing contributions fail, and new places, attribution and change history stay required',async t=>{
 const h=harness(t),resolved=await target(h),existing={...proposal('Empty'),summary:'',targets:[{record_id:resolved.record_id,expected_version:resolved.expected_version,expected_hash:resolved.expected_hash}],payload:{explanation:'  ',sources_text:'  ',attributes:[]}};
 existing.summary='  ';
 const response=await call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(existing),moniker,change_summary:'No content'});assert.equal(response.status,409);assert.equal(response.body.error,'contribution_content_required');
 const populated={...existing,summary:'',payload:{explanation:'',sources_text:'Synthetic source'}};
 assert.equal((await call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(populated),moniker:'',change_summary:'Add source'})).body.error,'public_moniker_required');
 assert.equal((await call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(populated),moniker,change_summary:''})).body.error,'change_summary_required');
 const invalidFact={...populated,payload:{explanation:'',sources_text:'Synthetic source',attributes:[{name:'Date',value:''}]}};
 const invalid=await call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(invalidFact),moniker,change_summary:'Add fact'});assert.equal(invalid.status,409);assert.equal(invalid.body.error,'attribute_value_required');
 const invalidSource={...populated,sources:[{url:'javascript:alert(1)'}]};assert.equal((await call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(invalidSource),moniker,change_summary:'Add source'})).status,400);
 const fresh={...proposal(),summary:'',payload:{explanation:'',geometry:{type:'Point',coordinates:[-74,40.72]},attributes:[{name:'Date',value:'1901'}]}};
 const rejected=await call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(fresh),moniker,change_summary:'New place'});assert.equal(rejected.status,400);assert.equal(rejected.body.error,'invalid_envelope');
 assert.equal((await publishedRecords(h.db)).length,0);assert.equal(count(h,'workflow_submissions'),0);
});
test('stale/concurrent writes and forged originals fail atomically; retry is exactly once',async t=>{
 const h=harness(t),resolved=await target(h),one=edit(resolved,{title:'One'}),two=edit(resolved,{title:'Two'});
 const results=await Promise.all([call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(one),moniker,change_summary:'one'}),call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(two),moniker,change_summary:'two'})]);
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const forged=edit(await target(h),{title:'Forged'});forged.payload.changes[0].before='wrong';ok(await call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(forged),moniker}),409);
 assert.equal(count(h,'workflow_submissions'),1);
});
test('Undo appends an inverse against current version, preserves later other fields and rejects overlaps',async t=>{
 const h=harness(t),first=await publish(h,edit(await target(h),{title:'Changed'}));
 await publish(h,edit(await target(h),{description:'Later independent field'}),'other');
 const current=await target(h),undo=ok(await call(h,'undo',{idempotency_key:key(),event_id:first.receipt.result.event_id,expected_version:current.expected_version,expected_hash:current.expected_hash,moniker:'another.owl',change_summary:'Undo title'} ,'other'),200);
 const [record]=await publishedRecords(h.db);assert.equal(record.title,place.title);assert.equal(record.description,'Later independent field');assert.equal((await directHistory(h.db,place.id)).items.length,3);
 const now=await target(h);ok(await call(h,'undo',{idempotency_key:key(),event_id:first.receipt.result.event_id,expected_version:now.expected_version,expected_hash:now.expected_hash,moniker,change_summary:'Overlapping undo'}),409);
 assert.equal(undo.submission.status,'published');
});
test('revoke removes owned values/history while shared container and others’ notes/edits survive, then delete',async t=>{
 const h=harness(t),created=await publish(h,proposal('Creator private title')),id=created.receipt.result.record_id;
 let current=await getTarget(h,id);await publish(h,{...proposal('Shared note'),summary:'Other contributor note',targets:[{record_id:id,expected_version:current.expected_version,expected_hash:current.expected_hash}],payload:{explanation:'Other contributor note'}},'other');
 await publish(h,edit(await getTarget(h,id),{title:'Other contributor title'}),'other');
 ok(await call(h,'delete',body(created.submission)),409);ok(await call(h,'revoke',body(created.submission),'other'),404);
 const revoked=ok(await call(h,'revoke',body(created.submission)),200);assert.equal(revoked.submission.status,'revoked');
 const [record]=await publishedRecords(h.db);assert.equal(record.id,id);assert.equal(record.title,'Other contributor title');assert.equal(record.description,undefined);assert.equal(record.notes[0].text,'Other contributor note');
 const history=await directHistory(h.db,id);assert.equal(history.items.length,2);assert.ok(!JSON.stringify(history).includes('Creator private title'));assert.ok(!JSON.stringify(history).includes('A synthetic description.'));
 const request=body(revoked.submission);ok(await call(h,'delete',request),200);assert.equal(ok(await call(h,'delete',request),200).reused,true);assert.equal((await publishedRecords(h.db))[0].id,id);
});
test('legacy saved/staged work stays private until an explicit owner Publish; old review operations disabled',async t=>{
 const h=harness(t),s=ok(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(proposal('Saved old proposal'))}),201).submission;
 assert.deepEqual(await publishedRecords(h.db),[]);ok(await call(h,'submission?id='+s.id,undefined,'reviewer'),404);
 ok(await call(h,'review',{idempotency_key:key()} ,'reviewer'),404);
 ok(await call(h,'publish',{...body(s),moniker,change_summary:'Publish my saved work'},'other'),404);
 await publish(h,proposal('Saved old proposal'),'author',{submission_id:s.id,expected_revision:s.revision});assert.equal((await publishedRecords(h.db)).length,1);
});

test('validation-to-commit interleaving cannot adopt a newer target version',async t=>{
 const h=harness(t),resolved=await target(h),a=edit(resolved,{title:'Stale writer'}),b=edit(resolved,{title:'Newer writer'});
 const original=h.store.getRecord;let calls=0,release,arrive;const held=new Promise(r=>release=r),paused=new Promise(r=>arrive=r);
 h.store.getRecord=async id=>{if(++calls===2){arrive();await held;}return original(id);};
 const pending=call(h,'publish',{idempotency_key:key(),submission_json:JSON.stringify(a),moniker,change_summary:'A'});await paused;
 await publish(h,b,'other');release();ok(await pending,409);assert.equal((await publishedRecords(h.db))[0].title,'Newer writer');assert.equal(count(h,'workflow_submissions'),1);
});
test('Undo-derived prior text is suppressed after its owner revokes and deletes',async t=>{
 const h=harness(t),a=await publish(h,proposal('Withdrawn creator text')),id=a.receipt.result.record_id;
 const b=await publish(h,edit(await getTarget(h,id),{title:'Another title'}),'other'),current=await getTarget(h,id);
 ok(await call(h,'undo',{idempotency_key:key(),event_id:b.receipt.result.event_id,expected_version:current.expected_version,expected_hash:current.expected_hash,moniker:'third.owl',change_summary:'Undo correction'},'third'),200);
 assert.equal((await publishedRecords(h.db))[0].title,'Withdrawn creator text');
 const request=body(a.submission);ok(await call(h,'revoke',request),200);assert.equal(ok(await call(h,'revoke',request),200).reused,true);
 for(const data of [await publishedRecords(h.db),await directHistory(h.db,id),await publishedEdits(h.db)])assert.ok(!JSON.stringify(data).includes('Withdrawn creator text'));
 ok(await call(h,'delete',body(a.submission)),200);
 const c=await getTarget(h,id);await publish(h,edit(c,{description:'New independent description'}),'other');assert.equal((await publishedRecords(h.db))[0].title,'Untitled place');
});
test('source identity survives creator withdrawal and subsequent source edits',async t=>{
 const h=harness(t),e=proposal();e.payload.sources_text='Original source';const a=await publish(h,e),id=a.receipt.result.record_id;
 await publish(h,edit(await getTarget(h,id),{'sources.0.title':'Other source correction'}),'other');
 ok(await call(h,'revoke',body(a.submission)),200);
 let r=(await publishedRecords(h.db))[0];assert.equal(r.sources.length,1);assert.equal(r.sources[0].source_id,'source_freeform');
 await publish(h,edit(await getTarget(h,id),{'sources.0.title':'Later correction'}),'third');r=(await publishedRecords(h.db))[0];assert.equal(r.sources.length,1);assert.equal(r.sources[0].title,'Later correction');
});
test('signed-out, forged-owner and email credits cannot publish; transaction failure leaves no partial projection',async t=>{
 const h=harness(t),b={idempotency_key:key(),submission_json:JSON.stringify(proposal()),moniker,change_summary:'Create'};
 ok(await call(h,'publish',b,''),401);ok(await call(h,'publish',{...b,moniker:'private@example.test'}),400);
 const old=h.db.batch;h.db.batch=async()=>{throw Error('Synthetic database failure');};ok(await call(h,'publish',b),503);h.db.batch=old;
 for(const table of ['workflow_receipts','workflow_submissions','workflow_revisions','workflow_events','approved_records','workflow_targets'])assert.equal(count(h,table),0);
 const saved=ok(await call(h,'publish',b),200);ok(await call(h,'revoke',body(saved.submission),'other'),404);ok(await call(h,'delete',body(saved.submission),'other'),404);
});

test('legacy approval/staging cannot publish automatically; explicit owner publication cancels its staged job',async t=>{
 const h=harness(t),direct=h.service;h.service=createWorkflowService({store:h.store,staticRecords:[place],taskSeeds:{tasks:[]},geography:{boundaries},authorization:{reviewers:['reviewer'],publishers:['publisher']}});
 const s=ok(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(proposal('Staged legacy place'))}),201).submission;
 const approved=ok(await call(h,'review',{...body(s),payload_hash:s.payload_hash,diff_hash:s.diff_hash,checks:Object.fromEntries(CHECKS.map(k=>[k,'pass'])),rationale:'Synthetic legacy fixture'},'reviewer'),200).submission;
 const staged=ok(await call(h,'apply',{...body(s),approval_hash:approved.approval.approval_hash},'publisher'),201).job;assert.deepEqual(await publishedRecords(h.db),[]);
 h.service=direct;ok(await call(h,'delete',body(s),'reviewer'),404);
 const p=ok(await call(h,'publish',{...body(s),moniker,change_summary:'Explicit owner publication'}),200);assert.equal(p.submission.status,'published');assert.equal((await h.store.getJob(staged.id)).status,'rolled_back');assert.equal((await publishedRecords(h.db))[0].canonical_reviewed,undefined);
});
test('typed annotation becomes a separate public note with explicit moniker',async t=>{
 const h=harness(t),r=await target(h),e={...proposal('Typed note'),type:'record_annotation',targets:[{record_id:r.record_id,expected_version:r.expected_version,expected_hash:r.expected_hash}],sources:[{citation:'Synthetic notebook',locator:'Fixture page 1',source_type:'notebook',url:'https://example.org/notebook',accessed_on:'2026-10-21',rights_status:'unknown',rights_statement:'Citation only',public_use:'citation_only'}],payload:{annotation_kind:'clarification',text:'Typed public note',original_wording:'Original description.',uncertainty_note:'Unverified date.',dates:null}};
 await publish(h,e);const [record]=await publishedRecords(h.db);assert.equal(record.description,place.description);assert.equal(record.notes[0].text,'Typed public note');assert.equal((await directHistory(h.db,place.id)).items[0].kind,'note');
});

test('Undo accepts a valid long change summary without exceeding the submission title limit',async t=>{
 const h=harness(t),summary='A long synthetic change summary. '.repeat(20),published=await publish(h,edit(await target(h),{title:'Changed'}),'author',{change_summary:summary}),current=await target(h);
 const result=ok(await call(h,'undo',{idempotency_key:key(),event_id:published.receipt.result.event_id,expected_version:current.expected_version,expected_hash:current.expected_hash,moniker,change_summary:'Undo a long-described change'}),200);assert.equal(result.submission.status,'published');assert.equal((await publishedRecords(h.db))[0].title,place.title);assert.equal((await directHistory(h.db,place.id)).items[1].summary,summary.trim());
});

test('Undo a note keeps later notes and its inverse cannot resurrect revoked note text',async t=>{
 const h=harness(t),note=async(text,actor)=>{const r=await target(h);return publish(h,{...proposal('Note'),summary:text,targets:[{record_id:r.record_id,expected_version:r.expected_version,expected_hash:r.expected_hash}],payload:{explanation:text}},actor);};
 const a=await note('Withdrawn note text','author');await note('Independent later note','other');
 const undo=async(event_id)=>{const current=await target(h);return ok(await call(h,'undo',{idempotency_key:key(),event_id,expected_version:current.expected_version,expected_hash:current.expected_hash,moniker:'third.owl',change_summary:'Undo note change'},'third'),200);};
 const inverse=await undo(a.receipt.result.event_id);assert.deepEqual((await publishedRecords(h.db))[0].notes.map(n=>n.text),['Independent later note']);
 await undo(inverse.receipt.result.event_id);assert.equal((await publishedRecords(h.db))[0].notes.length,2);
 ok(await call(h,'revoke',body(a.submission)),200);assert.deepEqual((await publishedRecords(h.db))[0].notes.map(n=>n.text),['Independent later note']);assert.ok(!JSON.stringify(await directHistory(h.db,place.id)).includes('Withdrawn note text'));
});

test('owner mutations require the revision they act on, and Undo requires a valid event ID',async t=>{
 const h=harness(t),published=await publish(h,proposal('Guarded place')),s=published.submission;
 for(const action of ['revoke','delete']){const missing=await call(h,action,{idempotency_key:key(),submission_id:s.id});assert.equal(missing.status,409,action);assert.equal(missing.body.error,'revision_conflict');}
 assert.equal((await call(h,'submission?id='+s.id)).body.submission.status,'published');
 const resolved=await getTarget(h,published.receipt.result.record_id);
 for(const event_id of [undefined,'',' bad id ']){const undo=await call(h,'undo',{idempotency_key:key(),...(event_id===undefined?{}:{event_id}),expected_version:resolved.expected_version,expected_hash:resolved.expected_hash,moniker,change_summary:'Undo without a valid event'});assert.equal(undo.status,400,JSON.stringify(undo.body));assert.equal(undo.body.error,'invalid_event_id');}
});
