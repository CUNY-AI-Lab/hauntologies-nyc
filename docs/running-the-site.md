# Running the site

This guide is for the people who build, configure and release the site, and it assumes you have read the [README](../README.md) and [Contribution access](contribution-access.md), which describe what participants see. It covers how to run the site on your own machine, which settings turn features on, how sign-in and email work underneath, and how to release and roll back.

The contribution behavior below follows the source on `main`. The live map can trail `main` until the release owner deploys the latest revision, so check the serving Worker version before you rely on a feature.

## What runs where

The site is a Vinext app, which is Vite with a Next.js-compatible app router, deployed to Cloudflare Workers with a D1 database bound as `DB`, and its pages and the map are plain HTML and JavaScript with Leaflet and MarkerCluster bundled. The Worker is named `hauntologies-nyc` and lives in the Cloudflare account `452c33847cf5cb1e46f391fca32fd1b5`, its database is also named `hauntologies-nyc` with the ID `df7f1e92-e339-4e25-ac30-989dd68d8dfc`, and its public address is https://hauntologies-nyc.ailab-452.workers.dev with preview URLs switched off.

## Run it locally

Use Node.js 22.13 or newer and install the dependencies with `npm run install:ci`. To try the map with accounts, run `npm run local`, which serves the pages and the real contribution service on SQLite at http://127.0.0.1:8790 with two synthetic accounts. `npm run dev` and `npm start` run the framework server without the account gate, so sign-in, History and the published-records feed answer only through `npm run local` or the prepared release Worker; the app routes `/api/activity`, `/api/contributors-summary`, `/api/place-completeness` and `/api/public-image` answer in both. Build, prepare the release configuration, lint and run the tests with the commands below, in that order.

```sh
npm run build
node scripts/prepare-account-release.mjs
npm run lint
npm test
```

`npm test` runs `node --test "tests/*.test.mjs"`, the same suite CI runs. Rebuild and prepare before you test after a change to `public/`, `web/`, `server/` or `deployment/`, since the prepared-runtime tests read `dist/`. Lint reports warnings without failing; CI fails on lint errors.

Migrations under `drizzle/` from `0004` onward are written by hand, and `drizzle/meta` stops at `0002`. `npm run db:generate` therefore refuses to run instead of generating a duplicate `CREATE TABLE`; write and review a SQL migration by hand.

The preparation script checks the Worker, account and database identifiers, projects the public catalog and writes `dist/server/wrangler.live.json`, performing no deployment and no database migration. The tests use synthetic local SQLite fixtures, and the repository holds no attendee or submission data, so please keep real names, email addresses and submissions out of issues, tests and fixtures.

## Settings

| Setting | Kind | What it does |
|---|---|---|
| `DB` | D1 binding | Holds registrations, accounts, contributions and images. |
| `MAP_ACCOUNTS_ENABLED` | variable | Turns on map accounts when set to `true`, which the account release script does. |
| `MAP_AUTH_SECRET` | secret | Protects account sessions and tokens, and must be at least 32 characters. Generate a fresh random value for each environment, store it as a Worker secret, and keep it out of files, logs and the repository. |
| `ACCOUNT_MAIL` | service binding | Reaches the account mail entrypoint in the Admission worker, described under Email delivery. Account routes answer "accounts unavailable" until this binding, the secret, the variable and the database are all present. |
| `REGISTRATION_ELIGIBILITY_ENABLED` | variable | Limits event registration and account creation to CUNY addresses and guests with the access code when set to `true`, which the account release script does. Without it, anyone can register. |
| `REGISTRATION_GUEST_CODE` | secret | The shared guest access code, at most 256 characters, compared by SHA-256 hash. Store it as a Worker secret. |
| `CONTRIBUTIONS_REVIEWER_IDS` | secret or variable | Legacy-mode reviewer list: a JSON array of up to twenty account IDs. It does not enable review in direct mode. |
| `CONTRIBUTIONS_PUBLISHER_IDS` | secret or variable | Legacy-mode publisher list, effective only with a valid nonempty reviewer list. It does not enable review or release mutations in direct mode. |
| `CONTRIBUTIONS_ADMIN_IDS` | secret or variable | Legacy-mode admin list, granting reviewer and publisher roles with the same independence rules. It does not enable those mutations in direct mode. |
| `CONTRIBUTIONS_OPEN_REVIEW` | variable | The preparation script sets this for the legacy review service. Direct mode disables review, triage, apply, verify and rollback mutations regardless of this setting. |
| `CAIL_*` | variables and one secret | Settings for the model-assisted ingestion backend, which stays off, with `CAIL_API_KEY` as the secret. See [Model-assisted ingestion](../server/README.md). |

