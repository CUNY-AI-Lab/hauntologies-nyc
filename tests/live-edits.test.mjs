import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorkflowStore } from '../server/workflow-store.mjs';
import { createWorkflowService } from '../server/workflow-service.mjs';
import { CHECKS } from '../server/workflow-core.mjs';
import { RecordEditModel as Model } from '../server/record-update.mjs';
import { publishedRecords, publishedEdits } from '../server/published-edits.mjs';

// Live edits on real SQLite with D1's single-writer batch semantics. Synthetic records and actors only.
const boundaries = JSON.parse(readFileSync(new URL('../public/data/nyc-borough-boundaries.geojson', import.meta.url)));
const place = { id: 'synthetic_place', title: 'Original title', description: 'Original description.', category: 'reported_haunting', borough: 'Manhattan',
  location_text: 'Original address', latitude: 40.72, longitude: -74, geo_status: 'approximate', uncertainty_m: null, built: 'c. 1890',
  image: { url: 'https://example.org/i.jpg', creator: 'Original credit' }, sources: [{ url: 'https://example.org/one', title: 'First source' }] };

function sqliteD1() {
  const native = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) native.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  const prepare = (sql, params = []) => ({ bind(...values) { return prepare(sql, values); },
    async first(column) { const row = native.prepare(sql).get(...params) || null; return column && row ? row[column] : row; },
    async all() { return { results: native.prepare(sql).all(...params) }; },
    async run() { return { success: true, meta: { changes: Number(native.prepare(sql).run(...params).changes) } }; } });
  // D1 applies one batch at a time, each as a transaction; concurrent callers queue.
  let tail = Promise.resolve();
  return { native, prepare, batch(statements) {
    const operation = tail.then(async () => { native.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); native.exec('COMMIT'); return out; } catch (error) { native.exec('ROLLBACK'); throw error; } });
    tail = operation.catch(() => {}); return operation; } };
}
function harness(t, authorization = { reviewers: ['reviewer', 'reviewer2'], publishers: ['publisher'] }) {
  const db = sqliteD1(); t.after(() => db.native.close());
  const store=createWorkflowStore(db),service = createWorkflowService({ store, staticRecords: [place], taskSeeds: { tasks: [] }, geography: { boundaries }, authorization });
  return { db, store, service };
}
async function call(h, path, body, actor = 'author') {
  const response = await h.service.handle(new Request('https://map.test/api/contributions/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'oai-authenticated-user-id': actor, origin: 'https://map.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: response.status, body: await response.json() };
}
const ok = (response, expected) => { assert.equal(response.status, expected, JSON.stringify(response.body)); return response.body; };
const key = () => crypto.randomUUID();
const count = (h, table) => h.db.native.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
const target = async h => ok(await call(h, 'target?id=' + place.id), 200).target;
function edit(resolved, updates) {
  const before = Model.snapshot(resolved.record), after = { ...before, ...updates }, message = 'Synthetic correction.';
  return { schema_version: '1.0', type: 'record_update', task_ids: [], title: 'Record update', summary: message, public_credit: { consent: false, label: '' }, sources: [], attachments: [],
    targets: [{ record_id: resolved.record_id, expected_version: resolved.expected_version, expected_hash: resolved.expected_hash }], payload: { change_message: message, changes: Model.changes(before, after) } };
}
const submit = async (h, value, actor = 'author') => ok(await call(h, 'submit', { idempotency_key: key(), submission_json: JSON.stringify(value) }, actor), 201).submission;
const approve = (h, s, actor = 'reviewer') => call(h, 'review', { idempotency_key: key(), submission_id: s.id, expected_revision: s.revision, payload_hash: s.payload_hash, diff_hash: s.diff_hash, checks: Object.fromEntries(CHECKS.map(k => [k, 'pass'])), rationale: 'Synthetic independent review.' }, actor);
const apply = (h, s, actor = 'publisher') => call(h, 'apply', { idempotency_key: key(), submission_id: s.id, expected_revision: s.revision, approval_hash: s.approval.approval_hash }, actor);
const verify = (h, job, actor = 'publisher') => call(h, 'verify', { idempotency_key: key(), job_id: job.id, map_list_check: { status: 'pass', evidence: 'Synthetic check of the map point and list entry.' } }, actor);
async function publish(h, value, author = 'author') {
  const s = await submit(h, value, author), approved = ok(await approve(h, s), 200).submission, staged = ok(await apply(h, approved), 201);
  return { s, job: staged.job, verified: await verify(h, staged.job) };
}

test('a reviewed edit to a built-in place goes live only after verify, published whole', async t => {
  const h = harness(t), resolved = await target(h);
  assert.equal(resolved.origin, 'static_inventory');
  const s = await submit(h, edit(resolved, { title: 'Edited title', built: 'c. 1891' }));
  assert.equal(s.application.applicable, true);
  ok(await call(h, 'review', { idempotency_key: key(), submission_id: s.id, expected_revision: 1, payload_hash: s.payload_hash, diff_hash: s.diff_hash, checks: Object.fromEntries(CHECKS.map(k => [k, 'pass'])), rationale: 'x' }, 'author'), 403);
  const approved = ok(await approve(h, s), 200).submission;
  const staged = ok(await apply(h, approved), 201);
  assert.deepEqual(await publishedRecords(h.db), [], 'nothing public before verify');
  ok(await verify(h, staged.job), 200);
  const [record] = await publishedRecords(h.db);
  assert.equal(record.id, place.id);
  assert.equal(record.title, 'Edited title');
  assert.equal(record.built, 'c. 1891');
  for (const kept of ['description', 'location_text', 'latitude', 'longitude', 'category']) assert.deepEqual(record[kept], place[kept], 'kept ' + kept);
  assert.deepEqual(record.image, place.image);
  assert.deepEqual(record.sources, place.sources);
  assert.equal((await publishedEdits(h.db))[0].targets[0].title, 'Edited title');
  const next = await target(h);
  assert.equal(next.origin, 'hosted');
  assert.equal(next.record.title, 'Edited title');
});

test('an edit prepared against an older version cannot overwrite a newer published edit', async t => {
  const h = harness(t), resolved = await target(h);
  const first = await submit(h, edit(resolved, { title: 'First edit' }), 'author');
  const second = await submit(h, edit(resolved, { title: 'Second edit' }), 'author2');
  const a1 = ok(await approve(h, first), 200).submission;
  ok(await verify(h, ok(await apply(h, a1), 201).job), 200);
  // The stale edit is refused at review and at apply; the published value stands.
  const stale = await approve(h, second);
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal((await publishedRecords(h.db))[0].title, 'First edit');
  // Reloading and proposing again against the new version succeeds.
  const fresh = await target(h);
  const { verified } = await publish(h, edit(fresh, { title: 'Second edit, rebased' }), 'author2');
  ok(verified, 200);
  assert.equal((await publishedRecords(h.db))[0].title, 'Second edit, rebased');
});

test('two approved edits racing to publish: exactly one lands, the other is refused', async t => {
  const h = harness(t), resolved = await target(h);
  const [x, y] = await Promise.all([submit(h, edit(resolved, { title: 'Race X' }), 'author'), submit(h, edit(resolved, { title: 'Race Y' }), 'author2')]);
  const [ax, ay] = await Promise.all([approve(h, x), approve(h, y, 'reviewer2')]);
  const approvedX = ok(ax, 200).submission, approvedY = ok(ay, 200).submission;
  const [sx, sy] = await Promise.all([apply(h, approvedX), apply(h, approvedY)]);
  const staged = [sx, sy].filter(r => r.status === 201);
  assert.ok(staged.length >= 1, 'at least one staged');
  const results = await Promise.all(staged.map(r => verify(h, r.body.job)));
  const landed = results.filter(r => r.status === 200 && r.body.job?.status === 'verified');
  assert.equal(landed.length, 1, JSON.stringify(results.map(r => [r.status, r.body.job?.status || r.body.error])));
  assert.equal(count(h, 'approved_records'), 1);
  assert.ok(['Race X', 'Race Y'].includes((await publishedRecords(h.db))[0].title));
});

test('rollback restores the built-in place, and it can be edited again afterwards', async t => {
  const h = harness(t), resolved = await target(h);
  const { job, verified } = await publish(h, edit(resolved, { title: 'Edited then rolled back' }));
  ok(verified, 200);
  ok(await call(h, 'rollback', { idempotency_key: key(), job_id: job.id, rationale: 'Synthetic rollback.' }, 'publisher'), 200);
  assert.deepEqual(await publishedRecords(h.db), []);
  const again = await target(h);
  assert.equal(again.origin, 'static_inventory');
  assert.equal(again.record.title, 'Original title');
  assert.equal(again.expected_version > 1, true);
  const second = await publish(h, edit(again, { title: 'Edited after rollback' }));
  ok(second.verified, 200);
  assert.equal((await publishedRecords(h.db))[0].title, 'Edited after rollback');
});

test('successive edits build on the published version', async t => {
  const h = harness(t);
  ok((await publish(h, edit(await target(h), { title: 'One' }))).verified, 200);
  const v2 = await target(h);
  ok((await publish(h, edit(v2, { description: 'Two' }), 'author2')).verified, 200);
  const [record] = await publishedRecords(h.db);
  assert.equal(record.title, 'One');
  assert.equal(record.description, 'Two');
  assert.equal((await target(h)).expected_version, v2.expected_version + 1);
});

test('admin authors cannot review or verify their own edit', async t => {
  const h = harness(t, { reviewers: ['admin', 'reviewer'], publishers: ['admin','reviewer'], stewards: [], admins: ['admin'] });
  const s = await submit(h, edit(await target(h), { title: 'Admin edit' }), 'admin');
  const denied=await approve(h,s,'admin');assert.equal(denied.status,403);assert.equal(denied.body.error,'self_approval_forbidden');
  assert.equal(ok(await call(h,'dashboard',undefined,'admin'),200).capabilities.can_self_approve,false);
  const approved=ok(await approve(h,s,'reviewer'),200).submission;
  const staged=ok(await apply(h,approved,'reviewer'),201);
  const ownVerify=await verify(h,staged.job,'admin');assert.equal(ownVerify.status,403);assert.equal(ownVerify.body.error,'self_verification_forbidden');
  assert.deepEqual(await publishedRecords(h.db),[]);
  ok(await verify(h,staged.job,'reviewer'),200);
});

test('a reviewer who is not an admin still cannot approve their own work', async t => {
  const h = harness(t, { reviewers: ['admin', 'reviewer'], publishers: ['admin'], stewards: [], admins: ['admin'] });
  const s = await submit(h, edit(await target(h), { title: 'Reviewer own edit' }), 'reviewer');
  const self = await approve(h, s, 'reviewer');
  assert.equal(self.status, 403);
  assert.equal(self.body.error, 'self_approval_forbidden');
  assert.equal(ok(await call(h, 'dashboard', undefined, 'reviewer'), 200).capabilities.can_self_approve, false);
  // An independent approval by someone else (here the admin) is not marked as self-approval.
  ok(await approve(h, s, 'admin'), 200);
  const binding = JSON.parse(h.db.native.prepare('SELECT binding_json FROM workflow_approvals WHERE submission_id=?').get(s.id).binding_json);
  assert.equal(binding.admin_self_approval, undefined);
});

// Regressions from the independent review.
test('an edit approved before edits could be applied is refused at apply', async t => {
  const h = harness(t), s = await submit(h, edit(await target(h), { title: 'Approved under the old rule' }));
  const approved = ok(await approve(h, s), 200).submission;
  h.db.native.prepare("UPDATE workflow_approvals SET binding_json=json_remove(binding_json,'$.application_applicable') WHERE submission_id=?").run(s.id);
  const refused = await apply(h, approved);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'approval_predates_application');
  assert.deepEqual(await publishedRecords(h.db), []);
});

test('stacked edits roll back newest first, an older release is refused, and the place stays editable', async t => {
  const h = harness(t);
  const first = await publish(h, edit(await target(h), { title: 'Edit one' }));
  const second = await publish(h, edit(await target(h), { title: 'Edit two' }), 'author2');
  const rollback = job => call(h, 'rollback', { idempotency_key: key(), job_id: job.id, rationale: 'Synthetic rollback.' }, 'publisher');
  const early = await rollback(first.job);
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'release_superseded');
  assert.equal((await publishedRecords(h.db))[0].title, 'Edit two', 'refusal changed nothing');
  ok(await rollback(second.job), 200);
  assert.equal((await publishedRecords(h.db))[0].title, 'Edit one');
  ok(await rollback(first.job), 200);
  assert.deepEqual(await publishedRecords(h.db), []);
  assert.equal(count(h, 'approved_records'), 0);
  ok((await publish(h, edit(await target(h), { title: 'After unwinding' }))).verified, 200);
  assert.equal((await publishedRecords(h.db))[0].title, 'After unwinding');
});

