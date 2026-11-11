import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { isIncomplete, STATUSES, validateValues } from "../js/model/application.js";
import { createFilters, EMPTY_FILTER_VALUE, EXCLUDE_REJECTED_FILTER_VALUE, isFiltering, matchesFilters } from "../js/model/filters.js";
import { planImport } from "../js/model/importPlan.js";
import { sortApplications } from "../js/model/sorting.js";
import { getDashboardMetrics, nextMilestone } from "../js/components/dashboard.js";
import { findHttpUrls } from "../js/components/applicationCard.js";
import { createFilterBar } from "../js/components/filterBar.js";
import { exportWorkbook, ExcelError, importWorkbook } from "../js/services/excel.js";
import { createStorage } from "../js/services/storage.js";
import { createStore } from "../js/state/store.js";

function memoryBackend(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    data,
  };
}

function createTestStore() {
  let tick = 0;
  const storage = createStorage("test", memoryBackend());
  return createStore({
    storage,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  });
}

const blank = {
  date: "", company: "", city: "", contactPerson: "", title: "", email: "", phone: "", method: "",
  status: "", responseReceived: "", interview: "", offered: "", comment: "", nextStep: "",
  followUpDate: "", notes: "",
};

test("page element IDs are unique and app feedback has a distinct target from application status", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length, "HTML element IDs must be unique");
  assert.match(html, /<select id="status" name="status"/);
  assert.match(html, /<div id="app-status" class="status"/);
  assert.match(html, /<details class="filter-panel">/);
  for (const id of ["filter-interview", "filter-offered", "filter-followup"]) {
    const select = html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))?.[0] ?? "";
    assert.match(select, /<option value="\[tom\]">\[tom\]<\/option>/, `${id} must offer [tom]`);
  }
  const statusFilter = html.match(/<fieldset class="status-filter">[\s\S]*?<\/fieldset>/)?.[0] ?? "";
  const statusValues = [...statusFilter.matchAll(/name="filter-status" value="([^"]+)" checked/g)].map((match) => match[1]);
  assert.deepEqual(statusValues, [EMPTY_FILTER_VALUE, ...STATUSES]);
  assert.ok(statusFilter.includes(`data-status-preset="${EXCLUDE_REJECTED_FILTER_VALUE}"`));
  assert.match(html, /placeholder="Sök företagsnamn eller \[tom\]"/);
});

test("URLs in notes are detected without trailing punctuation or unsafe schemes", () => {
  const text = "LinkedIn: https://example.com/profile, portfolio (https://example.org/work). javascript:alert(1)";
  assert.deepEqual(findHttpUrls(text), [
    { start: 10, end: 37, url: "https://example.com/profile" },
    { start: 50, end: 74, url: "https://example.org/work" },
  ]);
});

