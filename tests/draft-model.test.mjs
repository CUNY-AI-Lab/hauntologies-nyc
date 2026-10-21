import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {safeUrl as serverSafeUrl} from '../server/core.mjs';

const context=vm.createContext({window:{},URL,crypto:webcrypto,structuredClone,TextEncoder});
vm.runInContext(fs.readFileSync(new URL('../public/draft-model.js',import.meta.url),'utf8'),context);
const {safeUrl,draftFrom}=context.window.DraftModel;
const plain=value=>JSON.parse(JSON.stringify(value));
const draft=(change={})=>({title:'An unresolved historical place',evidence_summary:'A source reports this claim.',source_title:'Archive catalogue',source_url:'https://example.org/archive/item',latitude:null,longitude:null,...change});
function validationError(operation,pattern){
 assert.throws(operation,error=>{
  assert.notEqual(error.name,'TypeError','Malformed input must produce a useful validation error.');
  assert.match(error.message,pattern);
  return true;
 });
}

test('malformed source entries and singleton objects receive clear validation errors',()=>{
 for(const sources of [[null],[false],[42],['A citation'],[[]]])validationError(()=>draftFrom(draft({sources})),/Source 1.*source object/i);
 for(const sources of [{citation:'A source'},'{}','null','42'])validationError(()=>draftFrom(draft({sources})),/Sources.*array.*source objects/i);
});

test('invalid source-array JSON is rejected instead of silently discarded',()=>{
 for(const sources of ['[', '[{"citation":"A"},]', 'not json'])validationError(()=>draftFrom(draft({sources})),/Sources.*valid JSON array/i);
 const parsed=draftFrom(draft({sources:'[{"citation":"Archive, box 4, item 2","locator":"p. 7"}]'}));
 assert.deepEqual(plain(parsed.sources),[{citation:'Archive, box 4, item 2',locator:'p. 7'}]);
});

test('evidence, uncertainty, and long citations retain every character past the old limits',()=>{
 const evidence='  '+ 'Historical wording — 😀 & <source>.\n'.repeat(50)+'END EVIDENCE  ';
 const uncertainty='\n'+ 'Scope is unresolved; preserve the original qualifications. '.repeat(30)+'END UNCERTAINTY\n';
 const citation='Creator, title, collection, locator — '.repeat(40)+'END CITATION';
 assert.ok(evidence.length>601&&uncertainty.length>601&&citation.length>601);
 const input=draft({evidence_summary:evidence,uncertainty_note:uncertainty,source_title:citation,sources:[{citation,evidence_note:uncertainty}]});
 const result=draftFrom(input);
 assert.equal(result.evidence_summary,evidence);
 assert.equal(result.uncertainty_note,uncertainty);
 assert.equal(result.source_title,citation);
 assert.equal(result.sources[0].citation,citation);
 assert.equal(result.sources[0].evidence_note,uncertainty);
 assert.equal(result.original_submission.evidence_summary,evidence);
});

test('citation-only source objects are preserved without requiring or inventing a URL',()=>{
 const sources=[{citation:'Archive catalogue, box 4, item 2',repository:'Municipal archive',locator:'p. 7',rights_status:'unknown',evidence_note:'Supports the listed address only.'},{title:'Undated manuscript',citation:'Unidentified creator; date unknown.',extra:{sourceSpelling:'  As written  '}}];
 const result=draftFrom(draft({sources}));
 assert.deepEqual(plain(result.sources),sources);
 assert.ok(!Object.hasOwn(result.sources[0],'url'));
 assert.ok(!Object.hasOwn(result.sources[1],'url'));
});

test('original submission object and explicitly supplied original JSON remain lossless',()=>{
 const original={schema_version:'2.0',title:'  Original title 😀  ',description:'Original\nwording & <tags>.',metadata:{date:'Undated',citation:'  Catalogue\titem  ',unknownField:[null,0,false,'é']}};
 const originalJSON=' {\n  "schema_version": "2.0", "title": "  Original title 😀  ",\n  "description": "Original\\nwording & <tags>.", "metadata": { "date": "Undated", "citation": "  Catalogue\\titem  ", "unknownField": [null,0,false,"é"] }\n } ';
 assert.deepEqual(JSON.parse(originalJSON),original);
 const input=draft({original_submission:original,original_submission_json:originalJSON});
 const before=JSON.stringify(input),result=draftFrom(input);
 assert.deepEqual(plain(result.original_submission),original);
 assert.equal(result.original_submission_json,originalJSON);
 assert.equal(JSON.stringify(input),before,'Conversion must not mutate the caller’s input.');
 result.original_submission.metadata.date='changed output only';
 assert.equal(original.metadata.date,'Undated','The preserved submission must not alias the caller object.');
});

