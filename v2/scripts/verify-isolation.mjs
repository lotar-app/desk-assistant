import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "wrangler.jsonc");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const expected = {
  workerName: "desk-v2-foundation-dev",
  binding: "DESK_V2_DB",
  databaseName: "desk-v2-foundation-dev",
  databaseId: "e2b252a0-ec15-48a8-bcd6-aed6d49427a3",
  environment: "v2-development",
  systemName: "desk-v2"
};

assert.equal(config.name, expected.workerName, "Worker name is not allowlisted");
assert.equal(config.main, "src/index.mjs", "Worker entry point is not allowlisted");
assert.equal(config.vars?.DESK_ENVIRONMENT, expected.environment,
  "Runtime environment is not V2 development");
assert.equal(config.vars?.DESK_SYSTEM_NAME, expected.systemName,
  "Runtime system name is not Desk V2");
assert.equal(config.d1_databases?.length, 1, "Exactly one D1 binding is required");

const database = config.d1_databases[0];
assert.equal(database.binding, expected.binding, "D1 binding is not allowlisted");
assert.equal(database.database_name, expected.databaseName,
  "D1 database name is not allowlisted");
assert.equal(database.database_id, expected.databaseId,
  "D1 database UUID is not the allowlisted Desk V2 resource");
assert.equal(database.preview_database_id, "desk-v2-foundation-local",
  "Local preview database is not allowlisted");
assert.equal(database.migrations_dir, "migrations", "Unexpected migration directory");
assert.equal(database.migrations_table, "d1_migrations", "Unexpected migration table");
assert.equal(database.remote, undefined, "Remote D1 bindings are forbidden in Phase 1");
assert.equal(config.routes, undefined, "Routes are forbidden in Phase 1");
assert.equal(config.route, undefined, "Routes are forbidden in Phase 1");
assert.equal(config.services, undefined, "Service bindings are forbidden in Phase 1");

const scannedFiles = listFiles(root).filter(file => {
  const relative = path.relative(root, file);
  return !relative.startsWith("node_modules" + path.sep) &&
    !relative.startsWith("test" + path.sep) &&
    relative !== "README.md" &&
    relative !== "scripts/verify-isolation.mjs" &&
    !relative.endsWith("package-lock.json");
});
const forbidden = [
  "desk-projectactivity",
  "DESK_APPS_SCRIPT_URL",
  "DESK_API_TOKEN",
  "PROJECT_ACTIVITY_ACTIONS_TOKEN",
  "PROJECT_ACTIVITY_ADMIN_TOKEN",
  "ApiConfig.js",
  "clasp",
  "remote\" : true",
  "remote\": true"
];
for (const file of scannedFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const marker of forbidden) {
    assert.equal(content.includes(marker), false,
      `Forbidden V1/remote marker ${marker} in ${path.relative(root, file)}`);
  }
  if (file.includes(path.sep + "src" + path.sep)) {
    assert.equal(/from\s+["'](?:\.\.\/){2,}/.test(content), false,
      `Runtime import escapes v2/src in ${path.relative(root, file)}`);
  }
}

console.log("DESK V2 ISOLATION CHECK PASSED (local foundation only)");

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}
