// Only an authorized offline transition may write this audit event. Public GETs
// never read accounts or derive names from email addresses.
export const LEGACY_TRANSITION_POLICY = 'legacy-publication-2026-10-30';
export function releaseCreditSQL(revision = 'r', submission = 's') {
  if (![revision, submission].every(value => /^[a-z]+$/.test(value))) throw new Error('invalid_sql_alias');
  return `json_object('public_credit',json(CASE
    WHEN length(trim(COALESCE(json_extract(${revision}.raw_json,'$.public_credit.label'),'')))>0
    THEN json_extract(${revision}.raw_json,'$.public_credit')
    ELSE (SELECT json_extract(attribution.event_json,'$.public_credit') FROM workflow_events attribution
      WHERE attribution.kind='public_attribution' AND attribution.submission_id=${submission}.id
      AND attribution.revision=${revision}.revision AND attribution.actor_id=${submission}.owner_id
      AND json_extract(attribution.event_json,'$.policy')='${LEGACY_TRANSITION_POLICY}'
      ORDER BY attribution.created_at DESC,attribution.id DESC LIMIT 1)
    END))`;
}

// Explicit, reversible attribution merges are private audit entries. Match the
// verified actor and one approved alias; never merge people by display label.
export const PUBLIC_MERGE_POLICY = 'public-attribution-merge-v1';
export function publicMonikerSQL(actor = 'e.actor_id', moniker = "json_extract(e.event_json,'$.moniker')") {
  if (actor !== 'e.actor_id' || moniker !== "json_extract(e.event_json,'$.moniker')") throw new Error('invalid_attribution_expression');
  return `COALESCE((SELECT CASE WHEN json_extract(m.event_json,'$.active')=1 THEN json_extract(m.event_json,'$.name') ELSE ${moniker} END
    FROM workflow_events m WHERE m.kind='public_attribution_merge' AND m.actor_id=${actor}
    AND m.submission_id IS NULL AND json_extract(m.event_json,'$.policy')='${PUBLIC_MERGE_POLICY}'
    AND json_type(m.event_json,'$.active') IN ('true','false')
    AND json_type(m.event_json,'$.name')='text' AND length(trim(json_extract(m.event_json,'$.name'))) BETWEEN 1 AND 120
    AND instr(json_extract(m.event_json,'$.name'),'@')=0
    AND EXISTS(SELECT 1 FROM json_each(m.event_json,'$.aliases') alias WHERE alias.type='text' AND lower(trim(alias.value))=lower(trim(${moniker})))
    ORDER BY m.created_at DESC,m.id DESC LIMIT 1),${moniker})`;
}
export function publicDisplayName(candidate, fallback) {
  return typeof candidate==='string' && candidate.trim() && candidate.length<=120 && !/[@\u0000-\u001f\u007f]/.test(candidate) ? candidate.trim() : fallback;
}
