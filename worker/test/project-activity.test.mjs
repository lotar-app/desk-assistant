import test from "node:test";
import assert from "node:assert/strict";
import { normalizeActivityAlias } from "../project-activity/normalization.mjs";
import { ProjectActivityRepository } from "../project-activity/repository.mjs";
import { ProjectActivityService } from "../project-activity/service.mjs";
import worker from "../worker.js";

const core = (id = "ACT-BW", projectId = "PRJ-LOTAR") => ({
  activity_id: id, project_id: projectId, kind: "CAMPAIGN",
  canonical_name: "Black Winter", normalized_name: "black winter",
  status: "IN_PROGRESS", focus: "Fixture focus", next_action: "Fixture action",
  summary: "Fixture-only summary", schema_version: 1, snapshot_version: 3,
  created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-02T10:00:00Z",
  last_consolidated_at: "2026-09-02T10:00:00Z", last_event_id: null
});

const item = (key, type, value, revision = 1) => {
  const valueJson = JSON.stringify(value);
  return {
    activity_id: "ACT-BW", item_key: key, item_type: type,
    value_json: valueJson, item_revision: revision,
    approved_at: "2026-09-02T10:00:00Z", updated_at: "2026-09-02T10:00:00Z",
    source_event_id: null, size_bytes: new TextEncoder().encode(valueJson).length
  };
};

class MemoryRepository {
  constructor(options = {}) {
    this.activities = new Map((options.activities || [core()]).map(row => [row.activity_id, row]));
    this.aliases = options.aliases || [
      { projectId: "PRJ-LOTAR", aliasKey: "black winter", activityId: "ACT-BW" }
    ];
    this.items = options.items || [
      item("test.flag", "DECISION", "fixture-only"),
      item("test.context", "TECHNICAL_CONTEXT", "fixture-only"),
      item("test.content.short", "CONTENT", "fixture-only"),
      item("test.content.long", "CONTENT", "x".repeat(64))
    ];
    this.calls = {
      byId: 0, projectAlias: 0, globalAlias: 0,
      listItems: 0, compactItems: 0, keys: 0
    };
    this.simulatedUnrelatedRows = options.simulatedUnrelatedRows || 0;
  }
  async findById(id) { this.calls.byId++; return this.activities.get(id) || null; }
  async findByProjectAlias(projectId, aliasKey) {
    this.calls.projectAlias++;
    const alias = this.aliases.find(row => row.projectId === projectId && row.aliasKey === aliasKey);
    return alias ? this.activities.get(alias.activityId) || null : null;
  }
  async findByGlobalAlias(aliasKey) {
    this.calls.globalAlias++;
    return this.aliases.filter(row => row.aliasKey === aliasKey).map(row => {
      const activity = this.activities.get(row.activityId);
      return { activity_id: activity.activity_id, project_id: activity.project_id,
        canonical_name: activity.canonical_name };
    });
  }
  async listItems(activityId) {
    this.calls.listItems++;
    return this.items.filter(row => row.activity_id === activityId);
  }
  async listCompactItems(activityId, maxBytes) {
    this.calls.compactItems++;
    return this.items.filter(row => row.activity_id === activityId).map(row => ({
      ...row,
      value_json: row.item_type === "DECISION" || row.size_bytes <= maxBytes
        ? row.value_json
        : null
    }));
  }
  async getItemsByKeys(activityId, keys) {
    this.calls.keys++;
    return this.items.filter(row => row.activity_id === activityId && keys.includes(row.item_key));
  }
}

const makeService = (repository, options = {}) => new ProjectActivityService(repository, {
  compactContentMaxBytes: options.threshold ?? 32,
  resolveProjectName: options.resolveProjectName || (async name =>
    name.toLowerCase() === "lotar" ? { id: "PRJ-LOTAR", name: "Lotar" } : null)
});

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}

test("normalizza trim, Unicode, maiuscole e spazi", () => {
  assert.equal(normalizeActivityAlias(" Black   Winter "), "black winter");
  assert.equal(normalizeActivityAlias("BLACK WINTER"), "black winter");
  assert.equal(normalizeActivityAlias("Ｂｌａｃｋ Winter"), "black winter");
});

test("lookup projectId + alias", async () => {
  const repo = new MemoryRepository();
  const result = await makeService(repo).get({ projectId: "PRJ-LOTAR", activity: "BLACK WINTER" });
  assert.equal(result.activityId, "ACT-BW"); assert.equal(repo.calls.projectAlias, 1);
});

