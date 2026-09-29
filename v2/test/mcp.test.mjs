import test from "node:test";
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import worker from "../src/index.mjs";

test("/mcp rifiuta bearer assente o errato", async () => {
  const runtime = env();
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const absent = await worker.fetch(request(body), runtime, context());
  const wrong = await worker.fetch(request(body, "wrong-token"), runtime, context());
  assert.equal(absent.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal((await absent.json()).error, "UNAUTHORIZED");
  assert.equal((await wrong.json()).error, "UNAUTHORIZED");
});

test("client MCP ufficiale esegue handshake, discovery, read e write isolata", async () => {
  const database = fakeDb();
  const runtime = env(database);
  const client = new Client({ name: "desk-v2-local-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://desk-v2.test/mcp"), {
    authProvider: { token: async () => runtime.DESK_V2_MCP_BEARER_TOKEN },
    fetch: (input, init) => worker.fetch(new Request(input, init), runtime, context())
  });

  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [
      "desk_v2_capability_read",
      "desk_v2_capability_write",
      "desk_v2_create_container",
      "desk_v2_get_containers",
      "desk_v2_move_container",
      "desk_v2_update_container"
    ]);
    const readTool = listed.tools.find(tool => tool.name === "desk_v2_capability_read");
    const writeTool = listed.tools.find(tool => tool.name === "desk_v2_capability_write");
    const containersTool = listed.tools.find(tool => tool.name === "desk_v2_get_containers");
    const createTool = listed.tools.find(tool => tool.name === "desk_v2_create_container");
    const moveTool = listed.tools.find(tool => tool.name === "desk_v2_move_container");
    const updateTool = listed.tools.find(tool => tool.name === "desk_v2_update_container");
    assert.equal(readTool.annotations.readOnlyHint, true);
    assert.equal(writeTool.annotations.readOnlyHint, false);
    assert.equal(writeTool.annotations.destructiveHint, false);
    assert.deepEqual(containersTool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
    assert.deepEqual(createTool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
    assert.deepEqual(moveTool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
    assert.deepEqual(updateTool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });

    const before = database.snapshot();
    const read = await client.callTool({ name: "desk_v2_capability_read", arguments: {} });
    assert.deepEqual(read.structuredContent, {
      service: "desk-v2",
      environment: "v2-development",
      schemaVersion: "0001_foundation",
      containerCount: 0,
      taskCount: 0
    });
    assert.deepEqual(database.snapshot(), before);

    const write = await client.callTool({
      name: "desk_v2_capability_write",
      arguments: { marker: "CODEX-LOCAL-CAPABILITY" }
    });
    assert.equal(write.structuredContent.id, 1);
    assert.equal(write.structuredContent.marker, "CODEX-LOCAL-CAPABILITY");
    assert.equal(database.snapshot().markers.length, 1);
    assert.equal(database.snapshot().containers, 0);
    assert.equal(database.snapshot().tasks, 0);

    const invalid = await client.callTool({
      name: "desk_v2_capability_write",
      arguments: { marker: "invalid marker; DROP TABLE tasks" }
    });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /invalid|parameter|validation/i);
    assert.equal(database.snapshot().markers.length, 1);
  } finally {
    await client.close();
  }
});

test("container read gestisce database vuoto senza side effect", async () => {
  const database = fakeDb();
  await withClient(database, async client => {
    const before = database.snapshot();
    const result = await client.callTool({ name: "desk_v2_get_containers", arguments: {} });
    assert.deepEqual(result.structuredContent, {
      scope: "ROOTS",
      parentId: null,
      lifecycle: "ACTIVE",
      count: 0,
      containers: []
    });
    assert.deepEqual(database.snapshot(), before);
    assert.equal(database.audit().writes, 0);
    assert.equal(database.audit().taskQueries, 0);
  });
});

test("container read restituisce root e figli diretti con lifecycle e ordine deterministico", async () => {
  const database = fakeDb([
    container({ id: "ROOT-Z", name: "Zulu", focus: null, owner: null, nextAction: null }),
    container({ id: "ROOT-A2", name: "Alpha", focus: "Focus A2", owner: "Max", nextAction: "Review" }),
    container({ id: "ROOT-A1", name: "Alpha" }),
    container({ id: "ROOT-ARCHIVED", name: "Archived", lifecycle: "ARCHIVED" }),
    container({ id: "CHILD-B", parentId: "ROOT-A1", name: "Beta" }),
    container({ id: "CHILD-A", parentId: "ROOT-A1", name: "Alpha" }),
    container({ id: "CHILD-ARCHIVED", parentId: "ROOT-A1", name: "Old", lifecycle: "ARCHIVED" }),
    container({ id: "GRANDCHILD", parentId: "CHILD-A", name: "Nested" })
  ]);

  await withClient(database, async client => {
    const roots = await callContainers(client, {});
    assert.deepEqual(roots.containers.map(row => row.containerId), ["ROOT-A1", "ROOT-A2", "ROOT-Z"]);
    assert.equal(roots.scope, "ROOTS");
    assert.equal(roots.lifecycle, "ACTIVE");
    assert.deepEqual(roots.containers[1], {
      containerId: "ROOT-A2",
      parentId: null,
      name: "Alpha",
      status: "OPEN",
      focus: "Focus A2",
      owner: "Max",
      nextAction: "Review",
      lifecycleState: "ACTIVE",
      version: 1,
      createdAt: "2026-09-25T08:00:00.000Z",
      updatedAt: "2026-09-25T08:00:00.000Z",
      archivedAt: null
    });
    assert.equal(roots.containers[0].focus, null);
    assert.equal(roots.containers[0].owner, null);
    assert.equal(roots.containers[0].nextAction, null);

    const children = await callContainers(client, { parentId: "ROOT-A1" });
    assert.equal(children.scope, "CHILDREN");
    assert.equal(children.parentId, "ROOT-A1");
    assert.deepEqual(children.containers.map(row => row.containerId), ["CHILD-A", "CHILD-B"]);
    assert.equal(children.containers.some(row => row.containerId === "GRANDCHILD"), false);

    const archived = await callContainers(client, { lifecycle: "ARCHIVED" });
    assert.deepEqual(archived.containers.map(row => row.containerId), ["ROOT-ARCHIVED"]);
    assert.equal(archived.containers[0].archivedAt, "2026-09-25T09:00:00.000Z");

    const all = await callContainers(client, { lifecycle: "ALL" });
    assert.deepEqual(all.containers.map(row => row.containerId), [
      "ROOT-A1", "ROOT-A2", "ROOT-ARCHIVED", "ROOT-Z"
    ]);

    const noChildren = await callContainers(client, { parentId: "ROOT-Z" });
    const missingParent = await callContainers(client, { parentId: "MISSING" });
    assert.deepEqual(noChildren.containers, []);
    assert.deepEqual(missingParent.containers, []);
    assert.equal(database.audit().writes, 0);
    assert.equal(database.audit().taskQueries, 0);
  });
});

