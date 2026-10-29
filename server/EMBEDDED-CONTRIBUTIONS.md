# Area proposals and record annotations

This reference covers two contribution types that go beyond what the Contribute form sends: an area proposal and a record annotation. The form sends open proposals and the place editor sends record updates, so neither of these two types reaches the service from the visible interface today.

Area proposals and record annotations use the same `/api/contributions/preview`, `/submit` and `/revise` endpoints and existing D1 tables as other contributions. They leave authentication, reviewer permissions, AI settings and the point-oriented Entries schema untouched. Entries from tools use `entry_bundle`; the form's points use `open_proposal` until a publisher promotes one to an `entry_bundle`.

The types `area_proposal` and `record_annotation` are review-only. A valid submission enters `submitted`; deterministic validation errors enter `changes_requested`; and revising an approved or merged submission returns it to `draft`. An envelope failure, such as an unsafe URL or oversized submission, is refused before storage. A reviewer other than the contributor must confirm the editorial and privacy checks, including when the contributor is an admin. Even an approved proposal cannot be applied automatically, so no polygon or annotation is written into map records without the separate publication workflow.

## Fields both types share

Both types use the existing schema-version `1.0` envelope with `type`, `task_ids`, `title`, `summary`, `public_credit`, `sources`, `attachments`, `targets` and `payload`. The server assigns actor identities, revisions, review states, hashes, timestamps and receipts. Public credit appears only with explicit consent.

For these two types, `sources` holds 1 to 20 citation objects. Each object has the string fields `citation`, `locator`, `accessed_on`, `rights_status`, `rights_statement` and `public_use`, where `accessed_on` is the actual consultation date in `YYYY-MM-DD`. The `url` field is null, empty or an HTTP(S) address without credentials. Optional fields are `source_type`, `source_ref`, `entry_id`, `repository`, `source_date_original` and `evidence_note`, each a string or null. Unknown or restricted rights do not permit excerpts or media.

A dates object has exactly `time_original`, `time_precision`, `time_start_year`, `time_end_year` and `time_basis`. Precision is `unknown`, `year`, `range` or `circa`. Unknown bounds stay null; known bounds are ordered integer years from 1 to 3000, and `year` repeats the same year in both fields. A proposed date never overwrites a source's publication date or the original record.

## Area proposals

An area proposal leaves `targets` empty and puts these fields in its payload.

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

The category comes from the canonical claim categories and the borough is one of the five NYC boroughs or `unknown`. An unresolved area sets `geometry_status` to `unresolved` and `geometry` to `null`; the site never invents a point, box or centroid.

The geometry is a single simple GeoJSON Polygon with one exterior ring in longitude/latitude WGS84 order. It has 3–100 distinct vertices followed by the exact closing coordinate, with exactly two finite numbers in each coordinate. The server rejects unsupported geometry, holes, extra properties, repeated vertices, self-crossing or touching edges, degenerate area and out-of-range coordinates. The full perimeter and interior must fit inside the checked-in NYC union, and a named borough must contain the whole area. Missing boundary data fails closed. Containment uses a documented `1e-10` degree tolerance. The server never repairs, snaps or closes submitted geometry.

A valid proposal preview carries `proposal: {type, geometry, bounds, dates, source_refs, target: null}`. Geometry appears only after validation, and bounds are derived as `[[west,south],[east,north]]`. `application.applicable` is false with `area_proposal_review_only` for a valid proposal, or `attachment_review_only` when it carries an image.

## Record annotations

Start with `GET /api/contributions/target?id=<stable-record-id>` while signed in. It returns:

```text
{ target: { record_id, expected_version, expected_hash, origin, title, record } }
```

The server parses static inventory and pilot records from the checked-in assignments used by the frontend without executing JavaScript. Their snapshot format version is `1`; the SHA-256 content hash detects changed source data. Hosted records use their actual D1 version and hash. An ambiguous ID fails closed, and the lookup never creates or imports records into D1.

For `static_inventory`, `record` is the full original public record with its citations and uncertainty. Pilot records carry the same category and borough presentation fields as the map. For `hosted`, it is `{raw_json, raw, derived}`, with canonical fields under `derived.canonical_entry`; private actor and owner IDs are omitted. Unpublished hosted records resolve only for their owner, reviewers and publishers.

Copy only `record_id`, `expected_version` and `expected_hash` into the envelope's single target. The payload then has these fields:

```json
{
  "annotation_kind": "clarification",
  "text": "Proposed additional information or clarification.",
  "original_wording": "The wording being discussed, preserved exactly.",
  "uncertainty_note": "Source limits and unresolved questions.",
  "dates": null
}
```

`annotation_kind` is `addition` or `clarification`; `dates` is null or the shared date object. The server resolves the target again at preview, revision and review, rejecting stale version/hash pairs. The saved preview retains the exact target snapshot, so a later revision does not overwrite it or the original record. The diff shows the original target and proposed annotation separately, with `application.applicable` remaining false for `record_annotation_review_only`, or `attachment_review_only` when the annotation carries an image.

## Evidence and limits

Submission JSON bytes, original source snapshots, revisions, validation results and receipt bindings remain in immutable workflow history. Existing idempotency keys and same-origin checks apply. Static target review performs a fresh server catalog check and rejects a collision with a D1 ID; static targets are not accepted by apply, activation or rollback operators except as a built-in `record_update`.

Local tests use synthetic identities and isolated SQLite. They establish deterministic service behavior, not authenticated production acceptance. Hosted submission and revision acceptance still require an authorized browser session. The public map uses map accounts; open review grants bounded peer review and publication, while private hosted targets and raw job snapshots retain explicit privileged access.

## Next

[Running the site](../docs/running-the-site.md) covers the settings, release steps and sign-in internals behind these contributions.
