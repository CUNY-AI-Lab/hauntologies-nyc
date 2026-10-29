#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ "${GITHUB_REF:-}" == refs/heads/main ]] || fail 'Release must run from main.'
[[ "${EXPECTED_MAIN_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail 'Supply the full main commit SHA.'
[[ "${GITHUB_SHA:-}" == "$EXPECTED_MAIN_SHA" ]] || fail 'The workflow revision differs from the requested commit.'
[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || fail 'No CI deployment credential is configured.'
[[ -n "${RUNNER_TEMP:-}" && -n "${GITHUB_STEP_SUMMARY:-}" ]] || fail 'GitHub Actions temporary storage is required.'

current_main() { gh api repos/CUNY-AI-Lab/hauntologies-nyc/commits/main --jq .sha; }
[[ "$(current_main)" == "$EXPECTED_MAIN_SHA" ]] || fail 'Main changed before preflight.'
[[ "$(git rev-parse HEAD)" == "$EXPECTED_MAIN_SHA" ]] || fail 'Checkout differs from the requested commit.'
git diff --quiet && git diff --cached --quiet || fail 'Tracked source changed during the build.'

umask 077
workdir=$(mktemp -d "${RUNNER_TEMP}/hauntologies-release.XXXXXX")
trap 'rm -rf "$workdir"' EXIT
wrangler=./node_modules/.bin/wrangler
config=dist/server/wrangler.live.json
origin=https://hauntologies-nyc.ailab-452.workers.dev

"$wrangler" deployments status --name hauntologies-nyc --json > "$workdir/before-deployment.json"
before_id=$(jq -er '.versions | select(length == 1 and .[0].percentage == 100) | .[0].version_id' "$workdir/before-deployment.json")
"$wrangler" versions view "$before_id" --name hauntologies-nyc --json > "$workdir/before-version.json"
jq -e '[.resources.bindings[] | select(.type == "d1" and .name == "DB" and .database_id == "df7f1e92-e339-4e25-ac30-989dd68d8dfc")] | length == 1' "$workdir/before-version.json" >/dev/null || fail 'The current database binding does not match the intended database.'
jq -e '[.resources.bindings[] | select(.type == "service" and .name == "ACCOUNT_MAIL" and .service == "cail-tools-admission" and .entrypoint == "AdmissionHauntologiesAccountMail" and .environment == "production")] | length == 1' "$workdir/before-version.json" >/dev/null || fail 'The current account-mail binding does not match the intended service.'
before_tag=$(jq -er '.annotations["workers/tag"] | select(type == "string" and test("^[0-9a-f]{7,40}$"))' "$workdir/before-version.json")
git rev-parse --verify "${before_tag}^{commit}" >/dev/null || fail 'The serving version has no resolvable source tag.'
git diff --quiet "$before_tag" "$EXPECTED_MAIN_SHA" -- drizzle || fail 'Migration changes need separate review before release.'

"$wrangler" d1 time-travel info DB --config "$config" --json > "$workdir/bookmark.json"
bookmark=$(jq -er '.bookmark | select(type == "string" and length > 0)' "$workdir/bookmark.json")
"$wrangler" d1 execute DB --remote --config "$config" --json \
  --command "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name" > "$workdir/tables.json"
jq -er '.[0].results[].name' "$workdir/tables.json" > "$workdir/tables.txt"

snapshot_counts() {
  local table count
  while IFS= read -r table; do
    [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail 'A table name cannot be safely inspected.'
    count=$("$wrangler" d1 execute DB --remote --config "$config" --json \
      --command "SELECT COUNT(*) AS n FROM \"$table\"" | jq -er '.[0].results[0].n | numbers')
    printf '%s %s\n' "$table" "$count"
  done < "$workdir/tables.txt"
}
snapshot_counts > "$workdir/counts-before.txt"
binding_signatures() {
  jq -r '[.resources.bindings[] | [.type, .name, (if .type == "d1" then (.database_id // "") elif .type == "service" then ([.service, .entrypoint, .environment] | map(. // "") | join("|")) else "" end)] | @tsv] | sort[]' "$1"
}
binding_signatures "$workdir/before-version.json" > "$workdir/bindings-before.txt"

printf 'Prior Worker version: `%s`\n\nD1 bookmark: `%s`\n\n' "$before_id" "$bookmark" >> "$GITHUB_STEP_SUMMARY"
[[ "$(current_main)" == "$EXPECTED_MAIN_SHA" ]] || fail 'Main changed before deployment.'
"$wrangler" deploy --config "$config" --keep-vars --tag "$EXPECTED_MAIN_SHA" --message "CI release $EXPECTED_MAIN_SHA"
printf 'Deployment submitted. If verification fails, inspect the serving version before retrying.\n\n' >> "$GITHUB_STEP_SUMMARY"

after_id=''
for attempt in {1..12}; do
  "$wrangler" deployments status --name hauntologies-nyc --json > "$workdir/after-deployment.json"
  candidate=$(jq -r '.versions | if length == 1 and .[0].percentage == 100 then .[0].version_id else empty end' "$workdir/after-deployment.json")
  if [[ -n "$candidate" ]]; then
    "$wrangler" versions view "$candidate" --name hauntologies-nyc --json > "$workdir/after-version.json"
    if jq -e --arg sha "$EXPECTED_MAIN_SHA" '.annotations["workers/tag"] == $sha' "$workdir/after-version.json" >/dev/null; then
      after_id=$candidate
      break
    fi
  fi
  sleep 5
done
[[ -n "$after_id" ]] || fail 'Could not confirm the serving version. Inspect the deployment before retrying.'
binding_signatures "$workdir/after-version.json" > "$workdir/bindings-after.txt"
[[ -z "$(comm -23 "$workdir/bindings-before.txt" "$workdir/bindings-after.txt")" ]] || fail 'A prior Worker binding is missing after deployment.'
"$wrangler" d1 execute DB --remote --config "$config" --json \
  --command "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name" > "$workdir/tables-after.json"
jq -er '.[0].results[].name' "$workdir/tables-after.json" > "$workdir/tables-after.txt"
if ! cmp -s "$workdir/tables.txt" "$workdir/tables-after.txt"; then
  printf '::warning::Database table names changed during the release; review the schema.\n'
fi
snapshot_counts > "$workdir/counts-after.txt"
if ! cmp -s "$workdir/counts-before.txt" "$workdir/counts-after.txt"; then
  printf '::warning::Database table counts changed during the release; review the change without exposing participant records.\n'
fi

curl --fail --silent --show-error --max-time 20 "$origin/api/access-status" > "$workdir/access.json"
jq -e '.enabled == true and .account_mode == "map" and .dashboard_enabled == false' "$workdir/access.json" >/dev/null || fail 'Account readiness did not match the release contract.'
code=$(curl --silent --show-error --max-time 20 -o "$workdir/signed-out.json" -w '%{http_code}' "$origin/api/contributor-roster")
[[ "$code" == 401 ]] || fail 'Signed-out roster protection did not return 401.'
for asset in app.js contributions.js place-history.js; do
  curl --fail --silent --show-error --max-time 20 -H 'Cache-Control: no-cache' "$origin/$asset" -o "$workdir/$asset"
  cmp -s "dist/client/$asset" "$workdir/$asset" || fail "Delivered $asset differs from the prepared asset."
done
printf 'Serving Worker version: `%s` at source `%s`.\n\nDatabase table counts were checked before and after.\n' "$after_id" "$EXPECTED_MAIN_SHA" >> "$GITHUB_STEP_SUMMARY"
[[ "$(current_main)" == "$EXPECTED_MAIN_SHA" ]] || fail 'Main changed during the release; review the serving revision.'