test("container read esegue lookup BY_ID anche per archiviati e gestisce ID inesistente", async () => {
  const database = fakeDb([
    container({ id: "ARCHIVED-ID", name: "Archived", lifecycle: "ARCHIVED" })
  ]);
  await withClient(database, async client => {
    const found = await callContainers(client, { containerId: "ARCHIVED-ID" });
    assert.equal(found.scope, "BY_ID");
    assert.equal(found.parentId, null);
    assert.equal(found.lifecycle, null);
    assert.equal(found.count, 1);
    assert.equal(found.containers[0].lifecycleState, "ARCHIVED");

    const missing = await callContainers(client, { containerId: "MISSING" });
    assert.deepEqual(missing, {
      scope: "BY_ID",
      parentId: null,
      lifecycle: null,
      count: 0,
      containers: []
    });
    assert.equal(database.audit().writes, 0);
    assert.equal(database.audit().taskQueries, 0);
  });
});

test("container read rifiuta combinazioni e proprietà non valide", async () => {
  const database = fakeDb();
  await withClient(database, async client => {
    const invalidArguments = [
      { containerId: "A", parentId: "B" },
      { containerId: "" },
      { containerId: "   " },
      { parentId: "" },
      { parentId: "\t" },
      { lifecycle: "DELETED" },
      { containerId: "A", lifecycle: "ACTIVE" },
      { unexpected: true }
    ];
    for (const args of invalidArguments) {
      const result = await client.callTool({ name: "desk_v2_get_containers", arguments: args });
      assert.equal(result.isError, true, `expected invalid input: ${JSON.stringify(args)}`);
    }
    assert.equal(database.audit().containerQueries, 0);
    assert.equal(database.audit().writes, 0);
  });
});

test("container create normalizza input, crea root e child e resta coerente con READ", async () => {
  const database = fakeDb();
  await withClient(database, async client => {
    const root = await callCreate(client, {
      idempotencyKey: " root-create-001 ",
      name: "  Root Alpha  ",
      focus: "  Focus  ",
      owner: "   ",
      nextAction: null
    });
    assert.equal(root.replayed, false);
    assert.match(root.container.containerId,
      /^CTR-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.deepEqual({
      parentId: root.container.parentId,
      name: root.container.name,
      status: root.container.status,
      focus: root.container.focus,
      owner: root.container.owner,
      nextAction: root.container.nextAction,
      lifecycleState: root.container.lifecycleState,
      version: root.container.version,
      archivedAt: root.container.archivedAt
    }, {
      parentId: null,
      name: "Root Alpha",
      status: "IN_PROGRESS",
      focus: "Focus",
      owner: null,
      nextAction: null,
      lifecycleState: "ACTIVE",
      version: 1,
      archivedAt: null
    });
    assert.equal(root.container.createdAt, root.container.updatedAt);
    assert.equal(new Date(root.container.createdAt).toISOString(), root.container.createdAt);

    const child = await callCreate(client, {
      idempotencyKey: "child-create-001",
      name: "Child",
      parentId: ` ${root.container.containerId} `,
      focus: null,
      owner: " Max ",
      nextAction: " Review "
    });
    assert.equal(child.container.parentId, root.container.containerId);
    assert.equal(child.container.owner, "Max");
    assert.equal(child.container.nextAction, "Review");

    const byId = await callContainers(client, { containerId: child.container.containerId });
    assert.deepEqual(byId.containers[0], child.container);
    assert.equal(database.snapshot().tasks, 0);
  });
});

test("container create applica idempotenza, conflitto e nomi duplicati", async () => {
  const database = fakeDb();
  await withClient(database, async client => {
    const input = { idempotencyKey: "same-001", name: "Duplicate" };
    const first = await callCreate(client, input);
    const replay = await callCreate(client, input);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.container, first.container);
    assert.equal(database.snapshot().containers, 1);
    assert.equal(database.snapshot().idempotency, 1);

    database.updateContainer(first.container.containerId, { name: "Changed Later" });
    const snapshotReplay = await callCreate(client, input);
    assert.equal(snapshotReplay.container.name, "Duplicate");

    const conflict = await client.callTool({
      name: "desk_v2_create_container",
      arguments: { idempotencyKey: "same-001", name: "Different" }
    });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error.code, "IDEMPOTENCY_KEY_CONFLICT");
    assert.equal(database.snapshot().containers, 1);

    const second = await callCreate(client,
      { idempotencyKey: "same-name-002", name: "Duplicate" });
    assert.notEqual(second.container.containerId, first.container.containerId);
    assert.equal(database.snapshot().containers, 2);
  });
});

test("container create gestisce parent invalido e validazione strict senza side effect", async () => {
  const database = fakeDb([
    container({ id: "ACTIVE-PARENT", name: "Active" }),
    container({ id: "ARCHIVED-PARENT", name: "Archived", lifecycle: "ARCHIVED" })
  ]);
  await withClient(database, async client => {
    const missing = await client.callTool({
      name: "desk_v2_create_container",
      arguments: { idempotencyKey: "missing-parent", name: "Child", parentId: "MISSING" }
    });
    assert.equal(missing.structuredContent.error.code, "CONTAINER_PARENT_NOT_FOUND");

    const archived = await client.callTool({
      name: "desk_v2_create_container",
      arguments: { idempotencyKey: "archived-parent", name: "Child", parentId: "ARCHIVED-PARENT" }
    });
    assert.equal(archived.structuredContent.error.code, "CONTAINER_PARENT_ARCHIVED");

    for (const [arguments_, code] of [
      [{ idempotencyKey: "bad name", name: "Valid" }, "INVALID_IDEMPOTENCY_KEY"],
      [{ idempotencyKey: "valid-key", name: "   " }, "INVALID_NAME"],
      [{ idempotencyKey: "valid-key", name: "Valid", parentId: "  " },
        "INVALID_PARENT_ID"],
      [{ idempotencyKey: "valid-key", name: "Valid", status: "DONE" }, null]
    ]) {
      const result = await client.callTool({
        name: "desk_v2_create_container", arguments: arguments_
      });
      assert.equal(result.isError, true);
      if (code) assert.match(result.content[0].text, new RegExp(code));
    }
    assert.equal(database.snapshot().containers, 2);
    assert.equal(database.snapshot().idempotency, 0);
  });
});

