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
      "desk_v2_capability_write"
    ]);
    const readTool = listed.tools.find(tool => tool.name === "desk_v2_capability_read");
    const writeTool = listed.tools.find(tool => tool.name === "desk_v2_capability_write");
    assert.equal(readTool.annotations.readOnlyHint, true);
    assert.equal(writeTool.annotations.readOnlyHint, false);
    assert.equal(writeTool.annotations.destructiveHint, false);

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

function fakeDb() {
  const state = { containers: 0, tasks: 0, markers: [] };
  return {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...bound) { values = bound; return statement; },
        async first() {
          if (/COUNT\(\*\).*containers/i.test(sql)) return { count: state.containers };
          if (/COUNT\(\*\).*tasks/i.test(sql)) return { count: state.tasks };
          if (/FROM mcp_capability_test WHERE id/i.test(sql)) {
            return state.markers.find(row => row.id === Number(values[0])) || null;
          }
          throw new Error(`unexpected first query: ${sql}`);
        },
        async run() {
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
    snapshot() { return structuredClone(state); }
  };
}
