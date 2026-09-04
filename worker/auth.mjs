export async function requireBearer(request, configuredToken) {
  if (typeof configuredToken !== "string" || configuredToken.length < 16) {
    return { ok: false, status: 503, code: "AUTH_NOT_CONFIGURED" };
  }
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match || !(await secureEqual(match[1], configuredToken))) {
    return { ok: false, status: 401, code: "UNAUTHORIZED" };
  }
  return { ok: true };
}

async function secureEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right))
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
  }
  return difference === 0;
}
