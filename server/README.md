# Private map ingestion backend

Provider: CUNY AI Lab gateway, exact model glm-5.3-flash. No model request is possible until the server credential, enable gate, allowance-mode gate, and configured request ceiling are all present. No fallback provider or automatic model retry.

The original JSON string and parsed participant fields remain immutable. GLM may return only validated source spans and constrained derived fields. Coordinates come from explicit cited input or exact matches in the already sourced Site gazetteer. Other place names stay unlocated for review; there is no guessed or ambient geocoding.

Endpoints require the Sites authenticated-user header. Mutations require a same-origin Origin header and JSON body. All database reads/writes are scoped to that user. The current Site remains owner-private. Broader participant collection requires an explicit sharing and reviewer-role design.

Environment setup after secure approval:
- CAIL_API_KEY: server secret, never client code
- CAIL_ENABLED: true only after setup/account checks
- CAIL_ALLOWANCE_MODE: existing_only
- CAIL_MAX_REQUESTS_PER_DAY: explicitly approved integer ceiling
- CAIL_SITE_BUDGET_MICRODOLLARS: explicitly approved application-wide reservation ceiling
- CAIL_BUDGET_WINDOW: explicit approval-window identifier; not automatically reset
- CAIL_REQUEST_BUDGET_MICRODOLLARS: approved maximum allowance reservation per request, at least 10,000 microdollars and greater than or equal to the provider's verified worst-case request estimate (including system/schema tokens)

The application never creates keys, purchases credits, increases quota, changes sharing, or publishes user entries automatically. A resolved preview enters a separate pending-review layer. Explicit confirmation is necessary for approved records.

The D1 reservation ceiling is global across Site users and retained conservatively for the approved window. Gateway allowance is an estimate, not a payment authorization. Existing-only mode makes no purchase or quota increase. Indeterminate processing becomes a terminal status after five minutes and is never silently retried.
