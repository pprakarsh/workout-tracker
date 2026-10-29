// Entry and routine SHAPE: normalisation, defaults and the plan-to-session
// expansion. Pure functions -- no state, no persistence, no DOM. The store owns
// what is stored and when; this module owns what the stored thing looks like.
//
// `normalizeEntry` is the compatibility layer for the whole app. There is no
// migration framework, so every field here must tolerate its own absence: old
// IndexedDB rows, old gist backups and hand-written JSON all arrive through
// this function and must come out valid.
import { uid, num, parseReps, parseDur } from './util.js';
import { parsePace, intervalSpec, isIntervals, plannedLegs, resolveRun, storedSeconds } from './cardio.js';
import { parseMeasure, parseAmountRange } from './measure.js';

/**
 * Per-set targets: a plan with a different load/reps for each set.
 * Accepts  [{weight:60,reps:10}, …]  |  ["60x10","70x8"]  |  "60x10, 70x8, 80x5"
 * Reps may be a range ("8-12"); the weight may be omitted ("x10") for bodyweight.
 * Returns [{weight, repsMin, repsMax}] or null.
 */
export function parseSetTargets(raw, measure = 'reps') {
  if (raw === null || raw === undefined || raw === '') return null;

  const one = (str) => {
    const s = String(str).trim().toLowerCase().replace(/×/g, 'x');
    if (!s) return null;
    const m = s.match(/^([\d.]*)\s*(?:x|@|\*)\s*(.+)$/);
    if (m) {
      const reps = parseAmountRange(m[2], measure);
      return { weight: num(m[1]), repsMin: reps.min, repsMax: reps.max };
    }
    // a bare number is a weight with no rep target
    const w = num(s);
    return w === null ? null : { weight: w, repsMin: null, repsMax: null };
  };

  const list = typeof raw === 'string'
    ? raw.split(/[,;\n]/).map(one)
    : Array.isArray(raw)
      ? raw.map((item) => {
        if (item === null || item === undefined) return null;
        if (typeof item === 'string' || typeof item === 'number') return one(item);
        const reps = parseAmountRange(
          item.reps !== undefined ? item.reps : { min: item.repsMin, max: item.repsMax },
          measure,
        );
        return { weight: num(item.weight), repsMin: reps.min, repsMax: reps.max };
      })
      : null;

  if (!list) return null;
  const clean = list.filter((x) => x && (x.weight !== null || x.repsMin !== null || x.repsMax !== null));
  return clean.length ? clean : null;
}

/** Coerce any loosely-shaped entry (hand-written JSON included) into our shape. */
export function normalizeEntry(raw = {}) {
  const type = String(raw.type || '').toLowerCase() === 'cardio' ? 'cardio' : 'lift';
  // `sets` is either a count (3) or a per-set plan ([{weight,reps},…])
  // `sets` is either a count (3), a per-set plan ([{weight,reps},…] / ["60x10",…]),
  // or the compact string form "60x10, 70x8, 80x5".
  const setsIsPlan = (Array.isArray(raw.sets)
    // a plan is [{weight,reps},…]; logged sets carry an id and a done flag, and
    // must never be mistaken for targets
    && !raw.sets.some((x) => x && typeof x === 'object' && ('done' in x || 'id' in x)))
    || (typeof raw.sets === 'string' && /[x×@*,;]/i.test(raw.sets));
  // what the per-set number means. Must be resolved BEFORE the targets, which
  // are parsed in this unit: "1:00" is a minute's plank, not one rep.
  const measure = type === 'lift'
    ? parseMeasure(raw.measure ?? raw.measuredIn ?? (raw.hold || raw.isometric ? 'time' : 'reps'))
    : 'reps';
  const setTargets = parseSetTargets(
    raw.setTargets ?? raw.perSet ?? raw.setPlan ?? (setsIsPlan ? raw.sets : null),
    measure,
  );
  const reps = parseAmountRange(
    raw.reps !== undefined ? raw.reps
      : (raw.repsMin !== undefined || raw.repsMax !== undefined)
        ? { min: raw.repsMin, max: raw.repsMax }
        : raw.targetReps,
    measure,
  );
  const group = raw.group ?? raw.groupId ?? raw.superset ?? null;
  const declaredSets = num(raw.targetSets ?? (setsIsPlan ? null : raw.sets));
  return {
    id: raw.id || uid('e'),
    type,
    name: String(raw.name || raw.exercise || 'Exercise').trim(),
    group: group === null || group === undefined || group === '' ? null : String(group).trim(),
    // lift targets — either one target for every set, or setTargets per set
    targetSets: setTargets ? setTargets.length : (declaredSets ?? (type === 'lift' ? 3 : null)),
    setTargets,
    // 'reps' | 'time' | 'distance' -- see js/measure.js. Absent means reps, so
    // every entry written before this existed keeps its original meaning.
    measure,
    repsMin: setTargets ? null : reps.min,
    repsMax: setTargets ? null : reps.max,
    weight: setTargets ? null : num(raw.weight ?? raw.targetWeight),
    unit: raw.unit || null,
    // a bodyweight movement: pull-ups, dips, push-ups. Sets default to BW and
    // any `weight` logged is treated as ADDED load.
    bodyweight: !!(raw.bodyweight ?? raw.bw),
    // cardio targets
    targetDistance: num(raw.distance ?? raw.targetDistance),
    distanceUnit: raw.distanceUnit || null,
    // `duration`/`pace` are human input, where a bare number means MINUTES.
    // `targetDuration`/`targetPace` are our own stored seconds and must pass
    // through untouched -- see storedSeconds. Getting this wrong multiplied
    // every cardio target by sixty on each session start.
    targetDuration: raw.duration !== undefined
      ? parseDur(raw.duration, { bare: 'minutes' })
      : storedSeconds(raw.targetDuration, (v) => parseDur(v, { bare: 'minutes' })),
    targetPace: raw.pace !== undefined
      ? parsePace(raw.pace)
      : storedSeconds(raw.targetPace, parsePace),
    // intervals: ONE entry holding a repeating pattern and a round count, not
    // N entries. `repeat` from older routines still works -- see intervalSpec.
    ...(type === 'cardio' ? (() => {
      const spec = intervalSpec(raw, {
        duration: raw.duration !== undefined
          ? parseDur(raw.duration, { bare: 'minutes' })
          : storedSeconds(raw.targetDuration, (v) => parseDur(v, { bare: 'minutes' })),
        pace: raw.pace !== undefined ? parsePace(raw.pace) : storedSeconds(raw.targetPace, parsePace),
      });
      return { legs: spec.legs, rounds: spec.legs ? spec.rounds : null };
    })() : { legs: null, rounds: null }),
    // shared
    rest: parseDur(raw.rest ?? raw.restSeconds ?? raw.restTime),
    // notes may be a string or a list of lines (handy in hand-written JSON)
    notes: (Array.isArray(raw.notes) ? raw.notes.join('\n')
      : String(raw.notes ?? raw.note ?? '')).trim(),
  };
}

