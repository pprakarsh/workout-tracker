// Read-only derived queries over store state: the exercise library, history
// lookups and recent values. Split out of store.js when it passed the 1000-line
// cap; the seam is mutations (store.js) versus queries (here).
//
// Imports state but never mutates it.
import { state } from './store.js';
import {
  normName, startOfWeek, startOfMonth, addWeeks, addMonths, fmtDate, isoDate,
} from './util.js';
import { cardioLogged } from './cardio.js';
import {
  exerciseSets, metricFor, bySession, weeklyTotals, exerciseTotals, cardioRuns,
} from './trends.js';

/* ------------------------------------------------------------------ */
/* history lookups                                                    */
/* ------------------------------------------------------------------ */

/** Every exercise name ever used, for the autocomplete datalist. */
export function exerciseNames() {
  const out = new Map();
  const add = (n) => { const k = normName(n); if (k && !out.has(k)) out.set(k, n.trim()); };
  state.routines.forEach((r) => r.entries.forEach((e) => add(e.name)));
  state.sessions.forEach((s) => s.entries.forEach((e) => add(e.name)));
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}

/** An entry reduced to a reusable definition: targets and notes, no logged data. */
function definitionOf(e) {
  return {
    type: e.type,
    name: e.name,
    // The superset letter describes one routine's arrangement, so it is
    // deliberately not carried into another routine.
    group: null,
    targetSets: e.targetSets ?? null,
    setTargets: e.setTargets ?? null,
    repsMin: e.repsMin ?? null,
    repsMax: e.repsMax ?? null,
    weight: e.weight ?? null,
    targetDistance: e.targetDistance ?? null,
    distanceUnit: e.distanceUnit ?? null,
    targetDuration: e.targetDuration ?? null,
    rest: e.rest ?? null,
    notes: e.notes || '',
  };
}

/**
 * The global exercise library: one record per distinct exercise name across all
 * routines and all logged sessions, carrying the most recent definition of it
 * plus how often and when it was actually performed.
 *
 * Routine definitions win over session snapshots (a routine is the intent; a
 * session is one instance of it), newest routine first. An exercise that only
 * ever existed as an ad-hoc session addition still shows up, defined from that.
 */
export function exerciseLibrary() {
  const byKey = new Map();
  const touch = (name) => {
    const key = normName(name);
    if (!key) return null;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        name: String(name).trim(),
        def: null,
        fromRoutine: null,
        candidates: [],
        routines: 0,
        performed: 0,
        lastPerformed: null,
      });
    }
    return byKey.get(key);
  };

  state.routines.forEach((r) => {
    r.entries.forEach((e) => {
      const rec = touch(e.name);
      if (!rec) return;
      rec.routines++;
      rec.candidates.push({ entry: e, routine: r });
    });
  });

  state.sessions.forEach((s) => {
    s.entries.forEach((e) => {
      const rec = touch(e.name);
      if (!rec) return;
      const logged = e.type === 'cardio'
        ? cardioLogged(e.log)
        : (e.sets || []).some((x) => x.done);
      if (logged) {
        rec.performed++;
        if (!rec.lastPerformed || s.startedAt > rec.lastPerformed) rec.lastPerformed = s.startedAt;
      }
      if (!rec.sessionDef || s.startedAt > rec.sessionDefAt) {
        rec.sessionDef = e;
        rec.sessionDefAt = s.startedAt;
      }
    });
  });

  return [...byKey.values()].map((rec) => {
    // Most recently updated routine wins; then the more recently created one.
    // Spelling the tie-break out matters: without it, iteration order (which is
    // alphabetical by routine name) silently decided which definition you got.
    const best = rec.candidates.sort((a, b) => (
      (b.routine.updatedAt || 0) - (a.routine.updatedAt || 0)
      || (b.routine.createdAt || 0) - (a.routine.createdAt || 0)
    ))[0];
    const source = best ? best.entry : rec.sessionDef;
    return {
      key: rec.key,
      name: rec.name,
      def: source ? definitionOf(source) : null,
      fromRoutine: best ? best.routine.name : null,
      routines: rec.routines,
      performed: rec.performed,
      lastPerformed: rec.lastPerformed,
    };
  }).sort(
    (a, b) => (b.lastPerformed || 0) - (a.lastPerformed || 0) || a.name.localeCompare(b.name),
  );
}

/**
 * Distinct weights recently used for an exercise, newest first. Offered as chips
 * so changing a load is a tap rather than a keypad.
 */
