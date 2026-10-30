import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Synthetic fixture bytes only. The browser decode and canvas are stubbed so the test exercises
// the file checks that run before and after the browser re-encodes an image.
const source=readFileSync(new URL('../public/contribution-image.js',import.meta.url),'utf8');
const jpeg=Buffer.from(JSON.parse(readFileSync(new URL('./fixtures/attachment-images.json',import.meta.url),'utf8')).jpeg,'base64');
function sofSize(bytes){
 for(let i=2;i<bytes.length-8;){const marker=bytes[i+1],length=bytes.readUInt16BE(i+2);if(marker>=192&&marker<=207&&![196,200,204].includes(marker))return{height:bytes.readUInt16BE(i+5),width:bytes.readUInt16BE(i+7)};i+=2+length;}
 throw new Error('fixture has no frame header');
}
function load(){
 const size=sofSize(jpeg);
 const canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toBlob:(resolve,type)=>resolve(new Blob([jpeg],{type}))};
 const root={Blob,File,createImageBitmap:async()=>({...size,close(){}}),document:{createElement:()=>canvas}};
 const context=vm.createContext({window:root,Uint8Array,DataView,String,Number,Set,Object,Promise,Math,Error});
 vm.runInContext(source,context);
 return root.ContributionImage;
}
const file=bytes=>new File([bytes],'synthetic.jpg',{type:'image/jpeg'});

test('a phone JPEG with data after its end-of-image marker is accepted and re-encoded without it',async()=>{
 const image=load(),trailer=Buffer.concat([jpeg,Buffer.from('MotionPhoto_Data'),Buffer.alloc(64,7)]);
 const prepared=await image.prepare(file(trailer));
 assert.equal(prepared.outputType,'image/jpeg');
 const output=Buffer.from(await prepared.file.arrayBuffer());
 assert.equal(output.at(-2),255);assert.equal(output.at(-1),217);
});

test('a truncated JPEG without an end-of-image marker is still rejected',async()=>{
 const image=load(),truncated=jpeg.subarray(0,jpeg.length-2);
 await assert.rejects(image.prepare(file(truncated)),{code:'invalid_image'});
 const cut=Buffer.concat([truncated,Buffer.from('trailing bytes without EOI')]);
 await assert.rejects(image.prepare(file(cut)),{code:'invalid_image'});
});
