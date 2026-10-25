// Optional sync to a secret GitHub Gist.
//
// The whole backup is one JSON file in one gist ("blob sync"): simple, free, and
// every push becomes a gist revision you can inspect or restore in the browser.
// The trade-off is that it is last-write-wins over the entire dataset, so both
// push and pull check whether the other side moved on and ask before clobbering.
//
// The token is kept in IndexedDB under its own meta key, NOT in settings, so it
// never ends up inside an exported backup.
import { state, emit, dataFingerprint } from './store.js';
import { metaGet, metaSet } from './db.js';
import { backupObject, importFromText } from './exportimport.js';
import { uid, APP_VERSION } from './util.js';

const API = 'https://api.github.com';
export const FILE = 'workout-tracker-backup.json';

export const sync = {
  token: null,
  gistId: null,
  deviceId: null,
  autoPush: false,
  autoPull: true,        // on launch, fetch a newer copy when nothing local would be lost
  lastPushedAt: null,
  lastPulledAt: null,
  lastSeenRemoteMs: 0,   // the remote pushedAt we last observed
};

export async function initSync() {
  const saved = await metaGet('sync', null);
  if (saved) Object.assign(sync, saved);
  if (!sync.deviceId) {
    sync.deviceId = uid('dev');
    await persist();
  }
}

async function persist() {
  await metaSet('sync', { ...sync });
}

export const syncConfigured = () => !!sync.token;

export async function configureSync({ token, gistId, autoPush, autoPull }) {
  if (token !== undefined) sync.token = (token || '').trim() || null;
  if (gistId !== undefined) sync.gistId = (gistId || '').trim() || null;
  if (autoPush !== undefined) sync.autoPush = !!autoPush;
  if (autoPull !== undefined) sync.autoPull = !!autoPull;
  sync.lastSeenRemoteMs = 0;
  await persist();
  emit();
}

/* ------------------------------------------------------------------ */
/* pairing a second device                                            */
/* ------------------------------------------------------------------ */

/**
 * One string carrying the token and gist id, so a new device needs a single
 * paste instead of two. It contains the token, so treat it like a password.
 */
export function pairingCode() {
  if (!sync.token || !sync.gistId) return null;
  return btoa(JSON.stringify({ v: 1, t: sync.token, g: sync.gistId }));
}

/** Accepts a pairing code; returns null if the text is a raw token instead. */
export function parsePairing(text) {
  const s = String(text || '').trim();
  if (!s || /^(github_pat_|gh[pousr]_)/.test(s)) return null;
  try {
    const o = JSON.parse(atob(s));
    if (o && o.t) return { token: String(o.t), gistId: o.g ? String(o.g) : null };
  } catch { /* not a pairing code */ }
  return null;
}

export async function disconnectSync() {
  sync.token = null;
  sync.gistId = null;
  sync.autoPush = false;
  sync.lastPushedAt = null;
  sync.lastPulledAt = null;
  sync.lastSeenRemoteMs = 0;
  await persist();
  emit();
}

/* ------------------------------------------------------------------ */
/* GitHub API                                                         */
/* ------------------------------------------------------------------ */

