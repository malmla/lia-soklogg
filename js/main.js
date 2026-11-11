import { createAnnouncer, createStatus } from "./components/feedback.js";
import { createAnalyticsConsent } from "./components/analyticsConsent.js";
import { createApplicationForm } from "./components/applicationForm.js";
import { createApplicationList } from "./components/applicationList.js";
import { createConflictDialog } from "./components/conflictDialog.js";
import { createDashboard } from "./components/dashboard.js";
import { createFilterBar } from "./components/filterBar.js";
import { createThemeToggle } from "./components/themeToggle.js";
import { isFiltering, matchesFilters } from "./model/filters.js";
import { planImport } from "./model/importPlan.js";
import { FIELDS } from "./model/application.js";
import { sortApplications } from "./model/sorting.js";
import {
  exportWorkbook,
  ExcelError,
  importWorkbook,
} from "./services/excel.js";
import { createStorage } from "./services/storage.js";
import { createStore } from "./state/store.js";
import { todayIso } from "./utils/date.js";
import { downloadBlob, writeBlobToFile } from "./utils/download.js";
import { must } from "./utils/dom.js";

const STORAGE_KEY = "lia-applications";
const EXPORT_REMINDER_KEY = "lia-export-reminder";
const EXPORT_FILENAME_KEY = "lia-export-filename";
const REPOSITORY_API_URL = "https://api.github.com/repos/malmla/lia-soklogg";

