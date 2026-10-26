const REQUIRED_SCOPE = "desk.read";
const ALLOWED_ALGORITHMS = new Set(["RS256"]);

export class OAuthConfigurationError extends Error {}
export class OAuthTokenError extends Error {}

export function oauthConfiguration(env) {
  const issuer = requiredUrl(env.DESK_V2_OAUTH_ISSUER, "DESK_V2_OAUTH_ISSUER", {
    preserveTrailingSlash: true
  });
  const resource = requiredUrl(env.DESK_V2_MCP_CANONICAL_URL,
    "DESK_V2_MCP_CANONICAL_URL");
  const audience = requiredText(env.DESK_V2_OAUTH_AUDIENCE,
    "DESK_V2_OAUTH_AUDIENCE");
  const jwksUri = requiredUrl(env.DESK_V2_OAUTH_JWKS_URI,
    "DESK_V2_OAUTH_JWKS_URI");
  if (audience !== resource) {
    throw new OAuthConfigurationError(
      "DESK_V2_OAUTH_AUDIENCE must equal DESK_V2_MCP_CANONICAL_URL."
    );
  }
  return { issuer, resource, audience, jwksUri, requiredScope: REQUIRED_SCOPE };
}

export function protectedResourceMetadata(config) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.requiredScope],
    bearer_methods_supported: ["header"]
  };
}

export function resourceMetadataUrl(config) {
  const url = new URL(config.resource);
  return `${url.origin}/.well-known/oauth-protected-resource`;
}

export function bearerChallenge(config, error = undefined) {
  const fields = [
    `resource_metadata="${resourceMetadataUrl(config)}"`,
    `scope="${config.requiredScope}"`
  ];
  if (error) fields.push(`error="${error}"`);
  return `Bearer ${fields.join(", ")}`;
}

export async function authorizeOAuthRequest(request, config, options = {}) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) throw new OAuthTokenError("Missing or malformed bearer token.");
  return verifyJwt(match[1], config, options);
}

export async function verifyJwt(token, config, options = {}) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(part => !part)) {
    throw new OAuthTokenError("Malformed JWT.");
  }
  const header = decodeJson(parts[0], "JWT header");
  const claims = decodeJson(parts[1], "JWT claims");
  if (!isRecord(header) || !isRecord(claims)) {
    throw new OAuthTokenError("Invalid JWT payload.");
  }
  if (!ALLOWED_ALGORITHMS.has(header.alg) || typeof header.kid !== "string" || !header.kid) {
    throw new OAuthTokenError("Unsupported JWT header.");
  }

  const fetchImpl = options.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(config.jwksUri, { headers: { accept: "application/json" } });
  } catch {
    throw new OAuthTokenError("JWKS could not be loaded.");
  }
  if (!response.ok) throw new OAuthTokenError("JWKS could not be loaded.");
  let jwks;
  try { jwks = await response.json(); }
  catch { throw new OAuthTokenError("JWKS could not be parsed."); }
  const candidates = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const jwk = candidates.find(key => key?.kid === header.kid && key?.kty === "RSA" &&
    (!key.alg || key.alg === header.alg) && (!key.use || key.use === "sig"));
  if (!jwk) throw new OAuthTokenError("Signing key not found.");

  let key;
  try {
    key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
  } catch {
    throw new OAuthTokenError("Invalid signing key.");
  }
  let validSignature;
  try {
    validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    throw new OAuthTokenError("Invalid JWT signature.");
  }
  if (!validSignature) throw new OAuthTokenError("Invalid JWT signature.");

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== config.issuer) throw new OAuthTokenError("Invalid token issuer.");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.audience)) {
    throw new OAuthTokenError("Invalid token audience.");
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= now) {
    throw new OAuthTokenError("Token expired.");
  }
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) {
    throw new OAuthTokenError("Token not active.");
  }
  const scopes = typeof claims.scope === "string" ? claims.scope.split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(config.requiredScope)) {
    throw new OAuthTokenError("Required scope missing.");
  }
  return claims;
}

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new OAuthConfigurationError(`${name} is required.`);
  }
  return value.trim();
}

function requiredUrl(value, name, options = {}) {
  const text = requiredText(value, name);
  let url;
  try { url = new URL(text); } catch { throw new OAuthConfigurationError(`${name} is invalid.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new OAuthConfigurationError(`${name} must be a canonical HTTPS URL.`);
  }
  const canonical = url.toString();
  return options.preserveTrailingSlash ? canonical : canonical.replace(/\/$/, "");
}

function decodeJson(value, label) {
  try { return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))); }
  catch { throw new OAuthTokenError(`Invalid ${label}.`); }
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new OAuthTokenError("Invalid base64url value.");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