test('after a rollback, a changed built-in record can still be edited', async t => {
  const h = harness(t);
  const { job } = await publish(h, edit(await target(h), { title: 'Edited' }));
  ok(await call(h, 'rollback', { idempotency_key: key(), job_id: job.id, rationale: 'Synthetic rollback.' }, 'publisher'), 200);
  // A later deploy changes the built-in record; the same database carries on.
  const changed = { ...place, built: 'c. 1892' };
  const redeployed = { db: h.db, service: createWorkflowService({ store: createWorkflowStore(h.db), staticRecords: [changed], taskSeeds: { tasks: [] }, geography: { boundaries }, authorization: { reviewers: ['reviewer'], publishers: ['publisher'] } }) };
  const resolved = await target(redeployed);
  assert.equal(resolved.record.built, 'c. 1892');
  ok((await publish(redeployed, edit(resolved, { title: 'Edited after redeploy' }))).verified, 200);
  assert.equal((await publishedRecords(h.db))[0].title, 'Edited after redeploy');
});

test('published edits carry what the card shows and no editor text', async t => {
  const h = harness(t);
  ok((await publish(h, edit(await target(h), { description: 'A visible new description.' }))).verified, 200);
  const [record] = await publishedRecords(h.db);
  assert.equal(record.description, 'A visible new description.');
  assert.equal(record.canonical_reviewed, true, 'reviewed card text shows the edited description');
  const stored = h.db.native.prepare('SELECT owner_id, derived_json FROM approved_records WHERE id=?').get(place.id);
  assert.equal(stored.owner_id, 'inventory');
  assert.equal(JSON.parse(stored.derived_json).edited_record.submission_json, undefined);
});