test("legacy ranked records are normalized into the söklogg model", () => {
  const backend = memoryBackend({
    applications: JSON.stringify([
      { id: "legacy-id", rank: 3, company: "IKEA", contact: "Anna", motivation: "Bra match", notes: "Länk" },
    ]),
  });
  const { items, problem } = createStorage("applications", backend).load();
  assert.equal(problem, undefined);
  assert.equal(items[0].contactPerson, "Anna");
  assert.equal(items[0].comment, "Bra match");
  assert.equal(items[0].notes, "Länk");
  assert.equal(items[0].date, "");
  assert.equal("rank" in items[0], false);
  assert.match(items[0].id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  assert.ok(items[0].createdAt);
  assert.equal(JSON.parse(backend.getItem("applications"))[0].comment, "Bra match");
});

test("corrupt storage is backed up and storage failures are reported", () => {
  const backend = memoryBackend({ apps: "{broken" });
  const corrupt = createStorage("apps", backend).load();
  assert.equal(corrupt.problem, "corrupt");
  assert.equal(backend.getItem("apps.backup"), "{broken");

  const failing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.equal(createStorage("apps", failing).save([]).ok, false);
  assert.equal(createStorage("apps", null).load().problem, "unavailable");
});

test("only company is required; dates, status, Ja/Nej and email are validated when provided", () => {
  assert.equal(Object.keys(validateValues({ company: "IKEA" })).length, 0);
  assert.ok(validateValues({ company: "" }).company);
  assert.ok(validateValues({ company: "IKEA", email: "not-an-email" }).email);
  assert.ok(validateValues({ company: "IKEA", date: "2026-02-30" }).date);
  assert.ok(validateValues({ company: "IKEA", followUpDate: "20/10/2026" }).followUpDate);
  assert.ok(validateValues({ company: "IKEA", status: "Okänd" }).status);
  assert.ok(validateValues({ company: "IKEA", interview: "Kanske" }).interview);
  assert.equal(
    Object.keys(
      validateValues({ company: "IKEA", date: "2026-10-20", status: "Avslag", interview: "Nej" }),
    ).length,
    0,
  );
  assert.equal(isIncomplete({ company: "IKEA", date: "" }), true);
  assert.equal(isIncomplete({ company: "IKEA", date: "2026-10-20" }), false);
});

test("applications sort by selected field and direction, with empty values last", () => {
  const apps = [
    { company: "B", date: "2026-10-20", followUpDate: "2026-11-02" },
    { company: "Ö", date: "" },
    { company: "A", date: "2026-10-20", followUpDate: "2026-10-30" },
    { company: "C", date: "2026-11-02", followUpDate: "" },
  ];
  assert.deepEqual(sortApplications(apps).map((app) => app.company), ["C", "A", "B", "Ö"]);
  assert.deepEqual(sortApplications(apps, "date", "asc").map((app) => app.company), ["A", "B", "C", "Ö"]);
  assert.deepEqual(
    sortApplications(apps, "followUpDate", "asc").map((app) => app.company),
    ["A", "B", "C", "Ö"],
  );
  assert.deepEqual(
    sortApplications(apps, "followUpDate", "desc").map((app) => app.company),
    ["B", "A", "C", "Ö"],
  );
  assert.deepEqual(sortApplications(apps, "company", "asc").map((app) => app.company), ["A", "B", "C", "Ö"]);
  assert.deepEqual(sortApplications(apps, "company", "desc").map((app) => app.company), ["Ö", "C", "B", "A"]);
});

test("store creates, edits and removes applications with timestamps", () => {
  const store = createTestStore();
  store.load();
  for (const company of ["IKEA", "Volvo", "Saab"]) {
    assert.equal(store.saveApplication({ company }).ok, true);
  }
  const [first] = store.getState().applications;
  const created = first.createdAt;

  assert.equal(store.saveApplication({ company: "IKEA AB", status: "Avslag" }, first.id).ok, true);
  const edited = store.getState().applications.find((app) => app.id === first.id);
  assert.equal(edited.createdAt, created);
  assert.equal(edited.status, "Avslag");
  assert.notEqual(edited.updatedAt, created);

  store.remove(first.id);
  assert.equal(store.getState().applications.length, 2);
});

test("company matching ignores case and whitespace; selected Excel conflicts preserve identity", () => {
  const store = createTestStore();
  store.load();
  store.saveApplication({ company: "IKEA", city: "Älmhult" });
  const existing = store.getState().applications[0];
  const imported = [
    { ...existing, id: "new-id", company: " ikea ", city: "Stockholm", createdAt: "excel-created", updatedAt: "excel-updated" },
    { ...existing, id: "identical-id", createdAt: "excel-created", updatedAt: "excel-updated" },
    { ...blank, id: "fresh-id", company: "Volvo", createdAt: "new", updatedAt: "new" },
  ];
  const { fresh, conflicts, unchanged } = planImport(store.getState().applications, imported);
  assert.equal(fresh.length, 1);
  assert.equal(conflicts.length, 1);
  assert.equal(unchanged.length, 1);
  const result = store.applyImport(fresh, conflicts, [{ action: "update" }]);
  assert.deepEqual([result.added, result.updated], [1, 1]);
  const ikea = store.getState().applications.find((app) => app.company === "ikea");
  assert.equal(ikea.id, existing.id);
  assert.equal(ikea.createdAt, existing.createdAt);
  assert.equal(ikea.city, "Stockholm");
});

test("import planning groups duplicate company rows and treats exact rows as unchanged", () => {
  const first = { ...blank, id: "first-id", company: "Acme", city: "Stockholm" };
  const second = { ...first, id: "second-id", city: "Göteborg" };
  const { fresh, conflicts, unchanged } = planImport([], [
    first,
    { ...first, id: "same-data-id", company: " ACME " },
    second,
  ]);
  assert.equal(fresh.length, 1);
  assert.equal(unchanged.length, 1);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].existing.id, first.id);
});

