/* Shared task saves are confirmed by the server; pending requests stay with their original account. */
(function (root) {
  'use strict';
  const storageKey = 'hauntologies-pending-task';
  function createClient({request, storage, identity, newKey = () => crypto.randomUUID()}) {
    const pending = new Map(), inFlight = new Map();
    const read = key => { try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; } };
    const valid = saved => saved && typeof saved.idempotency_key === 'string' && saved.task && typeof saved.task.bounded_task === 'string';
    const legacy = read(storageKey);
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const changed = () => Object.assign(new Error('Account changed. Return to the original account to check this task save.'), {status:409});
    function forActor(actor) {
      if (!actor) return null;
      if (!pending.has(actor)) {
        const saved = read(storageKey + ':' + actor);
        pending.set(actor, valid(saved) && saved.actor_id === actor ? saved : null);
      }
      return pending.get(actor);
    }
    function remember(actor, value) {
      pending.set(actor, value);
      try { if (value) storage?.setItem(storageKey + ':' + actor, JSON.stringify(value)); else storage?.removeItem(storageKey + ':' + actor); } catch {}
    }
    function current(expected) { const now = identity(); return now.actor === expected.actor && now.generation === expected.generation; }
    return {
      pendingTask: () => forActor(identity().actor)?.task || null,
      // Unowned historical requests are retained, never silently attributed to a new sign-in.
      hasUnownedPendingTask: () => Boolean(valid(legacy)),
      async list() {
        const data = await request('/tasks');
        if (!Array.isArray(data.tasks)) throw new Error('The shared task list could not be read. Please refresh it.');
        return data.tasks;
      },
      create(task) {
        const owner = identity();
        if (!owner.actor) return Promise.reject(Object.assign(new Error('Sign in before saving a shared task.'), {status:401}));
        const previous = forActor(owner.actor);
        if (previous && !same(previous.task, task)) return Promise.reject(new Error('Retry the pending task before creating another task.'));
        if (!previous && [...pending].some(([actor, saved]) => actor !== owner.actor && saved && same(saved.task, task))) return Promise.reject(changed());
        if (!previous && valid(legacy) && same(legacy.task, task)) return Promise.reject(new Error('This older pending task has no confirmed owner. Check the shared list; it cannot be safely retried.'));
        if (inFlight.has(owner.actor)) return inFlight.get(owner.actor);
        const saved = previous || {actor_id:owner.actor, idempotency_key:newKey(), task};
        remember(owner.actor, saved);
        const operation = Promise.resolve().then(async () => {
          if (!current(owner)) throw changed();
          try {
            // Actor is an expected-account assertion, not client-supplied authentication.
            const data = await request('/task-create', {idempotency_key:saved.idempotency_key, task:saved.task}, owner.actor);
            if (!current(owner)) throw changed();
            if (!data.task?.task_id) throw Object.assign(new Error('The shared save could not be confirmed. Retry this task.'), {uncertain:true});
            remember(owner.actor, null);
            return data.task;
          } catch (error) {
            // A denied retry says nothing about an earlier request whose response was lost.
            if (current(owner) && !previous && error.status && error.status < 500 && ![401,403,409].includes(error.status) && !error.uncertain) remember(owner.actor, null);
            throw error;
          }
        }).finally(() => { if (inFlight.get(owner.actor) === operation) inFlight.delete(owner.actor); });
        inFlight.set(owner.actor, operation);
        return operation;
      }
    };
  }
  root.SharedTasks = {createClient};
})(typeof window === 'undefined' ? globalThis : window);
