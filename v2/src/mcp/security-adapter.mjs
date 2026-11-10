export const CHATGPT_READONLY_PROFILE = "chatgpt-readonly";
export const CHATGPT_BUSINESS_WRITE_PROFILE = "chatgpt-business-write";
export const CHATGPT_READONLY_TOOLS = Object.freeze([
  "desk_v2_get_containers",
  "desk_v2_get_tasks",
  "desk_v2_resolve_reference",
  "desk_v2_get_briefing",
  "desk_v2_get_timeline",
  "desk_v2_get_project_activity"
]);
export const CHATGPT_MUTATIVE_TOOLS = Object.freeze([
  "desk_v2_create_container",
  "desk_v2_move_container",
  "desk_v2_update_container",
  "desk_v2_archive_container",
  "desk_v2_restore_container",
  "desk_v2_create_task",
  "desk_v2_update_task",
  "desk_v2_move_task",
  "desk_v2_set_task_completion",
  "desk_v2_apply_project_update",
  "desk_v2_update_project_activity"
]);
export const CHATGPT_BUSINESS_WRITE_TOOLS = Object.freeze([
  ...CHATGPT_READONLY_TOOLS,
  ...CHATGPT_MUTATIVE_TOOLS
]);

const READONLY_TOOL_SET = new Set(CHATGPT_READONLY_TOOLS);
const BUSINESS_WRITE_TOOL_SET = new Set(CHATGPT_BUSINESS_WRITE_TOOLS);
const READONLY_SCOPES = Object.freeze(["desk.read"]);
const BUSINESS_WRITE_SCOPES = Object.freeze(["desk.read", "desk.write"]);

export function profileConfiguration(profile = CHATGPT_READONLY_PROFILE) {
  if (profile === CHATGPT_READONLY_PROFILE) {
    return { tools: READONLY_TOOL_SET, scopes: READONLY_SCOPES };
  }
  if (profile === CHATGPT_BUSINESS_WRITE_PROFILE) {
    return { tools: BUSINESS_WRITE_TOOL_SET, scopes: BUSINESS_WRITE_SCOPES };
  }
  throw new Error(`Unsupported MCP profile: ${profile}`);
}

export function configureToolProfile(server, profile) {
  if (!profile) return server;
  const configuration = profileConfiguration(profile);
  const securitySchemes = securitySchemesFor(configuration.scopes);
  const registerTool = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) => {
    if (!configuration.tools.has(name)) return disabledToolHandle();
    return registerTool(name, {
      ...config,
      _meta: { ...(config._meta || {}), securitySchemes }
    }, handler);
  };
  return server;
}

export async function addToolSecuritySchemes(request, response, profile) {
  if (!response.ok) return response;
  const configuration = profileConfiguration(profile);
  const securitySchemes = securitySchemesFor(configuration.scopes);

  let payload;
  try { payload = await request.clone().json(); } catch { return response; }
  if (payload?.method !== "tools/list") return response;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return adaptEventStreamResponse(response, configuration.tools, securitySchemes);
  }
  if (!contentType.includes("application/json")) return response;

  let body;
  try { body = await response.clone().json(); } catch { return response; }
  addSchemesToListResult(body, configuration.tools, securitySchemes);
  return replaceResponse(response, JSON.stringify(body));
}

async function adaptEventStreamResponse(response, toolSet, securitySchemes) {
  let body;
  try { body = await response.clone().text(); } catch { return response; }
  const adapted = body.split("\n").map(line => {
    if (!line.startsWith("data:")) return line;
    const prefix = line.startsWith("data: ") ? "data: " : "data:";
    try {
      const payload = JSON.parse(line.slice(prefix.length));
      addSchemesToListResult(payload, toolSet, securitySchemes);
      return `${prefix}${JSON.stringify(payload)}`;
    } catch {
      return line;
    }
  }).join("\n");
  return replaceResponse(response, adapted);
}

function addSchemesToListResult(body, toolSet, securitySchemes) {
  const tools = body?.result?.tools;
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    if (!toolSet.has(tool.name)) continue;
    tool.securitySchemes = securitySchemes;
    tool._meta = { ...(tool._meta || {}), securitySchemes };
  }
}

function securitySchemesFor(scopes) {
  return Object.freeze([{ type: "oauth2", scopes }]);
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
