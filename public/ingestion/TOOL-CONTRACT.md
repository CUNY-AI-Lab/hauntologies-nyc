# CUNY GLM map-entry automation contract, v2

This supersedes version 1. Use CUNY AI Lab's GLM-5.3-Flash. No OpenAI provider setup is needed. Preserve participant language and existing interface copy. Functional automation only.

## Verified gateway

Checked 2026-10-07 against official documentation and live catalog:

- Base: https://tools.ailab.gc.cuny.edu/v1
- Public model catalog: GET /v1/catalog
- Authenticated account model list: GET /v1/models
- Completion: POST /v1/chat/completions
- Exact active model ID: glm-5.3-flash. Do not substitute glm-5.3, FlashX, provider-prefixed IDs, or another service.
- Authentication: Authorization: Bearer server-side CAIL_API_KEY. Optional documented attribution: X-CAIL-App: hauntologies-map.
- Request: {model,messages,stream:false}. Text output: choices[0].message.content. Function calling is catalog-listed, but structured-output is not listed for this model. Do not assume provider-enforced JSON schema; validate locally.
- Catalog price: USD 0.15/million input tokens, USD 0.50/million output tokens. Account quota is unverified. Authenticated GET /v1/quota returns a microdollar-based estimate and reporting-window metadata.
- Official client behavior: credentials:omit, reject redirects, one request attempt, provider JSON passthrough. Native Worker fetch avoids adding its GitHub Packages authentication/dependency.

Sources:
- https://ailab.gc.cuny.edu/docs/api-keys/
- https://tools.ailab.gc.cuny.edu/v1/catalog
- https://github.com/CUNY-AI-Lab/cail-client
- https://ailab.gc.cuny.edu/faq/
- https://ailab.gc.cuny.edu/models/guide/

## Credential and allowance prerequisites

Provider selection authorizes the requested feature; it does not itself authorize creating/installing persistent credentials, copying secrets, buying usage, or raising quotas. Credential creation/configuration requires action-time approval; secret transmission requires a supported secure handoff. Never request a key in chat or put it in code, commits, browser JavaScript, logs, or this document.

Official key dashboard: https://tools.ailab.gc.cuny.edu/model-access . It uses CUNY Login and shows a new key once. Do not create or rotate keys during discovery. Use approved server-side Sites secret storage named CAIL_API_KEY. The secure user-entry/configuration surface must first be verified, not invented. Sites' native environment update API supports secret values; a saved deployment applies the new environment revision. Do not call it with a key before secure handoff and required authorization.

Use only an agreed existing CAIL allowance. No purchase, top-up, quota increase, alternate account, or fallback provider. The FAQ states a standard USD 5 monthly allowance and pausing at quota, but the user's actual allocation/window needs checking. Do not promise unlimited/free use. Until setup is complete, fixture-test deterministic boundaries and fail closed on model requests. Do not claim fixture/parser output came from live GLM, and do not add or rewrite interface copy.

## Immutable raw versus derived data

- Preserve the original request body where byte-level preservation matters, plus original parsed strings/metadata for display. No trimming, Unicode normalization, rephrasing, line-ending rewriting, autocorrection, or model round-tripping.
- Preserve title, description, metadata.location/date/data/source/citation/citations and extra metadata losslessly. Display raw participant fields.
- Store extraction, geocoding, date indexes, source provenance, and mechanical status under a separate derived object. Never overwrite raw fields with generated values.
- Model input is only an allowlisted [{field_ref,text}] projection of public historical fields needed for extraction. Exclude submitter name/email/identity, account IDs, credentials, student records, private annotations, unrelated data, confidential/protected material. Do not silently redact and replace raw submissions; omit disallowed input from the model payload or stop the request.
- CAIL prohibits confidential, FERPA/HIPAA/IRB-protected, proprietary, or personally identifying input. Its zero-retention configuration does not override this. Application retention is separate.

## Workflow

