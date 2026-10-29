// Rendered recovery checks against the real local service, with synthetic data only.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOCAL_MAP_URL||'http://127.0.0.1:8791';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Synthetic localhost only');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage();
const out='output/playwright/direct',checks=[],errors=[];await mkdir(out,{recursive:true});page.on('pageerror',e=>errors.push(e.message));
const api=async(path,body)=>{const r=await context.request[body?'post':'get'](base+path,body?{data:body,headers:{origin:base}}:{}),data=await r.json();assert.ok(r.ok(),JSON.stringify(data));return data;};
const key=()=>crypto.randomUUID(),proposal=title=>({schema_version:'1.0',type:'open_proposal',task_ids:[],title,summary:'Synthetic recovery fixture.',public_credit:{consent:true,label:'night.owl',identity:'moniker'},sources:[],attachments:[],targets:[],payload:{explanation:'Synthetic recovery fixture.',geometry:{type:'Point',coordinates:[-74,40.72]}}});
const publish=(envelope,summary)=>api('/api/contributions/publish',{idempotency_key:key(),submission_json:JSON.stringify(envelope),change_summary:summary});
async function note(id,text){const target=(await api('/api/contributions/target?id='+id)).target;return publish({...proposal(text),summary:text,targets:[{record_id:id,expected_version:target.expected_version,expected_hash:target.expected_hash}],payload:{explanation:text}},text);}
async function fixture(label){const title='Synthetic Undo '+label+' '+Date.now(),root=await publish(proposal(title),'Add recovery fixture'),id=root.receipt.result.record_id,summary='Note to undo: '+label,edit=await note(id,summary);return{title,id,summary,event:edit.receipt.result.event_id};}
async function openUndo(f){
 await page.reload();await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());
 await page.locator('#mapControlsButton').click();await page.locator('#filtersButton').click();await page.locator('#search').fill(f.title);await page.locator('#mapToolsButton').click();
 const card=page.locator('.place-card[data-place-id="'+f.id+'"]');await card.waitFor();await card.getByRole('button',{name:'History',exact:true}).click();
 const entry=card.locator('.history-entry').filter({has:page.getByText(f.summary,{exact:true})});await entry.locator(':scope > summary').click();await entry.getByRole('button',{name:'Undo',exact:true}).click();
 const form=entry.locator('form');await form.getByLabel('Public username').fill('night.owl');await form.getByLabel('Describe your change').fill('Undo synthetic note');return form;
}
const submit=async(form,name='Publish undo')=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/contributions/undo'));await form.getByRole('button',{name,exact:true}).click();return response;};
const stored=(actor,event)=>page.evaluate(k=>sessionStorage.getItem(k),'hauntologies-pending-undo:'+actor+':'+event);
const undoCount=async id=>(await api('/api/place-history?id='+id)).items.filter(i=>i.kind==='undo').length;
try{
 await api('/api/auth/sign-in',{email:'contributor@local.test',password:'haunted-local-only'});const actor=(await api('/api/auth/session')).actor_id;await page.goto(base);
 const invalid=await fixture('invalid username');let form=await openUndo(invalid);await form.getByLabel('Public username').fill('synthetic@example.test');
 const rejected=await submit(form),rejectedBody=rejected.request().postDataJSON();assert.equal(rejected.status(),400);assert.equal((await rejected.json()).error,'public_moniker_required');await form.getByText('Choose a public username without an email address.',{exact:true}).waitFor();assert.equal(await stored(actor,invalid.event),null);
 form=await openUndo(invalid);await form.getByLabel('Public username').fill('corrected.owl');await form.getByLabel('Describe your change').fill('Corrected username and description');const corrected=await submit(form),correctedBody=corrected.request().postDataJSON();assert.equal(corrected.status(),200);assert.notEqual(correctedBody.idempotency_key,rejectedBody.idempotency_key);assert.equal(correctedBody.moniker,'corrected.owl');assert.equal(correctedBody.change_summary,'Corrected username and description');assert.equal(await undoCount(invalid.id),1);checks.push('400 invalid username clears saved request; reopened History publishes corrected fields');

 const stale=await fixture('stale version');form=await openUndo(stale);let interleave=true;
 await page.route('**/api/contributions/undo',async route=>{if(interleave){interleave=false;await note(stale.id,'Later independent note');}await route.continue();});
 const conflicted=await submit(form),staleBody=conflicted.request().postDataJSON();assert.equal(conflicted.status(),409);assert.equal((await conflicted.json()).error,'stale_target');await form.getByText('This place changed in an overlapping field. Reload History and compare the changes.',{exact:true}).waitFor();assert.equal(await stored(actor,stale.event),null);
 form=await openUndo(stale);await form.getByLabel('Describe your change').fill('Undo after comparing current History');const refreshed=await submit(form),refreshedBody=refreshed.request().postDataJSON();assert.equal(refreshed.status(),200);assert.notEqual(refreshedBody.idempotency_key,staleBody.idempotency_key);assert.ok(refreshedBody.expected_version>staleBody.expected_version);assert.notEqual(refreshedBody.expected_hash,staleBody.expected_hash);assert.equal(refreshedBody.change_summary,'Undo after comparing current History');assert.equal(await undoCount(stale.id),1);const record=(await api('/api/published-records')).records.find(r=>r.id===stale.id);assert.deepEqual(record.notes.map(n=>n.text),['Later independent note']);checks.push('409 stale target clears saved request; retry fetches current version and preserves unrelated note');await page.unroute('**/api/contributions/undo');

 const uncertain=await fixture('response loss');form=await openUndo(uncertain);let loseResponse=true,original;
 await page.route('**/api/contributions/undo',async route=>{if(loseResponse){loseResponse=false;original=route.request().postDataJSON();const result=await route.fetch();assert.equal(result.status(),200);await route.abort('failed');}else await route.continue();});
 await form.getByRole('button',{name:'Publish undo',exact:true}).click();await form.getByRole('button',{name:'Retry / confirm',exact:true}).waitFor();assert.deepEqual(JSON.parse(await stored(actor,uncertain.event)),original);assert.equal(await undoCount(uncertain.id),1);await page.screenshot({path:out+'/undo-uncertain-390.png',fullPage:true});
 form=await openUndo(uncertain);await form.getByLabel('Public username').fill('different.owl');await form.getByLabel('Describe your change').fill('Changed fields must not rewrite a pending request');const retry=await submit(form);assert.equal(retry.status(),200);assert.deepEqual(retry.request().postDataJSON(),original);assert.equal((await retry.json()).reused,true);assert.equal(await undoCount(uncertain.id),1);await page.waitForFunction(k=>sessionStorage.getItem(k)===null,'hauntologies-pending-undo:'+actor+':'+uncertain.event);checks.push('lost successful response retains exact key/body across reload; retry reconciles once');
 assert.deepEqual(errors,[]);await writeFile(out+'/undo-recovery-results.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(error){await page.screenshot({path:out+'/undo-recovery-failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw error;}finally{await browser.close();}
