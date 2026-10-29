import { publicCredit, recordCredits } from './record-credits.mjs';
// A public credit label names its contributor only while they are on the roster. Every public
// projection of release history reads this column, so leaving the roster hides the name everywhere
// at once (records, published edits, the Contributors counts) and rejoining restores it.
const ROSTER_HIDDEN=`EXISTS (SELECT 1 FROM contributor_roster_hidden h WHERE 'map_'||h.user_id=s.owner_id) AS roster_hidden`;
const releaseCredit=row=>publicCredit(row.raw_json,row.roster_hidden);
// Public projection of immutable, independently approved and verified releases.
// Never return a submission DTO, current draft, source text, media or identity.
export async function publishedEdits(db) {
  const {results = []} = await db.prepare(`SELECT j.id,j.updated_at,j.manifest_json,r.raw_json,${ROSTER_HIDDEN}
    FROM workflow_jobs j JOIN workflow_approvals a ON a.id=j.approval_id
      AND a.submission_id=j.submission_id AND a.revision=j.revision
    JOIN workflow_revisions r ON r.submission_id=j.submission_id AND r.revision=j.revision
    JOIN workflow_submissions s ON s.id=j.submission_id
    WHERE j.status='verified' AND (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1)
    ORDER BY j.updated_at DESC,j.id ASC LIMIT 20`).all();
  const legacy=results.flatMap(row => {
    try {
      const manifest=JSON.parse(row.manifest_json);
      const targets=(manifest.targets||[]).filter(target=>target.after).map(target=>{
        const record=JSON.parse(target.after.derived_json),edited=record.edited_record?JSON.parse(target.after.raw_json):null;
        return {record_id:target.record_id,title:edited?.title||record.canonical_entry?.title||'Published place'};
      });
      if(!targets.length)return [];
      const label=releaseCredit(row);
      return [{id:row.id,published_at:row.updated_at,targets,...(label?{credit:label}:{})}];
    } catch { return []; }
  });
  const {results:direct=[]}=await db.prepare("SELECT e.id,e.created_at,e.event_json,r.raw_json FROM workflow_events e JOIN workflow_submissions s ON s.id=e.submission_id JOIN approved_records r ON r.id=json_extract(e.event_json,'$.record_id') WHERE e.kind='direct_publish' AND s.review_state='published' ORDER BY e.created_at DESC,e.id DESC LIMIT 20").all();
  return [...legacy,...direct.map(row=>{const e=JSON.parse(row.event_json);return{id:row.id,published_at:row.created_at,credit:e.moniker,summary:e.summary,targets:[{record_id:e.record_id,title:JSON.parse(row.raw_json).title||'Place'}]};})].sort((a,b)=>b.published_at.localeCompare(a.published_at)).slice(0,20);
}

// Public credit for the Contributors list: one count per live release whose contributor opted in.
// Only the consented label leaves the server; uncredited and roster-hidden releases are only counted in the total.
export async function contributorCredits(db) {
  const {results = []} = await db.prepare(`SELECT r.raw_json,${ROSTER_HIDDEN} FROM workflow_jobs j
    JOIN workflow_approvals a ON a.id=j.approval_id AND a.submission_id=j.submission_id AND a.revision=j.revision
    JOIN workflow_revisions r ON r.submission_id=j.submission_id AND r.revision=j.revision
    JOIN workflow_submissions s ON s.id=j.submission_id
    WHERE j.status='verified' AND (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1)`).all();
  const counts=new Map();let total=0;
  for (const row of results) {
    try{JSON.parse(row.raw_json);}catch{continue;}
    total++;
    const label=releaseCredit(row);
    if(!label)continue;
    const key=label.toLocaleLowerCase('en-US'),entry=counts.get(key)||{name:label,count:0};entry.count++;counts.set(key,entry);
  }
  const {results:direct=[]}=await db.prepare("SELECT e.event_json FROM workflow_events e JOIN workflow_submissions s ON s.id=e.submission_id WHERE e.kind='direct_publish' AND s.review_state='published'").all();
  for(const row of direct){const name=JSON.parse(row.event_json).moniker;if(!name)continue;total++;const key=name.toLocaleLowerCase('en-US'),entry=counts.get(key)||{name,count:0};entry.count++;counts.set(key,entry);}
  const contributors=[...counts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'en-US'));
  return {contributors,total};
}