test("container create serializza richieste concorrenti sulla stessa key", async () => {
  const database = fakeDb();
  await withClient(database, async client => {
    const same = await Promise.all([
      callCreate(client, { idempotencyKey: "concurrent-same", name: "Concurrent" }),
      callCreate(client, { idempotencyKey: "concurrent-same", name: "Concurrent" })
    ]);
    assert.deepEqual(same.map(result => result.replayed).sort(), [false, true]);
    assert.equal(database.snapshot().containers, 1);

    const different = await Promise.all([
      client.callTool({ name: "desk_v2_create_container", arguments: {
        idempotencyKey: "concurrent-different", name: "Winner A"
      } }),
      client.callTool({ name: "desk_v2_create_container", arguments: {
        idempotencyKey: "concurrent-different", name: "Winner B"
      } })
    ]);
    assert.equal(different.filter(result => result.isError === true).length, 1);
    assert.equal(different.filter(result => result.isError !== true).length, 1);
    assert.equal(different.find(result => result.isError === true)
      .structuredContent.error.code, "IDEMPOTENCY_KEY_CONFLICT");
    assert.equal(database.snapshot().containers, 2);
  });
});

test("container create rollbacka la key su collisione e consente retry", async () => {
  const database = fakeDb([], { collideNextCreate: true });
  await withClient(database, async client => {
    const collision = await client.callTool({
      name: "desk_v2_create_container",
      arguments: { idempotencyKey: "collision-retry", name: "Collision" }
    });
    assert.equal(collision.isError, true);
    assert.equal(collision.structuredContent.error.code, "CONTAINER_ID_COLLISION");
    assert.equal(collision.structuredContent.error.retryable, true);
    assert.equal(database.snapshot().containers, 0);
    assert.equal(database.snapshot().idempotency, 0);

    const retry = await callCreate(client,
      { idempotencyKey: "collision-retry", name: "Collision" });
    assert.equal(retry.replayed, false);
    assert.equal(database.snapshot().containers, 1);
    assert.equal(database.snapshot().idempotency, 1);
  });
});

test("container move valida schema strict e accetta ID legacy", async () => {
  const database = fakeDb([
    container({ id: "LEGACY ROOT", name: "Legacy Root" }),
    container({ id: "LEGACY CHILD", name: "Legacy Child" })
  ]);
  await withClient(database, async client => {
    const invalidInputs = [
      [{}, null],
      [{ idempotencyKey: "move", containerId: "LEGACY CHILD", expectedVersion: 1 },
        "INVALID_NEW_PARENT_ID"],
      [{ idempotencyKey: "move", newParentId: null, expectedVersion: 1 },
        "INVALID_CONTAINER_ID"],
      [{ idempotencyKey: "move", containerId: "LEGACY CHILD", newParentId: null },
        "INVALID_EXPECTED_VERSION"],
      { idempotencyKey: "move", containerId: "LEGACY CHILD", newParentId: null,
        expectedVersion: "1" },
      { idempotencyKey: "move", containerId: " ", newParentId: null,
        expectedVersion: 1 },
      { idempotencyKey: "move", containerId: "LEGACY CHILD", newParentId: " ",
        expectedVersion: 1 },
      { idempotencyKey: "move", containerId: "LEGACY CHILD", newParentId: null,
        expectedVersion: 1, extra: true }
    ].map(entry => Array.isArray(entry) ? entry : [entry,
      typeof entry.expectedVersion === "string" ? "INVALID_EXPECTED_VERSION"
        : entry.containerId?.trim() === "" ? "INVALID_CONTAINER_ID"
          : entry.newParentId?.trim() === "" ? "INVALID_NEW_PARENT_ID" : null]);
    for (const [arguments_, code] of invalidInputs) {
      const result = await client.callTool({ name: "desk_v2_move_container", arguments: arguments_ });
      assert.equal(result.isError, true, JSON.stringify(arguments_));
      if (code) assert.match(result.content[0].text, new RegExp(code));
    }
    const moved = await callMove(client, {
      idempotencyKey: " legacy-move ", containerId: " LEGACY CHILD ",
      newParentId: " LEGACY ROOT ", expectedVersion: 1
    });
    assert.equal(moved.container.containerId, "LEGACY CHILD");
    assert.equal(moved.container.parentId, "LEGACY ROOT");
  });
});

test("container move copre root-child, child-root, altro parent e preserva dominio", async () => {
  const database = fakeDb([
    container({ id: "ROOT-A", name: "Root A" }),
    container({ id: "ROOT-B", name: "Root B" }),
    container({ id: "CHILD", parentId: null, name: "Child", focus: "Focus",
      owner: "Owner", nextAction: "Next" }),
    container({ id: "GRANDCHILD", parentId: "CHILD", name: "Grandchild" })
  ]);
  await withClient(database, async client => {
    const original = database.getContainer("CHILD");
    const toA = await callMove(client, {
      idempotencyKey: "move-to-a", containerId: "CHILD", newParentId: "ROOT-A",
      expectedVersion: 1
    });
    assert.equal(toA.replayed, false);
    assert.equal(toA.changed, true);
    assert.equal(toA.container.parentId, "ROOT-A");
    assert.equal(toA.container.version, 2);
    assert.notEqual(toA.container.updatedAt, original.updated_at);
    assert.equal(toA.container.createdAt, original.created_at);
    assert.deepEqual({ name: toA.container.name, status: toA.container.status,
      focus: toA.container.focus, owner: toA.container.owner,
      nextAction: toA.container.nextAction, lifecycleState: toA.container.lifecycleState },
    { name: original.name, status: original.status, focus: original.focus,
      owner: original.owner, nextAction: original.next_action,
      lifecycleState: original.lifecycle_state });
    assert.equal(database.getContainer("GRANDCHILD").parent_id, "CHILD");

    const toRoot = await callMove(client, {
      idempotencyKey: "move-root", containerId: "CHILD", newParentId: null,
      expectedVersion: 2
    });
    assert.equal(toRoot.container.parentId, null);
    assert.equal(toRoot.container.version, 3);

    const toB = await callMove(client, {
      idempotencyKey: "move-to-b", containerId: "CHILD", newParentId: "ROOT-B",
      expectedVersion: 3
    });
    assert.equal(toB.container.parentId, "ROOT-B");
    assert.equal(toB.container.version, 4);
    assert.equal(database.getContainer("GRANDCHILD").parent_id, "CHILD");
    assert.equal(database.snapshot().tasks, 0);
  });
});

