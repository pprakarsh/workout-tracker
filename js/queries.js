// Read-only derived queries over store state: the exercise library, history
// lookups and recent values. Split out of store.js when it passed the 1000-line
// cap; the seam is mutations (store.js) versus queries (here).
//
// Imports state but never mutates it.
import { state } from './store.js';
import { normName } from './util.js';

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
        ? !!(e.log && (e.log.done || e.log.distance !== null))
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
        : !!(e.log && (e.log.done || e.log.distance !== null || e.log.duration !== null));
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