async function updateVersionTracker(element) {
  try {
    const response = await fetch(REPOSITORY_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-cache",
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}.`);

    const { pushed_at: pushedAt } = await response.json();
    if (typeof pushedAt !== "string") {
      throw new Error("GitHub API returned an invalid push date.");
    }
    const timestamp = Date.parse(pushedAt);
    if (!Number.isFinite(timestamp)) {
      throw new Error("GitHub API returned an invalid push date.");
    }

    const formatted = new Intl.DateTimeFormat("sv-SE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(timestamp);
    element.textContent = `Senaste push: ${formatted}`;
  } catch (error) {
    console.error("Kunde inte hämta senaste push från GitHub.", error);
    element.textContent = "Senaste push: kunde inte hämtas";
  }
}

export function startApp() {
  updateVersionTracker(must("version-tracker"));
  const status = createStatus(must("app-status"));
  const announce = createAnnouncer(must("announcer"));

  const store = createStore({
    storage: createStorage(STORAGE_KEY),
    onSaveError: () =>
      status.show(
        [
          "Ändringen kunde inte sparas i webbläsaren (lagringen är full eller blockerad). Exportera till Excel för att inte förlora data.",
        ],
        "error",
      ),
  });

  const analytics = createAnalyticsConsent(
    must("analytics-toggle"),
    must("analytics-consent-dialog"),
    {
      onError(error, cause) {
        console.error(error);
        status.show(
          [
            cause === "load"
              ? "Google Tag Manager kunde inte laddas. Analys är avstängd."
              : cause === "read"
                ? "Analysinställningen kunde inte läsas. Analys är avstängd."
                : "Analysinställningen kunde inte sparas. Analys är avstängd.",
          ],
          "error",
        );
      },
    },
  );
  createThemeToggle(must("theme-toggle"), {
    onError: () =>
      status.show(["Temainställningen kunde inte sparas lokalt."], "error"),
    onToggle: () => analytics.trackFeature("theme_toggle"),
  });
  const dashboard = createDashboard(must("dashboard"));

  const form = createApplicationForm({
    form: must("application-form"),
    title: must("form-title"),
    submitButton: must("submit-btn"),
    cancelButton: must("cancel-btn"),
    summary: must("form-error"),
    onSubmit(values, id) {
      const before = id && store.getState().applications.find((a) => a.id === id);
      const result = store.saveApplication(values, id);
      if (result.ok) {
        analytics.trackFeature(id ? "application_edit" : "application_add");
        // Adding counts filled fields (the date defaults to today, so it is skipped); editing counts changed ones
        const used = FIELDS.filter((name) => {
          const value = String(values[name] ?? "").trim();
          return before ? value !== (before[name] ?? "") : value && name !== "date";
        });
        analytics.trackFields(used, id ? "edit" : "add");
        announce(id ? "Ansökan uppdaterad." : "Ansökan sparad.");
      }
      return result;
    },
  });

  const filterBar = createFilterBar(must("filters"), {
    resetButton: must("filter-reset"),
    info: must("filter-info"),
    onChange: (field, mode) => store.setFilter(field, mode),
    // Track filter usage without sending free-text filter contents.
    onUse: (field, mode) => analytics.trackFilter(field, mode),
    onReset: () => {
      store.resetFilters();
      analytics.trackFeature("filter_reset");
    },
  });

  const list = createApplicationList(must("list"), {
    emptyEl: must("empty"),
    onEdit(id) {
      const app = store.getState().applications.find((a) => a.id === id);
      if (app) form.edit(app);
    },
    onDelete(id) {
      const app = store.getState().applications.find((a) => a.id === id);
      if (!app || !window.confirm(`Ta bort ${app.company || "företaget"}?`))
        return;
      store.remove(id);
      analytics.trackFeature("application_delete");
      if (form.getEditingId() === id) form.reset();
      announce("Ansökan borttagen.");
      must("list-heading").focus();
    },
  });

  const count = must("count");
  const sortField = must("sort-field");
  const sortDirection = must("sort-direction");
  const listElement = must("list");

  function render({ applications, filters }) {
    const total = applications.length;
    const filtering = isFiltering(filters);
    const today = todayIso();

    const visible = sortApplications(applications, sortField.value, sortDirection.value)
      .filter((app) => matchesFilters(app, filters, today))
      .map((app) => ({ app, today }));

    count.textContent = total;
    listElement.setAttribute(
      "aria-label",
      `Söklogg, sorterad efter ${sortField.selectedOptions[0].textContent.toLowerCase()}, ${
        sortDirection.value === "asc" ? "stigande" : "fallande"
      }`,
    );
    dashboard.update(applications, today);
    filterBar.update({ filters, filtering, shown: visible.length, total });
    list.update(visible, { total, filtering });
  }

  sortField.addEventListener("change", () => render(store.getState()));
  sortDirection.addEventListener("change", () => render(store.getState()));

  store.subscribe(render);

  const problem = store.load();
  if (problem === "corrupt") {
    status.show(
      [
        "Sparad data kunde inte läsas och en säkerhetskopia har sparats i webbläsaren. Listan startade tom.",
      ],
      "error",
    );
  } else if (problem === "corrupt-backup-failed") {
    status.show(
      [
        "Sparad data kunde inte läsas och säkerhetskopian kunde inte sparas. Listan startade tom.",
      ],
      "error",
    );
  } else if (problem === "migration-save-failed") {
    status.show(
      [
        "Befintliga ansökningar kunde läsas, men uppdateringen av det lokala lagringsformatet kunde inte sparas.",
      ],
      "error",
    );
  } else if (problem === "unavailable") {
    status.show(
      [
        "LocalStorage är inte tillgängligt. Ändringar sparas inte när du lämnar sidan.",
      ],
      "error",
    );
  }

  const importButton = must("import-btn");
  const exportButton = must("export-btn");
  const exportReminder = must("export-reminder");
  const fileInput = must("import-file");
  const conflictDialog = createConflictDialog(must("conflict-dialog"));
  let importedFilename = "";
  try {
    exportReminder.checked = localStorage.getItem(EXPORT_REMINDER_KEY) !== "false";
  } catch (error) {
    console.error(error);
    status.show(["Påminnelseinställningen kunde inte läsas från webbläsaren."], "error");
  }
  try {
    importedFilename = localStorage.getItem(EXPORT_FILENAME_KEY) ?? "";
  } catch (error) {
    console.error(error);
    status.show(["Det importerade filnamnet kunde inte läsas från webbläsaren."], "error");
  }
  function rememberImportedFilename(filename) {
    importedFilename = filename;
    try {
      localStorage.setItem(EXPORT_FILENAME_KEY, filename);
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  exportReminder.addEventListener("change", () => {
    try {
      localStorage.setItem(EXPORT_REMINDER_KEY, String(exportReminder.checked));
    } catch (error) {
      console.error(error);
      status.show(["Påminnelseinställningen kunde inte sparas i webbläsaren."], "error");
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!exportReminder.checked || !store.getState().applications.length) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const excelPickerOptions = {
    id: "lia-excel",
    types: [
      {
        description: "Excel",
        accept: {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
            ".xlsx",
          ],
        },
      },
    ],
  };

  const busy = (button, on) => {
    button.disabled = on;
    button.setAttribute("aria-busy", String(on));
  };

  async function importFile(file) {
    busy(importButton, true);
    try {
      const imported = await importWorkbook(file);
      analytics.trackFeature("import");
      const { fresh, conflicts, unchanged } = planImport(
        store.getState().applications,
        imported,
      );

      if (!fresh.length && !conflicts.length) {
        const filenameSaved = rememberImportedFilename(file.name);
        status.show(
          [
            `${unchanged.length} ansökningar var redan identiska. Inga ändringar gjordes.`,
            !filenameSaved &&
              "Det importerade filnamnet kunde inte sparas för framtida exporter.",
          ].filter(Boolean),
          filenameSaved ? "success" : "error",
        );
        return;
      }

      let choices = [];
      if (conflicts.length) {
        const namesInUse = [
          ...store.getState().applications.map((app) => app.company),
          ...fresh.map((app) => app.company),
        ];
        choices = await conflictDialog.ask(conflicts, namesInUse);
        if (!choices) {
          status.show(["Importen avbröts. Inga ändringar gjordes."]);
          return;
        }
      }
      const result = store.applyImport(fresh, conflicts, choices);
      if (!result.persisted) return;
      if (!result.persisted) return;
      const filenameSaved = rememberImportedFilename(file.name);
      const messages = [
        `${result.added} nya ansökningar importerades.`,
        result.updated &&
          `${result.updated} befintliga ansökningar uppdaterades från Excel.`,
        unchanged.length &&
          `${unchanged.length} identiska ansökningar lämnades oförändrade.`,
        result.incomplete &&
          `${result.incomplete} saknar företagsnamn eller datum.`,
        !filenameSaved &&
          "Det importerade filnamnet kunde inte sparas för framtida exporter.",
      ].filter(Boolean);
      status.show(messages, filenameSaved ? "success" : "error");
    } catch (error) {
      if (error instanceof ExcelError)
        status.show([error.message, ...error.details], "error");
      else {
        console.error(error);
        status.show(["Importen misslyckades oväntat. Försök igen."], "error");
      }
    } finally {
      busy(importButton, false);
    }
  }

  importButton.addEventListener("click", async () => {
    if (typeof window.showOpenFilePicker !== "function") {
      fileInput.click();
      return;
    }

    busy(importButton, true);
    try {
      const [handle] = await window.showOpenFilePicker({
        ...excelPickerOptions,
        multiple: false,
      });
      await importFile(await handle.getFile());
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error(error);
        status.show(["Importen kunde inte öppnas. Försök igen."], "error");
      }
    } finally {
      busy(importButton, false);
    }
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) await importFile(file);
  });

  exportButton.addEventListener("click", async () => {
    const { applications } = store.getState();
    if (!applications.length) {
      status.show(["Det finns inga ansökningar att exportera."], "error");
      return;
    }
    busy(exportButton, true);
    try {
      const now = new Date();
      const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
      ].join("-");
      const hasSaveFilePicker = typeof window.showSaveFilePicker === "function";
      const defaultFilename = `lia-soklogg-${timestamp}.xlsx`;
      const filename = hasSaveFilePicker
        ? importedFilename.replace(/\.xlsx?$/i, ".xlsx") || defaultFilename
        : defaultFilename;
      const fileHandle =
        hasSaveFilePicker
          ? await window.showSaveFilePicker({
              ...excelPickerOptions,
              suggestedName: filename,
            })
          : null;
      const workbook = await exportWorkbook(applications);
      if (fileHandle) await writeBlobToFile(fileHandle, workbook);
      else downloadBlob(workbook, filename);
      analytics.trackFeature("export");
      status.clear();
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error(error);
      status.show(
        [
          error instanceof ExcelError
            ? error.message
            : "Exporten misslyckades. Försök igen.",
        ],
        "error",
      );
    } finally {
      busy(exportButton, false);
    }
  });
}
