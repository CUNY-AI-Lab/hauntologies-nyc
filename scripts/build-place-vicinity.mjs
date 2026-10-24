// Names each mapped record by its nearest cross streets and neighbourhood,
// from NYC GeoSearch, so map labels say where a place is instead of
// "approximate". Run after records move: node scripts/build-place-vicinity.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../public/', import.meta.url);
const context = { window: { URLSearchParams }, globalThis: null, URLSearchParams };
context.globalThis = context.window;
vm.createContext(context);
for (const file of ['inventory.js', 'pilot.js', 'atlas-model.js', 'place-search-model.js']) vm.runInContext(readFileSync(new URL(file, root), 'utf8'), context);
const { NYC_INVENTORY, HAUNT_PILOT, AtlasModel, PlaceSearchModel: M } = context.window;
const out = new URL('data/place-vicinity.json', root);
let previous = {};
try { previous = JSON.parse(readFileSync(out, 'utf8')); } catch {}

const records = [...NYC_INVENTORY.records, ...(HAUNT_PILOT ? [HAUNT_PILOT] : [])];
const result = {};
for (const record of records) {
  const point = AtlasModel.normalize(record).geometry?.coordinates;
  if (!point) continue;
  const [longitude, latitude] = point, key = latitude.toFixed(6) + ',' + longitude.toFixed(6);
  if (previous[record.id]?.at === key) { result[record.id] = previous[record.id]; continue; }
  const response = await fetch(M.reverseGeosearchUrl(latitude, longitude));
  const vicinity = response.ok ? M.describeVicinity(await response.json()) : null;
  if (vicinity) result[record.id] = { at: key, near: vicinity.near, area: vicinity.area };
  await new Promise(resolve => setTimeout(resolve, 150));
}
writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log(Object.keys(result).length + ' of ' + records.length + ' records named.');