In legacy mode, each entry in the three role lists must be a map account ID, which is `map_` followed by a lowercase version 4 UUID. The validator also accepts an older Access ID, which is `access_` followed by 64 lowercase hex characters, but no signed-in map account can match one.

The site ignores a whole list when it holds more than twenty entries, a duplicate or any malformed entry. A typo therefore cannot grant a role by accident. Each list must be a string containing the JSON array. A native array in the configuration is ignored and grants no roles. The flags `MAP_ACCOUNTS_ENABLED` and `REGISTRATION_ELIGIBILITY_ENABLED` must be the exact string `true`.

Reviewers come from `CONTRIBUTIONS_REVIEWER_IDS`. Publishers come from `CONTRIBUTIONS_PUBLISHER_IDS`. A publisher list counts only when the reviewer list is valid and nonempty. An invalid publisher list grants no publishers and leaves reviewers unchanged. Admins from `CONTRIBUTIONS_ADMIN_IDS` hold both roles, but cannot review or verify their own work.

A deploy that replaces the configuration removes variables that exist only in the Cloudflare dashboard unless `keep_vars` is set. Preserve existing Worker secrets and settings through an approved release and verify the bindings afterward. Before adding an ID for a separately authorized legacy use, confirm that the account is verified, has a password and shows that ID at `/api/auth/session` while signed in.

## How a contribution reaches the map

The Worker runtime selects `publicationMode: 'direct'`. A verified contributor publishes a point place, note on an existing place, or supported field/source edit with a chosen public username and change description. The private revision, submission state, publication event, public projection, target version/hash and idempotent receipt are written in one guarded D1 batch. Stale targets or mismatched account assertions fail; a repeated request with the same actor-bound receipt is safe to confirm.

The place's History shows active public changes with their usernames and field differences. Undo publishes an inverse against the current version, preserving unrelated later changes and rejecting overlapping changes. Inverses refer to active predecessors so revocation cannot restore withdrawn values through Undo.

An owner can revoke a published contribution, removing its effects and public history while retaining a private copy. Shared place IDs and other contributors' changes survive. The owner can then delete that private copy, leaving minimal idempotency receipts and target-version tombstones. Copies downloaded elsewhere cannot be erased. Legacy snapshot releases keep their dependency guard: a conflicting later release or edit blocks revocation rather than overwriting it.