test("container move classifica lifecycle, parent, self, cycle e version", async () => {
  const database = fakeDb([
    container({ id: "ROOT", name: "Root" }),
    container({ id: "CHILD", parentId: "ROOT", name: "Child" }),
    container({ id: "GRANDCHILD", parentId: "CHILD", name: "Grandchild" }),
    container({ id: "ARCHIVED", name: "Archived", lifecycle: "ARCHIVED" })
  ]);
  await withClient(database, async client => {
    const cases = [
      ["missing", "MISSING", null, 1, "CONTAINER_NOT_FOUND"],
      ["archived", "ARCHIVED", null, 1, "CONTAINER_ARCHIVED"],
      ["version", "CHILD", null, 2, "CONTAINER_VERSION_CONFLICT"],
      ["self", "CHILD", "CHILD", 1, "CONTAINER_SELF_PARENT"],
      ["parent-missing", "CHILD", "MISSING", 1, "CONTAINER_PARENT_NOT_FOUND"],
      ["parent-archived", "CHILD", "ARCHIVED", 1, "CONTAINER_PARENT_ARCHIVED"],
      ["cycle", "ROOT", "GRANDCHILD", 1, "CONTAINER_CYCLE"]
    ];
    for (const [key, containerId, newParentId, expectedVersion, code] of cases) {
      const result = await client.callTool({ name: "desk_v2_move_container", arguments: {
        idempotencyKey: key, containerId, newParentId, expectedVersion
      } });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.code, code);
      assert.equal(result.structuredContent.error.retryable, false);
    }
    assert.equal(database.getContainer("ROOT").parent_id, null);
    assert.equal(database.snapshot().idempotency, 0);
  });
});

test("container move gestisce no-op, replay, conflict e snapshot storico", async () => {
  const database = fakeDb([
    container({ id: "ROOT", name: "Root" }),
    container({ id: "CHILD", parentId: "ROOT", name: "Child" })
  ]);
  await withClient(database, async client => {
    const noOpInput = { idempotencyKey: "noop", containerId: "CHILD",
      newParentId: "ROOT", expectedVersion: 1 };
    const noOp = await callMove(client, noOpInput);
    assert.equal(noOp.changed, false);
    assert.equal(noOp.container.version, 1);
    assert.equal(noOp.container.updatedAt, "2026-09-25T08:00:00.000Z");
    const noOpReplay = await callMove(client, noOpInput);
    assert.equal(noOpReplay.replayed, true);
    assert.deepEqual(noOpReplay.container, noOp.container);

    const moveInput = { idempotencyKey: "historical", containerId: "CHILD",
      newParentId: null, expectedVersion: 1 };
    const moved = await callMove(client, moveInput);
    database.updateContainer("CHILD", { parentId: "ROOT", version: 3,
      updatedAt: "2026-09-26T00:00:00.000Z", lifecycleState: "ARCHIVED",
      archivedAt: "2026-09-26T00:00:00.000Z" });
    const replay = await callMove(client, moveInput);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.container, moved.container);
    assert.equal(database.getContainer("CHILD").parent_id, "ROOT");
    assert.equal(database.getContainer("CHILD").version, 3);

    const conflict = await client.callTool({ name: "desk_v2_move_container", arguments: {
      ...moveInput, newParentId: "ROOT"
    } });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error.code, "IDEMPOTENCY_KEY_CONFLICT");
  });
});

test("container move serializza concorrenza e sanitizza rollback D1", async () => {
  const database = fakeDb([
    container({ id: "ROOT-A", name: "Root A" }),
    container({ id: "ROOT-B", name: "Root B" }),
    container({ id: "CHILD", name: "Child" })
  ]);
  await withClient(database, async client => {
    const different = await Promise.all([
      client.callTool({ name: "desk_v2_move_container", arguments: {
        idempotencyKey: "key-a", containerId: "CHILD", newParentId: "ROOT-A",
        expectedVersion: 1
      } }),
      client.callTool({ name: "desk_v2_move_container", arguments: {
        idempotencyKey: "key-b", containerId: "CHILD", newParentId: "ROOT-B",
        expectedVersion: 1
      } })
    ]);
    assert.equal(different.filter(result => result.isError !== true).length, 1);
    assert.equal(different.find(result => result.isError === true)
      .structuredContent.error.code, "CONTAINER_VERSION_CONFLICT");
    assert.equal(database.getContainer("CHILD").version, 2);
    assert.equal(database.snapshot().idempotency, 1);
  });

  const failing = fakeDb([
    container({ id: "ROOT", name: "Root" }), container({ id: "CHILD", name: "Child" })
  ], { failNextMoveBatch: true });
  await withClient(failing, async client => {
    const failed = await client.callTool({ name: "desk_v2_move_container", arguments: {
      idempotencyKey: "rollback", containerId: "CHILD", newParentId: "ROOT",
      expectedVersion: 1
    } });
    assert.equal(failed.isError, true);
    assert.equal(failed.structuredContent.error.code, "D1_OPERATION_FAILED");
    assert.equal(failed.structuredContent.error.retryable, true);
    assert.equal(failing.getContainer("CHILD").parent_id, null);
    assert.equal(failing.getContainer("CHILD").version, 1);
    assert.equal(failing.snapshot().idempotency, 0);
  });
});

