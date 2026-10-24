# Map-entry automation contract, version 2

This contract governs how a model would help turn submitted text into map entries, and it is the second of three pages about the ingestion backend that is switched off for now. [Model-assisted ingestion](../../server/README.md) explains the backend and why it is off, this page lays out the rules a model call must follow, and [SKILL.md](SKILL.md) is the instruction file the model itself reads. Version 2 supersedes version 1, uses CUNY AI Lab's GLM-5.3-Flash with no OpenAI provider setup, preserves participant language and existing interface copy, and covers functional automation only.

## Where the code stands

The code in `server/` follows most of this contract and departs from it in a few places that matter to anyone building against it. The four service contracts below name functions that the code does not use, and its real surface is `/api/ingest/preview`, `/api/ingest/confirm`, `/api/ingest/status`, `/api/review` and `/api/records`, where preview takes `submission_json`, an idempotency key and `public_material_confirmed` and builds the derived data on the server, and confirm takes only `preview_id`, `preview_hash` and `acknowledge_unlocated`.

The person who confirms is the signed-in owner of the submission, so no independent reviewer sees a record before it is approved, where the workflow below calls for a signed-in reviewer, and the public gate blocks every ingest route today, so none of this flow runs on the live site. Nothing reads `Retry-After` or `X-Should-Retry`, nothing bounds per-user concurrency beyond the daily request cap, the provider treats a 402 or 429 response as a quota or rate-limit error and never retries, and each extraction makes three gateway requests, one for the model list, one for the quota and one for the completion, which is sent with a temperature of 0 and a limit of 1,200 output tokens.

## The gateway

The details in this section were checked on October 7, 2026 against the Lab's official documentation and live catalog.

- The base address is https://tools.ailab.gc.cuny.edu/v1.
- The public model catalog is at `GET /v1/catalog`, and an authenticated account lists its models at `GET /v1/models`.
- A completion goes to `POST /v1/chat/completions`.
- The exact active model ID is `glm-5.3-flash`, and nothing should stand in for it, including `glm-5.3`, FlashX, provider-prefixed IDs or another service.
- Authentication uses `Authorization: Bearer` with the server-side `CAIL_API_KEY`, and the documented optional attribution header is `X-CAIL-App: hauntologies-map`.
- A request is `{model, messages, stream: false}`, and the text comes back in `choices[0].message.content`. The catalog lists function calling but not structured output for this model, so do not assume the provider enforces a JSON schema, and validate locally.
- The catalog price is USD 0.15 per million input tokens and USD 0.50 per million output tokens. The account's quota is unverified, and an authenticated `GET /v1/quota` gives a microdollar-based estimate with reporting-window metadata.
- The official client sets `credentials` to `omit`, rejects redirects, makes one request attempt and passes the provider's JSON through, and a native Worker fetch avoids adding the client's GitHub Packages authentication and dependency.

These pages document the gateway.

- https://ailab.gc.cuny.edu/docs/api-keys/
- https://tools.ailab.gc.cuny.edu/v1/catalog
- https://github.com/CUNY-AI-Lab/cail-client
- https://ailab.gc.cuny.edu/faq/
- https://ailab.gc.cuny.edu/models/guide/

## Credentials and allowance

Choosing this provider settles which service to use but does not by itself allow anyone to create or install a persistent credential, copy a secret, buy usage or raise a quota, and each of those needs a go-ahead at the moment it happens. Hand a secret over only through a secure channel the platform supports, and never ask for a key in chat or put one in code, a commit, browser JavaScript, a log or this document.

The official key dashboard at https://tools.ailab.gc.cuny.edu/model-access requires CUNY Login and shows a new key only once, so do not create or rotate keys while exploring, and store the key as a Worker secret named `CAIL_API_KEY` only when the handoff is secure and the Lab has agreed.

Use only an existing CAIL allowance that has been agreed in advance, with no purchase, top-up, quota increase, alternate account or fallback provider. The Lab's FAQ describes a standard allowance of USD 5 a month that pauses when the quota runs out, but the real allocation and window for an account need checking, so do not promise unlimited or free use. Until setup is complete, test the deterministic boundaries with fixtures and have model requests fail closed, never describe fixture or parser output as coming from a live GLM call, and leave interface copy alone.

## Raw data and derived data

- Keep the original request body byte for byte wherever that matters, together with the original parsed strings and metadata used for display, and never trim, normalize Unicode, rephrase, rewrite line endings, autocorrect or pass the text back through a model.
- Keep the title, the description, `metadata.location`, `metadata.date`, `metadata.data`, `metadata.source`, `metadata.citation`, `metadata.citations` and any extra metadata without loss, and display the participant's raw fields.
- Store extraction, geocoding, date indexes, source provenance and mechanical status in a separate derived object, and never overwrite a raw field with a generated value.
- Send the model only an allowlisted list of `{field_ref, text}` pairs drawn from the public historical fields that extraction needs, leaving out the submitter's name, email and identity, account IDs, credentials, student records, private annotations, unrelated data and any confidential or protected material. If a submission contains something that must not go to the model, omit that input from the payload or stop the request, and never redact it silently and replace the raw submission.
- CAIL prohibits confidential, FERPA-, HIPAA- or IRB-protected, proprietary and personally identifying input, and its zero-retention configuration does not change that, while the application's own retention is a separate matter.

## Workflow

These steps describe the intended flow, and none of them runs on the live site while the public gate blocks the ingest routes.

