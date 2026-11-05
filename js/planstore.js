// Writes for the 10-day plan: ONE RECORD PER DAY.
//
// The mirror of js/queries.js: that module reads derived values out of store
// state, this one writes one slice of it back. Both import `state` and `emit`
// from the store and neither is imported BY the store, so the dependency stays
// one-way. It lives outside store.js because store.js reached its 1000-line
// cap, and this was the cleanest seam available.
//
// What a planned day MEANS is js/plan.js, which is pure. This is persistence.
//
// WHY PER RECORD. The plan used to be one `meta.plan` blob holding a date-keyed
// map. That is fine on one device and silently lossy on two: both phones hold
// the whole map, so whichever writes last replaces the other's days wholesale,
// and the day you scheduled on the laptop quietly disappears. A date is a
// naturally collision-free key -- two devices editing Tuesday really are in
// conflict, and two devices editing different days are not -- so one record per
// day makes a future merge correct by construction.
//
// `state.plan` is still the same date-keyed map in memory, so no view changed.
//
// TWO KINDS OF DISAPPEARANCE, and the distinction is the whole reason this file
// got longer:
//
//   the user cleared a day      intent. Tombstoned, so it stays cleared when a
//                               backend eventually syncs.
//   prunePlan dropped a day     housekeeping, on a rule every device computes
//                               identically from the same data. NOT tombstoned
//                               -- a tombstone here would let this device's
//                               tidying delete a day another device still
//                               shows.
//
// Which is also why pruning is no longer on the write path. It runs once, at
// boot, from store.init(). Writing every day on every edit would also defeat a
// delta sync by bumping `updatedAt` on days nobody touched.
import { state, emit } from './store.js';
import { dbPut, dbDel, dbGetAll, metaSet } from './db.js';
import { tombstone, clearTombstone, isTombstoned } from './tombstones.js';
import { blankDay, prunePlan, isEmptyDay } from './plan.js';
import { scheduleRoutinePush } from './sync.js';

/** Persist exactly one day, or remove it. Nothing else is touched. */
async function writeDay(key, entry) {
  if (isEmptyDay(entry)) {
    delete state.plan[key];
    await dbDel('plan', key);
    // Emptied field by field until nothing was left is the same INTENT as
    // Clear, so it is tombstoned the same way.
    await tombstone('plan', key);
  } else {
    state.plan[key] = entry;
    await dbPut('plan', { key, ...entry, updatedAt: Date.now() });
    await clearTombstone('plan', key);
  }
  // The plan is the one thing you most want on your other phone -- what you are
  // doing tomorrow -- so a plan edit schedules a push like a routine edit does.
  scheduleRoutinePush();
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
  await writeDay(key, next);
  return state.plan[key] || null;
}

export async function clearPlanDay(key) {
  await writeDay(key, null);
}

/**
 * Tick a day by hand. Only for a day history cannot speak for -- you trained
 * without the app, or a partial session counts. A day with a matching finished
 * session already reads as done without this.
 */
export async function togglePlanDone(key) {
  const cur = state.plan[key] || blankDay();
  await writeDay(key, { ...cur, doneAt: cur.doneAt ? null : Date.now() });
  return state.plan[key] || null;
}

/** Move a day's plan to another day, swapping if the target is taken. */
export async function movePlanDay(fromKey, toKey) {
  if (fromKey === toKey) return false;
  const from = state.plan[fromKey];
  if (!from) return false;
  const to = state.plan[toKey] || null;
  // The target is written first: if the second write failed, a day duplicated
  // is recoverable by hand and a day lost is not.
  await writeDay(toKey, from);
  await writeDay(fromKey, to);
  return true;
}

/* ------------------------------------------------------------------ */
/* boot                                                              */
/* ------------------------------------------------------------------ */

/**
 * Load the plan, migrating a v2 `meta.plan` blob on the way if one is there.
 *
 * The migration is here rather than in db.js's onupgradeneeded because an
 * upgrade transaction is the wrong place to normalise domain data -- it cannot
 * call normalizePlan, and a half-normalised plan written inside a version
 * change is unrecoverable. Reading both sources and preferring the records is
 * idempotent, so a half-finished migration simply completes next launch.
 *
 * Returns the number of days migrated, so a test can tell a migration from a
 * normal load.
 */
export async function loadPlan(blob, normalize) {
  const rows = await dbGetAll('plan').catch(() => []);
  const fromStore = {};
  (rows || []).forEach((r) => {
    if (!r || !r.key) return;
    const { key, updatedAt, ...rest } = r;
    fromStore[key] = rest;
  });

  let migrated = 0;
  const blobDays = normalize(blob);
  Object.entries(blobDays).forEach(([key, v]) => {
    // Records win: a day present in both was already migrated and may since
    // have been edited, so the blob only fills gaps.
    if (key in fromStore) return;
    // And a gap is not always a gap. A day the user CLEARED after the migration
    // is also absent from the store, and is indistinguishable from one never
    // migrated -- so without this the blob resurrects it on the next launch,
    // every launch. The tombstone is what tells the two apart, which is why
    // store.init() loads tombstones before calling this.
    if (isTombstoned('plan', key)) return;
    fromStore[key] = v;
    migrated++;
  });

  state.plan = normalize(fromStore);
  if (migrated) {
    await Promise.all(Object.entries(state.plan)
      .map(([key, v]) => dbPut('plan', { key, ...v, updatedAt: Date.now() })));
    // Retire the blob. The migration is one-shot by design: leaving it in place
    // means two sources of truth for the same data, and the one that is never
    // written again always wins an argument it should not be in.
    await metaSet('plan', null);
  }
  return migrated;
}

/**
 * Drop empty and long-past days. Housekeeping, so it leaves no tombstones.
 *
 * Called once from store.init() rather than on every write, both because it is
 * not part of any edit and because re-writing untouched days would make every
 * one of them look changed to a delta sync.
 */
export async function prunePlanStore(now = Date.now()) {
  const kept = prunePlan(state.plan, now);
  const dropped = Object.keys(state.plan).filter((k) => !(k in kept));
  state.plan = kept;
  await Promise.all(dropped.map((k) => dbDel('plan', k)));
  return dropped.length;
}