test("lookup projectName + alias", async () => {
  const result = await makeService(new MemoryRepository()).get({ projectName: "Lotar", activity: "Black Winter" });
  assert.equal(result.projectId, "PRJ-LOTAR"); assert.equal(result.activity.projectName, "Lotar");
});

test("lookup alias globale unico", async () => {
  const repo = new MemoryRepository();
  const result = await makeService(repo).get({ activity: "Black Winter" });
  assert.equal(result.activityId, "ACT-BW"); assert.equal(repo.calls.globalAlias, 1);
});

test("lookup alias globale ambiguo", async () => {
  const second = core("ACT-BW-2", "PRJ-OTHER");
  const repo = new MemoryRepository({ activities: [core(), second], aliases: [
    { projectId: "PRJ-LOTAR", aliasKey: "black winter", activityId: "ACT-BW" },
    { projectId: "PRJ-OTHER", aliasKey: "black winter", activityId: "ACT-BW-2" }
  ]});
  await assert.rejects(makeService(repo).get({ activity: "Black Winter" }), error =>
    error.code === "AMBIGUOUS_ACTIVITY" && error.details.candidates.length === 2);
});

test("attività inesistente", async () => {
  await expectCode(makeService(new MemoryRepository()).get({ projectId: "PRJ-LOTAR", activity: "Missing" }), "ACTIVITY_NOT_FOUND");
});

test("progetto inesistente", async () => {
  await expectCode(makeService(new MemoryRepository()).get({ projectName: "Missing", activity: "Black Winter" }), "PROJECT_NOT_FOUND");
});

test("COMPACT restituisce sezioni correnti", async () => {
  const result = await makeService(new MemoryRepository()).get({ projectId: "PRJ-LOTAR", activity: "Black Winter", mode: "COMPACT" });
  assert.equal(result.decisionsApproved["test.flag"].value, "fixture-only");
  assert.ok(result.approvedContentIndex["test.content.short"]);
});

test("FULL restituisce tutti gli item", async () => {
  const result = await makeService(new MemoryRepository()).get({ activityId: "ACT-BW", mode: "FULL" });
  assert.equal(Object.keys(result.items).length, 4);
});

test("KEYS restituisce solo le chiavi richieste", async () => {
  const result = await makeService(new MemoryRepository()).get({ activityId: "ACT-BW", mode: "KEYS", keys: ["test.flag"] });
  assert.deepEqual(Object.keys(result.items), ["test.flag"]);
});

test("KEYS singola chiave", async () => {
  const result = await makeService(new MemoryRepository()).get({ activityId: "ACT-BW", mode: "KEYS", keys: ["test.content.short"] });
  assert.equal(result.items["test.content.short"].value, "fixture-only");
});

test("KEYS multiple", async () => {
  const keys = ["test.flag", "test.context"];
  const result = await makeService(new MemoryRepository()).get({ activityId: "ACT-BW", mode: "KEYS", keys });
  assert.deepEqual(Object.keys(result.items), keys);
});

test("KEYS chiave inesistente restituisce null", async () => {
  const result = await makeService(new MemoryRepository()).get({ activityId: "ACT-BW", mode: "KEYS", keys: ["test.missing"] });
  assert.equal(result.items["test.missing"], null);
});

test("KEYS vuoto è INVALID_KEYS", async () => {
  await expectCode(makeService(new MemoryRepository()).get({ activityId: "ACT-BW", mode: "KEYS", keys: [] }), "INVALID_KEYS");
});

test("canonicalName usa lo stesso alias lookup", async () => {
  const result = await makeService(new MemoryRepository()).get({ projectId: "PRJ-LOTAR", activity: " Black Winter " });
  assert.equal(result.canonicalName, "Black Winter");
});

test("attività omonime restano distinte per progetto", async () => {
  const second = core("ACT-BW-2", "PRJ-OTHER");
  const repo = new MemoryRepository({ activities: [core(), second], aliases: [
    { projectId: "PRJ-LOTAR", aliasKey: "black winter", activityId: "ACT-BW" },
    { projectId: "PRJ-OTHER", aliasKey: "black winter", activityId: "ACT-BW-2" }
  ]});
  const result = await makeService(repo).get({ projectId: "PRJ-OTHER", activity: "Black Winter" });
  assert.equal(result.activityId, "ACT-BW-2");
});

test("COMPACT indicizza contenuto sopra soglia senza valore", async () => {
  const repo = new MemoryRepository();
  const result = await makeService(repo).get({ activityId: "ACT-BW", mode: "COMPACT" });
  assert.ok(result.approvedContentIndex["test.content.long"]);
  assert.equal(result.contentsApproved["test.content.long"], undefined);
  assert.equal(repo.calls.compactItems, 1);
  assert.equal(repo.calls.listItems, 0);
});

