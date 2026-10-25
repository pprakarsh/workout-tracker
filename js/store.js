// Application state + persistence. Everything lives on this device: IndexedDB only.
import { dbGetAll, dbPut, dbDel, dbClear, metaGet, metaSet } from './db.js';
import { uid, num, parseReps, parseDur, normName } from './util.js';

export const DEFAULT_SETTINGS = {
  unit: 'kg',            // default load unit for new sets
  distanceUnit: 'km',
  defaultRest: 120,      // seconds, used when a routine entry has no rest target
  beep: true,            // sound when the rest target is reached
};

export const state = {
  ready: false,
  routines: [],
  sessions: [],          // every session, newest first
  active: null,          // the in-progress session object (also present in .sessions)
  settings: { ...DEFAULT_SETTINGS },
  timer: null,           // { startedAt, target, sessionId, entryId, setId, label, beeped }
  tab: 'now',
  nav: {},               // per-tab sub-navigation, e.g. { routineId, sessionId }
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => listeners.forEach((fn) => fn());

/* ------------------------------------------------------------------ */
/* normalisation                                                       */
/* ------------------------------------------------------------------ */

/** Coerce any loosely-shaped entry (hand-written JSON included) into our shape. */
export function normalizeEntry(raw = {}) {
  const type = String(raw.type || '').toLowerCase() === 'cardio' ? 'cardio' : 'lift';
  const reps = parseReps(
    raw.reps !== undefined ? raw.reps
      : (raw.repsMin !== undefined || raw.repsMax !== undefined)
        ? { min: raw.repsMin, max: raw.repsMax }
        : raw.targetReps,
  );
  const group = raw.group ?? raw.groupId ?? raw.superset ?? null;
  return {
    id: raw.id || uid('e'),
    type,
    name: String(raw.name || raw.exercise || 'Exercise').trim(),
    group: group === null || group === undefined || group === '' ? null : String(group).trim(),
    // lift targets
    targetSets: num(raw.targetSets ?? raw.sets) ?? (type === 'lift' ? 3 : null),
    repsMin: reps.min,
    repsMax: reps.max,
    weight: num(raw.weight ?? raw.targetWeight),
    unit: raw.unit || null,
    // cardio targets
    targetDistance: num(raw.distance ?? raw.targetDistance),
    distanceUnit: raw.distanceUnit || null,
    targetDuration: parseDur(raw.duration ?? raw.targetDuration),
    // shared
    rest: parseDur(raw.rest ?? raw.restSeconds ?? raw.restTime),
    notes: String(raw.notes || raw.note || '').trim(),
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

const blankSet = (unit) => ({
  id: uid('s'), weight: null, unit, reps: null, rpe: null,
  note: '', done: false, completedAt: null, rest: null,
});

const blankLog = (distanceUnit) => ({
  distance: null, distanceUnit, duration: null,
  avgHr: null, maxHr: null, elevation: null,
  rpe: null, note: '', done: false, completedAt: null,
});

/** Routine entry -> session entry (a snapshot; editing it never touches the routine). */
function toSessionEntry(entry, settings) {
  const e = normalizeEntry(entry);
  return {
    ...e,
    id: uid('e'),          // fresh id: the session copy is its own thing
    sourceId: e.id,        // remembers which routine entry it came from
    unit: e.unit || settings.unit,
    distanceUnit: e.distanceUnit || settings.distanceUnit,
    sets: e.type === 'lift' ? [] : null,
    log: e.type === 'cardio' ? blankLog(e.distanceUnit || settings.distanceUnit) : null,
    skipped: false,
  };
}

/* ------------------------------------------------------------------ */
/* load                                                               */
/* ------------------------------------------------------------------ */

export async function init() {
  const [routines, sessions, settings, activeId, timer] = await Promise.all([
    dbGetAll('routines'),
    dbGetAll('sessions'),
    metaGet('settings', null),
    metaGet('activeSessionId', null),
    metaGet('timer', null),
  ]);
  state.routines = (routines || []).map(normalizeRoutine)
    .sort((a, b) => a.name.localeCompare(b.name));
  state.sessions = (sessions || []).sort((a, b) => b.startedAt - a.startedAt);
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.active = activeId ? state.sessions.find((s) => s.id === activeId && !s.finishedAt) || null : null;
  state.timer = timer && timer.startedAt ? timer : null;
  // a timer belonging to a session that is gone or finished is stale
  if (state.timer && state.timer.sessionId && !state.active) state.timer = null;
  state.ready = true;
  emit();
}

/* ------------------------------------------------------------------ */
/* settings                                                          */
/* ------------------------------------------------------------------ */

export async function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await metaSet('settings', state.settings);
  emit();
}

/* ------------------------------------------------------------------ */
/* routines                                                          */
/* ------------------------------------------------------------------ */

function sortRoutines() {
  state.routines.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveRoutine(routine) {
  routine.updatedAt = Date.now();
  const i = state.routines.findIndex((r) => r.id === routine.id);
  if (i >= 0) state.routines[i] = routine; else state.routines.push(routine);
  sortRoutines();
  await dbPut('routines', routine);
  emit();
  return routine;
}

export async function createRoutine({ name, description = '', entries = [] }) {
  return saveRoutine(normalizeRoutine({ name, description, entries }));
}

export async function deleteRoutine(id) {
  state.routines = state.routines.filter((r) => r.id !== id);
  await dbDel('routines', id);
  emit();
}

export async function duplicateRoutine(id) {
  const r = state.routines.find((x) => x.id === id);
  if (!r) return null;
  return createRoutine({
    name: `${r.name} (copy)`,
    description: r.description,
    entries: r.entries.map((e) => ({ ...e, id: undefined })),
  });
}

export const getRoutine = (id) => state.routines.find((r) => r.id === id) || null;

/* ------------------------------------------------------------------ */
/* sessions                                                          */
/* ------------------------------------------------------------------ */

export async function persistSession(session) {
  session.updatedAt = Date.now();
  const i = state.sessions.findIndex((s) => s.id === session.id);
  if (i >= 0) state.sessions[i] = session;
  else state.sessions.unshift(session);
  await dbPut('sessions', session);
}

/** Persist the active session, optionally without triggering a re-render. */
async function touch({ silent = false } = {}) {
  if (!state.active) return;
  await persistSession(state.active);
  if (!silent) emit();
}

export async function startSession(routineId) {
  if (state.active) throw new Error('A workout is already in progress');
  const r = getRoutine(routineId);
  const session = {
    id: uid('w'),
    routineId: r ? r.id : null,
    routineName: r ? r.name : 'Ad-hoc workout',
    routineDescription: r ? r.description : '',
    startedAt: Date.now(),
    finishedAt: null,
    unit: state.settings.unit,
    entries: (r ? r.entries : []).map((e) => toSessionEntry(e, state.settings)),
    currentIdx: 0,
    rpe: null,
    bodyweight: null,
    notes: '',
    modified: false,     // set when the snapshot diverges from the routine
  };
  state.active = session;
  await persistSession(session);
  await metaSet('activeSessionId', session.id);
  state.tab = 'now';
  emit();
  return session;
}

export async function finishSession() {
  const s = state.active;
  if (!s) return null;
  s.finishedAt = Date.now();
  await persistSession(s);
  state.active = null;
  state.timer = null;
  await metaSet('activeSessionId', null);
  await metaSet('timer', null);
  emit();
  return s;
}

export async function discardSession() {
  const s = state.active;
  if (!s) return;
  state.sessions = state.sessions.filter((x) => x.id !== s.id);
  await dbDel('sessions', s.id);
  state.active = null;
  state.timer = null;
  await metaSet('activeSessionId', null);
  await metaSet('timer', null);
  emit();
}

export async function deleteSession(id) {
  if (state.active && state.active.id === id) return discardSession();
  state.sessions = state.sessions.filter((x) => x.id !== id);
  await dbDel('sessions', id);
  emit();
}

export const getSession = (id) => state.sessions.find((s) => s.id === id) || null;

/** Push the live session's exercise list back onto its source routine. */
export async function saveSessionBackToRoutine() {
  const s = state.active;
  if (!s || !s.routineId) return null;
  const r = getRoutine(s.routineId);
  if (!r) return null;
  const prior = new Map(r.entries.map((e) => [e.id, e]));
  r.entries = s.entries
    .filter((e) => !e.skipped)
    // Keep the original routine entry ids where the exercise came from the routine,
    // and don't bake the session's resolved units into the routine: a routine only
    // carries a unit if it was explicitly given one.
    .map((e) => {
      const src = e.sourceId ? prior.get(e.sourceId) : null;
      return normalizeEntry({
        ...e,
        id: e.sourceId || uid('e'),
        unit: src ? src.unit : null,
        distanceUnit: src ? src.distanceUnit : null,
      });
    });
  s.modified = false;
  await touch({ silent: true });
  return saveRoutine(r);
}

/* ------------------------------------------------------------------ */
/* live session: entries                                              */
/* ------------------------------------------------------------------ */

export const entryIndex = (id) =>
  state.active ? state.active.entries.findIndex((e) => e.id === id) : -1;
export const findEntry = (id) =>
  state.active ? state.active.entries.find((e) => e.id === id) || null : null;

/**
 * Indices that make up the "block" at idx: a contiguous run of entries sharing
 * the same non-empty group (a superset / circuit). Ungrouped entries are alone.
 */
export function blockAt(entries, idx) {
  if (!entries.length) return [];
  idx = Math.min(Math.max(idx, 0), entries.length - 1);
  const g = entries[idx].group;
  if (!g) return [idx];
  let a = idx; let b = idx;
  while (a - 1 >= 0 && entries[a - 1].group === g) a--;
  while (b + 1 < entries.length && entries[b + 1].group === g) b++;
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export async function setCurrent(idx) {
  if (!state.active) return;
  state.active.currentIdx = Math.min(Math.max(idx, 0), Math.max(state.active.entries.length - 1, 0));
  await touch();
}

export async function stepBlock(dir) {
  const s = state.active;
  if (!s || !s.entries.length) return;
  const blk = blockAt(s.entries, s.currentIdx);
  const target = dir > 0 ? blk[blk.length - 1] + 1 : blk[0] - 1;
  if (target < 0 || target >= s.entries.length) return;
  s.currentIdx = blockAt(s.entries, target)[0];
  await touch();
}

export async function addSessionEntry(raw) {
  const s = state.active;
  if (!s) return null;
  const e = toSessionEntry(raw, state.settings);
  s.entries.push(e);
  s.modified = true;
  await touch();
  return e;
}

export async function updateSessionEntry(entryId, patch, opts) {
  const e = findEntry(entryId);
  if (!e) return;
  Object.assign(e, patch);
  state.active.modified = true;
  await touch(opts);
}

export async function removeSessionEntry(entryId) {
  const s = state.active;
  if (!s) return;
  const i = entryIndex(entryId);
  if (i < 0) return;
  s.entries.splice(i, 1);
  s.currentIdx = Math.min(s.currentIdx, Math.max(s.entries.length - 1, 0));
  s.modified = true;
  await touch();
}

export async function moveSessionEntry(entryId, dir) {
  const s = state.active;
  if (!s) return;
  const i = entryIndex(entryId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= s.entries.length) return;
  const cur = s.entries[s.currentIdx];
  [s.entries[i], s.entries[j]] = [s.entries[j], s.entries[i]];
  if (cur) s.currentIdx = s.entries.indexOf(cur);
  s.modified = true;
  await touch();
}

export async function toggleSkip(entryId) {
  const e = findEntry(entryId);
  if (!e) return;
  e.skipped = !e.skipped;
  state.active.modified = true;
  await touch();
}

/* ------------------------------------------------------------------ */
/* live session: sets                                                 */
/* ------------------------------------------------------------------ */

export async function addSet(entryId) {
  const e = findEntry(entryId);
  if (!e || e.type !== 'lift') return null;
  const prev = e.sets[e.sets.length - 1];
  const set = blankSet(e.unit || state.settings.unit);
  // Prefill from the previous set, else from the routine target.
  set.weight = prev ? prev.weight : (e.weight ?? null);
  set.reps = prev ? prev.reps : (e.repsMin ?? e.repsMax ?? null);
  e.sets.push(set);
  await touch();
  return set;
}

export async function updateSet(entryId, setId, patch, opts) {
  const e = findEntry(entryId);
  if (!e || !e.sets) return;
  const set = e.sets.find((s) => s.id === setId);
  if (!set) return;
  Object.assign(set, patch);
  await touch(opts);
}

export async function deleteSet(entryId, setId) {
  const e = findEntry(entryId);
  if (!e || !e.sets) return;
  e.sets = e.sets.filter((s) => s.id !== setId);
  await touch();
}

export async function toggleSetDone(entryId, setId) {
  const e = findEntry(entryId);
  const set = e?.sets?.find((s) => s.id === setId);
  if (!set) return;
  set.done = !set.done;
  set.completedAt = set.done ? Date.now() : null;
  await touch();
}

export async function updateLog(entryId, patch, opts) {
  const e = findEntry(entryId);
  if (!e || e.type !== 'cardio') return;
  e.log = { ...e.log, ...patch };
  await touch(opts);
}

export async function updateSessionMeta(patch, opts) {
  if (!state.active) return;
  Object.assign(state.active, patch);
  await touch(opts);
}

/* ------------------------------------------------------------------ */
/* rest timer state (ticking lives in timer.js)                       */
/* ------------------------------------------------------------------ */

export async function startRest({ target, entryId = null, setId = null, label = '' }) {
  state.timer = {
    startedAt: Date.now(),
    target: target ?? state.settings.defaultRest,
    sessionId: state.active ? state.active.id : null,
    entryId, setId, label, beeped: false,
  };
  await metaSet('timer', state.timer);
  emit();
}

export async function setRestTarget(target) {
  if (!state.timer) return;
  state.timer.target = Math.max(0, Math.round(target));
  state.timer.beeped = false;
  await metaSet('timer', state.timer);
  emit();
}

/** Stop the timer and record the actual rest against the set it was started from. */
export async function stopRest() {
  const t = state.timer;
  if (!t) return null;
  const elapsed = Math.round((Date.now() - t.startedAt) / 1000);
  state.timer = null;
  await metaSet('timer', null);
  if (t.entryId && t.setId && state.active && state.active.id === t.sessionId) {
    await updateSet(t.entryId, t.setId, { rest: elapsed }, { silent: true });
  }
  emit();
  return elapsed;
}

export async function markBeeped() {
  if (!state.timer) return;
  state.timer.beeped = true;
  await metaSet('timer', state.timer);
}

/* ------------------------------------------------------------------ */
/* whole-database replace (device-to-device restore)                  */
/* ------------------------------------------------------------------ */

/**
 * Wipe this device's data and write the backup verbatim — same ids, same
 * in-progress session, same running rest timer — so the app is byte-for-byte
 * the state the backup was taken from.
 */
export async function restoreAll({ routines = [], sessions = [], settings = null, activeSessionId = null, timer = null }) {
  await Promise.all([dbClear('routines'), dbClear('sessions')]);

  state.routines = routines.map(normalizeRoutine);
  sortRoutines();
  state.sessions = sessions
    .filter((s) => s && s.id && s.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt);

  await Promise.all([
    ...state.routines.map((r) => dbPut('routines', r)),
    ...state.sessions.map((s) => dbPut('sessions', s)),
  ]);

  if (settings) state.settings = { ...DEFAULT_SETTINGS, ...settings };
  await metaSet('settings', state.settings);

  state.active = activeSessionId
    ? state.sessions.find((s) => s.id === activeSessionId && !s.finishedAt) || null
    : null;
  await metaSet('activeSessionId', state.active ? state.active.id : null);

  state.timer = timer && timer.startedAt && (!timer.sessionId || state.active) ? timer : null;
  await metaSet('timer', state.timer);

  state.nav = {};
  emit();
  return { routines: state.routines.length, sessions: state.sessions.length };
}

/** Counts you can eyeball on both devices to confirm a restore matched. */
export function dataFingerprint() {
  let sets = 0;
  state.sessions.forEach((s) => s.entries.forEach((e) => {
    sets += e.type === 'cardio' ? (e.log && (e.log.done || e.log.distance !== null) ? 1 : 0) : (e.sets || []).length;
  }));
  const oldest = state.sessions.length ? Math.min(...state.sessions.map((s) => s.startedAt)) : null;
  const newest = state.sessions.length ? Math.max(...state.sessions.map((s) => s.startedAt)) : null;
  return {
    routines: state.routines.length,
    sessions: state.sessions.length,
    loggedSets: sets,
    oldest,
    newest,
  };
}

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

/**
 * The most recent logged instance of an exercise, for the "last time" reference.
 * Returns { session, entry } or null. Skips the live session.
 */
export function lastLogFor(name, excludeSessionId = null) {
  const key = normName(name);
  if (!key) return null;
  for (const s of state.sessions) {
    if (s.id === excludeSessionId) continue;
    if (state.active && s.id === state.active.id) continue;
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

/* ------------------------------------------------------------------ */
/* progress helpers                                                   */
/* ------------------------------------------------------------------ */

export function entryStatus(e) {
  if (e.skipped) return 'skipped';
  if (e.type === 'cardio') return e.log?.done ? 'done' : 'pending';
  const sets = e.sets || [];
  const done = sets.filter((s) => s.done).length;
  if (!done) return 'pending';
  const target = e.targetSets ?? sets.length;
  return done >= target ? 'done' : 'partial';
}

export function sessionProgress(s) {
  const live = s.entries.filter((e) => !e.skipped);
  const done = live.filter((e) => entryStatus(e) === 'done').length;
  return { done, total: live.length };
}

export function sessionVolume(s) {
  let v = 0;
  s.entries.forEach((e) => (e.sets || []).forEach((x) => {
    if (x.done && x.weight !== null && x.reps !== null) v += x.weight * x.reps;
  }));
  return Math.round(v);
}
