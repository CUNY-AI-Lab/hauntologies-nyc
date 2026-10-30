import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const config=JSON.parse(await fs.readFile(new URL('../dist/server/wrangler.json',import.meta.url),'utf8'));
const db=JSON.parse(await fs.readFile(new URL('../wrangler.d1.json',import.meta.url),'utf8'));
Object.assign(config,{
  name:'hauntologies-nyc',
  topLevelName:'hauntologies-nyc',
  account_id:db.account_id,
  main:'demo-worker.mjs',
  workers_dev:false,
  preview_urls:false,
  d1_databases:db.d1_databases.map(({migrations_dir,...binding})=>binding),
  assets:{...config.assets,run_worker_first:['/api','/api/*','/auth','/auth/*','/data/source-inventory.json']},
  vars:{...config.vars,CAIL_ENABLED:'false'}
});
await fs.copyFile(new URL('../deployment/demo-gate.mjs',import.meta.url),new URL('../dist/server/demo-gate.mjs',import.meta.url));
// Keep the public projection import local to the prepared Worker bundle.
const gateFile=new URL('../dist/server/demo-gate.mjs',import.meta.url);
await fs.writeFile(gateFile,(await fs.readFile(gateFile,'utf8')).replace('../server/direct-publication.mjs','./direct-publication.mjs').replace('../server/published-edits.mjs','./published-edits.mjs').replace('../server/pending-places.mjs','./pending-places.mjs').replace('../server/registration-eligibility.mjs','./registration-eligibility.mjs'));
await fs.copyFile(new URL('../server/record-credits.mjs',import.meta.url),new URL('../dist/server/record-credits.mjs',import.meta.url));
await fs.copyFile(new URL('../server/public-attribution.mjs',import.meta.url),new URL('../dist/server/public-attribution.mjs',import.meta.url));
await fs.copyFile(new URL('../server/published-edits.mjs',import.meta.url),new URL('../dist/server/published-edits.mjs',import.meta.url));
await fs.copyFile(new URL('../server/pending-places.mjs',import.meta.url),new URL('../dist/server/pending-places.mjs',import.meta.url));
// Vinext emits no_bundle:true. Bundle this adapter's dependency explicitly so
// the generated Worker never tries to resolve a bare npm import at runtime.
await build({entryPoints:[fileURLToPath(new URL('../server/direct-publication.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../dist/server/direct-publication.mjs',import.meta.url)),bundle:true,format:'esm',platform:'node',target:'es2022',conditions:['workerd','node']});
await build({entryPoints:[fileURLToPath(new URL('../deployment/access-identity.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../dist/server/access-identity.mjs',import.meta.url)),bundle:true,format:'esm',platform:'browser',target:'es2022'});
await build({entryPoints:[fileURLToPath(new URL('../deployment/map-accounts.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../dist/server/map-accounts.mjs',import.meta.url)),bundle:true,format:'esm',platform:'node',target:'es2022',external:['cloudflare:workers'],conditions:['workerd','node'],minify:true});
await fs.copyFile(new URL('../server/registration.mjs',import.meta.url),new URL('../dist/server/registration.mjs',import.meta.url));
await fs.copyFile(new URL('../server/registration-eligibility.mjs',import.meta.url),new URL('../dist/server/registration-eligibility.mjs',import.meta.url));
await fs.writeFile(new URL('../dist/server/demo-worker.mjs',import.meta.url),"import handler from './index.js';\nimport {createDemoWorker} from './demo-gate.mjs';\nimport {handleRegistration} from './registration.mjs';\nexport default createDemoWorker(handler,handleRegistration);\n");
await fs.writeFile(new URL('../dist/server/wrangler.demo.json',import.meta.url),JSON.stringify(config,null,2)+'\n');
// These public handlers are bundled through server/runtime.ts by Vinext. Keep
// their browser assets in the no-bundle release and verify the shipped modules
// with tests/contributors-prepared.runtime.test.mjs (no production connection).
for (const asset of ['activity.js','activity.css','contributor-page.js','contributor-page.css','place-link.js']) {
  await fs.access(new URL('../dist/client/'+asset,import.meta.url));
}
console.log('Prepared hauntologies-nyc with DB binding and registration; contribution/review APIs blocked, public and preview routes disabled.');
