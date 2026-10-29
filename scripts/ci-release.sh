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
check=scripts/check-code-only-release.mjs
origin=https://hauntologies-nyc.ailab-452.workers.dev

# No deploy-time build command, resource provisioning, or schema migration is allowed.
node "$check" config "$config"
"$wrangler" deployments status --name hauntologies-nyc --json > "$workdir/before-deployment.json"
before_id=$(jq -er '.versions | select(length == 1 and .[0].percentage == 100) | .[0].version_id' "$workdir/before-deployment.json")
"$wrangler" versions view "$before_id" --name hauntologies-nyc --json | node "$check" snapshot "$config" > "$workdir/before.json"
before_tag=$(jq -er '.tag' "$workdir/before.json")
git rev-parse --verify "${before_tag}^{commit}" >/dev/null || fail 'The serving version has no resolvable source tag.'
git diff --quiet "$before_tag" "$EXPECTED_MAIN_SHA" -- drizzle ':(glob)**/migrations/**' || fail 'Migration changes need separate review before release.'

printf 'Code-only release: prior Worker version `%s`, source `%s`, UTC `%s`.\n\nNo D1 schema, table counts, or Time Travel bookmark were checked. Database review remains separate.\n\n' "$before_id" "$before_tag" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_STEP_SUMMARY"
[[ "$(current_main)" == "$EXPECTED_MAIN_SHA" ]] || fail 'Main changed before deployment.'
if ! "$wrangler" deploy --config "$config" --keep-vars --tag "$EXPECTED_MAIN_SHA" --message "CI release $EXPECTED_MAIN_SHA"; then
  printf 'Deployment command failed; it may have changed production. Inspect the serving version before retrying.\n\n' >> "$GITHUB_STEP_SUMMARY"
  fail 'Deployment outcome uncertain. Inspect the serving version before retrying.'
fi
printf 'Deployment submitted. If verification fails, inspect the serving version before retrying.\n\n' >> "$GITHUB_STEP_SUMMARY"

after_id=''
for attempt in {1..12}; do
  "$wrangler" deployments status --name hauntologies-nyc --json > "$workdir/after-deployment.json"
  candidate=$(jq -r '.versions | if length == 1 and .[0].percentage == 100 then .[0].version_id else empty end' "$workdir/after-deployment.json")
  if [[ -n "$candidate" ]]; then
    if ! "$wrangler" versions view "$candidate" --name hauntologies-nyc --json | node "$check" snapshot "$config" > "$workdir/after.json"; then
      fail 'Could not verify serving bindings or variables. Inspect the deployment before retrying.'
    fi
    if jq -e --arg sha "$EXPECTED_MAIN_SHA" '.tag == $sha' "$workdir/after.json" >/dev/null; then
      after_id=$candidate
      break
    fi
  fi
  sleep 5
done
[[ -n "$after_id" ]] || fail 'Could not confirm the serving version. Inspect the deployment before retrying.'
jq -S '.bindings' "$workdir/before.json" > "$workdir/bindings-before.json"
jq -S '.bindings' "$workdir/after.json" > "$workdir/bindings-after.json"
cmp -s "$workdir/bindings-before.json" "$workdir/bindings-after.json" || fail 'Worker bindings or variables changed after deployment. Inspect the deployment before retrying.'

curl --fail --silent --show-error --max-time 20 "$origin/api/access-status" > "$workdir/access.json"
jq -e '.enabled == true and .account_mode == "map" and .dashboard_enabled == false' "$workdir/access.json" >/dev/null || fail 'Account readiness did not match the release contract.'
code=$(curl --silent --show-error --max-time 20 -o "$workdir/signed-out.json" -w '%{http_code}' "$origin/api/contributor-roster")
[[ "$code" == 401 ]] || fail 'Signed-out roster protection did not return 401.'
for asset in app.js contributions.js place-history.js; do
  curl --fail --silent --show-error --max-time 20 -H 'Cache-Control: no-cache' "$origin/$asset" -o "$workdir/$asset"
  cmp -s "dist/client/$asset" "$workdir/$asset" || fail "Delivered $asset differs from the prepared asset."
done
printf 'Serving Worker version: `%s` at source `%s`. Binding names and variable hashes were checked.\n' "$after_id" "$EXPECTED_MAIN_SHA" >> "$GITHUB_STEP_SUMMARY"
[[ "$(current_main)" == "$EXPECTED_MAIN_SHA" ]] || fail 'Main changed during the release; review the serving revision.'
