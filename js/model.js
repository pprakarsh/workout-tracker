// Entry and routine SHAPE: normalisation, defaults and the plan-to-session
// expansion. Pure functions -- no state, no persistence, no DOM. The store owns
// what is stored and when; this module owns what the stored thing looks like.
//
// `normalizeEntry` is the compatibility layer for the whole app. There is no
// migration framework, so every field here must tolerate its own absence: old
// IndexedDB rows, old gist backups and hand-written JSON all arrive through
// this function and must come out valid.
import { uid, num, parseReps, parseDur, normName } from './util.js';
import { parsePace, intervalSpec, isIntervals, plannedLegs, resolveRun, storedSeconds } from './cardio.js';
import { parseMeasure, parseAmountRange } from './measure.js';
import { otherSide, parseSide, parseGroup, parseGroups } from './exercise.js';

/**
 * Per-set targets: a plan with a different load/reps for each set.
 * Accepts  [{weight:60,reps:10}, …]  |  ["60x10","70x8"]  |  "60x10, 70x8, 80x5"
 * Reps may be a range ("8-12"); the weight may be omitted ("x10") for bodyweight.
 *
 * `>` chains a DROP onto the set before it: "100x8 > 80x6 > 60x5" is one working
 * set with two drop stages, not three sets. It reads the way a lifter writes it
 * and round-trips through JSON as `{weight, reps, drop:true}`.
 *
 * Returns [{weight, repsMin, repsMax, drop}] or null.
 */
export function parseSetTargets(raw, measure = 'reps') {
  if (raw === null || raw === undefined || raw === '') return null;

  const one = (str) => {
    const s = String(str).trim().toLowerCase().replace(/×/g, 'x');
    if (!s) return null;
    const m = s.match(/^([\d.]*)\s*(?:x|@|\*)\s*(.+)$/);
    if (m) {
      const reps = parseAmountRange(m[2], measure);
      return { weight: num(m[1]), repsMin: reps.min, repsMax: reps.max, drop: false };
    }
    // a bare number is a weight with no rep target
    const w = num(s);
    return w === null ? null : { weight: w, repsMin: null, repsMax: null, drop: false };
  };

  // one comma-separated chunk may itself be a drop chain: everything after the
  // first `>` is a stage of the set that opened the chunk
  const chunk = (str) => String(str).split('>').map((part, i) => {
    const t = one(part);
    if (t && i > 0) t.drop = true;
    return t;
  });

  const list = typeof raw === 'string'
    ? raw.split(/[,;\n]/).flatMap(chunk)
    : Array.isArray(raw)
      ? raw.flatMap((item) => {
        if (item === null || item === undefined) return [null];
        if (typeof item === 'number') return [one(item)];
        if (typeof item === 'string') return chunk(item);
        const reps = parseAmountRange(
          item.reps !== undefined ? item.reps : { min: item.repsMin, max: item.repsMax },
          measure,
        );
        return [{
          weight: num(item.weight), repsMin: reps.min, repsMax: reps.max, drop: !!item.drop,
        }];
      })
      : null;

  if (!list) return null;
  const clean = list.filter((x) => x && (x.weight !== null || x.repsMin !== null || x.repsMax !== null));
  return clean.length ? clean : null;
}

/**
 * The alternatives list for an Either/Or slot: "Leg Press OR Hack Squat".
 *
 * Accepts an array or a comma/slash-separated string, because hand-written JSON
 * and a single text field should both work. The exercise's own name is dropped
 * from its own list -- offering the exercise you are already doing as a swap is
 * noise -- and duplicates collapse on normName so "hack squat" and "Hack Squat"
 * are one option, not two.
 */
