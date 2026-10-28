// Application state + persistence. Everything lives on this device: IndexedDB only.
import { dbGetAll, dbPut, dbDel, dbClear, metaGet, metaSet } from './db.js';
import { uid, num, parseReps, parseDur } from './util.js';
import { resolveRun, isIntervals, plannedLegs, reconcileLegs, cardioLogged } from './cardio.js';
import {
  blankSet, expandEntry, materializePlan, normalizeEntry, normalizeRoutine,
  parseSetTargets, setLabels, workingSets,
} from './model.js';

// Re-exported so the store stays the single front door for callers: views ask
// the store for everything about a session, shape helpers included.
export {
  normalizeEntry, normalizeRoutine, parseSetTargets, setLabels, workingSets, materializePlan,
};

export const DEFAULT_SETTINGS = {
  unit: 'kg',            // default load unit for new sets
  distanceUnit: 'km',
  defaultRest: 120,      // seconds, used when a routine entry has no rest target
  beep: true,            // sound when the rest target is reached
  keepAwake: true,       // hold a screen wake lock while a workout is running
  weightStep: 2.5,       // the +/- stepper increment for weight
  effortScale: 'rpe',    // 'rpe' | 'rir' | 'both' -- which effort column(s) to log
};

export const state = {
  ready: false,
  routines: [],
  sessions: [],          // every session, newest first
  active: null,          // the in-progress session object (also present in .sessions)
  editSessionId: null,   // a FINISHED session opened for correction in History
  // transient view state: which interval blocks have their rounds expanded.
  // Not persisted -- it is a disclosure triangle, not data.
  openRounds: new Set(),
  settings: { ...DEFAULT_SETTINGS },
  timer: null,           // { startedAt, target, sessionId, entryId, setId, label, beeped }
  tab: 'now',
  nav: {},               // per-tab sub-navigation, e.g. { routineId, sessionId }
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => listeners.forEach((fn) => fn());

/**
 * The session the editing actions apply to: normally the live workout, but a
 * finished session while one is open for correction in History. Everything that
 * mutates entries/sets goes through this, so the same UI serves both.
 */
export function working() {
  if (state.editSessionId) {
    return state.sessions.find((s) => s.id === state.editSessionId) || null;
  }
  return state.active;
}

/** True when the thing being edited is a past session, not the live workout. */
export const editingPast = () => !!state.editSessionId;

export async function setEditing(sessionId) {
  state.editSessionId = sessionId || null;
  emit();
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

/** Persist whatever session is being edited, optionally without re-rendering. */
async function touch({ silent = false } = {}) {
  const s = working();
  if (!s) return;
  await persistSession(s);
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
    entries: (r ? r.entries : []).flatMap((e) => expandEntry(e, state.settings)),
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
  if (state.editSessionId === id) state.editSessionId = null;
  state.sessions = state.sessions.filter((x) => x.id !== id);
  await dbDel('sessions', id);
  emit();
}

export const getSession = (id) => state.sessions.find((s) => s.id === id) || null;

/** Push the edited session's exercise list back onto its source routine. */
export async function saveSessionBackToRoutine() {
  const s = working();
  if (!s || !s.routineId) return null;
  const r = getRoutine(s.routineId);
  if (!r) return null;
  const prior = new Map(r.entries.map((e) => [e.id, e]));
  // Expanded interval reps collapse back into a single entry carrying `repeat`,
  // otherwise a 6x400m routine would grow to six lines every time it was saved.
  const repCount = new Map();
  s.entries.forEach((e) => {
    if (e.repTotal && e.sourceId) repCount.set(e.sourceId, (repCount.get(e.sourceId) || 0) + 1);
  });
  r.entries = s.entries
    .filter((e) => !e.skipped)
    .filter((e) => !e.repTotal || e.repIndex === 1)
    // Keep the original routine entry ids where the exercise came from the routine,
    // and don't bake the session's resolved units into the routine: a routine only
    // carries a unit if it was explicitly given one.
    .map((e) => {
      const src = e.sourceId ? prior.get(e.sourceId) : null;
      return normalizeEntry({
        id: e.sourceId || uid('e'),
        type: e.type,
        name: e.name,
        group: e.group,
        targetSets: e.targetSets,
        setTargets: e.setTargets,
        repsMin: e.repsMin,
        repsMax: e.repsMax,
        weight: e.weight,
        targetDistance: e.targetDistance,
        targetDuration: e.targetDuration,
        targetPace: e.targetPace,
        legs: e.legs,
        rounds: e.rounds,
        rest: e.rest,
        notes: e.notes,
        repeat: e.repTotal ? (repCount.get(e.sourceId) || e.repTotal) : null,
        // a routine only carries a unit if it was explicitly given one, so don't
        // bake in the unit the session happened to resolve
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

export const entryIndex = (id) => {
  const s = working();
  return s ? s.entries.findIndex((e) => e.id === id) : -1;
};
export const findEntry = (id) => {
  const s = working();
  return s ? s.entries.find((e) => e.id === id) || null : null;
};

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
  const s = working();
  if (!s) return;
  s.currentIdx = Math.min(Math.max(idx, 0), Math.max(s.entries.length - 1, 0));
  await touch();
}

export async function stepBlock(dir) {
  const s = working();
  if (!s || !s.entries.length) return;
  const blk = blockAt(s.entries, s.currentIdx);
  const target = dir > 0 ? blk[blk.length - 1] + 1 : blk[0] - 1;
  if (target < 0 || target >= s.entries.length) return;
  s.currentIdx = blockAt(s.entries, target)[0];
  await touch();
}

export async function addSessionEntry(raw) {
  const s = working();
  if (!s) return null;
  const made = expandEntry(raw, state.settings);
  s.entries.push(...made);
  s.modified = true;
  await touch();
  return made[0];
}

export async function updateSessionEntry(entryId, patch, opts) {
  const e = findEntry(entryId);
  if (!e) return;
  Object.assign(e, patch);
  const s = working();
  if (s) s.modified = true;
  await touch(opts);
}

export async function removeSessionEntry(entryId) {
  const s = working();
  if (!s) return;
  const i = entryIndex(entryId);
  if (i < 0) return;
  s.entries.splice(i, 1);
  s.currentIdx = Math.min(s.currentIdx, Math.max(s.entries.length - 1, 0));
  s.modified = true;
  await touch();
}

export async function moveSessionEntry(entryId, dir) {
  const s = working();
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
  const s = working();
  if (s) s.modified = true;
  await touch();
}

/* ------------------------------------------------------------------ */
/* live session: sets                                                 */
/* ------------------------------------------------------------------ */

/**
 * The set the confirm button acts on: the first working set not yet done.
 * Warmups are included only if they come before it, so a warmup you have not
 * ticked is offered first.
 */
export function activeSet(e) {
  if (!e || e.type !== 'lift') return null;
  return (e.sets || []).find((s) => !s.done) || null;
}

/** The planned target for set number i (0-based), per-set plan first. */
export function plannedSet(e, i) {
  if (!e || e.type !== 'lift') return null;
  if (e.setTargets && e.setTargets[i]) return e.setTargets[i];
  if (e.weight !== null || e.repsMin !== null || e.repsMax !== null) {
    return { weight: e.weight, repsMin: e.repsMin, repsMax: e.repsMax };
  }
  return null;
}

export async function addSet(entryId, { warmup = false } = {}) {
  const e = findEntry(entryId);
  if (!e || e.type !== 'lift') return null;
  const prev = e.sets[e.sets.length - 1];
  const set = blankSet(e.unit || state.settings.unit, warmup);
  set.bodyweight = !!e.bodyweight;
  if (warmup) {
    // a warmup has no planned target; start from the previous set or the first target
    const ref = plannedSet(e, 0) || prev;
    set.weight = ref ? (ref.weight ?? null) : null;
    set.reps = ref ? (ref.reps ?? ref.repsMin ?? null) : null;
    // Warmups come first. With the plan pre-materialised, appending would put a
    // warmup after the working sets it precedes in reality.
    let at = 0;
    while (at < e.sets.length && e.sets[at].warmup) at++;
    e.sets.splice(at, 0, set);
    await touch();
    return set;
  }
  // planned targets are indexed by WORKING set number, so warmups don't shift them
  const workingCount = workingSets(e).length;
  const plan = plannedSet(e, workingCount);
  if (e.setTargets && e.setTargets[workingCount]) {
    set.weight = plan.weight ?? (prev ? prev.weight : null);
    set.reps = plan.repsMin ?? plan.repsMax ?? (prev ? prev.reps : null);
  } else {
    const prevWorking = workingSets(e).slice(-1)[0];
    set.weight = prevWorking ? prevWorking.weight : (e.weight ?? null);
    set.reps = prevWorking ? prevWorking.reps : (e.repsMin ?? e.repsMax ?? null);
  }
  e.sets.push(set);
  await touch();
  return set;
}

/**
 * Start resting after a specific set, whatever state that set is in.
 *
 * Deliberately independent of whether a weight or reps have been entered: the
 * clock is time-critical and the numbers are not. If a timer is already running
 * for another set it is stopped first, recording what it measured, rather than
 * silently discarded.
 */
export async function startRestForSet(entryId, setId) {
  const e = findEntry(entryId);
  const set = e?.sets?.find((x) => x.id === setId);
  if (!set) return null;
  const t = state.timer;
  if (t) {
    if (t.entryId === entryId && t.setId === setId) return { already: true };
    await stopRest();                 // records the previous set's rest first
  }
  const labels = setLabels(e.sets);
  await startRest({
    target: e.rest ?? state.settings.defaultRest,
    entryId,
    setId,
    label: `Rest after ${e.name} set ${labels[e.sets.indexOf(set)]}`,
  });
  return { started: true };
}

/**
 * Correct the recorded rest for a set. Rest is normally written when you stop
 * the timer, so this covers forgetting to start it, stopping it late, or fixing
 * it days later. Pass null to mark it as not logged again.
 */
export async function setRestFor(entryId, setId, seconds) {
  const e = findEntry(entryId);
  const set = e?.sets?.find((x) => x.id === setId);
  if (!set) return;
  set.rest = seconds === null || seconds === undefined ? null : Math.max(0, Math.round(seconds));
  await touch();
}

/**
 * Undo a confirmed set: un-tick it and, if the rest timer was started by that
 * same tap, cancel it without recording any rest. For a mis-tap, nothing
 * should be left behind.
 */
export async function undoSet(entryId, setId) {
  const e = findEntry(entryId);
  const set = e?.sets?.find((x) => x.id === setId);
  if (!set) return null;
  set.done = false;
  set.completedAt = null;
  const t = state.timer;
  if (t && t.entryId === entryId && t.setId === setId) {
    set.rest = null;
    state.timer = null;
    await metaSet('timer', null);
  }
  await touch();
  return set;
}

export async function toggleBodyweight(entryId, setId) {
  const e = findEntry(entryId);
  const set = e?.sets?.find((x) => x.id === setId);
  if (!set) return;
  set.bodyweight = !set.bodyweight;
  await touch();
}

export async function toggleWarmup(entryId, setId) {
  const e = findEntry(entryId);
  const set = e?.sets?.find((x) => x.id === setId);
  if (!set) return;
  set.warmup = !set.warmup;
  await touch();
}

/** Create every remaining planned set in one go. */
export async function fillPlannedSets(entryId) {
  const e = findEntry(entryId);
  if (!e || e.type !== 'lift') return 0;
  const want = e.setTargets ? e.setTargets.length : (e.targetSets ?? 0);
  let made = 0;
  while (workingSets(e).length < want) {
    const i = workingSets(e).length;
    const plan = plannedSet(e, i);
    const set = blankSet(e.unit || state.settings.unit);
    set.weight = plan ? (plan.weight ?? null) : null;
    set.reps = plan ? (plan.repsMin ?? plan.repsMax ?? null) : null;
    e.sets.push(set);
    made++;
  }
  if (made) await touch();
  return made;
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

/** Show or hide the per-round detail of one interval block. */
export async function toggleRounds(entryId) {
  if (state.openRounds.has(entryId)) state.openRounds.delete(entryId);
  else state.openRounds.add(entryId);
  emit();
}

/**
 * Edit a run's numbers. When one of {distance, duration, pace} changes the
 * others are brought back into line by resolveRun, so the three can never
 * disagree -- enter a time and a pace and the distance follows.
 */
export async function updateLog(entryId, patch, opts) {
  const e = findEntry(entryId);
  if (!e || e.type !== 'cardio') return;
  const anchor = ['pace', 'distance', 'duration'].find((k) => k in patch) || null;
  const next = { ...e.log, ...patch };
  e.log = anchor ? resolveRun(next, anchor) : next;
  await touch(opts);
}

/**
 * Log the whole interval block in one tap: every round takes its planned
 * numbers. This is the point of the pattern -- a treadmill block is one thing
 * you did, not six things to visit. Tapping again clears the block.
 */
export async function logAllRounds(entryId) {
  const e = findEntry(entryId);
  const legs = e?.log?.legs;
  if (!legs || !legs.length) return 0;
  const all = legs.every((x) => x.done);
  legs.forEach((x) => { x.done = !all; });
  e.log.done = !all;
  e.log.completedAt = all ? null : Date.now();
  await touch();
  return all ? 0 : legs.length;
}

/** Tick or un-tick one leg of one round. */
export async function toggleLeg(entryId, legId) {
  const e = findEntry(entryId);
  const leg = e?.log?.legs?.find((x) => x.id === legId);
  if (!leg) return;
  leg.done = !leg.done;
  e.log.done = e.log.legs.some((x) => x.done);
  e.log.completedAt = e.log.done ? (e.log.completedAt || Date.now()) : null;
  await touch();
}

/**
 * Change one round's numbers. The leg is flagged `edited`, which exempts it
 * from a later edit of the pattern: "round 4 was slower" must survive "the plan
 * was actually 1:15 throughout".
 */
export async function updateLeg(entryId, legId, patch, opts) {
  const e = findEntry(entryId);
  const leg = e?.log?.legs?.find((x) => x.id === legId);
  if (!leg) return;
  Object.assign(leg, patch, { edited: true });
  await touch(opts);
}

/** Drop the hand-edit on one leg and take the planned numbers back. */
export async function resetLeg(entryId, legId) {
  const e = findEntry(entryId);
  const leg = e?.log?.legs?.find((x) => x.id === legId);
  if (!leg || !isIntervals(e)) return;
  const plan = e.legs[leg.leg];
  if (!plan) return;
  Object.assign(leg, {
    label: plan.label || '', duration: plan.duration ?? null, pace: plan.pace ?? null, edited: false,
  });
  await touch();
}

/**
 * Replace the interval pattern on a live entry, re-expanding the rounds. Ticks
 * are kept and hand-edited legs keep their own numbers; see reconcileLegs.
 * Pass legs: null to turn the block back into one plain run.
 */
export async function setIntervalPlan(entryId, { legs, rounds }) {
  const e = findEntry(entryId);
  if (!e || e.type !== 'cardio') return;
  e.legs = legs && legs.length ? legs : null;
  e.rounds = e.legs ? Math.max(1, Math.round(rounds || 1)) : null;
  e.log = { ...e.log, legs: e.legs ? reconcileLegs(e, e.log?.legs || []) : null };
  const s = working();
  if (s) s.modified = true;   // the session now diverges from its routine
  await touch();
}

export async function updateSessionMeta(patch, opts) {
  const s = working();
  if (!s) return;
  Object.assign(s, patch);
  await touch(opts);
}

/**
 * Correct when a session happened. Used by the History editor, which also makes
 * it possible to log a workout you forgot and then move it to the right day.
 */
export async function updateSessionTiming(sessionId, { startedAt, finishedAt }) {
  const s = getSession(sessionId);
  if (!s) return null;
  if (Number.isFinite(startedAt)) s.startedAt = startedAt;
  if (Number.isFinite(finishedAt)) s.finishedAt = finishedAt;
  if (s.finishedAt && s.finishedAt < s.startedAt) s.finishedAt = s.startedAt;
  await persistSession(s);
  state.sessions.sort((a, b) => b.startedAt - a.startedAt);
  emit();
  return s;
}

/* ------------------------------------------------------------------ */
/* rest timer state (ticking lives in timer.js)                       */
/* ------------------------------------------------------------------ */

export async function startRest({ target, entryId = null, setId = null, label = '' }) {
  state.timer = {
    startedAt: Date.now(),
    target: target ?? state.settings.defaultRest,
    sessionId: working() ? working().id : null,
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
  const s = working();
  let pending = null;
  if (t.entryId && t.setId && s && s.id === t.sessionId) {
    await updateSet(t.entryId, t.setId, { rest: elapsed }, { silent: true });
    // The numbers may have been typed during the rest. If the set is complete
    // now, tick it; if not, say so rather than silently leaving it unlogged.
    const e = findEntry(t.entryId);
    const set = e?.sets?.find((x) => x.id === t.setId);
    if (set && !set.done) {
      if (setIsLoggable(set)) {
        set.done = true;
        set.completedAt = Date.now();
        await touch({ silent: true });
      } else {
        pending = { entryId: t.entryId, setId: t.setId };
      }
    }
  }
  emit();
  return { elapsed, pending };
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
  state.editSessionId = null;
  emit();
  return { routines: state.routines.length, sessions: state.sessions.length };
}

/** Counts you can eyeball on both devices to confirm a restore matched. */
export function dataFingerprint() {
  let sets = 0;
  state.sessions.forEach((s) => s.entries.forEach((e) => {
    // ticked sets only: pre-materialised rows are plan, and counting them would
    // inflate the number both devices compare after a restore
    sets += e.type === 'cardio'
      ? (cardioLogged(e.log) ? 1 : 0)
      : (e.sets || []).filter((x) => x.done).length;
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
/* progress helpers                                                   */
/* ------------------------------------------------------------------ */

export function entryStatus(e) {
  if (e.skipped) return 'skipped';
  if (e.type === 'cardio') return e.log?.done ? 'done' : 'pending';
  // warmups are not working sets: they count towards neither the target nor volume
  const sets = workingSets(e);
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

/**
 * Load moved, in the session's unit. A bodyweight set counts your bodyweight
 * plus any added load, but only when the session records a bodyweight -- we will
 * not invent a number. Without it, bodyweight sets contribute nothing rather
 * than guessing, which is why logging bodyweight is worth doing.
 */
export function sessionVolume(s) {
  let v = 0;
  s.entries.forEach((e) => workingSets(e).forEach((x) => {
    if (!x.done || x.reps === null) return;
    if (x.bodyweight) {
      if (s.bodyweight) v += (s.bodyweight + (x.weight || 0)) * x.reps;
      return;
    }
    if (x.weight !== null) v += x.weight * x.reps;
  }));
  return Math.round(v);
}

/** Can this set be confirmed, or does it still need a number? */
export function setIsLoggable(set) {
  if (!set) return false;
  if (set.reps === null) return false;
  return set.bodyweight || set.weight !== null;
}
