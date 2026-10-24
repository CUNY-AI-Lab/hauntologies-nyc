'use strict';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=window.DraftModel.safeUrl;
const link=(url,label)=>safeUrl(url)?`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${esc(label)}</a>`:esc(label);
const displayLabel=value=>String(value??'').replace(/\s*·\s*/g,', ');
// Where a place is, by its nearest cross streets and neighbourhood (data/place-vicinity.json,
// built by scripts/build-place-vicinity.mjs). A record moved since then falls back to its borough.
let vicinity={};
function vicinityOf(r,n=AtlasModel.normalize(r)){const v=vicinity[r.id],c=n.geometry?.coordinates;return v&&c&&v.at===c[1].toFixed(6)+','+c[0].toFixed(6)?v:null;}
function whereLabel(r,n=AtlasModel.normalize(r)){if(!n.geometry)return 'Unlocated';const v=vicinityOf(r,n);return v?[v.near,v.area].filter(Boolean).join(' · '):String(r.borough||'New York City');}
// Tooltips are for a hovering mouse. On touch a tap would leave one standing behind the popup or card.
const hoverTips=matchMedia('(hover: hover)').matches;
function bindHoverTip(marker,content,options){if(hoverTips)marker.bindTooltip(content,options);marker.on('popupopen',()=>marker.closeTooltip());return marker;}
// The title card floats over the top of the map, so popups pan to open below its current edge.
if(window.L?.Popup){const adjustPan=L.Popup.prototype._adjustPan;L.Popup.prototype._adjustPan=function(...args){const card=document.querySelector('.brand')?.getBoundingClientRect(),mapTop=this._map?.getContainer().getBoundingClientRect().top||0;this._basePad??=L.point(this.options.autoPanPaddingTopLeft||this.options.autoPanPadding);this.options.autoPanPaddingTopLeft=[this._basePad.x,Math.max(this._basePad.y,card?Math.round(card.bottom-mapTop)+8:0)];return adjustPan.apply(this,args)}}
fetch('data/place-vicinity.json',{cache:'force-cache'}).then(r=>r.ok?r.json():{}).then(data=>{vicinity=data&&typeof data==='object'?data:{};if(map)renderRecords();}).catch(()=>{});
const NYC_BOUNDS=[[40.47737324425922,-74.25874745984156],[40.91766180885905,-73.70000906387347]], STORAGE='hauntologies-nyc-drafts-v1';
const LAYERS=window.HAUNT_LAYERS||[], layerById=new Map(LAYERS.map(layer=>[layer.id,layer]));
const layerOpacities=new Map();
const pilot={...window.HAUNT_PILOT};
let drafts=[],selected=pilot.id,picking=false,selectingContributionPlace=false,map,imagery,pointLayer,baseErrors=0,loadToken=0;
try{drafts=JSON.parse(localStorage.getItem(STORAGE)||'[]').filter(r=>(validCoordinates(r.latitude,r.longitude)||((r.latitude===null||r.latitude==='')&&(r.longitude===null||r.longitude==='')))&&(safeUrl(r.source_url)||r.original_submission||r.sources?.length)).slice(0,500)}catch{}
const sourceInventory=window.NYC_INVENTORY||{records:[],audits:[]};
pilot.category='pilot';pilot.borough='Manhattan';
let hostedRecords=[],publishedPlaces=[];
const allRecords=()=>[...new Map([...drafts,pilot,...sourceInventory.records,...publishedPlaces].map(record=>[record.id,record])).values()];
let publishedRequest=0,publishedSignature='';
async function refreshPublishedPlaces(){const request=++publishedRequest;try{const data={records:[]};let cursor='',seen=new Set();do{const response=await fetch('/api/published-records'+(cursor?'?after='+encodeURIComponent(cursor):''),{cache:'no-store'});if(!response.ok)return false;const page=await response.json();if(request!==publishedRequest||!Array.isArray(page.records))return false;data.records.push(...page.records);cursor=page.next_cursor||'';if(cursor&&seen.has(cursor))return false;seen.add(cursor);}while(cursor);const signature=JSON.stringify(data.records);if(signature!==publishedSignature){publishedSignature=signature;publishedPlaces=data.records;const panel=$('casePanel'),scroll=panel.scrollTop;populateFacets();renderRecords();panel.scrollTop=scroll;window.dispatchEvent(new CustomEvent('contributions-records-changed',{detail:{publicRefresh:true}}));}return true;}catch{return false;}}
window.HauntologiesPublic=Object.freeze({refresh:refreshPublishedPlaces});
window.addEventListener('focus',refreshPublishedPlaces);
function setHostedRecords(records){hostedRecords=records;populateFacets();renderRecords()}
const hasPoint=r=>Boolean(AtlasModel.normalize(r).geometry);
const markers=new Map();
let uncertaintyLayer;
let proposedPointMarker=null,proposedPanFrame=0,contributionPicking=false,statusBeforePicking=null;
function clearProposedPoint(){cancelAnimationFrame(proposedPanFrame);if(proposedPointMarker&&map)map.removeLayer(proposedPointMarker);proposedPointMarker=null;}
function stopContributionPicking(){
 contributionPicking=false;document.body.classList.remove('contribution-picking');
 $('chooseContributionPoint')?.setAttribute('aria-pressed','false');
 // A cancelled pick puts back whatever the location line said before, such as an earlier pin.
 const status=$('newLocationStatus');if(status?.dataset.state==='picking'){status.textContent=statusBeforePicking?.text||'';if(statusBeforePicking?.state)status.dataset.state=statusBeforePicking.state;else delete status.dataset.state;}
 statusBeforePicking=null;
 if($('mapStatus').textContent==='Choose a location')updateLayerStatus();
}
function showProposedPoint(point){
 clearProposedPoint();
 if(!map||!point||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||$('researchSidecar').hidden||!$('draftPanel').classList.contains('active'))return;
 proposedPointMarker=L.marker([point.latitude,point.longitude],{interactive:false,keyboard:false,zIndexOffset:800,icon:L.divIcon({className:'proposed-point',html:'<span aria-hidden="true">+</span>',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(map);
 proposedPointMarker.getElement()?.setAttribute('aria-label','Proposed location');
 const marker=proposedPointMarker;
 proposedPanFrame=requestAnimationFrame(()=>{
  if(proposedPointMarker!==marker||$('researchSidecar').hidden)return;
  const size=map.getSize(),panel=$('researchSidecar').getBoundingClientRect(),brand=document.querySelector('.brand').getBoundingClientRect(),tools=document.querySelector('.header-tools').getBoundingClientRect();
  const position=map.latLngToContainerPoint(marker.getLatLng()),narrow=panel.width>size.x*.75;
  const left=24,right=narrow?size.x-24:panel.left-24,top=brand.bottom+24,bottom=narrow?panel.top-24:size.y-90;
  const x=Math.max(left,Math.min(right,position.x)),y=Math.max(Math.min(top,bottom),Math.min(bottom,position.y));
  const targetX=y<tools.bottom+24&&x>tools.left-24?Math.max(left,tools.left-24):x;
  if(Math.abs(position.x-targetX)>1||Math.abs(position.y-y)>1)map.panBy([position.x-targetX,position.y-y],{animate:false});
 });
}
function emptyMapTarget(target){
 return target instanceof Element&&$('map').contains(target)&&!$('map').inert&&!document.querySelector('dialog[open]')&&!target.closest('.leaflet-marker-icon,.leaflet-popup,.leaflet-tooltip,.leaflet-interactive,.leaflet-control,button,a,input,select,textarea,[role="button"]');
}
function requestContributionPoint(latlng,replace=false){
 const accepted=window.ContributionPoint?.request({latitude:latlng.lat,longitude:latlng.lng},{replace});
 if(accepted){stopContributionPicking();toolOpener='map';$('chooseContributionPoint').focus({preventScroll:true});$('newLocationStatus').scrollIntoView({block:'nearest'});}
 else if(window.ContributionPoint)$('mapStatus').textContent='Location unavailable for this contribution';
 return accepted;
}
window.addEventListener('contributions-point-changed',event=>showProposedPoint(event.detail?.point));
// A contributor sees their own unpublished places, marked by status; nobody else does.
let ownPlacesLayer=null,ownPlaces=[];
function renderOwnPlaces(){
 if(!map)return;ownPlacesLayer??=L.layerGroup().addTo(map);ownPlacesLayer.clearLayers();
 for(const place of ownPlaces){
  const label=place.status==='changes_requested'?'Sent back to you':place.status==='approved'?'Approved, not yet on the map':place.status==='draft'?'Draft':'Waiting for review';
  const marker=L.marker([place.latitude,place.longitude],{pane:'researchPoints',zIndexOffset:700,title:place.title+', '+label,icon:L.divIcon({className:'own-place',html:'<span aria-hidden="true"></span>',iconSize:[26,26],iconAnchor:[13,13]})});
  const tip=document.createElement('span');tip.append(document.createTextNode(place.title),document.createElement('br'),document.createTextNode(label));bindHoverTip(marker,tip,{direction:'top',offset:[0,-12]});
  marker.on('add',()=>marker.getElement()?.setAttribute('data-status',place.status));
  marker.on('click',()=>window.dispatchEvent(new CustomEvent('contributions-review-requested',{detail:{submissionId:place.id}})));
  ownPlacesLayer.addLayer(marker);
 }
}
window.addEventListener('contributions-own-places',event=>{ownPlaces=(event.detail?.places||[]).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));renderOwnPlaces();renderPendingPlaces();});
// Everyone sees places sent for review as their own layer, before a reviewer decides.
// A contribution to a mapped place sits as a badge beside that place's marker.
let pendingPlacesLayer=null,pendingPlaces=[],pendingRequest=0;const pendingMarkers=new Map();
const pendingLabel=status=>status==='approved'?'Approved, publishing soon':status==='changes_requested'?'Under review: more information requested':'Under review';
// Where a pending place is: the contributor's own words, the place it adds to, or its cross streets.
function pendingWhere(place,record){
 if(record)return 'Adds to '+(record.title||'a mapped place')+' · '+whereLabel(record);
 return place.location_text||'';
}
function pendingPopup(place,record){
 const root=document.createElement('div');root.className='pending-place-popup';
 const status=document.createElement('p');status.className='pending-place-status';status.textContent=pendingLabel(place.status);
 const title=document.createElement('strong');title.textContent=place.title;root.append(status,title);
 const where=document.createElement('p');where.className='pending-place-where';where.textContent=pendingWhere(place,record);root.append(where);
 if(!record&&!place.location_text&&window.PlaceSearch?.describe)window.PlaceSearch.describe(place.latitude,place.longitude).then(v=>{if(v?.label)where.textContent=v.label;}).catch(()=>{});
 if(place.description){const p=document.createElement('p');p.textContent=place.description;root.append(p);}
 const note=document.createElement('p');note.className='small';note.textContent='Shared by a contributor. Not yet checked by a reviewer.';root.append(note);return root;
}
function pendingPoint(place,records){const record=place.record_id?records.get(place.record_id):null,lat=record?Number(record.latitude):place.latitude,lon=record?Number(record.longitude):place.longitude;return Number.isFinite(lat)&&Number.isFinite(lon)?{record,lat,lon}:null;}
function renderPendingPlaces(){
 if(!map)return;pendingPlacesLayer??=L.layerGroup().addTo(map);pendingPlacesLayer.clearLayers();pendingMarkers.clear();
 const own=new Set(ownPlaces.map(p=>p.id)),records=new Map(allRecords().map(r=>[r.id,r]));
 for(const place of pendingPlaces){
  if(own.has(place.id))continue;
  const at=pendingPoint(place,records);if(!at)continue;const {record,lat,lon}=at;
  const label=pendingLabel(place.status);
  const marker=L.marker([lat,lon],{pane:'researchPoints',zIndexOffset:650,keyboard:true,title:place.title+', '+label,icon:L.divIcon({className:'pending-place'+(record?' attached':''),html:'<span aria-hidden="true">?</span>',iconSize:record?[18,18]:[24,24],iconAnchor:record?[-4,22]:[12,12]})});
  marker.on('add',()=>marker.getElement()?.setAttribute('data-status',place.status));
  // Contributor text is untrusted: Leaflet renders a string tooltip as HTML, so pass a text node.
  const tip=document.createElement('span');tip.textContent=place.title+' · '+label;bindHoverTip(marker,tip,{direction:'top',offset:[0,-10]});
  marker.bindPopup(()=>pendingPopup(place,record),{maxWidth:280});
  pendingPlacesLayer.addLayer(marker);pendingMarkers.set(place.id,marker);
 }
 renderPendingList(records,own);
}
// The title card lists everything under review; choosing one brings it up on the map.
function bringUpPending(place){
 const feed=$('pendingPlacesFeed');window.HauntologiesDisclosure?window.HauntologiesDisclosure.set(feed,false):(feed.open=false);
 const marker=pendingMarkers.get(place.id);
 if(marker){map.setView(marker.getLatLng(),Math.max(map.getZoom(),17));marker.openPopup();return;}
 const at=pendingPoint(place,new Map(allRecords().map(r=>[r.id,r])));if(at)map.setView([at.lat,at.lon],Math.max(map.getZoom(),17));
 // The contributor's own place is drawn by their layer; open it in their contributions.
 if(ownPlaces.some(p=>p.id===place.id))window.dispatchEvent(new CustomEvent('contributions-review-requested',{detail:{submissionId:place.id}}));
}
function renderPendingList(records,own){
 const feed=$('pendingPlacesFeed');if(!feed)return;
 const shown=pendingPlaces.filter(place=>pendingPoint(place,records));
 feed.hidden=!shown.length;$('pendingPlacesCount').textContent=String(shown.length);
 $('pendingPlacesList').replaceChildren(...shown.map(place=>{
  const row=document.createElement('li'),button=document.createElement('button'),record=place.record_id?records.get(place.record_id):null;button.type='button';
  const title=document.createElement('strong');title.textContent=place.title;const meta=document.createElement('span');
  meta.textContent=[own.has(place.id)?'Yours':'',pendingLabel(place.status),pendingWhere(place,record)].filter(Boolean).join(' · ');
  if(!record&&!place.location_text&&window.PlaceSearch?.describe)window.PlaceSearch.describe(place.latitude,place.longitude).then(v=>{if(v?.label)meta.textContent+=' · '+v.label;}).catch(()=>{});
  button.append(title,meta);button.addEventListener('click',()=>bringUpPending(place));row.append(button);return row;
 }));
}
async function refreshPendingPlaces(){
 const request=++pendingRequest;
 try{const response=await fetch('/api/pending-places',{cache:'no-store'});if(!response.ok)return;const data=await response.json();if(request!==pendingRequest||!Array.isArray(data.places))return;
  pendingPlaces=data.places.filter(p=>p&&typeof p.id==='string'&&typeof p.title==='string');renderPendingPlaces();}catch{}
}
window.addEventListener('contributions-records-changed',renderPendingPlaces);
window.addEventListener('contributions-own-places',refreshPendingPlaces);
window.addEventListener('focus',refreshPendingPlaces);
// A fresh pin lands with one pulse; redrawing an existing pin does not repeat it.
window.addEventListener('contributions-point-pinned',()=>{const icon=proposedPointMarker?.getElement();if(!icon)return;icon.classList.remove('just-pinned');void icon.offsetWidth;icon.classList.add('just-pinned');});
window.addEventListener('contributions-point-pick-requested',()=>{
 if(!map)return;
 // Contribute stays on screen while a point is chosen. It stops being modal so the map takes the click;
 // returning to the Contribute tab after a pin or cancel restores modality.
 for(const id of ['toolsMenu','layersPanel','filtersPanel'])$(id).hidden=true;
 for(const id of ['toolsButton','filtersButton','layersButton'])$(id).setAttribute('aria-expanded','false');
 setSidecarModal(false);contributionPicking=true;document.body.classList.add('contribution-picking');
 $('chooseContributionPoint').setAttribute('aria-pressed','true');
 const status=$('newLocationStatus');if(status.dataset.state!=='picking')statusBeforePicking={text:status.textContent,state:status.dataset.state};
 status.textContent='Select a spot on the map. Press Esc to cancel.';status.dataset.state='picking';
 $('mapStatus').textContent='Choose a location';$('map').focus();
});
window.addEventListener('contributions-point-pick-cancelled',()=>{stopContributionPicking();$('draftTab').click();$('chooseContributionPoint').focus();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&contributionPicking){event.preventDefault();stopContributionPicking();$('draftTab').click();$('chooseContributionPoint')?.focus();}});
const layerName=r=>r.status==='draft'?'Local draft':r.category==='demolished'?'Demolition list':['haunting','reported_haunting'].includes(r.category)?'Ghost story':r.category==='archival_gap'?'Archival gap':r.category==='vanished_place'?'Vanished place':r.category==='pending'?'Pending review':r.category==='submitted'?'Submitted record':'Place';
function validCoordinates(lat,lon){return Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&String(lat).trim()!==''&&String(lon).trim()!==''&&Number(lat)>=40.45&&Number(lat)<=40.98&&Number(lon)>=-74.30&&Number(lon)<=-73.65}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(drafts));return true}catch{$('formStatus').textContent='Browser storage is unavailable. Keep this tab open and export your draft now.';$('formStatus').classList.add('error');return false}}
let toolOpener='toolsButton',placeLayout=null;
const toolPanels=['toolsMenu','layersPanel','filtersPanel','researchSidecar'];
let sidecarModalState=null;
function setSidecarModal(active){
 const sidecar=$('researchSidecar');
 if(!active){
  if(!sidecarModalState)return;
  for(const [node,inert] of sidecarModalState.background)node.inert=inert;
  for(const [name,value] of sidecarModalState.attributes)value===null?sidecar.removeAttribute(name):sidecar.setAttribute(name,value);
  sidecarModalState=null;return;
 }
 if(sidecarModalState)return;
 const background=new Map();
 for(let branch=sidecar;branch.parentElement&&branch!==document.body;branch=branch.parentElement){
  for(const sibling of branch.parentElement.children){
   // Native dialogs manage their own modality, including the record editor opened from Review.
   if(sibling===branch||sibling.tagName==='DIALOG')continue;
   background.set(sibling,sibling.inert);sibling.inert=true;
  }
 }
 sidecarModalState={background,attributes:['role','aria-modal'].map(name=>[name,sidecar.getAttribute(name)])};
 sidecar.setAttribute('role','dialog');sidecar.setAttribute('aria-modal','true');
 if(!sidecar.contains(document.activeElement))$('sidecarTitle').focus({preventScroll:true});
}
function closeTools(focus=false){
 clearProposedPoint();stopContributionPicking();
 setSidecarModal(false);
 for(const id of toolPanels)$(id).hidden=true;
 for(const id of ['toolsButton','filtersButton','mapToolsButton','layersButton','openResearch'])$(id).setAttribute('aria-expanded','false');
 document.body.classList.remove('sidecar-open','places-open');if(focus)$(toolOpener).focus({preventScroll:true});
}
function openSidecar(open=true){
 closeTools();toolOpener='toolsButton';$('researchSidecar').hidden=!open;$('openResearch').setAttribute('aria-expanded',String(open));
 document.body.classList.toggle('sidecar-open',open);
}
function switchPanel(id){
 openSidecar();document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===id));
 document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.panel===id));
 $('sidecarTitle').textContent=id==='casePanel'?'Places':id==='sourcesPanel'?'Sources':'Contribute';
 document.body.classList.toggle('places-open',id==='casePanel');
 if(id==='casePanel'){$('publishedEditsFeed').open=false;placeLayout?.layout();}
 if(id==='casePanel'){toolOpener='mapToolsButton';$('mapToolsButton').setAttribute('aria-expanded','true');}
 setSidecarModal(id==='draftPanel');
 if(id==='draftPanel')window.ContributionPoint?.show();
}
$('toolsButton').addEventListener('click',async()=>{if($('toolsButton').disabled)return;$('toolsButton').disabled=true;try{const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});if(response.status===401){try{sessionStorage.setItem('hauntologies-return-edit','true');}catch{}location.assign('/register?return=edit');return;}if(!response.ok){window.dispatchEvent(new CustomEvent('account-open-requested'));return;}const session=await response.json();if(session.password_required){window.dispatchEvent(new CustomEvent('account-open-requested'));return;}}catch{window.dispatchEvent(new CustomEvent('account-open-requested'));return;}finally{$('toolsButton').disabled=false;}const open=$('toolsMenu').hidden;closeTools();toolOpener='toolsButton';$('toolsMenu').hidden=!open;$('toolsButton').setAttribute('aria-expanded',String(open));if(open)$('submitTool').focus()});
$('filtersButton').addEventListener('click',()=>{const open=$('filtersPanel').hidden;closeTools();toolOpener='filtersButton';$('filtersPanel').hidden=!open;$('filtersButton').setAttribute('aria-expanded',String(open));if(open)$('search').focus()});
document.addEventListener('pointerdown',e=>{
 if(document.querySelector('dialog[open]')||e.target.closest('.header-tools'))return;
 const panel=!$('filtersPanel').hidden?$('filtersPanel'):!$('researchSidecar').hidden&&$('casePanel').classList.contains('active')?$('researchSidecar'):null;
 if(panel&&!panel.contains(e.target))closeTools(true);
},{capture:true});
$('mapToolsButton').addEventListener('click',()=>{
 if(!$('researchSidecar').hidden&&$('casePanel').classList.contains('active')){closeTools(true);return;}
 switchPanel('casePanel');revealPlaceCard([...$('casePanel').querySelectorAll('.place-card')].find(card=>card.dataset.placeId===selected));$('sidecarTitle').focus({preventScroll:true});
});
$('layersButton').addEventListener('click',()=>{const open=$('layersPanel').hidden;closeTools();toolOpener='layersButton';$('layersPanel').hidden=!open;$('layersButton').setAttribute('aria-expanded',String(open));if(open)$('layersTitle').focus()});
for(const [button,view,title] of [['submitTool','submissionView','Contribute'],['reviewTool','reviewView','Review']])$(button).addEventListener('click',()=>{switchPanel('draftPanel');document.querySelector(`[data-workflow-view="${view}"]`).click();$('sidecarTitle').textContent=title;$('sidecarTitle').focus()});
$('openResearch').addEventListener('click',()=>switchPanel('casePanel'));
for(const id of ['closeResearch','closeLayers','closeFilters'])$(id).addEventListener('click',()=>closeTools(true));
document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>switchPanel(b.dataset.panel)));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('dialog[open]')&&toolPanels.some(id=>!$(id).hidden)){e.preventDefault();closeTools(true);map?.closePopup()}});
// A tool is a keyboard surface. Keep its controls reachable without tabbing into obscured pins.
document.addEventListener('keydown',e=>{
 if(e.key!=='Tab'||document.querySelector('dialog[open]'))return;
 const panel=toolPanels.map($).find(n=>!n.hidden);if(!panel)return;
 const controls=[...panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]')].filter(n=>n.getClientRects().length);
 if(!controls.length)return;const first=controls[0],last=controls.at(-1);
 if(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){e.preventDefault();last.focus()}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});
