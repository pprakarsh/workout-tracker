// The 10-day plan: which routine is intended on which day.
//
// Pure functions over plain objects -- no state, no persistence, no DOM. The
// store holds the plan and saves it; this module decides what a day means.
//
// A plan is a map keyed by LOCAL date, `{ '2026-10-29': entry }`. Local, not
// UTC: a plan for "today" has to mean the day you are actually living in, and
// an ISO timestamp would roll over at the wrong moment for most of the world.
//
// DONE IS DERIVED, NOT BOOKKEPT. If you did the workout then a finished session
// for that routine exists on that date, so the plan reads it from history
// rather than asking you to tick a second box. `doneAt` is only for the case
// history cannot know about -- you trained without the app, or you are calling
// a partial session good enough.
import { isoDate } from './util.js';

/** How many days ahead the plan shows. The ask was ten; it is the only reason for 10. */
export const PLAN_DAYS = 10;
/** And how many behind. Enough to review a training week without it becoming a log. */
export const PAST_DAYS = 7;

/** A fresh, empty day. `routineId: null` with `rest: false` means "not planned yet". */
export const blankDay = () => ({ routineId: null, rest: false, doneAt: null, note: '' });

/** Local midnight for a timestamp, so day arithmetic cannot drift by an hour. */
export const startOfDay = (ts = Date.now()) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** `n` days after `ts`, built from calendar parts so DST does not shift it. */
export function addDays(ts, n) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

export const dayKey = (ts) => isoDate(ts);

/** Midday on a date key: a safe timestamp for formatting, never near midnight. */
export function keyToTs(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0).getTime();
}

/** Whole days from today to this key: 0 today, 1 tomorrow, -1 yesterday. */
export function daysFromToday(key, now = Date.now()) {
  return Math.round((startOfDay(keyToTs(key)) - startOfDay(now)) / 86400000);
}

/**
 * What happened, or is meant to happen, on one planned day.
 *
 * Statuses, in the order they are decided:
 *   done    a finished session for the planned routine, or a manual tick
 *   swapped a finished session that day, but for a different routine -- worth
 *           saying out loud rather than calling the day missed
 *   rest    a deliberate rest day
 *   open    nothing planned yet
 *   missed  a past day that was planned and never logged
 *   today / upcoming
 */
export function dayStatus(key, entry, sessions = [], now = Date.now()) {
  const e = entry || blankDay();
  const offset = daysFromToday(key, now);
  const onDay = sessions.filter((s) => s.finishedAt && dayKey(s.startedAt) === key);
  const matched = e.routineId ? onDay.find((s) => s.routineId === e.routineId) : null;

  if (matched || e.doneAt) {
    return { state: 'done', offset, session: matched || null, manual: !matched && !!e.doneAt };
  }
  if (onDay.length && e.routineId) {
    return { state: 'swapped', offset, session: onDay[0] };
  }
  // A finished session beats a rest day. Marking a day rest and then training
  // anyway is common -- plans change -- and reporting it as rest would hide the
  // workout from the row, the week's count and the adherence line. Reality wins
  // over intent, so this is checked BEFORE e.rest.
  if (onDay.length) {
    return { state: 'done', offset, session: onDay[0], restPlanned: !!e.rest };
  }
  if (e.rest) return { state: 'rest', offset, session: null };
  if (!e.routineId) return { state: 'open', offset, session: null };
  if (offset < 0) return { state: 'missed', offset, session: null };
  return { state: offset === 0 ? 'today' : 'upcoming', offset, session: null };
}

/**
 * Today plus the next nine days, oldest first -- the plan proper.
 */
export function planWindow(plan = {}, sessions = [], now = Date.now(), days = PLAN_DAYS) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const ts = addDays(now, i);
    const key = dayKey(ts);
    const entry = plan[key] || blankDay();
    out.push({ key, ts, entry, status: dayStatus(key, entry, sessions, now) });
  }
  return out;
}

/**
 * The seven days behind, MOST RECENT FIRST -- the same direction History reads.
 *
 * Shown below the plan rather than above it, so opening the tab still puts
 * today at the top. A past row answers a different question from a future one
 * ("did I do it?" rather than "what am I doing?"), which is why the view
 * renders them with a `past` flag instead of reusing the row as-is.
 */
export function pastWindow(plan = {}, sessions = [], now = Date.now(), days = PAST_DAYS) {
  const out = [];
  for (let i = 1; i <= days; i++) {
    const ts = addDays(now, -i);
    const key = dayKey(ts);
    const entry = plan[key] || blankDay();
    out.push({ key, ts, entry, status: dayStatus(key, entry, sessions, now) });
  }
  return out;
}

/** Counts for the header: how much of the window is planned and done. */
export function planSummary(window = []) {
  const planned = window.filter((d) => d.entry.routineId).length;
  const done = window.filter((d) => d.status.state === 'done' && d.entry.routineId).length;
  const rest = window.filter((d) => d.status.state === 'rest').length;
  return { planned, done, rest, open: window.length - planned - rest };
}

/**
 * What the week behind came to. `trained` counts every day something was
 * logged, planned or not -- an unplanned session is still training, and a
 * review that ignored it would be lying about the week.
 */
export function pastSummary(window = []) {
  const trained = window.filter((d) => d.status.state === 'done' || d.status.state === 'swapped').length;
  const missed = window.filter((d) => d.status.state === 'missed').length;
  const rest = window.filter((d) => d.status.state === 'rest').length;
  return { trained, missed, rest, days: window.length };
}

/** Drop days that are neither planned nor rest, and days long past. */
export function prunePlan(plan = {}, now = Date.now(), keepPastDays = 60) {
  const out = {};
  Object.entries(plan).forEach(([key, e]) => {
    if (!e) return;
    if (!e.routineId && !e.rest && !e.doneAt && !e.note) return;
    if (daysFromToday(key, now) < -keepPastDays) return;
    out[key] = e;
  });
  return out;
}

/** A date key that names a real calendar day. "2026-13-99" matches the shape
 *  but is not a date, and would sit in the plan forever doing nothing. */
function isRealDayKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return dayKey(keyToTs(key)) === key;
}

/** Coerce a stored or imported plan into shape. The compatibility layer. */
export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  Object.entries(raw).forEach(([key, v]) => {
    if (!isRealDayKey(key) || !v || typeof v !== 'object') return;
    out[key] = {
      routineId: v.routineId || null,
      rest: !!v.rest,
      doneAt: Number.isFinite(v.doneAt) ? v.doneAt : null,
      note: String(v.note || '').trim(),
    };
  });
  return out;
}
