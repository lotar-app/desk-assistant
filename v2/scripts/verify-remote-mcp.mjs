import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export const EXPECTED_READONLY_TOOLS = Object.freeze([
  "desk_v2_get_briefing",
  "desk_v2_get_containers",
  "desk_v2_get_project_activity",
  "desk_v2_get_tasks",
  "desk_v2_get_timeline",
  "desk_v2_resolve_reference"
]);

const DEFAULT_ENDPOINT = new URL("https://desk-v2-foundation-dev.fastmax.workers.dev/mcp");
const TOKEN_ENVIRONMENT_VARIABLE = "DESK_V2_OAUTH_ACCESS_TOKEN";
const DEFAULT_TIMEOUT_MS = 15_000;
const PROBE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: "desk-v2-oauth-probe",
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "desk-v2-remote-verifier", version: "1.0.0" }
  }
});
const PROBE_HEADERS = Object.freeze({
  "content-type": "application/json",
  accept: "application/json, text/event-stream"
});

export class RemoteVerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = "RemoteVerificationError";
    this.code = code;
  }
}

export async function verifyRemoteMcp(options = {}) {
  const endpoint = new URL(options.endpoint || DEFAULT_ENDPOINT);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const accessToken = options.accessToken ?? process.env[TOKEN_ENVIRONMENT_VARIABLE];

  const anonymous = await fetchWithTimeout(fetchImpl, endpoint, {
    method: "POST",
    headers: PROBE_HEADERS,
    body: PROBE_BODY
  }, timeoutMs);
  verifyAnonymousChallenge(anonymous, endpoint);

  if (!accessToken) {
    return {
      status: "INCOMPLETE",
      anonymous: "PASS",
      authenticatedDiscovery: "NOT_VERIFIED",
      reason: `${TOKEN_ENVIRONMENT_VARIABLE} is not available`
    };
  }

  let client;
  try {
    client = (options.createClient || createAuthenticatedClient)({ endpoint, accessToken });
    await stage(() => client.connect(), timeoutMs,
      "MCP_INITIALIZE_FAILED", "MCP_INITIALIZE_TIMEOUT");
    const listed = await stage(() => client.listTools(), timeoutMs,
      "MCP_TOOLS_LIST_FAILED", "MCP_TOOLS_LIST_TIMEOUT");
    verifyExactToolAllowlist(listed);
  } finally {
    if (client) {
      await closeQuietly(client, timeoutMs);
    }
  }

  return {
    status: "PASS",
    anonymous: "PASS",
    authenticatedDiscovery: "PASS",
    toolCount: EXPECTED_READONLY_TOOLS.length
  };
}

export function verifyAnonymousChallenge(response, endpoint) {
  if (response.status !== 401) {
    throw new RemoteVerificationError("ANONYMOUS_STATUS_NOT_401");
  }

  const challenge = response.headers.get("www-authenticate") || "";
  const resourceMetadata = `${endpoint.origin}/.well-known/oauth-protected-resource`;
  if (!/^Bearer(?:\s|$)/i.test(challenge)
      || !challenge.includes(`resource_metadata="${resourceMetadata}"`)
      || !challenge.includes('scope="desk.read"')) {
    throw new RemoteVerificationError("OAUTH_CHALLENGE_INVALID");
  }
}

export function verifyExactToolAllowlist(listed) {
  if (!listed || !Array.isArray(listed.tools)
      || listed.tools.some(tool => !tool || typeof tool.name !== "string")) {
    throw new RemoteVerificationError("MCP_TOOLS_RESPONSE_MALFORMED");
  }

  const actual = listed.tools.map(tool => tool.name).sort();
  const expected = [...EXPECTED_READONLY_TOOLS].sort();
  if (actual.length !== expected.length
      || actual.some((name, index) => name !== expected[index])) {
    throw new RemoteVerificationError("MCP_TOOL_ALLOWLIST_MISMATCH");
  }
}

function createAuthenticatedClient({ endpoint, accessToken }) {
  const client = new Client({ name: "desk-v2-remote-verifier", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: async () => accessToken }
  });
  return {
    connect: () => client.connect(transport),
    listTools: () => client.listTools(),
    close: () => client.close()
  };
}

async function fetchWithTimeout(fetchImpl, endpoint, init, timeoutMs) {
  const controller = new AbortController();
  try {
    return await stage(
      () => fetchImpl(endpoint, { ...init, signal: controller.signal }),
      timeoutMs,
      "ANONYMOUS_REQUEST_FAILED",
      "ANONYMOUS_REQUEST_TIMEOUT",
      () => controller.abort()
    );
  } finally {
    controller.abort();
  }
}

async function stage(operation, timeoutMs, failureCode, timeoutCode, onTimeout = () => {}) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation).catch(() => {
        throw new RemoteVerificationError(failureCode);
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new RemoteVerificationError(timeoutCode));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function closeQuietly(client, timeoutMs) {
  try {
    await stage(() => client.close(), timeoutMs, "MCP_CLOSE_FAILED", "MCP_CLOSE_TIMEOUT");
  } catch {
    // Closing is best-effort and must not replace the primary verification result.
  }
}

async function main() {
  try {
    const result = await verifyRemoteMcp();
    if (result.status !== "PASS") {
      console.error(`DESK V2 REMOTE OAUTH CHECK INCOMPLETE: ${result.reason}`);
      process.exitCode = 2;
      return;
    }
    console.log(`DESK V2 REMOTE OAUTH CHECK PASS: ${result.toolCount} read-only tools`);
  } catch (error) {
    const code = error instanceof RemoteVerificationError
      ? error.code
      : "REMOTE_VERIFICATION_FAILED";
    console.error(`DESK V2 REMOTE OAUTH CHECK FAIL: ${code}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
