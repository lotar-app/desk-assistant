import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";
import { createWorker } from "../src/index.mjs";

const metadata = {
  environment: "v2-development",
  schema_family: "desk-v2-foundation",
  system_name: "desk-v2"
};

const migrations = [
  "0001_foundation.sql",
  "0002_mcp_capability_test.sql",
  "0003_container_create_idempotency.sql",
  "0004_hierarchy_schema_preparation.sql",
  "0005_timeline_task_completion.sql",
  "0006_project_activity.sql"
];

const tables = [
  "containers",
  "d1_migrations",
  "desk_hierarchy",
  "mcp_capability_test",
  "mcp_idempotency",
  "project_activities",
  "project_activity_aliases",
  "project_activity_item_revisions",
  "project_activity_items",
  "system_metadata",
  "tasks",
  "timeline_events"
];

const containerColumns = ["name_key", "role"];

function db(options = {}) {
  return {
    prepare(sql) {
      return {
        async all() {
          if (/system_metadata/.test(sql)) {
            return { results: Object.entries(options.metadata || metadata)
              .map(([key, value]) => ({ key, value })) };
          }
          if (/d1_migrations/.test(sql)) {
            return { results: (options.migrations || migrations).map(name => ({ name })) };
          }
          if (/sqlite_master/.test(sql)) {
            return { results: (options.tables || tables).map(name => ({ name })) };
          }
          if (/PRAGMA table_info\(containers\)/.test(sql)) {
            return { results: (options.containerColumns || containerColumns)
              .map(name => ({ name })) };
          }
          if (/PRAGMA foreign_keys/.test(sql)) {
            return { results: [{ foreign_keys: options.foreignKeys ?? 1 }] };
          }
          throw new Error("unexpected fixture query");
        }
      };
    }
  };
}

function env(database = db()) {
  return {
    DESK_SYSTEM_NAME: "desk-v2",
    DESK_ENVIRONMENT: "v2-development",
    DESK_SCHEMA_FAMILY: "desk-v2-foundation",
    DESK_REQUIRED_MIGRATION: "0001_foundation.sql",
    DESK_V2_DB: database
  };
}

function request(path, method = "GET") {
  return new Request(`http://desk-v2.test${path}`, { method });
}

test("GET /health è vivo e non richiede il database", async () => {
  const response = await worker.fetch(request("/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true, service: "desk-v2", environment: "v2-development", status: "alive"
  });
});

test("GET /ready verifica identità, baseline completa, schema e foreign key", async () => {
  const response = await worker.fetch(request("/ready"), env());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true, service: "desk-v2", environment: "v2-development",
    status: "ready", schemaVersion: "0006_project_activity"
  });
});

const invalidReadinessCases = [
  ["binding mancante", env(undefined)],
  ["metadata errati", env(db({ metadata: { ...metadata, system_name: "wrong" } }))],
  ["migrazione extra", env(db({ migrations: [...migrations, "0007_unexpected.sql"] }))],
  ["migrazioni fuori ordine", env(db({
    migrations: [migrations[1], migrations[0], ...migrations.slice(2)]
  }))],
  ["foreign key disabilitate", env(db({ foreignKeys: 0 }))]
];

for (const migration of migrations) {
  invalidReadinessCases.push([
    `migrazione mancante: ${migration}`,
    env(db({ migrations: migrations.filter(name => name !== migration) }))
  ]);
}

for (const table of tables) {
  invalidReadinessCases.push([
    `tabella mancante: ${table}`,
    env(db({ tables: tables.filter(name => name !== table) }))
  ]);
}

for (const column of containerColumns) {
  invalidReadinessCases.push([
    `colonna containers mancante: ${column}`,
    env(db({ containerColumns: containerColumns.filter(name => name !== column) }))
  ]);
}

for (const [name, runtime] of invalidReadinessCases) {
  test(`/ready fallisce chiuso: ${name}`, async () => {
    if (name === "binding mancante") delete runtime.DESK_V2_DB;
    const response = await worker.fetch(request("/ready"), runtime);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      success: false, status: "not_ready",
      error: { code: "FOUNDATION_NOT_READY" }
    });
  });
}

test("route sconosciuta restituisce 404", async () => {
  assert.equal((await worker.fetch(request("/missing"), env())).status, 404);
});

test("un profilo OAuth sconosciuto fallisce chiuso", async () => {
  const oauthWorker = createWorker({ fetchImpl: async () => {
    throw new Error("JWKS must not be requested for an invalid profile");
  } });
  const runtime = {
    DESK_V2_MCP_AUTH_MODE: "oauth",
    DESK_V2_MCP_PROFILE: "unknown-profile",
    DESK_V2_OAUTH_ISSUER: "https://desk-test.example/",
    DESK_V2_OAUTH_AUDIENCE: "https://desk-v2.example/mcp",
    DESK_V2_OAUTH_JWKS_URI: "https://desk-test.example/.well-known/jwks.json",
    DESK_V2_MCP_CANONICAL_URL: "https://desk-v2.example/mcp"
  };
  const response = await oauthWorker.fetch(new Request("https://desk-v2.example/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  }), runtime, {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "MCP_OAUTH_NOT_CONFIGURED" });
});

for (const path of ["/health", "/ready", "/missing"]) {
  test(`POST ${path} restituisce 405`, async () => {
    assert.equal((await worker.fetch(request(path, "POST"), env())).status, 405);
  });
}
