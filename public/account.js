'use strict';
(() => {
  const byId=id=>document.getElementById(id),dialog=byId('accountDialog'),trigger=byId('accountButton');
  if(!dialog||!trigger)return;
  const status=byId('accountStatus'),actions=byId('accountActions'),list=byId('accountContributions'),registration=byId('accountRegistration');
  if(!status||!actions||!list||!registration)return;
  let generation=0,opener=null,controller=null,signedIn=false,readiness=null,checking=false;
  const idValid=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(id);
  const actorValid=value=>typeof value?.actor_id==='string'&&value.actor_id.length>0&&value.actor_id.length<=200;
  const node=(tag,value)=>{const result=document.createElement(tag);if(value!==undefined)result.textContent=value;return result;};
  const labels={draft:'Draft',submitted:'Pending review',changes_requested:'Changes requested',approved:'Approved',merged:'Published',withheld:'Withheld'};
  function clear(){list.replaceChildren();actions.replaceChildren();}
  function identity(value,pending=false){
    signedIn=value;checking=pending;trigger.disabled=pending;trigger.textContent=pending?'…':value?'Account':'Sign in';
    trigger.setAttribute('aria-label',pending?'Checking sign-in':value?'Account':'Sign in');
    byId('accountTitle').textContent=value?'Account':'Sign in';
    if(byId('accountRegistrationSection'))byId('accountRegistrationSection').hidden=!value;
    if(byId('accountSignInHelp'))byId('accountSignInHelp').hidden=value;
    const saved=window.HauntologiesRegistration?.receipt();registration.textContent=saved?'Receipt: '+saved.receipt_id:'No receipt saved in this browser';
    if(byId('accountEventLink'))byId('accountEventLink').hidden=!!saved;
  }
  function button(label,action){const result=node('button',label);result.type='button';result.className='outline';result.addEventListener('click',action);actions.append(result);return result;}
  function retry(label='Retry'){button(label,()=>reconcile());}
  async function read(path,signal){
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal});
    if(!response.ok)throw Object.assign(new Error('unavailable'),{status:response.status});
    return response.json();
  }
  function signIn(message='Sign in to view your contributions'){
    status.textContent=message;
    if(readiness?.enabled===true&&readiness.sign_in_url==='/api/contributions/sign-in'){
      const link=node('a','Sign in');link.href=readiness.sign_in_url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
    }
    if(readiness?.enabled!==false)retry();
  }
  function authenticatedActions(){retry('Refresh');if(readiness?.dashboard_enabled===true)button('Sign out',logout);}
  function render(items){
    const own=items.filter(item=>item?.is_own===true&&idValid(item.id)).slice(0,100);
    status.textContent=own.length?'':'No contributions yet';
    for(const item of own){
      const row=node('li'),link=node('a',typeof item.title==='string'&&item.title?item.title:item.id);link.href='#submissionDetail';
      link.addEventListener('click',event=>{
        event.preventDefault();dialog.close();
        window.dispatchEvent(new CustomEvent('contributions-review-requested',{detail:{submissionId:item.id}}));
      });
      const state=node('p','Status: '+(labels[item.status]||'Unknown')),updated=node('p','Updated: '),date=new Date(item.updated_at);
      if(typeof item.updated_at==='string'&&Number.isFinite(date.getTime())){const time=node('time',date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}));time.dateTime=date.toISOString();updated.append(time);}else updated.append(document.createTextNode('Unknown'));
      row.append(link,state,updated);list.append(row);
    }
    if(items.length>=100)status.textContent='Showing recent contributions';
    authenticatedActions();
  }
  async function reconcile(){
    const version=++generation;controller?.abort();controller=new AbortController();
    const active=controller,timeout=setTimeout(()=>active.abort(),20000);clear();identity(false,true);if(dialog.open)status.textContent='Loading…';
    let verifiedActor=null;
    try{
      readiness=await read('/api/access-status',active.signal);
      if(version!==generation)return;
      if(readiness.enabled!==true){identity(false);window.dispatchEvent(new CustomEvent('contributions-session-ended',{detail:{disabled:readiness.enabled===false}}));if(dialog.open)signIn(readiness.enabled===false?'Sign-in is not enabled yet':'Contributions unavailable');return;}
      const path=readiness.dashboard_enabled===true?'/auth/session':'/api/contributions/session';
      const session=await read(path,active.signal);
      if(!actorValid(session))throw new Error('invalid_session');
      verifiedActor=session.actor_id;
      if(version!==generation)return;
      identity(true);
      if(!dialog.open)return;
      const privateSession=path==='/api/contributions/session'?session:await read('/api/contributions/session',active.signal);
      if(privateSession?.actor_id!==verifiedActor){verifiedActor=null;throw new Error('session_changed');}
      const data=await read('/api/contributions/dashboard',active.signal);
      const current=await read(path,active.signal);
      if(current?.actor_id!==verifiedActor){verifiedActor=null;throw new Error('session_changed');}
      if(!Array.isArray(data?.submissions))throw new Error('invalid_list');
      if(version!==generation||!dialog.open)return;
      render(data.submissions);
    }catch(error){
      if(version!==generation)return;
      if(error.status===401)verifiedActor=null;
      clear();identity(!!verifiedActor);
      if(!verifiedActor)window.dispatchEvent(new CustomEvent('contributions-session-ended'));
      if(!dialog.open)return;
      if(!verifiedActor&&error.status===401)signIn();
      else if(verifiedActor){status.textContent=error.status===403?'Contributions unavailable for this account':'Contributions unavailable';authenticatedActions();}
      else signIn('Sign-in unavailable');
    }finally{clearTimeout(timeout);}
  }
  async function logout(){
    const version=++generation;controller?.abort();controller=new AbortController();const active=controller,timeout=setTimeout(()=>active.abort(),20000);
    clear();identity(false,true);status.textContent='Signing out…';window.dispatchEvent(new CustomEvent('contributions-session-ended'));
    try{
      const response=await fetch('/auth/logout',{method:'POST',credentials:'same-origin',cache:'no-store',signal:active.signal});
      if(response.status!==204)throw new Error('unconfirmed');
      if(version!==generation)return;identity(false);signIn('Signed out');
    }catch{if(version===generation){identity(false);signIn('Sign-out not confirmed');}}
    finally{clearTimeout(timeout);}
  }
  function open(){
    opener=document.activeElement;if(typeof closeTools==='function')closeTools();
    if(!dialog.open)dialog.showModal();byId('closeAccount')?.focus();reconcile();
  }
  trigger.addEventListener('click',open);window.addEventListener('account-open-requested',open);
  byId('closeAccount')?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{
    generation++;controller?.abort();clear();status.textContent='';identity(signedIn);
    const target=opener?.isConnected&&opener.getClientRects().length?opener:trigger;target.focus({preventScroll:true});
  });
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll('button:not([disabled]),a[href],summary,[tabindex="0"]')].filter(item=>item.getClientRects().length&&!item.closest('[hidden]'));
    const first=controls[0],last=controls.at(-1),active=document.activeElement;if(!first)return;
    if(event.shiftKey&&(active===first||!controls.includes(active))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(active===last||!controls.includes(active))){event.preventDefault();first.focus();}
  });
  window.addEventListener('registration-confirmed',()=>identity(signedIn,checking));
  window.addEventListener('focus',()=>{if(!checking)reconcile();});
  window.addEventListener('pageshow',()=>{if(!checking)reconcile();});
  window.addEventListener('pagehide',()=>{generation++;controller?.abort();clear();identity(false);});
  reconcile();
})();
