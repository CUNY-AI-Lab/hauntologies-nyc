import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const file of ['local-preview.js', 'hosted.js']) {
  test(file + ' leaves the minimal map alone when legacy controls are absent', () => {
    let requests = 0;
    const context = vm.createContext({ document: { getElementById: () => null }, fetch: () => { requests++; throw Error('Unexpected API request'); } });
    assert.doesNotThrow(() => vm.runInContext(readFileSync(new URL('../public/ingestion/' + file, import.meta.url), 'utf8'), context));
    assert.equal(requests, 0);
  });
}
