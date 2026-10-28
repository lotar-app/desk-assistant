import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPECTED_READONLY_TOOLS,
  RemoteVerificationError,
  verifyRemoteMcp
} from "../scripts/verify-remote-mcp.mjs";

const endpoint = "https://desk-v2.example.test/mcp";
const oauthChallenge = 'Bearer resource_metadata="https://desk-v2.example.test/.well-known/oauth-protected-resource", scope="desk.read", error="invalid_token"';

function unauthorizedFetch(_url, init) {
  assert.equal(init.method, "POST");
  assert.equal(Object.hasOwn(init.headers, "authorization"), false);
  return Promise.resolve(new Response("", {
    status: 401,
    headers: { "www-authenticate": oauthChallenge }
  }));
}

function mockClient(tools = EXPECTED_READONLY_TOOLS) {
  const calls = [];
  return {
    calls,
    connect: async () => calls.push("initialize"),
    listTools: async () => {
      calls.push("tools/list");
      return { tools: tools.map(name => ({ name })) };
    },
    callTool: async () => {
      throw new Error("tool calls are forbidden in the verifier");
    },
    close: async () => calls.push("close")
  };
}

test("accepts an OAuth challenge and discovers exactly six read-only tools", async () => {
  const client = mockClient();
  const result = await verifyRemoteMcp({
    endpoint,
    accessToken: "test-oauth-token",
    fetchImpl: unauthorizedFetch,
    createClient: () => client
  });

  assert.deepEqual(result, {
    status: "PASS",
    anonymous: "PASS",
    authenticatedDiscovery: "PASS",
    toolCount: 6
  });
  assert.deepEqual(client.calls, ["initialize", "tools/list", "close"]);
});

test("rejects an extra diagnostic or mutative tool", async () => {
  const client = mockClient([...EXPECTED_READONLY_TOOLS, "desk_v2_capability_read"]);
  await assert.rejects(
    verifyRemoteMcp({
      endpoint,
      accessToken: "test-oauth-token",
      fetchImpl: unauthorizedFetch,
      createClient: () => client
    }),
    errorWithCode("MCP_TOOL_ALLOWLIST_MISMATCH")
  );
  assert.deepEqual(client.calls, ["initialize", "tools/list", "close"]);
});

test("rejects a missing expected tool", async () => {
  const client = mockClient(EXPECTED_READONLY_TOOLS.slice(1));
  await assert.rejects(
    verifyRemoteMcp({
      endpoint,
      accessToken: "test-oauth-token",
      fetchImpl: unauthorizedFetch,
      createClient: () => client
    }),
    errorWithCode("MCP_TOOL_ALLOWLIST_MISMATCH")
  );
});

test("reports incomplete verification when no OAuth token is available", async () => {
  let clientCreated = false;
  const result = await verifyRemoteMcp({
    endpoint,
    accessToken: "",
    fetchImpl: unauthorizedFetch,
    createClient: () => {
      clientCreated = true;
      return mockClient();
    }
  });

  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.anonymous, "PASS");
  assert.equal(result.authenticatedDiscovery, "NOT_VERIFIED");
  assert.match(result.reason, /DESK_V2_OAUTH_ACCESS_TOKEN/);
  assert.equal(clientCreated, false);
});

test("rejects anonymous HTTP responses other than 401", async () => {
  await assert.rejects(
    verifyRemoteMcp({
      endpoint,
      accessToken: "test-oauth-token",
      fetchImpl: async () => new Response("sensitive response", { status: 500 })
    }),
    errorWithCode("ANONYMOUS_STATUS_NOT_401")
  );
});

test("rejects a malformed OAuth challenge", async () => {
  await assert.rejects(
    verifyRemoteMcp({
      endpoint,
      accessToken: "test-oauth-token",
      fetchImpl: async () => new Response("", {
        status: 401,
        headers: { "www-authenticate": "Bearer" }
      })
    }),
    errorWithCode("OAUTH_CHALLENGE_INVALID")
  );
});

test("rejects a malformed tools/list response", async () => {
  const client = mockClient();
  client.listTools = async () => ({ tools: [{ description: "missing name" }] });
  await assert.rejects(
    verifyRemoteMcp({
      endpoint,
      accessToken: "test-oauth-token",
      fetchImpl: unauthorizedFetch,
      createClient: () => client
    }),
    errorWithCode("MCP_TOOLS_RESPONSE_MALFORMED")
  );
});

test("sanitizes MCP errors without exposing their message", async () => {
  const client = mockClient();
  client.connect = async () => {
    throw new Error("Authorization: Bearer secret-value");
  };

  await assert.rejects(
    verifyRemoteMcp({
      endpoint,
      accessToken: "test-oauth-token",
      fetchImpl: unauthorizedFetch,
      createClient: () => client
    }),
    error => {
      assert.equal(error.code, "MCP_INITIALIZE_FAILED");
      assert.equal(error.message.includes("secret-value"), false);
      return true;
    }
  );
});

test("fails safely when the anonymous request times out", async () => {
  await assert.rejects(
    verifyRemoteMcp({
      endpoint,
      accessToken: "test-oauth-token",
      timeoutMs: 5,
      fetchImpl: async () => new Promise(() => {})
    }),
    errorWithCode("ANONYMOUS_REQUEST_TIMEOUT")
  );
});

function errorWithCode(code) {
  return error => error instanceof RemoteVerificationError && error.code === code;
}
