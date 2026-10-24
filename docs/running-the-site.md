# Running the site

This guide is for the people who build, configure and release the site, and it assumes you have read the [README](../README.md) and [Contribution access](contribution-access.md), which describe what participants see. It covers how to run the site on your own machine, which settings turn features on, how sign-in and email work underneath, and how to release and roll back.

## What runs where

The site is a Vinext app, which is Vite with a Next.js-compatible app router, deployed to Cloudflare Workers with a D1 database bound as `DB`, and its pages and the map are plain HTML and JavaScript with Leaflet and MarkerCluster bundled. The Worker is named `hauntologies-nyc` and lives in the Cloudflare account `452c33847cf5cb1e46f391fca32fd1b5`, its database is also named `hauntologies-nyc` with the ID `df7f1e92-e339-4e25-ac30-989dd68d8dfc`, and its public address is https://hauntologies-nyc.ailab-452.workers.dev with preview URLs switched off.

## Run it locally

Use Node.js 22.13 or newer, install the dependencies with `npm run install:ci`, start the development server with `npm run dev`, and build, prepare the release configuration and run the tests with the commands below, in that order.

```sh
npm run build
node scripts/prepare-account-release.mjs
node --test tests/*.test.mjs
```

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
| `CONTRIBUTIONS_REVIEWER_IDS` | secret or variable | A JSON array of up to twenty account IDs that may review. No release script sets any of the three role lists, so set them on the Worker yourself. |
| `CONTRIBUTIONS_PUBLISHER_IDS` | secret or variable | A JSON array of up to twenty account IDs that may apply, verify and roll back approved changes, which has no effect unless the reviewer list is valid and not empty. |
| `CONTRIBUTIONS_ADMIN_IDS` | secret or variable | A JSON array of up to twenty account IDs that hold the reviewer and publisher roles and may approve their own work, with each such approval recorded as the admin's own in its audit event. |
| `CAIL_*` | variables and one secret | Settings for the model-assisted ingestion backend, which stays off, with `CAIL_API_KEY` as the secret. See [Model-assisted ingestion](../server/README.md). |

Each entry in the three role lists must be a map account ID, which is `map_` followed by a lowercase version 4 UUID. The validator also accepts an older Access ID, which is `access_` followed by 64 lowercase hex characters, but no signed-in map account can match one. The site ignores a whole list when it holds more than twenty entries, a duplicate or any malformed entry, so a typo cannot grant a role by accident. Each list must be written as a string that contains the JSON array, since a native array in the configuration is ignored and grants no roles, and the flags `MAP_ACCOUNTS_ENABLED` and `REGISTRATION_ELIGIBILITY_ENABLED` must be the exact string `true`. Reviewers come from `CONTRIBUTIONS_REVIEWER_IDS` and publishers from `CONTRIBUTIONS_PUBLISHER_IDS`, and a publisher list counts only when the reviewer list is valid and not empty, while an invalid publisher list grants no publishers and leaves the reviewers alone. Admins from `CONTRIBUTIONS_ADMIN_IDS` hold the reviewer and publisher roles and alone may approve their own work, so an admin list switches those roles on even when the other two lists are missing. A deploy that replaces the configuration removes variables that exist only in the Cloudflare dashboard unless `keep_vars` is set, so store each list as a Worker secret, for example with `npx wrangler secret put CONTRIBUTIONS_PUBLISHER_IDS --name hauntologies-nyc`, or add it to the prepared configuration, and check after each deploy that the lists are still in place. Before you add an ID, confirm that the account is verified, has a password, and shows that ID when the person opens `/api/auth/session` while signed in.

## How a contribution reaches the map

Review and publishing are separate steps. A reviewer approves one exact version, and a publisher applies it, which stages the change, and then verifies it, which writes the record to `approved_records` so that the map and the Published edits list show it, while a rollback restores the earlier state. Only an `entry_bundle` creates a new map record, and a valid `record_update` to a built-in or published place applies as the whole edited record, so the edited place replaces the original on the map by ID, and citation, date and location corrections apply to hosted records in the same way. A freeform `open_proposal` from the Contribute form stays review-only until a publisher restates it with Promote to entry, which submits a new `entry_bundle` in the publisher's name and needs its own review by someone other than its author, except that an admin may approve their own work, before the publisher applies and verifies it, while edits to unpublished hosted records, area proposals, record annotations, layer candidates, filter proposals, duplicate proposals and QA and stewardship reports stay review-only. Every step is a single D1 batch guarded by the submission revision and the target's version and hash, so only one of two edits prepared against the same version can land, and the other is refused, as `stale_target` when it is submitted against an old version and as `validation_failed` when it goes stale after submission, while a race inside the batch reports `version_conflict` and an edit that was already staged is discarded at verify, and in every case its author reloads and proposes again.

## How sign-in works

Map accounts use Better Auth 1.7.12, pinned along with its core package, for email and password sign-in on the Worker and D1, and only these actions exist under `/api/auth/`. The action `session` answers GET requests, and `register`, `verify`, `set-password`, `sign-in`, `request-reset`, `reset` and `sign-out` answer POST requests. Every other path under that prefix is refused, which leaves the library's own sign-up, social providers, account linking and administrative endpoints unreachable. Each POST must come from the exact production origin in a same-origin fetch and carry JSON of at most 4 KB that contains only the fields its action allows.

