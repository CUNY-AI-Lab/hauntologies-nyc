import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProposalAttributes, ATTRIBUTE_LIMITS } from '../server/proposal-attributes.mjs';
import { buildPreview } from '../server/workflow-core.mjs';

test('additional details remain optional and preserve exact contributor wording', () => {
  assert.deepEqual(validateProposalAttributes(undefined).attributes, []);
  const input = [{ name: 'Archive box', value: '  Box 3\nFolder 12 — not yet checked  ' }, { name: 'Description', value: '<img src=x onerror=alert(1)>' }];
  const result = validateProposalAttributes(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.attributes, input);
  result.attributes[0].value = 'changed';
  assert.equal(input[0].value, '  Box 3\nFolder 12 — not yet checked  ');
});

test('new attributes reject coercion, extra fields, oversized or empty values', () => {
  for (const input of [null, {}, 'text', [{ name: true, value: 'x' }], [{ name: 'x', value: 42 }],
    [{ name: 'x', value: 'v', actor_id: 'forged' }], [{ name: '', value: 'x' }],
    [{ name: 'x', value: '' }], [{ name: 'x'.repeat(81), value: 'v' }],
    [{ name: 'x', value: 'v'.repeat(4001) }], [{ name: 'line\nbreak', value: 'x' }],
    [{ name: 'x', value: 'x\u0000y' }]]) assert.equal(validateProposalAttributes(input).valid, false, JSON.stringify(input));
});

test('review and identity fields cannot masquerade as extra attributes', () => {
  for (const name of ['__proto__', 'constructor', 'Owner ID', 'created_at', 'review-state', 'permissions', 'ＲＥＣＯＲＤ＿ＩＤ']) {
    assert.equal(validateProposalAttributes([{ name, value: 'changed' }]).errors[0].code, 'reserved_attribute', name);
  }
});

test('duplicate normalized names and aggregate limits are enforced without changing originals', () => {
  assert.equal(validateProposalAttributes([{ name: 'Archive', value: 'a' }, { name: ' archive ', value: 'b' }]).errors[0].code, 'duplicate_attribute');
  assert.equal(validateProposalAttributes(Array.from({ length: 21 }, (_, i) => ({ name: 'n' + i, value: 'x' }))).valid, false);
  assert.equal(validateProposalAttributes(Array.from({ length: 8 }, (_, i) => ({ name: 'n' + i, value: 'x'.repeat(ATTRIBUTE_LIMITS.value) }))).errors.at(-1).code, 'attributes_too_large');
});

test('extra attributes are included in the pending proposal and exact review diff', async () => {
  const attributes = [{ name: 'Archive box', value: '  Box 12?\nNot yet verified  ' }];
  const envelope = { schema_version: '1.0', type: 'open_proposal', task_ids: [], title: 'Contribution',
    summary: 'My explanation', public_credit: { consent: false, label: '' }, sources: [], attachments: [], targets: [],
    payload: { explanation: 'My explanation', attributes } };
  const original = JSON.stringify(envelope);
  const preview = await buildPreview(original);
  assert.deepEqual(preview.validation.errors, []);
  assert.deepEqual(preview.proposal.attributes, attributes);
  assert.deepEqual(preview.diff[0].after.payload.attributes, attributes);
  assert.equal(preview.application.applicable, false);
  assert.deepEqual(preview.application.operations, []);
  assert.deepEqual(preview.envelope, JSON.parse(original));
  envelope.payload.attributes[0].value = 'Box 13';
  const changed = await buildPreview(JSON.stringify(envelope));
  assert.notEqual(changed.payload_hash, preview.payload_hash);
  assert.notEqual(changed.diff_hash, preview.diff_hash);
  envelope.payload.attributes = [{ name: 'review_state', value: 'approved' }];
  const forged = await buildPreview(JSON.stringify(envelope));
  assert.equal(forged.validation.valid, false);
  assert.ok(forged.validation.errors.some(error => error.code === 'reserved_attribute'));
});
