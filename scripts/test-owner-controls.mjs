// Synthetic local UI acceptance. Start `npm run local -- --port 8791` first.
// Set PLAYWRIGHT_MODULE to the installed playwright package entry if it is not a local dependency.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOCAL_MAP_URL||'http://127.0.0.1:8791';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw new Error('Synthetic localhost only');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const api=async(path,body)=>{const r=await context.request[body?'post':'get'](base+path,body?{data:body,headers:{origin:base}}:{});const data=await r.json();assert.ok(r.ok(),JSON.stringify(data));return data;};
const signIn=async email=>api('/api/auth/sign-in',{email,password:'haunted-local-only'});
const key=()=>crypto.randomUUID();
const credit={consent:true,label:'night.owl',identity:'moniker'};
const proposal=title=>({schema_version:'1.0',type:'open_proposal',task_ids:[],title,summary:'Synthetic description only.',public_credit:credit,sources:[],attachments:[],targets:[],payload:{explanation:'Synthetic description only.',geometry:{type:'Point',coordinates:[-74.2391,40.5365]}}});
const submit=async e=>(await api('/api/contributions/submit',{idempotency_key:key(),submission_json:JSON.stringify(e)})).submission;
const ready=()=>page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());
const review=async s=>{await page.evaluate(id=>window.dispatchEvent(new CustomEvent('contributions-review-requested',{detail:{submissionId:id}})),s.id);await page.locator('#submissionDetail').getByRole('button',{name:/^Revise(?: and resubmit)?$/}).click();};
const out='output/playwright/pr35';await mkdir(out,{recursive:true});
try{
 await signIn('contributor@local.test');
 const fresh=await submit(proposal('Synthetic moniker place'));
 await page.goto(base);await ready();
 // Exercise all three summary-only revision kinds. Invalid synthetic legacy payloads remain revisable;
 // the real preview request proves which credit is submitted without approving their invalid content.
 for(const type of ['entry_bundle','area_proposal','record_annotation']){
  const e={...proposal('Legacy '+type),type,public_credit:{consent:true,label:'Prior chosen label'},payload:{}};
  const s=await submit(e);await review(s);
  assert.equal(await page.locator('#freeformCredit').isVisible(),false,type);
  await page.locator('#contributionSummary').fill('Revised summary only.');
  const request=page.waitForRequest(r=>r.url().endsWith('/api/contributions/preview')&&r.method()==='POST');
  await page.locator('#previewContribution').click();
  const sent=JSON.parse((await request).postDataJSON().submission_json);
  assert.deepEqual(sent.public_credit,e.public_credit);assert.equal(sent.summary,'Revised summary only.');
  await page.locator('#cancelRevision').click();assert.equal(await page.locator('#freeformCredit').getAttribute('hidden'),null);await page.locator('#contributionPlace').fill('40.5365, -74.2391');await page.locator('#contributionPlace').press('Enter');assert.equal(await page.locator('#freeformCredit').isVisible(),true);
 }
 await review(fresh);assert.equal(await page.locator('#publicCreditLabel').inputValue(),'night.owl');
 assert.equal(await page.locator('#publicCreditConsent').count(),0);
 await page.screenshot({path:out+'/username-390.png',fullPage:true});for(const [width,height] of [[320,740],[844,390]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/username-'+width+'.png',fullPage:true});}await page.setViewportSize({width:390,height:844});
 await page.locator('#cancelRevision').click();
 // Publish a synthetic standalone place through the real independent server review/apply/verify sequence.
 await signIn('reviewer@local.test');
 const approved=(await api('/api/contributions/review',{idempotency_key:key(),submission_id:fresh.id,expected_revision:1,payload_hash:fresh.payload_hash,diff_hash:fresh.diff_hash,checks:Object.fromEntries(['evidence_check','geography_check','rights_check','duplicate_check','privacy_check'].map(k=>[k,'pass'])),rationale:'Synthetic local UI fixture.'})).submission;
 const job=(await api('/api/contributions/apply',{idempotency_key:key(),submission_id:fresh.id,expected_revision:1,approval_hash:approved.approval.approval_hash})).job;
 await api('/api/contributions/verify',{idempotency_key:key(),job_id:job.id,map_list_check:{status:'pass',evidence:'Synthetic local acceptance.'}});
 await signIn('contributor@local.test');await page.reload();await ready();
 await page.locator('#accountButton').click();await page.locator('#openOwnEdits').click();
 const row=page.locator('#ownEditsList li').filter({has:page.getByRole('button',{name:'Synthetic moniker place',exact:true})});
 assert.equal(await row.getByRole('button',{name:/^Delete /}).count(),0);
 await row.getByRole('button',{name:'Revoke Synthetic moniker place',exact:true}).click();
 await row.getByRole('button',{name:'Delete Synthetic moniker place',exact:true}).waitFor();
 assert.match(await row.innerText(),/Revoked/);
 assert.ok(!(await api('/api/published-records')).records.some(r=>r.title==='Synthetic moniker place'));
 assert.ok(!(await api('/api/published-edits')).items.some(i=>i.targets.some(t=>t.title==='Synthetic moniker place')));
 await page.screenshot({path:out+'/revoked-390.png',fullPage:true});
 await row.getByRole('button',{name:'Delete Synthetic moniker place',exact:true}).click();
 await row.waitFor({state:'detached'});
 assert.ok(!(await api('/api/contributions/edits')).items.some(i=>i.id===fresh.id));
 // Hold an actual owner revocation response across a real account switch.
 const delayed=await submit(proposal('Delayed owner response'));
 await signIn('reviewer@local.test');
 const allowed=(await api('/api/contributions/review',{idempotency_key:key(),submission_id:delayed.id,expected_revision:1,payload_hash:delayed.payload_hash,diff_hash:delayed.diff_hash,checks:Object.fromEntries(['evidence_check','geography_check','rights_check','duplicate_check','privacy_check'].map(k=>[k,'pass'])),rationale:'Synthetic delayed response.'})).submission;
 const staged=(await api('/api/contributions/apply',{idempotency_key:key(),submission_id:delayed.id,expected_revision:1,approval_hash:allowed.approval.approval_hash})).job;
 await api('/api/contributions/verify',{idempotency_key:key(),job_id:staged.id,map_list_check:{status:'pass',evidence:'Synthetic delayed response.'}});
 await signIn('contributor@local.test');await page.reload();await ready();await page.locator('#accountButton').click();await page.locator('#openOwnEdits').click();
 let release,arrived;const held=new Promise(r=>release=r),received=new Promise(r=>arrived=r);
 await page.route('**/api/contributions/revoke',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response});});
 await page.getByRole('button',{name:'Revoke Delayed owner response',exact:true}).click();await received;
 await signIn('reviewer@local.test');
 await page.evaluate(async()=>window.HauntologiesAccount.resolve(await (await fetch('/api/auth/session')).json()));
 await page.locator('#accountButton').click();await page.locator('#openOwnEdits').click();
 await page.waitForFunction(()=>document.getElementById('ownEditsStatus').textContent==='0 edits');
 const before=await page.locator('#ownEditsDialog').innerText();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/contributions/revoke'));release();await response;
 // Browser task queue barrier, with no timing sleep.
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await page.locator('#ownEditsDialog').innerText(),before);
 assert.equal(await page.getByRole('button',{name:'Delete Delayed owner response',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: typed revision controls/payloads and restoration (3 kinds), chosen username, real publish → revoke → delete, public removal, delayed owner response across account switch, 320/390/landscape, no page errors.');
}catch(error){console.error('UI status:',await page.locator('#ownEditsStatus').textContent());await page.screenshot({path:out+'/failure.png',fullPage:true});throw error;}finally{await browser.close();}
