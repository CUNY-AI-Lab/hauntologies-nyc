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
async function seedHosted(h){const raw_json=JSON.stringify({title:'Hosted original',description:'  Exact original\n😀  ',metadata:{sources:synthetic.sources,untouched:{arbitrary:'source data'}}}),derived_json=JSON.stringify({location:{status:'missing',latitude:null,longitude:null,reason:'Unresolved'}});const row={id:'hosted_fixture',owner_id:'author',preview_id:'fixture_preview',raw_json,raw_hash:await hash(raw_json),derived_json,preview_hash:'fixture',approved_at:'2026-10-21T22:00:00Z'};h.db.native.prepare('INSERT INTO approved_records (id,owner_id,preview_id,raw_json,raw_hash,derived_json,preview_hash,approved_at) VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(row));return row}

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
 const h=harness(t),resolved=await target(h),original=JSON.stringify(resolved),updates={title:'  Revised café 😀  ',inclusion_reason:'Reported story',description:'  Proposed wording\nwith whitespace.  ',category:'reported_haunting',place_type:'Museum',address:'New proposed address',geo_basis:'A proposed map locator',uncertainty_note:'Still uncertain',date_wording:'Circa 1890',date_start:'1889',date_end:'1891',date_precision:'circa',date_basis:'Explicit range',built:'c. 1890',demolished:null,source_url:'https://example.org/new',source_title:'Proposed source title',source_citation:'Proposed citation',source_date:'1888',source_locator:'Page 4',source_type:'Archive',rights_notes:'Citation only',image_url:'https://example.org/proposed.jpg',image_source_url:'https://example.org/image-record',image_credit:'Artist',image_license:'CC BY 4.0',image_license_url:'https://creativecommons.org/licenses/by/4.0/',image_caption:'Caption',image_alt:'Image description','sources.1.url':'https://example.org/two-corrected','sources.1.citation':'Exact revised citation','sources.1.locator':'Box 2','aliases.1':'Earlier alternate name'};
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
 assert.equal(snapshot.source_url,record.source_url);assert.equal(snapshot.source_title,record.source_title);assert.equal(snapshot.source_citation,null);assert.equal(JSON.stringify(record),original);
});

test('source titles remain distinct from unrecorded bibliographic citations',()=>{
 const record={id:'synthetic-label',title:'Place',metadata:{source:{url:'https://example.org/item',title:'Original batch label'}}};
 const snapshot=Model.snapshot(record);assert.equal(snapshot.source_title,'Original batch label');assert.equal(snapshot.source_citation,null);
});

function withSources(resolved,sources,updates={}){const value=envelope(resolved,updates);value.payload.source_additions=structuredClone(sources);return value;}

test('source-addition helpers share browser/server rules and preserve optional fields exactly',()=>{
 const browser={window:{},URL,structuredClone};vm.createContext(browser);for(const file of ['atlas-model.js','place-summary.js','record-edit-model.js'])vm.runInContext(readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),browser);
 const additions=[{citation:'  Archive café 😀\nBox 4; folio 9  ',url:null,note:'',source_date_original:null},{title:'Paper map',locator:'Shelf 2',rights_status:'unknown',url:''},{url:'https://example.org/catalog'}],raw=JSON.stringify(additions);
 assert.equal(Model.validateSourceAdditions().valid,true);assert.equal(Model.maxSourceAdditions,10);assert.equal(Object.isFrozen(Model.sourceFields),true);
 assert.equal(JSON.stringify(browser.window.RecordEditModel.sourceFields),JSON.stringify(Model.sourceFields));
 const options={snapshot:Model.snapshot(synthetic),change_message:'Add archival references.',source_additions:additions};
 assert.equal(Model.validateChanges([],options).valid,true);assert.equal(JSON.stringify(browser.window.RecordEditModel.validateChanges([],options)),JSON.stringify(Model.validateChanges([],options)));
 assert.equal(JSON.stringify(additions),raw);assert.equal(Model.validateChanges([],{...options,source_additions:[]}).valid,false);
 for(const field of Model.sourceFields)assert.equal(field.type==='url'?field.maxLength===2048:field.maxLength===6000,true);
});

