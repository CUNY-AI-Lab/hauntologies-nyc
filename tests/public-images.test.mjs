import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contributorsHarness,proposal,target} from './fixtures/contributors-harness.mjs';
import {handlePublicImage} from '../server/public-images.mjs';
import {publishedRecords} from '../server/published-edits.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/attachment-images.json',import.meta.url))).png;
async function savedImage(h,rights='CC0 — synthetic fixture'){
 const saved=await h.call('submit',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(proposal())});assert.equal(saved.status,201);
 const form=new FormData();form.set('submission_id',saved.body.submission.id);form.set('expected_revision','1');form.set('idempotency_key',crypto.randomUUID());form.set('metadata_json',JSON.stringify({rights,credit:'Synthetic artist',alt:'Synthetic color sample'}));form.set('image',new Blob([Buffer.from(fixture,'base64')],{type:'image/png'}),'fixture.png');
 const response=await h.service.handle(new Request('https://map.test/api/contributions/attachment',{method:'POST',headers:{'oai-authenticated-user-id':'synthetic_actor_A',origin:'https://map.test','sec-fetch-site':'same-origin'},body:form}));assert.equal(response.status,201);return response.json();
}
const read=(h,id,method='GET')=>handlePublicImage(new Request('https://map.test/api/public-image?id='+id,{method}),h.db);
const publication=image=>({idempotency_key:crypto.randomUUID(),submission_id:image.submission.id,expected_revision:image.submission.revision,moniker:'Night Owl',change_summary:'Publish a synthetic place and selected image',public_image_ids:[image.attachment.attachment_id]});
test('private upload stays private; explicit publication serves only sanitized bytes and retry counts once',async t=>{
 const h=contributorsHarness(t),saved=await savedImage(h),id=saved.attachment.attachment_id;
 assert.equal((await read(h,id)).status,404);const body=publication(saved),published=await h.call('publish',body);assert.equal(published.status,200,JSON.stringify(published.body));
 const again=await h.call('publish',body);assert.equal(again.body.reused,true);assert.deepEqual(again.body.receipt,published.body.receipt);
 const record=(await publishedRecords(h.db))[0];assert.equal(record.images.length,1);assert.equal(record.images[0].credit,'Synthetic artist');assert.ok(!JSON.stringify(record).includes('synthetic_actor_A'));
 const response=await read(h,id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'image/png');const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length<Buffer.from(fixture,'base64').length);assert.ok(!bytes.includes(Buffer.from('eXIf')));
 assert.equal((await read(h,id,'HEAD')).status,200);assert.equal(await (await read(h,id,'HEAD')).text(),'');assert.equal((await read(h,id,'POST')).status,405);
 const revoked=await h.call('revoke',{idempotency_key:crypto.randomUUID(),submission_id:saved.submission.id,expected_revision:published.body.submission.revision});assert.equal(revoked.status,200);assert.equal((await read(h,id)).status,404);assert.equal(h.db.native.prepare('SELECT COUNT(*) AS n FROM contribution_media').get().n,1);
});
test('unknown rights, foreign IDs and omitted publication selection never reveal uploaded bytes',async t=>{
 const h=contributorsHarness(t),saved=await savedImage(h,'unknown'),body=publication(saved),id=saved.attachment.attachment_id;
 const denied=await h.call('publish',body);assert.equal(denied.body.error,'image_rights_required');assert.equal((await read(h,id)).status,404);
 const foreign=await h.call('publish',{...body,idempotency_key:crypto.randomUUID()},'synthetic_actor_B');assert.equal(foreign.status,404);
 const textOnly=await h.call('publish',{...body,idempotency_key:crypto.randomUUID(),public_image_ids:[]});assert.equal(textOnly.status,200);assert.equal((await read(h,id)).status,404);assert.equal((await publishedRecords(h.db))[0].images,undefined);
});
test('Undo withdraws public image access, and corrupt bytes fail closed',async t=>{
 const h=contributorsHarness(t),saved=await savedImage(h),published=await h.call('publish',publication(saved)),id=saved.attachment.attachment_id;
 const resolved=await target(h,published.body.receipt.result.record_id);
 const undone=await h.call('undo',{idempotency_key:crypto.randomUUID(),event_id:published.body.receipt.result.event_id,expected_version:resolved.expected_version,expected_hash:resolved.expected_hash,moniker:'Night Owl',change_summary:'Undo synthetic image publication'});assert.equal(undone.status,200);assert.equal((await read(h,id)).status,404);
 const broken={prepare:()=>({bind:()=>({first:async()=>({metadata_json:'{"rights":"CC0"}',image_blob:new Uint8Array([1]),byte_length:1,sha256:'0'.repeat(64),media_type:'image/png'})})})};
 assert.equal((await handlePublicImage(new Request('https://map.test/api/public-image?id='+id),broken)).status,503);
});
