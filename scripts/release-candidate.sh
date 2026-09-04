#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly RELEASE_COMMIT="${1:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
readonly DESCRIPTION="Workspace Foundation candidate $RELEASE_COMMIT"

RELEASE_PARENT=""
RELEASE_DIR=""
CURRENT_PHASE="initialization"
VERSION_NUMBER=""

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR [%s]: %s\n' "$CURRENT_PHASE" "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${RELEASE_PARENT:-}" && -d "$RELEASE_PARENT" ]]; then
    rm -rf -- "$RELEASE_PARENT"
  fi
}

on_error() {
  local status=$1
  local line=$2
  printf 'ERROR [%s]: command failed at line %s with exit code %s\n' \
    "$CURRENT_PHASE" "$line" "$status" >&2
  exit "$status"
}

trap cleanup EXIT HUP INT TERM
trap 'on_error $? $LINENO' ERR

phase_1_verify_preconditions() {
  CURRENT_PHASE="1 - preconditions"
  log "[1/9] Verifying release preconditions"

  local command
  for command in git tar node clasp mktemp cmp rg cp chmod rm sed tail mkdir; do
    command -v "$command" >/dev/null 2>&1 || fail "Missing command: $command"
  done

  [[ -f "$REPO_ROOT/.env" ]] || fail "Missing .env"
  [[ -f "$REPO_ROOT/.clasp.json" ]] || fail "Missing .clasp.json"
  [[ -f "$REPO_ROOT/.claspignore" ]] || fail "Missing .claspignore"

  [[ "$(git -C "$REPO_ROOT" rev-parse HEAD)" == "$RELEASE_COMMIT" ]] ||
    fail "HEAD does not match the requested release commit"
  [[ "$(git -C "$REPO_ROOT" rev-parse origin/main)" == "$RELEASE_COMMIT" ]] ||
    fail "origin/main does not match the requested release commit"

  git -C "$REPO_ROOT" cat-file -e "$RELEASE_COMMIT^{commit}"
  git -C "$REPO_ROOT" show "$RELEASE_COMMIT:ApiConfig.js" |
    rg -q 'CAMBIA_QUESTO_TOKEN' ||
    fail "The committed ApiConfig.js does not contain the expected placeholder"

  git -C "$REPO_ROOT" show "$RELEASE_COMMIT:WorkspaceMigration.js" >/dev/null
  git -C "$REPO_ROOT" show "$RELEASE_COMMIT:WorkspaceMigrationAdmin.js" >/dev/null

  log "OK: preconditions verified"
}

phase_2_create_temporary_copy() {
  CURRENT_PHASE="2 - temporary copy"
  log "[2/9] Creating isolated release copy"

  umask 077
  RELEASE_PARENT="$(mktemp -d /private/tmp/desk-release.XXXXXX)"
  RELEASE_DIR="$RELEASE_PARENT/source"
  mkdir -m 700 "$RELEASE_DIR"

  git -C "$REPO_ROOT" status --porcelain=v1 -z \
    > "$RELEASE_PARENT/repository.before"

  git -C "$REPO_ROOT" archive "$RELEASE_COMMIT" |
    tar -x -C "$RELEASE_DIR"

  cp "$REPO_ROOT/.clasp.json" "$RELEASE_DIR/.clasp.json"
  cp "$REPO_ROOT/.claspignore" "$RELEASE_DIR/.claspignore"
  chmod 600 "$RELEASE_DIR/.clasp.json" "$RELEASE_DIR/.claspignore"

  [[ -f "$RELEASE_DIR/WorkspaceMigration.js" ]] ||
    fail "WorkspaceMigration.js is missing from the release copy"
  [[ -f "$RELEASE_DIR/WorkspaceMigrationAdmin.js" ]] ||
    fail "WorkspaceMigrationAdmin.js is missing from the release copy"
  log "OK: isolated copy created"
}

