const MigrationDataSource = {

  headersMatchWithEmptyTail(actualHeaders, expectedHeaders) {
    if (!Array.isArray(actualHeaders) || !Array.isArray(expectedHeaders) ||
        actualHeaders.length < expectedHeaders.length) {
      return false;
    }
    return MigrationUtils.valuesEqual(
      actualHeaders.slice(0, expectedHeaders.length), expectedHeaders
    ) && actualHeaders.slice(expectedHeaders.length).every(header => (
      String(header) === ""
    ));
  },

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
        exists: !!sheet,
        headers: [],
        rows: []
      };
    }

    const values = sheet.getDataRange().getValues();
    const headers = values.shift().map(value => String(value || ""));

    return {
      name: sheetName,
      exists: true,
      headers: headers,
      rows: values.map((row, index) => ({
        rowNumber: index + 2,
        rawValues: row.map(value => MigrationUtils.normalizeValue(value)),
        values: headers.reduce((record, header, columnIndex) => {
          record[header] = MigrationUtils.normalizeValue(row[columnIndex]);
          return record;
        }, {})
      }))
    };
  }

};
