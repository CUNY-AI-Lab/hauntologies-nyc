import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOCAL_MAP_URL||'http://127.0.0.1:8798';if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Synthetic localhost only');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
const out='output/playwright/completion';await mkdir(out,{recursive:true});
const api=async(path,body)=>{const r=await context.request[body?'post':'get'](base+path,body?{data:body,headers:{origin:base}}:{});const data=await r.json();assert.ok(r.ok(),JSON.stringify(data));return data;};
const login=()=>api('/api/auth/sign-in',{email:'contributor@local.test',password:'haunted-local-only'});
try{
 await login();await page.goto(base);await page.waitForFunction(()=>window.HauntologiesAccount?.canContribute());await page.locator('#toolsButton').click();await page.locator('#submitTool').click();
 await page.locator('#contributionPlace').fill('40.72, -74');await page.locator('#contributionPlace').press('Enter');
 await page.locator('#contributionObjectTitle').fill('Synthetic public image '+Date.now());await page.locator('#contributionSummary').fill('A synthetic image publication.');await page.locator('#contributionChangeSummary').fill('Add a place with an image');await page.locator('#publicCreditLabel').fill('Image tester');
 await page.locator('#freeformImages > summary').click();const fixture=JSON.parse(await readFile('tests/fixtures/attachment-images.json','utf8'));
 await page.locator('#contributionImages').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(fixture.png,'base64')});await page.locator('#image-0-rights').waitFor({state:'attached'});
 await page.locator('#previewContribution').click();await page.getByText('Image 1: add the license or permission that allows public display.',{exact:true}).waitFor();checks.push('unknown image rights stop publication with an actionable field message');
 await page.locator('#image-0-rights').fill('CC0 — synthetic fixture');await page.locator('#image-0-credit').fill('Synthetic artist');await page.locator('#image-0-alt').fill('A synthetic color sample');
 let resolveCommit;const committed=new Promise(resolve=>resolveCommit=resolve);let intercepted=false;
 await page.route('**/api/contributions/publish',async route=>{if(intercepted){await route.continue();return;}intercepted=true;const response=await route.fetch();resolveCommit(await response.json());await route.abort('failed');});
 await page.locator('#previewContribution').click();const first=await committed;assert.ok(first.receipt,JSON.stringify(first));
 await page.locator('#retryContributionImages').waitFor({state:'visible'});const retry=page.waitForResponse(r=>r.url().endsWith('/api/contributions/publish'));
 await page.locator('#retryContributionImages').click();const repeated=await (await retry).json();assert.equal(repeated.reused,true);assert.deepEqual(repeated.receipt,first.receipt);
 await page.locator('#contributionReceipt').getByText('Your contribution is on the map.',{exact:true}).waitFor();checks.push('one Publish action stages, uploads and publishes; a lost response retries the same receipt without duplicate publication');
 const id=first.receipt.result.record_id,record=(await api('/api/published-records')).records.find(r=>r.id===id);assert.equal(record.images.length,1);assert.equal(record.images[0].credit,'Synthetic artist');
 await api('/api/auth/sign-out',{});await page.goto(base+'/?place='+encodeURIComponent(id));const card=page.locator('.place-card[data-place-id="'+id+'"]');await card.waitFor();await card.locator('.place-record > summary').click();
 const image=card.locator('img');await image.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.place-record img')].some(image=>image.complete&&image.naturalWidth>0));
 for(const [width,height] of [[1440,1000],[390,844],[320,740]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/public-image-'+width+'.png',fullPage:true});}
 checks.push('signed-out public image decodes on desktop, 390px and 320px with credit, rights and alt text');
 await login();await api('/api/contributions/revoke',{idempotency_key:crypto.randomUUID(),submission_id:first.submission.id,expected_revision:first.submission.revision});assert.equal((await context.request.get(base+record.images[0].url)).status(),404);checks.push('revocation immediately closes public image delivery');
 assert.deepEqual(errors,[]);await writeFile(out+'/images-results.json',JSON.stringify({checks,errors,synthetic_only:true},null,2));console.log(JSON.stringify({checks,errors}));
}catch(e){await page.screenshot({path:out+'/images-failure.png',fullPage:true});console.error('Image acceptance failed at',page.url());throw e;}finally{await browser.close();}
