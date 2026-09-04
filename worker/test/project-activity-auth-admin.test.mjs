import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const ACTIONS = "actions-token-fixture-123";
const ADMIN = "admin-token-fixture-456";

function request(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://desk.test${path}`, {
    method: "POST", headers, body: JSON.stringify(body || {})
  });
}

function deliveredDb() {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          return /FROM timeline_outbox/.test(sql) ? {
            event_id: "EVT-1", activity_id: "ACT-1", project_id: "PRJ-1",
            event_type: "PROJECT_ACTIVITY_UPDATED", description: "fixture-only",
            payload_json: null, created_at: "2026-09-04T12:00:00.000Z",
            delivered_at: "2026-09-04T12:01:00.000Z", attempts: 1,
            last_error: null
          } : null;
        },
        async all() { return { results: [] }; },
        async run() { return {}; }
      };
    },
    async batch() { return []; }
  };
}

const env = () => ({ PROJECT_ACTIVITY_ACTIONS_TOKEN: ACTIONS,
  PROJECT_ACTIVITY_ADMIN_TOKEN: ADMIN, DB: deliveredDb(),
  DESK_APPS_SCRIPT_URL: "https://apps.test/exec", DESK_API_TOKEN: "upstream-fixture" });

for (const [name, path, body] of [
  ["getProjectActivity", "/project-activity", { action: "getProjectActivity", activityId: "missing" }],
  ["updateProjectActivity", "/project-activity/update", { action: "updateProjectActivity" }]
]) {
  test(name + " senza token restituisce 401", async () => {
    const response = await worker.fetch(request(path, body), env());
    assert.equal(response.status, 401); assert.equal((await response.json()).error.code, "UNAUTHORIZED");
  });
  test(name + " con token errato restituisce 401", async () => {
    const response = await worker.fetch(request(path, body, "wrong-token-fixture-789"), env());
    assert.equal(response.status, 401);
  });
  test(name + " con Actions token raggiunge il dominio", async () => {
    const response = await worker.fetch(request(path, body, ACTIONS), env());
    assert.notEqual(response.status, 401); assert.ok([400, 404].includes(response.status));
  });
}

test("secret Actions mancante fallisce chiuso", async () => {
  const runtime = env(); delete runtime.PROJECT_ACTIVITY_ACTIONS_TOKEN;
  const response = await worker.fetch(request("/project-activity", {
    action: "getProjectActivity", activityId: "missing"
  }, ACTIONS), runtime);
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "AUTH_NOT_CONFIGURED");
});

for (const path of ["/internal/project-activity/outbox/deliver",
  "/internal/project-activity/outbox/deliver-pending"]) {
  test(path + " senza token è 401", async () => {
    assert.equal((await worker.fetch(request(path, {}), env())).status, 401);
  });
  test(path + " con token errato è 401", async () => {
    assert.equal((await worker.fetch(request(path, {}, "wrong-token-fixture-789"), env())).status, 401);
  });
  test(path + " non accetta Actions token", async () => {
    assert.equal((await worker.fetch(request(path, {}, ACTIONS), env())).status, 401);
  });
}

test("admin token non abilita route Actions", async () => {
  assert.equal((await worker.fetch(request("/project-activity", {
    action: "getProjectActivity", activityId: "missing"
  }, ADMIN), env())).status, 401);
});

test("deliver one autenticata restituisce solo summary compatta", async () => {
  const response = await worker.fetch(request("/internal/project-activity/outbox/deliver",
    { eventId: "EVT-1" }, ADMIN), env());
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.alreadyDelivered, true);
  assert.equal(body.attempts, 1); assert.equal("payload" in body, false);
  assert.equal(JSON.stringify(body).includes(ADMIN), false);
});

test("deliver one autenticata consegna un evento pending", async () => {
  const runtime = env();
  runtime.DB.prepare = sql => ({
    bind() { return this; },
    async first() { return /FROM timeline_outbox/.test(sql) ? {
      event_id: "EVT-PENDING", activity_id: "ACT-1", project_id: "PRJ-1",
      event_type: "PROJECT_ACTIVITY_UPDATED", description: "fixture-only",
      payload_json: "sensitive-fixture-payload", created_at: "2026-09-04T12:00:00.000Z",
      delivered_at: null, attempts: 0, last_error: null
    } : null; },
    async run() { return {}; }, async all() { return { results: [] }; }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true,
    eventId: "EVT-PENDING", created: true });
  try {
    const response = await worker.fetch(request("/internal/project-activity/outbox/deliver",
      { eventId: "EVT-PENDING" }, ADMIN), runtime);
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.delivered, true);
    assert.equal(body.attempts, 1);
    assert.equal(JSON.stringify(body).includes("sensitive-fixture-payload"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("deliver one valida input ed evento inesistente", async () => {
  const invalid = await worker.fetch(request("/internal/project-activity/outbox/deliver",
    { eventId: "bad event" }, ADMIN), env());
  assert.equal(invalid.status, 400);
  const runtime = env(); runtime.DB.prepare = () => ({ bind() { return this; }, async first() { return null; } });
  const missing = await worker.fetch(request("/internal/project-activity/outbox/deliver",
    { eventId: "EVT-MISSING" }, ADMIN), runtime);
  assert.equal(missing.status, 404);
});

test("deliver pending usa default 10, limita a 100 e non espone payload", async () => {
  const response = await worker.fetch(request("/internal/project-activity/outbox/deliver-pending",
    {}, ADMIN), env());
  const body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body,
    { success: true, attempted: 0, delivered: 0, failed: 0, events: [] });
  const invalid = await worker.fetch(request("/internal/project-activity/outbox/deliver-pending",
    { limit: 101 }, ADMIN), env());
  assert.equal(invalid.status, 400);
});

test("secret Admin mancante fallisce chiuso e nessun errore contiene token", async () => {
  const runtime = env(); delete runtime.PROJECT_ACTIVITY_ADMIN_TOKEN;
  const response = await worker.fetch(request("/internal/project-activity/outbox/deliver",
    { eventId: "EVT-1" }, ADMIN), runtime);
  const text = await response.text();
  assert.equal(response.status, 503); assert.equal(text.includes(ADMIN), false);
  assert.equal(text.includes(ACTIONS), false); assert.equal(text.includes("upstream-fixture"), false);
});
