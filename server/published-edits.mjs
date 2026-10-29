import { recordCredits } from './record-credits.mjs';
// Public projection of immutable, independently approved and verified releases.
// Never return a submission DTO, current draft, source text, media or identity.
export async function publishedEdits(db) {
  const {results = []} = await db.prepare(`SELECT j.id,j.updated_at,j.manifest_json,r.raw_json
    FROM workflow_jobs j JOIN workflow_approvals a ON a.id=j.approval_id
      AND a.submission_id=j.submission_id AND a.revision=j.revision
    JOIN workflow_revisions r ON r.submission_id=j.submission_id AND r.revision=j.revision
    JOIN workflow_submissions s ON s.id=j.submission_id
    WHERE j.status='verified' AND (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1)
    ORDER BY j.updated_at DESC,j.id ASC LIMIT 20`).all();
  return results.flatMap(row => {
    try {
      const manifest=JSON.parse(row.manifest_json), published=JSON.parse(row.raw_json);
      const targets=(manifest.targets||[]).filter(target=>target.after).map(target=>{
        const record=JSON.parse(target.after.derived_json),edited=record.edited_record?JSON.parse(target.after.raw_json):null;
        return {record_id:target.record_id,title:edited?.title||record.canonical_entry?.title||'Published place'};
      });
      if(!targets.length)return [];
      const credit=published.public_credit;
      const label=credit?.consent===true&&typeof credit.label==='string'?credit.label.trim():'';
      return [{id:row.id,published_at:row.updated_at,targets,
        ...(label&&label.length<=120&&!label.includes('@')?{credit:label}:{})}];
    } catch { return []; }
  });
}

// Public credit for the Contributors list: one count per live release whose contributor opted in.
// Only the consented label leaves the server; uncredited releases are only counted in the total.
export async function contributorCredits(db) {
  const {results = []} = await db.prepare(`SELECT r.raw_json FROM workflow_jobs j
    JOIN workflow_approvals a ON a.id=j.approval_id AND a.submission_id=j.submission_id AND a.revision=j.revision
    JOIN workflow_revisions r ON r.submission_id=j.submission_id AND r.revision=j.revision
    JOIN workflow_submissions s ON s.id=j.submission_id
    WHERE j.status='verified' AND (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1)`).all();
  const counts=new Map();let total=0;
  for (const row of results) {
    let credit=null;try{credit=JSON.parse(row.raw_json).public_credit;}catch{continue;}
    total++;
    const label=credit?.consent===true&&typeof credit.label==='string'?credit.label.trim().replace(/\s+/g,' '):'';
    if(!label||label.length>120||label.includes('@'))continue;
    const key=label.toLocaleLowerCase('en-US'),entry=counts.get(key)||{name:label,count:0};entry.count++;counts.set(key,entry);
  }
  const contributors=[...counts.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'en-US'));
  return {contributors,total};
}

