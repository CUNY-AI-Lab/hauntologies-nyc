import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/disclosure.js', import.meta.url), 'utf8');
function setup(width, present = true, open = true) {
  const listeners = new Map();
  const details = { open, style: { removeProperty() {} }, dataset: {}, getBoundingClientRect: () => ({ height: 40 }), isConnected: false };
  const body = { nodeType: 1, matches: () => false, querySelectorAll: () => [] };
  const window = { addEventListener() {} };
  const document = { body, getElementById: () => present ? details : null, querySelectorAll: () => [], addEventListener: (type, fn) => listeners.set(type, fn) };
  let mediaListeners = 0;
  vm.runInContext(source, vm.createContext({ window, document,
    matchMedia: query => ({ matches: query.includes('max-width') ? width <= 760 : true, addEventListener() { mediaListeners++; } }),
    MutationObserver: class { observe() {} }, setTimeout: () => 1,
  }));
  return { details, api: window.HauntologiesDisclosure, listeners, mediaListeners };
}
for (const width of [320, 390, 760, 761, 1440]) test(`Event details starts closed at ${width}px`, () => assert.equal(setup(width).details.open, false));
test('already collapsed Event details stays collapsed on desktop', () => {
  assert.equal(setup(1440, true, false).details.open, false);
});
test('missing Event details does not break other disclosure controls', () => assert.doesNotThrow(() => setup(390, false)));
test('manual opening and closing remain available and are not reset by responsive listeners', () => {
  const h = setup(390); h.api.set(h.details, true); assert.equal(h.details.open, true);
  h.api.set(h.details, false); assert.equal(h.details.open, false);
  assert.equal(h.mediaListeners, 0); assert.equal(h.listeners.has('resize'), false);
});