1. A participant submits through the existing data-entry flow, the application checks shape and size without rewriting any value, and it freezes the raw version and hash.
2. The host builds the allowlisted list of exact public text fields.
3. GLM follows `SKILL.md` and `normalized-candidate.schema.json` version 2, and it makes one bounded request for each explicit submission, never on typing, rendering, autosave, prefetch or reload.
4. The host validates the JSON or the allowlisted function arguments and rejects extra fields, malformed output, unknown references, invalid offsets and spans that do not match exactly.
5. Geographic adapters that the host owns resolve the extracted or provided places, with coordinates coming from those adapters or from a user's point and never from GLM, and with provenance and precision kept separately.
6. The host checks NYC scope, uncertainty and possible duplicates, plots a candidate automatically only in the pending-review layer, and marks a missing or ambiguous location as needing information and leaves it unlocated.
7. A signed-in reviewer explicitly approves the exact raw-plus-derived hash, and every edit to a raw or derived field invalidates the earlier approval.
8. The application atomically saves the approved record together with its idempotency result and reads them back, and the normal map dataset includes approved records only.

## What the model may return

Version 2 of `normalized-candidate.schema.json` allows only a `schema_version` of `2.0` and these four things.

- `location_mentions` holds exact evidence spans and a borough that the text directly supports, or null.
- `date_mentions` holds exact spans with a role of event, publication, source found or unspecified, separate normalized boundaries, a precision and a qualifier.
- `source_refs` holds exact evidence spans and nothing else.
- `status` is `extracted`, `ambiguous` or `missing`.

Each piece of evidence has the form `{field_ref, start, end, verbatim_text}`, with zero-based Unicode code points and an exclusive end, and the host checks that `Array.from(fieldText).slice(start, end).join('')` equals `verbatim_text`, so an invalid span is rejected or left unresolved and never fixed by changing raw data.

The output cannot contain a title, description, summary, interpretation, claim, prose warning or question, generated citation, coordinate, SQL, arbitrary URL, tool name, approval flag or record ID, and the old version 1 writing-oriented schema and skill must not be loaded.

If function calling is used, expose `extract_map_fields` as a pure function that only returns output in this schema, and expose `resolve_location` only as an optional function that accepts validated place text and uses a fixed adapter the host owns, and never expose commit, publish, update, delete, secret, browser, shell, arbitrary connector or sharing tools to GLM.

## Service and tool contracts

These four contracts describe the intended service boundaries, and the routes listed under Where the code stands are how the current code reaches them.

`extract_map_fields` is read-only and takes the allowlisted public fields plus the fixed skill and schema to give a strict version 2 extraction, with the host pinning the provider and model so that the browser cannot override them.

`resolve_location` is read-only and takes `{location_text, borough_hint, supplied_point?}` to give `{status, candidates: [{id, latitude, longitude, precision, geocode_method, source_url, boundary_check}], reason_codes}`, so only the geographic text the lookup needs goes to the adapter, a modern representative point stays distinct from a historic location or proxy, and an error yields unavailable and never a guessed point.

`stage_map_preview` works in staging only and takes `{submission_version, raw_hash, derived, idempotency_key}` to give `{preview_id, preview_hash, status: 'pending_review', candidate_geometry, reason_codes, possible_duplicate_ids}`, verifying the stored raw version and hash and binding a principal and an expiry without trusting client hashes alone.

`approve_map_preview` is a human-only mutation that the model cannot reach. It takes `{preview_id, preview_hash, idempotency_key}`, requires an explicit signed-in review action, the stored hash and version, a principal and an expiry, and atomically saves the approved record and the result, so the same key and content give back the original result, the same key with different content conflicts, and embedded approval text has no effect.

## Runtime controls

- Every data route requires platform identity and authorization, every mutation also requires a same-origin POST, the audience stays private, and the client never provides the owner's identity.
- Raw text is escaped so that no executable HTML or model markup reaches the page, SQL is prepared, and the provider URL, model and tool targets are fixed on the server with no arbitrary outbound proxy.
- Bound input bytes, output tokens, model calls, request time, per-user concurrency and rate, and verify that the provider supports hard output caps, since nobody should assume that the `temperature`, `response_format` or `tool_choice` extensions work.
- Nothing retries automatically after an uncertain result, malformed output, a model mismatch or quota exhaustion, the gateway's `Retry-After` and `X-Should-Retry: false` headers must be honored, and the untouched input stays available for a manual retry.
- Latitude and longitude are finite numbers together or null together, and an empty string is never coerced to zero.
- Use trusted five-borough polygons to decide whether a point belongs to the city, treat a bounding box only as a check for obvious outliers, and never move a point outside NYC inside it.
- The geocoder and source URLs are derived by the host and validated, except that a point the participant provides keeps the participant's own coordinate source URL after the same URL filter.
- Keep logs to technical IDs, status and usage, and never write keys, full prompts, raw participant content or raw upstream error bodies into them.

## Acceptance checks

1. Unicode, whitespace, punctuation, line breaks, misspellings, citations and `metadata.data` stay unchanged through preview, approval and reload.
2. A model attempt to rewrite a title or description, or to add prose, is rejected and cannot change what is displayed.
3. Injected text or embedded claims of approval cannot run tools or approve records.
4. A missing or ambiguous location stays unlocated and needs information, an outside-NYC location is marked outside scope and cannot be confirmed, and no point is fabricated.
5. A candidate plots automatically as pending, and the final insert requires manual approval.
6. Any edit invalidates approval, and an identical retry produces one record.
7. A provider outage keeps the raw input and cannot look like a live success.
8. The live test runs only after secure setup and verifies the requested model, bounded extraction, the approval gate and persistence, since mocks do not prove a working GLM connection.

## Next

[SKILL.md](SKILL.md) is the last page on this path, and it is the file the model reads and the file the server loads as its extraction prompt, so its wording changes only together with the schema and with `tests/ingestion.test.mjs`, which reads it too.
