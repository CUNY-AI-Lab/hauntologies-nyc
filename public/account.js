'use strict';
(() => {
  const byId = id => document.getElementById(id), dialog = byId('accountDialog'), trigger = byId('accountButton');
  if (!dialog || !trigger) return;
  const status = byId('accountStatus'), actions = byId('accountActions'), list = byId('accountContributions'), registration = byId('accountRegistration');
  const formHost = document.createElement('div'); formHost.id = 'accountFormHost'; status.after(formHost);
  const returnKey='hauntologies-return-edit';
  if(new URLSearchParams(location.search).get('edit')==='1'){try{sessionStorage.setItem(returnKey,'true');}catch{}const url=new URL(location.href);url.searchParams.delete('edit');history.replaceState(null,'',url.pathname+url.search+url.hash);}
  function returnToEdit(){let requested=false;try{requested=sessionStorage.getItem(returnKey)==='true';if(requested)sessionStorage.removeItem(returnKey);}catch{}if(requested){if(dialog.open)dialog.close();byId('toolsButton').click();}}
  let session = null, mode = 'sign-in', challenge = null, busy = false, opener = null, generation = 0, checks = 0;
  const node = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  const labels = { draft: 'Draft', submitted: 'Pending review', changes_requested: 'Changes requested', approved: 'Approved', merged: 'Published', withheld: 'Withheld' };
  const messages = { registration_restricted: 'Please use your CUNY email address. Guests can enter an access code below.', rate_limited: 'Please wait before trying again.', invalid_credentials: 'Check your email and password, then try again.', invalid_email: 'Enter your email address.', password_length: 'Use a password with 12 to 128 characters.', invalid_token: 'This link has expired or has already been used. Request a new link.', password_already_set: 'Your password is already set. Sign in with it or request a reset.', mail_unavailable: 'Email delivery is temporarily unavailable. Please try again later.', account_unavailable: 'Account service is temporarily unavailable. Please try again.', sign_in_required: 'Sign in to continue.' };
  async function api(path, body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(messages[value.error] || 'Please try again.'), { status: response.status, code: value.error });
      return value;
    } finally { clearTimeout(timer); }
  }
  function identity(value) {
    if(session?.actor_id&&session.actor_id!==value?.actor_id)window.dispatchEvent(new CustomEvent('contributions-session-ended'));
    // A sign-in this tab did not make (another tab, an email link, a restored page) still has to
    // reach the contribution form, or it keeps asking to sign in beside an "Account" button.
    const started = value?.actor_id && !value.password_required && (session?.actor_id !== value.actor_id || session?.password_required);
    session = value;
    if (started) window.dispatchEvent(new CustomEvent('contributions-session-started')); trigger.disabled = false; trigger.textContent = value && !value.password_required ? 'Account' : 'Sign in';
    trigger.setAttribute('aria-label', trigger.textContent);
    byId('accountRegistrationSection').hidden = !(value && !value.password_required);
    // Published edits is for signed-in contributors; it closes before hiding so it can't reopen stale.
    const feed = byId('publishedEditsFeed'), signedIn = Boolean(value && !value.password_required);
    if (feed) { if (!signedIn) feed.open = false; feed.hidden = !signedIn; }
    const saved = window.HauntologiesRegistration?.receipt(); registration.textContent = saved ? 'Receipt: ' + saved.receipt_id : 'Event registration is available below.';
    byId('accountEventLink').hidden = !!saved;
  }
  function button(label, action) { const result = node('button', label); result.type = 'button'; result.className = 'outline'; result.addEventListener('click', action); actions.append(result); return result; }
  function listMessage(text) { const row = node('li', text); row.className = 'account-list-message'; list.replaceChildren(row); }
  function field(form, label, name, type, autocomplete) {
    const wrapper = node('label', label), input = node('input'); input.id = 'account-' + name; input.name = name; input.type = type; input.autocomplete = autocomplete; input.required = true;
    if (type === 'password') { input.minLength = 12; input.maxLength = 128; } else input.maxLength = 254;
    wrapper.htmlFor = input.id; wrapper.append(input); form.append(wrapper); return input;
  }
  function renderForm(nextMode, message = '') {
    generation++; // A chosen form supersedes any earlier session check.
    mode = nextMode; formHost.replaceChildren(); actions.replaceChildren(); list.replaceChildren(); status.textContent = message;
    byId('accountRegistrationSection').hidden = true;
    const titles = { 'sign-in': 'Sign in', register: 'Register', 'request-reset': 'Reset password', verify: 'Create your password', reset: 'Reset password', 'set-password': 'Create your password' };
    byId('accountTitle').textContent = titles[mode];
    const form = node('form'); form.className = 'account-form';
    const email = ['sign-in', 'register', 'request-reset'].includes(mode) ? field(form, 'Email', 'email', 'email', 'email') : null;
    const admission = ['register', 'verify', 'set-password', 'reset'].includes(mode) ? window.HauntologiesAdmission?.attach({ form, email, anchor: email?.parentElement, deferred: mode === 'reset' }) : null;
    if (['sign-in', 'verify', 'reset', 'set-password'].includes(mode)) {
      field(form, 'Password', 'password', 'password', mode === 'sign-in' ? 'current-password' : 'new-password');
      if (mode !== 'sign-in') {
        field(form, 'Confirm password', 'confirmation', 'password', 'new-password');
        const hint = node('p', 'Use 12 to 128 characters.'); hint.className = 'small'; form.append(hint);
      }
    }
    if (mode === 'register') form.append(node('p', 'Verify your email, then choose a password for Hauntologies. Your verification link expires 30 days after it is sent. Event registration is separate.'));
    const submit = node('button', mode === 'sign-in' ? 'Sign in' : mode === 'register' ? 'Send verification email' : mode === 'request-reset' ? 'Send reset email' : 'Save password'); submit.type = 'submit'; submit.className = 'primary'; form.append(submit); formHost.append(form);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      await admission?.ready;
      if (busy || !form.isConnected || !form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form));
      if (values.confirmation !== undefined && values.password !== values.confirmation) { status.textContent = 'Enter the same password in both fields.'; return; }
      const operation = mode, payload = { ...admission?.payload() };
      if (values.email) payload.email = values.email.trim();
      if (values.password) payload.password = values.password;
      if (['verify', 'reset'].includes(operation)) payload.token = challenge;
      busy = true; submit.disabled = true; status.textContent = operation === 'register' || operation === 'request-reset' ? 'Requesting email…' : 'Saving…';
      try {
        await api('/api/auth/' + operation, payload);
        if (operation === 'register' || operation === 'request-reset') {
          renderForm('sign-in', operation === 'register' ? 'Check your email for a verification link. If you already have an account, sign in or reset your password.' : 'If this address has an account, a reset link will arrive by email.');
        } else if (operation === 'reset') { challenge = null; identity(null); renderForm('sign-in', 'Password updated. Sign in with your new password.'); }
        else { challenge = null; await reconcile(); }
      } catch (error) { if (error.code === 'registration_restricted') admission?.reject(); status.textContent = error.name === 'AbortError' ? 'The request took too long. Check your email or try signing in before retrying.' : error.code === 'invalid_token' && operation === 'verify' ? 'This verification link has already been used or is invalid. Request a new link.' : error.message; }
      finally { busy = false; submit.disabled = false; }
    });
    if (mode === 'sign-in') { button('Reset password', () => renderForm('request-reset')); button("Don't have an account? Register here.", () => renderForm('register')); }
    else button('Back to sign in', () => { challenge = null; renderForm('sign-in'); });
  }
  async function showAccount(version) {
    byId('accountTitle').textContent = 'Account'; status.textContent = session.email; formHost.replaceChildren(); actions.replaceChildren(); listMessage('Loading…');
    button('Refresh', reconcile); button('Sign out', async () => {
      if (busy) return; busy = true;
      try { await api('/api/auth/sign-out', {}); window.dispatchEvent(new CustomEvent('contributions-session-ended', { detail: { signedOut: true } })); identity(null); renderForm('sign-in', 'Signed out.'); }
      catch (error) { status.textContent = error.message; } finally { busy = false; }
    });
    const actor = session.actor_id;
    try {
      const data = await api('/api/contributions/edits?page=1');
      if (generation !== version || session?.actor_id !== actor || !dialog.open) return;
      listMessage(data.total + (data.total === 1 ? ' edit' : ' edits'));
    } catch (error) { if (generation === version) listMessage(error.message); }
  }
  // `generation` guards the dialog's contents; `checks` guards the button. Closing the dialog or
  // leaving the page discards a dialog render, but the newest session answer still reaches the
  // button, so it never stays at "…".
  async function reconcile() {
    const version = ++generation, check = ++checks;
    try {
      const value = await api('/api/auth/session');
      if (check === checks) identity(value);
      if (version !== generation) return;
      if (dialog.open) { if (value.password_required) renderForm('set-password'); else await showAccount(version); }
      if(!value.password_required)returnToEdit();
    } catch (error) {
      if (check === checks) identity(null);
      if (version !== generation) return;
      if (error.status === 401) window.dispatchEvent(new CustomEvent('contributions-session-ended'));
      if (dialog.open && !challenge) renderForm('sign-in', error.status === 401 ? '' : error.message);
    }
  }
  function open() { opener = document.activeElement; if (typeof closeTools === 'function') closeTools(); if (!dialog.open) dialog.showModal(); if (!challenge) reconcile(); }
  function readChallenge() {
    const match = location.hash.match(/^#account-(verify|reset)=([A-Za-z0-9_-]{24,128})$/);
    if (match) { challenge = match[2]; history.replaceState(null, '', location.pathname + location.search); open(); renderForm(match[1]); return true; }
    if(session&&!session.password_required&&['#account-register','#sign-in'].includes(location.hash)){history.replaceState(null,'',location.pathname+location.search);return true;}
    if (location.hash === '#account-register') { history.replaceState(null, '', location.pathname + location.search); opener=trigger;if(!dialog.open)dialog.showModal();renderForm('register');return true; }
    if (location.hash === '#sign-in') { history.replaceState(null, '', location.pathname + location.search); open(); return true; }
    return false;
  }
  trigger.addEventListener('click', open); window.addEventListener('account-open-requested', open);
  byId('closeAccount').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; challenge = null; formHost.replaceChildren(); actions.replaceChildren(); list.replaceChildren(); (opener?.isConnected ? opener : trigger).focus({ preventScroll: true }); });
  window.addEventListener('hashchange', readChallenge);
  window.addEventListener('focus', () => { if (!busy && !dialog.open) reconcile(); });
  window.addEventListener('pageshow', event => { if ((!busy && !dialog.open) || event.persisted) reconcile(); });
  window.addEventListener('pagehide', () => { generation++; challenge = null; formHost.replaceChildren(); list.replaceChildren(); });
  window.addEventListener('registration-confirmed', () => identity(session));
  reconcile().then(readChallenge);
})();
