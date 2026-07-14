const MigrationDataSource = {

  readSheet(sheetName) {
    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(sheetName);

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
