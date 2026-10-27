import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
class Node {
 constructor(tag,text=''){this.tag=tag;this.text=text??'';this.children=[];this.attributes={};this.listeners={};this.dataset={};this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.isConnected=true;}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value;}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=value;}
 closest(selector){for(let node=this;node;node=node.parent)if(selector==='dialog'&&node.tag==='dialog'||selector==='.workflow-jobs'&&node.className==='workflow-jobs')return node;return null;}
 addEventListener(type,fn){this.listeners[type]=fn;}
 focus(){}
 close(){this.closed=true;}
 get textContent(){return this.text+this.children.map(x=>x.textContent).join(' ');}
 set textContent(value){this.text=value;this.children=[];}
}
const walk=node=>[node,...node.children.flatMap(walk)];
function setup(){
 const nodes={applicationJobs:new Node('div')},section=new Node('section');section.className='workflow-jobs';section.append(nodes.applicationJobs);
 const calls=[],events=[],listeners={};let sequence=0;
 const caps={can_review:true,can_apply:true,independent_review_available:true,is_admin:false,can_triage:true};
 const context=vm.createContext({dashboard:{jobs:[],submissions:[]},selectedSubmission:null,
  caps:()=>caps,byId:id=>nodes[id],el:(tag,text,cls)=>{const n=new Node(tag,text);n.className=cls;return n;},
  button:(text,action,cls)=>{const n=new Node('button',text);n.className=cls;n.listeners.click=action;return n;},
  document:{createTextNode:text=>new Node('#text',text)},metadata:()=>new Node('dl'),rawDisclosure:()=>new Node('details','Receipt'),statusLabel:s=>s,
  window:{HauntologiesAccount:{snapshot:()=>({actor:'peer',generation:1}),canContribute:()=>true,isCurrent:value=>value?.actor==='peer'&&value.generation===1},addEventListener:(type,fn)=>{listeners[type]=fn;},dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  crypto:{randomUUID:()=> 'synthetic-'+ ++sequence},loadDashboard:async()=>{},loadSubmission:async()=>{},
  safeMutation:async(path,body)=>{calls.push({path,body});return path==='/apply'?{job:{id:'job',submission_id:'s',status:'verification_pending',can_verify:true}}:path==='/verify'?{job:{status:'verified'}}:{submission:{}};}
 });
 const render=source.slice(source.indexOf('  function renderJobs(){'),source.indexOf('  function showReconciliation('));
 const controls=source.slice(source.indexOf('  const reviewKeys='),source.indexOf("  document.querySelectorAll('[data-workflow-view]')",source.indexOf('  const reviewKeys=')));
 vm.runInContext(render+controls+';globalThis.ui={renderJobs,renderReviewControls,jobControls};',context);
 return{context,caps,nodes,section,calls,events,listeners,ui:context.ui};
}
const approved={id:'s',title:'Synthetic place',revision:1,status:'approved',is_own:false,approval:{independent:true,revision:1,approval_hash:'synthetic'},application:{applicable:true}};
test('ordinary eligible participant sees Verify jobs; author-only jobs remain hidden',()=>{
 const h=setup();h.context.dashboard.jobs=[{id:'eligible',submission_id:'s',status:'verification_pending',can_verify:true},{id:'own',status:'verification_pending',can_verify:false}];h.context.dashboard.submissions=[approved];h.ui.renderJobs();
 assert.equal(h.section.hidden,false);assert.equal(h.nodes.applicationJobs.children.length,1);assert.equal(walk(h.nodes.applicationJobs).filter(n=>n.tag==='button'&&n.text==='Verify').length,1);
});
test('no admin exception exposes a self-review or self-verification button',()=>{
 const h=setup();h.caps.is_admin=true;h.caps.can_self_approve=true;
 for(const status of ['submitted','approved']){const root=new Node('section');h.ui.renderReviewControls(root,{...approved,status,is_own:true,validation:{valid:true}});assert.equal(walk(root).filter(n=>n.tag==='button').length,0);}
});
test('review approval does not automatically stage or publish',async()=>{
 const h=setup(),root=new Node('section');h.ui.renderReviewControls(root,{...approved,status:'submitted',validation:{valid:true},payload_hash:'payload',diff_hash:'diff'});
 for(const n of walk(root).filter(n=>n.tag==='input'))n.checked=true;
 await walk(root).find(n=>n.tag==='button'&&n.text==='Approve review').listeners.click();
 assert.deepEqual(h.calls.map(x=>x.path),['/review']);
});
test('Verify prepares the approved snapshot internally and opens its preview',async()=>{
 const h=setup(),root=new Node('section');h.ui.renderReviewControls(root,approved);
 await walk(root).find(n=>n.tag==='button'&&n.text==='Verify').listeners.click();
 assert.deepEqual(h.calls.map(x=>x.path),['/apply']);assert.equal(h.events[0].type,'contributions-preview-requested');assert.equal(h.events[0].detail.can_verify,true);
});
test('verification requires a rendered preview, explicit check and evidence before publication',async()=>{
 const h=setup(),dialog=new Node('dialog'),container=new Node('section');dialog.dataset.previewReady='true';dialog.append(container);
 h.listeners['contributions-verification-ready']({detail:{account:{actor:'peer',generation:1},job:{id:'job',submission_id:'s',status:'verification_pending',can_verify:true},container}});
 const form=walk(container).find(n=>n.tag==='form'),select=walk(form).find(n=>n.tag==='select'),evidence=walk(form).find(n=>n.tag==='textarea'),confirm=walk(form).find(n=>n.tag==='input');
 const submit=()=>form.listeners.submit({preventDefault(){}});
 await submit();assert.equal(h.calls.length,0);
 select.value='pass';evidence.value='Checked the synthetic map point and list title.';await submit();assert.equal(h.calls.length,0);
 confirm.checked=true;dialog.dataset.previewReady='false';await submit();assert.equal(h.calls.length,0);
 dialog.dataset.previewReady='true';await submit();assert.deepEqual(h.calls.map(x=>x.path),['/verify']);assert.equal(dialog.closed,true);
});
test('an author/noneligible preview never receives a verification form',()=>{
 const h=setup(),container=new Node('section');h.listeners['contributions-verification-ready']({detail:{job:{status:'verification_pending',can_verify:false},container}});assert.equal(container.children.length,0);
});
test('preview markup exposes verification only for persisted eligible snapshots',()=>{
 const preview=readFileSync(new URL('../public/contribution-preview.js',import.meta.url),'utf8');
 assert.match(preview,/if\(job\.can_verify===true\).*contributions-verification-ready/s);
 assert.match(preview,/previewReady=String\(records\.length>0\)/);
 const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');assert.match(html,/>Submit<\/button>/);assert.match(html,/<h3 id="jobHeading">Verification<\/h3>/);
});
test('logout during dashboard refresh cannot reopen an old verification preview',async()=>{
 const h=setup(),root=new Node('section');let release,started,current=true;const ready=new Promise(resolve=>started=resolve);
 h.context.window.HauntologiesAccount.isCurrent=()=>current;
 h.context.loadDashboard=()=>new Promise(resolve=>{release=resolve;started();});h.ui.renderReviewControls(root,approved);
 const clicking=walk(root).find(n=>n.tag==='button'&&n.text==='Verify').listeners.click();await ready;current=false;release();await clicking;
 assert.deepEqual(h.calls.map(x=>x.path),['/apply']);assert.equal(h.events.length,0);
});
