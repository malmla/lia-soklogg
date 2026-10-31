import {
  cleanValues,
  createApplication,
  isIncomplete,
  validateValues,
} from "../model/application.js";
import { createFilters } from "../model/filters.js";
import { normalizeName } from "../utils/text.js";

/**
 * Single source of truth. Applications are treated as immutable: every change produces
 * new objects, persists, and notifies subscribers.
 */
export function createStore({ storage, now = () => new Date().toISOString(), onSaveError = () => {} }) {
  let state = { applications: [], filters: createFilters() };
  const listeners = new Set();

  function commit(patch, { persist = false } = {}) {
    state = { ...state, ...patch };
    let saved = { ok: true };
    if (persist) {
      saved = storage.save(state.applications);
      if (!saved.ok) onSaveError(saved.error);
    }
    listeners.forEach((listener) => listener(state));
    return saved;
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** (Re)loads applications from storage. Returns the storage problem, if any. */
    load() {
      const { items, problem } = storage.load();
      commit({ applications: items });
      return problem;
    },

    /** Validates and creates (no id) or updates (id) an application. */
    saveApplication(values, id = null) {
      const errors = validateValues(values, { requireCompany: true });
      if (Object.keys(errors).length) return { ok: false, errors };

      const t = now();
      const clean = cleanValues(values);
      const apps = state.applications;
      const current = id && apps.find((a) => a.id === id);
      if (id && !current) {
        return { ok: false, errors: { _form: "Företaget finns inte längre och kan inte uppdateras." } };
      }
      const companyKey = normalizeName(clean.company);
      if (apps.some((a) => a.id !== id && normalizeName(a.company) === companyKey)) {
        return {
          ok: false,
          errors: {
            company:
              "Företaget finns redan. Lägg till avdelning eller annan särskiljande information i företagsnamnet.",
          },
        };
      }
      const next = id
        ? apps.map((a) => (a.id === id ? { ...current, ...clean, updatedAt: t } : a))
        : [...apps, createApplication(clean, t)];
      const saved = commit({ applications: next }, { persist: true });
      return { ok: true, persisted: saved.ok };
    },

    remove(id) {
      commit({ applications: state.applications.filter((a) => a.id !== id) }, { persist: true });
    },

    /**
     * Adds new applications and applies each conflict as an update or a separately named entry.
     */
    applyImport(fresh, conflicts, choices) {
      const t = now();
      const updates = new Map();
      const imported = new Map(fresh.map((app) => [app.id, app]));
      const separate = [];
      conflicts.forEach(({ existing, row }, i) => {
        const choice = choices[i];
        const fields = cleanValues(row);
        if (choice.action === "new") {
          separate.push(createApplication({ ...row, company: choice.company }, t));
        } else if (choice.action === "update") {
          const base = updates.get(existing.id) ?? imported.get(existing.id) ?? existing;
          const updated = {
            ...base,
            ...fields,
            id: base.id,
            createdAt: base.createdAt,
            updatedAt: t,
          };
          if (updates.has(existing.id) || state.applications.some((app) => app.id === existing.id)) {
            updates.set(existing.id, updated);
          } else {
            imported.set(existing.id, updated);
          }
        } else {
          throw new Error("Importvalet saknas eller är ogiltigt.");
        }
      });

      const merged = [
        ...state.applications.map((a) => updates.get(a.id) ?? a),
        ...imported.values(),
        ...separate,
      ];
      const saved = commit({ applications: merged }, { persist: true });

      const touched = [...imported.values(), ...separate, ...updates.values()];
      return {
        added: imported.size + separate.length,
        updated: updates.size,
        incomplete: touched.filter(isIncomplete).length,
        persisted: saved.ok,
      };
    },

    setFilter(field, mode) {
      commit({ filters: { ...state.filters, [field]: mode } });
    },

    resetFilters() {
      commit({ filters: createFilters() });
    },
  };
}
