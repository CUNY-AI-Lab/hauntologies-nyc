# Embedded contribution contracts

These additions use the existing `/api/contributions/preview`, `/submit`, `/revise` and readback endpoints and existing D1 tables. They do not change authentication, grant reviewer/publisher permissions, enable AI, or change the canonical point-oriented Entries schema. New points continue to use `entry_bundle`.

Both `area_proposal` and `record_annotation` are review-only. Valid submissions enter `submitted`; deterministic errors enter `changes_requested`. Independent review still requires all editorial/privacy checks and cannot be performed by the contributor. Even an independently approved proposal cannot be applied by the existing data operator. No polygon or annotation is automatically written into map records.

## Shared fields

Use the existing schema-version `1.0` envelope: `type`, `task_ids`, `title`, `summary`, `public_credit`, `sources`, `attachments`, `targets`, `payload`. The server owns actor identities, revisions, review states, hashes, timestamps and receipts. Public credit requires explicit consent.

For these two types, `sources` contains 1–20 citation objects. Required string fields are `citation`, `locator`, `accessed_on`, `rights_status`, `rights_statement`, `public_use`. `accessed_on` is the actual consultation date in `YYYY-MM-DD`. `url` is null/empty or an HTTP(S) URL without credentials. Optional string/null fields are `source_type`, `source_ref`, `entry_id`, `repository`, `source_date_original`, `evidence_note`. Rights/public-use enums retain the existing canonical values; unknown/restricted rights do not permit excerpts or media. A citation without a known URL is valid. No attachment upload is added.

A dates object contains exactly `time_original`, `time_precision`, `time_start_year`, `time_end_year`, `time_basis`. Precision is `unknown`, `year`, `range` or `circa`. Unknown bounds remain null; known bounds are ordered integer years, and `year` repeats the same year in both fields. A proposal date does not overwrite a source publication date or the original record.

## Area proposal

`targets` is empty. Payload fields:

```json
{
  "category": "reported_haunting",
  "description": "An attributed claim, with source limits.",
  "place_original": "Original source wording for the area",
  "borough": "Manhattan",
  "dates": {
    "time_original": "unknown",
    "time_precision": "unknown",
    "time_start_year": null,
    "time_end_year": null,
    "time_basis": "The consulted source does not give a historical date."
  },
  "geometry_status": "proposed",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-73.99,40.75],[-73.989,40.75],[-73.989,40.751],[-73.99,40.751],[-73.99,40.75]]]
  },
  "geometry_basis": "Explain the source and proposed extent.",
  "uncertainty_note": "The boundary remains a proposal pending review.",
  "record_license": "Explicit contributor-supplied license or unknown",
  "rights_notes": "Explain the submitted text rights."
}
```

Category uses the canonical claim categories. Borough uses the five named NYC boroughs or `unknown`. An unresolved area instead has `geometry_status: "unresolved"` and `geometry: null`; no point, box or centroid is invented.

Geometry is a single simple GeoJSON Polygon exterior ring in longitude/latitude WGS84 order. There are 3–100 distinct vertices plus the exact closing coordinate, each with exactly two finite numeric ordinates. Unsupported geometry, holes, extra geometry properties, repeated vertices, self-crossing/touching edges, degenerate area and out-of-range coordinates are rejected. The complete perimeter and interior must fit within the checked-in NYC union; a named borough must contain the whole area. Missing boundary data fails closed. Numerical containment uses a documented `1e-10` degree coordinate tolerance. The server never repairs, snaps or closes submitted geometry.

The preview has `proposal: {type, geometry, bounds, dates, source_refs, target: null}`. Geometry is present only after geometry validation; bounds are derived as `[[west,south],[east,north]]`. `application.applicable` is false with `area_proposal_review_only` for a valid proposal.

## Record annotation

First call `GET /api/contributions/target?id=<stable-record-id>` under the normal signed-in Site identity. It returns:

```text
{ target: { record_id, expected_version, expected_hash, origin, title, record } }
```

Static inventory and pilot records are parsed from the same checked-in JSON assignments used by the frontend, without executing JavaScript. Their snapshot format version is `1`; the SHA-256 content hash is authoritative for detecting changed source data. Hosted records use their actual D1 version/hash. Ambiguous IDs fail closed. The lookup never creates or imports records into D1.

For `static_inventory`, `record` is the full original public record, including citations and uncertainty. The pilot includes the same category/borough presentation fields as the map. For `hosted`, it is `{raw_json, raw, derived}`; canonical fields remain under `derived.canonical_entry`. Private server actor/owner IDs are omitted.

Copy only the returned `record_id`, `expected_version`, and `expected_hash` into the single envelope target. Payload fields are:

```json
{
  "annotation_kind": "clarification",
  "text": "Proposed additional information or clarification.",
  "original_wording": "The wording being discussed, preserved exactly.",
  "uncertainty_note": "Source limits and unresolved questions.",
  "dates": null
}
```

Kind is `addition` or `clarification`. Dates can be null or the shared date object. The server re-resolves the target at preview, revision and review, rejecting stale version/hash pairs. The saved preview retains the exact target snapshot; a later revision never overwrites the prior snapshot or original record. The diff shows the original target and proposed annotation separately. `application.applicable` remains false with `record_annotation_review_only`.

## Evidence and limits

Submission JSON bytes, original source snapshots, revisions, validation results and receipt bindings remain in the existing immutable workflow history. Existing idempotency keys and same-origin checks apply. Static target review uses a fresh server catalog check and rejects D1 ID collisions; static targets are never accepted by apply/activation/rollback operators.

Local tests use explicitly synthetic identities and isolated SQLite. They establish deterministic service behavior, not authenticated production acceptance. Hosted submission/revision acceptance still requires a real authorized browser session. The owner-private Site still has no independent reviewer/publisher grants.
