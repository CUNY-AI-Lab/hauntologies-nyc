# Direct publication and revision history

The behavior below follows the source on `main`. The live map can trail `main` until the release owner deploys the latest revision.

Registered contributors who can currently edit the map publish new point places, notes on existing places, and typed field/source edits directly. The form requires a chosen public username and a brief change description. Email and account/event names are never attribution defaults. The chosen username is remembered on the current device per account; this adds no account/profile schema or signup requirement. There is no new attribution opt-out toggle.

Place cards keep Edit and History together. Core content remains visible; History, notes and additional Record information are collapsed below it. History loads the public changes on demand, each headed by its username with the time and labeled minus/plus values. Undo publishes an inverse revision against the current version. It preserves later unrelated changes and rejects overlapping ones. Inverses refer to active predecessor changes rather than copying their historical values, so later revocation cannot resurrect withdrawn text or sources through Undo.

## Persistence and ownership

The runtime selects `publicationMode: 'direct'`. Publication writes the private revision, submission state, immutable publication event, public record projection, target version/hash and idempotent receipt in one guarded D1 batch. Repeated requests use the same actor-bound receipt; stale targets and mismatched account assertions fail. Both validation and the final transaction use the caller's expected target version. Existing tables are reused; there is no migration or new service.

A new point gets a stable place ID independent of its text. Notes have separate ownership; edits store field/source changes rather than owning a shared place. Source IDs remain stable when earlier source contributions are withdrawn.

Only an owner can revoke a published contribution. Revocation removes its effects from the current projection and public history/diffs/feed, while keeping its private owner copy. History is recomputed from active contributions, excluding withdrawn predecessor values. Shared container IDs and other contributors' changes survive. Only then can the owner delete the private content. Deletion retains minimal idempotency receipts and target-version tombstones. It cannot erase copies previously downloaded elsewhere.

## Existing work and limits

Existing submitted, changes-requested, approved and staged records do not become public automatically. Supported saved work has an explicit owner Publish action in My edits. Publishing a staged item cancels its old staged job atomically. Previously public verified releases stay public.

Older unsupported formats (for example area proposals and multi-entry bundles) remain private. Their summary-only editor says Save privately; their content can be used in a new place/note or a typed Edit.

Legacy snapshot releases retain the prior dependency guard for withdrawal. If another release or direct edit depends on the legacy snapshot, revocation fails with `revocation_dependency_conflict`; it does not claim to remove the content or overwrite another contributor. Resolving that legacy dependency needs a separate targeted change.

The legacy service mode remains for tests and historical receipts. The production runtime disables review, triage, apply, verify and rollback mutations; direct publication does not manufacture independent-review provenance. Engineering validation still runs.

## Images

A publication can carry up to three images. The form saves the contribution privately, uploads each sanitized derivative against that saved revision, then publishes with the uploaded attachment IDs. The owner can also check saved images in the Edits Publish form. `selectedPublicImages` in `server/public-images.mjs` rejects the whole publication with `image_rights_required` when a selected image has blank or unknown rights, and the form blocks that case before sending. Unselected images remain owner-only.

`GET /api/public-image?id=<attachment ID>` serves an image only while its submission is published, its current revision references the same attachment and hash, and a direct projection in `approved_records` lists it. Revocation and Undo therefore close access at once. Responses carry `no-store`, `nosniff`, a same-origin resource policy and a sandboxed content security policy, and the handler rechecks byte length and SHA-256 before it sends bytes. The place card shows each image with its own alt text, or "Image description unavailable." when none was written.

## Verification and release status

Build and prepare with `npm run build && node scripts/prepare-account-release.mjs`, then run `node --test tests/*.test.mjs`. New coverage lives in `tests/direct-publication.test.mjs`, `tests/direct-publication.runtime.test.mjs` and `tests/public-images.test.mjs`. Browser acceptance is `scripts/test-direct-ui.mjs` and `scripts/test-direct-recovery.mjs`, against `npm run local -- --port 8791 --fresh` only, and `scripts/test-public-images-ui.mjs` against port 8798 by default; they reject a non-localhost URL. Set `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` when using an existing external Playwright/browser installation.

PR 35 merged the earlier review-queue product. Stephen's participant and operator documentation was integrated by [PR 37](https://github.com/CUNY-AI-Lab/hauntologies-nyc/pull/37), and [PR 36](https://github.com/CUNY-AI-Lab/hauntologies-nyc/pull/36) merged the direct-publication changes. [PR 38](https://github.com/CUNY-AI-Lab/hauntologies-nyc/pull/38) added GitHub Actions validation, and [PR 39](https://github.com/CUNY-AI-Lab/hauntologies-nyc/pull/39) merged the guarded `Release Hauntologies` workflow. [PR 46](https://github.com/CUNY-AI-Lab/hauntologies-nyc/pull/46) added selected image publication. A merged workflow does not establish which revision serves in production; check the serving Worker version before you rely on a feature.
