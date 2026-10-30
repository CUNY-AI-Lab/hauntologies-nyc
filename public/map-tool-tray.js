'use strict';
// Search, Filters and Layers drop down beneath Tools on phones; desktop controls stay visible.
// The tray stays open while it holds focus or the search is open, and folds when Filters or Layers
// opens its panel, which sits where the column would.
(() => {
  const byId = id => document.getElementById(id);
  const group = byId('mapToolGroup'), button = byId('mapControlsButton'), tray = byId('mapToolTray');
  if (!group || !button || !tray) return;
  const hoverable = matchMedia('(hover: hover) and (pointer: fine)');
  const directControls = matchMedia('(min-width: 761px)');
  let pinned = false, hovering = false, leaveTimer = 0;
  const panelOpen = () => [...tray.querySelectorAll('[aria-expanded]')].some(item => item.getAttribute('aria-expanded') === 'true');
  const opensPopout = item => item.matches?.('[aria-controls]') && byId(item.getAttribute('aria-controls'))?.classList.contains('popout');
  const popoutOpen = () => [...tray.querySelectorAll('[aria-expanded="true"]')].some(opensPopout);
  const anyPopoutOpen=()=>[...document.querySelectorAll('.popout')].some(n=>!n.hidden&&!n.matches('dialog'));
  const isOpen = () => group.hasAttribute('data-open');

  function sync() {
    // Desktop controls stay directly reachable, including while a panel is open.
    button.hidden = directControls.matches;
    if (directControls.matches) {
      pinned = hovering = false;
      group.setAttribute('data-open', ''); tray.dataset.settled = 'true';
      button.setAttribute('aria-expanded', 'true');
      return;
    }
    // Keyboard focus holds the tray; focus returned after a mouse dismissal does not.
    const keyboardFocus = tray.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    if (popoutOpen()) pinned = hovering = false;
    const open = !popoutOpen() && (pinned || hovering || panelOpen() || keyboardFocus);
    group.toggleAttribute('data-open', open);
    button.setAttribute('aria-expanded', String(open));
  }
  directControls.addEventListener('change', sync);
  function fold(focus = false) {
    pinned = hovering = false; clearTimeout(leaveTimer);
    if (panelOpen() && typeof closeTools === 'function') closeTools();
    if (focus) button.focus({ preventScroll: true });
    sync();
  }

  button.addEventListener('click', event => {
    if (pinned) { fold(); return; }
    // Tools while Filters or Layers is open goes back to the column.
    if (anyPopoutOpen() && typeof closeTools === 'function') closeTools();
    pinned = true; sync();
    // Keyboard activation moves into the tray; a pointer leaves focus where it is.
    if (event.detail === 0) byId('filtersButton').focus();
  });
  group.addEventListener('pointerenter', event => {
    // An open panel covers the column, so hover waits for it to close.
    if (!hoverable.matches || event.pointerType !== 'mouse' || anyPopoutOpen()) return;
    clearTimeout(leaveTimer); hovering = true; sync();
  });
  group.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    // Grace period for crossing the gap between button and tray.
    clearTimeout(leaveTimer); leaveTimer = setTimeout(() => { hovering = false; sync(); }, 280);
  });
  group.addEventListener('focusin', sync);
  group.addEventListener('focusout', () => setTimeout(sync));
  group.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !isOpen() || panelOpen() || byId('plotPlaceButton')?.getAttribute('aria-pressed') === 'true') return;
    event.preventDefault(); fold(true);
  });
  document.addEventListener('pointerdown', event => {
    if (pinned && !group.contains(event.target)) { pinned = false; sync(); }
  }, { capture: true });
  // A panel closed from elsewhere can leave nothing holding the tray open.
  new MutationObserver(records => setTimeout(() => {
    sync();
    // A closing panel returns focus to its button, which is folded away: Tools takes it instead.
    const closed = records.some(record => opensPopout(record.target) && record.target.getAttribute('aria-expanded') === 'false');
    const active = document.activeElement, lost = !active || active === document.body || tray.contains(active) || active.closest('[hidden]') || !active.getClientRects().length;
    if (closed && !isOpen() && lost) button.focus({ preventScroll: true });
  })).observe(tray, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });

  // The unfold clips the tray; once open, the clip lifts so panels anchored to tray items
  // (place search results) can extend past its edges.
  tray.addEventListener('transitionend', event => { if (event.propertyName === 'clip-path' && isOpen()) tray.dataset.settled = 'true'; });
  new MutationObserver(() => { if (!isOpen()) delete tray.dataset.settled; }).observe(group, { attributes: true, attributeFilter: ['data-open'] });

  // Active filters stay visible on Tools while the tray is folded.
  const source = byId('filtersActiveCount'), badge = byId('toolsActiveCount');
  function mirror() {
    const count = source.hidden ? 0 : Number(source.textContent) || 0;
    badge.textContent = String(count); badge.hidden = !count;
    button.setAttribute('aria-label', count ? `Tools, ${count} ${count === 1 ? 'filter' : 'filters'} active` : 'Tools');
  }
  new MutationObserver(mirror).observe(source, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
  mirror(); sync();
})();
