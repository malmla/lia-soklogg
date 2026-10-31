import { h } from "../utils/dom.js";

const missing = (label) => h("span", { class: "missing" }, `${label} saknas`);

const actionButton = (text, action, label, extraClass = "") =>
  h("button", { type: "button", class: `btn small ${extraClass}`.trim(), "data-action": action, "aria-label": label }, text);

const isOverdue = (app, today) => Boolean(app.followUpDate) && app.followUpDate < today;

/** Everything that affects how a card looks; used to skip rebuilding unchanged cards. */
export function cardSignature({ app, today }) {
  return JSON.stringify([
    app.date, app.company, app.city, app.contactPerson, app.title, app.email, app.phone, app.method,
    app.status, app.responseReceived, app.interview, app.offered, app.comment, app.nextStep,
    app.followUpDate, app.notes, isOverdue(app, today),
  ]);
}

/** Finds web links in notes while leaving surrounding text and punctuation intact. */
export function findHttpUrls(value) {
  const links = [];
  for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let url = match[0];
    while (/[.,!?;:]$/.test(url)) url = url.slice(0, -1);
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      const count = (character) => [...url].filter((part) => part === character).length;
      while (url.endsWith(close) && count(close) > count(open)) {
        url = url.slice(0, -1);
      }
    }

    const start = match.index;
    if (!url || start === undefined) continue;
    try {
      const parsed = new URL(url);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname) {
        links.push({ start, end: start + url.length, url });
      }
    } catch {
      // Ignore malformed URL-like text.
    }
  }
  return links;
}

function noteContent(value) {
  const links = findHttpUrls(value);
  if (!links.length) return [value];

  const content = [];
  let cursor = 0;
  for (const link of links) {
    if (link.start > cursor) content.push(value.slice(cursor, link.start));
    content.push(
      h("a", { href: link.url, target: "_blank", rel: "noopener noreferrer" }, link.url),
    );
    cursor = link.end;
  }
  if (cursor < value.length) content.push(value.slice(cursor));
  return content;
}

export function createCard({ app, today }) {
  const name = app.company || "företag utan namn";

  const date = h(
    "div",
    { class: "date-badge" },
    h("span", { class: "date-label" }, "Datum"),
    h("span", { class: "date-value" }, app.date || "–"),
  );

  const heading = h(
    "h3",
    {},
    app.company || missing("Företag"),
    app.city && h("span", { class: "city" }, ` · ${app.city}`),
    app.status && h("span", { class: "status-badge", dataset: { status: app.status } }, app.status),
  );

  const meta = h(
    "div",
    { class: "meta" },
    app.contactPerson && h("span", {}, `👤 ${app.contactPerson}${app.title ? `, ${app.title}` : ""}`),
    !app.contactPerson && app.title && h("span", {}, app.title),
    app.email && h("a", { href: `mailto:${app.email}` }, app.email),
    app.phone && h("a", { href: `tel:${app.phone.replace(/[^\d+]/g, "")}` }, app.phone),
    app.method && h("span", {}, `Kontakt: ${app.method}`),
  );

  const answers = [
    ["Svar mottaget", app.responseReceived],
    ["Intervju", app.interview],
    ["LIA-plats erbjuden", app.offered],
  ].filter(([, value]) => value);
  const progress = answers.length
    ? h(
        "div",
        { class: "meta" },
        ...answers.map(([label, value]) => h("span", { class: value === "Ja" ? "yes" : "no" }, `${label}: ${value}`)),
      )
    : null;

  const followUp = app.followUpDate
    ? h(
        "p",
        { class: isOverdue(app, today) ? "text overdue" : "text" },
        h("strong", {}, "Uppföljning"),
        isOverdue(app, today) ? `${app.followUpDate} (försenad)` : app.followUpDate,
      )
    : null;

  const texts = [
    ["Nästa steg", app.nextStep],
    ["Kommentar", app.comment],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => h("p", { class: "text" }, h("strong", {}, label), value));
  const notes = app.notes
    ? h("p", { class: "text" }, h("strong", {}, "Notes"), ...noteContent(app.notes))
    : null;

  const actions = h(
    "div",
    { class: "actions" },
    actionButton("Redigera", "edit", `Redigera ${name}`),
    actionButton("Ta bort", "delete", `Ta bort ${name}`, "danger"),
  );

  return h(
    "li",
    { class: "item", dataset: { id: app.id, name } },
    date,
    h("div", { class: "item-body" }, heading, meta, progress, followUp, ...texts, notes, actions),
  );
}
