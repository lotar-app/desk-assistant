import test from "node:test";
import assert from "node:assert/strict";
import { ProjectActivityRepository } from "../project-activity/repository.mjs";
import { ProjectActivityService } from "../project-activity/service.mjs";
import { ProjectActivityWriteService } from "../project-activity/write-service.mjs";
import worker from "../worker.js";

const NOW = "2026-09-04T12:00:00.000Z";

function activity() {
  return {
    activity_id: "ACT-BW", project_id: "PRJ-LOTAR", kind: "CAMPAIGN",
    canonical_name: "Black Winter", normalized_name: "black winter",
    status: "IN_PROGRESS", focus: "fixture-only", next_action: null,
    summary: null, schema_version: 1, snapshot_version: 4,
    created_at: NOW, updated_at: NOW, last_consolidated_at: NOW,
    last_event_id: null
  };
}

function item(key = "test.flag", value = "fixture-only", revision = 1) {
  const valueJson = JSON.stringify(value);
  return {
    activity_id: "ACT-BW", item_key: key, item_type: "DECISION",
    value_json: valueJson, item_revision: revision, approved_at: NOW,
    updated_at: NOW, source_event_id: null,
    size_bytes: new TextEncoder().encode(valueJson).length
  };
}

class TransactionalRepository {
  constructor(options = {}) {
    this.activities = new Map((options.activities || [activity()]).map(row => [row.activity_id, structuredClone(row)]));
    this.aliases = new Map();
    (options.aliases || [{ project_id: "PRJ-LOTAR", alias_key: "black winter", alias: "Black Winter", activity_id: "ACT-BW", created_at: NOW }])
      .forEach(row => this.aliases.set(`${row.project_id}|${row.alias_key}`, structuredClone(row)));
    this.items = new Map((options.items || [item()]).map(row => [`${row.activity_id}|${row.item_key}`, structuredClone(row)]));
    this.idempotency = new Map(); this.revisions = []; this.outbox = [];
    this.failCommit = false; this.commitCalls = 0; this.deliveryCalls = 0;
    this.listCompactCalls = 0; this.listItemsCalls = 0;
  }
  async findIdempotency(key) { return this.idempotency.get(key) || null; }
  async findById(id) { return this.activities.get(id) || null; }
  async findByProjectAlias(projectId, aliasKey) {
    const alias = this.aliases.get(`${projectId}|${aliasKey}`);
    return alias ? this.activities.get(alias.activity_id) || null : null;
  }
  async findAlias(projectId, aliasKey) { return this.aliases.get(`${projectId}|${aliasKey}`) || null; }
  async getItemsByKeys(activityId, keys) {
    return keys.map(key => this.items.get(`${activityId}|${key}`)).filter(Boolean);
  }
  async listCompactItems(activityId, maxBytes) {
    this.listCompactCalls++;
    return [...this.items.values()].filter(row => row.activity_id === activityId).map(row => ({
      ...row,
      value_json: row.item_type === "DECISION" || row.size_bytes <= maxBytes
        ? row.value_json : null
    }));
  }
  async listItems(activityId) {
    this.listItemsCalls++;
    return [...this.items.values()].filter(row => row.activity_id === activityId);
  }
  async commitWrite(plan) {
    this.commitCalls++;
    if (this.failCommit) throw new Error("simulated batch rollback");
    if (this.idempotency.has(plan.idempotencyKey)) throw new Error("unique idempotency");
    const activities = new Map([...this.activities].map(([key, value]) => [key, structuredClone(value)]));
    const aliases = new Map([...this.aliases].map(([key, value]) => [key, structuredClone(value)]));
    const items = new Map([...this.items].map(([key, value]) => [key, structuredClone(value)]));
    const revisions = structuredClone(this.revisions); const outbox = structuredClone(this.outbox);
    if (!plan.created) {
      const current = activities.get(plan.activity.activity_id);
      if (!current || current.snapshot_version !== plan.expectedSnapshotVersion) throw new Error("stale");
    }
    activities.set(plan.activity.activity_id, structuredClone(plan.activity));
    plan.aliasAdds.forEach(row => {
      const key = `${row.projectId}|${row.aliasKey}`;
      if (aliases.has(key)) throw new Error("alias conflict");
      aliases.set(key, { project_id: row.projectId, alias_key: row.aliasKey,
        alias: row.alias, activity_id: plan.activity.activity_id, created_at: plan.now });
    });
    plan.aliasRemoves.forEach(row => aliases.delete(`${row.projectId}|${row.aliasKey}`));
    plan.itemUpserts.forEach(row => {
      const value = { activity_id: plan.activity.activity_id, item_key: row.key,
        item_type: row.type, value_json: row.valueJson, item_revision: row.revision,
        approved_at: row.approvedAt, updated_at: plan.now, source_event_id: null };
      value.size_bytes = new TextEncoder().encode(value.value_json).length;
      items.set(`${plan.activity.activity_id}|${row.key}`, value);
    });
    plan.itemDeletes.forEach(row => items.delete(`${plan.activity.activity_id}|${row.key}`));
    revisions.push(...structuredClone(plan.revisions));
    if (plan.outbox) outbox.push(structuredClone(plan.outbox));
    this.activities = activities; this.aliases = aliases; this.items = items;
    this.revisions = revisions; this.outbox = outbox;
    this.idempotency.set(plan.idempotencyKey, {
      idempotency_key: plan.idempotencyKey, activity_id: plan.activity.activity_id,
      request_hash: plan.requestHash, response_json: JSON.stringify(plan.response), created_at: plan.now
    });
    return [];
  }
}

