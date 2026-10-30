'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const read = window.HauntologiesPublicReads.json;
  let data = null, contributor = '', place = '', generation = 0, detailGeneration = 0, detailKey = '', refreshedAt = 0;
  const number = value => Number.isInteger(value) ? value.toLocaleString('en-US') : '—';
  const counted = (value, word) => number(value) + ' ' + word + (value === 1 ? '' : 's');
  const metricText = metric => metric?.coverage === 'unavailable' || metric?.value === null ? '—' : number(metric?.value) + (metric?.coverage === 'partial' ? ' recorded' : '');

  function view(name) {
    document.querySelector('.directory-columns').dataset.view = name;
    byId('showContributors').setAttribute('aria-pressed', String(name === 'contributors'));
    byId('showPlaces').setAttribute('aria-pressed', String(name === 'places'));
  }
  byId('showContributors').addEventListener('click', () => view('contributors'));
  byId('showPlaces').addEventListener('click', () => view('places'));

  function renderPeople() {
    const query = byId('contributorSearch').value.trim().toLocaleLowerCase();
    const people = (data?.contributors || []).filter(person => person.name.toLocaleLowerCase().includes(query));
    const names = new Map();
    for (const person of data?.contributors || []) { const key = person.name.toLocaleLowerCase(); names.set(key, (names.get(key) || 0) + 1); }
    byId('peopleList').replaceChildren(...people.map(person => {
      const item = make('li'), button = make('button'); button.type = 'button'; button.setAttribute('aria-pressed', String(person.id === contributor));
      button.append(make('span', person.name, 'person-name'));
      button.append(make('span', person.legacy && !person.published ? 'Earlier activity type unknown' : `${counted(person.published,'contribution')} · ${metricText(person.metrics.added)} added · ${metricText(person.metrics.edits)} edits · ${metricText(person.metrics.notes)} notes`, 'person-counts'));
      button.append(make('span', `${counted(person.place_ids.length,'place')} touched${person.legacy ? ` · ${counted(person.legacy,'older release')}` : ''}`, 'person-counts'));
      if (names.get(person.name.toLocaleLowerCase()) > 1) button.append(make('span', 'Shared username, separate contributor', 'person-identity'));
      button.addEventListener('click', () => {
        contributor = person.id; byId('contributorFilter').hidden = false; byId('selectedContributor').textContent = 'Places contributed to by ' + person.name;
        byId('placeSearch').value = ''; byId('boroughFilter').value = ''; byId('needsDetails').checked = false;
        renderPeople(); renderPlaces(); view('places');
        if (matchMedia('(max-width:720px)').matches) byId('placesHeading').scrollIntoView({ block: 'start' });
        byId('placeSelector').focus({ preventScroll: true });
      });
      item.append(button); return item;
    }));
    byId('peopleCount').textContent = data ? number(data.contributors.length) + ' public identities' : '';
    byId('peopleEmpty').hidden = people.length > 0 || !data;
    byId('peopleEmpty').textContent = data?.contributors.length ? 'No public usernames match this search.' : 'No publicly attributed contributions yet. Public work without a username is included in the totals.';
  }

  function renderPlaces() {
    const selectedPerson = data?.contributors.find(person => person.id === contributor);
    const query = byId('placeSearch').value.trim().toLocaleLowerCase(), borough = byId('boroughFilter').value;
    const places = (data?.places || []).filter(item => (!selectedPerson || selectedPerson.place_ids.includes(item.id)) && (!query || item.title.toLocaleLowerCase().includes(query)) && (!borough || item.borough === borough) && (!byId('needsDetails').checked || item.needs_details));
    byId('placeCount').textContent = data ? `${number(places.length)} of ${number(data.places.length)} places` : '';
    const picker = byId('placeSelector');
    picker.replaceChildren(...places.map(item => new Option(item.title, item.id)));
    if (!places.length) picker.append(new Option('No matching places', ''));
    picker.disabled = !places.length;
    place = places.some(item => item.id === place) ? place : places[0]?.id || '';
    picker.value = place;
    byId('placeEmpty').hidden = !!places.length || !data;
    byId('placeEmpty').textContent = data?.places.length ? 'No places match these filters. Clear a filter to continue.' : 'No public places yet.';
    loadPlace();
  }

  function fieldList(fields) {
    const list = make('ul', undefined, 'field-list');
    for (const field of fields) {
      const item = make('li'), name = make('span', field.label, 'field-name');
      name.append(make('small', field.group));
      const state = make('span', field.state_label, 'field-state'); state.dataset.state = field.state;
      item.append(name, state); list.append(item);
    }
    return list;
  }

  async function loadPlace() {
    const key = data && place ? data.snapshot_token + ':' + place : '';
    if (key && key === detailKey) return;
    detailKey = key;
    const request = ++detailGeneration, inspector = byId('placeInspector'), id = place;
    inspector.replaceChildren(make('p', id ? 'Loading place details…' : 'Choose a place to see its details.', 'directory-help'));
    inspector.setAttribute('aria-busy', String(!!id));
    if (!id || !data) return;
    try {
      const result = await read('/api/place-completeness?place=' + encodeURIComponent(id) + '&snapshot=' + encodeURIComponent(data.snapshot_token));
      if (request !== detailGeneration || document.visibilityState === 'hidden') return;
      const item = result.place;
      if (!item || item.id !== id || !Array.isArray(item.fields)) throw new Error('Invalid public detail');
      const title = make('h3', item.title), context = make('p', item.borough + ' · ' + (item.origin === 'base' ? 'Imported/base place' : 'Published place'), 'place-context');
      const links = make('nav', undefined, 'place-links'); links.setAttribute('aria-label', 'Actions for ' + item.title);
      for (const [label, action] of [['Edit', 'edit'], ['History', 'history'], ['View on map', '']]) {
        const link = make('a', label); link.href = '/?place=' + encodeURIComponent(item.id) + (action ? '&action=' + action : ''); links.append(link);
      }
      const missing = item.fields.filter(field => ['missing', 'invalid'].includes(field.state));
      const unknown = item.fields.filter(field => field.state === 'unknown');
      const rest = item.fields.filter(field => !['missing', 'invalid', 'unknown'].includes(field.state));
      const summary = make('p', `${missing.length ? number(missing.length) + ' missing details' : 'No missing details in tracked fields'}${unknown.length ? ' · ' + number(unknown.length) + ' unknown' : ''}`, 'place-gap-summary');
      const activity = make('p', `${metricText(item.contributions.published)} published contributions · ${metricText(item.contributions.edits)} edits · ${metricText(item.contributions.notes)} notes`, 'directory-help');
      const details = make('details', undefined, 'place-field-details');
      details.append(make('summary', 'Present, optional and not applicable (' + rest.length + ')'), fieldList(rest));
      const navigation = make('nav', undefined, 'place-links'); navigation.setAttribute('aria-label', 'Browse places');
      for (const [label, step] of [['Previous place', -1], ['Next place', 1]]) {
        const button = make('button', label, 'textbutton'); button.type = 'button';
        button.disabled = byId('placeSelector').selectedIndex + step < 0 || byId('placeSelector').selectedIndex + step >= byId('placeSelector').options.length;
        button.addEventListener('click', () => { byId('placeSelector').selectedIndex += step; place = byId('placeSelector').value; loadPlace(); });
        navigation.append(button);
      }
      inspector.replaceChildren(title, context, links, activity, summary, fieldList([...missing, ...unknown]), details, navigation);
    } catch (error) {
      if (request !== detailGeneration) return;
      detailKey = '';
      if (error.status === 409 || error.status === 404) { refresh(); return; }
      const retry = make('button', 'Retry place details', 'outline'); retry.type = 'button'; retry.addEventListener('click', loadPlace);
      inspector.replaceChildren(make('p', 'Place details are unavailable. Retry to load the current public record.', 'directory-empty'), retry);
    } finally { if (request === detailGeneration) inspector.setAttribute('aria-busy', 'false'); }
  }

  function clearData() {
    data = null; contributor = ''; detailKey = ''; ++detailGeneration;
    byId('contributorFilter').hidden = true;
    for (const key of ['Published', 'Added', 'Edits', 'Notes']) byId('total' + key).textContent = '—';
    byId('otherTotals').textContent = 'Totals are unavailable until the public contributions load.';
    renderPeople(); renderPlaces();
  }

  async function refresh() {
    if (byId('refreshDirectory').disabled || document.visibilityState === 'hidden') return;
    const request = ++generation;
    clearData(); byId('refreshDirectory').disabled = true;
    byId('directoryStatus').textContent = 'Loading public contributions…';
    try {
      const result = await read('/api/contributors-summary');
      if (request !== generation || document.visibilityState === 'hidden') return;
      if (!result.metrics || !Array.isArray(result.contributors) || !Array.isArray(result.places) || typeof result.snapshot_token !== 'string') throw new Error('Invalid public summary');
      data = result; refreshedAt = Date.now();
      for (const [id, key] of [['Published','published'],['Added','added'],['Edits','edits'],['Notes','notes']]) byId('total' + id).textContent = metricText(data.metrics[key]);
      byId('otherTotals').textContent = `${metricText(data.metrics.undo)} Undo actions; ${metricText(data.metrics.unique_places_edited)} unique places edited; ${number(data.totals.legacy)} older releases; ${number(data.totals.unclassified)} unclassified publications; ${number(data.totals.unattributed)} publications without verified public attribution. ${number(data.totals.places)} current public places, including the base inventory.`;
      byId('directoryStatus').textContent = 'Global totals · Public snapshot ' + new Date(data.as_of).toLocaleString() + (data.coverage_start ? ' · Recorded publications from ' + data.coverage_start.slice(0,10) : ' · No recorded public publications');
      renderPeople(); renderPlaces();
    } catch {
      if (request === generation) byId('directoryStatus').textContent = 'Public contributions are unavailable. Select Refresh to try again.';
    } finally { if (request === generation) byId('refreshDirectory').disabled = false; }
  }
  byId('refreshDirectory').addEventListener('click', refresh);
  byId('contributorSearch').addEventListener('input', renderPeople);
  for (const id of ['placeSearch','boroughFilter','needsDetails']) byId(id).addEventListener(id === 'placeSearch' ? 'input' : 'change', renderPlaces);
  byId('placeSelector').addEventListener('change', () => { place = byId('placeSelector').value; loadPlace(); });
  byId('clearContributor').addEventListener('click', () => { contributor = ''; byId('contributorFilter').hidden = true; renderPeople(); renderPlaces(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { ++generation; clearData(); byId('refreshDirectory').disabled = false; }
    else refresh();
  });
  // No hidden polling. Focus catches a revoke made in another tab without a retained cache.
  window.addEventListener('focus', () => { if (Date.now() - refreshedAt > 30000) refresh(); });
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  refresh();
})();
