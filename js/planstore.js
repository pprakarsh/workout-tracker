// Writes for the 10-day plan.
//
// The mirror of js/queries.js: that module reads derived values out of store
// state, this one writes one slice of it back. Both import `state` and `emit`
// from the store and neither is imported BY the store, so the dependency stays
// one-way. It lives outside store.js because store.js reached its 1000-line
// cap, and this was the cleanest seam available -- the plan needs only `state`,
// `emit` and `metaSet`, never `touch` or `findEntry`.
//
// What a planned day MEANS is js/plan.js, which is pure. This is persistence.
import { state, emit } from './store.js';
import { metaSet } from './db.js';
import { blankDay, prunePlan } from './plan.js';

async function persistPlan() {
  state.plan = prunePlan(state.plan);
  await metaSet('plan', state.plan);
  emit();
}

/** Put a routine on a day. `routineId: null` with rest clears or rests the day. */
export async function setPlanDay(key, { routineId = undefined, rest = undefined, note = undefined } = {}) {
  const cur = state.plan[key] || blankDay();
  const next = { ...cur };
  if (routineId !== undefined) next.routineId = routineId || null;
  if (rest !== undefined) next.rest = !!rest;
  if (note !== undefined) next.note = String(note || '').trim();
  // A rest day and a routine are mutually exclusive, and WHAT THE CALLER JUST
  // SET WINS. Resolving this the other way round let a day's existing rest flag
  // silently swallow the routine you had just chosen for it.
  if (routineId) next.rest = false;
  else if (rest) next.routineId = null;
  state.plan[key] = next;
  await persistPlan();
  return next;
}

export async function clearPlanDay(key) {
  delete state.plan[key];
  await persistPlan();
}

/**
 * Tick a day by hand. Only for a day history cannot speak for -- you trained
 * without the app, or a partial session counts. A day with a matching finished
 * session already reads as done without this.
 */
export async function togglePlanDone(key) {
  const cur = state.plan[key] || blankDay();
  state.plan[key] = { ...cur, doneAt: cur.doneAt ? null : Date.now() };
  await persistPlan();
  return state.plan[key];
}

/** Move a day's plan to another day, swapping if the target is taken. */
export async function movePlanDay(fromKey, toKey) {
  if (fromKey === toKey) return false;
  const from = state.plan[fromKey];
  if (!from) return false;
  const to = state.plan[toKey] || null;
  state.plan[toKey] = from;
  if (to) state.plan[fromKey] = to;
  else delete state.plan[fromKey];
  await persistPlan();
  return true;
}

