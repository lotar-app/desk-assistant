import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const instructions = await readFile(new URL("./DESK_ASSISTANT_INSTRUCTIONS.md", import.meta.url), "utf8");
const scenarios = JSON.parse(await readFile(
  new URL("./project-activity-consolidation-scenarios.json", import.meta.url), "utf8"
));
const openapi = await readFile(
  new URL("../openapi/desk-action.openapi.yaml", import.meta.url), "utf8"
);
const has = pattern => assert.match(instructions, pattern);

test("l'artefatto production rispetta i limiti Custom GPT", () => {
  const characters = Array.from(instructions).length;
  const bytes = Buffer.byteLength(instructions, "utf8");
  assert.ok(characters <= 7400, `target superato: ${characters}`);
  assert.ok(characters <= 7600, `hard limit superato: ${characters}`);
  assert.ok(bytes < 8000, `limite UTF-8 superato: ${bytes}`);
});

test("la fixture copre esattamente i 28 scenari ProjectActivity", () => {
  assert.deepEqual(scenarios.map(row => row.id), Array.from({ length: 28 }, (_, i) => i + 1));
  assert.ok(scenarios.every(row => row.input && row.outcome && Array.isArray(row.actions)));
});

test("brainstorming, reazione debole e proposta scartata non scrivono", () => {
  for (const id of [1, 2, 7]) {
    assert.equal(scenarios[id - 1].outcome, "NO_WRITE");
    assert.equal(scenarios[id - 1].actions.includes("updateProjectActivity"), false);
  }
  has(/Do not call `updateProjectActivity` for brainstorming[\s\S]*assistant proposals[\s\S]*If approval is uncertain, do not write/i);
});

test("approval, replacement, revocation e multi-item mantengono stable key", () => {
  assert.equal(scenarios[2].items[0].op, "UPSERT");
  assert.equal(scenarios[4].items[0].sameStableKey, true);
  assert.equal(scenarios[5].items[0].op, "DELETE");
  assert.equal(scenarios[5].items[0].reasonRequired, true);
  assert.equal(scenarios[6].delete, false);
  assert.equal(scenarios[7].singleUpdate, true);
  assert.equal(scenarios[24].items.length, 3);
  has(/Existing Activity: call `getProjectActivity` immediately before writing[\s\S]*expectedSnapshotVersion/i);
  has(/Replacement uses the same key/);
  has(/revocation without replacement uses DELETE[\s\S]*`reason`/i);
  has(/stable hierarchical key/);
});

test("retrieval Activity usa ordine, alias e fallback senza Timeline", () => {
  assert.deepEqual(scenarios[12].actions, ["getProjectActivity", "getProject", "getProjectTasks"]);
  assert.equal(scenarios[10].autoResolve, true);
  assert.equal(scenarios[11].outcome, "CLARIFY");
  assert.equal(scenarios[27].timelineRead, false);
  has(/\(1\) unambiguous current-conversation context; \(2\) `getProjectActivity`[\s\S]*\(3\) `getProject`; \(4\) `getProjectTasks`[\s\S]*\(5\) one clarification/);
  has(/Do not use Timeline for normal Activity retrieval/);
});

test("Project resolution è autonoma e non crea implicitamente", () => {
  has(/readable project names/);
  has(/partial name\/abbreviation only when it identifies one Project/);
  has(/equally plausible matches ask once/);
  has(/Never invent Project IDs/);
  has(/Create a Project only when Max explicitly says it is new or clearly starts it/);
  has(/`Black Winter` is not necessarily a Project/);
});

test("Task resolution traduce title in ID e gestisce match e liste", () => {
  has(/`getProjectTasks` mandatory for Task title\/list\/inspect\/complete\/reopen/);
  has(/Resolve before `updateDesk`/);
  has(/Unique→use/);
  has(/none→inform/);
  has(/multiple→clarify once/);
  has(/never ask\/invent IDs/);
  has(/Lines MUST be `- ✅ Completata — <title>` or `- ⬜ Aperta — <title>`/);
  has(/Pre-send, fix lines not starting `- ` or a number; emoji\/text-first fails/);

  const markdownTask = /^(?:[-*] |\d+\. )/;
  for (const row of ["- ✅ Completata — Task A", "- ⬜ Aperta — Task B", "1. ✅ Completata — Task A"])
    assert.match(row, markdownTask);
  for (const row of ["✅ Completata — Task A", "⬜ Aperta — Task B"])
    assert.doesNotMatch(row, markdownTask);
});

test("creazione Activity usa Project certo e versione zero", () => {
  assert.equal(scenarios[13].createIfMissing, true);
  assert.equal(scenarios[13].expectedSnapshotVersion, 0);
  assert.equal(scenarios[14].createIfMissing, false);
  has(/`createIfMissing: true` and version `0` only when its Project and name are certain/);
  has(/ProjectActivity never creates Projects/);
});

test("version e idempotency conflict falliscono in sicurezza", () => {
  assert.equal(scenarios[17].blindRetry, false);
  assert.equal(scenarios[18].maxRetries, 1);
  assert.equal(scenarios[19].overwrite, false);
  assert.equal(scenarios[20].newKeyToForce, false);
  has(/`SNAPSHOT_VERSION_CONFLICT`[\s\S]*Retry at most once[\s\S]*Never loop/);
  has(/`IDEMPOTENCY_CONFLICT`[\s\S]*do not force the write with a new key/);
  has(/distinct opaque `idempotencyKey`[\s\S]*reuse exactly the same key only for technical retries/);
});