// The roster uses only contributor-chosen, consented monikers. Account/registration
// names and emails are never attribution sources, even for the viewer's own defaults.
export async function contributorRoster(db, actorId = '') {
  const {results=[]}=await db.prepare(`SELECT s.id,s.review_state,r.raw_json FROM workflow_submissions s
    JOIN workflow_revisions r ON r.submission_id=s.id AND r.revision=s.current_revision
    WHERE s.review_state IN ('published','merged')
      AND (json_extract(r.raw_json,'$.public_credit.identity')='moniker' OR NOT EXISTS (SELECT 1 FROM contributor_roster_hidden h WHERE 'map_'||h.user_id=s.owner_id))`).all();
  const people=new Map();
  for(const row of results){
    const name=publicCredit(row.raw_json);if(!name)continue;
    const key=name.toLocaleLowerCase('en-US'),entry=people.get(key)||{name,contributions:0,published:0,account:true};
    entry.contributions++;if(['published','merged'].includes(row.review_state))entry.published++;people.set(key,entry);
  }
  const registrants=[...people.values()].sort((a,b)=>b.contributions-a.contributions||a.name.localeCompare(b.name,'en-US'));
  const userId=String(actorId).startsWith('map_')?String(actorId).slice(4):'';
  if(!userId)return {registrants};
  const hidden=await db.prepare('SELECT 1 AS hidden FROM contributor_roster_hidden WHERE user_id=?').bind(userId).first();
  return {registrants,you:{listed:!hidden}};
}

// The signed-in account's own choice to appear on the roster, or not.
export async function setRosterListing(db, actorId, listed) {
  const userId=String(actorId).startsWith('map_')?String(actorId).slice(4):'';
  if(!userId)throw new Error('account_required');
  await (listed
    ?db.prepare('DELETE FROM contributor_roster_hidden WHERE user_id=?').bind(userId)
    :db.prepare('INSERT INTO contributor_roster_hidden (user_id,created_at) SELECT id,? FROM hny_auth_user WHERE id=? ON CONFLICT(user_id) DO NOTHING').bind(new Date().toISOString(),userId)).run();
  return {listed:Boolean(listed)};
}

const placeFields=['entry_id','group_id','category','title','claim_text','place_original','place_normalized','place_type','place_types','related_entry_id','time_original','time_start_year','time_end_year','time_precision','time_basis','geo_status','geo_method','geo_basis','geo_source_ref','latitude','longitude','borough','uncertainty_m','uncertainty_basis','gap_question','gap_scope','gap_limitations','image_url','image_caption'];
const sourceFields=['source_ref','entry_id','role','title','citation','url','repository','locator','evidence_note','rights_statement','rights_status'];
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
export async function publishedRecordPage(db,after=''){
  const {results=[]}=await db.prepare(`SELECT r.id,r.raw_json,r.derived_json,r.preview_hash FROM approved_records r
    LEFT JOIN workflow_jobs j ON j.id=r.preview_hash AND j.status='verified'
    LEFT JOIN workflow_approvals a ON a.id=j.approval_id AND a.submission_id=j.submission_id AND a.revision=j.revision
    LEFT JOIN workflow_submissions s ON s.id=j.submission_id WHERE (json_extract(r.derived_json,'$.publication_mode')='direct' OR (s.review_state<>'revoked' AND (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1))) AND r.id>? ORDER BY r.id LIMIT 501`).bind(after).all();
  const records=results.slice(0,500).flatMap(publicRecord),credits=await recordCredits(db,records.map(record=>record.id));
  return {records:records.map(record=>{if(record.direct_publication)return record;const names=credits.get(record.id);return names?.length||Object.hasOwn(record,'contributors')?{...record,contributors:names||[]}:record;}),next_cursor:results.length>500?results[499].id:null};
}
export async function publishedRecords(db){return (await publishedRecordPage(db)).records;}
export function publicRecord(row){
    try{const derived=JSON.parse(row.derived_json),entry=derived.canonical_entry;
      if(derived.publication_mode==='direct'){const record=JSON.parse(row.raw_json);delete record.canonical_reviewed;return [{...record,id:row.id,direct_publication:true}];}
      // An edited place is published whole, in the map's own record shape.
      if(derived.edited_record){if(derived.workflow?.review_state!=='merged'||derived.workflow.job_id!==row.preview_hash||typeof row.raw_json!=='string')return [];const edited=JSON.parse(row.raw_json);return [{...edited,id:row.id,review_state:'merged',canonical_reviewed:true,merged_version:row.preview_hash,edited:true}];}
      if(entry?.review_state!=='merged'||derived.workflow?.job_id!==row.preview_hash)return [];
      const value=pick(entry,placeFields),sources=(derived.canonical_sources||[]).map(source=>pick(source,sourceFields));
      return [{...value,id:row.id,status:'approved',review_state:'merged',canonical_reviewed:true,merged_version:row.preview_hash,
        description:entry.claim_text||'',evidence_summary:entry.claim_text||'',location_text:entry.place_original||'',
        latitude:entry.geo_status==='unresolved'?null:entry.latitude??null,longitude:entry.geo_status==='unresolved'?null:entry.longitude??null,
        sources,source_title:sources[0]?.citation||'',source_url:sources[0]?.url||''}];
    }catch{return [];}
}
