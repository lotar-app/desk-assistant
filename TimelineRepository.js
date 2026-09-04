/**
 * TIMELINE REPOSITORY
 */

const TimelineRepository = {

  sheet() {
    return SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEETS.TIMELINE);
  },

  append(data, headers) {
    if (this.sheet().getLastRow() === 0) {
      this.sheet().appendRow(headers);
    }

    this.sheet().appendRow(data);
    return this.sheet().getLastRow();
  },

  appendLegacy(event) {
    return this.append([
      event.timestamp, String(event.projectId || ""),
      String(event.eventType || ""), String(event.description || "")
    ], TIMELINE_HEADERS);
  },

  appendEvent(event) {
    return this.append([
      String(event.id || ""), String(event.projectId || ""),
      String(event.taskId || ""), event.timestamp,
      String(event.eventType || ""), String(event.description || ""),
      String(event.author || "SYSTEM")
    ], TIMELINE_CANONICAL_HEADERS);
  },

  nextRowNumber() {
    return this.sheet().getLastRow() + 1;
  },

  getEventAtRow(rowNumber) {
    const row = Number(rowNumber);
    if (!Number.isInteger(row) || row < 2 || row > this.sheet().getLastRow()) {
      return null;
    }
    return this.fromRow(this.sheet().getRange(row, 1, 1, 7).getValues()[0]);
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
    const canonical = row.length >= 7 &&
      String(row[1] || "").trim() !== "" &&
      String(row[4] || "").trim() !== "" &&
      String(row[5] || "").trim() !== "";
    if (canonical) {
      return {
        id: row[0] || "", projectId: row[1] || "", taskId: row[2] || "",
        date: row[3], timestamp: row[3], type: row[4] || "",
        eventType: row[4] || "", description: row[5] || "",
        author: row[6] || "", layout: "CANONICAL_V1"
      };
    }
    return {
      id: "", projectId: row[1] || "", taskId: "", date: row[0],
      timestamp: row[0], type: row[2] || "", eventType: row[2] || "",
      description: row[3] || "", author: "", layout: "LEGACY_V0"
    };
  }

};
