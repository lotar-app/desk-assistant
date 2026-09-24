export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function methodNotAllowed() {
  return json({ success: false, error: { code: "METHOD_NOT_ALLOWED" } }, 405);
}

export function notFound() {
  return json({ success: false, error: { code: "NOT_FOUND" } }, 404);
}