phase_3_validate_token_source() {
  CURRENT_PHASE="3 - token source"
  log "[3/9] Validating token source"

  env REPO_ROOT="$REPO_ROOT" node <<'NODE'
const fs = require("fs");

function readToken(path) {
  const text = fs.readFileSync(path, "utf8");
  const line = text
    .split(/\r?\n/)
    .find(item => /^\s*DESK_API_TOKEN\s*=/.test(item));

  if (!line) throw new Error("DESK_API_TOKEN is missing from .env");

  let value = line.replace(/^\s*DESK_API_TOKEN\s*=\s*/, "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  if (!value || value === "CAMBIA_QUESTO_TOKEN") {
    throw new Error("DESK_API_TOKEN is empty or invalid");
  }
}

readToken(process.env.REPO_ROOT + "/.env");
NODE

  log "OK: token source is available"
}

phase_4_inject_token() {
  CURRENT_PHASE="4 - token injection"
  log "[4/9] Injecting token into isolated copy"

  env REPO_ROOT="$REPO_ROOT" RELEASE_DIR="$RELEASE_DIR" node <<'NODE'
const fs = require("fs");

function readToken(path) {
  const text = fs.readFileSync(path, "utf8");
  const line = text
    .split(/\r?\n/)
    .find(item => /^\s*DESK_API_TOKEN\s*=/.test(item));

  if (!line) throw new Error("DESK_API_TOKEN is missing");

  let value = line.replace(/^\s*DESK_API_TOKEN\s*=\s*/, "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  if (!value || value === "CAMBIA_QUESTO_TOKEN") {
    throw new Error("DESK_API_TOKEN is empty or invalid");
  }
  return value;
}

const token = readToken(process.env.REPO_ROOT + "/.env");
const target = process.env.RELEASE_DIR + "/ApiConfig.js";
fs.writeFileSync(
  target,
  "const DESK_API_TOKEN = " + JSON.stringify(token) + ";\n",
  { mode: 0o600 }
);

const config = fs.readFileSync(target, "utf8");
const match = config.match(/^const DESK_API_TOKEN = (.+);\s*$/);
if (!match || JSON.parse(match[1]) !== token) {
  throw new Error("Injected token does not match the secure source");
}
NODE

  if rg -q 'CAMBIA_QUESTO_TOKEN' "$RELEASE_DIR/ApiConfig.js"; then
    fail "ApiConfig.js still contains the placeholder"
  fi

  log "OK: token injected without displaying it"
}

phase_5_verify_repository_unchanged() {
  CURRENT_PHASE="5 - repository verification"
  log "[5/9] Verifying repository state before upload"

  git -C "$REPO_ROOT" status --porcelain=v1 -z \
    > "$RELEASE_PARENT/repository.before-upload"
  cmp "$RELEASE_PARENT/repository.before" \
    "$RELEASE_PARENT/repository.before-upload"

  log "OK: repository is unchanged"
}

phase_6_push_candidate() {
  CURRENT_PHASE="6 - clasp push"
  log "[6/9] Uploading candidate source to Apps Script"

  (
    cd "$RELEASE_DIR"
    clasp status > "$RELEASE_PARENT/clasp-status.txt"
  )

  rg -q '^└─ WorkspaceMigration\.js$' "$RELEASE_PARENT/clasp-status.txt" ||
    fail "WorkspaceMigration.js is not included by clasp"
  rg -q '^└─ WorkspaceMigrationAdmin\.js$' "$RELEASE_PARENT/clasp-status.txt" ||
    fail "WorkspaceMigrationAdmin.js is not included by clasp"
  rg -q '^└─ ApiConfig\.js$' "$RELEASE_PARENT/clasp-status.txt" ||
    fail "ApiConfig.js is not included by clasp"

  (
    cd "$RELEASE_DIR"
    clasp push
  )

  log "OK: clasp push completed"
}