export function recentWeights(name, limit = 4) {
  const key = normName(name);
  if (!key) return [];
  const out = [];
  for (const s of state.sessions) {
    if (state.active && s.id === state.active.id) continue;
    for (const e of s.entries) {
      if (normName(e.name) !== key) continue;
      for (const x of [...(e.sets || [])].reverse()) {
        if (x.warmup || !x.done || x.weight === null) continue;
        if (!out.includes(x.weight)) out.push(x.weight);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

export const findInLibrary = (key) => exerciseLibrary().find((x) => x.key === normName(key)) || null;

/**
 * The most recent logged instance of an exercise, for the "last time" reference.
 * Returns { session, entry } or null. Skips the live session.
 */
export function lastLogFor(name, excludeSessionId = null) {
  const key = normName(name);
  if (!key) return null;
  for (const s of state.sessions) {
    if (s.id === excludeSessionId) continue;
    if (!s.finishedAt) continue;        // only completed sessions count as "last time"
    for (const e of s.entries) {
      if (normName(e.name) !== key) continue;
      const hasWork = e.type === 'lift'
        ? (e.sets || []).some((x) => x.done || x.reps !== null || x.weight !== null)
        : cardioLogged(e.log);
      if (hasWork) return { session: s, entry: e };
    }
  }
  return null;
}

/** Previous session for a routine (most recent finished one). */
export function lastSessionForRoutine(routineId) {
  return state.sessions.find((s) => s.routineId === routineId && s.finishedAt) || null;
}

export const completedSessions = () => state.sessions.filter((s) => s.finishedAt);


/* ------------------------------------------------------------------ */
/* history filtering                                                  */
/* ------------------------------------------------------------------ */

/** The default: everything, newest first. */
export const ALL_SESSIONS = { mode: 'all', offset: 0, from: null, to: null };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const dayEnd = (ts) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
};

const parseDayInput = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const ts = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return isoDate(ts) === v ? ts : null;
};

/**
 * Turn a filter into a concrete window plus a label for the header.
 *
 * `offset` steps whole weeks or months back (negative) and forward, so the week
 * and month views can be browsed rather than only showing the current one.
 * A range with `from` equal to `to` is a single day, which is how "a specific
 * date" is expressed -- one control instead of two.
 */
export function historyWindow(filter = ALL_SESSIONS, now = Date.now()) {
  const f = { ...ALL_SESSIONS, ...(filter || {}) };
  if (f.mode === 'week') {
    const from = addWeeks(startOfWeek(now), f.offset || 0);
    const to = dayEnd(addWeeks(from, 1) - 86400000);
    const sameYear = new Date(from).getFullYear() === new Date(now).getFullYear();
    return {
      from,
      to,
      label: f.offset === 0 ? 'This week'
        : f.offset === -1 ? 'Last week'
          : `${fmtDate(from).slice(4, sameYear ? 10 : 99)} - ${fmtDate(to).slice(4)}`,
      sub: `${fmtDate(from).slice(4)} - ${fmtDate(to).slice(4)}`,
    };
  }
  if (f.mode === 'month') {
    const from = addMonths(startOfMonth(now), f.offset || 0);
    const to = dayEnd(addMonths(from, 1) - 86400000);
    const d = new Date(from);
    return {
      from,
      to,
      label: f.offset === 0 ? 'This month' : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      sub: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    };
  }
  if (f.mode === 'range') {
    const a = parseDayInput(f.from);
    const b = parseDayInput(f.to);
    if (a === null && b === null) return { from: null, to: null, label: 'Pick a date', sub: '' };
    const from = a === null ? b : a;
    const to = dayEnd(b === null ? a : b);
    if (from > to) return { from: to - 86399999, to: dayEnd(from), label: 'Date range', sub: '' };
    const oneDay = isoDate(from) === isoDate(to);
    return {
      from,
      to,
      label: oneDay ? fmtDate(from) : `${fmtDate(from).slice(4)} - ${fmtDate(to).slice(4)}`,
      sub: oneDay ? 'a single day' : '',
    };
  }
  return { from: null, to: null, label: 'All time', sub: '' };
}

/** Sessions inside a window. A null bound means unbounded on that side. */
export function sessionsIn(sessions, window) {
  if (!window || (window.from === null && window.to === null)) return sessions;
  return sessions.filter((s) => (window.from === null || s.startedAt >= window.from)
    && (window.to === null || s.startedAt <= window.to));
}

/** Month headings for a list of sessions, so a long range stays readable. */
export function groupByMonth(sessions = []) {
  const out = [];
  let key = null;
  sessions.forEach((s) => {
    const d = new Date(s.startedAt);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    if (k !== key) {
      key = k;
      out.push({ heading: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, sessions: [] });
    }
    out[out.length - 1].sessions.push(s);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* trends                                                            */
/* ------------------------------------------------------------------ */

/**
 * Everything the Trends tab needs about one exercise, in the unit on display.
 *
 * The state read lives here so js/trends.js can stay pure and testable with
 * hand-built sessions. `normName` folds case and spacing, so "Bench press" and
 * "Bench Press" are one exercise rather than two half-histories.
 */
export function exerciseTrend(name, unit = state.settings.unit) {
  const key = normName(name);
  if (!key) return null;
  const lib = findInLibrary(key);
  const sessions = [...state.sessions].sort((a, b) => a.startedAt - b.startedAt);
  const type = lib?.def?.type === 'cardio' ? 'cardio' : 'lift';
  if (type === 'cardio') {
    return {
      key, name: lib?.name || name, type: 'cardio', measure: 'reps',
      runs: cardioRuns(sessions, key, normName), sets: [], rows: [], converted: 0, unit,
    };
  }
  // the measure can only come from the sessions themselves: a routine may have
  // been edited since, and a logged plank stays a plank
  const measure = (() => {
    for (let i = state.sessions.length - 1; i >= 0; i--) {
      const hit = state.sessions[i].entries.find((e) => normName(e.name) === key && e.type === 'lift');
      if (hit) return hit.measure || 'reps';
    }
    return lib?.def?.measure || 'reps';
  })();
  const { sets, converted } = exerciseSets(sessions, key, normName, unit);
  const metric = metricFor(measure);
  return {
    key,
    name: lib?.name || name,
    type: 'lift',
    measure,
    metric,
    sets,
    rows: bySession(sets, metric),
    converted,
    unit,
  };
}

/** Weekly volume and set counts for the whole log. */
export function weeklyVolume(weeks = 12, unit = state.settings.unit) {
  return weeklyTotals(state.sessions, unit, weeks, startOfWeek, addWeeks, Date.now(),
    state.settings.distanceUnit);
}

/** Every exercise ever logged, ranked by how much work went into it. */
export function trainedExercises(sessions = state.sessions, unit = state.settings.unit) {
  return exerciseTotals(sessions, normName, unit, state.settings.distanceUnit);
}

/* ------------------------------------------------------------------ */
/* completeness                                                      */
/* ------------------------------------------------------------------ */

/**
 * Work that LOOKS logged but is not confirmed, and would therefore be lost.
 *
 * Every row in a session opens pre-filled -- a lift's sets from the plan or
 * last time, a run's numbers from its targets -- because logging is meant to be
 * confirming rather than typing. The cost is that a filled-in row and a
 * recorded one look identical, and an unconfirmed one contributes to nothing:
 * not History, not the exports, not Trends, not the plan's done check. A run is
 * the easy one to lose, since a lifter learns to tick each set but a runner
 * sees numbers already in the boxes.
 *
 * So this is what the finish prompt warns about.
 */
export function unconfirmedWork(session) {
  if (!session) return [];
  const out = [];
  session.entries.forEach((e) => {
    if (e.skipped) return;
    if (e.type === 'cardio') {
      const l = e.log || {};
      const legs = l.legs || [];
      if (legs.length) {
        const unticked = legs.filter((x) => !x.done && (x.duration || x.pace));
        if (unticked.length && unticked.length === legs.length) {
          out.push({ id: e.id, name: e.name, kind: 'cardio', what: `${new Set(legs.map((x) => x.round)).size} rounds` });
        }
        return;
      }
      const hasNumbers = l.duration || l.distance !== null || l.pace;
      if (!l.done && hasNumbers) {
        out.push({ id: e.id, name: e.name, kind: 'cardio', what: 'the run' });
      }
      return;
    }
    const filled = (e.sets || []).filter((x) => !x.done && !x.warmup
      && (x.reps !== null || x.weight !== null));
    if (filled.length) {
      out.push({
        id: e.id, name: e.name, kind: 'lift',
        what: `${filled.length} set${filled.length === 1 ? '' : 's'}`,
      });
    }
  });
  return out;
}
