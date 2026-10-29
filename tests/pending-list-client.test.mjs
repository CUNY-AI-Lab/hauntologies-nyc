import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.value='';this.open=false;this.hidden=false;this.className='';}
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
function harness(places,{account=false,own=[],cards=[]}={}){
 const nodes={pendingPlacesFeed:new Element('details'),pendingPlacesCount:new Element('span'),pendingPlacesList:new Element('ul')};nodes.pendingPlacesFeed.append(new Element('summary'));
 const slots=cards.map(id=>{const slot=new Element('div');slot.dataset.recordId=id;slot.hidden=true;return slot;});
 const events=[];
 const context=vm.createContext({document:{createElement:tag=>new Element(tag),querySelectorAll:()=>slots},window:{HauntologiesAccount:account?{canContribute:()=>true}:undefined,dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},$:id=>nodes[id],pendingPlaces:places,ownPlaces:own,ownIds:new Set(own.map(p=>p.id)),pendingMarkers:new Map(),whereLabel:()=> 'Existing vicinity',allRecords:()=>[],map:{closePopup(){}}});
 vm.runInContext(source.slice(source.indexOf('const pendingLabel='),source.indexOf("let pendingSignature=")),context);
 return {nodes,context,slots,events,render:records=>context.renderPendingList(records||new Map(),new Set(own.map(p=>p.id)))};
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
 assert.ok(popup.textContent.includes('Shared by a contributor.'));
});
test('a credited contributor is named in the list row and the popup, as literal text',()=>{
 const h=harness([{id:'named',title:'Named lantern',status:'submitted',latitude:40.7,longitude:-74,contributor:'<b>Ada</b> Example'}]);h.render();
 const row=h.nodes.pendingPlacesList.children[0];
 assert.deepEqual(row.children.map(n=>n.tagName),['strong','p','p','details','button']);
 assert.equal(row.children[2].className,'pending-contributor');assert.equal(row.children[2].textContent,'By <b>Ada</b> Example');
 const popup=h.context.pendingPopup(h.context.pendingPlaces[0],null);
 assert.equal(popup.children.find(n=>n.className==='pending-place-contributor').textContent,'By <b>Ada</b> Example');
 assert.ok(popup.textContent.includes('Shared by <b>Ada</b> Example. Not yet checked by a reviewer.'));
 assert.ok(!popup.children.some(n=>n.className==='pending-review-action'),'signed out, no review shortcut');
});
test('a signed-in participant gets a Review shortcut for others\' submitted or approved work only',()=>{
 const places=[{id:'theirs',title:'Theirs',status:'submitted',latitude:40.7,longitude:-74},{id:'mine',title:'Mine',status:'submitted',latitude:40.71,longitude:-74},{id:'back',title:'Sent back',status:'changes_requested',latitude:40.72,longitude:-74}];
 const h=harness(places,{account:true,own:[{id:'mine'}]});h.render();
 const rows=h.nodes.pendingPlacesList.children,review=row=>row.children.find(n=>n.className==='pending-review-action');
 assert.ok(review(rows[0]),'another person\'s submission can be reviewed');assert.equal(review(rows[1]),undefined,'own work has no review shortcut');assert.equal(review(rows[2]),undefined,'returned work is not readable by peers');
 assert.ok(rows[1].textContent.includes('Yours'));
 review(rows[0]).listeners.click();
 assert.deepEqual(JSON.parse(JSON.stringify(h.events.map(e=>[e.type,e.detail]))),[['contributions-review-requested',{submissionId:'theirs'}]]);
});
test('a place card lists the contributions under review that add to it, with names',()=>{
 const places=[{id:'note1',title:'Cold spot',status:'submitted',record_id:'place-a',contributor:'Ada Example',description:'A draft moves through the hall.'},{id:'note2',title:'Bell',status:'approved',record_id:'place-a'},{id:'elsewhere',title:'Other',status:'submitted',record_id:'place-b'}];
 const h=harness(places,{cards:['place-a','place-c']});
 h.render(new Map([['place-a',{title:'Hall',latitude:40.7,longitude:-74}],['place-b',{title:'Elsewhere',latitude:40.7,longitude:-74}]]));
 const [a,c]=h.slots;
 assert.equal(a.hidden,false);assert.equal(a.children[0].textContent,'Under review (2)');
 const items=a.children[1].children;assert.equal(items.length,2);
 assert.equal(items[0].children[0].textContent,'Cold spot');assert.equal(items[0].children[1].textContent,'By Ada Example · Under review');assert.equal(items[0].children[2].textContent,'A draft moves through the hall.');
 assert.equal(items[1].children[1].textContent,'Approved');
 assert.equal(c.hidden,true);assert.equal(c.children.length,0);
});
