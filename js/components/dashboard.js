import { ACTIVE_DIALOGUE_STATUSES, MILESTONES } from "../model/milestones.js";
import { daysBetween, todayIso } from "../utils/date.js";
import { isFilled } from "../utils/text.js";

const GRADE_LABELS = {
  below: "Pågår",
  pass: "Delmål nått",
  distinction: "Mål nått",
};

const count = (apps, predicate) => apps.filter(predicate).length;

function single(value, target) {
  return { value, target, grade: value >= target ? "distinction" : "below" };
}

/** The Min status figures plus progress against the milestones in the template's instructions. */
export function getDashboardMetrics(applications) {
  const companies = count(applications, (app) => isFilled(app.company) && isFilled(app.status) && app.status !== "Ej kontaktat",
  );

  return {
    companies: {
      value: companies,
      target: companies < 10 ? 10 : 20,
      grade: companies >= 20 ? "distinction" : companies >= 10 ? "pass" : "below",
    },
    followUps: single(count(applications, (app) => isFilled(app.followUpDate)), 3),
    dialogue: single(
      count(applications, (app) => app.interview === "Ja" || ACTIVE_DIALOGUE_STATUSES.includes(app.status)),
      1,
    ),
    interviews: single(count(applications, (app) => app.interview === "Ja"), 1),
    offers: single(count(applications, (app) => app.offered === "Ja"), 1),
  };
}

/** The first milestone that is today or later, with days left, or null when all have passed. */
export function nextMilestone(today = todayIso()) {
  const upcoming = MILESTONES.filter((m) => m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  return upcoming ? { ...upcoming, daysLeft: daysBetween(today, upcoming.date) } : null;
}

function describeNext(milestone) {
  if (!milestone) return "Alla deadlines är passerade.";
  const when =
    milestone.daysLeft === 0 ? "idag" : milestone.daysLeft === 1 ? "imorgon" : `om ${milestone.daysLeft} dagar`;
  return `Nästa deadline: ${milestone.name} (${milestone.date}), ${when}.`;
}

export function createDashboard(root) {
  const nodes = new Map([...root.querySelectorAll("[data-stat]")].map((n) => [n.dataset.stat, n]));
  const cards = new Map([...root.querySelectorAll("[data-goal]")].map((n) => [n.dataset.goal, n]));
  const nextDeadline = root.querySelector("[data-next-deadline]");

  return {
    update(applications, today = todayIso()) {
      const metrics = getDashboardMetrics(applications);
      for (const [key, metric] of Object.entries(metrics)) {
        nodes.get(key).textContent = `${metric.value} av ${metric.target}`;
        cards.get(key).dataset.status = metric.grade;
        nodes.get(`${key}Grade`).textContent = GRADE_LABELS[metric.grade];
      }
      nextDeadline.textContent = describeNext(nextMilestone(today));
    },
  };
}
