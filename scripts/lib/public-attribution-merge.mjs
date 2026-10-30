import { PUBLIC_MERGE_POLICY } from '../../server/public-attribution.mjs';

const quote = value => "'" + value.replaceAll("'", "''") + "'";
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value);
const validName = value => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 120 && !/[@\u0000-\u001f\u007f]/.test(value);

// An operator supplies the verified owning actor after a scoped identity check.
// This is an offline operation, never a mutating public request or account merge.
export function attributionMergePlan({ id, actor, aliases, name, at }) {
  if (!idValid(id) || !idValid(actor) || !actor.startsWith('map_') || !validName(name) ||
      !Array.isArray(aliases) || aliases.length < 2 || aliases.length > 10 ||
      !aliases.every(value => validName(value) && /^[a-z0-9_. -]+$/.test(value)) ||
      new Set(aliases).size !== aliases.length || !aliases.includes(name.toLowerCase()) ||
      typeof at !== 'string' || new Date(at).toISOString() !== at) throw new Error('invalid_attribution_merge');
  const payload = JSON.stringify({ policy:PUBLIC_MERGE_POLICY, active:true, aliases, name, authorized_by:'operator', operation:id });
  const overlap = `m.kind='public_attribution_merge' AND m.actor_id=${quote(actor)} AND json_extract(m.event_json,'$.policy')=${quote(PUBLIC_MERGE_POLICY)} AND EXISTS(SELECT 1 FROM json_each(m.event_json,'$.aliases') a WHERE lower(trim(a.value)) IN (${aliases.map(quote).join(',')}))`;
  // Require each approved alias still to have a consented, currently public
  // publication owned by the same verified account. Drafts are never selected.
  const eligible = alias => `EXISTS(SELECT 1 FROM workflow_events e
    JOIN workflow_submissions s ON s.id=e.submission_id AND s.owner_id=e.actor_id
    JOIN workflow_revisions r ON r.submission_id=e.submission_id AND r.revision=e.revision
    JOIN approved_records p ON p.id=json_extract(e.event_json,'$.record_id')
    WHERE e.kind='direct_publish' AND e.actor_id=${quote(actor)} AND s.review_state='published'
    AND json_extract(p.derived_json,'$.publication_mode')='direct'
    AND lower(trim(json_extract(e.event_json,'$.moniker')))=${quote(alias)}
    AND json_extract(r.raw_json,'$.public_credit.consent')=1
    AND json_extract(r.raw_json,'$.public_credit.identity')='moniker'
    AND lower(trim(json_extract(r.raw_json,'$.public_credit.label')))=${quote(alias)})`;
  const sql = `INSERT INTO workflow_events(id,submission_id,job_id,revision,actor_id,kind,event_json,created_at)
    SELECT ${quote(id)},NULL,NULL,0,${quote(actor)},'public_attribution_merge',${quote(payload)},${quote(at)}
    WHERE NOT EXISTS(SELECT 1 FROM workflow_events WHERE id=${quote(id)})
    AND NOT EXISTS(SELECT 1 FROM workflow_events m WHERE ${overlap})
    AND EXISTS(SELECT 1 FROM hny_auth_user u WHERE 'map_'||u.id=${quote(actor)} AND u.emailVerified=1)
    AND NOT EXISTS(SELECT 1 FROM contributor_roster_hidden h WHERE 'map_'||h.user_id=${quote(actor)})
    AND ${aliases.map(eligible).join(' AND ')};`;
  return { id, actor, aliases:[...aliases], name, at, payload, sql };
}

export function attributionMergeRollback(plan, { id, at }) {
  attributionMergePlan(plan);
  if (!idValid(id) || id === plan.id || typeof at !== 'string' || new Date(at).toISOString() !== at || at <= plan.at) throw new Error('invalid_attribution_rollback');
  const payload = JSON.stringify({ policy:PUBLIC_MERGE_POLICY, active:false, aliases:plan.aliases, name:plan.name, authorized_by:'operator', operation:id, reverses:plan.id });
  return `INSERT INTO workflow_events(id,submission_id,job_id,revision,actor_id,kind,event_json,created_at)
    SELECT ${quote(id)},NULL,NULL,0,${quote(plan.actor)},'public_attribution_merge',${quote(payload)},${quote(at)}
    WHERE NOT EXISTS(SELECT 1 FROM workflow_events WHERE id=${quote(id)})
    AND EXISTS(SELECT 1 FROM workflow_events WHERE id=${quote(plan.id)} AND actor_id=${quote(plan.actor)} AND event_json=${quote(plan.payload)})
    AND NOT EXISTS(SELECT 1 FROM workflow_events m WHERE m.kind='public_attribution_merge' AND m.actor_id=${quote(plan.actor)}
      AND json_extract(m.event_json,'$.policy')=${quote(PUBLIC_MERGE_POLICY)} AND (m.created_at>${quote(plan.at)} OR (m.created_at=${quote(plan.at)} AND m.id>${quote(plan.id)}))
      AND EXISTS(SELECT 1 FROM json_each(m.event_json,'$.aliases') a WHERE lower(trim(a.value)) IN (${plan.aliases.map(quote).join(',')})));`;
}