test('the map card shows an edited description', async t => {
  const vm = await import('node:vm');
  const ctx = vm.createContext({ window: {}, structuredClone, URL });
  for (const file of ['atlas-model.js', 'place-summary.js']) vm.runInContext(readFileSync(new URL('../public/' + file, import.meta.url), 'utf8'), ctx);
  const card = record => ctx.window.PlaceSummary.view(record).description;
  const h = harness(t);
  const { description, ...bare } = place, untouched = { ...bare, canonical_reviewed: true };
  ok((await publish(h, edit(await target(h), { description: 'Shown on the card.' }))).verified, 200);
  assert.equal(card((await publishedRecords(h.db))[0]), 'Shown on the card.');
  assert.equal(card(untouched), card(bare), 'a place without a description keeps its label');
});

test('approved work can be sent back or withheld, but not while a release is staged', async t => {
  const h = harness(t);
  const triage = (s, action, actor = 'reviewer') => call(h, 'triage', { idempotency_key: key(), submission_id: s.id, expected_revision: s.revision, action, rationale: 'Synthetic triage.' }, actor);
  const a = ok(await approve(h, await submit(h, edit(await target(h), { title: 'Send me back' }))), 200).submission;
  assert.equal(ok(await triage(a, 'request_information'), 200).submission.status, 'changes_requested');
  const b = ok(await approve(h, await submit(h, edit(await target(h), { title: 'Withdraw me' }), 'author2')), 200).submission;
  assert.equal(ok(await triage(b, 'withhold', 'author2'), 200).submission.status, 'withheld');
  const c = ok(await approve(h, await submit(h, edit(await target(h), { title: 'Staged' }), 'author3')), 200).submission;
  ok(await apply(h, c), 201);
  assert.equal((await triage(c, 'request_information')).status, 409);
});

