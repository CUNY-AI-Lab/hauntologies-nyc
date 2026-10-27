'use strict';
// The Contribute form's Place field. One input finds a mapped place to add to,
// an address, intersection or OpenStreetMap object, or coordinates (repaired),
// and sets the form's own controls: an existing record through
// #freeformPlaceSelect, a new point through ContributionPoint.request. A pin's
// name comes from the chosen row or, for a pin dropped on the map, Nominatim.
(function () {
  const $ = id => document.getElementById(id), M = window.PlaceSearchModel;
  const input = $('contributionPlace'), list = $('contributionPlaceOptions');
  if (!M || !input || !list || !window.ContributionPoint) return;
  const engine = () => window.PlaceSearch?.records ? window.PlaceSearch : null;
  const status = $('newLocationStatus'), nameNode = $('contributionPlaceName'), clear = $('clearContributionPoint');
  const inBoroughs = (lat, lon) => !window.NycGeometry?.available || Boolean(window.NycGeometry.findBorough(lat, lon));
  const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value ?? ''; if (className) node.className = className; return node; };

  const state = {rows: [], active: -1, nyc: {query: '', rows: []}, osm: {query: '', rows: [], busy: false, note: ''}, named: null};

  // ---- Rows ------------------------------------------------------------------

  function records(query) {
    const usable = r => r?.id && r.status !== 'draft' && !r.hosted_pending;
    const hits = engine() ? engine().records(query, 8) : M.searchIndex(M.buildIndex((typeof allRecords === 'function' ? allRecords() : []).filter(usable), {
      point: r => { const c = window.AtlasModel?.normalize(r).geometry?.coordinates; return c ? [c[1], c[0]] : null; }
    }), query, {limit: 8});
    return hits.filter(hit => usable(hit.record)).slice(0, 5).map(hit => ({id: 'record:' + hit.record.id, record: hit.record, kind: 'On the map',
      title: hit.record.title, subtitle: hit.record.borough || ''}));
  }

  const pointRow = (row, kind) => {
    const ok = inBoroughs(row.latitude, row.longitude);
    return {...row, kind, disabled: !ok, subtitle: ok ? row.subtitle : 'Outside the five boroughs'};
  };

  function rowsFor(query) {
    // The hint is for an empty form; once a place is chosen the plate says what it is.
    const chosen = window.ContributionPoint.get() || !$('freeformRecordContext').hidden;
    if (!query) return pointMode() && !chosen && !state.quiet ? [{id: 'pick', action: 'pick', kind: '', title: 'Choose a mapped place on the map', subtitle: 'Or type an address, a place, an OSM link or coordinates'}] : [];
    const rows = [];
    const coords = M.parseCoordinates(query, {locate: (lat, lon) => window.NycGeometry?.findBorough(lat, lon) || null});
    if (coords?.status === 'ok') rows.push(pointRow({id: 'coords', kind: 'Coordinates', title: `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`,
      subtitle: [coords.borough, ...coords.notes].filter(Boolean).join('. '), latitude: coords.latitude, longitude: coords.longitude}, 'Coordinates'));
    else if (coords?.deliberate) rows.push({id: 'coords', kind: 'Coordinates', disabled: true, title: 'Outside the map', subtitle: 'No reading of these numbers falls in New York City'});
    if (coords?.status !== 'ok') rows.push(...records(query));
    if (state.nyc.query === query) rows.push(...state.nyc.rows.map(row => pointRow(row, row.kind)));
    if (state.osm.query === query) rows.push(...state.osm.rows.map(row => pointRow(row, row.kind)));
    if (!coords && engine() && !(state.osm.query === query && !state.osm.busy)) {
      rows.push({id: 'streets', action: 'streets', kind: '', disabled: state.osm.busy,
        title: state.osm.busy ? 'Searching streets and buildings…' : 'Search streets and buildings', subtitle: state.osm.busy ? '' : 'Press Enter'});
    }
    return rows;
  }

  function render() {
    const query = input.value.trim();
    state.rows = rowsFor(query);
    if (state.active >= state.rows.length) state.active = -1;
    list.replaceChildren(...state.rows.map((row, i) => {
      const option = text('div', '', 'contribution-place-option' + (row.action ? ' action' : ''));
      option.id = 'contributionPlaceOption' + i;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(i === state.active));
      if (row.disabled) option.setAttribute('aria-disabled', 'true');
      option.append(text('span', row.title, 'contribution-place-option-title'));
      const meta = [row.kind, row.subtitle].filter(Boolean).join(' · ');
      if (meta) option.append(text('span', meta, 'contribution-place-option-meta'));
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => activate(row));
      return option;
    }));
    if (state.osm.query === query && state.osm.note) list.append(text('p', state.osm.note, 'contribution-place-note'));
    const open = document.activeElement === input && list.children.length > 0;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    input.setAttribute('aria-activedescendant', state.active >= 0 ? 'contributionPlaceOption' + state.active : '');
  }

  // ---- Choosing ----------------------------------------------------------------

  const pointMode = () => !$('newPlaceLocation').hidden;

  function say(message) { status.textContent = message; delete status.dataset.state; }

  function activate(row) {
    if (!row || row.disabled) return;
    if (row.action === 'pick') { input.blur(); window.dispatchEvent(new CustomEvent('contributions-place-pick-requested')); return; }
    if (row.action === 'streets') { searchStreets(); return; }
    // A place that could not be set keeps the typed text, so it can be tried again.
    if (!(row.record ? chooseRecord(row.record) : choosePoint(row))) return;
    input.value = ''; state.active = -1; state.quiet = true; state.nyc = {query: '', rows: []}; state.osm = {query: '', rows: [], busy: false, note: ''};
    render();
  }

  function chooseRecord(record) {
    const search = $('existingPlaceSearch'), select = $('freeformPlaceSelect');
    search.value = ''; search.dispatchEvent(new Event('input', {bubbles: true}));
    select.value = record.id;
    if (select.value !== record.id) { say('That place cannot take contributions yet.'); return false; }
    select.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  }

  function choosePoint(row) {
    if(!window.HauntologiesAccount?.canContribute())return false;
    // A new point replaces a chosen record.
    if (!$('freeformRecordContext').hidden) $('removeFreeformRecord').click();
    // Coordinates are already on the status line; look up a street name for them instead.
    state.named = row.kind === 'Coordinates' ? null : {latitude: row.latitude, longitude: row.longitude, name: row.title};
    // Bring the spot into view first; app.js then keeps the pin clear of this panel.
    if (inBoroughs(row.latitude, row.longitude) && typeof map !== 'undefined' && map) map.setView([row.latitude, row.longitude], Math.max(map.getZoom(), 17), {animate: false});
    if (!window.ContributionPoint.request({latitude: row.latitude, longitude: row.longitude}, {replace: true})) {
      state.named = null;
      say(inBoroughs(row.latitude, row.longitude) ? 'The form is busy. Try again when the upload finishes.' : 'New places must be in New York City.');
      return false;
    }
    return true;
  }

  // ---- Remote lookups ------------------------------------------------------------

  let suggestTimer = 0, suggestAbort = null;
  function scheduleSuggest(query) {
    clearTimeout(suggestTimer); suggestAbort?.abort();
    if (!engine() || query.length < 3 || M.parseCoordinates(query) || M.parseOsmReference(query) || /^https?:/i.test(query)) return;
    suggestTimer = setTimeout(async () => {
      suggestAbort = new AbortController();
      try {
        const rows = await engine().suggest(query, suggestAbort.signal);
        if (input.value.trim() !== query) return;
        state.nyc = {query, rows: rows.slice(0, 4)};
        render();
      } catch (error) { if (error.name !== 'AbortError') { state.nyc = {query, rows: []}; render(); } }
    }, 250);
  }

  async function searchStreets() {
    const query = input.value.trim();
    if (!engine() || !query || state.osm.busy) return;
    state.osm = {query, rows: [], busy: true, note: ''};
    render();
    try {
      const {rows} = await engine().resolve(query);
      // Results stay filed under their own query even if the field has moved on.
      state.osm = {query, rows: rows.slice(0, 6), busy: false, note: rows.length ? '' : 'Nothing found in New York City. Try an address, or Pin it on the map.'};
    } catch (error) {
      state.osm = {query, rows: [], busy: false, note: error.message === 'busy' ? 'The street search is busy. Try again in a moment.' : 'The street search is unavailable. Pin it on the map instead.'};
    }
    render();
    const usable = state.osm.rows.filter(row => inBoroughs(row.latitude, row.longitude));
    if (usable.length === 1 && M.parseOsmReference(query) && input.value.trim() === query) activate(pointRow(usable[0], usable[0].kind));
  }

  // ---- The pinned point's plate ---------------------------------------------------

  const same = (a, b) => a && b && Math.abs(a.latitude - b.latitude) < 1e-6 && Math.abs(a.longitude - b.longitude) < 1e-6;
  let reverseTimer = 0, reverseFor = null, naming = Promise.resolve();
  function showPlate(point) {
    clear.hidden = !point;
    // The last name is kept, so returning to the same pin (after Change) shows it again.
    if (!point) { nameNode.textContent = ''; return; }
    if (same(point, state.named)) nameNode.textContent = state.named.name;
    else {
      nameNode.textContent = '';
      if (engine()?.reverse && !same(point, reverseFor)) {
        clearTimeout(reverseTimer); reverseFor = point;
        // Preview waits on this, so a quick submit still carries the place's name.
        naming = new Promise(resolve => {
          reverseTimer = setTimeout(async () => {
            try {
              const row = await engine().reverse(point.latitude, point.longitude);
              if (row && same(point, reverseFor) && same(window.ContributionPoint.get(), point)) { state.named = {...point, name: row.title}; nameNode.textContent = row.title; }
            } catch {}
            resolve();
          }, 400);
        });
      }
    }
    // A restored draft has a point but no confirmation yet.
    if (!status.textContent && status.dataset.state !== 'picking') {
      const borough = window.NycGeometry?.findBorough(point.latitude, point.longitude);
      status.textContent = 'Pinned at ' + point.latitude.toFixed(5) + ', ' + point.longitude.toFixed(5) + (borough ? ' in ' + borough : '');
      status.dataset.state = 'success';
    }
  }
  window.addEventListener('contributions-point-changed', event => showPlate(event.detail?.point || null));
  // A place plotted with the map's pin tool arrives already named by its cross streets.
  window.addEventListener('contributions-plot-confirmed', event => {
    const {latitude, longitude, name} = event.detail || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    choosePoint({latitude, longitude, title: name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, kind: 'Plotted'});
  });
  clear.addEventListener('click', () => { $('cancelContributionPoint').click(); input.focus(); });
  // The pinned point's name, once looked up; never waits longer than `ms`.
  window.ContributionPlace = Object.freeze({named: (ms = 2500) => Promise.race([naming, new Promise(resolve => setTimeout(resolve, ms))])});
  // contributions.js restores a draft before this script loads.
  showPlate(window.ContributionPoint.get());

  // ---- Field behaviour ---------------------------------------------------------------

  input.addEventListener('input', () => { state.active = -1; state.quiet = false; render(); scheduleSuggest(input.value.trim()); });
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) { state.quiet = false; list.hidden = true; input.setAttribute('aria-expanded', 'false'); } }));
  input.addEventListener('keydown', event => {
    const enabled = state.rows.map((row, i) => row.disabled ? -1 : i).filter(i => i >= 0);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!enabled.length) return;
      const at = enabled.indexOf(state.active), step = event.key === 'ArrowDown' ? 1 : -1;
      state.active = enabled[at < 0 ? (step > 0 ? 0 : enabled.length - 1) : (at + step + enabled.length) % enabled.length];
      render();
      $('contributionPlaceOption' + state.active)?.scrollIntoView({block: 'nearest'});
    } else if (event.key === 'Enter') {
      // Enter never submits the form from here.
      event.preventDefault();
      const query = input.value.trim();
      if (state.active >= 0) activate(state.rows[state.active]);
      else if (state.rows[0]?.id === 'coords' && !state.rows[0].disabled) activate(state.rows[0]);
      else if (query) searchStreets();
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault(); event.stopPropagation();
      if (state.active >= 0) { state.active = -1; render(); } else { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    }
  });
})();
