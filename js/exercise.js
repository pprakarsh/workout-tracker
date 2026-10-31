// The exercise LIBRARY's shape: what an exercise is, independently of any
// routine that asks for it or any session that logged it.
//
// Pure functions -- no state, no persistence, no DOM -- like model.js and
// measure.js. js/exercisestore.js owns the stored records; this module owns what
// a stored record looks like and the vocabulary it is allowed to use.
//
// IDENTITY IS THE NAME, through normName, exactly as everywhere else in this
// app. There is no exercise id, so a library record attaches to every routine
// entry and every logged set that shares its name, retroactively, with no
// migration. That is the whole reason this is cheap to add.
//
// WHAT "ISOMETRIC / BODYWEIGHT / EXTERNAL WEIGHT" ACTUALLY IS: two independent
// questions, not one three-way choice. `measure` says what the number means
// (reps / seconds / metres) and `bodyweight` says where the load comes from. A
// bodyweight plank is both: timed AND unloaded. Collapsing them into one enum
// would make that exercise impossible to describe, so they stay separate and
// `kindLabel` renders the pair as the one phrase a human would say.
import { normName } from './util.js';
import { parseMeasure } from './measure.js';

/**
 * The muscle-group vocabulary, for aggregating volume in Trends.
 *
 * Deliberately FLAT. Lats are part of your back and Rear Delts are part of your
 * shoulders, but a hierarchy would mean deciding whether a pulldown's lat sets
 * also count as back sets, and any answer to that is an opinion dressed up as
 * data. A flat list aggregates exactly what you tagged, and nothing else.
 */
export const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Lats', 'Traps', 'Lower Back',
  'Shoulders', 'Rear Delts',
  'Biceps', 'Triceps', 'Forearms',
  'Core', 'Obliques',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors', 'Abductors',
  'Neck', 'Full Body',
];

const GROUP_ALIASES = {
  pec: 'Chest', pecs: 'Chest', pectorals: 'Chest', chest: 'Chest',
  lat: 'Lats', lats: 'Lats', latissimus: 'Lats',
  'upper back': 'Back', back: 'Back', rhomboids: 'Back', 'mid back': 'Back',
  trap: 'Traps', traps: 'Traps', trapezius: 'Traps',
  'lower back': 'Lower Back', erectors: 'Lower Back', spinalerectors: 'Lower Back',
  delt: 'Shoulders', delts: 'Shoulders', deltoids: 'Shoulders', shoulder: 'Shoulders',
  'front delts': 'Shoulders', 'side delts': 'Shoulders', 'lateral delts': 'Shoulders',
  'rear delt': 'Rear Delts', 'rear delts': 'Rear Delts', 'posterior delts': 'Rear Delts',
  bi: 'Biceps', bis: 'Biceps', bicep: 'Biceps', biceps: 'Biceps',
  tri: 'Triceps', tris: 'Triceps', tricep: 'Triceps', triceps: 'Triceps',
  forearm: 'Forearms', forearms: 'Forearms', grip: 'Forearms',
  ab: 'Core', abs: 'Core', abdominals: 'Core', core: 'Core',
  oblique: 'Obliques', obliques: 'Obliques',
  quad: 'Quads', quads: 'Quads', quadriceps: 'Quads',
  ham: 'Hamstrings', hams: 'Hamstrings', hamstring: 'Hamstrings', hamstrings: 'Hamstrings',
  glute: 'Glutes', glutes: 'Glutes', gluteus: 'Glutes',
  calf: 'Calves', calves: 'Calves',
  adductor: 'Adductors', adductors: 'Adductors', groin: 'Adductors',
  abductor: 'Abductors', abductors: 'Abductors',
  neck: 'Neck',
  'full body': 'Full Body', fullbody: 'Full Body', total: 'Full Body',
};

const titleCase = (s) => s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/**
 * Normalise one muscle group to the vocabulary, or keep it as a custom label.
 *
 * An unrecognised value is title-cased and kept rather than rejected. Importing
 * someone else's library should not fail on a group this app has not heard of,
 * and Trends aggregates by whatever label is on the exercise, so a custom group
 * works everywhere a built-in one does.
 */
