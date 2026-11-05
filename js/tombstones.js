// Deletions, remembered.
//
// THIS IS THE ONE PIECE OF SYNC GROUNDWORK THAT CANNOT BE ADDED LATER. Every
// record already carries `updatedAt`, so a future backend can find what
// changed. A deletion leaves nothing behind at all, so a device that deleted a
// routine last month is indistinguishable from a device that never had it --
// and on first sync the naive answer is to send it back. Every deletion the
// user has ever made would be undone, once, permanently.
//
// So a tombstone is written at the moment of deletion, when the information
// still exists. Nothing reads them yet. That is the point.
//
// A dedicated object store rather than a flag on the record, because a soft
// delete means every read path has to filter and the first one that forgets
// shows the user something they deleted. There are a lot of read paths here.
// A tombstone store is written once per deletion and read by nobody until a
// backend exists.
//
// THE INVARIANT: a record and its tombstone never both exist. Writing a record
// clears its tombstone, which is what makes merge-undo (it resurrects the
// exercise it deleted) and merge-import (it may restore a record you deleted)
// correct by construction rather than by remembering to handle them.
//
// The impure half of js/syncschema.js. Imports the db primitives and never
// `state`, so it can be called from the store, from exercisestore and from
// planstore without any of them forming a cycle.
import { dbGetAll, dbPut, dbDel, dbClear } from './db.js';
import { RECORD_STORES } from './syncschema.js';

/**
 * Every tombstone, by composite key, held in memory.
 *
 * Loaded once at boot so the clear-on-write check is a Map lookup rather than
 * an IndexedDB read. Writing a set is on the hot path -- every tick of a ✓
 * persists a session -- and paying a database round trip there to ask a
 * question whose answer is almost always "no" would be the wrong trade.
 */
let cache = new Map();
let loaded = false;

const composite = (store, id) => `${store}/${id}`;

/** Called by store.init(). Safe to call again; reloads from disk. */
export async function initTombstones() {
  const rows = await dbGetAll('tombstones').catch(() => []);
  cache = new Map((rows || []).filter((r) => r && r.key).map((r) => [r.key, r]));
  loaded = true;
  return cache.size;
}

/**
 * Record that a user deleted something.
 *
 * `replacedBy` names a successor where one exists. Only a merge can supply it,
 * and only at the instant it runs -- it is the one caller that knows both the
 * name being removed and the name taking its place. Reconstructing that
 * afterwards is impossible, which is why it is written now even though nothing
 * consumes it yet.
 */
export async function tombstone(store, id, { replacedBy = null } = {}) {
  if (!RECORD_STORES.includes(store)) {
    throw new Error(`tombstone: ${store} is not a record store`);
  }
  if (id === undefined || id === null || id === '') return null;
  const rec = {
    key: composite(store, id),
    store,
    id: String(id),
    deletedAt: Date.now(),
    replacedBy: replacedBy ? String(replacedBy) : null,
  };
  cache.set(rec.key, rec);
  await dbPut('tombstones', rec);
  return rec;
}

/**
 * Forget a deletion, because the record is back.
 *
 * Call this from the save primitives, not from the callers who happen to
 * resurrect something -- the whole value of the invariant is that no caller has
 * to know it exists.
 */
export async function clearTombstone(store, id) {
  const key = composite(store, id);
  // The overwhelmingly common case: writing a record that was never deleted.
  // A Map miss answers it with no database work at all.
  if (!cache.has(key)) return false;
  cache.delete(key);
  await dbDel('tombstones', key);
  return true;
}

/** Whether this id is currently tombstoned. */
export const isTombstoned = (store, id) => cache.has(composite(store, id));

/** One tombstone, or null. */
export const tombstoneFor = (store, id) => cache.get(composite(store, id)) || null;

/** All of them, newest deletion first. For the backend that does not exist yet. */
export const allTombstones = () => [...cache.values()]
  .sort((a, b) => b.deletedAt - a.deletedAt || a.key.localeCompare(b.key));

/** Deletions since a timestamp, for a delta push. `>=` so a same-ms delete counts. */
export const tombstonesSince = (ms = 0) => allTombstones().filter((t) => t.deletedAt >= ms);

/** How many are held. Cheap enough to show in a diagnostics panel. */
export const tombstoneCount = () => cache.size;

/** Whether the cache has been populated, so a caller can tell empty from unloaded. */
export const tombstonesLoaded = () => loaded;

/**
 * Drop every tombstone.
 *
 * Only for a whole-database replace, where this device is being made an exact
 * copy of a backup. Keeping them would re-delete records the backup contains,
 * which is the opposite of a restore.
 */
export async function clearAllTombstones() {
  cache = new Map();
  await dbClear('tombstones');
}
