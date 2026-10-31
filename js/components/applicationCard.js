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

/** Notes often hold a link (for example a LinkedIn profile); only http(s) links are made clickable. */
function noteContent(value) {
  return /^https?:\/\/\S+$/i.test(value)
    ? h("a", { href: value, target: "_blank", rel: "noopener noreferrer" }, value)
    : value;
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
  const notes = app.notes ? h("p", { class: "text" }, h("strong", {}, "Notes"), noteContent(app.notes)) : null;

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