test("manual entries require a distinct company name for an existing company", () => {
  const store = createTestStore();
  store.load();
  store.saveApplication({ company: "Acme" });

  const duplicate = store.saveApplication({ company: " ACME " });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.company, /avdelning/i);
  assert.equal(store.saveApplication({ company: "Acme - Marknad" }).ok, true);
  assert.equal(store.getState().applications.length, 2);
});

test("import can create a separately named entry instead of updating an existing one", () => {
  const store = createTestStore();
  store.load();
  store.saveApplication({ company: "Acme", city: "Stockholm" });
  const existing = store.getState().applications[0];
  const row = { ...existing, id: "excel-id", company: "Acme", city: "Göteborg" };

  const result = store.applyImport([], [{ existing, row }], [
    { action: "new", company: "Acme - Göteborg" },
  ]);

  assert.equal(result.added, 1);
  assert.equal(result.updated, 0);
  assert.deepEqual(
    store.getState().applications.map(({ company, city }) => [company, city]),
    [["Acme", "Stockholm"], ["Acme - Göteborg", "Göteborg"]],
  );
});

test("filters combine with AND and follow-up filters compare against today", () => {
  const today = "2026-11-01";
  const filters = createFilters();
  filters.status = ["Ansökan skickad"];
  filters.interview = "Nej";
  const app = { company: "IKEA", status: "Ansökan skickad", interview: "Nej", offered: "", followUpDate: "" };
  assert.equal(matchesFilters(app, filters, today), true);
  assert.equal(matchesFilters({ ...app, interview: "Ja" }, filters, today), false);
  assert.equal(matchesFilters({ ...app, status: "Avslag" }, filters, today), false);

  const followUp = createFilters();
  followUp.followUp = "overdue";
  assert.equal(matchesFilters({ ...app, followUpDate: "2026-10-31" }, followUp, today), true);
  assert.equal(matchesFilters({ ...app, followUpDate: "2026-11-01" }, followUp, today), false);
  assert.equal(matchesFilters(app, followUp, today), false);
  followUp.followUp = "upcoming";
  assert.equal(matchesFilters({ ...app, followUpDate: "2026-11-01" }, followUp, today), true);
  assert.equal(matchesFilters(app, followUp, today), false);
});

test("status filter can exclude rejections while including all other and empty statuses", () => {
  const filters = createFilters();
  filters.status = filters.status.filter((status) => status !== "Avslag");
  for (const status of [...STATUSES, ""]) {
    assert.equal(matchesFilters({ status }, filters), status !== "Avslag", `status: ${status || "[tom]"}`);
  }
  assert.equal(matchesFilters({}, filters), true);

  filters.interview = "Ja";
  assert.equal(matchesFilters({ status: "Ansökan skickad", interview: "Ja" }, filters), true);
  assert.equal(matchesFilters({ status: "Ansökan skickad", interview: "Nej" }, filters), false);
  assert.equal(matchesFilters({ status: "Avslag", interview: "Ja" }, filters), false);
});

