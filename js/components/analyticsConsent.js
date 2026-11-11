import { EMPTY_FILTER_VALUE, EXCLUDE_REJECTED_FILTER_VALUE } from "../model/filters.js";

const CONSENT_KEY = "lia-analytics-consent";
const GTM_ID = "GTM-K2Z8CDDC";
const TRACKED_FEATURES = new Set([
  "import",
  "export",
  "application_add",
  "application_edit",
  "application_delete",
  "filter_reset",
  "theme_toggle",
]);
const APPLICATION_FIELDS = new Set([
  "date", "company", "city", "contactPerson", "title", "email", "phone", "method", "status",
  "responseReceived", "interview", "offered", "comment", "nextStep", "followUpDate", "notes",
]);
const SAVE_TYPES = new Set(["add", "edit"]);
const FILTER_FIELDS = new Set(["company", "status", "interview", "offered", "followUp"]);
const FILTER_MODES = new Map([
  ["", "all"],
  [EMPTY_FILTER_VALUE, "empty"],
  ["Ja", "yes"],
  ["Nej", "no"],
  ["overdue", "overdue"],
  ["upcoming", "upcoming"],
  ["Ej kontaktat", "not_contacted"],
  ["Ansökan skickad", "application_sent"],
  ["Kontakt etablerad", "contact_established"],
  ["Intervju bokad", "interview_booked"],
  ["Avslag", "rejected"],
  [EXCLUDE_REJECTED_FILTER_VALUE, "exclude_rejected"],
  ["LIA-plats klar", "placement_secured"],
]);

function readConsent(onError) {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch (error) {
    onError(error, "read");
    return null;
  }
}

export function createAnalyticsConsent(toggle, dialog, { onError = () => {} } = {}) {
  const heading = dialog.querySelector("#analytics-consent-title");
  const acceptButton = dialog.querySelector("[data-analytics-accept]");
  const rejectButton = dialog.querySelector("[data-analytics-reject]");
  let enabled = false;
  let tagManagerStarted = false;
  let gtag = null;

  const syncToggle = () => {
    toggle.setAttribute("aria-checked", String(enabled));
  };

  const saveConsent = (value) => {
    try {
      localStorage.setItem(CONSENT_KEY, value);
      return true;
    } catch (error) {
      onError(error, "write");
      return false;
    }
  };

  const updateConsent = (allowed) => {
    if (!gtag) return;
    gtag("consent", "update", {
      analytics_storage: allowed ? "granted" : "denied",
    });
  };

  const loadTagManager = () => {
    if (tagManagerStarted) {
      updateConsent(true);
      return;
    }

    const dataLayer = (window.dataLayer = window.dataLayer || []);
    const originalPush = dataLayer.push.bind(dataLayer);
    dataLayer.push = (...items) => {
      for (const item of items) {
        console.log("[GTM dataLayer]", item.event ?? "(no event)", { ...item });
      }
      return originalPush(...items);
    };
    gtag = function () {
      dataLayer.push(arguments);
    };
    gtag("consent", "default", {
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    updateConsent(true);
    dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
    script.addEventListener("error", () => {
      tagManagerStarted = false;
      enabled = false;
      syncToggle();
      updateConsent(false);
      saveConsent("denied");
      onError(new Error("Google Tag Manager kunde inte laddas."), "load");
    });
    tagManagerStarted = true;
    document.head.append(script);
  };

  const setEnabled = (value) => {
    enabled = value;
    syncToggle();
    if (enabled) loadTagManager();
    else updateConsent(false);
  };

  const openDialog = () => {
    if (dialog.open) return;
    dialog.showModal();
    heading.focus();
  };

  acceptButton.addEventListener("click", () => {
    if (!saveConsent("granted")) {
      dialog.close();
      return;
    }
    setEnabled(true);
    dialog.close();
  });

  rejectButton.addEventListener("click", () => {
    saveConsent("denied");
    setEnabled(false);
    dialog.close();
  });

  toggle.addEventListener("click", () => {
    if (enabled) {
      saveConsent("denied");
      setEnabled(false);
    } else {
      openDialog();
    }
  });

  const consent = readConsent(onError);
  if (consent === "granted") setEnabled(true);
  else {
    setEnabled(false);
    if (consent === null) openDialog();
  }

  syncToggle();

  return {
    trackFeature(featureName) {
      if (!enabled || !TRACKED_FEATURES.has(featureName)) return;
      window.dataLayer.push({ event: "feature_used", feature_name: featureName });
    },
    /** Sends one event per field name (never the value) so field usage can be compared. */
    trackFields(fieldNames, saveType) {
      if (!enabled || !SAVE_TYPES.has(saveType)) return;
      for (const fieldName of fieldNames) {
        if (!APPLICATION_FIELDS.has(fieldName)) continue;
        window.dataLayer.push({
          event: "application_field_used",
          field_name: fieldName,
          save_type: saveType,
        });
      }
    },
    trackFilter(field, mode, selected) {
      if (!enabled || !FILTER_FIELDS.has(field)) return;

      if (mode === undefined && field !== "company") return;
      const filterMode = mode === undefined ? "text" : FILTER_MODES.get(mode);
      if (!filterMode) return;

      window.dataLayer.push({
        event: "filter_used",
        filter_field: field,
        filter_mode: filterMode,
        filter_selection: field === "status" && typeof selected === "boolean"
          ? (selected ? "selected" : "deselected")
          : null,
      });
    },
  };
}
