function testTimelineCanonicalModel() {
  const appended = [];
  const originalAppend = TimelineRepository.append;
  TimelineRepository.append = function(row) {
    appended.push(row);
    return appended.length + 1;
  };
  try {
    addTimeline("PRJ-1", "PROJECT_CREATED", "fixture-only",
      { id: "PRJ-1", author: "SYSTEM", timestamp: new Date(0) });
    addTimeline("PRJ-1", "TASK_CREATED", "fixture-only",
      { id: "TSK-1", taskId: "TSK-1", author: "SYSTEM", timestamp: new Date(1) });
    addTimeline("PRJ-1", "MEMORY_EVENT", "fixture-only",
      { author: "CUSTOM_GPT", timestamp: new Date(2) });
  } finally {
    TimelineRepository.append = originalAppend;
  }
  assertCanonicalTimeline(appended.length === 3, "Writer canonico non invocato.");
  assertCanonicalTimeline(appended[0][0] === "PRJ-1" && appended[0][2] === "" &&
    appended[0][4] === "PROJECT_CREATED" && appended[0][6] === "SYSTEM",
  "Mapping Project errato.");
  assertCanonicalTimeline(appended[1][0] === "TSK-1" &&
    appended[1][2] === "TSK-1" && appended[1][3].getTime() === 1,
  "Mapping Task errato.");
  assertCanonicalTimeline(appended[2][0] === "" &&
    appended[2][4] === "MEMORY_EVENT" && appended[2][5] === "fixture-only" &&
    appended[2][6] === "CUSTOM_GPT", "Mapping memory errato.");

  const projectCreate = String(ProjectService.create);
  const projectUpdate = String(ProjectService.update);
  const taskCreate = String(TaskService.create);
  const taskComplete = String(TaskService.complete);
  const memoryWriter = String(DeskEngine.applyPreparedUpdate);
  assertCanonicalTimeline(projectCreate.indexOf("{ id: id, author: \"SYSTEM\" }") !== -1,
    "Project create non mappato.");
  assertCanonicalTimeline(projectUpdate.indexOf("{ id: id, author: \"SYSTEM\" }") !== -1,
    "Project update non mappato.");
  assertCanonicalTimeline(taskCreate.indexOf("taskId: id") !== -1,
    "Task create senza TaskID.");
  assertCanonicalTimeline(taskComplete.indexOf("taskId: id") !== -1,
    "Task complete senza TaskID.");
  assertCanonicalTimeline(memoryWriter.indexOf("CUSTOM_GPT") !== -1,
    "Memory event senza Author.");
  return { success: true, events: appended.length };
}

function assertCanonicalTimeline(condition, message) {
  if (!condition) throw new Error(message);
}
