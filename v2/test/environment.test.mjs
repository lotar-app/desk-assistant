import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_ENVIRONMENT,
  EXPECTED_MIGRATION,
  EXPECTED_SCHEMA_FAMILY,
  EXPECTED_SYSTEM_NAME,
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
