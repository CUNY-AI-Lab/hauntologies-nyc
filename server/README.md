# Model-assisted ingestion

This page describes a backend that would let a language model help turn a participant's submitted text into map entries. It comes last in the guide path because the feature is switched off; nothing on the live site depends on it.

## What it would do

The backend would send a participant's submitted text to the CUNY AI Lab gateway using the exact model `glm-5.3-flash`. An extraction takes three gateway requests: one for the model list, one for quota and one for the completion. The model may return only validated source spans and constrained derived fields, so the original JSON string and parsed participant fields stay immutable. Coordinates come from exact matches in `server/gazetteer.json`, marked source-verified, or from a point supplied by the participant, which is always marked not source-verified. Other place names stay unlocated for review; there is no guessed or ambient geocoding. A resolved preview enters a separate pending-review layer, and the participant must confirm it before it becomes a record.

## Why it is off

No model request is possible until the server credential, enable gate, allowance-mode gate, per-user daily request cap, per-request reserve, site budget and budget window are all present. The `.env.example` file ships with `CAIL_ENABLED=false`, the prepared Worker pins the setting to `'false'`, and `server/runtime.ts` passes `'false'` to the backend whatever the environment says. The public Worker's gate does not route `/api/ingest`, so those paths remain closed. There is no fallback provider and model calls are never retried automatically.

The application never creates keys, buys credits, raises a quota, changes sharing or publishes a participant's entry on its own.

## Settings

| Setting | Meaning |
|---|---|
| `CAIL_API_KEY` | The gateway key, kept as a Worker secret and never placed in client code. |
| `CAIL_ENABLED` | Set to `true` only after setup and account checks pass. |
| `CAIL_ALLOWANCE_MODE` | `existing_only`, which makes no purchase or quota increase. |
| `CAIL_MAX_REQUESTS_PER_DAY` | A cap on requests for each user in each UTC day, from 1 to 1,000. |
| `CAIL_REQUEST_BUDGET_MICRODOLLARS` | The allowance one request reserves, from 10,000 to 1,000,000 microdollars. |
| `CAIL_SITE_BUDGET_MICRODOLLARS` | A whole-application reservation ceiling, at least the per-request reserve and at most 100,000,000 microdollars. |
| `CAIL_BUDGET_WINDOW` | A 4–64 character label for the budget window; it never resets on its own. |

The reservation ceiling in D1 is global across users and held conservatively for the whole window. Gateway allowance is an estimate, not a payment authorization. Existing-only mode never buys anything or raises a quota. Processing that becomes indeterminate turns into a terminal status after five minutes and is never retried silently.

## Access

The `/api/ingest` endpoints expect the authenticated-user header set by the contribution gate. Mutations require a same-origin `Origin` header and JSON body, and reads and writes of previews and records are scoped to that user. The budget check adds reservations across all users. Collecting submissions from participants more broadly would need an explicit sharing and reviewer-role design, which this backend does not provide.

## Next

The [tool contract](../public/ingestion/TOOL-CONTRACT.md) sets out gateway details, data rules and acceptance checks, and the [extraction skill](../public/ingestion/SKILL.md) holds the instructions the model itself receives.
