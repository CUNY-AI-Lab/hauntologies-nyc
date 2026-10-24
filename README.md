# Hauntologies NYC

Source for the NYC Leaflet map and event registration, using Vinext (Vite with a Next.js-compatible app router), React, and Cloudflare Workers/D1. The map client is plain JavaScript with bundled Leaflet and MarkerCluster.

Use Node.js 22.13 or newer. Install with `npm run install:ci` and run locally with `npm run dev`.

To try contributing and reviewing on your own machine, run `npm run local` and open http://127.0.0.1:8790. Sign in from the map's Sign in button with a testing account; the password for both is `haunted-local-only`:

- `contributor@local.test` submits places and sees their own work.
- `reviewer@local.test` can also review and publish.

The local server runs the real contribution service on SQLite in `.local/` (gitignored); `npm run local -- --fresh` starts over. Registration, password resets and image uploads need production services and are off locally.

Build and prepare the existing Worker release:

```sh
npm run build && node scripts/prepare-account-release.mjs
```

Preparation checks the existing Worker, account and D1 identifiers, projects the public catalog, and writes `dist/server/wrangler.live.json`. It performs no deployment or database migration. Run `node --test tests/*.test.mjs` after preparation.

Deploy that prepared release only when deployment is authorized:

```sh
npx wrangler deploy --config dist/server/wrangler.live.json
```

The public map is already approved and live at https://hauntologies-nyc.ailab-452.workers.dev, with standalone event registration at `/register`. Release preparation preserves its public `workers.dev` route and keeps preview URLs disabled. Map accounts use verified email and a password chosen after verification. Signed-in contributors can save and read their own proposals and private images. Review, publishing and attendee-dashboard permissions require separate explicit grants. Account implementation and release steps are documented in [Contribution access](docs/contribution-access.md).

The existing D1 binding is `DB`. Schema migrations contain no participant rows. Registration tests use synthetic local SQLite fixtures; no attendee or submission data is included. Do not use production data in repository issues, tests, or fixtures.

The metadata editor supports field corrections and up to ten new references per proposal, with a required change message and immutable revision history. Review uses exact proposed values and requires independent authorization; changes do not automatically overwrite map records.

AI is disabled. The deployment gate derives contribution identity from a verified map session and removes client-supplied identity headers. Event registration stays independent of account registration. The exact account endpoints are allowlisted; obsolete identity integrations and administrative routes remain blocked.

Private source archives, provenance evidence, local runtime profiles, credentials, build output, and original Git history are excluded. Public record citations, uncertainty, IDs, and geometry remain in the map source. The task seed file retains 23 current proposed opportunities with private reconciliation metadata removed. Tests dependent on private archives remain in the original workspace; public-category and behavioral tests are retained here.

Connecting a repository to Workers Builds requires the existing Cloudflare GitHub App to have access to that exact repository. Do not grant access, create API tokens, enable AI, or broaden access as an automatic build step. The repository connection is not established by this source export.