test("tipi e separazione updateDesk ProjectActivity restano espliciti", () => {
  assert.equal(scenarios[21].items[0].type, "CONTENT");
  assert.equal(scenarios[22].items[0].type, "DECISION");
  assert.equal(scenarios[23].items[0].type, "TECHNICAL_CONTEXT");
  assert.deepEqual(scenarios[25].actions, ["getProjectActivity", "updateProjectActivity", "updateDesk"]);
  assert.equal(scenarios[26].updateDesk, false);
  has(/If only internal memory changes, use only ProjectActivity/);
  has(/If the same fact also changes general progress, use both/);
  has(/Do not mirror every Activity item into Desk/);
});

test("updateDesk mantiene payload, status e confirmation policy", () => {
  for (const field of ["summary", "focus", "nextAction", "status", "newTasks", "completedTasks", "timelineEvent"])
    assert.ok(instructions.includes("`" + field + "`"));
  for (const status of ["IN_PROGRESS", "WAITING", "PAUSED", "DONE"])
    assert.ok(instructions.includes("`" + status + "`"));
  has(/Safe updates need no confirmation/);
  has(/non-explicit closure, delete\/remove, critical\/irreversible change, ambiguous task completion, or recording speculation as fact/);
});

test("cross-chat tenta Action, distingue failure/assenza e non finge letture", () => {
  has(/attempt it before declaring it unavailable/);
  has(/Never infer unavailability from a new chat, missing context, no prior invocation, or the client\/browser\/app/);
  has(/Action not attempted, an attempted call that failed, and an Action genuinely absent from runtime/);
  has(/never claim a Desk read succeeded unless the call succeeded/);
});

test("briefing Desk ha trigger, allowlist, ordine e chiusure deterministiche", () => {
  has(/Exact `Desk`[\s\S]*is a command, never a workspace\/Project/);
  has(/Call `getWorkspaceBriefing` omitting `workspace` to use default LOTAR/);
  has(/never pass `"Desk"`, call `getProject\("Desk"\)`, or `updateDesk`/);
  has(/`Desk <suffix>` passes only the suffix as `workspace`/);
  has(/If the call fails, report failure briefly/);
  has(/never claim Desk data or render briefing headings\/placeholders/);
  has(/From `recentContext` use only `projectName`, `status`, `focus`, `nextAction`, `lastUpdate`, `openTasks`/);
  const headings = ["DOVE RIPARTIRE", "IN ATTESA", "PROGETTI ATTIVI", "PROGETTI IN PAUSA"];
  let previous = -1;
  for (const heading of headings) {
    const index = instructions.indexOf(`\`${heading}\``);
    assert.ok(index > previous, `${heading} fuori ordine`);
    previous = index;
  }
  has(/becomes `selected`/);
  has(/selected\.nextAction verbatim/);
  has(/If `selected` exists, never reassess eligibility/);
  has(/La prossima azione consigliata è: <selected\.nextAction>/);
  has(/Only if no `selected` exists close exactly `La prossima azione consigliata non è disponibile nei dati di Desk\.`/);
  has(/La prossima azione consigliata non è disponibile nei dati di Desk\./);
  has(/`IN ATTESA`:[\s\S]*if none, omit header and empty-state text/);
  has(/`PROGETTI IN PAUSA`:[\s\S]*if none, omit header and empty-state text/);
  has(/`PROGETTI ATTIVI`: other `IN_PROGRESS` Projects excluding `selected`/);
  has(/Never infer missing values\/priorities/);
  has(/do not derive one/);
});

test("date e durate restano dinamiche e non persistite", () => {
  has(/Never invent dates/);
  has(/One date is a deadline/);
  has(/inclusive end is `start \+ duration - 1 day`/);
  for (const label of ["Futura", "Da fare oggi / Scade oggi", "In corso", "Ultimo giorno previsto", "Scaduta"])
    has(new RegExp(label));
  has(/Calculate temporal status dynamically[\s\S]*do not persist it/);
});

test("istruzioni production non espongono sink, route o token Admin", () => {
  for (const forbidden of [
    "appendProjectActivityTimelineEvent",
    "/internal/project-activity/outbox/deliver",
    "PROJECT_ACTIVITY_ADMIN_TOKEN"
  ]) assert.equal(instructions.includes(forbidden), false);
});

test("OpenAPI espone le sei Action previste e non il sink interno", () => {
  for (const operation of [
    "updateDesk", "getProject", "getProjectTasks", "getWorkspaceBriefing",
    "getProjectActivity", "updateProjectActivity"
  ]) assert.match(openapi, new RegExp(`operationId: ${operation}`));
  assert.match(openapi, /ProjectActivityBearer/);
  assert.match(openapi, /scheme: bearer/);
  assert.equal(openapi.includes("appendProjectActivityTimelineEvent"), false);
});

test("OpenAPI mantiene components schemas compatibile col parser GPT", () => {
  const components = JSON.parse(execFileSync("ruby", [
    "-ryaml", "-rjson", "-e",
    "document = YAML.safe_load(STDIN.read, aliases: false); puts JSON.generate(document.fetch('components'))"
  ], { input: openapi, encoding: "utf8" }));
  assert.deepEqual(components.schemas, {});
  assert.equal(typeof components.securitySchemes, "object");
  assert.equal(components.securitySchemes.ProjectActivityBearer.scheme, "bearer");
});
