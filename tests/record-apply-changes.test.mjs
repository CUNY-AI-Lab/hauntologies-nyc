import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Runs the shipped browser models against the public inventory; no network or private data.
const ctx = vm.createContext({ window: {}, structuredClone, URL });
for (const file of ['inventory.js', 'atlas-model.js', 'place-summary.js', 'record-edit-model.js']) {
  vm.runInContext(readFileSync(new URL('../public/' + file, import.meta.url), 'utf8'), ctx);
}
const { RecordEditModel: model, NYC_INVENTORY: inventory } = ctx.window;
const plain = value => JSON.parse(JSON.stringify(value));

function editedValue(field, before) {
  if (field.options) return field.options.find(option => option !== before);
  if (field.key === 'latitude') return before === 40.75 ? 40.76 : 40.75;
  if (field.key === 'longitude') return before === -73.98 ? -73.97 : -73.98;
  if (field.key === 'uncertainty_m') return before === 125 ? 150 : 125;
  if (['date_start', 'date_end'].includes(field.key)) return before === '1911' ? '1912' : '1911';
  if (field.type === 'url') return before === 'https://example.org/edited' ? 'https://example.org/edited-2' : 'https://example.org/edited';
  return 'Edited ' + field.key;
}

test('applyChanges is the exact inverse of snapshot for every field of every inventory place', () => {
  const records = inventory.records.filter(record => record && typeof record === 'object');
  assert.ok(records.length > 100, 'inventory loaded');
  let checked = 0;
  for (const record of records) {
    const before = plain(model.snapshot(record));
    for (const field of model.fieldsFor(record)) {
      if (field.key.startsWith('aliases.') && typeof before[field.key] !== 'string') continue;
      const after = editedValue(field, before[field.key]);
      const next = model.applyChanges(record, [{ field: field.key, before: before[field.key], after }]);
      const snap = plain(model.snapshot(next));
      assert.deepEqual(snap[field.key], after, record.id + ' ' + field.key);
      // Values snapshot computes from other fields (not stored on the record) may follow the edit.
      const computed = key => (key === 'inclusion_reason' && !Object.hasOwn(record, 'display_reason') && !Object.hasOwn(record, 'inclusion_reason'))
        || (key === 'place_type' && !Object.hasOwn(record, 'place_type')) || (key === 'geo_status' && !Object.hasOwn(record, 'geo_status'))
        || model.sourceAliases[key] === field.key || model.sourceAliases[field.key] === key;
      for (const key of Object.keys(before)) if (key !== field.key && !computed(key)) assert.deepEqual(snap[key], before[key], record.id + ' kept ' + key + ' when editing ' + field.key);
      checked++;
    }
  }
  assert.ok(checked > 5000, 'checked ' + checked + ' field edits');
});

test('applyChanges never mutates its input and appends source additions', () => {
  const record = inventory.records.find(r => Array.isArray(r.sources) && r.sources.length);
  const before = JSON.stringify(record);
  const next = model.applyChanges(record, [{ field: 'title', before: record.title, after: 'Edited title' }], [{ citation: 'Added reference' }]);
  assert.equal(JSON.stringify(record), before);
  assert.equal(next.title, 'Edited title');
  assert.equal(next.sources.length, record.sources.length + 1);
  assert.equal(next.sources.at(-1).citation, 'Added reference');
});
