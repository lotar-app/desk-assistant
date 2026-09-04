/**
 * TIMELINE REPOSITORY
 */

const TimelineRepository = {

  sheet() {
    return SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEETS.TIMELINE);
  },

  append(data) {
    if (this.sheet().getLastRow() === 0) {
      this.sheet().appendRow(TIMELINE_HEADERS);
    }

    this.sheet().appendRow(data);
  },

  findByEventId(eventId) {
    const target = String(eventId || "").trim();
    if (!target) return null;
    const values = this.sheet().getDataRange().getValues();
    if (!values.length) return null;
    const eventIdIndex = values[0].indexOf("EventId");
    if (eventIdIndex === -1) {
      throw new Error("TIMELINE_EVENT_ID_SCHEMA_MISSING");
    }
    for (let index = 1; index < values.length; index++) {
      if (String(values[index][eventIdIndex] || "").trim() === target) {
        return this.fromRow(values[index]);
      }
    }
    return null;
  },

  list() {

    const values = this.sheet().getDataRange().getValues();

    values.shift();

    return values.map(row => this.fromRow(row));

  },

  listByProject(projectId) {

    return this
      .list()
      .filter(event => String(event.projectId).trim() === String(projectId).trim());

  },

  latestByProject(projectId, limit) {

    return this
      .listByProject(projectId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

  },

  fromRow(row) {

    return {
      date: row[0],
      projectId: row[1],
      type: row[2],
      description: row[3],
      eventId: row[4] || null
    };

  }

};
