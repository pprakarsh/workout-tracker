// Minimal promise wrapper around IndexedDB. Three stores:
//   routines : { id, ... }
//   sessions : { id, startedAt, ... }
//   meta     : { key, value }   -- settings, activeSessionId, rest timer
const DB_NAME = 'workout-tracker';
const DB_VERSION = 1;

let _dbp = null;

export function openDb() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('routines')) {
        db.createObjectStore('routines', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked by another open tab'));
  });
  return _dbp;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name, mode) {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function dbGetAll(name) {
  return wrap((await store(name, 'readonly')).getAll());
}
export async function dbGet(name, key) {
  return wrap((await store(name, 'readonly')).get(key));
}
export async function dbPut(name, value) {
  return wrap((await store(name, 'readwrite')).put(value));
}
export async function dbDel(name, key) {
  return wrap((await store(name, 'readwrite')).delete(key));
}
export async function dbClear(name) {
  return wrap((await store(name, 'readwrite')).clear());
}

export async function metaGet(key, fallback = null) {
  const row = await dbGet('meta', key);
  return row === undefined || row === null ? fallback : row.value;
}
export async function metaSet(key, value) {
  return dbPut('meta', { key, value });
}

/** Rough storage usage, where the browser exposes it. */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