test('legacy recorded admin self-approval cannot authorize a new publication', async t => {
  const h = harness(t, { reviewers: ['admin', 'reviewer'], publishers: ['admin'], admins: ['admin'] });
  const s = await submit(h, edit(await target(h), { title: 'Legacy self approval' }), 'admin');
  const approved=ok(await approve(h,s,'reviewer'),200).submission;
  h.db.native.prepare('UPDATE workflow_approvals SET reviewer_id=? WHERE submission_id=?').run('admin',s.id);
  const result=await apply(h,approved,'admin');assert.equal(result.status,409);assert.equal(result.body.error,'approval_required');
});

// New places: independent review and explicit verification publish a map entry.
const proposal = (payload = {}, extra = {}) => ({ schema_version: '1.0', type: 'open_proposal', task_ids: [], title: 'Thomas Shoe Factory', summary: 'Footsteps on the upper floor.',
  public_credit: { consent: true, label: 'A. Contributor' }, sources: [], attachments: [], targets: [],
  payload: { explanation: 'Footsteps on the upper floor.', sources_text: 'Brooklyn Daily Eagle, 1911.', geometry: { type: 'Point', coordinates: [-73.9575, 40.7079] }, ...payload }, ...extra });

test('an admin approves a new place and it is on the map at its point', async t => {
  const h = harness(t, { reviewers: ['admin'], publishers: ['admin'], stewards: [], admins: ['admin'] });
  const s = await submit(h, proposal(), 'author');
  assert.equal(s.application.applicable, true);
  const approved = ok(await approve(h, s, 'admin'), 200).submission;
  ok(await verify(h, ok(await apply(h, approved, 'admin'), 201).job, 'admin'), 200);
  const [place] = await publishedRecords(h.db);
  assert.equal(place.title, 'Thomas Shoe Factory');
  assert.equal(place.description, 'Footsteps on the upper floor.');
  assert.deepEqual([place.latitude, place.longitude], [40.7079, -73.9575]);
  assert.equal(place.borough, 'Brooklyn');
  assert.equal((await publishedEdits(h.db))[0].credit, 'A. Contributor', 'consented credit shows in Published edits');
  assert.equal(ok(await call(h, 'submission?id=' + s.id, undefined, 'admin'), 200).submission.status, 'merged');
});

