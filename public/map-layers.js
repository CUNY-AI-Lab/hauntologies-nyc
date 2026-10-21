'use strict';
// Public institutional raster services. Metadata checked 2026-10-21.
// Extents describe published bounding rectangles, not guaranteed pixel coverage.
// Imagery dates are independent from the historical periods of atlas records.
(function (root) {
  const NYC = 'https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/';
  const TERMS = 'https://www.nyc.gov/home/terms-of-use.page';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows = [
    {
      id:'1924', service:'Ortho_1924_Mosaic', credit:'NYC OTI',
      extent:[-74.259724,40.492973,-73.688561,40.917707],
      notes:'Citywide 1924 imagery, acquired from the Department of City Planning. Manually georeferenced against visible locations in 1951 and modern imagery; alignment is approximate.'
    },
    {
      id:'1951', service:'NYC_Orthos_1951', credit:'NYS DOS',
      extent:[-74.511366,40.300347,-73.347914,41.075911],
      notes:'Citywide 1951 imagery, acquired from the Department of Records Municipal Archives. Manually georeferenced against modern imagery; alignment is approximate.'
    },
    {
      id:'1996', service:'Ortho_1996_Mosaic', credit:'NYC',
      extent:[-74.267045,40.495744,-73.699479,40.921474],
      notes:'Published resolution: one foot. April imagery covers the city; Manhattan also has June capture. Collection dates can vary within this mosaic.'
    },
    {
      id:'2001-2', service:'NYC_Orthos_2001_2', credit:'NYP DOS',
      extent:[-74.330769,40.474400,-73.626757,40.942676],
      notes:'Combined 2001–2002 mosaic, published at six-inch resolution. Metadata distinguishes 2001 Manhattan/Staten Island work from 2002 Bronx/Brooklyn/Queens work. Attribution reproduces the publisher’s “NYP DOS” spelling.'
    },
    {
      id:'2004', service:'NYC_Ortho_2004', credit:'NYC OTI (DoITT)',
      extent:[-74.267237,40.488883,-73.699385,40.921479],
      notes:'Six-inch imagery captured in April–May. Full true orthoimagery in Manhattan; elsewhere, true orthos for buildings above six stories. This item supplies no separate license statement; consult its metadata and NYC.gov terms.'
    },
    {
      id:'2006', service:'NYC_Orthos_2006', credit:'SOURCE: New York State Orthoimagery Program - 2006',
      extent:[-74.276150,40.488903,-73.690485,40.928344],
      notes:'Six-inch imagery: April in Bronx, Brooklyn, Queens and Staten Island; June in Manhattan. Selective true orthoimagery outside Manhattan. Bounds use the service extent, which differs from its item extent.'
    },
    {
      id:'2008', service:'NYC_Orthos_2008', credit:'SOURCE: New York State Orthoimagery Program - 2008',
      extent:[-74.276150,40.488903,-73.690485,40.928344],
      notes:'Six-inch imagery: March 10–May 14 outside Manhattan and June in Manhattan. Full true orthoimagery in Manhattan; selective true orthos elsewhere.'
    },
    {
      id:'2010', service:'NYC_Orthos_2010', credit:'SOURCE: New York State Orthoimagery Program - 2010',
      extent:[-74.566142,40.318096,-73.400493,41.097595],
      notes:'Six-inch imagery: April 1–10 outside Manhattan and June 15 in Manhattan. Full true orthoimagery in Manhattan; selective true orthos elsewhere.'
    },
    {
      id:'2012', service:'NYC_Orthos_2012', credit:'SOURCE: New York State Orthoimagery Program - 2012',
      extent:[-75.269816,40.066329,-72.696818,41.345501],
      notes:'Six-inch imagery: March 30–April 6 outside Manhattan; June 15–16 and 20 in Manhattan. Full true orthoimagery in Manhattan; selective true orthos elsewhere.'
    },
    {
      id:'2014', service:'NYC_Orthos_2014', credit:'SOURCE: New York State Orthoimagery Program - 2014',
      extent:[-74.700546,40.310593,-72.978439,41.173134],
      notes:'Full true orthoimagery at six-inch resolution. April 1–3 outside Manhattan, April 25 over water, and June 1 in Manhattan.'
    },
    {
      id:'2016', service:'NYC_Orthos_2016', credit:'SOURCE: New York State Orthoimagery Program - 2016',
      extent:[-74.276150,40.488903,-73.690485,40.928344],
      notes:'Full true orthoimagery at six-inch resolution, captured March 26–April 5.'
    },
    {
      id:'2018', service:'NYC_Orthos_2018', credit:'SOURCE: New York State Orthoimagery Program - 2018',
      extent:[-75.269267,40.066329,-72.697368,41.345501],
      notes:'Full true orthoimagery at six-inch resolution, captured April 14–May 2.'
    },
    {
      id:'2020', service:'NYC_Orthos_-_2020', credit:'NY State Orthoimagery Program - 2020',
      extent:[-74.665232,40.320818,-73.293315,41.183227],
      notes:'Published as citywide 2020 orthoimagery. The service description identifies the NY State Orthoimagery Program; its copyright field is blank. Bounds use the service extent, which differs from its item extent.'
    },
    {
      id:'2022', service:'NYC_Orthos_2022', credit:'NYC OTI',
      extent:[-74.276150,40.488903,-73.690485,40.928344],
      notes:'Published as the final 2022 orthoimagery for all of NYC. Web Mercator service.'
    },
    {
      id:'2024', service:'NYC_Orthos_2024', credit:'NYC OTI',
      extent:[-74.276150,40.488903,-73.690485,40.928344],
      notes:'Published as the final 2024 orthoimagery for all of NYC. Web Mercator service.'
    }
  ];
  const aerial = rows.map(row => {
    const sourceUrl = NYC + row.service + '/MapServer';
    const yearLabel = row.id === '2001-2' ? '2001–02' : row.id;
    const [west,south,east,north] = row.extent;
    return {
      id:row.id, label:yearLabel + (Number(row.id) < 1960 ? ' · aerial photograph' : ' · orthoimagery'),
      yearLabel, kind:'aerial', url:sourceUrl + '/tile/{z}/{y}/{x}', sourceUrl,
      attributionHtml:'<a href="' + escape(sourceUrl) + '" target="_blank" rel="noopener">' + escape(row.credit) + '</a> · <a href="' + TERMS + '" target="_blank" rel="noopener">NYC.gov terms</a>',
      bounds:[[south,west],[north,east]], maxNativeZoom:19, // Conservative display cap; NYC metadata advertises higher LODs, not assured image detail.
      coverage:'Published extent ' + south + '–' + north + '° N, ' + west + '–' + east + '° longitude. Citywide collection; gaps and georeferencing differences may remain within these bounds.',
      notes:row.notes
    };
  });
  const colton = {
    id:'1836-colton', label:'1836 · Colton map', yearLabel:'1836', kind:'cartographic',
    url:'https://tiles.arcgis.com/tiles/IEuSomXfi6iB7a25/arcgis/rest/services/New_York_City_1836/MapServer/tile/{z}/{y}/{x}',
    sourceUrl:'https://www.arcgis.com/home/item.html?id=0fcf0bd879b84a01bd596aee72111e49',
    attributionHtml:'David Rumsey Map Collection · David Rumsey Map Center · Stanford University Libraries · <a href="https://www.davidrumsey.com/about/copyright-and-permissions" target="_blank" rel="noopener">Permissions</a>',
    bounds:[[40.647075868891,-74.0999198174628],[40.904202868891,-73.8109108174628]],
    maxNativeZoom:19, // Published native maximum.
    coverage:'Manhattan and surroundings; not citywide. The published map has limited coverage and may have gaps within its rectangular extent.',
    notes:'A georeferenced 1836 Colton map. Historical cartography and modern coordinates may not align exactly; labels and depicted geography reflect the source map.'
  };
  root.HAUNT_LAYERS = Object.freeze([colton,...aerial].map(layer => Object.freeze(layer)));
})(typeof window !== 'undefined' ? window : globalThis);
