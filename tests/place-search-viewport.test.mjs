import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/place-search.js', import.meta.url), 'utf8');
// Execute the actual layout and scheduling functions with synthetic viewport
// transitions. This is not an iPhone/browser rendering test.
function setup({ width = 390, height = 844, row = false } = {}) {
  const classes = new Set(['is-open']), styles = new Map(), frames = [];
  const brand = { bottom: 160 }, box = { left: width - 110, bottom: 280 };
  const root = { closest: () => ({ getBoundingClientRect: () => box }),
    classList: { contains: key => classes.has(key), toggle: (key, value) => value ? classes.add(key) : classes.delete(key) },
    style: { setProperty: (key, value) => styles.set(key, parseFloat(value)) } };
  const viewport = { scale: 1, offsetLeft: 0, offsetTop: 0, width, height };
  const focus = [];
  const context = vm.createContext({ root, window: { visualViewport: viewport }, innerWidth: width, innerHeight: height,
    narrow: () => width <= 760, getComputedStyle: () => ({ flexDirection: row ? 'row' : 'column' }),
    toggle: { getBoundingClientRect: () => box }, input: { focus: options => focus.push(options.preventScroll) },
    document: { querySelector: selector => ({ getBoundingClientRect: () => selector.endsWith('.brand') ? brand : { left: 12 } }) },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
  });
  vm.runInContext(source.slice(source.indexOf('  function layout() {'), source.indexOf('  function syncPanel() {')), context);
  return { viewport, classes, styles, brand, box, focus, frames,
    withoutViewport: () => { context.window.visualViewport = undefined; },
    layout: () => context.layout(), schedule: () => context.scheduleLayout(), focusInput: () => context.focusInput(),
    flush: () => { const pending = frames.splice(0); pending.forEach(fn => fn()); } };
}
function assertFits(h) {
  const top = h.styles.get('--search-top'), panel = h.styles.get('--search-panel-max');
  const width = h.styles.get('--search-width');
  assert.ok(top >= h.viewport.offsetTop + 8);
  assert.ok(top + 50 + panel <= h.viewport.offsetTop + h.viewport.height - 8 + 0.01);
  assert.ok(width <= h.viewport.width - 24);
}
test('first focus is synchronous and prevents browser scrolling; follow-up layout is coalesced', () => {
  const h = setup(); h.layout(); h.focusInput();
  assert.deepEqual(h.focus, [true]); assert.equal(h.frames.length, 1);
  h.viewport.height = 330; h.viewport.offsetTop = 180;
  h.schedule(); h.schedule(); assert.equal(h.frames.length, 1); h.flush(); assertFits(h);
});
test('keyboard pan, dismissal, and refocus use fresh visual bounds without window resize', () => {
  const h = setup();
  for (const [height, offsetTop] of [[300, 220], [300, 120], [844, 0], [280, 250]]) {
    Object.assign(h.viewport, { height, offsetTop }); h.schedule(); h.flush(); assertFits(h);
  }
});
test('expanded details and landscape do not force the field or a 160px result panel offscreen', () => {
  const h = setup({ width: 740, height: 390 }); h.brand.bottom = 600;
  h.viewport.height = 140; h.layout(); assertFits(h);
  assert.ok(h.styles.get('--search-panel-max') < 160);
});
test('narrow visual viewport fits even when preferred field width exceeds it', () => {
  const h = setup(); h.viewport.width = 170; h.viewport.offsetLeft = 80; h.layout(); assertFits(h);
  assert.equal(h.styles.get('--search-width'), 146);
});
test('closing before a queued frame cannot reopen or relayout the control', () => {
  const h = setup(); h.schedule(); h.classes.clear(); h.flush(); assert.equal(h.styles.size, 0);
  h.classes.add('is-open'); h.focusInput(); h.flush(); assertFits(h);
});
test('horizontal tray and wide keyboard layout also respect visual viewport bounds', () => {
  for (const row of [true, false]) {
    const h = setup({ width: 1024, height: 768, row }); h.viewport.height = 320; h.viewport.offsetTop = 100;
    h.layout(); assertFits(h);
  }
});
test('window and visual viewport events share scheduler; all input focus paths use helper', () => {
  assert.match(source, /window\.addEventListener\('resize', scheduleLayout\)/);
  assert.match(source, /visualViewport\?\.addEventListener\('resize', scheduleLayout\)/);
  assert.match(source, /visualViewport\?\.addEventListener\('scroll', scheduleLayout\)/);
  assert.equal((source.match(/input\.focus\(/g) || []).length, 1);
  assert.match(source, /open\(\); focusInput\(\);/);
});

test('pinch zoom leaves desktop field placement under user control', () => {
  const h = setup({ width: 1024, height: 768 });
  Object.assign(h.viewport, { scale: 2, width: 512, height: 384, offsetTop: 200 });
  h.layout(); assert.equal(h.classes.has('drops-below'), false);
  assert.equal(h.styles.has('--search-top'), false);
});

test('browsers without visualViewport retain usable layout bounds', () => {
  const h = setup(); h.withoutViewport(); h.layout(); assertFits(h);
});