// Signed-in roster: every event registrant by name, with what their map account has sent and
// what is published. Emails only join registration to account here and never leave the server.
// An account can leave the list; `you` tells the signed-in viewer whether they are on it.
export async function contributorRoster(db, actorId = '') {
  // A place sent again under the same title counts once, as in Under review; the default title never merges.
  const place=`count(DISTINCT CASE WHEN lower(trim(coalesce(json_extract(r.raw_json,'$.title'),''))) IN ('','contribution') THEN s.id ELSE lower(trim(json_extract(r.raw_json,'$.title'))) END)`;
  const mine=`FROM workflow_submissions s JOIN workflow_revisions r ON r.submission_id=s.id AND r.revision=s.current_revision WHERE s.owner_id='map_'||u.id`;
  const {results = []} = await db.prepare(`SELECT g.name,
      (SELECT ${place} ${mine} AND s.review_state IN ('submitted','changes_requested','approved','merged')) AS sent,
      (SELECT ${place} ${mine} AND s.review_state='merged') AS published,
      u.id IS NOT NULL AS account,
      u.id IN (SELECT user_id FROM contributor_roster_hidden) AS hidden
    FROM (SELECT lower(trim(email)) AS email, name, max(created_at) AS at FROM event_registrations GROUP BY lower(trim(email))) g
    LEFT JOIN hny_auth_user u ON lower(u.email)=g.email`).all();
  // Leaving the list hides the name, including any other sign-up under that same name.
  const people=new Map(),hiddenNames=new Set();
  for (const row of results) {
    const name=rosterName(row.name);
    if(!name)continue;
    const key=name.toLocaleLowerCase('en-US');
    if(row.hidden){hiddenNames.add(key);continue;}
    const entry=people.get(key)||{name,contributions:0,published:0,account:false};
    entry.contributions+=Number(row.sent)||0;entry.published+=Number(row.published)||0;entry.account||=Boolean(row.account);people.set(key,entry);
  }
  // A bare first name signed up again in full ("Zarin", then "Zarin Syed") is one person, and
  // leaving the list under either form hides both.
  const keys=new Set([...people.keys(),...hiddenNames]);
  for(const key of keys){
    if(key.includes(' '))continue;
    const full=[...keys].filter(other=>other.startsWith(key+' '));
    if(full.length!==1)continue;
    const whole=people.get(full[0]),entry=people.get(key);
    if(hiddenNames.has(key)||hiddenNames.has(full[0])){hiddenNames.add(key);hiddenNames.add(full[0]);continue;}
    if(whole&&entry){whole.contributions+=entry.contributions;whole.published+=entry.published;whole.account||=entry.account;people.delete(key);}
  }
  for(const key of hiddenNames)people.delete(key);
  const registrants=[...people.values()].sort((a,b)=>b.contributions-a.contributions||a.name.localeCompare(b.name,'en-US'));
  const userId=String(actorId).startsWith('map_')?String(actorId).slice(4):'';
  if(!userId)return {registrants};
  const hidden=await db.prepare('SELECT 1 AS hidden FROM contributor_roster_hidden WHERE user_id=?').bind(userId).first();
  // The viewer's own registration name, offered back to them as a default public credit.
  // It is theirs already; it still never reaches anyone else from here.
  const own=await db.prepare(`SELECT g.name FROM event_registrations g JOIN hny_auth_user u ON lower(trim(g.email))=lower(u.email)
    WHERE u.id=? ORDER BY g.created_at DESC LIMIT 1`).bind(userId).first();
  const name=rosterName(own?.name);
  return {registrants,you:{listed:!hidden,...(name?{name}:{})}};
}

// Registration names as people typed them: test sign-ups are dropped and a handle such as
// "first.last" reads as a name. Anything that looks like an email never leaves the server.
const placeholderName=/^(test(ing|er)?|asdf+|placeholder|example|name|n\/?a|none|x+)\d*$/i;
function rosterName(value){
  let name=typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,120):'';
  if(!name||name.includes('@')||placeholderName.test(name))return '';
  if(/^[a-z]+(?:[._][a-z]+)+$/i.test(name))name=name.split(/[._]/).map(part=>part[0].toUpperCase()+part.slice(1).toLowerCase()).join(' ');
  return name;
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
    JOIN workflow_jobs j ON j.id=r.preview_hash AND j.status='verified'
    JOIN workflow_approvals a ON a.id=j.approval_id AND a.submission_id=j.submission_id AND a.revision=j.revision
    JOIN workflow_submissions s ON s.id=j.submission_id WHERE (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1) AND r.id>? ORDER BY r.id LIMIT 501`).bind(after).all();
  const records=results.slice(0,500).flatMap(publicRecord),credits=await recordCredits(db,records.map(record=>record.id));
  return {records:records.map(record=>{const names=credits.get(record.id);return names?.length||Object.hasOwn(record,'contributors')?{...record,contributors:names||[]}:record;}),next_cursor:results.length>500?results[499].id:null};
}
export async function publishedRecords(db){return (await publishedRecordPage(db)).records;}
export function publicRecord(row){
    try{const derived=JSON.parse(row.derived_json),entry=derived.canonical_entry;
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
