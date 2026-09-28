import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const persistence = fs.mkdtempSync(path.join(os.tmpdir(), "desk-v2-foundation-"));

try {
  wrangler(["d1", "migrations", "apply", "DESK_V2_DB", "--local",
    "--persist-to", persistence]);
  const schema = execute(`
    SELECT count(*) AS count
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('system_metadata', 'containers', 'tasks', 'd1_migrations',
        'mcp_capability_test', 'mcp_idempotency');
  `);
  assert.match(schema, /(?:"count"\s*:\s*6|count[^0-9]*6)/i);
  assert.match(execute(`SELECT count(*) AS count FROM d1_migrations
    WHERE name = '0003_container_create_idempotency.sql';`),
  /(?:"count"\s*:\s*1|count[^0-9]*1)/i);
  assert.match(execute("PRAGMA foreign_keys;"), /foreign_keys[^0-9]*1/i);
  console.log("DESK V2 FOUNDATION CHECK PASSED");
} finally {
  fs.rmSync(persistence, { recursive: true, force: true });
}

function execute(sql) {
  return wrangler(["d1", "execute", "DESK_V2_DB", "--local",
    "--persist-to", persistence, "--command", compact(sql)]);
}

function wrangler(args) {
  assert.equal(args.includes("--remote"), false, "Remote access is forbidden");
  assert.equal(args.includes("--local"), true, "Every D1 command must be local");
  return execFileSync(path.join(root, "node_modules", ".bin", "wrangler"), args, {
    cwd: root,
    encoding: "utf8",
    env: sanitizedEnvironment()
  });
}

function compact(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function sanitizedEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(DESK_|PROJECT_ACTIVITY_|CLOUDFLARE_|CF_)/.test(key)) delete env[key];
  }
  return env;
}
