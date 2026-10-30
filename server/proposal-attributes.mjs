// Extra attributes remain contributor-authored proposals, never executable field paths.
// Keep names and values verbatim; normalization is only used to detect duplicates.
export const ATTRIBUTE_LIMITS = Object.freeze({ count: 20, name: 80, value: 4000, total: 30000 });
const reserved = new Set(['__proto__', 'prototype', 'constructor', 'id', 'record_id', 'entry_id',
  'actor_id', 'reviewer_id', 'owner_id', 'created_at', 'updated_at', 'approved_at',
  'approval_hash', 'review_state', 'current_revision', 'expected_revision', 'payload_hash',
  'diff_hash', 'private_contributor_reference', 'permissions', 'roles']);

export function validateProposalAttributes(value) {
  const errors = [];
  const issue = (field, code, message) => errors.push({ field, code, message });
  if (value === undefined) return { valid: true, attributes: [], errors };
  if (!Array.isArray(value) || value.length > ATTRIBUTE_LIMITS.count) {
    issue('payload.attributes', 'invalid_attributes', 'Use up to twenty extra facts.');
    return { valid: false, attributes: [], errors };
  }
  const seen = new Set();
  let total = 0;
  for (const [index, row] of value.entries()) {
    const field = `payload.attributes.${index}`;
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        Object.keys(row).length !== 2 || !Object.hasOwn(row, 'name') || !Object.hasOwn(row, 'value')) {
      issue(field, 'attribute_pair_required', 'Use a fact label and a detail.');
      continue;
    }
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > ATTRIBUTE_LIMITS.name || /[\u0000-\u001f\u007f]/u.test(row.name)) {
      issue(field + '.name', 'attribute_name_required', 'Use a fact label of at most 80 characters.');
    } else {
      const normalized = row.name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
      if (reserved.has(normalized.replace(/[ -]+/gu, '_'))) issue(field + '.name', 'reserved_attribute', 'Account and review fields cannot be proposed here.');
      if (seen.has(normalized)) issue(field + '.name', 'duplicate_attribute', 'Use each fact label once.');
      seen.add(normalized);
      total += row.name.length;
    }
    if (typeof row.value !== 'string' || !row.value.trim() || row.value.length > ATTRIBUTE_LIMITS.value || row.value.includes('\u0000')) {
      issue(field + '.value', 'attribute_value_required', 'Use a detail of at most 4000 characters.');
    } else total += row.value.length;
  }
  if (total > ATTRIBUTE_LIMITS.total) issue('payload.attributes', 'attributes_too_large', 'Keep additional details within 30000 characters.');
  return { valid: errors.length === 0, attributes: errors.length ? [] : structuredClone(value), errors };
}
