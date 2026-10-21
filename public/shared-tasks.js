/* Shared task saves are confirmed by the server; browser storage holds pending requests only. */
(function (root) {
  'use strict';
  const storageKey = 'hauntologies-pending-task';
  function createClient({request, storage, newKey = () => crypto.randomUUID()}) {
    let pending = null;
    try {
      const saved = JSON.parse(storage?.getItem(storageKey) || 'null');
      if (saved && typeof saved.idempotency_key === 'string' && saved.task && typeof saved.task.bounded_task === 'string') pending = saved;
    } catch {}
    function remember(value) {
      pending = value;
      try { if(value) storage?.setItem(storageKey, JSON.stringify(value)); else storage?.removeItem(storageKey); } catch {}
    }
    return {
      pendingTask: () => pending?.task || null,
      async list() {
        const data = await request('/tasks');
        if (!Array.isArray(data.tasks)) throw new Error('The shared task list could not be read. Please refresh it.');
        return data.tasks;
      },
      async create(task) {
        if (pending && JSON.stringify(pending.task) !== JSON.stringify(task)) throw new Error('Retry the pending task before creating another task.');
        const body = pending || {idempotency_key:newKey(), task};
        remember(body);
        try {
          const data = await request('/task-create', body);
          if (!data.task?.task_id) throw Object.assign(new Error('The shared save could not be confirmed. Retry this task.'), {uncertain:true});
          remember(null);
          return data.task;
        } catch(error) {
          if (error.status && error.status < 500 && !error.uncertain) remember(null);
          throw error;
        }
      }
    };
  }
  root.SharedTasks = {createClient};
})(typeof window === 'undefined' ? globalThis : window);
