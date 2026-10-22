/* Private contribution workspace. The server owns identity, revisions and decisions. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  if (!byId('contributionWorkspace')) return;
  const apiRoot = '/api/contributions';
  const removedTaskIds = new Set(['HNY-012','HNY-014','HNY-015']);
  let sharedTasks = null;
  const taskClient = window.SharedTasks.createClient({request:api, storage:window.sessionStorage});
  function localTasks(){try{const saved=JSON.parse(localStorage.getItem('hauntologies-created-tasks')||'[]');return Array.isArray(saved)?saved:[];}catch{return [];}}
  function taskCard(t){const card=el('details',undefined,'task-card');card.append(el('summary',t.bounded_task),intakeText(t.description||t.evidence_deliverable||''),metadata([['Status',statusLabel(t.status)],['Section',t.section],['Skill level',statusLabel(t.skill_level)]]));return card;}
  function renderTaskList(){
    const root=byId('taskLedger');root.replaceChildren();
    const tasks=(sharedTasks||[]).filter(t=>!removedTaskIds.has(t.task_id));
    tasks.forEach(t=>root.append(taskCard(t)));
    byId('sharedTaskCount').textContent=sharedTasks===null?'':`${tasks.length} shared ${tasks.length===1?'task':'tasks'}`;
    const drafts=localTasks(),local=byId('earlierLocalTasks');local.replaceChildren();local.hidden=!drafts.length;
    if(drafts.length){local.append(el('h3','Earlier browser drafts'),el('p','Copy a draft into the form above to add it to the shared list.','small'));drafts.forEach(t=>local.append(taskCard(t)));}
  }
  async function loadSharedTasks(){
    const status=byId('sharedTaskStatus');
    try{sharedTasks=await taskClient.list();status.replaceChildren();renderTaskList();return true;}
    catch(error){status.replaceChildren(el('span','Shared tasks unavailable'));if(error.status===401)await accessActions(status);return false;}
  }
  function restorePendingTask(){const task=taskClient.pendingTask();if(!task)return;for(const [id,key]of [['newTaskTitle','bounded_task'],['newTaskDescription','description'],['newTaskSection','section'],['newTaskSkill','skill_level'],['newTaskStatus','status']])byId(id).value=task[key];byId('createTaskResult').textContent='A shared save is pending. Retry this task to confirm it.';}
  async function createTask(event){
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),out=byId('createTaskResult');
    const task={bounded_task:byId('newTaskTitle').value.trim(),description:byId('newTaskDescription').value.trim(),section:byId('newTaskSection').value,skill_level:byId('newTaskSkill').value,status:byId('newTaskStatus').value};
    if(!task.bounded_task||!task.description)return;
    button.disabled=true;out.textContent='Saving to the shared task list…';
    try{
      const saved=await taskClient.create(task);
      sharedTasks=[saved,...(sharedTasks||[]).filter(t=>t.task_id!==saved.task_id)];
      out.textContent='Task saved to the shared list.';
      form.reset();renderTaskList();await loadSharedTasks();
    }catch(error){out.textContent=error.status===401?'Shared tasks unavailable':error.status===403?'Your account needs permission to save shared tasks.':error.message;}
    finally{button.disabled=false;}
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const text = value => String(value ?? '');
  const safeLink = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
  const el = (tag, content, className) => { const node = document.createElement(tag); if (content !== undefined) node.textContent = text(content); if (className) node.className = className; return node; };
  const button = (label, action, className = 'outline') => { const node = el('button', label, className); node.type = 'button'; node.addEventListener('click', action); return node; };
  const states = ['draft','submitted','changes_requested','approved','merged'];
  const taskStates = ['proposed','open','in_progress','blocked','completed','archived'];
  const labels = {record_update:'Metadata update',open_proposal:'Contribution',area_proposal:'Proposed area',record_annotation:'Clarification',entry_bundle:'Historical entry and linked evidence',layer_candidate:'Layer candidate',filter_proposal:'Filter proposal',citation_correction:'Citation correction',date_correction:'Date correction',location_correction:'Location correction',duplicate_proposal:'Duplicate proposal',qa_report:'QA report',stewardship_report:'Stewardship or documentation'};
  const headings = {area_proposal:'Area',record_annotation:'Clarify',entry_bundle:'Entry',layer_candidate:'Layer',filter_proposal:'Filter',citation_correction:'Citation',date_correction:'Date',location_correction:'Location',duplicate_proposal:'Duplicate',qa_report:'Test',stewardship_report:'Stewardship'};
  const rights = ['unknown','public_domain','licensed','permission','restricted'];
  const uses = ['citation_only','paraphrase','excerpt','media'];
  const sourceRoles = ['report','existence','disappearance','context','geography','gap_documentation'];
  const datePrecision = ['unknown','year','range','circa'];
  const geoStatus = ['unresolved','approximate','located'];
  const geoMethods = ['unresolved','historic_map','address_match','gazetteer','contextual_estimate'];
  const boroughs = ['unknown','Bronx','Brooklyn','Manhattan','Queens','Staten Island'];
  let dashboard = null, selectedSubmission = null, revisionOf = null, revisionOriginal = null, preview = null, pendingWrite = readPendingWrite(), busy = false, rowCounter = 0, connectionVersion = 0;
  function readPendingWrite(){try{const value=JSON.parse(sessionStorage.getItem('hauntologies-pending-contribution-write')||'null');return value&&/^\/(submit|revise|triage|task|review|apply|verify|rollback)$/.test(value.path)&&typeof value.body?.idempotency_key==='string'?value:null;}catch{return null;}}
  function retainWrite(value){pendingWrite=value;try{if(value)sessionStorage.setItem('hauntologies-pending-contribution-write',JSON.stringify(value));else sessionStorage.removeItem('hauntologies-pending-contribution-write');}catch{}}
  const caps = () => dashboard?.capabilities || {};
  async function accessActions(root){
    const version=connectionVersion,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/access-status',{credentials:'same-origin',cache:'no-store',signal:controller.signal}),access=await response.json();
      if(version!==connectionVersion||!response.ok)return;
      if(access.enabled===false){const pending=root.querySelector('[data-reconciliation]');root.textContent='Sign-in is not enabled yet';if(pending)root.append(pending);return;}
      if(access.enabled!==true||access.sign_in_url!=='/api/contributions/sign-in')return;
      const pending=root.querySelector('[data-reconciliation]');root.textContent='Sign in to submit';if(pending)root.append(pending);
      const link=el('a','Sign in');link.href=access.sign_in_url;link.target='_blank';link.rel='noopener noreferrer';
      const retry=button('Retry',async()=>{retry.disabled=true;const data=await loadDashboard();await loadSharedTasks();if(data&&openTargetFailed&&openRequestedRecordId)await chooseOpenReference(openRequestedRecordId,openTargetLabel);if(data&&draftRevisionBlocked)await restoreRevisionDraft();retry.disabled=false;});
      root.querySelector('[data-access-actions]')?.remove();const actions=el('span');actions.dataset.accessActions='true';actions.append(link,retry);root.append(actions);
    }catch{}finally{clearTimeout(timeout);}
  }
  function serviceFailure(error, retry){
    if(error.status===401||error.status===403)return;
    const root=byId('workflowConnection');root.textContent=error.message||'Submissions unavailable';
    if(retry)root.append(document.createTextNode(' '),button('Retry',retry));
  }
  async function sessionActor(){
    const session=await api('/session');
    if(typeof session?.actor_id!=='string'||!session.actor_id||session.actor_id.length>200)throw Object.assign(new Error('Session unavailable'),{status:503});
    return session.actor_id;
  }
  async function requireOriginalActor(request){
    const actor=await sessionActor();
    if(typeof request.actor_id!=='string'||!request.actor_id)throw Object.assign(new Error('Original account could not be confirmed'),{status:409});
    if(actor!==request.actor_id)throw Object.assign(new Error('Use the original account to retry this save'),{status:409});
  }
  function clearPrivateView(message){
    dashboard=null;selectedSubmission=null;sharedTasks=null;connectionVersion++;
    byId('workflowConnection').textContent=message;byId('reviewCapabilityNotice').textContent='';
    byId('submissionDetail').replaceChildren();byId('submissionDetail').hidden=true;
    byId('contributionReceipt').replaceChildren();byId('contributionReceipt').hidden=true;
    byId('contributionTargetPick').replaceChildren(new Option('No records',''));byId('useContributionTarget').disabled=true;
    byId('targetSnapshot').replaceChildren();byId('confirmContribution')?.setAttribute('disabled','');
    renderTaskList();renderQueue();renderJobs();
  }
  function requireReceipt(response,request){
    const receipt=response?.receipt,action=request.path.slice(1),result=receipt?.result;
    const valid=typeof receipt?.id==='string'&&receipt.id.length>0&&receipt.action===action&&result&&typeof result==='object'&&!Array.isArray(result);
    const uncertain=()=>Object.assign(new Error('Save receipt could not be confirmed'),{uncertain:true});
    if(!valid)throw uncertain();
    if(['submit','revise'].includes(action)){
      const expected=action==='revise'?request.body.expected_revision+1:1,submission=response.submission;
      if(typeof result.submission_id!=='string'||result.revision!==expected||submission?.id!==result.submission_id||!Number.isInteger(submission.revision)||submission.revision<expected||action==='revise'&&result.submission_id!==request.body.submission_id)throw uncertain();
    }
    for(const key of ['submission_id','job_id','task_id'])if(request.body[key]&&result[key]!==request.body[key])throw uncertain();
    return response;
  }
  const statusLabel=value=>({submitted:'Awaiting review',changes_requested:'Needs information',in_progress:'In progress',verification_pending:'Verification pending',rolled_back:'Rolled back',ready_for_review:'Ready for review'})[value]||text(value).replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
  function disclosure(title,...content){const details=el('details',undefined,'workflow-details');details.append(el('summary',title),...content);return details;}

  const getPath = (object, path) => path.split('.').reduce((v,k) => v?.[k], object);
  const setPath = (object, path, value) => { const keys=path.split('.'); let target=object; keys.slice(0,-1).forEach(k=>target=target[k]??(target[k]={})); target[keys.at(-1)]=value; };
  function field(spec, value) {
    const [name,label,kind='text',options,help] = spec;
    const wrap=el('label'); const inputId='wf-'+name.replace(/[^a-zA-Z0-9_-]/g,'-'); wrap.htmlFor=inputId; wrap.append(el('span',label));
    let input;
    if(kind==='select'){input=el('select');(options||[]).forEach(option=>{const o=el('option',typeof option==='object'?option.label:option);o.value=typeof option==='object'?option.value:option;input.append(o);});}
    else if(kind==='textarea'||kind==='lines'){input=el('textarea');input.rows=3;}
    else {input=el('input');input.type=['number','date','url'].includes(kind)?kind:'text';if(kind==='number')input.step='any';}
    input.id=inputId;input.dataset.field=name;input.dataset.kind=kind;if(value!==undefined||kind!=='select')input.value=Array.isArray(value)?value.join('\n'):value??'';input.hasOriginalValue=value!==undefined;input.originalValue=value===undefined?undefined:structuredClone(value);input.initialValue=input.value;wrap.append(input);
    if(help){const note=el('small',help,'field-help');note.id=inputId+'-help';input.setAttribute('aria-describedby',note.id);wrap.append(note);}
    return wrap;
  }
  function fieldValue(input){if(input.hasOriginalValue&&input.value===input.initialValue)return structuredClone(input.originalValue);if(input.dataset.kind==='number')return input.value.trim()===''?null:Number(input.value);if(input.dataset.kind==='lines')return input.value.split('\n').map(s=>s.trim()).filter(Boolean);return input.value;}
  const specs = {
    qa_report:[['version','Tested version'],['device','Device or viewport'],['browser','Browser and version'],['test_mode','Test environment','select',['desktop','emulated','physical']],['steps','Reproduction steps','textarea'],['expected','Expected result','textarea'],['observed','Observed result','textarea'],['result','Observed outcome','select',['not_tested','pass','fail']],['evidence','Evidence and untested limits','textarea']],
    stewardship_report:[['submission_ids','Bounded submission IDs, one per line','lines'],['blockers','Blockers','textarea'],['routing','Review routing / responsibility','textarea',null,''],['handoff','Handoff evidence','textarea'],['next_action','Next action','textarea']],
    layer_candidate:[['title','Map item title'],['url','Source item URL','url'],['date_meaning','What each date means','textarea'],['capture_date','Capture date, if known'],['publication_date','Publication date, if known'],['georeferencing_date','Georeferencing date, if known'],['south','South bound','number'],['west','West bound','number'],['north','North bound','number'],['east','East bound','number'],['crs','Coordinate reference system'],['protocol','Protocol','select',['XYZ','WMTS','WMS','IIIF','image','unknown']],['min_zoom','Minimum zoom','number'],['max_zoom','Maximum zoom','number'],['max_native_zoom','Native maximum zoom','number'],['coverage','Coverage and untested areas','textarea'],['rights_status','Item-specific rights','select',rights],['rights_statement','Rights statement and terms URL','textarea'],['verification_evidence','Actual verification evidence','textarea',null,'']],
    filter_proposal:[['field','Controlled record field','select',['borough','place_type','period','evidence','review_state','location_certainty']],['operator','Predicate operator','select',['equals','in','range','is_unknown']],['value','Predicate value','text',null,'Comma-separated values or two year bounds'],['null_behavior','Unknown value behavior','select',['include','exclude','only']],['fixture_total','Fixture record count','number'],['fixture_matched','Expected matching count','number'],['fixture_unknown','Unknown-period or unlocated count','number'],['reason','Rationale and fixture descriptions','textarea']],
    citation_correction:[['original_wording','Original citation wording','textarea'],['reason','Reason and supporting evidence','textarea']],
    date_correction:[['original_wording','Original date wording','textarea'],['reason','Reason and supporting evidence','textarea'],['after.time_original','Proposed original date wording','textarea'],['after.time_start_year','Historical start year','number'],['after.time_end_year','Historical end year','number'],['after.time_precision','Date precision','select',datePrecision],['after.time_basis','Historical interpretation and uncertainty basis','textarea',null,'Blank years = unknown']],
    location_correction:[['original_wording','Original place wording','textarea'],['reason','Reason and supporting evidence','textarea'],['after.geo_status','Location certainty','select',geoStatus],['after.latitude','Latitude (WGS84)','number'],['after.longitude','Longitude (WGS84)','number'],['after.geo_method','Matching method','select',geoMethods],['after.geo_basis','Geographic basis and alternatives','textarea'],['after.geo_source_ref','Geography source reference'],['after.uncertainty_m','Defensible uncertainty radius (metres)','number',null,'Blank = unquantified'],['after.borough','Borough','select',boroughs]],
    duplicate_proposal:[['record_ids','Compared record IDs, one per line','lines'],['comparison','Compare claims, periods, places, and source uses','textarea'],['proposed_canonical_id','Proposed canonical record ID'],['source_transfer','Explicit source-transfer proposals, one per line','lines'],['reason','Reason and preservation of originals','textarea',null,'']],
    entry_bundle:[['entry_id','Stable entry ID'],['group_id','Group ID'],['category','Claim category','select',['reported_haunting','vanished_place','archival_gap']],['title','Entry title'],['claim_text','Attributed claim','textarea'],['related_entry_id','Related entry ID, if any'],['place_original','Place wording as written','textarea'],['place_normalized','Normalized place label'],['borough','Borough','select',boroughs],['modern_location','Present-day counterpart, if known'],['time_original','Original historical date wording','textarea'],['time_start_year','Historical start year','number'],['time_end_year','Historical end year','number'],['time_precision','Historical date precision','select',datePrecision],['time_basis','Date basis and uncertainty','textarea'],['geo_status','Location certainty','select',geoStatus],['latitude','Latitude (WGS84)','number'],['longitude','Longitude (WGS84)','number'],['geo_method','Geographic method','select',geoMethods],['geo_basis','Location basis and unresolved limits','textarea'],['geo_source_ref','Geography source reference'],['uncertainty_m','Defensible uncertainty radius (metres)','number'],['gap_question','Archival-gap question','textarea'],['gap_scope','Bounded search scope','textarea'],['gap_limitations','Search / archival limitations','textarea'],['interpretation','Labeled interpretation, if any','textarea'],['record_license','Contributor text license'],['rights_notes','Contributor text reuse notes','textarea']]
  };
  const sourceSpecs=[['source_ref','Source-use reference'],['entry_id','Linked entry ID'],['role','Evidence role','select',sourceRoles],['citation','Full citation','textarea'],['repository','Repository'],['locator','Precise source locator'],['source_date_original','Source date as written'],['accessed_on','Actually consulted on','date'],['url','Stable HTTP(S) source URL','url'],['evidence_note','What this source supports and its limits','textarea'],['rights_status','Rights status','select',rights],['rights_statement','Rights statement / license or restriction','textarea'],['public_use','Intended use','select',uses]];
  const attachmentSpecs=[['url','Attachment URL','url'],['title','Attachment title'],['provenance','Provenance','textarea'],['rights_status','Rights status','select',rights],['rights_statement','Rights statement','textarea'],['public_use','Intended use','select',uses],['privacy_review','Privacy considerations','textarea']];
  const targetSpecs=[['record_id','Target record ID'],['expected_version','Expected version','number'],['expected_hash','Expected source hash']];
  const searchSpecs=[['search_id','Search ID'],['entry_id','Linked entry ID'],['searched_on','Actual search date','date'],['collection','Collection'],['collection_locator','Collection locator'],['coverage','Coverage and historical period','textarea'],['query_or_units','Literal queries, spelling variants, or units','textarea'],['result','Search result','select',['no_match','partial_trace','inaccessible','documented_loss']],['result_note','What was found','textarea'],['limitations','Access, indexing, digitization, survival, language limits','textarea']];
  function addRow(containerId,rowSpecs,values={}){
    const row=el('div',undefined,'workflow-repeat-row');row.dataset.row='true';row.originalValues=structuredClone(values);const prefix='row'+(++rowCounter)+'.';rowSpecs.forEach(spec=>{const f=field([prefix+spec[0],...spec.slice(1)],values[spec[0]]);f.querySelector('[data-field]').dataset.rowField=spec[0];row.append(f);});
    row.append(button('Remove',()=>{row.remove();invalidatePreview();},'textbutton'));byId(containerId).append(row);return row;
  }
  function rows(containerId){return [...byId(containerId).querySelectorAll('[data-row]')].map(row=>({...row.originalValues,...Object.fromEntries([...row.querySelectorAll('[data-row-field]')].filter(input=>!row.preserveMissing||Object.prototype.hasOwnProperty.call(row.originalValues,input.dataset.rowField)||input.value!==input.initialValue).map(input=>[input.dataset.rowField,fieldValue(input)]))}));}
  function renderPayload(type,payload={}){
    if(simpleFlow()!=='other'){renderSimplePayload(type,payload);return;}
    const root=byId('typedPayloadFields');root.replaceChildren(el('legend',headings[type]||'Details'));
    const data=type==='entry_bundle'?payload.Entries?.[0]||{}:payload;
    const fields=el('div',undefined,'typed-fields');
    (specs[type]||[]).forEach(spec=>{
      let value=getPath(data,spec[0]);
      if(type==='layer_candidate'&&['south','west','north','east'].includes(spec[0]))value=payload.bounds?.[spec[0]==='south'||spec[0]==='west'?0:1]?.[spec[0]==='south'||spec[0]==='north'?0:1];
      if(type==='filter_proposal'&&spec[0]==='value')value=Array.isArray(payload.value)?payload.value.join(', '):payload.value;
      if(type==='filter_proposal'&&spec[0].startsWith('fixture_'))value=payload.expected_fixture_counts?.[spec[0].slice(8)];
      fields.append(field(spec,value));
    });root.append(fields);
    if(type==='entry_bundle'){
      const searches=el('div');searches.id='submissionSearches';root.append(el('h4','Searches'),searches,button('Add',()=>{addRow('submissionSearches',searchSpecs);invalidatePreview();}));
      (payload.SearchLog||[]).forEach(s=>addRow('submissionSearches',searchSpecs,s));
    }
  }
  const simpleFlow=()=>byId('contributionFlow')?.value||'other';
  let simpleDraft={},simpleEntryId='map-'+crypto.randomUUID(),clarificationTarget=null,targetRequest=0;
  const simpleControl=name=>byId('wf-simple-'+name.replace(/[^a-zA-Z0-9_-]/g,'-'));
  const simpleValue=name=>{const control=simpleControl(name);return control?fieldValue(control):simpleDraft[name];};
  const simpleFields=[
    ['geometry_kind','Location','select',[{value:'point',label:'Point'},{value:'area',label:'Proposed area'},{value:'unknown',label:'Unknown location'}]],
    ['category','Type','select',[{value:'reported_haunting',label:'Ghost story'},{value:'vanished_place',label:'Vanished place'},{value:'archival_gap',label:'Archival gap'}]],
    ['place_original','Place'],['borough','Borough','select',boroughs],
    ['annotation_kind','Contribution','select',[{value:'clarification',label:'Clarification'},{value:'addition',label:'Additional evidence'}]],
    ['original_wording','Original wording','textarea'],['payload_wording','Proposed wording','textarea'],
    ['date_mode','Dates','select',[{value:'none',label:'No date change'},{value:'provided',label:'Provide dates'}]],['time_original','Date wording'],['time_precision','Date certainty','select',datePrecision],['time_start_year','From year','number'],['time_end_year','Through year','number'],['time_basis','Date basis','textarea'],
    ['latitude','Latitude','number'],['longitude','Longitude','number'],['geo_status','Location certainty','select',[{value:'approximate',label:'Approximate'},{value:'located',label:'Located'}]],['geo_method','Location method','select',geoMethods.filter(x=>x!=='unresolved')],
    ['area_status','Area certainty','select',[{value:'proposed',label:'Proposed footprint'},{value:'unresolved',label:'Unknown footprint'}]],['area_input','Area entry','select',[{value:'bounds',label:'Bounds'},{value:'geojson',label:'GeoJSON or vertices'}]],['south','South latitude','number'],['west','West longitude','number'],['north','North latitude','number'],['east','East longitude','number'],['geometry_json','Polygon or closed vertices','textarea',null,'[longitude, latitude] pairs'],
    ['geo_basis','Location basis','textarea'],['uncertainty_m','Uncertainty radius in metres','number',null,'Leave blank when unquantified'],['uncertainty_note','Uncertainty','textarea'],
    ['gap_question','Research question','textarea'],['gap_scope','Search scope','textarea'],['gap_limitations','Search limitations','textarea'],
    ['record_license','Your text license','select',['Unspecified','CC BY 4.0','CC0','All rights reserved']],['rights_notes','Rights notes','textarea']
  ];
  const simpleSourceSpecs=[['source_ref','Source ID'],['entry_id','Entry ID'],['role','Evidence use','select',sourceRoles],['source_type','Source type','select',['unknown','archive','book','article','map','website','oral_report','other']],['citation','Citation','textarea'],['repository','Repository'],['locator','Page or locator'],['source_date_original','Source date'],['accessed_on','Consulted on','date'],['url','Source URL','url'],['evidence_note','What it supports','textarea'],['rights_status','Source rights','select',rights],['rights_statement','Rights statement','textarea'],['public_use','Use','select',uses]];
  function rememberSimple(){for(const [name]of simpleFields){const c=simpleControl(name);if(c)simpleDraft[name]=fieldValue(c);}}
  function visibleSimple(name,visible){const input=simpleControl(name);if(input)input.closest('label').hidden=!visible;}
  function updateSimpleFields(){
    rememberSimple();const clarify=simpleFlow()==='clarify',kind=simpleValue('geometry_kind')||'point',area=!clarify&&kind==='area',point=!clarify&&kind==='point';
    byId('contributionType').value=clarify?'record_annotation':area?'area_proposal':'entry_bundle';
    for(const [name]of simpleFields)visibleSimple(name,true);
    for(const name of ['geometry_kind','category','place_original','borough','geo_basis','record_license','rights_notes'])visibleSimple(name,!clarify);
    for(const name of ['annotation_kind','original_wording'])visibleSimple(name,clarify);visibleSimple('payload_wording',!!revisionOriginal&&['area_proposal','record_annotation'].includes(revisionOriginal.type));
    for(const name of ['latitude','longitude','geo_status','geo_method','uncertainty_m'])visibleSimple(name,point);
    visibleSimple('area_status',area);const hasArea=area&&simpleValue('area_status')!=='unresolved';for(const name of ['area_input'])visibleSimple(name,hasArea);
    for(const name of ['south','west','north','east'])visibleSimple(name,hasArea&&simpleValue('area_input')==='bounds');
    visibleSimple('geometry_json',hasArea&&simpleValue('area_input')==='geojson');
    visibleSimple('date_mode',clarify);const showDates=!clarify||simpleValue('date_mode')==='provided';for(const name of ['time_original','time_precision','time_basis'])visibleSimple(name,showDates);for(const name of ['time_start_year','time_end_year'])visibleSimple(name,showDates&&simpleValue('time_precision')!=='unknown');
    const gap=!clarify&&simpleValue('category')==='archival_gap';for(const name of ['gap_question','gap_scope','gap_limitations'])visibleSimple(name,gap&&!area);
    if(byId('simpleSearches'))byId('simpleSearches').hidden=!gap||area;
    for(const [name]of simpleFields){const input=simpleControl(name);input.required=!input.closest('label').hidden&&['place_original','original_wording','time_original','time_basis','geo_basis','uncertainty_note','rights_notes'].includes(name);}configureSimpleSources();invalidatePreview();
  }
  function configureSimpleSources(){
    const canonical=byId('contributionType').value==='entry_bundle';
    for(const row of byId('submissionSources').querySelectorAll('[data-row]'))for(const input of row.querySelectorAll('[data-row-field]')){
      const key=input.dataset.rowField;input.required=['citation','locator','accessed_on','rights_statement',...(canonical?['repository','source_date_original','evidence_note']:[])].includes(key);input.closest('label').hidden=['source_ref','entry_id'].includes(key)||(key==='role'&&!canonical)||(key==='source_type'&&canonical);
    }
  }
  function addSimpleSource(values){const row=addRow('submissionSources',simpleSourceSpecs,values||{source_ref:'source-'+crypto.randomUUID(),entry_id:simpleEntryId,role:'report',source_type:'unknown',source_date_original:'Unknown',rights_status:'unknown',public_use:'citation_only'});row.preserveMissing=!!values;configureSimpleSources();}
  function renderSimplePayload(type,payload={}){
    const entry=type==='entry_bundle'?payload.Entries?.[0]||{}:payload,dates=entry.dates||entry;
    simpleDraft={date_mode:entry.dates?'provided':'none',geometry_kind:type==='area_proposal'?'area':entry.geo_status==='unresolved'?'unknown':'point',category:'reported_haunting',borough:'unknown',time_precision:'unknown',geo_status:'approximate',geo_method:'historic_map',area_input:'bounds',area_status:entry.geometry_status||'proposed',record_license:'Unspecified',...simpleDraft,...entry,...dates};
    if(type==='area_proposal'){simpleDraft.geometry_kind='area';if(Object.prototype.hasOwnProperty.call(entry,'geometry_status'))simpleDraft.area_status=entry.geometry_status;}
    if(type==='entry_bundle'&&Object.prototype.hasOwnProperty.call(entry,'geo_status'))simpleDraft.geometry_kind=entry.geo_status==='unresolved'?'unknown':'point';
    if(Object.prototype.hasOwnProperty.call(entry,'dates'))simpleDraft.date_mode=entry.dates===null?'none':'provided';
    if(revisionOriginal&&['area_proposal','record_annotation'].includes(type))simpleDraft.payload_wording=entry[type==='record_annotation'?'text':'description'];
    const summaryLabel=byId('contributionSummary').closest('label');if(summaryLabel?.firstChild?.nodeType===Node.TEXT_NODE)summaryLabel.firstChild.textContent=revisionOriginal&&['area_proposal','record_annotation'].includes(type)?'Summary':'Description';
    if(type==='area_proposal'){simpleDraft.geo_basis=entry.geometry_basis||'';if(entry.geometry){simpleDraft.area_input='geojson';simpleDraft.geometry_json=JSON.stringify(entry.geometry,null,2);}}
    if(entry.entry_id)simpleEntryId=entry.entry_id;
    const root=byId('typedPayloadFields');root.replaceChildren(el('legend',simpleFlow()==='clarify'?'Clarify':'Place'));
    const grid=el('div',undefined,'typed-fields');for(const spec of simpleFields){const f=field(['simple.'+spec[0],...spec.slice(1)],simpleDraft[spec[0]]);grid.append(f);}root.append(grid);
    const searches=el('section');searches.id='simpleSearches';searches.append(el('h4','Searches'));const rowsNode=el('div');rowsNode.id='submissionSearches';searches.append(rowsNode,button('Add search',()=>{addRow('submissionSearches',searchSpecs,{search_id:'search-'+crypto.randomUUID(),entry_id:simpleEntryId});invalidatePreview();}));root.append(searches);(payload.SearchLog||[]).forEach(row=>addRow('submissionSearches',searchSpecs,row));
    for(const name of ['geometry_kind','area_input','area_status','time_precision','category','date_mode'])simpleControl(name).addEventListener('change',updateSimpleFields);
    root.append(button('Preview location',()=>{try{const envelope=buildSimpleEnvelope();window.dispatchEvent(new CustomEvent('contributions-draft-preview-requested',{detail:{envelope,target:clarificationTarget}}));}catch(error){renderErrors([{field:error.field||'geometry',message:error.message}]);}},'outline'));
    updateSimpleFields();
  }
  function simpleDates(){return{time_original:simpleValue('time_original')||'',time_precision:simpleValue('time_precision')||'unknown',time_start_year:simpleValue('time_precision')==='unknown'?null:simpleValue('time_start_year'),time_end_year:simpleValue('time_precision')==='unknown'?null:simpleValue('time_end_year'),time_basis:simpleValue('time_basis')||''};}
  function simpleGeometry(){
    if(simpleValue('geometry_kind')!=='area'||simpleValue('area_status')==='unresolved')return null;
    try{return simpleValue('area_input')==='geojson'?window.HostedRecordModel.parseAreaGeometry(simpleValue('geometry_json')):window.HostedRecordModel.areaFromBounds(...['south','west','north','east'].map(simpleValue));}catch(error){error.field=simpleValue('area_input')==='geojson'?'geometry_json':'south';throw error;}
  }
  function buildSimpleEnvelope(){
    rememberSimple();const clarify=simpleFlow()==='clarify',area=!clarify&&simpleValue('geometry_kind')==='area',point=!clarify&&simpleValue('geometry_kind')==='point';
    const type=clarify?'record_annotation':area?'area_proposal':'entry_bundle',credit={consent:byId('publicCreditConsent').checked,label:byId('publicCreditConsent').checked?byId('publicCreditLabel').value:''};
    const canonicalSources=rows('submissionSources').map(source=>{const row={...source};delete row.source_type;return row;}),proposalSources=rows('submissionSources').map(source=>{const row={...source};delete row.role;return row;});
    const title=byId('contributionTitle').value,summary=byId('contributionSummary').value,dates=simpleDates(),prior=revisionOriginal?.type===type?revisionOriginal:null;
    const bodyText=prior&&['area_proposal','record_annotation'].includes(type)?simpleValue('payload_wording'):summary;
    let payload,targets=[],sources=[];
    if(clarify){payload={...(prior?.payload||{}),annotation_kind:simpleValue('annotation_kind')||'clarification',text:bodyText,original_wording:simpleValue('original_wording')||'',uncertainty_note:simpleValue('uncertainty_note')||'',dates:simpleValue('date_mode')==='provided'?dates:null};sources=proposalSources;if(clarificationTarget)targets=[{record_id:clarificationTarget.record_id,expected_version:clarificationTarget.expected_version,expected_hash:clarificationTarget.expected_hash}];}
    else if(area){payload={...(prior?.payload||{}),category:simpleValue('category'),description:bodyText,place_original:simpleValue('place_original')||'',borough:simpleValue('borough'),dates,geometry_status:simpleValue('area_status')||'proposed',geometry:simpleGeometry(),geometry_basis:simpleValue('geo_basis')||'',uncertainty_note:simpleValue('uncertainty_note')||'',record_license:simpleValue('record_license'),rights_notes:simpleValue('rights_notes')||''};sources=proposalSources;}
    else{
      const entry={entry_id:simpleEntryId,group_id:'map',contributor:credit.consent&&credit.label?credit.label:'Uncredited contributor',category:simpleValue('category'),title,claim_text:summary,place_original:simpleValue('place_original')||'',place_normalized:simpleValue('place_original')||'',borough:simpleValue('borough'),...dates,geo_status:point?simpleValue('geo_status'):'unresolved',latitude:point?simpleValue('latitude'):null,longitude:point?simpleValue('longitude'):null,geo_method:point?simpleValue('geo_method'):'unresolved',geo_basis:simpleValue('geo_basis')||'',geo_source_ref:point?canonicalSources.find(s=>s.role==='geography')?.source_ref||null:null,uncertainty_m:point?simpleValue('uncertainty_m'):null,interpretation:simpleValue('uncertainty_note')||'',record_license:simpleValue('record_license'),rights_notes:simpleValue('rights_notes')||''};
      if(entry.category==='archival_gap')for(const key of ['gap_question','gap_scope','gap_limitations'])entry[key]=simpleValue(key)||'';
      payload={Entries:[entry],Sources:canonicalSources.map(s=>({...s,entry_id:entry.entry_id})),SearchLog:rows('submissionSearches').map(s=>({...s,entry_id:entry.entry_id,researcher:entry.contributor}))};
    }
    return{schema_version:'1.0',type,task_ids:prior?.task_ids||[],title,summary,public_credit:credit,sources,attachments:prior?.attachments||[],targets,payload};
  }
  function simpleErrors(){
    if(simpleFlow()==='other')return[];const errors=[],clarify=simpleFlow()==='clarify',point=!clarify&&simpleValue('geometry_kind')==='point',area=!clarify&&simpleValue('geometry_kind')==='area';
    for(const name of ['uncertainty_note',...(revisionOriginal&&['area_proposal','record_annotation'].includes(revisionOriginal.type)?['payload_wording']:[]),...(!clarify||simpleValue('date_mode')==='provided'?['time_original','time_basis']:[]),...(clarify?['original_wording']:['place_original','geo_basis','rights_notes'])])if(!text(simpleValue(name)).trim())errors.push({field:name,message:'Enter '+(simpleFields.find(x=>x[0]===name)?.[1]||name).toLowerCase()});
    if(clarify&&!clarificationTarget)errors.push({field:'clarificationTarget',message:'Choose an existing record'});
    if(point&&(!Number.isFinite(simpleValue('latitude'))||!Number.isFinite(simpleValue('longitude'))))errors.push({field:'latitude',message:'Enter both latitude and longitude, or choose Unknown location'});
    const sourceRows=rows('submissionSources');if(!sourceRows.length)errors.push({field:'sources',message:'Add a source citation'});sourceRows.forEach((source,index)=>{for(const key of ['citation','locator','accessed_on','rights_statement',...(!clarify&&!area?['repository','source_date_original','evidence_note']:[])])if(!text(source[key]).trim())errors.push({field:'sources.'+index+'.'+key,message:'Enter '+(simpleSourceSpecs.find(s=>s[0]===key)?.[1]||key).toLowerCase()});});
    if(area){try{simpleGeometry()}catch(error){errors.push({field:error.field,message:error.message});}}
    return errors;
  }
  function syncFlow(){
    const flow=simpleFlow();for(const id of ['contributionTypeGroup','contributionTaskGroup','contributionTargetsGroup','contributionAttachmentsGroup'])if(byId(id))byId(id).hidden=flow!=='other';
    if(byId('clarificationTargetGroup'))byId('clarificationTargetGroup').hidden=flow!=='clarify';
    if(flow==='other'){if(['area_proposal','record_annotation'].includes(byId('contributionType').value))byId('contributionType').value='qa_report';return;}
    renderPayload(flow==='clarify'?'record_annotation':simpleDraft.geometry_kind==='area'?'area_proposal':'entry_bundle');
    if(!byId('submissionSources').querySelector('[data-row]'))addSimpleSource();
  }
  function renderClarificationTargets(){
    const select=byId('clarificationTarget');if(!select)return;const current=select.value,items=new Map();
    const records=typeof allRecords==='function'?allRecords():window.NYC_INVENTORY?.records||[];
    for(const r of records)if(r?.id&&r.status!=='draft'&&!r.hosted_pending)items.set(r.id,{id:r.id,title:r.title});
    for(const r of dashboard?.targets||[])items.set(r.record_id,{id:r.record_id,title:r.title});
    select.replaceChildren(new Option('Choose a record',''));for(const r of [...items.values()].sort((a,b)=>text(a.title).localeCompare(text(b.title))))select.append(new Option(r.title,r.id));select.value=current;
  }
  async function chooseClarification(id){
    const request=++targetRequest;clarificationTarget=null;invalidatePreview();byId('clarificationTargetHelp').textContent=id?'Loading record…':'';if(!id)return;
    try{const data=await api('/target?id='+encodeURIComponent(id));if(request!==targetRequest)return;clarificationTarget=data.target;byId('clarificationTargetHelp').replaceChildren(metadata([['Record',data.target.record_id],['Version',data.target.expected_version]]));const r=window.HostedRecordModel.targetRecord(data.target);if(simpleControl('original_wording')&&!revisionOf)simpleControl('original_wording').value=r.claim_text||r.evidence_summary||r.description||r.title||'';if(!byId('contributionTitle').value)byId('contributionTitle').value='Clarify '+data.target.title;}
    catch(error){if(request!==targetRequest)return;byId('clarificationTargetHelp').textContent=error.status===401?'Submissions unavailable':'Record unavailable: '+error.message;}
  }

  // Intake stores the contributor's words; classification and plotting remain review work.
  let openTargets=[],openRequestedRecordId='',openTargetLabel='',openTargetPending=false,openTargetFailed=false,openRequest=0,openTaskIds=[],openSourcesInitial='',openSourcesDisplayInitial='',openExplanationInitial='',openExplanationDisplayInitial='';
  const draftStorageKey='hauntologies-contribution-draft';let draftRevisionBlocked=null;
  const isOpenForm=()=>!revisionOriginal||revisionOriginal.type==='open_proposal';
  function draftValue(){return {version:1,explanation:byId('contributionSummary').value,sources:byId('freeformSources').value,attributes:attributeValues(),place_mode:byId('contributionPlaceMode').value,record_id:openRequestedRecordId,title:openTargetLabel,revision:revisionOf?{id:revisionOf.id,revision:revisionOf.revision}:draftRevisionBlocked};}
  function saveDraft(){if(!isOpenForm())return;try{const value=draftValue();if(value.explanation||value.sources||value.attributes.length||value.record_id)sessionStorage.setItem(draftStorageKey,JSON.stringify(value));else sessionStorage.removeItem(draftStorageKey);}catch{}}
  function clearSavedDraft(request){
    try{const saved=JSON.parse(request.body.submission_json);if(saved.type!=='open_proposal')return;
      const now=buildEnvelope();if(now.summary===saved.summary&&JSON.stringify(now.payload)===JSON.stringify(saved.payload)&&JSON.stringify(now.targets)===JSON.stringify(saved.targets))sessionStorage.removeItem(draftStorageKey);
    }catch{}
  }
  function restoreDraftFields(value){
    byId('contributionSummary').value=value.explanation;byId('freeformSources').value=value.sources;byId('contributionAttributes').replaceChildren();for(const attribute of value.attributes)addAttribute(attribute);
    byId('contributionPlaceMode').value=value.place_mode;openRequestedRecordId=value.record_id;openTargetLabel=value.title;showOpenReference();
  }
  async function restoreRevisionDraft(){
    if(!draftRevisionBlocked)return;const expected=draftRevisionBlocked,value=draftValue();
    try{const data=await api('/submission?id='+encodeURIComponent(expected.id));if(data.submission?.revision!==expected.revision){byId('workflowConnection').textContent='Submission changed. Open its latest revision from Review';return;}
      if(data.submission.type!=='open_proposal'||!data.submission.is_own)return;
      draftRevisionBlocked=null;loadRevision(data.submission);restoreDraftFields(value);saveDraft();
    }catch(error){serviceFailure(error,restoreRevisionDraft);}
  }
  function restoreDraft(){
    try{const value=JSON.parse(sessionStorage.getItem(draftStorageKey)||'null');if(!value||value.version!==1||typeof value.explanation!=='string'||value.explanation.length>15000||typeof value.sources!=='string'||value.sources.length>30000||!Array.isArray(value.attributes)||value.attributes.length>20||value.attributes.some(a=>!a||typeof a.name!=='string'||a.name.length>80||typeof a.value!=='string'||a.value.length>4000)||!['new','existing'].includes(value.place_mode)||typeof value.record_id!=='string'||value.record_id.length>200||typeof value.title!=='string')return;
      restoreDraftFields(value);if(value.revision&&typeof value.revision.id==='string'&&Number.isInteger(value.revision.revision)){draftRevisionBlocked=value.revision;restoreRevisionDraft();}
      else if(value.record_id)chooseOpenReference(value.record_id,value.title);
    }catch{}
  }
  function showOpenReference(){
    const visible=!!(openRequestedRecordId||openTargets.length||openTargetPending||openTargetFailed);
    byId('freeformRecordContext').hidden=true;
    byId('freeformRecordContext').dataset.recordId=openRequestedRecordId||openTargets[0]?.record_id||'';
    byId('freeformRecordLabel').textContent=openTargetLabel||openRequestedRecordId||openTargets[0]?.record_id||'';
    byId('freeformRecordContext').setAttribute('aria-busy',String(openTargetPending));
    if(visible)byId('contributionPlaceMode').value='existing';
    byId('freeformPlacePicker').hidden=byId('contributionPlaceMode').value!=='existing';
    populatePlaceChoices();
  }
  function resetOpenContext(){
    ++openRequest;openTargets=[];openRequestedRecordId='';openTargetLabel='';openTargetPending=false;openTargetFailed=false;openTaskIds=[];openSourcesInitial='';openSourcesDisplayInitial='';openExplanationInitial='';openExplanationDisplayInitial='';
    byId('freeformSources').value='';byId('freeformContext').hidden=false;byId('freeformContext').open=false;byId('contributionPlaceMode').value='new';byId('contributionAttributes').replaceChildren();byId('addContributionAttribute').disabled=false;showOpenReference();
  }
  function populatePlaceChoices(){
    const select=byId('freeformPlaceSelect'),records=typeof allRecords==='function'?allRecords():window.NYC_INVENTORY?.records||[];
    const entries=new Map(records.filter(r=>r?.id&&r.status!=='draft'&&!r.hosted_pending).map(r=>[r.id,r.title||r.id]));
    if(openRequestedRecordId&&!entries.has(openRequestedRecordId))entries.set(openRequestedRecordId,openTargetLabel||openRequestedRecordId);
    select.replaceChildren(new Option('Choose a place',''));for(const [id,title] of [...entries].sort((a,b)=>a[1].localeCompare(b[1])))select.append(new Option(title,id));select.value=openRequestedRecordId||openTargets[0]?.record_id||'';select.title=select.selectedOptions[0]?.textContent||'';
  }
  function attributeValues(){return [...byId('contributionAttributes').children].map(row=>Object.fromEntries(['name','value'].map(key=>{const control=row.querySelector('[data-attribute='+key+']');return [key,control.value===row.originalDisplay[key]?row.originalValue[key]:control.value];})));}
  function addAttribute(value={name:'',value:''}){
    const root=byId('contributionAttributes');if(root.children.length>=20)return;
    const row=el('div',undefined,'contribution-attribute'),name=el('input'),content=el('textarea');name.type='text';name.maxLength=80;content.rows=2;content.maxLength=4000;
    name.dataset.attribute='name';content.dataset.attribute='value';name.value=value.name;content.value=value.value;row.originalValue=structuredClone(value);row.originalDisplay={name:name.value,value:content.value};
    const id='attribute-'+(++rowCounter);name.id=id+'-name';content.id=id+'-value';const nameLabel=el('label','Name'),valueLabel=el('label','Value');nameLabel.htmlFor=name.id;valueLabel.htmlFor=content.id;nameLabel.append(name);valueLabel.append(content);
    row.append(nameLabel,valueLabel,button('Remove',()=>{row.remove();byId('addContributionAttribute').disabled=false;invalidatePreview();saveDraft();},'textbutton'));root.append(row);byId('addContributionAttribute').disabled=root.children.length>=20;return name;
  }
  async function chooseOpenReference(id,title=''){
    const request=++openRequest;openTargets=[];openRequestedRecordId=id;openTargetPending=true;openTargetFailed=false;openTargetLabel=typeof title==='string'?title:'';showOpenReference();invalidatePreview();renderErrors([]);saveDraft();
    try{const data=await api('/target?id='+encodeURIComponent(id));if(request!==openRequest)return;const target=data.target;
      if(!target||target.record_id!==id||!Number.isInteger(target.expected_version)||typeof target.expected_hash!=='string')throw new Error('Reference unavailable');
      openTargets=[{record_id:target.record_id,expected_version:target.expected_version,expected_hash:target.expected_hash}];openTargetLabel=target.title||target.record_id;openTargetPending=false;showOpenReference();
    }catch(error){if(request!==openRequest)return;openTargetPending=false;openTargetFailed=true;showOpenReference();serviceFailure(error,()=>chooseOpenReference(id,openTargetLabel));}
  }
  let stagedImages=[],imageBatch=null,imageBusy=false,imageProcessing=false;
  const attachmentId=value=>typeof value==='string'&&/^watt_[0-9a-f-]{36}$/.test(value);
  const imageFields=[['caption','Caption',2000],['alt','Description',1000],['credit','Credit',1000],['source_url','Source link',2048],['rights','Rights',2000]];
  function imageStatus(message,retry=false){
    byId('contributionImageProgress').hidden=!message;byId('contributionImageStatus').textContent=message;
    byId('retryContributionImages').hidden=!retry;byId('retryContributionImages').disabled=imageBusy;
  }
  function renderStagedImages(){
    const root=byId('stagedContributionImages');root.replaceChildren();
    byId('contributionImages').disabled=imageBusy||imageProcessing||!!imageBatch||stagedImages.length>=3;
    for(const [index,entry] of stagedImages.entries()){
      const card=el('div',undefined,'staged-image');card.append(el('p',entry.file.name),el('p',entry.receipt?'Uploaded':'Not uploaded','small'),el('p','Metadata removed','small'));
      const details=disclosure('Details');
      for(const [key,label,max] of imageFields){const input=el(key==='caption'||key==='alt'?'textarea':'input');input.id='image-'+index+'-'+key;input.dataset.imageField=key;input.value=entry.metadata[key]||'';input.maxLength=max;input.disabled=imageBusy||!!entry.pending||!!entry.receipt;if(input.tagName==='TEXTAREA')input.rows=2;else input.type=key==='source_url'?'url':'text';const wrap=el('label',label);wrap.htmlFor=input.id;wrap.append(input);details.append(wrap);input.addEventListener('input',()=>{entry.metadata[key]=input.value;if(imageBatch&&!entry.pending)imageStatus('Contribution saved. Image not saved',true);});}
      card.append(details);
      if(!entry.receipt&&!entry.pending&&!imageBusy){card.append(button('Remove',()=>{stagedImages=stagedImages.filter(item=>item!==entry);renderStagedImages();if(imageBatch&&!stagedImages.some(item=>!item.receipt)){imageBatch=null;stagedImages=[];renderStagedImages();imageStatus('Contribution saved');}else if(imageBatch)imageStatus('Contribution saved. Image not saved',true);},'textbutton'));}
      root.append(card);
    }
  }
  async function stageImages(){
    const input=byId('contributionImages'),files=[...input.files];input.value='';if(!files.length||imageBusy||imageBatch)return;
    const error=byId('contributionImageError');error.hidden=true;error.textContent='';
    if(stagedImages.length+files.length>3){error.textContent='Choose up to 3 images';error.hidden=false;return;}
    imageProcessing=true;byId('previewContribution').disabled=true;invalidatePreview();renderStagedImages();
    try{for(const file of files){const prepared=await window.ContributionImage.prepare(file);if(prepared.metadataRemoved!==true||!(prepared.file instanceof Blob))throw new Error('Image processing unavailable');stagedImages.push({file:prepared.file,width:prepared.width,height:prepared.height,metadata:{rights:'unknown'},pending:null,receipt:null});}}
    catch(failure){error.textContent=failure.message||'Image could not be prepared';error.hidden=false;}
    finally{imageProcessing=false;byId('previewContribution').disabled=false;renderStagedImages();}
  }
  async function attachmentRequest(entry){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000),pending=entry.pending,body=new FormData();
    body.set('submission_id',imageBatch.submission_id);body.set('expected_revision',String(pending.expected_revision));body.set('idempotency_key',pending.idempotency_key);body.set('metadata_json',pending.metadata_json);body.set('image',entry.file,entry.file.name);
    try{
      const response=await fetch(apiRoot+'/attachment',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',body,signal:controller.signal});
      let data;try{data=await response.json();}catch{throw Object.assign(new Error('Image receipt unavailable'),{uncertain:true});}
      if(!response.ok){if(response.status===401||response.status===403){clearPrivateView(response.status===401?'Submissions unavailable':'Submission not permitted');if(response.status===401)await accessActions(byId('workflowConnection'));}throw Object.assign(new Error(typeof data.error==='string'?data.error:'Image not saved'),{status:response.status});}
      const receipt=data.receipt,result=receipt?.result;
      if(typeof receipt?.id!=='string'||!receipt.id||receipt.action!=='attachment'||result?.submission_id!==imageBatch.submission_id||result.revision!==pending.expected_revision+1||!attachmentId(result.attachment_id)||data.submission?.id!==imageBatch.submission_id||!Number.isInteger(data.submission.revision)||data.submission.revision<result.revision)throw Object.assign(new Error('Image receipt unavailable'),{uncertain:true});
      const ref=data.attachment,expectedMetadata={rights:'unknown',...JSON.parse(pending.metadata_json)};
      const equalMetadata=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===Object.keys(expectedMetadata).length&&Object.entries(expectedMetadata).every(([key,valueText])=>value[key]===valueText);
      const referenceShape=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='attachment_id,byte_length,height,media_type,metadata,sha256,width'&&value.attachment_id===result.attachment_id&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256)&&Number.isInteger(value.byte_length)&&value.byte_length>0&&value.byte_length<=1048576&&['image/jpeg','image/png','image/webp'].includes(value.media_type)&&value.media_type===entry.file.type&&Number.isInteger(value.width)&&Number.isInteger(value.height)&&value.width>0&&value.height>0&&value.width<=8192&&value.height<=8192&&value.width*value.height<=16777216&&value.width===entry.width&&value.height===entry.height&&equalMetadata(value.metadata);
      let raw;try{raw=JSON.parse(data.submission.raw_json);}catch{}
      const equalReference=value=>referenceShape(value)&&['sha256','byte_length','media_type','width','height'].every(key=>value[key]===ref[key]);
      if(!referenceShape(ref)||!Array.isArray(data.submission.attachments)||!data.submission.attachments.some(equalReference)||!Array.isArray(raw?.attachments)||!raw.attachments.some(equalReference))throw Object.assign(new Error('Stored image could not be confirmed'),{uncertain:true});
      return data;
    }finally{clearTimeout(timeout);}
  }
  async function beginImages(submission,request){
    if(!stagedImages.length||!['/submit','/revise'].includes(request.path))return;
    if(!imageBatch)imageBatch={submission_id:submission.id,revision:submission.revision,actor_id:request.actor_id};
    await uploadImages();
  }
  async function uploadImages(){
    if(!imageBatch||imageBusy)return;imageBusy=true;renderStagedImages();imageStatus('Saving images');
    try{
      const actor=await sessionActor();if(actor!==imageBatch.actor_id)throw Object.assign(new Error('Use the original account to retry images'),{accountMismatch:true});
      for(const entry of stagedImages){
        if(entry.receipt)continue;
        if(!entry.pending)entry.pending={idempotency_key:crypto.randomUUID(),expected_revision:imageBatch.revision,metadata_json:JSON.stringify(entry.metadata)};
        renderStagedImages();
        const response=await attachmentRequest(entry);entry.receipt=response.receipt;entry.pending=null;imageBatch.revision=response.submission.revision;
        showReceipt(response.submission,response);renderStagedImages();
      }
      stagedImages=[];imageBatch=null;renderStagedImages();imageStatus('Images saved');
    }catch(error){
      const entry=stagedImages.find(item=>!item.receipt),definite=!!error.status&&error.status<500;
      if(entry&&definite&&!entry.uncertain&&![401,403,409].includes(error.status))entry.pending=null;
      if(entry&&(error.uncertain||!error.status&&!error.accountMismatch||error.status>=500))entry.uncertain=true;
      const blocked=[400,403,409,413,415].includes(error.status);
      imageStatus(error.accountMismatch?'Contribution saved. Use the original account to retry images':error.status===409?'Contribution saved. Review it before retrying images':'Contribution saved. Image not saved',!blocked);
      if(error.status===401){byId('retryContributionImages').hidden=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch('/api/access-status',{credentials:'same-origin',cache:'no-store',signal:controller.signal});const access=await response.json();byId('retryContributionImages').hidden=!(response.ok&&access.enabled===true&&access.sign_in_url==='/api/contributions/sign-in');}catch{}finally{clearTimeout(timer);}}
    }finally{imageBusy=false;renderStagedImages();byId('retryContributionImages').disabled=false;}
  }
  function renderPrivateImages(root,attachments){
    const list=el('div');for(const [index,ref] of (attachments||[]).entries()){
      if(!attachmentId(ref?.attachment_id))continue;const section=el('section'),link=el('a','Image '+(index+1));link.href=apiRoot+'/attachment?id='+encodeURIComponent(ref.attachment_id);link.target='_blank';link.rel='noopener noreferrer';section.append(link);
      const values=imageFields.filter(([key])=>typeof ref.metadata?.[key]==='string'&&ref.metadata[key]).map(([key,label])=>[label,ref.metadata[key]]);if(values.length)section.append(metadata(values));list.append(section);
    }if(list.childElementCount)root.append(disclosure('Images',list));
  }
  byId('contributionImages').addEventListener('change',stageImages);
  byId('retryContributionImages').addEventListener('click',uploadImages);
  window.addEventListener('beforeunload',event=>{if(stagedImages.some(entry=>!entry.receipt)){event.preventDefault();event.returnValue='';}});
  function buildIntakeEnvelope(){
    const explanation=revisionOriginal&&byId('contributionSummary').value===openExplanationDisplayInitial?openExplanationInitial:byId('contributionSummary').value;
    // Existing typed submissions keep every payload/source field. Their summary alone is editable here.
    if(revisionOriginal&&revisionOriginal.type!=='open_proposal'){
      const revised={...structuredClone(revisionOriginal),summary:explanation};
      if(revised.type==='record_update')revised.payload.change_message=explanation;
      return revised;
    }
    const prior=revisionOriginal?structuredClone(revisionOriginal):null;
    const payload=prior?prior.payload:{explanation,geometry:null};
    payload.explanation=explanation;
    const sourcesText=byId('freeformSources').value;
    if(!prior||sourcesText!==openSourcesDisplayInitial)payload.sources_text=sourcesText===''?null:sourcesText;
    const attributes=attributeValues();if(attributes.length||Object.hasOwn(payload,'attributes'))payload.attributes=attributes;
    return prior?{...prior,summary:explanation,targets:structuredClone(openTargets),payload}:{schema_version:'1.0',type:'open_proposal',task_ids:[...openTaskIds],title:'Contribution',summary:explanation,public_credit:{consent:false,label:''},sources:[],attachments:[],targets:structuredClone(openTargets),payload};
  }
  function buildEnvelope(){
    return buildIntakeEnvelope();
  }
  function buildLegacyEnvelope(){
    if(simpleFlow()!=='other')return buildSimpleEnvelope();
    const type=byId('contributionType').value, prior=revisionOriginal?.type===type?revisionOriginal:null, payload=structuredClone(type==='entry_bundle'?prior?.payload?.Entries?.[0]||{}:prior?.payload||{});
    byId('typedPayloadFields').querySelectorAll('[data-field]:not([data-row-field])').forEach(input=>setPath(payload,input.dataset.field,fieldValue(input)));
    const credit={consent:byId('publicCreditConsent').checked,label:byId('publicCreditConsent').checked?byId('publicCreditLabel').value:''};
    const creditChanged=!!prior&&(credit.consent!==!!prior.public_credit?.consent||credit.label!==(prior.public_credit?.label||''));
    const sources=rows('submissionSources').map(source=>{const clean={...source};delete clean.source_type;return clean;}),targets=rows('submissionTargets').map(t=>({...t,expected_hash:t.expected_hash||null})),attachments=rows('submissionAttachments');
    if(type==='layer_candidate'){
      payload.bounds=[[payload.south,payload.west],[payload.north,payload.east]];['south','west','north','east'].forEach(k=>delete payload[k]);['capture_date','publication_date','georeferencing_date'].forEach(k=>{if(!payload[k])payload[k]=null;});
    }
    if(type==='filter_proposal'){
      if(payload.operator==='in')payload.value=text(payload.value).split(',').map(v=>v.trim()).filter(Boolean);
      if(payload.operator==='range')payload.value=text(payload.value).split(',').map(v=>v.trim()).filter(Boolean).map(Number);
      if(payload.operator==='is_unknown')payload.value=null;
      payload.expected_fixture_counts={total:payload.fixture_total,matched:payload.fixture_matched,unknown:payload.fixture_unknown};['fixture_total','fixture_matched','fixture_unknown'].forEach(k=>delete payload[k]);
    }
    let finalPayload=payload;
    if(type==='citation_correction')payload.add_sources=sources;
    if(type==='entry_bundle'){
      payload.contributor=!creditChanged&&prior?.payload?.Entries?.[0]?.contributor?prior.payload.Entries[0].contributor:(credit.consent&&credit.label?credit.label:'Uncredited contributor');
      const linkedSources=sources.map(s=>({...s,entry_id:s.entry_id||payload.entry_id}));
      const searches=rows('submissionSearches').map(s=>({...s,entry_id:s.entry_id||payload.entry_id,researcher:creditChanged?payload.contributor:s.researcher||payload.contributor}));
      finalPayload={Entries:[payload],Sources:linkedSources,SearchLog:searches};
    }
    return {schema_version:'1.0',type,task_ids:byId('contributionTask').value?[byId('contributionTask').value]:[],title:byId('contributionTitle').value,summary:byId('contributionSummary').value,public_credit:credit,sources:prior&&['entry_bundle','citation_correction'].includes(type)?prior.sources:sources,attachments,targets,payload:finalPayload};
  }
  function invalidatePreview(){preview=null;byId('contributionPreview').hidden=true;byId('contributionReceipt').hidden=true;}
  function errorControl(path){
    if(!path)return null;
    if(isOpenForm()){
      if(path==='summary'||path==='payload.explanation')return byId('contributionSummary');
      if(path==='payload.sources_text')return byId('freeformSources');
      if(path==='targets'||path.startsWith('targets.'))return byId('freeformPlaceSelect');
      const attribute=path.match(/^payload\.attributes\.(\d+)(?:\.(name|value))?$/);if(attribute)return byId('contributionAttributes').children[Number(attribute[1])]?.querySelector('[data-attribute="'+(attribute[2]||'name')+'"]');
      return null;
    }
    if(simpleFlow()!=='other'){if(path==='clarificationTarget'||path==='targets')return byId('clarificationTarget');if(['payload.text','payload.description'].includes(path))return byId('contributionSummary');if(path==='payload.geometry_basis')return simpleControl('geo_basis');if(path==='payload.geometry_status')return simpleControl('area_status');const key=path.replace(/^payload\./,'').replace(/^Entries\.0\./,'').replace(/^dates\./,'');const input=simpleControl(key);if(input)return input;if(key==='geometry'||key.startsWith('geometry.'))return simpleControl(simpleValue('area_input')==='geojson'?'geometry_json':'south');if(key==='geo_source_ref')return byId('submissionSources').querySelector('[data-row-field=role]');if(key==='sources')return byId('addSubmissionSource');}
    const common={title:'contributionTitle',summary:'contributionSummary',type:'contributionType','public_credit.label':'publicCreditLabel'};
    if(common[path])return byId(common[path]);
    const normalized=path.replace(/^payload\./,'').replace(/\[(\d+)\]/g,'.$1');
    const row=normalized.match(/^(Sources|sources|add_sources|targets|attachments|SearchLog)\.(\d+)\.(.+)$/);
    if(row){const container={Sources:'submissionSources',sources:'submissionSources',add_sources:'submissionSources',targets:'submissionTargets',attachments:'submissionAttachments',SearchLog:'submissionSearches'}[row[1]];return [...(byId(container)?.querySelectorAll('[data-row]')||[])][Number(row[2])]?.querySelector('[data-row-field="'+CSS.escape(row[3])+'"]')||null;}
    return byId('wf-'+normalized.replace(/^Entries\.0\./,'').replace(/[^a-zA-Z0-9_-]/g,'-'));
  }
  function renderErrors(errors){
    const root=byId('workflowErrors');root.replaceChildren();byId('typedContributionForm').querySelectorAll('[aria-invalid]').forEach(input=>input.removeAttribute('aria-invalid'));if(!errors?.length){root.hidden=true;return;}
    root.append(el('h4','Errors'));const list=el('ul');errors.forEach(err=>{const li=el('li'),message=typeof err==='string'?err:err.message||pretty(err),input=typeof err==='object'?errorControl(err.field):null;if(input){input.setAttribute('aria-invalid','true');const link=el('a',message);link.href='#'+input.id;link.addEventListener('click',event=>{event.preventDefault();let parent=input.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}input.focus();input.scrollIntoView({block:'center'});});li.append(link);}else li.textContent=message;list.append(li);});root.append(list);root.hidden=false;root.focus();
  }
  async function api(path,body){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
    const response=await fetch(apiRoot+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});
    let data;try{data=await response.json();}catch{throw Object.assign(new Error('The contribution service returned an unreadable response.'),{status:response.status,uncertain:true});}
    if(!response.ok){if(response.status===401||response.status===403){clearPrivateView(response.status===401?'Submissions unavailable':'Submission not permitted');if(response.status===401)accessActions(byId('workflowConnection'));}const err=data.error;throw Object.assign(new Error(typeof err==='string'?err:err?.message||data.message||'Contribution request failed.'),{status:response.status,data});}return data;
    }finally{clearTimeout(timeout);}
  }
  function empty(container,message){container.replaceChildren(el('p',message,'empty'));}
  function switchView(id,focus=true){
    const title=byId('sidecarTitle');if(title)title.textContent=({taskView:'Tasks',submissionView:'Submit',reviewView:'Review'})[id]||title.textContent;
    document.querySelectorAll('.workflow-view').forEach(n=>n.hidden=n.id!==id);document.querySelectorAll('[data-workflow-view]').forEach(b=>{const active=b.dataset.workflowView===id;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    if(focus)byId(id).querySelector('h3')?.focus();
  }
  function refList(refs){const list=el('ul',undefined,'workflow-refs');(refs||[]).forEach(ref=>{const li=el('li');const url=typeof ref==='string'?safeLink(ref):ref.kind==='url'?safeLink(ref.value):safeLink(ref.url);const label=typeof ref==='string'?ref:ref.label||ref.value||ref.url||pretty(ref);if(url){const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener';li.append(a);}else li.append(el('span',label));list.append(li);});return list;}
  function metadata(items){const dl=el('dl',undefined,'workflow-metadata');items.forEach(([k,v])=>{dl.append(el('dt',k),el('dd',v??'Unknown'));});return dl;}
  function labeledControl(label,input){const node=el('label');node.append(el('span',label),input);return node;}
  function resetContributionForm(){byId('typedContributionForm').reset();['submissionSources','submissionTargets','submissionAttachments','targetSnapshot'].forEach(id=>byId(id).replaceChildren());byId('publicCreditLabel').disabled=true;byId('useContributionTarget').disabled=true;renderErrors([]);}

  function applyDashboard(data){dashboard=data;sharedTasks=data.tasks||sharedTasks;connectionVersion++;
    byId('workflowConnection').textContent=caps().can_submit?'':'Read-only';
    byId('reviewCapabilityNotice').textContent=caps().independent_review_available?'':'Independent reviewer required';
    const targetSelect=byId('contributionTargetPick');targetSelect.replaceChildren();const first=el('option',(data.targets||[]).length?'Choose a record':'No records');first.value='';targetSelect.append(first);(data.targets||[]).forEach((target,index)=>{const option=el('option',target.title);option.value=String(index);targetSelect.append(option);});byId('useContributionTarget').disabled=true;
    renderTaskList();renderQueue();renderJobs();renderClarificationTargets();
    const confirm=byId('confirmContribution');if(confirm)confirm.disabled=!caps().can_submit||busy||!!pendingWrite||preview?.result?.validation?.valid!==true;
    if(pendingWrite)showReconciliation();
  }
  async function loadDashboard(){try{const data=await api('/dashboard');applyDashboard(data);return data;}catch(error){clearPrivateView(error.status===401?'Submissions unavailable':'Review unavailable');await accessActions(byId('workflowConnection'));if(pendingWrite)showReconciliation();return null;}}
  function rawDisclosure(title,value){const details=el('details',undefined,'workflow-details');details.append(el('summary',title));const pre=el('pre',pretty(value),'workflow-raw');details.append(pre);return details;}
  function validationView(validation){const root=el('div',undefined,'validation-result');root.append(el('strong',validation?.valid?'Valid':'Check fields'));['errors','warnings'].forEach(kind=>{if(validation?.[kind]?.length){root.append(el('h4',kind==='errors'?'Errors':'Warnings'));const list=el('ul');validation[kind].forEach(e=>list.append(el('li',typeof e==='string'?e:e.message||pretty(e))));root.append(list);}});return root;}
  function diffView(diff){const root=el('details',undefined,'field-diff workflow-details');root.append(el('summary','Changes'));if(!diff||Array.isArray(diff)&&!diff.length){root.append(el('p','No data changes','small'));return root;}
    const changes=Array.isArray(diff)?diff:[diff];changes.forEach(change=>{const row=el('div',undefined,'diff-row');row.append(el('strong',change.field||change.path||change.record_id||'Proposed change'));const pair=el('div',undefined,'diff-pair');[['Before',change.before],['After',change.after]].forEach(([label,value])=>{const cell=el('div');cell.append(el('small',label),el('pre',value===undefined?'Not specified':pretty(value)));pair.append(cell);});row.append(pair);if(change.field===undefined&&change.before===undefined&&change.after===undefined)row.append(rawDisclosure('Details',change));root.append(row);});return root;}
  function editorialChecks(submission){const root=el('div',undefined,'editorial-checks');root.append(el('h4','Checks'));const checks=submission?.approval?.checks||submission?.checks||{};const list=el('dl',undefined,'workflow-metadata');['evidence_check','geography_check','rights_check','duplicate_check'].forEach(k=>list.append(el('dt',k.replace('_check','')),el('dd',checks[k]||submission?.approval?.[k]||'pending')));list.append(el('dt','Privacy review'),el('dd',checks.privacy_check||submission?.approval?.privacy_check||submission?.approval?.privacy_review||'pending'));root.append(list);return root;}
  function intakeText(value){const node=el('p',value);node.style.whiteSpace='pre-wrap';return node;}
  function renderPreview(envelope,result,raw){
    const root=byId('contributionPreview');root.replaceChildren();root.hidden=false;root.append(el('h3','Preview'));root.firstChild.id='previewContributionTitle';
    if(envelope.type==='open_proposal'){
      root.append(intakeText(envelope.payload.explanation));if(result.local)root.append(el('p','Local preview','small'));
      if(envelope.payload.attributes?.length)root.append(disclosure('Details',metadata(envelope.payload.attributes.map(a=>[a.name,a.value]))));
      if(openTargetLabel)root.append(el('p',openTargetLabel));
      if(envelope.payload.sources_text)root.append(rawDisclosure('Sources',envelope.payload.sources_text));
      if(envelope.targets.length)root.append(rawDisclosure('Reference',envelope.targets));
      if(!result.local&&!result.validation?.valid)root.append(validationView(result.validation));
      if(revisionOf)root.append(diffView(result.diff));
      root.append(rawDisclosure('Original',raw));
    }else{
      root.append(intakeText(envelope.summary),el('p','Review only','small'),validationView(result.validation),diffView(result.diff),rawDisclosure('Original',raw));
    }
    const send=button(revisionOf?'Revise':'Submit',submitPreview,'primary');send.id='confirmContribution';send.disabled=!caps().can_submit||busy||result.validation?.valid!==true;root.append(send);root.focus();
  }
  async function previewForm(event){
    event.preventDefault();if(imageProcessing||imageBusy)return;if(pendingWrite){renderErrors(['Save outcome unknown. Check the queue before retrying.']);showReconciliation();return;}
    renderErrors([]);const errors=[],explanation=byId('contributionSummary').value;
    if(!explanation.trim())errors.push({field:'summary',message:'Describe what you would like to contribute'});
    if(isOpenForm()&&explanation.length>15000)errors.push({field:'summary',message:'Use 15,000 characters or fewer'});
    if(imageBatch){imageStatus('Contribution saved. Images not saved',true);return;}
    if(isOpenForm()&&byId('contributionPlaceMode').value==='existing'&&!openRequestedRecordId&&!openTargets.length)errors.push({field:'targets',message:'Choose an existing place'});
    for(const [i,row] of attributeValues().entries()){if(!row.name.trim())errors.push({field:'payload.attributes.'+i+'.name',message:'Add a name'});if(!row.value.trim())errors.push({field:'payload.attributes.'+i+'.value',message:'Add a value'});}
    if(errors.length){renderErrors(errors);return;}let envelope,raw;
    try{envelope=buildEnvelope();raw=JSON.stringify(envelope,null,2);}catch(error){renderErrors([{field:error.field,message:error.message}]);return;}
    const local=()=>{const result={local:true,validation:{valid:false}};preview={raw,envelope,result};renderPreview(envelope,result,raw);};
    if(openTargetPending||openTargetFailed||draftRevisionBlocked){local();return;}
    byId('previewContribution').disabled=true;
    try{const result=await api('/preview',{submission_json:raw,...(revisionOf?{submission_id:revisionOf.id,expected_revision:revisionOf.revision}:{})});preview={raw,envelope,result:result.preview};renderPreview(envelope,result.preview,raw);if(!result.preview.validation?.valid)renderErrors(result.preview.validation?.errors||[]);}
    catch(error){local();serviceFailure(error,()=>byId('previewContribution').click());}
    finally{byId('previewContribution').disabled=false;}
  }

  async function submitPreview(){
    if(pendingWrite){renderErrors(['Save outcome unknown. Check the queue before retrying.']);showReconciliation();return;}
    if(!preview||!caps().can_submit||busy||imageProcessing||imageBusy||imageBatch||draftRevisionBlocked)return;
    const exact=preview;
    if(JSON.stringify(buildEnvelope(),null,2)!==exact.raw){invalidatePreview();renderErrors(['Form changed. Preview again.']);return;}
    busy=true;byId('confirmContribution').disabled=true;let request=null;
    try{
      const actor_id=await sessionActor();
      if(pendingWrite)throw Object.assign(new Error('Previous save unresolved; check the queue'),{status:409});
      if(JSON.stringify(buildEnvelope(),null,2)!==exact.raw)throw Object.assign(new Error('Form changed. Preview again.'),{status:400});
      request=revisionOf?{actor_id,path:'/revise',body:{idempotency_key:crypto.randomUUID(),submission_id:revisionOf.id,expected_revision:revisionOf.revision,submission_json:exact.raw}}:{actor_id,path:'/submit',body:{idempotency_key:crypto.randomUUID(),submission_json:exact.raw}};
      retainWrite(request);const response=requireReceipt(await api(request.path,request.body),request);
      retainWrite(null);clearSavedDraft(request);showReceipt(response.submission,response);preview=null;byId('contributionPreview').hidden=true;await beginImages(response.submission,request);await loadDashboard();
    }catch(error){
      const uncertain=!!request&&(error.uncertain||!error.status||error.status>=500);
      if(uncertain)renderErrors([]);else if(error.status===400)renderErrors([error.message]);else serviceFailure(error);
      if(!uncertain){if(request)retainWrite(null);}else showReconciliation();
    }finally{busy=false;const confirm=byId('confirmContribution');if(confirm)confirm.disabled=!!pendingWrite||!caps().can_submit||!preview?.result?.validation?.valid;}
  }
  function showReceipt(submission,response){const root=byId('contributionReceipt');root.replaceChildren();root.hidden=false;root.append(el('h3','Saved'),metadata([['Submission',submission.id],['Revision',response.receipt.result.revision??submission.revision],['Status',statusLabel(submission.status)],['Receipt',response.receipt.id]]));if(submission.id)root.append(button('Review',async()=>{switchView('reviewView');await loadSubmission(submission.id);},'outline'));root.focus();}

  function clearRevision(){revisionOf=null;revisionOriginal=null;byId('revisionContext').hidden=true;byId('cancelRevision').hidden=true;invalidatePreview();}
  function loadRevision(submission){
    if(imageBatch){imageStatus('Contribution saved. Images not saved',true);return;}
    let value;try{value=JSON.parse(submission.raw_json);}catch{return;}
    if(value.type==='record_update'){window.dispatchEvent(new CustomEvent('record-edit-revision-requested',{detail:{submission:structuredClone(submission),opener:document.activeElement}}));return;}
    clearRevision();resetContributionForm();resetOpenContext();revisionOriginal=structuredClone(value);revisionOf={id:submission.id,revision:submission.revision};
    openExplanationInitial=value.type==='open_proposal'?value.payload.explanation:value.summary||'';byId('contributionSummary').value=openExplanationInitial;openExplanationDisplayInitial=byId('contributionSummary').value;
    openTargets=structuredClone(value.targets||[]);openRequestedRecordId=openTargets[0]?.record_id||'';openTargetLabel=openRequestedRecordId;openTaskIds=[...(value.task_ids||[])];
    openSourcesInitial=value.type==='open_proposal'?value.payload.sources_text??'':'';byId('freeformSources').value=openSourcesInitial;openSourcesDisplayInitial=byId('freeformSources').value;
    for(const attribute of value.payload.attributes||[])addAttribute(attribute);
    for(const id of ['freeformContext','freeformImages','freeformDetails','freeformPlaceChoice'])byId(id).hidden=value.type!=='open_proposal';showOpenReference();if(value.type!=='open_proposal')byId('freeformRecordContext').hidden=true;
    byId('revisionContext').replaceChildren(el('span','Revision '+submission.revision),el('br'),el('span','Submission: '+submission.id));byId('revisionContext').hidden=false;byId('cancelRevision').hidden=false;invalidatePreview();switchView('submissionView',false);byId('contributionSummary').focus();
  }

  function renderQueue(){const items=dashboard?.submissions||[],filter=byId('queueState').value,visible=items.filter(s=>filter==='all'||s.status===filter);byId('queueSummary').textContent=dashboard?`${visible.length} ${visible.length===1?'submission':'submissions'}`:'';const root=byId('contributionQueue');root.replaceChildren();if(!visible.length){empty(root,!dashboard?'Review unavailable':items.length?'No matches':'No submissions');return;}visible.forEach(s=>{const b=button('',()=>loadSubmission(s.id),'queue-item');b.append(el('strong',s.title||s.id),el('span','Submission: '+s.id),el('span','Revision: '+s.revision),el('small','Status: '+statusLabel(s.status)));root.append(b);});}

  async function loadSubmission(id){const root=byId('submissionDetail');root.hidden=false;root.replaceChildren(el('p','Loading…','small'));try{const data=await api('/submission?id='+encodeURIComponent(id));selectedSubmission=data.submission;renderSubmission(selectedSubmission);root.focus();}catch(error){empty(root,error.message);}}
  function renderSubmission(s){const root=byId('submissionDetail');root.replaceChildren();root.hidden=false;root.append(el('h3','Review'),el('strong',s.title||s.id),metadata([['Submission',s.id],['Revision',s.revision],['Status',statusLabel(s.status)]]),disclosure('Details',metadata([['Type',labels[s.type]||s.type],['Credit',s.public_credit?.consent?s.public_credit.label:'None'],['Created',s.created_at],['Updated',s.updated_at],['Payload hash',s.payload_hash],['Diff hash',s.diff_hash]]),validationView(s.validation)),diffView(s.diff),editorialChecks(s));
    if(s.type==='open_proposal'){
      let original;try{original=JSON.parse(s.raw_json);}catch{}
      if(original?.payload){root.append(intakeText(original.payload.explanation));if(original.payload.sources_text)root.append(rawDisclosure('Sources',original.payload.sources_text));if(original.payload.attributes?.length)root.append(disclosure('Details',metadata(original.payload.attributes.map(a=>[a.name,a.value]))));root.append(metadata([['Evidence','Unverified']]));}
    }
    renderPrivateImages(root,s.attachments);
    if(s.type==='record_update'&&s.proposal?.change_message)root.append(el('h4','Message'),intakeText(s.proposal.change_message));
    if(!s.application?.applicable)root.append(el('p','Review only','small'));
    if(s.targets?.length)root.append(rawDisclosure('Targets',s.targets));root.append(rawDisclosure('Original',s.raw_json));
    const history=el('details',undefined,'workflow-details');history.append(el('summary','History'));const list=el('ol');[...(s.revisions||[]),...(s.events||[])].forEach(event=>list.append(el('li',pretty(event))));if(!list.children.length)list.append(el('li','No events'));history.append(list);root.append(history);
    if(s.is_own&&caps().can_submit)root.append(button('Revise',()=>loadRevision(s),'outline'));
    if(s.capabilities?.can_triage||s.capabilities?.can_withhold){const form=el('form',undefined,'triage-form');form.append(el('h4','Triage'));const select=el('select');select.setAttribute('aria-label','Triage action');[...(s.capabilities?.can_triage?[['request_information','Request information'],['ready_for_review','Submit for review']]:[]),...(s.capabilities?.can_withhold?[['withhold','Withhold']]:[])].forEach(([value,label])=>{const o=el('option',label);o.value=value;select.append(o);});const reason=el('textarea');reason.rows=3;reason.required=true;reason.setAttribute('aria-label','Triage reason');reason.placeholder='';const save=el('button','Save','outline');save.type='submit';const output=el('p',undefined,'small');output.setAttribute('role','status');form.append(labeledControl('Action',select),labeledControl('Reason',reason),save,output);form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{await safeMutation('/triage',{idempotency_key:crypto.randomUUID(),submission_id:s.id,expected_revision:s.revision,action:select.value,rationale:reason.value});await loadDashboard();await loadSubmission(s.id);}catch(error){output.textContent=error.message;save.disabled=false;}});root.append(form);}
    renderReviewControls(root,s);
  }
  function renderJobs(){const root=byId('applicationJobs'),jobs=dashboard?.jobs||[];root.replaceChildren();if(!jobs.length){empty(root,'No jobs');return;}jobs.forEach(job=>{const card=el('details',undefined,'job-card');card.append(el('summary',job.id),metadata([['Status',statusLabel(job.status||job.state)||'Unknown']]));card.append(rawDisclosure('Receipt',job),button('Refresh',async()=>{try{const data=await api('/job?id='+encodeURIComponent(job.id));card.append(rawDisclosure('Receipt',data.job));}catch(error){card.append(el('p',error.message,'error'));}},'outline'));jobControls(card,job);root.append(card);});}
  function showReconciliation(ready=false){
    if(!pendingWrite)return;
    const root=byId('workflowConnection');root.querySelector('[data-reconciliation]')?.remove();
    const controls=el('span');controls.dataset.reconciliation='true';controls.append(el('span',' Save outcome unknown '));root.append(controls);
    const retry=button(ready?'Retry save':'Check queue',async()=>{
      retry.disabled=true;
      if(!ready){const data=await loadDashboard();showReconciliation(!!data);return;}
      if(!pendingWrite)return;const request=pendingWrite,selectedId=selectedSubmission?.id;
      try{
        await requireOriginalActor(request);const result=requireReceipt(await api(request.path,request.body),request);retainWrite(null);renderErrors([]);
        if(result.submission){if(['/submit','/revise'].includes(request.path))clearSavedDraft(request);showReceipt(result.submission,result);if(['submit','revise'].includes(request.path.slice(1)))await beginImages(result.submission,request);}
        else{byId('contributionReceipt').replaceChildren(el('h3','Saved'),metadata([['Receipt',result.receipt.id]]));byId('contributionReceipt').hidden=false;}
        await loadDashboard();
        if(selectedId&&result.submission?.id===selectedId)await loadSubmission(selectedId);
        if(dashboard)byId('workflowConnection').textContent='Saved';
        if(result.job&&['verified','rolled_back'].includes(result.job.status))window.dispatchEvent(new CustomEvent('contributions-records-changed'));
      }catch(error){
        // A rejected retry cannot establish whether the earlier uncertain write committed.
        showReconciliation(error.status!==401);root.append(el('span',' '+(error.status===401?'Submissions unavailable':error.message)));
      }
    },'outline');retry.dataset.reconciliationAction=ready?'retry':'check';controls.append(retry);
  }
  async function safeMutation(path,body){
    if(pendingWrite)throw new Error('Previous save unresolved; check the queue');
    const actor_id=await sessionActor();if(pendingWrite)throw new Error('Previous save unresolved; check the queue');const request={actor_id,path,body};retainWrite(request);try{const result=requireReceipt(await api(path,body),request);retainWrite(null);return result;}catch(error){if(error.uncertain||!error.status||error.status>=500){error.message='Save outcome unknown; check the queue before retrying. '+error.message;showReconciliation();}else retainWrite(null);throw error;}
  }
  function renderReviewControls(root,s){
    const canReview=!!caps().can_review&&!!caps().independent_review_available&&!s.is_own&&s.status==='submitted'&&s.validation?.valid===true;
    const form=el('form',undefined,'approval-form');form.append(el('h4','Review'));
    const checkFields={};['evidence_check','geography_check','rights_check','duplicate_check','privacy_check'].forEach(key=>{
      const label=el('label',key==='privacy_check'?'Privacy review':key.replace('_check','')+' review');const select=el('select');select.setAttribute('aria-label',key);['pending','pass','fail'].forEach(value=>{const option=el('option',statusLabel(value));option.value=value;select.append(option);});select.disabled=!canReview;checkFields[key]=select;label.append(select);form.append(label);
    });
    const reasonLabel=el('label','Reason');const reason=el('textarea');reason.rows=3;reason.disabled=!canReview;reason.required=true;reason.setAttribute('aria-label','Independent review reason');reasonLabel.append(reason);form.append(reasonLabel);
    const approve=el('button','Approve','outline');approve.type='submit';approve.disabled=true;const result=el('p',undefined,'small');result.setAttribute('role','status');form.append(approve,result);
    const update=()=>approve.disabled=!canReview||Object.values(checkFields).some(input=>input.value!=='pass')||!reason.value.trim();form.addEventListener('input',update);form.addEventListener('change',update);
    form.addEventListener('submit',async event=>{event.preventDefault();if(approve.disabled)return;approve.disabled=true;try{await safeMutation('/review',{idempotency_key:crypto.randomUUID(),submission_id:s.id,expected_revision:s.revision,payload_hash:s.payload_hash,diff_hash:s.diff_hash,checks:Object.fromEntries(Object.entries(checkFields).map(([k,v])=>[k,v.value])),rationale:reason.value});await loadDashboard();await loadSubmission(s.id);}catch(error){result.textContent=error.message;update();}});
    if(!canReview)form.append(el('p',s.is_own?'A different reviewer is required':!caps().can_review||!caps().independent_review_available?'Reviewer permission required':s.status!=='submitted'?'Submit for review first':'Resolve validation errors','small'));
    root.append(form);
    const canApply=!!caps().can_apply&&s.status==='approved'&&s.approval?.independent===true&&s.approval?.revision===s.revision&&s.application?.applicable;
    const apply=button('Apply',async()=>{
      apply.disabled=true;const out=el('div',undefined,'small');root.append(out);try{const result=await safeMutation('/apply',{idempotency_key:crypto.randomUUID(),submission_id:s.id,expected_revision:s.revision,approval_hash:s.approval.approval_hash});out.replaceChildren(metadata([['Job',result.job?.id||'Unknown'],['Status',statusLabel(result.job?.status)||'Recorded']]));await loadDashboard();}catch(error){out.textContent=error.message;apply.disabled=!canApply;}
    },'outline');apply.disabled=!canApply;root.append(apply);
  }
  function jobControls(card,job){
    if(job.status==='verification_pending')card.append(button('Preview',()=>window.dispatchEvent(new CustomEvent('contributions-preview-requested',{detail:job})),'outline'));
    if(!caps().can_apply)return;
    if(job.status==='verification_pending'){
      const form=el('form',undefined,'job-action-form');form.append(el('h4','Verify'));
      const label=el('label','Result');const status=el('select');status.setAttribute('aria-label','Map/list verification outcome');['not_tested','pass','fail'].forEach(value=>{const option=el('option',statusLabel(value));option.value=value;status.append(option);});label.append(status);const evidenceLabel=el('label','Evidence');const evidence=el('textarea');evidence.rows=3;evidence.required=true;evidence.setAttribute('aria-label','Map/list verification evidence');evidenceLabel.append(evidence);const submit=el('button','Verify','outline');submit.type='submit';const output=el('p',undefined,'small');output.setAttribute('role','status');form.append(label,evidenceLabel,submit,output);form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{const result=await safeMutation('/verify',{idempotency_key:crypto.randomUUID(),job_id:job.id,map_list_check:{status:status.value,evidence:evidence.value}});output.textContent=statusLabel(result.job.status);if(['verified','rolled_back'].includes(result.job.status))window.dispatchEvent(new CustomEvent('contributions-records-changed'));await loadDashboard();}catch(error){output.textContent=error.message;submit.disabled=false;}});card.append(form);
    }
    if(caps().can_rollback&&job.status==='verified'){
      const form=el('form',undefined,'job-action-form');form.append(el('h4','Rollback'));const label=el('label','Reason');const reason=el('textarea');reason.rows=3;reason.required=true;reason.setAttribute('aria-label','Rollback reason');label.append(reason);const submit=el('button','Rollback','outline');submit.type='submit';const output=el('p',undefined,'small');output.setAttribute('role','status');form.append(label,submit,output);form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{const result=await safeMutation('/rollback',{idempotency_key:crypto.randomUUID(),job_id:job.id,rationale:reason.value});output.textContent=statusLabel(result.job.status);if(result.job.status==='rolled_back')window.dispatchEvent(new CustomEvent('contributions-records-changed'));await loadDashboard();}catch(error){output.textContent=error.message;submit.disabled=false;}});card.append(form);
    }
  }
  document.querySelectorAll('[data-workflow-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.workflowView)));
  byId('contributionType').addEventListener('change',()=>{renderPayload(byId('contributionType').value);invalidatePreview();});
  byId('publicCreditConsent').addEventListener('change',()=>{byId('publicCreditLabel').disabled=!byId('publicCreditConsent').checked;invalidatePreview();});
  byId('typedContributionForm').addEventListener('input',()=>{invalidatePreview();saveDraft();});byId('typedContributionForm').addEventListener('change',()=>{invalidatePreview();saveDraft();});byId('typedContributionForm').addEventListener('submit',previewForm);
  byId('addSubmissionSource').addEventListener('click',()=>{if(simpleFlow()==='other')addRow('submissionSources',sourceSpecs);else addSimpleSource();invalidatePreview();});byId('addSubmissionTarget').addEventListener('click',()=>{addRow('submissionTargets',targetSpecs);invalidatePreview();});byId('addSubmissionAttachment').addEventListener('click',()=>{addRow('submissionAttachments',attachmentSpecs);invalidatePreview();});
  byId('contributionTargetPick').addEventListener('change',()=>{byId('useContributionTarget').disabled=byId('contributionTargetPick').value==='';});
  byId('useContributionTarget').addEventListener('click',()=>{const index=byId('contributionTargetPick').value;if(index==='')return;const target=dashboard?.targets?.[Number(index)];if(!target)return;addRow('submissionTargets',targetSpecs,{record_id:target.record_id,expected_version:target.expected_version,expected_hash:target.expected_hash});byId('targetSnapshot').replaceChildren(rawDisclosure('Record',target.canonical_entry));invalidatePreview();});
  byId('cancelRevision').addEventListener('click',()=>{clearRevision();resetContributionForm();resetOpenContext();byId('contributionSummary').focus();});
  byId('exportContribution').addEventListener('click',()=>{try{const blob=new Blob([JSON.stringify(buildEnvelope(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download='hauntologies-local-contribution.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);byId('contributionReceipt').replaceChildren(el('p','Exported locally'));byId('contributionReceipt').hidden=false;}catch(error){renderErrors([{field:error.field,message:error.message}]);}});
  byId('queueState').addEventListener('change',renderQueue);byId('refreshContributions').addEventListener('click',loadDashboard);
  for(const [value,label]of [['area_proposal','Proposed area'],['record_annotation','Clarification']])if(![...byId('contributionType').options].some(o=>o.value===value)){const option=new Option(label,value);option.hidden=true;byId('contributionType').append(option);}
  byId('contributionFlow')?.addEventListener('change',()=>{rememberSimple();clearRevision();syncFlow();if(simpleFlow()==='other')renderPayload(byId('contributionType').value);});
  byId('clarificationTarget')?.addEventListener('change',()=>chooseClarification(byId('clarificationTarget').value));
  byId('removeFreeformRecord').addEventListener('click',()=>{++openRequest;openTargets=[];openRequestedRecordId='';openTargetLabel='';openTargetPending=false;openTargetFailed=false;byId('contributionPlaceMode').value='new';showOpenReference();invalidatePreview();saveDraft();byId('contributionSummary').focus();});
  byId('contributionPlaceMode').addEventListener('change',()=>{if(byId('contributionPlaceMode').value==='new'){++openRequest;openTargets=[];openRequestedRecordId='';openTargetLabel='';openTargetPending=false;openTargetFailed=false;}showOpenReference();invalidatePreview();});
  byId('freeformPlaceSelect').addEventListener('change',()=>{const select=byId('freeformPlaceSelect');if(select.value)chooseOpenReference(select.value,select.selectedOptions[0].textContent);else{++openRequest;openTargets=[];openRequestedRecordId='';openTargetLabel='';openTargetPending=false;openTargetFailed=false;showOpenReference();invalidatePreview();}});
  byId('addContributionAttribute').addEventListener('click',()=>{addAttribute()?.focus();invalidatePreview();saveDraft();});
  window.addEventListener('contributions-clarify-requested',event=>{
    const id=event.detail?.recordId;if(typeof id!=='string'||!id)return;
    clearRevision();for(const id of ['freeformContext','freeformImages','freeformDetails','freeformPlaceChoice'])byId(id).hidden=false;chooseOpenReference(id,event.detail?.title);switchView('submissionView',false);byId('contributionSummary').focus();
  });
  window.addEventListener('contributions-records-changed',renderClarificationTargets);
  window.addEventListener('contributions-review-requested',async event=>{
    const id=event.detail?.submissionId;if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(id))return;
    byId('draftTab').click();switchView('reviewView');await loadSubmission(id);
  });
  window.addEventListener('contributions-session-ended',event=>clearPrivateView(event.detail?.disabled?'Sign-in is not enabled yet':'Sign in to submit'));
  window.addEventListener('record-edit-saved',async event=>{await loadDashboard();if(selectedSubmission?.id===event.detail?.submissionId)await loadSubmission(selectedSubmission.id);});
  byId('tasksTool').addEventListener('click',()=>{byId('draftTab').click();switchView('taskView');loadSharedTasks();byId('toolsMenu').hidden=true;byId('toolsButton').setAttribute('aria-expanded','false');});
  byId('createTaskForm').addEventListener('submit',createTask);
  byId('refreshSharedTasks').addEventListener('click',loadSharedTasks);
  restorePendingTask();renderTaskList();loadSharedTasks();
  resetOpenContext();restoreDraft();loadDashboard();

})();
