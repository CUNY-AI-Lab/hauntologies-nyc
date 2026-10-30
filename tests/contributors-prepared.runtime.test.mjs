import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { createDemoWorker } from '../deployment/demo-gate.mjs';

test('public directory routes strip identity and cookies; aliases and writes stay closed',async()=>{
 const seen=[];
 const worker=createDemoWorker({fetch(request){seen.push(request);return new Response('public');}});
 for(const route of ['/api/contributors-summary','/api/place-completeness?place=synthetic','/api/public-image?id=watt_00000000-0000-4000-8000-000000000001']){
  const result=await worker.fetch(new Request('https://map.test'+route,{headers:{cookie:'private-session','oai-authenticated-user-id':'private-actor'}}),{},{});
  assert.equal(result.status,200);assert.equal(seen.at(-1).headers.get('cookie'),null);assert.equal(seen.at(-1).headers.get('oai-authenticated-user-id'),null);
  assert.equal((await worker.fetch(new Request('https://map.test'+route,{method:'POST'}),{},{})).status,405);
 }
 for(const route of ['/api/Contributors-summary','/api//contributors-summary','/api/%63ontributors-summary','/api/Public-image','/api//public-image','/api/%70ublic-image'])assert.equal((await worker.fetch(new Request('https://map.test'+route),{},{})).status,401);
 assert.equal(seen.length,3);
});

test('prepared no-bundle Worker serves page, shipped assets and both APIs on synthetic local D1',async t=>{
 const root=path.resolve(import.meta.dirname,'../dist/server'),client=path.resolve(root,'../client');
 const files=(await readdir(root,{recursive:true})).filter(name=>/\.(?:mjs|js)$/.test(name));
 const worker=new Miniflare({modules:['demo-worker.mjs',...files.filter(name=>name!=='demo-worker.mjs')].map(name=>({type:'ESModule',path:path.join(root,name)})),modulesRoot:root,
  compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
  assets:{directory:client,routerConfig:{has_user_worker:true,static_routing:{user_worker:['/api','/api/*']}}},
  outboundService:()=>{throw new Error('No external service is allowed in this synthetic test');}});
 t.after(()=>worker.dispose());
 const db=await worker.getD1Database('DB');
 for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()){
  const source=await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8');let statement='',trigger=false;
  for(const line of source.split('\n')){
   if(line.trim().startsWith('--'))continue;statement+=line+'\n';if(/CREATE TRIGGER/i.test(line))trigger=true;
   if(trigger?/END\s*;/i.test(line):/;\s*$/.test(line)){if(statement.trim())await db.prepare(statement.trim()).run();statement='';trigger=false;}
  }
 }
 const fetch=route=>worker.dispatchFetch('https://map.test'+route);
 const page=await fetch('/contributors');assert.equal(page.status,200);assert.match(await page.text(),/peopleList/);
 for(const asset of ['contributor-page.js','contributor-page.css','place-link.js']){
  const response=await fetch('/'+asset);assert.equal(response.status,200,asset);assert.equal(await response.text(),await readFile(path.join(client,asset),'utf8'));
 }
 const summary=await fetch('/api/contributors-summary');assert.equal(summary.status,200);assert.equal(summary.headers.get('cache-control'),'no-store');
 const data=await summary.json();assert.equal(data.totals.published,0);assert.equal(data.totals.places,209);assert.equal(data.contributors.length,0);
 const detail=await fetch('/api/place-completeness?place='+encodeURIComponent(data.places[0].id)+'&snapshot='+data.snapshot_token);assert.equal(detail.status,200);
 assert.equal((await detail.json()).place.id,data.places[0].id);
 assert.equal((await fetch('/api/place-completeness?place=private_missing')).status,404);
 assert.equal((await fetch('/api/contributor-roster')).status,401);
 const privateImage=await fetch('/api/public-image?id=watt_00000000-0000-4000-8000-000000000001');
 assert.equal(privateImage.status,404);assert.equal(privateImage.headers.get('cache-control'),'no-store');assert.deepEqual(await privateImage.json(),{error:'image_not_public'});
 assert.equal((await fetch('/api/public-image?id=invalid')).status,400);
});
