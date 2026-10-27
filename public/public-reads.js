'use strict';
// Public map reads only. Never replay a save, review, registration or authentication request.
(() => {
  const transient = new Set([408, 429, 500, 502, 503, 504]);
  const cooldowns = new Map();
  async function json(path) {
    const deadline = Date.now() + 24000;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (navigator.onLine === false) throw new Error('Offline');
      const cooldown = cooldowns.get(path);
      if (cooldown?.until > Date.now()) throw Object.assign(new Error('Public map read is waiting for the server'), { status: cooldown.status });
      cooldowns.delete(path);
      const controller = new AbortController(); let timer, timedOut = false;
      try {
        // Race the whole read (including the body), not just receipt of headers.
        // Abort releases the connection; the deadline still settles a non-cooperative fetch.
        return await Promise.race([
          (async () => {
            const response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
            if (!response.ok) {
              const value = response.headers.get('Retry-After');
              const delay = value === null ? 0 : /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now());
              if (transient.has(response.status) && Number.isFinite(delay) && delay > 0) cooldowns.set(path, { until: Date.now() + delay, status: response.status });
              throw Object.assign(new Error('Public map read unavailable'), { status: response.status, retryAfter: Number.isFinite(delay) ? delay : 0 });
            }
            return response.json();
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Public map read timed out')); }, Math.max(1, Math.min(8000, deadline - Date.now()))); }),
        ]);
      } catch (error) {
        const retryable = timedOut || error instanceof TypeError || transient.has(error.status);
        const delay = Math.max(500 * 2 ** attempt, error.retryAfter || 0);
        if (!retryable || attempt === 2 || Date.now() + delay >= deadline || navigator.onLine === false) throw error;
        clearTimeout(timer);
        // Bounded backoff. A longer Retry-After ends this cycle instead of retrying early.
        await new Promise(resolve => setTimeout(resolve, delay));
      } finally { clearTimeout(timer); }
    }
  }
  function singleFlight(task) {
    let active = null;
    return function refresh() {
      if (!active) active = Promise.resolve().then(task).finally(() => { active = null; });
      return active;
    };
  }
  window.HauntologiesPublicReads = Object.freeze({ json, singleFlight });
})();
