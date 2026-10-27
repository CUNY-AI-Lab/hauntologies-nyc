/* Read-only preview of the persisted, typed release manifest. */
(function () {
  'use strict';
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(className)el.className=className;return el;};
  const css=node('style',`#candidateDialog{width:min(1120px,96vw);max-width:96vw;max-height:94dvh;background:#10100f;color:#eee;border:1px solid #88704d;padding:16px;border-radius:8px}#candidateDialog::backdrop{background:#000c}#candidateDialog button,#candidateDialog select{min-height:44px}#candidateDialog :focus-visible{outline:3px solid #ffbc64;outline-offset:3px}.candidate-head,.candidate-controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.candidate-head h2{flex:1;margin:0}.candidate-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,1fr);gap:16px}.candidate-map{height:460px;min-height:250px;background:#20211f}.candidate-list{display:grid;gap:8px;max-height:210px;overflow:auto;padding:4px}.candidate-list button{text-align:left;width:100%;overflow-wrap:anywhere}.candidate-detail{max-height:300px;overflow:auto;overflow-wrap:anywhere;padding:4px}.candidate-detail dt{font-weight:700;color:#efc28e}.candidate-detail dd{margin:0 0 10px}.candidate-pin{background:#f6a64b;color:#18110a;border:2px solid #fff;border-radius:50%;width:18px;height:18px}.candidate-pin.approximate{border-style:dashed;border-radius:0;transform:rotate(45deg)}.candidate-result{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:650px){.candidate-grid{grid-template-columns:1fr}.candidate-map{height:270px}.candidate-list{max-height:160px}#candidateDialog{padding:10px;max-height:94dvh}}`);document.head.append(css);
  let dialog,map,markerGroup,records=[],selected=null,currentJob=null,boundaries=null;
  const polygon=r=>{if(!r.geometry||r.geo_status==='unresolved')return null;try{return window.HostedRecordModel.parseAreaGeometry(r.geometry)}catch{return null}};
  const mapped=r=>point(r)||!!polygon(r);
  const point=r=>r.geo_status!=='unresolved'&&Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)&&Math.abs(r.latitude)<=90&&Math.abs(r.longitude)<=180;
  function metadata(items){const dl=node('dl');items.forEach(([label,value])=>dl.append(node('dt',label),node('dd',value??'Unknown')));return dl;}
  const locationLabel=record=>polygon(record)?'Proposed area':point(record)?record.geo_status||record.location_precision||'Located':'Unlocated';
  const link=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
  function rowRecord(snapshot){
    const raw=JSON.parse(snapshot.raw_json),derived=JSON.parse(snapshot.derived_json);
    if(!raw||typeof raw!=='object'||!derived||typeof derived!=='object')throw new Error('Invalid persisted record snapshot.');
    return window.HostedRecordModel.flatten({id:snapshot.id,raw,derived,raw_json:snapshot.raw_json});
  }
  function showRecord(record){
    selected=record.id;const detail=dialog.querySelector('.candidate-detail');detail.replaceChildren(node('h3','Record'),node('strong',record.title));
    const fields=[['Record',record.id],['Location',locationLabel(record)]];
    if(point(record))fields.push(['Coordinates',`${record.latitude}, ${record.longitude}`]);
    fields.push(['Place',record.location_text],['Date',record.time_original||'Unknown'],['Date basis',record.time_basis||'Unknown'],['Claim',record.evidence_summary||record.description],['Location basis',record.geo_basis||'Unknown']);
    if(record.original_wording)fields.push(['Original',record.original_wording]);if(record.uncertainty_note)fields.push(['Uncertainty',record.uncertainty_note]);detail.append(metadata(fields),node('h4','Sources'));
    if(!record.sources?.length)detail.append(node('p','No sources'));
    for(const source of record.sources||[]){const section=node('section');if(source.citation)section.append(node('p',source.citation));const fields=[['Role',source.role],['Repository',source.repository],['Locator',source.locator],['Note',source.evidence_note]].filter(([,value])=>value!==undefined&&value!==null&&value!=='');if(fields.length)section.append(metadata(fields));const href=link(source.url);if(href){const a=node('a','Source');a.href=href;a.target='_blank';a.rel='noopener noreferrer';section.append(a);}detail.append(section);}
    dialog.querySelectorAll('[data-candidate-record]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.candidateRecord===record.id)));
    if(polygon(record))map.fitBounds(L.geoJSON(polygon(record)).getBounds(),{padding:[28,28],maxZoom:16});else if(point(record))map.panTo([record.latitude,record.longitude]);detail.focus();
  }
  function renderState(){
    const state=dialog.querySelector('#candidateState').value,list=dialog.querySelector('.candidate-list'),detail=dialog.querySelector('.candidate-detail');markerGroup.clearLayers();list.replaceChildren();detail.replaceChildren();selected=null;records=[];dialog.dataset.previewReady='false';
    try{records=currentJob.proposal_envelope?(state==='after'?window.HostedRecordModel.proposalRecords(currentJob.proposal_envelope,currentJob.target):currentJob.target?.record?[{...window.HostedRecordModel.targetRecord(currentJob.target),id:currentJob.target.record_id}]:[]):(currentJob.manifest?.targets||[]).flatMap(t=>t[state+'_record']?[t[state+'_record']]:t[state]?[rowRecord(t[state])]:[]);}catch(error){dialog.querySelector('#candidateStatus').textContent='Cannot render this persisted snapshot: '+error.message;return;}
    const located=records.filter(mapped);dialog.querySelector('#candidateStatus').textContent=currentJob.proposal_envelope?'Unreviewed':'';
    if(!records.length)list.append(node('p','No records'));
    records.forEach(r=>{const button=node('button',undefined,'outline');button.append(node('strong',r.title),node('br'),node('span',locationLabel(r)));button.type='button';button.dataset.candidateRecord=r.id;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>showRecord(r));list.append(button);if(polygon(r)){L.geoJSON(polygon(r),{style:{color:'#f6a64b',weight:2,dashArray:'6 4',fillOpacity:.15},onEachFeature:(_feature,layer)=>layer.on('click',()=>showRecord(r))}).addTo(markerGroup);}else if(point(r)){const approximate=r.geo_status==='approximate'||r.location_precision==='approximate';L.marker([r.latitude,r.longitude],{keyboard:true,title:r.title,alt:r.title,icon:L.divIcon({className:'candidate-pin'+(approximate?' approximate':''),iconSize:[18,18],iconAnchor:[9,9]})}).on('click',()=>showRecord(r)).addTo(markerGroup);}});
    if(located.length)map.fitBounds(markerGroup.getBounds(),{padding:[28,28],maxZoom:15});else map.fitBounds([[40.48,-74.27],[40.93,-73.68]]);
    dialog.querySelector('.candidate-result').replaceChildren();dialog.dataset.previewReady=String(records.length>0);
  }
  async function open(job){
    const account=job?.uiAccount||window.HauntologiesAccount?.snapshot();
    if(!window.HauntologiesAccount?.isCurrent(account))return;
    if(!job?.proposal_envelope&&(!job?.manifest?.targets||!Array.isArray(job.manifest.targets)))return;
    if(!window.L||!window.HostedRecordModel)return;
    const opener=document.activeElement;if(dialog?.open)dialog.close();currentJob=job;dialog=node('dialog');dialog.id='candidateDialog';dialog.setAttribute('aria-labelledby','candidateTitle');
    const head=node('div',undefined,'candidate-head'),title=node('h2',job.can_verify===true?'Verify contribution':'Preview');title.id='candidateTitle';const close=node('button','Close','outline');close.type='button';close.addEventListener('click',()=>dialog.close());head.append(title,close);

    const controls=node('div',undefined,'candidate-controls'),label=node('label','State '),select=node('select');select.id='candidateState';for(const [value,text] of [['after','After'],['before','Before']]){const option=node('option',text);option.value=value;select.append(option);}select.addEventListener('change',renderState);label.append(select);controls.append(label);
    const status=node('p');status.id='candidateStatus';status.setAttribute('role','status');const grid=node('div',undefined,'candidate-grid'),mapEl=node('div',undefined,'candidate-map');mapEl.setAttribute('aria-label','Map of release candidate records');const side=node('section'),list=node('div',undefined,'candidate-list'),detail=node('section',undefined,'candidate-detail');detail.tabIndex=-1;detail.setAttribute('aria-label','Selected candidate source details');side.append(list,detail);grid.append(mapEl,side);
    const evidence=node('button','Counts','outline');evidence.type='button';const result=node('div',undefined,'candidate-result');result.setAttribute('role','status');evidence.addEventListener('click',()=>{const fields=[['Records',records.length],['Mapped',markerGroup.getLayers().length],['Unlocated',records.filter(r=>!mapped(r)).length],['Selected',selected||'None']];if(!job.proposal_envelope)fields.push(['Job',job.id],['Operation',job.operation_hash]);result.replaceChildren(metadata(fields));});
    const tileStatus=node('p');tileStatus.setAttribute('role','status');dialog.append(head,controls,status,tileStatus,grid,evidence,result);document.body.append(dialog);const thisDialog=dialog;dialog.showModal();
    map=L.map(mapEl,{zoomControl:true,scrollWheelZoom:false,attributionControl:true});map.attributionControl.addAttribution('NYC borough boundaries');L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).on('tileerror',()=>{tileStatus.textContent='Street map unavailable';}).addTo(map);markerGroup=L.featureGroup().addTo(map);const thisMap=map;thisDialog.addEventListener('close',()=>{thisMap.remove();if(map===thisMap)map=null;thisDialog.remove();if(opener?.isConnected&&opener.getClientRects().length)opener.focus();else document.getElementById('toolsButton')?.focus();},{once:true});renderState();
    if(job.can_verify===true){const verification=node('section',undefined,'candidate-verification');dialog.append(verification);window.dispatchEvent(new CustomEvent('contributions-verification-ready',{detail:{job,container:verification,account}}));}
    try{if(!boundaries){const r=await fetch('/data/nyc-borough-boundaries.geojson',{cache:'force-cache'});if(!r.ok)throw new Error();boundaries=await r.json();}if(map===thisMap&&thisDialog.open)L.geoJSON(boundaries,{interactive:false,style:{color:'#9c9c8d',weight:1,fillColor:'#45473e',fillOpacity:.2}}).addTo(map).bringToBack();}catch{if(thisDialog.open)status.append(node('span',' Boundary unavailable'));}
    if(!window.HauntologiesAccount.isCurrent(account)||!thisDialog.open)return;
    requestAnimationFrame(()=>{if(thisDialog.open&&map===thisMap)thisMap.invalidateSize();});close.focus();
  }
  window.addEventListener('hauntologies-auth-changed',()=>{if(dialog?.open)dialog.close();});
  window.addEventListener('contributions-preview-requested',event=>open(event.detail));
  window.addEventListener('contributions-draft-preview-requested',event=>open({proposal_envelope:event.detail.envelope,target:event.detail.target,id:'Unsaved proposal',operation_hash:'Unreviewed'}));
})();
