import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");

test("foundation D1 locale e Worker locale rispettano tutti gli invarianti", async () => {
  const persistence = fs.mkdtempSync(path.join(os.tmpdir(), "desk-v2-test-"));
  const port = 8900 + (process.pid % 500);
  const token = randomUUID();
  let workerProcess;
  let client;

  try {
    command(["d1", "migrations", "apply", "DESK_V2_DB", "--local",
      "--persist-to", persistence]);

    const secondApply = command(["d1", "migrations", "apply", "DESK_V2_DB",
      "--local", "--persist-to", persistence]);
    assert.match(secondApply, /No migrations to apply|already applied|Migrations to be applied:\s*0/i);

    assertQuery("SELECT count(*) AS value FROM d1_migrations WHERE name = '0001_foundation.sql';", /value[^0-9]*1/i);
    assertQuery("SELECT count(*) AS value FROM d1_migrations WHERE name = '0002_mcp_capability_test.sql';", /value[^0-9]*1/i);
    assertQuery("SELECT count(*) AS value FROM d1_migrations WHERE name = '0003_container_create_idempotency.sql';", /value[^0-9]*1/i);
    assertQuery("SELECT value FROM system_metadata WHERE key = 'system_name';", /desk-v2/i);
    assertQuery("SELECT value FROM system_metadata WHERE key = 'environment';", /v2-development/i);
    assertQuery("PRAGMA foreign_keys;", /foreign_keys[^0-9]*1/i);
    assertQuery(`SELECT count(*) AS value FROM sqlite_master WHERE type = 'table'
      AND name IN ('system_metadata','containers','tasks','d1_migrations','mcp_capability_test',
        'mcp_idempotency');`, /value[^0-9]*6/i);
    assertQuery("SELECT count(*) AS value FROM mcp_capability_test;", /value[^0-9]*0/i);

    execute(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-ROOT',NULL,'Fixture Root','IN_PROGRESS','ACTIVE',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
    execute(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-CHILD','FIXTURE-ROOT','Fixture Child','IN_PROGRESS','ACTIVE',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
    execute(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at,archived_at)
      VALUES ('FIXTURE-ARCHIVED-PARENT',NULL,'Archived Parent','IN_PROGRESS','ARCHIVED',1,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z');`);
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
    expectSqlFailure(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at)
      VALUES ('FIXTURE-ACTIVE-UNDER-ARCHIVED','FIXTURE-ARCHIVED-PARENT','Rejected',
      'IN_PROGRESS','ACTIVE',1,'2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z');`, /CONTAINER_PARENT_ARCHIVED/);
    execute("UPDATE containers SET parent_id='FIXTURE-ARCHIVED-PARENT' WHERE container_id='FIXTURE-CHILD';");
    assertQuery("SELECT parent_id FROM containers WHERE container_id='FIXTURE-CHILD';",
      /FIXTURE-ARCHIVED-PARENT/);
    execute("UPDATE containers SET parent_id='FIXTURE-ROOT' WHERE container_id='FIXTURE-CHILD';");

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
      "--port", String(port), "--ip", "127.0.0.1", "--var",
      `DESK_V2_MCP_BEARER_TOKEN:${token}`], {
      cwd: root,
      env: sanitizedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    workerProcess.stdout.resume();
    workerProcess.stderr.pipe(process.stderr);
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

    client = await connectDiagnosticClient({
      name: "desk-v2-integration-test",
      testName: "foundation D1 locale e Worker locale rispettano tutti gli invarianti",
      session: "A", port, token,
      worker: () => workerProcess
    });
    try {
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 10);
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_get_containers"));
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_create_container"));
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_move_container"));
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_update_container"));
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_archive_container"));
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_restore_container"));
      const roots = await client.callTool({
        name: "desk_v2_get_containers",
        arguments: {}
      });
      assert.deepEqual(roots.structuredContent.containers.map(row => row.containerId),
        ["FIXTURE-ROOT"]);
      assert.equal(roots.structuredContent.containers[0].focus, null);
      assert.equal(roots.structuredContent.containers[0].owner, null);
      assert.equal(roots.structuredContent.containers[0].nextAction, null);

      const children = await client.callTool({
        name: "desk_v2_get_containers",
        arguments: { parentId: "FIXTURE-ROOT" }
      });
      assert.deepEqual(children.structuredContent.containers.map(row => row.containerId),
        ["FIXTURE-CHILD"]);

      const byId = await client.callTool({
        name: "desk_v2_get_containers",
        arguments: { containerId: "FIXTURE-CHILD" }
      });
      assert.equal(byId.structuredContent.scope, "BY_ID");
      assert.equal(byId.structuredContent.count, 1);
      assert.equal(byId.structuredContent.lifecycle, null);

      const read = await client.callTool({ name: "desk_v2_capability_read", arguments: {} });
      assert.equal(read.structuredContent.containerCount, 3);
      assert.equal(read.structuredContent.taskCount, 1);
      const write = await client.callTool({
        name: "desk_v2_capability_write",
        arguments: { marker: "CODEX-LOCAL-D1-CAPABILITY" }
      });
      assert.equal(write.structuredContent.marker, "CODEX-LOCAL-D1-CAPABILITY");
      assertQuery("SELECT COUNT(*) AS value FROM mcp_capability_test;", /value[^0-9]*1/i);
      execute("DELETE FROM mcp_capability_test WHERE marker='CODEX-LOCAL-D1-CAPABILITY';");
      assertQuery("SELECT COUNT(*) AS value FROM mcp_capability_test;", /value[^0-9]*0/i);

      const createInput = {
        idempotencyKey: "foundation-create-001",
        name: " Foundation Root ",
        focus: " Local only ",
        owner: null,
        nextAction: " Verify replay "
      };
      const created = await client.callTool({
        name: "desk_v2_create_container", arguments: createInput
      });
      assert.notEqual(created.isError, true);
      assert.equal(created.structuredContent.replayed, false);
      assert.equal(created.structuredContent.container.name, "Foundation Root");
      assert.equal(created.structuredContent.container.status, "IN_PROGRESS");
      assert.equal(created.structuredContent.container.lifecycleState, "ACTIVE");
      assert.equal(created.structuredContent.container.version, 1);
      assert.equal(created.structuredContent.container.archivedAt, null);
      assert.equal(created.structuredContent.container.createdAt,
        created.structuredContent.container.updatedAt);
      assert.match(created.structuredContent.container.containerId, /^CTR-[0-9a-f-]{36}$/i);

      const replay = await client.callTool({
        name: "desk_v2_create_container", arguments: createInput
      });
      assert.equal(replay.structuredContent.replayed, true);
      assert.deepEqual(replay.structuredContent.container, created.structuredContent.container);

      const conflict = await client.callTool({
        name: "desk_v2_create_container",
        arguments: { ...createInput, name: "Different" }
      });
      assert.equal(conflict.isError, true);
      assert.equal(conflict.structuredContent.error.code, "IDEMPOTENCY_KEY_CONFLICT");

      const archivedParent = await client.callTool({
        name: "desk_v2_create_container",
        arguments: { idempotencyKey: "foundation-archived-parent", name: "Rejected",
          parentId: "FIXTURE-ARCHIVED-PARENT" }
      });
      assert.equal(archivedParent.structuredContent.error.code, "CONTAINER_PARENT_ARCHIVED");
      const missingParent = await client.callTool({
        name: "desk_v2_create_container",
        arguments: { idempotencyKey: "foundation-missing-parent", name: "Rejected",
          parentId: "FIXTURE-MISSING" }
      });
      assert.equal(missingParent.structuredContent.error.code, "CONTAINER_PARENT_NOT_FOUND");

      const child = await client.callTool({
        name: "desk_v2_create_container",
        arguments: { idempotencyKey: "foundation-child-001", name: "Child",
          parentId: created.structuredContent.container.containerId }
      });
      assert.equal(child.structuredContent.container.parentId,
        created.structuredContent.container.containerId);

      const concurrent = await Promise.all([
        client.callTool({ name: "desk_v2_create_container", arguments: {
          idempotencyKey: "foundation-concurrent", name: "Concurrent"
        } }),
        client.callTool({ name: "desk_v2_create_container", arguments: {
          idempotencyKey: "foundation-concurrent", name: "Concurrent"
        } })
      ]);
      assert.deepEqual(concurrent.map(item => item.structuredContent.replayed).sort(),
        [false, true]);
      assertQuery("SELECT COUNT(*) AS value FROM containers WHERE name='Concurrent';",
        /value[^0-9]*1/i);

      const conflicting = await Promise.all([
        client.callTool({ name: "desk_v2_create_container", arguments: {
          idempotencyKey: "foundation-concurrent-conflict", name: "Conflict A"
        } }),
        client.callTool({ name: "desk_v2_create_container", arguments: {
          idempotencyKey: "foundation-concurrent-conflict", name: "Conflict B"
        } })
      ]);
      assert.equal(conflicting.filter(item => item.isError === true).length, 1);
      assert.equal(conflicting.filter(item => item.isError !== true).length, 1);
      assert.equal(conflicting.find(item => item.isError === true)
        .structuredContent.error.code, "IDEMPOTENCY_KEY_CONFLICT");
      assertQuery(`SELECT COUNT(*) AS value FROM containers
        WHERE name IN ('Conflict A','Conflict B');`, /value[^0-9]*1/i);

      const duplicateNames = await Promise.all([
        client.callTool({ name: "desk_v2_create_container", arguments: {
          idempotencyKey: "foundation-duplicate-name-a", name: "Allowed Duplicate"
        } }),
        client.callTool({ name: "desk_v2_create_container", arguments: {
          idempotencyKey: "foundation-duplicate-name-b", name: "Allowed Duplicate"
        } })
      ]);
      assert.equal(duplicateNames.every(item => item.isError !== true), true);
      assert.notEqual(duplicateNames[0].structuredContent.container.containerId,
        duplicateNames[1].structuredContent.container.containerId);
      assertQuery("SELECT COUNT(*) AS value FROM containers WHERE name='Allowed Duplicate';",
        /value[^0-9]*2/i);
      assertQuery("SELECT COUNT(*) AS value FROM tasks;", /value[^0-9]*1/i);

      execute(`INSERT INTO containers
        (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at)
        VALUES
        ('MOVE-ROOT-A',NULL,'Move Root A','IN_PROGRESS','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
        ('MOVE-ROOT-B',NULL,'Move Root B','IN_PROGRESS','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
        ('MOVE-CHILD','MOVE-ROOT-A','Move Child','IN_PROGRESS','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
        ('MOVE-GRANDCHILD','MOVE-CHILD','Move Grandchild','IN_PROGRESS','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
      execute(`INSERT INTO tasks
        (task_id,container_id,title,status,lifecycle_state,version,created_at,updated_at)
        VALUES ('MOVE-TASK','MOVE-CHILD','Move Task','OPEN','ACTIVE',1,
        '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);

      const movedToB = await client.callTool({ name: "desk_v2_move_container", arguments: {
        idempotencyKey: "integration-move-to-b", containerId: "MOVE-CHILD",
        newParentId: "MOVE-ROOT-B", expectedVersion: 1
      } });
      assert.equal(movedToB.structuredContent.changed, true);
      assert.equal(movedToB.structuredContent.container.containerId, "MOVE-CHILD");
      assert.equal(movedToB.structuredContent.container.parentId, "MOVE-ROOT-B");
      assert.equal(movedToB.structuredContent.container.version, 2);
      assert.equal(movedToB.structuredContent.container.createdAt,
        "2026-01-01T00:00:00.000Z");
      assert.notEqual(movedToB.structuredContent.container.updatedAt,
        "2026-01-01T00:00:00.000Z");
      const grandchildAfterMove = await client.callTool({
        name: "desk_v2_get_containers", arguments: { containerId: "MOVE-GRANDCHILD" }
      });
      assert.equal(grandchildAfterMove.structuredContent.containers[0].parentId, "MOVE-CHILD");

      const cycle = await client.callTool({ name: "desk_v2_move_container", arguments: {
        idempotencyKey: "integration-cycle", containerId: "MOVE-CHILD",
        newParentId: "MOVE-GRANDCHILD", expectedVersion: 2
      } });
      assert.equal(cycle.isError, true);
      assert.equal(cycle.structuredContent.error.code, "CONTAINER_CYCLE");

      const movedToRoot = await client.callTool({ name: "desk_v2_move_container", arguments: {
        idempotencyKey: "integration-move-root", containerId: "MOVE-CHILD",
        newParentId: null, expectedVersion: 2
      } });
      assert.equal(movedToRoot.structuredContent.container.parentId, null);
      assert.equal(movedToRoot.structuredContent.container.version, 3);

      const archivedParentMove = await client.callTool({
        name: "desk_v2_move_container", arguments: {
          idempotencyKey: "integration-archived-parent", containerId: "MOVE-CHILD",
          newParentId: "FIXTURE-ARCHIVED-PARENT", expectedVersion: 3
        }
      });
      assert.equal(archivedParentMove.structuredContent.error.code,
        "CONTAINER_PARENT_ARCHIVED");
      const archivedSourceMove = await client.callTool({
        name: "desk_v2_move_container", arguments: {
          idempotencyKey: "integration-archived-source",
          containerId: "FIXTURE-ARCHIVED-PARENT", newParentId: null, expectedVersion: 1
        }
      });
      assert.equal(archivedSourceMove.structuredContent.error.code, "CONTAINER_ARCHIVED");

      const noOpInput = { idempotencyKey: "integration-noop", containerId: "MOVE-CHILD",
        newParentId: null, expectedVersion: 3 };
      const noOp = await client.callTool({ name: "desk_v2_move_container", arguments: noOpInput });
      assert.equal(noOp.structuredContent.changed, false);
      assert.equal(noOp.structuredContent.container.version, 3);
      const noOpReplay = await client.callTool({
        name: "desk_v2_move_container", arguments: noOpInput
      });
      assert.equal(noOpReplay.structuredContent.replayed, true);
      assert.deepEqual(noOpReplay.structuredContent.container, noOp.structuredContent.container);

      const competing = await Promise.all([
        client.callTool({ name: "desk_v2_move_container", arguments: {
          idempotencyKey: "integration-race-a", containerId: "MOVE-CHILD",
          newParentId: "MOVE-ROOT-A", expectedVersion: 3
        } }),
        client.callTool({ name: "desk_v2_move_container", arguments: {
          idempotencyKey: "integration-race-b", containerId: "MOVE-CHILD",
          newParentId: "MOVE-ROOT-B", expectedVersion: 3
        } })
      ]);
      assert.equal(competing.filter(item => item.isError !== true).length, 1);
      assert.equal(competing.find(item => item.isError === true)
        .structuredContent.error.code, "CONTAINER_VERSION_CONFLICT");

      const sameKeyInput = { idempotencyKey: "integration-same-key",
        containerId: "MOVE-GRANDCHILD", newParentId: "MOVE-ROOT-A", expectedVersion: 1 };
      const sameKey = await Promise.all([
        client.callTool({ name: "desk_v2_move_container", arguments: sameKeyInput }),
        client.callTool({ name: "desk_v2_move_container", arguments: sameKeyInput })
      ]);
      assert.deepEqual(sameKey.map(item => item.structuredContent.replayed).sort(),
        [false, true]);

      const historicalInput = { idempotencyKey: "integration-historical",
        containerId: "MOVE-ROOT-B", newParentId: "MOVE-ROOT-A", expectedVersion: 1 };
      const historical = await client.callTool({
        name: "desk_v2_move_container", arguments: historicalInput
      });
      execute(`UPDATE containers SET parent_id=NULL, version=version+1,
        updated_at='2026-01-03T00:00:00.000Z' WHERE container_id='MOVE-ROOT-B';`);
      const historicalReplay = await client.callTool({
        name: "desk_v2_move_container", arguments: historicalInput
      });
      assert.equal(historicalReplay.structuredContent.replayed, true);
      assert.deepEqual(historicalReplay.structuredContent.container,
        historical.structuredContent.container);
      execute(`CREATE TRIGGER move_test_forced_failure
        BEFORE UPDATE OF parent_id ON containers
        WHEN NEW.container_id='MOVE-ROOT-A'
        BEGIN SELECT RAISE(ABORT, 'MOVE_TEST_FAILURE'); END;`);
      const forcedFailure = await client.callTool({
        name: "desk_v2_move_container", arguments: {
          idempotencyKey: "integration-rollback", containerId: "MOVE-ROOT-A",
          newParentId: "MOVE-ROOT-B", expectedVersion: 1
        }
      });
      assert.equal(forcedFailure.isError, true);
      assert.equal(forcedFailure.structuredContent.error.code, "D1_OPERATION_FAILED");
      execute("DROP TRIGGER move_test_forced_failure;");
      assertQuery("SELECT container_id FROM tasks WHERE task_id='MOVE-TASK';", /MOVE-CHILD/);
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE operation='desk_v2_move_container' AND idempotency_key='integration-noop';`,
      /value[^0-9]*1/i);
      assertQuery("SELECT version AS value FROM containers WHERE container_id='MOVE-CHILD';",
        /value[^0-9]*4/i);
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE idempotency_key IN ('integration-race-a','integration-race-b');`,
      /value[^0-9]*1/i);
      assertQuery(`SELECT version AS value FROM containers
        WHERE container_id='MOVE-GRANDCHILD';`, /value[^0-9]*2/i);
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE operation='desk_v2_move_container'
          AND idempotency_key='integration-same-key';`, /value[^0-9]*1/i);
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE operation='desk_v2_move_container'
          AND idempotency_key='integration-rollback';`, /value[^0-9]*0/i);
      assertQuery(`SELECT COUNT(*) AS value FROM containers
        WHERE container_id='MOVE-ROOT-B' AND parent_id IS NULL AND version=3;`,
      /value[^0-9]*1/i);
      assertQuery(`SELECT COUNT(*) AS value FROM containers
        WHERE container_id='MOVE-ROOT-A' AND parent_id IS NULL AND version=1;`,
      /value[^0-9]*1/i);

      await client.close();
      client = undefined;
      await stopWorker(workerProcess);
      workerProcess = undefined;

      workerProcess = spawn(wrangler, ["dev", "--local", "--persist-to", persistence,
        "--port", String(port), "--ip", "127.0.0.1", "--var",
        `DESK_V2_MCP_BEARER_TOKEN:${token}`], {
        cwd: root,
        env: sanitizedEnvironment(),
        stdio: ["ignore", "pipe", "pipe"]
      });
      workerProcess.stdout.resume();
      workerProcess.stderr.pipe(process.stderr);
      const resumedHealth = await waitForResponse(`http://127.0.0.1:${port}/health`);
      assert.equal(resumedHealth.status, 200);
      const resumedReady = await fetch(`http://127.0.0.1:${port}/ready`);
      assert.equal(resumedReady.status, 200);

      client = await connectDiagnosticClient({
        name: "desk-v2-integration-test",
        testName: "foundation D1 locale e Worker locale rispettano tutti gli invarianti",
        session: "B", port, token,
        worker: () => workerProcess
      });

      execute(`INSERT INTO containers
        (container_id,parent_id,name,status,focus,owner,next_action,lifecycle_state,
         version,created_at,updated_at)
        VALUES
        ('UPDATE-PARENT',NULL,'Update Parent','OPEN','Focus','Owner','Next','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
        ('UPDATE-CHILD','UPDATE-PARENT','Update Child','OPEN',NULL,NULL,NULL,'ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
        ('UPDATE-RACE',NULL,'Update Race','OPEN',NULL,NULL,NULL,'ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
        ('UPDATE-SAME',NULL,'Update Same','OPEN',NULL,NULL,NULL,'ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
        ('UPDATE-HISTORY',NULL,'Update History','OPEN',NULL,NULL,NULL,'ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
        ('UPDATE-ROLLBACK',NULL,'Update Rollback','OPEN',NULL,NULL,NULL,'ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
      execute(`INSERT INTO tasks
        (task_id,container_id,title,status,lifecycle_state,version,created_at,updated_at)
        VALUES ('UPDATE-TASK','UPDATE-CHILD','Update Task','OPEN','ACTIVE',1,
        '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);

      const realUpdate = await client.callTool({
        name: "desk_v2_update_container", arguments: {
          idempotencyKey: "integration-update-real", containerId: "UPDATE-PARENT",
          expectedVersion: 1, patch: { name: " Updated Parent ", status: "LEGACY_STATUS",
            focus: " New Focus ", owner: " New Owner " }
        }
      });
      assert.equal(realUpdate.structuredContent.changed, true);
      assert.equal(realUpdate.structuredContent.replayed, false);
      assert.equal(realUpdate.structuredContent.container.version, 2);
      assert.equal(realUpdate.structuredContent.container.name, "Updated Parent");
      assert.equal(realUpdate.structuredContent.container.status, "LEGACY_STATUS");
      assert.equal(realUpdate.structuredContent.container.focus, "New Focus");
      assert.equal(realUpdate.structuredContent.container.owner, "New Owner");
      assert.equal(realUpdate.structuredContent.container.nextAction, "Next");
      assert.equal(realUpdate.structuredContent.container.parentId, null);
      assert.equal(realUpdate.structuredContent.container.lifecycleState, "ACTIVE");
      assert.equal(realUpdate.structuredContent.container.archivedAt, null);
      assert.equal(realUpdate.structuredContent.container.createdAt,
        "2026-01-01T00:00:00.000Z");
      assert.notEqual(realUpdate.structuredContent.container.updatedAt,
        "2026-01-01T00:00:00.000Z");
      assertQuery(`SELECT COUNT(*) AS value FROM containers
        WHERE container_id='UPDATE-CHILD' AND parent_id='UPDATE-PARENT';`, /value[^0-9]*1/i);
      assertQuery(`SELECT COUNT(*) AS value FROM tasks
        WHERE task_id='UPDATE-TASK' AND container_id='UPDATE-CHILD' AND title='Update Task';`,
      /value[^0-9]*1/i);

      const cleared = await client.callTool({
        name: "desk_v2_update_container", arguments: {
          idempotencyKey: "integration-update-clear", containerId: "UPDATE-PARENT",
          expectedVersion: 2, patch: { focus: null, owner: " ", nextAction: "" }
        }
      });
      assert.deepEqual({ focus: cleared.structuredContent.container.focus,
        owner: cleared.structuredContent.container.owner,
        nextAction: cleared.structuredContent.container.nextAction },
      { focus: null, owner: null, nextAction: null });
      assert.equal(cleared.structuredContent.container.version, 3);

      const updateNoOpInput = { idempotencyKey: "integration-update-noop",
        containerId: "UPDATE-PARENT", expectedVersion: 3,
        patch: { owner: null, focus: null } };
      const updateNoOp = await client.callTool({
        name: "desk_v2_update_container", arguments: updateNoOpInput
      });
      assert.equal(updateNoOp.structuredContent.changed, false);
      assert.equal(updateNoOp.structuredContent.container.version, 3);
      assert.equal(updateNoOp.structuredContent.container.updatedAt,
        cleared.structuredContent.container.updatedAt);
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE operation='desk_v2_update_container'
          AND idempotency_key='integration-update-noop';`, /value[^0-9]*1/i);
      const canonicalReplay = await client.callTool({
        name: "desk_v2_update_container", arguments: {
          ...updateNoOpInput, patch: { focus: null, owner: null }
        }
      });
      assert.equal(canonicalReplay.structuredContent.replayed, true);
      assert.deepEqual(canonicalReplay.structuredContent.container,
        updateNoOp.structuredContent.container);

      const stale = await client.callTool({
        name: "desk_v2_update_container", arguments: {
          idempotencyKey: "integration-update-stale", containerId: "UPDATE-PARENT",
          expectedVersion: 2, patch: { name: "Stale" }
        }
      });
      assert.equal(stale.structuredContent.error.code, "CONTAINER_VERSION_CONFLICT");
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE idempotency_key='integration-update-stale';`, /value[^0-9]*0/i);

      const race = await Promise.all([
        client.callTool({ name: "desk_v2_update_container", arguments: {
          idempotencyKey: "integration-update-race-a", containerId: "UPDATE-RACE",
          expectedVersion: 1, patch: { focus: "A" }
        } }),
        client.callTool({ name: "desk_v2_update_container", arguments: {
          idempotencyKey: "integration-update-race-b", containerId: "UPDATE-RACE",
          expectedVersion: 1, patch: { owner: "B" }
        } })
      ]);
      assert.equal(race.filter(result => result.isError !== true).length, 1);
      assert.equal(race.find(result => result.isError === true)
        .structuredContent.error.code, "CONTAINER_VERSION_CONFLICT");
      assertQuery("SELECT version AS value FROM containers WHERE container_id='UPDATE-RACE';",
        /value[^0-9]*2/i);
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE idempotency_key IN ('integration-update-race-a','integration-update-race-b');`,
      /value[^0-9]*1/i);

      const sameInput = { idempotencyKey: "integration-update-same",
        containerId: "UPDATE-SAME", expectedVersion: 1, patch: { name: "Same Updated" } };
      const same = await Promise.all([
        client.callTool({ name: "desk_v2_update_container", arguments: sameInput }),
        client.callTool({ name: "desk_v2_update_container", arguments: sameInput })
      ]);
      assert.deepEqual(same.map(result => result.structuredContent.replayed).sort(), [false, true]);
      assertQuery("SELECT version AS value FROM containers WHERE container_id='UPDATE-SAME';",
        /value[^0-9]*2/i);
      const sameConflict = await client.callTool({
        name: "desk_v2_update_container", arguments: {
          ...sameInput, patch: { name: "Different" }
        }
      });
      assert.equal(sameConflict.structuredContent.error.code, "IDEMPOTENCY_KEY_CONFLICT");

      const updateHistoricalInput = { idempotencyKey: "integration-update-history",
        containerId: "UPDATE-HISTORY", expectedVersion: 1, patch: { name: "Historical" } };
      const historicalUpdate = await client.callTool({
        name: "desk_v2_update_container", arguments: updateHistoricalInput
      });
      const laterUpdate = await client.callTool({
        name: "desk_v2_update_container", arguments: {
          idempotencyKey: "integration-update-later", containerId: "UPDATE-HISTORY",
          expectedVersion: 2, patch: { name: "Later" }
        }
      });
      const movedHistory = await client.callTool({
        name: "desk_v2_move_container", arguments: {
          idempotencyKey: "integration-update-history-move", containerId: "UPDATE-HISTORY",
          newParentId: "UPDATE-PARENT", expectedVersion: 3
        }
      });
      assert.equal(movedHistory.structuredContent.container.version, 4);
      const updateHistoricalReplay = await client.callTool({
        name: "desk_v2_update_container", arguments: updateHistoricalInput
      });
      assert.equal(updateHistoricalReplay.structuredContent.replayed, true);
      assert.deepEqual(updateHistoricalReplay.structuredContent.container,
        historicalUpdate.structuredContent.container);
      assert.equal(laterUpdate.structuredContent.container.name, "Later");
      assertQuery(`SELECT COUNT(*) AS value FROM containers
        WHERE container_id='UPDATE-HISTORY' AND name='Later'
          AND parent_id='UPDATE-PARENT' AND version=4;`, /value[^0-9]*1/i);

      const archivedUpdate = await client.callTool({
        name: "desk_v2_update_container", arguments: {
          idempotencyKey: "integration-update-archived",
          containerId: "FIXTURE-ARCHIVED-PARENT", expectedVersion: 1,
          patch: { name: "Rejected" }
        }
      });
      assert.equal(archivedUpdate.structuredContent.error.code, "CONTAINER_ARCHIVED");
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE idempotency_key='integration-update-archived';`, /value[^0-9]*0/i);

      execute(`CREATE TRIGGER update_test_forced_failure
        BEFORE UPDATE OF name ON containers
        WHEN NEW.container_id='UPDATE-ROLLBACK'
        BEGIN SELECT RAISE(ABORT, 'UPDATE_TEST_FAILURE'); END;`);
      const updateFailure = await client.callTool({
        name: "desk_v2_update_container", arguments: {
          idempotencyKey: "integration-update-rollback", containerId: "UPDATE-ROLLBACK",
          expectedVersion: 1, patch: { name: "Rejected" }
        }
      });
      assert.equal(updateFailure.structuredContent.error.code, "D1_OPERATION_FAILED");
      execute("DROP TRIGGER update_test_forced_failure;");
      assertQuery(`SELECT COUNT(*) AS value FROM containers
        WHERE container_id='UPDATE-ROLLBACK' AND name='Update Rollback' AND version=1;`,
      /value[^0-9]*1/i);
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE idempotency_key='integration-update-rollback';`, /value[^0-9]*0/i);

      await client.close();
      client = undefined;
      await stopWorker(workerProcess);
      workerProcess = undefined;

      workerProcess = spawn(wrangler, ["dev", "--local", "--persist-to", persistence,
        "--port", String(port), "--ip", "127.0.0.1", "--var",
        `DESK_V2_MCP_BEARER_TOKEN:${token}`], {
        cwd: root,
        env: sanitizedEnvironment(),
        stdio: ["ignore", "pipe", "pipe"]
      });
      workerProcess.stdout.resume();
      workerProcess.stderr.pipe(process.stderr);
      const lifecycleHealth = await waitForResponse(`http://127.0.0.1:${port}/health`);
      assert.equal(lifecycleHealth.status, 200);
      const lifecycleReady = await fetch(`http://127.0.0.1:${port}/ready`);
      assert.equal(lifecycleReady.status, 200);

      client = await connectDiagnosticClient({
        name: "desk-v2-integration-test",
        testName: "foundation D1 locale e Worker locale rispettano tutti gli invarianti",
        session: "C", port, token,
        worker: () => workerProcess
      });

      execute(`INSERT INTO containers
        (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at,
         archived_at)
        VALUES
        ('LIFE-LEAF',NULL,'Lifecycle Leaf','OPEN','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL),
        ('LIFE-ROOT',NULL,'Lifecycle Root','OPEN','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL),
        ('LIFE-CHILD','LIFE-ROOT','Lifecycle Child','OPEN','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL),
        ('LIFE-GRANDCHILD','LIFE-CHILD','Lifecycle Grandchild','OPEN','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL),
        ('LIFE-ARCHIVED-PARENT',NULL,'Lifecycle Archived Parent','OPEN','ARCHIVED',1,
         '2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z',
         '2026-01-02T00:00:00.000Z'),
        ('LIFE-ARCHIVED-CHILD','LIFE-ARCHIVED-PARENT','Lifecycle Archived Child','OPEN',
         'ARCHIVED',1,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z',
         '2026-01-02T00:00:00.000Z'),
        ('LIFE-ALL-ROOT',NULL,'All Archived Root','OPEN','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL),
        ('LIFE-ALL-CHILD','LIFE-ALL-ROOT','All Archived Child','OPEN','ARCHIVED',1,
         '2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z',
         '2026-01-02T00:00:00.000Z'),
        ('LIFE-ROLLBACK',NULL,'Lifecycle Rollback','OPEN','ACTIVE',1,
         '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL);`);
      execute(`INSERT INTO tasks
        (task_id,container_id,title,status,lifecycle_state,version,created_at,updated_at)
        VALUES ('LIFE-TASK','LIFE-LEAF','Lifecycle Task','OPEN','ACTIVE',1,
        '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);

      const descendantBlocked = await client.callTool({
        name: "desk_v2_archive_container", arguments: {
          idempotencyKey: "integration-archive-descendant", containerId: "LIFE-ROOT",
          expectedVersion: 1
        }
      });
      assert.equal(descendantBlocked.structuredContent.error.code,
        "CONTAINER_HAS_ACTIVE_DESCENDANTS");
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE idempotency_key='integration-archive-descendant';`, /value[^0-9]*0/i);
      execute(`UPDATE containers SET lifecycle_state='ARCHIVED',
        updated_at='2026-01-02T00:00:00.000Z', archived_at='2026-01-02T00:00:00.000Z'
        WHERE container_id='LIFE-GRANDCHILD';`);
      execute(`UPDATE containers SET lifecycle_state='ARCHIVED',
        updated_at='2026-01-02T00:00:00.000Z', archived_at='2026-01-02T00:00:00.000Z'
        WHERE container_id='LIFE-CHILD';`);

      const archiveInput = { idempotencyKey: "integration-archive-real",
        containerId: "LIFE-LEAF", expectedVersion: 1 };
      const archived = await client.callTool({
        name: "desk_v2_archive_container", arguments: archiveInput
      });
      assert.equal(archived.structuredContent.changed, true);
      assert.equal(archived.structuredContent.container.lifecycleState, "ARCHIVED");
      assert.equal(archived.structuredContent.container.version, 2);
      assert.equal(archived.structuredContent.container.archivedAt,
        archived.structuredContent.container.updatedAt);
      assertQuery(`SELECT COUNT(*) AS value FROM tasks
        WHERE task_id='LIFE-TASK' AND container_id='LIFE-LEAF' AND lifecycle_state='ACTIVE'
          AND version=1;`, /value[^0-9]*1/i);
      const archiveReplay = await client.callTool({
        name: "desk_v2_archive_container", arguments: archiveInput
      });
      assert.equal(archiveReplay.structuredContent.replayed, true);
      assert.deepEqual(archiveReplay.structuredContent.container,
        archived.structuredContent.container);
      const archiveConflict = await client.callTool({
        name: "desk_v2_archive_container", arguments: {
          ...archiveInput, expectedVersion: 2
        }
      });
      assert.equal(archiveConflict.structuredContent.error.code, "IDEMPOTENCY_KEY_CONFLICT");
      const archiveNoOp = await client.callTool({
        name: "desk_v2_archive_container", arguments: {
          idempotencyKey: "integration-archive-noop", containerId: "LIFE-LEAF",
          expectedVersion: 2
        }
      });
      assert.equal(archiveNoOp.structuredContent.changed, false);
      assert.equal(archiveNoOp.structuredContent.container.updatedAt,
        archived.structuredContent.container.updatedAt);
      const allArchived = await client.callTool({
        name: "desk_v2_archive_container", arguments: {
          idempotencyKey: "integration-archive-all-descendants",
          containerId: "LIFE-ALL-ROOT", expectedVersion: 1
        }
      });
      assert.equal(allArchived.structuredContent.changed, true);
      assertQuery(`SELECT COUNT(*) AS value FROM containers
        WHERE container_id='LIFE-ALL-CHILD' AND lifecycle_state='ARCHIVED' AND version=1;`,
      /value[^0-9]*1/i);

      const restoreBlocked = await client.callTool({
        name: "desk_v2_restore_container", arguments: {
          idempotencyKey: "integration-restore-parent", containerId: "LIFE-ARCHIVED-CHILD",
          expectedVersion: 1
        }
      });
      assert.equal(restoreBlocked.structuredContent.error.code, "CONTAINER_PARENT_ARCHIVED");
      const restored = await client.callTool({
        name: "desk_v2_restore_container", arguments: {
          idempotencyKey: "integration-restore-real", containerId: "LIFE-LEAF",
          expectedVersion: 2
        }
      });
      assert.equal(restored.structuredContent.changed, true);
      assert.equal(restored.structuredContent.container.lifecycleState, "ACTIVE");
      assert.equal(restored.structuredContent.container.archivedAt, null);
      assert.equal(restored.structuredContent.container.version, 3);
      const restoreNoOp = await client.callTool({
        name: "desk_v2_restore_container", arguments: {
          idempotencyKey: "integration-restore-noop", containerId: "LIFE-LEAF",
          expectedVersion: 3
        }
      });
      assert.equal(restoreNoOp.structuredContent.changed, false);
      const restoredUnderActiveParent = await client.callTool({
        name: "desk_v2_restore_container", arguments: {
          idempotencyKey: "integration-restore-active-parent", containerId: "LIFE-CHILD",
          expectedVersion: 1
        }
      });
      assert.equal(restoredUnderActiveParent.structuredContent.changed, true);
      assert.equal(restoredUnderActiveParent.structuredContent.container.parentId, "LIFE-ROOT");
      assertQuery(`SELECT COUNT(*) AS value FROM containers
        WHERE container_id='LIFE-GRANDCHILD' AND parent_id='LIFE-CHILD'
          AND lifecycle_state='ARCHIVED' AND version=1
          AND archived_at='2026-01-02T00:00:00.000Z';`, /value[^0-9]*1/i);
      execute(`CREATE TRIGGER lifecycle_test_forced_failure
        BEFORE UPDATE OF lifecycle_state ON containers
        WHEN NEW.container_id='LIFE-ROLLBACK'
        BEGIN SELECT RAISE(ABORT, 'LIFECYCLE_TEST_FAILURE'); END;`);
      const lifecycleFailure = await client.callTool({
        name: "desk_v2_archive_container", arguments: {
          idempotencyKey: "integration-lifecycle-rollback", containerId: "LIFE-ROLLBACK",
          expectedVersion: 1
        }
      });
      assert.equal(lifecycleFailure.structuredContent.error.code, "D1_OPERATION_FAILED");
      execute("DROP TRIGGER lifecycle_test_forced_failure;");
      assertQuery(`SELECT COUNT(*) AS value FROM containers
        WHERE container_id='LIFE-ROLLBACK' AND lifecycle_state='ACTIVE' AND version=1
          AND archived_at IS NULL;`, /value[^0-9]*1/i);
      assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
        WHERE idempotency_key='integration-lifecycle-rollback';`, /value[^0-9]*0/i);
    } finally {
      if (client) await client.close().catch(() => {});
    }
  } finally {
    await stopWorker(workerProcess);
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

test("task read foundation usa Worker e transport MCP isolati", async () => {
  const persistence = fs.mkdtempSync(path.join(os.tmpdir(), "desk-v2-task-read-"));
  const port = 9400 + (process.pid % 300);
  const token = randomUUID();
  let workerProcess;
  let client;

  const localCommand = args => command([...args, "--persist-to", persistence]);
  const execute = sql => localCommand([
    "d1", "execute", "DESK_V2_DB", "--local", "--command", compact(sql)
  ]);
  const assertQuery = (sql, pattern) => assert.match(execute(sql), pattern);

  try {
    command(["d1", "migrations", "apply", "DESK_V2_DB", "--local",
      "--persist-to", persistence]);
    execute(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at,archived_at)
      VALUES
      ('TASK-READ-ROOT',NULL,'Task Read Root','IN_PROGRESS','ACTIVE',1,
       '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL),
      ('TASK-READ-ARCHIVED-PARENT',NULL,'Task Read Archived Parent','IN_PROGRESS',
       'ARCHIVED',1,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z',
       '2026-01-02T00:00:00.000Z');`);
    execute(`INSERT INTO tasks
      (task_id,container_id,title,description,status,priority,assignee,due_date,
       lifecycle_state,version,created_at,updated_at,completed_at,archived_at)
      VALUES
      ('TASK-READ-A','TASK-READ-ROOT','Alpha','Mapped description','OPEN','HIGH','Max',
       '2026-10-05','ACTIVE',1,'2026-01-01T00:00:00.000Z',
       '2026-01-01T00:00:00.000Z','2026-01-01T12:00:00.000Z',NULL),
      ('TASK-READ-B','TASK-READ-ROOT','Alpha',NULL,'NON_STANDARD',NULL,NULL,NULL,
       'ACTIVE',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL,NULL),
      ('TASK-READ-ARCHIVED','TASK-READ-ROOT','Beta',NULL,'OPEN',NULL,NULL,NULL,
       'ARCHIVED',1,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z',NULL,
       '2026-01-02T00:00:00.000Z'),
      ('LEGACY-TASK-READ','TASK-READ-ROOT','Gamma',NULL,'CUSTOM',NULL,NULL,NULL,
       'ACTIVE',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL,NULL),
      ('TASK-READ-UNDER-ARCHIVED','TASK-READ-ARCHIVED-PARENT','Delta',NULL,
       'CUSTOM_ACTIVE',NULL,NULL,NULL,'ACTIVE',1,'2026-01-01T00:00:00.000Z',
       '2026-01-01T00:00:00.000Z',NULL,NULL);`);
    assertQuery("SELECT COUNT(*) AS value FROM containers;", /value[^0-9]*2/i);
    assertQuery("SELECT COUNT(*) AS value FROM tasks;", /value[^0-9]*5/i);
    assertQuery("SELECT SUM(version) AS value FROM tasks;", /value[^0-9]*5/i);
    assertQuery("SELECT COUNT(*) AS value FROM mcp_idempotency;", /value[^0-9]*0/i);
    assertQuery("SELECT COUNT(*) AS value FROM mcp_capability_test;", /value[^0-9]*0/i);

    workerProcess = spawn(wrangler, ["dev", "--local", "--persist-to", persistence,
      "--port", String(port), "--ip", "127.0.0.1", "--var",
      `DESK_V2_MCP_BEARER_TOKEN:${token}`], {
      cwd: root,
      env: sanitizedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    workerProcess.stdout.resume();
    workerProcess.stderr.pipe(process.stderr);
    const health = await waitForResponse(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(ready.status, 200);

    client = await connectDiagnosticClient({
      name: "desk-v2-task-read-foundation",
      testName: "task read foundation usa Worker e transport MCP isolati",
      session: "Task READ isolated", port, token,
      worker: () => workerProcess
    });

    const listed = await client.listTools();
    assert.equal(listed.tools.length, 10);
    const taskTool = listed.tools.find(tool => tool.name === "desk_v2_get_tasks");
    assert.ok(taskTool);
    assert.deepEqual(taskTool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });

    const defaultActive = await client.callTool({
      name: "desk_v2_get_tasks", arguments: { containerId: "TASK-READ-ROOT" }
    });
    assert.deepEqual(defaultActive.structuredContent, {
      scope: "CONTAINER", containerId: "TASK-READ-ROOT", lifecycle: "ACTIVE", count: 3,
      tasks: defaultActive.structuredContent.tasks
    });
    assert.deepEqual(defaultActive.structuredContent.tasks.map(row => row.taskId),
      ["TASK-READ-A", "TASK-READ-B", "LEGACY-TASK-READ"]);
    assert.deepEqual(defaultActive.structuredContent.tasks[0], {
      taskId: "TASK-READ-A", containerId: "TASK-READ-ROOT", title: "Alpha",
      description: "Mapped description", status: "OPEN", priority: "HIGH", assignee: "Max",
      dueDate: "2026-10-05", lifecycleState: "ACTIVE", version: 1,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T12:00:00.000Z", archivedAt: null
    });
    assert.deepEqual(Object.keys(defaultActive.structuredContent.tasks[0]).sort(), [
      "archivedAt", "assignee", "completedAt", "containerId", "createdAt", "description",
      "dueDate", "lifecycleState", "priority", "status", "taskId", "title", "updatedAt",
      "version"
    ]);
    assert.equal(defaultActive.structuredContent.tasks[1].status, "NON_STANDARD");
    assert.equal(defaultActive.structuredContent.tasks[1].description, null);
    assert.equal(defaultActive.structuredContent.tasks[1].priority, null);
    assert.equal(defaultActive.structuredContent.tasks[1].assignee, null);
    assert.equal(defaultActive.structuredContent.tasks[1].dueDate, null);
    assert.equal(defaultActive.structuredContent.tasks[1].completedAt, null);

    const explicitActive = await client.callTool({
      name: "desk_v2_get_tasks",
      arguments: { containerId: "TASK-READ-ROOT", lifecycle: "ACTIVE" }
    });
    assert.deepEqual(explicitActive.structuredContent.tasks, defaultActive.structuredContent.tasks);
    const archived = await client.callTool({
      name: "desk_v2_get_tasks",
      arguments: { containerId: "TASK-READ-ROOT", lifecycle: "ARCHIVED" }
    });
    assert.deepEqual(archived.structuredContent.tasks.map(row => row.taskId),
      ["TASK-READ-ARCHIVED"]);
    const all = await client.callTool({
      name: "desk_v2_get_tasks",
      arguments: { containerId: "TASK-READ-ROOT", lifecycle: "ALL" }
    });
    assert.deepEqual(all.structuredContent.tasks.map(row => row.taskId),
      ["TASK-READ-A", "TASK-READ-B", "TASK-READ-ARCHIVED", "LEGACY-TASK-READ"]);

    const underArchived = await client.callTool({
      name: "desk_v2_get_tasks", arguments: { containerId: "TASK-READ-ARCHIVED-PARENT" }
    });
    assert.deepEqual(underArchived.structuredContent.tasks.map(row => row.taskId),
      ["TASK-READ-UNDER-ARCHIVED"]);

    for (const taskId of ["TASK-READ-A", "TASK-READ-ARCHIVED", "LEGACY-TASK-READ",
      "TASK-READ-UNDER-ARCHIVED"]) {
      const byId = await client.callTool({ name: "desk_v2_get_tasks", arguments: { taskId } });
      assert.equal(byId.structuredContent.scope, "BY_ID");
      assert.equal(byId.structuredContent.containerId, null);
      assert.equal(byId.structuredContent.lifecycle, null);
      assert.equal(byId.structuredContent.count, 1);
      assert.equal(byId.structuredContent.tasks.length, 1);
      assert.equal(byId.structuredContent.tasks[0].taskId, taskId);
    }

    const missingContainer = await client.callTool({
      name: "desk_v2_get_tasks", arguments: { containerId: "MISSING-CONTAINER" }
    });
    assert.equal(missingContainer.structuredContent.error.code, "CONTAINER_NOT_FOUND");
    const missingTask = await client.callTool({
      name: "desk_v2_get_tasks", arguments: { taskId: "MISSING-TASK" }
    });
    assert.equal(missingTask.structuredContent.error.code, "TASK_NOT_FOUND");
    const invalidLifecycle = await client.callTool({
      name: "desk_v2_get_tasks",
      arguments: { containerId: "TASK-READ-ROOT", lifecycle: "INVALID" }
    });
    assert.equal(invalidLifecycle.isError, true);
    const mixedScope = await client.callTool({
      name: "desk_v2_get_tasks",
      arguments: { taskId: "TASK-READ-A", containerId: "TASK-READ-ROOT" }
    });
    assert.equal(mixedScope.isError, true);

    await client.close();
    client = undefined;
    await stopWorker(workerProcess);
    workerProcess = undefined;

    assertQuery("SELECT COUNT(*) AS value FROM containers;", /value[^0-9]*2/i);
    assertQuery("SELECT COUNT(*) AS value FROM tasks;", /value[^0-9]*5/i);
    assertQuery("SELECT SUM(version) AS value FROM tasks;", /value[^0-9]*5/i);
    assertQuery(`SELECT COUNT(*) AS value FROM tasks
      WHERE updated_at IN ('2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z');`,
    /value[^0-9]*5/i);
    assertQuery("SELECT COUNT(*) AS value FROM mcp_idempotency;", /value[^0-9]*0/i);
    assertQuery("SELECT COUNT(*) AS value FROM mcp_capability_test;", /value[^0-9]*0/i);
  } finally {
    if (client) await client.close().catch(() => {});
    await stopWorker(workerProcess);
    fs.rmSync(persistence, { recursive: true, force: true });
  }
});

test("task create foundation usa Worker e transport MCP isolati", async () => {
  const persistence = fs.mkdtempSync(path.join(os.tmpdir(), "desk-v2-task-create-"));
  const port = 9700 + (process.pid % 200);
  const token = randomUUID();
  let workerProcess;
  let client;

  const localCommand = args => command([...args, "--persist-to", persistence]);
  const execute = sql => localCommand([
    "d1", "execute", "DESK_V2_DB", "--local", "--command", compact(sql)
  ]);
  const assertQuery = (sql, pattern) => assert.match(execute(sql), pattern);

  try {
    command(["d1", "migrations", "apply", "DESK_V2_DB", "--local",
      "--persist-to", persistence]);
    execute(`INSERT INTO containers
      (container_id,parent_id,name,status,lifecycle_state,version,created_at,updated_at,archived_at)
      VALUES
      ('TASK-CREATE-ACTIVE',NULL,'Task Create Active','IN_PROGRESS','ACTIVE',1,
       '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL),
      ('TASK-CREATE-ARCHIVED',NULL,'Task Create Archived','IN_PROGRESS','ARCHIVED',1,
       '2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z',
       '2026-01-02T00:00:00.000Z');`);

    workerProcess = spawn(wrangler, ["dev", "--local", "--persist-to", persistence,
      "--port", String(port), "--ip", "127.0.0.1", "--var",
      `DESK_V2_MCP_BEARER_TOKEN:${token}`], {
      cwd: root,
      env: sanitizedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    workerProcess.stdout.resume();
    workerProcess.stderr.pipe(process.stderr);
    assert.equal((await waitForResponse(`http://127.0.0.1:${port}/health`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 200);

    client = await connectDiagnosticClient({
      name: "desk-v2-task-create-foundation",
      testName: "task create foundation usa Worker e transport MCP isolati",
      session: "Task Create isolated", port, token,
      worker: () => workerProcess
    });

    const listed = await client.listTools();
    assert.equal(listed.tools.length, 10);
    const createTool = listed.tools.find(tool => tool.name === "desk_v2_create_task");
    assert.ok(createTool);
    assert.deepEqual(createTool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });

    const minimalInput = {
      idempotencyKey: "foundation-task-create-minimal",
      containerId: " TASK-CREATE-ACTIVE ",
      title: " Foundation Task ",
      status: " CUSTOM_STATUS "
    };
    const created = await client.callTool({
      name: "desk_v2_create_task", arguments: minimalInput
    });
    assert.notEqual(created.isError, true);
    assert.equal(created.structuredContent.replayed, false);
    const createdTask = created.structuredContent.task;
    assert.match(createdTask.taskId,
      /^TSK-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.deepEqual(createdTask, {
      taskId: createdTask.taskId,
      containerId: "TASK-CREATE-ACTIVE",
      title: "Foundation Task",
      description: null,
      status: "CUSTOM_STATUS",
      priority: null,
      assignee: null,
      dueDate: null,
      lifecycleState: "ACTIVE",
      version: 1,
      createdAt: createdTask.createdAt,
      updatedAt: createdTask.createdAt,
      completedAt: null,
      archivedAt: null
    });
    assert.deepEqual(Object.keys(createdTask).sort(), [
      "archivedAt", "assignee", "completedAt", "containerId", "createdAt", "description",
      "dueDate", "lifecycleState", "priority", "status", "taskId", "title", "updatedAt",
      "version"
    ]);

    const byId = await client.callTool({
      name: "desk_v2_get_tasks", arguments: { taskId: createdTask.taskId }
    });
    assert.deepEqual(byId.structuredContent.tasks, [createdTask]);

    const replay = await client.callTool({
      name: "desk_v2_create_task", arguments: {
        ...minimalInput,
        containerId: "TASK-CREATE-ACTIVE",
        title: "Foundation Task",
        status: "CUSTOM_STATUS",
        description: null,
        priority: null,
        assignee: null,
        dueDate: null
      }
    });
    assert.equal(replay.structuredContent.replayed, true);
    assert.deepEqual(replay.structuredContent.task, createdTask);
    const conflict = await client.callTool({
      name: "desk_v2_create_task", arguments: {
        ...minimalInput, containerId: "TASK-CREATE-ACTIVE", title: "Different"
      }
    });
    assert.equal(conflict.structuredContent.error.code, "IDEMPOTENCY_KEY_CONFLICT");

    const optional = await client.callTool({
      name: "desk_v2_create_task", arguments: {
        idempotencyKey: "foundation-task-create-optional",
        containerId: "TASK-CREATE-ACTIVE",
        title: " Optional Task ",
        status: " READY ",
        description: " Description ",
        priority: " High ",
        assignee: " Max ",
        dueDate: " someday-ish "
      }
    });
    assert.deepEqual({
      description: optional.structuredContent.task.description,
      priority: optional.structuredContent.task.priority,
      assignee: optional.structuredContent.task.assignee,
      dueDate: optional.structuredContent.task.dueDate
    }, { description: "Description", priority: "High", assignee: "Max",
      dueDate: "someday-ish" });

    const missing = await client.callTool({
      name: "desk_v2_create_task", arguments: {
        idempotencyKey: "foundation-task-create-missing",
        containerId: "MISSING", title: "Missing", status: "OPEN"
      }
    });
    assert.equal(missing.structuredContent.error.code, "CONTAINER_NOT_FOUND");
    const archived = await client.callTool({
      name: "desk_v2_create_task", arguments: {
        idempotencyKey: "foundation-task-create-archived",
        containerId: "TASK-CREATE-ARCHIVED", title: "Archived", status: "OPEN"
      }
    });
    assert.equal(archived.structuredContent.error.code, "CONTAINER_ARCHIVED");

    execute(`CREATE TRIGGER task_create_test_forced_failure
      BEFORE INSERT ON tasks
      WHEN NEW.title='Forced Failure'
      BEGIN SELECT RAISE(ABORT, 'TASK_CREATE_TEST_FAILURE'); END;`);
    const failed = await client.callTool({
      name: "desk_v2_create_task", arguments: {
        idempotencyKey: "foundation-task-create-rollback",
        containerId: "TASK-CREATE-ACTIVE", title: "Forced Failure", status: "OPEN"
      }
    });
    assert.equal(failed.structuredContent.error.code, "D1_OPERATION_FAILED");
    execute("DROP TRIGGER task_create_test_forced_failure;");

    await client.close();
    client = undefined;
    await stopWorker(workerProcess);
    workerProcess = undefined;

    assertQuery("SELECT COUNT(*) AS value FROM tasks;", /value[^0-9]*2/i);
    assertQuery(`SELECT COUNT(*) AS value FROM tasks
      WHERE task_id IN ('${createdTask.taskId}','${optional.structuredContent.task.taskId}')
        AND lifecycle_state='ACTIVE' AND version=1 AND completed_at IS NULL
        AND archived_at IS NULL;`, /value[^0-9]*2/i);
    assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
      WHERE operation='desk_v2_create_task';`, /value[^0-9]*2/i);
    assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency AS item
      LEFT JOIN tasks AS task ON task.task_id=item.resource_id
      WHERE item.operation='desk_v2_create_task' AND task.task_id IS NULL;`,
    /value[^0-9]*0/i);
    assertQuery(`SELECT COUNT(*) AS value FROM mcp_idempotency
      WHERE idempotency_key IN ('foundation-task-create-missing',
        'foundation-task-create-archived','foundation-task-create-rollback');`,
    /value[^0-9]*0/i);
  } finally {
    if (client) await client.close().catch(() => {});
    await stopWorker(workerProcess);
    fs.rmSync(persistence, { recursive: true, force: true });
  }
});

test("migration chain 0001, 0002 e 0003 si applica senza modificare le precedenti", () => {
  const persistence = fs.mkdtempSync(path.join(os.tmpdir(), "desk-v2-staged-"));
  try {
    command(["d1", "execute", "DESK_V2_DB", "--local", "--persist-to",
      persistence, "--file", path.join(root, "migrations", "0001_foundation.sql")]);
    command(["d1", "execute", "DESK_V2_DB", "--local", "--persist-to",
      persistence, "--file", path.join(root, "migrations", "0002_mcp_capability_test.sql")]);
    command(["d1", "execute", "DESK_V2_DB", "--local", "--persist-to",
      persistence, "--file", path.join(root, "migrations", "0003_container_create_idempotency.sql")]);
    const result = command(["d1", "execute", "DESK_V2_DB", "--local", "--persist-to",
      persistence, "--command", "SELECT COUNT(*) AS value FROM mcp_capability_test;"]);
    assert.match(result, /value[^0-9]*0/i);
    const idempotency = command(["d1", "execute", "DESK_V2_DB", "--local",
      "--persist-to", persistence, "--command",
      "SELECT COUNT(*) AS value FROM mcp_idempotency;"]);
    assert.match(idempotency, /value[^0-9]*0/i);
  } finally {
    fs.rmSync(persistence, { recursive: true, force: true });
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

async function connectDiagnosticClient({ name, testName, session, port, token, worker }) {
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(endpoint), { authProvider: { token: async () => token } }
  );
  const listTools = client.listTools.bind(client);
  const callTool = client.callTool.bind(client);
  client.listTools = (...args) => diagnosticRequest({
    request: () => listTools(...args), testName, session, operation: "tools/list", endpoint, worker
  });
  client.callTool = (...args) => diagnosticRequest({
    request: () => callTool(...args), testName, session,
    operation: `tools/call:${args[0]?.name || "unknown"}`, endpoint, worker
  });
  await diagnosticRequest({
    request: () => client.connect(transport), testName, session, operation: "initialize",
    endpoint, worker
  });
  return client;
}

async function diagnosticRequest({ request, testName, session, operation, endpoint, worker }) {
  try {
    return await request();
  } catch (error) {
    const process = worker();
    const detail = [
      `MCP request failed: test=${testName}`,
      `session=${session}`,
      `operation=${operation}`,
      `endpoint=${endpoint}`,
      `error=${formatError(error)}`,
      `cause=${formatError(error?.cause)}`,
      `workerExitCode=${process?.exitCode ?? "null"}`,
      `workerSignalCode=${process?.signalCode ?? "null"}`
    ].join("; ");
    throw new Error(detail, { cause: error });
  }
}

function formatError(error) {
  if (!error) return "none";
  const code = error.code ? ` code=${error.code}` : "";
  return `${error.name || "Error"}: ${error.message || String(error)}${code}`;
}

async function stopWorker(workerProcess) {
  if (!workerProcess) return;
  if (workerProcess.exitCode === null && workerProcess.signalCode === null) {
    await new Promise((resolve, reject) => {
      const onExit = () => {
        workerProcess.off("error", onError);
        resolve();
      };
      const onError = error => {
        workerProcess.off("exit", onExit);
        reject(error);
      };
      workerProcess.once("exit", onExit);
      workerProcess.once("error", onError);
      const signaled = workerProcess.kill("SIGTERM");
      if (!signaled && (workerProcess.exitCode !== null || workerProcess.signalCode !== null)) {
        workerProcess.off("exit", onExit);
        workerProcess.off("error", onError);
        resolve();
      }
    });
  }
  workerProcess.stdout?.pause();
  workerProcess.stderr?.unpipe(process.stderr);
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