Registration emails a single-use link with a random 256-bit token that the database stores hashed, and the person who asks for an account does not choose a password until the link in the email has been opened, so someone who types another person's address cannot set that account's password. The link works for 30 days from the day it was issued, measured from the stored row's creation time, and `verify` rejects an older row before it spends any access-code attempt while cleanup deletes setup rows past that age, so an address that registered but never created a password keeps a live link until the link is used or the 30 days run out. Opening the link loads the map page without sending the token to any server, because the token sits in the URL fragment, and the Create your password form then posts the token and the new password together, so the server verifies the email, creates the session and sets the password in one request and returns the session cookie only if all of that succeeds, which means that a failure after the link has been consumed leaves a verified account without a password, and that person has to register again or reset the password. Reset links last 30 minutes, carry a purpose of their own and revoke every earlier session once the new password is saved. Passwords hold 12 to 128 characters and are hashed with the scrypt implementation in Better Auth, and a unique index on user and provider keeps two credentials from being created for one account.

Sessions live in the host-only cookie `__Host-hauntologies-session`, which is Secure, HttpOnly and SameSite=Lax with a one-hour lifetime and no refresh or cookie cache, and every private request reads the database again to confirm a live session, a verified email and a stored password credential. Account IDs take the form `map_` plus an immutable UUID, and the gate strips any identity headers a client sends before it passes the verified account to the contribution service. Responses from the account handler and private image downloads carry `Cache-Control: private, no-store`, other contribution responses carry `no-store`, and none of them gives page scripts a session token.

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

Work through these steps in order, and stop at any step that does not check out.

1. Record the current Worker version, a D1 Time Travel bookmark and the row counts of the existing tables, then inspect the schema before applying anything, using the `d1_migrations` table to see which migrations have already run.
2. Apply, in order, the reviewed migrations in `drizzle/` that the database has not seen, where `0005_contribution_media.sql` adds private image storage and `0006_map_accounts.sql` adds the account tables, named with the prefix `hny_auth_`, along with the rate counters, and neither touches existing rows.
3. Build and prepare with `npm run build` and `node scripts/prepare-account-release.mjs`, which sets `MAP_ACCOUNTS_ENABLED` and `REGISTRATION_ELIGIBILITY_ENABLED`, adds the mail binding, enables the public `workers.dev` route and keeps preview URLs off, and then run `node --test tests/*.test.mjs`.
4. Set `MAP_AUTH_SECRET`, `REGISTRATION_GUEST_CODE` and, once people are named, `CONTRIBUTIONS_REVIEWER_IDS`, `CONTRIBUTIONS_PUBLISHER_IDS` and `CONTRIBUTIONS_ADMIN_IDS` as Worker secrets without writing any of them to a file or to output, and release the Admission mail entrypoint through its own deployment workflow before you activate the binding.
5. Deploy the prepared file with the command below, then check the serving version, that `/api/access-status` reports `enabled` with `account_mode` set to `map`, that private routes refuse a signed-out request, and that the delivered assets match the build, and finish with a verification and reset round trip using a mailbox you control, comparing the table counts with the ones you recorded and writing the exact Worker version and the responses you observed into the release record.

```sh
npx wrangler deploy --config dist/server/wrangler.live.json
```

To roll back, switch to the previous Worker version after confirming that its bindings are still in place, and leave the added tables as they are so that account data and audit history survive. D1 Time Travel is the recovery path for a database problem that someone has verified independently, and it is a poor way to undo an ordinary code release.

## What the tests cover

The account tests sign in with email proof, check the one-hour cookie, confirm that reset links are purpose-bound and single-use, check that concurrent verification links create one credential, and confirm that uncertain email or unavailable session storage keeps private access closed, while the registration tests cover admission by CUNY address or code without storing codes, durable limits on code guesses, replayed receipts and the rate budgets. The role tests in `tests/review-authorization.test.mjs` cover list validation and how the three lists combine, and `tests/live-edits.test.mjs` covers approving, applying, verifying and rolling back an edit, refusing a stale one and recording an admin's self-approval. The gate tests confirm that encoded or repeated path separators cannot reach the contribution routes, that identity headers sent by a client are removed, and that private image downloads keep their cache protection.

## What this repository leaves out

This repository is an export of a larger workspace, so it leaves out private source archives, provenance evidence, local runtime profiles, credentials, build output and the original Git history. What remains is the public record citations, uncertainty notes, IDs and geometry in the map source, the current proposed opportunities in the task seed file with their private reconciliation notes removed, and the public-category and behavior tests, while the tests that depend on the private archives stay in the original workspace.

Connecting this repository to Workers Builds needs the existing Cloudflare GitHub App to have access to this exact repository, a connection the export does not establish, and granting that access, creating API tokens, enabling AI and widening access are each separate decisions that no build performs.

## Next

[Model-assisted ingestion](../server/README.md) begins the last stretch of this path, which continues through the tool contract and the extraction skill, and it describes what the backend would do and why it stays off.