test("container update valida schema strict, patch e normalizzazione", async () => {
  const database = fakeDb([container({ id: "LEGACY ID", name: "Original" })]);
  await withClient(database, async client => {
    const invalid = [
      [{}, null],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1 },
        "INVALID_PATCH"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1, patch: null },
        "INVALID_PATCH"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1, patch: [] },
        "INVALID_PATCH"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1, patch: {} },
        "INVALID_PATCH"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { parentId: null } }, "INVALID_PATCH"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { name: null } }, "INVALID_CONTAINER_NAME"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { name: "  " } }, "INVALID_CONTAINER_NAME"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { status: null } }, "INVALID_CONTAINER_STATUS"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { status: "" } }, "INVALID_CONTAINER_STATUS"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { focus: 1 } }, "INVALID_CONTAINER_FOCUS"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { owner: false } }, "INVALID_CONTAINER_OWNER"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { nextAction: {} } }, "INVALID_CONTAINER_NEXT_ACTION"],
      [{ idempotencyKey: "u", containerId: " ", expectedVersion: 1,
        patch: { name: "Valid" } }, "INVALID_CONTAINER_ID"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: "1",
        patch: { name: "Valid" } }, "INVALID_EXPECTED_VERSION"],
      [{ idempotencyKey: "bad key", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { name: "Valid" } }, "INVALID_IDEMPOTENCY_KEY"],
      [{ idempotencyKey: "u", containerId: "LEGACY ID", expectedVersion: 1,
        patch: { name: "Valid" }, extra: true }, null]
    ];
    for (const [arguments_, code] of invalid) {
      const result = await client.callTool({ name: "desk_v2_update_container", arguments: arguments_ });
      assert.equal(result.isError, true, JSON.stringify(arguments_));
      if (code) assert.match(result.content[0].text, new RegExp(code));
    }
    assert.equal(database.snapshot().idempotency, 0);

    const updated = await callUpdate(client, {
      idempotencyKey: " normalized ", containerId: " LEGACY ID ", expectedVersion: 1,
      patch: { name: " Renamed ", status: " LEGACY_STATE ", focus: " ",
        owner: null, nextAction: " Next " }
    });
    assert.deepEqual({ name: updated.container.name, status: updated.container.status,
      focus: updated.container.focus, owner: updated.container.owner,
      nextAction: updated.container.nextAction },
    { name: "Renamed", status: "LEGACY_STATE", focus: null, owner: null,
      nextAction: "Next" });
    assert.equal(updated.container.containerId, "LEGACY ID");
  });
});

test("container update accetta ciascun campo singolarmente", async () => {
  const fields = [
    ["name", " New Name ", "New Name"],
    ["status", " LEGACY_STATUS ", "LEGACY_STATUS"],
    ["focus", " New Focus ", "New Focus"],
    ["owner", " New Owner ", "New Owner"],
    ["nextAction", " New Next ", "New Next"]
  ];
  const database = fakeDb(fields.map(([field]) => container({
    id: `SINGLE-${field}`, name: `Single ${field}`, focus: "Old Focus",
    owner: "Old Owner", nextAction: "Old Next"
  })));
  await withClient(database, async client => {
    for (const [field, inputValue, expectedValue] of fields) {
      const id = `SINGLE-${field}`;
      const before = database.getContainer(id);
      const result = await callUpdate(client, { idempotencyKey: `single-${field}`,
        containerId: id, expectedVersion: 1, patch: { [field]: inputValue } });
      assert.equal(result.container[field], expectedValue);
      assert.equal(result.container.version, 2);
      for (const [otherField] of fields) {
        if (otherField === field) continue;
        const column = otherField === "nextAction" ? "next_action" : otherField;
        assert.equal(result.container[otherField], before[column]);
      }
    }
  });
});

test("container update applica patch parziale e preserva struttura e dominio", async () => {
  const database = fakeDb([
    container({ id: "ROOT", name: "Root", focus: "Focus", owner: "Owner",
      nextAction: "Next" }),
    container({ id: "CHILD", parentId: "ROOT", name: "Child" })
  ]);
  await withClient(database, async client => {
    const before = database.getContainer("ROOT");
    const updated = await callUpdate(client, { idempotencyKey: "partial",
      containerId: "ROOT", expectedVersion: 1, patch: { owner: " New Owner " } });
    assert.equal(updated.replayed, false);
    assert.equal(updated.changed, true);
    assert.equal(updated.container.owner, "New Owner");
    assert.equal(updated.container.name, before.name);
    assert.equal(updated.container.status, before.status);
    assert.equal(updated.container.focus, before.focus);
    assert.equal(updated.container.nextAction, before.next_action);
    assert.equal(updated.container.parentId, before.parent_id);
    assert.equal(updated.container.lifecycleState, before.lifecycle_state);
    assert.equal(updated.container.archivedAt, before.archived_at);
    assert.equal(updated.container.createdAt, before.created_at);
    assert.equal(updated.container.version, 2);
    assert.notEqual(updated.container.updatedAt, before.updated_at);
    assert.equal(database.getContainer("CHILD").parent_id, "ROOT");
    const read = await callContainers(client, { containerId: "ROOT" });
    assert.deepEqual(read.containers[0], updated.container);
  });
});

test("container update gestisce no-op, replay, canonicalizzazione e snapshot storico", async () => {
  const database = fakeDb([container({ id: "TARGET", name: "Target", focus: "A", owner: "B" })]);
  await withClient(database, async client => {
    const noOpInput = { idempotencyKey: "noop-update", containerId: "TARGET",
      expectedVersion: 1, patch: { focus: " A " } };
    const noOp = await callUpdate(client, noOpInput);
    assert.equal(noOp.changed, false);
    assert.equal(noOp.container.version, 1);
    assert.equal(noOp.container.updatedAt, "2026-09-25T08:00:00.000Z");
    assert.equal((await callUpdate(client, noOpInput)).replayed, true);

    const ordered = { idempotencyKey: "canonical", containerId: "TARGET",
      expectedVersion: 1, patch: { focus: "C", owner: "D" } };
    const first = await callUpdate(client, ordered);
    const replay = await callUpdate(client, { ...ordered, patch: { owner: "D", focus: "C" } });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.container, first.container);

    database.updateContainer("TARGET", { name: "Later", version: 3,
      updatedAt: "2026-09-26T00:00:00.000Z", parentId: "LATER-PARENT",
      lifecycleState: "ARCHIVED", archivedAt: "2026-09-26T00:00:00.000Z" });
    const historical = await callUpdate(client, ordered);
    assert.deepEqual(historical.container, first.container);
    assert.equal(database.getContainer("TARGET").name, "Later");
    const conflict = await client.callTool({ name: "desk_v2_update_container", arguments: {
      ...ordered, patch: { focus: "Different", owner: "D" }
    } });
    assert.equal(conflict.structuredContent.error.code, "IDEMPOTENCY_KEY_CONFLICT");
  });
});

