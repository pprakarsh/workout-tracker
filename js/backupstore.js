// Whole-database replace, and the counts used to confirm one worked.
//
// Split out of store.js when it reached its 1000-line cap. The seam is a real
// one: store.js owns incremental state -- one routine, one session, one set at a
// time -- while this module replaces EVERYTHING at once, which is a different
// and much blunter operation with different failure modes. It is the landing
// point for a gist restore, a JSON backup and a device-to-device copy.
//
// A peer of store.js, like cardiostore.js and planstore.js: it imports state
// from the store and the store never imports it back.
import { state, emit, DEFAULT_SETTINGS } from './store.js';
import { dbClear, dbPut, metaSet } from './db.js';
import { normalizeRoutine } from './model.js';
import { normalizePlan, prunePlan } from './plan.js';
import { cardioLogged } from './cardio.js';

/**
 * Wipe this device's data and write the backup verbatim — same ids, same
 * in-progress session, same running rest timer — so the app is byte-for-byte
 * the state the backup was taken from.
 */
export async function restoreAll({
  routines = [], sessions = [], settings = null, activeSessionId = null, timer = null, plan = null,
}) {
  await Promise.all([dbClear('routines'), dbClear('sessions')]);

  state.routines = routines.map(normalizeRoutine);
  state.routines.sort((a, b) => a.name.localeCompare(b.name));
  state.sessions = sessions
    .filter((s) => s && s.id && s.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt);

  await Promise.all([
    ...state.routines.map((r) => dbPut('routines', r)),
    ...state.sessions.map((s) => dbPut('sessions', s)),
  ]);

  if (settings) state.settings = { ...DEFAULT_SETTINGS, ...settings };
  await metaSet('settings', state.settings);

  // a backup without a plan predates the Plan tab; leave what is here alone
  if (plan) {
    state.plan = prunePlan(normalizePlan(plan));
    await metaSet('plan', state.plan);
  }

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
