'use strict';
// One unfold treatment for every <details> on the page, including ones rendered later.
// The element's own height is animated, so no content is rewrapped and existing selectors hold.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const DURATION = 220, EASE = 'cubic-bezier(.2,.7,.2,1)';
  const running = new WeakMap();
  const ownSummary = details => details.querySelector(':scope > summary');

  function mark(summary) {
    // Re-marked when a script resets the summary's text.
    if (summary.hidden || summary.querySelector(':scope > .disclosure-mark')) return;
    summary.dataset.disclosure = 'true';
    const icon = document.createElement('span'); icon.className = 'disclosure-mark'; icon.setAttribute('aria-hidden', 'true');
    summary.append(icon);
  }
  function markWithin(root) {
    if (root.nodeType !== 1) return;
    if (root.matches('details > summary')) mark(root);
    for (const summary of root.querySelectorAll('details > summary')) mark(summary);
  }

  function finish(details) {
    running.get(details)?.cancel(); running.delete(details);
    details.style.removeProperty('height'); details.style.removeProperty('overflow');
    delete details.dataset.closing;
  }
  // Animates from the height on screen now, so a reversed click picks up mid-motion.
  function animate(details, from, to, done) {
    details.style.overflow = 'hidden';
    const motion = details.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: DURATION, easing: EASE });
    running.set(details, motion);
    motion.onfinish = () => { finish(details); done?.(); };
  }
  function set(details, open) {
    const from = details.getBoundingClientRect().height, wasRunning = running.has(details);
    finish(details);
    if (!wasRunning && details.open === open) return;
    if (reduced.matches || !details.isConnected || !details.getClientRects().length) { details.open = open; return; }
    if (open) {
      details.open = true;
      animate(details, from, details.getBoundingClientRect().height);
    } else {
      // Measure the folded height, then stay open until the fold completes.
      details.open = false; const to = details.getBoundingClientRect().height; details.open = true;
      details.dataset.closing = 'true';
      animate(details, from, to, () => { details.open = false; });
    }
  }
  // Content that arrives after opening (a fetched list) grows in the same motion.
  function resize(details, change) {
    if (!details.open || reduced.matches || running.has(details)) { change(); return; }
    const from = details.getBoundingClientRect().height; change();
    const to = details.getBoundingClientRect().height;
    if (Math.abs(to - from) > 1) animate(details, from, to);
  }

  document.addEventListener('click', event => {
    const summary = event.target.closest?.('summary');
    const details = summary?.parentElement;
    if (!details || details.tagName !== 'DETAILS' || ownSummary(details) !== summary || event.defaultPrevented) return;
    // Controls placed inside a summary keep their own behaviour.
    const control = event.target.closest('a,button,input,select,textarea,label');
    if (control && summary.contains(control) && control !== summary) return;
    event.preventDefault();
    set(details, !details.open || details.dataset.closing === 'true');
  });

  // Sections marked data-hint say what they hold while folded, so a record's completeness
  // reads down the list. data-hint="required" says so when the section is still empty.
  function hintText(details) {
    const images = details.querySelectorAll('.staged-image').length;
    if (images) return images === 1 ? '1 image' : images + ' images';
    const filled = [...details.querySelectorAll('input, textarea')]
      .filter(field => !['file', 'checkbox', 'radio', 'hidden', 'button', 'submit'].includes(field.type) && !field.closest('[hidden]') && field.value.trim())
      .map(field => field.value.trim());
    if (filled.length === 2 && filled.every(value => Number.isFinite(Number(value)))) return filled.map(value => Number(value).toFixed(5)).join(', ');
    if (filled.length === 1) return filled[0].length > 40 ? filled[0].slice(0, 39) + '…' : filled[0];
    if (filled.length) return filled.length + ' entries';
    return details.dataset.hint === 'required' ? 'Required' : '';
  }
  function hint(details) {
    const summary = ownSummary(details);
    if (!summary || summary.hidden) return;
    let node = summary.querySelector(':scope > .disclosure-hint');
    if (!node) {
      // The space keeps "Coordinates 40.7…" apart when read aloud; flex layout drops it visually.
      node = document.createElement('span'); node.className = 'disclosure-hint';
      const before = summary.querySelector(':scope > .disclosure-mark');
      summary.insertBefore(document.createTextNode(' '), before); summary.insertBefore(node, before);
    }
    const text = hintText(details);
    if (node.textContent !== text) node.textContent = text;
    node.toggleAttribute('data-required', text === 'Required');
  }
  // A timer, not an animation frame: hints are content and must update in background tabs too.
  let hintTimer = 0;
  const refreshHints = () => { if (!hintTimer) hintTimer = setTimeout(() => { hintTimer = 0; for (const details of document.querySelectorAll('details[data-hint]')) hint(details); }); };
  for (const type of ['input', 'change', 'toggle']) document.addEventListener(type, refreshHints, true);
  // Scripts fill fields without input events, for example when a pin sets coordinates.
  window.addEventListener('contributions-point-changed', refreshHints);

  markWithin(document.body);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.target.matches?.('details > summary')) mark(record.target);
      for (const node of record.addedNodes) markWithin(node);
    }
    refreshHints();
  }).observe(document.body, { childList: true, subtree: true });
  refreshHints();

  window.HauntologiesDisclosure = Object.freeze({ set, resize });
})();
