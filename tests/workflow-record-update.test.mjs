import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { hash, CHECKS } from '../server/workflow-core.mjs';
import { RecordEditModel as Model } from '../server/record-update.mjs';
import { parseStaticRecords } from '../server/static-targets.mjs';

// Only synthetic submissions in isolated local SQLite. Source records are read-only fixtures.
const boundaries=JSON.parse(readFileSync(new URL('../public/data/nyc-borough-boundaries.geojson',import.meta.url)));
const actual=parseStaticRecords(readFileSync(new URL('../public/inventory.js',import.meta.url),'utf8'),readFileSync(new URL('../public/pilot.js',import.meta.url),'utf8'));
const synthetic={id:'synthetic_place',title:'  Original café 😀  ',description:'Original\nwording, untouched.',category:'reported_haunting',borough:'Manhattan',location_text:'Original address',latitude:40.72,longitude:-74,geo_status:'approximate',uncertainty_m:null,source_url:'https://example.org/primary',source_title:'Primary citation',record_date:'2026-10-21',checked_date:'2026-10-21',aliases:['Earlier name','Other name'],sources:[{url:'https://example.org/one',title:'First source',note:'Original first note',extra:{retain:'all unknown fields'}},{url:'https://example.org/two',citation:'  Second source\nlocator?  ',locator:null}],image:{url:'https://example.org/image.jpg',creator:'Original artist',license:'Unresolved',caption:'Original caption',extra:'Retain'}};
function sqliteD1(){
 const native=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())native.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const prepare=(sql,params=[])=>({bind(...values){return prepare(sql,values)},async first(column){const row=native.prepare(sql).get(...params)||null;return column&&row?row[column]:row},async all(){return{results:native.prepare(sql).all(...params)}},async run(){return{success:true,meta:{changes:Number(native.prepare(sql).run(...params).changes)}}}});
 let tail=Promise.resolve();const db={native,prepare,beforeBatch:null,batch(statements){const operation=tail.then(async()=>{if(db.beforeBatch){const run=db.beforeBatch;db.beforeBatch=null;run()}native.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());native.exec('COMMIT');return results}catch(error){native.exec('ROLLBACK');throw error}});tail=operation.catch(()=>{});return operation}};return db;
}
function harness(t,options={}){const db=sqliteD1(),store=createWorkflowStore(db),settings={store,staticRecords:[synthetic],taskSeeds:{tasks:[]},geography:{boundaries},authorization:{reviewers:['reviewer'],publishers:['publisher']},...options};t.after(()=>db.native.close());return{db,store,settings,service:createWorkflowService(settings)}}
async function call(h,path,body,options={}){const actor=options.actor===undefined?'author':options.actor;const response=await h.service.handle(new Request('https://map.test/api/contributions/'+path,{method:body===undefined?'GET':'POST',headers:{...(actor?{'oai-authenticated-user-id':actor}:{}),origin:options.origin||'https://map.test','sec-fetch-site':options.site||'same-origin','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));return{status:response.status,body:await response.json()}}
const status=(response,expected)=>assert.equal(response.status,expected,JSON.stringify(response.body));
const key=()=>crypto.randomUUID().replaceAll('-','_');
async function target(h,id=synthetic.id){const response=await call(h,'target?id='+id);status(response,200);return response.body.target}
function envelope(resolved,updates={title:'Proposed title'},message='  Correct this metadata; original wording remains.\nSynthetic evidence.  '){const before=Model.snapshot(resolved),after={...before,...updates};return{schema_version:'1.0',type:'record_update',task_ids:[],title:'Record update',summary:message,public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[{record_id:resolved.record_id,expected_version:resolved.expected_version,expected_hash:resolved.expected_hash}],payload:{change_message:message,changes:Model.changes(before,after)}}}
const count=(h,table)=>h.db.native.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
async function submit(h,value){const request={idempotency_key:key(),submission_json:JSON.stringify(value,null,2)},response=await call(h,'submit',request);status(response,201);return{...response.body,request}}
const reviewBody=s=>({idempotency_key:key(),submission_id:s.id,expected_revision:s.revision,payload_hash:s.payload_hash,diff_hash:s.diff_hash,checks:Object.fromEntries(CHECKS.map(k=>[k,'pass'])),rationale:'Synthetic independent review of the proposed data only.'});
async function seedHosted(h){const raw_json=JSON.stringify({title:'Hosted original',description:'  Exact original\n😀  ',metadata:{sources:synthetic.sources,untouched:{arbitrary:'source data'}}}),derived_json=JSON.stringify({location:{status:'missing',latitude:null,longitude:null,reason:'Unresolved'}});const row={id:'hosted_fixture',owner_id:'owner',preview_id:'fixture_preview',raw_json,raw_hash:await hash(raw_json),derived_json,preview_hash:'fixture',approved_at:'2026-10-21T22:00:00Z'};h.db.native.prepare('INSERT INTO approved_records (id,owner_id,preview_id,raw_json,raw_hash,derived_json,preview_hash,approved_at) VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(row));return row}

test('browser and Node use identical fields and lossless snapshots for all 209 authoritative records',()=>{
 const browser={window:{},URL,structuredClone};vm.createContext(browser);for(const file of ['atlas-model.js','place-summary.js','record-edit-model.js'])vm.runInContext(readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),browser);
 const originals=JSON.stringify(actual);assert.equal(actual.length,209);
 for(const record of actual){assert.equal(JSON.stringify(browser.window.RecordEditModel.snapshot(record)),JSON.stringify(Model.snapshot(record)),record.id);assert.equal(JSON.stringify(browser.window.RecordEditModel.fieldsFor(record)),JSON.stringify(Model.fieldsFor(record)),record.id)}
 assert.equal(JSON.stringify(actual),originals);assert.equal(Model.snapshot(synthetic).source_date,null);assert.equal(Model.snapshot(synthetic).date_start,null);assert.equal(Model.snapshot(synthetic).date_end,null);
});

test('legacy hosted metadata projects original location, source and date wording without deriving date bounds or a pin',()=>{
 const target={record_id:'legacy_hosted',record:{raw:{title:'Legacy',description:'Original',metadata:{location:{address:'123 Existing Place',latitude:40.8,longitude:-73.95},source:'https://example.org/original',citation:'  Original citation  ',date:'1901'}},derived:{location:{status:'missing',latitude:null,longitude:null}}}};
 const before=JSON.stringify(target),snapshot=Model.snapshot(target);
 assert.equal(snapshot.address,'123 Existing Place');assert.equal(snapshot.source_url,'https://example.org/original');assert.equal(snapshot.source_citation,'  Original citation  ');assert.equal(snapshot.date_wording,'1901');
 assert.equal(snapshot.date_start,null);assert.equal(snapshot.date_end,null);assert.equal(snapshot.latitude,null);assert.equal(snapshot.longitude,null);assert.equal(snapshot.geo_status,'unresolved');assert.equal(JSON.stringify(target),before);
});

test('full metadata and specific source corrections preserve original records and exact submission text',async t=>{
 const h=harness(t),resolved=await target(h),original=JSON.stringify(resolved),updates={title:'  Revised café 😀  ',inclusion_reason:'Reported story',description:'  Proposed wording\nwith whitespace.  ',category:'reported_haunting',place_type:'Museum',address:'New proposed address',geo_basis:'A proposed map locator',uncertainty_note:'Still uncertain',date_wording:'Circa 1890',date_start:'1889',date_end:'1891',date_precision:'circa',date_basis:'Explicit range',built:'c. 1890',demolished:null,source_url:'https://example.org/new',source_citation:'Proposed citation',source_date:'1888',source_locator:'Page 4',source_type:'Archive',rights_notes:'Citation only',image_url:'https://example.org/proposed.jpg',image_source_url:'https://example.org/image-record',image_credit:'Artist',image_license:'CC BY 4.0',image_license_url:'https://creativecommons.org/licenses/by/4.0/',image_caption:'Caption',image_alt:'Image description','sources.1.url':'https://example.org/two-corrected','sources.1.citation':'Exact revised citation','sources.1.locator':'Box 2','aliases.1':'Earlier alternate name'};
 const value=envelope(resolved,updates),created=await submit(h,value),p=created.submission;
 assert.equal(p.type,'record_update');assert.equal(p.status,'submitted');assert.equal(p.raw_json,created.request.submission_json);assert.equal(p.application.applicable,false);assert.equal(p.application.reason,'record_update_review_only');assert.deepEqual(p.application.operations,[]);
 assert.deepEqual(p.proposal.field_diff,value.payload.changes);assert.equal(p.proposal.change_message,value.payload.change_message);assert.deepEqual(p.proposal.target.record,synthetic);
 assert.equal(p.diff.length,value.payload.changes.length);for(const diff of p.diff){const change=value.payload.changes.find(x=>x.field===diff.field);assert.deepEqual(diff.before,change.before);assert.deepEqual(diff.after,change.after)}
 assert.equal(JSON.stringify(resolved),original);assert.deepEqual((await target(h)).record,synthetic);assert.equal(count(h,'approved_records'),0);assert.equal(count(h,'workflow_jobs'),0);
 const replay=await call(h,'submit',created.request);status(replay,200);assert.equal(replay.body.receipt.id,created.receipt.id);assert.equal(count(h,'workflow_revisions'),1);
 const conflict=await call(h,'submit',{...created.request,submission_json:created.request.submission_json+'\n'});status(conflict,409);
});

test('title correction on sparse legacy metadata preserves unknowns and does not require invented dates or geometry',async t=>{
 const sparse={id:'sparse',title:'Legacy',borough:'Manhattan / Bronx',geo_status:'unlocated',latitude:null,longitude:null,event_date_start:'?',event_date_end:'Undated',event_date_precision:'Unrecorded',sources:[{title:'Original',url:null}]};
 const h=harness(t,{staticRecords:[sparse]}),resolved=await target(h,'sparse'),created=await submit(h,envelope(resolved,{title:'Clarified title'}));
 assert.equal(created.submission.validation.valid,true);assert.deepEqual(created.submission.proposal.target.record,sparse);assert.equal(created.submission.proposal.editable_after.date_start,'?');assert.equal(created.submission.proposal.editable_after.borough,'Manhattan / Bronx');
});

test('forged before, stale version/hash, missing target and no-op changes fail without a saved revision',async t=>{
 const h=harness(t),resolved=await target(h),variants=[];
 let value=envelope(resolved);value.payload.changes[0].before='Forged original';variants.push([value,409,'forged_before']);
 value=envelope(resolved);value.targets[0].expected_hash='a'.repeat(64);variants.push([value,409,'stale_target']);
 value=envelope(resolved);value.targets[0].expected_version++;variants.push([value,409,'stale_target']);
 value=envelope(resolved);value.targets[0].record_id='absent';variants.push([value,409,'update_target_not_found']);
 variants.push([envelope(resolved,{}),400,'validation_failed']);
 value=envelope(resolved);value.payload.changes[0].after=value.payload.changes[0].before;variants.push([value,400,'validation_failed']);
 for(const [body,wanted,code]of variants){const result=await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(body)});status(result,wanted);assert.equal(result.body.error,code)}
 assert.equal(count(h,'workflow_revisions'),0);assert.equal(count(h,'workflow_receipts'),0);
});

test('read-only fields, wrong scalar types, URLs, oversized and duplicate changes are rejected',async t=>{
 const h=harness(t),resolved=await target(h),before=Model.snapshot(resolved);
 const changes=[...[null,17,{},[],{toString:null}].map(field=>({field,before:null,after:'Invalid field'})),{field:'id',before:synthetic.id,after:'replacement'},{field:'review_state',before:null,after:'merged'},{field:'sources',before:synthetic.sources,after:[]},{field:'sources.9.url',before:null,after:'https://example.org'},{field:'sources.0.unknown',before:null,after:'value'},{field:'aliases.20',before:null,after:'Invented index'},
 ...[null,17,{},[],true,''].map(after=>({field:'title',before:before.title,after})),
 ...['javascript:alert(1)','https://person:secret@example.org','file:///tmp/file'].map(after=>({field:'sources.1.url',before:before['sources.1.url'],after})),
 {field:'image_url',before:before.image_url,after:'data:image/png;base64,AA'},{field:'latitude',before:before.latitude,after:'40.7'},{field:'uncertainty_m',before:null,after:-5},{field:'description',before:before.description,after:'x'.repeat(15001)}];
 for(const change of changes){const value=envelope(resolved);value.payload.changes=[change];status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(value)}),400)}
 for(const message of ['', '  ', 'x'.repeat(2001)])status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(envelope(resolved,undefined,message))}),400);
 const duplicate=envelope(resolved);duplicate.payload.changes.push(duplicate.payload.changes[0]);status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(duplicate)}),400);
 assert.equal(count(h,'workflow_submissions'),0);
});

