import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDemoWorker} from '../deployment/demo-gate.mjs';
function setup(){const seen=[];const worker=createDemoWorker({fetch(request,env,ctx){seen.push({request,env,ctx});return new Response('map');}});return {seen,worker};}
test('all contribution and review requests are blocked before the old handler',async()=>{const {worker,seen}=setup();for(const path of ['/api','/api/records','/api/review','/api/contributions/dashboard','/api/contributions/submit','/api/ingest/confirm'])for(const method of ['GET','POST','HEAD']){const r=await worker.fetch(new Request('https://example.test'+path,{method,headers:{'oai-authenticated-user-id':'forged'}}),{},{});assert.equal(r.status,401,path);assert.equal(r.headers.get('Cache-Control'),'no-store');}assert.equal(seen.length,0);});
test('encoded and repeated path separators cannot bypass the API lock',async()=>{const {worker,seen}=setup();for(const path of ['/%61pi/records','/api%2freview','//api/review','/%2561pi/review','/API/review']){const r=await worker.fetch(new Request('https://example.test'+path),{},{});assert.equal(r.status,401,path);}assert.equal(seen.length,0);});
test('malformed URL encoding returns400 without calling the app',async()=>{const {worker,seen}=setup();assert.equal((await worker.fetch(new Request('https://example.test/%zz'),{},{})).status,400);assert.equal(seen.length,0);});
test('non-read methods are blocked outside APIs as well',async()=>{const {worker,seen}=setup();for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await worker.fetch(new Request('https://example.test/',{method}),{},{})).status,401);assert.equal(seen.length,0);});
test('map GET retains the handler, environment and context but removes spoofed hosting identity',async()=>{const {worker,seen}=setup();const env={DB:{}},ctx={};const input=new Request('https://example.test/',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'fake@example.test','accept':'text/html'}});assert.equal(await (await worker.fetch(input,env,ctx)).text(),'map');assert.equal(seen[0].env,env);assert.equal(seen[0].ctx,ctx);assert.equal(seen[0].request.headers.get('oai-authenticated-user-id'),null);assert.equal(seen[0].request.headers.get('oai-authenticated-user-email'),null);assert.equal(seen[0].request.headers.get('accept'),'text/html');assert.equal(input.headers.get('oai-authenticated-user-id'),'forged');});
test('staging configuration has explicit D1 and disables all external preview/production URLs',()=>{const c=JSON.parse(fs.readFileSync(new URL('../dist/server/wrangler.demo.json',import.meta.url)));assert.equal(c.name,'hauntologies-nyc');assert.equal(c.account_id,'452c33847cf5cb1e46f391fca32fd1b5');assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert.equal(c.vars.CAIL_ENABLED,'false');assert.deepEqual(c.assets.run_worker_first,['/api','/api/*','/auth','/auth/*','/data/source-inventory.json']);assert.deepEqual(c.d1_databases,[{binding:'DB',database_name:'hauntologies-nyc',database_id:'df7f1e92-e339-4e25-ac30-989dd68d8dfc'}]);});

test('the original source archive has no public route',async()=>{const {worker,seen}=setup();assert.equal((await worker.fetch(new Request('https://example.test/data/source-inventory.json'),{},{})).status,404);assert.equal(seen.length,0);});

test('registration exception cannot open private submission or review APIs',async()=>{
 const registrations=[], app=[];
 const worker=createDemoWorker({fetch:r=>{app.push(r.url);return new Response('map')}},async(r,env)=>{registrations.push({url:r.url,env});return Response.json({ok:true,receipt_id:'synthetic'});});
 const env={DB:{}};
 const result=await worker.fetch(new Request('https://example.test/api/register',{method:'POST'}),env,{});
 assert.equal(result.status,200);assert.equal(registrations.length,1);assert.equal(registrations[0].env,env);
 for(const path of ['/api/register/attendees','/api/registrations','/api/contributions/dashboard','/api/contributions/submit','/api/review'])assert.equal((await worker.fetch(new Request('https://example.test'+path),env,{})).status,401);
 assert.equal(registrations.length,1);assert.deepEqual(app,[]);
});

test('private image downloads retain cache protection and verified identity at the gate',async()=>{
 let forwarded;
 const worker=createDemoWorker({fetch:r=>{forwarded=r;return new Response(new Uint8Array([1,2,3]),{headers:{'Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="synthetic.png"','Content-Type':'image/png','X-Content-Type-Options':'nosniff'}});}},undefined,async()=> 'synthetic_verified_actor');
 const response=await worker.fetch(new Request('https://example.test/api/contributions/attachment?id=synthetic',{headers:{'oai-authenticated-user-id':'forged','Cookie':'private-session=opaque'}}),{},{});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 assert.match(response.headers.get('Content-Disposition'),/^attachment;/);
 assert.equal(forwarded.headers.get('oai-authenticated-user-id'),'synthetic_verified_actor');
 assert.equal(forwarded.headers.get('Cookie'),null);
 const blocked=setup();
 assert.equal((await blocked.worker.fetch(new Request('https://example.test/api/contributions/attachment?id=synthetic',{headers:{'oai-authenticated-user-id':'forged'}}),{},{})).status,401);
 assert.equal(blocked.seen.length,0);
});
