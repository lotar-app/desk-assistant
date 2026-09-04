export class OutboxDeliveryError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "OutboxDeliveryError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.status = options.status;
  }
}

export class ProjectActivityOutboxDeliveryService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.fetch = options.fetch || globalThis.fetch;
    this.appsScriptUrl = options.appsScriptUrl;
    this.token = options.token;
    this.now = options.now || (() => new Date().toISOString());
  }

  async deliverOutboxEvent(eventId) {
    const event = await this.repository.findOutboxEvent(String(eventId || "").trim());
    if (!event) throw deliveryError("OUTBOX_EVENT_NOT_FOUND");
    if (event.delivered_at) {
      return deliveryResult(event, { alreadyDelivered: true,
        attempts: Number(event.attempts), deliveredAt: event.delivered_at });
    }
    let sink;
    try {
      const response = await this.fetch(this.appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          token: this.token,
          action: "appendProjectActivityTimelineEvent",
          eventId: event.event_id,
          projectId: event.project_id,
          activityId: event.activity_id,
          eventType: event.event_type,
          description: event.description,
          createdAt: event.created_at
        })
      });
      if (!response.ok) {
        throw new OutboxDeliveryError(
          response.status >= 500 ? "APPS_SCRIPT_TEMPORARY_ERROR" : "APPS_SCRIPT_PERMANENT_ERROR",
          `Apps Script HTTP ${response.status}`,
          { retryable: response.status >= 500, status: response.status }
        );
      }
      try {
        sink = await response.json();
      } catch {
        throw deliveryError("APPS_SCRIPT_INVALID_RESPONSE");
      }
      if (!sink || sink.success !== true || sink.eventId !== event.event_id ||
          (sink.created !== true && sink.idempotentReplay !== true)) {
        const code = sink && sink.error && sink.error.code;
        if (code === "TIMELINE_EVENT_CONFLICT") throw deliveryError("SINK_IDEMPOTENCY_CONFLICT");
        if (code === "TIMELINE_LOCK_UNAVAILABLE") {
          throw deliveryError("APPS_SCRIPT_TEMPORARY_ERROR");
        }
        if (code === "PROJECT_NOT_FOUND" || code === "INVALID_TIMELINE_EVENT") {
          throw deliveryError("APPS_SCRIPT_PERMANENT_ERROR");
        }
        if (sink && sink.error === "Unauthorized") {
          throw deliveryError("APPS_SCRIPT_PERMANENT_ERROR");
        }
        throw deliveryError("APPS_SCRIPT_INVALID_RESPONSE");
      }
    } catch (error) {
      const normalized = error instanceof OutboxDeliveryError
        ? error
        : new OutboxDeliveryError("APPS_SCRIPT_NETWORK_ERROR", "Apps Script network error", { retryable: true });
      await this.repository.recordOutboxFailure(event.event_id, safeError(normalized));
      throw normalized;
    }
    const deliveredAt = this.now();
    await this.repository.recordOutboxSuccess(event.event_id, deliveredAt);
    return deliveryResult(event, {
      deliveredAt,
      attempts: Number(event.attempts) + 1,
      idempotentReplay: sink.idempotentReplay === true
    });
  }

  async deliverPendingOutbox(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw deliveryError("INVALID_DELIVERY_LIMIT");
    }
    const events = await this.repository.listPendingOutbox(limit);
    const results = [];
    for (const event of events) {
      try {
        results.push(await this.deliverOutboxEvent(event.event_id));
      } catch (error) {
        results.push({ success: false, eventId: event.event_id, error: error.code,
          retryable: error.retryable === true });
      }
    }
    return results;
  }
}

function deliveryError(code) {
  const definitions = {
    OUTBOX_EVENT_NOT_FOUND: ["Outbox event not found", false],
    APPS_SCRIPT_INVALID_RESPONSE: ["Apps Script returned an invalid response", true],
    SINK_IDEMPOTENCY_CONFLICT: ["Timeline sink idempotency conflict", false],
    APPS_SCRIPT_PERMANENT_ERROR: ["Apps Script rejected the event", false],
    APPS_SCRIPT_TEMPORARY_ERROR: ["Apps Script temporarily unavailable", true],
    INVALID_DELIVERY_LIMIT: ["Delivery limit must be an integer between 1 and 100", false]
  };
  const definition = definitions[code] || [code, false];
  return new OutboxDeliveryError(code, definition[0], { retryable: definition[1] });
}

function safeError(error) {
  return JSON.stringify({ code: error.code, message: error.message,
    retryable: error.retryable === true, status: error.status || null }).slice(0, 1000);
}

function deliveryResult(event, extra) {
  return { success: true, eventId: event.event_id, ...extra };
}