document.addEventListener('focusin',e=>{
 const target=e.target;if(!(target instanceof HTMLElement)||!target.matches('input,select,textarea,button,a,summary'))return;
 const scroller=target.closest('.panel,.popout-content');if(!scroller||!scroller.closest('.popout'))return;
 requestAnimationFrame(()=>{
  if(document.activeElement!==target)return;
  const box=target.getBoundingClientRect(),view=scroller.getBoundingClientRect(),credit=map?.attributionControl?.getContainer().getBoundingClientRect();
  const top=Math.max(8,view.top+12),bottom=Math.min(view.bottom-12,(credit?.top??innerHeight)-8);
  if(box.top<top)scroller.scrollTop+=box.top-top;
  else if(box.bottom>bottom)scroller.scrollTop+=box.height>bottom-top?box.top-top:box.bottom-bottom;
 });
});
// Expose the verified catalog through the compact picker.
for(const layer of LAYERS){
 const id=layer.id,label=id==='1836-colton'?'Colton 1836':'Aerial '+layer.yearLabel;
 $('layerSelect').append(new Option(label,layer.id));
 const b=document.createElement('button');b.textContent=layer.yearLabel;b.dataset.year=id;b.title=layer.label;b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>changeYear(id));$('yearStrip').append(b);
}
$('layerSelect').addEventListener('change',e=>changeYear(e.target.value));
$('opacity').addEventListener('input',()=>{const value=Number($('opacity').value);$('opacityValue').value=value+'%';$('opacity').setAttribute('aria-valuetext',value+' percent');if(activeLayer)layerOpacities.set(activeLayer.id,value);if(imagery)imagery.setOpacity(value/100)});
function recenterNYC(){if(map){map.stop();map.fitBounds(NYC_BOUNDS,{paddingTopLeft:[20,20],paddingBottomRight:[20,Math.ceil(map.attributionControl.getContainer().getBoundingClientRect().height)+64],animate:false});}}
$('recenterMap').addEventListener('click',recenterNYC);
$('fitLayer').addEventListener('click',()=>{const layer=layerById.get($('layerSelect').value);if(map&&layer){map.fitBounds(layer.bounds,{padding:[30,30],animate:false});$('map').focus()}});
let activeLayer=null,layerLoaded=0,layerFailed=0,layerLoading=false,layerSlow=false;
const loadedTiles=new Set(),failedTiles=new Set();
function syncTileCounts(){layerLoaded=loadedTiles.size;layerFailed=failedTiles.size}
function updateLayerStatus(){
 let status='';
 if(!activeLayer)status=baseErrors?'Street map unavailable':'';
 else if(!L.latLngBounds(activeLayer.bounds).intersects(map.getBounds()))status='No imagery here';
 else if(layerFailed)status=layerLoaded?'Some tiles unavailable':'Map unavailable';
 else if(layerSlow)status='Map loading slowly';
 else if(layerLoading)status='Loading…';
 $('mapStatus').textContent=status;
}
function changeYear(id){
 const layer=layerById.get(id);if(id!=='none'&&!layer)return;
 const token=++loadToken;
 if(imagery&&map)map.removeLayer(imagery);imagery=null;
 activeLayer=layer||null;loadedTiles.clear();failedTiles.clear();syncTileCounts();layerLoading=false;layerSlow=false;
 $('layerSelect').value=id;$('opacity').disabled=!layer;$('opacityControl').hidden=!layer;$('fitLayer').disabled=!layer;
 const opacity=layer?(layerOpacities.get(id)??100):100;$('opacity').value=String(opacity);$('opacityValue').value=opacity+'%';$('opacity').setAttribute('aria-valuetext',opacity+' percent');
 $('yearBadge').textContent=layer?.yearLabel||'Now';
 document.querySelectorAll('#yearStrip button').forEach(b=>{const active=b.dataset.year===id;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
 $('layerHelp').textContent='';$('selectedLayerInfo').replaceChildren();
 if(!map)return;
 if(!layer){updateLayerStatus();return}
 imagery=L.tileLayer(layer.url,{pane:'history',className:'historical-raster',bounds:layer.bounds,minZoom:9,maxNativeZoom:layer.maxNativeZoom,maxZoom:20,noWrap:true,opacity:Number($('opacity').value)/100,attribution:layer.attributionHtml});
 imagery.on('loading',()=>{if(token!==loadToken)return;layerLoading=true;layerSlow=false;updateLayerStatus();setTimeout(()=>{if(token===loadToken&&layerLoading){layerSlow=true;updateLayerStatus()}},15000)});
 imagery.on('tileload',e=>{if(token!==loadToken||!e.tile.src.startsWith('https:'))return;loadedTiles.add(e.tile);failedTiles.delete(e.tile);syncTileCounts();updateLayerStatus()});
 imagery.on('tileerror',e=>{if(token!==loadToken||!e.tile.src.startsWith('https:'))return;failedTiles.add(e.tile);loadedTiles.delete(e.tile);syncTileCounts();updateLayerStatus()});
 imagery.on('tileunload',e=>{if(token!==loadToken)return;loadedTiles.delete(e.tile);failedTiles.delete(e.tile);syncTileCounts();updateLayerStatus()});
 imagery.on('load',()=>{if(token!==loadToken)return;layerLoading=false;layerSlow=false;updateLayerStatus()});
 imagery.addTo(map);updateLayerStatus();
}
if(window.L){map=L.map('map',{zoomControl:false,minZoom:9,maxZoom:20,maxBounds:[[40.43,-74.33],[40.99,-73.61]],maxBoundsViscosity:.8,doubleClickZoom:true,tapHold:false,scrollWheelZoom:true,wheelDebounceTime:80,wheelPxPerZoomLevel:120,zoomSnap:.25,zoomDelta:1,zoomAnimation:!matchMedia('(prefers-reduced-motion: reduce)').matches}).setView([40.71,-73.98],10);const zoom=L.control.zoom({position:'topright'}).addTo(map);$('zoomTools').append(zoom.getContainer());for(const id of toolPanels){L.DomEvent.disableClickPropagation($(id));L.DomEvent.disableScrollPropagation($(id))}map.createPane('history');map.getPane('history').style.zIndex=250;map.createPane('researchPoints');map.getPane('researchPoints').style.zIndex=450;L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{className:'street-basemap',maxNativeZoom:19,maxZoom:20,noWrap:true,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).on('tileerror',()=>{baseErrors++;$('mapStatus').textContent='Street map unavailable'}).addTo(map);pointLayer=(L.markerClusterGroup?L.markerClusterGroup({animate:false,clusterPane:'researchPoints',maxClusterRadius:44,showCoverageOnHover:false,spiderfyOnMaxZoom:true,iconCreateFunction:cluster=>L.divIcon({html:'<span>'+cluster.getChildCount()+'</span>',className:'research-cluster',iconSize:[44,44]})}):L.layerGroup()).addTo(map);uncertaintyLayer=L.layerGroup().addTo(map);map.on('click',e=>{if(!picking)return;const f=$('contributionForm');f.elements.latitude.value=e.latlng.lat.toFixed(6);f.elements.longitude.value=e.latlng.lng.toFixed(6);picking=false;document.body.classList.remove('picking');$('pickPoint').textContent='Choose on map';$('formStatus').textContent='Point selected';switchPanel('draftPanel')});map.on('moveend',updateLayerStatus);changeYear('none');fetch('data/nyc-borough-boundaries.geojson').then(r=>r.json()).then(data=>L.geoJSON(data,{style:{color:'#7c817a',weight:1,fillColor:'#202721',fillOpacity:.13},interactive:false}).addTo(map)).catch(()=>{})}else{$('mapStatus').textContent='Map unavailable'}
if(map){
 let lastInteractivePress=null;
 $('map').addEventListener('pointerdown',event=>{
  if(event.target.closest('.leaflet-marker-icon,.leaflet-interactive,.leaflet-popup,.leaflet-control'))lastInteractivePress={x:event.clientX,y:event.clientY,at:performance.now()};
 },{capture:true,passive:true});
 // Leaflet owns wheel normalization and zoom state. Modified gestures retain browser zoom.
 $('map').addEventListener('wheel',event=>{
  if(event.ctrlKey||event.metaKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||event.target.closest('.leaflet-popup,.leaflet-control,input,select,textarea'))event.stopImmediatePropagation();
 },{capture:true,passive:true});
 $('map').addEventListener('dblclick',event=>{
  // A first marker click may move/remove its node before the second click arrives.
  const fromInteractive=lastInteractivePress&&performance.now()-lastInteractivePress.at<800&&Math.hypot(event.clientX-lastInteractivePress.x,event.clientY-lastInteractivePress.y)<=8;
  if(fromInteractive||event.target.closest('.leaflet-marker-icon,.leaflet-interactive,.leaflet-popup,.leaflet-control,button,a,input,select,textarea'))event.stopImmediatePropagation();
  lastInteractivePress=null;
 },{capture:true});
 let hold=null,suppressClickUntil=0;
 const pointers=new Set();
 function cancelHold(){if(hold)clearTimeout(hold.timer);hold=null;}
 document.addEventListener('pointerdown',event=>{pointers.add(event.pointerId);if(pointers.size>1)cancelHold();},{capture:true,passive:true});
 $('map').addEventListener('pointerdown',event=>{
  cancelHold();
  if(event.button!==0||event.isPrimary===false||pointers.size!==1||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||!emptyMapTarget(event.target))return;
  const candidate={id:event.pointerId,x:event.clientX,y:event.clientY,latlng:map.mouseEventToLatLng(event),timer:null};
  hold=candidate;candidate.timer=setTimeout(()=>{
   if(hold!==candidate||!pointers.has(candidate.id)||!emptyMapTarget(event.target))return;
   hold=null;suppressClickUntil=performance.now()+1000;
   requestContributionPoint(candidate.latlng,contributionPicking);
  },650);
 },{passive:true});
 document.addEventListener('pointermove',event=>{if(hold&&event.pointerId===hold.id&&Math.hypot(event.clientX-hold.x,event.clientY-hold.y)>8)cancelHold();},{capture:true,passive:true});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,event=>{pointers.delete(event.pointerId);if(hold?.id===event.pointerId)cancelHold();},{capture:true,passive:true});
 document.addEventListener('wheel',cancelHold,{capture:true,passive:true});
 window.addEventListener('blur',()=>{cancelHold();pointers.clear()});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelHold();pointers.clear()}});
 map.on('movestart zoomstart',cancelHold);
 $('map').addEventListener('contextmenu',event=>{if(hold||performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}});
 $('map').addEventListener('click',event=>{if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
 map.on('click',event=>{if(contributionPicking&&emptyMapTarget(event.originalEvent?.target)){L.DomEvent.stop(event.originalEvent);requestContributionPoint(event.latlng,true)}});
}
if(map){const credit=map.attributionControl.getContainer(),syncCredit=()=>document.documentElement.style.setProperty('--attribution-height',Math.ceil(credit.getBoundingClientRect().height)+'px');new ResizeObserver(syncCredit).observe(credit);syncCredit()}
$('pickPoint')?.addEventListener('click',()=>{if(!map)return;picking=!picking;document.body.classList.toggle('picking',picking);$('pickPoint').textContent=picking?'Cancel selection':'Choose on map';$('formStatus').textContent=picking?'Click the public location on the map.':'';if(picking){closeTools();$('map').focus()}});
const facetControls={filterBorough:'boroughs',filterType:'placeTypes',filterEvidence:'evidence',filterReview:'reviews',filterGeo:'geoStatuses'};
const facetLabels={filterEvidence:{reported_story:'Reported story',source_list:'Source list',source_grounded:'Historical case',archival_gap:'Archival question',unknown:'Unknown'},filterReview:{legacy:'Not recorded',owner_approved:'Owner approved',unknown:'Unknown'},filterGeo:{approximate:'Approximate'}};
function populateFacets(){
 const facets=AtlasModel.facets(allRecords());
 const collection=$('filterStatus'),previous=collection.value;collection.replaceChildren(new Option('All','all'));for(const cat of [...new Set(allRecords().map(r=>r.category))]){const rows=allRecords().filter(r=>r.category===cat);collection.add(new Option(layerName(rows[0]),cat))}const featuredRows=allRecords().filter(r=>r.featured);if(featuredRows.length){const option=new Option('Five borough starters','featured');option.id='featuredOption';collection.add(option)}collection.value=[...collection.options].some(o=>o.value===previous)?previous:'all';
 for(const [id,key] of Object.entries(facetControls)){
  const el=$(id),old=el.value;el.replaceChildren(new Option('All','all'));
  for(const item of facets[key])el.add(new Option(facetLabels[id]?.[item.value]||item.label,item.value));
  el.value=[...el.options].some(o=>o.value===old)?old:'all';
 }
}
function filtered(){
 const f=$('filterStatus').value;
 const records=AtlasModel.filter(allRecords(),{query:$('search').value,borough:$('filterBorough').value,placeType:$('filterType').value,evidence:$('filterEvidence').value,review:$('filterReview').value,geoStatus:$('filterGeo').value,period:$('filterPeriod').value==='custom'?'range':$('filterPeriod').value,fromYear:$('filterPeriod').value==='custom'?$('periodStart').value:'',toYear:$('filterPeriod').value==='custom'?$('periodEnd').value:''});
 return records.filter(r=>f==='all'||(f==='featured'&&r.featured)||r.category===f||(f==='draft'&&r.status==='draft')||(f==='unlocated'&&!hasPoint(r)));
}
const markerSymbols={
 haunting:'<path d="M5 20V10a7 7 0 0 1 14 0v10l-3-2-4 2-4-2z"/><path d="M9 10h.01M15 10h.01" stroke-width="3"/>',
 question:'<path d="M8 8a4 4 0 1 1 7 3c-2 1-3 2-3 4"/><path d="M12 19h.01" stroke-width="3"/>',
 demolished:'<path d="M4 21V5h9l-2 6 5-1-2 5h6v6M2 21h20M7 8h1M7 12h1M7 16h1M17 18h1"/>',
 place:'<path d="M3 10h18l-2-6H5zM5 10v11h14V10M9 21v-7h6v7M2 21h20"/>',
 record:'<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/>'
};
function recordSymbol(r){return ['haunting','reported_haunting'].includes(r.category)?'haunting':r.category==='archival_gap'||r.claim_status==='question'?'question':r.category==='demolished'?'demolished':['pilot','vanished_place'].includes(r.category)?'place':'record'}
function markerSvg(r){return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${markerSymbols[recordSymbol(r)]}</svg>`}
function renderLegend(records){
 const entries=new Map();for(const r of records){const label=layerName(r);if(!entries.has(label))entries.set(label,r)}
 $('mapLegend').innerHTML=[...entries].map(([label,r])=>`<li data-record-category="${esc(r.category||'draft')}"><span class="legend-symbol ${esc(r.category||'draft')}" aria-hidden="true">${markerSvg(r)}</span><span>${esc(label)}</span></li>`).join('');
}
function syncFilterState(){
 const count=Number(Boolean($('search').value.trim()))+['filterStatus','filterPeriod',...Object.keys(facetControls)].filter(id=>$(id).value!=='all').length;
 $('filtersActiveCount').textContent=String(count);$('filtersActiveCount').hidden=!count;
 $('filtersButton').classList.toggle('active',count>0);$('filtersButton').setAttribute('aria-label',count?`Filters, ${count} active`:'Filters');
}
function renderRecords(){
 const records=filtered(),mapped=records.filter(hasPoint);
 syncFilterState();renderLegend(records);
 if(!records.some(r=>r.id===selected))selected=records[0]?.id||null;
 $('recordList').replaceChildren();$('unlocatedList').replaceChildren();markers.clear();
 if(pointLayer)pointLayer.clearLayers();if(uncertaintyLayer)uncertaintyLayer.clearLayers();
 $('filterCount').textContent=`${records.length} results`;
 Object.assign($('filterCount').dataset,{total:String(allRecords().length),matched:String(records.length),mapped:String(mapped.length),unlocated:String(records.length-mapped.length)});
 $('inventorySummary').textContent=`${records.length} records · ${mapped.length} mapped · ${records.length-mapped.length} unlocated`;
 const invalidRange=$('filterPeriod').value==='custom'&&$('periodStart').value!==''&&$('periodEnd').value!==''&&Number($('periodStart').value)>Number($('periodEnd').value);
 if($('periodHelp')){$('periodHelp').hidden=!invalidRange;$('periodHelp').textContent=invalidRange?'Start year must precede end year':'';}
 records.forEach(r=>{
  const n=AtlasModel.normalize(r),b=document.createElement('button');b.type='button';b.className='place-select';b.dataset.recordId=r.id;b.classList.toggle('active',selected===r.id);b.setAttribute('aria-pressed',String(selected===r.id));
  b.innerHTML=`<i class="dot ${esc(r.category||'draft')} ${esc(n.geoStatus)}" aria-hidden="true"></i><span class="place-title">${esc(r.title)}</span>`;
  const card=document.createElement('article');card.className='place-card';card.dataset.placeId=r.id;card.append(b);card.insertAdjacentHTML('beforeend',placeFacts(r));
  const actions=document.createElement('div');actions.className='place-actions';appendPlaceRecord(actions,r);addContributionAction(actions,r);card.append(actions);
  b.addEventListener('click',()=>selectRecord(r));(hasPoint(r)?$('recordList'):$('unlocatedList')).append(card);
  if(map&&hasPoint(r)){
   const marker=L.marker([n.geometry.coordinates[1],n.geometry.coordinates[0]],{pane:'researchPoints',icon:L.divIcon({html:markerSvg(r),className:'point-icon '+(r.status==='draft'?'local':r.category||'')+(selected===r.id?' selected':''),iconSize:[44,44],iconAnchor:[22,22]}),title:r.title,alt:r.title+', '+whereLabel(r,n),keyboard:true,riseOnHover:true});
   marker.on('click',()=>selectRecord(r));bindHoverTip(marker,esc(r.title)+'<br><small>'+esc(whereLabel(r,n))+'</small>',{direction:'top',offset:[0,-9]});pointLayer.addLayer(marker);markers.set(r.id,marker);
   if(n.uncertaintyM>0)L.circle([n.geometry.coordinates[1],n.geometry.coordinates[0]],{radius:n.uncertaintyM,color:'#efad6b',weight:1,fillOpacity:.08,interactive:false}).addTo(uncertaintyLayer);
  }
 });
 if(!records.length){$('recordList').innerHTML='<div class="empty"><h3>Empty</h3><p>'+(invalidRange?'Check the year range':'No matching records')+'</p><button class="outline" id="emptyReset">Reset</button></div>';$('emptyReset').addEventListener('click',()=>resetFilters());$('detail').innerHTML='';}
 else renderDetail(records.find(r=>r.id===selected));
 $('unlocatedList').closest('section').hidden=!records.some(r=>!hasPoint(r));
 if($('mapScope'))$('mapScope').textContent=`${mapped.length} mapped · ${records.length-mapped.length} unlocated`;
}
function fitRecords(records){if(!map)return;const pts=records.filter(hasPoint).map(r=>{const c=AtlasModel.normalize(r).geometry.coordinates;return[c[1],c[0]]});if(pts.length)map.fitBounds(L.latLngBounds(pts),{padding:[34,34],maxZoom:16,animate:false})}
function visibleMapCenter(){
 const size=map.getSize(),panel=$('researchSidecar').getBoundingClientRect(),brand=document.querySelector('.brand').getBoundingClientRect();
 if(panel.left>120){
  const x=panel.left/2,obstacles=[...document.querySelectorAll('.brand,.header-tools')].filter(node=>getComputedStyle(node).visibility!=='hidden').map(node=>node.getBoundingClientRect());
  const top=Math.max(24,...obstacles.filter(r=>r.left<x&&r.right>x).map(r=>r.bottom+24));
  const bottom=Math.min(size.y-24,...[...document.querySelectorAll('.contribution-navigation,.contributors-footer,.recenter-map')].map(node=>node.getBoundingClientRect()).filter(r=>r.left<x&&r.right>x).map(r=>r.top-24));
  return L.point(x,(Math.min(top,bottom)+bottom)/2);
 }
 const top=Math.min(brand.bottom+18,panel.top-45);return L.point(size.x/2,Math.max(24,(top+panel.top)/2));
}
function revealRecord(r){if(!map||!hasPoint(r))return;map.stop();const c=AtlasModel.normalize(r).geometry.coordinates,latlng=L.latLng(c[1],c[0]);map.setView(latlng,Math.max(map.getZoom(),16),{animate:false});const marker=markers.get(r.id);if(marker&&pointLayer.getVisibleParent&&pointLayer.getVisibleParent(marker)!==marker)map.setZoom(Math.min(map.getMaxZoom(),18),{animate:false});map.panBy(map.latLngToContainerPoint(latlng).subtract(visibleMapCenter()),{animate:false});}
function revealPlaceCard(card){if(!card)return;const panel=$('casePanel');panel.scrollTop+=card.getBoundingClientRect().top-panel.getBoundingClientRect().top-8;placeLayout?.remember();}
function selectRecord(r){
 if(selectingContributionPlace){selectingContributionPlace=false;switchPanel('draftPanel');window.dispatchEvent(new CustomEvent('contributions-clarify-requested',{detail:{recordId:r.id,title:r.title}}));updateLayerStatus();return;}
 selected=r.id;renderRecords();switchPanel('casePanel');map?.closePopup();
 const button=[...$('recordList').querySelectorAll('button[data-record-id]'),...$('unlocatedList').querySelectorAll('button[data-record-id]')].find(b=>b.dataset.recordId===r.id);revealPlaceCard(button?.closest('.place-card'));button?.focus({preventScroll:true});revealRecord(r);
}
function resetFilters(fit=true){$('search').value='';for(const id of ['filterStatus','filterPeriod',...Object.keys(facetControls)])$(id).value='all';$('periodStart').value='';$('periodEnd').value='';togglePeriod();renderRecords();if(fit)fitRecords(filtered())}
function togglePeriod(){const active=$('filterPeriod').value==='custom';$('periodStart').disabled=!active;$('periodEnd').disabled=!active;if($('periodBounds'))$('periodBounds').hidden=!active;}
$('search').addEventListener('input',renderRecords);
for(const id of ['filterStatus','filterPeriod',...Object.keys(facetControls)])$(id).addEventListener('change',()=>{togglePeriod();renderRecords();fitRecords(filtered())});
for(const id of ['periodStart','periodEnd'])$(id).addEventListener('input',()=>{renderRecords();fitRecords(filtered())});
$('fitFiltered').addEventListener('click',()=>fitRecords(filtered()));$('resetFilters').addEventListener('click',()=>resetFilters());
function addContributionAction(card,r){
 if(r.status==='draft'||(!sourceInventory.records.some(x=>x.id===r.id)&&r.id!==pilot.id&&!publishedPlaces.some(x=>x.id===r.id)))return;
 const button=document.createElement('button');button.type='button';button.className='outline place-contribute';button.dataset.contributionRecordId=r.id;button.textContent='Contribute';button.setAttribute('aria-label',`Contribute to ${r.title}`);
 button.addEventListener('click',()=>{switchPanel('draftPanel');$('sidecarTitle').textContent='Contribute';window.dispatchEvent(new CustomEvent('contributions-clarify-requested',{detail:{recordId:r.id,title:r.title}}))});card.append(button);
 const edit=document.createElement('button');edit.type='button';edit.className='outline place-edit';edit.dataset.editRecordId=r.id;edit.textContent='Edit';edit.setAttribute('aria-label',`Edit ${r.title}`);edit.setAttribute('aria-haspopup','dialog');
 edit.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('record-edit-requested',{detail:{recordId:r.id,record:structuredClone(r),opener:edit}})));card.append(edit);
}
function placeFacts(r){
 const p=PlaceSummary.view(r),v=vicinityOf(r),near=v?[v.near,v.area].filter(Boolean).join(', '):'';
 const coordinates=p.latitude===null||p.longitude===null
  ? '<p class="place-coordinate-note">Location unresolved</p>'
  : `<dl class="place-coordinates"><dt>Coordinates</dt><dd><span class="sr-only">Latitude </span>${esc(p.latitude)}<span aria-hidden="true">, </span><span class="sr-only">Longitude </span>${esc(p.longitude)}</dd></dl>`;
 return `<div class="place-facts"><p class="place-description">${esc(p.description)}</p><p class="place-location">${p.current?'Current location: ':''}${esc(p.location)}</p>${near?`<p class="place-near">Near ${esc(near)}</p>`:''}${coordinates}<div class="place-links">${p.mapUrl?link(p.mapUrl,'View on map'):''}${p.sourceUrl?link(p.sourceUrl,'View source'):''}</div></div>`;
}

function appendPlaceRecord(card,r){
 const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');details.className='place-record';summary.textContent='Record';body.className='place-record-content';details.append(summary,body);
 const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=String(value);return el;};
 body.append(text('h3',r.title));const description=PlaceSummary.view(r).description;if(description)body.append(text('p',description));
 const p=PlaceSummary.view(r);if(p.latitude!==null)body.append(text('p',p.latitude+', '+p.longitude));
 const photo=r.image||{},url=photo.localUrl&&/^assets\/[A-Za-z0-9_./-]+$/.test(photo.localUrl)?photo.localUrl:safeUrl(photo.url||r.image_url);
 if(url){const figure=document.createElement('figure'),image=document.createElement('img');image.src=url;image.alt=photo.alt||photo.caption||r.image_caption||r.title;image.loading='lazy';figure.append(image);if(photo.caption||r.image_caption)figure.append(text('figcaption',photo.caption||r.image_caption));if(photo.creator||photo.license)figure.append(text('p',[photo.creator,photo.license].filter(Boolean).join(' · ')));body.append(figure);}
 const sources=Array.isArray(r.sources)?r.sources:[];if(sources.length||r.source_url){body.append(text('h4','Sources'));const list=document.createElement('ul');for(const source of sources.length?sources:[{url:r.source_url,title:r.source_title}]){const row=document.createElement('li'),url=safeUrl(source.url);if(url){const a=text('a',source.title||source.citation||source.source_ref||'Source');a.href=url;a.target='_blank';a.rel='noopener noreferrer';row.append(a);}else row.append(text('span',source.citation||source.title||'Source'));if(source.evidence_note)row.append(text('p',source.evidence_note));list.append(row);}body.append(list);}
 const metadata=[['Location',r.location_text||r.place_original],['Borough',r.borough],['Dates',r.time_original||r.event_date_start],['Date basis',r.time_basis],['Location basis',r.geo_basis||r.location_precision],['Uncertainty',r.uncertainty_note],['Rights',r.rights_or_license]];const dl=document.createElement('dl');for(const[label,value]of metadata)if(value!==undefined&&value!==null&&value!==''){dl.append(text('dt',label),text('dd',value));}if(dl.children.length)body.append(dl);card.append(details);
}

function renderDetail(r){
 $('detail').hidden=true;
 $('detail').replaceChildren();
}
function draftFrom(raw){
 const record=window.DraftModel.draftFrom(raw);
 if(record.latitude!==null){
  if(!NycGeometry.available)throw Error('NYC boundary validation is unavailable. Your input is unchanged; retry, or leave both coordinates blank to retain an unlocated draft.');
  const borough=NycGeometry.findBorough(record.latitude,record.longitude);
  if(!borough)throw Error('Coordinates are outside the five-borough boundary. Your input is unchanged; leave both coordinates blank to retain an unlocated draft.');
  record.borough=borough;record.boundary_check='inside_nyc';record.boundary_source_url='https://data.cityofnewyork.us/City-Government/Borough-Boundaries-water-areas-included-/wh2p-dxnf';
 }
 return record;
}
$('contributionForm')?.addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,raw=Object.fromEntries(new FormData(form));try{await NycGeometry.ready;if(drafts.length>=500)throw Error('The 500-point local limit has been reached. Export and review your records.');const r=draftFrom(raw);drafts.push(r);populateFacets();const saved=persist();form.reset();$('formStatus').classList.remove('error');$('formStatus').textContent=saved?'Draft saved in this browser. It has not been submitted to a shared map.':'Draft kept in this tab only. Export it now because browser storage is unavailable.';resetFilters(false);selectRecord(r)}catch(err){$('formStatus').textContent=err.message;$('formStatus').classList.add('error')}});
const exportKeys=['id','place_id','title','status','claim_status','location_text','latitude','longitude','location_precision','geocode_method','geocode_source_url','event_date_start','event_date_end','event_date_precision','record_date','earliest_source_found_date','source_title','source_url','source_page_or_id','source_type','evidence_summary','interpretation','uncertainty_note','rights_or_license','checked_date','category','borough','built','demolished','sources','proxy','aliases','data_quality_flags','featured','image','reported_phenomena','historical_context','reported_interior','source_quality','original_submission','original_submission_json','boundary_check','boundary_source_url','site_group_id','site_relationship'];
function download(content,type,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)}
$('exportGeo')?.addEventListener('click',()=>download(JSON.stringify({type:'FeatureCollection',name:'Hauntologies of New York — private pilot and local drafts',features:allRecords().map(r=>({type:'Feature',id:r.id,geometry:hasPoint(r)?{type:'Point',coordinates:[Number(r.longitude),Number(r.latitude)]}:null,properties:Object.fromEntries(exportKeys.filter(k=>!['latitude','longitude'].includes(k)).map(k=>[k,r[k]??'']))}))},null,2),'application/geo+json','hauntologies-points.geojson'));
const csvCell=x=>{let s=typeof x==='object'&&x!==null?JSON.stringify(x):String(x??'');if(/^[=+@]/.test(s)||(/^-/.test(s)&&!/^-[\d.]+$/.test(s))||/^[\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
$('exportCsv')?.addEventListener('click',()=>download([exportKeys.join(','),...allRecords().map(r=>exportKeys.map(k=>csvCell(r[k])).join(','))].join('\r\n'),'text/csv;charset=utf-8','hauntologies-points.csv'));
function parseCSV(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=''}else cell+=c}if(quoted)throw Error('CSV has an unclosed quoted field.');if(cell||row.length){row.push(cell);rows.push(row)}const headers=rows.shift()?.map(x=>x.trim().replace(/^\uFEFF/,''))||[];return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])))}
$('importFile')?.addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1000000)throw Error('Choose a file smaller than 1 MB.');const text=await file.text();let rows;if(/\.csv$/i.test(file.name))rows=parseCSV(text);else{const json=JSON.parse(text);if(json.type!=='FeatureCollection'||!Array.isArray(json.features))throw Error('Choose a GeoJSON FeatureCollection containing Point features.');rows=json.features.map(f=>{if(f.geometry===null)return{...f.properties,longitude:null,latitude:null};if(f.geometry?.type!=='Point')throw Error('Only Point features or null geometry (unlocated records) are supported.');return{...f.properties,longitude:f.geometry.coordinates[0],latitude:f.geometry.coordinates[1]}})}if(!rows.length)throw Error('No points were found.');if(rows.length+drafts.length>500)throw Error('Import would exceed the 500-point local limit.');await NycGeometry.ready;const imported=rows.map(draftFrom);drafts.push(...imported);populateFacets();const saved=persist();$('importStatus').classList.remove('error');$('importStatus').textContent=imported.length+' points imported as local drafts.'+(saved?'':' Browser storage unavailable; export now.');renderRecords()}catch(err){$('importStatus').textContent=err.message;$('importStatus').classList.add('error')}e.target.value=''});
window.addEventListener('offline',()=>{$('mapStatus').textContent='Offline'});window.addEventListener('online',()=>changeYear($('layerSelect').value));populateFacets();togglePeriod();selected=pilot.id;closeTools();renderRecords();recenterNYC();

window.addEventListener('edits-place-requested',async event=>{await refreshPublishedPlaces();const record=allRecords().find(item=>item.id===event.detail?.recordId);if(!record)return;resetFilters(false);selectRecord(record);});

refreshPublishedPlaces();refreshPendingPlaces();

window.addEventListener('contributions-place-pick-requested',()=>{closeTools();selectingContributionPlace=true;$('mapStatus').textContent='Choose an existing place on the map or in Places';$('map').focus();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&selectingContributionPlace){selectingContributionPlace=false;updateLayerStatus();switchPanel('draftPanel');
 // The visible place field replaced the old picker button, which is now hidden.
 ($('contributionPlace')||$('chooseExistingPlace')).focus();}});

window.addEventListener('contributions-records-changed',event=>{if(!event.detail?.publicRefresh)refreshPublishedPlaces();});

// Keep the visible reading position while browser chrome, text or orientation changes.
function setupPlaceLayout(){
 const panel=$('casePanel'),sidecar=$('researchSidecar');
 const header=document.querySelector('.masthead'),tools=document.querySelector('.header-tools'),brand=document.querySelector('.brand');
 const dockNodes=()=>[...document.querySelectorAll('.contribution-navigation,.contributors-footer,.recenter-map')];
 let anchor=null,frame=0,lastWidth=innerWidth,lastHeight=innerHeight;
 const active=()=>document.body.classList.contains('places-open')&&!sidecar.hidden;
 const visible=node=>node.getBoundingClientRect().height&&(!node.closest('.place-record-content')||node.closest('.place-record').open);
 const readingNodes=card=>[...card.querySelectorAll('.place-select,.place-description,.place-location,.place-coordinates,.place-links,.place-record > summary,.place-record-content > *,.place-contribute,.place-edit')];
 const remember=()=>{
  if(!active())return;
  const bounds=panel.getBoundingClientRect();
  const card=[...panel.querySelectorAll('.place-card')].find(node=>{const r=node.getBoundingClientRect();return r.bottom>bounds.top+8&&r.top<bounds.bottom;});
  if(!card){anchor=null;return;}
  const candidates=readingNodes(card);
  const node=candidates.find(node=>visible(node)&&node.getBoundingClientRect().bottom>bounds.top+8)||card;
  anchor={node,card,id:card.dataset.placeId,index:candidates.indexOf(node),offset:node.getBoundingClientRect().top-bounds.top};
 };
 const layout=()=>{
  if(!active())return;
  const saved=anchor,view=window.visualViewport;
  const docks=dockNodes();for(const node of docks)observer.observe(node);
  // Pinch zoom remains browser-controlled; layout reflow uses the CSS viewport.
  const viewTop=view?.scale===1?view.offsetTop:0,viewBottom=view?.scale===1?view.offsetTop+view.height:innerHeight;
  const bounds=sidecar.getBoundingClientRect(),overlaps=r=>r.right>bounds.left&&r.left<bounds.right;
  const short=matchMedia('(max-height:640px)').matches;
  const top=Math.ceil(Math.max(viewTop+12,...[tools,...short?[]:[brand]].map(node=>{const r=node.getBoundingClientRect();return overlaps(r)?r.bottom+8:viewTop+12;})));
  const bottom=Math.floor(Math.min(viewBottom-12,...docks.map(node=>{const r=node.getBoundingClientRect();return overlaps(r)?r.top-8:viewBottom-12;})));
  const values={'--places-top':top+'px','--places-height':Math.max(0,bottom-top)+'px'};
  for(const [key,value]of Object.entries(values))if(sidecar.style.getPropertyValue(key)!==value)sidecar.style.setProperty(key,value);
  const card=saved&&(saved.card.isConnected?saved.card:[...panel.querySelectorAll('.place-card')].find(node=>node.dataset.placeId===saved.id));
  if(card){
   // A public-record refresh may replace DOM nodes during the same resize.
   const previous=saved.node.isConnected?saved.node:readingNodes(card)[saved.index];
   const node=previous&&visible(previous)?previous:card;
   const offset=node===previous?saved.offset:8;
   panel.scrollTop+=node.getBoundingClientRect().top-panel.getBoundingClientRect().top-offset;
  }
  lastWidth=innerWidth;lastHeight=innerHeight;remember();
 };
 const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(layout);};
 panel.addEventListener('scroll',()=>{if(innerWidth===lastWidth&&innerHeight===lastHeight)remember();},{passive:true});
 panel.addEventListener('toggle',event=>{
  if(!event.target.matches('.place-record'))return;
  const card=event.target.closest('.place-card'),bounds=card.getBoundingClientRect(),view=panel.getBoundingClientRect();
  if(!event.target.open&&bounds.height<=view.height-16&&(bounds.top<view.top||bounds.bottom>view.bottom))revealPlaceCard(card);
  schedule();
 },true);
 const observer=new ResizeObserver(schedule);
 for(const node of [header,tools,brand,...dockNodes(),$('recordList'),$('unlocatedList'),sidecar.querySelector('.popout-head')])observer.observe(node);
 window.addEventListener('resize',schedule);
 window.visualViewport?.addEventListener('resize',schedule);
 window.visualViewport?.addEventListener('scroll',schedule);
 return{layout,remember};
}
placeLayout=setupPlaceLayout();
