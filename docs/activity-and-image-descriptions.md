# Public activity and image descriptions

`/activity` and the read-only `/api/activity` show the latest 100 recorded publications still public, in descending publication-time order. The page initially displays 20 and reveals more on request. Direct publication events and earlier verified publication jobs each count once. Historical types come from immutable release operations and the published revision type; timestamps come from verification events or successful verification receipts, never job staging time. Unknown types and unavailable dates remain explicit. The API reports the complete publication count within the existing projection bounds.

Activity uses the same single SQLite/D1 snapshot and public-record projection as Contributors. Direct `direct_publish` events and independently authorized verified releases with a current public target qualify. Pending, failed, revoked and imported work does not count. Retried publications do not create additional events. Revocation removes the withdrawn events and their attribution. The response allowlists the event type, publication time, consented public username (or null), and current public place ID/title, plus an optional place count for multi-place releases. A bundle is one publication and its distinct new places are counted separately. It excludes private account/submission/event IDs, full emails, revision text, change descriptions and audit payloads. Unknown event kinds are labelled only as publications; invalid dates remain unavailable. Roster-hidden contributors remain unattributed.

The Worker strips cookies and identity headers before the public handler; only exact GET/HEAD routes are open, and responses use `no-store`. Invalid queries and excessive projection sizes fail closed. Refresh clears stale content before reading; offline/error responses clear names and show an unavailable state. The page clears its feed when backgrounded and refreshes on return. It does not poll or submit participant data.

The Activity introduction is exactly “Recent additions, edits, and updates to the map”. The successful view has no count or coverage paragraph. Compact entries use 17px place names and keep 44px link targets; loading and error announcements remain available.

The Contribute submenu now orders Edit, Tasks, Activity, Contributors. Activity uses the existing site type, colors and document layout, with native links/buttons, a skip link, status announcements and keyboard focus retained as more items appear.

## Image descriptions

Images use their own supplied alt text. Missing descriptions say “Image description unavailable.” Place titles, captions and another gallery image's metadata are not substituted. Primary image descriptions remain editable through the existing Image description field and direct-publication path, with guidance to describe visible content.

Automatic image description generation is **not enabled**. The repository has no authorized vision-description service: its only model-assisted backend is text ingestion, disabled in `server/runtime.ts` and prepared Worker configuration with `CAIL_ENABLED=false`; `/api/ingest` is closed by the public gate. This change neither enables it nor adds a provider, inference call, credential, permission, image upload or backfill. An authorized vision-capable path and explicit image/privacy handling would be needed before generated descriptions can be offered. Existing saved attachment metadata is immutable; this PR does not introduce gallery attachment metadata revisions.

## Validation and release

- Synthetic regression tests cover public event types/counts, retries, revocation, private/rejected/draft states, attribution, limits, route isolation and image-description publication.
- Prepared Worker tests exercise both Activity routes and shipped browser assets with local synthetic D1 and external services blocked.
- The existing `scripts/test-contributors-ui.mjs` covers Activity at desktop and 390px/320px mobile widths, keyboard navigation, literal text, pagination focus, offline recovery, malformed data and revocation.
- `npm run lint` uses the repository's ESLint flat configuration, and CI fails on lint errors. Build, syntax checks and tests remain required.

This is a code-only change with no database migration. The existing release owner coordinates deployment. Production acceptance must confirm Activity navigation, public feed behavior, image descriptions and mobile/keyboard behavior after deployment. Synthetic local checks do not establish production acceptance.
