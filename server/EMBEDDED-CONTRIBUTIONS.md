# Area proposals and record annotations

This reference covers two contribution types that go beyond what the Contribute form sends, the area proposal and the record annotation, and it is written for anyone who builds a tool that sends these contributions or reviews what such a tool sends. The form described in [Contribution access](../docs/contribution-access.md) sends open proposals, which carry an optional point, and the place editor sends record updates, so neither of these two types reaches the service from the visible interface today.

Area proposals and record annotations travel through the same `/api/contributions/preview`, `/submit` and `/revise` endpoints and the same readback as every other contribution, and they use the existing D1 tables. They leave authentication, reviewer permissions (which `CONTRIBUTIONS_REVIEWER_IDS` grants, as [Running the site](../docs/running-the-site.md) explains), AI settings and the point-oriented Entries schema untouched, and entries from tools keep using the `entry_bundle` type, while the form sends points as `open_proposal`, which applies the same geometry checks when it carries a polygon, and a publisher restates an approved open proposal as an `entry_bundle` with the Promote to entry step.

The types `area_proposal` and `record_annotation` are review-only. For these two types a valid submission enters `submitted` and one with deterministic validation errors enters `changes_requested`, and revising an approved or merged submission returns it to `draft`, while a failure in the envelope itself, such as an unsafe URL or an oversized submission, is refused before anything is stored. A reviewer other than the contributor must confirm every editorial and privacy check, and even an approved proposal cannot be applied by the existing data operator, so no polygon or annotation is ever written into the map's records automatically.

## Fields both types share

Both types use the existing envelope, whose fields are `schema_version` (which must be `1.0`), `type`, `task_ids`, `title`, `summary`, `public_credit`, `sources`, `attachments`, `targets` and `payload`, and although the endpoint that stores images accepts any type, an area proposal or record annotation that carries an image reference reports `attachment_review_only` as its reason in place of its own. The server alone assigns actor identities, revisions, review states, hashes, timestamps and receipts, and a public credit appears only with explicit consent.

For these two types, `sources` holds 1 to 20 citation objects, and each object must have the string fields `citation`, `locator`, `accessed_on`, `rights_status`, `rights_statement` and `public_use`, where `accessed_on` is the date the contributor consulted the source, written as `YYYY-MM-DD`. The `url` field is null, empty or an HTTP(S) address without credentials, and a citation with no known URL is valid. The fields `source_type`, `source_ref`, `entry_id`, `repository`, `source_date_original` and `evidence_note` are optional and may be strings or null. The rights and public-use values keep their existing canonical enums, and unknown or restricted rights do not permit excerpts or media.

A dates object has exactly the fields `time_original`, `time_precision`, `time_start_year`, `time_end_year` and `time_basis`, where `time_original` and `time_basis` must be non-empty strings and the precision is `unknown`, `year`, `range` or `circa`. The bounds stay null when the precision is `unknown`, and for `year`, `range` and `circa` each bound must be an integer year from 1 to 3000, in order, with `year` repeating the same year in the start and end fields, while a proposed date never overwrites a source's publication date or the original record.

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
  "record_license": "License stated by the contributor, or unknown",
  "rights_notes": "Explain the submitted text rights."
}
```

The category comes from the canonical claim categories and the borough is one of the five NYC boroughs or `unknown`, while an area whose boundary is not yet known sets `geometry_status` to `"unresolved"` and `geometry` to `null`, and the site never invents a point, box or centroid for it.

The geometry is a single simple GeoJSON Polygon with one exterior ring, written in longitude and latitude order in WGS84, with 3 to 100 distinct vertices followed by the exact closing coordinate and exactly two finite numbers in each coordinate. The server rejects unsupported geometry types, holes, extra geometry properties, repeated vertices, edges that cross or touch themselves, areas with no extent and coordinates out of range. The whole perimeter and interior must fit inside the checked-in union of NYC boroughs, and a named borough must contain the entire area, while missing boundary data makes the check fail closed. Containment tests allow a coordinate tolerance of `1e-10` degrees, and the server never repairs, snaps or closes a submitted geometry.

The preview of a valid proposal carries a `proposal` object with the fields `type`, `geometry`, `bounds`, `dates`, `source_refs` and `target`, where `target` is null, and geometry appears in it only after it passes validation, with the server deriving `bounds` as `[[west,south],[east,north]]`. For a valid proposal `application.applicable` is false with the reason `area_proposal_review_only`, or `attachment_review_only` when the proposal carries an image.

## Record annotations

Start by calling `GET /api/contributions/target?id=<stable-record-id>` while signed in, which responds with this shape.

```text
{ target: { record_id, expected_version, expected_hash, origin, title, record } }
```

The server parses static inventory and pilot records from the checked-in JSON assignments in `public/inventory.js` and `public/pilot.js`, which hold more fields than the projected copies the served frontend receives, without executing any JavaScript, and it detects changed source data through the SHA-256 content hash of a snapshot whose format version is `1`, while hosted records use their real D1 version and hash. An unpublished hosted record resolves only for its owner and for reviewers, and anyone else receives a 404 `target_not_found`, while an ambiguous ID fails closed and the lookup never creates or imports records into D1.

For `static_inventory` targets, `record` is the full original public record with its citations and uncertainty, and pilot records add the same category and borough presentation fields the map uses, while for `hosted` targets that no verified job has published, `record` has the three parts `raw_json`, `raw` and `derived`, with the canonical fields under `derived.canonical_entry` and private actor and owner IDs left out, and a hosted record that has been published returns its public projection instead.

Copy only the returned `record_id`, `expected_version` and `expected_hash` into the envelope's single target, and the payload then has these fields.

```json
{
  "annotation_kind": "clarification",
  "text": "Proposed additional information or clarification.",
  "original_wording": "The wording being discussed, preserved exactly.",
  "uncertainty_note": "Source limits and unresolved questions.",
  "dates": null
}
```

The `annotation_kind` is `addition` or `clarification` and `dates` is null or the shared date object, while the server resolves the target again at preview, at revision and at review, treating a version and hash pair that has gone stale as a `stale_target` validation error at the first two and refusing it with a 409 at review. The saved preview keeps the exact target snapshot, so a later revision never overwrites that snapshot or the original record, and the diff shows the original target and the proposed annotation separately, with `application.applicable` staying false for the reason `record_annotation_review_only`, or `attachment_review_only` when the annotation carries an image.

## Evidence and limits

The submission JSON bytes, original source snapshots, revisions, validation results and receipt bindings all stay in the existing workflow history, which the application only ever appends to, and the existing idempotency keys and same-origin checks apply. Review of a static target runs a fresh check against the server's catalog and rejects any collision with a D1 ID, and the apply, activation and rollback operators never accept a static target.

The local tests use synthetic identities and an isolated SQLite database, so they show that the service behaves deterministically and do not stand in for a signed-in submission made in a real browser.

## Next

[Running the site](../docs/running-the-site.md) covers the settings, release steps and sign-in internals behind these contributions.