test('changed geometry enforces paired nulls, NYC boundary and borough; unknown stays null',async t=>{
 const h=harness(t),resolved=await target(h);
 for(const updates of [{latitude:null},{latitude:40.72,longitude:-74.05},{borough:'Brooklyn'},{geo_status:'unresolved'},{latitude:91},{longitude:181},{latitude:0,longitude:0},{latitude:null,longitude:null,geo_status:'located'}])status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(envelope(resolved,updates))}),400);
 const clear=await submit(h,envelope(resolved,{latitude:null,longitude:null,geo_status:'unresolved'}));assert.equal(clear.submission.proposal.editable_after.latitude,null);assert.equal(clear.submission.proposal.editable_after.longitude,null);
 const moved=await submit(h,envelope(resolved,{latitude:40.721,longitude:-74.001}));assert.equal(moved.submission.proposal.editable_after.latitude,40.721);
 const noBoundaries=harness(t,{geography:{}});status(await call(noBoundaries,'submit',{idempotency_key:key(),submission_json:JSON.stringify(envelope(await target(noBoundaries),{latitude:40.721}))}),400);
});

test('changed date bounds are ordered, valid calendar dates and explicitly unknown when cleared',async t=>{
 const h=harness(t),resolved=await target(h);
 for(const updates of [{date_start:'1890'},{date_start:'1900',date_end:'1800',date_precision:'range'},{date_start:'2025-02-29',date_end:'2025-03-01',date_precision:'range'},{date_start:'1890',date_end:'1891',date_precision:'year'},{date_start:'1890',date_end:'1890',date_precision:'unknown'},{date_start:1890,date_end:1890,date_precision:'year'}])status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(envelope(resolved,updates))}),400);
 status((await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(envelope(resolved,{date_start:'2024-02-29',date_end:'2024-03-01',date_precision:'range'}))})),201);
 const before=Model.snapshot(resolved),result=Model.validateChanges([{field:'date_precision',before:before.date_precision,after:'unknown'}],{snapshot:before,change_message:'Mark unknown.'});assert.equal(result.valid,true);assert.equal(result.after.date_start,null);
});