export function normalizeRoutine(raw = {}) {
  const entries = (raw.entries || raw.exercises || []).map(normalizeEntry);
  return {
    id: raw.id || uid('r'),
    name: String(raw.name || raw.title || 'Untitled routine').trim(),
    description: String(raw.description || raw.desc || '').trim(),
    entries,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

export const blankSet = (unit, warmup = false) => ({
  id: uid('s'), weight: null, unit, reps: null, rpe: null, rir: null,
  // bodyweight: the load is your own body. `weight` then means ADDED load
  // (a belt, a dumbbell between the feet) and may stay null for plain BW.
  bodyweight: false,
  warmup, note: '', done: false, completedAt: null, rest: null,
});

/**
 * Display labels for a set list: warmups are W1, W2... and working sets are
 * numbered 1, 2... independently, which is how lifters count them.
 */
export function setLabels(sets = []) {
  let w = 0; let n = 0;
  return sets.map((s) => (s.warmup ? `W${++w}` : String(++n)));
}

/** Sets that count towards targets, volume and records. */
export const workingSets = (e) => (e.sets || []).filter((s) => !s.warmup);

/**
 * A fresh cardio log. Pre-filled from the entry's targets, like a lift's sets
 * are pre-materialised: logging a run is confirming the plan, not typing it in
 * from scratch. Summaries and exports still filter on `done`, so a pre-filled
 * log that was never confirmed never reads as history.
 */
const blankLog = (distanceUnit, e = null) => ({
  ...resolveRun({
    distance: e?.targetDistance ?? null,
    duration: e?.targetDuration ?? null,
    pace: e?.targetPace ?? null,
  }),
  distanceUnit,
  avgHr: null, maxHr: null, elevation: null,
  rpe: null, note: '', done: false, completedAt: null,
  // an interval block carries its expanded pattern; a plain run has no legs
  legs: isIntervals(e) ? plannedLegs(e) : null,
});

/** Routine entry -> session entry (a snapshot; editing it never touches the routine). */
export function toSessionEntry(entry, settings) {
  const e = normalizeEntry(entry);
  return {
    ...e,
    id: uid('e'),          // fresh id: the session copy is its own thing
    sourceId: e.id,        // remembers which routine entry it came from
    unit: e.unit || settings.unit,
    distanceUnit: e.distanceUnit || settings.distanceUnit,
    sets: e.type === 'lift' ? [] : null,
    log: e.type === 'cardio' ? blankLog(e.distanceUnit || settings.distanceUnit, e) : null,
    skipped: false,
  };
}

/**
 * Routine entry -> session entry. Intervals used to fan out into one entry per
 * round, which meant opening six cards to record one treadmill block. A cardio
 * entry is now always ONE entry: the rounds live inside its log, where they can
 * be confirmed in a single tap and still edited one at a time.
 */
export function expandEntry(entry, settings) {
  return [materializePlan(toSessionEntry(normalizeEntry(entry), settings))];
}

/**
 * Create the rows the plan calls for, so a session opens as a checklist to tick
 * off rather than an empty form with an "add set" button. Logging a set is
 * confirming one, not creating one.
 */
export function materializePlan(entry) {
  if (entry.type !== 'lift') return entry;
  const want = entry.setTargets ? entry.setTargets.length : (entry.targetSets ?? 0);
  for (let i = entry.sets.length; i < want; i++) {
    const plan = entry.setTargets?.[i]
      || (entry.weight !== null || entry.repsMin !== null
        ? { weight: entry.weight, repsMin: entry.repsMin, repsMax: entry.repsMax } : null);
    const set = blankSet(entry.unit);
    set.bodyweight = !!entry.bodyweight;
    set.weight = plan ? (plan.weight ?? null) : null;
    set.reps = plan ? (plan.repsMin ?? plan.repsMax ?? null) : null;
    entry.sets.push(set);
  }
  return entry;
}