export function parseGroup(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const k = raw.toLowerCase().replace(/\s+/g, ' ');
  if (GROUP_ALIASES[k]) return GROUP_ALIASES[k];
  const exact = MUSCLE_GROUPS.find((g) => g.toLowerCase() === k);
  return exact || titleCase(raw);
}

/** Normalise a list of muscle groups: array or a comma/slash-separated string. */
export function parseGroups(v, exclude = null) {
  const list = Array.isArray(v) ? v
    : v === null || v === undefined || v === '' ? []
      : String(v).split(/[,;/\n]/);
  // `exclude` may be one group or a list of them
  const skip = (Array.isArray(exclude) ? exclude : [exclude])
    .map((g) => parseGroup(g)).filter(Boolean);
  const out = [];
  for (const item of list) {
    const g = parseGroup(item);
    // a group already named as primary is not also "another muscle worked"
    if (!g || skip.includes(g) || out.includes(g)) continue;
    out.push(g);
  }
  return out;
}

/** 'L' or 'R'; anything else is R, so the pair is always well defined. */
export const otherSide = (side) => (side === 'L' ? 'R' : 'L');
export const parseSide = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'L' || s === 'LEFT') return 'L';
  if (s === 'R' || s === 'RIGHT') return 'R';
  return null;
};
export const sideLabel = (side) => (side === 'L' ? 'left' : side === 'R' ? 'right' : '');

/**
 * Coerce any loosely-shaped exercise record into our shape.
 *
 * Tolerates its own absence in every field, like normalizeEntry does: a library
 * imported from a file, seeded from history, or written by an older version of
 * this app all arrive here and must come out valid.
 */
