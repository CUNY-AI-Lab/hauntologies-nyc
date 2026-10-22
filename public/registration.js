'use strict';
(() => {
  const byId=id=>document.getElementById(id);
  const dialog=byId('registrationDialog'),form=byId('registrationForm');
  const name=byId('registrationName'),email=byId('registrationEmail'),submit=byId('submitRegistration');
  const status=byId('registrationStatus'),error=byId('registrationError'),receipt=byId('registrationReceipt');
  if(!form||!name||!email||!submit||!status||!error||!receipt)return;
  const registerButton=byId('registerButton');
  let request=null,busy=false,registered=false,opener=null;

  function message(node,value){node.textContent=value;node.hidden=!value;}
  function lock(){submit.disabled=busy;name.readOnly=email.readOnly=busy||!!request;form.setAttribute('aria-busy',String(busy));}
  function showError(value){message(error,value);if(!dialog||dialog.open)error.focus();}
  const errors={
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
      const target=opener?.isConnected&&opener.getClientRects().length?opener:registerButton;
      target.focus({preventScroll:true});
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
    if(!request){
      if(!form.reportValidity())return;
      request={key:crypto.randomUUID(),body:JSON.stringify({name:name.value,email:email.value})};
    }
    const exact=request;busy=true;lock();message(error,'');message(status,'Saving…');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':exact.key},body:exact.body,signal:controller.signal});
      let data;try{data=await response.json();}catch{throw new Error('unreadable_response');}
      if(!response.ok){
        if(response.status>=500)throw new Error('registration_unavailable');
        request=null;
        showError(errors[data?.error]||(response.status===401?'Registration is unavailable':'Registration was not saved. Please try again'));
        return;
      }
      if(data?.ok!==true||typeof data.receipt_id!=='string'||!data.receipt_id.trim()||data.event?.id!=='hauntologies-2026-10-30')throw new Error('missing_receipt');
      registered=true;request=null;form.hidden=true;receipt.replaceChildren();
      const heading=document.createElement(dialog?'h3':'h2');heading.textContent='Registered';
      const saved=document.createElement('p');saved.textContent='Receipt: '+data.receipt_id;
      receipt.append(heading,saved);receipt.hidden=false;if(!dialog||dialog.open)receipt.focus();
    }catch{
      // A missing response cannot establish whether the write committed.
      request=exact;showError('Save outcome unknown. Select Register to retry');
    }finally{clearTimeout(timeout);busy=false;message(status,'');lock();}
  });
})();
