import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");

test("foundation D1 locale e Worker locale rispettano tutti gli invarianti", async () => {
  const persistence = fs.mkdtempSync(path.join(os.tmpdir(), "desk-v2-test-"));
  const port = 8900 + (process.pid % 500);
  let workerProcess;

  try {
    command(["d1", "migrations", "apply", "DESK_V2_DB", "--local",
      "--persist-to", persistence]);

    const secondApply = command(["d1", "migrations", "apply", "DESK_V2_DB",
      "--local", "--persist-to", persistence]);
    assert.match(secondApply, /No migrations to apply|already applied|Migrations to be applied:\s*0/i);

    assertQuery("SELECT count(*) AS value FROM d1_migrations WHERE name = '0001_foundation.sql';", /value[^0-9]*1/i);
    assertQuery("SELECT value FROM system_metadata WHERE key = 'system_name';", /desk-v2/i);
    assertQuery("SELECT value FROM system_metadata WHERE key = 'environment';", /v2-development/i);
    assertQuery("PRAGMA foreign_keys;", /foreign_keys[^0-9]*1/i);
    assertQuery(`SELECT count(*) AS value FROM sqlite_master WHERE type = 'table'
      AND name IN ('system_metadata','containers','tasks','d1_migrations');`, /value[^0-9]*4/i);

    execute(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-ROOT',NULL,'Fixture Root','IN_PROGRESS','ACTIVE',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
    execute(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-CHILD','FIXTURE-ROOT','Fixture Child','IN_PROGRESS','ACTIVE',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
    assertQuery("SELECT parent_id FROM containers WHERE container_id='FIXTURE-CHILD';", /FIXTURE-ROOT/);

    expectSqlFailure(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-SELF','FIXTURE-SELF','Fixture Self','IN_PROGRESS','ACTIVE',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`, /CHECK constraint/i);
    expectSqlFailure(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-ORPHAN','FIXTURE-MISSING','Fixture Orphan','IN_PROGRESS','ACTIVE',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`, /FOREIGN KEY constraint/i);
    expectSqlFailure("UPDATE containers SET parent_id='FIXTURE-CHILD' WHERE container_id='FIXTURE-ROOT';", /CONTAINER_CYCLE/);
    expectSqlFailure("DELETE FROM containers WHERE container_id='FIXTURE-ROOT';", /FOREIGN KEY constraint/i);
    expectSqlFailure(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-BAD-VERSION',NULL,'Bad Version','IN_PROGRESS','ACTIVE',0,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`, /CHECK constraint/i);
    expectSqlFailure(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at,archived_at)
      VALUES ('FIXTURE-BAD-LIFECYCLE',NULL,'Bad Lifecycle','IN_PROGRESS','ARCHIVED',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL);`, /CHECK constraint/i);

    execute(`INSERT INTO tasks
      (task_id,container_id,title,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-TASK','FIXTURE-CHILD','Fixture Task','OPEN','ACTIVE',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
    assertQuery("SELECT container_id FROM tasks WHERE task_id='FIXTURE-TASK';", /FIXTURE-CHILD/);
    expectSqlFailure(`INSERT INTO tasks
      (task_id,container_id,title,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-TASK-ORPHAN','FIXTURE-MISSING','Orphan Task','OPEN','ACTIVE',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`, /FOREIGN KEY constraint/i);
    expectSqlFailure("DELETE FROM containers WHERE container_id='FIXTURE-CHILD';", /FOREIGN KEY constraint/i);
    expectSqlFailure(`INSERT INTO tasks
      (task_id,container_id,title,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-TASK-BAD','FIXTURE-CHILD','Bad Task','OPEN','ACTIVE',0,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`, /CHECK constraint/i);

    workerProcess = spawn(wrangler, ["dev", "--local", "--persist-to", persistence,
      "--port", String(port), "--ip", "127.0.0.1"], {
      cwd: root,
      env: sanitizedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const health = await waitForResponse(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      success: true, service: "desk-v2", environment: "v2-development", status: "alive"
    });
    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, "ready");
    assert.equal((await fetch(`http://127.0.0.1:${port}/missing`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`, { method: "POST" })).status, 405);
  } finally {
    if (workerProcess && !workerProcess.killed) workerProcess.kill("SIGTERM");
    fs.rmSync(persistence, { recursive: true, force: true });
  }

  function execute(sql) {
    return command(["d1", "execute", "DESK_V2_DB", "--local", "--persist-to",
      persistence, "--command", compact(sql)]);
  }

  function assertQuery(sql, pattern) {
    assert.match(execute(sql), pattern);
  }

  function expectSqlFailure(sql, pattern) {
    const result = rawCommand(["d1", "execute", "DESK_V2_DB", "--local",
      "--persist-to", persistence, "--command", compact(sql)]);
    assert.notEqual(result.status, 0, `SQL unexpectedly succeeded: ${sql}`);
    assert.match(`${result.stdout}\n${result.stderr}`, pattern);
  }
});

function command(args) {
  const result = rawCommand(args);
  assert.equal(result.status, 0,
    `Wrangler failed (${args.join(" ")}):\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
}

function rawCommand(args) {
  assert.equal(args.includes("--remote"), false, "Remote D1 access is forbidden");
  if (args[0] === "d1") assert.equal(args.includes("--local"), true,
    "Every D1 command must use --local");
  return spawnSync(wrangler, args, {
    cwd: root,
    encoding: "utf8",
    env: sanitizedEnvironment()
  });
}

function sanitizedEnvironment() {
  const env = { ...process.env, NO_D1_WARNING: "true" };
  for (const key of Object.keys(env)) {
    if (/^(DESK_|PROJECT_ACTIVITY_|CLOUDFLARE_|CF_)/.test(key)) delete env[key];
  }
  return env;
}

function compact(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

async function waitForResponse(url) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error("Worker did not start");
}