export function normalizeExercise(raw = {}) {
  const name = String(raw.name || raw.exercise || '').trim();
  const measure = parseMeasure(raw.measure ?? raw.measures ?? raw.kind);
  // PRIMARY IS A LIST. A deadlift's prime movers really are hamstrings, glutes
  // and erectors; a bench press really is chest, triceps and front delts.
  // Forcing one would make you pick arbitrarily, and the arbitrary pick then
  // decides every per-muscle number downstream.
  const primary = parseGroups(raw.primary ?? raw.group ?? raw.muscle ?? raw.volumeGroup);
  return {
    key: normName(name),
    name,
    type: String(raw.type || '').toLowerCase() === 'cardio' ? 'cardio' : 'lift',
    // what the number on a set means -- see measure.js. 'isometric' arrives here
    // as 'time', which is why an isometric needs no separate flag.
    measure,
    // where the load comes from. Independent of `measure`: a plank is timed and
    // unloaded, a weighted plank is timed and loaded.
    bodyweight: !!(raw.bodyweight ?? raw.bw),
    // one limb at a time, so every set is logged twice -- once per side
    unilateral: !!(raw.unilateral ?? raw.perSide ?? raw.singleArm ?? raw.singleLeg),
    primary,
    // "other muscles", for indirect set counting in Trends
    secondary: parseGroups(raw.secondary ?? raw.others ?? raw.otherMuscles ?? raw.assisting, primary),
    notes: (Array.isArray(raw.notes) ? raw.notes.join('\n')
      : String(raw.notes ?? raw.note ?? '')).trim(),
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

/** The one phrase a human would say for a measure + load pair. */
export function kindLabel(ex) {
  if (!ex) return '';
  if (ex.type === 'cardio') return 'cardio';
  const load = ex.bodyweight ? 'bodyweight' : 'external weight';
  if (ex.measure === 'time') return `isometric hold, ${load}`;
  if (ex.measure === 'distance') return `loaded carry, ${load}`;
  return `reps, ${load}`;
}

/** The short pills shown next to a name in the library list. */
export function kindPills(ex) {
  const out = [];
  if (!ex) return out;
  if (ex.type === 'cardio') { out.push('cardio'); return out; }
  if (ex.measure === 'time') out.push('isometric');
  if (ex.measure === 'distance') out.push('carry');
  out.push(ex.bodyweight ? 'bodyweight' : 'weighted');
  if (ex.unilateral) out.push('per side');
  return out;
}

/**
 * The fields a library record contributes to a routine entry or a session entry.
 *
 * Only what the library is authoritative about. Targets, rest and per-set plans
 * belong to the routine -- the same exercise is three sets of eight in one
 * routine and five of five in another -- so they are deliberately absent.
 */
export function exerciseDefaults(ex) {
  if (!ex) return {};
  return {
    measure: ex.measure,
    bodyweight: ex.bodyweight,
    unilateral: ex.unilateral,
    primary: ex.primary,
    secondary: ex.secondary,
  };
}

/**
 * Direct and indirect sets per muscle group over a set of sessions.
 *
 * DIRECT and INDIRECT are reported separately and never blended. The tempting
 * move is to count a secondary muscle as half a set, but that fraction is
 * invented -- nothing in the data supports 0.5 over 0.3 -- and once blended you
 * cannot get the real numbers back out. Two honest columns beat one made-up one.
 *
 * `lookup(name)` returns the library record for a name, or null. Pure: sessions
 * and the lookup both come in as arguments.
 */
export function groupTotals(sessions = [], lookup = () => null, { from = null, to = null } = {}) {
  const byGroup = new Map();
  const touch = (g) => {
    if (!byGroup.has(g)) {
      byGroup.set(g, { group: g, direct: 0, indirect: 0, volume: 0, lastAt: null, exercises: new Set() });
    }
    return byGroup.get(g);
  };

  sessions.forEach((s) => {
    if (!s.finishedAt) return;
    if (from !== null && s.startedAt < from) return;
    if (to !== null && s.startedAt >= to) return;
    (s.entries || []).forEach((e) => {
      if (e.type === 'cardio') return;
      const ex = lookup(e.name);
      // An entry's own tags win over the library's, so a session logged before
      // the library was tagged still counts once the library is filled in, and
      // an entry tagged differently on purpose is respected.
      //
      // Both are run through parseGroups rather than read directly, because an
      // entry stored before these became LISTS has `primary: 'Chest'` as a bare
      // string sitting in IndexedDB. There is no migration framework, so every
      // reader tolerates both shapes -- the same contract normalizeEntry keeps.
      //
      // An EMPTY list counts as "not set", not as "deliberately none":
      // normalizeEntry gives every entry `primary: []`, so treating the empty
      // array as an answer would mean the library's lists could never apply.
      const own = parseGroups(e.primary);
      const primary = own.length ? own : parseGroups(ex?.primary);
      const ownSec = parseGroups(e.secondary, primary);
      const secondary = ownSec.length ? ownSec : parseGroups(ex?.secondary, primary);
      if (!primary.length && !secondary.length) return;
      // the same filter the rest of Trends uses: confirmed working sets only
      const sets = (e.sets || []).filter((x) => x.done && !x.warmup);
      if (!sets.length) return;
      const vol = (e.measure || 'reps') === 'reps'
        ? sets.reduce((n, x) => {
          if (x.reps === null) return n;
          if (x.bodyweight) return s.bodyweight ? n + (s.bodyweight + (x.weight || 0)) * x.reps : n;
          return x.weight !== null ? n + x.weight * x.reps : n;
        }, 0)
        : 0;
      // A set counts ONCE PER GROUP it is tagged with, so a bench press tagged
      // chest + triceps is three chest sets AND three triceps sets. That is how
      // per-muscle volume is counted, and it means the direct column sums to
      // more than your total set count -- which is correct, not a bug.
      primary.forEach((g) => {
        const rec = touch(g);
        rec.direct += sets.length;
        rec.volume += vol;
        rec.exercises.add(e.name);
        if (!rec.lastAt || s.startedAt > rec.lastAt) rec.lastAt = s.startedAt;
      });
      secondary.forEach((g) => {
        const rec = touch(g);
        rec.indirect += sets.length;
        rec.exercises.add(e.name);
        if (!rec.lastAt || s.startedAt > rec.lastAt) rec.lastAt = s.startedAt;
      });
    });
  });

  return [...byGroup.values()]
    .map((r) => ({ ...r, volume: Math.round(r.volume), exercises: [...r.exercises].sort() }))
    .sort((a, b) => b.direct - a.direct || b.indirect - a.indirect || a.group.localeCompare(b.group));
}
