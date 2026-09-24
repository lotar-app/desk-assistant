import { HealthService } from "./foundation/health-service.mjs";
import { json, methodNotAllowed, notFound } from "./response.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
