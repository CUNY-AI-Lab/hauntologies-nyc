import { publicCredit } from './record-credits.mjs';
// Public projection of places sent for review but not yet published, so the map can
// show them as their own "under review" layer. Only the words a contributor wrote for
// the map and where it is: never an owner, account, email, source, image or fact list.
// The one name that can appear is the public credit label the contributor consented to,
// and a roster opt-out suppresses it here as it does on published records.
// A withheld, superseded or published submission drops out of this list, and so does an older
// attempt at a place the same contributor has since sent again under the same title.
export const PENDING_STATES = Object.freeze(['submitted', 'changes_requested', 'approved']);
const LIMIT = 500;
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const clip = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : '';
const inNyc = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat > 40.4 && lat < 41 && lon > -74.3 && lon < -73.6;

export function pendingPlace(row) {
  try {
    const raw = JSON.parse(row.raw_json), preview = JSON.parse(row.preview_json);
    if (raw?.type !== 'open_proposal' || preview?.validation?.valid !== true) return [];
    const payload = raw.payload || {}, coordinates = payload.geometry?.type === 'Point' ? payload.geometry.coordinates : null;
    const point = Array.isArray(coordinates) && coordinates.length === 2 && inNyc(coordinates[1], coordinates[0]) ? { latitude: coordinates[1], longitude: coordinates[0] } : null;
    const target = Array.isArray(raw.targets) && raw.targets.length === 1 && RECORD_ID.test(raw.targets[0]?.record_id || '') ? raw.targets[0].record_id : null;
    // Without a point or a mapped place it adds to, there is nowhere to draw it.
    if (!point && !target) return [];
    const contributor = publicCredit(row.raw_json,row.roster_hidden);
    return [{
      id: row.id, status: row.review_state, submitted_at: row.created_at,
      title: clip(raw.title, 300) || 'Contribution', description: clip(payload.explanation, 2000),
      location_text: clip(payload.location_text, 300), ...(point || {}), ...(point ? {} : { record_id: target }),
      // A note on a mapped place is reviewed but never published as a place of its own.
      ...(target ? { note: true } : {}),
      ...(contributor ? { contributor } : {})
    }];
  } catch { return []; }
}

export async function pendingPlaces(db) {
  const { results = [] } = await db.prepare(`SELECT s.id,s.owner_id,s.review_state,s.created_at,r.raw_json,r.preview_json,
      EXISTS (SELECT 1 FROM contributor_roster_hidden h WHERE 'map_'||h.user_id=s.owner_id) AS roster_hidden
    FROM workflow_submissions s JOIN workflow_revisions r ON r.submission_id=s.id AND r.revision=s.current_revision
    ORDER BY s.updated_at DESC,s.id ASC LIMIT ${LIMIT * 4}`).all();
  // The owner is only compared here, never returned. Places left with the default title are never merged.
  // A newer attempt counts in any state, so an older one stays hidden while the newer is a draft or published.
  const keyOf = row => { try { const title = clip(JSON.parse(row.raw_json)?.title, 300).toLocaleLowerCase('en-US'); return title && title !== 'contribution' ? row.owner_id + '\n' + title : null; } catch { return null; } };
  const newest = new Map();
  for (const row of results) { const key = keyOf(row); if (key && !(newest.get(key)?.created_at > row.created_at)) newest.set(key, row); }
  return { places: results.filter(row => { const key = keyOf(row); return PENDING_STATES.includes(row.review_state) && (!key || newest.get(key) === row); }).slice(0, LIMIT).flatMap(pendingPlace) };
}
