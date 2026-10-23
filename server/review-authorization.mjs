const ACTOR_ID = /^access_[a-f0-9]{64}$/;
const MAX_REVIEWERS = 20;
const EMPTY = Object.freeze([]);
const DISABLED = Object.freeze({ reviewers: EMPTY, publishers: EMPTY, stewards: EMPTY });

// This is server configuration, never a request field or an identity lookup.
// Reject the entire list if any entry is invalid; do not partially grant roles.
export function reviewAuthorization(raw) {
  if (typeof raw !== 'string') return DISABLED;
  let ids;
  try { ids = JSON.parse(raw); } catch { return DISABLED; }
  if (!Array.isArray(ids) || ids.length > MAX_REVIEWERS ||
      ids.some(id => typeof id !== 'string' || id.length !== 71 || !ACTOR_ID.test(id)) ||
      new Set(ids).size !== ids.length) return DISABLED;
  return Object.freeze({ reviewers: Object.freeze(ids), publishers: EMPTY, stewards: EMPTY });
}