test("status filters support multiple selections, none, all and reset", () => {
  const store = createTestStore();
  const filters = store.getState().filters;
  assert.equal(isFiltering(filters), false);
  assert.equal(matchesFilters({ status: "Avslag" }, filters), true);

  store.setFilter("status", ["Ansökan skickad", EMPTY_FILTER_VALUE]);
  assert.equal(isFiltering(store.getState().filters), true);
  assert.equal(matchesFilters({ status: "Ansökan skickad" }, store.getState().filters), true);
  assert.equal(matchesFilters({ status: "" }, store.getState().filters), true);
  assert.equal(matchesFilters({ status: "Avslag" }, store.getState().filters), false);

  store.setFilter("status", []);
  assert.equal(isFiltering(store.getState().filters), true);
  assert.equal(matchesFilters({ status: "" }, store.getState().filters), false);
  assert.equal(matchesFilters({ status: "Avslag" }, store.getState().filters), false);
  store.resetFilters();
  assert.equal(isFiltering(store.getState().filters), false);
  assert.equal(matchesFilters({ status: "Avslag" }, store.getState().filters), true);
});

test("status checkbox controls and presets update filter state and reset", () => {
  class Control extends EventTarget {
    constructor(value = "") {
      super();
      this.value = value;
      this.checked = true;
      this.dataset = {};
    }
    click() { this.dispatchEvent(new Event("click")); }
  }
  const statuses = [EMPTY_FILTER_VALUE, ...STATUSES].map((value) => new Control(value));
  const all = new Control();
  all.dataset.statusPreset = "all";
  const exclude = new Control();
  exclude.dataset.statusPreset = EXCLUDE_REJECTED_FILTER_VALUE;
  const reset = new Control();
  const info = {};
  const root = {
    querySelectorAll(selector) {
      if (selector === 'input[name="filter-status"]') return statuses;
      if (selector === "[data-status-preset]") return [all, exclude];
      return [];
    },
  };
  const store = createTestStore();
  const events = [];
  const bar = createFilterBar(root, {
    resetButton: reset,
    info,
    onChange: (field, value) => store.setFilter(field, value),
    onUse: (field, value) => events.push([field, value]),
    onReset: () => store.resetFilters(),
  });
  const render = () => bar.update({ filters: store.getState().filters, filtering: isFiltering(store.getState().filters), shown: 1, total: 2 });
  store.subscribe(render);
  render();
  assert.equal(reset.hidden, true);

  exclude.click();
  assert.equal(statuses.find((item) => item.value === "Avslag").checked, false);
  assert.equal(statuses.find((item) => item.value === EMPTY_FILTER_VALUE).checked, true);
  assert.equal(info.textContent, "Visar 1 av 2");
  assert.deepEqual(events.at(-1), ["status", EXCLUDE_REJECTED_FILTER_VALUE]);

  statuses[0].checked = false;
  statuses[0].dispatchEvent(new Event("change"));
  assert.equal(store.getState().filters.status.includes(EMPTY_FILTER_VALUE), false);
  all.click();
  assert.equal(reset.hidden, true);
  assert.ok(statuses.every((item) => item.checked));

  exclude.click();
  reset.click();
  assert.ok(statuses.every((item) => item.checked));
  assert.equal(reset.hidden, true);
});

test("filters can find missing values for every filterable field", () => {
  const missing = { company: "", status: "", interview: "", offered: "", followUpDate: "" };
  const populated = {
    company: "IKEA",
    status: "Ansökan skickad",
    interview: "Nej",
    offered: "Ja",
    followUpDate: "2026-11-02",
  };

  for (const [field, valueField] of [
    ["company", "company"],
    ["status", "status"],
    ["interview", "interview"],
    ["offered", "offered"],
    ["followUp", "followUpDate"],
  ]) {
    const filters = createFilters();
    filters[field] = field === "status" ? [EMPTY_FILTER_VALUE] : EMPTY_FILTER_VALUE;
    assert.equal(matchesFilters(missing, filters, "2026-11-01"), true, `${field} should match empty`);
    assert.equal(matchesFilters(populated, filters, "2026-11-01"), false, `${field} should reject filled`);
    assert.equal(
      matchesFilters({ ...missing, [valueField]: EMPTY_FILTER_VALUE }, filters, "2026-11-01"),
      false,
      `${field} should not treat the literal marker as empty`,
    );
  }
});

