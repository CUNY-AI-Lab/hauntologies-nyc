# Hauntologies of New York

A Halloween hackathon at the CUNY Graduate Center on Friday, October 30, 3–6:30 p.m., in Room 5307. Drop in anytime.

"The future is always experienced as a haunting," writes critical theorist Mark Fisher in his 2012 essay *What is Hauntology?*, "as a virtuality that already impinges on the present, conditioning expectations and motivating cultural production."

To welcome All Hallows' Eve, please join the GC's M.A. Program in Digital Humanities and M.S. Program in Data Analysis and Visualization for Hauntologies of New York. Together, we'll develop a collaborative map of reported hauntings, spectral places and archival silences using public datasets and digitized collections. No coding experience is required.

[Register here](https://hauntologies-nyc.ailab-452.workers.dev/register). Bring your own laptop if you can, and come in costume if you'd like. Pizza, drinks and Halloween candy will be aplenty.

## Before you come

Registration asks for your name and email address and shows a receipt on the screen; it does not create a map account or send a confirmation email. CUNY addresses are accepted as they are, while guests from outside CUNY need an access code from the organizers. [Contribution access](docs/contribution-access.md) explains the two sign-ups and the steps for contributing.

## The map

The public map is live at https://hauntologies-nyc.ailab-452.workers.dev. Anyone can search places and addresses, filter by borough, place type, period and location certainty, and view aerial imagery from 1924 forward. Signing in lets you propose a place with sources and photographs, add a note to an existing place or propose a correction. Every proposal goes through review; an approved proposal reaches the public map only after the separate publication and verification steps.

The public map is already approved and live, with standalone event registration at `/register`. Map accounts use verified email and a password chosen after verification. Signed-in contributors can save and read their own proposals and private images. Open review lets verified map accounts review and publish others' submitted work, subject to the configured roles and independent-review rules. Contributors choose whether their name appears with each contribution, under review and once published. Attendee-dashboard access remains blocked.

## Where to go from here

This repository holds the source for the map, the registration page and the guides that explain how they work. Read down this path until you reach the guide for your part:

1. [Contribution access](docs/contribution-access.md) explains event registration, map accounts, the contribution form, review and publication.
2. [Private images](docs/private-images.md) describes image limits, upload behavior and access after submission.
3. [Area proposals and record annotations](server/EMBEDDED-CONTRIBUTIONS.md) lists the fields for the two contribution types the visible form does not offer.
4. [Running the site](docs/running-the-site.md) is for maintainers and covers local setup, settings, sign-in, email, releases and rollback.
5. [Model-assisted ingestion](server/README.md) describes the disabled backend; its [tool contract](public/ingestion/TOOL-CONTRACT.md) and [extraction skill](public/ingestion/SKILL.md) set out its boundaries if it is ever enabled.

## Run it locally

You need Node.js 22.13 or newer. Install dependencies and start the development server with:

```sh
npm run install:ci
npm run dev
```

To try contributing and reviewing on your own machine, run `npm run local` and open http://127.0.0.1:8790. The two synthetic accounts use the password `haunted-local-only`:

- `contributor@local.test` submits places and reviews the other account's work.
- `reviewer@local.test` can also review and publish.

The local server runs the real contribution service on SQLite in `.local/` (gitignored). `npm run local -- --fresh` starts over. Registration, password resets and image uploads need production services and are off locally.

Build and prepare the existing Worker release with:

```sh
npm run build && node scripts/prepare-account-release.mjs
```

Preparation checks the existing Worker, account and D1 identifiers, projects the public catalog and writes `dist/server/wrangler.live.json`; it performs no deployment or database migration. Run the test suite after preparation.

Production release is currently blocked: this repository has no configured CI deployment path. A future approved CI path must build and prepare the release, deploy the prepared configuration, and read back the serving version, `/api/access-status` (`enabled` with `account_mode: map`), signed-out protection, delivered assets and table counts. Separately, an authorized human must perform the verification/reset mailbox round trip and record rollout acceptance; CI must not receive mailbox credentials. Granting deployment access is a separate decision. Existing manual deployment notes are historical; do not run a local `wrangler deploy` from this repository.

The existing D1 binding is `DB`. Do not put participant data, credentials or private source archives in this repository. AI is disabled, and connecting Workers Builds or granting provider access is a separate decision.

## Questions

Write to Zach Muhlbauer at zmuhlbauer@gc.cuny.edu with questions about the event or to ask for a guest access code. Problems with the site itself can be opened as issues in this repository; keep attendee names, email addresses and submission details out of them.