async function gh(path, opts = {}) {
  if (!sync.token) throw new Error('No GitHub token configured.');
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${sync.token}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch (err) {
    throw new Error(`Could not reach GitHub — are you offline? (${err.message})`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      if (body && body.message) detail = `: ${body.message}`;
    } catch { /* no JSON body */ }
    if (res.status === 401) throw new Error('GitHub rejected the token (401). It may be wrong or expired.');
    if (res.status === 403) throw new Error(`GitHub refused the request (403)${detail}. The token probably lacks Gists write permission.`);
    if (res.status === 404) throw new Error('Gist not found (404). Check the gist id, and that this token can see it.');
    if (res.status === 422) throw new Error(`GitHub could not accept the data (422)${detail}.`);
    throw new Error(`GitHub API error ${res.status}${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

function payload() {
  return JSON.stringify({
    ...backupObject(),
    sync: {
      device: sync.deviceId,
      pushedAt: new Date().toISOString(),
      pushedAtMs: Date.now(),
      app: APP_VERSION,
    },
  }, null, 2);
}

/** Read the gist and return its parsed backup. */
export async function fetchRemote() {
  if (!sync.gistId) throw new Error('No gist yet — push once to create one.');
  const g = await gh(`/gists/${sync.gistId}`);
  const file = (g.files && (g.files[FILE] || Object.values(g.files)[0])) || null;
  if (!file) throw new Error('That gist has no files in it.');

  let content = file.content;
  if (file.truncated) {
    // The API inlines files up to 1 MB; beyond that it only gives a raw URL.
    try {
      const raw = await fetch(file.raw_url);
      if (!raw.ok) throw new Error(`status ${raw.status}`);
      content = await raw.text();
    } catch (err) {
      throw new Error(`The backup is over 1 MB and the raw download failed (${err.message}). Blob sync has outgrown a single gist file.`);
    }
  }

  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    throw new Error(`The gist does not contain valid JSON: ${err.message}`);
  }
  return {
    content,
    data,
    remotePushedAtMs: data?.sync?.pushedAtMs || Date.parse(g.updated_at) || 0,
    remoteDevice: data?.sync?.device || null,
    htmlUrl: g.html_url,
    counts: data?.counts || null,
  };
}

/**
 * Local records changed since the given instant. With ms = 0 (never synced)
 * everything counts, so a device with data is never wiped without asking.
 */
export function localChangesSince(ms) {
  const out = [];
  // >= not >: a record saved in the same millisecond as the sync marker is
  // treated as unsynced. Erring this way prompts an extra question; erring the
  // other way silently destroys a logged set.
  state.sessions.forEach((s) => {
    const at = s.updatedAt || s.finishedAt || s.startedAt || 0;
    if (at >= ms) out.push({ kind: 'session', name: s.routineName, at });
  });
  state.routines.forEach((r) => {
    if ((r.updatedAt || 0) >= ms) out.push({ kind: 'routine', name: r.name, at: r.updatedAt });
  });
  return out.sort((a, b) => b.at - a.at);
}

export const localIsEmpty = () => state.sessions.length === 0 && state.routines.length === 0;

/**
 * Work on this device that the gist does not have yet.
 *
 * The cut-off is when THIS device last synced, measured by its own clock —
 * never the timestamp inside the remote payload. Comparing local edit times
 * against another device's clock means any skew (or a device with a wrong date)
 * can make unpushed work look older than the backup and get silently discarded.
 */
export function unsyncedLocalChanges() {
  if (localIsEmpty()) return [];
  return localChangesSince(Math.max(sync.lastPushedAt || 0, sync.lastPulledAt || 0));
}

/**
 * Push local data to the gist, creating the gist on first use.
 * Returns { ok } or { conflict, remote } when the gist moved on since we last
 * saw it — the caller decides whether to force.
 */
export async function pushNow({ force = false } = {}) {
  if (!sync.token) throw new Error('Set up Gist sync first.');

  if (sync.gistId && !force) {
    const remote = await fetchRemote().catch((err) => {
      // A missing/unreadable gist is worth surfacing rather than silently
      // overwriting something we failed to read.
      throw err;
    });
    if (remote.remotePushedAtMs > (sync.lastSeenRemoteMs || 0)) {
      return { conflict: true, remote };
    }
  }

  const body = JSON.stringify(
    sync.gistId
      ? { files: { [FILE]: { content: payload() } } }
      : {
        public: false,
        description: 'Workout Tracker backup (secret gist)',
        files: { [FILE]: { content: payload() } },
      },
  );

  const res = sync.gistId
    ? await gh(`/gists/${sync.gistId}`, { method: 'PATCH', body })
    : await gh('/gists', { method: 'POST', body });

  if (res && res.id) sync.gistId = res.id;
  sync.lastPushedAt = Date.now();
  sync.lastSeenRemoteMs = sync.lastPushedAt;
  await persist();
  emit();
  return { ok: true, gistId: sync.gistId, htmlUrl: res?.html_url, counts: dataFingerprint() };
}

/**
 * Replace local data with the gist's copy.
 * Returns { conflict, localNewer } when local has records the backup predates.
 */
export async function pullNow({ force = false } = {}) {
  const remote = await fetchRemote();
  const localNewer = unsyncedLocalChanges();
  if (!force && localNewer.length) {
    return { conflict: true, localNewer, remote };
  }
  const result = await importFromText(remote.content, { mode: 'replace' });
  sync.lastPulledAt = Date.now();
  sync.lastSeenRemoteMs = remote.remotePushedAtMs || Date.now();
  await persist();
  emit();
  return { ok: true, ...result };
}

/** Fire-and-forget push used by the auto-push-on-finish option. */
export async function autoPushIfEnabled() {
  if (!sync.autoPush || !sync.token) return null;
  try {
    const res = await pushNow();
    return res.conflict ? { conflict: true } : { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Run at startup. Pulls when this device is empty (a fresh install) or simply
 * behind, and declines when local work would be lost. Never throws — a failure
 * here must not stop the app from opening offline.
 */
export async function autoPullOnLaunch() {
  if (!sync.autoPull || !sync.token || !sync.gistId) return null;
  try {
    const remote = await fetchRemote();
    const localEmpty = localIsEmpty();
    const localNewer = unsyncedLocalChanges();

    if (!localEmpty) {
      if (localNewer.length) return { conflict: true, localNewer };
      if (remote.remotePushedAtMs <= (sync.lastSeenRemoteMs || 0)) return { upToDate: true };
    }

    const result = await importFromText(remote.content, { mode: 'replace' });
    sync.lastPulledAt = Date.now();
    sync.lastSeenRemoteMs = remote.remotePushedAtMs || Date.now();
    await persist();
    emit();
    return { ok: true, firstRun: localEmpty, ...result };
  } catch (err) {
    return { error: err.message };
  }
}
