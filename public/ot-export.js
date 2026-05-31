import {
  DEFAULT_SHEET_NAME,
  minutesBetween,
  normalizeSheetName,
  normalizeTime24h,
  splitEntriesAcrossMidnight,
} from "./domain.js";

const OT_EXPORT_HEADERS = [
  "DEMO",
  "MSNV",
  "Họ và tên",
  "",
  "Ngày ghi nhận OT",
  "Thời gian vào ca",
  "Thời gian ra ca",
  "Tổng giờ OT",
  "Giải trình (7,14,21,28)",
];
const OT_EXPORT_COLUMN_WIDTHS = [
  16.75, 16.75, 22.13, 22.13, 36.63, 16.75, 16.75, 16.75, 94.75,
];
const OT_EXPORT_COLORS = {
  headerText: "FF914D4F",
  dateFill: "FFB7E1CD",
  hoursText: "FF4A86E8",
  border: "FF000000",
};

function createOtExportBorder() {
  return {
    top: { style: "thin", color: { argb: OT_EXPORT_COLORS.border } },
    right: { style: "thin", color: { argb: OT_EXPORT_COLORS.border } },
    bottom: { style: "thin", color: { argb: OT_EXPORT_COLORS.border } },
    left: { style: "thin", color: { argb: OT_EXPORT_COLORS.border } },
  };
}

function createOtExportHeaderStyle(overrides = {}) {
  return {
    font: {
      bold: true,
      color: { argb: OT_EXPORT_COLORS.headerText },
    },
    alignment: {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    },
    border: createOtExportBorder(),
    ...overrides,
  };
}

function createOtExportCellStyle(overrides = {}) {
  return {
    alignment: {
      vertical: "middle",
    },
    border: createOtExportBorder(),
    ...overrides,
  };
}

function parseExcelCompatibleDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const match = String(value ?? "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseExcelCompatibleTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  const isMidnightBoundary = hour === 24 && minute === 0 && second === 0;
  const isRegularTime =
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59;

  if (!isMidnightBoundary && !isRegularTime) {
    return null;
  }

  const totalSeconds = isMidnightBoundary
    ? 86400
    : hour * 3600 + minute * 60 + second;
  return totalSeconds / 86400;
}

function normalizeOtExportRecord(record) {
  const date = parseExcelCompatibleDate(record?.date);
  const startTimeSerial = parseExcelCompatibleTime(record?.startTime);
  const endTimeSerial = parseExcelCompatibleTime(record?.endTime);
  const startTimeText = String(record?.startTime ?? "").trim();
  const endTimeText = String(record?.endTime ?? "").trim();

  if (!date || startTimeSerial === null || endTimeSerial === null) {
    return null;
  }

  return {
    date,
    startTimeSerial,
    endTimeSerial,
    startTimeText,
    endTimeText,
    totalHours:
      minutesBetween(
        normalizeTime24h(startTimeText) ?? startTimeText,
        normalizeTime24h(endTimeText) ?? endTimeText,
      ) / 60,
    note: String(record?.note ?? "").trim(),
  };
}

function formatOtHoursForExport(value) {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue)) {
    return "0.00";
  }

  return normalizedValue.toFixed(2);
}

export function createOtExportWorkbook(records, employee = {}) {
  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = "OT Tracker";
  workbook.calcProperties.fullCalcOnLoad = true;
  createOtExportWorksheet(workbook, records, employee);

  return workbook;
}

