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
import { handlePublicContributions } from './public-contributions.mjs';
import { handlePublicImage } from './public-images.mjs';
const staticRecords=parseStaticRecords(inventoryText,pilotText);
const boundaries=JSON.parse(boundaryText);

export function handleRequest(request:Request){
  // Bindings pass straight into untyped .mjs services, which validate them at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e=env as Record<string,any>;
  const geography={boundaries,gazetteer};
  if(new URL(request.url).pathname==='/api/public-image')return handlePublicImage(request,e.DB);
  if (['/api/activity','/api/contributors-summary', '/api/place-completeness'].includes(new URL(request.url).pathname)) {
    return handlePublicContributions(request, { db: e.DB, staticRecords });
  }
  if(new URL(request.url).pathname.startsWith('/api/contributions/')){
    // Explicit role lists control privileged data; open review adds bounded peer review/publication.
    return createWorkflowService({publicationMode:'direct',store:e.DB?createWorkflowStore(e.DB):null,taskSeeds,geography,staticRecords,authorization:reviewAuthorization(e.CONTRIBUTIONS_REVIEWER_IDS,e.CONTRIBUTIONS_PUBLISHER_IDS,e.CONTRIBUTIONS_ADMIN_IDS,e.CONTRIBUTIONS_OPEN_REVIEW)}).handle(request);
  }
  return createIngestionService({store:e.DB?createD1Store(e.DB):null,provider:createCunyProvider({extractionSchema,skillText}),config:{...e,CAIL_ENABLED:'false'},geography}).handle(request);
}
