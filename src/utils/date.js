const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * `new Date("2026-10-05")` is parsed as UTC midnight, so anywhere west of UTC
 * it reads back as the previous day. Trip dates are calendar days, never
 * instants: parse them as local midnight so the stored ISO string round-trips
 * to the day the traveller actually picked.
 */
export function parseTripDate(value) {
  if (!value) return null;
  const local = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(local.getTime()) ? null : local;
}

/** Local-calendar YYYY-MM-DD for today, for `min` on `<input type="date">`. */
export function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function fmtDateRange(start, end) {
  if (!start || !end) return "";
  const s = new Date(start);
  const e = new Date(end);
  if (s.getMonth() === e.getMonth()) {
    return `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}`;
  }
  return `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()}\u2013${MONTHS_SHORT[e.getMonth()]} ${e.getDate()}`;
}

export function dayCount(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
}
