'use strict';
// Promote to entry: a publisher restates an approved freeform proposal as a structured entry.
// The entry is submitted as a new proposal in the publisher's name and needs its own independent
// review before Apply; the server's preview is the only validator. Load promote-entry-model.js first.
(() => {
  const model = window.PromoteEntryModel;
  if (!model) return;
  const apiRoot = '/api/contributions', storageKey = id => 'hauntologies-promote:' + id;
  const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
  const labels = { report: 'Report', existence: 'Existence', disappearance: 'Disappearance', context: 'Context', geography: 'Geography',
    reported_haunting: 'Reported haunting', vanished_place: 'Vanished place', approximate: 'Approximate', located: 'Located', unresolved: 'Unresolved',
    contextual_estimate: 'Contextual estimate', address_match: 'Address match', gazetteer: 'Gazetteer', historic_map: 'Historic map',
    unknown: 'Unknown', year: 'Single year', range: 'Year range', circa: 'Circa', public_domain: 'Public domain', licensed: 'Licensed', permission: 'Permission', restricted: 'Restricted',
    citation_only: 'Citation only', paraphrase: 'Paraphrase', excerpt: 'Excerpt', media: 'Media' };
  const fieldNames = { title: 'Title', claim_text: 'Claim', place_original: 'Place as recorded', place_normalized: 'Place, normalized', borough: 'Borough',
    time_original: 'Date as recorded', time_basis: 'Date basis', geo_basis: 'Location basis', geo_source_ref: 'Geography source', record_license: 'Record license',
    rights_notes: 'Rights notes', citation: 'Citation', repository: 'Repository', locator: 'Locator', evidence_note: 'Evidence note', rights_statement: 'Rights statement', accessed_on: 'Accessed on' };

  let dialog = null, form = null, submission = null, checked = null, opener = null;
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const save = () => { try { sessionStorage.setItem(storageKey(submission.id), JSON.stringify(form)); } catch {} };

  async function request(path, body) {
    const session = await fetch(apiRoot + '/session', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.ok ? r.json() : null);
    if (typeof session?.actor_id !== 'string') throw Object.assign(new Error('Sign in again to continue.'), { status: 401 });
    const response = await fetch(apiRoot + path, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'X-Hauntologies-Actor': session.actor_id }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'The contribution service did not accept this request.'), { status: response.status, data });
    return data;
  }

  // Any edit voids the last check, so Submit always sends exactly what the server validated.
  function changed() { checked = null; save(); renderActions(); }
  function field(parent, label, key, { type = 'text', options, rows, help, target = form, onChange } = {}) {
    const wrap = node('label', label), id = 'promote-' + Math.random().toString(36).slice(2);
    let input;
    if (options) { input = node('select'); for (const value of options) { const option = node('option', labels[value] || value); option.value = value; input.append(option); } }
    else if (rows) { input = node('textarea'); input.rows = rows; }
    else { input = node('input'); input.type = type; }
    input.id = id; wrap.htmlFor = id; input.value = target[key] ?? '';
    input.addEventListener(options ? 'change' : 'input', () => { target[key] = type === 'number' && input.value !== '' ? Number(input.value) : input.value; changed(); onChange?.(); });
    wrap.append(input);
    if (help) wrap.append(node('span', help, 'promote-help'));
    parent.append(wrap);
    return input;
  }
  function section(title) { const set = node('fieldset', undefined, 'promote-section'); set.append(node('legend', title)); body.append(set); return set; }

  let body, actions;
  function render() {
    body.replaceChildren();
    const from = node('section', undefined, 'promote-reference');
    from.append(node('h3', 'From the proposal'), node('p', form.claim_text || '—'));
    if (form.reference.sources_text) from.append(node('p', 'Sources as given: ' + form.reference.sources_text));
    for (const attribute of form.reference.attributes) from.append(node('p', attribute.name + ': ' + attribute.value));
    from.append(node('p', 'Credit: ' + (form.public_credit.consent && form.public_credit.label ? form.public_credit.label : 'Uncredited contributor')));
    body.append(from);

    const entry = section('Entry');
    field(entry, 'Category', 'category', { options: Object.keys(model.categories), onChange: () => { form = model.withRequiredSources(form, today()); changed(); render(); } });
    field(entry, 'Title', 'title');
    field(entry, 'Claim', 'claim_text', { rows: 4, help: 'State what the sources report, not that it happened.' });

    const place = section('Place');
    field(place, 'Place as recorded', 'place_original', { help: 'Wording from the source, kept as written.' });
    field(place, 'Place, normalized', 'place_normalized', { help: 'Current name or address a reader can find.' });
    field(place, 'Borough', 'borough', { options: model.boroughs });

    const date = section('Date');
    field(date, 'Date as recorded', 'time_original');
    field(date, 'Precision', 'time_precision', { options: model.precisions, onChange: render });
    if (form.time_precision !== 'unknown') {
      field(date, form.time_precision === 'year' ? 'Year' : 'From year', 'time_start_year', { type: 'number' });
      if (form.time_precision !== 'year') field(date, 'Through year', 'time_end_year', { type: 'number' });
    }
    field(date, 'Basis', 'time_basis', { rows: 2 });

    const location = section('Location');
    field(location, 'Status', 'geo_status', { options: form.latitude === null ? ['unresolved'] : model.geoStatuses, onChange: render });
    if (form.geo_status !== 'unresolved') {
      location.append(node('p', 'Point from the proposal: ' + form.latitude.toFixed(5) + ', ' + form.longitude.toFixed(5), 'promote-help'));
      field(location, 'Method', 'geo_method', { options: model.geoMethods.filter(m => m !== 'unresolved') });
      field(location, 'Uncertainty radius (m)', 'uncertainty_m', { type: 'number' });
    }
    field(location, 'Basis', 'geo_basis', { rows: 2 });

    const sources = section('Sources');
    const required = model.categories[form.category]?.roles || [];
    sources.append(node('p', 'Required for this category: ' + required.map(r => labels[r]).join(', ') + (form.geo_status !== 'unresolved' ? ', Geography' : '') + '.', 'promote-help'));
    form.sources.forEach((row, index) => {
      const item = node('details', undefined, 'workflow-details promote-source');
      item.dataset.hint = ''; item.open = !row.citation;
      item.append(node('summary', labels[row.role] + ' source'));
      field(item, 'Role', 'role', { options: model.roles, target: row, onChange: render });
      field(item, 'Citation', 'citation', { rows: 2, target: row });
      field(item, 'Repository', 'repository', { target: row });
      field(item, 'Locator', 'locator', { target: row, help: 'Page, folio, box or URL fragment.' });
      field(item, 'Source date as given', 'source_date_original', { target: row });
      field(item, 'Accessed on', 'accessed_on', { type: 'date', target: row });
      field(item, 'Evidence note', 'evidence_note', { rows: 2, target: row, help: 'What this source supports, and what it does not.' });
      field(item, 'Rights status', 'rights_status', { options: model.rightsStatuses, target: row });
      field(item, 'Rights statement', 'rights_statement', { target: row });
      field(item, 'Public use', 'public_use', { options: model.publicUses, target: row });
      field(item, 'Link', 'url', { type: 'url', target: row });
      const remove = node('button', 'Remove source', 'textbutton'); remove.type = 'button';
      remove.addEventListener('click', () => { form.sources.splice(index, 1); changed(); render(); });
      item.append(remove);
      sources.append(item);
    });
    const add = node('button', 'Add source', 'outline'); add.type = 'button';
    add.addEventListener('click', () => { form.sources.push(model.source('context', today())); changed(); render(); });
    sources.append(add);

    const rights = section('Rights');
    field(rights, 'Record license', 'record_license', { options: ['', ...model.licenses] });
    field(rights, 'Rights notes', 'rights_notes', { rows: 2 });
    renderActions();
  }

  function renderActions(errors) {
    actions.replaceChildren();
    if (errors?.length) {
      const list = node('ul', undefined, 'promote-errors'); list.setAttribute('role', 'alert');
      for (const error of errors) { const key = String(error.field || '').split('.').at(-1); list.append(node('li', (fieldNames[key] ? fieldNames[key] + ': ' : '') + (error.message || error))); }
      actions.append(list);
    }
    const check = node('button', 'Check entry', 'outline'); check.type = 'button';
    check.addEventListener('click', runCheck);
    const submit = node('button', 'Submit entry for review', 'primary'); submit.type = 'button'; submit.disabled = !checked;
    submit.addEventListener('click', runSubmit);
    actions.append(node('p', checked ? 'Checked. Submitting creates a new proposal in your name; a reviewer other than you must approve it before Apply.' : 'Check the entry before submitting it.', 'promote-help'), check, submit);
  }

  async function runCheck() {
    const raw = JSON.stringify(model.envelope(form), null, 2);
    try {
      const data = await request('/preview', { submission_json: raw });
      const validation = data.preview?.validation;
      if (validation?.valid && data.preview.application?.applicable) { checked = { raw, key: crypto.randomUUID() }; renderActions(); actions.querySelector('.primary')?.focus(); }
      else { checked = null; renderActions(validation?.errors?.length ? validation.errors : [{ message: data.preview?.application?.reason || 'This entry cannot be applied yet.' }]); }
    } catch (error) { renderActions([{ message: error.message }]); }
  }
  async function runSubmit() {
    if (!checked) return;
    const button = actions.querySelector('.primary'); button.disabled = true;
    try {
      const data = await request('/submit', { idempotency_key: checked.key, submission_json: checked.raw });
      try { sessionStorage.removeItem(storageKey(submission.id)); } catch {}
      actions.replaceChildren(node('p', 'Entry ' + form.entry_id + ' submitted as ' + (data.submission?.id || 'a new proposal') + '. It appears in Review; a reviewer other than you must approve it before you can apply it.', 'promote-receipt'));
      actions.firstChild.setAttribute('role', 'status');
      window.dispatchEvent(new CustomEvent('contributions-refresh-requested'));
    } catch (error) {
      // A lost response keeps the same idempotency key, so retrying cannot create a duplicate.
      renderActions([{ message: error.message }]); if (!error.status) actions.querySelector('.primary').disabled = false;
    }
  }

  function ensureDialog() {
    if (dialog) return;
    dialog = node('dialog', undefined, 'record-editor promote-entry'); dialog.setAttribute('aria-labelledby', 'promoteEntryTitle');
    const head = node('div', undefined, 'popout-head'), title = node('h2', 'Promote to entry'); title.id = 'promoteEntryTitle';
    const close = node('button', undefined, 'close-control'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.append(node('span', '×'));
    close.firstChild.setAttribute('aria-hidden', 'true'); close.addEventListener('click', () => dialog.close());
    head.append(title, close);
    const content = node('div', undefined, 'record-editor-content');
    content.append(node('p', 'Restate this approved proposal as a structured entry. The proposal stays as it is.', 'promote-help'));
    body = node('div', undefined, 'promote-body'); actions = node('div', undefined, 'promote-actions');
    content.append(body, actions); dialog.append(head, content); document.body.append(dialog);
    dialog.addEventListener('close', () => (opener?.isConnected ? opener : document.body).focus?.({ preventScroll: true }));
  }

  function open(source, trigger) {
    ensureDialog(); submission = source; opener = trigger; checked = null;
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem(storageKey(source.id)) || 'null'); } catch {}
    if (saved?.source?.id === source.id && saved.source.revision === source.revision) form = saved;
    else {
      const point = (() => { try { const c = JSON.parse(source.raw_json).payload?.geometry?.coordinates; return Array.isArray(c) ? c : null; } catch { return null; } })();
      const borough = point ? window.NycGeometry?.findBorough(point[1], point[0]) || 'unknown' : 'unknown';
      form = model.draft(source, { today: today(), entryId: model.newEntryId(today(), crypto.randomUUID().replaceAll('-', '')), borough });
    }
    render(); dialog.showModal(); dialog.querySelector('select, input, textarea')?.focus();
  }

  window.addEventListener('contributions-review-rendered', event => {
    const { root, submission: source, capabilities } = event.detail || {};
    if (!root || !model.promotable(source, capabilities)) return;
    const trigger = node('button', 'Promote to entry', 'outline'); trigger.type = 'button';
    trigger.addEventListener('click', () => open(source, trigger));
    root.append(node('p', 'Freeform proposals cannot change the map directly. Promote it to a structured entry, which then needs its own review.', 'small'), trigger);
  });
  window.HauntologiesPromoteEntry = Object.freeze({ open });
})();
