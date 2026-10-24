const ACTOR_ID = /^(?:access_[a-f0-9]{64}|map_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const MAX_REVIEWERS = 20;
const EMPTY = Object.freeze([]);
const DISABLED = Object.freeze({ reviewers: EMPTY, publishers: EMPTY, stewards: EMPTY });

// Each list is server configuration, never a request field or an identity lookup.
// Reject a whole list if any entry is invalid; do not partially grant roles.
function actorList(raw) {
  if (typeof raw !== 'string') return null;
  let ids;
  try { ids = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(ids) || ids.length > MAX_REVIEWERS ||
      ids.some(id => typeof id !== 'string' || ![40, 71].includes(id.length) || !ACTOR_ID.test(id)) ||
      new Set(ids).size !== ids.length) return null;
  return Object.freeze(ids);
}

// Publishers apply and verify independently approved changes. They come only from their own
// list (CONTRIBUTIONS_PUBLISHER_IDS) and have no effect without a valid reviewer list, because
// nothing can be approved without an independent reviewer. An invalid publisher list grants no
// publishers and leaves reviewers as configured.
export function reviewAuthorization(rawReviewers, rawPublishers) {
  const reviewers = actorList(rawReviewers);
  if (!reviewers) return DISABLED;
  return Object.freeze({ reviewers, publishers: (reviewers.length && actorList(rawPublishers)) || EMPTY, stewards: EMPTY });
}
