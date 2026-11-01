import { isFilled, normalizeName } from "../utils/text.js";
import { todayIso } from "../utils/date.js";

export const FILTER_FIELDS = ["company", "status", "interview", "offered", "followUp"];
export const EMPTY_FILTER_VALUE = "[tom]";

export const createFilters = () => Object.fromEntries(FILTER_FIELDS.map((f) => [f, ""]));

export const isFiltering = (filters) => Object.values(filters).some(Boolean);

/**
 * Filters combine with AND. Company searches by substring or the empty marker; status, interview
 * and offered match an exact value or the empty marker; followUp supports date ranges and empty.
 */
export function matchesFilters(app, filters, today = todayIso()) {
  for (const field of FILTER_FIELDS) {
    const mode = filters[field];
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
