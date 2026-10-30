// Offline planner only. It creates guarded forward/rollback SQL against a private
// snapshot; it has no credentials, network calls, or production execution path.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorkflowStore} from '../../server/workflow-store.mjs';
import {createWorkflowService} from '../../server/workflow-service.mjs';
import {publicCredit} from '../../server/record-credits.mjs';
import {LEGACY_TRANSITION_POLICY} from '../../server/public-attribution.mjs';
import {knownImageRights} from '../../server/public-images.mjs';
import {hash,stable} from '../../server/workflow-core.mjs';
import {parseStaticRecords} from '../../server/static-targets.mjs';

const cutoff='2026-10-30T06:46:00.000Z';
const fields={
 workflow_submissions:['id','owner_id','current_revision','review_state','created_at','updated_at'],
 workflow_revisions:['id','submission_id','revision','actor_id','raw_json','raw_hash','payload_hash','diff_hash','preview_json','created_at'],
 workflow_events:['id','submission_id','job_id','revision','actor_id','kind','event_json','created_at'],
 workflow_jobs:['id','submission_id','revision','approval_id','status','operation_hash','manifest_json','verification_json','created_at','updated_at'],
 workflow_approvals:['id','submission_id','revision','reviewer_id','approval_hash','binding_json','created_at'],
 contribution_media:['id','submission_id','owner_id','sha256','byte_length','media_type','width','height','metadata_json','created_at'],
 approved_records:['id','owner_id','preview_id','raw_json','raw_hash','derived_json','preview_hash','approved_at'],
 workflow_targets:['record_id','version','record_hash','job_id','updated_at'],
};
const quote=value=>value===null?'NULL':typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?"'"+value.replaceAll("'","''")+"'":(()=>{throw Error('Unsupported SQL value');})();
const objectSQL=(table,columns)=>'json_object('+columns.flatMap(key=>[quote(key),table+'.'+key]).join(',')+')';
const selector=table=>table==='workflow_submissions'?'id IN (SELECT id FROM eligible)':table==='approved_records'?'id IN (SELECT id FROM target_ids)':table==='workflow_targets'?'record_id IN (SELECT id FROM target_ids)':'submission_id IN (SELECT id FROM eligible)';
export const LEGACY_SNAPSHOT_SQL=`WITH eligible AS MATERIALIZED (
 SELECT s.id,s.owner_id FROM workflow_submissions s
 WHERE s.review_state IN ('submitted','approved','merged','published') AND s.created_at<${quote(cutoff)}
 AND NOT EXISTS(SELECT 1 FROM workflow_events e WHERE e.submission_id=s.id AND e.kind='direct_publish')
 ORDER BY s.id LIMIT 21
), target_ids AS MATERIALIZED (
 SELECT 'place_'||substr(id,4) AS id FROM eligible
 UNION SELECT json_extract(t.value,'$.record_id') FROM workflow_revisions r, json_each(r.raw_json,'$.targets') t WHERE r.submission_id IN (SELECT id FROM eligible)
 UNION SELECT json_extract(t.value,'$.record_id') FROM workflow_jobs j,json_each(j.manifest_json,'$.targets') t WHERE j.submission_id IN (SELECT id FROM eligible)
)
SELECT json_object(
${Object.entries(fields).map(([table,columns])=>`${quote(table)},(SELECT json_group_array(${objectSQL(table,columns)}) FROM ${table} WHERE ${selector(table)})`).join(',\n')},
'owners',(SELECT json_group_array(json_object('owner_id',e.owner_id,'verified',COALESCE(u.emailVerified,0),'prefix',CASE WHEN u.emailVerified=1 AND instr(u.email,'@')>1 THEN substr(u.email,1,instr(u.email,'@')-1) END,'hidden',EXISTS(SELECT 1 FROM contributor_roster_hidden h WHERE h.user_id=u.id))) FROM (SELECT DISTINCT owner_id FROM eligible) e LEFT JOIN hny_auth_user u ON 'map_'||u.id=e.owner_id)) AS snapshot`;
const keyOf=table=>table==='workflow_targets'?'record_id':'id';
const same=(a,b)=>stable(a)===stable(b);
const where=row=>Object.entries(row).map(([key,value])=>key+' IS '+quote(value)).join(' AND ');
const snapshotTables=native=>Object.fromEntries([...Object.keys(fields).filter(t=>t!=='contribution_media'),'workflow_receipts'].map(table=>[table,native.prepare('SELECT * FROM '+table+' ORDER BY '+keyOf(table)).all()]));
const validName=name=>typeof name==='string'&&!!name.trim()&&name.length<=120&&!/[@\u0000-\u001f\u007f]/.test(name);
// Legacy imports need an affirmative rights statement. A repository or creator
// name is attribution, not evidence of permission to publish an old upload.
export const legacyImageMayPublish=rights=>knownImageRights(rights)&&/^(?:cc0\b|cc[ -]by\b|public domain\b|https?:\/\/creativecommons\.org\/(?:publicdomain|licenses)\/|(?:used with permission|published with permission|permission granted|i own the (?:image|photo|copyright))\b)/i.test(rights.trim());
const insertSQL=(table,row,guard='1')=>`INSERT INTO ${table} (${Object.keys(row).join(',')}) SELECT ${Object.values(row).map(quote).join(',')} WHERE ${guard}`;