function getUniqueWorksheetName(workbook, desiredName) {
  const baseName =
    normalizeSheetName(desiredName).slice(0, 31) || DEFAULT_SHEET_NAME;
  let candidate = baseName;
  let index = 2;

  while (workbook.getWorksheet(candidate)) {
    const suffix = ` ${index}`;
    candidate = `${baseName.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }

  return candidate;
}

function createOtExportWorksheet(workbook, records, employee = {}) {
  const worksheet = workbook.addWorksheet(
    getUniqueWorksheetName(workbook, employee.sheetName),
    {
      views: [{ state: "frozen", ySplit: 1 }],
    },
  );

  setOtExportColumnWidths(worksheet);
  writeOtExportHeader(worksheet);
  writeOtExportRows(worksheet, records, employee);

  return worksheet;
}

export function createAdminOtExportWorkbook(profiles) {
  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = "OT Tracker";
  workbook.calcProperties.fullCalcOnLoad = true;

  const worksheet = workbook.addWorksheet(
    getUniqueWorksheetName(workbook, "All members"),
    {
      views: [{ state: "frozen", ySplit: 1 }],
    },
  );

  const records = profiles.flatMap((profile) => {
    const employee = profile.employee ?? {};
    return splitEntriesAcrossMidnight(profile.entries ?? []).map((entry) => ({
      entry,
      employee,
    }));
  });

  setOtExportColumnWidths(worksheet);
  writeOtExportHeader(worksheet);
  writeAdminOtExportRows(worksheet, records);

  return workbook;
}

function setOtExportColumnWidths(worksheet) {
  worksheet.columns = OT_EXPORT_COLUMN_WIDTHS.map((width) => ({ width }));
}

function writeOtExportHeader(worksheet) {
  const headerRow = worksheet.getRow(1);
  OT_EXPORT_HEADERS.forEach((value, index) => {
    headerRow.getCell(index + 1).value = value;
  });

  headerRow.height = 28;
  applyOtExportHeaderStyles(headerRow);
}

function applyOtExportHeaderStyles(row) {
  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const headerStyle = createOtExportHeaderStyle();

    if (columnNumber === 5) {
      headerStyle.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: OT_EXPORT_COLORS.dateFill },
      };
    }

    if (columnNumber === 8) {
      headerStyle.font = {
        bold: true,
        color: { argb: OT_EXPORT_COLORS.hoursText },
      };
    }

    cell.style = headerStyle;
  });
}

function writeOtExportRows(worksheet, records, employee) {
  const normalizedRecords = records
    .map((record) => normalizeOtExportRecord(record))
    .filter(Boolean);
  const employeeCode = String(employee.employeeCode ?? "").trim();
  const employeeName = String(employee.fullName ?? "").trim();

  normalizedRecords.forEach((record, index) => {
    const rowNumber = index + 2;
    const row = worksheet.getRow(rowNumber);

    row.getCell(1).value = "DEMO";
    row.getCell(2).value = employeeCode;
    row.getCell(3).value = employeeName;
    row.getCell(4).value = "";
    row.getCell(5).value = record.date;
    row.getCell(6).value = record.startTimeSerial;
    row.getCell(7).value = record.endTimeSerial;
    row.getCell(8).value = {
      formula: `SUBSTITUTE(TEXT(MOD(G${rowNumber}-F${rowNumber},1)*24,"0.00"),",",".")`,
      result: formatOtHoursForExport(record.totalHours),
    };
    row.getCell(9).value = record.note;

    applyOtExportDataStyles(row);
  });
}

function writeAdminOtExportRows(worksheet, records) {
  const normalizedRecords = records
    .map(({ entry, employee }) => ({
      record: normalizeOtExportRecord(entry),
      employee: employee ?? {},
    }))
    .filter(({ record }) => record);

  normalizedRecords.forEach(({ record, employee }, index) => {
    const rowNumber = index + 2;
    const row = worksheet.getRow(rowNumber);
    const employeeCode = String(employee.employeeCode ?? "").trim();
    const employeeName = String(employee.fullName ?? "").trim();

    row.getCell(1).value = "DEMO";
    row.getCell(2).value = employeeCode;
    row.getCell(3).value = employeeName;
    row.getCell(4).value = "";
    row.getCell(5).value = record.date;
    row.getCell(6).value = record.startTimeSerial;
    row.getCell(7).value = record.endTimeSerial;
    row.getCell(8).value = {
      formula: `SUBSTITUTE(TEXT(MOD(G${rowNumber}-F${rowNumber},1)*24,"0.00"),",",".")`,
      result: formatOtHoursForExport(record.totalHours),
    };
    row.getCell(9).value = record.note;

    applyOtExportDataStyles(row);
  });
}

function applyOtExportDataStyles(row) {
  row.height = 22;

  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const isCentered = columnNumber >= 5 && columnNumber <= 8;
    cell.style = createOtExportCellStyle({
      alignment: {
        horizontal: isCentered ? "center" : "left",
        vertical: "middle",
      },
    });

    if (columnNumber === 5) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: OT_EXPORT_COLORS.dateFill },
      };
      cell.numFmt = "dd/MM/yyyy";
    }

    if (columnNumber === 6 || columnNumber === 7) {
      cell.numFmt = "HH:mm:ss";
    }

    if (columnNumber === 8) {
      cell.font = {
        color: { argb: OT_EXPORT_COLORS.hoursText },
      };
      cell.numFmt = "@";
    }
  });
}
