# Direct publication and revision history

Registered contributors who can currently edit the map publish new point places, notes on existing places, and typed field/source edits directly. The form requires a chosen public username and a brief change description. Email and account/event names are never attribution defaults. The chosen username is remembered on the current device per account; this adds no account/profile schema or signup requirement. There is no new attribution opt-out toggle.

Place cards keep Edit and History together. Core content remains visible; History, notes and additional Record information are collapsed below it. History loads the public changes on demand with username, time, description and labeled minus/plus values. Undo publishes an inverse revision against the current version. It preserves later unrelated changes and rejects overlapping ones. Inverses refer to active predecessor changes rather than copying their historical values, so later revocation cannot resurrect withdrawn text or sources through Undo.

## Persistence and ownership

The runtime selects `publicationMode: 'direct'`. Publication writes the private revision, submission state, immutable publication event, public record projection, target version/hash and idempotent receipt in one guarded D1 batch. Repeated requests use the same actor-bound receipt; stale targets and mismatched account assertions fail. Both validation and the final transaction use the caller's expected target version. Existing tables are reused; there is no migration or new service.

A new point gets a stable place ID independent of its text. Notes have separate ownership; edits store field/source changes rather than owning a shared place. Source IDs remain stable when earlier source contributions are withdrawn.

Only an owner can revoke a published contribution. Revocation removes its effects from the current projection and public history/diffs/feed, while keeping its private owner copy. History is recomputed from active contributions, excluding withdrawn predecessor values. Shared container IDs and other contributors' changes survive. Only then can the owner delete the private content. Deletion retains minimal idempotency receipts and target-version tombstones. It cannot erase copies previously downloaded elsewhere.

## Existing work and limits

Existing submitted, changes-requested, approved and staged records do not become public automatically. Supported saved work has an explicit owner Publish action in My edits. Publishing a staged item cancels its old staged job atomically. Previously public verified releases stay public.

Older unsupported formats (for example area proposals and multi-entry bundles) remain private. Their summary-only editor says Save privately; their content can be used in a new place/note or a typed Edit. Private saved images remain owner-only, including after text publication. The direct form does not offer a new public image upload flow.

Legacy snapshot releases retain the prior dependency guard for withdrawal. If another release or direct edit depends on the legacy snapshot, revocation fails with `revocation_dependency_conflict`; it does not claim to remove the content or overwrite another contributor. Resolving that legacy dependency needs a separate targeted change.

The legacy service mode remains for tests and historical receipts. The production runtime disables review, triage, apply, verify and rollback mutations; direct publication does not manufacture independent-review provenance. Engineering validation still runs.

## Verification and release status

Build and prepare with `npm run build && node scripts/prepare-account-release.mjs`, then run `node --test tests/*.test.mjs`. New coverage lives in `tests/direct-publication.test.mjs` and `tests/direct-publication.runtime.test.mjs`. Browser acceptance is `scripts/test-direct-ui.mjs` and `scripts/test-direct-recovery.mjs`, against `npm run local -- --port 8791 --fresh` only; they reject a non-localhost URL. Set `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` when using an existing external Playwright/browser installation.

PR35 was externally merged at `5de74977d6781207f3af70f61f331f5c6f00d49f` before this successor candidate was pushed. It contains the previous review-queue product, not the direct-publication changes described here.

Read-only release audit on October 29 found zero GitHub Actions workflows and no checks on PR35. Stephen's [release-readiness comment](https://github.com/CUNY-AI-Lab/hauntologies-nyc/pull/35#issuecomment-6486910650) reports that Cloudflare has no build configuration for this Worker. That Cloudflare configuration observation was not independently repeated by this task. Local guides describe a Wrangler deployment, while the reported fleet policy requires CI. An authorized CI release path has not been established. No workflow, secret, permission, infrastructure or production setting was changed, and this candidate has not been deployed.

The separate [PR10 documentation review](https://github.com/CUNY-AI-Lab/hauntologies-nyc/pull/10#pullrequestreview-5692439143) still needs a current-main refresh and removal of obsolete 30-day setup-link/cleanup claims. Its writer's files are not changed here; the broader participant/operator guides must also be reconciled with this direct-publication model before release.
