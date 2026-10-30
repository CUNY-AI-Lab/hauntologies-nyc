import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
// Place cards survive background refreshes, Undo follows sign-in, and a dropped session check
// pauses instead of signing out. Synthetic local accounts and records only.
const {chromium,request}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOCAL_MAP_URL||'http://127.0.0.1:8798';if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Synthetic localhost only');
const proposal=(title,lon,lat)=>({schema_version:'1.0',type:'open_proposal',task_ids:[],title,summary:'Synthetic description.',public_credit:{consent:true,label:'night.owl',identity:'moniker'},sources:[],attachments:[],targets:[],payload:{explanation:'Synthetic description.',geometry:{type:'Point',coordinates:[lon,lat]}}});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
const out='output/playwright/place-card-refresh';await mkdir(out,{recursive:true});
const post=async(ctx,path,data)=>{const r=await ctx.post(base+path,{data,headers:{origin:base}});const body=await r.json();assert.ok(r.ok(),path+' '+JSON.stringify(body));return body;};
const signIn=(ctx,email='contributor@local.test')=>post(ctx,'/api/auth/sign-in',{email,password:'haunted-local-only'});
const publish=(ctx,title,lon,lat,moniker)=>post(ctx,'/api/contributions/publish',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(proposal(title,lon,lat)),moniker,change_summary:'Add a synthetic place'});
const focus=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
const cardOf=id=>page.locator('.place-card[data-place-id="'+id+'"]');
const refresh=()=>page.evaluate(()=>window.HauntologiesPublic.refresh());
const historyFocused=id=>page.waitForFunction(id=>document.activeElement===[...document.querySelectorAll('.place-card')].find(c=>c.dataset.placeId===id)?.querySelector(':scope > details.place-history > summary'),id);
const undoCount=async id=>{const r=await context.request.get(base+'/api/place-history?id='+id);return(await r.json()).items.filter(item=>item.kind==='undo').length;};
try{
 await signIn(context.request);const title='Synthetic refresh place '+Date.now(),first=await publish(context.request,title,-74,40.72,'night.owl'),id=first.receipt.result.record_id;
 await page.goto(base+'/?place='+encodeURIComponent(id));await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());
 const card=cardOf(id);await card.waitFor();await card.locator('.place-history > summary').click();
 const entry=card.locator('.history-entry').first();await entry.waitFor();await entry.locator(':scope > summary').click();
 await entry.getByRole('button',{name:'Undo',exact:true}).click();const name=entry.locator('form input').first();await name.fill('typed.owl');
 const other=await request.newContext();await signIn(other,'reviewer@local.test');const second=await publish(other,'Synthetic second place '+Date.now(),-73.99,40.73,'other.owl');
 await focus();await page.waitForTimeout(1500);
 assert.equal(await entry.locator('form input').first().inputValue(),'typed.owl');assert.equal(await cardOf(second.receipt.result.record_id).count(),0);
 checks.push('a background refresh waits while a contributor types an Undo');
 // Exact regression: move from the name through both buttons while refreshes are pending.
 const form=entry.locator('form'),reason=form.locator('input').nth(1);await reason.fill('Keep this unsent reason');await name.focus();
 for(const expected of ['INPUT','BUTTON','BUTTON']){
  await page.keyboard.press('Tab');await refresh();assert.equal(await page.evaluate(()=>document.activeElement.tagName),expected);
  assert.equal(await name.inputValue(),'typed.owl');assert.equal(await reason.inputValue(),'Keep this unsent reason');
 }
 await page.keyboard.press('Shift+Tab');await refresh();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Publish undo');
 checks.push('Tab and Shift+Tab through both Undo buttons preserve fields and focus across repeated refreshes');
 await page.locator('#map').focus();await refresh();assert.equal(await form.count(),1);assert.equal(await reason.inputValue(),'Keep this unsent reason');
 checks.push('moving focus outside Undo leaves the unsent form intact');
 let release;const held=new Promise(resolve=>release=resolve);
 await page.route('**/api/contributions/undo',async route=>{await held;await route.continue();});
 const pending=page.waitForRequest(r=>r.url().endsWith('/api/contributions/undo'));await form.getByRole('button',{name:'Publish undo',exact:true}).click();await pending;
 await refresh();assert.equal(await form.count(),1);assert.equal(await form.getByRole('button',{name:'Publish undo',exact:true}).isDisabled(),true);
 // Hold a read taken before the Undo commit until the save succeeds.
 let releaseRead,readReady;const readHeld=new Promise(resolve=>releaseRead=resolve),readyRead=new Promise(resolve=>readReady=resolve);let holdRead=true;
 await page.route('**/api/published-records',async route=>{if(holdRead){holdRead=false;const response=await route.fetch();readReady();await readHeld;await route.fulfill({response});}else await route.continue();});
 const staleRead=refresh();await readyRead;
 const accepted=page.waitForResponse(r=>r.url().endsWith('/api/contributions/undo'));release();assert.equal((await accepted).status(),200);await form.waitFor({state:'detached'});releaseRead();await staleRead;
 await form.waitFor({state:'detached'});await cardOf(second.receipt.result.record_id).waitFor({state:'attached'});await historyFocused(id);await page.unroute('**/api/contributions/undo');await page.unroute('**/api/published-records');assert.equal(await undoCount(id),1);
 checks.push('pointer submission keeps the pending form; confirmed Undo fences a delayed pre-save response, refreshes and restores History focus');
 const secondCard=cardOf(second.receipt.result.record_id);await secondCard.locator('.place-history > summary').click();
 const secondEntry=secondCard.locator('.history-entry').first();await secondEntry.waitFor();await secondEntry.locator(':scope > summary').click();await secondEntry.getByRole('button',{name:'Undo',exact:true}).click();
 const cancelForm=secondEntry.locator('form');await cancelForm.locator('input').first().fill('cancel.owl');
 const third=await publish(other,'Synthetic third place '+Date.now(),-73.98,40.73,'other.owl');await refresh();
 await cancelForm.getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Enter');await cancelForm.waitFor({state:'detached'});await cardOf(third.receipt.result.record_id).waitFor({state:'attached'});await historyFocused(second.receipt.result.record_id);assert.equal(await undoCount(second.receipt.result.record_id),0);
 checks.push('keyboard Cancel resumes deferred reads, restores focus and does not publish');
 await post(context.request,'/api/auth/sign-out',{});await focus();await page.waitForFunction(()=>document.documentElement.dataset.accountState==='signed_out');
 assert.equal(await card.locator('.history-entry button',{hasText:'Undo'}).first().evaluate(b=>b.hidden),true);
 await signIn(context.request);await focus();await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());
 await card.locator('.history-entry button',{hasText:'Undo'}).first().waitFor({state:'attached'});
 await page.waitForFunction(id=>[...document.querySelectorAll('.place-card')].find(c=>c.dataset.placeId===id)?.querySelector('.history-entry button:not([hidden])')?.textContent==='Undo',id);
 checks.push('Undo follows sign-out and sign-in without reopening History');
 // An Undo submitted with Enter leaves focus in its field; the map still refreshes the card.
 const latest=secondCard.locator('.history-entry').last();await latest.locator(':scope > summary').click();await latest.getByRole('button',{name:'Undo',exact:true}).click();
 await latest.locator('form input').first().fill('night.owl');const summary=latest.locator('form input').nth(1);await summary.fill('Undo the synthetic place');const entered=page.waitForResponse(r=>r.url().endsWith('/api/contributions/undo'));await summary.press('Enter');assert.equal((await entered).status(),200);
 await page.waitForFunction(([id,title])=>{const card=[...document.querySelectorAll('.place-card')].find(c=>c.dataset.placeId===id);return card&&card.querySelector('.place-title')?.textContent!==title;},[second.receipt.result.record_id,second.submission.title],{timeout:15000});
 await latest.locator('form').waitFor({state:'detached'});await historyFocused(second.receipt.result.record_id);assert.equal(await undoCount(second.receipt.result.record_id),1);
 checks.push('an Undo submitted with Enter still refreshes the place card and restores focus');
 const thirdCard=cardOf(third.receipt.result.record_id);await thirdCard.locator('.place-history > summary').click();
 const thirdEntry=thirdCard.locator('.history-entry').first();await thirdEntry.waitFor();await thirdEntry.locator(':scope > summary').click();await thirdEntry.getByRole('button',{name:'Undo',exact:true}).click();
 const uncertain=thirdEntry.locator('form');await uncertain.locator('input').first().fill('retry.owl');await uncertain.locator('input').nth(1).fill('Retain this uncertain request');
 let lose=true,original;const bodies=[];
 await page.route('**/api/contributions/undo',async route=>{bodies.push(route.request().postDataJSON());if(lose){lose=false;original=bodies.at(-1);const result=await route.fetch();assert.equal(result.status(),200);await route.abort('failed');}else await route.continue();});
 await uncertain.getByRole('button',{name:'Publish undo',exact:true}).click();await uncertain.getByRole('button',{name:'Retry / confirm',exact:true}).waitFor();
 const fourth=await publish(other,'Synthetic recovery refresh '+Date.now(),-73.97,40.73,'other.owl');await uncertain.locator('input').first().focus();
 await page.keyboard.press('Tab');await refresh();await page.keyboard.press('Tab');await refresh();
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Retry / confirm');assert.equal(await uncertain.locator('input').nth(1).inputValue(),'Retain this uncertain request');assert.equal(await cardOf(fourth.receipt.result.record_id).count(),0);
 await page.screenshot({path:out+'/unsent-recovery.png',fullPage:true});
 const retried=page.waitForResponse(r=>r.url().endsWith('/api/contributions/undo'));await page.keyboard.press('Enter');const receipt=await retried;assert.equal(receipt.status(),200);assert.equal((await receipt.json()).reused,true);assert.deepEqual(bodies,[original,original]);assert.equal(await undoCount(third.receipt.result.record_id),1);
 await uncertain.waitFor({state:'detached'});await cardOf(fourth.receipt.result.record_id).waitFor({state:'attached'});await historyFocused(third.receipt.result.record_id);await page.unroute('**/api/contributions/undo');
 checks.push('lost successful response preserves the form through repeated reads and keyboard retry, using the same request exactly once');
 await other.dispose();
 await page.evaluate(()=>{window.__ended=0;window.addEventListener('contributions-session-ended',()=>window.__ended++);});
 let dropped=false,continuedFailure=true;await page.route('**/api/auth/session',route=>{if(!dropped){dropped=true;return route.abort('failed');}if(continuedFailure)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'account_unavailable'})});return route.continue();});
 await focus();await page.waitForFunction(()=>document.documentElement.dataset.accountPaused==='true');
 for(let attempt=0;attempt<2;attempt++){const failed=page.waitForResponse(r=>r.url().endsWith('/api/auth/session'));await page.locator('#accountButton').click();assert.equal((await failed).status(),503);assert.equal(await page.locator('#accountDialog').evaluate(d=>d.open),false);}
 await page.screenshot({path:out+'/outage-no-modal.png',fullPage:true});continuedFailure=false;
 checks.push('repeated Account clicks during a session outage leave the map usable without a hidden modal');
 await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute(),null,{timeout:10000});await page.unroute('**/api/auth/session');
 assert.equal(await page.evaluate(()=>window.__ended),0);assert.equal(await page.locator('#accountButton').textContent(),'Account');
 checks.push('a dropped session check pauses and restores the same account without ending the session');
 assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({checks,errors,synthetic_only:true},null,2));console.log(JSON.stringify({checks,errors}));
}catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error('Place card refresh acceptance failed at',page.url(),await page.evaluate(()=>({active:document.activeElement.outerHTML.slice(0,400),forms:document.querySelectorAll('.place-card form').length}))); throw e;}finally{await browser.close();}
