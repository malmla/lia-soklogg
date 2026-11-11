import { isFilled, normalizeName } from "../utils/text.js";
import { todayIso } from "../utils/date.js";
import { STATUSES } from "./application.js";

export const FILTER_FIELDS = ["company", "status", "interview", "offered", "followUp"];
export const EMPTY_FILTER_VALUE = "[tom]";
export const EXCLUDE_REJECTED_FILTER_VALUE = "exclude-rejected";
export const STATUS_FILTER_VALUES = [EMPTY_FILTER_VALUE, ...STATUSES];

export const createFilters = () => ({
  ...Object.fromEntries(FILTER_FIELDS.map((f) => [f, ""])),
  status: [...STATUS_FILTER_VALUES],
});

const allStatusesSelected = (statuses) => STATUS_FILTER_VALUES.every((value) => statuses.includes(value));

export const isFiltering = (filters) =>
  !allStatusesSelected(filters.status) ||
  FILTER_FIELDS.some((field) => field !== "status" && Boolean(filters[field]));

/**
 * Filters combine with AND. Company searches by substring or the empty marker; status matches
 * any selected value; interview and offered match an exact value or the empty marker; followUp
 * supports date ranges and empty.
 */
export function matchesFilters(app, filters, today = todayIso()) {
  for (const field of FILTER_FIELDS) {
    const mode = filters[field];
    if (field === "status") {
      if (!allStatusesSelected(mode) &&
          !(isFilled(app.status)
            ? app.status !== EMPTY_FILTER_VALUE && mode.includes(app.status)
            : mode.includes(EMPTY_FILTER_VALUE))) {
        return false;
      }
      continue;
    }
    if (!mode) continue;
    if (field === "company") {
      if (mode === EMPTY_FILTER_VALUE) {
        if (isFilled(app.company)) return false;
      } else if (!normalizeName(app.company).includes(normalizeName(mode))) {
        return false;
      }
    } else if (field === "followUp") {
      if (mode === EMPTY_FILTER_VALUE) {
        if (isFilled(app.followUpDate)) return false;
      } else if (!isFilled(app.followUpDate) || ((mode === "overdue") !== app.followUpDate < today)) {
        return false;
      }
    } else if (mode === EMPTY_FILTER_VALUE ? isFilled(app[field]) : app[field] !== mode) {
      return false;
    }
  }
  return true;
}
