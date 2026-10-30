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
