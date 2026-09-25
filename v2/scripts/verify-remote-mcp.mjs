import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const endpoint = new URL("https://desk-v2-foundation-dev.fastmax.workers.dev/mcp");
const marker = "CODEX-REMOTE-CAPABILITY-20260924";
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
    "desk_v2_capability_read",
    "desk_v2_capability_write"
  ]);
  const read = await client.callTool({ name: "desk_v2_capability_read", arguments: {} });
  assert.deepEqual(read.structuredContent, {
    service: "desk-v2",
    environment: "v2-development",
    schemaVersion: "0001_foundation",
    containerCount: 0,
    taskCount: 0
  });
  const write = await client.callTool({
    name: "desk_v2_capability_write",
    arguments: { marker }
  });
  assert.equal(write.structuredContent.marker, marker);
  console.log(JSON.stringify({
    authentication: "PASS",
    handshake: "PASS",
    tools: listed.tools.map(tool => tool.name).sort(),
    read: read.structuredContent,
    write: write.structuredContent
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
