'use strict';
// Shares the server's boroughAt ray-casting semantics, including polygon holes.
// This tests the bundled borough boundary (water areas included), not whether
// a place is accessible, on dry land, historically correct or source-verified.
(function (root) {
  let boundaries = null;
  const boroughNames = ['Manhattan','Brooklyn','Queens','Bronx','Staten Island'];
  const polygonsFor = geometry => geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];

  function ringContains(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function findBorough(lat, lon) {
    // Do not turn blank/null/string input into coordinates. Form callers must
    // validate and explicitly convert their complete coordinate pair first.
    if (!boundaries || typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return boundaries.features.find(feature => polygonsFor(feature.geometry).some(polygon =>
      ringContains([lon, lat], polygon[0]) && !polygon.slice(1).some(ring => ringContains([lon, lat], ring))
    ))?.properties.boroname || null;
  }

  function validBoundaries(data) {
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length !== 5) return false;
    const names = data.features.map(feature => feature?.properties?.boroname);
    if (new Set(names).size !== 5 || !names.every(name => boroughNames.includes(name))) return false;
    return data.features.every(feature => {
      const geometry = feature.geometry;
      if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) return false;
      const polygons = polygonsFor(geometry);
      return polygons.length > 0 && polygons.every(polygon => Array.isArray(polygon) && polygon.length > 0 && polygon.every(ring =>
        Array.isArray(ring) && ring.length >= 4 && ring.every(point => Array.isArray(point) && point.length >= 2 &&
          typeof point[0] === 'number' && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
          typeof point[1] === 'number' && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90)
      ));
    });
  }

  const ready = Promise.resolve().then(() => fetch('data/nyc-borough-boundaries.geojson'))
    .then(response => {
      if (!response.ok) throw new Error('Boundary file unavailable');
      return response.json();
    })
    .then(data => {
      if (!validBoundaries(data)) throw new Error('Invalid boundary file');
      boundaries = data;
      return true;
    })
    .catch(() => false);

  root.NycGeometry = Object.freeze({ready, findBorough, get available() { return boundaries !== null; }});
})(typeof window !== 'undefined' ? window : globalThis);
