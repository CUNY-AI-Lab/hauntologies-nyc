'use strict';
(() => {
  const byId=id=>document.getElementById(id),dialog=byId('ownEditsDialog');
  if(!dialog)return;
  const list=byId('ownEditsList'),status=byId('ownEditsStatus'),back=byId('returnToEdits');
  const labels={draft:'Draft',submitted:'Saved privately',changes_requested:'Saved privately · needs changes',approved:'Saved privately',published:'Published',merged:'Published',revoked:'Revoked · visible only to you',withheld:'Withdrawn'};
  const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const button=(label,action)=>{const el=node('button',label);el.type='button';el.className='outline';el.addEventListener('click',action);return el;};
  const date=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  let page=1,totalPages=1,loaded=false,generation=0,scroll=0,returnFocus=null,actor=null;
  async function request(path,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});return{response,data:await response.json()};}finally{clearTimeout(timer);}}
  async function get(path){const account=window.HauntologiesAccount?.snapshot();const {response,data}=await request(path);if(response.status===401)window.HauntologiesAccount?.invalidate(account);if(!response.ok)throw new Error(response.status===401?'Sign in to view your edits.':'Edits are temporarily unavailable.');return data;}
  const requests=new Map();
  async function post(path,body,expectedActor){
    let response,data;try{({response,data}=await request(path,{method:'POST',headers:{'content-type':'application/json','X-Hauntologies-Actor':expectedActor},body:JSON.stringify(body)}));}catch{throw new Error('Save outcome unknown. Retry this action to confirm it.');}
    if(!response.ok){const messages={unsupported_direct_type:'This saved format cannot be published directly. Use its text in a new place or note, or Edit an existing place.',public_moniker_required:'Choose a public username, not an email address.',change_summary_required:'Briefly describe your change.',stale_target:'This place changed. Open its current record before publishing.',revocation_dependency_conflict:'Another release depends on this contribution. It cannot be revoked without changing that work.',deletion_dependency_conflict:'Another release retains this contribution in its history. Deletion is blocked to protect that work.',published_record_cannot_be_deleted:'Revoke the published contribution before deleting it.'};throw new Error(messages[data.error]||(response.status===401?'Sign in to change your edits.':response.status===409?'This edit changed. Reopen My edits before trying again.':'That edit could not be changed right now.'));}
    const action=path.split('/').pop(),result=data.receipt?.result;
    if(action==='publish'&&result?.published!==true||data.receipt?.action!==action||typeof data.receipt.id!=='string'||(action==='delete'?result?.deleted_submission_id:result?.submission_id)!==body.submission_id||result?.revision!==(action==='publish'?body.expected_revision+1:body.expected_revision))throw new Error('Save outcome unknown. Retry this action to confirm it.');
    return data;
  }
  async function change(item,control,action){
    const account=window.HauntologiesAccount?.snapshot(),owner=actor,version=generation;
    const current=()=>version===generation&&owner===actor&&owner===account?.actor&&window.HauntologiesAccount?.isCurrent(account);
    if(!current())return;
    const question=action==='revoke'?'Revoke "'+(item.title||'this contribution')+'"? Its published changes will be removed from the map. Your private contribution remains; deletion is a separate step.':'Delete "'+(item.title||'this contribution')+'"? Its saved content will be gone for good.';
    if(!window.confirm(question)||!current())return;
    const requestKey=[owner,action,item.id,item.revision].join(':');
    if(!requests.has(requestKey))requests.set(requestKey,{idempotency_key:crypto.randomUUID(),submission_id:item.id,expected_revision:item.revision});
    control.disabled=true;status.textContent=action==='revoke'?'Revoking…':'Deleting…';
    try{
      await post('/api/contributions/'+action,requests.get(requestKey),owner);
      if(!current())return;
      requests.delete(requestKey);
      window.dispatchEvent(new CustomEvent('contributions-edit-deleted',{detail:{submissionId:item.id,actor:owner}}));
      window.dispatchEvent(new CustomEvent('contributions-records-changed'));
      await load(page);
    }catch(error){if(!current())return;status.textContent=error.message;control.disabled=false;}
  }
  async function identity(){const value=await get('/api/auth/session');if(value.password_required||typeof value.actor_id!=='string')throw new Error('Sign in to view your edits.');return value.actor_id;}
  function leave(action,focus){scroll=dialog.scrollTop;returnFocus=focus;dialog.close();back.hidden=false;action();}
  function showItem(item){
    const row=node('li'),title=button(item.title||'Edit',()=>leave(()=>window.dispatchEvent(new CustomEvent('contributions-review-requested',{detail:{submissionId:item.id}})),title));title.className='edit-title';row.append(title,node('p',(labels[item.status]||'Saved')+' · '+date(item.updated_at)));
    if(item.can_revoke){const revoke=button('Revoke',()=>change(item,revoke,'revoke'));revoke.setAttribute('aria-label','Revoke '+(item.title||'contribution'));row.append(revoke);}
    if(item.can_delete){const del=button('Delete',()=>change(item,del,'delete'));del.className='textbutton edit-delete';del.setAttribute('aria-label','Delete '+(item.title||'edit'));row.append(del);}
    if(item.publication_note)row.append(node('p',item.publication_note));
    if(item.can_publish){const publish=button('Publish',()=>publishSaved(row,item));row.append(publish);}
    const targets=node('div');targets.className='edit-targets';
    for(const target of item.targets||[]){const open=button(target.title||'View place',()=>leave(()=>window.dispatchEvent(new CustomEvent('edits-place-requested',{detail:{recordId:target.record_id}})),open));open.setAttribute('aria-label','Show '+(target.title||'place')+' on map');targets.append(open);}
    row.append(targets);return row;
  }
  async function publishSaved(row,item){
    if(row.querySelector('form'))return;
    const account=window.HauntologiesAccount.snapshot(),version=generation,current=()=>version===generation&&window.HauntologiesAccount.isCurrent(account);
    const form=node('form'),name=node('input'),summary=node('input'),send=button('Publish',()=>{}),notice=node('p');send.type='submit';name.maxLength=120;summary.maxLength=2000;name.required=summary.required=true;
    try{name.value=JSON.parse(localStorage.getItem('hauntologies-public-moniker:'+account.actor)||'null')?.label||'';}catch{}
    for(const [label,input] of [['Public username',name],['Describe your change',summary]]){const l=node('label',label);l.append(input);form.append(l);}form.append(send,button('Cancel',()=>form.remove()),notice);row.append(form);let pending=null;
    send.disabled=true;
    try{
      const {submission}=await get('/api/contributions/submission?id='+encodeURIComponent(item.id));if(!current()||!form.isConnected)return;
      if(!name.value&&submission.public_credit?.identity==='moniker')name.value=submission.public_credit.label||'';
      for(const [index,ref] of (submission.attachments||[]).entries()){
        const label=node('label'),choice=node('input');choice.type='checkbox';choice.dataset.publicImageId=ref.attachment_id;
        const rights=ref.metadata?.rights||'';choice.disabled=!rights.trim()||/^(unknown|unspecified|unresolved|not known|n\/a)$/i.test(rights.trim());
        label.append(choice,document.createTextNode(' Publish image '+(index+1)+(choice.disabled?' — rights unknown':' · '+rights)));form.insertBefore(label,send);
      }
      send.disabled=false;
    }catch{if(current())notice.textContent='Saved images could not be checked. Close this form and try again.';return;}
    form.addEventListener('submit',async event=>{event.preventDefault();if(!current())return;pending||={idempotency_key:crypto.randomUUID(),submission_id:item.id,expected_revision:item.revision,moniker:name.value,change_summary:summary.value,public_image_ids:[...form.querySelectorAll('[data-public-image-id]:checked')].map(input=>input.dataset.publicImageId)};send.disabled=true;notice.textContent='Publishing…';try{await post('/api/contributions/publish',pending,account.actor);if(!current())return;window.dispatchEvent(new CustomEvent('contributions-records-changed'));await load(page);}catch(error){if(current()){notice.textContent=error.message;send.disabled=false;send.textContent='Retry / confirm';}}});
  }
  function controls(){byId('previousEdits').disabled=page<=1;byId('nextEdits').disabled=page>=totalPages;byId('editsPage').textContent='Page '+page+' of '+totalPages;}
  async function load(next){const version=++generation;status.textContent='Loading…';byId('previousEdits').disabled=true;byId('nextEdits').disabled=true;
    try{const expectedActor=actor,data=await get('/api/contributions/edits?page='+next),currentActor=await identity();if(version!==generation)return;if(currentActor!==expectedActor){clear();return;}page=data.page;totalPages=data.total_pages;
      if(page>totalPages){await load(totalPages);return;}
      list.replaceChildren(...data.items.map(showItem));status.textContent=data.total+' '+(data.total===1?'edit':'edits');loaded=true;scroll=0;dialog.scrollTop=0;controls();
    }catch(error){if(version!==generation)return;list.replaceChildren();status.textContent=error.message;loaded=false;controls();}
  }
  async function open(restore=false){const account=window.HauntologiesAccount?.snapshot();if(!window.HauntologiesAccount?.isCurrent(account))return;const version=generation;if(byId('accountDialog').open)byId('accountDialog').close();
    try{const currentActor=await identity();if(version!==generation||!window.HauntologiesAccount.isCurrent(account)||currentActor!==account.actor)return;if(actor!==currentActor){clear();actor=currentActor;}if(!dialog.open)dialog.showModal();back.hidden=true;
      if(restore&&loaded){dialog.scrollTop=scroll;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}else load(restore?page:1);
    }catch(error){if(version!==generation||!window.HauntologiesAccount.isCurrent(account))return;clear();status.textContent=error.message;}
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
      const rows=data.items.map(item=>{const row=node('li');for(const target of item.targets){row.append(button(target.title||'View place',()=>{setFeed(false);window.dispatchEvent(new CustomEvent('edits-place-requested',{detail:{recordId:target.record_id}}));}));}row.append(node('p',date(item.published_at)+(item.credit?' · '+item.credit:'')));return row;});
      // A list that arrives after the card unfolds grows in the same motion.
      const fill=()=>feedList.replaceChildren(...rows);window.HauntologiesDisclosure?window.HauntologiesDisclosure.resize(feed,fill):fill();
    }catch{if(version===feedGeneration&&feed.open)feedStatus.textContent='Published edits are temporarily unavailable.';}
  }
  feed.addEventListener('toggle',()=>{clearInterval(timer);if(feed.open){refreshFeed();timer=setInterval(()=>{if(document.visibilityState==='visible')refreshFeed();},30000);}else feedGeneration++;});
  window.addEventListener('pagehide',()=>{clearInterval(timer);feedGeneration++;});
})();
