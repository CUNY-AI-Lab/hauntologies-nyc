# Contributors and place details

Local feature branch from main eef929b. No live participant records are used for implementation or acceptance.

## Design

Use the map's existing colors: night `#080908`, paper `#11110f`, ink `#f2eee7`, muted `#b8b0a5`, line `#3b3730`, sun `#e9caa1`. Georgia carries the site name and place heading; Arial carries controls and data. Square corners, no decorative motion. Left align all text; right align comparable counts.

Desktop:

```
Hauntologies of New York                         Map
Contributors                        Refresh
Published contributions | Places added | Edits | Notes
Details (definitions and limits)
Contributors             Places [search] [borough] [needs details]
Alphabetical directory   Place selector
name + activity          Selected place, map / edit / contribute
                         Missing and unknown fields
                         Details: present / optional / not applicable
```

Phone: Contributors / Places view buttons, naturally scrolling content, 44px targets. A contributor opens associated places. One selected place is inspected at a time; there is no completeness leaderboard or giant matrix. Controls are directly visible.

Review against the brief: the palette and square corners deliberately match the map. Small totals support the work rather than dominate the page. Omit new branding, cards, charts, scores and decorative badges.

## Data contract

One explicitly public projection supplies both read-only endpoints. Every successful, currently public direct publication counts once by event ID. Edits count events, not individual fields. Places added counts distinct record IDs created by those events. Notes, Undo and unknown event kinds remain separate. Verified legacy releases are reported separately without guessing their kind. Imports and base inventory do not enter contribution totals.

Only a consented public moniker can name a contributor. Group internally by verified actor plus normalized moniker. Do not link changed monikers, merge same-name actors, or use names stored on accounts/registrations. Random response IDs deliberately cannot identify a person across refreshes. Persistent public profiles would require a separate consent/storage contract; no migration is included.

Record completeness uses the editor's snapshot aliases on public record projections. Missing describes a gap in core place/reference metadata. Unknown describes unresolved or explicitly unknown information. Optional fields do not count as gaps; blank descriptions on existing places are optional. Image child fields are not applicable without an image. No percentage implies research certainty.

No public payload is cached. Refresh/visibility changes discard old payloads before reading again. A single bounded database statement gives records and contribution evidence a consistent read. Bounds fail closed instead of presenting partial totals. No live query, credential, mutation, migration, push or deployment is part of this local task.

The initial version returns a complete bounded directory/list rather than cursor pages: 5,000 stored public records, 10,000 direct events and 5,000 older releases. A larger dataset returns unavailable, never a partial total. Server pagination and a durable identity mapping remain separate scaling work. The selected-place request carries a public-content snapshot fingerprint; changed publication or attribution state returns 409 and refreshes the directory. Raw private identity material is excluded from the fingerprint.

## Validation and execution limits

- Production build and account-release assembly succeed locally. The prepared, un-rebundled Worker serves the page, exact assets and both APIs with a disposable synthetic D1 database.
- The full regression suite passed 603 tests; focused tests exercise actual SQLite direct publication and legacy release lifecycles, duplicates, revocation, strict hidden-roster attribution, same-name actors, unknown kinds, source aliases, optional fields, invalid coordinates and 620 places.
- All 17 browser acceptance checks passed, covering 320px, 390px, landscape, desktop, 200% content zoom, keyboard skip/focus, empty states, 503, malformed JSON, offline recovery, literal untrusted usernames, place-specific History, sign-in-to-Edit continuation, and the Contribute menu's working Edit, Tasks and Contributors entries. Evidence is under `output/playwright/contributors/` and `output/validation/` (ignored local artifacts).
- ESLint cannot run because this checkout has no ESLint v9 configuration. Syntax checks, build and the tests above are available.
- Astra/max was requested, and the supplied Astra design review was incorporated. This executor could not attest model selection or execution. The native Codex app was unavailable to computer-use controls; no claim of Astra implementation execution is made.
- This task used an independent clone/branch at the pinned main revision. The existing Air image patch was neither cherry-picked nor edited. Pending image-release adapters and the desktop Tools-wrapper change need their existing owners' integration.

## Follow-up navigation

The subsequent user request changes the main `toolsButton` label from **Edit** to **Contribute**, with visible menu order **Edit, Tasks, Contributors**. The existing `submitTool` now labelled Edit keeps its contribution-form action; Tasks keeps the current shared task view. Contributors is a normal link to the new public page. Place-specific Edit controls keep their labels and behavior. Activity is omitted until a working feature exists, at which point its requested position is before Contributors. The old dialog source remains isolated but is no longer loaded by the map. Desktop direct controls are tracked separately with the map owner.
