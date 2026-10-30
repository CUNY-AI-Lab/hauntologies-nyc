import {fail,hash,stable,idValid,snapshotHash} from './workflow-core.mjs';
import {RecordEditModel} from './record-update.mjs';
import {selectedPublicImages} from './public-images.mjs';
const copy=v=>structuredClone(v),equal=(a,b)=>stable(a??null)===stable(b??null);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dangerous=new Set(['__proto__','prototype','constructor']);
function read(root,path){let value=root;for(const key of path)value=value?.[key];return value===undefined?null:copy(value);}
function write(root,path,value){let parent=root;for(const key of path.slice(0,-1)){if(dangerous.has(key))fail('invalid_field');if(!parent[key]||typeof parent[key]!=='object')parent[key]={};parent=parent[key];}const key=path.at(-1);if(dangerous.has(key))fail('invalid_field');if(value===null)delete parent[key];else parent[key]=copy(value);}
function difference(before,after,path=[]){
 if(equal(before,after))return [];
 if(before&&after&&!Array.isArray(before)&&!Array.isArray(after)&&typeof before==='object'&&typeof after==='object')return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(k=>dangerous.has(k)?[]:difference(before[k],after[k],[...path,k]));
 return [{path,before:before??null,after:after??null}];
}
export function normalizedRecord(record){const value=copy(record||{}),sources={},images={};for(const image of value.images||[])if(image?.attachment_id)images[image.attachment_id]=image;delete value.images;for(const [i,source] of (value.sources||[]).entries()){if(source&&typeof source==='object'){const id=source.source_id||'base_'+i;sources[id]={...source,source_id:id};}}delete value.sources;for(const key of ['notes','contributors','canonical_reviewed','merged_version','review_state','status','direct_publication'])delete value[key];return {record:value,sources,images};}
const materialize=(state,id)=>({...copy(state.record),id,title:state.record.title||'Untitled place',sources:Object.entries(state.sources||{}).map(([source_id,source])=>({...source,source_id})),...(Object.keys(state.images||{}).length?{images:Object.values(state.images)}:{}),direct_publication:true,status:'published',review_state:'published'});
const active=rows=>rows.filter(row=>row.review_state==='published');
function eventData(row){return {...JSON.parse(row.event_json),id:row.id,submission_id:row.submission_id,created_at:row.created_at};}
export function directProjection(id,base,rows){
 const state={...normalizedRecord(base),notes:{}},history=[],names=new Set(),effects=new Map();
 for(const row of active(rows)){
  const event=eventData(row),changes=[],applied=[];
  // An inverse refers to the active predecessor, never a copied historical value.
  // Withdrawing that predecessor also withdraws values derived from it by Undo.
  const patches=event.undo_of?(effects.get(event.undo_of)||[]).map(c=>({path:c.path,after:c.before})):[...(event.changes||[]),...(event.note?[{path:['notes',row.submission_id],after:{...event.note,id:row.submission_id,moniker:event.moniker,created_at:row.created_at}}]:[])];
  for(const change of patches){const before=read(state,change.path);write(state,change.path,change.after);applied.push({path:change.path,before,after:change.after});changes.push({field:change.path[0]==='notes'?'Note':change.path[0]==='sources'?'Source · '+(change.path.slice(2).join(' · ')||'reference'):change.path.slice(1).join(' · '),before,after:change.after});}
  effects.set(row.id,applied);
  history.push({id:row.id,record_id:id,moniker:event.moniker,created_at:row.created_at,summary:event.summary,kind:event.kind,changes});names.add(event.moniker);
 }
 const record=materialize(state,id);record.notes=Object.values(state.notes);record.contributors=[...names];return{record,state,history,effects};
}
export async function directHistory(db,id){
 if(!idValid(id))fail('invalid_record_id');
 const row=await db.prepare('SELECT derived_json FROM approved_records WHERE id=?').bind(id).first();
 const base=row?JSON.parse(row.derived_json).direct_base:undefined;if(base===undefined)return{items:[]};
 const {results=[]}=await db.prepare("SELECT e.*,s.review_state FROM workflow_events e JOIN workflow_submissions s ON s.id=e.submission_id WHERE e.kind='direct_publish' AND json_extract(e.event_json,'$.record_id')=? ORDER BY CAST(json_extract(e.event_json,'$.version') AS INTEGER),e.id").bind(id).all();
 return{items:directProjection(id,base,results).history.reverse()};
}
export function createDirectPublisher({store,resolveTarget,preview,audit,receipt,revisionRow,response,readableHead}){
 const rowsFor=id=>store.directEvents(id);
 async function stateFor(id){const stored=await store.getRecord(id),target=await resolveTarget(id);if(stored&&!target)fail('record_not_public',409);const metadata=stored?JSON.parse(stored.derived_json):null;const base=metadata&&own(metadata,'direct_base')?metadata.direct_base:target?.record||{};return{stored,target,base,rows:await rowsFor(id),version:stored?.version??(target?.expected_version||0),hash:stored?.hash??target?.expected_hash??null};}
 function checkTarget(envelope,state){const expected=envelope.targets?.[0];if(!expected||!state.target||expected.expected_version!==state.target.expected_version||expected.expected_hash!==state.target.expected_hash||state.stored&&(state.stored.version!==state.target.expected_version||state.stored.hash!==state.target.expected_hash))fail('stale_target',409);}
 async function projection(id,state,rows,eventId,at){const result=directProjection(id,state.base,rows);if(!active(rows).length&&!Object.keys(state.base).length)return null;const raw=JSON.stringify(result.record);return{id,owner_id:'shared',preview_id:'direct_'+id,raw_json:raw,raw_hash:await hash(raw),derived_json:JSON.stringify({publication_mode:'direct',direct_base:state.base}),preview_hash:eventId,approved_at:at};}
 async function commit(actor,body,action,head,raw,p,event,state,at){
  const revision=(head?.current_revision||0)+1,id=head?.id||event.submission_id,rev=revisionRow(id,revision,actor,raw,p,at),next={id,owner_id:actor,current_revision:revision,review_state:'published',created_at:head?.created_at||at,updated_at:at};
  const entry=audit(actor,'direct_publish',id,revision,at,{...event,version:state.version+1});
  const rows=[...state.rows,{...entry,review_state:'published'}],after=await projection(event.record_id,state,rows,entry.id,at);
  const rec=await receipt(actor,action,body,at,{submission_id:id,revision,record_id:event.record_id,event_id:entry.id,published:true});
  const saved=await store.commitDirect(rec,{head:next,previous:head,revision:rev,event:entry,target:{record_id:event.record_id,before:state.stored,before_version:state.target?.origin==='static_inventory'?state.target.expected_version:state.stored?.version||0,...(state.target?.origin==='static_inventory'?{origin:'static_inventory',operation:'update_record'}:{}),after,after_version:state.version+1,after_hash:after?await snapshotHash(after):'absent'}});
  return response(saved.receipt,actor,saved.reused);
 }
 return {
  async publish(actor,b,at){
   let head=null,raw=b.submission_json;
   if(b.submission_id){head=await readableHead(b.submission_id);if(head.owner_id!==actor)fail('submission_not_found',404);if(head.current_revision!==b.expected_revision)fail('revision_conflict',409);if(['published','revoked'].includes(head.review_state))fail('already_published_or_revoked',409);if((await store.jobsForSubmission(head.id)).some(j=>['verified','conflict'].includes(j.status)))fail('legacy_release_requires_resolution',409);if(!raw)raw=(await store.getRevision(head.id,head.current_revision)).raw_json;}
   let envelope;try{envelope=JSON.parse(raw||'null');}catch{fail('invalid_submission_json');}if(!envelope||typeof envelope!=='object')fail('invalid_submission_json');
   const moniker=typeof b.moniker==='string'?b.moniker:envelope.public_credit?.identity==='moniker'?envelope.public_credit.label:'';
   if(!moniker?.trim()||moniker.length>120||/[@\u0000-\u001f\u007f]/.test(moniker))fail('public_moniker_required');
   envelope.public_credit={consent:true,label:moniker.trim(),identity:'moniker'};raw=JSON.stringify(envelope);
   const p=await preview(raw,head?.id);if(!p.validation.valid)fail(p.validation.errors[0]?.code||'validation_failed',409);
   const summary=typeof b.change_summary==='string'?b.change_summary.trim():'';if(!summary||summary.length>2000)fail('change_summary_required');
   const id=head?.id||'ws_'+crypto.randomUUID();let recordId=envelope.targets?.[0]?.record_id,state,changes=[],note=null,kind;
   if(envelope.type==='record_update'){
    state=await stateFor(recordId);if(!state.target)fail('record_not_found',404);checkTarget(envelope,state);
    const before=directProjection(recordId,state.base,state.rows).record;
    const after=RecordEditModel.applyChanges(before,envelope.payload.changes,(envelope.payload.source_additions||[]).map(s=>({...s,source_id:'source_'+crypto.randomUUID()})));
    changes=difference(normalizedRecord(before),normalizedRecord(after));kind='edit';
   }else if(['open_proposal','record_annotation'].includes(envelope.type)){
    if(recordId){state=await stateFor(recordId);if(!state.target)fail('record_not_found',404);checkTarget(envelope,state);note={text:envelope.type==='open_proposal'?(envelope.payload.explanation??''):envelope.payload.text,sources:envelope.payload.sources_text||'',...(envelope.sources.length?{source_references:envelope.sources}:{}),...(envelope.type==='record_annotation'?{details:{original_wording:envelope.payload.original_wording,uncertainty_note:envelope.payload.uncertainty_note,dates:envelope.payload.dates}}:{}),...(envelope.payload.attributes?.length?{attributes:envelope.payload.attributes}:{})};kind='note';}
    else{
     const c=envelope.payload?.geometry?.coordinates;if(envelope.type!=='open_proposal'||!Array.isArray(c)||c.length!==2)fail('place_or_point_required',409);
     recordId='place_'+id.slice(3);state=await stateFor(recordId);if(state.stored)fail('record_exists',409);
     const record={id:recordId,title:envelope.title,description:envelope.payload.explanation,location_text:envelope.payload.location_text||'',latitude:c[1],longitude:c[0],geo_status:'approximate',sources:envelope.sources.map((s,i)=>({...s,source_id:'source_'+i}))};
     if(envelope.payload.sources_text)record.sources.push({source_id:'source_freeform',title:envelope.payload.sources_text});
     if(envelope.payload.attributes?.length)record.attributes=envelope.payload.attributes;
     changes=difference(normalizedRecord({}),normalizedRecord(record));kind='create';
    }
   }else fail('unsupported_direct_type',409);
   for(const image of selectedPublicImages(envelope.attachments,b.public_image_ids))changes.push({path:['images',image.attachment_id],before:null,after:image});
   return commit(actor,b,'publish',head,raw,p,{submission_id:id,record_id:recordId,kind,summary,moniker:moniker.trim(),changes,...(note?{note}:{})},state,at);
  },
  async undo(actor,b,at){
   if(!idValid(b.event_id))fail('invalid_event_id');
   const event=await store.directEvent(b.event_id);if(!event||event.review_state!=='published')fail('history_not_found',404);
   const prior=eventData(event),state=await stateFor(prior.record_id);if(!state.target||state.target.expected_version!==b.expected_version||state.target.expected_hash!==b.expected_hash)fail('stale_target',409);
   const projection=directProjection(prior.record_id,state.base,state.rows),current=projection.state;
   const changes=(projection.effects.get(event.id)||[]).map(c=>{if(!equal(read(current,c.path),c.after))fail('undo_conflict',409);return{path:c.path,before:c.after,after:c.before};});
   if(!changes.length)fail('nothing_to_undo',409);
   if(typeof b.moniker!=='string'||!b.moniker.trim()||b.moniker.length>120||/[@\u0000-\u001f\u007f]/.test(b.moniker))fail('public_moniker_required');
   if(typeof b.change_summary!=='string'||!b.change_summary.trim()||b.change_summary.length>2000)fail('change_summary_required');
   const id='ws_'+crypto.randomUUID(),envelope={schema_version:'1.0',type:'open_proposal',task_ids:[],title:'Undo change',summary:b.change_summary,public_credit:{consent:true,label:b.moniker,identity:'moniker'},sources:[],attachments:[],targets:[],payload:{explanation:b.change_summary}};
   const raw=JSON.stringify(envelope),p=await preview(raw);
   return commit(actor,b,'undo',null,raw,p,{submission_id:id,record_id:prior.record_id,kind:'undo',undo_of:event.id,summary:b.change_summary,moniker:b.moniker.trim(),changes},state,at);
  },
  async revoke(actor,b,head,at){
   if(head.owner_id!==actor)fail('submission_not_found',404);if(head.current_revision!==b.expected_revision)fail('revision_conflict',409);
   const events=await store.directEventsForSubmission(head.id);if(!events.length)return null;
   if(head.review_state!=='published')fail('not_published',409);
   const ids=[...new Set(events.map(e=>JSON.parse(e.event_json).record_id))];if(ids.length!==1)fail('invalid_direct_history',409);
   const id=ids[0],state=await stateFor(id),rows=state.rows.map(r=>r.submission_id===head.id?{...r,review_state:'revoked'}:r);
   const ev=audit(actor,'direct_revoke',head.id,head.current_revision,at,{record_id:id}),after=await projection(id,state,rows,ev.id,at),rec=await receipt(actor,'revoke',b,at,{submission_id:head.id,revision:head.current_revision,record_id:id});
   const saved=await store.revokeDirect(rec,head,ev,{record_id:id,before:state.stored,before_version:state.stored?.version||0,after,after_version:state.version+1,after_hash:after?await snapshotHash(after):'absent'},at);return response(saved.receipt,actor,saved.reused);
  }
 };
}
