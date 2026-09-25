import { createMcpHandler } from "agents/mcp/server";
import { HealthService } from "./foundation/health-service.mjs";
import { createDeskMcpServer } from "./mcp/server.mjs";
import { json, methodNotAllowed, notFound } from "./response.mjs";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return handleMcp(request, env, ctx);
    if (request.method !== "GET") return methodNotAllowed();

    const service = new HealthService(env);
    if (url.pathname === "/health") return json(service.health());
    if (url.pathname === "/ready") {
      const result = await service.ready();
      return json(result, result.success ? 200 : 503);
    }
    return notFound();
  }
};

async function handleMcp(request, env, ctx) {
  if (!env?.DESK_V2_MCP_BEARER_TOKEN) {
    return json({ error: "MCP_NOT_CONFIGURED" }, 503);
  }
  if (!await authorized(request, env.DESK_V2_MCP_BEARER_TOKEN)) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "www-authenticate": "Bearer"
      }
    });
  }
  const handler = createMcpHandler(() => createDeskMcpServer(env), {
    route: "/mcp",
    legacy: "stateless"
  });
  return handler(request, env, ctx);
}

async function authorized(request, expectedToken) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) return false;
  const [actual, expected] = await Promise.all([
    digest(match[1]),
    digest(expectedToken)
  ]);
  return actual.every((value, index) => value === expected[index]);
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
