import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const instructions = await readFile(new URL("./DESK_ASSISTANT_INSTRUCTIONS.md", import.meta.url), "utf8");
const scenarios = JSON.parse(await readFile(
  new URL("./project-activity-consolidation-scenarios.json", import.meta.url), "utf8"
));
const openapi = await readFile(
  new URL("../openapi/desk-action.openapi.yaml", import.meta.url), "utf8"
);

test("la fixture copre esattamente i 28 scenari richiesti", () => {
  assert.deepEqual(scenarios.map(row => row.id), Array.from({ length: 28 }, (_, index) => index + 1));
  assert.ok(scenarios.every(row => row.input && row.outcome && Array.isArray(row.actions)));
});

test("brainstorming e reazione debole non causano write", () => {
  for (const id of [1, 2, 7]) {
    assert.equal(scenarios[id - 1].outcome, "NO_WRITE");
    assert.equal(scenarios[id - 1].actions.includes("updateProjectActivity"), false);
  }
  assert.match(instructions, /interessante/);
  assert.match(instructions, /assistant proposal never becomes approved/i);
});

test("approvazione, sostituzione e revoca usano operazioni stabili", () => {
  assert.equal(scenarios[2].items[0].op, "UPSERT");
  assert.equal(scenarios[4].items[0].sameStableKey, true);
  assert.equal(scenarios[5].items[0].op, "DELETE");
  assert.equal(scenarios[5].items[0].reasonRequired, true);
  assert.equal(scenarios[6].delete, false);
});

test("approvazione multipla è una sola request e l'ambiguità chiarisce", () => {
  assert.equal(scenarios[7].singleUpdate, true);
  assert.equal(scenarios[7].items.length, 3);
  assert.equal(scenarios[8].outcome, "CLARIFY");
  assert.equal(scenarios[24].singleUpdate, true);
});

test("retrieval order privilegia ProjectActivity e non Timeline", () => {
  assert.deepEqual(scenarios[12].actions, ["getProjectActivity", "getProject", "getProjectTasks"]);
  assert.equal(scenarios[27].timelineRead, false);
  assert.match(instructions, /current conversation;\s*2\. `getProjectActivity`/);
  assert.match(instructions, /Do not use Timeline for this\s+fallback/);
});

test("alias unico si risolve e alias ambiguo non viene scelto", () => {
  assert.equal(scenarios[10].autoResolve, true);
  assert.equal(scenarios[11].outcome, "CLARIFY");
});

test("createIfMissing richiede creazione esplicita e versione zero", () => {
  assert.equal(scenarios[13].createIfMissing, true);
  assert.equal(scenarios[13].expectedSnapshotVersion, 0);
  assert.equal(scenarios[14].createIfMissing, false);
});

test("attività esistente usa la versione letta", () => {
  assert.equal(scenarios[15].versionSource, "snapshot");
  assert.equal(scenarios[16].expectedSnapshotVersion, 12);
  assert.deepEqual(scenarios[15].actions, ["getProjectActivity", "updateProjectActivity"]);
});

test("version conflict rilegge, limita il retry e protegge contraddizioni", () => {
  assert.equal(scenarios[17].blindRetry, false);
  assert.equal(scenarios[18].maxRetries, 1);
  assert.equal(scenarios[19].overwrite, false);
  assert.match(instructions, /retry at most once/);
});

test("idempotency conflict non forza una nuova chiave", () => {
  assert.equal(scenarios[20].newKeyToForce, false);
  assert.match(instructions, /never generate a replacement key to force the write/i);
  assert.match(instructions, /runtime does not guarantee that conversation or turn IDs/i);
});

test("tipi item corrispondono a contenuto, decisione e contesto tecnico", () => {
  assert.equal(scenarios[21].items[0].type, "CONTENT");
  assert.equal(scenarios[22].items[0].type, "DECISION");
  assert.equal(scenarios[23].items[0].type, "TECHNICAL_CONTEXT");
});

test("updateDesk resta separato e si combina solo quando necessario", () => {
  assert.deepEqual(scenarios[25].actions,
    ["getProjectActivity", "updateProjectActivity", "updateDesk"]);
  assert.equal(scenarios[26].updateDesk, false);
  assert.match(instructions, /do not mirror every consolidated item/i);
});

test("l'action sink 3A non viene esposta nelle istruzioni GPT", () => {
  assert.equal(instructions.includes("appendProjectActivityTimelineEvent"), false);
});

test("OpenAPI espone read/write ProjectActivity ma non il sink interno", () => {
  assert.match(openapi, /operationId: getProjectActivity/);
  assert.match(openapi, /operationId: updateProjectActivity/);
  assert.match(openapi, /expectedSnapshotVersion:/);
  assert.match(openapi, /idempotencyKey:/);
  assert.match(openapi, /ProjectActivityBearer/);
  assert.match(openapi, /scheme: bearer/);
  assert.equal(openapi.includes("appendProjectActivityTimelineEvent"), false);
});
