'use strict';
// Restates an approved freeform proposal as a structured entry bundle. The proposal is never
// changed; the entry is a new submission that needs its own independent review before Apply.
// Shared by the browser and Node tests; the server's buildPreview remains the authority.
(function(root){
  const categories=Object.freeze({
    reported_haunting:{label:'Reported haunting',roles:['report']},
    vanished_place:{label:'Vanished place',roles:['existence','disappearance']},
  });
  const roles=Object.freeze(['report','existence','disappearance','context','geography']);
  const boroughs=Object.freeze(['unknown','Bronx','Brooklyn','Manhattan','Queens','Staten Island']);
  const precisions=Object.freeze(['unknown','year','range','circa']);
  const geoStatuses=Object.freeze(['approximate','located','unresolved']);
  const geoMethods=Object.freeze(['contextual_estimate','address_match','gazetteer','historic_map','unresolved']);
  const rightsStatuses=Object.freeze(['unknown','public_domain','licensed','permission','restricted']);
  const publicUses=Object.freeze(['citation_only','paraphrase','excerpt','media']);
  const licenses=Object.freeze(['CC0-1.0','CC-BY-4.0']);

  const parse=submission=>{try{const value=JSON.parse(submission?.raw_json);return value&&typeof value==='object'?value:null;}catch{return null;}};
  const pointOf=payload=>{const c=payload?.geometry?.type==='Point'?payload.geometry.coordinates:null;return Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)?{latitude:c[1],longitude:c[0]}:null;};
  const source=(role,today,values={})=>({role,citation:'',repository:'',locator:'',source_date_original:'unknown',accessed_on:today,evidence_note:'',rights_status:'unknown',rights_statement:'',public_use:'citation_only',url:'',...values});
  // The contributor's map pin is the evidence for an approximate point, cited back to the proposal.
  const pinSource=(submission,today)=>source('geography',today,{
    citation:'Hauntologies of New York contribution '+submission.id+', revision '+submission.revision+', map point placed by the contributor',
    repository:'Hauntologies of New York contributions',locator:'Proposal '+submission.id+', revision '+submission.revision,
    evidence_note:'Contributor-placed map point. Locates the reported place approximately; not independently verified.',
    rights_status:'permission',rights_statement:'Contributor-supplied location, cited only.'});

  // Every source role a category requires gets a row. Rows the publisher has started are kept;
  // untouched rows the new category no longer needs are dropped so they cannot block the check.
  const untouched=row=>!row.citation&&!row.repository&&!row.locator&&!row.evidence_note&&!row.rights_statement&&!row.url;
  function withRequiredSources(form,today){
    const needed=categories[form.category]?.roles||[];
    const sources=form.sources.filter(row=>row.role==='geography'||needed.includes(row.role)||!untouched(row));
    for(const role of needed){
      if(sources.some(row=>row.role===role))continue;
      const geography=sources.findIndex(row=>row.role==='geography');
      sources.splice(geography<0?sources.length:geography,0,source(role,today));
    }
    return {...form,sources};
  }

  function draft(submission,{today,entryId,borough='unknown'}){
    const envelope=parse(submission);
    if(!envelope||submission.type!=='open_proposal')throw new Error('Only freeform proposals can be promoted.');
    const payload=envelope.payload||{},point=pointOf(payload),credit=envelope.public_credit||{};
    const form={
      source:{id:submission.id,revision:submission.revision},
      public_credit:{consent:credit.consent===true,label:credit.consent===true&&typeof credit.label==='string'?credit.label:''},
      reference:{sources_text:payload.sources_text||'',attributes:Array.isArray(payload.attributes)?payload.attributes:[],location_text:payload.location_text||''},
      category:'reported_haunting',entry_id:entryId,title:envelope.title||'',claim_text:payload.explanation||envelope.summary||'',
      place_original:payload.location_text||'',place_normalized:'',borough:boroughs.includes(borough)?borough:'unknown',
      time_original:'unknown',time_precision:'unknown',time_start_year:null,time_end_year:null,time_basis:'The proposal does not establish a date.',
      geo_status:point?'approximate':'unresolved',geo_method:point?'contextual_estimate':'unresolved',
      geo_basis:point?'Point placed on the map by the contributor; not independently located.':'The proposal gives no usable location.',
      latitude:point?.latitude??null,longitude:point?.longitude??null,uncertainty_m:null,
      record_license:'',rights_notes:'',sources:point?[pinSource(submission,today)]:[],
    };
    return withRequiredSources(form,today);
  }

  const textOrNull=value=>typeof value==='string'&&value.trim()?value:null;
  const yearOrNull=value=>value===''||value===null||value===undefined?null:Number(value);
  function envelope(form){
    const contributor=form.public_credit.consent&&form.public_credit.label?form.public_credit.label:'Uncredited contributor';
    const located=form.geo_status!=='unresolved',unknownDate=form.time_precision==='unknown';
    const rows=form.sources.map((row,index)=>{
      const value={source_ref:form.entry_id+'-S'+String(index+1).padStart(2,'0'),entry_id:form.entry_id,role:row.role,citation:row.citation,repository:row.repository,locator:row.locator,
        source_date_original:row.source_date_original,accessed_on:row.accessed_on,evidence_note:row.evidence_note,rights_status:row.rights_status,rights_statement:row.rights_statement,public_use:row.public_use};
      if(textOrNull(row.url))value.url=row.url.trim();
      return value;
    });
    const geography=rows.find(row=>row.role==='geography');
    const entry={entry_id:form.entry_id,group_id:form.entry_id.split('-')[0],contributor,category:form.category,title:form.title,claim_text:form.claim_text,related_entry_id:null,
      place_original:form.place_original,place_normalized:form.place_normalized,borough:form.borough,modern_location:null,
      time_original:form.time_original,time_precision:form.time_precision,time_basis:form.time_basis,
      time_start_year:unknownDate?null:yearOrNull(form.time_start_year),time_end_year:unknownDate?null:yearOrNull(form.time_precision==='year'?form.time_start_year:form.time_end_year),
      geo_status:form.geo_status,geo_method:located?form.geo_method:'unresolved',geo_basis:form.geo_basis,
      latitude:located?form.latitude:null,longitude:located?form.longitude:null,geo_source_ref:located&&geography?geography.source_ref:null,
      uncertainty_m:located&&form.uncertainty_m!==''&&form.uncertainty_m!==null?Number(form.uncertainty_m):null,
      gap_question:null,gap_scope:null,gap_limitations:null,interpretation:null,record_license:form.record_license,rights_notes:form.rights_notes};
    return {schema_version:'1.0',type:'entry_bundle',task_ids:[],title:form.title,
      summary:'Restates approved proposal '+form.source.id+' (revision '+form.source.revision+') as a structured entry for independent review.',
      public_credit:{consent:form.public_credit.consent,label:form.public_credit.consent?form.public_credit.label:''},
      sources:[],attachments:[],targets:[],payload:{Entries:[entry],Sources:rows,SearchLog:[]}};
  }

  // An entry ID that is stable, group-prefixed and unlikely to collide; the server rejects a reused one.
  const newEntryId=(date,random)=>'HNY-'+date.replaceAll('-','')+'-'+random.slice(0,6).toUpperCase();
  const promotable=(submission,capabilities)=>!!capabilities?.can_apply&&submission?.type==='open_proposal'&&submission.status==='approved'&&submission.approval?.independent===true&&submission.approval?.revision===submission.revision;

  root.PromoteEntryModel=Object.freeze({categories,roles,boroughs,precisions,geoStatuses,geoMethods,rightsStatuses,publicUses,licenses,draft,withRequiredSources,envelope,newEntryId,promotable,source});
})(typeof window!=='undefined'?window:globalThis);
