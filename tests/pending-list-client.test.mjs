import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.value='';this.open=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 set textContent(value){this.value=String(value);this.children=[];}
 get textContent(){return this.value+this.children.map(n=>n.textContent).join('');}
 set innerHTML(_value){throw Error('Untrusted text must not become HTML');}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(k,v){this.listeners[k]=v;}
 querySelector(){return this.children[0];}
 querySelectorAll(){return this.children.flatMap(n=>[...(n.tagName==='details'&&n.open?[n]:[]),...n.querySelectorAll()]);}
}
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function harness(places){
 const nodes={pendingPlacesFeed:new Element('details'),pendingPlacesCount:new Element('span'),pendingPlacesList:new Element('ul')};nodes.pendingPlacesFeed.append(new Element('summary'));
 const context=vm.createContext({document:{createElement:tag=>new Element(tag)},window:{},$:id=>nodes[id],pendingPlaces:places,ownPlaces:[],pendingMarkers:new Map(),whereLabel:()=> 'Existing vicinity',allRecords:()=>[]});
 vm.runInContext(source.slice(source.indexOf('const pendingLabel='),source.indexOf("let pendingSignature=")),context);
 return {nodes,context,render:records=>context.renderPendingList(records||new Map(),new Set())};
}
test('list separates status, linked place, location disclosure and map action with literal text',()=>{
 const h=harness([{id:'synthetic',title:'<img src=x>',status:'approved',record_id:'target'}]);
 h.render(new Map([['target',{title:'Long mapped place',latitude:40.7,longitude:-74}]]));
 const row=h.nodes.pendingPlacesList.children[0];
 assert.deepEqual(row.children.map(n=>n.tagName),['strong','p','p','details','button']);
 assert.equal(row.children[0].textContent,'<img src=x>');assert.equal(row.children[1].textContent,'Approved');
 assert.equal(row.children[2].textContent,'Adds toLong mapped place');assert.equal(row.children[3].open,false);
 assert.equal(row.children[3].children[0].listeners.click,undefined);assert.equal(typeof row.children[4].listeners.click,'function');
});
test('repeated refresh preserves open location without duplicating rows or absent values',()=>{
 const h=harness([{id:'synthetic',title:'Synthetic',status:'submitted',latitude:40.7,longitude:-74}]);h.render();
 h.nodes.pendingPlacesList.children[0].children[2].open=true;h.render();h.render();
 assert.equal(h.nodes.pendingPlacesList.children.length,1);const row=h.nodes.pendingPlacesList.children[0];
 assert.equal(row.children[2].open,true);assert.ok(row.textContent.includes('Location marked on the map'));assert.ok(!row.textContent.includes('undefined'));
});
for(const [status,expected] of [['submitted','Not yet checked by a reviewer.'],['changes_requested','A reviewer has requested more information.'],['approved','Approved by a reviewer; publication is a separate step.']])test(`popup accurately describes ${status}`,()=>{
 const h=harness([]),popup=h.context.pendingPopup({title:'Synthetic',status,location_text:'Synthetic address'},null);
 assert.ok(popup.textContent.includes(expected));if(status!=='submitted')assert.ok(!popup.textContent.includes('Not yet checked'));
});
