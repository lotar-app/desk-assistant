import test from "node:test";
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createWorker } from "../src/index.mjs";
import {
  OAuthConfigurationError,
  OAuthTokenError,
  authorizeOAuthRequest,
  bearerChallenge,
  oauthConfiguration,
  protectedResourceMetadata,
  verifyJwt
} from "../src/auth/oauth-resource-server.mjs";
import {
  CHATGPT_BUSINESS_WRITE_PROFILE,
  CHATGPT_BUSINESS_WRITE_TOOLS,
  CHATGPT_MUTATIVE_TOOLS,
  CHATGPT_READONLY_TOOLS,
  addToolSecuritySchemes
} from "../src/mcp/security-adapter.mjs";

const issuer = "https://desk-test.eu.auth0.com/";
const resource = "https://desk-v2.example.test/mcp";
const jwksUri = `${issuer}.well-known/jwks.json`;

test("OAuth configuration and protected-resource metadata are strict", () => {
  const config = oauthConfiguration(oauthEnv());
  assert.deepEqual(protectedResourceMetadata(config), {
    resource,
    authorization_servers: [issuer],
    scopes_supported: ["desk.read"],
    bearer_methods_supported: ["header"]
  });
  assert.match(bearerChallenge(config, "invalid_token"),
    /resource_metadata="https:\/\/desk-v2\.example\.test\/\.well-known\/oauth-protected-resource"/);
  assert.throws(() => oauthConfiguration({ ...oauthEnv(), DESK_V2_OAUTH_AUDIENCE: "x" }),
    OAuthConfigurationError);
});

test("business-write OAuth metadata requires both read and write scopes", () => {
  const runtime = oauthEnv(CHATGPT_BUSINESS_WRITE_PROFILE);
  const config = oauthConfiguration(runtime);
  assert.deepEqual(config.requiredScopes, ["desk.read", "desk.write"]);
  assert.deepEqual(protectedResourceMetadata(config).scopes_supported,
    ["desk.read", "desk.write"]);
  assert.match(bearerChallenge(config), /scope="desk\.read desk\.write"/);
});

test("JWT validation accepts a correct Auth0-style RS256 token", async () => {
  const fixture = await jwtFixture();
  const claims = await verifyJwt(await fixture.token(), oauthConfiguration(oauthEnv()), {
    fetchImpl: fixture.fetchImpl,
    now: fixture.now
  });
  assert.equal(claims.sub, "auth0|desk-local-test");
});

for (const scenario of [
  ["expired", { exp: 1 }],
  ["not active", { nbf: 2_000_000_000 }],
  ["wrong issuer", { iss: "https://wrong.example" }],
  ["wrong audience", { aud: "https://wrong.example/mcp" }],
  ["wrong scope", { scope: "openid profile" }]
]) {
  test(`JWT validation rejects ${scenario[0]}`, async () => {
    const fixture = await jwtFixture();
    await assert.rejects(
      verifyJwt(await fixture.token(scenario[1]), oauthConfiguration(oauthEnv()), {
        fetchImpl: fixture.fetchImpl,
        now: fixture.now
      }),
      OAuthTokenError
    );
  });
}

test("JWT validation rejects an invalid signature", async () => {
  const fixture = await jwtFixture();
  const other = await jwtFixture();
  await assert.rejects(
    verifyJwt(await fixture.token({}, other.privateKey), oauthConfiguration(oauthEnv()), {
      fetchImpl: fixture.fetchImpl,
      now: fixture.now
    }),
    /signature/i
  );
});

test("JWT and JWKS parsing failures remain authentication errors", async () => {
  const fixture = await jwtFixture();
  const token = await fixture.token();
  const malformedSignature = `${token.slice(0, token.lastIndexOf(".") + 1)}%%%`;
  await assert.rejects(
    verifyJwt(malformedSignature, oauthConfiguration(oauthEnv()), {
      fetchImpl: fixture.fetchImpl,
      now: fixture.now
    }),
    OAuthTokenError
  );
  await assert.rejects(
    verifyJwt(token, oauthConfiguration(oauthEnv()), {
      fetchImpl: async () => new Response("not-json", { status: 200 }),
      now: fixture.now
    }),
    OAuthTokenError
  );
});

