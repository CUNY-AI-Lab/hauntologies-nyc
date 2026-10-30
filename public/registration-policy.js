'use strict';
(() => {
  const notice = 'CUNY email addresses do not need a code. Guests need an access code from the organizers.';
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
    const group = document.createElement('div'); group.className = 'registration-admission';
    const label = document.createElement('label'), input = document.createElement('input'), hint = document.createElement('p');
    input.id = email.id + '-access-code'; input.name = 'access_code'; input.type = 'text';
    input.spellcheck = false; input.setAttribute('autocapitalize', 'off');
    input.autocomplete = 'off'; input.maxLength = 256;
    label.htmlFor = input.id; label.textContent = 'Access code (optional)'; label.append(input);
    hint.id = input.id + '-notice'; hint.className = 'registration-admission-notice'; hint.textContent = notice;
    group.append(hint, label);
    if (anchor) anchor.after(group); else form.append(group);
    let restricted = false, rejected = false;
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
      const approved = !rejected && remembered(email.value);
      const needsCode = restricted && !!email.value.trim() && !isCunyEmail(email.value) && !approved;
      hint.textContent = approved && !isCunyEmail(email.value) ? 'Guest access confirmed for this email.' : notice;
      hint.hidden = !restricted; input.required = needsCode;
      describe(email, restricted); describe(input, restricted);
    }
    email.addEventListener('input', () => { rejected = false; sync(); });
    const ready = policy.then(value => { restricted = value && !deferred; sync(); });
    return {
      ready,
      payload: () => input.disabled || !input.value ? {} : { access_code: input.value },
      lock: value => { input.readOnly = value; },
      clear: () => { input.value = ''; sync(); },
      reject: () => { restricted = true; rejected = true; sync(); if (!input.disabled) input.focus(); },
    };
  }
  const admissionKey = 'hauntologies-admitted-emails';
  function remembered(email) { try { return JSON.parse(sessionStorage.getItem(admissionKey) || '[]').includes(email.trim().toLowerCase()); } catch { return false; } }
  function remember(email) { try { const emails = JSON.parse(sessionStorage.getItem(admissionKey) || '[]'); sessionStorage.setItem(admissionKey, JSON.stringify([...new Set([...emails, email.trim().toLowerCase()])].slice(-10))); } catch {} }
  window.HauntologiesAdmission = Object.freeze({ notice, attach, remember });
})();
