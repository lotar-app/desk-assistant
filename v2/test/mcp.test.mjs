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
      "desk_v2_get_containers"
    ]);
    const readTool = listed.tools.find(tool => tool.name === "desk_v2_capability_read");
    const writeTool = listed.tools.find(tool => tool.name === "desk_v2_capability_write");
    const containersTool = listed.tools.find(tool => tool.name === "desk_v2_get_containers");
    const createTool = listed.tools.find(tool => tool.name === "desk_v2_create_container");
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
          if (/SELECT container_id FROM containers WHERE container_id/i.test(sql)) {
            if (values[0] === collidedId) return { container_id: values[0] };
            return state.containers.find(row => row.container_id === values[0]) || null;
          }
          if (/SELECT lifecycle_state FROM containers WHERE container_id/i.test(sql)) {
            const row = state.containers.find(item => item.container_id === values[0]);
            return row ? { lifecycle_state: row.lifecycle_state } : null;
          }
          throw new Error(`unexpected first query: ${sql}`);
        },
        async all() {
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
    audit() { return { ...audit }; }
  };
  return database;
}
