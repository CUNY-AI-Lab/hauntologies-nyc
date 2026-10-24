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

// Publishers apply and verify independently approved changes. Every reviewer is a publisher, so
// approving a change publishes it; CONTRIBUTIONS_PUBLISHER_IDS can add publishers who do not
// review. Publishers have no effect without a valid reviewer list, because nothing can be
// approved without an independent reviewer. An invalid publisher list adds no publishers and
// leaves reviewers as configured.
// Admins (CONTRIBUTIONS_ADMIN_IDS) hold both roles and alone may approve their own work; each
// such approval is marked in its binding so the history shows it skipped independent review.
export function reviewAuthorization(rawReviewers, rawPublishers, rawAdmins) {
  const admins = actorList(rawAdmins) || EMPTY, listed = actorList(rawReviewers);
  if (!listed && !admins.length) return DISABLED;
  const unique = ids => Object.freeze([...new Set(ids)]);
  const reviewers = unique([...(listed || EMPTY), ...admins]);
  const publishers = unique([...reviewers, ...((listed?.length && actorList(rawPublishers)) || EMPTY)]);
  return Object.freeze({ reviewers, publishers, stewards: EMPTY, ...(admins.length ? { admins } : {}) });
}
