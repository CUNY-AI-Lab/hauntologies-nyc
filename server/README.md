# Model-assisted ingestion

This page describes a backend that would let a language model help turn a participant's submitted text into map entries, and it comes last on the path through these guides because the feature is switched off, so it is written for anyone who wants to know what would have to be true before the backend ran, since nothing on the live site depends on it.

## What it would do

The backend would send a participant's submitted text to the CUNY AI Lab gateway, using the model `glm-5.3-flash`, and ask the model to point at the places, dates and sources that the text already mentions, which takes three gateway requests for each extraction, one for the model list, one for the quota and one for the completion. The model may return only validated source spans and a small set of constrained derived fields, so the original JSON string and the parsed participant fields stay immutable. Coordinates come from exact matches in the gazetteer in `server/gazetteer.json`, which the preview marks as source-verified, or from a point the participant provides, which the preview always marks as not source-verified, and any other place name stays unlocated for review, with no guessed or ambient geocoding. A resolved preview then enters a separate pending-review layer, and the signed-in participant who submitted it has to confirm it explicitly before it becomes a record, so no independent reviewer is involved.

## Why it is off

No model request is possible until the server credential, the enable gate, the allowance-mode gate, a per-user daily request cap, a per-request reserve, a site budget and a budget window are all present, which is why the `.env.example` file ships with `CAIL_ENABLED=false`, and the backend has no fallback provider and never retries a model call automatically. Three locks hold it shut today, since the prepared Worker configuration pins `CAIL_ENABLED` to `'false'`, the Worker runtime in `server/runtime.ts` passes it to the backend as `'false'` whatever the environment says, and the public Worker's gate does not route `/api/ingest` at all, so a request to those paths receives a sign-in-required refusal.

The application never creates keys, buys credits, raises a quota, changes sharing or publishes a participant's entry on its own.

## Settings

| Setting | Meaning |
|---|---|
| `CAIL_API_KEY` | The gateway key, kept as a Worker secret and never placed in client code. |
| `CAIL_ENABLED` | Set to `true` only after the setup and account checks pass. |
| `CAIL_ALLOWANCE_MODE` | Set to `existing_only`, which makes no purchase and no quota increase. |
| `CAIL_MAX_REQUESTS_PER_DAY` | A cap on requests for each user in each UTC day, an integer from 1 to 1,000. |
| `CAIL_REQUEST_BUDGET_MICRODOLLARS` | The allowance one request reserves, from 10,000 to 1,000,000 microdollars, which should cover the provider's worst-case estimate for a request including system and schema tokens, although the code checks only the range. |
| `CAIL_SITE_BUDGET_MICRODOLLARS` | A ceiling on the allowance the whole application may reserve, at least the per-request reserve and at most 100,000,000 microdollars. |
| `CAIL_BUDGET_WINDOW` | A label of 4 to 64 letters, digits, hyphens or underscores for the window the site budget applies to, which never resets on its own. |

The reservation ceiling in D1 is global across all users and is held conservatively for the whole window, and gateway allowance is an estimate and not a payment authorization. Existing-only mode never buys anything or raises a quota, and processing that becomes indeterminate turns into a terminal status after five minutes and is never retried silently.

## Access

The `/api/ingest` endpoints expect the authenticated-user header that the contribution gate sets, mutations require a same-origin `Origin` header and a JSON body, and reads and writes of previews and records are scoped to that user, while the budget check adds up reservations across all users. Collecting submissions from participants more broadly would need a sharing design and reviewer roles of its own, which this backend does not provide.

## Next

The [tool contract](../public/ingestion/TOOL-CONTRACT.md) sets out the gateway details, the data rules and the acceptance checks for this backend, and the [extraction skill](../public/ingestion/SKILL.md) holds the instructions the model itself receives.
