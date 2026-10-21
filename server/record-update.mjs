import '../public/atlas-model.js';
import '../public/place-summary.js';
import '../public/record-edit-model.js';
import { boroughAt } from './core.mjs';
import { hasUsableBoundaries } from './area-geometry.mjs';
export const RecordEditModel=globalThis.RecordEditModel;

export async function recordUpdateProposal(envelope,v,getTarget,geography){
  const payload=envelope.payload;
  v.known(payload,['change_message','changes','source_additions'],'payload');
  if(envelope.summary!==payload.change_message)v.issue('summary','change_message_mismatch','Preserve the change message exactly in the summary.');
  if(envelope.sources.length)v.issue('sources','original_sources_preserved','Propose source field corrections in changes or new references in source_additions; original source arrays remain intact.');
  let target=null;
  if(envelope.targets.length!==1)v.issue('targets','one_update_target','A record update needs exactly one authoritative target.');
  else{
    const requested=envelope.targets[0];target=await getTarget(requested.record_id);
    if(!target)v.issue('targets','update_target_not_found','This record no longer exists.');
    else if(target.expected_version!==requested.expected_version||target.expected_hash!==requested.expected_hash)v.issue('targets','stale_target','This record changed. Reload it and compare your proposal again.');
  }
  const before=target?RecordEditModel.snapshot(target):null,result=RecordEditModel.validateChanges(payload.changes,{snapshot:before,change_message:payload.change_message,source_additions:payload.source_additions});
  for(const error of result.errors)v.issue('payload.'+error.field,error.code,error.message);
  const changed=new Set(Array.isArray(payload.changes)?payload.changes.map(change=>change?.field):[]);
  if(before&&['latitude','longitude','geo_status','borough','uncertainty_m'].some(key=>changed.has(key))){
    const after=result.after,lat=after.latitude,lon=after.longitude;
    if(lat!==null||lon!==null){
      if(typeof lat!=='number'||typeof lon!=='number'||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)v.issue('payload.changes','coordinate_pair','Use finite paired WGS84 coordinates.');
      else if(!hasUsableBoundaries(geography?.boundaries))v.issue('payload.changes','boundary_unavailable','NYC boundary validation is unavailable.');
      else{const borough=boroughAt(lat,lon,geography.boundaries);if(!borough)v.issue('payload.changes','outside_nyc','The proposed point is outside NYC.');else if(after.borough!==null&&after.borough!=='unknown'&&after.borough!==borough)v.issue('payload.changes','borough_mismatch','The borough and proposed point disagree.');}
    }
  }
  v.warn('payload','record_update_review_only','This is a proposed metadata update for independent human review. Original records and all source arrays remain unchanged.');
  return{type:'record_update',target,change_message:payload.change_message,editable_before:before,editable_after:result.after,field_diff:structuredClone(payload.changes||[]),source_additions:structuredClone(Array.isArray(payload.source_additions)?payload.source_additions:[]),geometry:null,source_refs:[]};
}
