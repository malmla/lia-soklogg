import {
  canonicalOption,
  cleanValues,
  createApplication,
  DATE_FIELDS,
  FIELDS,
  isIsoDate,
  STATUSES,
  validateValues,
  YES_NO,
  YES_NO_FIELDS,
} from "../model/application.js";
import { sortApplications } from "../model/sorting.js";

// Loaded on demand so the app starts fast.
const EXCELJS_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const TEMPLATE_URL = new URL("../../assets/lia-soklogg-mall.xlsx", import.meta.url);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const SHEET_NAME = "Söklogg";
const BRANSCH_SHEET_NAME = "Ansökningar";
const TEMPLATE_ROWS = 201;

export const COLUMNS = {
  date: "Datum",
  company: "Företag",
  city: "Ort",
  contactPerson: "Kontaktperson",
  title: "Titel",
  email: "E-post",
  phone: "Telefon",
  method: "Hur kontaktades företaget?",
  status: "Status",
  responseReceived: "Svar mottaget",
  interview: "Intervju",
  offered: "LIA-plats erbjuden",
  comment: "Kommentar",
  nextStep: "Nästa steg",
  followUpDate: "Uppföljningsdatum",
  notes: "Notes",
};

const REQUIRED_COLUMNS = new Set(["date", "company", "status"]);
const BRANSCH_COLUMNS = {
  company: "Företag",
  city: "Ort",
  contactPerson: "Kontaktperson",
  email: "E-post",
  phone: "Telefonnummer",
  motivation: "Kort presentation av företaget samt motivering till topp 1-3 / 1-5",
  notes: "Anteckningar",
};
const MAX_LISTED_ERRORS = 10;

export class ExcelError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ExcelError";
    this.details = details;
  }
}

let excelJs = null;

function loadExcelJs() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  excelJs ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = EXCELJS_URL;
    script.onload = () => resolve(globalThis.ExcelJS);
    script.onerror = () => reject(new Error("ExcelJS could not be loaded."));
    document.head.append(script);
  }).catch(() => {
    excelJs = null;
    throw new ExcelError("Excel-biblioteket kunde inte laddas. Kontrollera din internetanslutning.");
  });
  return excelJs;
}

const isoDate = (date) => date.toISOString().slice(0, 10);

/** Reads a cell value as plain text, unwrapping formulas, rich text and hyperlinks. */
function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : isoDate(value);
  if (typeof value === "object") {
    if ("error" in value) return "";
    if ("result" in value) return cellText(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
    if ("text" in value) return cellText(value.text);
    return "";
  }
  return String(value).trim();
}

function importBranschSheet(sheet, now) {
  const headerRow = sheet.getRow(1);
  const columnIndex = {};
  const missing = [];
  for (const [field, header] of Object.entries(BRANSCH_COLUMNS)) {
    let index = 0;
    for (let i = 1; i <= sheet.columnCount && !index; i++) {
      if (cellText(headerRow.getCell(i).value) === header) index = i;
    }
    if (index) columnIndex[field] = index;
    else if (field !== "notes") missing.push(header);
  }
  if (missing.length) {
    throw new ExcelError(
      `Felaktig bransch-tracker-export. Kolumner saknas: ${missing.join(", ")}.`,
    );
  }

  const imported = [];
  const errors = [];
  for (let line = 2; line <= sheet.rowCount; line++) {
    const row = sheet.getRow(line);
    const sourceValues = {};
    for (const field of Object.keys(BRANSCH_COLUMNS)) {
      sourceValues[field] = columnIndex[field]
        ? cellText(row.getCell(columnIndex[field]).value)
        : "";
    }
    if (!Object.values(sourceValues).some(Boolean)) continue;

    const values = Object.fromEntries(FIELDS.map((field) => [field, ""]));
    values.company = sourceValues.company;
    values.city = sourceValues.city;
    values.contactPerson = sourceValues.contactPerson;
    values.email = sourceValues.email;
    values.phone = sourceValues.phone;
    values.comment = sourceValues.motivation;
    values.notes = sourceValues.notes;

    for (const message of Object.values(validateValues(values, { requireCompany: false }))) {
      errors.push(`Rad ${line}: ${message}`);
    }
    imported.push(createApplication(values, now));
  }

  if (errors.length) {
    const details = errors.slice(0, MAX_LISTED_ERRORS);
    if (errors.length > MAX_LISTED_ERRORS) details.push(`…och ${errors.length - MAX_LISTED_ERRORS} fel till.`);
    throw new ExcelError("Importen avbröts, inga ansökningar lades till.", details);
  }
  if (!imported.length) throw new ExcelError("Filen innehåller inga rader att importera.");
  return imported;
}

