import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRegistrationEmail, isCunyEmail, registrationAllowed } from '../server/registration-eligibility.mjs';
import { harness, password, replacement } from './fixtures/map-accounts-harness.mjs';

const guestCode = 'LOCAL-TEST-ONLY-guest-482';
const policy = { REGISTRATION_ELIGIBILITY_ENABLED:'true', REGISTRATION_GUEST_CODE:guestCode };
const total = async (h, table) => (await h.db.prepare('SELECT count(*) n FROM '+table).first()).n;
const denied = result => { assert.equal(result.status,403,JSON.stringify(result.body)); assert.deepEqual(result.body,Object.hasOwn(result.body,'ok')?{ok:false,error:'registration_restricted'}:{error:'registration_restricted'}); assert.equal(result.cookie,''); };

test('CUNY admission matches complete ASCII domains and preserves each flow’s normalization', async () => {
  for (const email of ['person@cuny.edu',' Person@GC.CUNY.EDU ','person@students.brooklyn.cuny.edu','person+project@ccny.cuny.edu']) {
    assert.equal(isCunyEmail(email),true,email); assert.equal(await registrationAllowed(email,undefined,policy),true,email);
  }
  assert.equal(normalizeRegistrationEmail(' Person@GC.CUNY.EDU '),'Person@gc.cuny.edu');
  assert.equal(normalizeRegistrationEmail(' Person@GC.CUNY.EDU ',true),'person@gc.cuny.edu');
  for (const email of ['person@notcuny.edu','person@cuny.edu.example.com','person@cuny-edu.com','person@xn--cny-hoa.edu']) assert.equal(isCunyEmail(email),false,email);
  for (const email of ['person@@cuny.edu','person@.cuny.edu','person@a..cuny.edu','person@cuny.edu.','person@cuny。edu','person@сuny.edu','person@cuny.edu\u200b','per\nson@cuny.edu','person@cuny.edu\r\nx:y','https://guest@cuny.edu','person@cuny.edu/path','a..b@cuny.edu','person@-a.cuny.edu','person @cuny.edu','person@cuny.edu\r\n','\u00a0person@cuny.edu']) {
    assert.equal(normalizeRegistrationEmail(email),null,email); assert.equal(await registrationAllowed(email,guestCode,policy),false,email);
  }
  for (const code of [undefined,'','incorrect',guestCode+' ',guestCode.toLowerCase(),123,{},'x'.repeat(257)]) assert.equal(await registrationAllowed('guest@example.test',code,policy),false);
  assert.equal(await registrationAllowed('guest@example.test',guestCode,policy),true);
  assert.equal(await registrationAllowed('guest@example.test',guestCode,{REGISTRATION_ELIGIBILITY_ENABLED:'true'}),false);
  assert.equal(await registrationAllowed('guest@example.test',undefined,{}),true);
});