test('authentication, same-origin protections, independent review and no automatic apply remain intact',async t=>{
 const h=harness(t),resolved=await target(h),value=envelope(resolved),body={idempotency_key:key(),submission_json:JSON.stringify(value)};
 status(await call(h,'target?id='+synthetic.id,undefined,{actor:null}),401);status(await call(h,'submit',body,{actor:null}),401);status(await call(h,'submit',body,{origin:'https://elsewhere.test'}),403);
 const created=await submit(h,value),s=created.submission;
 status(await call(h,'review',reviewBody(s)),403);status(await call(h,'review',reviewBody(s),{actor:'stranger'}),403);
 const reviewed=await call(h,'review',reviewBody(s),{actor:'reviewer'});status(reviewed,200);assert.equal(reviewed.body.submission.status,'approved');
 const apply=await call(h,'apply',{idempotency_key:key(),submission_id:s.id,expected_revision:s.revision,approval_hash:reviewed.body.submission.approval.approval_hash},{actor:'publisher'});status(apply,409);assert.equal(apply.body.error,'record_update_review_only');assert.equal(count(h,'workflow_jobs'),0);assert.equal(count(h,'approved_records'),0);
 const noGrants=harness(t,{authorization:{reviewers:[],publishers:[]}}),other=await submit(noGrants,envelope(await target(noGrants)));status(await call(noGrants,'review',reviewBody(other.submission),{actor:'reviewer'}),403);
});