test("container update classifica dominio, concorrenza e rollback sanitizzato", async () => {
  const database = fakeDb([
    container({ id: "TARGET", name: "Target" }),
    container({ id: "ARCHIVED", name: "Archived", lifecycle: "ARCHIVED" })
  ]);
  await withClient(database, async client => {
    const cases = [
      ["missing", "MISSING", 1, "CONTAINER_NOT_FOUND"],
      ["archived-update", "ARCHIVED", 1, "CONTAINER_ARCHIVED"],
      ["version-update", "TARGET", 2, "CONTAINER_VERSION_CONFLICT"]
    ];
    for (const [key, containerId, expectedVersion, code] of cases) {
      const result = await client.callTool({ name: "desk_v2_update_container", arguments: {
        idempotencyKey: key, containerId, expectedVersion, patch: { name: "Changed" }
      } });
      assert.equal(result.structuredContent.error.code, code);
    }
    assert.equal(database.snapshot().idempotency, 0);
    const concurrent = await Promise.all([
      client.callTool({ name: "desk_v2_update_container", arguments: {
        idempotencyKey: "concurrent-a", containerId: "TARGET", expectedVersion: 1,
        patch: { focus: "A" }
      } }),
      client.callTool({ name: "desk_v2_update_container", arguments: {
        idempotencyKey: "concurrent-b", containerId: "TARGET", expectedVersion: 1,
        patch: { owner: "B" }
      } })
    ]);
    assert.equal(concurrent.filter(result => result.isError !== true).length, 1);
    assert.equal(concurrent.find(result => result.isError === true)
      .structuredContent.error.code, "CONTAINER_VERSION_CONFLICT");
    assert.equal(database.getContainer("TARGET").version, 2);
  });

  const sameKey = fakeDb([container({ id: "TARGET", name: "Target" })]);
  await withClient(sameKey, async client => {
    const input = { idempotencyKey: "same-key", containerId: "TARGET",
      expectedVersion: 1, patch: { name: "Changed" } };
    const results = await Promise.all([
      client.callTool({ name: "desk_v2_update_container", arguments: input }),
      client.callTool({ name: "desk_v2_update_container", arguments: input })
    ]);
    assert.deepEqual(results.map(result => result.structuredContent.replayed).sort(), [false, true]);
    assert.equal(sameKey.getContainer("TARGET").version, 2);
  });

  const failing = fakeDb([container({ id: "TARGET", name: "Target" })],
    { failNextUpdateBatch: true });
  await withClient(failing, async client => {
    const result = await client.callTool({ name: "desk_v2_update_container", arguments: {
      idempotencyKey: "rollback-update", containerId: "TARGET", expectedVersion: 1,
      patch: { name: "Changed" }
    } });
    assert.equal(result.structuredContent.error.code, "D1_OPERATION_FAILED");
    assert.equal(result.structuredContent.error.retryable, true);
    assert.equal(failing.getContainer("TARGET").name, "Target");
    assert.equal(failing.snapshot().idempotency, 0);
  });
});

function request(body, token) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("https://desk-v2.test/mcp", { method: "POST", headers, body });
}

function env(database = fakeDb()) {
  return {
    DESK_SYSTEM_NAME: "desk-v2",
    DESK_ENVIRONMENT: "v2-development",
    DESK_SCHEMA_FAMILY: "desk-v2-foundation",
    DESK_REQUIRED_MIGRATION: "0001_foundation.sql",
    DESK_V2_MCP_BEARER_TOKEN: "synthetic-local-test-token",
    DESK_V2_DB: database
  };
}

function context() {
  return { waitUntil() {}, passThroughOnException() {} };
}

async function withClient(database, callback) {
  const runtime = env(database);
  const client = new Client({ name: "desk-v2-container-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://desk-v2.test/mcp"), {
    authProvider: { token: async () => runtime.DESK_V2_MCP_BEARER_TOKEN },
    fetch: (input, init) => worker.fetch(new Request(input, init), runtime, context())
  });
  await client.connect(transport);
  try {
    await callback(client);
  } finally {
    await client.close();
  }
}

async function callContainers(client, args) {
  const result = await client.callTool({ name: "desk_v2_get_containers", arguments: args });
  assert.notEqual(result.isError, true);
  return result.structuredContent;
}

async function callCreate(client, args) {
  const result = await client.callTool({ name: "desk_v2_create_container", arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent));
  return result.structuredContent;
}

async function callMove(client, args) {
  const result = await client.callTool({ name: "desk_v2_move_container", arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent));
  return result.structuredContent;
}

async function callUpdate(client, args) {
  const result = await client.callTool({ name: "desk_v2_update_container", arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent));
  return result.structuredContent;
}

function container({ id, parentId = null, name, lifecycle = "ACTIVE", focus = null,
  owner = null, nextAction = null }) {
  return {
    container_id: id,
    parent_id: parentId,
    name,
    status: "OPEN",
    focus,
    owner,
    next_action: nextAction,
    lifecycle_state: lifecycle,
    version: 1,
    created_at: "2026-09-25T08:00:00.000Z",
    updated_at: "2026-09-25T08:00:00.000Z",
    archived_at: lifecycle === "ARCHIVED" ? "2026-09-25T09:00:00.000Z" : null
  };
}