test("OAuth HTTP challenge and protected-resource metadata are exposed", async () => {
  const fixture = await jwtFixture();
  const worker = createWorker({ fetchImpl: fixture.fetchImpl });
  const runtime = oauthEnv();
  const metadata = await worker.fetch(new Request(
    "https://desk-v2.example.test/.well-known/oauth-protected-resource"
  ), runtime, {});
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), protectedResourceMetadata(oauthConfiguration(runtime)));

  const denied = await worker.fetch(mcpRequest("initialize", undefined), runtime, {});
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("www-authenticate"), /scope="desk\.read"/);
  assert.match(denied.headers.get("www-authenticate"), /error="invalid_token"/);

  const token = await fixture.token();
  const malformed = `${token.slice(0, token.lastIndexOf(".") + 1)}%%%`;
  const malformedDenied = await worker.fetch(mcpRequest("initialize", malformed), runtime, {});
  assert.equal(malformedDenied.status, 401);
  assert.match(malformedDenied.headers.get("www-authenticate"), /error="invalid_token"/);
});

test("chatgpt-readonly discovers only six tools and rejects mutation calls", async () => {
  const fixture = await jwtFixture();
  const token = await fixture.token();
  const runtime = oauthEnv();
  const worker = createWorker({ fetchImpl: fixture.fetchImpl });
  await authorizeOAuthRequest(mcpRequest("initialize", token), oauthConfiguration(runtime), {
    fetchImpl: fixture.fetchImpl
  });
  const client = new Client({ name: "desk-oauth-local", version: "1.0.0" });
  let rawListedTools;
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    authProvider: { token: async () => token },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      let method;
      try { method = (await request.clone().json())?.method; } catch {}
      const response = await worker.fetch(request, runtime, {});
      if (method === "tools/list") {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          rawListedTools = (await response.clone().json())?.result?.tools;
        } else if (contentType.includes("text/event-stream")) {
          const dataLine = (await response.clone().text()).split("\n")
            .find(line => line.startsWith("data:"));
          const payload = JSON.parse(dataLine.replace(/^data:\s?/, ""));
          rawListedTools = payload?.result?.tools;
        }
      }
      return response;
    }
  });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(),
      [...CHATGPT_READONLY_TOOLS].sort());
    assert.equal(rawListedTools?.length, 6);
    assert.equal(rawListedTools.every(tool => (
      tool.securitySchemes?.[0]?.type === "oauth2" &&
      tool.securitySchemes[0].scopes?.includes("desk.read")
    )), true);
    assert.equal(listed.tools.every(tool => tool.annotations?.readOnlyHint === true), true);
    assert.equal(listed.tools.every(tool => (
      tool._meta?.securitySchemes?.[0]?.type === "oauth2" &&
      tool._meta.securitySchemes[0].scopes?.includes("desk.read")
    )), true);
    await assert.rejects(client.callTool({
      name: "desk_v2_create_task",
      arguments: { containerId: "x", title: "x", idempotencyKey: "x" }
    }), /not found|invalid params/i);
  } finally {
    await client.close();
  }
});

