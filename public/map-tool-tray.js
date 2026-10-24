'use strict';
// Filters, Layers and zoom unfold beside Tools: on hover with a mouse, or on click and tap.
// The tray stays open while it holds focus or one of its panels is open.
(() => {
  const byId = id => document.getElementById(id);
  const group = byId('mapToolGroup'), button = byId('mapControlsButton'), tray = byId('mapToolTray');
  if (!group || !button || !tray) return;
  const hoverable = matchMedia('(hover: hover) and (pointer: fine)');
  let pinned = false, hovering = false, leaveTimer = 0;
  const panelOpen = () => [...tray.querySelectorAll('[aria-expanded]')].some(item => item.getAttribute('aria-expanded') === 'true');
  const isOpen = () => group.hasAttribute('data-open');

  function sync() {
    // Keyboard focus holds the tray; focus returned after a mouse dismissal does not.
    const keyboardFocus = tray.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    const open = pinned || hovering || panelOpen() || keyboardFocus;
    group.toggleAttribute('data-open', open);
    button.setAttribute('aria-expanded', String(open));
  }
  function fold(focus = false) {
    pinned = hovering = false; clearTimeout(leaveTimer);
    if (panelOpen() && typeof closeTools === 'function') closeTools();
    if (focus) button.focus({ preventScroll: true });
    sync();
  }

  button.addEventListener('click', event => {
    if (pinned) { fold(); return; }
    pinned = true; sync();
    // Keyboard activation moves into the tray; a pointer leaves focus where it is.
    if (event.detail === 0) byId('filtersButton').focus();
  });
  group.addEventListener('pointerenter', event => {
    if (!hoverable.matches || event.pointerType !== 'mouse') return;
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
    if (event.key !== 'Escape' || event.defaultPrevented || !isOpen() || panelOpen()) return;
    event.preventDefault(); fold(true);
  });
  document.addEventListener('pointerdown', event => {
    if (pinned && !group.contains(event.target)) { pinned = false; sync(); }
  }, { capture: true });
  // A panel closed from elsewhere can leave nothing holding the tray open.
  new MutationObserver(() => setTimeout(sync)).observe(tray, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });

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
