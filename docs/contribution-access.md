# Map accounts

The October 22 production request authorizes email/password sign-in and contribution access on the existing Hauntologies site. Account registration is separate from event RSVP. CUNY Login and Cloudflare Access are withdrawn for this application; their historical adapters stay outside the release bundle.

## Account flow

The Sign in dialog accepts Email and Password, with Reset password and "Don't have an account? Register here." Registration sends an expiring verification link. The recipient chooses the initial password after opening that link, which prevents an earlier requester from setting a password for someone else's mailbox. Passwords contain 12–128 characters and use Better Auth 1.7.12's scrypt implementation. Better Auth and its core package are pinned, and the compiled adapter is exercised in the Cloudflare Worker/D1 runtime.

Only these `/api/auth/` actions are exposed: `session` (GET), and `register`, `verify`, `set-password`, `sign-in`, `request-reset`, `reset`, `sign-out` (POST). Mutations require the exact production Origin, same-origin fetch context and bounded JSON with allowlisted fields. Library signup, social providers, account linking and administrative endpoints stay inaccessible.

Verification setup links stay usable until password creation; reset challenges expire after 30 minutes. They have separate purposes, use hashed identifiers and support one successful consumption. Verification tokens contain 256 random bits; reset tokens use the library's generator. Initial credential creation is protected by a unique user/provider index. Reset revokes previous sessions. Responses expose account status, never a bearer session token.

Sessions use a host-only `__Host-hauntologies-session` cookie with Secure, HttpOnly, SameSite=Lax and a seven-day lifetime. The account session check renews it at most daily and returns the renewed cookie; other private checks do not refresh it. Cookie caching is disabled. Each private request checks current database state, verified email and an installed password credential. Account actors use `map_` plus an immutable library-generated UUID. Client identity headers are removed before the gate passes a verified actor to the contribution service.

Durable, hashed rate counters bound mutation volume, IP/subnet volume, account attempts and outgoing email requests. The global mail limit is 240 dispatched messages/hour and the recipient limit is three requests/hour; Admission also enforces its own shared send limits. Expired rate rows are pruned from an indexed expiry column on account mutations. Private responses use `Cache-Control: private, no-store`.

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

Verified accounts can submit, revise, read and withhold their own contributions. A valid pointed new-place proposal can appear on the public Under review layer before approval. That layer shares its title, description and location, not account identities, private images or source notes. Submission does not publish a verified map record.

When `CONTRIBUTIONS_OPEN_REVIEW=true`, every verified map account can review and publish others' submitted work. Open peers cannot approve their own work, including admins. They do not receive others' drafts, withheld work, historical private revisions, unpublished hosted targets or raw release snapshots. Peers inspect safe before/after map projections for an approved release. Existing owners and explicitly configured reviewers/publishers retain their scoped privileged access. Attendee-dashboard access remains blocked by the public Worker gate.

`CONTRIBUTIONS_REVIEWER_IDS` lists selected reviewers, who also publish. `CONTRIBUTIONS_PUBLISHER_IDS` can add publishers when a valid nonempty reviewer list exists. Each list is a JSON array of at most 20 canonical immutable actor IDs. Invalid entries reject the whole list. `CONTRIBUTIONS_ADMIN_IDS` adds both roles; admin self-approval is recorded explicitly and is available only when open review is disabled. These settings are operator controls, never client claims. Updating code does not authorize changing these settings.

Approval requires explicit evidence, geography, rights, duplicate and privacy checks. The displayed current diff and payload hashes bind the decision. A stale browser preview is rejected with `proposal_changed`; reload and inspect the current publication preview before approving again. The saved historical revision preview remains intact. Approval alone does not publish.

Choose **Stage for verification** after approval. Inspect the candidate map, list and source details using **Preview**, then supply the map/list outcome and concrete evidence in **Verify**. A passing verification activates exactly the staged bytes after server integrity and canonical validation checks. `not_tested` cannot publish. A failed check discards the staged release. The contributor can see these steps as separate states rather than a fabricated automatic acceptance.

Qualifying new-point proposals can create a minimal canonical record. Notes on a built-in or published place append their exact text, facts and source wording to its description under the same review, target guards, staging and verification steps. Public names stay in consented release history so roster opt-outs remain effective. Areas, attachments and unsupported proposals remain review-only. Edits to a built-in or already published place apply as the whole edited record under target version/hash guards. Two edits against the same version cannot both land. Rollback advances the version while restoring the prior snapshot; raw proposals, receipts and audit history are retained. Edits to unpublished hosted records remain review-only and outside ordinary peer access. Ordinary peers edit published places through `record_update`, which uses the safe public target projection. Legacy canonical correction types require ownership or an explicitly privileged role because their raw snapshots can contain private historical fields.

Private images allow three per proposal, one MiB per image, 24 MiB retained per owner and 256 MiB overall. Only the owner uploads; authorized reviewers can download currently referenced images of work they may read. Images are not public assets and are not published automatically. See [Private images](private-images.md).

