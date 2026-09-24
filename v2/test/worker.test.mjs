import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const metadata = {
  environment: "v2-development",
  schema_family: "desk-v2-foundation",
  system_name: "desk-v2"
};

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
            return { results: [{ name: options.migration || "0001_foundation.sql" }] };
          }
          if (/sqlite_master/.test(sql)) {
            return { results: (options.tables || ["containers", "d1_migrations",
              "system_metadata", "tasks"]).map(name => ({ name })) };
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

test("GET /ready verifica identità, schema, migration e foreign key", async () => {
  const response = await worker.fetch(request("/ready"), env());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true, service: "desk-v2", environment: "v2-development",
    status: "ready", schemaVersion: "0001_foundation"
  });
});

for (const [name, runtime] of [
  ["binding mancante", env(undefined)],
  ["metadata errati", env(db({ metadata: { ...metadata, system_name: "wrong" } }))],
  ["migration mancante", env(db({ migration: "other.sql" }))],
  ["schema incompleto", env(db({ tables: ["system_metadata"] }))],
  ["foreign key disabilitate", env(db({ foreignKeys: 0 }))]
]) {
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

for (const path of ["/health", "/ready", "/missing"]) {
  test(`POST ${path} restituisce 405`, async () => {
    assert.equal((await worker.fetch(request(path, "POST"), env())).status, 405);
  });
}
