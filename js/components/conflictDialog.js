import { h } from "../utils/dom.js";
import { normalizeName } from "../utils/text.js";

const FIELD_LABELS = {
  date: "Datum",
  city: "Ort",
  contactPerson: "Kontaktperson",
  title: "Titel",
  email: "E-post",
  phone: "Telefon",
  method: "Kontaktsätt",
  status: "Status",
  responseReceived: "Svar mottaget",
  interview: "Intervju",
  offered: "LIA-plats erbjuden",
  comment: "Kommentar",
  nextStep: "Nästa steg",
  followUpDate: "Uppföljning",
  notes: "Notes",
};

function describe(app) {
  const parts = Object.entries(FIELD_LABELS)
    .filter(([field]) => app[field] !== "" && app[field] !== null && app[field] !== undefined)
    .map(([field, label]) => `${label}: ${app[field]}`);
  return parts.length ? parts.join(" · ") : "Inga andra uppgifter";
}

/**
 * Modal that lets the user pick, per company that already exists, which version to keep.
 * `ask()` resolves to an array of "keep" | "excel" (one per conflict) or null when cancelled.
 */
export function createConflictDialog(dialog) {
  const list = dialog.querySelector("[data-conflict-list]");
  let resolve = null;
  let reservedNames = [];

  const finish = (value) => {
    const pending = resolve;
    resolve = null;
    pending?.(value);
  };
  const setAllToUpdate = () =>
    list.querySelectorAll('input[value="update"]').forEach((radio) => {
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    });

  dialog.querySelector("[data-conflict-all-update]").addEventListener("click", setAllToUpdate);
  dialog.querySelector("[data-conflict-cancel]").addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-conflict-confirm]").addEventListener("click", () => {
    const decisions = [];
    const usedNames = new Set(reservedNames.map(normalizeName).filter(Boolean));
    let invalid = false;

    [...list.querySelectorAll("fieldset")].forEach((fieldset, i) => {
      const selected = fieldset.querySelector(`input[name="conflict-${i}"]:checked`);
      const error = fieldset.querySelector("[data-conflict-error]");
      error.hidden = true;
      error.textContent = "";

      if (!selected) {
        error.textContent = "Välj om posten ska uppdateras eller läggas till separat.";
      } else if (selected.value === "new") {
        const company = fieldset.querySelector("[data-new-company]").value.trim();
        const key = normalizeName(company);
        if (!key || usedNames.has(key)) {
          error.textContent =
            "Ange ett unikt företagsnamn med avdelning eller annan särskiljande information.";
        } else {
          usedNames.add(key);
          decisions.push({ action: "new", company });
        }
      } else {
        decisions.push({ action: "update" });
      }

      if (error.textContent) {
        error.hidden = false;
        invalid = true;
      }
    });

    if (invalid) return;
    finish(decisions);
    dialog.close();
  });
  // Escape or backdrop close counts as cancel
  dialog.addEventListener("close", () => finish(null));

  return {
    ask(conflicts, namesInUse = []) {
      reservedNames = namesInUse;
      list.replaceChildren(
        ...conflicts.map(({ existing, row }, i) => {
          const update = h("input", {
            type: "radio",
            name: `conflict-${i}`,
            value: "update",
          });
          const createNew = h("input", {
            type: "radio",
            name: `conflict-${i}`,
            value: "new",
          });
          const newCompany = h("input", {
            type: "text",
            value: row.company,
            placeholder: `${row.company} - avdelning`,
            disabled: true,
            "data-new-company": "",
            "aria-label": `Företagsnamn för en ny post för ${row.company}`,
          });
          update.addEventListener("change", () => {
            newCompany.disabled = true;
          });
          createNew.addEventListener("change", () => {
            newCompany.disabled = false;
            newCompany.focus();
            newCompany.setSelectionRange(newCompany.value.length, newCompany.value.length);
          });
          newCompany.addEventListener("input", () => {
            createNew.checked = true;
            newCompany.disabled = false;
          });

          return h(
            "fieldset",
            { class: "conflict" },
            h("legend", {}, existing.company),
            h(
              "label",
              { class: "choice" },
              update,
              h("span", {}, h("strong", {}, "Uppdatera befintlig post"), h("small", {}, describe(row))),
            ),
            h(
              "label",
              { class: "choice" },
              createNew,
              h("span", {}, h("strong", {}, "Skapa en separat post")),
            ),
            h(
              "label",
              { class: "choice-name" },
              "Nytt företagsnamn",
              newCompany,
            ),
            h("p", { class: "field-error", hidden: true, "data-conflict-error": "" }),
          );
        }),
      );
      return new Promise((res) => {
        resolve = res;
        dialog.showModal();
        list.querySelector("input")?.focus();
      });
    },
  };
}
