import test from "node:test";
import assert from "node:assert/strict";
import { ProjectActivityOutboxDeliveryService, OutboxDeliveryError } from
  "../project-activity/outbox-delivery.mjs";
import { ProjectActivityRepository } from "../project-activity/repository.mjs";
import { deliverOutboxEvent } from "../worker.js";

const NOW = "2026-09-04T12:00:00.000Z";
const eventFixture = () => ({
  event_id: "EVT-1", activity_id: "ACT-BW", project_id: "PRJ-LOTAR",
  event_type: "PROJECT_ACTIVITY_UPDATED", description: "fixture-only",
  payload_json: JSON.stringify({ test: true }), created_at: NOW,
  delivered_at: null, attempts: 0, last_error: null
});

class OutboxRepository {
  constructor(events = [eventFixture()]) {
    this.events = new Map(events.map(row => [row.event_id, structuredClone(row)]));
    this.pendingLimits = []; this.successes = []; this.failures = [];
  }
  async findOutboxEvent(id) { const row = this.events.get(id); return row ? structuredClone(row) : null; }
  async listPendingOutbox(limit) {
    this.pendingLimits.push(limit);
    return [...this.events.values()].filter(row => !row.delivered_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.event_id.localeCompare(b.event_id))
      .slice(0, limit).map(row => structuredClone(row));
  }
  async recordOutboxSuccess(id, at) {
    const row = this.events.get(id); row.attempts++; row.delivered_at ||= at; row.last_error = null;
    this.successes.push(id);
  }
  async recordOutboxFailure(id, message) {
    const row = this.events.get(id); row.attempts++; if (!row.delivered_at) row.last_error = message;
    this.failures.push(id);
  }
}

function sink(options = {}) {
  const rows = new Map(); let calls = 0;
  return {
    rows,
    get calls() { return calls; },
    async fetch(_url, request) {
      calls++;
      if (options.network) throw new Error("network with token-like fixture hidden");
      if (options.status) return new Response("failure", { status: options.status });
      if (options.invalidJson) return new Response("not-json");
      const body = JSON.parse(request.body);
      const comparable = JSON.stringify([body.projectId, body.eventType, body.description]);
      const previous = rows.get(body.eventId);
      if (previous && previous !== comparable) return Response.json({ success: false,
        error: { code: "TIMELINE_EVENT_CONFLICT" } });
      if (previous) return Response.json({ success: true, eventId: body.eventId,
        created: false, idempotentReplay: true });
      rows.set(body.eventId, comparable);
      if (options.loseFirstResponse && calls === 1) throw new Error("response lost");
      return Response.json({ success: true, eventId: body.eventId, created: true });
    }
  };
}

const service = (repo, fakeSink, options = {}) => new ProjectActivityOutboxDeliveryService(repo, {
  appsScriptUrl: "https://apps.test/exec", token: "test-only",
  fetch: fakeSink.fetch.bind(fakeSink), now: () => NOW, ...options
});

function diagnosticLogger() {
  const entries = [];
  return { entries, error(message, metadata) { entries.push({ message, metadata }); } };
}

test("prima delivery crea sink row e marca delivered con attempts 1", async () => {
  const repo = new OutboxRepository(); const fake = sink();
  const result = await service(repo, fake).deliverOutboxEvent("EVT-1");
  assert.equal(fake.rows.size, 1); assert.equal(result.attempts, 1);
  assert.equal(repo.events.get("EVT-1").delivered_at, NOW);
  assert.equal(repo.events.get("EVT-1").last_error, null);
});