Public contributor names come only from the consented credit label on each contribution. The Contribute form shows **Show my name with this contribution** with a name field, checked by default; the name field is offered the person's own event-registration name when their account email matches an RSVP, and the device remembers the last choice per account. With the box checked and a name typed, the label appears with the contribution on the public Under review layer (title card list, map popup and the place card it adds to), in the Review queue and detail, and on the published record and Published edits after verification. Unchecking the box, or leaving the name blank, sends `consent:false` and the contribution stays unnamed everywhere. Account identifiers, emails and RSVP names are never inferred as public credit; a roster opt-out withholds the label from every public projection at once (pending places, published records, Published edits and the Contributors counts) and rejoining restores it, while the release itself stays public and still counts; uncredited and rolled-back releases are excluded from published credits. A signed-in roster separately joins event registrations to accounts by normalized email and shows names/counts to map accounts; a person can opt out, and the roster response tells the signed-in viewer their own registration name only. Emails never leave that roster query, and RSVP records do not create reviewer/admin roles.

## Production release

Target Worker: `hauntologies-nyc`, Cloudflare account `452c33847cf5cb1e46f391fca32fd1b5`. Existing D1 database: `hauntologies-nyc` / `df7f1e92-e339-4e25-ac30-989dd68d8dfc`. Public origin: `https://hauntologies-nyc.ailab-452.workers.dev`.

1. Record the current Worker version, a D1 Time Travel bookmark and counts for existing tables. Inspect the schema before applying additive migrations.
2. Preserve migration order and apply only missing, reviewed additive migrations. `0005_contribution_media.sql` stores images, `0006_map_accounts.sql` stores namespaced users, credentials, sessions, challenges and rates, and `0007_roster_opt_out.sql` stores roster opt-outs. Check the migration ledger and schema first; do not rerun applied migrations or remove history.
3. Build and run `node scripts/prepare-account-release.mjs`, then `node --test tests/*.test.mjs`. This prepares `MAP_ACCOUNTS_ENABLED=true`, `REGISTRATION_ELIGIBILITY_ENABLED=true`, `CONTRIBUTIONS_OPEN_REVIEW=true` and the restricted mail binding, while preserving the existing public route and disabling preview URLs.
4. Store a cryptographically generated Hauntologies-only `MAP_AUTH_SECRET` through Worker secret storage without saving it in files, output or source. Release Admission's restricted mail service through its required CI deployment before activating the map binding.
5. Deploy the prepared `dist/server/wrangler.live.json`, verify the serving version, account readiness, signed-out protection and delivered assets, then test verification and reset with the authorized mailbox. Recheck existing table counts.

Any production verification, reset, contribution or image acceptance test requires its own authorization and a disposable test identity. Local synthetic checks do not authorize participant reads or production writes.

Rollback uses the prior Worker version after checking that its bindings are retained; leave additive tables in place to preserve account data and audit history. D1 Time Travel is the recovery path for an independently verified database problem, rather than a routine code rollback.

## Verification

The local runtime suite covers verification-before-password, replay and expiry, concurrent credential creation, reset purpose separation and concurrent consumption, session expiry/revocation, origin and route rejection, durable rate enforcement, forged headers, cross-user proposal/image denial, private image save/readback and default administrative denial. Synthetic mail is confined to the test harness. Browser checks cover registration, password creation, contribution save and account list, sign-out, reset, sign-in with the new password and the mobile dialog. Production verification results belong in the release record with the exact Worker version and observed responses.

References: [Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [database adapters](https://better-auth.com/docs/adapters/other-relational-databases), [OWASP password reset guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Verification email lifetime

Verification mail uses `expiresAt:null`, matching the requested lifetime until password creation. The account service preserves unused setup proofs regardless of age and removes all setup proofs for an address after its password is created. The email and registration interface describe the same behavior. Reset expiry remains 30 minutes. Earlier proposals for a 30-day verification deadline are superseded by this policy.

The contribution form asks for a location before the remaining fields. **Submit** validates and saves in one action; **Check review status** opens the saved contribution. The Review queue lists the newest submissions first and opens on **Awaiting review** (submitted and approved work), with a **Refresh** button and a count of what awaits review from others; while the queue is open it refreshes itself when the public Under review layer changes, at most once every 20 seconds. Each row names the kind of contribution (new place, or a note on a mapped place) and the credited name when one was given. Signed-in participants also reach Review from the **Review** button on another person's pending place in the title-card list, its map popup, or the place card it adds to. The approval checklist keeps its five separate checks and adds **Confirm all five checks**, which ticks them at once; each is still sent to the server individually. Owners and explicitly listed moderators may permanently delete an unpublished contribution only if it has no release job; ordinary peer review grants no deletion access to others’ work. Deletion removes its private revisions and attachments while retaining the idempotency receipt. Published or staged release history cannot be deleted this way. The Jobs panel is shown only to configured administrators; reviewers continue staging and verification through the submission controls.


## Guest admission across account setup

A valid guest access code is checked once during event or account registration. The server records the normalized email hash and approval time in `hny_guest_admissions`; it stores neither the email address nor the code in that table. The emailed proof still verifies ownership before password creation. An admission decision survives code rotation and supports resumed password setup. It grants eligibility only; verified sessions continue to control contribution access and roles. Password creation and reset forms contain only password fields. Existing approved invitations are reconciled separately against their production issue and approval records.
