import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = Number(readArgument("--id"));
const marker = readArgument("--marker");
assert.ok(Number.isSafeInteger(id) && id > 0, "--id must be a positive integer");
assert.match(marker, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, "--marker is invalid");

const config = JSON.parse(fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
assert.equal(config.name, "desk-v2-foundation-dev");
assert.equal(config.d1_databases?.[0]?.binding, "DESK_V2_DB");
assert.equal(config.d1_databases?.[0]?.database_id,
  "e2b252a0-ec15-48a8-bcd6-aed6d49427a3");

const escapedMarker = marker.replaceAll("'", "''");
const where = `id = ${id} AND marker = '${escapedMarker}'`;
const before = execute(`SELECT COUNT(*) AS count FROM mcp_capability_test WHERE ${where};`);
assert.match(before, /count[^0-9]*1/i, "exactly one matching capability row is required");
execute(`DELETE FROM mcp_capability_test WHERE ${where};`);
const after = execute(`SELECT COUNT(*) AS count FROM mcp_capability_test WHERE ${where};`);
assert.match(after, /count[^0-9]*0/i, "capability row cleanup failed");
console.log("MCP capability-test row removed and absence verified");

function execute(sql) {
  return execFileSync(path.join(root, "node_modules", ".bin", "wrangler"), [
    "d1", "execute", "DESK_V2_DB", "--remote", "--command", sql
  ], { cwd: root, encoding: "utf8" });
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  assert.notEqual(index, -1, `${name} is required`);
  assert.ok(process.argv[index + 1], `${name} requires a value`);
  return process.argv[index + 1];
}
