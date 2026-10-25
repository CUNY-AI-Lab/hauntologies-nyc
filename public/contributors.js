(() => {
  function mountContributors() {
    if (document.getElementById('contributorsButton')) return;

    const footer = document.createElement('footer');
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

    // Map contributors come from published releases whose authors opted into public credit,
    // counted per name; the people who built the map follow under their own heading.
    const credited = document.createElement('section');
    credited.className = 'contributors-section';
    const creditedTitle = document.createElement('h3');
    creditedTitle.textContent = 'Map contributions';
    const creditedStatus = document.createElement('p');
    creditedStatus.className = 'contributors-status';
    creditedStatus.setAttribute('role', 'status');
    const creditedList = document.createElement('ol');
    creditedList.className = 'contributors-list contributors-counts';
    credited.append(creditedTitle, creditedList, creditedStatus);

    const built = document.createElement('section');
    built.className = 'contributors-section';
    const builtTitle = document.createElement('h3');
    builtTitle.textContent = 'Built by';
    const list = document.createElement('ul');
    list.className = 'contributors-list';
    for (const name of [
      'Zach Muhlbauer',
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
    built.append(builtTitle, list);

    let loading = 0;
    async function loadCredits() {
      const version = ++loading;
      if (!creditedList.childElementCount) creditedStatus.textContent = 'Loading…';
      try {
        const response = await fetch('/api/contributor-credits', { cache: 'no-store' });
        if (!response.ok) throw new Error('unavailable');
        const { contributors = [], total = 0 } = await response.json();
        if (version !== loading) return;
        creditedList.replaceChildren(...contributors.map(({ name, count }) => {
          const item = document.createElement('li');
          const who = document.createElement('span');
          who.textContent = name;
          const tally = document.createElement('span');
          tally.className = 'contributors-count';
          tally.textContent = String(count);
          tally.setAttribute('aria-label', count === 1 ? '1 contribution' : count + ' contributions');
          item.append(who, tally);
          return item;
        }));
        const uncredited = total - contributors.reduce((sum, c) => sum + c.count, 0);
        creditedStatus.textContent = !total ? 'No published contributions yet.'
          : uncredited ? (uncredited === 1 ? '1 more published without credit.' : uncredited + ' more published without credit.') : '';
      } catch {
        if (version === loading && !creditedList.childElementCount) creditedStatus.textContent = 'Contribution counts are unavailable right now.';
      }
    }
    dialog.append(header, credited, built);
    document.body.append(footer, dialog);

    button.addEventListener('click', () => {
      if (typeof window.closeTools === 'function') window.closeTools();
      if (!dialog.open) dialog.showModal();
      loadCredits();
      close.focus({ preventScroll: true });
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (button.isConnected && button.getClientRects().length) {
        button.focus({ preventScroll: true });
      }
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Tab') {
        // The close button is the only interactive element in this dialog.
        event.preventDefault();
        close.focus({ preventScroll: true });
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