test("company filter matches case-insensitive substrings", () => {
  const filters = createFilters();
  filters.company = "kea";
  assert.equal(matchesFilters({ company: "IKEA" }, filters), true);
  assert.equal(matchesFilters({ company: "IKEA Sverige" }, filters), true);
  assert.equal(matchesFilters({ company: "Acme" }, filters), false);
});

test("dashboard reproduces the Min status counts and milestone goals", () => {
  const apps = Array.from({ length: 20 }, (_, i) => ({
    ...blank,
    company: `Företag ${i}`,
    followUpDate: i < 3 ? "2026-12-01" : "",
    interview: i === 0 ? "Ja" : "Nej",
    offered: i === 1 ? "Ja" : "",
    status: i === 2 ? "Kontakt etablerad" : "Ansökan skickad",
  }));
  assert.deepEqual(getDashboardMetrics(apps), {
    companies: { value: 20, target: 20, grade: "distinction" },
    followUps: { value: 3, target: 3, grade: "distinction" },
    dialogue: { value: 2, target: 1, grade: "distinction" },
    interviews: { value: 1, target: 1, grade: "distinction" },
    offers: { value: 1, target: 1, grade: "distinction" },
  });

  const few = getDashboardMetrics([
    { ...blank, company: "A", status: "Ansökan skickad" },
    { ...blank, company: "B", status: "Ej kontaktat" },
    { ...blank, company: "C", status: "" },
    { ...blank, company: "", status: "Avslag" },
  ]);
  assert.deepEqual(few.companies, { value: 1, target: 10, grade: "below" });
  assert.deepEqual(few.dialogue, { value: 0, target: 1, grade: "below" });
  assert.equal(getDashboardMetrics(apps.slice(0, 10)).companies.grade, "pass");
});

test("next milestone is the first deadline that is today or later", () => {
  assert.deepEqual(nextMilestone("2026-10-31"), {
    date: "2026-12-31",
    name: "Minst 10 företag kontaktade",
    daysLeft: 61,
  });
  assert.equal(nextMilestone("2026-12-31").daysLeft, 0);
  assert.equal(nextMilestone("2027-12-01"), null);
});

test("store supports at least 250 records", () => {
  const store = createTestStore();
  store.load();
  for (let i = 0; i < 250; i++) store.saveApplication({ company: `Företag ${i}` });
  assert.equal(store.getState().applications.length, 250);
});

