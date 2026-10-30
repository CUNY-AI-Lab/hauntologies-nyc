import {bytesHash} from './contribution-media.mjs';
import {fail} from './workflow-core.mjs';
const idValid=id=>typeof id==='string'&&/^watt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export const knownImageRights=value=>typeof value==='string'&&!!value.trim()&&!/^(unknown|unspecified|unresolved|not known|n\/a)$/i.test(value.trim());

// Called only after the existing owner/revision/reference validation succeeds.
// Uploading a file alone never makes it public; the publish request selects IDs.
export function selectedPublicImages(attachments,ids=[]){
 if(!Array.isArray(ids)||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!idValid(id)))fail('invalid_public_images');
 return ids.map(id=>{
  const ref=attachments.find(ref=>ref.attachment_id===id);if(!ref)fail('attachment_reference_invalid');
  const m=ref.metadata||{};if(!knownImageRights(m.rights))fail('image_rights_required');
  return {attachment_id:id,sha256:ref.sha256,url:'/api/public-image?id='+id,width:ref.width,height:ref.height,caption:m.caption||'',alt:m.alt||'',credit:m.credit||'',sourceUrl:m.source_url||'',license:m.rights};
 });
}

export async function handlePublicImage(request,db){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'};
 const error=status=>Response.json({error:status===404?'image_not_public':status===400?'invalid_query':'image_unavailable'},{status,headers});
 if(!['GET','HEAD'].includes(request.method))return Response.json({error:'method_not_allowed'},{status:405,headers});
 const q=new URL(request.url).searchParams,id=q.get('id');if(q.size!==1||q.getAll('id').length!==1||!idValid(id))return error(400);
 try{
  const row=await db.prepare(`SELECT m.sha256,m.byte_length,m.media_type,m.image_blob,m.metadata_json
   FROM contribution_media m JOIN workflow_submissions s ON s.id=m.submission_id AND s.owner_id=m.owner_id
   JOIN workflow_revisions r ON r.submission_id=s.id AND r.revision=s.current_revision
   WHERE m.id=? AND s.review_state='published'
   AND EXISTS(SELECT 1 FROM json_each(r.raw_json,'$.attachments') a WHERE json_extract(a.value,'$.attachment_id')=m.id AND json_extract(a.value,'$.sha256')=m.sha256)
   AND EXISTS(SELECT 1 FROM approved_records p,json_each(p.raw_json,'$.images') image
     WHERE json_extract(p.derived_json,'$.publication_mode')='direct'
     AND json_extract(image.value,'$.attachment_id')=m.id AND json_extract(image.value,'$.sha256')=m.sha256)
   LIMIT 1`).bind(id).first();
  if(!row||!knownImageRights(JSON.parse(row.metadata_json).rights))return error(404);
  const bytes=new Uint8Array(row.image_blob);if(bytes.length!==row.byte_length||await bytesHash(bytes)!==row.sha256)return error(503);
  const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[row.media_type];if(!extension)return error(503);
  return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers,'Content-Type':row.media_type,'Content-Length':String(bytes.length),'Content-Disposition':'inline; filename="image.'+extension+'"','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }catch{return error(503);}
}
