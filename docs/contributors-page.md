# Contributors and place details

`/contributors` is a public, read-only page with two views. Contributors lists the public usernames behind direct publications with their activity, and Places shows one chosen place at a time with the core details it lacks. `/api/contributors-summary` and `/api/place-completeness` serve the page, and neither reads account names, email addresses or event registrations. Development and acceptance used synthetic records only.

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

## Current public surface

The separate `/contributors` page now redirects to the map’s Contributors dropdown. The dropdown displays public contributor counts, including earlier verified releases. The public summary and one-place completeness APIs remain available. The layout discussion above records the original page design.

## Data contract

One explicitly public projection supplies both read-only endpoints. Every successful, currently public direct publication counts once by event ID. Edits count events, not individual fields. Places added counts distinct record IDs created by those events. Notes, Undo and unknown event kinds remain separate. Earlier verified releases also count once by publication job ID. Their immutable release operations and released revision type identify additions, field/source edits, and notes; unknown types remain unclassified and make affected metric coverage partial. Earlier release counts are components of the headline total, not additional contributions. Verification events or successful verification receipts supply historical publication time; staging time is never substituted. Imports and base inventory do not enter contribution totals.

Only a consented public moniker can name a contributor. Group internally by verified actor plus normalized moniker. Do not link changed monikers, merge same-name actors, or use names stored on accounts/registrations. Random response IDs deliberately cannot identify a person across refreshes. Persistent public profiles would require a separate consent/storage contract; no migration is included.

Record completeness uses the editor's snapshot aliases on public record projections. Missing describes a gap in core place/reference metadata. Unknown describes unresolved or explicitly unknown information. Optional fields do not count as gaps; blank descriptions on existing places are optional. Image child fields are not applicable without an image. No percentage implies research certainty.

No public payload is cached. Refresh/visibility changes discard old payloads before reading again. A single bounded database statement gives records and contribution evidence a consistent read. Bounds fail closed instead of presenting partial totals. No live query, credential, mutation, migration, push or deployment is part of this local task.

The initial version returns a complete bounded directory/list rather than cursor pages: 5,000 stored public records, 10,000 direct events and 5,000 older releases. A larger dataset returns unavailable, never a partial total. Server pagination and a durable identity mapping remain separate scaling work. The selected-place request carries a public-content snapshot fingerprint; changed publication or attribution state returns 409 and refreshes the directory. Raw private identity material is excluded from the fingerprint.

## Verification

`tests/contributor-dashboard.test.mjs` and `tests/contributors-prepared.runtime.test.mjs` exercise direct and legacy release lifecycles on synthetic SQLite and on a prepared Worker, including duplicates, revocation, hidden-roster attribution, same-name contributors, unknown event kinds, source aliases, optional fields, invalid coordinates and a 620-place catalog. `scripts/test-contributors-ui.mjs` checks the page at 320px, 390px, landscape and desktop widths and at 200% zoom, along with keyboard focus, empty, error, offline and malformed-data states, literal rendering of untrusted usernames, place-specific History and the sign-in-to-Edit continuation. [Running the site](running-the-site.md#what-the-tests-cover) explains how to run the browser checks.

## Navigation

The bottom-right **Contribute** button opens **Edit**, **Tasks**, **Activity** and **Contributors**, in that order. **Edit** opens the contribution form and **Tasks** the shared task view; **Activity** and **Contributors** link to their public pages, described further in [Activity and image descriptions](activity-and-image-descriptions.md). The pumpkin in the title card also links to Contributors. Place-specific Edit controls keep their own labels and behavior.