export function altNames(raw, selfName = '') {
  const list = Array.isArray(raw) ? raw
    : raw === null || raw === undefined || raw === '' ? []
      : String(raw).split(/[,;/\n]|\bor\b/i);
  const self = normName(selfName);
  const out = new Map();
  for (const item of list) {
    const name = String(item ?? '').trim();
    const key = normName(name);
    if (!key || key === self || out.has(key)) continue;
    out.set(key, name);
  }
  return [...out.values()];
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
    // Either/Or: other exercises that can fill this slot, chosen at workout
    // time because a machine is taken. Always an array, never null, so every
    // read site can iterate without a guard.
    alternatives: altNames(raw.alternatives ?? raw.alts ?? raw.either ?? raw.or, raw.name),
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
    // one limb at a time, so the plan's sets are logged twice -- once per side.
    // Carried on the ENTRY as well as in the library so a session stays
    // self-describing: editing the library must not retroactively change the
    // shape of a workout already logged.
    unilateral: !!(raw.unilateral ?? raw.perSide),
    // muscle groups, for per-group trends. Copied from the library when the
    // entry is created; the entry's own value wins thereafter.
    primary: parseGroup(raw.primary ?? raw.muscle) || null,
    secondary: parseGroups(raw.secondary ?? raw.otherMuscles, raw.primary ?? raw.muscle),
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
  // answered "I do not know" rather than left blank -- see effortAnswered
  effortUnknown: false,
  // bodyweight: the load is your own body. `weight` then means ADDED load
  // (a belt, a dumbbell between the feet) and may stay null for plain BW.
  bodyweight: false,
  // a drop stage: strip the load and keep going, NO rest before it. Belongs to
  // the working set above it -- see setLabels and nextIsDrop.
  drop: false,
  // 'L' | 'R' on a unilateral exercise, null otherwise. A side is a property of
  // the SET, not of the entry, so a correction can un-side one row.
  side: null,
  warmup, note: '', done: false, completedAt: null, rest: null,
});

/**
 * Display labels for a set list: warmups are W1, W2... and working sets are
 * numbered 1, 2... independently, which is how lifters count them.
 *
 * A drop stage takes its parent's number with an arrow per stage -- 3, 3↓, 3↓↓
 * -- because it is not a fourth set, it is the same set at a lighter load. A
 * drop with no working set before it is nonsense, so it falls back to a number.
 */
export function setLabels(sets = []) {
  let w = 0; let n = 0; let d = 0;
  // how many sides of the CURRENT numbered set have been emitted. Needed because
  // "the other side of the same set" and "the first side of the next set" look
  // identical from the row alone -- both are a side differing from the one before.
  let sides = 0; let prev = null;
  return sets.map((s) => {
    if (s.warmup) { d = 0; sides = 0; prev = null; return `W${++w}`; }
    if (s.drop && n > 0) return `${n}${s.side || ''}${'\u2193'.repeat(++d)}`;
    d = 0;
    // The two sides of one set share its number: 1L and 1R are the same set,
    // done twice. Numbering them 1 and 2 would claim you did two sets.
    if (s.side && sides === 1 && prev && s.side !== prev) {
      sides = 2; prev = s.side;
      return `${n}${s.side}`;
    }
    sides = s.side ? 1 : 0;
    prev = s.side || null;
    return `${++n}${s.side || ''}`;
  });
}

/** Sets that count towards targets, volume and records. */
export const workingSets = (e) => (e.sets || []).filter((s) => !s.warmup);

/**
 * How many logged rows one planned set becomes.
 *
 * A unilateral exercise is logged twice per set -- once per side -- because a
 * left arm and a right arm are not interchangeable and averaging them hides the
 * imbalance you train unilaterally to find. `targetSets` keeps meaning PLANNED
 * sets, so "3 sets" of a single-arm row is three sets per side, six rows. That
 * invariant is what stops the routine form, the exports and every existing
 * routine from needing to know this feature exists.
 */
export const rowsPerSet = (e) => (e?.unilateral ? 2 : 1);

/** Rows a plan materialises into, after the unilateral doubling. */
export function plannedRowCount(e) {
  const want = e?.setTargets ? e.setTargets.length : (e?.targetSets ?? 0);
  return want * rowsPerSet(e);
}

/** Which planned set the i-th working ROW belongs to. */
export const planIndexFor = (e, row) => Math.floor(row / rowsPerSet(e));

/** The side for the i-th working row: null unless the exercise is unilateral. */
export const sideForRow = (e, row, firstSide = 'L') => {
  if (!e?.unilateral) return null;
  const first = firstSide === 'R' ? 'R' : 'L';
  return row % 2 === 0 ? first : otherSide(first);
};

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

/**
 * What the app already knows about an exercise by name: how it is measured and
 * whether it is a bodyweight movement.
 *
 * Pure, so the store can use it without importing the query layer (which reads
 * state and would close a dependency cycle). Routine definitions beat session
 * snapshots because a routine is a deliberate statement about the exercise;
 * a session is just the last time it happened.
 */
export function knownDefinition(routines = [], sessions = [], name = '') {
  const key = normName(name);
  if (!key) return null;
  const match = (e) => normName(e.name) === key;
  for (const r of routines) {
    const hit = (r.entries || []).find(match);
    if (hit) return { measure: hit.measure || 'reps', bodyweight: !!hit.bodyweight };
  }
  const recent = [...sessions].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  for (const s of recent) {
    const hit = (s.entries || []).find(match);
    if (hit) return { measure: hit.measure || 'reps', bodyweight: !!hit.bodyweight };
  }
  return null;
}

