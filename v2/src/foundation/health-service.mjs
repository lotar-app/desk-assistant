import {
  EXPECTED_ENVIRONMENT,
  EXPECTED_MIGRATIONS,
  EXPECTED_SCHEMA_FAMILY,
  EXPECTED_SYSTEM_NAME,
  READY_SCHEMA_VERSION,
  validateEnvironment
} from "../environment.mjs";
import { FoundationRepository } from "./foundation-repository.mjs";

export class HealthService {
  constructor(env) {
    this.env = env || {};
  }

  health() {
    return {
      success: true,
      service: EXPECTED_SYSTEM_NAME,
      environment: EXPECTED_ENVIRONMENT,
      status: "alive"
    };
  }

  async ready() {
    const environment = validateEnvironment(this.env);
    if (!environment.ok) return notReady();

    try {
      const repository = new FoundationRepository(this.env.DESK_V2_DB);
      const [metadata, migrations, tables, containerColumns, foreignKeys] = await Promise.all([
        repository.readMetadata(),
        repository.readMigrationNames(),
        repository.readTables(),
        repository.readContainerColumns(),
        repository.foreignKeysEnabled()
      ]);
      const valid = metadata.system_name === EXPECTED_SYSTEM_NAME &&
        metadata.schema_family === EXPECTED_SCHEMA_FAMILY &&
        metadata.environment === EXPECTED_ENVIRONMENT &&
        exactMatch(migrations, EXPECTED_MIGRATIONS) &&
        repository.expectedTablesPresent(tables) &&
        repository.expectedContainerColumnsPresent(containerColumns) &&
        foreignKeys;
      if (!valid) return notReady();
      return {
        success: true,
        service: EXPECTED_SYSTEM_NAME,
        environment: EXPECTED_ENVIRONMENT,
        status: "ready",
        schemaVersion: READY_SCHEMA_VERSION
      };
    } catch {
      return notReady();
    }
  }
}

function exactMatch(actual, expected) {
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function notReady() {
  return {
    success: false,
    status: "not_ready",
    error: { code: "FOUNDATION_NOT_READY" }
  };
}
