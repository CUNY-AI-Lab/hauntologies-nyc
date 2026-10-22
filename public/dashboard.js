(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const pageSize = 25;
  const timeoutMs = 20000;
  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/New_York', timeZoneName: 'short',
  });
  let cursors = [null];
  let pageIndex = 0;
  let nextCursor = null;
  let lastAttempt = { index: 0, cursor: null };
  let requestNumber = 0;
  let activeController = null;
  let busy = false;

  function clearRows() {
    $('registrationRows').replaceChildren();
    $('registrationResults').hidden = true;
    $('registrationPages').hidden = true;
    $('registrationPage').textContent = '';
    nextCursor = null;
    $('previousRegistrations').disabled = true;
    $('nextRegistrations').disabled = true;
  }

  function setBusy(value) {
    busy = value;
    $('registrations').setAttribute('aria-busy', String(value));
    $('refreshRegistrations').disabled = value;
    $('retryRegistrations').disabled = value;
    $('dashboardLogout').disabled = value;
  }

  function recovery({ signIn = false, retry = false } = {}) {
    $('dashboardSignIn').hidden = !signIn;
    $('retryRegistrations').hidden = !retry;
    $('dashboardRecovery').hidden = !signIn && !retry;
  }

  async function request(path, options = {}, outerSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (outerSignal?.aborted) controller.abort();
    else outerSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetch(path, {
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        ...options, signal: controller.signal,
        headers: { Accept: 'application/json', ...options.headers },
      });
      const body = response.status === 204 ? null : await response.json().catch(() => null);
      return { response, body };
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', abort);
    }
  }

  async function signInReady(signal) {
    try {
      const { response, body } = await request('/api/access-status', {}, signal);
      return response.ok && body?.dashboard_enabled === true;
    } catch { return false; }
  }

  function validPage(body) {
    return body && Array.isArray(body.registrations) && body.registrations.length <= pageSize
      && (body.next_cursor === null || (typeof body.next_cursor === 'string' && body.next_cursor.length > 0 && body.next_cursor.length <= 1024))
      && body.registrations.every(row => row && typeof row.name === 'string' && typeof row.email === 'string'
        && typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at)));
  }

  function renderRows(rows) {
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      const email = document.createElement('td');
      const registered = document.createElement('td');
      const time = document.createElement('time');
      name.textContent = row.name;
      email.textContent = row.email;
      time.dateTime = row.created_at;
      time.textContent = dateFormat.format(new Date(row.created_at));
      registered.append(time);
      tr.append(name, email, registered);
      fragment.append(tr);
    }
    $('registrationRows').replaceChildren(fragment);
  }

  async function loadPage(index = 0, cursor = null) {
    if (busy) return;
    const number = ++requestNumber;
    activeController?.abort();
    activeController = new AbortController();
    const signal = activeController.signal;
    lastAttempt = { index, cursor };
    clearRows();
    recovery();
    $('dashboardLogout').hidden = true;
    $('dashboardStatus').textContent = 'Loading';
    setBusy(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (cursor !== null) params.set('cursor', cursor);
      const { response, body } = await request('/api/admin/registrations?' + params, {}, signal);
      if (number !== requestNumber) return;
      if (response.status === 401 || response.status === 403) {
        const ready = await signInReady(signal);
        if (number !== requestNumber) return;
        $('dashboardLogout').hidden = response.status !== 403;
        $('dashboardStatus').textContent = response.status === 403 ? 'Access unavailable' : ready ? 'Sign in to view registrations' : 'Sign-in unavailable';
        recovery({ signIn: ready, retry: true });
        return;
      }
      if (!response.ok || !validPage(body)) throw new Error('unavailable');
      pageIndex = index;
      cursors[index] = cursor;
      nextCursor = body.next_cursor;
      renderRows(body.registrations);
      $('dashboardLogout').hidden = false;
      $('dashboardStatus').textContent = body.registrations.length ? '' : 'No registrations';
      $('registrationResults').hidden = !body.registrations.length && index === 0;
      $('registrationPages').hidden = index === 0 && nextCursor === null;
      $('registrationPage').textContent = 'Page ' + (index + 1);
      $('previousRegistrations').disabled = index === 0;
      $('nextRegistrations').disabled = nextCursor === null;
    } catch {
      if (number !== requestNumber) return;
      clearRows();
      $('dashboardStatus').textContent = 'Registrations unavailable';
      recovery({ retry: true });
    } finally {
      if (number === requestNumber) setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    const number = ++requestNumber;
    activeController?.abort();
    activeController = new AbortController();
    const signal = activeController.signal;
    clearRows();
    cursors = [null];
    pageIndex = 0;
    lastAttempt = { index: 0, cursor: null };
    recovery();
    $('dashboardStatus').textContent = 'Signing out';
    setBusy(true);
    try {
      const { response } = await request('/auth/logout', { method: 'POST' }, signal);
      if (response.status !== 204) throw new Error('unconfirmed');
      const ready = await signInReady(signal);
      if (number !== requestNumber) return;
      $('dashboardLogout').hidden = true;
      $('dashboardStatus').textContent = 'Signed out';
      recovery({ signIn: ready });
    } catch {
      if (number !== requestNumber) return;
      $('dashboardLogout').hidden = false;
      $('dashboardStatus').textContent = 'Sign-out not confirmed';
    } finally {
      if (number === requestNumber) setBusy(false);
    }
  }

  $('refreshRegistrations').addEventListener('click', () => { cursors = [null]; loadPage(); });
  $('retryRegistrations').addEventListener('click', () => loadPage(lastAttempt.index, lastAttempt.cursor));
  $('previousRegistrations').addEventListener('click', () => { if (pageIndex > 0) loadPage(pageIndex - 1, cursors[pageIndex - 1]); });
  $('nextRegistrations').addEventListener('click', () => { if (nextCursor !== null) loadPage(pageIndex + 1, nextCursor); });
  $('dashboardLogout').addEventListener('click', logout);
  window.addEventListener('pagehide', () => {
    ++requestNumber;
    activeController?.abort();
    clearRows();
    setBusy(false);
  });
  window.addEventListener('pageshow', event => { if (event.persisted) loadPage(); });
  loadPage();
}());
