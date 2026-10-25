/* Prepare a metadata-free image derivative locally; the server validates uploads independently. */
(function (root) {
  'use strict';
  // Files up to 5 MiB are accepted; the stored derivative stays within the server's 1 MiB limit,
  // which keeps each D1 row under its 2,000,000-byte value cap.
  const MAX_INPUT_BYTES=5*1024*1024, MAX_BYTES=1024*1024, MAX_AXIS=8192, MAX_PIXELS=16777216;
  const TYPES=new Set(['image/jpeg','image/png','image/webp']);
  const messages={
    image_too_large:'Choose an image no larger than 5 MB.',
    unsupported_image_type:'Choose a JPEG, PNG, or WebP image.',
    animated_image_unsupported:'Choose a still image. Animated images are not supported.',
    invalid_image:'This image is incomplete or could not be read.',
    image_dimensions_exceeded:'Use an image at most 8192 pixels per side and 16,777,216 pixels in total.',
    image_output_too_large:'This image could not be reduced below 1 MB. Choose a smaller image.',
    image_processing_unavailable:'This browser could not prepare the image.'
  };
  const fail=code=>{throw Object.assign(new Error(messages[code]),{code});};
  const invalid=()=>fail('invalid_image');
  function dimensions(width,height){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)invalid();
    if(width>MAX_AXIS||height>MAX_AXIS||width*height>MAX_PIXELS)fail('image_dimensions_exceeded');
    return {width,height};
  }
  const ascii=(bytes,offset,length)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
  const u24=(bytes,offset)=>bytes[offset]+bytes[offset+1]*256+bytes[offset+2]*65536;
  function png(bytes,view){
    if(bytes.length<33||ascii(bytes,0,8)!=='\x89PNG\r\n\x1a\n'||view.getUint32(8)!==13||ascii(bytes,12,4)!=='IHDR')invalid();
    const size=dimensions(view.getUint32(16),view.getUint32(20));
    let offset=8,hasData=false;
    while(offset+12<=bytes.length){
      const length=view.getUint32(offset),type=ascii(bytes,offset+4,4),data=offset+8,end=data+length;
      if(end+4>bytes.length)invalid();
      if(type==='IHDR'&&offset!==8)invalid();
      if(['acTL','fcTL','fdAT'].includes(type))fail('animated_image_unsupported');
      if(type==='IDAT')hasData=true;
      if(type==='IEND'){
        if(length!==0||!hasData||end+4!==bytes.length)invalid();
        return size;
      }
      offset=end+4;
    }
    invalid();
  }
  function jpeg(bytes,view){
    if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)invalid();
    let offset=2,size;
    while(offset<bytes.length-2){
      if(bytes[offset++]!==255)invalid();
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===undefined||marker===0||marker===216||marker===217||offset+2>bytes.length)invalid();
      const length=view.getUint16(offset),end=offset+length;
      if(length<2||end>bytes.length-2)invalid();
      if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
        if(length<8||length!==8+3*bytes[offset+7]||size)invalid();
        size=dimensions(view.getUint16(offset+5),view.getUint16(offset+3));
      }
      if(marker===218){if(!size||end>=bytes.length-2)invalid();return size;}
      offset=end;
    }
    invalid();
  }
  function webpImage(bytes,view,type,data,length){
    if(type==='VP8 '){
      if(length<10||(bytes[data]&1)||ascii(bytes,data+3,3)!=='\x9d\x01\x2a')invalid();
      return dimensions(view.getUint16(data+6,true)&16383,view.getUint16(data+8,true)&16383);
    }
    if(type==='VP8L'){
      if(length<5||bytes[data]!==47||(bytes[data+4]>>5)!==0)invalid();
      const bits=view.getUint32(data+1,true);
      return dimensions((bits&16383)+1,((bits>>>14)&16383)+1);
    }
    return null;
  }
  function webp(bytes,view){
    if(bytes.length<20||ascii(bytes,0,4)!=='RIFF'||ascii(bytes,8,4)!=='WEBP'||view.getUint32(4,true)+8!==bytes.length)invalid();
    let offset=12,canvas,image;
    while(offset+8<=bytes.length){
      const type=ascii(bytes,offset,4),length=view.getUint32(offset+4,true),data=offset+8,end=data+length;
      if(end+(length&1)>bytes.length)invalid();
      if(type==='VP8X'){
        if(offset!==12||length!==10)invalid();
        if(bytes[data]&2)fail('animated_image_unsupported');
        canvas=dimensions(u24(bytes,data+4)+1,u24(bytes,data+7)+1);
      }else if(type==='ANIM'||type==='ANMF'){
        fail('animated_image_unsupported');
      }else{
        const found=webpImage(bytes,view,type,data,length);
        if(found){if(image)invalid();image=found;}
      }
      offset=end+(length&1);
    }
    if(offset!==bytes.length||!image)invalid();
    if(canvas&&image&&(canvas.width!==image.width||canvas.height!==image.height))invalid();
    return canvas||image;
  }
  function inspect(bytes,type){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(type==='image/png')return png(bytes,view);
    if(type==='image/jpeg')return jpeg(bytes,view);
    if(type==='image/webp')return webp(bytes,view);
    fail('unsupported_image_type');
  }
  function encode(canvas,type,quality=0.9){
    return new Promise(resolve=>{try{canvas.toBlob(resolve,type,quality);}catch{resolve(null);}});
  }
  // Steps quality, then dimensions, down until the derivative fits. A type the browser cannot
  // write comes back as PNG and is skipped; PNG may become lossy WebP, which keeps transparency.
  async function fit(canvas,context,bitmap,size,type){
    const types={'image/png':['image/png','image/webp'],'image/webp':['image/webp','image/png'],'image/jpeg':['image/jpeg']}[type];
    for(let step=0,scale=1;step<10;step++,scale*=0.8){
      const width=Math.max(1,Math.round(size.width*scale)),height=Math.max(1,Math.round(size.height*scale));
      canvas.width=width;canvas.height=height;context.imageSmoothingQuality='high';context.drawImage(bitmap,0,0,width,height);
      for(const candidate of types)for(const quality of candidate==='image/png'?[1]:[0.9,0.8,0.7]){
        const output=await encode(canvas,candidate,quality);
        if(output?.type===candidate&&output.size&&output.size<=MAX_BYTES)return {output,width,height};
      }
    }
    fail('image_output_too_large');
  }
  async function prepare(file){
    if(!(file instanceof root.Blob)||!file.size)invalid();
    if(file.size>MAX_INPUT_BYTES)fail('image_too_large');
    if(!TYPES.has(file.type))fail('unsupported_image_type');
    let bytes;
    try{bytes=new Uint8Array(await file.arrayBuffer());}catch{invalid();}
    // Encoded dimensions are bounded before allocating decoded pixels.
    const source=inspect(bytes,file.type);
    if(typeof root.createImageBitmap!=='function'||!root.document)fail('image_processing_unavailable');
    let bitmap,canvas;
    try{
      try{bitmap=await root.createImageBitmap(file,{imageOrientation:'from-image'});}catch{invalid();}
      const size=dimensions(bitmap.width,bitmap.height);
      if(!((size.width===source.width&&size.height===source.height)||(size.width===source.height&&size.height===source.width)))invalid();
      canvas=root.document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
      const context=canvas.getContext('2d',{alpha:true});
      if(!context||typeof canvas.toBlob!=='function')fail('image_processing_unavailable');
      const {output,width,height}=await fit(canvas,context,bitmap,size,file.type);
      if(!output||!output.size||!TYPES.has(output.type))fail('image_processing_unavailable');
      const retained=inspect(new Uint8Array(await output.arrayBuffer()),output.type);
      if(retained.width!==width||retained.height!==height)fail('image_processing_unavailable');
      const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[output.type];
      return {file:new root.File([output],'contribution-image.'+extension,{type:output.type}),width,height,sourceWidth:size.width,sourceHeight:size.height,resized:width!==size.width,metadataRemoved:true,inputType:file.type,outputType:output.type,usedPngFallback:output.type==='image/png'&&file.type!=='image/png'};
    }catch(error){
      if(Object.prototype.hasOwnProperty.call(messages,error?.code))throw error;
      fail('image_processing_unavailable');
    }finally{
      bitmap?.close();
      if(canvas){canvas.width=0;canvas.height=0;}
    }
  }
  root.ContributionImage=Object.freeze({prepare});
})(typeof window!=='undefined'?window:globalThis);