test("COMPACT query non trasferisce value_json grande", async () => {
  const repo = new MemoryRepository();
  const rows = await repo.listCompactItems("ACT-BW", 32);
  assert.equal(rows.find(row => row.item_key === "test.content.long").value_json, null);
  assert.notEqual(rows.find(row => row.item_key === "test.content.short").value_json, null);
});

test("FULL include contenuto sopra soglia", async () => {
  const result = await makeService(new MemoryRepository()).get({ activityId: "ACT-BW", mode: "FULL" });
  assert.equal(result.items["test.content.long"].value.length, 64);
});

test("KEYS non carica tutti gli item", async () => {
  const repo = new MemoryRepository();
  await makeService(repo).get({ activityId: "ACT-BW", mode: "KEYS", keys: ["test.flag"] });
  assert.equal(repo.calls.keys, 1); assert.equal(repo.calls.listItems, 0);
});

test("read path non espone né interroga Timeline", async () => {
  const service = makeService(new MemoryRepository());
  assert.equal("timeline" in service, false);
  const result = await service.get({ activityId: "ACT-BW", mode: "FULL" });
  assert.equal("timeline" in result, false);
});

test("repository usa WHERE indicizzati nei lookup", async () => {
  const statements = [];
  const db = { prepare(sql) { statements.push(sql.replace(/\s+/g, " ").trim()); return {
    bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; }
  }; }};
  const repo = new ProjectActivityRepository(db);
  await repo.findById("ACT"); await repo.findByProjectAlias("PRJ", "alias");
  await repo.findByGlobalAlias("alias");
  await repo.listCompactItems("ACT", 2048);
  await repo.getItemsByKeys("ACT", ["test.flag"]);
  assert.match(statements[0], /WHERE activity_id = \?/);
  assert.match(statements[1], /WHERE x\.project_id = \? AND x\.alias_key = \?/);
  assert.match(statements[2], /WHERE x\.alias_key = \?/);
  assert.match(statements[3], /CASE WHEN item_type = 'DECISION'/);
  assert.match(statements[3], /length\(CAST\(value_json AS BLOB\)\) <= \?/);
  assert.match(statements[3], /WHERE activity_id = \?/);
  assert.match(statements[4], /WHERE activity_id = \? AND item_key IN \(\?\)/);
  assert.ok(statements.every(sql => /WHERE/.test(sql)));
});

test("dataset voluminoso simulato non cambia il numero di lookup", async () => {
  const repo = new MemoryRepository({ simulatedUnrelatedRows: 1_000_000 });
  const result = await makeService(repo).get({ projectId: "PRJ-LOTAR", activity: "Black Winter", mode: "KEYS", keys: ["test.flag"] });
  assert.equal(result.items["test.flag"].value, "fixture-only");
  assert.deepEqual(repo.calls, {
    byId: 0, projectAlias: 1, globalAlias: 0,
    listItems: 0, compactItems: 0, keys: 1
  });
});

test("mode invalido", async () => {
  await expectCode(makeService(new MemoryRepository()).get({ activityId: "ACT-BW", mode: "HISTORY" }), "INVALID_MODE");
});

test("Worker restituisce D1_NOT_CONFIGURED senza binding", async () => {
  const response = await worker.fetch(new Request("https://desk.test/project-activity", {
    method: "POST", body: JSON.stringify({ activity: "Black Winter" })
  }), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "D1_NOT_CONFIGURED");
});

test("routing Worker esistente resta invariato", async () => {
  const originalFetch = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (_url, options) => {
    forwarded.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ success: true, project: { id: "PRJ" } }));
  };
  try {
    const env = { DESK_APPS_SCRIPT_URL: "https://apps.test/exec", DESK_API_TOKEN: "test-only" };
    const cases = [
      ["/getProject", { projectName: "Lotar" }, "getProject"],
      ["/project-tasks", { projectName: "Lotar" }, "getProjectTasks"],
      ["/workspace-briefing", { workspace: "LOTAR" }, "getWorkspaceBriefing"],
      ["/", { projectName: "Lotar", data: { summary: "fixture-only" } }, undefined]
    ];
    for (const [path, body, expectedAction] of cases) {
      const response = await worker.fetch(new Request("https://desk.test" + path, {
        method: "POST", body: JSON.stringify(body)
      }), env);
      assert.equal(response.status, 200);
      assert.equal(forwarded.at(-1).action, expectedAction);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
