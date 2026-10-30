'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const dropdown = byId('contributorsDropdown'), panel = byId('contributorsPanel');
  if (!dropdown || !panel) return;
  const list = byId('contributorsList'), status = byId('contributorsStatus'), refresh = byId('refreshContributors');
  let generation = 0, timer = 0;
  const node = (tag, text, className) => {
    const element = document.createElement(tag); element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const count = (value, singular) => value + ' ' + singular + (value === 1 ? '' : 's');
  function valid(data) {
    return data?.schema_version === '1.0' && Array.isArray(data.contributors) && data.contributors.every(person =>
      typeof person.name === 'string' && person.name.length > 0 && person.name.length <= 120 && !person.name.includes('@') &&
      ['published','legacy'].every(key => Number.isSafeInteger(person[key]) && person[key] >= 0));
  }
  async function load() {
    const request = ++generation;
    list.replaceChildren(); status.textContent = 'Loading contributors…'; refresh.disabled = true;
    try {
      const data = await window.HauntologiesPublicReads.json('/api/contributors-summary');
      if (request !== generation || !dropdown.open || document.hidden) return;
      if (!valid(data)) throw new Error('Invalid public contributors');
      const names = new Map();
      for (const person of data.contributors) names.set(person.name.toLocaleLowerCase(), (names.get(person.name.toLocaleLowerCase()) || 0) + 1);
      for (const person of data.contributors) {
        const item = node('li', ''), name = node('span', person.name, 'contributor-name');
        if (names.get(person.name.toLocaleLowerCase()) > 1) name.append(node('small', 'Shared username, separate contributor'));
        const total = node('span', count(person.published, 'contribution'), 'contributor-count');
        item.append(name, total); list.append(item);
      }
      status.textContent = data.contributors.length ? '' : 'No publicly credited contributions yet';
    } catch {
      if (request === generation) status.textContent = 'Contributors are unavailable. Select Refresh to try again.';
    } finally { if (request === generation) refresh.disabled = false; }
  }
  function size() { panel.style.setProperty('--contributors-top', panel.getBoundingClientRect().top + 'px'); }
  function open() {
    window.closeTools?.();
    dropdown.open = true; size(); byId('contributorsToggle').focus({preventScroll:true});
  }
  function close(returnFocus = false) {
    dropdown.open = false;
    if (returnFocus) byId('contributorsToggle').focus({preventScroll:true});
  }
  dropdown.addEventListener('toggle', () => {
    clearInterval(timer);
    if (dropdown.open) {
      size(); load();
      timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
    } else { ++generation; list.replaceChildren(); }
  });
  refresh.addEventListener('click', load);
  byId('contributorsButton')?.addEventListener('click', open);
  document.addEventListener('pointerdown', event => {
    if (dropdown.open && !dropdown.contains(event.target) && !byId('contributorsButton')?.contains(event.target)) close();
  });
  dropdown.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { ++generation; list.replaceChildren(); }
    else if (dropdown.open) load();
  });
  for (const type of ['contributions-session-started', 'contributions-session-ended']) {
    window.addEventListener(type, () => { ++generation; list.replaceChildren(); if (dropdown.open && !document.hidden) load(); });
  }
  window.addEventListener('resize', () => { if (dropdown.open) size(); });
  window.addEventListener('hashchange', () => { if (location.hash === '#contributors') open(); });
  if (location.hash === '#contributors') open();
})();
