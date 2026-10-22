# Private dashboard access

The public map and registration at `/register` use the existing Worker and D1 database. Registration accepts only Name and Email through `/api/register`; it has no public attendee list. Contribution and review APIs remain closed. No reviewer grants, identity provider, service binding or database migration are created by this release.

## Current decision

The owner selected their existing CUNY Login admin account, `zach.muhlbauer`. The earlier Gmail and email one-time PIN proposal is superseded and was not approved. A typed username is not a verified subject. No account is granted access until its authenticated canonical subject is verified and the exact integration is approved.

The existing CUNY service source documents a private `WorkerIdentity` entrypoint on `cail-doorway`. A proposed Hauntologies receiver would use:

- Service binding `IDENTITY` to `cail-doorway`, entrypoint `WorkerIdentity`
- Binding props `{ "id": "hauntologies-nyc", "worker": "hauntologies-nyc", "workspace": false }`
- Audience `cail:hauntologies-nyc` and issuer `https://tools.ailab.gc.cuny.edu/cail-sso`
- Same-origin `/auth/start`, `/auth/callback` and POST `/auth/logout`
- Private dashboard and contribution routes only; `/`, `/register` and `/api/register` stay public

These are proposed integration values derived from local service source, not a verified deployed registration. The receiver requires an application adapter, authorization scoped to the verified owner, and action-time approval for the persistent service binding. This release does not add that binding or imply access for other contributors. The dormant Cloudflare Access JWT adapter is a different protocol and must not be enabled as a substitute.

## Application safeguards

Submit requires a matching durable receipt. An uncertain save retains its exact request and idempotency key. Pending requests bind to the verified actor; a different account cannot replay them. Sign-in opens separately and does not submit automatically. Failed authentication clears loaded private review data and capabilities.

Reviewer configuration defaults to empty. `CONTRIBUTIONS_REVIEWER_IDS` accepts only explicitly approved verified actor IDs; malformed configuration grants no roles. Publishers and stewards remain empty. Contributor credits confer no permissions. A contributor cannot approve their own proposal, and reviewed metadata does not automatically overwrite map records.

Old hosting identities and submission history have not been migrated or remapped. Do not infer ownership from an unverified email or rewrite existing history.

## Verification and remaining decisions

On October 22, 2026 the user approved renewal of the existing Wrangler OAuth session with unchanged permissions. Renewal succeeded with the same 29 scopes; no new login grant or credential was created. The previously denied Access organization lookup was not retried.

The public registration page and time change can deploy independently. Private dashboard activation still requires the exact CUNY binding approval and verified owner subject. Any independent reviewer identity and role needs separate approval.

Production proposal/retry/withdrawal testing and registration test writes remain unapproved. Local synthetic SQLite and browser results are not production acceptance. No attendee or submission data belongs in this repository or test fixtures.
