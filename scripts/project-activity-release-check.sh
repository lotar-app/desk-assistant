#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly EXPECTED_COMMIT="${1:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
readonly BINDING_MODE="${2:-preparation}"
readonly EXPECTED_BRANCH="${3:-main}"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }

[[ "$(git -C "$REPO_ROOT" rev-parse HEAD)" == "$EXPECTED_COMMIT" ]] ||
  fail "HEAD does not match expected commit"
[[ "$(git -C "$REPO_ROOT" branch --show-current)" == "$EXPECTED_BRANCH" ]] ||
  fail "current branch does not match expected branch"
git -C "$REPO_ROOT" cat-file -e "$EXPECTED_COMMIT^{commit}"
git -C "$REPO_ROOT" show --check --oneline "$EXPECTED_COMMIT" >/dev/null
pass "release branch and commit"

while IFS= read -r status; do
  [[ -z "$status" || "$status" == " M ApiConfig.js" || "$status" == "?? audit/" ]] ||
    fail "working tree contains an unexpected path"
done < <(git -C "$REPO_ROOT" status --short)
pass "working tree contains only approved local exclusions"

for file in \
  worker/migrations/0001_project_activity_foundation.sql \
  worker/migrations/0002_project_activity_write_path.sql \
  worker/migrations/0003_project_activity_outbox_delivery.sql \
  TimelineEventIdMigration.js ProjectActivityTimelineDeliveryRepository.js \
  ProjectActivityTimelineDeliveryMigration.js \
  ProjectActivityTimelineDeliveryMigrationAdmin.js \
  openapi/desk-action.openapi.yaml gpt/DESK_ASSISTANT_INSTRUCTIONS.md; do
  git -C "$REPO_ROOT" cat-file -e "$EXPECTED_COMMIT:$file" || fail "missing $file"
done
pass "required release files"

git -C "$REPO_ROOT" show "$EXPECTED_COMMIT:ApiConfig.js" |
  rg -q 'CAMBIA_QUESTO_TOKEN' || fail "committed ApiConfig.js must contain placeholder"
pass "committed Apps Script token placeholder"

if git -C "$REPO_ROOT" grep -I -E \
  "PROJECT_ACTIVITY_(ACTIONS|ADMIN)_TOKEN[[:space:]]*[:=][[:space:]]*[\"'][^\"']{16,}" \
  "$EXPECTED_COMMIT" -- ':!worker/test/**'; then
  fail "a ProjectActivity token-like assignment is tracked"
fi
pass "no ProjectActivity secret assignment"

cd "$REPO_ROOT"
npm run test:project-activity
npm run test:apps-script
npm run test:gpt-instructions
ruby -e 'require "yaml"; YAML.load_file("openapi/desk-action.openapi.yaml")'
sqlite3 :memory: \
  '.read worker/migrations/0001_project_activity_foundation.sql' \
  '.read worker/migrations/0002_project_activity_write_path.sql' \
  '.read worker/migrations/0003_project_activity_outbox_delivery.sql' \
  'PRAGMA integrity_check;' | rg -qx 'ok'
git diff --check
pass "tests, OpenAPI, SQL and whitespace"

if [[ "$BINDING_MODE" == "preparation" ]]; then
  rg -q 'PASTE_THE_CREATED_DATABASE_ID_HERE' worker/wrangler.jsonc ||
    fail "preparation mode expects an inactive placeholder binding"
elif [[ "$BINDING_MODE" == "activation" ]]; then
  rg -q '"binding"[[:space:]]*:[[:space:]]*"DB"' worker/wrangler.jsonc ||
    fail "activation mode requires DB binding"
  ! rg -q 'PASTE_THE_CREATED_DATABASE_ID_HERE' worker/wrangler.jsonc ||
    fail "activation mode refuses placeholder database ID"
else
  fail "binding mode must be preparation or activation"
fi
pass "D1 binding state: $BINDING_MODE"

for required in PROJECT_ACTIVITY_ACTIONS_TOKEN PROJECT_ACTIVITY_ADMIN_TOKEN; do
  rg -q "$required" worker/worker.js || fail "missing runtime secret reference: $required"
done
pass "runtime auth prerequisites"

printf 'PROJECTACTIVITY RELEASE CHECK PASSED (%s)\n' "$BINDING_MODE"
