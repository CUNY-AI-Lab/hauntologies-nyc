'use strict';
(() => {
  const byId=id=>document.getElementById(id), list=byId('activityList'), status=byId('activityStatus');
  const verbs={create:'added a place',edit:'edited a place',note:'updated a place',undo:'published an undo',publication:'published a contribution'};
  // Omit the requested older Thomas Shoe Factory feed entry; retain its Place and audit history.
  const hiddenEntry=event=>event.place.id==='wf_HNY-4ECE1F1584C3' && event.kind==='create' && event.at==='2026-10-25T03:16:07.618Z';
  let events=[], shown=0, generation=0;
  const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
  function valid(data) {
    return data?.schema_version==='1.0' && Number.isInteger(data.total) && data.total>=0 && data.limit===100 && Array.isArray(data.events) && data.events.length===Math.min(data.total,data.limit) && data.events.every(event=>
      Object.hasOwn(verbs,event.kind) && (event.contributor===null || typeof event.contributor==='string' && event.contributor.length<=120 && !event.contributor.includes('@')) &&
      (event.at===null || typeof event.at==='string' && Number.isFinite(Date.parse(event.at))) &&
      (event.place_count===undefined || Number.isInteger(event.place_count) && event.place_count>1) &&
      typeof event.place?.title==='string' && typeof event.place.id==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(event.place.id));
  }
  function more() {
    const previous=shown, moveFocus=document.activeElement===byId('moreActivity'); shown=Math.min(shown+20,events.length);
    for(const event of events.slice(previous,shown)) {
      const count=event.place_count||1,verb=count>1?({create:'added '+count+' places',edit:'edited '+count+' places',note:'updated '+count+' places',undo:'published an undo affecting '+count+' places',publication:'published a contribution affecting '+count+' places'})[event.kind]:verbs[event.kind];
      const item=node('li'), action=node('p',(event.contributor || 'Unattributed contributor')+' '+verb,'activity-action');
      const place=node('a',event.place.title,'activity-place');place.href='/?place='+encodeURIComponent(event.place.id);
      const time=node(event.at?'time':'span',event.at?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(event.at))+' UTC':'Publication date unavailable','activity-date');
      if(event.at)time.dateTime=event.at;
      const history=node('a','Place changelog','activity-history');history.href=place.href+'&action=history';history.setAttribute('aria-label','Changelog for '+event.place.title);
      const meta=node('div',undefined,'activity-meta');meta.append(time,history);
      item.append(action,place);if(count>1)item.append(node('p','And '+(count-1)+' other place'+(count===2?'':'s'),'activity-other-places'));item.append(meta);list.append(item);
    }
    byId('moreActivity').hidden=shown>=events.length;
    // Keep keyboard position in the newly revealed content when the last button disappears.
    if(previous && moveFocus)list.children[previous]?.querySelector('a')?.focus();
  }
  async function refresh(){
    const request=++generation;
    events=[];shown=0;list.replaceChildren();byId('activityEmpty').hidden=true;byId('moreActivity').hidden=true;
    byId('refreshActivity').disabled=true;list.setAttribute('aria-busy','true');status.textContent='Loading public activity…';
    try {
      const data=await window.HauntologiesPublicReads.json('/api/activity');
      if(request!==generation || document.hidden)return;
      if(!valid(data))throw new Error('Invalid public activity');
      events=data.events.filter(event=>!hiddenEntry(event));more();byId('activityEmpty').hidden=!!events.length;
      status.textContent='';
    } catch {if(request===generation)status.textContent='Public activity is unavailable. Select Refresh to try again.';}
    finally {if(request===generation){byId('refreshActivity').disabled=false;list.setAttribute('aria-busy','false');}}
  }
  byId('refreshActivity').addEventListener('click',refresh);byId('moreActivity').addEventListener('click',more);
  // Retained history may have been revoked while this page was in the background.
  document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;events=[];shown=0;list.replaceChildren();byId('refreshActivity').disabled=false;list.setAttribute('aria-busy','false');byId('moreActivity').hidden=true;byId('activityEmpty').hidden=true;status.textContent='';}else refresh();});
  window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});
  refresh();
})();
