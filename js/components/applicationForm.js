import { FIELDS } from "../model/application.js";
import { todayIso } from "../utils/date.js";
import { prefersReducedMotion } from "../utils/dom.js";

/**
 * Create/edit form. Validation lives in the store; the form only reads values,
 * shows the errors it is given and manages create vs. edit mode.
 */
export function createApplicationForm({ form, title, submitButton, cancelButton, summary, onSubmit }) {
  let editingId = null;
  const field = (name) => form.elements.namedItem(name);
  const errorEl = (name) => form.querySelector(`[data-error-for="${name}"]`);

  function clearErrors() {
    summary.hidden = true;
    summary.textContent = "";
    for (const name of FIELDS) {
      field(name).removeAttribute("aria-invalid");
      const el = errorEl(name);
      el.hidden = true;
      el.textContent = "";
    }
  }

  function showErrors(errors) {
    clearErrors();
    let first = null;
    for (const [name, message] of Object.entries(errors)) {
      const input = field(name);
      if (!input) continue;
      input.setAttribute("aria-invalid", "true");
      const el = errorEl(name);
      el.textContent = message;
      el.hidden = false;
      first ??= input;
    }
    summary.textContent = errors._form ?? "Rätta de markerade fälten och försök igen.";
    summary.hidden = false;
    first?.focus();
  }

  function setMode(editing) {
    title.textContent = editing ? "Redigera företag" : "Nytt företag";
    submitButton.textContent = editing ? "Uppdatera ansökan" : "Spara ansökan";
    cancelButton.hidden = !editing;
  }

  function reset() {
    editingId = null;
    form.reset();
    field("date").value = todayIso();
    clearErrors();
    setMode(false);
  }

  function edit(app) {
    clearErrors();
    editingId = app.id;
    for (const name of FIELDS) field(name).value = app[name] ?? "";
    setMode(true);
    form.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    field("company").focus({ preventScroll: true });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const values = Object.fromEntries(FIELDS.map((name) => [name, field(name).value]));
    const result = onSubmit(values, editingId);
    if (result.ok) reset();
    else showErrors(result.errors);
  });

  form.addEventListener("input", (e) => {
    const name = e.target.name;
    if (!name || !e.target.hasAttribute("aria-invalid")) return;
    e.target.removeAttribute("aria-invalid");
    const el = errorEl(name);
    if (el) el.hidden = true;
  });

  cancelButton.addEventListener("click", reset);
  reset();

  return { edit, reset, getEditingId: () => editingId };
}
