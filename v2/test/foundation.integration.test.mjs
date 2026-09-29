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

    const client = new Client({ name: "desk-v2-integration-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      { authProvider: { token: async () => token } }
    );
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 6);
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_get_containers"));
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_create_container"));
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_move_container"));
      assert.ok(tools.tools.some(tool => tool.name === "desk_v2_update_container"));

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
    } finally {
      await client.close();
    }
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