test('citation-only source proposals save exact originals and additions with review diff and stable replay receipt',async t=>{
 const h=harness(t),resolved=await target(h),original=JSON.stringify(resolved),additions=[{citation:'  Offline archive; box 2\nfolio 4 😀  ',url:null,note:'',source_date_original:null},{title:'A paper source',locator:'Shelf 8'}];
 const value=withSources(resolved,additions),created=await submit(h,value),s=created.submission;
 assert.equal(s.status,'submitted');assert.equal(s.validation.valid,true);assert.equal(s.raw_json,created.request.submission_json);assert.deepEqual(s.proposal.source_additions,additions);
 assert.deepEqual(s.proposal.editable_before,s.proposal.editable_after);assert.deepEqual(s.proposal.field_diff,[]);
 assert.deepEqual(s.diff,additions.map((source,index)=>({record_id:synthetic.id,operation:'propose_source_addition',field:'source_additions.'+index,before:null,after:source})));
 assert.equal(Object.hasOwn(s.proposal.source_additions[1],'url'),false);assert.equal(s.proposal.source_additions[0].url,null);assert.equal(s.proposal.source_additions[0].note,'');
 assert.deepEqual(s.application,{applicable:false,reason:'record_update_review_only',operations:[]});assert.deepEqual(s.proposal.target.record,synthetic);assert.equal(JSON.stringify(resolved),original);assert.deepEqual((await target(h)).record,synthetic);
 const replay=await call(h,'submit',created.request);status(replay,200);assert.equal(replay.body.receipt.id,created.receipt.id);assert.equal(count(h,'workflow_revisions'),1);
 status(await call(h,'submit',{...created.request,submission_json:created.request.submission_json+'\n'}),409);
 assert.equal(count(h,'approved_records'),0);assert.equal(count(h,'workflow_jobs'),0);
});

test('new-source validation rejects malformed scalars, all-blank refs, unknown keys and unsafe URLs before saving',async t=>{
 const h=harness(t),resolved=await target(h),invalid=[null,{},'citation',17,true,[null],[false],[[]],[{}],[{citation:' \n ',url:null}],[{license:'unknown'}],[{citation:'Citation',actor:'forged'}],[{citation:'Citation',title:'x'.repeat(6001)}],[{url:'https://example.org/'+ 'x'.repeat(2048)}],Array.from({length:11},()=>({citation:'Reference'}))];
 for(const field of Model.sourceFields)for(const value of [false,17,[],{}])invalid.push([{citation:'A real citation',[field.key]:value}]);
 for(const url of ['javascript:alert(1)','data:text/plain,reference','file:///tmp/source','https://person:secret@example.org','https://name@example.org','not a URL',' \n '])invalid.push([{citation:'Citation',url}]);
 invalid.push([JSON.parse('{"citation":"Citation","__proto__":{"actor":"forged"}}')]);
 for(const additions of invalid){assert.equal(Model.validateSourceAdditions(additions).valid,false,JSON.stringify(additions));const value=withSources(resolved,additions);status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(value)}),400)}
 for(const message of ['', '  ', 'x'.repeat(2001)]){const value=withSources(resolved,[{citation:'Citation'}]);value.summary=message;value.payload.change_message=message;status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(value)}),400)}
 assert.equal(count(h,'workflow_submissions'),0);assert.equal(count(h,'workflow_receipts'),0);
});

test('ten new references and a retained-source correction coexist without replacing or synthesizing original data',async t=>{
 const h=harness(t),hosted=await seedHosted(h),resolved=await target(h,hosted.id),additions=Array.from({length:10},(_,index)=>({citation:'  New reference '+index+'  ',locator:index===0?'x'.repeat(6000):null}));
 const value=withSources(resolved,additions,{'sources.1.locator':'New proposed locator'}),created=await submit(h,value),s=created.submission;
 assert.equal(s.diff.length,11);assert.equal(s.diff[0].operation,'propose_field_update');assert.deepEqual(s.proposal.source_additions,additions);
 assert.deepEqual(s.proposal.target.record.raw.metadata.sources,synthetic.sources);assert.equal(s.proposal.target.record.raw.metadata.sources[0].extra.retain,'all unknown fields');
 assert.equal(s.proposal.editable_after['sources.1.locator'],'New proposed locator');assert.equal(Object.hasOwn(s.proposal.editable_after,'sources.2.citation'),false);
 const persisted=await h.store.getRecord(hosted.id);assert.equal(persisted.raw_json,hosted.raw_json);assert.equal(persisted.derived_json,hosted.derived_json);assert.equal(count(h,'workflow_jobs'),0);
});

