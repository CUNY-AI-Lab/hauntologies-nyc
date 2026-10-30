import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.LOCAL_MAP_URL||'http://127.0.0.1:8798';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Synthetic localhost only');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const record=(id,category)=>({id,title:'Synthetic '+id,category,latitude:40.72,longitude:-74,geo_status:'approximate'});
await page.route('**/api/published-records',route=>route.fulfill({json:{records:[record('category-one','Oral History'),record('category-two',' oral  history '),record('category-three','Ghost story')],next_cursor:null}}));
const out='output/playwright/completion';await mkdir(out,{recursive:true});
try{
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#filterStatus option[value="custom:oral history"]'));
 assert.equal(await page.locator('#mapControlsButton').isVisible(),false);
 for(const id of ['filtersButton','layersButton','placeSearchToggle'])assert.equal(await page.locator('#'+id).isVisible(),true);
 await page.locator('#filtersButton').click();await page.locator('#filtersPanel').waitFor({state:'visible'});
 const panel=await page.locator('#filtersPanel').boundingBox(),controls=await page.locator('.header-tools').boundingBox();assert.ok(panel.x+panel.width<=controls.x);
 await page.locator('#filterStatus').selectOption('custom:oral history');
 assert.deepEqual(await page.evaluate(()=>filtered().map(r=>r.id).sort()),['category-one','category-two']);
 assert.equal(await page.locator('#filterStatus option[value="reported_haunting"]').count(),1);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#filtersPanel').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'filtersButton');
 await page.screenshot({path:out+'/desktop-direct-controls.png',fullPage:true});checks.push('desktop controls visible without Tools; category aliases deduplicate; custom categories filter every matching place; Escape restores focus');
 await page.locator('#layersButton').click();await page.locator('#layersPanel').waitFor({state:'visible'});assert.equal(await page.locator('#filtersButton').isVisible(),true);await page.keyboard.press('Escape');checks.push('Layers opens independently and keeps direct controls reachable');
 await page.setViewportSize({width:390,height:844});await page.locator('#mapControlsButton').waitFor({state:'visible'});await page.locator('#mapControlsButton').click();await page.locator('#filtersButton').waitFor({state:'visible'});await page.screenshot({path:out+'/mobile-controls.png',fullPage:true});checks.push('existing compact phone tray still opens');
 await page.setViewportSize({width:844,height:390});await page.locator('#mapControlsButton').waitFor({state:'hidden'});await page.locator('#filtersButton').waitFor({state:'visible'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('resizing from phone to wide landscape restores direct controls without horizontal overflow');
 for(const signedIn of [false,true]){
  if(signedIn){await page.request.post(base+'/api/auth/sign-in',{data:{email:'contributor@local.test',password:'haunted-local-only'},headers:{origin:base}});await page.reload();await page.waitForFunction(()=>window.HauntologiesAccount.canContribute());}
  for(const [width,height]of [[1440,900],[390,844],[320,740],[844,390]]){
   await page.setViewportSize({width,height});const boxes=await page.evaluate(()=>{const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};};return{nyc:box('recenterMap'),zoom:box('zoomTools'),footer:box('mapFooter'),participation:document.querySelector('.contribution-navigation').getBoundingClientRect().toJSON()};});
   assert.ok(boxes.zoom.x>=boxes.nyc.right&&Math.abs(boxes.zoom.y-boxes.nyc.y)<2);assert.ok(boxes.footer.right<=width&&boxes.footer.bottom<=height);
   assert.ok(boxes.footer.right<=boxes.participation.x||boxes.footer.bottom<=boxes.participation.y||boxes.footer.y>=boxes.participation.bottom);
   const plus=page.locator('#zoomTools .leaflet-control-zoom-in'),minus=page.locator('#zoomTools .leaflet-control-zoom-out');assert.equal(await plus.isVisible(),true);assert.equal(await minus.isVisible(),true);
   await page.evaluate(()=>map.setZoom(12,{animate:false}));await plus.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>map.getZoom()===13&&!map._animatingZoom);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('leaflet-control-zoom-out')),true);await page.keyboard.press('Enter');await page.waitForFunction(()=>map.getZoom()===12&&!map._animatingZoom);
   await page.screenshot({path:out+'/zoom-dock-'+width+'-'+(signedIn?'account':'public')+'.png',fullPage:true});
  }
 }
 checks.push('zoom controls sit beside NYC, work with Enter/Tab and avoid account-control overlap on desktop, phone and landscape, signed in and out');
 assert.deepEqual(errors,[]);await writeFile(out+'/controls-results.json',JSON.stringify({checks,errors,synthetic_only:true},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();}