/** Parses a LIA söklogg or bransch-tracker export into application records. */
export async function importWorkbook(file, now = new Date().toISOString(), { ExcelJS } = {}) {
  if (file.size > MAX_FILE_BYTES) throw new ExcelError("Filen är för stor (max 5 MB).");
  ExcelJS ??= await loadExcelJs();

  let sheet;
  let branschSheet;
  try {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await file.arrayBuffer());
    sheet = book.getWorksheet(SHEET_NAME);
    branschSheet = book.getWorksheet(BRANSCH_SHEET_NAME);
  } catch {
    throw new ExcelError("Felaktig filstruktur: filen kunde inte läsas som en .xlsx-fil.");
  }
  if (!sheet && branschSheet) return importBranschSheet(branschSheet, now);
  if (!sheet) {
    throw new ExcelError(
      `Felaktig filstruktur. Fliken "${SHEET_NAME}" saknas och exporten känns inte igen som bransch-tracker.`,
    );
  }

  const headerRow = sheet.getRow(1);
  const columnIndex = {};
  const missing = [];
  for (const [field, header] of Object.entries(COLUMNS)) {
    let index = 0;
    for (let i = 1; i <= sheet.columnCount && !index; i++) {
      if (cellText(headerRow.getCell(i).value) === header) index = i;
    }
    if (index) columnIndex[field] = index;
    else if (REQUIRED_COLUMNS.has(field)) missing.push(header);
  }
  if (missing.length) throw new ExcelError(`Felaktig filstruktur. Kolumner saknas: ${missing.join(", ")}.`);

  const imported = [];
  const errors = [];
  for (let line = 2; line <= sheet.rowCount; line++) {
    const row = sheet.getRow(line);
    const values = {};
    for (const field of FIELDS) {
      values[field] = columnIndex[field] ? cellText(row.getCell(columnIndex[field]).value) : "";
    }
    if (!FIELDS.some((field) => values[field])) continue;

    for (const field of YES_NO_FIELDS) values[field] = canonicalOption(values[field], YES_NO) ?? values[field];
    values.status = canonicalOption(values.status, STATUSES) ?? values.status;
    for (const field of DATE_FIELDS) {
      // Tolerate a time part, as in "2026-10-20 00:00:00"
      const day = values[field].slice(0, 10);
      if (isIsoDate(day)) values[field] = day;
    }

    for (const message of Object.values(validateValues(values, { requireCompany: false }))) {
      errors.push(`Rad ${line}: ${message}`);
    }
    imported.push(createApplication(values, now));
  }

  if (errors.length) {
    const details = errors.slice(0, MAX_LISTED_ERRORS);
    if (errors.length > MAX_LISTED_ERRORS) details.push(`…och ${errors.length - MAX_LISTED_ERRORS} fel till.`);
    throw new ExcelError("Importen avbröts, inga ansökningar lades till.", details);
  }
  if (!imported.length) throw new ExcelError("Filen innehåller inga rader att importera.");
  return imported;
}

async function loadTemplate() {
  try {
    const response = await fetch(TEMPLATE_URL);
    if (!response.ok) throw new Error(`Template returned ${response.status}.`);
    return await response.arrayBuffer();
  } catch {
    throw new ExcelError("Excel-mallen kunde inte hämtas. Försök igen.");
  }
}

/**
 * Builds a full copy of the söklogg template (all four sheets) with the applications written to the
 * Söklogg sheet, the dropdown lists restored and the Min status formulas covering every row.
 */
export async function exportWorkbook(applications, { ExcelJS, templateData } = {}) {
  ExcelJS ??= await loadExcelJs();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(templateData ?? (await loadTemplate()));
  const sheet = book.getWorksheet(SHEET_NAME);
  if (!sheet) throw new ExcelError(`Excel-mallen saknar fliken "${SHEET_NAME}".`);

  const column = {};
  for (const [field, header] of Object.entries(COLUMNS)) {
    for (let i = 1; i <= sheet.columnCount && !column[field]; i++) {
      if (cellText(sheet.getRow(1).getCell(i).value) === header) column[field] = i;
    }
  }

  const rows = sortApplications(applications).map(cleanValues);
  const lastRow = Math.max(TEMPLATE_ROWS, rows.length + 1);

  rows.forEach((values, i) => {
    const row = sheet.getRow(i + 2);
    for (const field of FIELDS) {
      const cell = row.getCell(column[field]);
      if (DATE_FIELDS.includes(field)) {
        cell.value = values[field] ? new Date(`${values[field]}T00:00:00Z`) : null;
        cell.numFmt = "yyyy-mm-dd";
      } else {
        cell.value = values[field] || null;
      }
    }
    row.commit();
  });

  const statusColumn = sheet.getColumn(column.status).letter;
  const listValidation = (range) => ({ type: "list", allowBlank: true, formulae: [range] });
  for (let r = 2; r <= lastRow; r++) {
    sheet.getCell(`${statusColumn}${r}`).dataValidation = listValidation("Listor!$A$1:$A$6");
    for (let c = column.responseReceived; c <= column.offered; c++) {
      sheet.getCell(r, c).dataValidation = listValidation("Listor!$B$1:$B$2");
    }
  }

  const summary = book.getWorksheet("Min status");
  const col = (field) => sheet.getColumn(column[field]).letter;
  if (summary) {
    summary.getCell("B3").value = { formula: `COUNTA(${SHEET_NAME}!${col("company")}2:${col("company")}${lastRow})` };
    summary.getCell("B4").value = { formula: `COUNTIF(${SHEET_NAME}!${col("interview")}2:${col("interview")}${lastRow},"Ja")` };
    summary.getCell("B5").value = { formula: `COUNTIF(${SHEET_NAME}!${col("offered")}2:${col("offered")}${lastRow},"Ja")` };
  }

  book.calcProperties.fullCalcOnLoad = true;
  return new Blob([await book.xlsx.writeBuffer()], { type: XLSX_MIME });
}
