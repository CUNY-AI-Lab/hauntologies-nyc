# Hauntologies NYC

Source for the NYC Leaflet map and event registration, using Vinext (Vite with a Next.js-compatible app router), React, and Cloudflare Workers/D1. The map client is plain JavaScript with bundled Leaflet and MarkerCluster.

Use Node.js 22.13 or newer. Install with `npm run install:ci` and run locally with `npm run dev`.

Build and prepare the existing Worker release:

```sh
npm run build && node scripts/prepare-worker-release.mjs
```

Preparation checks the existing Worker, account and D1 identifiers, projects the public catalog, and writes `dist/server/wrangler.live.json`. It performs no deployment or database migration. Run `node --test tests/*.test.mjs` after preparation.

Deploy that prepared release only when deployment is authorized:

```sh
npx wrangler deploy --config dist/server/wrangler.live.json
```

The public map is already approved and live at https://hauntologies-nyc.ailab-452.workers.dev. Release preparation preserves its public `workers.dev` route and keeps preview URLs disabled. Private contribution and review APIs remain blocked by the Worker gate.

The existing D1 binding is `DB`. Schema migrations contain no participant rows. Registration tests use synthetic local SQLite fixtures; no attendee or submission data is included. Do not use production data in repository issues, tests, or fixtures.

AI is disabled. Contribution and review endpoints retain their authentication boundary. The deployment gate exposes only the intended event-registration write path and blocks the other APIs; existing hosting identity headers are not trusted by the public Worker.

Private source archives, provenance evidence, local runtime profiles, credentials, build output, and original Git history are excluded. Public record citations, uncertainty, IDs, and geometry remain in the map source. The task seed file retains 23 current proposed opportunities with private reconciliation metadata removed. Tests dependent on private archives remain in the original workspace; public-category and behavioral tests are retained here.

Connecting a repository to Workers Builds requires the existing Cloudflare GitHub App to have access to that exact repository. Do not grant access, create API tokens, enable AI, or broaden access as an automatic build step. The repository connection is not established by this source export.
