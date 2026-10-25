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

const placeFields=['entry_id','group_id','category','title','claim_text','place_original','place_normalized','place_type','place_types','related_entry_id','time_original','time_start_year','time_end_year','time_precision','time_basis','geo_status','geo_method','geo_basis','geo_source_ref','latitude','longitude','borough','uncertainty_m','uncertainty_basis','gap_question','gap_scope','gap_limitations','image_url','image_caption'];
const sourceFields=['source_ref','entry_id','role','title','citation','url','repository','locator','evidence_note','rights_statement','rights_status'];
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
export async function publishedRecordPage(db,after=''){
  const {results=[]}=await db.prepare(`SELECT r.id,r.raw_json,r.derived_json,r.preview_hash FROM approved_records r
    JOIN workflow_jobs j ON j.id=r.preview_hash AND j.status='verified'
    JOIN workflow_approvals a ON a.id=j.approval_id AND a.submission_id=j.submission_id AND a.revision=j.revision
    JOIN workflow_submissions s ON s.id=j.submission_id WHERE (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1) AND r.id>? ORDER BY r.id LIMIT 501`).bind(after).all();
  return {records:results.slice(0,500).flatMap(publicRecord),next_cursor:results.length>500?results[499].id:null};
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
