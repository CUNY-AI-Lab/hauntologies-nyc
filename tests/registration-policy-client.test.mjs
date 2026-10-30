import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/registration-policy.js',import.meta.url),'utf8');
class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.hidden=false;this.disabled=false;this.required=false;this.value='';this.attributes=new Map();this.listeners=new Map();}
  append(...nodes){this.children.push(...nodes);}
  after(node){this.inserted=node;}
  addEventListener(name,handler){this.listeners.set(name,handler);}
  dispatch(name){this.listeners.get(name)?.();}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  removeAttribute(name){this.attributes.delete(name);}
  focus(){this.focused=true;}
}
function fixture({restricted=true,deferred=false}={}){
  const values=new Map(),sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
  const window={},email=new Element('input'),form=new Element('form');email.id='registrationEmail';
  vm.runInNewContext(source,{document:{createElement:tag=>new Element(tag)},window,sessionStorage,fetch:async()=>({ok:true,json:async()=>({restricted})}),AbortController,setTimeout,clearTimeout});
  const admission=window.HauntologiesAdmission.attach({form,email,anchor:email,deferred});
  const group=email.inserted,[hint,label]=group.children,[input]=label.children;
  return {window,email,group,hint,label,input,admission};
}

test('access code remains visible with an empty, CUNY or guest email',async()=>{
  const f=fixture();
  assert.equal(f.group.hidden,false,'visible before the policy response');
  assert.equal(f.label.textContent,'Access code (optional)');
  await f.admission.ready;
  for(const [email,required] of [['',false],['person@gc.cuny.edu',false],['guest@example.test',true]]){
    f.email.value=email;f.email.dispatch('input');
    assert.equal(f.group.hidden,false,email);assert.equal(f.label.hidden,false,email);assert.equal(f.input.disabled,false,email);
    assert.equal(f.input.required,required,email);
  }
  assert.match(f.hint.textContent,/Guests need an access code/);
});

test('a code entered before the email is preserved and submitted',async()=>{
  const f=fixture();await f.admission.ready;
  f.input.value='SYNTHETIC-CODE';
  for(const email of ['','person@cuny.edu','guest@example.test']){
    f.email.value=email;f.email.dispatch('input');
    assert.equal(f.input.value,'SYNTHETIC-CODE');
    assert.equal(f.admission.payload().access_code,'SYNTHETIC-CODE');
  }
  f.admission.clear();assert.equal(f.input.value,'');assert.equal(Object.keys(f.admission.payload()).length,0);
});

test('the field remains available when policy is open or a pending retry is restored',async()=>{
  for(const options of [{restricted:false},{restricted:true,deferred:true}]){
    const f=fixture(options);await f.admission.ready;f.email.value='guest@example.test';f.email.dispatch('input');
    assert.equal(f.group.hidden,false);assert.equal(f.input.disabled,false);assert.equal(f.input.required,false);
    f.admission.reject();assert.equal(f.input.required,true);assert.equal(f.input.focused,true);
  }
});
