import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),context={window:{}};
vm.createContext(context);
for(const file of ['inventory.js','pilot.js','atlas-model.js','place-summary.js'])vm.runInContext(fs.readFileSync(path.join(root,'public',file),'utf8'),context);
const {NYC_INVENTORY,HAUNT_PILOT,AtlasModel,PlaceSummary}=context.window;
const keys=['id','place_id','title','location_text','latitude','longitude','category','borough','status','review_state','geo_status','geometry','proxy','place_types','place_type','event_date_start','event_date_end','event_date_precision','time_start_year','time_end_year','time_precision','time_original','uncertainty_m','uncertainty_basis','geo_basis'];
function project(record){
 const result=Object.fromEntries(keys.filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]]));
 const view=PlaceSummary.view(record);
 result.display_reason=view.description;
 result.display_source_url=view.sourceUrl;
 result.location_text=view.location;
 const before=AtlasModel.normalize(record),after=AtlasModel.normalize(result);
 for(const key of ['id','title','boroughs','placeTypes','category','evidence','review','geoStatus','geometry','uncertaintyM','period'])assert.equal(JSON.stringify(after[key]),JSON.stringify(before[key]),record.id+' '+key);
 return result;
}
const client=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'dist/client');assert(fs.existsSync(client));
fs.writeFileSync(path.join(client,'inventory.js'),'window.NYC_INVENTORY = '+JSON.stringify({records:NYC_INVENTORY.records.map(project),audits:[]})+';\n');
fs.writeFileSync(path.join(client,'pilot.js'),'window.HAUNT_PILOT = '+JSON.stringify(project(HAUNT_PILOT))+';\n');
fs.rmSync(path.join(client,'data/source-inventory.json'),{force:true});
console.log(JSON.stringify({public_records:NYC_INVENTORY.records.length+1,filter_geometry_period_parity:true,raw_audit_excluded:true},null,2));
