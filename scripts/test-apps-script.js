const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");

const files = [
  "Constants.js", "Settings.js", "MigrationUtils.js", "MigrationManifest.js",
  "MigrationRecordCodec.js", "MigrationLog.js", "MigrationLogRepository.js",
  "MigrationDataSource.js", "BaselineValidator.js", "DryRunEngine.js",
  "MigrationPreflightValidator.js", "MigrationSafetyGuard.js", "BackupEngine.js",
  "MigrationWriter.js", "RollbackEngine.js", "MigrationExecutor.js",
  "TimelineRepository.js", "ProjectActivityTimelineDeliveryRepository.js",
  "ProjectRepository.js", "TaskRepository.js", "TimelineService.js",
  "ProjectService.js", "TaskService.js", "MemoryUpdate.js",
  "WorkspaceSettings.js", "WorkspaceRepository.js", "WorkspaceAliasRepository.js",
  "WorkspaceService.js",
  "WorkspaceDataQualityService.js", "DeskEngine.js", "UI.js",
  "TimelineEventIdMigration.js", "TestMigrationExecution.js",
  "TimelineEventIdMigrationAdmin.js", "ProjectActivityTimelineDeliveryMigration.js",
  "ProjectActivityTimelineDeliveryMigrationAdmin.js", "TestProjectActivityOutbox.js",
  "TestProjectActivityTimelineDeliveryMigration.js", "TestTimelineCanonicalModel.js"
];

const context = vm.createContext({
  console,
  Date,
  Utilities: {
    DigestAlgorithm: { SHA_256: "sha256" },
    Charset: { UTF_8: "utf8" },
    formatDate() { return "20260904-120000"; },
    computeDigest(_algorithm, value) {
      return [...crypto.createHash("sha256").update(value, "utf8").digest()];
    }
  },
  Session: { getScriptTimeZone() { return "Europe/Rome"; } }
});

for (const file of files) {
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
}

const sink = vm.runInContext("testProjectActivityTimelineSink()", context);
const migration = vm.runInContext("testProjectActivityTimelineEventIdMigration()", context);
const registryMigration = vm.runInContext(
  "testProjectActivityTimelineDeliveryMigration()", context
);
const canonical = vm.runInContext("testTimelineCanonicalModel()", context);
if (!sink.success || !migration.success || !registryMigration.success || !canonical.success) {
  process.exitCode = 1;
} else console.log("Apps Script ProjectActivity canonical Timeline tests: PASS");
