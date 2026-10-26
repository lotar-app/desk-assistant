import { createMcpHandler } from "agents/mcp/server";
import { HealthService } from "./foundation/health-service.mjs";
import { createDeskMcpServer } from "./mcp/server.mjs";
import {
  OAuthConfigurationError,
  OAuthTokenError,
  authorizeOAuthRequest,
  bearerChallenge,
  oauthConfiguration,
  protectedResourceMetadata
} from "./auth/oauth-resource-server.mjs";
import {
  CHATGPT_READONLY_PROFILE,
  addToolSecuritySchemes
} from "./mcp/security-adapter.mjs";
import { json, methodNotAllowed, notFound } from "./response.mjs";

export function createWorker(options = {}) {
  return {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" &&
        (url.pathname === "/.well-known/oauth-protected-resource" ||
         url.pathname === "/.well-known/oauth-protected-resource/mcp")) {
      return handleProtectedResourceMetadata(env);
    }
    if (url.pathname === "/mcp") return handleMcp(request, env, ctx, options);
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
}

const worker = createWorker();
export default worker;

async function handleMcp(request, env, ctx, options) {
  if (env?.DESK_V2_MCP_AUTH_MODE === "oauth") {
    return handleOAuthMcp(request, env, ctx, options);
  }
  if (env?.DESK_V2_MCP_AUTH_MODE && env.DESK_V2_MCP_AUTH_MODE !== "static") {
    return json({ error: "MCP_AUTH_MODE_INVALID" }, 503);
  }
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

async function handleOAuthMcp(request, env, ctx, options) {
  let config;
  try {
    config = oauthConfiguration(env);
  } catch (error) {
    if (error instanceof OAuthConfigurationError) {
      return json({ error: "MCP_OAUTH_NOT_CONFIGURED" }, 503);
    }
    throw error;
  }
  try {
    await authorizeOAuthRequest(request, config, { fetchImpl: options.fetchImpl });
  } catch (error) {
    if (!(error instanceof OAuthTokenError)) throw error;
    return oauthUnauthorized(config, "invalid_token");
  }
  const profile = env.DESK_V2_MCP_PROFILE || CHATGPT_READONLY_PROFILE;
  if (profile !== CHATGPT_READONLY_PROFILE) {
    return json({ error: "MCP_PROFILE_INVALID" }, 503);
  }
  const handler = createMcpHandler(() => createDeskMcpServer(env, { profile }), {
    route: "/mcp",
    legacy: "stateless"
  });
  const requestForAdapter = request.clone();
  return addToolSecuritySchemes(
    requestForAdapter,
    await handler(request, env, ctx),
    profile
  );
}

function handleProtectedResourceMetadata(env) {
  try {
    return json(protectedResourceMetadata(oauthConfiguration(env)));
  } catch (error) {
    if (error instanceof OAuthConfigurationError) {
      return json({ error: "MCP_OAUTH_NOT_CONFIGURED" }, 503);
    }
    throw error;
  }
}

function oauthUnauthorized(config, error) {
  return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "www-authenticate": bearerChallenge(config, error)
    }
  });
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
