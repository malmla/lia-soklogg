const collator = new Intl.Collator("sv");

/** Newest contact date first; entries without a date go last. */
export function compareApplications(a, b) {
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  }
  return collator.compare(a.company, b.company);
}

export const sortApplications = (apps) => [...apps].sort(compareApplications);
