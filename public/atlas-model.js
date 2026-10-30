'use strict';
// Presentation-only adapter. Original records, source wording, citations and dates
// are never rewritten. The source-list type lookup is copied by stable ID from
// public/data/source-inventory.json (2026-10-07 inventory).
(function (root) {
  const SOURCE_PLACE_TYPES = {
  "Banks, financial buildings": [
    "demolished-nyc-001",
    "demolished-nyc-002",
    "demolished-nyc-004",
    "demolished-nyc-005",
    "demolished-nyc-006",
    "demolished-nyc-007",
    "demolished-nyc-008",
    "demolished-nyc-053"
  ],
  "Synagogues": [
    "demolished-nyc-009",
    "demolished-nyc-010",
    "demolished-nyc-011",
    "demolished-nyc-012",
    "demolished-nyc-013"
  ],
  "Forts": [
    "demolished-nyc-014",
    "demolished-nyc-015"
  ],
  "Hospitals": [
    "demolished-nyc-016",
    "demolished-nyc-017",
    "demolished-nyc-018",
    "demolished-nyc-019",
    "demolished-nyc-020",
    "demolished-nyc-021",
    "demolished-nyc-022"
  ],
  "Industrial buildings": [
    "demolished-nyc-023"
  ],
  "Mansions": [
    "demolished-nyc-024",
    "demolished-nyc-025",
    "demolished-nyc-026",
    "demolished-nyc-027",
    "demolished-nyc-028",
    "demolished-nyc-029",
    "demolished-nyc-030",
    "demolished-nyc-031",
    "demolished-nyc-032",
    "demolished-nyc-033",
    "demolished-nyc-034",
    "demolished-nyc-035",
    "demolished-nyc-036",
    "demolished-nyc-037",
    "demolished-nyc-038",
    "demolished-nyc-039",
    "demolished-nyc-040",
    "demolished-nyc-041",
    "demolished-nyc-042",
    "demolished-nyc-043",
    "demolished-nyc-044",
    "demolished-nyc-045",
    "demolished-nyc-046",
    "demolished-nyc-047",
    "demolished-nyc-048",
    "demolished-nyc-049",
    "demolished-nyc-050"
  ],
  "Museums, exhibition space, libraries": [
    "demolished-nyc-051",
    "demolished-nyc-052",
    "demolished-nyc-053",
    "demolished-nyc-054"
  ],
  "Office buildings, tenement houses, skyscrapers": [
    "demolished-nyc-055",
    "demolished-nyc-056",
    "demolished-nyc-057",
    "demolished-nyc-058",
    "demolished-nyc-059",
    "demolished-nyc-060",
    "demolished-nyc-061",
    "demolished-nyc-062",
    "demolished-nyc-063",
    "demolished-nyc-064",
    "demolished-nyc-065",
    "demolished-nyc-066",
    "demolished-nyc-067",
    "demolished-nyc-068",
    "demolished-nyc-069",
    "demolished-nyc-070",
    "demolished-nyc-071",
    "demolished-nyc-072",
    "demolished-nyc-073",
    "demolished-nyc-074",
    "demolished-nyc-075",
    "demolished-nyc-076",
    "demolished-nyc-077",
    "demolished-nyc-078",
    "demolished-nyc-079",
    "demolished-nyc-080",
    "demolished-nyc-081",
    "demolished-nyc-082",
    "demolished-nyc-083",
    "demolished-nyc-084",
    "demolished-nyc-085",
    "demolished-nyc-086",
    "demolished-nyc-087",
    "demolished-nyc-088",
    "demolished-nyc-089",
    "demolished-nyc-090",
    "demolished-nyc-091",
    "demolished-nyc-092",
    "demolished-nyc-093",
    "demolished-nyc-094",
    "demolished-nyc-095",
    "demolished-nyc-096"
  ],
  "Operas": [
    "demolished-nyc-097",
    "demolished-nyc-098",
    "demolished-nyc-099",
    "demolished-nyc-100",
    "demolished-nyc-101"
  ],
  "Theatres": [
    "demolished-nyc-099",
    "demolished-nyc-127",
    "demolished-nyc-128",
    "demolished-nyc-129",
    "demolished-nyc-130",
    "demolished-nyc-131",
    "demolished-nyc-132",
    "demolished-nyc-133",
    "demolished-nyc-134",
    "demolished-nyc-135",
    "demolished-nyc-136",
    "demolished-nyc-137",
    "demolished-nyc-138",
    "demolished-nyc-139",
    "demolished-nyc-140",
    "demolished-nyc-141",
    "demolished-nyc-142",
    "demolished-nyc-143",
    "demolished-nyc-144",
    "demolished-nyc-145",
    "demolished-nyc-146",
    "demolished-nyc-147",
    "demolished-nyc-148",
    "demolished-nyc-149",
    "demolished-nyc-150",
    "demolished-nyc-152",
    "demolished-nyc-153",
    "demolished-nyc-154",
    "demolished-nyc-155",
    "demolished-nyc-156",
    "demolished-nyc-157",
    "demolished-nyc-158",
    "demolished-nyc-159",
    "demolished-nyc-160",
    "demolished-nyc-161",
    "demolished-nyc-162",
    "demolished-nyc-163",
    "demolished-nyc-164",
    "demolished-nyc-165",
    "demolished-nyc-166",
    "demolished-nyc-167",
    "demolished-nyc-168",
    "demolished-nyc-169",
    "demolished-nyc-170",
    "demolished-nyc-171",
    "demolished-nyc-172",
    "demolished-nyc-173",
    "demolished-nyc-174",
    "demolished-nyc-175",
    "demolished-nyc-176",
    "demolished-nyc-177",
    "demolished-nyc-178",
    "demolished-nyc-179"
  ],
  "Prisons": [
    "demolished-nyc-102",
    "demolished-nyc-103",
    "demolished-nyc-104",
    "demolished-nyc-105"
  ],
  "Railway stations": [
    "demolished-nyc-106",
    "demolished-nyc-107",
    "demolished-nyc-108",
    "demolished-nyc-109",
    "demolished-nyc-110",
    "demolished-nyc-111",
    "demolished-nyc-112",
    "demolished-nyc-113"
  ],
  "Shopping malls": [
    "demolished-nyc-114",
    "demolished-nyc-115",
    "demolished-nyc-116",
    "demolished-nyc-117"
  ],
  "Stadiums, sport buildings": [
    "demolished-nyc-118",
    "demolished-nyc-119",
    "demolished-nyc-120",
    "demolished-nyc-121",
    "demolished-nyc-122",
    "demolished-nyc-123",
    "demolished-nyc-124",
    "demolished-nyc-125",
    "demolished-nyc-126"
  ],
  "Villages": [
    "demolished-nyc-180",
    "demolished-nyc-181"
  ],
  "Other buildings": [
    "demolished-nyc-182",
    "demolished-nyc-183",
    "demolished-nyc-184",
    "demolished-nyc-185",
    "demolished-nyc-186",
    "demolished-nyc-187",
    "demolished-nyc-188",
    "demolished-nyc-189"
  ],
  "Other structures": [
    "demolished-nyc-190",
    "demolished-nyc-191",
    "demolished-nyc-192",
    "demolished-nyc-193",
    "demolished-nyc-194"
  ]
};
  const typesById = new Map();
  for (const [type, ids] of Object.entries(SOURCE_PLACE_TYPES)) {
    for (const id of ids) typesById.set(id, [...(typesById.get(id) || []), type]);
  }

  const CATEGORY_LABELS = Object.freeze({
    reported_haunting: 'Reported haunting', vanished_place: 'Vanished place / recorded change',
    archival_gap: 'Archival gap', unknown: 'Claim category unknown'
  });
  function categoryFor(value) {
    const label = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').normalize('NFC') : '';
    if (!label) return {value:'unknown',label:CATEGORY_LABELS.unknown};
    const key = label.toLocaleLowerCase('en-US').replace(/[ _-]+/g, ' ');
    const aliases = {haunting:'reported_haunting','ghost story':'reported_haunting','reported haunting':'reported_haunting',demolished:'vanished_place',pilot:'vanished_place','vanished place':'vanished_place','archival gap':'archival_gap',unknown:'unknown'};
    const canonical = Object.hasOwn(aliases,key) ? aliases[key] : null;
    return canonical ? {value:canonical,label:CATEGORY_LABELS[canonical]} : {value:'custom:'+key,label};
  }
  const EVIDENCE_LABELS = Object.freeze({
    reported_story: 'Attributed story · not supernatural proof',
    source_list: 'Source-list entry · conflicts may remain',
    source_grounded: 'Cited historical case',
    archival_gap: 'Bounded archival question',
    participant: 'Participant submission', unknown: 'Evidence not classified'
  });
  const REVIEW_LABELS = Object.freeze({
    legacy: 'Legacy inventory · framework review not recorded',
    owner_approved: 'Owner approved · framework review not recorded',
    pending: 'Pending review', draft: 'Draft', submitted: 'Submitted',
    changes_requested: 'Changes requested', approved: 'Approved', merged: 'Merged',
    withheld: 'Withheld', superseded: 'Superseded', unknown: 'Review state unknown'
  });
  const GEO_LABELS = Object.freeze({
    located: 'Located', approximate: 'Approximate site / area anchor', unresolved: 'Unlocated'
  });
  const BOROUGHS = ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island'];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const text = value => typeof value === 'string' ? value.trim() : '';
  const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) ? Number(value) : null;
  const year = value => {
    const s = String(value ?? '').trim();
    // No extraction from prose: "before", "circa", decades, and absent bounds
    // require an editor's interpretation before they can become filter years.
    if (!/^\d{1,4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(s)) return null;
    const n = Number(s.split('-')[0]);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const arrayOfText = value => [...new Set((Array.isArray(value) ? value : [value]).map(text).filter(Boolean))];
  const coordinates = (record, original) => {
    if (record.geo_status === 'unresolved') return null;
    let lat, lon;
    const hasGeometry = own(original, 'geometry') || own(record, 'geometry');
    if (hasGeometry) {
      const geometry = own(original, 'geometry') ? original.geometry : record.geometry;
      if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) return null;
      [lon, lat] = geometry.coordinates.map(numeric);
    } else {
      lat = numeric(record.latitude); lon = numeric(record.longitude);
    }
    // This atlas is NYC-only. Blank/null values, 0,0, swapped axes, partial
    // pairs and outside-city anchors stay unplotted rather than being repaired.
    if (lat === null || lon === null || lat < 40.45 || lat > 40.98 || lon < -74.30 || lon > -73.65) return null;
    return { type: 'Point', coordinates: [lon, lat] };
  };

  function periodFor(record, category) {
    const canonical = own(record, 'time_start_year') || own(record, 'time_end_year') || own(record, 'time_precision');
    const rawStart = canonical ? record.time_start_year : record.event_date_start;
    const rawEnd = canonical ? record.time_end_year : record.event_date_end;
    let start = year(rawStart), end = year(rawEnd);
    const precision = text(record.time_precision || record.event_date_precision);
    const original = text(record.time_original) || [rawStart, rawEnd].filter(v => v !== null && v !== undefined && v !== '').join(' – ');
    const unknown = precision.toLowerCase() === 'unknown' || start === null || end === null || start > end;
    if (unknown) { start = null; end = null; }
    const basis = text(record.time_basis) || (category === 'vanished_place'
      ? 'Source-listed historical span; source wording and disputed changes remain in the record.'
      : category === 'reported_haunting'
        ? 'Historical report/event dates only; building and publication dates do not date a haunting.'
        : 'Historical claim dates only; source publication dates remain separate.');
    return {
      start, end, unknown, original, precision: precision || 'unknown', basis,
      label: unknown ? (original ? 'Unknown or unresolved period · ' + original : 'Unknown period')
        : (start === end ? String(start) : start + '–' + end) + (/circa/i.test(precision) ? ' · approximate bounds' : '')
    };
  }

  function normalize(original) {
    if (!original || typeof original !== 'object') throw new TypeError('Atlas record must be an object');
    const record = original.type === 'Feature' && original.properties ? original.properties : original;
    const id = String(original.id ?? record.id ?? record.entry_id ?? '');
    const categoryInfo = categoryFor(record.category), category = categoryInfo.value;
    const evidence = record.category === 'demolished' ? 'source_list'
      : record.category === 'pilot' || id === 'second-avenue-deli' ? 'source_grounded'
      : category === 'reported_haunting' ? 'reported_story'
      : category === 'archival_gap' ? 'archival_gap'
      : record.original_submission || record.source_type === 'hosted-submission' ? 'participant' : 'unknown';
    const explicitReview = text(record.review_state);
    const review = own(REVIEW_LABELS, explicitReview) ? explicitReview
      : record.hosted_pending || record.status === 'pending' ? 'pending'
      : record.source_type === 'hosted-submission' && record.status === 'approved' ? 'owner_approved'
      : record.status === 'draft' ? 'draft'
      : record.status === 'sourced' ? 'legacy' : 'unknown';
    const boroughs = [...new Set(String(record.borough || '').split(/\s*\/\s*/).map(b => BOROUGHS.find(x => x.toLowerCase() === b.trim().toLowerCase()) || 'unknown'))];
    const explicitTypes = arrayOfText(record.place_types || record.place_type);
    const placeTypes = explicitTypes.length ? explicitTypes : [...(typesById.get(id) || ['Unknown'])];
    const geometry = coordinates(record, original);
    const geoStatus = !geometry ? 'unresolved' : record.geo_status === 'located' && !record.proxy ? 'located' : 'approximate';
    const radius = numeric(record.uncertainty_m);
    // Never turn a prose "75 m" or a guessed radius into a circle. A positive
    // explicit radius also needs a documented basis, and unlocated means none.
    const uncertaintyM = geometry && radius > 0 && text(record.uncertainty_basis || record.geo_basis) ? radius : null;
    const period = periodFor(record, category);
    const title = text(record.title) || 'Untitled record';
    const searchText = [title, record.location_text, record.place_original, record.place_normalized,
      record.claim_text, record.evidence_summary, record.description, record.uncertainty_note,
      record.gap_question, record.gap_scope, record.gap_limitations, record.source_title,
      ...(record.aliases || []), ...boroughs, ...placeTypes,
      ...(Array.isArray(record.sources) ? record.sources.filter(s => s && typeof s === 'object' && !Array.isArray(s)).flatMap(s => [s.title, s.citation, s.note, s.evidence_note]) : [])
    ].filter(v => v !== undefined && v !== null).join(' ').toLocaleLowerCase();
    return { original, id, title, boroughs, placeTypes, category, categoryLabel: categoryInfo.label,
      evidence, evidenceLabel: EVIDENCE_LABELS[evidence], review, reviewLabel: REVIEW_LABELS[review],
      geoStatus, geoLabel: GEO_LABELS[geoStatus], geometry, uncertaintyM, period, searchText };
  }

  const selectedValues = value => (Array.isArray(value) ? value : [value]).filter(v => v !== undefined && v !== null && v !== '' && v !== 'all');
  const matches = (values, choice) => {
    const wanted = selectedValues(choice);
    return !wanted.length || wanted.some(v => values.includes(v));
  };
  function periodMatches(period, filters) {
    const mode = filters.period || 'all';
    if (mode === 'unknown') return period.unknown;
    if (mode === 'known' && period.unknown) return false;
    const range = typeof mode === 'object' ? mode : {};
    const rawStart = range.start ?? filters.fromYear;
    const rawEnd = range.end ?? filters.toYear;
    const hasStart = rawStart !== undefined && rawStart !== null && rawStart !== '';
    const hasEnd = rawEnd !== undefined && rawEnd !== null && rawEnd !== '';
    if (!hasStart && !hasEnd) return true;
    const start = hasStart ? numeric(rawStart) : -Infinity;
    const end = hasEnd ? numeric(rawEnd) : Infinity;
    if (start === null || end === null || (hasStart && !Number.isInteger(start)) || (hasEnd && !Number.isInteger(end)) || start > end || period.unknown) return false;
    return period.start <= end && period.end >= start;
  }
  function filter(records, filters = {}) {
    const query = text(filters.query).toLocaleLowerCase();
    return records.filter(record => {
      const r = normalize(record);
      return (!query || r.searchText.includes(query))
        && matches(r.boroughs, filters.borough) && matches(r.placeTypes, filters.placeType)
        && matches([r.category], filters.category) && matches([r.evidence], filters.evidence)
        && matches([r.review], filters.review) && matches([r.geoStatus], filters.geoStatus)
        && periodMatches(r.period, filters);
    });
  }
  function facets(records) {
    const rows = records.map(normalize);
    const count = (values, label = value => value) => {
      const counts = new Map();
      rows.forEach(r => [...new Set(values(r))].forEach(value => counts.set(value, (counts.get(value) || 0) + 1)));
      return [...counts].map(([value, n]) => ({value, label: label(value), count: n})).sort((a, b) => a.label.localeCompare(b.label));
    };
    return {
      boroughs: count(r => r.boroughs, value => value === 'unknown' ? 'Unknown borough' : value),
      placeTypes: count(r => r.placeTypes),
      categories: count(r => [r.category], value => rows.find(row=>row.category===value).categoryLabel),
      evidence: count(r => [r.evidence], value => EVIDENCE_LABELS[value]),
      reviews: count(r => [r.review], value => REVIEW_LABELS[value]),
      geoStatuses: count(r => [r.geoStatus], value => GEO_LABELS[value]),
      periods: count(r => [r.period.unknown ? 'unknown' : 'known'], value => value === 'unknown' ? 'Unknown or unresolved period' : 'Known year bounds')
    };
  }
  root.AtlasModel = Object.freeze({ normalize, filter, facets, categoryFor });
})(typeof window !== 'undefined' ? window : globalThis);
