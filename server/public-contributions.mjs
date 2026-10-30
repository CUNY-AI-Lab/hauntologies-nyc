import { publicRecord } from './published-edits.mjs';
import { publicCredit } from './record-credits.mjs';
import { publicCatalogRecord } from './catalog-projection.mjs';
import { RecordEditModel } from './record-update.mjs';
import {releaseCreditSQL,publicMonikerSQL,publicDisplayName} from './public-attribution.mjs';

const RECORD_LIMIT = 5000, EVENT_LIMIT = 10000, LEGACY_LIMIT = 5000;
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value);
const normalized = value => value.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('en-US');
const json = value => { try { return JSON.parse(value); } catch { return null; } };
const present = value => typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && !!value.trim();
const unknown = value => typeof value === 'string' && /^(unknown|unresolved|not known|unspecified)$/i.test(value.trim());
const counts = () => ({ published: 0, added: 0, edits: 0, notes: 0, undo: 0, unclassified: 0, legacy: 0 });
const metricsFor = values => Object.fromEntries(Object.entries(values).map(([key,value]) => [key, {value,unit:['added','unique_places_edited','places_touched'].includes(key)?'places':key==='legacy'?'releases':'events',coverage:values.unclassified && ['added','edits','notes','undo','unique_places_edited'].includes(key)?'partial':'complete'}]));

// One read snapshot: a revoke cannot leave old events paired with new public records.
// No account, registrant, receipt, private draft or historical narrative is selected.
export const PUBLIC_CONTRIBUTIONS_SQL = `WITH public_records AS (
 SELECT r.id,r.raw_json,r.derived_json,r.preview_hash FROM approved_records r
 LEFT JOIN workflow_jobs j ON j.id=r.preview_hash AND j.status='verified'
 LEFT JOIN workflow_approvals a ON a.id=j.approval_id AND a.submission_id=j.submission_id AND a.revision=j.revision
 LEFT JOIN workflow_submissions s ON s.id=j.submission_id
 WHERE json_extract(r.derived_json,'$.publication_mode')='direct'
 OR (s.review_state<>'revoked' AND (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1))
 ORDER BY r.id LIMIT ${RECORD_LIMIT + 1}
), direct_events AS (
 SELECT e.id,e.actor_id,e.created_at,
 json_object('record_id',json_extract(e.event_json,'$.record_id'),'kind',json_extract(e.event_json,'$.kind'),'moniker',json_extract(e.event_json,'$.moniker'),'display_moniker',${publicMonikerSQL()}) AS event_json,
 ${releaseCreditSQL()} AS credit_json,
 EXISTS (SELECT 1 FROM contributor_roster_hidden h WHERE 'map_'||h.user_id=s.owner_id) AS roster_hidden
 FROM workflow_events e JOIN workflow_submissions s ON s.id=e.submission_id
 JOIN workflow_revisions r ON r.submission_id=e.submission_id AND r.revision=e.revision
 JOIN public_records p ON p.id=json_extract(e.event_json,'$.record_id')
 WHERE e.kind='direct_publish' AND s.review_state='published'
 ORDER BY e.created_at,e.id LIMIT ${EVENT_LIMIT + 1}
), verified_times AS (
 SELECT job_id,min(created_at) AS published_at FROM workflow_events WHERE kind='verified' GROUP BY job_id
), legacy_releases AS (
 SELECT j.id,s.owner_id AS actor_id,COALESCE(v.published_at,CASE WHEN json_extract(j.verification_json,'$.outcome')='verified' THEN json_extract(j.verification_json,'$.checked_at') END) AS created_at,
 (SELECT json_object('submission_type',json_extract(r.raw_json,'$.type'),'targets',json_group_array(json_object('record_id',json_extract(t.value,'$.record_id'),'after',1,'operation',json_extract(t.value,'$.operation'),'before_type',json_type(t.value,'$.before'),'origin',json_extract(t.value,'$.origin'))))
  FROM json_each(j.manifest_json,'$.targets') t JOIN public_records p ON p.id=json_extract(t.value,'$.record_id')
  WHERE json_type(t.value,'$.after')='object') AS manifest_json,
 ${releaseCreditSQL()} AS credit_json,
 EXISTS (SELECT 1 FROM contributor_roster_hidden h WHERE 'map_'||h.user_id=s.owner_id) AS roster_hidden
 FROM workflow_jobs j JOIN workflow_submissions s ON s.id=j.submission_id
 JOIN workflow_approvals a ON a.id=j.approval_id AND a.submission_id=j.submission_id AND a.revision=j.revision
 JOIN workflow_revisions r ON r.submission_id=j.submission_id AND r.revision=j.revision
 LEFT JOIN verified_times v ON v.job_id=j.id
 WHERE j.status='verified' AND s.review_state<>'revoked'
 AND (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1)
 AND COALESCE(json_extract(r.raw_json,'$.type'),'') NOT IN ('import','bulk_import')
 AND NOT EXISTS (SELECT 1 FROM workflow_events e WHERE e.submission_id=s.id AND e.kind='direct_publish')
 ORDER BY j.id LIMIT ${LEGACY_LIMIT + 1}
)
SELECT 'record' AS section,id,raw_json,derived_json,preview_hash,NULL AS actor_id,NULL AS created_at,NULL AS event_json,NULL AS credit_json,NULL AS roster_hidden,NULL AS manifest_json FROM public_records
UNION ALL SELECT 'event',id,NULL,NULL,NULL,actor_id,created_at,event_json,credit_json,roster_hidden,NULL FROM direct_events
UNION ALL SELECT 'legacy',id,NULL,NULL,NULL,actor_id,created_at,NULL,credit_json,roster_hidden,manifest_json FROM legacy_releases`;

