import assert from 'node:assert/strict';
import '../public/atlas-model.js';
import '../public/place-summary.js';

// Shared allowlist used by the shipped public catalog and completeness reads.
const keys=['id','place_id','title','location_text','latitude','longitude','category','borough','status','review_state','geo_status','geometry','proxy','place_types','place_type','event_date_start','event_date_end','event_date_precision','time_start_year','time_end_year','time_precision','time_original','uncertainty_m','uncertainty_basis','geo_basis'];
// Public reference metadata supports inspection and proposed corrections without
// exposing the private research notes, audit history or original narratives.
const referenceKeys=['url','title','citation','repository','locator','source_date_original','accessed_on','rights_status','rights_statement','public_use','credit','license'];
const imageKeys=['url','sourceUrl','creator','credit','license','licenseUrl','caption','alt'];
const referenceMetadata=(value,allowed)=>Object.fromEntries(allowed.filter(key=>Object.hasOwn(value,key)&&(['string','number','boolean'].includes(typeof value[key])||value[key]===null)).map(key=>[key,value[key]]));
export function publicCatalogRecord(record){
 const result=Object.fromEntries(keys.filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]]));
 const view=globalThis.PlaceSummary.view(record);
 result.display_reason=view.description;
 result.display_source_url=view.sourceUrl;
 result.location_text=view.location;
 for(const key of ['source_url','source_title','source_type','source_citation','source_locator','source_date'])if(Object.hasOwn(record,key)&&(typeof record[key]==='string'||record[key]===null))result[key]=record[key];
 if(Array.isArray(record.sources))result.sources=record.sources.map(source=>source&&typeof source==='object'&&!Array.isArray(source)?referenceMetadata(source,referenceKeys):{});
 if(record.image&&typeof record.image==='object'&&!Array.isArray(record.image))result.image=referenceMetadata(record.image,imageKeys);
 const before=globalThis.AtlasModel.normalize(record),after=globalThis.AtlasModel.normalize(result);
 for(const key of ['id','title','boroughs','placeTypes','category','evidence','review','geoStatus','geometry','uncertaintyM','period'])assert.equal(JSON.stringify(after[key]),JSON.stringify(before[key]),record.id+' '+key);
 return result;
}
