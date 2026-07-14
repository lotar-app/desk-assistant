const MigrationDataSource = {

  readSheet(sheetName) {
    return this.readFromSpreadsheet(
      SpreadsheetApp.getActiveSpreadsheet(),
      sheetName
    );
  },

  forSpreadsheet(spreadsheet) {
    return {
      readSheet: sheetName => (
        MigrationDataSource.readFromSpreadsheet(spreadsheet, sheetName)
      )
    };
  },

  readFromSpreadsheet(spreadsheet, sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet || sheet.getLastRow() === 0) {
      return {
        name: sheetName,
        headers: [],
        rows: []
      };
    }

    const values = sheet.getDataRange().getValues();
    const headers = values.shift().map(value => String(value || ""));

    return {
      name: sheetName,
      headers: headers,
      rows: values.map((row, index) => ({
        rowNumber: index + 2,
        values: headers.reduce((record, header, columnIndex) => {
          record[header] = MigrationUtils.normalizeValue(row[columnIndex]);
          return record;
        }, {})
      }))
    };
  }

};
