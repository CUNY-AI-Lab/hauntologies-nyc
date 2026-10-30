import {releaseCreditSQL} from './public-attribution.mjs';
// Names come from released attribution or an explicitly authorized attribution
// audit event. Public reads never query account or registration identities.
export function publicCredit(raw, hidden = false) {
  try {
    const credit = JSON.parse(raw).public_credit;
    if(hidden && credit?.identity!=='moniker')return null;
    if (credit?.consent !== true || typeof credit.label !== 'string') return null;
    const label = credit.label.trim().replace(/\s+/g, ' ');
    return label && label.length <= 120 && !/[@\u0000-\u001f\u007f]/.test(label) ? label : null;
  } catch { return null; }
}

export async function recordCredits(db, recordIds) {
  if (!recordIds.length) return new Map();
  const results=[];
  // D1 bounds parameters per statement; a public page can contain 500 records.
  for(let offset=0;offset<recordIds.length;offset+=80){
    const ids=recordIds.slice(offset,offset+80);
    const page=await db.prepare(`SELECT t.value AS target_json,${releaseCreditSQL()} AS raw_json
    FROM workflow_jobs j
    JOIN workflow_approvals a ON a.id=j.approval_id AND a.submission_id=j.submission_id AND a.revision=j.revision
    JOIN workflow_submissions s ON s.id=j.submission_id
    JOIN workflow_revisions r ON r.submission_id=j.submission_id AND r.revision=j.revision
    JOIN json_each(j.manifest_json,'$.targets') t
    WHERE j.status='verified' AND s.review_state<>'revoked' AND (a.reviewer_id<>s.owner_id OR json_extract(a.binding_json,'$.admin_self_approval')=1)
      AND (json_extract(r.raw_json,'$.public_credit.identity')='moniker' OR NOT EXISTS (SELECT 1 FROM contributor_roster_hidden h WHERE 'map_'||h.user_id=s.owner_id))
      AND json_extract(t.value,'$.record_id') IN (${ids.map(() => '?').join(',')})
    ORDER BY j.created_at,j.id`).bind(...ids).all();
    results.push(...(page.results||[]));
  }
  const credits = new Map();
  for (const row of results) {
    const label = publicCredit(row.raw_json);
    if (!label) continue;
    const id = JSON.parse(row.target_json).record_id, names = credits.get(id) || [];
    if (!names.some(name => name.toLocaleLowerCase('en-US') === label.toLocaleLowerCase('en-US'))) names.push(label);
    credits.set(id, names);
  }
  return credits;
}
