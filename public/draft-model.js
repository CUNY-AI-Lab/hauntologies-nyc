'use strict';
(function(root){
 const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}};
 const blank=value=>value===null||value===undefined||value==='';
 const validCoordinates=(lat,lon)=>!blank(lat)&&!blank(lon)&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&Number(lat)>=40.45&&Number(lat)<=40.98&&Number(lon)>=-74.30&&Number(lon)<=-73.65;
 function parseSources(value){
  if(blank(value))return [];
  let sources=value;
  if(typeof sources==='string'){try{sources=JSON.parse(sources)}catch{throw Error('Sources must contain a valid JSON array.')}}
  if(!Array.isArray(sources))throw Error('Sources must be an array of source objects.');
  return sources.map((source,index)=>{
   if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Source '+(index+1)+' must be a source object.');
   for(const key of ['url','sourceUrl'])if(!blank(source[key])&&!safeUrl(source[key]))throw Error('Source '+(index+1)+' needs an http/https URL without embedded credentials.');
   return structuredClone(source);
  });
 }
 function draftFrom(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('A draft must be a record object.');
  if(!raw.title||!raw.evidence_summary||!raw.source_title||!safeUrl(raw.source_url)||!(validCoordinates(raw.latitude,raw.longitude)||(blank(raw.latitude)&&blank(raw.longitude))))throw Error('Each record needs a title, evidence_summary, source_title, an http/https source_url without embedded credentials, and either NYC latitude/longitude or both coordinates left blank.');
  if(!blank(raw.geocode_source_url)&&!safeUrl(raw.geocode_source_url))throw Error('The coordinate source needs an http/https URL without embedded credentials.');
  const sources=parseSources(raw.sources);
  let original=raw.original_submission;
  if(typeof original==='string'&&original){try{original=JSON.parse(original)}catch{throw Error('Original submission must contain valid JSON.')}}
  if(blank(original))original=raw;
  const keys=['title','place_id','location_text','claim_status','location_precision','geocode_method','geocode_source_url','event_date_start','event_date_end','event_date_precision','record_date','earliest_source_found_date','source_title','source_url','source_page_or_id','source_type','evidence_summary','interpretation','uncertainty_note','rights_or_license','checked_date','category','borough','built','demolished'];
  const record=Object.fromEntries(keys.map(key=>[key,String(raw[key]??'')]));
  Object.assign(record,{id:'draft-'+crypto.randomUUID(),status:'draft',category:'draft',latitude:blank(raw.latitude)?null:Number(raw.latitude),longitude:blank(raw.longitude)?null:Number(raw.longitude),source_url:safeUrl(raw.source_url),sources,original_submission:structuredClone(original),original_submission_json:typeof raw.original_submission_json==='string'?raw.original_submission_json:JSON.stringify(raw),proxy:raw.proxy===true||raw.proxy==='true'});
  for(const field of ['aliases','data_quality_flags']){
   let values=raw[field];if(blank(values))values=[];
   if(typeof values==='string'){try{values=JSON.parse(values)}catch{throw Error(field+' must contain a valid JSON array.')}}
   if(!Array.isArray(values))throw Error(field+' must be an array.');record[field]=values.map(String);
  }
  record.checked_date=record.checked_date||new Date().toISOString().slice(0,10);return record;
 }
 root.DraftModel=Object.freeze({safeUrl,draftFrom});
})(typeof window!=='undefined'?window:globalThis);
