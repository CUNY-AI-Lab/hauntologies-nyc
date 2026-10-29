import {fail} from './workflow-core.mjs';

// Unwind only this submission's live snapshots, in dependency order, not clock order.
// Another contributor's newer snapshot is never overwritten. The store repeats the
// current-snapshot and dependency guards in the same transaction as the withdrawal.
export async function ownerRevocationTargets(jobs, getRecord) {
  const grouped = new Map();
  for (const job of jobs) for (const target of JSON.parse(job.manifest_json).targets) {
    const entries = grouped.get(target.record_id) || [];
    entries.push(target); grouped.set(target.record_id, entries);
  }
  const result = [];
  for (const [id, entries] of grouped) {
    const current = await getRecord(id);
    let cursor = current, oldest, latest;
    const remaining = [...entries];
    while (remaining.length) {
      const index = remaining.findIndex(t => cursor && t.after && cursor.raw_json === t.after.raw_json && cursor.derived_json === t.after.derived_json);
      if (index < 0) fail('revocation_dependency_conflict', 409);
      oldest = remaining.splice(index, 1)[0]; latest ||= oldest; cursor = oldest.before;
    }
    const removedEntry=!oldest.before?JSON.parse(oldest.after.derived_json).canonical_entry?.entry_id:null;
    result.push({...latest, before:oldest.before, before_hash:oldest.before_hash, after:current, removed_entry_id:removedEntry});
  }
  return result;
}
