export const CHATGPT_READONLY_PROFILE = "chatgpt-readonly";
export const CHATGPT_READONLY_TOOLS = Object.freeze([
  "desk_v2_get_containers",
  "desk_v2_get_tasks",
  "desk_v2_resolve_reference",
  "desk_v2_get_briefing",
  "desk_v2_get_timeline",
  "desk_v2_get_project_activity"
]);

const READONLY_TOOL_SET = new Set(CHATGPT_READONLY_TOOLS);
const SECURITY_SCHEMES = Object.freeze([{ type: "oauth2", scopes: ["desk.read"] }]);

export function configureToolProfile(server, profile) {
  if (!profile) return server;
  if (profile !== CHATGPT_READONLY_PROFILE) {
    throw new Error(`Unsupported MCP profile: ${profile}`);
  }
  const registerTool = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) => {
    if (!READONLY_TOOL_SET.has(name)) return disabledToolHandle();
    return registerTool(name, {
      ...config,
      _meta: { ...(config._meta || {}), securitySchemes: SECURITY_SCHEMES }
    }, handler);
  };
  return server;
}

export async function addToolSecuritySchemes(request, response, profile) {
  if (profile !== CHATGPT_READONLY_PROFILE || !response.ok) return response;

  let payload;
  try { payload = await request.clone().json(); } catch { return response; }
  if (payload?.method !== "tools/list") return response;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return adaptEventStreamResponse(response);
  }
  if (!contentType.includes("application/json")) return response;

  let body;
  try { body = await response.clone().json(); } catch { return response; }
  addSchemesToListResult(body);
  return replaceResponse(response, JSON.stringify(body));
}

async function adaptEventStreamResponse(response) {
  let body;
  try { body = await response.clone().text(); } catch { return response; }
  const adapted = body.split("\n").map(line => {
    if (!line.startsWith("data:")) return line;
    const prefix = line.startsWith("data: ") ? "data: " : "data:";
    try {
      const payload = JSON.parse(line.slice(prefix.length));
      addSchemesToListResult(payload);
      return `${prefix}${JSON.stringify(payload)}`;
    } catch {
      return line;
    }
  }).join("\n");
  return replaceResponse(response, adapted);
}

function addSchemesToListResult(body) {
  const tools = body?.result?.tools;
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    if (!READONLY_TOOL_SET.has(tool.name)) continue;
    tool.securitySchemes = SECURITY_SCHEMES;
    tool._meta = { ...(tool._meta || {}), securitySchemes: SECURITY_SCHEMES };
  }
}

function replaceResponse(response, body) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function disabledToolHandle() {
  return { disable() {}, enable() {}, remove() {}, update() {} };
}
