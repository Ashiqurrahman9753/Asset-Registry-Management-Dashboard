// Due-date logic for recurring filings (CPF, GST, ...). computeNextDue is the
// existing engine, moved here unchanged so the dashboard's CPF / GST board and
// the client window agree on exactly the same dates.

// Same "current cycle, roll forward once completed" idea as the AR/AGM deadline,
// generalized across monthly/quarterly/yearly — recurring tasks (CPF, GST,
// Compilation, Accounting) that aren't tied to FYE the way AR/AGM is.
//
// "Completed" is matched by which cycle window the completion date falls
// in, not by literal day-of-month comparison — filing a few days *before*
// the due date should still satisfy that cycle, not silently get attributed
// to the next one (comparing raw dates got this wrong for early filers).
export function computeNextDue(schedule, today = new Date()) {
  const { frequency, dueDay, dueMonth, lastCompletedDate } = schedule;
  const lastDayOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const makeDate = (y, m) => new Date(y, m, Math.min(dueDay, lastDayOfMonth(y, m)));
  const periodIndex = (date) => {
    const totalMonths = date.getFullYear() * 12 + date.getMonth();
    if (frequency === "monthly") return totalMonths;
    const anchor = ((dueMonth || 1) - 1 + 12) % 12;
    const cycleLen = frequency === "quarterly" ? 3 : 12;
    return Math.floor((totalMonths - anchor - 1) / cycleLen);
  };

  const candidates = [];
  if (frequency === "monthly") {
    for (let offset = -13; offset <= 13; offset++) {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      candidates.push(makeDate(d.getFullYear(), d.getMonth()));
    }
  } else {
    const anchor = ((dueMonth || 1) - 1 + 12) % 12;
    const monthsInYear = frequency === "quarterly" ? [anchor, anchor + 3, anchor + 6, anchor + 9] : [anchor];
    for (let yOff = -2; yOff <= 2; yOff++) {
      for (const m of monthsInYear) {
        const d = new Date(today.getFullYear() + yOff, m, 1);
        candidates.push(makeDate(d.getFullYear(), d.getMonth()));
      }
    }
  }
  candidates.sort((a, b) => a - b);

  const lastDone = lastCompletedDate ? new Date(lastCompletedDate) : null;
  const lastDonePeriod = lastDone ? periodIndex(lastDone) : null;
  let due;
  if (lastDonePeriod !== null) {
    due = candidates.find((d) => periodIndex(d) > lastDonePeriod);
  } else {
    const pastOrToday = candidates.filter((d) => d <= today);
    due = pastOrToday.length ? pastOrToday[pastOrToday.length - 1] : candidates.find((d) => d > today);
  }
  if (!due) return null;

  const daysLeft = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  return { due, daysLeft, overdue: daysLeft < 0 };
}

// ---------- Cycle view: what to show for "this cycle" ----------

// A filing needs action when it is overdue or due within this many days.
export const ACTION_DAYS = 5;

// How far ahead the *next* cycle counts as "current". A monthly CPF cycle that
// was filed on the 5th shows as filed until the next one is 15 days away.
const HORIZON = { monthly: 15, quarterly: 30, yearly: 30 };

const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();

// The due date one cycle before or after `due` (dir = -1 or +1).
export function stepDue(due, schedule, dir) {
  const months = schedule.frequency === "monthly" ? 1 : schedule.frequency === "quarterly" ? 3 : 12;
  const t = due.getMonth() + dir * months;
  const y = due.getFullYear() + Math.floor(t / 12);
  const m = ((t % 12) + 12) % 12;
  return new Date(y, m, Math.min(schedule.dueDay, lastDayOf(y, m)));
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// What a due date is *for*: a monthly filing due in November covers October.
export function periodText(schedule, due) {
  if (schedule.frequency === "monthly") {
    const p = new Date(due.getFullYear(), due.getMonth() - 1, 1);
    return `${MON[p.getMonth()]} ${p.getFullYear()}`;
  }
  if (schedule.frequency === "quarterly") {
    const end = new Date(due.getFullYear(), due.getMonth() - 1, 1);
    const start = new Date(end.getFullYear(), end.getMonth() - 2, 1);
    return start.getFullYear() === end.getFullYear()
      ? `${MON[start.getMonth()]}–${MON[end.getMonth()]} ${end.getFullYear()}`
      : `${MON[start.getMonth()]} ${start.getFullYear()}–${MON[end.getMonth()]} ${end.getFullYear()}`;
  }
  const endMonth = new Date(due.getFullYear(), due.getMonth() - 1, 1);
  return `Year to ${MON[endMonth.getMonth()]} ${endMonth.getFullYear()}`;
}

// The state of a schedule's current cycle:
//   done:    the current cycle is already filed
//   overdue: due date passed and not filed
//   action:  due within ACTION_DAYS (or overdue) — needs doing now
// `due` is the date of the cycle being shown; `period` says what it covers.
export function cycleView(schedule, today = new Date()) {
  const next = computeNextDue(schedule, today);
  if (!next) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysBetween = (d) => Math.round((d - startOfToday) / 86400000);
  const horizon = HORIZON[schedule.frequency] || 30;
  const nextDays = daysBetween(next.due);
  if (nextDays <= horizon) {
    return { done: false, due: next.due, daysLeft: nextDays, overdue: nextDays < 0, action: nextDays <= ACTION_DAYS, period: periodText(schedule, next.due) };
  }
  const due = stepDue(next.due, schedule, -1);
  return { done: true, due, daysLeft: daysBetween(due), overdue: false, action: false, period: periodText(schedule, due), nextDue: next.due };
}
