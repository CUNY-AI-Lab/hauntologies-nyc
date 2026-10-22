# Private dashboard access

The live public map and registration at `/register` use the existing Worker and D1 database. Registration accepts Name and Email through `/api/register`; it has no public attendee list. The private attendee dashboard and CUNY session adapter in this branch are tested locally, not deployed or activated. No reviewer grant, identity provider, service binding or database migration is created by this change.

## Owner and integration decision

The owner selected the existing CUNY Login admin account `zach.muhlbauer`. The earlier Gmail/email-code proposal is superseded and was not approved. A typed username is not a verified subject. No owner is configured until the canonical subject is verified through the existing CUNY authentication service and the exact connection is approved.

The proposed private service connection is:

```json
{
  "binding": "IDENTITY",
  "service": "cail-doorway",
  "entrypoint": "WorkerIdentity",
  "props": { "id": "hauntologies-nyc", "worker": "hauntologies-nyc", "workspace": false }
}
```

The receiver verifies only the application identity for audience `cail:hauntologies-nyc` and issuer `https://tools.ailab.gc.cuny.edu/cail-sso`. It never consumes or exposes Gateway/workspace identity legs and adds no Gateway or AdmissionResolver binding. Doorway rechecks its existing session and Admission through the private RPC protocol. No username matching, first-login ownership, whole-domain access or admin-role inference is used.

## Local implementation

`/dashboard` is a data-free HTML shell. Attendee reads use exact GET `/api/admin/registrations`, which requires the verified owner before accessing D1. The response contains Name, Email, Registered time and a bounded pagination cursor for this event only. There are no export, edit, delete or email actions. Errors, expired authentication and sign-out clear rendered attendee data. No attendee data is stored in browser storage or bundled into the page.

The CUNY adapter uses random state and S256 PKCE, a Secure/HttpOnly/SameSite=Lax host-only cookie, bounded RPC, one-use callback redemption, validated public verification keys, exact RS256 issuer/audience/subject/time checks, and a server-verified opaque actor. Exact routes are GET `/auth/start`, GET `/auth/callback`, POST `/auth/logout` and GET `/auth/session`. The callback host is fixed to this Worker. Local return destinations are limited to `/` and `/dashboard`.

The authenticated self-session endpoint returns only the signed-in person's own canonical subject and opaque actor ID, never a token, and grants no access to registrations. It can be used to verify the owner's subject after the connection is approved. Attendee and contribution access require that verified subject to match the explicitly configured owner. Missing or malformed configuration stays closed. Confirmed logout returns 204; uncertain server revocation returns an error even though browser cookies are cleared.

These settings remain absent from release preparation:

| Setting | Required value after approval |
| --- | --- |
| `CONTRIBUTIONS_CUNY_ENABLED` | Exact string `true` |
| `CAIL_IDENTITY_JWKS` | Current public verification keys from the trusted existing CUNY identity service; no private key |
| `CONTRIBUTIONS_CUNY_OWNER_SUBJECT` | Owner's verified canonical `cail-` subject; never the typed username or an email |
| `IDENTITY` | The exact service binding above |

The existing Cloudflare Access adapter is a different, dormant protocol. It is not a substitute for CUNY Login. Once CUNY mode is enabled, its authentication failures never fall back to Access. No email-code login is configured.

## Contribution safeguards

Submit requires a matching durable receipt. Uncertain saves retain the exact request and idempotency key. Pending requests bind to the verified actor; another account cannot replay them. Sign-in opens separately and does not submit automatically. Authentication failures clear loaded private review data and capabilities.

The owner may submit and read their own proposals when CUNY access is activated. Attendee-dashboard ownership does not confer review, triage or publication authority. Reviewer configuration, publishers and stewards remain empty. Contributor credits confer no permissions. A contributor cannot approve their own proposal. Old hosting identities and submission history have not been migrated or reassigned.

## Verification and remaining decisions

The local suite includes synthetic RS256 identities, isolated SQLite registration saves/reads, owner/stranger/forged-identity denial before database access, route normalization, callback state and cookie handling, key/audience/time failures, pagination, safe text rendering and expired-session clearing. Compiled local checks verify that unconfigured private endpoints remain closed. These are not hosted CUNY login or production persistence acceptance.

Activation still requires approval of the exact CUNY binding, trusted current public-key configuration and verified owner subject. No other users receive access. After approval, real callback and owner readback must be checked; production synthetic registration and proposal writes still require their separate approval. Never read actual attendee details unnecessarily or put them in fixtures, screenshots, repository history or logs.

The public map and registration release remains independent. The existing Worker/D1 are reused; AI stays disabled. No new database, migration, paid service or credential is needed by the local implementation.
