import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('private image details render a same-origin preview and retain the download and attribution',()=>{
 const source=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
 const start=source.indexOf('  function renderPrivateImages('),end=source.indexOf("  byId('contributionImages')",start);
 assert.ok(start>=0&&end>start);
 class Element{constructor(tag,text){this.tag=tag;this.textContent=text||'';this.children=[];this.handlers={};}append(...children){this.children.push(...children);}get childElementCount(){return this.children.length;}addEventListener(type,fn){this.handlers[type]=fn;}}
 const el=(tag,text)=>new Element(tag,text),root=el('div');
 const context=vm.createContext({el,apiRoot:'/api/contributions',attachmentId:value=>typeof value==='string'&&/^watt_[0-9a-f-]{36}$/.test(value),imageFields:[['caption','Caption'],['alt','Alt text'],['credit','Credit']],metadata:values=>({values}),disclosure:(title,list)=>({title,list})});
 vm.runInContext(source.slice(start,end)+';globalThis.render=renderPrivateImages;',context);
 context.render(root,[{attachment_id:'watt_00000000-0000-4000-8000-000000000001',metadata:{alt:'A <safe> caption',credit:'Synthetic credit'}},{attachment_id:'https://example.test/private'},{attachment_id:'watt_00000000-0000-4000-8000-000000000002',metadata:{}}]);
 const list=root.children[0].list;assert.equal(list.children.length,2);const [image,link,metadata]=list.children[0].children;
 assert.equal(image.tag,'img');assert.equal(image.src,'/api/contributions/attachment?id=watt_00000000-0000-4000-8000-000000000001');assert.equal(image.alt,'A <safe> caption');assert.equal(link.href,image.src);assert.deepEqual(metadata.values.map(v=>v[1]),['A <safe> caption','Synthetic credit']);
 assert.equal(list.children[1].children[0].alt,'');image.handlers.error();assert.equal(image.hidden,true);
});
