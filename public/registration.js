'use strict';
(() => {
  const byId=id=>document.getElementById(id);
  const dialog=byId('registrationDialog'),form=byId('registrationForm');
  const name=byId('registrationName'),email=byId('registrationEmail'),submit=byId('submitRegistration');
  const status=byId('registrationStatus'),error=byId('registrationError'),receipt=byId('registrationReceipt');
  const registerButton=byId('registerButton');
  const eventId='hauntologies-2026-10-30',receiptKey='hauntologies-registration-receipt',pendingKey='hauntologies-registration-pending';
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  function readReceipt(){try{const value=JSON.parse(localStorage.getItem(receiptKey)||'null');return value?.event_id===eventId&&uuid(value.receipt_id)?{event_id:eventId,receipt_id:value.receipt_id}:null;}catch{return null;}}
  function readPending(){try{const value=JSON.parse(sessionStorage.getItem(pendingKey)||'null');return value?.event_id===eventId&&uuid(value.key)&&/^[a-f0-9]{64}$/.test(value.payload_hash)?value:null;}catch{return null;}}
  let savedReceipt=readReceipt(),pending=readPending(),request=null,busy=false,registered=!!savedReceipt,opener=null;
  window.HauntologiesRegistration=Object.freeze({receipt:()=>savedReceipt?{...savedReceipt}:readReceipt()});
  if(!form||!name||!email||!submit||!status||!error||!receipt)return;

  const admission=window.HauntologiesAdmission?.attach({form,email,anchor:email,deferred:!!pending});
  async function payloadHash(value){
    const address=value.email.trim(),at=address.lastIndexOf('@');
    const normalized={name:value.name.trim(),email:address.slice(0,at)+address.slice(at).toLowerCase()};
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(normalized)));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function retainPending(value){sessionStorage.setItem(pendingKey,JSON.stringify(value));pending=value;}
  function clearPending(){pending=null;try{sessionStorage.removeItem(pendingKey);}catch{}}
  function renderReceipt(){
    registered=true;form.hidden=true;name.value=email.value='';admission?.clear();receipt.replaceChildren();
    const heading=document.createElement(dialog?'h3':'h2');heading.textContent='Registered';
    const saved=document.createElement('p');saved.textContent='Receipt: '+savedReceipt.receipt_id;receipt.append(heading,saved);
    if(!dialog){const map=document.createElement('a');map.href='/';map.textContent='View map';receipt.append(map);}
    receipt.hidden=false;
    if(registerButton){registerButton.textContent='Registration';registerButton.setAttribute('aria-controls','registrationDialog');}
  }

  function message(node,value){node.textContent=value;node.hidden=!value;}
  function lock(){submit.disabled=busy;name.readOnly=email.readOnly=busy||!!request;admission?.lock(busy||!!request);form.setAttribute('aria-busy',String(busy));}
  function showError(value){message(error,value);if(!dialog||dialog.open)error.focus();}
  const errors={
    registration_restricted:'Please use your CUNY email address. Guests can enter an access code below.',
    invalid_name:'Enter a name of 120 characters or fewer',
    invalid_email:'Enter a valid email address',
    rate_limited:'Too many attempts. Please try again later',
    origin_not_allowed:'Registration is unavailable from this page',
    idempotency_conflict:'Registration could not be confirmed. Please try again',
    body_too_large:'Name or email is too long',
    invalid_request:'Check your name and email'
  };

  if(dialog&&registerButton){
    registerButton.addEventListener('click',()=>{
      opener=document.activeElement;
      if(typeof closeTools==='function')closeTools();
      if(!dialog.open)dialog.showModal();
      (registered?receipt:request?submit:name).focus();
    });
    byId('closeRegistration')?.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{
      const target=opener?.isConnected&&opener.getClientRects().length?opener:registerButton.getClientRects().length?registerButton:byId('toolsButton');
      target?.focus({preventScroll:true});
    });
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const controls=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')].filter(node=>node.getClientRects().length);
      if(!controls.length)return;
      const first=controls[0],last=controls.at(-1),active=document.activeElement;
      if(event.shiftKey&&(active===first||!controls.includes(active))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(active===last||!controls.includes(active))){event.preventDefault();first.focus();}
    });
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||registered)return;
    await admission?.ready;if(busy||registered)return;
    if(!request&&!form.reportValidity())return;
    busy=true;lock();message(error,'');message(status,'Saving…');
    if(!request){
      try{
        const body={name:name.value,email:email.value,...admission?.payload()},hash=await payloadHash(body);
        if(pending&&pending.payload_hash!==hash){showError('Enter the same name and email to retry this registration');busy=false;lock();message(status,'');return;}
        const key=pending?.key||crypto.randomUUID();
        retainPending({event_id:eventId,key,payload_hash:hash});request={key,body:JSON.stringify(body)};
      }catch{busy=false;lock();message(status,'');showError('Registration is unavailable in this browser');return;}
    }
    const exact=request;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':exact.key},body:exact.body,signal:controller.signal});
      let data;try{data=await response.json();}catch{throw new Error('unreadable_response');}
      if(!response.ok){
        if(response.status>=500)throw new Error('registration_unavailable');
        request=null;clearPending();
        showError(errors[data?.error]||(response.status===401?'Registration is unavailable':'Registration was not saved. Please try again'));
        if(data?.error==='registration_restricted')admission?.reject();
        return;
      }
      if(data?.ok!==true||!uuid(data.receipt_id)||data.event?.id!==eventId)throw new Error('missing_receipt');
      savedReceipt={event_id:eventId,receipt_id:data.receipt_id};
      try{localStorage.setItem(receiptKey,JSON.stringify(savedReceipt));}catch{}
      request=null;clearPending();renderReceipt();window.dispatchEvent(new CustomEvent('registration-confirmed'));
      if(!dialog||dialog.open)receipt.focus();
    }catch{
      // A missing response cannot establish whether the write committed.
      request=exact;showError('Save outcome unknown. Select Register to retry');
    }finally{clearTimeout(timeout);busy=false;message(status,'');lock();}
  });
  if(savedReceipt){clearPending();renderReceipt();}
  else if(pending)message(error,'Registration outcome unknown. Enter the same name and email to retry');
})();
