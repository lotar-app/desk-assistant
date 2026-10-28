import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_ENVIRONMENT,
  EXPECTED_MIGRATION,
  EXPECTED_MIGRATIONS,
  EXPECTED_SCHEMA_FAMILY,
  EXPECTED_SYSTEM_NAME,
  READY_SCHEMA_VERSION,
  validateEnvironment
} from "../src/environment.mjs";

function validEnvironment() {
  return {
    DESK_SYSTEM_NAME: EXPECTED_SYSTEM_NAME,
    DESK_ENVIRONMENT: EXPECTED_ENVIRONMENT,
    DESK_SCHEMA_FAMILY: EXPECTED_SCHEMA_FAMILY,
    DESK_REQUIRED_MIGRATION: EXPECTED_MIGRATION,
    DESK_V2_DB: { prepare() {} }
  };
}

test("accetta esclusivamente l'identità foundation V2 completa", () => {
  assert.deepEqual(validateEnvironment(validEnvironment()), { ok: true, errors: [] });
});

test("espone la baseline readiness completa e la sua versione", () => {
  assert.deepEqual(EXPECTED_MIGRATIONS, [
    "0001_foundation.sql",
    "0002_mcp_capability_test.sql",
    "0003_container_create_idempotency.sql",
    "0004_hierarchy_schema_preparation.sql",
    "0005_timeline_task_completion.sql",
    "0006_project_activity.sql"
  ]);
  assert.equal(READY_SCHEMA_VERSION, "0006_project_activity");
});

for (const [field, code] of [
  ["DESK_SYSTEM_NAME", "SYSTEM_NAME_MISMATCH"],
  ["DESK_ENVIRONMENT", "ENVIRONMENT_MISMATCH"],
  ["DESK_SCHEMA_FAMILY", "SCHEMA_FAMILY_MISMATCH"],
  ["DESK_REQUIRED_MIGRATION", "MIGRATION_ID_MISMATCH"],
  ["DESK_V2_DB", "DATABASE_BINDING_MISSING"]
]) {
  test(`fallisce chiuso per ${field}`, () => {
    const env = validEnvironment();
    delete env[field];
    const result = validateEnvironment(env);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes(code));
  });
}
