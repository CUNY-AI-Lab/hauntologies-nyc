'use strict';
(function(root){
 const label=value=>typeof value==='string'?value:value==null?'':JSON.stringify(value);
 const fields=['entry_id','group_id','category','title','claim_text','place_original','place_normalized','place_type','place_types','related_entry_id','time_original','time_start_year','time_end_year','time_precision','time_basis','geo_status','geo_method','geo_basis','geo_source_ref','uncertainty_m','uncertainty_basis','gap_question','gap_scope','gap_limitations','review_state','merged_version'];
 function flatten(record,pending=false){
  const raw=record.raw,derived=record.derived||{},loc=derived.location||{},metadata=raw.metadata||{};
  const result={id:record.id,title:raw.title,description:raw.description,evidence_summary:raw.description,location_text:label(metadata.location),borough:loc.borough,latitude:loc.latitude??null,longitude:loc.longitude??null,location_precision:loc.precision||'unlocated',geocode_source_url:loc.coordinate_source_url,category:pending?'pending':'submitted',status:pending?'pending':'approved',source_type:'hosted-submission',claim_status:pending?'pending_review':'approved_by_owner',source_title:'Participant submission',source_url:'',sources:[],original_submission:raw,original_submission_json:record.raw_json,hosted_payload:record,hosted_pending:pending};
  const canonical=derived.canonical_entry;
  if(!pending&&canonical?.review_state==='merged'&&derived.workflow?.review_state==='merged'){
   for(const field of fields)if(Object.prototype.hasOwnProperty.call(canonical,field))result[field]=structuredClone(canonical[field]);
   result.evidence_summary=canonical.claim_text??raw.description;
   result.location_text=canonical.place_original??result.location_text;
   result.sources=structuredClone(derived.canonical_sources||[]);
   result.source_title=result.sources[0]?.citation||'Reviewed canonical sources';result.source_url=result.sources[0]?.url||'';
   result.claim_status='Independently reviewed · merged';result.canonical_reviewed=true;
   if(canonical.geo_status==='unresolved'){result.latitude=null;result.longitude=null}
  }
  return result;
 }
 function parseAreaGeometry(value){
  let geometry;
  try{geometry=typeof value==='string'?JSON.parse(value):structuredClone(value)}catch{throw new Error('Enter a Polygon or a closed list of [longitude, latitude] pairs')}
  if(Array.isArray(geometry))geometry={type:'Polygon',coordinates:[geometry]};
  if(geometry&&typeof geometry==='object'&&Object.keys(geometry).some(key=>!['type','coordinates'].includes(key)))throw new Error('Polygon accepts only type and coordinates');
  if(!geometry||geometry.type!=='Polygon'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length!==1)throw new Error('Use one Polygon without holes');
  const ring=geometry.coordinates[0];
  if(!Array.isArray(ring)||ring.length<4||ring.length>101||ring.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90))throw new Error('Use 4–101 positions with numeric longitude, latitude pairs');
  if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw new Error('Close the polygon by repeating its first position');
  const vertices=ring.slice(0,-1);if(new Set(vertices.map(p=>p.join(','))).size!==vertices.length)throw new Error('Do not repeat polygon vertices');
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const on=(a,b,c)=>Math.abs(cross(a,b,c))<1e-12&&c[0]>=Math.min(a[0],b[0])&&c[0]<=Math.max(a[0],b[0])&&c[1]>=Math.min(a[1],b[1])&&c[1]<=Math.max(a[1],b[1]);
  const intersects=(a,b,c,d)=>{const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);return(x*y<0&&z*w<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)};
  let area=0;for(let i=0;i<ring.length-1;i++){area+=(ring[i][0]-ring[0][0])*(ring[i+1][1]-ring[0][1])-(ring[i+1][0]-ring[0][0])*(ring[i][1]-ring[0][1]);for(let j=i+1;j<ring.length-1;j++){if(j===i+1||(i===0&&j===ring.length-2))continue;if(intersects(ring[i],ring[i+1],ring[j],ring[j+1]))throw new Error('Polygon edges must not cross or overlap')}}
  if(Math.abs(area)/2<=1e-12)throw new Error('The polygon must enclose an area');
  return{type:'Polygon',coordinates:[ring.map(p=>[p[0],p[1]])]};
 }
 function areaFromBounds(south,west,north,east){
  if(![south,west,north,east].every(Number.isFinite)||south>=north||west>=east)throw new Error('Enter ordered south, west, north and east bounds');
  return parseAreaGeometry({type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]});
 }
 function targetRecord(target){const r=target?.record||{};return r.raw&&r.derived?flatten({id:target.record_id,...r}):r;}
 function proposalRecords(envelope,target){
  const p=envelope?.payload||{};
  if(envelope?.type==='entry_bundle')return(p.Entries||[]).map(entry=>({id:entry.entry_id,title:entry.title,evidence_summary:entry.claim_text,location_text:entry.place_original,time_original:entry.time_original,time_basis:entry.time_basis,latitude:entry.latitude,longitude:entry.longitude,geo_status:entry.geo_status,geo_basis:entry.geo_basis,sources:(p.Sources||[]).filter(s=>s.entry_id===entry.entry_id)}));
  if(envelope?.type==='area_proposal')return[{id:'proposed-area',title:envelope.title,evidence_summary:p.description,location_text:p.place_original,time_original:p.dates?.time_original,time_basis:p.dates?.time_basis,geometry:p.geometry_status==='unresolved'?null:p.geometry,latitude:null,longitude:null,geo_status:p.geometry_status==='unresolved'?'unresolved':'approximate',geo_basis:p.geometry_basis,uncertainty_note:p.uncertainty_note,sources:envelope.sources||[]}];
  if(envelope?.type==='record_annotation'){
   const original=target?.record||{},r=targetRecord(target),canonical=original.canonical_entry||original.derived?.canonical_entry||r;
   return[{...canonical,id:target?.record_id||envelope.targets?.[0]?.record_id,title:envelope.title,evidence_summary:p.text,original_wording:p.original_wording,location_text:canonical.place_original||canonical.location_text||canonical.title,time_original:p.dates?.time_original||canonical.time_original||canonical.event_date_start,time_basis:p.dates?.time_basis||canonical.time_basis,latitude:canonical.latitude??null,longitude:canonical.longitude??null,geo_status:canonical.geo_status||((Number.isFinite(canonical.latitude)&&Number.isFinite(canonical.longitude))?'approximate':'unresolved'),geo_basis:canonical.geo_basis||canonical.location_precision,uncertainty_note:p.uncertainty_note,sources:envelope.sources||[]}];
  }
  return[];
 }
 root.HostedRecordModel=Object.freeze({flatten,parseAreaGeometry,areaFromBounds,proposalRecords,targetRecord});
})(typeof window!=='undefined'?window:globalThis);