test('string original submissions are parsed for display while the complete raw import retains their bytes',()=>{
 const original=' { "title" : "Uneven spacing 😀", "metadata" : {"citation":"A\\nB"} }\n';
 const input=draft({original_submission:original,additional_import_field:{keep:['all','values']}});
 const result=draftFrom(input);
 assert.deepEqual(plain(result.original_submission),JSON.parse(original));
 assert.equal(JSON.parse(result.original_submission_json).original_submission,original);
 assert.deepEqual(JSON.parse(result.original_submission_json),input);
 validationError(()=>draftFrom(draft({original_submission:'{broken'})),/Original submission.*valid JSON/i);
});

test('raw imports without a separate original submission retain all original fields',()=>{
 const input=draft({extra_field:{retained:true},sources:[{citation:'Only a paper citation'}],aliases:['Old name']});
 const result=draftFrom(input);
 assert.deepEqual(plain(result.original_submission),input);
 assert.deepEqual(JSON.parse(result.original_submission_json),input);
 result.sources[0].citation='changed output only';
 assert.equal(input.sources[0].citation,'Only a paper citation');
});

test('client and server URL rules accept HTTP(S) and reject credentials and unsafe schemes identically',()=>{
 const valid=['https://example.org/archive/item?box=1#page7','http://example.org/item','HTTPS://EXAMPLE.ORG/Space%20Name','https://example.org:8443/path'];
 const invalid=['https://reader:secret@example.org/item','http://reader@example.org/item','https://:secret@example.org/item','https://read%65r:p%40ss@example.org/item','javascript:alert(1)','data:text/plain,hello','file:///tmp/item','ftp://example.org/item','//example.org/item','not a URL',null,undefined,''];
 for(const value of [...valid,...invalid])assert.equal(Boolean(safeUrl(value)),Boolean(serverSafeUrl(value)),String(value));
 for(const value of valid){assert.equal(safeUrl(value),new URL(value).href);assert.equal(draftFrom(draft({source_url:value})).source_url,new URL(value).href);}
 for(const value of invalid)assert.equal(safeUrl(value),'',String(value));
});

test('credential-bearing primary, geography, and additional source URLs are rejected clearly',()=>{
 const credentialURL='https://reader:secret@example.org/private';
 validationError(()=>draftFrom(draft({source_url:credentialURL})),/source_url.*without embedded credentials/i);
 validationError(()=>draftFrom(draft({geocode_source_url:credentialURL})),/coordinate source.*without embedded credentials/i);
 for(const key of ['url','sourceUrl'])validationError(()=>draftFrom(draft({sources:[{citation:'Item', [key]:credentialURL}]})),/Source 1.*without embedded credentials/i);
});

test('unlocated records keep null coordinates while partial or invalid coordinates are rejected',()=>{
 for(const coordinates of [{latitude:null,longitude:null},{latitude:'',longitude:''},{latitude:undefined,longitude:undefined}]){
  const result=draftFrom(draft(coordinates));
  assert.equal(result.latitude,null);assert.equal(result.longitude,null);
 }
 for(const coordinates of [{latitude:40.7,longitude:null},{latitude:null,longitude:-74},{latitude:0,longitude:0},{latitude:'bad',longitude:-74}])validationError(()=>draftFrom(draft(coordinates)),/NYC latitude\/longitude or both coordinates left blank/i);
 const located=draftFrom(draft({latitude:'40.729490',longitude:'-73.986580'}));
 assert.equal(located.latitude,40.72949);assert.equal(located.longitude,-73.98658);
 assert.equal(located.original_submission.latitude,'40.729490');
 assert.equal(located.original_submission.longitude,'-73.986580');
});
