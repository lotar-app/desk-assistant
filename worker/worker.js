import { ProjectActivityRepository } from "./project-activity/repository.mjs";
import { ProjectActivityService } from "./project-activity/service.mjs";
import { ProjectActivityWriteService } from "./project-activity/write-service.mjs";
import { ProjectActivityOutboxDeliveryService } from "./project-activity/outbox-delivery.mjs";
import { ProjectActivityError, activityError } from "./project-activity/errors.mjs";
import { OutboxDeliveryError } from "./project-activity/outbox-delivery.mjs";
import { requireBearer } from "./auth.mjs";

export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (request.method === "GET") {
      return json(
        {
          success: true,
          service: "Desk Worker online",
          version: 1
        },
        200,
        headers
      );
    }

    if (request.method !== "POST") {
      return json(
        {
          success: false,
          error: "Method not allowed"
        },
        405,
        headers
      );
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/project-activity" ||
          url.pathname === "/project-activity/update") {
        const auth = await requireBearer(request, env.PROJECT_ACTIVITY_ACTIONS_TOKEN);
        if (!auth.ok) return authError(auth, headers);
        const body = await request.json();
        return body.action === "updateProjectActivity" ||
          url.pathname === "/project-activity/update"
          ? updateProjectActivity(body, env, headers)
          : getProjectActivity(body, env, headers);
      }

      if (url.pathname === "/internal/project-activity/outbox/deliver" ||
          url.pathname === "/internal/project-activity/outbox/deliver-pending") {
        const auth = await requireBearer(request, env.PROJECT_ACTIVITY_ADMIN_TOKEN);
        if (!auth.ok) return authError(auth, headers);
        const body = await request.json();
        return url.pathname.endsWith("deliver-pending")
          ? deliverPendingAdmin(body, env, headers)
          : deliverOneAdmin(body, env, headers);
      }

      if (url.pathname === "/workspace-briefing") {
        const body = await request.json();
        const appsScriptResponse = await fetch(env.DESK_APPS_SCRIPT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify({
            token: env.DESK_API_TOKEN,
            action: "getWorkspaceBriefing",
            workspace: body.workspace
          })
        });

        const text = await appsScriptResponse.text();

        let result;

        try {
          result = JSON.parse(text);
        } catch {
          result = {
            raw: text
          };
        }

        return json(
          {
            success: appsScriptResponse.ok,
            httpStatus: appsScriptResponse.status,
            result
          },
          appsScriptResponse.ok ? 200 : 502,
          headers
        );
      }

      const body = await request.json();

      if (url.pathname === "/project-tasks") {
        const appsScriptResponse = await fetch(env.DESK_APPS_SCRIPT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify({
            token: env.DESK_API_TOKEN,
            action: "getProjectTasks",
            projectName: body.projectName
          })
        });

        const text = await appsScriptResponse.text();

        let result;

        try {
          result = JSON.parse(text);
        } catch {
          result = {
            raw: text
          };
        }

        return json(
          {
            success: appsScriptResponse.ok,
            httpStatus: appsScriptResponse.status,
            result
          },
          appsScriptResponse.ok ? 200 : 502,
          headers
        );
      }

      if (url.pathname === "/getProject") {
        const appsScriptResponse = await fetch(env.DESK_APPS_SCRIPT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify({
            token: env.DESK_API_TOKEN,
            action: "getProject",
            projectName: body.projectName
          })
        });

        const text = await appsScriptResponse.text();

        let result;

        try {
          result = JSON.parse(text);
        } catch {
          result = {
            raw: text
          };
        }

        return json(
          {
            success: appsScriptResponse.ok,
            httpStatus: appsScriptResponse.status,
            result
          },
          appsScriptResponse.ok ? 200 : 502,
          headers
        );
      }

      if (!body.projectName || !body.data) {
        return json(
          {
            success: false,
            error: "Missing projectName or data"
          },
          400,
          headers
        );
      }

      const appsScriptResponse = await fetch(env.DESK_APPS_SCRIPT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
          token: env.DESK_API_TOKEN,
          projectName: body.projectName,
          data: body.data
        })
      });

      const text = await appsScriptResponse.text();

      let result;

      try {
        result = JSON.parse(text);
      } catch {
        result = {
          raw: text
        };
      }

      return json(
        {
          success: appsScriptResponse.ok,
          httpStatus: appsScriptResponse.status,
          result
        },
        appsScriptResponse.ok ? 200 : 502,
        headers
      );

    } catch (err) {

      return json(
        {
          success: false,
          error: err instanceof Error ? err.message : String(err)
        },
        500,
        headers
      );

    }
  }
};