test("chatgpt-business-write discovers 6 read-only and 11 mutative tools", async () => {
  const fixture = await jwtFixture();
  const token = await fixture.token({ scope: "openid desk.read desk.write" });
  const runtime = oauthEnv(CHATGPT_BUSINESS_WRITE_PROFILE);
  const worker = createWorker({ fetchImpl: fixture.fetchImpl });
  const client = new Client({ name: "desk-oauth-write-local", version: "1.0.0" });
  let rawListedTools;
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    authProvider: { token: async () => token },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      let method;
      try { method = (await request.clone().json())?.method; } catch {}
      const response = await worker.fetch(request, runtime, {});
      if (method === "tools/list") {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          rawListedTools = (await response.clone().json())?.result?.tools;
        } else if (contentType.includes("text/event-stream")) {
          const dataLine = (await response.clone().text()).split("\n")
            .find(line => line.startsWith("data:"));
          rawListedTools = JSON.parse(dataLine.replace(/^data:\s?/, ""))?.result?.tools;
        }
      }
      return response;
    }
  });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map(tool => tool.name);
    assert.deepEqual(names.sort(), [...CHATGPT_BUSINESS_WRITE_TOOLS].sort());
    assert.equal(CHATGPT_READONLY_TOOLS.length, 6);
    assert.equal(CHATGPT_MUTATIVE_TOOLS.length, 11);
    assert.equal(rawListedTools?.length, 17);
    assert.equal(names.includes("desk_v2_capability_read"), false);
    assert.equal(names.includes("desk_v2_capability_write"), false);
    assert.equal(rawListedTools.every(tool => (
      tool.securitySchemes?.[0]?.scopes?.includes("desk.read") &&
      tool.securitySchemes[0].scopes?.includes("desk.write")
    )), true);
    assert.equal(listed.tools.every(tool => (
      tool._meta?.securitySchemes?.[0]?.scopes?.includes("desk.read") &&
      tool._meta.securitySchemes[0].scopes?.includes("desk.write")
    )), true);
  } finally {
    await client.close();
  }
});

test("chatgpt-business-write rejects tokens without desk.write", async () => {
  const fixture = await jwtFixture();
  await assert.rejects(
    authorizeOAuthRequest(
      mcpRequest("initialize", await fixture.token()),
      oauthConfiguration(oauthEnv(CHATGPT_BUSINESS_WRITE_PROFILE)),
      { fetchImpl: fixture.fetchImpl, now: fixture.now }
    ),
    /scope/i
  );
});

test("tools/list adapter emits top-level and compatibility securitySchemes", async () => {
  const request = new Request(resource, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  });
  const response = new Response(JSON.stringify({
    jsonrpc: "2.0", id: 1, result: { tools: [{ name: "desk_v2_get_tasks" }] }
  }), { headers: { "content-type": "application/json" } });
  const adapted = await addToolSecuritySchemes(request, response, "chatgpt-readonly");
  const tool = (await adapted.json()).result.tools[0];
  assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: ["desk.read"] }]);
  assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
});

test("tools/list adapter emits read and write scopes for business-write", async () => {
  const request = new Request(resource, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  });
  const response = Response.json({
    jsonrpc: "2.0", id: 1,
    result: { tools: [{ name: "desk_v2_update_task" }] }
  });
  const adapted = await addToolSecuritySchemes(
    request, response, CHATGPT_BUSINESS_WRITE_PROFILE
  );
  const tool = (await adapted.json()).result.tools[0];
  assert.deepEqual(tool.securitySchemes,
    [{ type: "oauth2", scopes: ["desk.read", "desk.write"] }]);
  assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
});

function oauthEnv(profile = "chatgpt-readonly") {
  return {
    DESK_V2_MCP_AUTH_MODE: "oauth",
    DESK_V2_MCP_PROFILE: profile,
    DESK_V2_OAUTH_ISSUER: issuer,
    DESK_V2_OAUTH_AUDIENCE: resource,
    DESK_V2_OAUTH_JWKS_URI: jwksUri,
    DESK_V2_MCP_CANONICAL_URL: resource,
    DESK_V2_DB: {}
  };
}

function mcpRequest(method, token) {
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(resource, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} })
  });
}

async function jwtFixture() {
  const pair = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(publicJwk, { kid: "desk-local-key", alg: "RS256", use: "sig" });
  const now = Math.floor(Date.now() / 1000);
  return {
    now,
    privateKey: pair.privateKey,
    fetchImpl: async url => {
      assert.equal(String(url), jwksUri);
      return Response.json({ keys: [publicJwk] });
    },
    async token(overrides = {}, signingKey = pair.privateKey) {
      const header = encode({ alg: "RS256", typ: "JWT", kid: "desk-local-key" });
      const claims = encode({
        iss: issuer, aud: resource, sub: "auth0|desk-local-test",
        scope: "openid desk.read", nbf: now - 30, exp: now + 300, ...overrides
      });
      const input = `${header}.${claims}`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(input)
      );
      return `${input}.${base64Url(new Uint8Array(signature))}`;
    }
  };
}

function encode(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