phase_7_create_version() {
  CURRENT_PHASE="7 - Apps Script version"
  log "[7/9] Creating immutable Apps Script candidate version"

  local output
  output="$(cd "$RELEASE_DIR" && clasp version "$DESCRIPTION")"
  printf '%s\n' "$output"

  VERSION_NUMBER="$(printf '%s\n' "$output" |
    sed -nE 's/.*[Vv]ersion[[:space:]]+([0-9]+).*/\1/p' |
    tail -n 1)"
  [[ -n "$VERSION_NUMBER" ]] || fail "Unable to determine Apps Script version number"

  (
    cd "$RELEASE_DIR"
    clasp versions > "$RELEASE_PARENT/versions.txt"
  )
  rg -Fq "$DESCRIPTION" "$RELEASE_PARENT/versions.txt" ||
    fail "Candidate version is not listed by clasp"

  log "OK: Apps Script version $VERSION_NUMBER created"
}

phase_8_restore_temporary_config() {
  CURRENT_PHASE="8 - temporary config restoration"
  log "[8/9] Restoring placeholder in temporary copy"

  git -C "$REPO_ROOT" archive "$RELEASE_COMMIT" ApiConfig.js |
    tar -x -C "$RELEASE_DIR"

  rg -q 'CAMBIA_QUESTO_TOKEN' "$RELEASE_DIR/ApiConfig.js" ||
    fail "ApiConfig.js placeholder was not restored"

  log "OK: temporary token copy removed"
}

phase_9_final_verification() {
  CURRENT_PHASE="9 - final verification"
  log "[9/9] Verifying repository and local cleanup conditions"

  git -C "$REPO_ROOT" status --porcelain=v1 -z \
    > "$RELEASE_PARENT/repository.after"
  cmp "$RELEASE_PARENT/repository.before" "$RELEASE_PARENT/repository.after"

  git -C "$REPO_ROOT" show "$RELEASE_COMMIT:ApiConfig.js" |
    rg -q 'CAMBIA_QUESTO_TOKEN'

  env REPO_ROOT="$REPO_ROOT" node <<'NODE'
const fs = require("fs");
const cp = require("child_process");

function readToken(path) {
  const text = fs.readFileSync(path, "utf8");
  const line = text
    .split(/\r?\n/)
    .find(item => /^\s*DESK_API_TOKEN\s*=/.test(item));

  if (!line) throw new Error("DESK_API_TOKEN is missing");

  let value = line.replace(/^\s*DESK_API_TOKEN\s*=\s*/, "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

const root = process.env.REPO_ROOT;
const token = readToken(root + "/.env");
const files = cp.execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString()
  .split("\0")
  .filter(Boolean);

const matches = files.filter(file => {
  try {
    return fs.readFileSync(root + "/" + file).includes(token);
  } catch {
    return false;
  }
});

if (matches.length) {
  throw new Error("The real token is present in tracked repository files");
}
NODE

  log "OK: repository matches its initial state"
}

finalize_cleanup() {
  CURRENT_PHASE="final cleanup"
  log "Removing isolated release copy"

  local temporary_path="$RELEASE_PARENT"
  cleanup

  [[ ! -e "$temporary_path" ]] ||
    fail "Temporary release directory still exists"

  trap - EXIT ERR HUP INT TERM
  RELEASE_PARENT=""
  RELEASE_DIR=""

  log "OK: isolated release copy removed"
}

main() {
  phase_1_verify_preconditions
  phase_2_create_temporary_copy
  phase_3_validate_token_source
  phase_4_inject_token
  phase_5_verify_repository_unchanged
  phase_6_push_candidate
  phase_7_create_version
  phase_8_restore_temporary_config
  phase_9_final_verification
  finalize_cleanup

  log "RELEASE CANDIDATE CREATED"
  log "Apps Script version: $VERSION_NUMBER"
  log "WorkspaceMigration.js: present"
  log "WorkspaceMigrationAdmin.js: present"
  log "Repository state: unchanged"
}

main "$@"