test('both registration routes enforce CUNY or code without storing codes, creating roles or merging RSVP and account identity', async t => {
  const h=await harness(t,{eligibilityEnabled:true,guestCode});
  const publicPolicy=await h.call('/api/registration-policy'); assert.deepEqual(publicPolicy.body,{restricted:true}); assert.equal(publicPolicy.headers.get('cache-control'),'no-store');
  const rsvp=(email,code,key=crypto.randomUUID())=>h.call('/api/register',{name:'Synthetic local guest',email,...(code===undefined?{}:{access_code:code})},'',{'Idempotency-Key':key});
  for (const [i,code] of [undefined,'wrong',123,{},'x'.repeat(257)].entries()) {
    denied(await rsvp('guest'+i+'@example.test',code));
    denied(await h.call('/api/auth/register',{email:'guest'+i+'@example.test',...(code===undefined?{}:{access_code:code})}));
  }
  assert.equal(await total(h,'event_registrations'),0);assert.equal(await total(h,'hny_auth_user'),0);assert.equal(await total(h,'hny_test_mail'),0);
  for (const email of ['rsvp@cuny.edu','Person@GC.CUNY.EDU','rsvp@students.brooklyn.cuny.edu']) assert.equal((await rsvp(email)).status,201);
  assert.equal((await h.db.prepare("SELECT email FROM event_registrations WHERE email LIKE 'Person@%'").first()).email,'Person@gc.cuny.edu');
  assert.equal(await total(h,'hny_auth_user'),0);
  const saved=await rsvp('guest@example.test',guestCode);assert.equal(saved.status,201);
  const register=await h.call('/api/auth/register',{email:'guest@example.test',access_code:guestCode});assert.deepEqual(register.body,{status:'check_email'});
  const token=await h.token('guest@example.test');assert.ok(token);assert.equal(await total(h,'hny_auth_user'),0);
  denied(await h.call('/api/auth/register',{email:'guest@example.test',access_code:'wrong'}));assert.equal(await total(h,'hny_test_mail'),1);
  denied(await h.call('/api/auth/verify',{token,password}));assert.equal(await total(h,'hny_auth_user'),0);assert.equal(await total(h,'hny_auth_session'),0);
  const verified=await h.call('/api/auth/verify',{token,password,access_code:guestCode});assert.equal(verified.status,200,JSON.stringify(verified.body));
  assert.equal((await h.call('/api/auth/verify',{token,password,access_code:guestCode})).status,400);
  const dashboard=await h.call('/api/contributions/dashboard',undefined,verified.cookie);assert.equal(dashboard.status,200);assert.equal(dashboard.body.capabilities.can_review,false);assert.equal(dashboard.body.capabilities.can_apply,false);
  assert.equal((await h.call('/api/admin/registrations',undefined,verified.cookie)).status,401);
  const proposal={schema_version:'1.0',type:'open_proposal',task_ids:[],title:'Synthetic admitted guest contribution',summary:'Local admission and ownership test.',public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{explanation:'Local admission and ownership test.'}};
  const submitted=await h.call('/api/contributions/submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(proposal)},verified.cookie);
  assert.equal(submitted.status,201,JSON.stringify(submitted.body));
  const other=await h.register('other-contributor@cuny.edu');
  assert.equal((await h.call('/api/contributions/submission?id='+submitted.body.submission.id,undefined,other)).status,404);
  assert.equal((await h.call('/api/contributions/submission?id='+submitted.body.submission.id,undefined,verified.cookie)).status,200);

  assert.deepEqual((await h.call('/api/auth/register',{email:'guest@example.test',access_code:guestCode})).body,register.body);
  for (const table of ['event_registrations','hny_auth_user','hny_auth_account','hny_auth_session','hny_auth_verification','hny_auth_limits','hny_test_mail']) assert.ok(!JSON.stringify((await h.db.prepare('SELECT * FROM '+table).all()).results).includes(guestCode),table);
  assert.equal((await h.call('/api/auth/register',{email:'MixedCase@GC.CUNY.EDU'})).status,200);assert.ok(await h.token('mixedcase@gc.cuny.edu'));
});

test('activation keeps old pending guest tokens usable with the current code and preserves existing users and RSVP receipts', async t => {
  const h=await harness(t), guest='pending@example.test', cuny='pending@gc.cuny.edu', established='established@example.test';
  const cookie=await h.register(established);
  for (const email of [guest,cuny]) assert.equal((await h.call('/api/auth/register',{email})).status,200);
  const token=await h.token(guest), cunyToken=await h.token(cuny);
  const key=crypto.randomUUID(), body={name:'Earlier local RSVP',email:guest};
  const saved=await h.call('/api/register',body,'',{'Idempotency-Key':key});assert.equal(saved.status,201);
  await h.configureEligibility(true,guestCode);
  for (const access_code of [undefined,'wrong']) denied(await h.call('/api/auth/verify',{token,password,...(access_code?{access_code}:{})}));
  assert.equal(await total(h,'hny_auth_user'),1);assert.equal(await total(h,'hny_auth_session'),1);
  assert.equal((await h.call('/api/auth/verify',{token:cunyToken,password})).status,200);
  const completed=await h.call('/api/auth/verify',{token,password,access_code:guestCode});assert.equal(completed.status,200,JSON.stringify(completed.body));
  const replay=await h.call('/api/register',body,'',{'Idempotency-Key':key});assert.equal(replay.status,200);assert.equal(replay.body.receipt_id,saved.body.receipt_id);
  assert.equal((await h.call('/api/auth/session',undefined,cookie)).status,200);
  assert.equal((await h.call('/api/auth/sign-in',{email:established,password})).status,200);
  assert.equal((await h.call('/api/auth/request-reset',{email:established})).status,200);
  const resetToken=await h.token(established,'reset_password');assert.ok(resetToken);
  assert.equal((await h.call('/api/auth/verify',{token:resetToken,password:replacement,access_code:guestCode})).status,400);
  assert.equal((await h.call('/api/auth/reset',{token:resetToken,password:replacement})).status,200);
  assert.equal((await h.call('/api/auth/session',undefined,cookie)).status,401);
  assert.equal((await h.call('/api/auth/sign-in',{email:established,password:replacement})).status,200);
});

test('passwordless guest sessions require code, missing configuration closes guest admission, and expiry and direct-route boundaries hold', async t => {
  const h=await harness(t), email='unfinished@example.test', cookie=await h.register(email);
  await h.db.prepare('DELETE FROM hny_auth_account').run();
  await h.configureEligibility(true);
  denied(await h.call('/api/auth/set-password',{password},cookie));
  denied(await h.call('/api/auth/register',{email:'new@example.test',access_code:guestCode}));
  assert.equal((await h.call('/api/auth/register',{email:'eligible@cuny.edu'})).status,200);
  const token=await h.token('eligible@cuny.edu');
  await h.db.prepare('UPDATE hny_auth_verification SET expiresAt=0').run();
  assert.equal((await h.call('/api/auth/verify',{token,password})).status,400);
  await h.configureEligibility(true,guestCode);
  assert.equal((await h.call('/api/auth/set-password',{password,access_code:guestCode},cookie)).status,200);
  for (const route of ['/api/auth/sign-up/email','/api/auth/sign-in/magic-link','/api/auth/magic-link/verify']) assert.equal((await h.call(route,{email,password,token,access_code:guestCode})).status,404,route);
  for (const route of ['/api/%61uth/register','/api//auth/register','/api/AUTH/register']) assert.equal((await h.call(route,{email,password,access_code:guestCode})).status,400,route);
  assert.equal((await h.call('/auth/verify',{token,password})).status,401);
});

test('rejected guest-code guesses count against durable limits before any RSVP or email is created', async t => {
  const h=await harness(t,{eligibilityEnabled:true,guestCode});
  for(let i=0;i<30;i++) denied(await h.call('/api/register',{name:'Local attempt',email:'attempt@example.test',access_code:'wrong'},'',{'Idempotency-Key':crypto.randomUUID(),'cf-connecting-ip':'192.0.2.201'}));
  const limited=await h.call('/api/register',{name:'Local attempt',email:'attempt@example.test',access_code:guestCode},'',{'Idempotency-Key':crypto.randomUUID(),'cf-connecting-ip':'192.0.2.201'});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');
  // The general per-account budget counts guesses; mail quotas remain for actual email requests.
  for(let i=0;i<12;i++) denied(await h.call('/api/auth/register',{email:'attempt@example.test',access_code:'wrong'}));
  assert.equal((await h.call('/api/auth/register',{email:'attempt@example.test',access_code:guestCode})).status,429);
  assert.equal(await total(h,'event_registrations'),0);assert.equal(await total(h,'hny_test_mail'),0);assert.equal(await total(h,'hny_auth_user'),0);
});


test('a password reset that creates a first credential requires admission, including links issued before activation', async t => {
  const h=await harness(t), email='first-password-reset@example.test';
  const cookie=await h.register(email);
  await h.db.prepare('DELETE FROM hny_auth_account').run();
  assert.equal((await h.call('/api/auth/request-reset',{email})).status,200);
  const token=await h.token(email,'reset_password');
  await h.configureEligibility(true,guestCode);
  denied(await h.call('/api/auth/reset',{token,password}));
  denied(await h.call('/api/auth/reset',{token,password,access_code:'wrong'}));
  assert.equal(await total(h,'hny_auth_account'),0);
  assert.equal((await h.call('/api/auth/session',undefined,cookie)).status,200);
  assert.equal((await h.call('/api/auth/reset',{token,password,access_code:guestCode})).status,200);
  assert.equal((await h.call('/api/auth/sign-in',{email,password})).status,200);
  assert.equal((await h.call('/api/auth/reset',{token,password,access_code:guestCode})).status,400);
});


test('simultaneous guest verification with admission consumes one token and creates one credential', async t => {
  const h=await harness(t,{eligibilityEnabled:true,guestCode}), email='concurrent-guest@example.test';
  assert.equal((await h.call('/api/auth/register',{email,access_code:guestCode})).status,200);
  const token=await h.token(email);
  const results=await Promise.all([h.call('/api/auth/verify',{token,password,access_code:guestCode}),h.call('/api/auth/verify',{token,password,access_code:guestCode})]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,400]);
  assert.equal(await total(h,'hny_auth_user'),1);assert.equal(await total(h,'hny_auth_account'),1);
});
