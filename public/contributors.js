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
    dialog.append(header, list);
    document.body.append(footer, dialog);

    button.addEventListener('click', () => {
      if (typeof window.closeTools === 'function') window.closeTools();
      if (!dialog.open) dialog.showModal();
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