test('revisions retain exact earlier bytes and an approval cannot survive a changed proposal',async t=>{
 const h=harness(t),resolved=await target(h),created=await submit(h,envelope(resolved));
 status(await call(h,'review',reviewBody(created.submission),{actor:'reviewer'}),200);
 const value=envelope(resolved,{title:'Another proposed title'}),request={idempotency_key:key(),submission_id:created.submission.id,expected_revision:1,submission_json:JSON.stringify(value,null,2)};
 const revised=await call(h,'revise',request);status(revised,200);assert.equal(revised.body.submission.revision,2);assert.equal(revised.body.submission.status,'draft');assert.equal(revised.body.submission.approval,null);
 assert.equal((await h.store.getRevision(created.submission.id,1)).raw_json,created.request.submission_json);assert.equal((await h.store.getRevision(created.submission.id,2)).raw_json,request.submission_json);
 status(await call(h,'revise',{...request,idempotency_key:key()}),409);assert.deepEqual((await target(h)).record,synthetic);
});

test('fresh static catalog hashes invalidate old proposals at save and review',async t=>{
 const h=harness(t),resolved=await target(h),value=envelope(resolved),created=await submit(h,value);
 h.service=createWorkflowService({...h.settings,staticRecords:[{...synthetic,title:'A new authoritative source version'}]});
 status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(value)}),409);
 status(await call(h,'review',reviewBody(created.submission),{actor:'reviewer'}),409);
 assert.equal(count(h,'workflow_approvals'),0);assert.equal(count(h,'workflow_submissions'),1);
});

