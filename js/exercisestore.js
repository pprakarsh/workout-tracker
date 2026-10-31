// The exercise library's writes: CRUD, seeding from what you have already done,
// and JSON import with explicit merge rules.
//
// A peer of store.js, like cardiostore.js, clockstore.js and backupstore.js: it
// imports state from the store and the store never imports it back.
//
// WHY A STORED LIBRARY AT ALL, when queries.js already derives one? Because the
// derived library can only know what a routine or a session happened to record.
// Nothing in a logged set says a dumbbell row is unilateral or that it trains
// your lats -- that is knowledge ABOUT the exercise, which has nowhere to live
// unless it is stored once, by name, and read by everything that shares the name.
import { state, emit, exerciseFor } from './store.js';
import { dbPut, dbDel, dbClear } from './db.js';
import { normalizeExercise, exerciseDefaults, parseGroups, parseGroup } from './exercise.js';
import { normName } from './util.js';

const sortLibrary = () => state.exercises.sort((a, b) => a.name.localeCompare(b.name));

export { exerciseFor };

/** The attributes the library is authoritative about, for a name. `{}` if unknown. */
export const defaultsFor = (name) => exerciseDefaults(exerciseFor(name));

/**
 * Create or overwrite one exercise.
 *
 * Keyed on the normalised name, so saving "Hack Squat" twice updates one record
 * rather than making two. Renaming is therefore a delete plus a save, which
 * `renameExercise` does explicitly.
 */
export async function saveExercise(raw) {
  const ex = normalizeExercise(raw);
  if (!ex.key) return null;
  const at = state.exercises.findIndex((x) => x.key === ex.key);
  if (at >= 0) {
    ex.createdAt = state.exercises[at].createdAt;
    ex.updatedAt = Date.now();
    state.exercises[at] = ex;
  } else {
    state.exercises.push(ex);
  }
  sortLibrary();
  await dbPut('exercises', ex);
  emit();
  return ex;
}

export async function deleteExercise(key) {
  const k = normName(key);
  const at = state.exercises.findIndex((x) => x.key === k);
  if (at < 0) return false;
  state.exercises.splice(at, 1);
  await dbDel('exercises', k);
  emit();
  return true;
}

/**
 * Rename an exercise in the library only.
 *
 * Deliberately does NOT touch routines or sessions. Identity in this app is the
 * name, so renaming the record while leaving the history alone would silently
 * orphan every set ever logged under the old name. The library screen says so
 * rather than pretending a rename is safe.
 */
export async function renameExercise(key, name) {
  const ex = exerciseFor(key);
  const to = String(name || '').trim();
  if (!ex || !to) return null;
  if (normName(to) === ex.key) return saveExercise({ ...ex, name: to });
  await deleteExercise(ex.key);
  return saveExercise({ ...ex, name: to });
}

/**
 * Fill the library from every exercise that already exists in a routine or a
 * session.
 *
 * Idempotent, and it never overwrites: an exercise already in the library keeps
 * the attributes you gave it. What it can seed is only what the old data knew --
 * the name, whether it is timed, whether it is bodyweight. Muscle groups and
 * unilateral are left blank, because guessing them from a name is exactly the
 * thing the ROADMAP said not to do ("never guess from names"): "Row" could be
 * a barbell row or a rowing machine, and a wrong tag is worse than no tag
 * because it silently pollutes every trend built on top of it.
 */
export async function seedExerciseLibrary() {
  const seen = new Map();
  const consider = (e, at) => {
    const key = normName(e.name);
    if (!key || exerciseFor(key)) return;
    const prev = seen.get(key);
    // the most recent sighting describes the exercise best
    if (prev && prev.at >= at) return;
    seen.set(key, { entry: e, at });
  };
  state.routines.forEach((r) => (r.entries || []).forEach((e) => consider(e, r.updatedAt || 0)));
  state.sessions.forEach((s) => (s.entries || []).forEach((e) => consider(e, s.startedAt || 0)));

  const made = [];
  for (const { entry } of seen.values()) {
    const ex = normalizeExercise({
      name: entry.name,
      type: entry.type,
      measure: entry.measure,
      bodyweight: entry.bodyweight,
      unilateral: entry.unilateral,
      primary: entry.primary,
      secondary: entry.secondary,
    });
    state.exercises.push(ex);
    made.push(ex);
  }
  sortLibrary();
  await Promise.all(made.map((ex) => dbPut('exercises', ex)));
  emit();
  return { added: made.length, skipped: state.exercises.length - made.length };
}

/* ------------------------------------------------------------------ */
/* import / export                                                    */
/* ------------------------------------------------------------------ */

export const LIBRARY_SCHEMA = 'workout-tracker/exercise-library@1';

/** The library as a plain object, for a file or the clipboard. */
export function libraryObject(list = state.exercises) {
  return {
    schema: LIBRARY_SCHEMA,
    exportedAt: new Date().toISOString(),
    exercises: list.map((ex) => {
      const o = { name: ex.name };
      if (ex.type !== 'lift') o.type = ex.type;
      if (ex.measure !== 'reps') o.measure = ex.measure;
      if (ex.bodyweight) o.bodyweight = true;
      if (ex.unilateral) o.unilateral = true;
      if (ex.primary) o.primary = ex.primary;
      if (ex.secondary.length) o.secondary = ex.secondary;
      if (ex.notes) o.notes = ex.notes;
      return o;
    }),
  };
}

