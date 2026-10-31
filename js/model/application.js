import { newId } from "../utils/id.js";
import { isFilled, isValidEmail } from "../utils/text.js";

export const FIELDS = [
  "date",
  "company",
  "city",
  "contactPerson",
  "title",
  "email",
  "phone",
  "method",
  "status",
  "responseReceived",
  "interview",
  "offered",
  "comment",
  "nextStep",
  "followUpDate",
  "notes",
];
export const REQUIRED_FIELDS = ["company"];

export const STATUSES = [
  "Ej kontaktat",
  "Ansökan skickad",
  "Kontakt etablerad",
  "Intervju bokad",
  "Avslag",
  "LIA-plats klar",
];
export const YES_NO = ["Ja", "Nej"];
export const DATE_FIELDS = ["date", "followUpDate"];
export const YES_NO_FIELDS = ["responseReceived", "interview", "offered"];

const text = (value) => String(value ?? "").trim();
const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Matches a value against an allowed list ignoring case; returns the canonical value or null. */
export function canonicalOption(value, options) {
  const wanted = text(value).toLocaleLowerCase("sv");
  return options.find((option) => option.toLocaleLowerCase("sv") === wanted) ?? null;
}

export function cleanValues(values) {
  const clean = {};
  for (const field of FIELDS) clean[field] = text(values[field]);
  return clean;
}

/** Returns a map of field -> message. Empty when the values are valid. */
export function validateValues(values, { requireCompany = true } = {}) {
  const errors = {};
  if (requireCompany && !isFilled(values.company)) errors.company = "Företag måste fyllas i.";
  if (isFilled(values.email) && !isValidEmail(text(values.email))) errors.email = "Ange en giltig e-postadress.";
  for (const field of DATE_FIELDS) {
    if (isFilled(values[field]) && !isIsoDate(text(values[field]))) {
      errors[field] = "Ange ett giltigt datum (ÅÅÅÅ-MM-DD).";
    }
  }
  if (isFilled(values.status) && !canonicalOption(values.status, STATUSES)) {
    errors.status = "Välj en status från listan.";
  }
  for (const field of YES_NO_FIELDS) {
    if (isFilled(values[field]) && !canonicalOption(values[field], YES_NO)) {
      errors[field] = "Välj Ja eller Nej.";
    }
  }
  return errors;
}

export function createApplication(values, now) {
  return { id: newId(), ...cleanValues(values), createdAt: now, updatedAt: now };
}

/** Coerces any stored record (including legacy ranked ones) to the current data model. */
export function normalizeApplication(raw, now) {
  const created = text(raw.createdAt) || now;
  const app = {
    id: UUID_V4.test(text(raw.id)) ? text(raw.id) : newId(),
    ...cleanValues({
      ...raw,
      contactPerson: raw.contactPerson ?? raw.contact,
      comment: raw.comment ?? raw.motivation,
    }),
    createdAt: created,
    updatedAt: text(raw.updatedAt) || created,
  };
  for (const field of DATE_FIELDS) if (!isIsoDate(app[field])) app[field] = "";
  app.status = canonicalOption(app.status, STATUSES) ?? "";
  for (const field of YES_NO_FIELDS) app[field] = canonicalOption(app[field], YES_NO) ?? "";
  return app;
}

export const isIncomplete = (app) => !isFilled(app.company) || !isFilled(app.date);
