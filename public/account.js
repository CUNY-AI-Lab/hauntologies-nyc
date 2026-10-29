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
    session = value;
    window.HauntologiesAccount?.resolve(value); trigger.disabled = false; trigger.textContent = value && !value.password_required ? 'Account' : 'Sign in';
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
    if (['sign-in', 'verify', 'reset', 'set-password'].includes(mode)) {
      const password = field(form, mode === 'sign-in' ? 'Password' : 'New password', 'password', 'password', mode === 'sign-in' ? 'current-password' : 'new-password');
      if (mode !== 'sign-in') {
        const hint = node('p', 'Use 12 to 128 characters.'); hint.id = 'account-password-hint'; hint.className = 'small account-password-hint'; form.append(hint); password.setAttribute('aria-describedby', hint.id);
        field(form, 'Confirm password', 'confirmation', 'password', 'new-password');
      }
    }
    const admission = mode === 'register' ? window.HauntologiesAdmission?.attach({ form, email, anchor: email?.parentElement }) : null;
    if (mode === 'register') form.append(node('p', 'Verify your email, then choose a password for Hauntologies. Your verification link stays usable until you create your password and can be used once. Event registration is separate.'));
    const submit = node('button', mode === 'sign-in' ? 'Sign in' : mode === 'register' ? 'Send verification email' : mode === 'request-reset' ? 'Send reset email' : mode === 'reset' ? 'Save new password' : 'Create password and sign in'); submit.type = 'submit'; submit.className = 'primary'; form.append(submit); formHost.append(form);
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
          if (operation === 'register') window.HauntologiesAdmission?.remember(values.email);
          renderForm('sign-in', operation === 'register' ? 'Check your email for a verification link. If you already have an account, sign in or reset your password.' : 'If this address has an account, a reset link will arrive by email.');
        } else if (operation === 'reset') { challenge = null; identity(null); renderForm('sign-in', 'Password updated. Sign in with your new password.'); }
        else { challenge = null; checks++; sessionCheck=null; await reconcile(); }
      } catch (error) { if (error.code === 'registration_restricted') admission?.reject(); status.textContent = error.name === 'AbortError' ? 'The request took too long. Check your email or try signing in before retrying.' : error.code === 'invalid_token' && operation === 'verify' ? 'This verification link has already been used or is invalid. Request a new link.' : error.code === 'registration_restricted' && !email ? 'Complete guest registration first, then reopen your verification email.' : error.message; }
      finally { busy = false; submit.disabled = false; reconcilePaused(); }
    });
    if (mode === 'sign-in') { button('Reset password', () => renderForm('request-reset')); button("Don't have an account? Register here.", () => renderForm('register')); }
    else button('Back to sign in', () => { challenge = null; renderForm('sign-in'); });
  }
  async function showAccount(version) {
    byId('accountTitle').textContent = 'Account'; status.textContent = session.email; formHost.replaceChildren(); actions.replaceChildren(); listMessage('Loading…');
    const actor=session.actor_id, account=window.HauntologiesAccount?.snapshot();
    const nameForm=node('form'), nameField=field(nameForm,'Public username','public-username','text','off'), nameHint=node('p','Saved on this device for future contributions. Existing contributions keep their original attribution.'), nameStatus=node('p'), saveName=node('button','Save username');
    nameField.maxLength=120;nameField.autocomplete='off';nameStatus.setAttribute('role','status');saveName.type='submit';saveName.className='outline';
    try{const saved=JSON.parse(localStorage.getItem('hauntologies-public-moniker:'+actor)||'null');nameField.value=typeof saved?.label==='string'?saved.label:'';}catch{}
    nameForm.append(nameHint,saveName,nameStatus);formHost.append(nameForm);
    nameForm.addEventListener('submit',event=>{
      event.preventDefault();if(!window.HauntologiesAccount?.isCurrent(account)||session?.actor_id!==actor)return;
      const label=nameField.value.trim().replace(/\s+/g,' ');
      if(!label||label.length>120||/[@\u0000-\u001f\u007f]/.test(label)){nameStatus.textContent='Choose a public username or moniker, not an email address.';nameField.focus();return;}
      try{localStorage.setItem('hauntologies-public-moniker:'+actor,JSON.stringify({label}));}catch{nameStatus.textContent='Could not save on this device.';return;}
      nameField.value=label;nameStatus.textContent='Username saved on this device.';
      window.dispatchEvent(new CustomEvent('hauntologies-public-moniker-changed',{detail:{actor,label}}));
    });
    button('Refresh', reconcile); button('Sign out', async () => {
      if (busy) return; busy = true; const account=window.HauntologiesAccount?.snapshot();
      try { await api('/api/auth/sign-out', {}); window.dispatchEvent(new CustomEvent('contributions-session-ended', { detail: { signedOut: true } })); identity(null); renderForm('sign-in', 'Signed out.'); }
      catch (error) { if(window.HauntologiesAccount?.isCurrent(account)){window.HauntologiesAccount.invalidate(account);status.textContent = 'Sign-out could not be confirmed. Sign in again before editing. '+error.message;} } finally { busy = false; reconcilePaused(); }
    });
    try {
      const data = await api('/api/contributions/edits?page=1');
      if (generation !== version || session?.actor_id !== actor || !dialog.open) return;
      listMessage(data.total + (data.total === 1 ? ' edit' : ' edits'));
    } catch (error) { if (generation === version) listMessage(error.message); }
  }
  // `generation` guards the dialog's contents; `checks` guards the button. Closing the dialog or
  // leaving the page discards a dialog render, but the newest session answer still reaches the
  // button, so it never stays at "…".
  let sessionCheck=null;
  function pausedSession() { const state=window.HauntologiesAccount?.snapshot();return state?.status==='unknown'&&Boolean(state.actor); }
  function reconcilePaused() { if(document.visibilityState==='visible'&&!busy&&pausedSession())reconcile(); }
  function reconcile() {
    if(sessionCheck)return sessionCheck;
    const pending=checkSession();sessionCheck=pending;pending.finally(()=>{if(sessionCheck===pending)sessionCheck=null;});return pending;
  }
  async function checkSession() {
    const version = ++generation, check = ++checks;
    try {
      const value = await api('/api/auth/session');
      if (check !== checks) return;
      if(typeof value?.actor_id!=='string'||!value.actor_id||typeof value.password_required!=='boolean')throw new Error('Session could not be confirmed. Please sign in again.');
      const currentDialog = version === generation; identity(value);
      if (!currentDialog) return;
      if (dialog.open) { if (value.password_required) renderForm('set-password'); else await showAccount(version); }
      if(!value.password_required)returnToEdit();
    } catch (error) {
      if (check !== checks) return;
      // A temporary service failure does not prove the retained account signed out.
      // Keep its private controls unavailable and retry on focus or the next interval.
      if (pausedSession() && error.status !== 401 && error.status !== 403) return;
      const currentDialog = version === generation; identity(null);
      if (!currentDialog) return;
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
  window.addEventListener('hauntologies-auth-changed', event => {
    if (window.HauntologiesAccount?.isTemporaryTransition?.(event?.detail) && event.detail.current.status === 'unknown') { checks++; generation++; sessionCheck=null; const feed=byId('publishedEditsFeed'); if(feed)feed.hidden=true; return; }
    if (event.detail.current.status !== 'signed_in') { checks++; generation++; sessionCheck=null; const hadSession=!!session; session = null; if(hadSession&&dialog.open&&!challenge)renderForm('sign-in'); trigger.disabled=false; trigger.textContent='Sign in'; trigger.setAttribute('aria-label','Sign in'); byId('accountRegistrationSection').hidden=true; const feed=byId('publishedEditsFeed'); if(feed){feed.open=false;feed.hidden=true;} }
  });
  document.addEventListener('visibilitychange', () => {
    if(document.hidden){checks++;generation++;sessionCheck=null;window.HauntologiesAccount?.pause();}
    else if(document.visibilityState==='visible'&&!busy&&(!dialog.open||pausedSession()))reconcile();
  });
  setInterval(() => { if(document.visibilityState==='visible'&&!busy&&(!dialog.open||pausedSession())) reconcile(); }, 30000);
  trigger.addEventListener('click', open); window.addEventListener('account-open-requested', open);
  byId('closeAccount').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; challenge = null; formHost.replaceChildren(); actions.replaceChildren(); list.replaceChildren(); (opener?.isConnected ? opener : trigger).focus({ preventScroll: true }); if(!busy)reconcile(); });
  window.addEventListener('hashchange', readChallenge);
  window.addEventListener('focus', () => { if (document.visibilityState==='visible'&&!busy&&(!dialog.open||pausedSession())) reconcile(); });
  window.addEventListener('pageshow', event => { if ((!busy && !dialog.open) || event.persisted) reconcile(); });
  window.addEventListener('pagehide', () => { window.HauntologiesAccount?.suspend(); generation++; challenge = null; formHost.replaceChildren(); list.replaceChildren(); });
  window.addEventListener('registration-confirmed', () => identity(session));
  reconcile().then(readChallenge);
})();