test('hosted source arrays and original raw/derived bytes remain intact through proposal review',async t=>{
 const h=harness(t),hosted=await seedHosted(h),resolved=await target(h,hosted.id),before=Model.snapshot(resolved);
 assert.equal(before['sources.1.citation'],synthetic.sources[1].citation);
 const created=await submit(h,envelope(resolved,{description:'Proposed description','sources.1.locator':'Specific source locator'}));
 status(await call(h,'review',reviewBody(created.submission),{actor:'reviewer'}),200);
 const unchanged=await h.store.getRecord(hosted.id);assert.equal(unchanged.raw_json,hosted.raw_json);assert.equal(unchanged.derived_json,hosted.derived_json);assert.equal(count(h,'approved_records'),1);assert.equal(count(h,'workflow_jobs'),0);
});

test('target change between validation and save transaction fails CAS and stores no submission or receipt',async t=>{
 const h=harness(t),hosted=await seedHosted(h),value=envelope(await target(h,hosted.id));
 const changed=JSON.stringify({...JSON.parse(hosted.raw_json),title:'Concurrent authoritative change'});
 h.db.beforeBatch=()=>h.db.native.prepare('UPDATE approved_records SET raw_json=? WHERE id=?').run(changed,hosted.id);
 const response=await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(value)});status(response,409);assert.equal(response.body.error,'version_conflict');
 assert.equal(count(h,'workflow_submissions'),0);assert.equal(count(h,'workflow_receipts'),0);assert.equal((await h.store.getRecord(hosted.id)).raw_json,changed);
});

test('target change before revision transaction keeps the previous immutable revision intact',async t=>{
 const h=harness(t),hosted=await seedHosted(h),resolved=await target(h,hosted.id),created=await submit(h,envelope(resolved));
 h.db.beforeBatch=()=>h.db.native.prepare('UPDATE approved_records SET derived_json=? WHERE id=?').run(JSON.stringify({location:{status:'missing'},later:'concurrent'}),hosted.id);
 const response=await call(h,'revise',{idempotency_key:key(),submission_id:created.submission.id,expected_revision:1,submission_json:JSON.stringify(envelope(resolved,{title:'Later proposal'}))});status(response,409);
 assert.equal(count(h,'workflow_revisions'),1);assert.equal((await h.store.getRevision(created.submission.id,1)).raw_json,created.request.submission_json);assert.equal(count(h,'workflow_receipts'),1);
});

test('primary source URL stays paired with its original title rather than a display shortcut',()=>{
 const record={id:'synthetic-source-pair',title:'Synthetic place',source_url:'https://example.org/catalog',source_title:'Synthetic catalog',display_source_url:'https://example.org/place'};
 const original=JSON.stringify(record),snapshot=Model.snapshot(record);
 assert.equal(snapshot.source_url,record.source_url);assert.equal(snapshot.source_citation,record.source_title);assert.equal(JSON.stringify(record),original);
});
