const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");

const files = [
  "Constants.js", "Settings.js", "MigrationUtils.js", "MigrationManifest.js",
  "MigrationWriter.js", "TimelineRepository.js", "TimelineService.js",
  "TimelineEventIdMigration.js", "TestMigrationExecution.js",
  "TestProjectActivityOutbox.js"
];

const context = vm.createContext({
  console,
  Date,
  Utilities: {
    DigestAlgorithm: { SHA_256: "sha256" },
    Charset: { UTF_8: "utf8" },
    computeDigest(_algorithm, value) {
      return [...crypto.createHash("sha256").update(value, "utf8").digest()];
    }
  }
});

for (const file of files) {
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
}

const sink = vm.runInContext("testProjectActivityTimelineSink()", context);
const migration = vm.runInContext("testProjectActivityTimelineEventIdMigration()", context);
if (!sink.success || !migration.success) process.exitCode = 1;
else console.log("Apps Script ProjectActivity 3A tests: PASS");
