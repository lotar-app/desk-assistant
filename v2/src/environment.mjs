export const EXPECTED_ENVIRONMENT = "v2-development";
export const EXPECTED_SYSTEM_NAME = "desk-v2";
export const EXPECTED_SCHEMA_FAMILY = "desk-v2-foundation";
export const EXPECTED_MIGRATION = "0001_foundation.sql";

export function validateEnvironment(env = {}) {
  const errors = [];
  if (env.DESK_SYSTEM_NAME !== EXPECTED_SYSTEM_NAME) {
    errors.push("SYSTEM_NAME_MISMATCH");
  }
  if (env.DESK_ENVIRONMENT !== EXPECTED_ENVIRONMENT) {
    errors.push("ENVIRONMENT_MISMATCH");
  }
  if (env.DESK_SCHEMA_FAMILY !== EXPECTED_SCHEMA_FAMILY) {
    errors.push("SCHEMA_FAMILY_MISMATCH");
  }
  if (env.DESK_REQUIRED_MIGRATION !== EXPECTED_MIGRATION) {
    errors.push("MIGRATION_ID_MISMATCH");
  }
  if (!env.DESK_V2_DB || typeof env.DESK_V2_DB.prepare !== "function") {
    errors.push("DATABASE_BINDING_MISSING");
  }
  return { ok: errors.length === 0, errors };
}
