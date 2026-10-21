import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import './prepare-worker-demo.mjs';
import './prepare-public-catalog.mjs';

// Existing approved public map; review APIs remain blocked by the Worker gate.
const file = new URL('../dist/server/wrangler.demo.json', import.meta.url);
const config = JSON.parse(await fs.readFile(file, 'utf8'));
assert.equal(config.name, 'hauntologies-nyc');
assert.equal(config.account_id, '452c33847cf5cb1e46f391fca32fd1b5');
assert.equal(config.d1_databases[0].database_id, 'df7f1e92-e339-4e25-ac30-989dd68d8dfc');
config.workers_dev = true;
config.preview_urls = false;
await fs.writeFile(new URL('../dist/server/wrangler.live.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
console.log('Prepared existing public Worker release; no deployment or migration performed.');