function fakeDb(containers = [], options = {}) {
  const state = {
    containers: structuredClone(containers), tasks: 0, markers: [], idempotency: []
  };
  const audit = { containerQueries: 0, taskQueries: 0, writes: 0 };
  let collideNextCreate = options.collideNextCreate === true;
  let failNextMoveBatch = options.failNextMoveBatch === true;
  let failNextUpdateBatch = options.failNextUpdateBatch === true;
  let collidedId = null;
  const database = {
    prepare(sql) {
      let values = [];
      if (/\bFROM\s+containers\b/i.test(sql)) audit.containerQueries += 1;
      if (/\bFROM\s+tasks\b/i.test(sql)) audit.taskQueries += 1;
      const statement = {
        bind(...bound) { values = bound; return statement; },
        _sql: sql,
        _values() { return values; },
        async first() {
          if (/COUNT\(\*\).*containers/i.test(sql)) return { count: state.containers.length };
          if (/COUNT\(\*\).*tasks/i.test(sql)) return { count: state.tasks };
          if (/FROM mcp_capability_test WHERE id/i.test(sql)) {
            return state.markers.find(row => row.id === Number(values[0])) || null;
          }
          if (/FROM mcp_idempotency/i.test(sql)) {
            return structuredClone(state.idempotency.find(row => (
              row.operation === values[0] && row.idempotency_key === values[1]
            )) || null);
          }
          if (/WITH RECURSIVE descendants/i.test(sql)) {
            return isDescendant(state.containers, values[0], values[1]) ? { found: 1 } : null;
          }
          if (/SELECT container_id FROM containers WHERE container_id/i.test(sql)) {
            if (values[0] === collidedId) return { container_id: values[0] };
            return state.containers.find(row => row.container_id === values[0]) || null;
          }
          if (/SELECT lifecycle_state FROM containers WHERE container_id/i.test(sql)) {
            const row = state.containers.find(item => item.container_id === values[0]);
            return row ? { lifecycle_state: row.lifecycle_state } : null;
          }
          if (/SELECT[\s\S]+FROM containers[\s\S]+WHERE container_id = \?/i.test(sql)) {
            return structuredClone(state.containers.find(row => row.container_id === values[0]) || null);
          }
          throw new Error(`unexpected first query: ${sql}`);
        },
        async all() {
          if (/WITH RECURSIVE descendants/i.test(sql)) {
            return { results: isDescendant(state.containers, values[0], values[1])
              ? [{ found: 1 }] : [] };
          }
          if (!/^\s*SELECT\b/i.test(sql) || !/\bFROM\s+containers\b/i.test(sql)) {
            throw new Error(`unexpected container query: ${sql}`);
          }
          let rows = [...state.containers];
          let valueIndex = 0;
          if (/WHERE\s+container_id\s*=\s*\?/i.test(sql)) {
            const containerId = values[valueIndex++];
            rows = rows.filter(row => row.container_id === containerId);
          } else if (/parent_id\s+IS\s+NULL/i.test(sql)) {
            rows = rows.filter(row => row.parent_id === null);
          } else if (/WHERE\s+parent_id\s*=\s*\?/i.test(sql)) {
            const parentId = values[valueIndex++];
            rows = rows.filter(row => row.parent_id === parentId);
          }
          if (/lifecycle_state\s*=\s*\?/i.test(sql)) {
            const lifecycle = values[valueIndex++];
            rows = rows.filter(row => row.lifecycle_state === lifecycle);
          }
          if (/ORDER\s+BY\s+name\s+ASC,\s*container_id\s+ASC/i.test(sql)) {
            rows.sort((left, right) => left.name < right.name ? -1
              : left.name > right.name ? 1
                : left.container_id < right.container_id ? -1
                  : left.container_id > right.container_id ? 1 : 0);
          }
          return { results: structuredClone(rows) };
        },
        async run() {
          audit.writes += 1;
          if (!/INSERT INTO mcp_capability_test/i.test(sql)) {
            throw new Error(`unexpected write query: ${sql}`);
          }
          const row = {
            id: state.markers.length + 1,
            marker: values[0],
            created_at: "2026-09-24T00:00:00.000Z"
          };
          state.markers.push(row);
          return { meta: { last_row_id: row.id } };
        }
      };
      return statement;
    },
    async batch(statements) {
      const before = structuredClone(state);
      try {
        const acquireValues = statements[0]._values();
        const [operation, key, hash, attemptId, resourceType, resourceId,
          responseJson, completedAt, parentId] = acquireValues;
        if (operation === "desk_v2_move_container") {
          return moveBatch({ statements, state, audit, before, options: {
            get failNextMoveBatch() { return failNextMoveBatch; },
            clearFailure() { failNextMoveBatch = false; }
          } });
        }
        if (operation === "desk_v2_update_container") {
          return updateBatch({ statements, state, audit, before, options: {
            get failNextUpdateBatch() { return failNextUpdateBatch; },
            clearFailure() { failNextUpdateBatch = false; }
          } });
        }
        const existing = state.idempotency.find(row => (
          row.operation === operation && row.idempotency_key === key
        ));
        const parent = parentId === null
          ? null : state.containers.find(row => row.container_id === parentId);
        if (!existing && (parentId === null || parent?.lifecycle_state === "ACTIVE")) {
          state.idempotency.push({
            operation, idempotency_key: key, request_hash: hash, attempt_id: attemptId,
            resource_type: resourceType, resource_id: resourceId,
            response_json: responseJson, completed_at: completedAt
          });
        }

        const acquired = state.idempotency.find(row => (
          row.operation === operation && row.idempotency_key === key &&
          row.request_hash === hash && row.attempt_id === attemptId
        ));
        if (acquired) {
          if (collideNextCreate || state.containers.some(row => row.container_id === resourceId)) {
            collideNextCreate = false;
            collidedId = resourceId;
            throw new Error("synthetic primary key collision");
          }
          const response = JSON.parse(responseJson);
          const value = response.container;
          state.containers.push({
            container_id: value.containerId,
            parent_id: value.parentId,
            name: value.name,
            status: value.status,
            focus: value.focus,
            owner: value.owner,
            next_action: value.nextAction,
            lifecycle_state: value.lifecycleState,
            version: value.version,
            created_at: value.createdAt,
            updated_at: value.updatedAt,
            archived_at: value.archivedAt
          });
          audit.writes += 2;
        }

        const record = state.idempotency.find(row => (
          row.operation === operation && row.idempotency_key === key
        ));
        let outcome = "UNEXPECTED_STATE";
        if (record && record.request_hash !== hash) outcome = "IDEMPOTENCY_CONFLICT";
        else if (record && record.attempt_id === attemptId) outcome = "CREATED";
        else if (record && record.request_hash === hash) outcome = "REPLAY";
        else if (parentId !== null && !parent) outcome = "PARENT_NOT_FOUND";
        else if (parentId !== null && parent.lifecycle_state === "ARCHIVED") {
          outcome = "PARENT_ARCHIVED";
        }
        return [{ success: true }, { success: true }, {
          success: true,
          results: [{ outcome, response_json: record?.response_json ?? null }]
        }];
      } catch (error) {
        state.containers = before.containers;
        state.tasks = before.tasks;
        state.markers = before.markers;
        state.idempotency = before.idempotency;
        throw error;
      }
    },
    snapshot() {
      return {
        containers: state.containers.length,
        tasks: state.tasks,
        markers: structuredClone(state.markers),
        idempotency: state.idempotency.length
      };
    },
    updateContainer(containerId, changes) {
      const row = state.containers.find(item => item.container_id === containerId);
      Object.assign(row, Object.fromEntries(Object.entries(changes).map(([key, value]) => [
        key === "containerId" ? "container_id"
          : key === "parentId" ? "parent_id"
            : key === "nextAction" ? "next_action"
              : key === "lifecycleState" ? "lifecycle_state" : key,
        value
      ])));
    },
    getContainer(containerId) {
      return structuredClone(state.containers.find(row => row.container_id === containerId) || null);
    },
    audit() { return { ...audit }; }
  };
  return database;
}

