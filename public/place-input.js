'use strict';
(function(root){
  function point(value){
    const input=String(value||'').trim();let pair;
    if(/^https?:\/\//i.test(input)){
      let url;try{url=new URL(input);}catch{return null;}
      if(!['openstreetmap.org','www.openstreetmap.org','osm.org','www.osm.org'].includes(url.hostname)||url.username||url.password)return null;
      const marker=[url.searchParams.get('mlat'),url.searchParams.get('mlon')];
      if(marker.every(value=>value!==null&&value.trim()!==''))pair=marker;
      else pair=url.hash.match(/^#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)(?:&.*)?$/)?.slice(1);
    }else pair=input.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/)?.slice(1);
    if(!pair)return null;const [latitude,longitude]=pair.map(Number);
    return Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180?{latitude,longitude}:null;
  }
  function matches(record,query){const text=String(query||'').trim().toLowerCase();if(!text)return true;const coordinates=point(text);if(coordinates)return Number.isFinite(record.latitude)&&Number.isFinite(record.longitude)&&Math.abs(record.latitude-coordinates.latitude)<=.001&&Math.abs(record.longitude-coordinates.longitude)<=.001;return String(record.title||'').toLowerCase().includes(text);}
  root.PlaceInput=Object.freeze({point,matches});
})(typeof window!=='undefined'?window:globalThis);
