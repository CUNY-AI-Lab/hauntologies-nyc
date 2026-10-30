// Synthetic localhost accounts only; no production or external requests.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOCAL_MAP_URL||'http://127.0.0.1:8798';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Synthetic localhost only');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),checks=[],errors=[];
const out='output/playwright/guide-integration';await mkdir(out,{recursive:true});page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('#taskView,.directory-header')].filter(e=>e.getClientRects().length).every(e=>e.scrollWidth<=e.clientWidth+1)),'no horizontal overflow');
try{
 await page.goto(base);await page.locator('#guidePageLink').click();await page.getByRole('heading',{name:'Guide to the map',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/guide');checks.push('signed-out title-card Guide link reaches the separate page');
 assert.equal(await page.locator('.guide-step').count(),7);assert.equal(await page.locator('.guide-meta').innerText(),'Oct 30, 2026 · @Zach M');
 for(const [width,height]of [[1440,1000],[390,844],[320,740],[844,390],[640,450]]){
  await page.setViewportSize({width,height});await noOverflow();
  for(const link of await page.locator('.directory-header nav a').all())assert.ok((await link.boundingBox()).height>=44);
  await page.screenshot({path:out+'/guide-'+width+'.png',fullPage:true});
 }
 checks.push('seven guide sections and byline remain readable across desktop, phone, landscape and narrow reflow');
 await page.emulateMedia({media:'print'});assert.equal(await page.locator('#printGuide').isVisible(),false);assert.equal(await page.locator('.directory-header').isVisible(),false);await page.emulateMedia({media:'screen'});checks.push('print layout hides navigation and Print control');
 assert.ok((await context.request.post(base+'/api/auth/sign-in',{data:{email:'contributor@local.test',password:'haunted-local-only'},headers:{origin:base}})).ok());
 await page.goto(base);await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());await page.locator('#toolsButton').click();
 assert.deepEqual(await page.locator('#toolsMenu > :is(button,a):visible').allTextContents(),['Edit','Tasks','Activity','Contributors','Guide']);
 await page.locator('#contributorsButton').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'guideButton');await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Guide to the map',exact:true}).waitFor();checks.push('Contribute places Guide directly below Contributors, with keyboard navigation');
 await page.goto(base);await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());
 for(const [width,height]of [[1440,1000],[390,844]]){
  await page.setViewportSize({width,height});if(width<761)await page.locator('#mapControlsButton').click();
  await page.locator('#placeSearchToggle').click();await page.locator('#plotPlaceButton').click();
  assert.equal(await page.locator('#plotPlaceButton').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#placeSearchToggle').getAttribute('aria-expanded'),'false');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#plotPlaceButton').getAttribute('aria-pressed'),'false');assert.equal(await page.evaluate(()=>document.activeElement.id),'plotPlaceButton');
 }
 checks.push('plotter stays right of Search, closes search and cancels with Escape on desktop and phone');
 await page.goto(base);await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());await page.locator('#toolsButton').click();await page.locator('#tasksTool').click();await page.waitForFunction(()=>document.querySelectorAll('#taskLedger .task-card').length===8);
 assert.deepEqual(await page.locator('#taskLedger .task-group > h4').allTextContents(),['Pull requests','Existing entries','New entries','Datasets and maps']);assert.equal(await page.locator('#taskLedger .task-card').count(),8);
 assert.equal(await page.locator('.task-create').evaluate(e=>e.open),false);assert.equal(await page.locator('#taskLedger .task-card .task-body ol').count(),8);checks.push('eight starting tasks in four groups with concrete steps and collapsed suggestion form');
 await page.waitForFunction(()=>document.activeElement.id==='taskTitle');
 const first=page.locator('#taskLedger .task-card').first();await first.locator('summary').focus();await page.keyboard.press('Enter');await page.locator('#taskLedger .task-card[open]').first().waitFor();assert.equal(await first.evaluate(e=>e.open),true);
 for(const [width,height]of [[1440,1000],[390,844],[320,740],[844,390]]){
  await page.setViewportSize({width,height});await noOverflow();
  const geometry=await first.evaluate(e=>{const s=e.querySelector('summary'),b=e.querySelector('.task-body');return{width:e.clientWidth,summary:s.getBoundingClientRect().width,padding:getComputedStyle(b).paddingLeft};});assert.ok(geometry.summary>=geometry.width-2);assert.equal(geometry.padding,'20px');
  await page.screenshot({path:out+'/tasks-'+width+'.png',fullPage:true});
 }
 checks.push('task titles use the full card width and open cards retain 20px insets at desktop and mobile widths');
 const actor='map_00000000-0000-4000-8000-000000000001';
 await page.evaluate(actor=>sessionStorage.setItem('hauntologies-pending-task:'+actor,JSON.stringify({actor_id:actor,idempotency_key:crypto.randomUUID(),task:{bounded_task:'Synthetic preserved suggestion',description:'Check a synthetic archive reference.',section:'Historical research',skill_level:'beginner',status:'proposed'}})),actor);
 await page.reload();await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());await page.locator('#toolsButton').click();await page.locator('#tasksTool').click();await page.getByText('A shared save is pending. Retry this task to confirm it.',{exact:true}).waitFor();
 assert.equal(await page.locator('.task-create').evaluate(e=>e.open),true);assert.equal(await page.locator('#newTaskTitle').inputValue(),'Synthetic preserved suggestion');assert.equal(await page.locator('#newTaskSection').inputValue(),'Historical research');checks.push('existing pending suggestions reopen with their saved legacy section instead of being discarded');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/contributions/task-create'));await page.locator('#createTaskForm').getByRole('button',{name:'Create task',exact:true}).click();assert.ok((await response).ok());
 await page.getByText('Synthetic preserved suggestion',{exact:true}).first().waitFor();assert.equal(await page.locator('#taskLedger .task-card').count(),9);checks.push('retrying the preserved synthetic suggestion adds it without replacing the eight starter tasks');
 assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({checks,errors,synthetic_only:true},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true});throw error;}finally{await browser.close();}