/**
 * Which fields an incoming record actually mentions.
 *
 * The difference between "bodyweight: false" and saying nothing about bodyweight
 * matters in `update` mode: a file that only carries muscle groups must not
 * quietly reset everything else to its default. normalizeExercise cannot tell
 * the two apart, because by then every field has a value, so the raw keys are
 * read here while they are still visible.
 */
function mentioned(raw) {
  const has = (...names) => names.some((n) => raw[n] !== undefined);
  const out = {};
  if (has('type')) out.type = true;
  if (has('measure', 'measures', 'kind')) out.measure = true;
  if (has('bodyweight', 'bw')) out.bodyweight = true;
  if (has('unilateral', 'perSide', 'singleArm', 'singleLeg')) out.unilateral = true;
  if (has('primary', 'group', 'muscle', 'volumeGroup')) out.primary = true;
  if (has('secondary', 'others', 'otherMuscles', 'assisting')) out.secondary = true;
  if (has('notes', 'note')) out.notes = true;
  return out;
}

/**
 * Import a library from JSON.
 *
 * Three modes, because "import" means three different things and guessing which
 * one you meant would be the wrong kind of helpful:
 *
 *   add      only exercises the library has never heard of. Nothing you have
 *            already tagged can change. The safe default.
 *   update   add the new ones AND overwrite the fields each incoming record
 *            actually mentions, leaving the rest alone.
 *   replace  the file becomes the library. Anything not in it is deleted.
 *
 * Accepts the exported shape, a bare array, or `{ exercises: [...] }`, so a
 * hand-written file does not have to carry the schema line.
 */
export async function importLibrary(text, { mode = 'add' } = {}) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('That is not valid JSON.');
  }
  const rows = Array.isArray(data) ? data
    : Array.isArray(data?.exercises) ? data.exercises
      : Array.isArray(data?.library) ? data.library : null;
  if (!rows) {
    throw new Error('No "exercises" list found. Expected { "exercises": [ … ] } or a bare array.');
  }

  const out = {
    added: 0, updated: 0, unchanged: 0, removed: 0, skipped: 0, groups: new Set(),
  };
  const incoming = new Set();

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') { out.skipped++; continue; }
    const name = String(raw.name || raw.exercise || '').trim();
    const key = normName(name);
    if (!key) { out.skipped++; continue; }
    incoming.add(key);
    const existing = exerciseFor(key);

    if (!existing) {
      const ex = await saveExercise(raw);
      if (ex) {
        out.added++;
        if (ex.primary) out.groups.add(ex.primary);
        ex.secondary.forEach((g) => out.groups.add(g));
      }
      continue;
    }
    if (mode === 'add') { out.unchanged++; continue; }

    // update / replace: overwrite only what this record actually says
    const says = mentioned(raw);
    const merged = { ...existing, name: name || existing.name };
    if (says.type) merged.type = raw.type;
    if (says.measure) merged.measure = raw.measure ?? raw.measures ?? raw.kind;
    if (says.bodyweight) merged.bodyweight = !!(raw.bodyweight ?? raw.bw);
    if (says.unilateral) {
      merged.unilateral = !!(raw.unilateral ?? raw.perSide ?? raw.singleArm ?? raw.singleLeg);
    }
    if (says.primary) merged.primary = parseGroup(raw.primary ?? raw.group ?? raw.muscle ?? raw.volumeGroup);
    if (says.secondary) {
      merged.secondary = parseGroups(
        raw.secondary ?? raw.others ?? raw.otherMuscles ?? raw.assisting, merged.primary,
      );
    }
    if (says.notes) merged.notes = raw.notes ?? raw.note;
    const before = JSON.stringify({ ...existing, updatedAt: 0 });
    const saved = await saveExercise(merged);
    if (saved && JSON.stringify({ ...saved, updatedAt: 0 }) !== before) out.updated++;
    else out.unchanged++;
    if (saved) {
      if (saved.primary) out.groups.add(saved.primary);
      saved.secondary.forEach((g) => out.groups.add(g));
    }
  }

  if (mode === 'replace') {
    const doomed = state.exercises.filter((x) => !incoming.has(x.key)).map((x) => x.key);
    for (const key of doomed) await deleteExercise(key);
    out.removed = doomed.length;
  }

  return { ...out, groups: [...out.groups].sort() };
}

/** Wipe the library. Used by a whole-database restore. */
export async function clearLibrary() {
  state.exercises = [];
  await dbClear('exercises');
  emit();
}

/** Write a whole library in one go, for a restore. */
export async function restoreLibrary(rows = []) {
  state.exercises = rows.map(normalizeExercise).filter((x) => x.key);
  sortLibrary();
  await dbClear('exercises');
  await Promise.all(state.exercises.map((ex) => dbPut('exercises', ex)));
  emit();
  return state.exercises.length;
}
