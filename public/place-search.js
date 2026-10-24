'use strict';
// Place search. A search icon in the map controls opens into a field on hover
// or focus. As you type it answers from coordinates and the map's own
// collections (both local), then NYC GeoSearch addresses. Enter asks
// Nominatim for streets, buildings, intersections and OpenStreetMap objects
// across Greater NYC in New York State. A chosen place can be routed to on
// foot, by bike or by car, listing the collection's places along the way.
(function () {
  const M = window.PlaceSearchModel, $ = id => document.getElementById(id);
  const root = $('placeSearch');
  if (!M || !root || !window.L || typeof map === 'undefined' || !map) return;

  const toggle = $('placeSearchToggle'), form = $('placeSearchForm'), input = $('placeSearchInput');
  const panel = $('placeSearchPanel'), status = $('placeSearchStatus'), list = $('placeSearchResults'), card = $('placeSearchTarget');
  const RECENT = 'hauntologies-place-search-recent-v1';
  const narrow = () => matchMedia('(max-width:760px)').matches;
  const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value ?? ''; if (className) node.className = className; return node; };
  const button = (label, className, action) => { const node = text('button', label, className); node.type = 'button'; node.addEventListener('click', action); return node; };

  const state = {
    query: '', rows: [], active: -1,
    nyc: {query: '', rows: []}, osm: {query: '', rows: [], busy: false, note: ''},
    target: null, origin: null, choosing: 'target', profile: 'foot', route: null, along: []
  };

  // ---- Map layers ----------------------------------------------------------

  map.createPane('searchFocus').style.zIndex = 440;
  const focusLayer = L.layerGroup().addTo(map), routeLayer = L.layerGroup().addTo(map);
  const pin = (latlng, className, label) => {
    const marker = L.marker(latlng, {interactive: false, keyboard: false, zIndexOffset: 700,
      icon: L.divIcon({className, html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 15]})});
    marker.on('add', () => marker.getElement()?.setAttribute('aria-label', label));
    return marker;
  };

  function drawTarget() {
    focusLayer.clearLayers();
    const t = state.target;
    if (!t || !Number.isFinite(t.latitude)) return;
    if (t.geometry) {
      const line = /LineString/.test(t.geometry.type);
      L.geoJSON(t.geometry, {pane: 'searchFocus', interactive: false,
        style: {color: '#ffcf94', weight: line ? 6 : 2, opacity: .9, dashArray: line ? null : '6 4', fillColor: '#eab37d', fillOpacity: .14}}).addTo(focusLayer);
    }
    pin([t.latitude, t.longitude], 'search-pin' + (t.record ? ' record' : ''), t.title).addTo(focusLayer);
  }

  // Keep the place clear of the results panel and the masthead.
  function reveal(place, bounds) {
    map.stop();
    const box = panel.hidden ? null : panel.getBoundingClientRect(), brand = document.querySelector('.brand')?.getBoundingClientRect();
    const right = box && box.left > 280 ? innerWidth - box.left + 24 : 24;
    const zoom = place.kind === 'Street' || place.kind === 'Area' ? 16 : 18;
    const extent = bounds || (place.bounds && place.kind !== 'Address' ? place.bounds : null);
    const target = extent || [[place.latitude, place.longitude], [place.latitude, place.longitude]];
    // A single point is centred clear of the panel; an extent (a route, a
    // street) must also stay out from under the masthead.
    const top = brand && (narrow() || extent) ? brand.bottom + 16 : 24;
    map.fitBounds(target, {paddingTopLeft: [24, top], paddingBottomRight: [right, 88], maxZoom: Math.max(zoom, bounds ? 0 : map.getZoom()), animate: false});
  }

  // ---- Collection index ------------------------------------------------------

  let indexCache = {key: '', index: []};
  function collectionIndex() {
    const records = typeof allRecords === 'function' ? allRecords() : [];
    const key = records.map(r => r.id).join('|');
    if (key !== indexCache.key) {
      indexCache = {key, index: M.buildIndex(records, {
        point: r => { const c = AtlasModel.normalize(r).geometry?.coordinates; return c ? [c[1], c[0]] : null; },
        labels: r => [typeof layerName === 'function' ? layerName(r) : '', ...(AtlasModel.normalize(r).placeTypes || [])]
      })};
    }
    return indexCache.index;
  }

  function view() {
    const center = map.getCenter();
    return {center: [center.lat, center.lng], radius: map.distance(center, map.getBounds().getNorthEast())};
  }

  // ---- Network -----------------------------------------------------------------

  const cache = new Map();
  async function getJSON(url, signal) {
    if (cache.has(url)) return cache.get(url);
    const response = await fetch(url, {signal, headers: {Accept: 'application/json'}, referrerPolicy: 'strict-origin-when-cross-origin'});
    if (!response.ok) throw new Error(response.status === 429 ? 'busy' : 'unavailable');
    const json = await response.json();
    if (cache.size > 80) cache.delete(cache.keys().next().value);
    cache.set(url, json);
    return json;
  }

  // Nominatim allows one request a second and no search-as-you-type, so its
  // requests are queued and only sent on Enter.
  let nominatimQueue = Promise.resolve(), nominatimAt = 0;
  function nominatim(url) {
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    const run = nominatimQueue.then(async () => {
      const wait = nominatimAt + 1100 - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      nominatimAt = Date.now();
      return getJSON(url);
    });
    nominatimQueue = run.catch(() => {});
    return run;
  }

  let geosearchTimer = 0, geosearchAbort = null;
  function scheduleGeosearch(query) {
    clearTimeout(geosearchTimer); geosearchAbort?.abort();
    if (query.length < 3 || state.coords || M.parseOsmReference(query) || /^https?:/i.test(query)) return;
    geosearchTimer = setTimeout(async () => {
      geosearchAbort = new AbortController();
      try {
        const rows = M.fromGeosearch(await getJSON(M.geosearchUrl(query), geosearchAbort.signal));
        if (input.value.trim() !== query) return;
        state.nyc = {query, rows: rows.slice(0, 5)};
        render();
      } catch (error) { if (error.name !== 'AbortError') { state.nyc = {query, rows: []}; render(); } }
    }, 250);
  }

  // Streets, buildings, intersections and OSM objects for one query; shared
  // with the Contribute form through window.PlaceSearch.resolve.
  async function lookupStreets(query) {
    const ref = M.parseOsmReference(query);
    let rows;
    if (ref) rows = M.fromNominatim(await nominatim(M.lookupUrl(ref)));
    else {
      rows = M.fromNominatim(await nominatim(M.nominatimUrl(query)));
      const split = M.splitIntersection(query), streets = split && (split.explicit || !rows.length) ? split.streets : null;
      if (streets) {
        // No intersections in Nominatim: fetch both streets and find where they meet.
        const segments = (name, bounds) => nominatim(M.nominatimUrl(name, {limit: bounds ? 40 : 20, dedupe: false, bounds})).then(M.fromNominatim);
        const [a, b] = await Promise.all(streets.map(name => segments(name)));
        let meet = M.intersectLines(a.map(r => r.geometry), b.map(r => r.geometry));
        // A long street (Broadway) has more segments than one page holds:
        // look for it again where the shorter street is.
        if (!meet && a.length && b.length) {
          const [long, short] = a.length >= b.length ? [streets[0], b] : [streets[1], a];
          for (const bounds of M.streetClusters(short)) {
            meet = M.intersectLines((await segments(long, bounds)).map(r => r.geometry), short.map(r => r.geometry));
            if (meet) break;
          }
        }
        if (meet) rows = [{id: 'x:' + streets.join('&'), source: 'osm', kind: 'Intersection', title: streets.join(' & '),
          subtitle: [...new Set([a[0], b[0]].flatMap(r => (r?.subtitle || '').split(', ')))]
            .filter(part => part && !/\b(street|avenue|road|place|boulevard|drive|lane|st|ave)\b/i.test(part)).join(', '),
          latitude: meet.latitude, longitude: meet.longitude,
          bounds: null, geometry: null, first: true}, ...rows];
      }
    }
    return {ref, rows};
  }

  async function runNominatim() {
    const query = input.value.trim();
    if (!query || state.osm.busy) return;
    state.osm = {query, rows: [], busy: true, note: ''};
    render();
    let ref = null;
    try {
      let rows;
      ({ref, rows} = await lookupStreets(query));
      if (input.value.trim() !== query) return;
      const {center, radius} = view();
      rows.forEach((row, rank) => { row.distance = M.distanceMeters(center, [row.latitude, row.longitude]); row.score = (row.first ? 10 : 1) * M.attenuation(row.distance, radius) / (1 + rank * .25); });
      state.osm = {query, rows: rows.sort((x, y) => y.score - x.score), busy: false,
        note: rows.length ? '' : ref ? 'That OpenStreetMap object is not in Greater NYC (New York State).' : 'No streets or buildings found in Greater NYC (New York State).'};
    } catch (error) {
      state.osm = {query, rows: [], busy: false, note: error.message === 'busy' ? 'The street search is busy. Try again in a moment.' : 'The street search is unavailable right now.'};
    }
    render();
    if (state.osm.rows.length === 1 && ref) activate(state.osm.rows[0]);
  }

  // ---- Results -----------------------------------------------------------------

  function placeFromRecord(record, point) {
    return {id: 'record:' + record.id, record, kind: typeof layerName === 'function' ? layerName(record) : 'Place', title: record.title,
      subtitle: [record.borough, window.PlaceSummary?.view(record).location].filter(Boolean).join(' · '), latitude: point?.[0] ?? null, longitude: point?.[1] ?? null};
  }

  function rowsFor() {
    const query = input.value.trim(), groups = [];
    if (!query) {
      const recent = readRecent();
      if (recent.length && state.choosing === 'target' && !state.target) groups.push(['Recent', recent]);
      return flatten(groups);
    }
    // The field shows the chosen place's name; its card replaces the results.
    if (state.target && state.choosing === 'target' && query === state.target.title) return [];
    const coords = state.coords;
    if (coords?.status === 'ok') groups.push(['Coordinates', [{id: 'coords', kind: 'Coordinates', title: `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
      subtitle: [coords.borough || 'Outside the five boroughs', ...coords.notes].join(' · '), latitude: coords.latitude, longitude: coords.longitude, notes: coords.notes}]]);
    else if (coords?.deliberate) groups.push(['Coordinates', [{id: 'coords', kind: 'Coordinates', disabled: true, title: 'Outside the map',
      subtitle: 'No reading of these numbers falls in Greater NYC'}]]);
    const {center, radius} = view();
    const local = M.searchIndex(collectionIndex(), query, {center, radius, limit: 6});
    if (local.length) groups.push(['On this map', local.map(hit => ({...placeFromRecord(hit.record, hit.point), distance: hit.distance}))]);
    if (state.nyc.query === query && state.nyc.rows.length) groups.push(['Addresses', state.nyc.rows.map((row, rank) => {
      const distance = M.distanceMeters(center, [row.latitude, row.longitude]);
      return {...row, distance, score: M.attenuation(distance, radius) / (1 + rank * .25)};
    }).sort((x, y) => y.score - x.score)]);
    if (state.osm.query === query && state.osm.rows.length) groups.push(['Streets and buildings', state.osm.rows]);
    if (!coords?.deliberate && coords?.status !== 'ok' && !(state.osm.query === query && !state.osm.busy)) {
      const ref = M.parseOsmReference(query);
      groups.push(['', [{id: 'action', action: true, kind: 'Search', disabled: state.osm.busy,
        title: state.osm.busy ? 'Searching…' : ref ? `Look up OpenStreetMap ${({N: 'node', W: 'way', R: 'relation'})[ref.type]} ${ref.id}` : `Search streets and buildings for “${query}”`,
        subtitle: state.osm.busy ? '' : 'Enter · OpenStreetMap Nominatim'}]]);
    }
    return flatten(groups);
  }

  function flatten(groups) {
    return groups.flatMap(([label, rows]) => rows.map((row, i) => ({...row, group: i ? null : label})));
  }

  const ICONS = {
    Coordinates: '<path d="M12 3v4m0 10v4M3 12h4m10 0h4"/><circle cx="12" cy="12" r="4"/>',
    Street: '<path d="M8 3 5 21M16 3l3 18M12 4v3m0 4v3m0 4v2"/>',
    Intersection: '<path d="M12 3v18M3 12h18"/>',
    Transit: '<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 11h12M9 21l1.5-4M15 21l-1.5-4M9 14h.01M15 14h.01"/>',
    Building: '<path d="M5 21V4h10v17M15 9h4v12M3 21h18M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1"/>',
    Address: '<path d="M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
    Area: '<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/>',
    Landmark: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    Search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    Location: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>',
    Record: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/>'
  };
  const icon = kind => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind] || ICONS.Record}</svg>`;

  function render() {
    const query = input.value.trim();
    state.coords = query ? M.parseCoordinates(query, {locate: (lat, lon) => window.NycGeometry?.findBorough(lat, lon) || null}) : null;
    state.rows = rowsFor();
    if (state.active >= state.rows.length) state.active = -1;
    list.replaceChildren();
    state.rows.forEach((row, i) => {
      if (row.group) list.append(text('p', row.group, 'place-search-group'));
      const option = document.createElement('div');
      option.id = 'placeSearchOption' + i; option.className = 'place-search-option' + (row.action ? ' action' : '');
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(i === state.active));
      if (row.disabled) option.setAttribute('aria-disabled', 'true');
      option.insertAdjacentHTML('beforeend', `<span class="place-search-icon">${icon(row.record ? 'Record' : row.kind)}</span>`);
      const body = text('span', '', 'place-search-text');
      body.append(text('span', row.title, 'place-search-title'), text('span', [row.action ? '' : row.kind, row.subtitle].filter(Boolean).join(' · '), 'place-search-meta'));
      option.append(body);
      if (Number.isFinite(row.distance)) { const d = text('span', M.formatDistance(row.distance), 'place-search-distance'); d.title = 'From the middle of the map'; option.append(d); }
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => activate(row));
      list.append(option);
    });
    const listed = Boolean(state.rows.length);
    list.hidden = !listed;
    input.setAttribute('aria-expanded', String(listed && !panel.hidden));
    input.setAttribute('aria-activedescendant', state.active >= 0 ? 'placeSearchOption' + state.active : '');
    status.textContent = state.choosing === 'origin' ? 'Choose a starting point' : state.osm.query === query && state.osm.note ? state.osm.note :
      /^https?:\/\//i.test(query) && !state.coords && !M.parseOsmReference(query) ? 'Links from other sites are not opened. Paste the address or an OpenStreetMap link.' : '';
    renderCard();
    syncPanel();
  }

  function move(step) {
    const enabled = state.rows.map((row, i) => row.disabled ? -1 : i).filter(i => i >= 0);
    if (!enabled.length) return;
    const at = enabled.indexOf(state.active);
    state.active = enabled[at < 0 ? (step > 0 ? 0 : enabled.length - 1) : (at + step + enabled.length) % enabled.length];
    render();
    $('placeSearchOption' + state.active)?.scrollIntoView({block: 'nearest'});
  }

  function activate(row) {
    if (!row || row.disabled) return;
    if (row.action) { runNominatim(); return; }
    if (row.record && !Number.isFinite(row.latitude)) { openRecord(row.record); return; }
    const place = {...row};
    delete place.group; delete place.distance; delete place.score;
    remember(place);
    if (state.choosing === 'origin') { state.origin = place; state.choosing = 'target'; input.value = ''; updateRoute(); }
    else {
      state.target = place; state.route = null; state.along = []; routeLayer.clearLayers();
      input.value = place.title; drawTarget(); reveal(place);
      if (state.origin) updateRoute();
    }
    state.active = -1; state.nyc = {query: '', rows: []};
    render();
    if (narrow()) { close(); toggle.focus({preventScroll: true}); }
  }

  // ---- Target card and routing ---------------------------------------------------

  function renderCard() {
    const t = state.target;
    card.hidden = !t || Boolean(input.value.trim() && input.value.trim() !== t.title) || state.choosing === 'origin';
    toggle.classList.toggle('holding', Boolean(t));
    $('placeSearchHeld').hidden = !t;
    if (card.hidden) return;
    // Re-rendering replaces the buttons; keep keyboard focus on the same one.
    const focused = card.contains(document.activeElement) ? document.activeElement.textContent : null;
    card.replaceChildren();
    card.append(text('p', [t.kind, t.record ? t.record.borough : null].filter(Boolean).join(' · '), 'place-search-kind'), text('h3', t.title));
    if (t.subtitle && !t.record) card.append(text('p', t.subtitle, 'place-search-subtitle'));
    if (Number.isFinite(t.latitude)) card.append(text('p', `${t.latitude.toFixed(6)}, ${t.longitude.toFixed(6)}`, 'place-search-coords'));
    const actions = text('div', '', 'place-search-actions');
    if (t.record) actions.append(button('Open record', 'primary', () => openRecord(t.record)));
    if (document.body.classList.contains('contribution-picking') && typeof requestContributionPoint === 'function') {
      actions.append(button('Use this location', 'primary', () => { requestContributionPoint(L.latLng(t.latitude, t.longitude), true); close(); }));
    }
    actions.append(button(state.origin || state.route ? 'Route' : 'Directions', 'outline', startRoute), button('Clear', 'textbutton', clearAll));
    card.append(actions);
    if (t.links) {
      const links = text('p', '', 'place-search-links');
      for (const [href, label] of [[t.links.osm, 'OpenStreetMap'], [t.links.details, 'Nominatim details']]) {
        const a = text('a', label); a.href = href; a.target = '_blank'; a.rel = 'noopener'; links.append(a);
      }
      card.append(links);
    }
    if (state.origin || state.route) card.append(routeSection());
    if (focused) [...card.querySelectorAll('button')].find(node => node.textContent === focused)?.focus({preventScroll: true});
  }

  function routeSection() {
    const section = text('section', '', 'place-search-route');
    section.setAttribute('aria-label', 'Directions');
    const modes = text('div', '', 'place-search-modes');
    modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Travel mode');
    for (const [profile, label] of Object.entries(M.PROFILES)) {
      const mode = button(label[0].toUpperCase() + label.slice(1), 'outline', () => { state.profile = profile; updateRoute(); });
      mode.setAttribute('aria-pressed', String(state.profile === profile));
      modes.append(mode);
    }
    section.append(modes);
    const from = text('p', '', 'place-search-from');
    from.append(text('span', 'From ', 'place-search-kind'), text('strong', state.origin ? state.origin.title : 'Choose a start'));
    section.append(from);
    const actions = text('div', '', 'place-search-actions');
    actions.append(button(state.origin ? 'Change start' : 'Search a start', 'outline', chooseOrigin));
    if (navigator.geolocation) actions.append(button('My location', 'outline', useMyLocation));
    if (state.origin) actions.append(button('Swap', 'textbutton', swap), button('Clear route', 'textbutton', clearRoute));
    section.append(actions);
    const r = state.route;
    if (r?.busy) section.append(text('p', 'Finding a route…', 'place-search-summary'));
    else if (r?.error) section.append(text('p', r.error, 'place-search-summary error'));
    else if (r?.line) {
      section.append(text('p', `${M.formatDistance(r.distance)} · ${M.formatDuration(r.duration)} ${M.PROFILES[state.profile]}`, 'place-search-summary'));
      section.append(text('h4', state.along.length ? `Along the way · ${state.along.length}` : 'No mapped places along the way'));
      if (state.along.length) {
        const ol = text('ol', '', 'place-search-along');
        for (const hit of state.along) {
          const li = document.createElement('li');
          const go = button(hit.record.title, 'place-search-along-item', () => openRecord(hit.record));
          go.append(text('span', `${M.formatDistance(hit.along)} in · ${M.formatDistance(hit.distance)} off route`, 'place-search-meta'));
          li.append(go); ol.append(li);
        }
        section.append(ol);
      }
    }
    return section;
  }

  function startRoute() {
    if (!state.origin) { chooseOrigin(); return; }
    updateRoute();
  }

  function chooseOrigin() {
    state.choosing = 'origin'; state.route = state.route?.line ? state.route : null;
    input.value = ''; input.placeholder = 'Starting point: street, place or lat, lon';
    open(); input.focus(); render();
  }

  function useMyLocation() {
    status.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(position => {
      const {latitude, longitude} = position.coords;
      if (!M.inArea(latitude, longitude)) { status.textContent = 'Your location is outside the map area.'; return; }
      state.origin = {id: 'here', kind: 'Location', title: 'Your location', latitude, longitude};
      state.choosing = 'target'; input.placeholder = PLACEHOLDER; updateRoute();
    }, () => { status.textContent = 'Your location is unavailable.'; }, {enableHighAccuracy: true, timeout: 10000, maximumAge: 60000});
  }

  function swap() { [state.origin, state.target] = [state.target, state.origin]; input.value = state.target.title; drawTarget(); updateRoute(); }
  function clearRoute() { routeAbort?.abort(); state.origin = null; state.route = null; state.along = []; routeLayer.clearLayers(); render(); }
  function clearAll() { clearRoute(); state.target = null; focusLayer.clearLayers(); input.value = ''; render(); input.focus(); }

  let routeAbort = null;
  async function updateRoute() {
    const {origin, target, profile} = state;
    input.placeholder = PLACEHOLDER;
    if (!origin || !target) { render(); return; }
    routeAbort?.abort(); routeAbort = new AbortController();
    const signal = routeAbort.signal;
    state.route = {busy: true}; input.value = target.title; render();
    try {
      const route = M.fromRoute(await getJSON(M.routeUrl(profile, origin, target), signal));
      if (signal.aborted) return;
      if (!route) throw new Error('none');
      state.route = route;
      state.along = M.alongRoute(collectionIndex(), route.line, {meters: 150}).filter(hit => hit.record.id !== target.record?.id && hit.record.id !== origin.record?.id);
      routeLayer.clearLayers();
      const line = {type: 'LineString', coordinates: route.line};
      L.geoJSON(line, {pane: 'searchFocus', interactive: false, style: {color: '#080908', weight: 9, opacity: .7}}).addTo(routeLayer);
      L.geoJSON(line, {pane: 'searchFocus', interactive: false, style: {color: '#e9caa1', weight: 4, opacity: .95}}).addTo(routeLayer);
      pin([origin.latitude, origin.longitude], 'search-pin origin', 'Route start: ' + origin.title).addTo(routeLayer);
      render();
      reveal(target, L.latLngBounds(route.line.map(([lon, lat]) => [lat, lon])));
    } catch (error) {
      if (signal.aborted) return;
      state.route = {error: error.message === 'none' ? 'No route between these places.' : 'Routing is unavailable right now.'};
      render();
    }
  }

  function openRecord(record) {
    if (typeof filtered === 'function' && typeof resetFilters === 'function' && !filtered().some(r => r.id === record.id)) resetFilters(false);
    close();
    if (typeof selectRecord === 'function') selectRecord(record);
  }

  // ---- Recent places (this browser only) -----------------------------------------

  function readRecent() {
    try {
      const rows = JSON.parse(localStorage.getItem(RECENT) || '[]');
      const records = typeof allRecords === 'function' ? allRecords() : [];
      return (Array.isArray(rows) ? rows : []).flatMap(row => {
        if (row.recordId) {
          const record = records.find(r => r.id === row.recordId);
          const c = record && AtlasModel.normalize(record).geometry?.coordinates;
          return record ? [placeFromRecord(record, c ? [c[1], c[0]] : null)] : [];
        }
        return M.inArea(row.latitude, row.longitude) ? [{...row, id: 'recent:' + row.title}] : [];
      }).slice(0, 5);
    } catch { return []; }
  }

  function remember(place) {
    if (place.kind === 'Location') return;
    try {
      const entry = place.record ? {recordId: place.record.id} : {kind: place.kind, title: place.title, subtitle: place.subtitle, latitude: place.latitude, longitude: place.longitude, links: place.links || null};
      const key = JSON.stringify(entry.recordId || entry.title);
      const rows = JSON.parse(localStorage.getItem(RECENT) || '[]').filter(row => JSON.stringify(row.recordId || row.title) !== key);
      localStorage.setItem(RECENT, JSON.stringify([entry, ...rows].slice(0, 5)));
    } catch {}
  }

  // ---- Opening, peeking and closing ------------------------------------------------

  const PLACEHOLDER = input.placeholder;
  const toolPanels = ['toolsMenu', 'layersPanel', 'filtersPanel', 'researchSidecar'];

  function layout() {
    // In a horizontal Tools tray the toggle sits at the tray's left end, so
    // the field and panel drop below the tray into the popout column instead.
    const tray = root.closest('#mapToolTray');
    const row = Boolean(tray) && getComputedStyle(tray).flexDirection.startsWith('row');
    root.classList.toggle('in-tray', row);
    if (row) {
      const top = tray.getBoundingClientRect().bottom + 8, inset = narrow() ? 12 : 20;
      root.style.setProperty('--search-top', top + 'px');
      root.style.setProperty('--search-right', inset + 'px');
      root.style.setProperty('--search-width', Math.min(400, innerWidth - 40) + 'px');
      root.style.setProperty('--search-panel-max', Math.max(160, innerHeight - top - 50 - 96) + 'px');
      return;
    }
    const box = toggle.getBoundingClientRect(), masthead = document.querySelector('.masthead').getBoundingClientRect();
    const room = Math.max(160, Math.min(380, box.left - masthead.left - 6));
    root.style.setProperty('--search-room', room + 'px');
    // On narrow screens the panel also spans under the toggle; either way it starts where the field does.
    root.style.setProperty('--search-panel-width', (narrow() ? room + 6 + box.width : room) + 'px');
    root.style.setProperty('--search-panel-max', Math.max(160, innerHeight - box.bottom - 96) + 'px');
  }

  function syncPanel() {
    const show = root.classList.contains('is-open') && Boolean(state.rows.length || !card.hidden || status.textContent);
    panel.hidden = !show;
    input.setAttribute('aria-expanded', String(show && state.rows.length > 0));
  }

  function open() {
    if (root.classList.contains('is-open')) return;
    // Close Places, Filters and Layers; leave contribution point picking alone.
    if (toolPanels.some(id => $(id) && !$(id).hidden) && typeof closeTools === 'function') closeTools();
    layout();
    root.classList.add('is-open', 'is-peeking');
    setExpanded(true);
    render();
  }

  // Another control (a tools tray) may open the search; it mirrors our state.
  const setExpanded = value => {
    for (const node of [toggle, $('mapSearchButton')]) node?.setAttribute('aria-expanded', String(value));
  };

  function close() {
    root.classList.remove('is-open', 'is-peeking');
    setExpanded(false);
    if (state.choosing === 'origin') { state.choosing = 'target'; input.placeholder = PLACEHOLDER; input.value = state.target?.title || ''; }
    state.active = -1;
    syncPanel();
  }

  let leaveTimer = 0;
  root.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(leaveTimer); layout(); root.classList.add('is-peeking');
  });
  root.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    leaveTimer = setTimeout(() => { if (!root.classList.contains('is-open')) root.classList.remove('is-peeking'); }, 450);
  });
  toggle.addEventListener('click', () => {
    if (root.classList.contains('is-open')) { close(); return; }
    open(); input.focus();
  });
  input.addEventListener('focus', open);
  input.addEventListener('input', () => {
    state.active = -1; render(); scheduleGeosearch(input.value.trim());
  });
  form.addEventListener('submit', event => event.preventDefault());
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); move(event.key === 'ArrowDown' ? 1 : -1); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (state.active >= 0) activate(state.rows[state.active]);
      else if (state.coords?.status === 'ok') activate(state.rows.find(row => row.id === 'coords'));
      else runNominatim();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (state.choosing === 'origin') { state.choosing = 'target'; input.placeholder = PLACEHOLDER; input.value = state.target?.title || ''; render(); }
      else if (state.active >= 0) { state.active = -1; render(); }
      else if (input.value && input.value !== state.target?.title) { input.value = state.target?.title || ''; render(); }
      else { close(); toggle.focus({preventScroll: true}); }
    }
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.target !== input && root.classList.contains('is-open')) { event.preventDefault(); close(); toggle.focus({preventScroll: true}); }
  });

  // Stays open while the map is panned on wide screens; other controls close it.
  document.addEventListener('pointerdown', event => {
    if (!root.classList.contains('is-open') || root.contains(event.target)) return;
    if (!narrow() && $('map').contains(event.target)) return;
    close();
  }, {capture: true});
  root.addEventListener('focusout', event => {
    const next = event.relatedTarget;
    if (next && !root.contains(next) && !$('map').contains(next)) close();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input,textarea,select,[contenteditable="true"]') || document.querySelector('dialog[open]') || root.closest('[inert]')) return;
    event.preventDefault(); open(); input.focus();
  });
  window.addEventListener('map-search-requested', () => {
    if (root.classList.contains('is-open')) { close(); return; }
    open(); input.focus();
  });
  const described = new Map();
  function describe(latitude, longitude) {
    const key = latitude.toFixed(5) + ',' + longitude.toFixed(5);
    if (!described.has(key)) {
      const lookup = getJSON(M.reverseGeosearchUrl(latitude, longitude)).then(M.describeVicinity);
      described.set(key, lookup); lookup.catch(() => described.delete(key));
    }
    return described.get(key);
  }
  window.PlaceSearch = Object.freeze({
    open: () => { open(); input.focus(); },
    close,
    get isOpen() { return root.classList.contains('is-open'); },
    // The search engine without this control's UI, for other place fields.
    records: (query, limit = 6) => { const {center, radius} = view(); return M.searchIndex(collectionIndex(), query, {center, radius, limit}); },
    suggest: async (query, signal) => M.fromGeosearch(await getJSON(M.geosearchUrl(query), signal)),
    resolve: lookupStreets,
    reverse: async (latitude, longitude) => M.fromNominatim([await nominatim(M.reverseUrl(latitude, longitude))])[0] || null,
    // Cross streets and neighbourhood at a point, from NYC GeoSearch; remembered per spot.
    describe
  });
  window.addEventListener('resize', () => { if (root.classList.contains('is-open') || root.classList.contains('is-peeking')) layout(); });
  map.on('moveend', () => { if (!panel.hidden && input.value.trim()) render(); });
})();