const core = new Set(['title', 'category', 'place_type', 'address', 'geo_basis']);
const unknownWhenBlank = new Set(['borough', 'geo_status']);
const imageNeeded = new Set(['image_credit', 'image_license', 'image_alt']);
const labels = { present: 'Present', missing: 'Missing', invalid: 'Invalid', unknown: 'Unknown', optional: 'Optional', not_applicable: 'Not applicable' };

// Classify from the immutable operation and released revision, never the final
// place shape or a staging timestamp. Missing evidence stays unclassified.
function legacyKind(manifest, targets) {
  const type=manifest.submission_type;
  if (['open_proposal','entry_bundle'].includes(type) && targets.every(t=>t.operation==='create_entry' && t.before_type==='null')) return 'create';
  const updates=targets.every(t=>t.operation==='update_record' && (t.before_type==='object' || t.origin==='static_inventory'));
  if (updates && type==='record_update') return 'edit';
  if (['citation_correction','date_correction','location_correction'].includes(type) && targets.every(t=>t.operation===type && t.before_type==='object')) return 'edit';
  if (updates && ['open_proposal','record_annotation'].includes(type)) return 'note';
  return 'publication';
}

export function placeCompleteness(record) {
  const snapshot = RecordEditModel.snapshot(record);
  const hasImage = present(snapshot.image_url) || present(record.image?.localUrl);
  const sourceFields = Object.values(RecordEditModel.sourceAliases);
  const fields = RecordEditModel.fieldsFor(record).filter(field => !sourceFields.includes(field.key) && !['latitude','longitude'].includes(field.key));
  const rows = fields.map(field => {
    const value = snapshot[field.key], blank = !present(value);
    let state = 'present', origin = 'stored';
    const requirement = field.key === 'title' ? 'core' : core.has(field.key) || unknownWhenBlank.has(field.key) || field.key === 'date_wording' ? 'recommended' : imageNeeded.has(field.key) ? 'conditional' : 'optional';
    if (field.group === 'Image' && field.key !== 'image_url' && !hasImage) state = 'not_applicable';
    else if (!blank && typeof value !== 'string' && typeof value !== 'number') state = 'invalid';
    else if (unknown(value)) state = 'unknown';
    else if (blank) state = core.has(field.key) || hasImage && imageNeeded.has(field.key) ? 'missing' : unknownWhenBlank.has(field.key) ? 'unknown' : 'optional';
    if (state !== 'not_applicable' && value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'number') state = 'invalid';
    if (field.key === 'title' && value === 'Untitled place') { state = 'missing'; origin = 'display_default'; }
    if (field.key === 'place_type' && !present(record.place_type) && !record.place_types?.length) { state = 'missing'; origin = 'display_default'; }
    if (field.key === 'inclusion_reason' && !present(record.inclusion_reason)) { state = 'optional'; origin = 'display_default'; }
    if (field.key === 'geo_status' && !present(record.geo_status)) { origin = 'derived'; state = 'unknown'; }
    if (field.key === 'date_wording' && blank) {
      if (unknown(snapshot.date_precision)) state = 'unknown';
      else if (present(snapshot.date_start) || present(snapshot.date_end)) { state = 'present'; origin = 'derived'; }
      else state = 'missing';
    }
    return { key: field.key, label: field.label, group: field.group, requirement, state, state_label: labels[state], reason_code: state === 'optional' ? 'optional_empty' : state, edit_key: field.key, value_origin: origin };
  });
  const coordinates = [snapshot.latitude, snapshot.longitude];
  const pairedNull = coordinates.every(value => value === null || value === undefined);
  const validPair = coordinates.every(value => typeof value === 'number' && Number.isFinite(value)) && Math.abs(coordinates[0]) <= 90 && Math.abs(coordinates[1]) <= 180;
  const coordinateState = pairedNull ? 'unknown' : validPair && snapshot.geo_status !== 'unresolved' ? 'present' : 'invalid';
  rows.push({ key: 'coordinates', label: 'Coordinates', group: 'Location', requirement: 'recommended', state: coordinateState, state_label: labels[coordinateState], reason_code: pairedNull ? 'unresolved_location' : validPair ? 'coordinate_pair' : 'invalid_coordinate_pair', edit_key: 'latitude', value_origin: 'stored' });
  const reference = ['source_title', 'source_citation', 'source_url', 'source_locator', ...Object.keys(snapshot).filter(key => /^sources\.\d+\.(title|citation|url|locator|repository)$/.test(key))].some(key => present(snapshot[key]) && !unknown(snapshot[key]));
  rows.push({ key: 'source_reference', label: 'Source reference', group: 'Sources', requirement: 'recommended', state: reference ? 'present' : 'missing', state_label: reference ? 'Present' : 'Missing', reason_code: reference ? 'reference_present' : 'reference_empty', edit_key: 'source_citation', value_origin: 'stored' });
  for(const [index,image] of (Array.isArray(record.images)?record.images:[]).entries())for(const [key,label] of [['credit','credit'],['license','rights'],['alt','description']]){
    const state=unknown(image?.[key])?'unknown':present(image?.[key])?'present':'missing';
    rows.push({key:'images.'+index+'.'+key,label:'Image '+(index+1)+' '+label,group:'Image',requirement:'conditional',state,state_label:labels[state],reason_code:state,edit_key:null,value_origin:'stored'});
  }
  const states = Object.fromEntries(Object.keys(labels).map(state => [state, rows.filter(row => row.state === state).length]));
  return { id: record.id, title: typeof snapshot.title === 'string' && present(snapshot.title) ? snapshot.title : 'Untitled place', borough: typeof snapshot.borough === 'string' && present(snapshot.borough) && !unknown(snapshot.borough) ? snapshot.borough : 'Unknown',
    needs_details: states.missing + states.invalid > 0, missing_details: states.missing + states.invalid, unknown_details: states.unknown, optional_empty: states.optional, states, fields: rows };
}

