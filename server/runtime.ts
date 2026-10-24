import { env } from 'cloudflare:workers';
import { createIngestionService } from './service.mjs';
import { createD1Store } from './d1-store.mjs';
import { createCunyProvider } from './provider.mjs';
import extractionSchema from '../public/ingestion/normalized-candidate.schema.json';
import skillText from '../public/ingestion/SKILL.md?raw';
import boundaryText from '../public/data/nyc-borough-boundaries.geojson?raw';
import gazetteer from './gazetteer.json';
import { createWorkflowService } from './workflow-service.mjs';
import { createWorkflowStore } from './workflow-store.mjs';
import taskSeeds from '../public/data/contribution-tasks.json';
import inventoryText from '../public/inventory.js?raw';
import pilotText from '../public/pilot.js?raw';
import { parseStaticRecords } from './static-targets.mjs';
import { reviewAuthorization } from './review-authorization.mjs';
const staticRecords=parseStaticRecords(inventoryText,pilotText);
const boundaries=JSON.parse(boundaryText);

export function handleRequest(request:Request){
  const e=env as Record<string,any>;
  const geography={boundaries,gazetteer};
  if(new URL(request.url).pathname.startsWith('/api/contributions/')){
    // Only explicitly configured verified actor IDs may review or publish, each from
    // its own list. Invalid or absent configuration grants no roles.
    return createWorkflowService({store:e.DB?createWorkflowStore(e.DB):null,taskSeeds,geography,staticRecords,authorization:reviewAuthorization(e.CONTRIBUTIONS_REVIEWER_IDS,e.CONTRIBUTIONS_PUBLISHER_IDS)}).handle(request);
  }
  return createIngestionService({store:e.DB?createD1Store(e.DB):null,provider:createCunyProvider({extractionSchema,skillText}),config:{...e,CAIL_ENABLED:'false'},geography}).handle(request);
}
