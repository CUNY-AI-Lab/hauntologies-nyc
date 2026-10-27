'use strict';
// Leaflet tracks window resize, not container-only changes or a restored mobile page.
// Use its public APIs, keep the current view, and retry only after a failure/slow load.
(() => {
  function attach(map, streets, onChange = () => {}) {
    const container = map.getContainer();
    const notice = document.getElementById('mapLoadNotice');
    const status = document.getElementById('mapLoadMessage');
    const button = document.getElementById('retryMap');
    const failed = new Set(), loaded = new Set();
    let slow = false, retrying = false, timer = 0, frame = 0, disposed = false;
    let lastAutomaticRetry = -Infinity, message = '';
    const online = () => navigator.onLine !== false;
    function show() {
      message = !online() ? 'Offline. Places are still available.'
        : failed.size ? (loaded.size ? 'Some street tiles are unavailable.' : 'Street map unavailable. Places are still available.')
        : slow ? 'Street map is loading slowly. Places are still available.'
        : retrying ? 'Retrying street map…' : '';
      notice.hidden = !message;
      status.textContent = message;
      button.disabled = !online() || retrying;
      onChange();
    }
    function watchLoading() {
      clearTimeout(timer); slow = false;
      timer = setTimeout(() => { slow = true; retrying = false; show(); }, 12000);
      show();
    }
    const events = {
      loading: watchLoading,
      tileload: ({ tile }) => { failed.delete(tile); loaded.add(tile); show(); },
      tileerror: ({ tile }) => { loaded.delete(tile); failed.add(tile); show(); },
      tileunload: ({ tile }) => { failed.delete(tile); loaded.delete(tile); show(); },
      load: () => { clearTimeout(timer); slow = false; retrying = false; show(); },
    };
    function resize() {
      if (frame || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!document.hidden && container.clientWidth && container.clientHeight) {
          map.invalidateSize({ animate: false, pan: false, debounceMoveend: true });
        }
      });
    }
    function retry(automatic = false) {
      resize();
      if (disposed || !online() || retrying || (!failed.size && !slow)) return;
      // online/pageshow/visibilitychange can arrive together. Never run a retry loop.
      if (automatic && Date.now() - lastAutomaticRetry < 5000) return;
      if (automatic) lastAutomaticRetry = Date.now();
      retrying = true; failed.clear(); loaded.clear();
      watchLoading();
      // Same provider, normal browser caching, only the currently visible grid.
      streets.redraw();
    }
    const restore = () => { if (!document.hidden) { resize(); retry(true); show(); } };
    const click = () => retry();
    streets.on(events);
    button.addEventListener('click', click);
    window.addEventListener('online', restore);
    window.addEventListener('offline', show);
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', restore);
    window.visualViewport?.addEventListener('resize', resize);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(container);
    function dispose() {
      disposed = true; clearTimeout(timer); cancelAnimationFrame(frame); observer?.disconnect();
      streets.off(events); button.removeEventListener('click', click);
      window.removeEventListener('online', restore); window.removeEventListener('offline', show);
      window.removeEventListener('pageshow', restore); document.removeEventListener('visibilitychange', restore);
      window.visualViewport?.removeEventListener('resize', resize);
      map.off('unload', dispose);
    }
    map.on('unload', dispose);
    resize(); watchLoading();
    return Object.freeze({ get message() { return message; }, retry, dispose });
  }
  window.HauntologiesMapRecovery = Object.freeze({ attach });
})();
