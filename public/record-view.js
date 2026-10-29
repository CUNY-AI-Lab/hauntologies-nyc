'use strict';
// The existing Places-card Record disclosure, rendered from the public record only.
(function(root){
  function append(card,record,{summary,near='',safeUrl}){
    const document=card.ownerDocument;
    const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=String(value);if(className)node.className=className;return node;};
    const present=value=>value!==undefined&&value!==null&&value!=='';
    const metadata=items=>{
      const list=document.createElement('dl');list.className='place-record-metadata';
      for(const [label,value]of items)if(present(value)){const row=document.createElement('div');row.append(text('dt',label),text('dd',value));list.append(row);}
      return list;
    };
    const link=(url,label)=>{const node=text('a',label);node.href=url;node.target='_blank';node.rel='noopener noreferrer';return node;};
    const details=document.createElement('details'),toggle=text('summary','Record'),body=document.createElement('div');
    details.className='place-record';body.className='place-record-content';details.append(toggle,body);
    const facts=metadata([
      ['Borough',record.borough&&!(summary.location+' '+near).toLowerCase().includes(String(record.borough).toLowerCase())?record.borough:null],
      ['Dates',record.time_original||record.event_date_start],['Date basis',record.time_basis],
      ['Location basis',record.geo_basis||record.location_precision],['Uncertainty',record.uncertainty_note],
      ['Uncertainty (m)',record.uncertainty_m],['Uncertainty basis',record.uncertainty_basis],
      ...(Array.isArray(record.attributes)?record.attributes.map(a=>[a.name,a.value]):[]),
      ['Rights',record.rights_or_license],['Record license',record.record_license],['Rights notes',record.rights_notes]
    ]);
    if(facts.children.length)body.append(facts);
    const photo=record.image||{},url=photo.localUrl&&/^assets\/[A-Za-z0-9_./-]+$/.test(photo.localUrl)?photo.localUrl:safeUrl(photo.url||record.image_url);
    if(url){
      const figure=document.createElement('figure'),image=document.createElement('img');image.src=url;image.alt=photo.alt||record.image_alt||photo.caption||record.image_caption||record.title;image.loading='lazy';figure.append(image);
      if(photo.caption||record.image_caption)figure.append(text('figcaption',photo.caption||record.image_caption));
      const credit=metadata([['Image credit',photo.creator||photo.credit||record.image_credit],['Image license',photo.license||record.image_license]]);
      if(credit.children.length)figure.append(credit);
      const sourceUrl=safeUrl(photo.sourceUrl||record.image_source_url),licenseUrl=safeUrl(photo.licenseUrl||record.image_license_url);
      if(sourceUrl)figure.append(link(sourceUrl,'Image source'));
      if(licenseUrl)figure.append(link(licenseUrl,'Image license'));
      body.append(figure);
    }
    const sources=Array.isArray(record.sources)&&record.sources.length?record.sources:record.source_url?[{url:record.source_url,title:record.source_title}]:[];
    if(sources.length){
      body.append(text('h4','Sources'));const list=document.createElement('ul');list.className='place-record-sources';
      for(const source of sources){
        if(!source||typeof source!=='object')continue;
        const row=document.createElement('li'),url=safeUrl(source.url),title=source.title||source.citation||source.source_ref||'Source';
        row.append(url?link(url,title):text('p',title,'place-record-source-title'));
        if(source.title&&source.citation&&source.citation!==source.title)row.append(text('p',source.citation,'place-record-citation'));
        const fields=metadata([
          ['Reference',source.source_ref],['Role',source.role],['Repository',source.repository],['Locator',source.locator],
          ['Source date',source.source_date_original],['Accessed',source.accessed_on],['Rights status',source.rights_status],['Rights statement',source.rights_statement],
          ['Reuse',source.public_use],['Credit',source.credit],['License',source.license]
        ]);
        if(fields.children.length)row.append(fields);
        if(source.evidence_note)row.append(text('p',source.evidence_note,'place-record-source-note'));
        list.append(row);
      }
      body.append(list);
    }
    if(body.children.length)card.append(details);
    return details;
  }
  root.PlaceRecordView=Object.freeze({append});
})(typeof window!=='undefined'?window:globalThis);
