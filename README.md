# Hauntologies NYC

Source for the NYC Leaflet map and event registration, using Vinext (Vite with a Next.js-compatible app router), React, and Cloudflare Workers/D1. The map client is plain JavaScript with bundled Leaflet and MarkerCluster.

Use Node.js 22.13 or newer. Install with `npm run install:ci`, run locally with `npm run dev`, and build with `npm run build`. `node scripts/prepare-public-catalog.mjs` creates the checked public catalog projection; `node scripts/prepare-worker-demo.mjs` prepares the existing `hauntologies-nyc` Worker configuration. After those build/preparation steps, run `node --test tests/*.test.mjs`. These preparation commands do not deploy or migrate a database. The prepared deployment configuration leaves external Worker and preview routes disabled until an explicit sharing decision.

The existing D1 binding is `DB`. Schema migrations contain no participant rows. Registration tests use synthetic local SQLite fixtures; no attendee or submission data is included. Do not use production data in repository issues, tests, or fixtures.

AI is disabled. Contribution and review endpoints retain their authentication boundary. The deployment gate exposes only the intended event-registration write path and blocks the other APIs; existing hosting identity headers are not trusted by the public Worker.

Private source archives, provenance evidence, local runtime profiles, credentials, build output, and original Git history are excluded. Public record citations, uncertainty, IDs, and geometry remain in the map source. The task seed file retains 23 current proposed opportunities with private reconciliation metadata removed. Tests dependent on private archives remain in the original workspace; public-category and behavioral tests are retained here.

Connecting a repository to Workers Builds requires the existing Cloudflare GitHub App to have access to that exact repository. Do not grant access, create API tokens, enable AI, or change public routes as an automatic build step. The repository connection is not established by this source export.