async function getProjectActivity(body, env, headers) {
  try {
    if (!env.DB || typeof env.DB.prepare !== "function") {
      throw activityError("D1_NOT_CONFIGURED");
    }
    const repository = new ProjectActivityRepository(env.DB);
    const service = new ProjectActivityService(repository, {
      resolveProjectName: name => resolveProjectByName(name, env)
    });
    return json(await service.get(body), 200, headers);
  } catch (error) {
    const known = error instanceof ProjectActivityError;
    const normalized = known ? error : activityError("INTERNAL_ERROR");
    return json({
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details ? { details: normalized.details } : {})
      }
    }, normalized.status, headers);
  }
}

async function updateProjectActivity(body, env, headers) {
  try {
    if (!env.DB || typeof env.DB.prepare !== "function" ||
        typeof env.DB.batch !== "function") {
      throw activityError("D1_NOT_CONFIGURED");
    }
    const repository = new ProjectActivityRepository(env.DB);
    const readService = new ProjectActivityService(repository, {
      resolveProjectName: name => resolveProjectByName(name, env)
    });
    const writeService = new ProjectActivityWriteService(repository, readService, {
      resolveProjectName: name => resolveProjectByName(name, env)
    });
    return json(await writeService.update(body), 200, headers);
  } catch (error) {
    const known = error instanceof ProjectActivityError;
    const normalized = known ? error : activityError("INTERNAL_ERROR");
    return json({
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details ? { details: normalized.details } : {})
      }
    }, normalized.status, headers);
  }
}

async function resolveProjectByName(projectName, env) {
  const response = await fetch(env.DESK_APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      token: env.DESK_API_TOKEN,
      action: "getProject",
      projectName
    })
  });
  if (!response.ok) throw activityError("PROJECT_NOT_FOUND");
  const result = await response.json();
  if (!result || result.success !== true || !result.project) {
    throw activityError("PROJECT_NOT_FOUND");
  }
  return result.project;
}

function json(payload, status, headers) {
  return new Response(
    JSON.stringify(payload, null, 2),
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json"
      }
    }
  );
}

function authError(auth, headers) {
  return json({ success: false, error: { code: auth.code,
    message: auth.status === 401 ? "Unauthorized." : "Authentication is not configured." } },
  auth.status, headers);
}

async function deliverOneAdmin(body, env, headers) {
  const eventId = String(body && body.eventId || "").trim();
  if (!eventId || eventId.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(eventId)) {
    return json({ success: false, error: { code: "INVALID_EVENT_ID",
      message: "eventId is required and must use a safe format." } }, 400, headers);
  }
  try {
    const result = await deliverOutboxEvent(eventId, env);
    return json({ success: true, eventId: result.eventId,
      delivered: result.alreadyDelivered !== true,
      alreadyDelivered: result.alreadyDelivered === true,
      attempts: result.attempts,
      deliveredAt: result.deliveredAt || null,
      idempotentReplay: result.idempotentReplay === true }, 200, headers);
  } catch (error) {
    return outboxAdminError(error, headers);
  }
}

async function deliverPendingAdmin(body, env, headers) {
  const limit = body && body.limit === undefined ? 10 : body.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return json({ success: false, error: { code: "INVALID_DELIVERY_LIMIT",
      message: "limit must be an integer between 1 and 100." } }, 400, headers);
  }
  try {
    const events = await deliverPendingOutbox(limit, env);
    const delivered = events.filter(event => event.success).length;
    return json({ success: true, attempted: events.length, delivered,
      failed: events.length - delivered,
      events: events.map(event => ({ eventId: event.eventId,
        success: event.success, alreadyDelivered: event.alreadyDelivered === true,
        error: event.error || null, retryable: event.retryable === true })) }, 200, headers);
  } catch (error) {
    return outboxAdminError(error, headers);
  }
}

function outboxAdminError(error, headers) {
  const known = error instanceof OutboxDeliveryError || error instanceof ProjectActivityError;
  const code = known ? error.code : "INTERNAL_ERROR";
  const status = code === "OUTBOX_EVENT_NOT_FOUND" ? 404 :
    code === "D1_NOT_CONFIGURED" || code === "AUTH_NOT_CONFIGURED" ? 503 : 502;
  return json({ success: false, error: { code, message: known ? error.message :
    "Internal error." } }, status, headers);
}

export async function deliverOutboxEvent(eventId, env, options = {}) {
  return outboxDeliveryService(env, options).deliverOutboxEvent(eventId);
}

export async function deliverPendingOutbox(limit, env, options = {}) {
  return outboxDeliveryService(env, options).deliverPendingOutbox(limit);
}

function outboxDeliveryService(env, options) {
  if (!env || !env.DB || typeof env.DB.prepare !== "function") {
    throw activityError("D1_NOT_CONFIGURED");
  }
  return new ProjectActivityOutboxDeliveryService(
    new ProjectActivityRepository(env.DB),
    {
      appsScriptUrl: env.DESK_APPS_SCRIPT_URL,
      token: env.DESK_API_TOKEN,
      fetch: options.fetch,
      now: options.now
    }
  );
}
