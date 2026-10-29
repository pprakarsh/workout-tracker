// Optional sync to a secret GitHub Gist.
//
// The whole backup is one JSON file in one gist ("blob sync"): simple, free, and
// every push becomes a gist revision you can inspect or restore in the browser.
// The trade-off is that it is last-write-wins over the entire dataset, so both
// push and pull check whether the other side moved on and ask before clobbering.
//
// The token is kept in IndexedDB under its own meta key, NOT in settings, so it
// never ends up inside an exported backup.
import { state, emit, subscribe, dataFingerprint } from './store.js';
import { metaGet, metaSet } from './db.js';
import { backupObject, importFromText } from './exportimport.js';
import { uid, APP_VERSION } from './util.js';

const API = 'https://api.github.com';
export const FILE = 'workout-tracker-backup.json';

export const sync = {
  token: null,
  gistId: null,
  deviceId: null,
  autoPush: false,         // push after finishing a workout
  autoPushRoutines: true,  // push after a routine is created, edited, deleted or imported
  autoPull: true,          // fetch a newer copy when nothing local would be lost
  autoPullForeground: true,// ...not just at launch, but when the app comes back to the front
  lastPushedAt: null,
  lastPulledAt: null,
  lastCheckedAt: 0,        // last time we asked the gist whether it had moved on
  lastSeenRemoteMs: 0,     // the remote pushedAt we last observed
};

/**
 * How background sync reports back. app.js supplies a toast; tests supply a spy.
 * Keeping it a callback means sync.js needs no DOM and stays unit-testable.
 */
let notifier = () => {};
export const setSyncNotifier = (fn) => { notifier = typeof fn === 'function' ? fn : () => {}; };

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

/** A one-glance summary for the Settings screen. Read-only. */
export function syncState() {
  const lastAt = Math.max(sync.lastPushedAt || 0, sync.lastPulledAt || 0) || null;
  if (!sync.token) return { configured: false, label: 'Not set up', lastAt: null, pending: pendingPush() };
  const unsynced = unsyncedLocalChanges();
  return {
    configured: true,
    lastAt,
    pending: pendingPush(),
    label: pendingPush() ? 'Push queued'
      : unsynced ? 'Changes not pushed yet'
        : lastAt ? 'Up to date' : 'Connected',
  };
}

export async function configureSync({
  token, gistId, autoPush, autoPushRoutines, autoPull, autoPullForeground,
}) {
  if (token !== undefined) sync.token = (token || '').trim() || null;
  if (gistId !== undefined) sync.gistId = (gistId || '').trim() || null;
  if (autoPush !== undefined) sync.autoPush = !!autoPush;
  if (autoPushRoutines !== undefined) sync.autoPushRoutines = !!autoPushRoutines;
  if (autoPull !== undefined) sync.autoPull = !!autoPull;
  if (autoPullForeground !== undefined) sync.autoPullForeground = !!autoPullForeground;
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
  cancelPendingPush();
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

/* ------------------------------------------------------------------ */
/* automatic push when the routine library changes                    */
/* ------------------------------------------------------------------ */

let pushTimer = null;
let lastRoutineSig = null;

/**
 * A cheap signature of the routine library. Length catches create/delete and the
 * newest updatedAt catches an edit, since every routine write stamps it.
 */
const routineSignature = () =>
  `${state.routines.length}:${state.routines.reduce((m, r) => Math.max(m, r.updatedAt || 0), 0)}`;

export const pendingPush = () => pushTimer !== null;

export function cancelPendingPush() {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
}

/**
 * Schedule a push after a routine change, debounced so a burst of edits (adding
 * three exercises, or typing a description) becomes one push and one gist
 * revision rather than a dozen.
 */
export function scheduleRoutinePush({ delay = 4000 } = {}) {
  if (!sync.autoPushRoutines || !sync.token) return false;
  cancelPendingPush();
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    try {
      const res = await pushNow();
      if (res.conflict) notifier({ reason: 'routine', conflict: true });
      else notifier({ reason: 'routine', ok: true, counts: res.counts });
    } catch (err) {
      notifier({ reason: 'routine', error: err.message });
    }
  }, delay);
  return true;
}

/** Push now if one was queued — used when the network comes back. */
export async function flushPendingPush() {
  if (!pendingPush()) return null;
  cancelPendingPush();
  try {
    const res = await pushNow();
    if (res.conflict) { notifier({ reason: 'routine', conflict: true }); return { conflict: true }; }
    notifier({ reason: 'routine', ok: true, counts: res.counts });
    return { ok: true };
  } catch (err) {
    notifier({ reason: 'routine', error: err.message });
    return { error: err.message };
  }
}

/** Finished sessions only, and only while no workout is in progress. */
function historySignature() {
  const done = state.sessions.filter((s) => s.finishedAt);
  const newest = done.reduce((n, s) => Math.max(n, s.updatedAt || s.finishedAt || 0), 0);
  return `${done.length}:${newest}`;
}
let lastHistorySig = '';

/**
 * Watch the store and push what changed. Subscribing beats calling a push from
 * each of the ten routine mutation sites (create, edit, delete, duplicate,
 * reorder, import, save-back-to-routine...) where one would eventually be
 * forgotten. The plan schedules its own push from planstore.js, since it writes
 * without going through here.
 *
 * FINISHED sessions are watched too, so correcting last Tuesday's workout in
 * History reaches your other phone -- that was a standing gap. A LIVE workout
 * is not: a push per logged set would spam gist revisions for no benefit, and
 * the session goes up in one piece when you finish it.
 */
export function watchRoutines() {
  lastRoutineSig = routineSignature();
  lastHistorySig = historySignature();
  subscribe(() => {
    const sig = routineSignature();
    if (sig !== lastRoutineSig) {
      lastRoutineSig = sig;
      scheduleRoutinePush();
      return;
    }
    if (state.active) return;                  // mid-workout: wait for Finish
    const hist = historySignature();
    if (hist === lastHistorySig) return;
    lastHistorySig = hist;
    scheduleRoutinePush();
  });
}

/* ------------------------------------------------------------------ */
/* automatic pull                                                     */
/* ------------------------------------------------------------------ */

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
    sync.lastCheckedAt = Date.now();
    sync.lastSeenRemoteMs = remote.remotePushedAtMs || Date.now();
    await persist();
    emit();
    return { ok: true, firstRun: localEmpty, ...result };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Pull when the app comes back to the foreground.
 *
 * An installed PWA usually *resumes* rather than cold-starting, so the
 * launch-time pull can go days without running. This closes that gap, rate
 * limited so switching apps mid-workout does not hammer the API. Same guards as
 * every other pull: it declines whenever local work would be lost.
 */
export async function autoPullOnForeground({ cooldownMs = 5 * 60 * 1000 } = {}) {
  if (!sync.autoPull || !sync.autoPullForeground || !sync.token || !sync.gistId) return null;
  if (state.active) return { skipped: 'workout-in-progress' };
  if (Date.now() - (sync.lastCheckedAt || 0) < cooldownMs) return { skipped: 'cooldown' };
  sync.lastCheckedAt = Date.now();
  await persist();
  return autoPullOnLaunch();
}
