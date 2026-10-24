'use strict';
// Pure logic for the map's place search: coordinate repair, the collection
// index, and adapters for NYC GeoSearch, Nominatim and OSRM routing.
// place-search.js owns the DOM, the network and the map.
(function (root) {
  // The map's maxBounds: the five boroughs plus the edges of Westchester,
  // Nassau and Hudson/Bergen counties. Geocoder rows outside New York State
  // are dropped even when they fall inside this box.
  const AREA = Object.freeze({south: 40.43, west: -74.33, north: 40.99, east: -73.61});
  const inArea = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= AREA.south && lat <= AREA.north && lon >= AREA.west && lon <= AREA.east;

  // ---- Coordinates -------------------------------------------------------

  const NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
  const HEMISPHERE = /^[NSEW]$/;

  function fromUrl(input) {
    let url;
    try { url = new URL(input); } catch { return null; }
    if (url.protocol === 'geo:') return url.pathname.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)?.slice(1) || null;
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.replace(/^www\./, ''), params = url.searchParams;
    if (host === 'openstreetmap.org' || host === 'osm.org') {
      if (params.get('mlat') && params.get('mlon')) return [params.get('mlat'), params.get('mlon')];
      return url.hash.match(/map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/)?.slice(1) || null;
    }
    if (/^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) || /^maps\.google\.[a-z.]+$/.test(host)) {
      // !3d!4d is the dropped pin; @ is only the viewport centre.
      const pin = url.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (pin) return pin.slice(1);
      return (params.get('q') || params.get('query') || params.get('ll') || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)?.slice(1) || null;
    }
    return null;
  }

  function tokens(text) {
    const source = text.normalize('NFKC').toUpperCase()
      .replace(/[′’‘`´]/g, "'").replace(/[″“”]|''/g, '"').replace(/[º˚]/g, '°')
      .replace(/(\d)\s*DEG(?:REES?)?\b/g, '$1°')
      .replace(/\b(?:LAT(?:ITUDE)?|LONG?(?:ITUDE)?|LNG)\s*[:=]?/g, ' ');
    const list = source.match(/[+-]?\d+(?:\.\d+)?|[°'"]|(?<![A-Z])[NSEW](?![A-Z])|[,;/]|\S/g) || [];
    // Anything else (street names, words) means this is not a coordinate.
    return list.every(t => NUMBER.test(t) || /^[°'",;/]$/.test(t) || HEMISPHERE.test(t)) ? list : null;
  }

  // Groups tokens into degree/minute/second components with optional
  // hemispheres. Returns [{value, axis}] or null.
  function components(list) {
    const numbers = list.filter(t => NUMBER.test(t));
    const marked = list.some(t => /^[°'"]$/.test(t) || HEMISPHERE.test(t));
    if (!marked) {
      // Plain numbers: "40.75 -73.98", "40 45 30, 73 59 15".
      if (![2, 4, 6].includes(numbers.length)) return null;
      const half = numbers.length / 2;
      return [numbers.slice(0, half), numbers.slice(half)].map(parts => toComponent(parts, null));
    }
    const prefix = HEMISPHERE.test(list[0]);
    const parts = [];
    let current = null, pending = null;
    const close = () => { if (current?.numbers.length) parts.push(current); current = null; };
    for (const token of list) {
      if (HEMISPHERE.test(token)) {
        if (prefix) { close(); pending = token; } else if (current?.numbers.length) { current.hemisphere = token; close(); } else return null;
      } else if (/^[,;/]$/.test(token)) close();
      else if (token === '"') { if (current) current.complete = true; }
      else if (token === '°' || token === "'") continue;
      else {
        if (!current || current.complete || current.numbers.length === 3 || /^[+-]/.test(token)) {
          close(); current = {numbers: [], hemisphere: pending, complete: false}; pending = null;
        }
        current.numbers.push(token);
        // A decimal can only be the last part of a component.
        if (token.includes('.')) current.complete = true;
      }
    }
    close();
    if (parts.length !== 2) return null;
    return parts.map(part => toComponent(part.numbers, part.hemisphere));
  }

  function toComponent(parts, hemisphere) {
    const [d, m = '0', s = '0'] = parts, degrees = Number(d), minutes = Number(m), seconds = Number(s);
    if (parts.length > 1 && (d.includes('.') || minutes >= 60 || seconds >= 60 || /^[+-]/.test(m) || /^[+-]/.test(s))) return null;
    let value = Math.abs(degrees) + minutes / 60 + seconds / 3600;
    if (d.startsWith('-') || hemisphere === 'S' || hemisphere === 'W') value = -value;
    return {value, axis: hemisphere ? (/[NS]/.test(hemisphere) ? 'lat' : 'lon') : null, signed: /^[+-]/.test(d) || Boolean(hemisphere), integer: parts.length === 1 && !d.includes('.')};
  }

  // A value typed without its decimal point ("407484") is shifted until its
  // whole part lands in [lo, hi). Returns null when no shift fits.
  function rescale(value, lo, hi) {
    let x = Math.abs(value), k = 0;
    while (x >= hi && k < 9) { x /= 10; k++; }
    return k && x >= lo ? Math.sign(value) * x : null;
  }

  const CORRECTIONS = {
    swapped: 'Read as latitude, longitude',
    west: 'Added the minus sign for west longitude',
    north: 'Dropped the minus sign from latitude',
    decimal: 'Restored the decimal point'
  };

  function interpretations(a, b) {
    let orders;
    if (a.axis || b.axis) {
      if (a.axis && a.axis === b.axis) return [];
      // Hemisphere letters settle the order; reading them is not a correction.
      orders = [a.axis === 'lat' || b.axis === 'lon' ? [a, b, false] : [b, a, false]];
    } else orders = [[a, b, false], [b, a, true]];
    const out = [];
    for (const [lat, lon, swapped] of orders) {
      const lats = [[lat.value, []]], lons = [[lon.value, []]];
      if (lat.value < 0 && !lat.axis) lats.push([-lat.value, ['north']]);
      if (lon.value > 0 && !lon.signed) lons.push([-lon.value, ['west']]);
      const latScaled = lat.integer ? rescale(lat.value, 40, 41) : null;
      const lonScaled = lon.integer ? rescale(lon.value, 73, 75) : null;
      if (latScaled !== null) lats.push([Math.abs(latScaled), ['decimal']]);
      if (lonScaled !== null) lons.push([-Math.abs(lonScaled), lon.value > 0 && !lon.signed ? ['decimal', 'west'] : ['decimal']]);
      for (const [latitude, latFix] of lats) for (const [longitude, lonFix] of lons) {
        out.push({latitude, longitude, corrections: [...(swapped ? ['swapped'] : []), ...latFix, ...lonFix]});
      }
    }
    return out;
  }

  // Reads coordinates in decimal, DMS, hemisphere and map-link forms and
  // repairs the usual mistakes (reversed order, a dropped minus sign, a
  // dropped decimal point) toward the reading that lands in the map area.
  // `locate(lat, lon)` may name the borough; it ranks land above water.
  // Returns null when the text is not a coordinate at all. `deliberate` is
  // false for bare integers ("420 5"), which may be a half-typed address.
  function parseCoordinates(text, {locate} = {}) {
    const input = String(text ?? '').trim();
    if (!input || input.length > 200) return null;
    let pair;
    const linked = /^[a-z][a-z0-9+.-]*:/i.test(input) ? fromUrl(input) : null;
    if (linked) pair = linked.map(value => toComponent([value], null)).map((c, i) => ({...c, axis: i ? 'lon' : 'lat', signed: true}));
    else {
      const list = tokens(input);
      pair = list && components(list);
    }
    if (!pair || pair.some(c => !c || !Number.isFinite(c.value))) return null;
    const candidates = interpretations(pair[0], pair[1])
      .filter(c => Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180)
      .map(c => {
        const borough = inArea(c.latitude, c.longitude) && typeof locate === 'function' ? locate(c.latitude, c.longitude) || null : null;
        return {...c, borough, cost: c.corrections.length + (borough ? 0 : 0.5)};
      });
    const inside = candidates.filter(c => inArea(c.latitude, c.longitude)).sort((x, y) => x.cost - y.cost);
    const best = inside[0];
    const deliberate = Boolean(linked) || /[.°'"NSEW]/i.test(input);
    if (!best) {
      const first = candidates[0] || {latitude: pair[0].value, longitude: pair[1].value};
      return {status: 'outside', deliberate, latitude: first.latitude, longitude: first.longitude, corrections: [], notes: [], borough: null};
    }
    const round = v => Math.round(v * 1e6) / 1e6;
    return {status: 'ok', deliberate, latitude: round(best.latitude), longitude: round(best.longitude), corrections: best.corrections,
      notes: [...new Set(best.corrections.map(key => CORRECTIONS[key]))], borough: best.borough};
  }

  // ---- Text --------------------------------------------------------------

  const ORDINALS = {first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
    nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90};
  const TENS = {twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90};
  const STREET_TYPES = 'street|st|avenue|ave|av|place|pl|road|rd|drive|dr|terrace|ter|lane|ln|walk|court|ct|boulevard|blvd';
  const suffix = n => (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({1: 'st', 2: 'nd', 3: 'rd'}[n % 10] || 'th');
  const ORDINAL_WORDS = Object.keys(ORDINALS).join('|'), UNIT_WORDS = Object.keys(ORDINALS).slice(0, 9).join('|');

  // "Fifth" -> "5th", "Twenty-Third" -> "23rd". OSM and PAD name numbered
  // streets with numerals, so spelled-out ordinals find nothing.
  function ordinals(text, {streetsOnly = false} = {}) {
    const after = streetsOnly ? `(?=\\s+(?:${STREET_TYPES})\\b)` : '';
    return String(text ?? '')
      .replace(new RegExp(`\\b(${Object.keys(TENS).join('|')})[\\s-]+(${UNIT_WORDS})\\b${after}`, 'gi'), (_, tens, unit) => {
        const n = TENS[tens.toLowerCase()] + ORDINALS[unit.toLowerCase()];
        return n + suffix(n);
      })
      .replace(new RegExp(`\\b(${ORDINAL_WORDS})\\b${after}`, 'gi'), word => {
        const n = ORDINALS[word.toLowerCase()];
        return n + suffix(n);
      });
  }

  // Also tidies addresses pasted from a finding ("420 South Fifth Street\n
  // Brooklyn , NY 11211\nUnited States").
  const normalizeQuery = text => ordinals(String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').replace(/\s+,/g, ',')
    .replace(/,?\s*(?:United States(?: of America)?|USA)\s*$/i, '').replace(/^address\s*:?\s+/i, '').trim(), {streetsOnly: true});

  // "Broadway & W 4th St", "Bleecker at Thompson" -> two street names.
  // `explicit` is true for & @ + and false for words that also occur in
  // place names ("Church of St. Paul and St. Andrew").
  function splitIntersection(text) {
    const match = normalizeQuery(text).match(/^(.{2,}?)\s*(&|@|\+|\s(?:and|at|x)\s)\s*(.{2,})$/i);
    return match ? {streets: [match[1].trim(), match[3].trim()], explicit: /^[&@+]$/.test(match[2].trim())} : null;
  }

  const fold = text => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '');
  const tokenize = text => fold(ordinals(text)).replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);

  // True when `term` is within one edit (including a transposition) of the
  // token or of the token's same-length prefix.
  function nearMiss(term, token) {
    if (term.length < 4) return false;
    const target = token.length > term.length + 1 ? token.slice(0, term.length) : token;
    if (Math.abs(target.length - term.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < term.length && j < target.length) {
      if (term[i] === target[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (term[i + 1] === target[j] && term[i] === target[j + 1]) { i += 2; j += 2; }
      else if (term.length > target.length) i++;
      else if (term.length < target.length) j++;
      else { i++; j++; }
    }
    return edits + (term.length - i) + (target.length - j) <= 1;
  }

  // ---- Geometry ----------------------------------------------------------

  function distanceMeters(a, b) {
    const rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Local planar metres around NYC; good to well under 1% across the area.
  const KX = 111320 * Math.cos(40.7 * Math.PI / 180), KY = 110540;
  const project = ([lat, lon]) => [lon * KX, lat * KY];

  function nearestOnSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
    const x = a[0] + t * dx, y = a[1] + t * dy;
    return {t, point: [x, y], distance: Math.hypot(p[0] - x, p[1] - y)};
  }

  // How much a match loses with distance from the middle of the map view.
  // `radius` is the visible half-diagonal, so anything on screen keeps most
  // of its weight while strong matches across the city still surface.
  function attenuation(meters, radius) {
    if (!Number.isFinite(meters)) return 0.6;
    const r = Math.max(800, radius || 0);
    return 0.35 + 0.65 / (1 + (meters / r) ** 2);
  }

  // ---- Collection index --------------------------------------------------

  // `point(record)` returns [lat, lon] or null; `labels(record)` returns
  // extra searchable words such as the collection and place type.
  function buildIndex(records, {point = () => null, labels = () => []} = {}) {
    return records.map(record => ({
      record,
      point: point(record),
      title: fold(record.title),
      fields: [
        [record.title, 3],
        [(record.aliases || []).join(' '), 2.5],
        [[record.location_text, record.place_original, record.place_normalized].filter(Boolean).join(' '), 1.5],
        [[record.borough, ...labels(record)].filter(Boolean).join(' '), 1]
      ].map(([text, weight]) => ({tokens: tokenize(text), weight})).filter(field => field.tokens.length)
    }));
  }

  function searchIndex(index, query, {center = null, radius = 0, limit = 8} = {}) {
    const terms = tokenize(query), phrase = fold(query).trim();
    if (!terms.length) return [];
    const rows = [];
    for (const entry of index) {
      let score = 0;
      for (const term of terms) {
        let best = 0;
        for (const field of entry.fields) for (const token of field.tokens) {
          const quality = token === term ? 1 : token.startsWith(term) ? 0.8 : nearMiss(term, token) ? 0.45 : 0;
          best = Math.max(best, quality * field.weight);
        }
        if (!best) { score = 0; break; }
        score += best;
      }
      if (!score) continue;
      if (phrase.length > 2 && entry.title.includes(phrase)) score *= 1.25;
      const distance = center && entry.point ? distanceMeters(center, entry.point) : null;
      rows.push({record: entry.record, point: entry.point, distance, score: score * attenuation(distance ?? NaN, radius)});
    }
    return rows.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Indexed places within `meters` of a route, in the order the route
  // passes them. `line` is GeoJSON order: [[lon, lat], ...].
  function alongRoute(index, line, {meters = 150} = {}) {
    const path = line.map(([lon, lat]) => project([lat, lon]));
    if (path.length < 2) return [];
    const lengths = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const rows = [];
    for (const entry of index) {
      if (!entry.point) continue;
      const p = project(entry.point);
      let best = null;
      for (let i = 1; i < path.length; i++) {
        const hit = nearestOnSegment(p, path[i - 1], path[i]);
        if (!best || hit.distance < best.distance) best = {distance: hit.distance, along: lengths[i - 1] + hit.t * (lengths[i] - lengths[i - 1])};
      }
      if (best.distance <= meters) rows.push({record: entry.record, point: entry.point, distance: best.distance, along: best.along});
    }
    return rows.sort((a, b) => a.along - b.along);
  }

  // ---- NYC GeoSearch (addresses and named lots, five boroughs) ------------

  const geosearchUrl = text => 'https://geosearch.planninglabs.nyc/v2/autocomplete?' + new URLSearchParams({text: normalizeQuery(text)});

  const ACRONYMS = new Set(['CUNY', 'SUNY', 'NYC', 'NYU', 'NYPD', 'FDNY', 'MTA', 'YMCA', 'YWCA', 'YMHA', 'PS', 'IS', 'JHS', 'HS', 'MS', 'LIRR', 'USA']);
  const titleCase = text => text.toLowerCase().replace(/\b([a-z])([a-z]*)/g, (word, first, rest) => ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : first.toUpperCase() + rest)
    .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_, n, s) => n + s.toLowerCase());

  function fromGeosearch(json) {
    const seen = new Set();
    return (json?.features || []).flatMap(feature => {
      const p = feature?.properties || {}, [longitude, latitude] = feature?.geometry?.coordinates || [];
      if (!inArea(latitude, longitude) || !p.name) return [];
      // PAD writes "SOUTH 5 STREET"; restore the ordinal after the house number.
      const title = titleCase(String(p.name)).replace(/(\S\s+)(\d+) (Street|Avenue|Road|Place|Drive|Terrace|Lane|Walk|Court)\b/g, (_, before, n, type) => before + n + suffix(Number(n)) + ' ' + type);
      const key = title + '|' + (p.borough || '');
      if (seen.has(key)) return [];
      seen.add(key);
      return [{id: 'nyc:' + (p.id || p.gid || key), source: 'nyc', kind: /^\d/.test(title) ? 'Address' : 'Landmark', title,
        subtitle: [p.neighbourhood, p.borough].filter(Boolean).join(', '), latitude, longitude, bbl: p.addendum?.pad?.bbl || null}];
    });
  }

  // The nearest addresses around a point, for naming a spot by its cross
  // streets and neighbourhood rather than by "approximate".
  const reverseGeosearchUrl = (latitude, longitude) => 'https://geosearch.planninglabs.nyc/v2/reverse?' + new URLSearchParams({
    'point.lat': latitude.toFixed(6), 'point.lon': longitude.toFixed(6), size: '20'
  });

  const ABBREVIATED = {STREET: 'St', AVENUE: 'Ave', PLACE: 'Pl', BOULEVARD: 'Blvd', ROAD: 'Rd', PARKWAY: 'Pkwy', DRIVE: 'Dr', TERRACE: 'Ter', LANE: 'Ln', COURT: 'Ct', EXPRESSWAY: 'Expy'};
  const streetKey = name => name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let row = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length];
  }
  const streetLabel = name => titleCase(name.trim().replace(/\s+/g, ' '))
    .replace(/(^|\s)(\d+) (Street|Avenue|Road|Place|Drive|Terrace|Lane)\b/g, (_, before, n, type) => before + n + suffix(Number(n)) + ' ' + type)
    .replace(/\b(Street|Avenue|Place|Boulevard|Road|Parkway|Drive|Terrace|Lane|Court|Expressway)$/, type => ABBREVIATED[type.toUpperCase()]);

  // The two nearest distinct streets (PAD spells one street several ways,
  // "MAC DOUGAL" and "MACDOUGAL", "BLEEKER" and "BLEECKER") and the area.
  function describeVicinity(json) {
    const rows = (json?.features || []).map(f => f?.properties || {}).filter(p => typeof p.street === 'string' && p.street.trim())
      .sort((a, b) => (Number(a.distance) || 0) - (Number(b.distance) || 0));
    const clusters = [];
    for (const p of rows) {
      const key = streetKey(p.street);
      let cluster = clusters.find(c => c.key === key || (key.length > 5 && c.key.length > 5 && editDistance(c.key, key) <= 2));
      if (!cluster) clusters.push(cluster = {key, spellings: new Map()});
      cluster.spellings.set(p.street, (cluster.spellings.get(p.street) || 0) + 1);
    }
    const streets = clusters.slice(0, 2).map(c => streetLabel([...c.spellings].sort((a, b) => b[1] - a[1] || a[0].split(' ').length - b[0].split(' ').length)[0][0]));
    const first = rows[0] || {};
    const area = [...new Set([first.neighbourhood, first.borough].filter(Boolean))].join(', ');
    const near = streets.join(' & ');
    if (!near && !area) return null;
    return {streets, near, area, borough: first.borough || null, label: [near, area].filter(Boolean).join(' · ')};
  }

  // ---- Nominatim (streets, buildings, places across Greater NYC in NYS) ---

  // `dedupe: false` keeps every segment of a street, which intersections
  // need; `bounds` ([[s, w], [n, e]]) narrows the search inside the area.
  function nominatimUrl(query, {limit = 8, dedupe = true, bounds = null} = {}) {
    const [[south, west], [north, east]] = bounds || [[AREA.south, AREA.west], [AREA.north, AREA.east]];
    return 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q: normalizeQuery(query), format: 'jsonv2', addressdetails: '1', limit: String(limit), countrycodes: 'us',
      viewbox: [Math.max(west, AREA.west), Math.min(north, AREA.north), Math.min(east, AREA.east), Math.max(south, AREA.south)].join(','), bounded: '1',
      polygon_geojson: '1', polygon_threshold: '0.00002', dedupe: dedupe ? '1' : '0', 'accept-language': 'en'
    });
  }

  // An OpenStreetMap object named by a Nominatim details link, an
  // openstreetmap.org link, "node/2838353308" or "N2838353308".
  function parseOsmReference(text) {
    const input = String(text ?? '').trim(), types = {n: 'N', node: 'N', w: 'W', way: 'W', r: 'R', relation: 'R'};
    let type, id;
    if (/^https?:\/\//i.test(input)) {
      let url;
      try { url = new URL(input); } catch { return null; }
      const host = url.hostname.replace(/^www\./, '');
      if (host === 'nominatim.openstreetmap.org') [type, id] = [url.searchParams.get('osmtype'), url.searchParams.get('osmid')];
      else if (host === 'openstreetmap.org' || host === 'osm.org') [, type, id] = url.pathname.match(/^\/(node|way|relation)\/(\d+)/) || [];
      else return null;
    } else {
      // Bare letters need the id attached so "N 40 45" stays a coordinate.
      const match = input.match(/^(?:(node|way|relation)\s*[/:#]?\s*|([nwr]))(\d+)$/i) || [];
      [type, id] = [match[1] || match[2], match[3]];
    }
    type = types[String(type || '').toLowerCase()];
    return type && /^\d{1,12}$/.test(id || '') ? {type, id: Number(id)} : null;
  }

  const lookupUrl = ref => 'https://nominatim.openstreetmap.org/lookup?' + new URLSearchParams({
    osm_ids: ref.type + ref.id, format: 'jsonv2', addressdetails: '1', polygon_geojson: '1', polygon_threshold: '0.00002', 'accept-language': 'en'
  });

  // The address or named place at a point, for a pin dropped on the map.
  const reverseUrl = (latitude, longitude) => 'https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({
    lat: latitude.toFixed(6), lon: longitude.toFixed(6), format: 'jsonv2', addressdetails: '1', zoom: '18', 'accept-language': 'en'
  });

  const osmLinks = (type, id) => {
    const letter = {node: 'N', way: 'W', relation: 'R'}[type] || type;
    return {details: `https://nominatim.openstreetmap.org/ui/details.html?osmtype=${letter}&osmid=${id}`,
      osm: `https://www.openstreetmap.org/${{N: 'node', W: 'way', R: 'relation'}[letter]}/${id}`};
  };

  function nominatimKind(row) {
    const a = row.address || {};
    if (row.category === 'highway') return 'Street';
    if (row.category === 'railway' || row.category === 'public_transport') return 'Transit';
    if (row.category === 'building' || row.addresstype === 'building') return 'Building';
    if (a.house_number && (row.category === 'place' || row.type === 'house')) return 'Address';
    if (['place', 'boundary'].includes(row.category)) return 'Area';
    return 'Landmark';
  }

  function fromNominatim(rows) {
    const kept = [];
    return (Array.isArray(rows) ? rows : []).flatMap(row => {
      const a = row.address || {}, latitude = Number(row.lat), longitude = Number(row.lon);
      if (a['ISO3166-2-lvl4'] !== 'US-NY' || !inArea(latitude, longitude)) return [];
      const street = [a.house_number, a.road].filter(Boolean).join(' ');
      const title = row.name || street || String(row.display_name || '').split(',')[0];
      const city = a.city === 'City of New York' || a.city === 'New York' ? null : a.city || a.town || a.village || a.hamlet;
      const subtitle = [...new Set([row.name && street, a.neighbourhood || a.quarter, a.suburb || a.city_district, city, city ? a.county : null].filter(Boolean))]
        .filter(part => part !== title).join(', ');
      const [south, north, west, east] = (row.boundingbox || []).map(Number);
      const geometry = ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(row.geojson?.type) ? row.geojson : null;
      // One station is a station, a platform and a stop; keep the first.
      const kind = nominatimKind(row);
      if (kind !== 'Street' && kept.some(k => k.title === title && distanceMeters([k.latitude, k.longitude], [latitude, longitude]) < 80)) return [];
      kept.push({title, latitude, longitude});
      return [{id: `osm:${row.osm_type}:${row.osm_id}`, source: 'osm', kind, title, subtitle, latitude, longitude,
        links: row.osm_type && row.osm_id ? osmLinks(row.osm_type, row.osm_id) : null,
        bounds: [south, west, north, east].every(Number.isFinite) ? [[south, west], [north, east]] : null, geometry, importance: Number(row.importance) || 0}];
    });
  }

  function segmentGap(p1, p2, q1, q2) {
    const rx = p2[0] - p1[0], ry = p2[1] - p1[1], sx = q2[0] - q1[0], sy = q2[1] - q1[1];
    const denom = rx * sy - ry * sx;
    if (denom) {
      const t = ((q1[0] - p1[0]) * sy - (q1[1] - p1[1]) * sx) / denom, u = ((q1[0] - p1[0]) * ry - (q1[1] - p1[1]) * rx) / denom;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return {distance: 0, point: [p1[0] + t * rx, p1[1] + t * ry]};
    }
    return [[p1, q1, q2], [p2, q1, q2], [q1, p1, p2], [q2, p1, p2]].map(([p, a, b]) => {
      const hit = nearestOnSegment(p, a, b);
      return {distance: hit.distance, point: [(p[0] + hit.point[0]) / 2, (p[1] + hit.point[1]) / 2]};
    }).reduce((x, y) => y.distance < x.distance ? y : x);
  }

  // Nominatim has no intersections. Given the street geometries for both
  // names, find where they meet (within `tolerance` metres).
  function intersectLines(first, second, {tolerance = 35} = {}) {
    const lines = geometries => geometries.flatMap(g => g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [])
      .map(line => line.map(([lon, lat]) => project([lat, lon])));
    const a = lines(first), b = lines(second);
    let best = null;
    // Simplified geometry can drop the shared node, so test real crossings
    // as well as near misses between segment ends.
    for (const lineA of a) for (let i = 1; i < lineA.length; i++) for (const lineB of b) for (let j = 1; j < lineB.length; j++) {
      const hit = segmentGap(lineA[i - 1], lineA[i], lineB[j - 1], lineB[j]);
      if (!best || hit.distance < best.distance) best = hit;
    }
    if (!best || best.distance > tolerance) return null;
    return {latitude: best.point[1] / KY, longitude: best.point[0] / KX, gap: best.distance};
  }

  // Padded extents of the places a street name occurs, largest first: the
  // segments of "W 4th St" in the Village and in Coney Island are separate
  // clusters. Segments within `gap` degrees join (0.01 is about 1 km); each
  // extent is padded by `pad` (0.003 is about 330 m).
  function streetClusters(rows, {gap = 0.01, pad = 0.003, limit = 3} = {}) {
    const clusters = [];
    for (const box of rows.map(row => row.bounds).filter(Boolean)) {
      const [[s, w], [n, e]] = box;
      const near = clusters.filter(c => s - gap <= c[1][0] && n + gap >= c[0][0] && w - gap <= c[1][1] && e + gap >= c[0][1]);
      const merged = near.reduce((acc, c) => { c.count && (acc.count += c.count); return [[Math.min(acc[0][0], c[0][0]), Math.min(acc[0][1], c[0][1])], [Math.max(acc[1][0], c[1][0]), Math.max(acc[1][1], c[1][1])]]; },
        Object.assign([[s, w], [n, e]], {count: 1}));
      merged.count = 1 + near.reduce((sum, c) => sum + c.count, 0);
      for (const c of near) clusters.splice(clusters.indexOf(c), 1);
      clusters.push(merged);
    }
    return clusters.sort((a, b) => b.count - a.count).slice(0, limit)
      .map(([[s, w], [n, e]]) => [[s - pad, w - pad], [n + pad, e + pad]]);
  }

  // ---- Routing (FOSSGIS OSRM: foot, bike, car) -----------------------------

  const PROFILES = Object.freeze({foot: 'walk', bike: 'bike', car: 'drive'});

  function routeUrl(profile, from, to) {
    if (!PROFILES[profile]) throw new Error('Unknown route profile');
    const pair = p => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`;
    return `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${pair(from)};${pair(to)}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  }

  function fromRoute(json) {
    const route = json?.code === 'Ok' ? json.routes?.[0] : null;
    const line = route?.geometry?.coordinates;
    if (!route || !Array.isArray(line) || line.length < 2) return null;
    return {distance: route.distance, duration: route.duration, line};
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return '';
    const miles = meters / 1609.344;
    return miles >= 0.1 ? `${miles >= 10 ? Math.round(miles) : miles.toFixed(1)} mi` : `${Math.round(meters * 3.28084 / 10) * 10} ft`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '';
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  root.PlaceSearchModel = Object.freeze({
    AREA, inArea, parseCoordinates, normalizeQuery, splitIntersection, tokenize, nearMiss,
    distanceMeters, attenuation, buildIndex, searchIndex, alongRoute,
    geosearchUrl, fromGeosearch, reverseGeosearchUrl, describeVicinity, nominatimUrl, fromNominatim, parseOsmReference, lookupUrl, reverseUrl, intersectLines, streetClusters,
    PROFILES, routeUrl, fromRoute, formatDistance, formatDuration
  });
})(typeof window !== 'undefined' ? window : globalThis);