Existing submitted, changes-requested, approved and staged work remains private until its owner explicitly publishes a supported item in Edits. Publishing a staged item cancels its old staged job atomically. Previously verified public releases stay public. Unsupported older formats, including areas and multi-entry bundles, stay private. A publication can carry up to three images, each with known rights, which `/api/public-image` serves while the contribution stays published; unselected saved images remain owner-only. [Direct publication](direct-publication.md#images) has the rules.

The legacy service and independent-review tests remain for historical receipts, but the direct runtime does not expose review, triage, apply, verify or rollback mutations or create review provenance. See [Direct publication and revision history](direct-publication.md) for the complete ownership and persistence rules.

## How sign-in works

Map accounts use Better Auth 1.7.12, pinned along with its core package, for email and password sign-in on the Worker and D1, and only these actions exist under `/api/auth/`. The action `session` answers GET requests, and `register`, `verify`, `set-password`, `sign-in`, `request-reset`, `reset` and `sign-out` answer POST requests. Every other path under that prefix is refused, which leaves the library's own sign-up, social providers, account linking and administrative endpoints unreachable. Each POST must come from the exact production origin in a same-origin fetch and carry JSON of at most 4 KB that contains only the fields its action allows.

Registration emails a single-use link with a random 256-bit token that the database stores hashed. The person who asks for an account does not choose a password until the link has been opened, so someone who types another person's address cannot set that account's password.

The mail payload marks a verification message with `expiresAt:null`. That is the message-service contract; it is not the database row's expiry field. Better Auth creates the stored magic-link row with `expiresIn:1800`. The map disables automatic cleanup for unused setup-proof rows; reset challenges are cleaned up separately and retain a finite 30-minute expiry. When a validated proof is presented, the map refreshes that existing row to 30 minutes from the current request before Better Auth consumes it. This is how an unused proof remains usable until password creation while the storage and consumption deadline stays finite for the active request.

Opening the link loads the map page without sending the token to a server because the token sits in the URL fragment. The Create your password form then posts the token and new password together. The server verifies the email, creates the session and sets the password in one request. A failure after the link has been consumed can leave a verified account without a password; that person must register again or reset the password.

Reset links last 30 minutes, carry a separate purpose and revoke earlier sessions once the new password is saved. Passwords hold 12 to 128 characters and use Better Auth's scrypt implementation. A unique user/provider index prevents duplicate credentials.

Sessions live in the host-only cookie `__Host-hauntologies-session`, which is Secure, HttpOnly and SameSite=Lax with a seven-day lifetime. The account session check may renew it at most once daily; other private checks do not refresh it, and cookie caching is disabled. Every private request reads the database again to confirm a live session, a verified email and a stored password credential. Account IDs take the form `map_` plus an immutable UUID, and the gate strips any identity headers a client sends before it passes the verified account to the contribution service. Responses from the account handler and private image downloads carry `Cache-Control: private, no-store`, other contribution responses carry `no-store`, and none of them gives page scripts a session token.

Durable counters in the `hny_auth_limits` table, keyed by hashed identifiers, bound the total number of account requests, the requests from one network address, the attempts against one email address across registration, sign-in and reset requests, with a daily cap on failed sign-ins, and each path that sends email, whether counted across all addresses, per recipient or per network address by the hour and by the day, and guesses at the access code, which count per account on verify, set-password and reset and per network address on those routes and on registration. The counters apply to POST actions only, so reading a session is never counted. The exact limits live in `deployment/map-accounts.mjs`, expired rows are pruned during account requests, and Admission applies its own recipient and daily caps on top of them.

## Event registration

Event registration is public intake only, as the header of `server/registration.mjs` says, with no attendee reads, no identity claims, no email and no writes to the map. It saves a name of up to 120 characters and a validated email address in `event_registrations`, requires an `Idempotency-Key` header so that retrying an uncertain save gives back the original receipt, and reads the row back before it reports success. Its own budgets in `event_registration_limits` currently allow 10 saved registrations per network address and 200 overall in each 15-minute window, so a room of people registering from one campus address can reach the first limit. While eligibility is on, every new registration request, including one from a CUNY address, counts against a separate durable budget in `server/registration-eligibility.mjs` before any registration is created, which is what limits access-code guesses, and it currently allows 30 requests per network address and 1,000 overall in each 15-minute window.

## Email delivery

Verification and reset messages leave through the Admission worker, which owns the sender address and the mail credentials, so the map reaches a restricted entrypoint there through the service binding that `scripts/prepare-account-release.mjs` writes into the prepared configuration.

```json
{
  "binding": "ACCOUNT_MAIL",
  "service": "cail-tools-admission",
  "entrypoint": "AdmissionHauntologiesAccountMail",
  "props": {
    "app": "hauntologies-nyc",
    "origin": "https://hauntologies-nyc.ailab-452.workers.dev"
  }
}
```

The entrypoint accepts only `verify_email` and `reset_password` for this app and origin, which keeps registration alerts and bulk mail outside this capability, and it builds fixed links of the form `/#account-verify=<token>` and `/#account-reset=<token>` and sends them from ailab@gc.cuny.edu with a fixed subject. The token travels in the URL fragment, which the browser never sends to a server, and the page removes it from the address bar before it asks for a password. A success response means the mail provider accepted the message and says nothing about whether it reached the mailbox, so an ambiguous send is recorded as unknown and never retried automatically, and the delivery records hold no plaintext token.

Admission documents its side in `apps/admission/docs/HAUNTOLOGIES-ACCOUNT-MAIL.md` in the `CUNY-AI-Lab/cail-tools-admission` repository, and its entrypoint has to be released before the map's binding is switched on.

## Release

For a reviewed release that changes code but no migrations, use the separate [code-only release procedure](code-only-release.md). The database procedure below is separate and requires its own authorization, as does the one-time [legacy publication transition](legacy-publication-transition.md) for older saved work.

Work through these steps in order, and stop at any step that does not check out.

1. Record the current Worker version, a D1 Time Travel bookmark and counts for existing tables. Compare the actual schema with `d1_migrations`: a table can exist even when the corresponding migration is absent from the ledger. Do not blindly reapply a migration.
2. Consider only separately reviewed and authorized migrations in `drizzle/`, in order. `0005_contribution_media.sql` adds private image storage and `0006_map_accounts.sql` adds account tables and rate counters. The direct-publication change itself adds no migration.
3. Build and prepare with `npm run build` and `node scripts/prepare-account-release.mjs`, then run `node --test tests/*.test.mjs`. Preparation sets account eligibility, adds the mail binding, enables the public `workers.dev` route and keeps preview URLs off.
4. Keep `MAP_AUTH_SECRET` and `REGISTRATION_GUEST_CODE` in Worker secret storage without writing them to a file or output. Release the Admission mail entrypoint through its own deployment workflow before activating the binding. Preserve existing variables and bindings and verify them after deployment.
5. For a release requiring database work, obtain separate authorization for the database procedure and release, then record the serving version, `/api/access-status` (`enabled` with `account_mode: map`), signed-out protection, delivered assets and the authorized database checks. Separately, an authorized human must perform the verification and reset round trip with a mailbox they control and record rollout acceptance; CI must not receive mailbox credentials.

The existing manual deployment notes are historical, not a currently approved release path. Do not run a local `wrangler deploy` from this repository. The required release approvals and configured CI deployment credential are needed before production release.

To roll back, switch to the previous Worker version after confirming that its bindings are still in place, and leave the added tables as they are so that account data and audit history survive. D1 Time Travel is the recovery path for a database problem that someone has verified independently, and it is a poor way to undo an ordinary code release.

## What the tests cover

The account tests sign in with email proof, check the seven-day cookie and its daily renewal, confirm that setup proofs survive age cleanup while reset links are purpose-bound and single-use, check that concurrent verification links create one credential and confirm that uncertain email or unavailable session storage keeps private access closed.

Registration tests cover admission by CUNY address or code without storing codes, durable limits on code guesses, replayed receipts and rate budgets. Direct-publication tests cover publication, guarded concurrent edits, History and Undo, owner revocation and deletion, explicit publication of supported saved work, selected public images and the revision each owner mutation names. Public projection tests cover Activity, Contributors and place details without private identifiers. Legacy-mode role and live-edit tests retain coverage of independent review, approval, verification and rollback. Gate tests confirm that encoded or repeated path separators cannot reach contribution routes, client identity headers are removed and private image downloads keep their cache protection.

Eight browser acceptance scripts, `scripts/test-*.mjs`, drive Chromium through Playwright against the local server; CI does not run them. Start `npm run local -- --port 8791 --fresh` for `test-direct-ui.mjs`, `test-direct-recovery.mjs` and `test-undo-recovery.mjs`, or `npm run local -- --port 8798 --fresh` for `test-direct-controls.mjs`, `test-public-images-ui.mjs`, `test-contributors-ui.mjs`, `test-map-components-ui.mjs` and `test-place-card-refresh-ui.mjs`, then run the script with `node`. Set `LOCAL_MAP_URL=http://127.0.0.1:<port>` to point a script at another local port. Each script refuses any address other than `127.0.0.1`, signs in only with the synthetic accounts and writes screenshots under `output/`, which Git ignores. Set `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` to reuse an existing Playwright installation and browser.

## What this repository leaves out

This repository is an export of a larger workspace, so it leaves out private source archives, provenance evidence, local runtime profiles, credentials, build output and the original Git history. What remains is the public record citations, uncertainty notes, IDs and geometry in the map source, the current proposed opportunities in the task seed file with their private reconciliation notes removed, and the public-category and behavior tests, while the tests that depend on the private archives stay in the original workspace.

Connecting this repository to Workers Builds needs the existing Cloudflare GitHub App to have access to this exact repository, a connection the export does not establish, and granting that access, creating API tokens, enabling AI and widening access are each separate decisions that no build performs.

## Next

[Model-assisted ingestion](../server/README.md) begins the last stretch of this path, which continues through the tool contract and the extraction skill, and it describes what the backend would do and why it stays off.
