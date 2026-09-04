export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalValue(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number.");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Value is not JSON serializable.");
  if (ancestors.has(value)) throw new TypeError("Circular JSON value.");
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map(item => canonicalValue(item, ancestors));
  } else {
    result = {};
    Object.keys(value).sort().forEach(key => {
      const item = value[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol") {
        throw new TypeError("Value is not JSON serializable.");
      }
      result[key] = canonicalValue(item, ancestors);
    });
  }
  ancestors.delete(value);
  return result;
}

export async function requestHash(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
