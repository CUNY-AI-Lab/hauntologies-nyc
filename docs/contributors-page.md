# Contributors and place details

Contributors is a public, read-only dropdown on the map. The pumpkin in the title card opens it, and so does **Contributors** in the **Contribute** menu. It lists each public username with a count of contributions; where a count includes earlier verified releases, the row says how many. `/contributors` redirects to `/#contributors`, which opens the same dropdown, so old bookmarks still work. `/api/contributors-summary` serves the list and reads no account names, email addresses or event registrations. Development and acceptance used synthetic records only.

## Behavior

The dropdown loads when it opens, refreshes every 30 seconds while open and visible, and has a **Refresh** button. Closing it, hiding the tab, signing in or signing out clears the names before the next read, so a stale list never stays on screen. Two people who chose the same username appear as separate rows marked "Shared username, separate contributor". Malformed data, an email-shaped name or a failed read clears the list and asks for a retry. Escape closes the dropdown and returns focus to the pumpkin; a click outside it closes it too.

It follows the map's colors and square corners, with counts right-aligned beside names.

## Data contract

One explicitly public projection supplies the read-only endpoints. Every successful, currently public direct publication counts once by event ID. Edits count events, not individual fields. Places added counts distinct record IDs created by those events. Notes, Undo and unknown event kinds remain separate. Earlier verified releases also count once by publication job ID. Their immutable release operations and released revision type identify additions, field/source edits, and notes; unknown types remain unclassified and make affected metric coverage partial. Earlier release counts are components of the headline total, not additional contributions. Verification events or successful verification receipts supply historical publication time; staging time is never substituted. Imports and base inventory do not enter contribution totals.

Only a consented public moniker can name a contributor. Group internally by verified actor plus normalized moniker. Do not link changed monikers, merge same-name actors, or use names stored on accounts/registrations. Random response IDs deliberately cannot identify a person across refreshes. Persistent public profiles would require a separate consent/storage contract; no migration is included.

No public payload is cached. A single bounded database statement gives records and contribution evidence a consistent read, and bounds fail closed instead of presenting partial totals. The response is a complete bounded list rather than cursor pages: 5,000 stored public records, 10,000 direct events and 5,000 older releases. A larger dataset returns unavailable, never a partial total. Server pagination and a durable identity mapping remain separate scaling work.

## Place details

`/api/place-completeness?place=<id>` still reports which core place and reference fields are missing or unknown for one public place. Missing describes a gap in core metadata, and unknown describes unresolved or explicitly unknown information. Optional fields do not count as gaps, blank descriptions on existing places are optional, and image child fields do not apply without an image. No percentage implies research certainty. The request carries a public-content snapshot fingerprint; changed publication or attribution state returns 409. The standalone page that displayed these details was retired in [PR 51](https://github.com/CUNY-AI-Lab/hauntologies-nyc/pull/51), so no screen on the map calls this endpoint now.

## Verification

`tests/contributors-dropdown-client.test.mjs` covers the dropdown's public-only reads, shared usernames, account changes, hidden tabs, malformed data and literal rendering. `tests/contributor-dashboard.test.mjs` and `tests/contributors-prepared.runtime.test.mjs` exercise direct and legacy release lifecycles on synthetic SQLite and on a prepared Worker, including duplicates, revocation, hidden-roster attribution, same-name contributors, unknown event kinds, source aliases, optional fields, invalid coordinates and a 620-place catalog. `scripts/test-contributors-ui.mjs` checks the redirect, the dropdown at desktop, mobile, short landscape and 200% zoom, keyboard use, failed and offline refreshes, place-specific History and the sign-in-to-Edit continuation. [Running the site](running-the-site.md#what-the-tests-cover) explains how to run the browser checks, and [Activity and image descriptions](activity-and-image-descriptions.md) covers the companion `/activity` page.
