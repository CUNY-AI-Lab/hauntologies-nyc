import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createWorkflowStore } from '../../server/workflow-store.mjs';
import { createWorkflowService } from '../../server/workflow-service.mjs';

export const basePlace = { id:'synthetic_base', title:'Archive garden', category:'reported_haunting', place_type:'garden', location_text:'Synthetic address', borough:'Manhattan', latitude:40.72, longitude:-74, geo_status:'approximate', time_precision:'unknown', sources:[{title:'Offline archive',locator:'Box 5'}] };
export function sqliteD1(filename = ':memory:') {
  const native = new DatabaseSync(filename);
  const prepare = (sql, params=[]) => ({ bind(...values) {return prepare(sql,values);},
    async all() {return {results:native.prepare(sql).all(...params)};},
    async first(column) {const row=native.prepare(sql).get(...params)||null;return column&&row?row[column]:row;},
    async run() {return {success:true,meta:{changes:Number(native.prepare(sql).run(...params).changes)}};},
  });
  let tail=Promise.resolve();
  return {native,prepare,batch(statements) {
    const operation=tail.then(async()=>{native.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());native.exec('COMMIT');return results;}catch(error){native.exec('ROLLBACK');throw error;}});
    tail=operation.catch(()=>{});return operation;
  }};
}
export function contributorsHarness(t, {db=sqliteD1(),staticRecords=[basePlace], initialize=true, publicationMode='direct', authorization}={}) {
  if(initialize) for(const file of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort()) db.native.exec(readFileSync(new URL('../../drizzle/'+file,import.meta.url),'utf8'));
  t?.after(()=>db.native.close());
  const store=createWorkflowStore(db),service=createWorkflowService({publicationMode,authorization,store,staticRecords,taskSeeds:{tasks:[]},geography:{boundaries:JSON.parse(readFileSync(new URL('../../public/data/nyc-borough-boundaries.geojson',import.meta.url)))}});
  const call=async(path,body,actor='synthetic_actor_A')=>{
    const response=await service.handle(new Request('https://map.test/api/contributions/'+path,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':actor,origin:'https://map.test','content-type':'application/json','sec-fetch-site':'same-origin'},...(body?{body:JSON.stringify(body)}:{})}));
    return {status:response.status,body:await response.json()};
  };
  return {db,store,service,call,staticRecords};
}
export const proposal = (title='Lantern house') => ({schema_version:'1.0',type:'open_proposal',task_ids:[],title,summary:'A synthetic description.',public_credit:{consent:true,identity:'moniker',label:'Night Owl'},sources:[],attachments:[],targets:[],payload:{explanation:'A synthetic description.',geometry:{type:'Point',coordinates:[-74,40.72]}}});
export const publish = (h,envelope,actor='synthetic_actor_A',extra={}) => h.call('publish',{idempotency_key:crypto.randomUUID(),submission_json:JSON.stringify(envelope),moniker:'Night Owl',change_summary:'A synthetic publication',...extra},actor);
export const target = async(h,id) => (await h.call('target?id='+id)).body.target;
