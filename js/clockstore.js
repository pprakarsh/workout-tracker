// The workout clock: rest, holds and the drop-set prompt.
//
// Split out of store.js when it reached its 1000-line cap. The seam is a real
// one: everything here is about ELAPSED TIME during a workout, and it is the
// only part of the store whose state is a timestamp rather than a record. The
// ticking, painting and beeping half lives in js/timer.js; this half owns what
// the clock IS and what stopping it writes down.
//
// One mechanism serves three jobs, distinguished by `kind`:
//
//   rest  counts toward a target, beeps, and writes elapsed into set.rest
//   hold  counts up, no beep, and writes elapsed into set.reps (a plank)
//   drop  counts up, no beep, writes nothing -- it is a prompt, not a measure
//
// They share one clock because they share the hard part: a start timestamp is
// the only representation that survives a reload, a screen lock and an app
// switch. A second ticking mechanism would have to re-earn all three, and two
// clocks eventually disagree.
//
// A peer of store.js, like cardiostore.js and backupstore.js: it imports from
// the store and the store never imports it back.
import {
  state, touch, working, findEntry, updateSet, setIsLoggable, emit,
} from './store.js';
import { setLabels } from './model.js';
import { metaSet } from './db.js';


export async function startRest({ target, entryId = null, setId = null, label = '', kind = 'rest' }) {
  state.timer = {
    kind,
    startedAt: Date.now(),
    target: target ?? state.settings.defaultRest,
    sessionId: working() ? working().id : null,
    entryId, setId, label, beeped: false,
  };
  await metaSet('timer', state.timer);
  emit();
}

/**
 * Time a HOLD rather than a rest -- a plank, a dead hang, an L-sit.
 *
 * The same clock does both. It already survives a reload, a screen lock and an
 * app switch because it stores a start timestamp rather than counting, and
 * building a second ticking mechanism to get those properties again is how two
 * timers end up disagreeing. `kind` is the only difference: a rest counts
 * toward a target and beeps, a hold counts up and writes what it measured.
 */
export async function startHold(entryId, setId) {
  const e = findEntry(entryId);
  const set = e?.sets?.find((x) => x.id === setId);
  if (!set || (e.measure || 'reps') !== 'time') return null;
  if (state.timer) await stopRest();          // bank whatever was running first
  const labels = setLabels(e.sets);
  await startRest({
    kind: 'hold',
    target: set.reps ?? e.repsMin ?? 0,       // the planned hold, for the progress ring
    entryId,
    setId,
    label: `${e.name} set ${labels[e.sets.indexOf(set)]}`,
  });
  return { started: true };
}

/**
 * Stop a hold and write the measured seconds into the set.
 *
 * The time is what the clock saw, not what was planned -- that is the whole
 * point of timing it. The set is NOT auto-ticked, because effort may still be
 * owed; the caller decides what to do next, exactly as stopRest does.
 */
export async function stopHold() {
  const t = state.timer;
  if (!t || t.kind !== 'hold') return null;
  const elapsed = Math.max(0, Math.round((Date.now() - t.startedAt) / 1000));
  state.timer = null;
  await metaSet('timer', null);
  const e = findEntry(t.entryId);
  const set = e?.sets?.find((x) => x.id === t.setId);
  if (set) {
    set.reps = elapsed;
    await touch({ silent: true });
  }
  emit();
  return { elapsed, entryId: t.entryId, setId: t.setId, loggable: set ? setIsLoggable(set, 'time') : false };
}

/**
 * Put the "drop now" bar up instead of a rest countdown.
 *
 * A drop set has no rest, so the usual clock would be actively misleading --
 * and a lifter who sees no bar at all cannot tell the app understood. This is
 * the same clock counting UP, with no target and no beep, so the seconds since
 * you racked it are visible: a drop that starts 40 seconds later is not a drop.
 * It clears itself when the drop stage is confirmed.
 */
export async function startDropNow(entryId, setId) {
  const e = findEntry(entryId);
  const set = e?.sets?.find((x) => x.id === setId);
  if (!set || !set.drop) return null;
  if (state.timer) await stopRest();          // bank whatever was running first
  const labels = setLabels(e.sets);
  await startRest({
    kind: 'drop',
    target: 0,
    entryId,
    setId,
    label: `${e.name} set ${labels[e.sets.indexOf(set)]}`,
  });
  return { started: true, set };
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
  if (t.kind === 'hold') return stopHold();   // a hold is stopped on its own terms
  const elapsed = Math.round((Date.now() - t.startedAt) / 1000);
  if (t.kind === 'drop') {
    // The drop clock measures nothing. It is attached to the set you are ABOUT
    // to do, and `rest` on a set means the rest taken after it, so writing
    // these seconds anywhere would state something false. The prompt just goes.
    state.timer = null;
    await metaSet('timer', null);
    emit();
    return { elapsed, drop: true, pending: null };
  }
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
      if (setIsLoggable(set, e.measure)) {
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

