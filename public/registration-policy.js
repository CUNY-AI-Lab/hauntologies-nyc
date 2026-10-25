'use strict';
(() => {
  const notice = 'Please use your CUNY email address. Guests can enter an access code below.';
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  const policy = fetch('/api/registration-policy', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
    .then(async response => { if (!response.ok) throw new Error('policy_unavailable'); return (await response.json()).restricted !== false; })
    .catch(() => true).finally(() => clearTimeout(timer));
  function isCunyEmail(value) {
    const email = value.trim();
    if (/[^\x20-\x7e]/.test(value) || /[^\x21-\x7e]/.test(email)) return false;
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts, labels = domain.split('.');
    if (email.length > 254 || !local || local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
      || local.startsWith('.') || local.endsWith('.') || local.includes('..') || labels.length < 2
      || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return false;
    return domain.toLowerCase() === 'cuny.edu' || domain.toLowerCase().endsWith('.cuny.edu');
  }
  function attach({ form, email, anchor, deferred = false }) {
    const group = document.createElement('div'); group.className = 'registration-admission'; group.hidden = true;
    const label = document.createElement('label'), input = document.createElement('input'), hint = document.createElement('p');
    input.id = (email?.id || 'account-completion') + '-access-code'; input.name = 'access_code'; input.type = 'password';
    input.autocomplete = 'off'; input.maxLength = 256; input.disabled = true;
    label.htmlFor = input.id; label.textContent = 'Access code'; label.append(input);
    hint.id = input.id + '-notice'; hint.className = 'registration-admission-notice'; hint.textContent = notice;
    group.append(hint, label);
    if (!email) { const optional = document.createElement('p'); optional.className = 'registration-admission-notice'; optional.textContent = 'Leave blank for a CUNY email.'; group.append(optional); }
    if (anchor) anchor.after(group); else form.prepend(group);
    let restricted = false;
    function describe(field, enabled) {
      if (!field) return;
      const current = field.getAttribute('aria-describedby');
      const ids = new Set((current || '').split(/\s+/).filter(Boolean));
      if (enabled) ids.add(hint.id); else ids.delete(hint.id);
      const value = [...ids].join(' ');
      if (value && value !== current) field.setAttribute('aria-describedby', value);
      else if (!value && current !== null) field.removeAttribute('aria-describedby');
    }
    function sync() {
      const shown = restricted && (!email || !!email.value.trim() && !isCunyEmail(email.value));
      group.hidden = !restricted; label.hidden = !shown; input.disabled = !shown; input.required = shown && !!email;
      describe(email, restricted); describe(input, shown);
      if (!shown) input.value = '';
    }
    email?.addEventListener('input', sync);
    const ready = policy.then(value => { restricted = value && !deferred; sync(); });
    return {
      ready,
      payload: () => input.disabled || !input.value ? {} : { access_code: input.value },
      lock: value => { input.readOnly = value; },
      clear: () => { input.value = ''; sync(); },
      reject: () => { restricted = true; sync(); if (!input.disabled) input.focus(); },
    };
  }
  window.HauntologiesAdmission = Object.freeze({ notice, attach });
})();
