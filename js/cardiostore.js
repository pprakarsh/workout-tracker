// Writes for a cardio log: the run's numbers, and an interval block's rounds.
//
// The same shape as js/planstore.js -- it imports `state`, `emit`, `findEntry`
// and `touch` from the store and is never imported BY the store, so the
// dependency stays one-way. It lives outside store.js because store.js reached
// its 1000-line cap again, and the cardio log is a self-contained slice of it.
//
// The ARITHMETIC is in js/cardio.js, which is pure. This is persistence.
import { state, emit, findEntry, touch, working } from './store.js';
import { resolveRun, isIntervals, plannedLegs, reconcileLegs } from './cardio.js';

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
