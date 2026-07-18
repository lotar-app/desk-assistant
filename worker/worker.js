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
