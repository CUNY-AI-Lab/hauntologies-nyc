import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/map-recovery.js', import.meta.url), 'utf8');
function target(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type) { for (const fn of listeners.get(type) || []) fn(); },
  }, extra);
}
function setup() {
  const timers = new Map(), frames = new Map(); let id = 0, clock = 0;
  const nodes = { mapLoadNotice: { hidden: true }, mapLoadMessage: { textContent: '' }, retryMap: target({ disabled: false }) };
  const document = target({ hidden: false, getElementById: key => nodes[key] });
  const window = target({ visualViewport: target() });
  const container = { clientWidth: 390, clientHeight: 844 };
  const invalidations = [], mapEvents = {}, tileEvents = {};
  const map = { getContainer: () => container, invalidateSize: options => invalidations.push(options), on: (type, fn) => { mapEvents[type] = fn; }, off: type => { delete mapEvents[type]; } };
  const streets = { redraws: 0, on: events => Object.assign(tileEvents, events), off: events => Object.keys(events).forEach(key => delete tileEvents[key]), redraw() { this.redraws++; } };
  const observers = [];
  const navigator = { onLine: true };
  const context = vm.createContext({ window, document, navigator, Date: { now: () => clock },
    ResizeObserver: class { constructor(fn) { this.callback = fn; observers.push(this); } observe(node) { this.node = node; } disconnect() { this.disconnected = true; } },
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: key => frames.delete(key),
  });
  vm.runInContext(source, context);
  const health = window.HauntologiesMapRecovery.attach(map, streets);
  const emit = (type, tile = {}) => tileEvents[type]?.({ tile });
  const tick = queue => { const pending = [...queue.values()]; queue.clear(); for (const fn of pending) fn(); };
  return { nodes, document, window, container, navigator, streets, health, invalidations, observers, timers, frames, emit,
    timeout: () => tick(timers), frame: () => tick(frames), advance: ms => { clock += ms; }, unload: () => mapEvents.unload() };
}

test('street failure is visible outside the hidden Layers panel; success clears it', () => {
  const h = setup(), tile = {};
  h.emit('tileerror', tile); h.emit('load');
  assert.equal(h.nodes.mapLoadNotice.hidden, false);
  assert.match(h.health.message, /Street map unavailable/);
  assert.equal(h.nodes.retryMap.disabled, false);
  h.emit('tileload', tile);
  assert.equal(h.health.message, ''); assert.equal(h.nodes.mapLoadNotice.hidden, true);
});
test('partial failure and unloaded tiles do not leave a permanent error counter', () => {
  const h = setup(), bad = {}, good = {};
  h.emit('tileload', good); h.emit('tileerror', bad); h.emit('load');
  assert.match(h.health.message, /Some street tiles/);
  h.emit('tileunload', bad);
  assert.equal(h.health.message, '');
});
test('offline to online retries the street grid once, not only historical imagery', () => {
  const h = setup(); h.emit('tileerror'); h.emit('load');
  h.navigator.onLine = false; h.window.emit('offline');
  assert.match(h.health.message, /Offline/); assert.equal(h.nodes.retryMap.disabled, true);
  h.nodes.retryMap.emit('click'); assert.equal(h.streets.redraws, 0);
  h.navigator.onLine = true; h.window.emit('online');
  assert.equal(h.streets.redraws, 1); assert.equal(h.nodes.retryMap.disabled, true);
  h.window.emit('pageshow'); h.document.emit('visibilitychange');
  assert.equal(h.streets.redraws, 1);
  h.emit('tileload'); h.emit('load'); assert.equal(h.nodes.mapLoadNotice.hidden, true);
});
test('event bursts after another failure cannot create automatic retry churn', () => {
  const h = setup(); h.emit('tileerror'); h.emit('load'); h.window.emit('online');
  h.emit('tileerror'); h.emit('load'); h.window.emit('pageshow'); h.document.emit('visibilitychange');
  assert.equal(h.streets.redraws, 1);
  h.advance(5000); h.window.emit('pageshow'); assert.equal(h.streets.redraws, 2);
});
test('a stalled request shows an actionable state but never starts a timer retry loop', () => {
  const h = setup(); h.emit('loading'); h.timeout();
  assert.match(h.health.message, /loading slowly/); assert.equal(h.streets.redraws, 0);
  h.nodes.retryMap.emit('click'); assert.equal(h.streets.redraws, 1);
  h.timeout(); assert.equal(h.streets.redraws, 1); assert.equal(h.nodes.retryMap.disabled, false);
  assert.equal(h.timers.size, 0);
});
test('healthy restore never refetches tiles or recenters the map', () => {
  const h = setup(); h.emit('tileload'); h.emit('load');
  h.window.emit('pageshow'); h.window.emit('online'); h.document.emit('visibilitychange'); h.frame();
  assert.equal(h.streets.redraws, 0); assert.equal(h.invalidations.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.invalidations[0])), { animate: false, pan: false, debounceMoveend: true });
});
test('container and visual viewport changes refresh size, coalesced into one frame', () => {
  const h = setup(); h.frame();
  assert.equal(h.observers[0].node, h.container);
  h.observers[0].callback(); h.window.visualViewport.emit('resize'); h.frame();
  assert.equal(h.invalidations.length, 2);
});
test('hidden or zero-size containers wait for a usable restored layout', () => {
  const h = setup(); h.container.clientWidth = 0; h.frame(); assert.equal(h.invalidations.length, 0);
  h.container.clientWidth = 390; h.document.hidden = true; h.observers[0].callback(); h.frame();
  assert.equal(h.invalidations.length, 0);
  h.document.hidden = false; h.window.emit('pageshow'); h.frame(); assert.equal(h.invalidations.length, 1);
});
test('map unload removes listeners, observer and timers', () => {
  const h = setup(); h.unload(); h.window.emit('pageshow'); h.nodes.retryMap.emit('click');
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.streets.redraws, 0);
  assert.equal(h.observers[0].disconnected, true);
});
test('entry point loads recovery before app and renders retry outside closed panels', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('src="map-recovery.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('id="mapLoadNotice"') < html.indexOf('id="layersPanel"'));
  assert.match(html, /id="mapLoadMessage" role="status"/);
  assert.match(html, /id="retryMap" class="outline" type="button"/);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /window\.HauntologiesMapRecovery\?\.attach\(map,streets,updateLayerStatus\);streets\.addTo\(map\)/);
  assert.match(app, /window\.HauntologiesPublicReads\|\|/);
});
