// Explicit synthetic/local acceptance only. Never point this runner at a live map.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOCAL_MAP_URL||'http://127.0.0.1:8798';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Synthetic localhost only');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const out='output/playwright/contributors';await mkdir(out,{recursive:true});
const checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
// The map's basemap/geocoders are not part of this feature's synthetic acceptance.
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const api=async(path,body)=>{const response=await context.request[body?'post':'get'](base+path,body?{data:body,headers:{origin:base}}:{});const data=await response.json();assert.ok(response.ok(),JSON.stringify(data));return data;};
const proposal=title=>({schema_version:'1.0',type:'open_proposal',task_ids:[],title,summary:'Synthetic place for local acceptance.',public_credit:{consent:true,identity:'moniker',label:'Night Owl'},sources:[],attachments:[],targets:[],payload:{explanation:'Synthetic place for local acceptance.',geometry:{type:'Point',coordinates:[-74,40.72]}}});
const publish=(value,name)=>api('/api/contributions/publish',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(value),moniker:name,change_summary:'Synthetic local acceptance'});
const loaded=()=>page.waitForFunction(()=>document.getElementById('directoryStatus')?.textContent.startsWith('Global totals'));
const placeLoaded=()=>page.locator('#placeInspector h3').waitFor();
try{
 await api('/api/auth/sign-in',{email:'contributor@local.test',password:'haunted-local-only'});
 const a=await publish(proposal('Synthetic Lantern House'),'Night Owl'),id=a.receipt.result.record_id;
 const target=(await api('/api/contributions/target?id='+id)).target;
 await publish({...proposal('Synthetic note'),summary:'Synthetic offline reference.',targets:[{record_id:id,expected_version:target.expected_version,expected_hash:target.expected_hash}],payload:{explanation:'Synthetic offline reference.',sources_text:'Notebook, page 4'}},'Night Owl');
 await api('/api/auth/sign-in',{email:'reviewer@local.test',password:'haunted-local-only'});
 await publish(proposal('Synthetic Archive Garden'),'Night Owl');
 await publish(proposal('Synthetic Unlocated Research'),'Archive Reader');
 await api('/api/auth/sign-out',{});
 await page.goto(base+'/contributors');await loaded();await placeLoaded();
 assert.equal(await page.locator('#peopleList button').count(),3);assert.equal(await page.getByText('Shared username, separate contributor',{exact:true}).count(),2);
 assert.ok(!(await page.locator('body').innerText()).includes('@local.test'));checks.push('signed-out public directory separates same-name actors and exposes no account email');
 await page.locator('#placeSearch').fill('Synthetic Lantern');await placeLoaded();assert.equal(await page.locator('#placeInspector h3').innerText(),'Synthetic Lantern House');
 await page.screenshot({path:out+'/desktop-1440.png',fullPage:true});
 await page.locator('#placeInspector .place-field-details summary').click();assert.ok((await page.locator('#placeInspector').innerText()).includes('Not applicable'));checks.push('one-place inspector keeps optional and non-applicable fields in a collapsed disclosure');
 await page.locator('#placeInspector .place-field-details summary').click();
 for(const [width,height] of [[390,844],[320,740],[844,390],[720,500]]){
  await page.setViewportSize({width,height});
  if(width<=720)await page.locator('#showPlaces').click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:out+'/places-'+width+'.png',fullPage:true});
  if(width<=720){await page.locator('#showContributors').click();await page.screenshot({path:out+'/contributors-'+width+'.png',fullPage:true});await page.locator('#peopleList button').first().click();assert.equal(await page.locator('#showPlaces').getAttribute('aria-pressed'),'true');await page.locator('#clearContributor').click();}
  checks.push('no horizontal page scroll and usable view controls at '+width+'×'+height);
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('#placeSearch').fill('Synthetic Lantern');await placeLoaded();
 await page.locator('#placeInspector').getByRole('link',{name:'History',exact:true}).click();await page.locator('.place-history[open] .history-entry').first().waitFor();await page.locator('.place-history[open] .history-entry summary').first().click();assert.match(await page.locator('.place-history[open]').innerText(),/Night Owl/);checks.push('History URL resolves the selected public place');
 await page.goto(base+'/contributors');await loaded();await page.locator('#placeSearch').fill('Synthetic Lantern');await placeLoaded();
 await page.locator('#placeInspector').getByRole('link',{name:'Edit',exact:true}).click();await page.locator('#accountDialog[open]').waitFor();
 await page.locator('#accountDialog').getByLabel('Email',{exact:true}).fill('contributor@local.test');
 await page.locator('#accountDialog').getByLabel('Password',{exact:true}).fill('haunted-local-only');
 await page.locator('#accountDialog').getByRole('button',{name:'Sign in',exact:true}).click();
 await page.locator('#recordEditorDialog[open]').waitFor();assert.equal(await page.locator('#record-edit-title').inputValue(),'Synthetic Lantern House');checks.push('Edit URL opens sign-in and resumes the requested editor after sign-in without a reload');
 await page.goto(base+'/contributors');await loaded();
 await page.locator('#contributorSearch').fill('no-such-name');assert.match(await page.locator('#peopleEmpty').innerText(),/No public usernames match/);await page.locator('#contributorSearch').fill('');
 await page.locator('#placeSearch').fill('no-such-place');assert.match(await page.locator('#placeEmpty').innerText(),/No places match/);checks.push('empty searches explain how to recover');
 await page.route('**/api/contributors-summary',route=>route.fulfill({status:503,contentType:'application/json',headers:{'Retry-After':'60'},body:'{"error":"synthetic_unavailable"}'}));
 await page.locator('#refreshDirectory').click();await page.getByText('Public contributions are unavailable. Select Refresh to try again.',{exact:true}).waitFor();assert.equal(await page.locator('#totalPublished').innerText(),'—');assert.equal(await page.locator('#peopleList button').count(),0);await page.screenshot({path:out+'/unavailable.png',fullPage:true});checks.push('503 clears prior identities and shows unavailable totals, not zero');
 await page.unroute('**/api/contributors-summary');await page.reload();await loaded();
 await page.route('**/api/contributors-summary',route=>route.fulfill({status:200,contentType:'application/json',body:'invalid json'}));await page.locator('#refreshDirectory').click();await page.getByText('Public contributions are unavailable. Select Refresh to try again.',{exact:true}).waitFor();checks.push('malformed JSON fails visibly');await page.unroute('**/api/contributors-summary');await page.reload();await loaded();
 await context.setOffline(true);await page.locator('#refreshDirectory').click();await page.getByText('Public contributions are unavailable. Select Refresh to try again.',{exact:true}).waitFor();assert.equal(await page.locator('#totalPublished').innerText(),'—');await context.setOffline(false);await page.locator('#refreshDirectory').click();await loaded();checks.push('offline clears old data and manual refresh recovers');
 const fixture=await api('/api/contributors-summary'),empty={...fixture,contributors:[],places:[],totals:Object.fromEntries(Object.keys(fixture.totals).map(key=>[key,0])),metrics:Object.fromEntries(Object.entries(fixture.metrics).map(([key,value])=>[key,{...value,value:0,coverage:'complete'}]))};
 await page.route('**/api/contributors-summary',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(empty)}));await page.locator('#refreshDirectory').click();await loaded();assert.equal(await page.locator('#totalPublished').innerText(),'0');assert.match(await page.locator('#peopleEmpty').innerText(),/No publicly attributed/);checks.push('a complete empty response displays a genuine zero and an explanatory empty state');
 await page.unroute('**/api/contributors-summary');
 const markup={...fixture,contributors:[{...fixture.contributors[0],name:'<img src=x onerror=alert(1)>'}]};
 await page.route('**/api/contributors-summary',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(markup)}));await page.locator('#refreshDirectory').click();await loaded();assert.equal(await page.locator('#peopleList img').count(),0);assert.equal(await page.locator('.person-name').innerText(),markup.contributors[0].name);checks.push('public usernames render as literal text');await page.unroute('**/api/contributors-summary');await page.reload();await loaded();
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'skip-link');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'main');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'refreshDirectory');checks.push('keyboard skip link and next focus reach the main content and Refresh');
 await page.evaluate(()=>{document.documentElement.style.zoom='2';});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/content-zoom-200.png',fullPage:true});await page.evaluate(()=>{document.documentElement.style.zoom='';});checks.push('200% content zoom has no horizontal page overflow');
 await page.goto(base);await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());
 assert.equal(await page.locator('#toolsButton').innerText(),'Contribute');await page.locator('#toolsButton').click();
 assert.deepEqual(await page.locator('#toolsMenu > :is(button,a):visible').allTextContents(),['Edit','Tasks','Contributors']);
 await page.screenshot({path:out+'/contribute-menu.png',fullPage:true});
 await page.locator('#submitTool').click();await page.locator('#draftPanel.active').waitFor();assert.equal(await page.locator('#sidecarTitle').innerText(),'Contribute');await page.locator('#closeResearch').click();
 await page.locator('#toolsButton').click();await page.locator('#tasksTool').click();await page.waitForFunction(()=>document.getElementById('sidecarTitle')?.textContent==='Tasks');await page.locator('#closeResearch').click();
 await page.locator('#toolsButton').click();await page.locator('#contributorsButton').click();await loaded();checks.push('Contribute menu orders Edit, Tasks, Contributors; existing form and tasks work; no unimplemented Activity link');
 assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({checks,errors,synthetic_only:true},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error('Acceptance failed at',page.url(),'; page errors:',errors);throw error;}finally{await browser.close();}
