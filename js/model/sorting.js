const collator = new Intl.Collator("sv");

function compareField(a, b, field, direction) {
  const left = String(a[field] ?? "").trim();
  const right = String(b[field] ?? "").trim();
  if (!left || !right) {
    if (!left && !right) return 0;
    return left ? -1 : 1;
  }

  const comparison = field === "company"
    ? collator.compare(left, right)
    : left.localeCompare(right);
  return direction === "desc" ? -comparison : comparison;
}

/** Sorts the selected field, keeping empty values last in either direction. */
export function compareApplications(a, b, field = "date", direction = "desc") {
  const comparison = compareField(a, b, field, direction);
  if (comparison) return comparison;

  if (field === "date") return collator.compare(a.company ?? "", b.company ?? "");
  return compareField(a, b, "date", "desc") || collator.compare(a.company ?? "", b.company ?? "");
}

export const sortApplications = (apps, field = "date", direction = "desc") =>
  [...apps].sort((a, b) => compareApplications(a, b, field, direction));
