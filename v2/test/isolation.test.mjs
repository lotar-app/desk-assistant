import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const v2Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(v2Root, "..");

test("la configurazione V2 non usa UUID, nome o binding D1 V1", () => {
  const v1 = JSON.parse(fs.readFileSync(path.join(repositoryRoot,
    "worker", "wrangler.jsonc"), "utf8"));
  const v2 = JSON.parse(fs.readFileSync(path.join(v2Root, "wrangler.jsonc"), "utf8"));
  const v1Database = v1.d1_databases[0];
  const v2Database = v2.d1_databases[0];
  assert.notEqual(v2.name, v1.name);
  assert.notEqual(v2Database.database_id, v1Database.database_id);
  assert.notEqual(v2Database.database_name, v1Database.database_name);
  assert.notEqual(v2Database.binding, v1Database.binding);
});

test("il package V2 non espone script deploy o comandi remoti", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(v2Root, "package.json"), "utf8"));
  assert.equal("deploy" in pkg.scripts, false);
  assert.equal(JSON.stringify(pkg.scripts).includes("--remote"), false);
});

test("il runtime V2 non importa file esterni a v2/src", () => {
  for (const file of files(path.join(v2Root, "src"))) {
    const content = fs.readFileSync(file, "utf8");
    assert.equal(/from\s+["'](?:\.\.\/){2,}/.test(content), false, file);
  }
});

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}