const templateData = async () => {
  const buffer = await readFile(new URL("../assets/lia-soklogg-mall.xlsx", import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

async function asFile(blob) {
  return { size: blob.size, arrayBuffer: () => blob.arrayBuffer() };
}

test("export makes a full copy of the template and the result imports back unchanged", async () => {
  const store = createTestStore();
  store.load();
  store.saveApplication({
    date: "2026-10-20", company: "itm8", city: "malmö, hbg, gbg", contactPerson: "Emma Humble",
    title: "Talent Acquisition Partner", email: "emhum@itm8.com", phone: "070 123 45 67",
    method: "formulär", status: "Ansökan skickad", responseReceived: "Nej", interview: "Nej",
    offered: "Nej", comment: "Skickade CV", nextStep: "Följ upp", followUpDate: "2026-11-03",
    notes: "https://join.itm8.se/people/1",
  });
  store.saveApplication({ date: "2026-10-21", company: "Handelsbanken", status: "Intervju bokad", interview: "Ja" });

  const blob = await exportWorkbook([...store.getState().applications].reverse(), {
    ExcelJS,
    templateData: await templateData(),
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await blob.arrayBuffer());
  assert.deepEqual(book.worksheets.map((sheet) => sheet.name), ["Instruktioner", "Söklogg", "Min status", "Listor"]);

  const sheet = book.getWorksheet("Söklogg");
  assert.equal(sheet.getCell("B2").value, "itm8");
  assert.equal(sheet.getCell("A2").value.toISOString().slice(0, 10), "2026-10-20");
  assert.equal(sheet.getCell("B3").value, "Handelsbanken");
  assert.equal(sheet.getCell("A3").value.toISOString().slice(0, 10), "2026-10-21");
  assert.equal(sheet.getCell("A3").numFmt, "yyyy-mm-dd");
  assert.equal(sheet.getCell("I3").dataValidation.formulae[0], "Listor!$A$1:$A$6");
  assert.equal(sheet.getCell("K200").dataValidation.formulae[0], "Listor!$B$1:$B$2");
  assert.equal(book.getWorksheet("Min status").getCell("B3").value.formula, "COUNTA(Söklogg!B2:B201)");
  assert.equal(book.getWorksheet("Listor").getCell("A6").value, "LIA-plats klar");
  assert.equal(book.getWorksheet("Instruktioner").getCell("A1").value, "LIA-söklogg för studerande");

  const imported = await importWorkbook(await asFile(blob), "now", { ExcelJS });
  const original = store.getState().applications;
  assert.equal(imported.length, 2);
  const { unchanged, fresh, conflicts } = planImport(original, imported);
  assert.deepEqual([unchanged.length, fresh.length, conflicts.length], [2, 0, 0]);
});

test("export formulas cover more rows than the template holds", async () => {
  const apps = Array.from({ length: 250 }, (_, i) => ({ ...blank, id: `id-${i}`, company: `Företag ${i}` }));
  const blob = await exportWorkbook(apps, { ExcelJS, templateData: await templateData() });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await blob.arrayBuffer());
  assert.equal(book.getWorksheet("Min status").getCell("B3").value.formula, "COUNTA(Söklogg!B2:B251)");
  assert.equal(book.getWorksheet("Söklogg").getCell("B251").value, "Företag 99");
});

test("imports a bransch-tracker export and maps fields to the LIA log", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Ansökningar");
  sheet.addRow([
    "Rangordning",
    "Företag",
    "Ort",
    "Kontaktperson",
    "E-post",
    "Telefonnummer",
    "Kort presentation av företaget samt motivering till topp 1-3 / 1-5",
    "Anteckningar",
  ]);
  sheet.addRow([
    1,
    "Exempelföretag",
    "Malmö",
    "Ada Andersson",
    "ada@example.com",
    "070 123 45 67",
    "Intressant bransch och bra match.",
    "Kontakta efter sommaren.",
  ]);

  const imported = await importWorkbook(
    await asFile(new Blob([await book.xlsx.writeBuffer()])),
    "2026-10-31",
    { ExcelJS },
  );
  assert.equal(imported.length, 1);
  assert.deepEqual(
    Object.fromEntries(
      ["company", "city", "contactPerson", "email", "phone", "comment", "notes", "date", "status"]
        .map((field) => [field, imported[0][field]]),
    ),
    {
      company: "Exempelföretag",
      city: "Malmö",
      contactPerson: "Ada Andersson",
      email: "ada@example.com",
      phone: "070 123 45 67",
      comment: "Intressant bransch och bra match.",
      notes: "Kontakta efter sommaren.",
      date: "",
      status: "",
    },
  );
  assert.equal("rank" in imported[0], false);
});

test("import rejects other workbooks and invalid values with clear messages", async () => {
  const other = new ExcelJS.Workbook();
  other.addWorksheet("Blad1").addRow(["a", "b"]);
  await assert.rejects(
    importWorkbook(await asFile(new Blob([await other.xlsx.writeBuffer()])), "now", { ExcelJS }),
    (error) => error instanceof ExcelError && /Söklogg/.test(error.message),
  );

  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await templateData());
  const sheet = book.getWorksheet("Söklogg");
  sheet.getRow(2).values = ["2026-10-20", "Acme", "", "", "", "", "", "", "Okänd status"];
  sheet.getRow(3).values = ["2026-13-45", "Beta", "", "", "", "", "", "", "Avslag"];
  const blob = new Blob([await book.xlsx.writeBuffer()]);
  await assert.rejects(importWorkbook(await asFile(blob), "now", { ExcelJS }), (error) => {
    assert.ok(error instanceof ExcelError);
    assert.equal(error.details.length, 2);
    assert.match(error.details[0], /Rad 2/);
    assert.match(error.details[1], /Rad 3/);
    return true;
  });
});
