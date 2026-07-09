/**
 * TIMELINE SERVICE
 */

function addTimeline(projectId, type, text) {

  TimelineRepository.append([
    new Date(),
    projectId,
    type,
    text
  ]);

}

function getLatestTimeline(projectId, limit) {

  return TimelineRepository.latestByProject(projectId, limit || 5);

}