function services(repo, options = {}) {
  const resolveProjectName = async name => name === "Lotar"
    ? { id: "PRJ-LOTAR", name: "Lotar" } : null;
  const read = new ProjectActivityService(repo, { compactContentMaxBytes: 32, resolveProjectName });
  let sequence = 0;
  const write = new ProjectActivityWriteService(repo, read, {
    resolveProjectName, now: () => NOW, id: () => `ID-${++sequence}`,
    ...options
  });
  return { read, write };
}

function request(overrides = {}) {
  return {
    action: "updateProjectActivity",
    project: { id: "PRJ-LOTAR", name: "Lotar" },
    activity: { id: "ACT-BW", name: "Black Winter", kind: "CAMPAIGN", createIfMissing: false },
    expectedSnapshotVersion: 4, idempotencyKey: "request-1",
    patch: { set: {}, clear: [] }, items: [], aliases: { add: [], remove: [] },
    timeline: { mode: "AUTO", summary: "fixture-only" },
    source: { type: "CUSTOM_GPT", conversationId: "fixture-only" },
    ...overrides
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}

test("crea attività con versione 1 e canonical alias", async () => {
  const repo = new TransactionalRepository({ activities: [], aliases: [], items: [] });
  const result = await services(repo).write.update(request({
    activity: { name: "Black Winter", kind: "CAMPAIGN", createIfMissing: true },
    expectedSnapshotVersion: 0
  }));
  assert.equal(result.created, true); assert.equal(result.snapshotVersion, 1);
  assert.ok(repo.aliases.has("PRJ-LOTAR|black winter"));
});

test("aggiorna core field", async () => {
  const repo = new TransactionalRepository();
  const result = await services(repo).write.update(request({ patch: { set: { focus: "fixture-updated" }, clear: [] } }));
  assert.equal(result.snapshotVersion, 5); assert.equal(repo.activities.get("ACT-BW").focus, "fixture-updated");
});

test("clear core field esplicito", async () => {
  const repo = new TransactionalRepository();
  await services(repo).write.update(request({ patch: { set: {}, clear: ["focus"] } }));
  assert.equal(repo.activities.get("ACT-BW").focus, null);
});

test("patch invalida o set/clear sovrapposti sono rifiutati", async () => {
  const write = services(new TransactionalRepository()).write;
  await expectCode(write.update(request({ patch: { set: { focus: "x" }, clear: ["focus"] } })), "INVALID_PATCH");
});

test("campo core assente resta invariato", async () => {
  const repo = new TransactionalRepository();
  await services(repo).write.update(request());
  assert.equal(repo.activities.get("ACT-BW").focus, "fixture-only");
});

test("UPSERT nuovo item parte da revision 1", async () => {
  const repo = new TransactionalRepository();
  await services(repo).write.update(request({ items: [{ op: "UPSERT", key: "test.version", type: "DECISION", value: 1 }] }));
  assert.equal(repo.items.get("ACT-BW|test.version").item_revision, 1);
});

test("UPSERT esistente incrementa itemRevision", async () => {
  const repo = new TransactionalRepository();
  await services(repo).write.update(request({ items: [{ op: "UPSERT", key: "test.flag", type: "DECISION", value: "fixture-updated" }] }));
  assert.equal(repo.items.get("ACT-BW|test.flag").item_revision, 2);
});

test("uguaglianza semantica ignora ordine proprietà", async () => {
  const repo = new TransactionalRepository({ items: [item("test.flag", { a: 1, b: 2 })] });
  const result = await services(repo).write.update(request({ items: [{ op: "UPSERT", key: "test.flag", type: "DECISION", value: { b: 2, a: 1 } }] }));
  assert.equal(result.noOp, true); assert.equal(result.snapshotVersion, 4);
});

test("patch e più item incrementano snapshot una sola volta", async () => {
  const repo = new TransactionalRepository();
  const result = await services(repo).write.update(request({
    patch: { set: { focus: "fixture-updated" }, clear: [] },
    items: [{ op: "UPSERT", key: "test.version", type: "DECISION", value: 1 },
      { op: "UPSERT", key: "test.flag", type: "DECISION", value: "changed" }]
  }));
  assert.equal(result.snapshotVersion, 5); assert.equal(repo.revisions.length, 2);
  assert.ok(repo.revisions.every(row => row.itemRevision >= 1));
});

test("DELETE registra revisione previous/new", async () => {
  const repo = new TransactionalRepository();
  await services(repo).write.update(request({ items: [{ op: "DELETE", key: "test.flag", reason: "fixture-only" }] }));
  assert.equal(repo.items.has("ACT-BW|test.flag"), false);
  assert.equal(repo.revisions[0].previousValueJson, '"fixture-only"');
  assert.equal(repo.revisions[0].newValueJson, null);
});

test("DELETE inesistente è NO-OP idempotente", async () => {
  const repo = new TransactionalRepository();
  const result = await services(repo).write.update(request({ items: [{ op: "DELETE", key: "test.missing", reason: "fixture-only" }] }));
  assert.equal(result.noOp, true); assert.equal(repo.revisions.length, 0);
});

test("DELETE senza reason è errore", async () => {
  await expectCode(services(new TransactionalRepository()).write.update(request({ items: [{ op: "DELETE", key: "test.flag" }] })), "INVALID_ITEM_OPERATION");
});

test("item type non ammesso è errore", async () => {
  await expectCode(services(new TransactionalRepository()).write.update(request({ items: [{ op: "UPSERT", key: "test.version", type: "OTHER", value: 1 }] })), "INVALID_ITEM_TYPE");
});

test("expectedSnapshotVersion corretto è accettato", async () => {
  const result = await services(new TransactionalRepository()).write.update(request());
  assert.equal(result.success, true);
});

test("expectedSnapshotVersion stale produce conflitto", async () => {
  await expectCode(services(new TransactionalRepository()).write.update(request({ expectedSnapshotVersion: 3 })), "SNAPSHOT_VERSION_CONFLICT");
});

test("creazione richiede expectedSnapshotVersion zero", async () => {
  const repo = new TransactionalRepository({ activities: [], aliases: [], items: [] });
  await expectCode(services(repo).write.update(request({
    activity: { name: "Black Winter", kind: "CAMPAIGN", createIfMissing: true },
    expectedSnapshotVersion: 1
  })), "SNAPSHOT_VERSION_CONFLICT");
});

test("retry idempotente restituisce la stessa risposta", async () => {
  const repo = new TransactionalRepository(); const write = services(repo).write;
  const payload = request({ patch: { set: { focus: "fixture-updated" }, clear: [] } });
  const first = await write.update(payload); const second = await write.update(payload);
  assert.deepEqual(second, first); assert.equal(repo.commitCalls, 1);
  assert.equal(repo.outbox.length, 1); assert.equal(repo.revisions.length, 0);
});

test("idempotency key riutilizzata con payload diverso produce conflitto", async () => {
  const repo = new TransactionalRepository(); const write = services(repo).write;
  await write.update(request());
  await expectCode(write.update(request({ patch: { set: { focus: "different" }, clear: [] } })), "IDEMPOTENCY_CONFLICT");
});

test("alias add e duplicato same activity", async () => {
  const repo = new TransactionalRepository(); const write = services(repo).write;
  const result = await write.update(request({ aliases: { add: [" BW ", "BW"], remove: [] } }));
  assert.equal(repo.aliases.get("PRJ-LOTAR|bw").activity_id, "ACT-BW");
  assert.equal(result.changedKeys.filter(key => key === "alias:+bw").length, 1);
});

test("alias già presente sulla stessa activity è NO-OP", async () => {
  const repo = new TransactionalRepository({ aliases: [
    { project_id: "PRJ-LOTAR", alias_key: "black winter", alias: "Black Winter", activity_id: "ACT-BW", created_at: NOW },
    { project_id: "PRJ-LOTAR", alias_key: "bw", alias: "BW", activity_id: "ACT-BW", created_at: NOW }
  ]});
  const result = await services(repo).write.update(request({ aliases: { add: ["BW"], remove: [] } }));
  assert.equal(result.noOp, true);
});

test("alias collision altra activity produce conflitto", async () => {
  const repo = new TransactionalRepository({ aliases: [
    { project_id: "PRJ-LOTAR", alias_key: "black winter", alias: "Black Winter", activity_id: "ACT-BW", created_at: NOW },
    { project_id: "PRJ-LOTAR", alias_key: "taken", alias: "Taken", activity_id: "ACT-OTHER", created_at: NOW }
  ]});
  await expectCode(services(repo).write.update(request({ aliases: { add: ["Taken"], remove: [] } })), "ALIAS_CONFLICT");
});

test("alias remove esplicito", async () => {
  const repo = new TransactionalRepository({ aliases: [
    { project_id: "PRJ-LOTAR", alias_key: "black winter", alias: "Black Winter", activity_id: "ACT-BW", created_at: NOW },
    { project_id: "PRJ-LOTAR", alias_key: "bw", alias: "BW", activity_id: "ACT-BW", created_at: NOW }
  ]});
  await services(repo).write.update(request({ aliases: { add: [], remove: ["BW"] } }));
  assert.equal(repo.aliases.has("PRJ-LOTAR|bw"), false);
});

test("canonical alias non è removibile", async () => {
  await expectCode(services(new TransactionalRepository()).write.update(request({ aliases: { add: [], remove: ["Black Winter"] } })), "INVALID_PATCH");
});

test("alias add/remove sovrapposti o non-array sono rifiutati", async () => {
  const write = services(new TransactionalRepository()).write;
  await expectCode(write.update(request({ aliases: { add: ["BW"], remove: [" bw "] } })), "INVALID_PATCH");
  await expectCode(write.update(request({ aliases: { add: "BW", remove: [] } })), "INVALID_PATCH");
});

test("outbox una sola riga per multi-change e nuovo snapshot", async () => {
  const repo = new TransactionalRepository();
  const result = await services(repo).write.update(request({ patch: { set: { focus: "changed" }, clear: [] }, items: [{ op: "UPSERT", key: "test.version", type: "DECISION", value: 1 }] }));
  assert.equal(repo.outbox.length, 1); assert.equal(repo.outbox[0].payload.snapshotVersion, 5);
  assert.equal(result.timelineDelivery, "PENDING"); assert.ok(result.timelineEventId);
  assert.equal(repo.deliveryCalls, 0);
});

test("NO-OP non crea outbox", async () => {
  const repo = new TransactionalRepository(); const result = await services(repo).write.update(request());
  assert.equal(result.noOp, true); assert.equal(repo.outbox.length, 0);
  assert.equal(result.timelineEventId, null);
});

test("revision history usa il nuovo snapshotVersion nel piano D1", async () => {
  const statements = [];
  const db = { prepare(sql) { return { sql: sql.replace(/\s+/g, " ").trim(), bind(...args) { this.args = args; statements.push(this); return this; } }; }, async batch(batch) { this.batch = batch; return []; } };
  const repo = new ProjectActivityRepository(db);
  await repo.commitWrite({ created: false, noOp: false, expectedSnapshotVersion: 4,
    idempotencyKey: "key", requestHash: "hash", response: {}, now: NOW,
    source: "TEST", activity: { ...activity(), snapshot_version: 5 },
    aliasAdds: [], aliasRemoves: [], itemUpserts: [], itemDeletes: [],
    revisions: [{ revisionId: "REV", key: "test.flag", operation: "UPSERT",
      previousValueJson: '"a"', newValueJson: '"b"', itemRevision: 2, reason: "" }],
    outbox: null });
  const revision = statements.find(row => /project_activity_item_revisions/.test(row.sql));
  assert.equal(revision.args[7], 5); assert.equal(db.batch.length, 3);
  assert.match(statements[0].sql, /snapshot_version = \?/);
});

test("errore intermedio simulato non lascia modifiche parziali", async () => {
  const repo = new TransactionalRepository(); repo.failCommit = true;
  const before = structuredClone(repo.activities.get("ACT-BW"));
  await assert.rejects(services(repo).write.update(request({ patch: { set: { focus: "changed" }, clear: [] } })));
  assert.deepEqual(repo.activities.get("ACT-BW"), before);
  assert.equal(repo.revisions.length, 0); assert.equal(repo.outbox.length, 0);
});

test("activity inesistente senza createIfMissing", async () => {
  await expectCode(services(new TransactionalRepository()).write.update(request({ activity: { name: "Missing", kind: "CAMPAIGN", createIfMissing: false } })), "ACTIVITY_NOT_FOUND");
});

test("project inesistente", async () => {
  await expectCode(services(new TransactionalRepository()).write.update(request({ project: { name: "Missing" } })), "PROJECT_NOT_FOUND");
});

test("response contiene snapshot COMPACT aggiornato", async () => {
  const result = await services(new TransactionalRepository()).write.update(request({ items: [{ op: "UPSERT", key: "test.version", type: "DECISION", value: 1 }] }));
  assert.equal(result.snapshot.mode, "COMPACT");
  assert.equal(result.snapshot.decisionsApproved["test.version"].value, 1);
});

test("write planning usa lookup indirizzati anche con molte revisioni", async () => {
  const repo = new TransactionalRepository(); repo.revisions = Array.from({ length: 10000 }, (_, i) => ({ revisionId: `OLD-${i}` }));
  await services(repo).write.update(request({ items: [{ op: "UPSERT", key: "test.version", type: "DECISION", value: 1 }] }));
  assert.equal(repo.listItemsCalls, 0); assert.equal(repo.listCompactCalls, 1);
});

test("Worker update restituisce D1_NOT_CONFIGURED senza binding", async () => {
  const response = await worker.fetch(new Request("https://desk.test/project-activity/update", {
    method: "POST",
    headers: { Authorization: "Bearer actions-test-token" },
    body: JSON.stringify({ action: "updateProjectActivity" })
  }), { PROJECT_ACTIVITY_ACTIONS_TOKEN: "actions-test-token" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "D1_NOT_CONFIGURED");
});
