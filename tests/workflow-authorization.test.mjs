import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createWorkflowStore} from '../server/workflow-store.mjs';
import {createWorkflowService} from '../server/workflow-service.mjs';
import {hash,CHECKS} from '../server/workflow-core.mjs';
import {createDemoWorker} from '../deployment/demo-gate.mjs';

// Isolated local SQLite and synthetic identities only. No Access configuration,
// production credentials, network calls or production database writes.
const privateText='PRIVATE ORIGINAL: contributor A, not public or consented.';
const staticRecord={id:'static-example',title:'Public catalog entry',latitude:null,longitude:null};
function database(){
 const native=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())native.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const prepare=(sql,args=[])=>({bind(...values){return prepare(sql,values)},async first(){return native.prepare(sql).get(...args)||null},async all(){return{results:native.prepare(sql).all(...args)}},async run(){return{success:true,meta:{changes:Number(native.prepare(sql).run(...args).changes)}}}});
 return{native,prepare,async batch(statements){native.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());native.exec('COMMIT');return results}catch(e){native.exec('ROLLBACK');throw e}}};
}
function harness(t,authorization={}){const db=database(),store=createWorkflowStore(db),settings={store,authorization,staticRecords:[staticRecord],taskSeeds:{tasks:[]}};t.after(()=>db.native.close());return{db,store,settings,service:createWorkflowService(settings)}}
const key=()=>crypto.randomUUID();
function envelope(text=privateText,overrides={}){return{schema_version:'1.0',type:'open_proposal',task_ids:[],title:'Private proposal',summary:text,public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{explanation:text},...overrides}}
async function call(h,path,body,actor='author-a'){const response=await h.service.handle(new Request('https://map.test/api/contributions/'+path,{method:body===undefined?'GET':'POST',headers:{...(actor?{'oai-authenticated-user-id':actor}:{}),origin:'https://map.test','sec-fetch-site':'same-origin','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));return{status:response.status,body:await response.json()}}
const status=(r,s)=>assert.equal(r.status,s,JSON.stringify(r.body));
async function submit(h,text=privateText,actor='author-a'){const request={idempotency_key:key(),submission_json:JSON.stringify(envelope(text))},response=await call(h,'submit',request,actor);status(response,201);return{...response.body,request}}
const reviewBody=s=>({idempotency_key:key(),submission_id:s.id,expected_revision:s.revision,payload_hash:s.payload_hash,diff_hash:s.diff_hash,checks:Object.fromEntries(CHECKS.map(k=>[k,'pass'])),rationale:'Independent synthetic review.'});
const triageBody=(s,action='withhold')=>({idempotency_key:key(),submission_id:s.id,expected_revision:s.revision,action,rationale:'Synthetic triage rationale.'});
async function hosted(h,id='hosted-private',owner='author-a',at='2026-01-01T00:00:00Z'){
 const raw_json=JSON.stringify({title:'Hosted title',description:privateText,metadata:{sources:[{citation:'Unpublished source note',url:'https://example.org'}]}}),derived_json=JSON.stringify({location:{status:'missing',latitude:null,longitude:null},canonical_entry:{entry_id:'private-entry',title:'Hosted title',claim_text:privateText}});
 h.db.native.prepare('INSERT INTO approved_records(id,owner_id,preview_id,raw_json,raw_hash,derived_json,preview_hash,approved_at) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,'preview-'+id,raw_json,await hash(raw_json),derived_json,'fixture',at);
 return h.store.getRecord(id);
}
function job(h,submission,id='private-job',at='2026-01-01T00:00:00Z'){
 const manifest={targets:[{record_id:'hosted-private',before:null,after:{id:'hosted-private',raw_json:JSON.stringify({description:privateText}),derived_json:'{}'}}]};
 h.db.native.prepare('INSERT INTO workflow_jobs(id,submission_id,revision,approval_id,status,operation_hash,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,submission.id,1,'approval-'+id,'verification_pending','fixture',JSON.stringify(manifest),at,at);return id;
}
const assertNoPrivate=r=>assert.equal(JSON.stringify(r.body).includes(privateText),false);

test('anonymous requests and forged headers remain blocked at the deployed gate',async t=>{
 const h=harness(t),saved=await submit(h);
 for(const path of ['dashboard','submission?id='+saved.submission.id,'target?id='+staticRecord.id,'job?id=private-job'])status(await call(h,path,undefined,null),401);
 status(await call(h,'preview',{submission_json:JSON.stringify(envelope())},null),401);
 let calls=0;const gate=createDemoWorker({fetch:()=>{calls++;return new Response('unexpected')}});
 for(const path of ['/api/contributions/dashboard','/api/contributions/preview','/api/review','/api/records'])assert.equal((await gate.fetch(new Request('https://map.test'+path,{headers:{'oai-authenticated-user-id':'author-a','cf-access-authenticated-user-email':'forged@example.org','cf-access-jwt-assertion':'forged'}}),{},{})).status,401);
 assert.equal(calls,0);
});

test('ordinary users see only their own submissions, full revisions and jobs',async t=>{
 const h=harness(t),a=await submit(h),b=await submit(h,'B private draft','author-b');job(h,a.submission);
 const dashboard=await call(h,'dashboard',undefined,'author-b');status(dashboard,200);assert.deepEqual(dashboard.body.submissions.map(s=>s.id),[b.submission.id]);assert.deepEqual(dashboard.body.jobs,[]);assertNoPrivate(dashboard);
 status(await call(h,'submission?id='+a.submission.id,undefined,'author-b'),404);status(await call(h,'job?id=private-job',undefined,'author-b'),404);
 const own=await call(h,'submission?id='+a.submission.id);status(own,200);assert.equal(own.body.submission.revisions[0].raw_json,a.request.submission_json);status(await call(h,'job?id=private-job'),200);
 assert.equal(dashboard.body.capabilities.can_triage,false);assert.equal(dashboard.body.capabilities.can_withhold_own,true);
});

test('hosted target and preview loaders do not expose other owners through invalid proposals',async t=>{
 const h=harness(t);await hosted(h);const target=await call(h,'target?id=hosted-private');status(target,200);
 const t0=target.body.target,reference={record_id:t0.record_id,expected_version:t0.expected_version,expected_hash:t0.expected_hash};
 status(await call(h,'target?id=hosted-private',undefined,'author-b'),404);
 const proposals=[
  envelope('Comment',{targets:[reference]}),
  envelope('Comment',{type:'record_annotation',targets:[reference],payload:{text:'Comment',original_wording:'Original',kind:'clarification',uncertainty_note:'Unverified'}}),
  envelope('Change title',{type:'record_update',targets:[reference],payload:{change_message:'Change title',changes:[{field:'title',before:'Hosted title',after:'Proposed title'}]}}),
  envelope('Correction',{type:'date_correction',targets:[reference],payload:{original_wording:'Original',reason:'Correction',after:{time_original:'unknown'}}}),
 ];
 for(const proposal of proposals){const result=await call(h,'preview',{submission_json:JSON.stringify(proposal)},'author-b');status(result,200);assertNoPrivate(result);assert.equal(result.body.preview.application.applicable,false);}
 const submitted=await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(proposals[2])},'author-b');status(submitted,409);assertNoPrivate(submitted);
 const publicTarget=await call(h,'target?id='+staticRecord.id,undefined,'author-b');status(publicTarget,200);assert.deepEqual(publicTarget.body.target.record,staticRecord);
 const d=await call(h,'dashboard',undefined,'author-b');assert.deepEqual(d.body.targets,[]);
});

test('triage requires explicit moderator privilege except withholding an owned proposal',async t=>{
 const h=harness(t),created=await submit(h),s=created.submission;
 for(const action of ['withhold','ready_for_review','request_information'])status(await call(h,'triage',triageBody(s,action),'author-b'),403);
 for(const action of ['ready_for_review','request_information'])status(await call(h,'triage',triageBody(s,action)),403);
 assert.equal((await h.store.getSubmission(s.id)).review_state,'submitted');
 const own=await call(h,'triage',triageBody(s));status(own,200);assert.equal(own.body.submission.status,'withheld');assert.equal(own.body.submission.capabilities.can_withhold,true);
});

test('reviewers and stewards can inspect and triage without granting stewards approval',async t=>{
 const h=harness(t,{reviewers:['reviewer'],stewards:['steward'],publishers:[]}),a=await submit(h),b=await submit(h,'Another proposal');await hosted(h);job(h,a.submission);
 for(const actor of ['reviewer','steward']){status(await call(h,'submission?id='+a.submission.id,undefined,actor),200);status(await call(h,'job?id=private-job',undefined,actor),200);status(await call(h,'target?id=hosted-private',undefined,actor),200);const d=await call(h,'dashboard',undefined,actor);assert.equal(d.body.submissions.length,2);assert.equal(d.body.capabilities.can_triage,true);assert.equal(d.body.capabilities.can_apply,false);}
 status(await call(h,'triage',triageBody(b.submission,'request_information'),'steward'),200);
 status(await call(h,'triage',triageBody(b.submission,'ready_for_review'),'reviewer'),200);
 status(await call(h,'review',reviewBody(b.submission),'steward'),403);
 status(await call(h,'review',reviewBody(b.submission),'reviewer'),200);
 const ownReviewer=await submit(h,'Reviewer own draft','reviewer');status(await call(h,'review',reviewBody(ownReviewer.submission),'reviewer'),403);
});

test('publishers receive approved release data, not another contributor draft queue or triage powers',async t=>{
 const h=harness(t,{reviewers:['reviewer'],publishers:['publisher']}),draft=await submit(h),approved=await submit(h,'Approved proposal');await hosted(h);job(h,approved.submission);
 status(await call(h,'review',reviewBody(approved.submission),'reviewer'),200);
 status(await call(h,'submission?id='+draft.submission.id,undefined,'publisher'),404);status(await call(h,'submission?id='+approved.submission.id,undefined,'publisher'),200);
 status(await call(h,'target?id=hosted-private',undefined,'publisher'),200);status(await call(h,'job?id=private-job',undefined,'publisher'),200);
 const d=await call(h,'dashboard',undefined,'publisher');assert.deepEqual(d.body.submissions.map(s=>s.id),[approved.submission.id]);assert.equal(d.body.capabilities.can_triage,false);
 status(await call(h,'triage',triageBody(draft.submission),'publisher'),403);
});

test('revoked reviewer receipt replay does not hydrate a later private revision',async t=>{
 const h=harness(t,{reviewers:['reviewer']}),created=await submit(h),request=reviewBody(created.submission),reviewed=await call(h,'review',request,'reviewer');status(reviewed,200);
 const revised=await call(h,'revise',{idempotency_key:key(),submission_id:created.submission.id,expected_revision:1,submission_json:JSON.stringify(envelope('A later private draft'))});status(revised,200);
 h.service=createWorkflowService({...h.settings,authorization:{}});
 const replay=await call(h,'review',request,'reviewer');status(replay,200);assert.equal(replay.body.reused,true);assert.equal(replay.body.receipt.id,reviewed.body.receipt.id);assert.equal(replay.body.submission,undefined);assert.equal(replay.body.job,undefined);
 status(await call(h,'submission?id='+created.submission.id,undefined,'reviewer'),404);
});

test('publisher readback of an approved revision excludes superseded private draft history',async t=>{
 const h=harness(t,{reviewers:['reviewer'],publishers:['publisher']}),created=await submit(h);
 const revised=await call(h,'revise',{idempotency_key:key(),submission_id:created.submission.id,expected_revision:1,submission_json:JSON.stringify(envelope('Approved revised wording'))});status(revised,200);
 status(await call(h,'review',reviewBody(revised.body.submission),'reviewer'),200);
 const publisher=await call(h,'submission?id='+created.submission.id,undefined,'publisher');status(publisher,200);assert.deepEqual(publisher.body.submission.revisions.map(r=>r.revision),[2]);assertNoPrivate(publisher);
 const owner=await call(h,'submission?id='+created.submission.id);status(owner,200);assert.deepEqual(owner.body.submission.revisions.map(r=>r.revision),[1,2]);assert.equal(owner.body.submission.revisions[0].raw_json,created.request.submission_json);
});

test('publisher rollback response keeps its receipt/job but does not expose the reset draft',async t=>{
 const h=harness(t,{reviewers:['reviewer'],publishers:['publisher']}),created=await submit(h);job(h,created.submission);
 const response=await call(h,'rollback',{idempotency_key:key(),job_id:'private-job',rationale:'Cancel the synthetic staged release'},'publisher');status(response,200);assert.equal(response.body.job.status,'rolled_back');assert.equal(response.body.submission,undefined);assert.equal(response.body.receipt.action,'rollback');
});

test('scope filtering occurs before list limits, so other users cannot crowd out owned rows',async t=>{
 const h=harness(t),own=await submit(h);job(h,own.submission,'old-owned-job');await hosted(h,'old-owned-record');
 h.db.native.prepare('UPDATE workflow_submissions SET updated_at=? WHERE id=?').run('2020-01-01T00:00:00Z',own.submission.id);
 const insertHead=h.db.native.prepare('INSERT INTO workflow_submissions(id,owner_id,current_revision,review_state,created_at,updated_at) VALUES(?,?,?,?,?,?)');
 for(let i=0;i<101;i++){const id='other-'+i;insertHead.run(id,'author-b',1,'submitted','2030-01-01T00:00:00Z','2030-01-01T00:00:00Z');job(h,{id},'job-'+i,'2030-01-01T00:00:00Z');}
 const insertRecord=h.db.native.prepare('INSERT INTO approved_records(id,owner_id,preview_id,raw_json,raw_hash,derived_json,preview_hash,approved_at) VALUES(?,?,?,?,?,?,?,?)');
 for(let i=0;i<1001;i++)insertRecord.run('record-'+i,'author-b','preview-'+i,'{}','fixture','{}','fixture','2030-01-01T00:00:00Z');
 const d=await call(h,'dashboard');status(d,200);assert.deepEqual(d.body.submissions.map(s=>s.id),[own.submission.id]);assert.deepEqual(d.body.jobs.map(j=>j.id),['old-owned-job']);assert.deepEqual(d.body.targets.map(r=>r.record_id),['old-owned-record']);
 assert.equal((await h.store.listSubmissions()).length,100);assert.equal((await h.store.listJobs()).length,100);assert.equal((await h.store.listRecords()).length,1000);
});

test('open peers cannot enumerate unpublished targets, private target proposals or raw job snapshots',async t=>{
 const A='map_00000000-0000-4000-8000-000000000001',B='map_00000000-0000-4000-8000-000000000002';
 const h=harness(t,{everyone:true,reviewers:['moderator'],publishers:['publisher']});
 await hosted(h,'hosted-private',A);
 status(await call(h,'target?id=hosted-private',undefined,B),404);
 status(await call(h,'target?id=hosted-private',undefined,A),200);
 status(await call(h,'target?id=hosted-private',undefined,'moderator'),200);
 status(await call(h,'target?id=hosted-private',undefined,'publisher'),200);
 const dashboard=await call(h,'dashboard',undefined,B);status(dashboard,200);assert.deepEqual(dashboard.body.targets,[]);assertNoPrivate(dashboard);
 const saved=await submit(h,'A submitted proposal',A),id=job(h,saved.submission);
 h.db.native.prepare("UPDATE workflow_submissions SET review_state='draft' WHERE id=?").run(saved.submission.id);
 status(await call(h,'job?id='+id,undefined,B),404);
 for(const action of ['verify','rollback']){
  const request={idempotency_key:key(),job_id:id,...action==='verify'?{map_list_check:{status:'pass',evidence:'Forged peer assertion'}}:{rationale:'Forged peer rollback'}};
  status(await call(h,action,request,B),404);
 }
 h.db.native.prepare("UPDATE workflow_submissions SET review_state='approved' WHERE id=?").run(saved.submission.id);
 const peerJob=await call(h,'job?id='+id,undefined,B);status(peerJob,200);assertNoPrivate(peerJob);
 assert.equal(Object.hasOwn(peerJob.body.job.manifest.targets[0],'after'),false);
 const moderatorJob=await call(h,'job?id='+id,undefined,'moderator');status(moderatorJob,200);assert.ok(JSON.stringify(moderatorJob.body).includes(privateText));
 // A saved preview referring to a private hosted target is also outside the peer queue.
 const row=h.db.native.prepare('SELECT preview_json FROM workflow_revisions WHERE submission_id=?').get(saved.submission.id),preview=JSON.parse(row.preview_json);
 preview.targets=[{record_id:'hosted-private'}];h.db.native.prepare('UPDATE workflow_revisions SET preview_json=? WHERE submission_id=?').run(JSON.stringify(preview),saved.submission.id);
 status(await call(h,'submission?id='+saved.submission.id,undefined,B),404);
 h.db.native.prepare("UPDATE workflow_submissions SET review_state='submitted' WHERE id=?").run(saved.submission.id);
 status(await call(h,'triage',triageBody(saved.submission,'request_information'),B),404);
 assert.equal((await h.store.getSubmission(saved.submission.id)).review_state,'submitted');
 const hidden=await call(h,'dashboard',undefined,B);status(hidden,200);assert.deepEqual(hidden.body.submissions,[]);assert.deepEqual(hidden.body.jobs,[]);
});

test('a newly created shared task can be linked without accepting malformed or nonexistent task IDs',async t=>{
 const h=harness(t),created=await call(h,'task-create',{idempotency_key:key(),task:{bounded_task:'Synthetic link test',description:'Use a generated task ID.',section:'Research',skill_level:'beginner',status:'proposed'}});status(created,201);
 const value=envelope('Linked synthetic contribution',{task_ids:[created.body.task.task_id]});
 const linked=await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify(value)});status(linked,201);assert.deepEqual(linked.body.submission.task_ids,[created.body.task.task_id]);
 for(const id of ['HNY-nope','HNY-00000000-0000-4000-8000-000000000099']){
  const rejected=await call(h,'submit',{idempotency_key:key(),submission_json:JSON.stringify({...value,task_ids:[id]})});status(rejected,400);
 }
});

test('a public projection never grants a peer access to private canonical correction snapshots',async t=>{
 const A='map_00000000-0000-4000-8000-000000000001',B='map_00000000-0000-4000-8000-000000000002';
 const h=harness(t,{everyone:true});await hosted(h,'hosted-private',A);
 const derived={canonical_entry:{entry_id:'private-entry',title:'Hosted title',claim_text:privateText,contributor:'HIDDEN_SYNTHETIC_NAME',review_notes:'PRIVATE_SYNTHETIC_REVIEW'}};
 h.db.native.prepare('UPDATE approved_records SET derived_json=? WHERE id=?').run(JSON.stringify(derived),'hosted-private');
 h.store.getPublicRecord=async id=>id==='hosted-private'?{id,title:'Safe public title',description:'Safe public text'}:null;
 h.service=createWorkflowService({...h.settings,store:h.store});
 const record=await h.store.getRecord('hosted-private'),value=envelope('Synthetic correction',{type:'date_correction',targets:[{record_id:record.id,expected_version:record.version,expected_hash:record.hash}],payload:{original_wording:'unknown',reason:'Synthetic test',after:{time_original:'1900',time_start_year:1900,time_end_year:1900,time_precision:'year',time_basis:'Synthetic source'}}});
 const result=await call(h,'preview',{submission_json:JSON.stringify(value)},B);status(result,200);assertNoPrivate(result);
 for(const secret of ['HIDDEN_SYNTHETIC_NAME','PRIVATE_SYNTHETIC_REVIEW'])assert.equal(JSON.stringify(result.body).includes(secret),false);
 assert.equal(result.body.preview.application.applicable,false);
});


test('an ordinary owner receives safe job projections even with open review disabled',async t=>{
 const h=harness(t),saved=await submit(h,'Synthetic own submission');const id=job(h,saved.submission);
 const result=await call(h,'job?id='+id);status(result,200);assertNoPrivate(result);
 assert.equal(Object.hasOwn(result.body.job.manifest.targets[0],'after'),false);
});
