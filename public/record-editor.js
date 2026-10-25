'use strict';
(() => {
  const byId=id=>document.getElementById(id),model=window.RecordEditModel;
  const dialog=byId('recordEditorDialog'),form=byId('recordEditorForm'),fieldsRoot=byId('recordEditorFields');
  const message=byId('recordChangeMessage'),previewRoot=byId('recordEditorPreview'),submit=byId('submitRecordEdit');
  const drafts=new Map();let current=null,opener=null,statusVersion=0,editorGeneration=0;
  const pendingStorageKey='hauntologies-pending-record-edit';
  const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const copy=value=>structuredClone(value),inputId=key=>'record-edit-'+key.replace(/[^a-zA-Z0-9_-]/g,'-');
  const display=value=>value===null||value===undefined?'':typeof value==='string'?value:typeof value==='object'?JSON.stringify(value):String(value);
  const safeUrl=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
  function persistPending(state){
    const changedKeys=new Set(JSON.parse(state.pending.body.submission_json).payload.changes.map(change=>change.field));
    // Keep this proposal only, not the original record, other revisions or review history.
    const value=JSON.stringify({version:1,request:state.pending,title:state.title,fields:state.fields.filter(field=>changedKeys.has(field.key))});
    sessionStorage.setItem(pendingStorageKey+':'+state.pending.actor_id,value);
    if(sessionStorage.getItem(pendingStorageKey+':'+state.pending.actor_id)!==value)throw new Error('Request recovery unavailable');
  }
  function clearPending(state){const actor=state.pending?.actor_id||state.actor_id;state.pending=null;state.pendingUncertain=false;try{sessionStorage.removeItem(pendingStorageKey+':'+actor);}catch{}}
  function restorePending(actor){
    try{
      const stored=JSON.parse(sessionStorage.getItem(pendingStorageKey+':'+actor)||sessionStorage.getItem(pendingStorageKey)||'null'),request=stored?.request,body=request?.body;
      if(stored?.version!==1||!['/submit','/revise'].includes(request?.path)||typeof body?.idempotency_key!=='string'||!body.idempotency_key||typeof body.submission_json!=='string')return null;
      if(request.path==='/revise'&&(typeof body.submission_id!=='string'||!Number.isInteger(body.expected_revision)||body.expected_revision<1))return null;
      if(request.actor_id!==actor)return null;
      const original=JSON.parse(body.submission_json),target=original.targets?.[0],changes=original.payload?.changes;
      if(original.type!=='record_update'||original.targets.length!==1||typeof target?.record_id!=='string'||!Array.isArray(changes)||typeof original.payload.change_message!=='string'||!Array.isArray(stored.fields))return null;
      const keys=new Set(changes.map(change=>change.field));
      if(stored.fields.some(field=>!field||typeof field.key!=='string'||!keys.has(field.key)||typeof field.label!=='string'||!['Place','Location','Dates','Sources','Image'].includes(field.group)))return null;
      const before=Object.fromEntries(changes.map(change=>[change.field,copy(change.before)])),state={id:target.record_id,title:typeof stored.title==='string'?stored.title:target.record_id,before,fields:stored.fields,message:original.payload.change_message,rawValues:{},dirty:new Set(keys),controls:new Map(),initial:new Map(),target:copy(target),lastTarget:copy(target),lookup:0,loading:false,sourceChoice:'primary',pending:copy(request),pendingUncertain:true,proposedValues:new Map(),proposedDisplays:new Map(),additions:(original.payload.source_additions||[]).map(value=>({value:copy(value),original:copy(value),removable:false})),preview:{changes:copy(changes),raw:body.submission_json,serverValid:false}};
      if(request.path==='/revise')state.revisionOf={id:body.submission_id,revision:body.expected_revision};
      for(const change of changes){state.rawValues[change.field]=display(change.after);state.proposedValues.set(change.field,copy(change.after));}
      return state;
    }catch{return null;}
  }
  function validateReceipt(data,request){
    const saved=data?.submission,receipt=data?.receipt,result=receipt?.result,revision=request.path==='/revise'?request.body.expected_revision+1:1;
    if(typeof receipt?.id!=='string'||!receipt.id||receipt.action!==request.path.slice(1)||typeof saved?.id!=='string'||result?.submission_id!==saved.id||result.revision!==revision||!Number.isInteger(saved.revision)||saved.revision<revision||request.path==='/revise'&&saved.id!==request.body.submission_id)throw Object.assign(new Error('Save receipt could not be confirmed'),{uncertain:true});
    return data;
  }
  function status(text){statusVersion++;byId('recordEditorStatus').textContent=text;}
  async function accessActions(state){
    const version=statusVersion,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    if(!state.pending&&!state.target)byId('reloadRecordEditor').hidden=true;
    try{
      const response=await fetch('/api/access-status',{credentials:'same-origin',cache:'no-store',signal:controller.signal}),access=await response.json();
      if(current!==state||version!==statusVersion||!response.ok)return;
      if(access?.enabled===false){byId('recordEditorStatus').textContent=state.pending?'Save outcome unknown. Sign-in is not enabled yet':'Sign-in is not enabled yet';return;}
      if(access?.enabled!==true||access.sign_in_url!=='/api/contributions/sign-in')return;
      byId('recordEditorStatus').textContent=state.pending?'Save outcome unknown. Sign in to retry':'Sign in to submit';
      const link=node('a','Sign in');link.href=access.sign_in_url;link.target='_blank';link.rel='noopener noreferrer';
      byId('recordEditorStatus').append(document.createTextNode(' '),link);
      if(!state.pending&&!state.target&&!state.loading&&!state.busy)byId('reloadRecordEditor').hidden=false;
    }catch{}finally{clearTimeout(timeout);}
  }
  function serviceStatus(state,error,text=serviceError(error)){
    state.unavailableStatus=error.status;status(text);
    byId('reloadRecordEditor').hidden=!!state.pending||!!state.target||!!state.loading||error.status===401||error.status===403;
    if(state.pending)byId('recordEditorPreviewMode').hidden=true;
    if(error.status===401)accessActions(state);
  }
  function changed(){if(!current||current.pending)return;current.preview=null;previewRoot.hidden=true;byId('recordEditorReceipt').hidden=true;submit.disabled=true;}
  function errors(items=[]){
    const root=byId('recordEditorErrors');root.replaceChildren();root.hidden=!items.length;
    form.querySelectorAll('[aria-invalid]').forEach(n=>n.removeAttribute('aria-invalid'));
    if(!items.length)return;
    const list=node('ul');for(const error of items){
      const item=typeof error==='string'?{message:error}:error,li=node('li');let field=item.field?.replace(/^payload\./,'');
      const change=field?.match(/(?:payload\.)?changes\.(\d+)/);if(change)field=current?.lastChanges?.[Number(change[1])]?.field;
      if(/^source_additions\.\d+$/.test(field))field+='.title';
      if(field==='geometry')field='latitude';if(field==='dates')field='date_start';
      const control=field==='change_message'?message:current?.controls.get(field);
      if(control){control.setAttribute('aria-invalid','true');const link=node('a',item.message);link.href='#'+control.id;link.addEventListener('click',event=>{event.preventDefault();reveal(control);control.focus();});li.append(link);}else li.textContent=item.message||'Check the proposed changes';list.append(li);
    }root.append(list);if(dialog.open)root.focus();
  }
  function reveal(control){
    const reference=control.closest('[data-edit-source]');if(reference?.hidden){byId('recordEditSource').value=reference.dataset.editSource;selectSource();}
    let parent=control.parentElement;while(parent&&parent!==dialog){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
  }
  function selectSource(){const value=byId('recordEditSource')?.value||'primary';fieldsRoot.querySelectorAll('[data-edit-source]').forEach(n=>n.hidden=n.dataset.editSource!==value);if(current)current.sourceChoice=value;}
  function lock(){
    if(!current)return;const disabled=!!(current.busy||current.pending||current.saved);
    form.querySelectorAll('input,select,textarea,button').forEach(n=>n.disabled=disabled);
    const add=byId('recordAddSource');if(add)add.disabled=disabled||current.additions.length>=model.maxSourceAdditions;
    byId('reloadRecordEditor').disabled=disabled;form.setAttribute('aria-busy',String(!!current.busy));
    submit.disabled=!!current.busy||!!current.saved||(!current.pending&&!current.preview?.serverValid);
    submit.textContent=current.pending?'Confirm save':current.revisionOf?'Revise':'Contribute';
  }
  function makeControl(field,state){
    const wrap=node('div'),label=node('label',field.label),control=node(field.type==='textarea'?'textarea':field.options?'select':'input');
    control.id=inputId(field.key);control.dataset.editField=field.key;label.htmlFor=control.id;
    if(field.options){
      control.append(new Option('Unknown',''));
      for(const option of field.options){const value=typeof option==='string'?option:option.value;control.append(new Option(typeof option==='string'?option:option.label,value));}
      const original=display(state.before[field.key]);if(original&&![...control.options].some(o=>o.value===original))control.append(new Option(original,original));
    }else if(field.type==='textarea')control.rows=3;
    else{control.type=['url','number'].includes(field.type)?field.type:'text';if(field.type==='number')control.step='any';}
    if(field.maxLength)control.maxLength=field.maxLength;
    control.value=display(state.before[field.key]);state.initial.set(field.key,control.value);
    if(Object.hasOwn(state.rawValues,field.key))control.value=state.rawValues[field.key];
    if(state.proposedValues?.has(field.key)&&!state.proposedDisplays.has(field.key))state.proposedDisplays.set(field.key,control.value);
    state.controls.set(field.key,control);label.append(control);wrap.append(label);
    let viewLink;
    if(field.type==='url'){
      viewLink=node('a',field.group==='Image'?'View image source':'View source');viewLink.className='record-edit-link';viewLink.target='_blank';viewLink.rel='noopener noreferrer';wrap.append(viewLink);
      const update=()=>{const url=safeUrl(control.value);viewLink.hidden=!url;if(url)viewLink.href=url;else viewLink.removeAttribute('href');};update();control.addEventListener('input',update);
    }
    control.addEventListener('input',()=>{state.rawValues[field.key]=control.value;state.dirty.add(field.key);changed();});
    control.addEventListener('change',()=>{state.rawValues[field.key]=control.value;state.dirty.add(field.key);changed();});
    return wrap;
  }
  function additionControl(field,state,index){
    const entry=state.additions[index],key='source_additions.'+index+'.'+field.key;
    const wrap=node('div'),label=node('label',field.key==='url'?'URL':field.label[0].toUpperCase()+field.label.slice(1)),control=node(field.type==='textarea'?'textarea':'input');
    control.id='record-addition-'+index+'-'+field.key;control.dataset.editField=key;label.htmlFor=control.id;
    if(field.type==='textarea')control.rows=3;else control.type=field.type==='url'?'url':'text';
    if(field.maxLength)control.maxLength=field.maxLength;control.value=display(entry.value[field.key]);
    state.controls.set(key,control);label.append(control);wrap.append(label);
    const update=()=>{
      if(control.value===display(entry.original[field.key])){if(Object.hasOwn(entry.original,field.key))entry.value[field.key]=copy(entry.original[field.key]);else delete entry.value[field.key];}
      else entry.value[field.key]=control.value;
      changed();
    };
    control.addEventListener('input',update);control.addEventListener('change',update);return wrap;
  }
  const sourceAdditions=state=>state.additions.map(entry=>copy(entry.value));
  function addSource(state){
    if(state.busy||state.pending||state.saved||state.additions.length>=model.maxSourceAdditions)return;
    state.additions.push({value:{},original:{},removable:true});state.sourceChoice='new:'+(state.additions.length-1);
    state.openGroups=[...new Set([...(state.openGroups||['Place']),'Sources'])];changed();renderFields(state);lock();state.controls.get('source_additions.'+(state.additions.length-1)+'.title')?.focus();
  }
  function renderFields(state){
    fieldsRoot.replaceChildren();state.controls=new Map();state.initial=new Map();
    for(const group of ['Place','Location','Dates','Sources','Image']){
      const details=node('details'),summary=node('summary',group),body=node('div');details.dataset.editGroup=group;details.open=state.openGroups?.includes(group)??group==='Place';body.className='record-edit-group';details.append(summary,body);
      const fields=state.fields.filter(field=>field.group===group);
      if(group==='Sources'){
        const refs=[...new Set(fields.filter(f=>f.sourceIndex!==undefined).map(f=>f.sourceIndex))];
        const select=node('select');select.id='recordEditSource';select.append(new Option('Primary','primary'));for(const index of refs)select.append(new Option('Reference '+(index+1),String(index)));
        state.additions.forEach((_,index)=>select.append(new Option('New reference '+(index+1),'new:'+index)));
        const label=node('label','Reference');label.htmlFor=select.id;label.append(select);body.append(label);select.addEventListener('change',selectSource);
        const add=node('button','Add');add.id='recordAddSource';add.type='button';add.className='outline record-source-action';add.addEventListener('click',()=>addSource(state));body.append(add);
        for(const value of ['primary',...refs.map(String)]){const subset=node('div');subset.className='record-edit-group';subset.dataset.editSource=value;subset.hidden=value!==(state.sourceChoice||'primary');for(const field of fields.filter(f=>value==='primary'?f.sourceIndex===undefined:String(f.sourceIndex)===value))subset.append(makeControl(field,state));body.append(subset);}
        state.additions.forEach((entry,index)=>{
          const subset=node('div');subset.className='record-edit-group';subset.dataset.editSource='new:'+index;
          const more=node('details'),moreFields=node('div');more.append(node('summary','Details'),moreFields);moreFields.className='record-edit-group';
          for(const key of ['title','url','citation'])subset.append(additionControl(model.sourceFields.find(field=>field.key===key),state,index));
          for(const field of model.sourceFields.filter(field=>!['title','url','citation'].includes(field.key)))moreFields.append(additionControl(field,state,index));
          subset.append(more);
          if(entry.removable){const remove=node('button','Remove');remove.type='button';remove.className='outline record-source-action';remove.dataset.removeSourceAddition=String(index);remove.addEventListener('click',()=>{
            state.additions.splice(index,1);state.sourceChoice='primary';changed();renderFields(state);lock();byId('recordAddSource').focus();
          });subset.append(remove);}
          body.append(subset);
        });
        select.value=[...select.options].some(o=>o.value===state.sourceChoice)?state.sourceChoice:'primary';
      }else for(const field of fields)body.append(makeControl(field,state));
      details.addEventListener('toggle',()=>{state.openGroups=[...fieldsRoot.querySelectorAll('details[open]')].map(n=>n.dataset.editGroup);});fieldsRoot.append(details);
    }
    selectSource();
  }
  function renderState(state){
    const focusedKey=document.activeElement?.dataset?.editField,selection=document.activeElement?.selectionStart;
    byId('recordEditorName').textContent=state.title;message.value=state.message;renderFields(state);
    const focused=state.controls.get(focusedKey);if(dialog.open&&focused){reveal(focused);focused.focus();if(typeof selection==='number'&&typeof focused.setSelectionRange==='function'&&!['number','select'].includes(focused.type)){try{focused.setSelectionRange(selection,selection);}catch{}}}
    byId('recordEditorReceipt').hidden=!state.saved;
    previewRoot.hidden=true;errors([]);status(state.pending?'Save outcome unknown':state.loading?'Loading current record…':state.target?(state.stale?'Record changed. Preview your changes again':''):state.unavailable||'Local preview');
    byId('reloadRecordEditor').hidden=!!state.pending||!!state.target||!!state.loading||state.unavailableStatus===401||state.unavailableStatus===403;
    if(state.unavailableStatus===401&&!state.loading)accessActions(state);
    if(state.preview)renderPreview(state,state.preview.changes,state.preview.serverValid);
    if(state.saved)renderReceipt(state.saved);lock();
  }
  async function api(path,body){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/contributions'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json',...(current?.actor_id?{'X-Hauntologies-Actor':current.actor_id}:{})}:undefined,body:body?JSON.stringify(body):undefined,signal:controller.signal});
      let data;try{data=await response.json();}catch{throw Object.assign(new Error('Unreadable response'),{status:response.status,uncertain:true});}
      if(!response.ok)throw Object.assign(new Error(typeof data.error==='string'?data.error:'Request failed'),{status:response.status});return data;
    }finally{clearTimeout(timeout);}
  }
  function serviceError(error){return error.message==='revision_conflict'?'Submission changed. Open its latest revision from Review':error.status===400?'Check the proposed changes':error.status===401?'Submissions unavailable':error.status===403?'Submission not permitted':error.status===409?'Record changed. Reload before submitting':'Could not load the submission service';}
  async function loadTarget(state){
    if(state.pending||state.busy||state.saved)return;const token=++state.lookup;state.loading=true;state.target=null;state.preview=null;
    if(current===state){status('Loading current record…');byId('reloadRecordEditor').hidden=true;previewRoot.hidden=true;lock();}
    try{
      const data=await api('/target?id='+encodeURIComponent(state.id)),target=data.target;
      if(token!==state.lookup)return;
      if(!target||target.record_id!==state.id||!Number.isInteger(target.expected_version)||typeof target.expected_hash!=='string'||!target.expected_hash)throw new Error('Invalid reference');
      const before=model.snapshot(target),fields=model.fieldsFor?model.fieldsFor(target):model.fields;
      if([...state.dirty].some(key=>!Object.hasOwn(before,key)))throw Object.assign(new Error('Source field changed'),{status:409});
      const binding={record_id:target.record_id,expected_version:target.expected_version,expected_hash:target.expected_hash};
      const bindingChanged=state.lastTarget&&(state.lastTarget.expected_version!==binding.expected_version||state.lastTarget.expected_hash!==binding.expected_hash);
      const baselineChanged=[...state.dirty].some(key=>JSON.stringify(state.before[key])!==JSON.stringify(before[key]));
      state.stale=!!(state.stale||bindingChanged||baselineChanged);state.lastTarget=copy(binding);state.target=binding;state.before=before;state.fields=fields;state.original=copy(target.record);state.title=target.title||state.title;state.unavailable='';state.unavailableStatus=null;
      for(const key of Object.keys(state.rawValues))if(!state.dirty.has(key))delete state.rawValues[key];
    }catch(error){if(token!==state.lookup)return;state.unavailable=serviceError(error);state.unavailableStatus=error.status;}
    finally{if(token===state.lookup){state.loading=false;if(current===state)renderState(state);}}
  }
  function afterValues(state){
    const after=copy(state.before);
    for(const field of state.fields){const control=state.controls.get(field.key);if(!state.dirty.has(field.key))continue;
      if(state.proposedValues?.has(field.key)&&control.value===state.proposedDisplays.get(field.key)){after[field.key]=copy(state.proposedValues.get(field.key));continue;}
      if(control.value===state.initial.get(field.key))continue;
      after[field.key]=control.value===''&&field.nullable?null:field.type==='number'?Number(control.value):control.value;
    }return after;
  }
  function proposedChanges(state){
    const changes=model.changes(state.before,afterValues(state)),prior=state.revisionOriginal?.payload.changes||[];
    return [...prior.map(old=>changes.find(change=>change.field===old.field)).filter(Boolean),...changes.filter(change=>!prior.some(old=>old.field===change.field))];
  }
  function envelope(state,changes){
    const value=state.revisionOriginal?copy(state.revisionOriginal):{schema_version:'1.0',type:'record_update',title:'Record update',summary:'',task_ids:[],public_credit:{consent:false,label:''},sources:[],attachments:[],targets:[],payload:{}};
    value.summary=state.message;value.targets=state.target?[copy(state.target)]:[];value.payload.change_message=state.message;value.payload.changes=copy(changes);
    if(state.additions.length||Object.hasOwn(value.payload,'source_additions'))value.payload.source_additions=sourceAdditions(state);
    return value;
  }
  function renderPreview(state,changes,serverValid){
    const root=byId('recordEditorDiff');root.replaceChildren();
    for(const change of changes){const section=node('section'),title=state.fields.find(f=>f.key===change.field)?.label||change.field;section.className='record-edit-diff';section.append(node('h4',title));const dl=node('dl');for(const [label,value]of [['Before',change.before],['After',change.after]])dl.append(node('dt',label),node('dd',value===null?'Unknown':display(value)));section.append(dl);root.append(section);}
    sourceAdditions(state).forEach((source,index)=>{const section=node('section'),dl=node('dl');section.className='record-edit-diff';section.append(node('h4','New reference '+(index+1)));dl.append(node('dt','Before'),node('dd','No reference'));for(const field of model.sourceFields)if(Object.hasOwn(source,field.key))dl.append(node('dt',field.label[0].toUpperCase()+field.label.slice(1)),node('dd',source[field.key]===null?'Unknown':display(source[field.key])));section.append(dl);root.append(section);});
    byId('recordEditorPreviewMode').textContent=serverValid?'Ready to submit':'Local preview';byId('recordEditorPreviewMode').hidden=!!state.pending;previewRoot.hidden=false;lock();
  }
  async function preview(event){
    event.preventDefault();const state=current;if(!state||state.pending||state.busy||state.saved)return;errors([]);
    const invalidNumbers=state.fields.filter(field=>field.type==='number'&&state.controls.get(field.key).validity.badInput).map(field=>({field:field.key,message:'Enter a number or leave this field blank'}));if(invalidNumbers.length){errors(invalidNumbers);return;}
    const changes=proposedChanges(state);state.lastChanges=changes;
    const validation=model.validateChanges(changes,{snapshot:state.before,change_message:state.message,source_additions:sourceAdditions(state)});
    if(!validation.valid){errors(validation.errors);return;}
    const raw=JSON.stringify(envelope(state,changes),null,2);state.preview={changes,raw,serverValid:false};renderPreview(state,changes,false);
    if(!state.target){status(state.loading?'Loading current record…':state.unavailable||'Submissions unavailable');if(state.unavailableStatus===401&&!state.loading)accessActions(state);previewRoot.focus();return;}
    state.busy=true;lock();
    try{const result=await api('/preview',{submission_json:raw,...(state.revisionOf?{submission_id:state.revisionOf.id,expected_revision:state.revisionOf.revision}:{})});if(current!==state)return;
      state.preview.serverValid=result.preview?.validation?.valid===true;
      if(!state.preview.serverValid){
        const issues=result.preview?.validation?.errors||['The proposal could not be validated'];
        if(issues.some(issue=>['stale_target','forged_before','update_target_not_found'].includes(issue.code))){state.target=null;state.stale=true;state.unavailable='Record changed. Reload before submitting';status(state.unavailable);byId('reloadRecordEditor').hidden=false;}
        errors(issues);
      }
      else{state.stale=false;status('');renderPreview(state,changes,true);previewRoot.focus();}
    }catch(error){state.target=null;state.unavailable=serviceError(error);if(current===state)serviceStatus(state,error);}
    finally{state.busy=false;if(current===state)lock();}
  }
  // Says what happens next in plain terms; the identifiers stay available for support.
  function renderReceipt(data){
    const root=byId('recordEditorReceipt'),saved=data.submission,revision=data.receipt.result.revision;
    const next=saved.status==='changes_requested'?'Sent back. Revise it and submit again.':saved.status==='approved'?'Approved. It replaces the place on the map once a publisher verifies it.':'Waiting for a reviewer. Once approved and published, your edit replaces the place on the map.';
    const view=node('button','View status');view.type='button';view.className='textbutton';
    view.addEventListener('click',()=>{dialog?.close?.();window.dispatchEvent(new CustomEvent('contributions-review-requested',{detail:{submissionId:saved.id}}));});
    root.replaceChildren();const reference=node('p','Reference '+saved.id+(revision>1?', revision '+revision:''));reference.className='submission-ref';
    root.append(node('h3',revision>1?'Revision sent for review':'Sent for review'),node('p',next),view,reference);
    root.hidden=false;
  }
  async function send(){
    const state=current;if(!state||state.busy||state.saved||(!state.pending&&!state.preview?.serverValid))return;
    if(state.pending&&(typeof state.pending.actor_id!=='string'||!state.pending.actor_id)){errors([]);status('Original account unknown');return;}
    state.busy=true;lock();errors([]);let actor;
    try{
      const session=await api('/session');actor=session?.actor_id;
      if(typeof actor!=='string'||!actor||actor.length>200)throw new Error('Invalid session');
    }catch(error){state.busy=false;if(current===state){serviceStatus(state,error);lock();}return;}
    if(current!==state||state.actor_id!==actor||state.pending&&state.pending.actor_id!==actor){state.busy=false;if(current===state){status('Original account required');lock();}return;}
    if(!state.pending){const now=JSON.stringify(envelope(state,proposedChanges(state)),null,2);if(now!==state.preview.raw){state.busy=false;changed();lock();status('Changes updated. Preview again');return;}
      const body={idempotency_key:crypto.randomUUID(),submission_json:state.preview.raw};if(state.revisionOf)Object.assign(body,{submission_id:state.revisionOf.id,expected_revision:state.revisionOf.revision});
      state.pending={path:state.revisionOf?'/revise':'/submit',body,actor_id:actor};
      try{persistPending(state);}catch{clearPending(state);state.busy=false;lock();status('Request not sent. Browser recovery storage is unavailable');return;}
    }
    const exact=state.pending,wasUncertain=!!state.pendingUncertain;
    try{
      const data=validateReceipt(await api(exact.path,exact.body),exact),saved=data.submission;
      state.saved=data;clearPending(state);state.preview=null;const confirmed=await api('/session');if(current!==state||confirmed.actor_id!==state.actor_id)return;
      if(current===state){previewRoot.hidden=true;status('');renderReceipt(data);byId('recordEditorReceipt').focus();}
      window.dispatchEvent(new CustomEvent('record-edit-saved',{detail:{submissionId:saved.id,revision:saved.revision}}));
    }catch(error){
      const uncertain=wasUncertain||error.uncertain||!error.status||error.status>=500;
      if(uncertain)state.pendingUncertain=true;
      else{clearPending(state);if(error.status===401||error.status===403||error.status===409){state.target=null;if(state.preview)state.preview.serverValid=false;state.unavailable=serviceError(error);byId('reloadRecordEditor').hidden=false;}}
      if(current===state)serviceStatus(state,error,uncertain?'Save outcome unknown':serviceError(error));
    }finally{state.busy=false;if(current===state)lock();}
  }

  window.addEventListener('record-edit-requested',async event=>{
    const generation=++editorGeneration;let actor;try{actor=(await api('/session')).actor_id;}catch{window.dispatchEvent(new CustomEvent('account-open-requested'));return;}if(generation!==editorGeneration||typeof actor!=='string')return;
    const {recordId,record,opener:source}=event.detail||{};if(!model||typeof recordId!=='string'||!record)return;
    opener=source instanceof HTMLElement?source:document.activeElement;
    const restored=restorePending(actor);if(restored&&!drafts.has(actor+':pending'))drafts.set(actor+':pending',restored);
    const pending=[...drafts.values()].find(state=>state.pending&&state.pending.actor_id===actor);
    let state=pending||drafts.get(actor+':'+recordId);
    if(!state||state.saved){state={id:recordId,title:record.title||recordId,original:copy(record),before:model.snapshot(record),fields:model.fieldsFor?model.fieldsFor(record):model.fields,message:'',rawValues:{},dirty:new Set(),controls:new Map(),initial:new Map(),additions:[],target:null,lookup:0,loading:false,sourceChoice:'primary'};drafts.set(actor+':'+recordId,state);}
    state.actor_id=actor;current=state;renderState(state);if(!dialog.open)dialog.showModal();
    if(state.pending){submit.focus();return;}
    message.focus();loadTarget(state);
  });
  window.addEventListener('record-edit-revision-requested',async event=>{
    const generation=++editorGeneration;let actor;try{actor=(await api('/session')).actor_id;}catch{window.dispatchEvent(new CustomEvent('account-open-requested'));return;}if(generation!==editorGeneration||typeof actor!=='string')return;
    const {submission,opener:source}=event.detail||{};let original;
    try{original=JSON.parse(submission.raw_json);}catch{return;}
    const target=submission.proposal?.target,recordId=original.targets?.[0]?.record_id;
    if(!model||original.type!=='record_update'||!target?.record||target.record_id!==recordId||!Number.isInteger(submission.revision))return;
    opener=source instanceof HTMLElement?source:document.activeElement;
    const key=actor+':revision:'+submission.id+':'+submission.revision,pending=[...drafts.values()].find(state=>state.pending&&state.pending.actor_id===actor)||restorePending(actor);
    let state=pending||drafts.get(key);
    if(!state||state.saved){
      state={id:recordId,title:target.title||recordId,original:copy(target.record),before:copy(submission.proposal.editable_before||model.snapshot(target)),fields:model.fieldsFor?model.fieldsFor(target):model.fields,message:original.payload.change_message,rawValues:{},dirty:new Set(),controls:new Map(),initial:new Map(),target:null,lastTarget:copy(original.targets[0]),lookup:0,loading:false,sourceChoice:'primary',revisionOf:{id:submission.id,revision:submission.revision},revisionOriginal:copy(original),originalRaw:submission.raw_json,proposedValues:new Map(),proposedDisplays:new Map(),additions:(original.payload.source_additions||[]).map(value=>({value:copy(value),original:copy(value),removable:false}))};
      for(const change of original.payload.changes){state.rawValues[change.field]=display(change.after);state.dirty.add(change.field);state.proposedValues.set(change.field,copy(change.after));}
      drafts.set(key,state);
    }
    state.actor_id=actor;current=state;renderState(state);if(!dialog.open)dialog.showModal();
    if(state.pending){submit.focus();return;}
    message.focus();loadTarget(state);
  });
  function hidePrivateEditor(){editorGeneration++;if(current)current.lookup++;current=null;fieldsRoot.replaceChildren();message.value='';previewRoot.hidden=true;byId('recordEditorDiff').replaceChildren();byId('recordEditorPreviewMode').textContent='';submit.disabled=true;byId('recordEditorReceipt').replaceChildren();status('');if(dialog.open)dialog.close();}
  window.addEventListener('contributions-session-ended',hidePrivateEditor);
  window.addEventListener('focus',async()=>{if(current){const state=current;try{const session=await api('/session');if(current===state&&session.actor_id!==state.actor_id)hidePrivateEditor();}catch{if(current===state)hidePrivateEditor();}}});
  message.addEventListener('input',()=>{if(current){current.message=message.value;changed();}});
  form.addEventListener('submit',preview);submit.addEventListener('click',send);
  byId('reloadRecordEditor').addEventListener('click',()=>current&&loadTarget(current));
  byId('closeRecordEditor').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab'||event.ctrlKey||event.altKey||event.metaKey||!dialog.open)return;
    const controls=[...dialog.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')].filter(control=>{
      if(control.tabIndex<0||control.matches(':disabled')||control.closest('[hidden],[inert]')||!control.getClientRects().length||getComputedStyle(control).visibility==='hidden')return false;
      for(let parent=control.parentElement;parent&&parent!==dialog;parent=parent.parentElement){
        if(parent.tagName==='DETAILS'&&!parent.open&&!parent.querySelector(':scope > summary')?.contains(control))return false;
      }
      return true;
    });
    if(!controls.length)return;
    const active=document.activeElement,index=controls.indexOf(active);let next;
    if(index>=0)next=controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length];
    else{
      const following=controls.filter(control=>active.compareDocumentPosition(control)&(event.shiftKey?Node.DOCUMENT_POSITION_PRECEDING:Node.DOCUMENT_POSITION_FOLLOWING));
      next=(event.shiftKey?following.at(-1):following[0])||controls[event.shiftKey?controls.length-1:0];
    }
    event.preventDefault();next.focus();
  });
  dialog.addEventListener('focusin',event=>{
    const target=event.target;if(!(target instanceof HTMLElement)||target.closest('.popout-head'))return;
    requestAnimationFrame(()=>{
      if(document.activeElement!==target||!dialog.open)return;
      const box=target.getBoundingClientRect(),view=dialog.getBoundingClientRect(),head=dialog.querySelector('.popout-head').getBoundingClientRect();
      const top=Math.max(view.top+12,head.bottom+12),bottom=Math.min(view.bottom-12,innerHeight-12);
      if(box.top<top)dialog.scrollTop+=box.top-top;
      else if(box.bottom>bottom)dialog.scrollTop+=box.height>bottom-top?box.top-top:box.bottom-bottom;
    });
  });
  dialog.addEventListener('close',()=>{const target=opener?.isConnected&&opener.getClientRects().length?opener:byId('mapToolsButton');target?.focus({preventScroll:true});});
})();
