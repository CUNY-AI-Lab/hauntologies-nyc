# Explicit public attribution merges

Contributors are normally grouped by verified actor and consented public moniker. A person choosing a different moniker does not automatically link the two public credits. An explicitly authorized merge can link named aliases belonging to the same verified account without rewriting publication events, revisions, receipt IDs, target hashes or saved drafts.

`scripts/lib/public-attribution-merge.mjs` generates a guarded offline statement. It appends one `public_attribution_merge` audit entry to the existing private event ledger. It does not merge accounts, publish submissions, alter ownership or create a public account identifier. It requires each alias to have a currently public, consented direct publication owned by that verified account. This operation does not cover legacy review-based releases.

Before applying an authorized merge, use existing approved database access to verify the aliases and exact owner, retain a protected minimal snapshot of affected event IDs and record hashes, obtain a current recovery bookmark, and inspect for existing overlapping attribution mappings. Never put private actor IDs, account names, email addresses or the generated SQL in a public PR or report. Do not infer ownership from labels. Preserve chosen names not included in the explicit merge.

Apply the statement once and read back its exact audit entry. An uncertain response requires inspection before retry. Repeating the same statement cannot create another event. Public reads resolve only that actor's approved aliases, including future publications using those aliases; totals still count the original publication events. Existing record-edit target hashes remain valid, and active browser forms do not reload or clear storage.

The rollback generator appends an inactive attribution entry, restoring original public labels. It refuses to override a later overlapping mapping. Repeating rollback or replaying the original merge after rollback cannot reactivate it. A new merge after rollback needs a separately reviewed operation. Never restore the entire database to undo a name change while contributors are working.

Read back Contributors, Activity, History and map record credits after application. Compare counts using the affected event set and account for concurrent real publications. Original submissions and private immutable audit evidence retain the names that were actually submitted.
