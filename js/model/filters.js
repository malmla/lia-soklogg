import { isFilled, normalizeName } from "../utils/text.js";
import { todayIso } from "../utils/date.js";

export const FILTER_FIELDS = ["company", "status", "interview", "offered", "followUp"];

export const createFilters = () => Object.fromEntries(FILTER_FIELDS.map((f) => [f, ""]));

export const isFiltering = (filters) => Object.values(filters).some(Boolean);

/**
 * Filters combine with AND. Company searches by substring; status, interview and offered
 * match the exact value; followUp is "overdue" (date before today) or "upcoming" (today or later).
 */
export function matchesFilters(app, filters, today = todayIso()) {
  for (const field of FILTER_FIELDS) {
    const mode = filters[field];
    if (!mode) continue;
    if (field === "company") {
      if (!normalizeName(app.company).includes(normalizeName(mode))) return false;
    } else if (field === "followUp") {
      if (!isFilled(app.followUpDate)) return false;
      if ((mode === "overdue") !== app.followUpDate < today) return false;
    } else if (app[field] !== mode) {
      return false;
    }
  }
  return true;
}