// This is the only output allowlist. Raw rows, private actor IDs and audit payloads
// remain local to this function. IDs identify directory rows for this response only.
export function projectPublicContributions({ staticRecords = [], rows = [], now = new Date().toISOString() }) {
  const grouped = Object.fromEntries(['record', 'event', 'legacy'].map(section => [section, rows.filter(row => row.section === section)]));
  if (grouped.record.length > RECORD_LIMIT || grouped.event.length > EVENT_LIMIT || grouped.legacy.length > LEGACY_LIMIT || staticRecords.length > RECORD_LIMIT) throw new Error('public_projection_limit');
  const records = new Map(staticRecords.map(record => [record.id, publicCatalogRecord(record)]));
  for (const row of grouped.record) for (const record of publicRecord(row)) records.set(record.id, record);
  const totals = counts(), people = new Map(), seen = new Set(), added = new Set(), edited = new Set(), activityEvents = [];
  const placeActivity = new Map([...records.keys()].map(id => [id, counts()]));
  let coverageStart = null;
  let unattributed = 0, unattributedLegacy = 0;
  function personFor(row, name) {
    if (!name || typeof row.actor_id !== 'string' || !row.actor_id) return null;
    const key = JSON.stringify([row.actor_id, normalized(name)]);
    if (!people.has(key)) people.set(key, { id: crypto.randomUUID(), name, identity_basis: 'actor_and_moniker', identity_scope: 'response', ...counts(), place_ids: new Set(), addedIds: new Set(), latest: null });
    return people.get(key);
  }
  function publication(row,kind,ids,name,legacy=false) {
    const person=personFor(row,name),at=typeof row.created_at==='string' && Number.isFinite(Date.parse(row.created_at)) ? new Date(row.created_at).toISOString() : null;
    totals.published++;
    if(legacy)totals.legacy++;
    if(at && (!coverageStart || at<coverageStart))coverageStart=at;
    if(person){person.published++;if(legacy)person.legacy++;for(const id of ids)person.place_ids.add(id);if(at && (!person.latest || at>person.latest))person.latest=at;}
    else{unattributed++;if(legacy)unattributedLegacy++;}
    const metric=({edit:'edits',note:'notes',undo:'undo'})[kind] || 'unclassified';
    if(kind!=='create'){totals[metric]++;if(person)person[metric]++;}
    for(const id of ids){
      const activity=placeActivity.get(id);activity.published++;if(legacy)activity.legacy++;
      if(kind==='create'){added.add(id);person?.addedIds.add(id);activity.added=1;}
      else{activity[metric]++;if(kind==='edit')edited.add(id);}
    }
    const id=ids[0],title=records.get(id).title;
    activityEvents.push({sort_id:(legacy?'legacy:':'direct:')+row.id,kind,at,contributor:name,
      place:{id,title:typeof title==='string' && title.trim()?title:'Untitled place'},...(ids.length>1?{place_count:ids.length}:{})});
  }
  for (const row of grouped.event) {
    if (seen.has(row.id)) continue;
    const event = json(row.event_json);
    if (!event || !records.has(event.record_id)) continue;
    seen.add(row.id);
    const consent = json(row.credit_json)?.public_credit;
    const credit = publicCredit(row.credit_json);
    const name = !row.roster_hidden && consent?.identity === 'moniker' && credit && typeof event.moniker === 'string' && normalized(credit) === normalized(event.moniker) ? publicDisplayName(event.display_moniker,credit) : null;
    publication(row,['create','edit','note','undo'].includes(event.kind)?event.kind:'publication',[event.record_id],name);
  }
  for (const row of grouped.legacy) {
    if (seen.has('legacy:' + row.id)) continue;
    const manifest=json(row.manifest_json);
    if(['import','bulk_import'].includes(manifest?.submission_type))continue;
    const targets = (manifest?.targets || []).filter(target => target.after && records.has(target.record_id));
    if (!targets.length) continue;
    seen.add('legacy:' + row.id);
    const name = row.roster_hidden ? null : publicCredit(row.credit_json);
    publication(row,legacyKind(manifest,targets),[...new Set(targets.map(target=>target.record_id))],name,true);
  }
  totals.added = added.size;
  const contributors = [...people.values()].map(({ addedIds, place_ids, ...person }) => ({ ...person, added: addedIds.size, place_ids: [...place_ids].sort(), metrics: metricsFor({published:person.published,added:addedIds.size,edits:person.edits,notes:person.notes,undo:person.undo,unclassified:person.unclassified,legacy:person.legacy,places_touched:place_ids.size}) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  const overridden = new Set(grouped.record.map(row => row.id));
  const places = [...records.values()].map(record => ({ ...placeCompleteness(record), origin: overridden.has(record.id) ? 'published' : 'base', contributions:metricsFor(placeActivity.get(record.id)) })).sort((a, b) => a.title.localeCompare(b.title, 'en-US') || a.id.localeCompare(b.id));
  const metrics = metricsFor({...totals, unique_places_edited: edited.size});
  const activity = activityEvents.sort((a,b) => (b.at || '').localeCompare(a.at || '') || a.sort_id.localeCompare(b.sort_id)).slice(0,100).map(({sort_id,...event}) => event);
  return { schema_version: '1.0', as_of: now, scope: 'All recorded history currently public', coverage_start: coverageStart, identity_scope: 'response', metrics, totals: { ...totals, unique_places_edited: edited.size, unattributed, unattributed_legacy: unattributedLegacy, places: places.length }, contributors, places, activity };
}

export async function readPublicContributions(db, staticRecords) {
  if (!db) throw new Error('public_projection_unavailable');
  const { results = [] } = await db.prepare(PUBLIC_CONTRIBUTIONS_SQL).all();
  const projection = projectPublicContributions({ staticRecords, rows: results });
  // A public-content fingerprint fences changes between summary and detail reads.
  // Exclude response IDs/time and all private identity material from this digest.
  const publicState = { totals:projection.totals, places:projection.places, activity:projection.activity, contributors:projection.contributors.map(({id,...person})=>person).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(publicState)));
  projection.snapshot_token = [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  return projection;
}

export async function handlePublicContributions(request, { db, staticRecords }) {
  const url = new URL(request.url), summary = url.pathname === '/api/contributors-summary', activity = url.pathname === '/api/activity';
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
  const respond = (body, status = 200) => request.method === 'HEAD' ? new Response(null, { status, headers }) : Response.json(body, { status, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return respond({ error: 'method_not_allowed' }, 405);
  if (summary || activity ? url.searchParams.size : [...url.searchParams.keys()].some(key => !['place','snapshot'].includes(key)) || url.searchParams.getAll('place').length !== 1 || !idValid(url.searchParams.get('place')) || url.searchParams.getAll('snapshot').length > 1 || url.searchParams.has('snapshot') && !/^[a-f0-9]{64}$/.test(url.searchParams.get('snapshot'))) return respond({ error: 'invalid_query' }, 400);
  try {
    const projection = await readPublicContributions(db, staticRecords);
    if (activity) return respond({ schema_version: '1.0', as_of: projection.as_of, scope: 'All recorded publications currently public', total: projection.totals.published, limit: 100, events: projection.activity });
    if (summary) { const { activity: omitted, ...directory } = projection; return respond({ ...directory, places: projection.places.map(({ fields, ...place }) => place) }); }
    if (url.searchParams.has('snapshot') && url.searchParams.get('snapshot') !== projection.snapshot_token) return respond({error:'public_snapshot_changed'},409);
    const place = projection.places.find(place => place.id === url.searchParams.get('place'));
    if (!place) return respond({ error: 'place_not_public' }, 404);
    return respond({ as_of: projection.as_of, snapshot_token: projection.snapshot_token, place });
  } catch { return respond({ error: 'public_details_unavailable' }, 503); }
}