export function decodeLegacySnapshot(rows){return rows.length===1&&typeof rows[0].snapshot==='string'?Object.entries(JSON.parse(rows[0].snapshot)).flatMap(([section,items])=>items.map(data=>({section,data:JSON.stringify(data)}))):rows;}

export async function planLegacyTransition(snapshot,{at=new Date().toISOString()}={}){
 if(!Array.isArray(snapshot)||snapshot.length>2000)throw Error('Bounded snapshot required');
 const grouped=Object.fromEntries([...Object.keys(fields),'owners'].map(table=>[table,[]]));
 for(const row of snapshot){if(!Object.hasOwn(grouped,row.section))throw Error('Unknown snapshot section');grouped[row.section].push(typeof row.data==='string'?JSON.parse(row.data):row.data);}
 if(grouped.workflow_submissions.length>20)throw Error('Legacy candidate bound exceeded');
 const native=new DatabaseSync(':memory:'),journal=[];
 try{
  for(const f of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())native.exec(readFileSync(new URL('../../drizzle/'+f,import.meta.url),'utf8'));
  for(const owner of grouped.owners){
   if(!owner.owner_id.startsWith('map_'))continue;
   // Synthetic account placeholders exist only in this offline SQLite preview.
   native.prepare('INSERT INTO hny_auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(owner.owner_id.slice(4),'Offline snapshot',String(owner.prefix||owner.owner_id)+'@'+owner.owner_id.slice(4)+'.snapshot.invalid',owner.verified,at,at);
   if(owner.hidden)native.prepare('INSERT INTO contributor_roster_hidden(user_id,created_at) VALUES (?,?)').run(owner.owner_id.slice(4),at);
  }
  for(const [table,columns] of Object.entries(fields))for(const row of grouped[table]){
   if(Object.keys(row).sort().join()!==[...columns].sort().join())throw Error('Snapshot columns changed: '+table);
   if(table==='contribution_media')native.prepare(`INSERT INTO ${table} (${columns.join(',')},image_blob) VALUES (${columns.map(()=>'?').join(',')},zeroblob(?))`).run(...columns.map(k=>row[k]),row.byte_length);
   else native.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(k=>row[k]));
  }
  const before=snapshotTables(native),planId=crypto.randomUUID(),rollbackId='wrc_'+crypto.randomUUID(),operation=LEGACY_TRANSITION_POLICY+':'+planId;
  const owners=new Map(grouped.owners.map(owner=>[owner.owner_id,owner]));
  const report={policy:LEGACY_TRANSITION_POLICY,cutoff,publications:0,new_places:0,notes:0,username_backfills:0,public_images:0,private_images:0,images_needing_rights_review:0,colliding_prefix_groups:0,skipped:[]};
  const groupedPrefixes=new Map();for(const o of owners.values())if(o.verified&&validName(o.prefix)){const key=o.prefix.toLowerCase();groupedPrefixes.set(key,(groupedPrefixes.get(key)||0)+1);}report.colliding_prefix_groups=[...groupedPrefixes.values()].filter(n=>n>1).length;
  let guardHead=null;
  const prepare=(sql,args=[])=>({bind(...values){return prepare(sql,values);},async all(){return{results:native.prepare(sql).all(...args)};},async first(key){const row=native.prepare(sql).get(...args)||null;return key&&row?row[key]:row;},async run(){return native.prepare(sql).run(...args);},sql,args});
  const db={prepare,async batch(statements){
   native.exec('BEGIN');try{
    const queries=statements.map(s=>({...s,args:[...s.args]}));
    if(guardHead){const owner=owners.get(guardHead.owner_id),first=queries[0];
     first.sql+=` AND EXISTS(SELECT 1 FROM hny_auth_user WHERE 'map_'||id=? AND emailVerified=1 AND substr(email,1,instr(email,'@')-1)=?) AND NOT EXISTS(SELECT 1 FROM workflow_jobs WHERE submission_id=?) AND NOT EXISTS(SELECT 1 FROM workflow_receipts WHERE id=?)`;
     first.args.push(guardHead.owner_id,owner.prefix,guardHead.id,rollbackId);
     const sourceRevision=grouped.workflow_revisions.find(r=>r.submission_id===guardHead.id&&r.revision===guardHead.current_revision);
     first.sql+=" AND NOT EXISTS(SELECT 1 FROM contributor_roster_hidden WHERE 'map_'||user_id=?) AND EXISTS(SELECT 1 FROM workflow_revisions WHERE submission_id=? AND revision=? AND raw_hash=? AND raw_json=?)";first.args.push(guardHead.owner_id,guardHead.id,guardHead.current_revision,sourceRevision.raw_hash,sourceRevision.raw_json);
     first.args[5]=JSON.stringify({...JSON.parse(first.args[5]),_migration_applied:0});
     for(const q of queries.slice(1))q.sql=q.sql.replaceAll('EXISTS (SELECT 1 FROM workflow_receipts WHERE id=?)',"EXISTS (SELECT 1 FROM workflow_receipts WHERE id=? AND json_extract(result_json,'$._migration_applied')=0)");
     queries.push({sql:"UPDATE workflow_receipts SET result_json=json_set(result_json,'$._migration_applied',1) WHERE id=?",args:[first.args[0]]});
    }
    const results=queries.map(q=>native.prepare(q.sql).run(...q.args));
    native.exec('COMMIT');journal.push(...queries.map(({sql,args})=>({sql,args})));return results;
   }catch(error){native.exec('ROLLBACK');throw error;}
  }};
  const store=createWorkflowStore(db),commit=store.commitDirect;
  store.commitDirect=(receipt,change)=>{change.event.event_json=JSON.stringify({...JSON.parse(change.event.event_json),migration:{policy:LEGACY_TRANSITION_POLICY,operation,initiated_by:'authorized_operator',attribution:'verified_owner'}});return commit(receipt,change);};
  const staticRecords=parseStaticRecords(readFileSync(new URL('../../public/inventory.js',import.meta.url),'utf8'),readFileSync(new URL('../../public/pilot.js',import.meta.url),'utf8'));
  const service=createWorkflowService({store,staticRecords,publicationMode:'direct',geography:{boundaries:JSON.parse(readFileSync(new URL('../../public/data/nyc-borough-boundaries.geojson',import.meta.url),'utf8'))},now:()=>new Date(at)});
  for(const head of grouped.workflow_submissions){
   const skip=reason=>report.skipped.push({submission_id:head.id,reason});
   const owner=owners.get(head.owner_id),revision=grouped.workflow_revisions.find(r=>r.submission_id===head.id&&r.revision===head.current_revision);
   if(!owner?.verified||!validName(owner.prefix)){skip('missing_or_invalid_verified_owner_prefix');continue;}
   if(head.created_at>=cutoff||!['submitted','approved','merged','published'].includes(head.review_state)||!revision){skip('ineligible_state_or_revision');continue;}
   if(await hash(revision.raw_json)!==revision.raw_hash)throw Error('Snapshot revision hash mismatch');
   const events=grouped.workflow_events.filter(e=>e.submission_id===head.id),jobs=grouped.workflow_jobs.filter(j=>j.submission_id===head.id);
   if(!events.some(e=>e.actor_id===head.owner_id&&['submit','revise'].includes(e.kind)&&JSON.parse(e.event_json).to_state==='submitted')){skip('owner_publication_intent_unproven');continue;}
   const envelope=JSON.parse(revision.raw_json),chosen=envelope.public_credit?.label?.trim();
   if(chosen&&!publicCredit(revision.raw_json)){skip('existing_attribution_choice_requires_resolution');continue;}
   if(['merged','published'].includes(head.review_state)){
    if(chosen||owner.hidden)continue;
    for(const job of jobs.filter(j=>j.status==='verified')){
     const r=grouped.workflow_revisions.find(r=>r.submission_id===head.id&&r.revision===job.revision),a=grouped.workflow_approvals.find(a=>a.id===job.approval_id&&a.revision===job.revision);
     if(!r||JSON.parse(r.raw_json).public_credit?.label?.trim()||!a||a.reviewer_id===head.owner_id&&JSON.parse(a.binding_json).admin_self_approval!==1&&JSON.parse(a.binding_json).admin_self_approval!==true)continue;
     if(events.some(e=>e.kind==='public_attribution'&&e.revision===r.revision))continue;
     const row={id:'wfe_'+crypto.randomUUID(),submission_id:head.id,job_id:job.id,revision:r.revision,actor_id:head.owner_id,kind:'public_attribution',event_json:JSON.stringify({policy:LEGACY_TRANSITION_POLICY,operation,initiated_by:'authorized_operator',public_credit:{consent:true,identity:'email_prefix',label:owner.prefix}}),created_at:at};
     const guard=`EXISTS(SELECT 1 FROM workflow_submissions WHERE ${where(head)}) AND EXISTS(SELECT 1 FROM workflow_jobs WHERE ${where(job)}) AND EXISTS(SELECT 1 FROM hny_auth_user WHERE 'map_'||id=${quote(head.owner_id)} AND emailVerified=1 AND substr(email,1,instr(email,'@')-1)=${quote(owner.prefix)}) AND NOT EXISTS(SELECT 1 FROM contributor_roster_hidden WHERE 'map_'||user_id=${quote(head.owner_id)}) AND NOT EXISTS(SELECT 1 FROM workflow_events WHERE submission_id=${quote(head.id)} AND revision=${r.revision} AND kind='public_attribution') AND NOT EXISTS(SELECT 1 FROM workflow_receipts WHERE id=${quote(rollbackId)})`;
     const sql=insertSQL('workflow_events',row,guard);native.exec(sql);journal.push({sql,args:[]});report.username_backfills++;
    }
    continue;
   }
   if(owner.hidden){skip('public_attribution_withheld');continue;}
   if(jobs.length){skip('legacy_job_requires_resolution');continue;}
   if(envelope.type!=='open_proposal'){skip('unsupported_legacy_type');continue;}
   // Notes are additive. Re-resolve their public target rather than replaying a
   // historical record edit or guessing changed field values.
   if(envelope.targets.length){
    const response=await service.handle(new Request('https://offline.invalid/api/contributions/target?id='+encodeURIComponent(envelope.targets[0].record_id),{headers:{'oai-authenticated-user-id':head.owner_id}}));
    const resolved=await response.json();if(response.status!==200||!resolved.target){skip('target_not_public');continue;}
    envelope.targets=[{record_id:resolved.target.record_id,expected_version:resolved.target.expected_version,expected_hash:resolved.target.expected_hash}];
   }
   const publicImages=envelope.attachments.filter(a=>legacyImageMayPublish(a.metadata?.rights)).map(a=>a.attachment_id);
   const body={idempotency_key:LEGACY_TRANSITION_POLICY+'_'+head.id+'_'+head.current_revision,submission_id:head.id,expected_revision:head.current_revision,submission_json:JSON.stringify(envelope),moniker:chosen||owner.prefix,change_summary:'Publish the previously review-submitted contribution',public_image_ids:publicImages};
   guardHead=head;
   const response=await service.handle(new Request('https://offline.invalid/api/contributions/publish',{method:'POST',headers:{'content-type':'application/json',origin:'https://offline.invalid','oai-authenticated-user-id':head.owner_id},body:JSON.stringify(body)}));
   guardHead=null;const result=await response.json();
   if(response.status!==200){skip('validation_'+result.error);continue;}
   report.publications++;report[envelope.targets.length?'notes':'new_places']++;report.public_images+=publicImages.length;report.private_images+=envelope.attachments.length-publicImages.length;
   report.images_needing_rights_review+=envelope.attachments.filter(a=>knownImageRights(a.metadata?.rights)&&!legacyImageMayPublish(a.metadata?.rights)).length;
  }
  const after=snapshotTables(native),changes=[];
  for(const table of Object.keys(before)){const key=keyOf(table),left=new Map(before[table].map(r=>[r[key],r])),right=new Map(after[table].map(r=>[r[key],r]));for(const id of new Set([...left.keys(),...right.keys()]))if(!same(left.get(id)||null,right.get(id)||null))changes.push({table,before:left.get(id)||null,after:right.get(id)||null,key,id});}
  const forwardStatements=journal.map(q=>{let i=0;const sql=q.args.length?q.sql.replace(/\?/g,()=>quote(q.args[i++])):q.sql;if(i!==q.args.length||sql.length>90000)throw Error('Unsafe or oversized SQL statement');return sql+';';});
  const forward=forwardStatements.join('\n');
  const guard=changes.map(c=>c.after?`EXISTS(SELECT 1 FROM ${c.table} WHERE ${where(c.after)})`:`NOT EXISTS(SELECT 1 FROM ${c.table} WHERE ${c.key}=${quote(c.id)})`).concat(grouped.workflow_submissions.map(s=>`(SELECT COUNT(*) FROM workflow_events WHERE submission_id=${quote(s.id)})=${after.workflow_events.filter(e=>e.submission_id===s.id).length}`)).join(' AND ')||'0';
  const receipt={id:rollbackId,actor_id:'operator:'+LEGACY_TRANSITION_POLICY,idempotency_key:operation+':rollback',action:'legacy_transition_rollback',request_hash:await hash(forward),result_json:JSON.stringify({operation,restored_changes:changes.length,applied:0}),created_at:at};
  const rollbackGuard=`EXISTS(SELECT 1 FROM workflow_receipts WHERE id=${quote(rollbackId)} AND json_extract(result_json,'$.applied')=0)`;
  const rollbackStatements=[insertSQL('workflow_receipts',receipt,guard).replace('INSERT INTO','INSERT OR IGNORE INTO')+';',...changes.slice().reverse().map(c=>c.before?`INSERT INTO ${c.table} (${Object.keys(c.before).join(',')}) SELECT ${Object.values(c.before).map(quote).join(',')} WHERE ${rollbackGuard} ON CONFLICT(${c.key}) DO UPDATE SET ${Object.keys(c.before).filter(k=>k!==c.key).map(k=>k+'=excluded.'+k).join(',')};`:`DELETE FROM ${c.table} WHERE ${c.key}=${quote(c.id)} AND ${rollbackGuard};`),`UPDATE workflow_receipts SET result_json=json_set(result_json,'$.applied',1) WHERE id=${quote(rollbackId)};`];
  if(rollbackStatements.some(sql=>Buffer.byteLength(sql)>90000))throw Error('Rollback statement exceeds D1 bound');
  const rollback=rollbackStatements.join('\n');
  // Exercise exact planned SQL, rollback, and replay locally. Recoverable copies
  // of both states accompany the plan; no original participant row is deleted.
  native.exec(forward);if(!same(snapshotTables(native),after))throw Error('Forward replay changed state');
  native.exec(rollback);native.exec(rollback);for(const [table,rows] of Object.entries(before)){const actual=native.prepare('SELECT * FROM '+table+(table==='workflow_receipts'?' WHERE id<>'+quote(rollbackId):'')+' ORDER BY '+keyOf(table)).all();if(!same(actual,rows))throw Error('Rollback mismatch: '+table);}
  native.exec(forward);for(const [table,rows] of Object.entries(before)){const actual=native.prepare('SELECT * FROM '+table+(table==='workflow_receipts'?' WHERE id<>'+quote(rollbackId):'')+' ORDER BY '+keyOf(table)).all();if(!same(actual,rows))throw Error('Rolled-back plan replayed: '+table);}
  return{schema_version:1,operation,at,report,source_snapshot_hash:await hash(stable(snapshot)),forward_sql:forward,rollback_sql:rollback,forward_statements:forwardStatements,rollback_statements:rollbackStatements,before,after,requires_serving_code:true};
 }finally{native.close();}
}
