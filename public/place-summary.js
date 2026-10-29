'use strict';
(function(root){
  const reasons={
    'second-avenue-deli':'Former deli',
    'demolished-nyc-008':'Altered building',
    'demolished-nyc-009':'Former synagogue',
    'demolished-nyc-010':'Partial demolition',
    'demolished-nyc-049':'Unverified demolition',
    'demolished-nyc-066':'Altered building',
    'demolished-nyc-076':'Unidentified building',
  'demolished-nyc-086':'Destroyed building',
    'demolished-nyc-106':'Former facility',
    'demolished-nyc-111':'Converted terminal',
    'demolished-nyc-167':'Former gardens'
  };
  function reason(record,n){
    if(record.display_reason)return record.display_reason;
    if(reasons[record.id])return reasons[record.id];
    if(['haunting','reported_haunting'].includes(record.category))return 'Ghost story';
    if(record.category==='demolished')return n.placeTypes.includes('Other structures')||n.placeTypes.includes('Forts')?'Demolished structure':'Demolished building';
    return 'Unclassified';
  }
  function location(record){
    // The imported Pelham row contains an image label in its location cell.
    // Hide only this known artifact; preserve the source record and its existing borough.
    const locationText=record.id==='demolished-nyc-106'&&/^\s*Image:\s*Map\s*$/i.test(record.location_text||'')?'':record.location_text;
    const original=String(locationText||record.place_original||record.borough||'Unknown').replace(/\s*·\s*/g,', ');
    const clean=original.replace(/\uFEFF/g,'');
    const match=clean.match(/^\s*\d+(?:\.\d+)?[°º][\s\S]*?\/\s*(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)\s*,\s*(.+)$/u);
    return match&&Number(match[1])===Number(record.latitude)&&Number(match[2])===Number(record.longitude)?match[3].trim():original;
  }
  function view(record){
    const n=root.AtlasModel.normalize(record),point=n.geometry?.coordinates;
    return {title:record.title,description:(record.canonical_reviewed||record.direct_publication)?(record.description||record.claim_text||reason(record,n)):reason(record,n),location:location(record),sourceUrl:record.display_source_url||record.source_url||null,latitude:point?.[1]??null,longitude:point?.[0]??null,approximate:n.geoStatus==='approximate',current:record.id==='featured-csi-wsia',mapUrl:point?`https://www.openstreetmap.org/?mlat=${point[1]}&mlon=${point[0]}#map=18/${point[1]}/${point[0]}`:null};
  }
  root.PlaceSummary=Object.freeze({view});
})(typeof window!=='undefined'?window:globalThis);