/** Routine entry -> session entry (a snapshot; editing it never touches the routine). */
export function toSessionEntry(entry, settings) {
  const e = normalizeEntry(entry);
  return {
    ...e,
    id: uid('e'),          // fresh id: the session copy is its own thing
    sourceId: e.id,        // remembers which routine entry it came from
    swappedFrom: null,     // set when an Either/Or slot is swapped mid-workout
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
export function expandEntry(entry, settings, sessions = null, before = null) {
  const e = normalizeEntry(entry);
  const prior = sessions && settings.prefillFrom === 'last'
    ? lastWorkingSets(sessions, e.name, e.measure || 'reps', before) : null;
  return [materializePlan(toSessionEntry(e, settings), prior, { firstSide: settings.firstSide })];
}

/**
 * The working sets of the most recent FINISHED session that logged this
 * exercise. Pure -- sessions come in as an argument -- so the store can call it
 * without this module ever importing state.
 */
export function lastWorkingSets(sessions = [], name, measure = 'reps', before = null) {
  const key = normName(name);
  if (!key) return null;
  const done = sessions
    // `before` matters for a backdated session: filling Tuesday's rows from
    // Thursday's numbers would be prefilling from the future
    .filter((s) => s.finishedAt && (before === null || s.startedAt < before))
    .sort((a, b) => b.startedAt - a.startedAt);
  for (const s of done) {
    const hit = s.entries.find((e) => e.type === 'lift' && normName(e.name) === key
      && (e.measure || 'reps') === measure);
    const sets = (hit?.sets || []).filter((x) => x.done && !x.warmup);
    if (sets.length) return sets;
  }
  return null;
}

/**
 * Create the rows the plan calls for, so a session opens as a checklist to tick
 * off rather than an empty form with an "add set" button. Logging a set is
 * confirming one, not creating one.
 *
 * `prior` is the last performance, supplied when settings.prefillFrom is
 * 'last'. THE SET COUNT ALWAYS COMES FROM THE PLAN, only the numbers inside the
 * rows come from last time. Taking the count from last time too would ratchet a
 * routine down for good: cut a 5x5 short at three sets once and every session
 * after it would open as a 3x5.
 *
 * A unilateral exercise doubles the rows -- one per side -- and matches last
 * time BY SIDE rather than by position, because `firstSide` is a setting: flip
 * it and positional matching would prefill your right arm with your left arm's
 * numbers.
 */
export function materializePlan(entry, prior = null, { firstSide = 'L' } = {}) {
  if (entry.type !== 'lift') return entry;
  const want = plannedRowCount(entry);
  // last time's sets, split by side, so a side can be matched to its own history
  const bySide = { L: [], R: [] };
  (prior || []).forEach((x) => { if (x.side === 'L' || x.side === 'R') bySide[x.side].push(x); });
  for (let i = entry.sets.length; i < want; i++) {
    const pi = planIndexFor(entry, i);
    const plan = entry.setTargets?.[pi]
      || (entry.weight !== null || entry.repsMin !== null
        ? { weight: entry.weight, repsMin: entry.repsMin, repsMax: entry.repsMax } : null);
    const set = blankSet(entry.unit);
    set.bodyweight = !!entry.bodyweight;
    // a drop stage is part of the PLAN, not of last time's performance: it says
    // how this set is to be done, so it comes from the target even when the
    // numbers come from history
    set.drop = !!(entry.setTargets?.[pi]?.drop);
    set.side = sideForRow(entry, i, firstSide);
    // last time's matching set, else the one before it, so a longer plan still
    // fills to the end rather than trailing off into blanks
    const mine = set.side && bySide[set.side].length ? bySide[set.side] : prior;
    const idx = set.side && bySide[set.side].length ? Math.floor(i / 2) : i;
    const was = mine ? (mine[idx] || mine[mine.length - 1]) : null;
    if (was) {
      set.weight = was.weight ?? null;
      set.reps = was.reps ?? null;
      set.bodyweight = !!was.bodyweight;
      set.unit = was.unit || entry.unit;
    } else {
      set.weight = plan ? (plan.weight ?? null) : null;
      set.reps = plan ? (plan.repsMin ?? plan.repsMax ?? null) : null;
    }
    // A bodyweight set's `weight` is ADDED load, so an empty box reads as "no
    // information" when the answer is almost always zero. Defaulting it to 0
    // makes the field obviously present and obviously editable -- which is how
    // you discover you can log a weighted pull-up at all. loadLabel still shows
    // plain "BW", because 0 added is no load added.
    if (set.bodyweight && set.weight === null) set.weight = 0;
    entry.sets.push(set);
  }
  return entry;
}