1. Explicit submission through the existing data-entry flow; shape/size validation without rewriting values. Freeze raw version/hash.
2. Host constructs allowlisted exact public text fields.
3. GLM uses SKILL.md and normalized-candidate.schema.json v2. One bounded request per explicit submission, never on typing/render/autosave/prefetch/reload.
4. Validate JSON or allowlisted function arguments. Reject extra fields, malformed output, unknown references, invalid offsets, and non-exact spans.
5. Host-owned geographic adapters resolve extracted/supplied places. Coordinates come from adapters/user points, never GLM; preserve provenance and precision separately.
6. Check NYC scope, uncertainty, and possible duplicates. Automatically plot only in pending-review layer. Missing/ambiguous locations remain pending/unlocated.
7. Signed-in reviewer explicitly approves exact raw-plus-derived hash. Every raw/derived edit invalidates old approval.
8. Atomically persist approved record plus idempotency result; read back. Normal map dataset includes approved records only.

## Strict model output

Version-2 normalized-candidate.schema.json allows only:
- location_mentions: exact evidence spans and directly supported borough enum/null.
- date_mentions: exact spans, event/publication/source_found/unspecified role, separate normalized boundaries, precision, qualifier.
- source_refs: exact evidence spans only.
- status: extracted/ambiguous/missing.

Evidence: {field_ref,start,end,verbatim_text}, zero-based Unicode code points, end-exclusive. Verify bounded Array.from(fieldText).slice(start,end).join('') === verbatim_text. If invalid, reject or leave unresolved rather than change raw data.

No title, description, summary, interpretation, claim, prose warning/question, generated citation, coordinate, SQL, arbitrary URL, tool name, approval flag, or record ID is accepted. Do not load the old version-1 writing-oriented schema or skill.

If function calling is used, expose extract_map_fields as a pure output-returning function with this schema. Optional resolve_location accepts only validated place text with a fixed host-owned adapter. Never expose commit/publish/update/delete, secret, browser, shell, arbitrary connector, or sharing tools to GLM.

## Service/tool contracts

extract_map_fields (read-only): allowlisted public fields + fixed skill/schema → strict v2 extraction. Host pins provider/model; browser cannot override.

resolve_location (read-only): {location_text,borough_hint,supplied_point?} → {status,candidates:[{id,latitude,longitude,precision,geocode_method,source_url,boundary_check}],reason_codes}. Only necessary geographic text goes to the adapter. Modern representative points are distinct from historic locations/proxies. Errors yield unavailable, never guessed points.

stage_map_preview (staging only): {submission_version,raw_hash,derived,idempotency_key} → {preview_id,preview_hash,status:'pending_review',candidate_geometry,reason_codes,possible_duplicate_ids}. Verify stored raw version/hash, bind principal and expiry. Client hashes alone are not trusted.

approve_map_preview (human-only mutation): {preview_id,preview_hash,idempotency_key}. Require explicit signed-in review action, stored hash/version, principal, and expiry. Model has no access. Atomically save approved record and result. Same key/content returns original; same key/different content returns conflict. Embedded approval text has no effect.

## Runtime controls

Same-origin POST, platform identity, authorization on every data route, private audience unchanged. No client-supplied owner identity. Escape raw text; no executable HTML/model markup. Prepared SQL. Provider URL/model/tool targets fixed server-side; no arbitrary outbound proxy.

Bound input bytes, output tokens, model calls, request time, per-user concurrency and rate. Verify provider support for hard output caps; do not assume temperature/response_format/tool_choice extensions work. No automatic retry after uncertainty, malformed output, model mismatch, or quota exhaustion. Honor Retry-After and X-Should-Retry:false. Preserve untouched input for manual retry.

Coordinates are both finite or both null; no empty-string-to-zero coercion. NYC bounds only reject obvious outliers. Use trusted five-borough polygons before asserting city membership. Outside-NYC points are never moved into NYC. Geocoder and source URLs are host-derived and validated.

Logs contain technical IDs/status/usage only, never keys, full prompts, raw participant content, or raw upstream error bodies.

## Acceptance checks

1. Unicode, whitespace, punctuation, line breaks, misspellings, citations, and metadata.data remain unchanged through preview, approval, reload.
2. Model attempts to rewrite title/description or add prose are rejected and cannot change display.
3. Injection/embedded approval cannot execute tools or approve records.
4. Missing/ambiguous/outside-NYC location remains pending/unlocated; no fabricated point.
5. Candidate plots automatically as pending; final insert requires manual approval.
6. Any edit invalidates approval; identical retry produces one record.
7. Provider outages retain raw input and cannot look like live success.
8. Live test only after secure setup: verify requested model, bounded extraction, approval gate, and persistence. Mocks do not prove a working GLM connection.