function moveBatch({ statements, state, audit, before, options }) {
  try {
    const values = statements[0]._values();
    const [operation, key, hash, attemptId, resourceType, resourceId,
      responseJson, completedAt, sourceId, expectedVersion, newParentId] = values;
    const existing = state.idempotency.find(row => (
      row.operation === operation && row.idempotency_key === key
    ));
    const source = state.containers.find(row => row.container_id === sourceId);
    const parent = newParentId === null ? null
      : state.containers.find(row => row.container_id === newParentId);
    const valid = source?.lifecycle_state === "ACTIVE"
      && source.version === expectedVersion
      && newParentId !== sourceId
      && (newParentId === null || parent?.lifecycle_state === "ACTIVE")
      && (newParentId === null || !isDescendant(state.containers, sourceId, newParentId));
    if (!existing && valid) {
      state.idempotency.push({ operation, idempotency_key: key, request_hash: hash,
        attempt_id: attemptId, resource_type: resourceType, resource_id: resourceId,
        response_json: responseJson, completed_at: completedAt });
    }
    const acquired = state.idempotency.find(row => row.operation === operation
      && row.idempotency_key === key && row.request_hash === hash
      && row.attempt_id === attemptId);
    if (acquired && options.failNextMoveBatch) {
      options.clearFailure();
      throw new Error("synthetic move failure");
    }
    if (acquired && source.parent_id !== newParentId) {
      const updateValues = statements[1]._values();
      source.parent_id = newParentId;
      source.version += 1;
      source.updated_at = updateValues[1];
      audit.writes += 2;
    } else if (acquired) {
      audit.writes += 1;
    }
    const record = state.idempotency.find(row => row.operation === operation
      && row.idempotency_key === key);
    let outcome = "UNEXPECTED_STATE";
    if (record && record.request_hash !== hash) outcome = "IDEMPOTENCY_CONFLICT";
    else if (record && record.attempt_id === attemptId) outcome = "COMPLETED";
    else if (record && record.request_hash === hash) outcome = "REPLAY";
    else if (!source) outcome = "CONTAINER_NOT_FOUND";
    else if (source.lifecycle_state === "ARCHIVED") outcome = "CONTAINER_ARCHIVED";
    else if (source.version !== expectedVersion) outcome = "VERSION_CONFLICT";
    else if (newParentId === sourceId) outcome = "SELF_PARENT";
    else if (newParentId !== null && !parent) outcome = "PARENT_NOT_FOUND";
    else if (newParentId !== null && parent.lifecycle_state === "ARCHIVED") {
      outcome = "PARENT_ARCHIVED";
    } else if (newParentId !== null
      && isDescendant(state.containers, sourceId, newParentId)) outcome = "CYCLE";
    return [{ success: true }, { success: true }, { success: true,
      results: [{ outcome, response_json: record?.response_json ?? null }] }];
  } catch (error) {
    state.containers = before.containers;
    state.tasks = before.tasks;
    state.markers = before.markers;
    state.idempotency = before.idempotency;
    throw error;
  }
}

function updateBatch({ statements, state, audit, before, options }) {
  try {
    const values = statements[0]._values();
    const [operation, key, hash, attemptId, resourceType, resourceId,
      responseJson, completedAt, sourceId, expectedVersion] = values;
    const existing = state.idempotency.find(row => row.operation === operation
      && row.idempotency_key === key);
    const source = state.containers.find(row => row.container_id === sourceId);
    const valid = source?.lifecycle_state === "ACTIVE" && source.version === expectedVersion;
    if (!existing && valid) {
      state.idempotency.push({ operation, idempotency_key: key, request_hash: hash,
        attempt_id: attemptId, resource_type: resourceType, resource_id: resourceId,
        response_json: responseJson, completed_at: completedAt });
    }
    const acquired = state.idempotency.find(row => row.operation === operation
      && row.idempotency_key === key && row.request_hash === hash
      && row.attempt_id === attemptId);
    if (acquired && options.failNextUpdateBatch) {
      options.clearFailure();
      throw new Error("synthetic update failure");
    }
    const response = acquired ? JSON.parse(responseJson) : null;
    if (acquired && response.changed) {
      const value = response.container;
      Object.assign(source, {
        name: value.name, status: value.status, focus: value.focus, owner: value.owner,
        next_action: value.nextAction, version: value.version, updated_at: value.updatedAt
      });
      audit.writes += 2;
    } else if (acquired) {
      audit.writes += 1;
    }
    const record = state.idempotency.find(row => row.operation === operation
      && row.idempotency_key === key);
    let outcome = "UNEXPECTED_STATE";
    if (record && record.request_hash !== hash) outcome = "IDEMPOTENCY_CONFLICT";
    else if (record && record.attempt_id === attemptId) outcome = "COMPLETED";
    else if (record && record.request_hash === hash) outcome = "REPLAY";
    else if (!source) outcome = "CONTAINER_NOT_FOUND";
    else if (source.lifecycle_state === "ARCHIVED") outcome = "CONTAINER_ARCHIVED";
    else if (source.version !== expectedVersion) outcome = "VERSION_CONFLICT";
    return [{ success: true }, { success: true }, { success: true,
      results: [{ outcome, response_json: record?.response_json ?? null }] }];
  } catch (error) {
    state.containers = before.containers;
    state.tasks = before.tasks;
    state.markers = before.markers;
    state.idempotency = before.idempotency;
    throw error;
  }
}

function isDescendant(containers, ancestorId, candidateId) {
  const pending = containers.filter(row => row.parent_id === ancestorId)
    .map(row => row.container_id);
  const visited = new Set();
  while (pending.length) {
    const id = pending.shift();
    if (id === candidateId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...containers.filter(row => row.parent_id === id).map(row => row.container_id));
  }
  return false;
}
