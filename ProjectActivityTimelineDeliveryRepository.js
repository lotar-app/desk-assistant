const ProjectActivityTimelineDeliveryRepository = {

  sheet() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
      CONFIG.SHEETS.PROJECT_ACTIVITY_TIMELINE_DELIVERY
    );
    if (!sheet) throw timelineDeliveryRegistryError("TIMELINE_DELIVERY_REGISTRY_MISSING");
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (!MigrationUtils.valuesEqual(headers, PROJECT_ACTIVITY_TIMELINE_DELIVERY_HEADERS)) {
      throw timelineDeliveryRegistryError("TIMELINE_DELIVERY_REGISTRY_SCHEMA_INVALID");
    }
    return sheet;
  },

  findByEventId(eventId) {
    const sheet = this.sheet();
    if (sheet.getLastRow() < 2) return null;
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
      PROJECT_ACTIVITY_TIMELINE_DELIVERY_HEADERS.length).getValues();
    for (let index = 0; index < rows.length; index++) {
      if (String(rows[index][0] || "") === String(eventId || "")) {
        return this.fromRow(rows[index], index + 2);
      }
    }
    return null;
  },

  createPending(record) {
    if (this.findByEventId(record.eventId)) {
      throw timelineDeliveryRegistryError("TIMELINE_DELIVERY_EVENT_EXISTS");
    }
    const sheet = this.sheet();
    sheet.appendRow([
      record.eventId, record.projectId, record.fingerprint, record.timelineRow,
      record.createdAt || new Date(), "PENDING"
    ]);
    return this.fromRow(sheet.getRange(sheet.getLastRow(), 1, 1,
      PROJECT_ACTIVITY_TIMELINE_DELIVERY_HEADERS.length).getValues()[0],
    sheet.getLastRow());
  },

  markDelivered(eventId, timelineRow) {
    const record = this.findByEventId(eventId);
    if (!record) throw timelineDeliveryRegistryError("TIMELINE_DELIVERY_EVENT_MISSING");
    this.sheet().getRange(record.rowNumber, 4, 1, 3).setValues([[
      Number(timelineRow), record.createdAt, "DELIVERED"
    ]]);
    record.timelineRow = Number(timelineRow);
    record.status = "DELIVERED";
    return record;
  },

  updatePendingTimelineRow(eventId, timelineRow) {
    const record = this.findByEventId(eventId);
    if (!record || record.status !== "PENDING") {
      throw timelineDeliveryRegistryError("TIMELINE_DELIVERY_PENDING_MISSING");
    }
    this.sheet().getRange(record.rowNumber, 4, 1, 1).setValues([[Number(timelineRow)]]);
    record.timelineRow = Number(timelineRow);
    return record;
  },

  fromRow(row, rowNumber) {
    return { eventId: row[0], projectId: row[1], fingerprint: row[2],
      timelineRow: row[3] || null, createdAt: row[4], status: row[5],
      rowNumber: rowNumber };
  }
};

function timelineDeliveryRegistryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