test('source addition approval is independent, revision-bound and never applicable; revised retries preserve history',async t=>{
 const h=harness(t,{authorization:{reviewers:['author','reviewer'],publishers:['publisher']}}),resolved=await target(h),created=await submit(h,withSources(resolved,[{citation:'First exact citation',url:null}])),s=created.submission;
 status(await call(h,'review',reviewBody(s)),403);
 const reviewed=await call(h,'review',reviewBody(s),{actor:'reviewer'});status(reviewed,200);
 const apply=await call(h,'apply',{idempotency_key:key(),submission_id:s.id,expected_revision:s.revision,approval_hash:reviewed.body.submission.approval.approval_hash},{actor:'publisher'});status(apply,409);assert.equal(apply.body.error,'record_update_review_only');
 const revisedValue=withSources(resolved,[{citation:'Second exact citation',url:null}]),request={idempotency_key:key(),submission_id:s.id,expected_revision:1,submission_json:JSON.stringify(revisedValue,null,2)},revised=await call(h,'revise',request);status(revised,200);
 assert.equal(revised.body.submission.revision,2);assert.equal(revised.body.submission.status,'draft');assert.equal(revised.body.submission.approval,null);assert.notEqual(revised.body.submission.diff_hash,s.diff_hash);assert.notEqual(revised.body.submission.payload_hash,s.payload_hash);
 assert.equal((await h.store.getRevision(s.id,1)).raw_json,created.request.submission_json);assert.equal((await h.store.getRevision(s.id,2)).raw_json,request.submission_json);
 const replay=await call(h,'revise',request);status(replay,200);assert.equal(replay.body.receipt.id,revised.body.receipt.id);assert.equal(count(h,'workflow_revisions'),2);
 status(await call(h,'review',reviewBody(s),{actor:'reviewer'}),409);assert.deepEqual((await target(h)).record,synthetic);assert.equal(count(h,'workflow_jobs'),0);assert.equal(count(h,'approved_records'),0);
});

test('source additions cannot bypass stale target, forged-before or atomic save checks',async t=>{
 const h=harness(t),resolved=await target(h),value=withSources(resolved,[{citation:'Citation'}]);
 for(const field of ['expected_hash','expected_version']){const stale=structuredClone(value);stale.targets[0][field]=field==='expected_hash'?'a'.repeat(64):99;status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(stale)}),409)}
 const forged=withSources(resolved,[{citation:'Citation'}],{title:'Proposed title'});forged.payload.changes[0].before='Invented';status(await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(forged)}),409);
 const hosted=await seedHosted(h),hostedValue=withSources(await target(h,hosted.id),[{citation:'Another citation'}]);h.db.beforeBatch=()=>h.db.native.prepare('UPDATE approved_records SET raw_json=? WHERE id=?').run(JSON.stringify({title:'Concurrent source update'}),hosted.id);
 const result=await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(hostedValue)});status(result,409);assert.equal(result.body.error,'version_conflict');assert.equal(count(h,'workflow_revisions'),0);assert.equal(count(h,'workflow_receipts'),0);
});

test('omitted source additions retain the existing field-only payload and review diff contract',async t=>{
 const h=harness(t),resolved=await target(h),old=envelope(resolved),explicit=structuredClone(old);explicit.payload.source_additions=[];
 const a=await call(h,'preview',{submission_json:JSON.stringify(old)}),b=await call(h,'preview',{submission_json:JSON.stringify(explicit)});status(a,200);status(b,200);
 assert.deepEqual(a.body.preview.diff,b.body.preview.diff);assert.equal(a.body.preview.diff_hash,b.body.preview.diff_hash);assert.equal(Object.hasOwn(a.body.preview.envelope.payload,'source_additions'),false);assert.deepEqual(a.body.preview.proposal.source_additions,[]);
});
