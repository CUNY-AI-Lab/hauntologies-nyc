'use strict';
// Shared browser/Node projection for proposals. Never writes into an original record.
// Load atlas-model.js and place-summary.js first for the existing display-derived fields.
(function(root){
  const text=(key,label,group,maxLength=2000,type='text',nullable=true)=>({key,label,group,type,maxLength,nullable});
  const fields=[
    text('title','Title','Place',300,'text',false),text('inclusion_reason','Inclusion reason','Place',300),
    text('description','Description','Place',15000,'textarea'),text('category','Category','Place',120),text('place_type','Place type','Place',200),
    {key:'borough',label:'Borough',group:'Location',type:'select',options:['unknown','Bronx','Brooklyn','Manhattan','Queens','Staten Island'],nullable:true},
    text('address','Address / original place wording','Location',2000),
    ...['latitude','longitude'].map(key=>({key,label:key[0].toUpperCase()+key.slice(1),group:'Location',type:'number',nullable:true})),
    {key:'geo_status',label:'Location certainty',group:'Location',type:'select',options:['unresolved','approximate','located'],nullable:false},
    text('geo_basis','Location basis','Location',4000,'textarea'),
    {key:'uncertainty_m',label:'Uncertainty radius (metres)','group':'Location',type:'number',nullable:true},
    text('uncertainty_note','Uncertainty note','Location',15000,'textarea'),
    text('date_wording','Date wording','Dates',2000),text('date_start','Start date (year, month or date)','Dates',10),text('date_end','End date (year, month or date)','Dates',10),
    text('date_precision','Date precision','Dates',120),text('date_basis','Date basis','Dates',4000,'textarea'),text('built','Built (original wording)','Dates',300),text('demolished','Demolition / loss date wording','Dates',300),
    text('source_url','Primary source URL','Sources',2048,'url'),text('source_title','Primary source title','Sources',2000),text('source_citation','Primary source citation','Sources',6000,'textarea'),
    text('source_date','Primary source date wording','Sources',300),text('source_locator','Primary source locator','Sources',2000),
    text('source_type','Primary source type','Sources',300),text('rights_notes','Rights / reuse notes','Sources',4000,'textarea'),
    text('image_url','Image URL','Image',2048,'url'),text('image_source_url','Image source URL','Image',2048,'url'),
    text('image_credit','Image credit','Image',2000),text('image_license','Image license','Image',1000),text('image_license_url','Image license URL','Image',2048,'url'),
    text('image_caption','Image caption','Image',4000,'textarea'),text('image_alt','Image description','Image',2000),
  ].map(Object.freeze);
  const byKey=new Map(fields.map(field=>[field.key,field]));
  const sourceKeys=['url','title','citation','locator','source_date_original','accessed_on','rights_status','rights_statement','public_use','evidence_note','note','source_type','repository','credit','license'];
  const sourceFields=Object.freeze(sourceKeys.map(key=>Object.freeze(text(key,key.replace(/_/g,' '),'Sources',key==='url'?2048:6000,key==='url'?'url':['citation','rights_statement','evidence_note','note'].includes(key)?'textarea':'text'))));
  const maxSourceAdditions=10;
  const own=(object,key)=>object&&Object.hasOwn(object,key);
  const first=(...pairs)=>{for(const [object,key]of pairs)if(own(object,key)&&object[key]!==undefined)return structuredClone(object[key]);return null;};
  function collections(input){const record=input?.record_id&&input.record?input.record:input||{},raw=record.raw||record;return{sources:Array.isArray(record.derived?.canonical_sources)?record.derived.canonical_sources:Array.isArray(raw.sources)?raw.sources:Array.isArray(raw.metadata?.sources)?raw.metadata.sources:[],aliases:Array.isArray(raw.aliases)?raw.aliases:[]};}
  function dynamicField(key){
    const source=typeof key==='string'&&key.match(/^sources\.([0-9]|[1-4][0-9])\.([a-z_]+)$/);
    if(source&&sourceKeys.includes(source[2]))return{...text(key,source[2].replace(/_/g,' '),'Sources',source[2]==='url'?2048:6000,source[2]==='url'?'url':['citation','rights_statement','evidence_note','note'].includes(source[2])?'textarea':'text'),sourceIndex:Number(source[1])};
    const alias=typeof key==='string'&&key.match(/^aliases\.([0-9]|[1-4][0-9])$/);
    return alias?text(key,'Alias '+(Number(alias[1])+1),'Place',300,'text',false):null;
  }
  function fieldsFor(input){const{sources,aliases}=collections(input);return[...fields,...sources.slice(0,50).flatMap((source,index)=>source&&typeof source==='object'&&!Array.isArray(source)?sourceKeys.map(key=>Object.freeze(dynamicField('sources.'+index+'.'+key))):[]),...aliases.slice(0,50).map((_,index)=>Object.freeze(dynamicField('aliases.'+index)))];}
  function snapshot(input){
    const record=input?.record_id&&input.record?input.record:input||{},raw=record.raw||record,derived=record.derived||{},canonical=derived.canonical_entry||{},metadata=raw.metadata||{},location=derived.location||{};
    const sources=collections(input).sources,source=sources[0]||{},image=raw.image||metadata.image||{};
    const originalLocation=metadata.location&&typeof metadata.location==='object'&&!Array.isArray(metadata.location)?metadata.location:{};
    const originalSource=metadata.source&&typeof metadata.source==='object'&&!Array.isArray(metadata.source)?metadata.source:{};
    const originalDate=metadata.date&&typeof metadata.date==='object'&&!Array.isArray(metadata.date)?metadata.date:{};
    const metadataScalars={address:typeof metadata.location==='string'?metadata.location:first([originalLocation,'label'],[originalLocation,'address'],[originalLocation,'place'],[originalLocation,'name']),source_url:typeof metadata.source==='string'&&safeUrl(metadata.source)?metadata.source:first([originalSource,'url']),source_citation:typeof metadata.citation==='string'?metadata.citation:first([originalSource,'citation']),date_wording:typeof metadata.date==='string'?metadata.date:first([originalDate,'original'],[originalDate,'text'])};
    const flat={...raw,...canonical,id:input?.record_id||raw.id,latitude:first([canonical,'latitude'],[raw,'latitude'],[location,'latitude']),longitude:first([canonical,'longitude'],[raw,'longitude'],[location,'longitude']),geo_status:first([canonical,'geo_status'],[raw,'geo_status'],[location,'precision'])};
    const normalized=root.AtlasModel?.normalize(flat),display=root.PlaceSummary?.view(flat);
    const dateValue=value=>typeof value==='number'?String(value):value;
    const result={
      title:first([canonical,'title'],[raw,'title']),inclusion_reason:first([raw,'display_reason'],[raw,'inclusion_reason'])??display?.description??null,
      description:first([canonical,'claim_text'],[raw,'description'],[raw,'evidence_summary']),category:first([canonical,'category'],[raw,'category']),
      place_type:first([canonical,'place_type'],[raw,'place_type'])??normalized?.placeTypes?.[0]??null,
      borough:first([canonical,'borough'],[raw,'borough'],[location,'borough']),address:first([canonical,'place_original'],[raw,'location_text'],[raw,'place_original'],[metadataScalars,'address']),
      latitude:flat.latitude,longitude:flat.longitude,geo_status:['located','approximate','unresolved'].includes(flat.geo_status)?flat.geo_status:normalized?.geoStatus||'unresolved',
      geo_basis:first([canonical,'geo_basis'],[raw,'geo_basis'],[raw,'location_precision'],[location,'reason']),uncertainty_m:first([canonical,'uncertainty_m'],[raw,'uncertainty_m']),uncertainty_note:first([raw,'uncertainty_note'],[canonical,'gap_limitations']),
      date_wording:first([canonical,'time_original'],[raw,'time_original'],[metadataScalars,'date_wording']),date_start:dateValue(first([canonical,'time_start_year'],[raw,'time_start_year'],[raw,'event_date_start'],[originalDate,'start'])),date_end:dateValue(first([canonical,'time_end_year'],[raw,'time_end_year'],[raw,'event_date_end'],[originalDate,'end'])),
      date_precision:first([canonical,'time_precision'],[raw,'time_precision'],[raw,'event_date_precision']),date_basis:first([canonical,'time_basis'],[raw,'time_basis']),built:first([raw,'built']),demolished:first([raw,'demolished']),
      source_url:first([raw,'source_url'],[raw,'display_source_url'],[source,'url'],[metadataScalars,'source_url']),source_title:first([raw,'source_title'],[source,'title'],[originalSource,'title']),source_citation:first([raw,'source_citation'],[source,'citation'],[metadataScalars,'source_citation']),
      source_date:first([source,'source_date_original'],[raw,'source_date']),source_locator:first([raw,'source_locator'],[source,'locator']),source_type:first([raw,'source_type'],[source,'source_type']),rights_notes:first([canonical,'rights_notes'],[raw,'rights_or_license'],[source,'rights_statement']),
      image_url:first([image,'url'],[raw,'image_url']),image_source_url:first([image,'sourceUrl'],[raw,'image_source_url']),image_credit:first([image,'creator'],[image,'credit'],[raw,'image_credit']),
      image_license:first([image,'license'],[raw,'image_license']),image_license_url:first([image,'licenseUrl'],[raw,'image_license_url']),image_caption:first([image,'caption'],[raw,'image_caption']),image_alt:first([image,'alt'],[raw,'image_alt']),
    };
    const list=collections(input);
    for(const field of fieldsFor(input)){if(field.sourceIndex!==undefined){const key=field.key.split('.')[2];result[field.key]=first([list.sources[field.sourceIndex],key]);}else if(field.key.startsWith('aliases.'))result[field.key]=structuredClone(list.aliases[Number(field.key.split('.')[1])]);}
    return result;
  }
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function changes(before,after){return Object.keys(before).filter(key=>(byKey.has(key)||dynamicField(key))&&!equal(before[key],after[key])).map(field=>({field,before:structuredClone(before[field]),after:structuredClone(after[field])}));}
  function safeUrl(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}}
  function validateSourceAdditions(additions=[]){
    const errors=[],issue=(field,code,message)=>errors.push({field,code,message});
    if(!Array.isArray(additions)||additions.length>maxSourceAdditions){issue('source_additions','bounded_source_additions','Propose at most ten new source references.');return{valid:false,errors};}
    for(const [index,source]of additions.entries()){
      const path='source_additions.'+index;
      if(!source||typeof source!=='object'||Array.isArray(source)){issue(path,'source_object_required','Each new source must be an object of optional text fields.');continue;}
      for(const key of Object.keys(source))if(!sourceKeys.includes(key))issue(path+'.'+key,'unknown_source_field','This source field is not supported.');
      for(const field of sourceFields){
        if(!own(source,field.key))continue;
        const value=source[field.key];
        if(value===null)continue;
        if(typeof value!=='string'||value.length>field.maxLength)issue(path+'.'+field.key,'source_text_required','Use text within the field limit, or null.');
        else if(field.type==='url'&&value!==''&&!safeUrl(value))issue(path+'.'+field.key,'unsafe_url','Use an HTTP(S) URL without credentials, an empty string or null.');
      }
      if(!['url','title','citation','locator','evidence_note','note','repository'].some(key=>own(source,key)&&typeof source[key]==='string'&&source[key].trim()))issue(path,'source_reference_required','Include a title, citation, locator, source note, repository or URL.');
    }
    return{valid:errors.length===0,errors};
  }
  function dateBounds(value){
    if(typeof value!=='string'||!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value))return null;
    const [year,month,day]=value.split('-').map(Number);
    if(year<1||year>3000||(month!==undefined&&(month<1||month>12)))return null;
    const maxDay=month?new Date(Date.UTC(year===1?2001:year,month,0)).getUTCDate():31;
    if(day!==undefined&&(day<1||day>maxDay))return null;
    return [year*10000+(month||1)*100+(day||1),year*10000+(month||12)*100+(day||maxDay)];
  }
  function validateChanges(proposed,{snapshot:before,change_message,source_additions=[]}={}){
    const errors=[...validateSourceAdditions(source_additions).errors],after=structuredClone(before||{}),changed=new Set();
    const issue=(field,code,message)=>errors.push({field,code,message});
    if(typeof change_message!=='string'||!change_message.trim()||change_message.length>2000)issue('change_message','change_message_required','Describe the change in 1–2000 characters.');
    if(!Array.isArray(proposed)||proposed.length>100){issue('changes','changes_required','List at most 100 changed fields.');return{valid:false,errors,after};}
    if(!proposed.length&&(!Array.isArray(source_additions)||!source_additions.length))issue('changes','changes_required','Propose a changed field or a new source reference.');
    for(const [index,change]of proposed.entries()){
      const path='changes.'+index;
      if(!change||typeof change!=='object'||Array.isArray(change)||Object.keys(change).length!==3||!['field','before','after'].every(key=>own(change,key))){issue(path,'invalid_change','Use exactly field, before and after.');continue;}
      if(typeof change.field!=='string'){issue(path+'.field','invalid_field','Use an editable field name.');continue;}
      const field=byKey.get(change.field)||(own(before,change.field)?dynamicField(change.field):null);
      if(!field){issue(path+'.field','read_only_field','This field is not editable.');continue;}
      if(changed.has(field.key)){issue(path,'duplicate_field','List each changed field once.');continue;}changed.add(field.key);
      if(!before||!own(before,field.key)||!equal(change.before,before[field.key]))issue(path+'.before','forged_before','The original value does not match this record. Reload it.');
      if(equal(change.before,change.after))issue(path,'no_effective_change','The proposed value is unchanged.');
      const value=change.after;
      if(value===null){if(!field.nullable)issue(path+'.after','required_value','This field cannot be cleared.');}
      else if(field.type==='number'){
        if(typeof value!=='number'||!Number.isFinite(value))issue(path+'.after','number_required','Use a finite number or null.');
        else if((field.key==='latitude'&&Math.abs(value)>90)||(field.key==='longitude'&&Math.abs(value)>180)||(field.key==='uncertainty_m'&&(value<=0||value>50000)))issue(path+'.after','number_out_of_bounds','The numeric value is outside its allowed range.');
      }else if(typeof value!=='string'||!value.trim()||value.length>(field.maxLength||2000))issue(path+'.after','text_required','Use nonblank text within the field limit, or null if optional.');
      else if(field.options&&!field.options.includes(value))issue(path+'.after','invalid_choice','Choose a listed value.');
      else if(field.type==='url'&&!safeUrl(value))issue(path+'.after','unsafe_url','Use an HTTP(S) URL without credentials.');
      else if(['date_start','date_end'].includes(field.key)&&!dateBounds(value))issue(path+'.after','invalid_date','Use YYYY, YYYY-MM or YYYY-MM-DD, or null for unknown.');
      after[field.key]=structuredClone(value);
    }
    if(['latitude','longitude','geo_status','uncertainty_m'].some(key=>changed.has(key))){
      const {latitude:lat,longitude:lon,geo_status:state,uncertainty_m:radius}=after;
      if((lat===null)!==(lon===null)||![lat,lon].every(value=>value===null||(typeof value==='number'&&Number.isFinite(value))))issue('geometry','coordinate_pair','Keep coordinates as paired finite numbers or paired nulls.');
      if(state==='unresolved'&&(lat!==null||lon!==null||radius!==null))issue('geometry','unresolved_geometry','Unresolved locations need null coordinates and radius.');
      if(state!=='unresolved'&&(lat===null||lon===null))issue('geometry','located_geometry_required','Located or approximate places need both coordinates.');
    }
    if(['date_start','date_end','date_precision'].some(key=>changed.has(key))){
      const a=after.date_start,b=after.date_end,low=dateBounds(a),high=dateBounds(b);
      if((a===null)!==(b===null)||(a!==null&&(!low||!high||low[0]>high[1])))issue('dates','invalid_date_interval','Use an ordered date pair or two null bounds for unknown.');
      if((after.date_precision===null||after.date_precision==='unknown')&&(a!==null||b!==null))issue('dates','unknown_date_bounds','Unknown precision requires unknown date bounds.');
      if(after.date_precision==='year'&&a!==b)issue('dates','single_year_bounds','A single-year date uses the same year at both bounds.');
    }
    return{valid:errors.length===0,errors,after};
  }
  root.RecordEditModel=Object.freeze({fields:Object.freeze(fields),fieldsFor,snapshot,changes,sourceFields,maxSourceAdditions,validateSourceAdditions,validateChanges});
})(typeof window!=='undefined'?window:globalThis);
