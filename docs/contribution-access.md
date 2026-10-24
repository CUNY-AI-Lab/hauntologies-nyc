# Map accounts

The October 22 production request authorizes email/password sign-in and contribution access on the existing Hauntologies site. Account registration is separate from event RSVP. CUNY Login and Cloudflare Access are withdrawn for this application; their historical adapters stay outside the release bundle.

## Account flow

The Sign in dialog accepts Email and Password, with Reset password and "Don't have an account? Register here." Registration sends an expiring verification link. The recipient chooses the initial password after opening that link, which prevents an earlier requester from setting a password for someone else's mailbox. Passwords contain 12–128 characters and use Better Auth 1.7.12's scrypt implementation. Better Auth and its core package are pinned, and the compiled adapter is exercised in the Cloudflare Worker/D1 runtime.

Only these `/api/auth/` actions are exposed: `session` (GET), and `register`, `verify`, `set-password`, `sign-in`, `request-reset`, `reset`, `sign-out` (POST). Mutations require the exact production Origin, same-origin fetch context and bounded JSON with allowlisted fields. Library signup, social providers, account linking and administrative endpoints stay inaccessible.

Verification and reset challenges expire after 30 minutes, have separate purposes, use hashed identifiers and support one successful consumption. Verification tokens contain 256 random bits; reset tokens use the library's generator. Initial credential creation is protected by a unique user/provider index. Reset revokes previous sessions. Responses expose account status, never a bearer session token.

Sessions use a host-only `__Host-hauntologies-session` cookie with Secure, HttpOnly, SameSite=Lax and a one-hour lifetime. Session refresh and cookie caching are disabled. Each private request checks current database state, verified email and an installed password credential. Account actors use `map_` plus an immutable library-generated UUID. Client identity headers are removed before the gate passes a verified actor to the contribution service.

Durable, hashed rate counters bound mutation volume, IP/subnet volume, account attempts and outgoing email requests. The global mail limit is 60 requests/hour and the recipient limit is three requests/hour; Admission also enforces its own shared send limits. Expired rate rows are pruned from an indexed expiry column on account mutations. Private responses use `Cache-Control: private, no-store`.

## Email delivery

The map calls the restricted `AdmissionHauntologiesAccountMail` entrypoint in `cail-tools-admission` using this exact binding:

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

Admission permits only `verify_email` and `reset_password`, constructs fixed same-origin links and uses the existing SES sender `ailab@gc.cuny.edu`. Credentials remain inside Admission. Tokens travel in URL fragments and are removed from the address bar before password entry. Delivery state contains no plaintext challenge. Ambiguous sends stay unknown rather than being retried automatically. A successful provider response establishes acceptance; receipt in the chosen mailbox is a separate check. Registration alerts and bulk mail remain outside this capability.

## Contributions and permissions

Verified accounts can submit, revise, read and withhold their own contributions. Existing private-image support stores bounded, sanitized JPEG/PNG/WebP attachments with a maximum of three per proposal, one MiB per image and 32 MiB across the database. Images inherit server-checked proposal ownership and remain private. Submission does not publish to the public map.

New accounts receive no reviewer, publisher or attendee-dashboard grant. Those roles require a separate explicit selection of a verified immutable account ID; the first registrant gains no special role. Historical contributions and event RSVPs are not linked through an email match. Existing event rows remain intact.

An explicitly selected reviewer can be configured through `CONTRIBUTIONS_REVIEWER_IDS`, a JSON array of exact verified actor IDs. Map accounts use `map_` followed by their canonical lowercase UUIDv4; legacy verified Access IDs remain supported. Before assigning a map reviewer, confirm its verified account, password credential and signed-in actor ID. This grants private review and triage only. Self-approval stays prohibited, and publication and attendee access retain their separate controls.

Publishers are configured separately through `CONTRIBUTIONS_PUBLISHER_IDS`, a JSON array in the same format and with the same 20-ID limit. A publisher can apply, verify and roll back independently approved changes; the reviewer list never grants publishing. The publisher list has no effect without a valid reviewer list, and an invalid publisher list grants no publishers while leaving reviewers unchanged. A publisher may also be a reviewer, but approval still requires a reviewer other than the submission's owner. Only structured entry bundles create map records: freeform proposals from the Contribute form remain review-only (`open_proposal_review_only`) until they are restated as an entry.

Edits to existing places are live once published. A metadata edit to a built-in or already published place applies as the whole edited record: an independent reviewer approves it, a publisher applies it (staged, not yet public), and verifying publishes it to `approved_records`, where the map shows it in place of the original by id. Every step is a single D1 batch guarded by the submission revision and the target's version and hash, so two edits prepared against the same version cannot both land: the second is refused (`stale_target`) and its author reloads and proposes again. Rollback restores the built-in place, which can then be edited again. Edits to unpublished hosted records remain review-only.

## Production release

Target Worker: `hauntologies-nyc`, Cloudflare account `452c33847cf5cb1e46f391fca32fd1b5`. Existing D1 database: `hauntologies-nyc` / `df7f1e92-e339-4e25-ac30-989dd68d8dfc`. Public origin: `https://hauntologies-nyc.ailab-452.workers.dev`.

1. Record the current Worker version, a D1 Time Travel bookmark and counts for existing tables. Inspect the schema before applying additive migrations.
2. Apply reviewed `0006_map_accounts.sql` for namespaced users, credentials, sessions, challenges and rates. Apply `0005_contribution_media.sql` deliberately for the image control already present in the contribution form; it adds only private attachment storage and leaves existing rows untouched.
3. Build and run `node scripts/prepare-account-release.mjs`, then `node --test tests/*.test.mjs`. This configures `MAP_ACCOUNTS_ENABLED=true` and the restricted mail binding, while preserving the existing public route and disabling preview URLs.
4. Store a cryptographically generated Hauntologies-only `MAP_AUTH_SECRET` through Worker secret storage without saving it in files, output or source. Release Admission's restricted mail service through its required CI deployment before activating the map binding.
5. Deploy the prepared `dist/server/wrangler.live.json`, verify the serving version, account readiness, signed-out protection and delivered assets, then test verification and reset with the authorized mailbox. Recheck existing table counts.

The user selected a mailbox for the production verification/reset test and chooses their own password. Clearly labeled test proposals may be saved and withheld; immutable receipts and audit rows remain. Event RSVP test rows are outside this test.

Rollback uses the prior Worker version after checking that its bindings are retained; leave additive tables in place to preserve account data and audit history. D1 Time Travel is the recovery path for an independently verified database problem, rather than a routine code rollback.

## Verification

The local runtime suite covers verification-before-password, replay and expiry, concurrent credential creation, reset purpose separation and concurrent consumption, session expiry/revocation, origin and route rejection, durable rate enforcement, forged headers, cross-user proposal/image denial, private image save/readback and default administrative denial. Synthetic mail is confined to the test harness. Browser checks cover registration, password creation, contribution save and account list, sign-out, reset, sign-in with the new password and the mobile dialog. Production verification results belong in the release record with the exact Worker version and observed responses.

References: [Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [database adapters](https://better-auth.com/docs/adapters/other-relational-databases), [OWASP password reset guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
