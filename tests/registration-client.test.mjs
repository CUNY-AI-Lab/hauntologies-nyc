import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=readFileSync(new URL('../public/registration.js',import.meta.url),'utf8');
const eventId='hauntologies-2026-10-30',receiptId='12345678-1234-4234-8234-123456789012';
const receiptKey='hauntologies-registration-receipt',pendingKey='hauntologies-registration-pending';
const storage=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};};
class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.hidden=false;this.value='';this.listeners=new Map();this.attrs={};this.textContent='';}
  addEventListener(name,handler){const handlers=this.listeners.get(name)||[];handlers.push(handler);this.listeners.set(name,handlers);}
  async emit(name){for(const handler of this.listeners.get(name)||[])await handler({preventDefault(){}});}
  setAttribute(key,value){this.attrs[key]=value;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  reportValidity(){return !!this.valid;}
  focus(){this.focused=true;}
}
function fixture({local=storage(),session=storage(),fetch}={}){
  const elements=new Map(['registrationForm','registrationName','registrationEmail','submitRegistration','registrationStatus','registrationError','registrationReceipt','registerButton'].map(id=>[id,new Element()]));
  elements.get('registrationForm').valid=true;
  const window={events:[],dispatchEvent(event){this.events.push(event.type);}};
  vm.runInNewContext(source,{document:{getElementById:id=>elements.get(id)||null,createElement:tag=>new Element(tag)},window,localStorage:local,sessionStorage:session,crypto:webcrypto,TextEncoder,AbortController,setTimeout,clearTimeout,fetch,CustomEvent:class{constructor(type){this.type=type;}}});
  return{local,session,window,get:id=>elements.get(id),async submit(name='Synthetic Guest',email='Guest@example.test'){elements.get('registrationName').value=name;elements.get('registrationEmail').value=email;await elements.get('registrationForm').emit('submit');}};
}
const success=()=>Response.json({ok:true,receipt_id:receiptId,event:{id:eventId}},{status:201});

test('only a confirmed event receipt persists Registration state without identity or PII',async()=>{
  const f=fixture({fetch:async()=>success()});await f.submit();
  assert.deepEqual(JSON.parse(f.local.getItem(receiptKey)),{event_id:eventId,receipt_id:receiptId});
  assert.equal(f.session.getItem(pendingKey),null);
  assert.equal(f.get('registerButton').textContent,'Registration');
  assert.equal(f.get('registrationForm').hidden,true);
  assert.equal(f.get('registrationName').value,'');assert.equal(f.get('registrationEmail').value,'');
  assert.deepEqual(f.window.events,['registration-confirmed']);
  const next=fixture({local:f.local,session:f.session,fetch:()=>{throw Error('No automatic request expected');}});
  assert.equal(next.get('registerButton').textContent,'Registration');
  assert.equal(next.get('registrationForm').hidden,true);
  assert.equal(next.get('registrationReceipt').children.at(-1).href,'/');
});

test('uncertain registration reload reuses the key for exactly the server-normalized payload',async()=>{
  const writes=[];const first=fixture({fetch:async(path,options)=>{writes.push(options);return Response.json({error:'registration_unavailable'},{status:503});}});
  await first.submit(' Synthetic Guest ','Guest@EXAMPLE.TEST');
  const pending=JSON.parse(first.session.getItem(pendingKey));
  assert.deepEqual(Object.keys(pending).sort(),['event_id','key','payload_hash']);
  assert.match(pending.payload_hash,/^[a-f0-9]{64}$/);assert.equal(first.local.getItem(receiptKey),null);
  assert.equal(JSON.stringify([...first.session.values]).includes('Synthetic'),false);
  assert.equal(JSON.stringify([...first.session.values]).includes('Guest@'),false);
  const second=fixture({local:first.local,session:first.session,fetch:async(path,options)=>{writes.push(options);return success();}});
  assert.match(second.get('registrationError').textContent,/outcome unknown/);
  await second.submit('Synthetic Guest','Guest@example.test');
  assert.equal(writes.length,2);assert.equal(writes[0].headers['Idempotency-Key'],writes[1].headers['Idempotency-Key']);
  assert.equal(second.session.getItem(pendingKey),null);
});

test('a changed payload cannot replace an uncertain registration after reload',async()=>{
  const first=fixture({fetch:async()=>{throw Error('network');}});await first.submit();
  const journal=first.session.getItem(pendingKey);let writes=0;
  const second=fixture({local:first.local,session:first.session,fetch:async()=>{writes++;return success();}});
  await second.submit('Different Guest','Guest@example.test');
  assert.equal(writes,0);assert.equal(second.session.getItem(pendingKey),journal);
  assert.equal(second.get('registrationError').textContent,'Enter the same name and email to retry this registration');
  assert.equal(second.get('registrationForm').hidden,false);
});

test('receipt-shaped success with missing or wrong event data remains uncertain',async()=>{
  for(const body of [{ok:true},{ok:true,receipt_id:receiptId,event:{id:'other-event'}},{ok:true,receipt_id:'not-a-receipt',event:{id:eventId}}]){
    const f=fixture({fetch:async()=>Response.json(body)});await f.submit();
    assert.equal(f.local.getItem(receiptKey),null);assert.ok(f.session.getItem(pendingKey));
    assert.equal(f.get('registrationForm').hidden,false);assert.match(f.get('registrationError').textContent,/outcome unknown/);
  }
});

test('definitive rejection clears pending key and allows correction',async()=>{
  const f=fixture({fetch:async()=>Response.json({ok:false,error:'invalid_email'},{status:400})});await f.submit();
  assert.equal(f.session.getItem(pendingKey),null);assert.equal(f.local.getItem(receiptKey),null);
  assert.equal(f.get('registrationEmail').readOnly,false);assert.equal(f.get('registrationError').textContent,'Enter a valid email address');
});

test('older-event or malformed local state never infers current registration',()=>{
  for(const value of [{event_id:'old-event',receipt_id:receiptId},{event_id:eventId,receipt_id:'invalid'},null]){
    const local=storage();local.setItem(receiptKey,JSON.stringify(value));const f=fixture({local});
    assert.equal(f.get('registrationForm').hidden,false);assert.equal(f.window.HauntologiesRegistration.receipt(),null);
  }
});

test('a map without registration controls can read its receipt without creating an identity',()=>{
  const local=storage(),session=storage(),window={};local.setItem(receiptKey,JSON.stringify({event_id:eventId,receipt_id:receiptId}));
  vm.runInNewContext(source,{document:{getElementById:()=>null},window,localStorage:local,sessionStorage:session});
  assert.equal(window.HauntologiesRegistration.receipt().receipt_id,receiptId);
  assert.deepEqual(Object.keys(window),['HauntologiesRegistration']);assert.equal(session.values.size,0);
});