test('a new place without a point is not published by approval; a note on an existing place publishes as that place with the note appended', async t => {
  const h = harness(t);
  assert.equal((await submit(h, proposal({ geometry: null }))).application.applicable, false);
  const attached = proposal({ geometry: null, attributes: [{ name: 'Floor', value: 'Upper' }] }, { targets: [{ record_id: place.id, expected_version: 1, expected_hash: (await target(h)).expected_hash }] });
  const { s, verified } = await publish(h, attached, 'author2');
  assert.equal(s.application.applicable, true);
  assert.equal(s.application.operations[0].operation, 'update_record');
  ok(verified, 200);
  const [record] = await publishedRecords(h.db);
  assert.equal(record.id, place.id);
  assert.equal(record.title, place.title, 'the place keeps its own title');
  assert.equal(record.description, 'Original description.\n\nContributor note: Footsteps on the upper floor.\nFloor: Upper\nSources: Brooklyn Daily Eagle, 1911.');
  for (const kept of ['location_text', 'latitude', 'longitude', 'category']) assert.deepEqual(record[kept], place[kept], 'kept ' + kept);
  assert.deepEqual(record.sources, place.sources);
  assert.equal((await publishedEdits(h.db))[0].credit, 'A. Contributor');
  // A second note lands after the first; an uncredited one names nobody.
  const again = proposal({ geometry: null, sources_text: null, explanation: 'A later memory.' }, { summary: 'A later memory.', public_credit: { consent: false, label: '' }, targets: [{ record_id: place.id, expected_version: 2, expected_hash: (await target(h)).expected_hash }] });
  ok((await publish(h, again, 'author3')).verified, 200);
  assert.equal((await publishedRecords(h.db))[0].description, record.description + '\n\nContributor note: A later memory.');
  assert.equal(Object.hasOwn((await publishedEdits(h.db))[0], 'credit'), false);
});

test('a new place approved before approval meant publication cannot be published with that approval', async t => {
  const h = harness(t);
  const s = await submit(h, proposal());
  const approved = ok(await approve(h, s), 200).submission;
  h.db.native.prepare("UPDATE workflow_approvals SET binding_json=json_remove(binding_json,'$.application_applicable') WHERE submission_id=?").run(s.id);
  const refused = await apply(h, approved);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'approval_predates_application');
});

