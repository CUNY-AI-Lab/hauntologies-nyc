(() => {
  function mountContributors() {
    if (document.getElementById('contributorsButton')) return;

    const footer = document.getElementById('mapFooter') || document.createElement('footer');
    footer.className = 'contributors-footer';
    const button = document.createElement('button');
    button.id = 'contributorsButton';
    button.className = 'outline';
    button.type = 'button';
    button.textContent = 'Contributors';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'contributorsDialog');
    footer.append(button);

    const dialog = document.createElement('dialog');
    dialog.id = 'contributorsDialog';
    dialog.setAttribute('aria-labelledby', 'contributorsTitle');
    dialog.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'contributors-heading';
    const title = document.createElement('h2');
    title.id = 'contributorsTitle';
    title.textContent = 'Contributors';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'contributors-close';
    close.setAttribute('aria-label', 'Close contributors');
    const closeSymbol = document.createElement('span');
    closeSymbol.setAttribute('aria-hidden', 'true');
    closeSymbol.textContent = '×';
    close.append(closeSymbol);
    header.append(title, close);

    // Contributions come from published releases whose authors opted into public credit, counted
    // per name; collaborators and the builder follow under their own headings.
    const credited = document.createElement('section');
    credited.className = 'contributors-section';
    const creditedTitle = document.createElement('h3');
    creditedTitle.textContent = 'Contributions';
    const creditedStatus = document.createElement('p');
    creditedStatus.className = 'contributors-status';
    creditedStatus.setAttribute('role', 'status');
    const creditedList = document.createElement('ol');
    creditedList.className = 'contributors-list contributors-counts';
    // A signed-in registrant can take their own name off the roster, and put it back.
    const listing = document.createElement('label');
    listing.className = 'contributors-listing';
    listing.hidden = true;
    const listed = document.createElement('input');
    listed.type = 'checkbox';
    listing.append(listed, document.createTextNode(' Show my name in this list'));
    credited.append(creditedTitle, creditedList, creditedStatus, listing);

    const collaborators = document.createElement('section');
    collaborators.className = 'contributors-section';
    const collaboratorsTitle = document.createElement('h3');
    collaboratorsTitle.textContent = 'Collaborators';
    const list = document.createElement('ul');
    list.className = 'contributors-list';
    for (const name of [
      "Sam O'Hana Grainger",
      'Zachary Lloyd',
      'Jason Nielsen',
      'Cen Liu',
      'Matthew K. Gold',
    ]) {
      const item = document.createElement('li');
      item.textContent = name;
      list.append(item);
    }
    collaborators.append(collaboratorsTitle, list);

    const built = document.createElement('p');
    built.className = 'contributors-builder';
    built.textContent = 'Built by Zach Muhlbauer';

    let loading = 0;
    const row = (name, count, note) => {
      const item = document.createElement('li');
      const who = document.createElement('span');
      who.textContent = name;
      if (note) {
        const small = document.createElement('small');
        small.textContent = note;
        who.append(small);
      }
      const tally = document.createElement('span');
      tally.className = 'contributors-count';
      tally.textContent = String(count);
      tally.setAttribute('aria-label', count === 1 ? '1 contribution' : count + ' contributions');
      item.append(who, tally);
      return item;
    };
    const getJson = async path => {
      const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw Object.assign(new Error('unavailable'), { status: response.status });
      return response.json();
    };
    // Signed in: every event registrant with what they have sent. Signed out: opted-in credit names only.
    async function loadCredits() {
      const version = ++loading;
      if (!creditedList.childElementCount) creditedStatus.textContent = 'Loading…';
      try {
        let roster = null;
        try { roster = await getJson('/api/contributor-roster'); } catch (error) { if (error.status !== 401) throw error; }
        if (version !== loading) return;
        listing.hidden = !roster?.you;
        if (roster?.you && !listed.disabled) listed.checked = roster.you.listed;
        if (roster) {
          const people = roster.registrants || [];
          creditedList.replaceChildren(...people.map(p => row(p.name, p.contributions,
            !p.account ? 'no map account yet' : p.published ? p.published + ' published' : '')));
          creditedStatus.textContent = people.length ? '' : 'No one has registered yet.';
          return;
        }
        const { contributors = [], total = 0 } = await getJson('/api/contributor-credits');
        if (version !== loading) return;
        creditedList.replaceChildren(...contributors.map(c => row(c.name, c.count)));
        const uncredited = total - contributors.reduce((sum, c) => sum + c.count, 0);
        creditedStatus.textContent = !total ? 'No published contributions yet.'
          : uncredited ? (uncredited === 1 ? '1 more published without credit.' : uncredited + ' more published without credit.') : '';
      } catch {
        if (version === loading && !creditedList.childElementCount) creditedStatus.textContent = 'Contribution counts are unavailable right now.';
      }
    }
    listed.addEventListener('change', async () => {
      const want = listed.checked;
      listed.disabled = true;
      try {
        const response = await fetch('/api/contributor-roster', { method: 'POST', cache: 'no-store', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listed: want }) });
        if (!response.ok) throw new Error('unavailable');
        listed.disabled = false;
        loadCredits();
      } catch {
        listed.checked = !want;
        listed.disabled = false;
        creditedStatus.textContent = 'That did not save. Try again in a moment.';
      }
    });
    // Signing in or out changes which list applies.
    for (const type of ['contributions-session-started', 'contributions-session-ended']) {
      window.addEventListener(type, () => { creditedList.replaceChildren(); listing.hidden = true; if (dialog.open) loadCredits(); });
    }

    dialog.append(header, credited, collaborators, built);
    document.body.append(footer, dialog);

    button.addEventListener('click', () => {
      if (typeof window.closeTools === 'function') window.closeTools();
      if (!dialog.open) dialog.showModal();
      loadCredits();
      clearInterval(refresh);
      refresh = setInterval(() => { if (dialog.open && document.visibilityState === 'visible') loadCredits(); }, 30000);
      close.focus({ preventScroll: true });
    });
    // Counts keep up while the dialog is open.
    let refresh = 0;
    dialog.addEventListener('close', () => clearInterval(refresh));
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (button.isConnected && button.getClientRects().length) {
        button.focus({ preventScroll: true });
      }
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Tab') {
        // Focus cycles between the close button and, when shown, the name switch.
        event.preventDefault();
        const stops = [close, ...(listing.hidden ? [] : [listed])];
        const at = stops.indexOf(document.activeElement);
        stops[(at + (event.shiftKey ? stops.length - 1 : 1)) % stops.length].focus({ preventScroll: true });
      }
      event.stopPropagation();
    });

    const outside = event => {
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom;
    };
    let backdropStart = false;
    dialog.addEventListener('pointerdown', event => {
      backdropStart = event.target === dialog && outside(event);
      event.stopPropagation();
    });
    dialog.addEventListener('click', event => {
      if (backdropStart && event.target === dialog && outside(event)) dialog.close();
      backdropStart = false;
      event.stopPropagation();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountContributors, { once: true });
  } else {
    mountContributors();
  }
})();
