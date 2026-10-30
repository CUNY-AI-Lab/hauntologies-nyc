'use strict';
// Narrow public-place navigation. Existing Edit and History handlers own the UI
// and authentication; the URL never supplies a target snapshot or private data.
(() => {
  let generation = 0, pendingEdit = null;
  const idValid = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(id);
  function notice(message) {
    let node = document.getElementById('placeLinkNotice');
    if (!node) {
      node = document.createElement('p'); node.id = 'placeLinkNotice'; node.className = 'notice'; node.setAttribute('role','status');
      document.getElementById('casePanel').prepend(node);
    }
    node.textContent = message;
  }
  function edit(record) {
    if (!window.HauntologiesAccount?.canContribute()) {
      pendingEdit = record.id;
      notice('Sign in to edit this place.');
      window.dispatchEvent(new CustomEvent('account-open-requested'));
      return;
    }
    pendingEdit = null;
    document.getElementById('placeLinkNotice')?.remove();
    const card = [...document.querySelectorAll('.place-card')].find(node => node.dataset.placeId === record.id);
    window.dispatchEvent(new CustomEvent('record-edit-requested', { detail: { recordId: record.id, record: structuredClone(record), opener: card?.querySelector('.place-edit') } }));
  }
  async function navigate() {
    const request = ++generation, query = new URL(location.href).searchParams;
    if (!query.has('place')) return;
    const id = query.get('place'), action = query.get('action') || '';
    if (query.getAll('place').length !== 1 || query.getAll('action').length > 1 || !idValid(id) || !['','edit','history'].includes(action)) return;
    const loaded = await window.HauntologiesPublic?.refresh();
    if (request !== generation) return;
    // The public collection deliberately excludes browser-local drafts.
    const record = [...new Map([pilot,...sourceInventory.records,...publishedPlaces].map(item=>[item.id,item])).values()].find(item => item.id === id);
    if (!loaded || !record) { switchPanel('casePanel'); notice(loaded ? 'This place is unavailable in the public map.' : 'The public map could not be refreshed. Reload to open this place.'); return; }
    resetFilters(false); selectRecord(record);
    if (action === 'edit') edit(record);
    if (action === 'history') {
      const card = [...document.querySelectorAll('.place-card')].find(node => node.dataset.placeId === id), history = card?.querySelector('.place-history');
      if (history) { history.open = true; history.scrollIntoView({block:'nearest'}); }
    }
  }
  window.addEventListener('contributions-session-started', () => {
    if (!pendingEdit) return;
    const record = [...publishedPlaces,...sourceInventory.records,pilot].find(item => item.id === pendingEdit);
    if (record) edit(record);
  });
  window.addEventListener('popstate', navigate);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', navigate, {once:true});
  else navigate();
})();
