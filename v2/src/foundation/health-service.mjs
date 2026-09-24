import {
  EXPECTED_ENVIRONMENT,
  EXPECTED_MIGRATION,
  EXPECTED_SCHEMA_FAMILY,
  EXPECTED_SYSTEM_NAME,
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
      const [metadata, migrations, tables, foreignKeys] = await Promise.all([
        repository.readMetadata(),
        repository.readMigrationNames(),
        repository.readTables(),
        repository.foreignKeysEnabled()
      ]);
      const valid = metadata.system_name === EXPECTED_SYSTEM_NAME &&
        metadata.schema_family === EXPECTED_SCHEMA_FAMILY &&
        metadata.environment === EXPECTED_ENVIRONMENT &&
        migrations.includes(EXPECTED_MIGRATION) &&
        repository.expectedTablesPresent(tables) &&
        foreignKeys;
      if (!valid) return notReady();
      return {
        success: true,
        service: EXPECTED_SYSTEM_NAME,
        environment: EXPECTED_ENVIRONMENT,
        status: "ready",
        schemaVersion: EXPECTED_MIGRATION.replace(/\.sql$/, "")
      };
    } catch {
      return notReady();
    }
  }
}

function notReady() {
  return {
    success: false,
    status: "not_ready",
    error: { code: "FOUNDATION_NOT_READY" }
  };
}
