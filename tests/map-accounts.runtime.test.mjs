import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {harness,password,replacement} from './fixtures/map-accounts-harness.mjs';
import {MAP_ORIGIN} from '../deployment/map-accounts.mjs';
import {CHECKS} from '../server/workflow-core.mjs';

test('email proof, password sign-in, one-hour cookie, own contribution and sign-out in Workers/D1', async t=>{
  const h=await harness(t), email='first@example.test';
  const before=await h.call('/api/auth/register',{email});assert.equal(before.status,200);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_auth_user').first()).n,0);
  assert.equal((await h.call('/api/auth/sign-in',{email,password})).status,401);
  const token=await h.token(email);assert.ok(token);
  const stored=await h.db.prepare('SELECT identifier,value FROM hny_auth_verification').all();assert.ok(!JSON.stringify(stored.results).includes(token));
  const verified=await h.call('/api/auth/verify',{token,password});assert.equal(verified.status,200,JSON.stringify(verified.body));
  const cookies=verified.headers.getSetCookie().join(';');assert.match(cookies,/^__Host-hauntologies-session=/);assert.match(cookies,/HttpOnly/i);assert.match(cookies,/; Secure(?:;|$)/i);assert.match(cookies,/SameSite=Lax/i);assert.match(cookies,/Max-Age=3600/i);assert.doesNotMatch(cookies,/Domain=/i);
  assert.equal((await h.call('/api/auth/verify',{token,password})).status,400);
  const signed=await h.call('/api/auth/sign-in',{email,password});assert.equal(signed.status,200);assert.deepEqual(signed.body,{status:'signed_in'});
  const session=await h.call('/api/auth/session',undefined,signed.cookie);assert.match(session.body.actor_id,/^map_/);assert.equal(session.body.email,email);
  const raw={schema_version:'1.0',type:'open_proposal',task_ids:[],title:'Synthetic contribution',summary:'Local account acceptance only.',public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{explanation:'Local account acceptance only.'}};
  const saved=await h.call('/api/contributions/submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(raw)},signed.cookie);assert.equal(saved.status,201,JSON.stringify(saved.body));
  const second=await h.register('second@example.test');
  const mismatched=await h.call('/api/contributions/submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(raw)},second,{'X-Hauntologies-Actor':session.body.actor_id});assert.equal(mismatched.status,409);assert.equal(mismatched.body.error,'account_changed');
  assert.equal((await h.call('/api/contributions/submission?id='+saved.body.submission.id,undefined,second)).status,404);
  const images=JSON.parse(await readFile(new URL('./fixtures/attachment-images.json',import.meta.url),'utf8'));
  const form=new FormData();
  for(const [key,value] of Object.entries({submission_id:saved.body.submission.id,expected_revision:1,idempotency_key:crypto.randomUUID(),metadata_json:JSON.stringify({alt:'Synthetic rectangle.'})})) form.append(key,String(value));
  form.append('image',new Blob([Buffer.from(images.png,'base64')],{type:'image/png'}),'synthetic.png');
  const upload=new Request(MAP_ORIGIN+'/api/contributions/attachment',{method:'POST',headers:{origin:MAP_ORIGIN,'sec-fetch-site':'same-origin',cookie:signed.cookie},body:form});
  const uploaded=await h.mf.dispatchFetch(upload.url,{method:upload.method,headers:Object.fromEntries(upload.headers),body:await upload.arrayBuffer()});
  const attachment=await uploaded.json();assert.equal(uploaded.status,201,JSON.stringify(attachment));
  const attachmentUrl=MAP_ORIGIN+'/api/contributions/attachment?id='+attachment.attachment.attachment_id;
  const download=await h.mf.dispatchFetch(attachmentUrl,{headers:{cookie:signed.cookie}});
  assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'private, no-store');
  assert.equal((await download.arrayBuffer()).byteLength,attachment.attachment.byte_length);
  assert.equal((await h.mf.dispatchFetch(attachmentUrl,{headers:{cookie:second}})).status,404);
  assert.equal((await h.mf.dispatchFetch(attachmentUrl)).status,401);
  const own=await h.call('/api/contributions/dashboard',undefined,signed.cookie);assert.equal(own.body.submissions.length,1);assert.equal(own.body.capabilities.can_review,false);
  assert.equal((await h.call('/api/admin/registrations',undefined,signed.cookie)).status,401);
  assert.equal((await h.call('/api/contributions/dashboard',undefined,'',{'oai-authenticated-user-id':session.body.actor_id})).status,401);
  assert.equal((await h.call('/api/auth/sign-out',{},signed.cookie)).status,200);
  assert.equal((await h.call('/api/auth/session',undefined,signed.cookie)).status,401);
});

test('reset is purpose-bound, one-use, revokes prior sessions and rejects prior password',async t=>{
  const h=await harness(t), email='reset@example.test', cookie=await h.register(email);
  assert.equal((await h.call('/api/auth/request-reset',{email})).status,200);
  const token=await h.token(email,'reset_password');assert.ok(token);
  assert.equal((await h.call('/api/auth/verify',{token,password:replacement})).status,400);
  const responses=await Promise.all([h.call('/api/auth/reset',{token,password:replacement}),h.call('/api/auth/reset',{token,password:replacement})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
  assert.equal(responses.find(r=>r.status===200).cookie,'__Host-hauntologies-session=');
  assert.equal((await h.call('/api/auth/session',undefined,cookie)).status,401);
  assert.equal((await h.call('/api/auth/sign-in',{email,password})).status,401);
  assert.equal((await h.call('/api/auth/sign-in',{email,password:replacement})).status,200);
  const unknown=await h.call('/api/auth/request-reset',{email:'missing@example.test'});assert.deepEqual(unknown.body,{status:'check_email'});
});

test('configured map reviewer independently reviews through account sessions while ownership and publication limits hold', async t => {
  const h = await harness(t);
  const owner = await h.register('proposal-owner@example.test');
  const reviewer = await h.register('proposal-reviewer@example.test');
  const stranger = await h.register('proposal-stranger@example.test');
  const session = await h.call('/api/auth/session', undefined, reviewer);
  assert.equal(session.status, 200);
  assert.equal(session.body.email, 'proposal-reviewer@example.test');
  const reviewerId = session.body.actor_id;
  assert.match(reviewerId, /^map_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const submit = async cookie => {
    const raw = {schema_version:'1.0',type:'open_proposal',task_ids:[],title:'Synthetic reviewer proposal',summary:'Local reviewer acceptance only.',public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{explanation:'Local reviewer acceptance only.'}};
    const result = await h.call('/api/contributions/submit', {idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(raw)}, cookie);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.submission;
  };
  const submission = await submit(owner), ownSubmission = await submit(reviewer);
  const detail = '/api/contributions/submission?id=' + submission.id;
  const reviewBody = value => ({idempotency_key:crypto.randomUUID(),submission_id:value.id,expected_revision:value.revision,payload_hash:value.payload_hash,diff_hash:value.diff_hash,checks:Object.fromEntries(CHECKS.map(key => [key,'pass'])),rationale:'Independent synthetic account review.'});

  assert.equal((await h.call(detail, undefined, reviewer)).status, 404);
  assert.equal((await h.call('/api/contributions/dashboard', undefined, reviewer)).body.capabilities.can_review, false);
  await h.configureReviewers([reviewerId]);
  assert.equal((await h.call('/api/auth/session', undefined, reviewer)).body.actor_id, reviewerId);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_auth_user').first()).n, 3);
  const dashboard = await h.call('/api/contributions/dashboard', undefined, reviewer);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.submissions.length, 2);
  assert.equal(dashboard.body.capabilities.can_review, true);
  assert.equal(dashboard.body.capabilities.can_triage, true);
  assert.equal(dashboard.body.capabilities.can_apply, false);
  assert.equal(dashboard.body.capabilities.can_rollback, false);
  const inspected = await h.call(detail, undefined, reviewer);
  assert.equal(inspected.status, 200);
  assert.equal(inspected.body.submission.is_own, false);

  const forged = {'oai-authenticated-user-id':reviewerId,'x-authenticated-user-id':reviewerId};
  assert.equal((await h.call(detail, undefined, stranger, forged)).status, 404);
  assert.equal((await h.call(detail, undefined, '', forged)).status, 401);
  assert.equal((await h.call('/api/contributions/review', reviewBody(submission), '', forged)).status, 401);
  const unauthorized = await h.call('/api/contributions/review', reviewBody(submission), stranger, forged);
  assert.equal(unauthorized.status, 403);
  assert.equal(unauthorized.body.error, 'reviewer_not_authorized');

  const approved = await h.call('/api/contributions/review', reviewBody(submission), reviewer);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.submission.status, 'approved');
  const storedApproval = await h.db.prepare('SELECT reviewer_id FROM workflow_approvals WHERE submission_id=?').bind(submission.id).first();
  assert.equal(storedApproval.reviewer_id, reviewerId);
  assert.equal((await h.call(detail, undefined, owner)).body.submission.status, 'approved');
  assert.equal((await h.call(detail, undefined, stranger)).status, 404);

  const selfReview = await h.call('/api/contributions/review', reviewBody(ownSubmission), reviewer);
  assert.equal(selfReview.status, 403);
  assert.equal(selfReview.body.error, 'self_approval_forbidden');
  const own = await h.call('/api/contributions/submission?id=' + ownSubmission.id, undefined, reviewer);
  assert.equal(own.body.submission.status, 'submitted');
  assert.equal(own.body.submission.approval, null);
  const apply = await h.call('/api/contributions/apply', {idempotency_key:crypto.randomUUID(),submission_id:submission.id,expected_revision:submission.revision,approval_hash:approved.body.submission.approval.approval_hash}, reviewer);
  assert.equal(apply.status, 403);
  assert.equal(apply.body.error, 'publisher_not_authorized');
  assert.equal((await h.db.prepare('SELECT count(*) n FROM workflow_jobs').first()).n, 0);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM approved_records').first()).n, 0);

  await h.configureReviewers([]);
  assert.equal((await h.call('/api/auth/session', undefined, reviewer)).body.actor_id, reviewerId);
  assert.equal((await h.call(detail, undefined, reviewer)).status, 404);
  assert.equal((await h.call('/api/contributions/dashboard', undefined, reviewer)).body.capabilities.can_review, false);
});

test('strict origin/routes and durable mail limits preserve old unused setup links',async t=>{
  const h=await harness(t), email='expired@example.test';
  assert.equal((await h.call('/api/auth/register',{email},'',{origin:'https://other.example'})).status,403);
  assert.equal((await h.call('/api/auth/register',{email,recipient:'elsewhere@example.test'})).status,400);
  assert.equal((await h.call('/api/auth/sign-up/email',{email,password})).status,404);
  assert.equal((await h.call('/api/%61uth/register',{email})).status,400);
  assert.equal((await h.call('/api/auth/register',{email})).status,200);
  const token=await h.token(email);
  await h.db.prepare('UPDATE hny_auth_verification SET expiresAt=0').run();
  assert.equal((await h.call('/api/auth/verify',{token,password})).status,200);
  assert.equal((await h.call('/api/auth/register',{email})).status,200);
  assert.equal((await h.call('/api/auth/register',{email})).status,200);
  assert.equal((await h.call('/api/auth/register',{email})).status,429);
});


test('concurrent verification links create one credential and rate counters expire',async t=>{
  const h=await harness(t), email='race@example.test';
  // Synthetic verified account without a credential isolates the password-creation race.
  await h.db.prepare('INSERT INTO hny_auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)').bind(crypto.randomUUID(),'',email,Date.now(),Date.now()).run();
  await h.call('/api/auth/register',{email});const first=await h.token(email);
  await h.call('/api/auth/register',{email});const second=await h.token(email);
  const results=await Promise.all([h.call('/api/auth/verify',{token:first,password}),h.call('/api/auth/verify',{token:second,password:replacement})]);
  assert.equal(results.filter(r=>r.status===200).length,1);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_auth_account').first()).n,1);
  const winner=results[0].status===200?password:replacement;
  assert.equal((await h.call('/api/auth/sign-in',{email,password:winner})).status,200);
  const user=await h.db.prepare('SELECT id FROM hny_auth_user').first();
  await h.db.prepare('UPDATE hny_auth_session SET expiresAt=0 WHERE userId=?').bind(user.id).run();
  assert.equal((await h.call('/api/auth/session',undefined,results.find(r=>r.status===200).cookie)).status,401);
  await h.db.prepare("INSERT INTO hny_auth_limits (bucket,window,count,expires_at) VALUES ('old',0,1,0)").run();
  await h.call('/api/auth/sign-out',{});
  assert.equal(await h.db.prepare("SELECT bucket FROM hny_auth_limits WHERE bucket='old'").first(),null);
});

test('uncertain email and unavailable session storage keep private access closed',async t=>{
  const failed=await harness(t,{mailFailure:true});
  const result=await failed.call('/api/auth/register',{email:'uncertain@example.test'});
  assert.equal(result.status,503);assert.equal(result.cookie,'');
  assert.equal((await failed.db.prepare('SELECT count(*) n FROM hny_test_mail').first()).n,0);
  assert.equal((await failed.db.prepare('SELECT count(*) n FROM hny_auth_user').first()).n,0);
  const h=await harness(t),cookie=await h.register('storage@example.test');
  await h.db.prepare('ALTER TABLE hny_auth_session RENAME TO unavailable_sessions').run();
  assert.equal((await h.call('/api/auth/session',undefined,cookie)).status,503);
  assert.equal((await h.call('/api/contributions/dashboard',undefined,cookie)).status,503);
});

test('participants sharing a campus address can register within global and recipient limits',async t=>{
  const h=await harness(t);
  for(let i=0;i<13;i++) assert.equal((await h.call('/api/auth/register',{email:`campus${i}@example.test`},'',{'cf-connecting-ip':'192.0.2.200'})).status,200);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM hny_test_mail').first()).n,13);
});

test('anonymous public projections exclude private proposals and owner edit pages require an account',async t=>{
 const h=await harness(t),cookie=await h.register('private-feed@example.test');
 const raw={schema_version:'1.0',type:'open_proposal',task_ids:[],title:'PRIVATE TITLE',summary:'PRIVATE TEXT',public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{explanation:'PRIVATE TEXT'}};
 assert.equal((await h.call('/api/contributions/submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(raw)},cookie)).status,201);
 for(const path of ['/api/published-edits','/api/published-records']){const result=await h.call(path);assert.equal(result.status,200);assert.deepEqual(result.body,path==='/api/published-records'?{records:[],next_cursor:null}:{items:[]});assert.equal((await h.call(path,{})).status,401);}
 assert.equal((await h.call('/api/contributions/edits')).status,401);const own=await h.call('/api/contributions/edits?page=1',undefined,cookie);assert.equal(own.status,200);assert.equal(own.body.total,1);assert.equal(own.body.items[0].title,'PRIVATE TITLE');
});
