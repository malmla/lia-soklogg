import { EXCLUDE_REJECTED_FILTER_VALUE } from "../model/filters.js";

/** Single-value filter controls opt in with data-filter="<field>". */
export function createFilterBar(
  root,
  { resetButton, info, onChange, onUse, onReset },
) {
  const selects = [...root.querySelectorAll("select[data-filter]")];
  const inputs = [...root.querySelectorAll("input[data-filter]")];
  const statuses = [...root.querySelectorAll('input[name="filter-status"]')];
  const presets = [...root.querySelectorAll("[data-status-preset]")];

  for (const select of selects) {
    select.addEventListener("change", () => {
      onChange(select.dataset.filter, select.value);
      onUse(select.dataset.filter, select.value);
    });
  }
  for (const input of inputs) {
    input.addEventListener("input", () => onChange(input.dataset.filter, input.value));
    input.addEventListener("change", () => onUse(input.dataset.filter));
  }
  for (const checkbox of statuses) {
    checkbox.addEventListener("change", () => {
      onChange("status", statuses.filter((item) => item.checked).map((item) => item.value));
      onUse("status", checkbox.value, checkbox.checked);
    });
  }
  for (const button of presets) {
    button.addEventListener("click", () => {
      const excludeRejected = button.dataset.statusPreset === EXCLUDE_REJECTED_FILTER_VALUE;
      const selected = statuses.filter((item) => !excludeRejected || item.value !== "Avslag");
      onChange("status", selected.map((item) => item.value));
      onUse("status", excludeRejected ? EXCLUDE_REJECTED_FILTER_VALUE : "");
    });
  }
  resetButton.addEventListener("click", onReset);

  return {
    update({ filters, filtering, shown, total }) {
      for (const select of selects) select.value = filters[select.dataset.filter] ?? "";
      for (const input of inputs) {
        const value = filters[input.dataset.filter] ?? "";
        if (input.value !== value) input.value = value;
      }
      for (const checkbox of statuses) checkbox.checked = filters.status.includes(checkbox.value);
      resetButton.hidden = !filtering;
      info.textContent = filtering ? `Visar ${shown} av ${total}` : "";
    },
  };
}