test('record credits retain later consented contributors and exclude uncredited, hidden and rolled-back releases', async t => {
  const h=harness(t), first=edit(await target(h),{title:'First credited edit'});
  first.public_credit={consent:true,label:'Synthetic Alice'};
  ok((await publish(h,first,'map_00000000-0000-4000-8000-000000000001')).verified,200);
  let resolved=ok(await call(h,'target?id='+place.id),200).target;
  const second=edit(resolved,{title:'Second credited edit'});second.public_credit={consent:true,label:'Synthetic Bob'};
  ok((await publish(h,second,'map_00000000-0000-4000-8000-000000000002')).verified,200);
  assert.deepEqual((await publishedRecords(h.db))[0].contributors,['Synthetic Alice','Synthetic Bob']);
  resolved=ok(await call(h,'target?id='+place.id),200).target;
  ok((await publish(h,edit(resolved,{title:'No credit edit'}),'uncredited-author')).verified,200);
  assert.deepEqual((await publishedRecords(h.db))[0].contributors,['Synthetic Alice','Synthetic Bob']);
  const user='00000000-0000-4000-8000-000000000002';
  h.db.native.prepare('INSERT INTO hny_auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(user,'Private account name','synthetic@example.test',1,'2026-10-25','2026-10-25');
  h.db.native.prepare('INSERT INTO contributor_roster_hidden VALUES(?,?)').run(user,'2026-10-25');
  assert.deepEqual((await publishedRecords(h.db))[0].contributors,['Synthetic Alice']);
  resolved=ok(await call(h,'target?id='+place.id),200).target;
  const next=edit(resolved,{title:'Rolled back credit'});next.public_credit={consent:true,label:'Synthetic Carol'};
  const release=await publish(h,next,'carol');ok(release.verified,200);
  assert.deepEqual((await publishedRecords(h.db))[0].contributors,['Synthetic Alice','Synthetic Carol']);
  ok(await call(h,'rollback',{idempotency_key:key(),job_id:release.job.id,rationale:'Synthetic rollback'} ,'publisher'),200);
  assert.deepEqual((await publishedRecords(h.db))[0].contributors,['Synthetic Alice']);
});

test('open peers keep typed public record edits and safe staged projections after the private snapshot repair',async t=>{
 const A='map_00000000-0000-4000-8000-000000000001',B='map_00000000-0000-4000-8000-000000000002';
 const h=harness(t,{everyone:true,reviewers:[],publishers:[]});
 async function release(value,author,reviewer){
  const s=await submit(h,value,author),approved=ok(await approve(h,s,reviewer),200).submission,staged=ok(await apply(h,approved,reviewer),201);
  const target=staged.job.manifest.targets[0];assert.equal(Object.hasOwn(target,'after'),false);assert.equal(target.after_record.id,place.id);
  ok(await verify(h,staged.job,reviewer),200);
 }
 await release(edit(await target(h),{title:'Peer first edit'}),A,B);
 const resolved=ok(await call(h,'target?id='+place.id,undefined,B),200).target;
 await release(edit(resolved,{title:'Peer later edit'}),B,A);
 assert.equal((await publishedRecords(h.db))[0].title,'Peer later edit');
});


test('published notes preserve exact text and respect later public-credit opt-outs',async t=>{
 const h=harness(t),user='00000000-0000-4000-8000-000000000019',actor='map_'+user;
 const explanation='  Original note with spacing.\nSecond line.  ',sources='  Original citation  ';
 const value=proposal({geometry:null,explanation,sources_text:sources,attributes:[{name:' Original fact ',value:' Original value '}]},{summary:explanation,sources:[{citation:'  Exact extra citation  ',url:'https://example.test/note-source'}],public_credit:{consent:true,label:'Synthetic Note Author'},targets:[{record_id:place.id,expected_version:1,expected_hash:(await target(h)).expected_hash}]});
 ok((await publish(h,value,actor)).verified,200);
 const record=(await publishedRecords(h.db))[0];
 assert.equal(record.description,place.description+'\n\nContributor note: '+explanation+'\n Original fact :  Original value '+'\nSources: '+sources);
 assert.deepEqual(record.contributors,['Synthetic Note Author']);
 assert.deepEqual(record.sources,[...place.sources,...value.sources]);
 assert.equal(record.description.includes('Synthetic Note Author'),false,'credit must remain suppressible');
 h.db.native.prepare('INSERT INTO hny_auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(user,'Private name','synthetic-note@example.test',1,'2026-10-25','2026-10-25');
 h.db.native.prepare('INSERT INTO contributor_roster_hidden VALUES(?,?)').run(user,'2026-10-25');
 assert.deepEqual((await publishedRecords(h.db))[0].contributors||[],[]);
 assert.equal((await publishedRecords(h.db))[0].description,record.description);
});

const lifecycleBody = s => ({idempotency_key:key(),submission_id:s.id,expected_revision:s.revision});
test('owner revokes a published edit before deleting; public feeds restore the original and private content remains until deletion',async t=>{
 const h=harness(t),value=edit(await target(h),{title:'Private after revocation'});value.public_credit={consent:true,label:'Synthetic Author'};
 const {s,job,verified}=await publish(h,value);ok(verified,200);
 const body=lifecycleBody(s);
 ok(await call(h,'delete',lifecycleBody(s)),409);
 for(const actor of ['other','reviewer','publisher'])ok(await call(h,'revoke',body,actor),404);
 const removed=ok(await call(h,'revoke',body),200);assert.equal(removed.submission.status,'revoked');
 assert.equal(ok(await call(h,'revoke',body),200).reused,true);
 ok(await call(h,'revoke',lifecycleBody(s)),409);
 assert.deepEqual(await publishedRecords(h.db),[]);assert.deepEqual(await publishedEdits(h.db),[]);
 assert.equal((await target(h)).record.title,place.title);
 const {contributorCredits}=await import('../server/published-edits.mjs');assert.deepEqual(await contributorCredits(h.db),{contributors:[],total:0});
 assert.equal(ok(await call(h,'submission?id='+s.id),200).submission.raw_json,JSON.stringify(value));
 for(const actor of ['other','reviewer','publisher']){ok(await call(h,'submission?id='+s.id,undefined,actor),404);ok(await call(h,'delete',lifecycleBody(s),actor),404);}
 ok(await call(h,'revise',{...lifecycleBody(s),submission_json:JSON.stringify(value)}),409);
 ok(await call(h,'rollback',{idempotency_key:key(),job_id:job.id,rationale:'Cannot revive revoked history'},'publisher'),404);
 const items=ok(await call(h,'edits'),200).items;assert.equal(items[0].can_revoke,false);assert.equal(items[0].can_delete,true);
 const deletion=lifecycleBody(s);ok(await call(h,'delete',deletion),200);assert.equal(ok(await call(h,'delete',deletion),200).reused,true);
 ok(await call(h,'submission?id='+s.id),404);
 for(const table of ['workflow_submissions','workflow_revisions','workflow_events','workflow_approvals','workflow_jobs','contribution_media'])assert.equal(count(h,table),0,table);
 assert.equal(count(h,'workflow_targets'),1,'version tombstone survives');
 ok(await call(h,'revoke',body),200); // old receipt cannot resurrect deleted content
 assert.equal(count(h,'workflow_submissions'),0);
});

test('revocation preserves another contributor’s prior release and its sources',async t=>{
 const h=harness(t),first=await publish(h,edit(await target(h),{title:'Earlier contributor'}),'earlier');ok(first.verified,200);
 const before=await publishedRecords(h.db),second=await publish(h,edit(await target(h),{title:'Later contribution'}));ok(second.verified,200);
 ok(await call(h,'revoke',lifecycleBody(second.s)),200);
 assert.deepEqual(await publishedRecords(h.db),before);
 ok(await call(h,'delete',lifecycleBody(second.s)),200);
 assert.deepEqual(await publishedRecords(h.db),before);
});

test('dependent releases block revocation; historical dependencies block deletion without destroying shared work',async t=>{
 const h=harness(t),first=await publish(h,edit(await target(h),{title:'Earlier own text'}));ok(first.verified,200);
 const second=await publish(h,edit(await target(h),{description:'Someone else added this'}),'other');ok(second.verified,200);
 const before=await publishedRecords(h.db);
 assert.equal(ok(await call(h,'revoke',lifecycleBody(first.s)),409).error,'revocation_dependency_conflict');
 assert.deepEqual(await publishedRecords(h.db),before);
 ok(await call(h,'revoke',lifecycleBody(second.s),'other'),200);
 ok(await call(h,'revoke',lifecycleBody(first.s)),200);
 assert.equal(ok(await call(h,'delete',lifecycleBody(first.s)),409).error,'deletion_dependency_conflict');
 assert.equal((await h.store.getSubmission(first.s.id)).review_state,'revoked');
 ok(await call(h,'delete',lifecycleBody(second.s),'other'),200);
 ok(await call(h,'delete',lifecycleBody(first.s)),200);
});

test('a staged dependent edit blocks revocation and a stale version cannot revoke',async t=>{
 const h=harness(t),first=await publish(h,edit(await target(h),{title:'Current'}));ok(first.verified,200);
 const next=await submit(h,edit(await target(h),{title:'Staged dependent'}),'other'),approved=ok(await approve(h,next),200).submission;
 ok(await apply(h,approved),201);
 ok(await call(h,'revoke',{...lifecycleBody(first.s),expected_revision:99}),409);
 assert.equal(ok(await call(h,'revoke',lifecycleBody(first.s)),409).error,'revocation_dependency_conflict');
 assert.equal((await publishedRecords(h.db))[0].title,'Current');
});

test('revocation checks dependencies again at the atomic commit boundary',async t=>{
 const h=harness(t),first=await publish(h,edit(await target(h),{title:'Before race'}));ok(first.verified,200);
 const original=h.store.revokeSubmission;h.store.revokeSubmission=async(...args)=>{
  const next=await publish(h,edit(await target(h),{title:'Concurrent contributor'}),'other');ok(next.verified,200);
  return original(...args);
 };
 ok(await call(h,'revoke',lifecycleBody(first.s)),409);
 assert.equal((await publishedRecords(h.db))[0].title,'Concurrent contributor');
 assert.equal((await h.store.getSubmission(first.s.id)).review_state,'merged');
});

test('all live revisions of one contribution are unwound atomically without reviving its earlier text',async t=>{
 const h=harness(t),first=await publish(h,edit(await target(h),{title:'First revision'}));ok(first.verified,200);
 const revised=ok(await call(h,'revise',{...lifecycleBody(first.s),submission_json:JSON.stringify(edit(await target(h),{title:'Second revision'}))}),200).submission;
 const queued=ok(await call(h,'triage',{...lifecycleBody(revised),action:'ready_for_review',rationale:'Synthetic revision.'},'reviewer'),200).submission;
 const approved=ok(await approve(h,queued),200).submission,job=ok(await apply(h,approved),201).job;ok(await verify(h,job),200);
 ok(await call(h,'revoke',lifecycleBody(revised)),200);
 assert.deepEqual(await publishedRecords(h.db),[]);assert.equal((await target(h)).record.title,place.title);
 assert.deepEqual((await h.store.jobsForSubmission(first.s.id)).map(j=>j.status),['revoked','revoked']);
 ok(await call(h,'delete',lifecycleBody(revised)),200);
});

test('a separate related claim prevents removing the new place it depends on',async t=>{
 const h=harness(t),e={schema_version:'1.0',type:'open_proposal',task_ids:[],title:'New source place',summary:'Synthetic source place.',public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{explanation:'Synthetic source place.',geometry:{type:'Point',coordinates:[-74,40.72]}}};
 const first=await publish(h,e);ok(first.verified,200);
 const record=JSON.parse(first.job.manifest.targets[0].after.raw_json),bundle=record.metadata.canonical_bundle,oldId=bundle.Entries[0].entry_id;
 const linked=JSON.parse(JSON.stringify(bundle).replaceAll(oldId,'HNY-LINKED'));
 linked.Entries[0].related_entry_id=oldId;
 const check=ok(await call(h,'preview',{submission_json:JSON.stringify({...e,type:'entry_bundle',title:'Related claim',payload:linked})},'reviewer2'),200);assert.deepEqual(check.preview.validation.errors,[]);const other=await publish(h,{...e,type:'entry_bundle',title:'Related claim',payload:linked},'reviewer2');ok(other.verified,200);
 ok(await call(h,'revoke',lifecycleBody(first.s)),409);
 assert.equal((await publishedRecords(h.db)).length,2);
});
