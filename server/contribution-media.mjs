import {fail,safeUrl} from './core.mjs';

// Container validation is intentionally not a full image codec. Images are retained
// as private, downloadable derivatives; embedded camera/location metadata is removed.
export const MEDIA_LIMITS=Object.freeze({image_bytes:1048576,request_bytes:1064960,per_submission:3,total_bytes:33554432,max_dimension:8192,max_pixels:16777216,metadata_bytes:8192});
const encoder=new TextEncoder();
const check=(value,code='invalid_image',status=400)=>{if(!value)fail(code,status)};
const u16=(b,o)=>(b[o]<<8)|b[o+1];
const u32=(b,o)=>(b[o]*0x1000000+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0;
const le32=(b,o)=>(b[o]+(b[o+1]<<8)+(b[o+2]<<16)+b[o+3]*0x1000000)>>>0;
const ascii=(b,o,n)=>String.fromCharCode(...b.subarray(o,o+n));
const join=parts=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){b.set(p,o);o+=p.length}return b};
const dimensions=(width,height)=>{check(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=MEDIA_LIMITS.max_dimension&&height<=MEDIA_LIMITS.max_dimension&&width*height<=MEDIA_LIMITS.max_pixels,'image_dimensions');return{width,height}};
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc(b){let n=0xffffffff;for(const x of b)n=crcTable[(n^x)&255]^(n>>>8);return(n^0xffffffff)>>>0}
function png(b){
 check(b.length>=45&&b.slice(0,8).every((x,i)=>x===[137,80,78,71,13,10,26,10][i]));
 const keep=[b.slice(0,8)];let o=8,size=null,color,depth,seenHeader=false,seenPalette=false,seenData=false,endData=false,seenEnd=false,seenTransparency=false,dataBytes=0;
 while(o<b.length){check(o+12<=b.length);const n=u32(b,o),type=ascii(b,o+4,4),end=o+12+n;check(end<=b.length&&/^[A-Za-z]{4}$/.test(type)&&type[2]===type[2].toUpperCase());check(crc(b.subarray(o+4,o+8+n))===u32(b,o+8+n));const data=b.subarray(o+8,o+8+n);check(seenHeader||type==='IHDR');
  if(type==='IHDR'){check(!seenHeader&&n===13);size=dimensions(u32(data,0),u32(data,4));depth=data[8];color=data[9];check(({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[color]?.includes(depth)&&data[10]===0&&data[11]===0&&data[12]<=1);seenHeader=true}
  else if(type==='PLTE'){check(!seenPalette&&!seenData&&n>0&&n%3===0&&n<=768&&![0,4].includes(color)&&(color!==3||n/3<=2**depth));seenPalette=true}
  else if(type==='tRNS'){check(!seenTransparency&&!seenData&&((color===0&&n===2)||(color===2&&n===6)||(color===3&&seenPalette&&n>0&&n<=256)));seenTransparency=true}
  else if(type==='IDAT'){check(!endData&&(color!==3||seenPalette));seenData=true;dataBytes+=n}
  else if(type==='IEND'){check(n===0&&seenData&&dataBytes>0&&end===b.length);seenEnd=true}
  else {check(type[0]===type[0].toLowerCase());check(!['acTL','fcTL','fdAT'].includes(type),'animated_image_unsupported');}
  if(seenData&&type!=='IDAT')endData=true;
  if(['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type))keep.push(b.slice(o,end));o=end;
 }
 check(seenEnd);return{...size,bytes:join(keep),media_type:'image/png'};
}
function jpeg(b){
 check(b.length>=20&&b[0]===255&&b[1]===216);const keep=[b.slice(0,2)];let o=2,size=null,components=0,scans=0,hasQuant=false,hasHuffman=false,ended=false;
 while(o<b.length){const start=o;check(b[o++]===255);while(b[o]===255)o++;check(o<b.length);const marker=b[o++];
  if(marker===217){check(size&&scans>0&&hasQuant&&hasHuffman&&o===b.length);keep.push(b.slice(start,o));ended=true;break}
  check(marker!==0&&marker!==216&&marker!==1&&!(marker>=208&&marker<=215));check(o+2<=b.length);const n=u16(b,o),end=o+n;check(n>=2&&end<=b.length);const d=b.subarray(o+2,end);
  if([192,193,194].includes(marker)){check(!size&&d.length>=6&&d[0]===8);size=dimensions(u16(d,3),u16(d,1));components=d[5];check([1,3].includes(components)&&d.length===6+3*components);const ids=new Set();for(let k=0;k<components;k++){const id=d[6+3*k],sampling=d[7+3*k];check(!ids.has(id)&&(sampling>>4)>=1&&(sampling>>4)<=4&&(sampling&15)>=1&&(sampling&15)<=4&&d[8+3*k]<=3);ids.add(id)}}
  else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))fail('unsupported_image_encoding');
  else if(marker===219){let p=0;while(p<d.length){const h=d[p++],precision=h>>4;check(precision<=1&&(h&15)<=3);p+=64*(precision+1);check(p<=d.length)}check(p>0);hasQuant=true}
  else if(marker===196){let p=0;while(p<d.length){check(p+17<=d.length);const h=d[p++];check((h>>4)<=1&&(h&15)<=3);let count=0;for(let k=0;k<16;k++)count+=d[p++];check(count>0&&count<=256&&p+count<=d.length);p+=count}check(p>0);hasHuffman=true}
  else if(marker===218){check(size&&d.length>=4);const ncomp=d[0];check(ncomp>=1&&ncomp<=components&&d.length===1+2*ncomp+3);scans++;keep.push(b.slice(start,end));let p=end;while(p<b.length){if(b[p]!==255){p++;continue}const markStart=p++;while(b[p]===255)p++;check(p<b.length);if(b[p]===0||(b[p]>=208&&b[p]<=215)){p++;continue}keep.push(b.slice(end,markStart));o=markStart;break}check(p<b.length);continue}
  else check((marker>=224&&marker<=239)||marker===254||marker===221,'unsupported_image_encoding');
  if(marker===221)check(d.length===2);
  if(!(marker>=224&&marker<=239)&&marker!==254)keep.push(b.slice(start,end));o=end;
 }
 check(ended);return{...size,bytes:join(keep),media_type:'image/jpeg'};
}
function webp(b){
 check(b.length>=20&&ascii(b,0,4)==='RIFF'&&ascii(b,8,4)==='WEBP'&&le32(b,4)+8===b.length);let o=12,extended=null,size=null,image=false,alpha=false;const keep=[];
 while(o<b.length){check(o+8<=b.length);const type=ascii(b,o,4),n=le32(b,o+4),end=o+8+n+(n&1);check(end<=b.length&&(!(n&1)||b[end-1]===0));const data=b.subarray(o+8,o+8+n);let chunk=b.slice(o,end);
  if(type==='VP8X'){check(o===12&&!extended&&n===10&&(data[0]&0xc1)===0&&data[1]===0&&data[2]===0&&data[3]===0);check(!(data[0]&2),'animated_image_unsupported');extended=dimensions(1+data[4]+(data[5]<<8)+(data[6]<<16),1+data[7]+(data[8]<<8)+(data[9]<<16));chunk[8]&=~0x2c}
  else if(type==='VP8 '){check(!image&&n>=10&&(data[0]&1)===0&&(data[0]&0x10)!==0&&data[3]===0x9d&&data[4]===1&&data[5]===0x2a);const partition=(data[0]|data[1]<<8|data[2]<<16)>>>5;check(partition>0&&partition+10<=n);size=dimensions((data[6]|data[7]<<8)&0x3fff,(data[8]|data[9]<<8)&0x3fff);image=true}
  else if(type==='VP8L'){check(!image&&!alpha&&n>=5&&data[0]===0x2f&&(data[4]>>5)===0);const bits=le32(data,1);size=dimensions(1+(bits&0x3fff),1+((bits>>>14)&0x3fff));image=true}
  else if(type==='ALPH'){check(extended&&!image&&!alpha&&n>1&&(data[0]&0xc0)===0&&(data[0]&3)<=1&&((data[0]>>4)&3)<=1);alpha=true}
  else if(['ANIM','ANMF'].includes(type))fail('animated_image_unsupported');
  else check(['ICCP','EXIF','XMP '].includes(type),'unsupported_image_encoding');
  if(['VP8X','VP8 ','VP8L','ALPH'].includes(type))keep.push(chunk);o=end;
 }
 check(image&&size&&(!extended||(size.width===extended.width&&size.height===extended.height)));if(!extended)check(keep.length===1);const body=join(keep),header=b.slice(0,12);new DataView(header.buffer).setUint32(4,body.length+4,true);return{...size,bytes:join([header,body]),media_type:'image/webp'};
}
export async function bytesHash(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('')}
export async function sanitizeImage(input,declaredType){const b=input instanceof Uint8Array?input:new Uint8Array(input);check(b.length>0&&b.length<=MEDIA_LIMITS.image_bytes,'image_too_large',413);check(['image/png','image/jpeg','image/webp'].includes(declaredType),'unsupported_image_type',415);const result=b[0]===137?png(b):b[0]===255?jpeg(b):ascii(b,0,4)==='RIFF'?webp(b):fail('invalid_image');check(result.media_type===declaredType,'image_type_mismatch',415);return{...result,input_sha256:await bytesHash(b),sha256:await bytesHash(result.bytes),byte_length:result.bytes.length}}
export function mediaMetadata(raw){check(typeof raw==='string'&&encoder.encode(raw).length<=MEDIA_LIMITS.metadata_bytes,'invalid_attachment_metadata');let value;try{value=JSON.parse(raw)}catch{fail('invalid_attachment_metadata')}check(value&&typeof value==='object'&&!Array.isArray(value),'invalid_attachment_metadata');const bounds={caption:2000,alt:1000,credit:1000,source_url:2048,rights:2000};for(const[k,v]of Object.entries(value)){check(Object.hasOwn(bounds,k)&&typeof v==='string'&&v.length<=bounds[k]&&!v.includes('\0'),'invalid_attachment_metadata');if(k==='source_url'&&v)check(safeUrl(v),'unsafe_url')}return{rights:'unknown',...value}}
export function attachmentReference(row){return{attachment_id:row.id,sha256:row.sha256,byte_length:row.byte_length,media_type:row.media_type,width:row.width,height:row.height,metadata:JSON.parse(row.metadata_json)}}
export function referenceShape(ref){return Boolean(ref&&typeof ref==='object'&&!Array.isArray(ref)&&Object.keys(ref).length===7&&['attachment_id','sha256','byte_length','media_type','width','height','metadata'].every(k=>Object.hasOwn(ref,k))&&typeof ref.attachment_id==='string'&&/^watt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref.attachment_id))}
export async function readAttachmentForm(req){
 check(req.method==='POST','method_not_allowed',405);check(req.headers.get('origin')===new URL(req.url).origin&&(req.headers.get('sec-fetch-site')||'same-origin')==='same-origin','same_origin_required',403);check(/^multipart\/form-data;\s*boundary=/i.test(req.headers.get('content-type')||''),'multipart_required',415);
 const reader=req.body?.getReader();check(reader,'invalid_attachment_form');let size=0;const parts=[];while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>MEDIA_LIMITS.request_bytes){await reader.cancel();fail('image_too_large',413)}parts.push(r.value)}let form;try{form=await new Response(join(parts),{headers:{'content-type':req.headers.get('content-type')}}).formData()}catch{fail('invalid_attachment_form')}
 const fields=['submission_id','expected_revision','idempotency_key','metadata_json','image'];check([...form.keys()].length===fields.length&&fields.every(k=>form.getAll(k).length===1),'invalid_attachment_form');const result=Object.fromEntries(form);for(const k of fields.slice(0,4))check(typeof result[k]==='string','invalid_attachment_form');check(/^\d{1,9}$/.test(result.expected_revision)&&Number(result.expected_revision)>0,'invalid_revision');result.expected_revision=Number(result.expected_revision);check(result.image&&typeof result.image.arrayBuffer==='function','invalid_attachment_form');check(result.image.size>0&&result.image.size<=MEDIA_LIMITS.image_bytes,'image_too_large',413);return result;
}