test("fetch nativo conserva il receiver richiesto dal runtime", async () => {
  const originalFetch = globalThis.fetch;
  let receiver;
  globalThis.fetch = async function (_url, request) {
    receiver = this;
    const body = JSON.parse(request.body);
    return Response.json({ success: true, eventId: body.eventId, created: true });
  };
  try {
    const repo = new OutboxRepository();
    const delivery = new ProjectActivityOutboxDeliveryService(repo, {
      appsScriptUrl: "https://apps.test/exec", token: "test-only", now: () => NOW
    });
    const result = await delivery.deliverOutboxEvent("EVT-1");
    assert.equal(receiver, globalThis);
    assert.equal(result.success, true);
    assert.equal(repo.events.get("EVT-1").delivered_at, NOW);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetch iniettato continua a essere usato senza dipendere dal fetch globale", async () => {
  const repo = new OutboxRepository(); let calls = 0;
  const injectedFetch = async (_url, request) => {
    calls++;
    const body = JSON.parse(request.body);
    return Response.json({ success: true, eventId: body.eventId, created: true });
  };
  const delivery = new ProjectActivityOutboxDeliveryService(repo, {
    appsScriptUrl: "https://apps.test/exec", token: "test-only",
    fetch: injectedFetch, now: () => NOW
  });
  const result = await delivery.deliverOutboxEvent("EVT-1");
  assert.equal(calls, 1);
  assert.equal(result.success, true);
});

test("response loss e retry producono una sola Timeline row", async () => {
  const repo = new OutboxRepository(); const fake = sink({ loseFirstResponse: true });
  await assert.rejects(service(repo, fake).deliverOutboxEvent("EVT-1"), { code: "APPS_SCRIPT_NETWORK_ERROR" });
  assert.equal(repo.events.get("EVT-1").attempts, 1);
  assert.ok(repo.events.get("EVT-1").last_error.includes("APPS_SCRIPT_NETWORK_ERROR"));
  const retry = await service(repo, fake).deliverOutboxEvent("EVT-1");
  assert.equal(fake.rows.size, 1); assert.equal(retry.idempotentReplay, true);
  assert.equal(repo.events.get("EVT-1").attempts, 2);
  assert.equal(repo.events.get("EVT-1").last_error, null);
});

test("diagnostica distingue FETCH e non espone secret o URL query", async () => {
  const repo = new OutboxRepository(); const logger = diagnosticLogger();
  const fake = { async fetch() {
    throw new TypeError("fetch failed\n token=test-only https://apps.test/exec?signed=secret");
  } };
  await assert.rejects(service(repo, fake, { logger }).deliverOutboxEvent("EVT-1"),
    { code: "APPS_SCRIPT_NETWORK_ERROR", message: "Apps Script network error" });
  assert.equal(logger.entries.length, 1);
  assert.deepEqual(logger.entries[0], { message: "project_activity_outbox_delivery_failure",
    metadata: { phase: "FETCH", eventId: "EVT-1", eventType: "PROJECT_ACTIVITY_UPDATED",
      errorName: "TypeError", errorMessage: "fetch failed  token=[REDACTED] https://apps.test",
      upstreamOrigin: "https://apps.test" } });
  assert.doesNotMatch(JSON.stringify(logger.entries), /test-only|signed=secret|\/exec/);
});

test("diagnostica distingue RESPONSE_READ mantenendo INVALID_RESPONSE", async () => {
  const repo = new OutboxRepository(); const logger = diagnosticLogger();
  const fake = { async fetch() { return { ok: true, status: 200,
    url: "https://script.googleusercontent.com/macros/echo?user_content_key=sensitive",
    async text() { throw new Error("body read failed token=test-only"); } }; } };
  await assert.rejects(service(repo, fake, { logger }).deliverOutboxEvent("EVT-1"),
    { code: "APPS_SCRIPT_INVALID_RESPONSE" });
  assert.equal(logger.entries[0].metadata.phase, "RESPONSE_READ");
  assert.equal(logger.entries[0].metadata.responseStatus, 200);
  assert.equal(logger.entries[0].metadata.finalOrigin, "https://script.googleusercontent.com");
  assert.doesNotMatch(JSON.stringify(logger.entries), /test-only|user_content_key|sensitive/);
});

test("diagnostica distingue RESPONSE_PARSE senza loggare il body", async () => {
  const repo = new OutboxRepository(); const logger = diagnosticLogger();
  const sensitiveBody = "not-json token=test-only payload-fixture-secret";
  const fake = { async fetch() { return { ok: true, status: 200,
    url: "https://apps.test/exec?key=sensitive", async text() { return sensitiveBody; } }; } };
  await assert.rejects(service(repo, fake, { logger }).deliverOutboxEvent("EVT-1"),
    { code: "APPS_SCRIPT_INVALID_RESPONSE" });
  assert.equal(logger.entries[0].metadata.phase, "RESPONSE_PARSE");
  assert.doesNotMatch(JSON.stringify(logger.entries),
    /not-json|test-only|payload-fixture-secret|key=sensitive/);
  assert.equal(logger.entries[0].metadata.errorMessage, "Invalid JSON response");
  assert.equal(repo.events.get("EVT-1").attempts, 1);
  assert.equal(repo.events.get("EVT-1").delivered_at, null);
});

test("evento già delivered non richiama Apps Script", async () => {
  const row = eventFixture(); row.delivered_at = NOW; row.attempts = 1;
  const repo = new OutboxRepository([row]); const fake = sink();
  const result = await service(repo, fake).deliverOutboxEvent("EVT-1");
  assert.equal(result.alreadyDelivered, true); assert.equal(fake.calls, 0);
  assert.equal(repo.events.get("EVT-1").attempts, 1);
});

test("evento inesistente è distinto", async () => {
  await assert.rejects(service(new OutboxRepository([]), sink()).deliverOutboxEvent("MISSING"),
    error => error instanceof OutboxDeliveryError && error.code === "OUTBOX_EVENT_NOT_FOUND");
});

for (const [name, fake, code, retryable] of [
  ["rete", sink({ network: true }), "APPS_SCRIPT_NETWORK_ERROR", true],
  ["Apps Script 500", sink({ status: 500 }), "APPS_SCRIPT_TEMPORARY_ERROR", true],
  ["Apps Script 400", sink({ status: 400 }), "APPS_SCRIPT_PERMANENT_ERROR", false],
  ["JSON invalido", sink({ invalidJson: true }), "APPS_SCRIPT_INVALID_RESPONSE", true]
]) {
  test(name + " incrementa attempts e non marca delivered", async () => {
    const repo = new OutboxRepository();
    await assert.rejects(service(repo, fake).deliverOutboxEvent("EVT-1"),
      error => error.code === code && error.retryable === retryable);
    const row = repo.events.get("EVT-1");
    assert.equal(row.attempts, 1); assert.equal(row.delivered_at, null); assert.ok(row.last_error);
    assert.equal(row.last_error.includes("test-only"), false);
  });
}

test("conflitto sink non marca delivered", async () => {
  const repo = new OutboxRepository(); const fake = sink();
  fake.rows.set("EVT-1", JSON.stringify(["PRJ-OTHER", "TYPE", "different"]));
  await assert.rejects(service(repo, fake).deliverOutboxEvent("EVT-1"), { code: "SINK_IDEMPOTENCY_CONFLICT" });
  assert.equal(repo.events.get("EVT-1").delivered_at, null);
});

test("due delivery concorrenti dipendono dal sink idempotente e creano una riga", async () => {
  const fake = sink(); const repoA = new OutboxRepository(); const repoB = new OutboxRepository();
  const [a, b] = await Promise.all([
    service(repoA, fake).deliverOutboxEvent("EVT-1"),
    service(repoB, fake).deliverOutboxEvent("EVT-1")
  ]);
  assert.equal(fake.rows.size, 1); assert.equal(a.success, true); assert.equal(b.success, true);
});

test("deliverPendingOutbox applica limite e ordine deterministico", async () => {
  const older = eventFixture(); older.event_id = "EVT-0"; older.created_at = "2026-09-03T12:00:00.000Z";
  const repo = new OutboxRepository([eventFixture(), older]); const fake = sink();
  const results = await service(repo, fake).deliverPendingOutbox(1);
  assert.deepEqual(repo.pendingLimits, [1]); assert.deepEqual(results.map(row => row.eventId), ["EVT-0"]);
});

test("limite assente, zero o eccessivo è rifiutato senza scansione", async () => {
  const repo = new OutboxRepository(); const delivery = service(repo, sink());
  for (const limit of [undefined, 0, 101]) await assert.rejects(delivery.deliverPendingOutbox(limit),
    { code: "INVALID_DELIVERY_LIMIT" });
  assert.deepEqual(repo.pendingLimits, []);
});

test("repository usa lookup diretto, pending limit e update atomici", async () => {
  const statements = [];
  const db = { prepare(sql) { return { sql: sql.replace(/\s+/g, " ").trim(),
    bind(...args) { this.args = args; statements.push(this); return this; },
    async first() { return null; }, async all() { return { results: [] }; }, async run() { return {}; } }; } };
  const repo = new ProjectActivityRepository(db);
  await repo.findOutboxEvent("EVT"); await repo.listPendingOutbox(10);
  await repo.recordOutboxSuccess("EVT", NOW); await repo.recordOutboxFailure("EVT", "safe");
  assert.match(statements[0].sql, /WHERE event_id = \? LIMIT 1/);
  assert.match(statements[1].sql, /WHERE delivered_at IS NULL ORDER BY created_at, event_id LIMIT \?/);
  assert.equal(statements[1].args[0], 10);
  assert.match(statements[2].sql, /attempts = attempts \+ 1/);
  assert.match(statements[3].sql, /attempts = attempts \+ 1/);
});

test("primitive Worker segnala D1_NOT_CONFIGURED", async () => {
  await assert.rejects(deliverOutboxEvent("EVT", {}), { code: "D1_NOT_CONFIGURED" });
});
