import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const endpoint = new URL("https://desk-v2-foundation-dev.fastmax.workers.dev/mcp");
const token = readSecret("DESK_V2_MCP_BEARER_TOKEN");

const probeBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
const probeHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const absent = await fetch(endpoint, { method: "POST", headers: probeHeaders, body: probeBody });
const wrong = await fetch(endpoint, {
  method: "POST",
  headers: { ...probeHeaders, authorization: "Bearer deliberately-wrong-token" },
  body: probeBody
});
assert.equal(absent.status, 401);
assert.equal(wrong.status, 401);

const client = new Client({ name: "desk-v2-remote-verifier", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(endpoint, {
  authProvider: { token: async () => token }
});
await client.connect(transport);
try {
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [
    "desk_v2_apply_project_update",
    "desk_v2_archive_container",
    "desk_v2_capability_read",
    "desk_v2_capability_write",
    "desk_v2_create_container",
    "desk_v2_create_task",
    "desk_v2_get_briefing",
    "desk_v2_get_containers",
    "desk_v2_get_project_activity",
    "desk_v2_get_tasks",
    "desk_v2_get_timeline",
    "desk_v2_move_container",
    "desk_v2_move_task",
    "desk_v2_resolve_reference",
    "desk_v2_restore_container",
    "desk_v2_set_task_completion",
    "desk_v2_update_container",
    "desk_v2_update_project_activity",
    "desk_v2_update_task"
  ]);
  const read = await client.callTool({ name: "desk_v2_capability_read", arguments: {} });
  assert.deepEqual(read.structuredContent, {
    service: "desk-v2",
    environment: "v2-development",
    schemaVersion: "0001_foundation",
    containerCount: 0,
    taskCount: 0
  });
  console.log(JSON.stringify({
    authentication: "PASS",
    handshake: "PASS",
    tools: listed.tools.map(tool => tool.name).sort(),
    read: read.structuredContent
  }, null, 2));
} finally {
  await client.close();
}

function readSecret(name) {
  const content = fs.readFileSync(path.join(root, ".dev.vars"), "utf8");
  const line = content.split(/\r?\n/).find(entry => entry.startsWith(`${name}=`));
  assert.ok(line, `${name} is missing from local .dev.vars`);
  const value = line.slice(name.length + 1);
  assert.ok(value, `${name} is empty`);
  return value;
}
