import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Small DOM surface for semantic/content tests; real layout and keyboard behavior are checked in the Mac browser.
class Element{
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.value='';}
  append(...nodes){this.children.push(...nodes);}
  set textContent(value){this.value=String(value);this.children=[];}
  get textContent(){return this.value+this.children.map(node=>node.textContent).join('');}
  set innerHTML(_value){throw new Error('Record content must be rendered as text, not HTML');}
}
const document={createElement:tag=>new Element(tag,document)};
const context={window:{}};vm.createContext(context);
vm.runInContext(readFileSync(new URL('../public/record-view.js',import.meta.url),'utf8'),context);
const descendants=node=>[node,...node.children.flatMap(descendants)];
const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const render=(record,summary={description:'Public record summary',latitude:40.73,longitude:-73.99})=>{const card=document.createElement('article');context.window.PlaceRecordView.append(card,record,{summary,safeUrl});return card;};

test('Record disclosure preserves long citations, multiple sources, uncertainty and image attribution without mutating public data',()=>{
  const citation='Synthetic citation with a long locator and source-specific qualifications. '.repeat(30);
  const record={title:'Synthetic record',location_text:'Synthetic public place',borough:'Manhattan',time_original:'unknown',time_basis:'Date is unresolved.',uncertainty_note:'Point is approximate.',contributors:['Consented Alice','Consented Bob'],rights_or_license:'Citation only',
    image:{url:'https://example.test/image.jpg',caption:'Synthetic caption',creator:'Public image creator',license:'CC BY',sourceUrl:'https://example.test/image-source',licenseUrl:'https://example.test/license'},
    sources:[{title:'First synthetic source',citation,url:'https://example.test/one',repository:'Synthetic archive',locator:'Series 1 / Box 2',rights_statement:'No reproduction permission inferred.',evidence_note:'The source reports a claim.'},{citation:'Second distinct citation',url:'https://example.test/two',source_date_original:'1900',credit:'Public source credit'}]};
  const before=JSON.stringify(record),card=render(record),nodes=descendants(card),text=card.textContent;
  for(const value of [citation,'Second distinct citation','Synthetic archive','Series 1 / Box 2','Point is approximate.','Date is unresolved.','Public image creator','Public source credit','Consented Alice, Consented Bob','No reproduction permission inferred.'])assert.ok(text.includes(value),value);
  assert.equal(card.children[0].tagName,'details');assert.equal(card.children[0].children[0].textContent,'Record');
  assert.deepEqual(nodes.filter(n=>n.tagName==='a').map(n=>n.href),['https://example.test/image-source','https://example.test/license','https://example.test/one','https://example.test/two']);
  assert.equal(JSON.stringify(record),before);
});

test('Record text and source labels never become markup, credential URLs are rejected and names are never inferred',()=>{
  const record={title:'<img src=x onerror=alert(1)>',owner_id:'Private owner',email:'private@example.test',sources:[{title:'<script>unsafe label</script>',url:'javascript:alert(1)'},{citation:'Unlinked credential source',url:'https://name:password@example.test/private'}]};
  const card=render(record,{description:'<b>literal public text</b>',latitude:null,longitude:null}),nodes=descendants(card);
  assert.ok(card.textContent.includes(record.title));assert.ok(card.textContent.includes('<script>unsafe label</script>'));
  assert.equal(nodes.filter(n=>n.tagName==='a'||n.tagName==='img').length,0);
  for(const secret of ['Private owner','private@example.test','Contributors:','Coordinates'])assert.equal(card.textContent.includes(secret),false);
});

test('legacy public source URL remains available when no sources array is populated',()=>{
  const card=render({title:'Legacy public record',sources:[],source_url:'https://example.test/legacy',source_title:'Original source'});
  assert.equal(descendants(card).find(n=>n.tagName==='a').href,'https://example.test/legacy');
});


test('flat public image attribution aliases retain their caption, credit, license and links',()=>{
 const card=render({title:'Flat image fixture',image_url:'https://example.test/image.jpg',image_alt:'Synthetic alt',image_caption:'Synthetic flat caption',image_credit:'Synthetic image creator',image_license:'CC BY',image_source_url:'https://example.test/source',image_license_url:'https://example.test/license'}),nodes=descendants(card);
 for(const text of ['Synthetic flat caption','Synthetic image creator','CC BY'])assert.ok(card.textContent.includes(text));
 assert.equal(nodes.find(n=>n.tagName==='img').alt,'Synthetic alt');
 assert.deepEqual(nodes.filter(n=>n.tagName==='a').map(n=>n.href),['https://example.test/source','https://example.test/license']);
});
