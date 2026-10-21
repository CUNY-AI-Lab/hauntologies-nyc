# Contribution access

The public map and event registration remain available. `/api/contributions/*` remains closed until an explicitly approved Cloudflare Access application is configured. This PR does not create an Access application, identity provider, policy, credential, reviewer grant, or database migration.

## Required activation decision

Approve one self-hosted Access application for `hauntologies-nyc.ailab-452.workers.dev/api/contributions/*`, with an Allow policy for one owner-selected email identity and a one-hour session. The bare `/api/contributions` route stays denied by the Worker. The map, static assets and `/api/register` remain outside this application. Do not use an entire email domain, Everyone, a bypass policy or a service token.

An account inventory on October 21, 2026 returned no Access applications and no identity providers. The team-domain lookup was denied; it was not retried. The owner must confirm the team domain and login method. If email one-time PIN is chosen, enabling that provider is a separate security configuration decision; no provider has been added here.

After approval, configure only these Worker variables using the actual application values:

| Variable | Meaning |
| --- | --- |
| `CONTRIBUTIONS_ACCESS_ENABLED` | Exact string `true`; absent or any other value keeps the API closed |
| `ACCESS_TEAM_DOMAIN` | Exact `https://TEAM.cloudflareaccess.com` issuer, without a trailing slash |
| `ACCESS_AUDIENCE` | This Access application's 64-character AUD tag, not an account or Worker ID |
| `ACCESS_ALLOWED_EMAILS` | The same explicitly approved owner email; commas allow future individually approved identities |

These settings contain no API token or client secret. Incomplete or invalid configuration fails closed. The verifier checks RS256 signature, fixed issuer/JWKS, audience, expiry, not-before, issued-at, application type, user subject and the explicit email allowlist. It replaces untrusted identity headers only after verification. API responses are not cached. Static Assets does not provide `ctx.access`, so the Worker verifies the assertion JWT directly.

## Verification after approval

The owner must first open a protected contribution URL in a browser and complete the approved login. Return to the map and retry the editor or review panel. Confirm a clearly labeled synthetic proposal receives a persisted receipt, appears in that owner's queue, and replays without duplication. Confirm an unauthenticated browser and a different, unapproved identity cannot read it. Do not call local fixture results production acceptance.

The initial owner can submit, read, revise and withhold their own proposals. Runtime reviewer and publisher lists remain empty. Admission through Access does not grant review or publishing rights; independent human reviewers need a separate, explicit server-role decision. A contributor cannot approve their own proposal. Metadata updates remain proposals even after review and cannot automatically overwrite the catalog.

Actors use an opaque hash of the verified issuer and subject. Old hosting IDs and submission history have not been migrated or remapped. Changing teams or removing and re-adding an Access user can create a different subject; resolve ownership deliberately, never by matching an unverified email or silently rewriting history.

If activation fails, leave `CONTRIBUTIONS_ACCESS_ENABLED` absent or false. The public map and registration continue working, and the private APIs remain closed. No production registration test or attendee data is part of this PR.

## References

- [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
