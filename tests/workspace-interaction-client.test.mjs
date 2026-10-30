import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const nodes=new Map(),listeners=new Map();let signedIn=true,nativeDialog=false;
 const document={activeElement:null,addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);}};
 class Node{
  constructor(id,parent=null){this.id=id;this.parentElement=parent;this.children=[];parent?.children.push(this);this.hidden=false;this.inert=false;this.tagName='DIV';this.attrs=new Map();this.events=new Map();this.value='';this.dataset={};const classes=new Set();this.classList={contains:c=>classes.has(c),remove:(...cs)=>cs.forEach(c=>classes.delete(c)),toggle:(c,on)=>on?classes.add(c):classes.delete(c)};nodes.set(id,this);}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  closest(selector){return selector.split(',').some(c=>this.classList.contains(c.slice(1)))?this:this.parentElement?.closest(selector)||null;}
  setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}
  focus(){document.activeElement=this;}addEventListener(type,fn){this.events.set(type,fn);}click(){return this.events.get('click')?.({target:this});}
  querySelectorAll(){return [];}
 }
 const body=new Node('body'),header=new Node('header',body),nav=new Node('participation',body),main=new Node('workspace',body);
 header.classList.toggle('header-tools',true);nav.classList.toggle('contribution-navigation',true);
 for(const id of ['toolsButton','accountButton'])new Node(id,nav);
 for(const id of ['mapToolsButton','filtersButton','layersButton'])new Node(id,header);
 new Node('map',main);new Node('toolsMenu',body);
 for(const id of ['filtersPanel','layersPanel','researchSidecar'])new Node(id,main);
 for(const id of ['casePanel','draftPanel','sourcesPanel','sidecarTitle','closeResearch'])new Node(id,nodes.get('researchSidecar'));
 const draft=new Node('draftText',nodes.get('draftPanel'));draft.value='An unsent synthetic contribution';
 for(const id of ['openResearch','publishedEditsFeed','search','layersTitle','submitTool','reviewTool','closeLayers','closeFilters'])new Node(id,body);
 const panels=['casePanel','draftPanel','sourcesPanel'].map(id=>nodes.get(id));
 document.body=body;document.querySelector=selector=>selector==='dialog[open]'&&nativeDialog?{}:null;
 document.querySelectorAll=selector=>selector==='.panel'?panels:[];
 const context=vm.createContext({document,window:{HauntologiesAccount:{canContribute:()=>signedIn},ContributionPoint:{show(){}}},$:(id)=>nodes.get(id),
  contributionPicking:false,clearProposedPoint(){},stopContributionPicking(){context.contributionPicking=false;},
  emptyMapTarget:target=>nodes.get('map').contains(target),map:{closePopup(){}},revealPlaceCard(){},selected:'synthetic',
  requireEditAccount(_button,action){action();}});
 vm.runInContext(source.slice(source.indexOf("let toolOpener="),source.indexOf('async function requireEditAccount')),context);
 vm.runInContext(source.slice(source.indexOf("$('toolsButton').addEventListener('click'"),source.indexOf("document.addEventListener('focusin'")),context);
 vm.runInContext('globalThis.actions={open:switchPanel,close:closeTools};',context);
 context.actions.close();
 const emit=(type,target,extra={})=>{let prevented=false;const event={target,preventDefault(){prevented=true;},...extra};for(const fn of listeners.get(type)||[])fn(event);return prevented;};
 return {nodes,document,context,draft,open:context.actions.open,emit,setSignedIn:value=>signedIn=value,setDialog:value=>nativeDialog=value};
}
test('Contribute leaves map and navigation interactive and keyboard focus untrapped',()=>{
 const h=fixture();h.open('draftPanel');
 for(const id of ['map','header','participation'])assert.equal(h.nodes.get(id).inert,false,id+' is usable');
 assert.equal(h.nodes.get('researchSidecar').getAttribute('aria-modal'),null);
 assert.equal(h.nodes.get('researchSidecar').getAttribute('role'),null,'labelled aside remains a nonmodal panel');
 assert.equal(h.emit('keydown',h.draft,{key:'Tab'}),false);
 h.emit('pointerdown',h.nodes.get('mapToolsButton'));h.nodes.get('mapToolsButton').click();
 assert.equal(h.nodes.get('casePanel').classList.contains('active'),true,'Places opens in one click');
 assert.equal(h.nodes.get('researchSidecar').hidden,false);
 h.open('draftPanel');assert.equal(h.draft.value,'An unsent synthetic contribution');
});
test('outside map clicks dismiss each panel without consuming the click or resetting draft fields',()=>{
 const h=fixture();
 for(const id of ['draftPanel','casePanel','sourcesPanel']){
  h.open(id);h.draft.focus();assert.equal(h.emit('pointerdown',h.nodes.get('map')),false);
  assert.equal(h.nodes.get('researchSidecar').hidden,true);assert.equal(h.document.activeElement,h.nodes.get('map'));
 }
 h.open('draftPanel');assert.equal(h.draft.value,'An unsent synthetic contribution');
 assert.equal(h.emit('pointerdown',h.draft),false);assert.equal(h.nodes.get('researchSidecar').hidden,false);
});
test('choosing a contribution point keeps the form open for the map click',()=>{
 const h=fixture();h.open('draftPanel');h.context.contributionPicking=true;
 assert.equal(h.emit('pointerdown',h.nodes.get('map')),false);
 assert.equal(h.nodes.get('researchSidecar').hidden,false);assert.equal(h.context.contributionPicking,true);
});
test('native dialogs retain their own modality and explicit Escape still closes the sidecar',()=>{
 const h=fixture();h.open('draftPanel');h.setDialog(true);h.emit('pointerdown',h.nodes.get('map'));
 assert.equal(h.nodes.get('researchSidecar').hidden,false);
 h.setDialog(false);assert.equal(h.emit('keydown',h.draft,{key:'Escape',defaultPrevented:false}),true);
 assert.equal(h.nodes.get('researchSidecar').hidden,true);assert.equal(h.draft.value,'An unsent synthetic contribution');
});
test('account controls remain clickable and signed-out users cannot reopen Contribute',()=>{
 const h=fixture();h.open('draftPanel');h.emit('pointerdown',h.nodes.get('accountButton'));
 assert.equal(h.nodes.get('researchSidecar').hidden,false);
 h.context.actions.close();h.setSignedIn(false);h.open('draftPanel');assert.equal(h.nodes.get('researchSidecar').hidden,true);
});
