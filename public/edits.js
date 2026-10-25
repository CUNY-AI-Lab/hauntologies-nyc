'use strict';
(() => {
  const byId=id=>document.getElementById(id),dialog=byId('ownEditsDialog');
  if(!dialog)return;
  const list=byId('ownEditsList'),status=byId('ownEditsStatus'),back=byId('returnToEdits');
  const labels={draft:'Draft',submitted:'Submitted for review',changes_requested:'Submitted for review · revision requested',approved:'Approved',merged:'Published',withheld:'Withdrawn'};
  const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const button=(label,action)=>{const el=node('button',label);el.type='button';el.className='outline';el.addEventListener('click',action);return el;};
  const date=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  let page=1,totalPages=1,loaded=false,generation=0,scroll=0,returnFocus=null,actor=null;
  async function get(path){const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error(response.status===401?'Sign in to view your edits.':'Edits are temporarily unavailable.');return response.json();}
  async function post(path,body){const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json',...(actor?{'X-Hauntologies-Actor':actor}:{})},body:JSON.stringify(body)});let data={};try{data=await response.json();}catch{}if(!response.ok)throw new Error(response.status===401?'Sign in to change your edits.':response.status===409?'This edit changed. Reload and try again.':'That edit could not be removed right now.');return data;}
  // Removes an unpublished edit for good; a published one stays with the map.
  async function remove(item,control){if(!window.confirm('Delete "'+(item.title||'this edit')+'"? It will be gone for good.'))return;control.disabled=true;status.textContent='Deleting…';
    try{await post('/api/contributions/delete',{idempotency_key:crypto.randomUUID(),submission_id:item.id,expected_revision:item.revision});window.dispatchEvent(new CustomEvent('contributions-edit-deleted',{detail:{submissionId:item.id}}));await load(page);}
    catch(error){status.textContent=error.message;control.disabled=false;}}
  async function identity(){const value=await get('/api/auth/session');if(value.password_required||typeof value.actor_id!=='string')throw new Error('Sign in to view your edits.');return value.actor_id;}
  function leave(action,focus){scroll=dialog.scrollTop;returnFocus=focus;dialog.close();back.hidden=false;action();}
  function showItem(item){
    const row=node('li'),title=button(item.title||'Edit',()=>leave(()=>window.dispatchEvent(new CustomEvent('contributions-review-requested',{detail:{submissionId:item.id}})),title));title.className='edit-title';row.append(title,node('p',(labels[item.status]||'Saved')+' · '+date(item.updated_at)));
    if(item.status!=='merged'){const del=button('Delete',()=>remove(item,del));del.className='textbutton edit-delete';del.setAttribute('aria-label','Delete '+(item.title||'edit'));row.append(del);}
    const targets=node('div');targets.className='edit-targets';
    for(const target of item.targets||[]){const open=button(target.title||'View place',()=>leave(()=>window.dispatchEvent(new CustomEvent('edits-place-requested',{detail:{recordId:target.record_id}})),open));open.setAttribute('aria-label','Show '+(target.title||'place')+' on map');targets.append(open);}
    row.append(targets);return row;
  }
  function controls(){byId('previousEdits').disabled=page<=1;byId('nextEdits').disabled=page>=totalPages;byId('editsPage').textContent='Page '+page+' of '+totalPages;}
  async function load(next){const version=++generation;status.textContent='Loading…';byId('previousEdits').disabled=true;byId('nextEdits').disabled=true;
    try{const expectedActor=actor,data=await get('/api/contributions/edits?page='+next),currentActor=await identity();if(version!==generation)return;if(currentActor!==expectedActor){clear();return;}page=data.page;totalPages=data.total_pages;
      if(page>totalPages){await load(totalPages);return;}
      list.replaceChildren(...data.items.map(showItem));status.textContent=data.total+' '+(data.total===1?'edit':'edits');loaded=true;scroll=0;dialog.scrollTop=0;controls();
    }catch(error){if(version!==generation)return;list.replaceChildren();status.textContent=error.message;loaded=false;controls();}
  }
  async function open(restore=false){if(byId('accountDialog').open)byId('accountDialog').close();
    try{const currentActor=await identity();if(actor!==currentActor){clear();actor=currentActor;}if(!dialog.open)dialog.showModal();back.hidden=true;
      if(restore&&loaded){dialog.scrollTop=scroll;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}else load(restore?page:1);
    }catch(error){clear();status.textContent=error.message;if(!dialog.open)dialog.showModal();}
  }
  byId('openOwnEdits').addEventListener('click',()=>open());byId('closeOwnEdits').addEventListener('click',()=>dialog.close());
  byId('previousEdits').addEventListener('click',()=>load(page-1));byId('nextEdits').addEventListener('click',()=>load(page+1));
  back.addEventListener('click',()=>{byId('closeResearch')?.click();open(true);});
  dialog.addEventListener('close',()=>byId('accountButton').focus({preventScroll:true}));
  function clear(){generation++;loaded=false;page=1;totalPages=1;scroll=0;returnFocus=null;actor=null;list.replaceChildren();status.textContent='';back.hidden=true;if(dialog.open)dialog.close();}
  window.addEventListener('contributions-session-ended',clear);window.addEventListener('contributions-session-started',clear);
  window.addEventListener('record-edit-saved',()=>{loaded=false;});
  window.addEventListener('focus',()=>{if(dialog.open){list.replaceChildren();loaded=false;open(true);}});

  const feed=byId('publishedEditsFeed'),feedList=byId('publishedEditsList'),feedStatus=byId('publishedEditsStatus');
  let timer=null,lastFeed='',feedGeneration=0;
  const setFeed=open=>window.HauntologiesDisclosure?window.HauntologiesDisclosure.set(feed,open):(feed.open=open);
  async function refreshFeed(){const version=++feedGeneration;if(!lastFeed)feedStatus.textContent='Loading…';
    try{const data=await get('/api/published-edits');await window.HauntologiesPublic?.refresh();if(version!==feedGeneration||!feed.open)return;const signature=JSON.stringify(data.items);feedStatus.textContent=data.items.length?'':'0 published edits';
      if(signature===lastFeed)return;lastFeed=signature;
      const rows=data.items.map(item=>{const row=node('li');for(const target of item.targets){row.append(button(target.title,()=>{setFeed(false);window.dispatchEvent(new CustomEvent('edits-place-requested',{detail:{recordId:target.record_id}}));}));}row.append(node('p',date(item.published_at)+(item.credit?' · '+item.credit:'')));return row;});
      // A list that arrives after the card unfolds grows in the same motion.
      const fill=()=>feedList.replaceChildren(...rows);window.HauntologiesDisclosure?window.HauntologiesDisclosure.resize(feed,fill):fill();
    }catch{if(version===feedGeneration&&feed.open)feedStatus.textContent='Published edits are temporarily unavailable.';}
  }
  feed.addEventListener('toggle',()=>{clearInterval(timer);if(feed.open){refreshFeed();timer=setInterval(()=>{if(document.visibilityState==='visible')refreshFeed();},30000);}else feedGeneration++;});
  window.addEventListener('pagehide',()=>{clearInterval(timer);feedGeneration++;});
})();
