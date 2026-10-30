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
try{
 await signIn(context.request);const title='Synthetic refresh place '+Date.now(),first=await publish(context.request,title,-74,40.72,'night.owl'),id=first.receipt.result.record_id;
 await page.goto(base+'/?place='+encodeURIComponent(id));await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());
 const card=cardOf(id);await card.waitFor();await card.getByRole('button',{name:'History',exact:true}).click();
 const entry=card.locator('.history-entry').first();await entry.waitFor();await entry.locator(':scope > summary').click();
 await entry.getByRole('button',{name:'Undo',exact:true}).click();const name=entry.locator('form input').first();await name.fill('typed.owl');
 const other=await request.newContext();await signIn(other,'reviewer@local.test');const second=await publish(other,'Synthetic second place '+Date.now(),-73.99,40.73,'other.owl');
 await focus();await page.waitForTimeout(1500);
 assert.equal(await entry.locator('form input').first().inputValue(),'typed.owl');assert.equal(await cardOf(second.receipt.result.record_id).count(),0);
 checks.push('a background refresh waits while a contributor types an Undo');
 await page.locator('#map').focus();await cardOf(second.receipt.result.record_id).waitFor({state:'attached'});
 assert.equal(await card.locator(':scope > details.place-history').evaluate(d=>d.open),true);
 checks.push('the refresh runs once focus leaves the form, and History reopens on the rebuilt card');
 await post(context.request,'/api/auth/sign-out',{});await focus();await page.waitForFunction(()=>document.documentElement.dataset.accountState==='signed_out');
 assert.equal(await card.locator('.history-entry button',{hasText:'Undo'}).first().evaluate(b=>b.hidden),true);
 await signIn(context.request);await focus();await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());
 await card.locator('.history-entry button',{hasText:'Undo'}).first().waitFor({state:'attached'});
 await page.waitForFunction(id=>[...document.querySelectorAll('.place-card')].find(c=>c.dataset.placeId===id)?.querySelector('.history-entry button:not([hidden])')?.textContent==='Undo',id);
 checks.push('Undo follows sign-out and sign-in without reopening History');
 // An Undo submitted with Enter leaves focus in its field; the map still refreshes the card.
 const latest=card.locator('.history-entry').last();await latest.locator(':scope > summary').click();await latest.getByRole('button',{name:'Undo',exact:true}).click();
 await latest.locator('form input').first().fill('night.owl');const summary=latest.locator('form input').nth(1);await summary.fill('Undo the synthetic place');await summary.press('Enter');
 await page.waitForFunction(([id,title])=>{const card=[...document.querySelectorAll('.place-card')].find(c=>c.dataset.placeId===id);return card&&card.querySelector('.place-title')?.textContent!==title;},[id,title],{timeout:15000});
 checks.push('an Undo submitted with Enter still refreshes the place card');
 await page.evaluate(()=>{window.__ended=0;window.addEventListener('contributions-session-ended',()=>window.__ended++);});
 let dropped=false;await page.route('**/api/auth/session',route=>{if(!dropped){dropped=true;return route.abort('failed');}return route.continue();});
 await focus();await page.waitForFunction(()=>document.documentElement.dataset.accountPaused==='true');
 await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute(),null,{timeout:10000});await page.unroute('**/api/auth/session');
 assert.equal(await page.evaluate(()=>window.__ended),0);assert.equal(await page.locator('#accountButton').textContent(),'Account');
 checks.push('a dropped session check pauses and restores the same account without ending the session');
 assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({checks,errors,synthetic_only:true},null,2));console.log(JSON.stringify({checks,errors}));
}catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error('Place card refresh acceptance failed at',page.url());throw e;}finally{await browser.close();}
