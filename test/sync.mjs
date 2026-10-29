// Gist sync against a fake GitHub API: push/pull round trip, conflict
// detection in both directions, and error surfacing. No network is used.
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';

const APP = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const dom = new JSDOM(readFileSync(`${APP}/index.html`, 'utf8'), { url: 'https://example.test/' });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.Blob = dom.window.Blob;
global.URL = dom.window.URL;
global.AudioContext = class { resume() {} };

let failures = 0;
const ok = (c, l) => { if (c) console.log(`  ok   ${l}`); else { failures++; console.log(`  FAIL ${l}`); } };
const section = (s) => console.log(`\n== ${s}`);

/* ------------------------------------------------------------------ */
/* fake GitHub                                                        */
/* ------------------------------------------------------------------ */
const FILE = 'workout-tracker-backup.json';
const hub = {
  gists: new Map(),          // id -> { id, public, files, updated_at, html_url }
  calls: [],
  validToken: 'github_pat_valid',
  nextId: 1,
  failNext: null,            // { status, message }
  truncateOver: Infinity,
  rawStore: new Map(),
};

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();
  hub.calls.push(`${method} ${u}`);

  // raw download for truncated files
  if (u.startsWith('https://raw.test/')) {
    if (hub.failRaw) return { ok: false, status: 403, async text() { return ''; } };
    const body = hub.rawStore.get(u);
    return body === undefined
      ? { ok: false, status: 404, async text() { return ''; } }
      : { ok: true, status: 200, async text() { return body; } };
  }

  const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  });

  if (hub.failNext) {
    const f = hub.failNext; hub.failNext = null;
    return json(f.status, { message: f.message });
  }

  const auth = opts.headers?.Authorization || '';
  if (auth !== `Bearer ${hub.validToken}`) return json(401, { message: 'Bad credentials' });

  const m = u.match(/^https:\/\/api\.github\.com\/gists(?:\/(.+))?$/);
  if (!m) return json(404, { message: 'Not Found' });
  const id = m[1];

  if (method === 'POST' && !id) {
    const body = JSON.parse(opts.body);
    const gid = `gist${hub.nextId++}`;
    hub.gists.set(gid, {
      id: gid, public: body.public, description: body.description,
      files: body.files, updated_at: new Date().toISOString(),
      html_url: `https://gist.github.com/${gid}`,
    });
    return json(201, hub.gists.get(gid));
  }

  const g = hub.gists.get(id);
  if (!g) return json(404, { message: 'Not Found' });

  if (method === 'PATCH') {
    const body = JSON.parse(opts.body);
    Object.assign(g.files, body.files);
    g.updated_at = new Date().toISOString();
    return json(200, g);
  }

  // GET: emulate the API's 1 MB inlining limit
  const out = { ...g, files: {} };
  for (const [name, f] of Object.entries(g.files)) {
    if (f.content.length > hub.truncateOver) {
      const raw = `https://raw.test/${id}/${name}`;
      hub.rawStore.set(raw, f.content);
      out.files[name] = { ...f, content: '', truncated: true, raw_url: raw };
    } else {
      out.files[name] = { ...f, truncated: false, raw_url: `https://raw.test/${id}/${name}` };
    }
  }
  return json(200, out);
};

/* ------------------------------------------------------------------ */

const store = await import(`${APP}/js/store.js`);
const xi = await import(`${APP}/js/exportimport.js`);
const sy = await import(`${APP}/js/sync.js`);
const { state } = store;

const seed = async (name, n = 2) => {
  const r = await store.createRoutine({
    name, entries: [{ name: 'Squat', sets: 3, reps: '5', weight: 100 }],
  });
  for (let i = 0; i < n; i++) {
    const s = await store.startSession(r.id);
    const set = await store.addSet(s.entries[0].id);
    await store.updateSet(s.entries[0].id, set.id, { weight: 100 + i, reps: 5, done: true });
    await store.finishSession();
  }
  return r;
};

section('setup');
await store.init();
await sy.initSync();
ok(sy.syncConfigured() === false, 'sync starts unconfigured');
ok(sy.sync.deviceId && sy.sync.deviceId.startsWith('dev'), 'a device id was generated');
await seed('Push Day', 2);
const local = store.dataFingerprint();
ok(local.sessions === 2, `seeded ${local.sessions} sessions, ${local.loggedSets} sets`);

section('a bad token fails loudly instead of silently');
await sy.configureSync({ token: 'github_pat_wrong' });
let err = null;
try { await sy.pushNow(); } catch (e) { err = e; }
ok(err && /401/.test(err.message), `401 surfaced: ${err?.message}`);
ok(sy.sync.gistId === null, 'no gist id recorded after a failed push');

section('first push creates a secret gist');
await sy.configureSync({ token: hub.validToken });
const p1 = await sy.pushNow();
ok(p1.ok === true, 'push reported success');
ok(!!sy.sync.gistId, `gist id stored (${sy.sync.gistId})`);
const gist = hub.gists.get(sy.sync.gistId);
ok(gist.public === false, 'the gist is secret (public: false)');
ok(!!gist.files[FILE], `payload written to ${FILE}`);
ok(p1.counts.sessions === 2, 'pushed the current session count');
ok(sy.sync.lastPushedAt > 0, 'lastPushedAt recorded');

section('the token never leaves the device');
const pushed = JSON.parse(gist.files[FILE].content);
ok(!JSON.stringify(pushed).includes(hub.validToken), 'the token is not in the pushed payload');
ok(!JSON.stringify(xi.backupObject()).includes(hub.validToken), 'the token is not in an exported backup');
ok(pushed.sync.device === sy.sync.deviceId, 'payload records which device pushed');
ok(pushed.routines.length === 1 && pushed.sessions.length === 2, 'payload carries routines and sessions');

section('pull restores the gist verbatim');
const beforeMd = xi.sessionMarkdown(state.sessions[0]);
await store.restoreAll({ routines: [], sessions: [], settings: null });   // simulate a fresh device
ok(store.dataFingerprint().sessions === 0, 'device wiped');
const pl = await sy.pullNow();
ok(pl.ok === true, 'pull succeeded');
ok(pl.actual.sessions === local.sessions && pl.actual.loggedSets === local.loggedSets,
  `counts match the original (${pl.actual.sessions} sessions, ${pl.actual.loggedSets} sets)`);
ok(xi.sessionMarkdown(state.sessions[0]) === beforeMd, 'a restored session exports identical markdown');
ok(sy.sync.lastPulledAt > 0, 'lastPulledAt recorded');

section('pull refuses to discard newer local work');
await seed('Leg Day', 1);
const unpushed = store.dataFingerprint().sessions;
const blocked = await sy.pullNow();
ok(blocked.conflict === true, 'pull reported a conflict instead of overwriting');
ok(blocked.localNewer.length >= 2, `${blocked.localNewer.length} local records flagged as newer`);
ok(store.dataFingerprint().sessions === unpushed, 'nothing was overwritten');
const forcedPull = await sy.pullNow({ force: true });
ok(forcedPull.ok === true, 'forcing the pull works');
ok(store.dataFingerprint().sessions === local.sessions, 'local is back to the gist copy');

section('a fresh device: pairing code + automatic first pull');
const code = sy.pairingCode();
ok(typeof code === 'string' && code.length > 20, 'pairing code produced');
const decoded = sy.parsePairing(code);
ok(decoded.token === hub.validToken && decoded.gistId === sy.sync.gistId,
  'pairing code round-trips the token and gist id');
ok(sy.parsePairing('github_pat_something') === null, 'a raw token is not mistaken for a pairing code');
ok(sy.parsePairing('garbage!!') === null, 'garbage is rejected');

// simulate a brand-new phone: empty database, no sync config
await store.restoreAll({ routines: [], sessions: [], settings: null });
await sy.disconnectSync();
ok(store.dataFingerprint().sessions === 0 && sy.syncConfigured() === false, 'fresh device');
const paired = sy.parsePairing(code);
await sy.configureSync({ token: paired.token, gistId: paired.gistId, autoPull: true });
const first = await sy.autoPullOnLaunch();
ok(first && first.ok === true, 'opening the app pulled automatically');
ok(first.firstRun === true, 'flagged as a first run');
ok(first.actual.sessions === local.sessions, `all ${first.actual.sessions} sessions arrived`);
ok(first.actual.loggedSets === local.loggedSets, `all ${first.actual.loggedSets} logged sets arrived`);
ok(state.routines.length >= 1, 'routines arrived too');

section('auto-pull on later launches');
const second = await sy.autoPullOnLaunch();
ok(second.upToDate === true, 'a second launch with no remote change does nothing');
// another device pushes something new
const g2 = hub.gists.get(sy.sync.gistId);
const bumped = JSON.parse(g2.files[FILE].content);
bumped.sync = { device: 'dev_other', pushedAt: new Date().toISOString(), pushedAtMs: Date.now() + 10_000 };
bumped.sessions = bumped.sessions.slice(0, 1);
bumped.counts = { routines: 1, sessions: 1, loggedSets: 1 };
g2.files[FILE].content = JSON.stringify(bumped);
const third = await sy.autoPullOnLaunch();
ok(third.ok === true, 'a newer remote copy is pulled on launch');
ok(store.dataFingerprint().sessions === 1, 'local now matches the remote copy');

section('auto-pull never silently discards local work');
await seed('Local Only', 1);
const guarded = await sy.autoPullOnLaunch();
ok(guarded.conflict === true, 'declines to pull when local has newer records');
ok(store.dataFingerprint().sessions === 2, 'the local session survived');
await sy.configureSync({ autoPull: false });
ok(await sy.autoPullOnLaunch() === null, 'respects the off switch');
await sy.configureSync({ autoPull: true });

section('auto-pull failures are returned, never thrown');
const savedFetch = global.fetch;
global.fetch = async () => { throw new TypeError('Load failed'); };
const offlineLaunch = await sy.autoPullOnLaunch();
ok(offlineLaunch && typeof offlineLaunch.error === 'string', `offline launch handled: ${offlineLaunch?.error?.slice(0, 40)}`);
global.fetch = savedFetch;

section('clock skew must not hide local work');
// another device pushes with a clock running 10 minutes fast
const gSkew = hub.gists.get(sy.sync.gistId);
const skewed = JSON.parse(gSkew.files[FILE].content);
skewed.sync = { device: 'dev_fast_clock', pushedAt: new Date().toISOString(), pushedAtMs: Date.now() + 600_000 };
gSkew.files[FILE].content = JSON.stringify(skewed);
await seed('Logged During Skew', 1);
const sessionsNow = store.dataFingerprint().sessions;
const skewPull = await sy.pullNow();
ok(skewPull.conflict === true, 'a future remote timestamp does not make local work look stale');
ok(store.dataFingerprint().sessions === sessionsNow, 'the session logged locally survived');
const skewAuto = await sy.autoPullOnLaunch();
ok(skewAuto.conflict === true, 'auto-pull declines for the same reason');
await sy.pushNow({ force: true });

section('a device with data that has never synced is not wiped silently');
await sy.disconnectSync();
await sy.configureSync({ token: hub.validToken, gistId: gSkew.id });
ok(store.dataFingerprint().sessions > 0, 'device has local data and no sync history');
const virgin = await sy.pullNow();
ok(virgin.conflict === true, 'pull asks first');
ok(virgin.localNewer.length > 0, `${virgin.localNewer.length} records flagged`);

section('push refuses to clobber a gist another device moved on');
// another device pushes behind our back
const otherPayload = JSON.parse(gist.files[FILE].content);
otherPayload.sync = { device: 'dev_other', pushedAt: new Date().toISOString(), pushedAtMs: Date.now() + 5000 };
otherPayload.counts = { routines: 9, sessions: 9, loggedSets: 99 };
gist.files[FILE].content = JSON.stringify(otherPayload);
const p2 = await sy.pushNow();
ok(p2.conflict === true, 'push reported a conflict');
ok(p2.remote.remoteDevice === 'dev_other', 'names the other device');
ok(p2.remote.counts.sessions === 9, 'shows what the gist holds');
ok(JSON.parse(gist.files[FILE].content).sync.device === 'dev_other', 'the gist was not modified');
const p3 = await sy.pushNow({ force: true });
ok(p3.ok === true, 'forcing the push works');
ok(JSON.parse(gist.files[FILE].content).sync.device === sy.sync.deviceId, 'the gist is now ours');

section('a clean push after a pull is not a conflict');
const p4 = await sy.pushNow();
ok(p4.ok === true, 'consecutive pushes from the same device are fine');

section('auto-push on finish, only when enabled');
const callsBefore = hub.calls.length;
await sy.autoPushIfEnabled();
ok(hub.calls.length === callsBefore, 'does nothing while the option is off');
await sy.configureSync({ autoPush: true });
await sy.pushNow({ force: true });                 // re-sync after configure reset the marker
const auto = await sy.autoPushIfEnabled();
ok(auto && auto.ok === true, 'pushes when enabled');
ok(hub.calls.length > callsBefore, 'the API was actually called');

section('network failure is reported, not swallowed');
const realFetch = global.fetch;
global.fetch = async () => { throw new TypeError('Load failed'); };
const offline = await sy.autoPushIfEnabled();
ok(offline && /offline/i.test(offline.error), `auto-push reports it: ${offline?.error}`);
global.fetch = realFetch;

section('a backup over 1 MB falls back to the raw download');
hub.truncateOver = 100;                            // pretend everything is oversized
const r2 = await sy.fetchRemote();
ok(r2.data.routines.length >= 1, 'raw fallback parsed the payload');
ok(hub.calls.some((c) => c.includes('raw.test')), 'the raw URL was fetched');
hub.rawStore.clear();                              // make the raw download fail
hub.failRaw = true;
let rawErr = null;
try { await sy.fetchRemote(); } catch (e) { rawErr = e; }
ok(rawErr && /over 1 MB/.test(rawErr.message), `clear message when that fails too: ${rawErr?.message?.slice(0, 60)}`);
hub.failRaw = false;
hub.truncateOver = Infinity;

section('garbage in the gist is rejected clearly');
gist.files[FILE].content = 'not json at all';
let badErr = null;
try { await sy.fetchRemote(); } catch (e) { badErr = e; }
ok(badErr && /valid JSON/.test(badErr.message), `parse error surfaced: ${badErr?.message?.slice(0, 50)}`);

section('a missing gist is reported as 404');
await sy.configureSync({ gistId: 'gist_does_not_exist' });
let missing = null;
try { await sy.fetchRemote(); } catch (e) { missing = e; }
ok(missing && /404/.test(missing.message), `404 surfaced: ${missing?.message?.slice(0, 50)}`);

section('disconnect forgets the credentials');
await sy.disconnectSync();
ok(sy.sync.token === null && sy.sync.gistId === null, 'token and gist id cleared');
ok(sy.syncConfigured() === false, 'reported as unconfigured');
ok(store.dataFingerprint().sessions > 0, 'local data untouched by disconnecting');

section('automatic push when the routine library changes');
await sy.configureSync({ token: hub.validToken, gistId: gSkew.id, autoPushRoutines: true });
await sy.pushNow({ force: true });
sy.watchRoutines();
let notices = [];
sy.setSyncNotifier((n) => notices.push(n));
ok(sy.pendingPush() === false, 'nothing queued to begin with');

// editing a FINISHED session must push too -- correcting last Tuesday on one
// phone and never seeing it on the other was a standing gap
sy.cancelPendingPush();
const histSess = {
  id: 'w_histpush', routineId: null, routineName: 'Pushed Edit', unit: 'kg',
  startedAt: Date.now() - 86400000, finishedAt: Date.now() - 82800000,
  updatedAt: Date.now() - 82800000, entries: [], currentIdx: 0,
  rpe: null, bodyweight: null, notes: '', modified: false,
};
store.state.sessions.unshift(histSess);
store.emit();
await new Promise((r) => setTimeout(r, 20));
ok(sy.pendingPush() === true, 'a finished session appearing schedules a push');
sy.cancelPendingPush();

// ...but a live workout must not, or every logged set spams a gist revision
store.state.active = histSess;
histSess.finishedAt = null;
store.emit();
await new Promise((r) => setTimeout(r, 20));
histSess.finishedAt = Date.now();
histSess.updatedAt = Date.now();
store.emit();
await new Promise((r) => setTimeout(r, 20));
ok(sy.pendingPush() === false, 'nothing is scheduled while a workout is in progress');
store.state.active = null;
store.state.sessions = store.state.sessions.filter((x) => x.id !== 'w_histpush');
sy.cancelPendingPush();

const callsBeforeRoutine = hub.calls.length;
const autoR = await store.createRoutine({ name: 'Auto Push Me', entries: [{ name: 'Squat' }] });
await new Promise((r) => setTimeout(r, 20));
ok(sy.pendingPush() === true, 'creating a routine queued a push');
ok(hub.calls.length === callsBeforeRoutine, 'but it is debounced, not fired immediately');

// a burst of edits must collapse into ONE push, not one per change
await store.saveRoutine(autoR);
await store.saveRoutine(autoR);
await store.createRoutine({ name: 'And Me', entries: [{ name: 'Bench' }] });
await new Promise((r) => setTimeout(r, 20));
ok(sy.pendingPush() === true, 'still just one queued push after four changes');

await sy.flushPendingPush();
ok(sy.pendingPush() === false, 'flushing clears the queue');
ok(hub.calls.length > callsBeforeRoutine, 'and the push actually happened');
ok(notices.some((n) => n.reason === 'routine' && n.ok), `reported back: ${JSON.stringify(notices.at(-1))}`);
const autoPushed = JSON.parse(hub.gists.get(sy.sync.gistId).files[FILE].content);
ok(autoPushed.routines.some((r) => r.name === 'Auto Push Me'), 'the new routine reached the gist');

section('logging sets does NOT trigger a routine push');
const noisy = await store.startSession(autoR.id);
const nSet = await store.addSet(noisy.entries[0].id);
await store.updateSet(noisy.entries[0].id, nSet.id, { weight: 60, reps: 5, done: true });
await new Promise((r) => setTimeout(r, 20));
ok(sy.pendingPush() === false, 'a session change queues nothing — no gist revision per set');
await store.discardSession();

section('routine auto-push respects its switch and reports failures');
await sy.configureSync({ autoPushRoutines: false });
await sy.pushNow({ force: true });
sy.cancelPendingPush();
await store.createRoutine({ name: 'Should Not Push', entries: [{ name: 'Curl' }] });
await new Promise((r) => setTimeout(r, 20));
ok(sy.pendingPush() === false, 'switched off, nothing is queued');
await sy.configureSync({ autoPushRoutines: true });
await sy.pushNow({ force: true });

notices = [];
const savedFetch2 = global.fetch;
global.fetch = async () => { throw new TypeError('Load failed'); };
await store.createRoutine({ name: 'Offline Routine', entries: [{ name: 'Row' }] });
await new Promise((r) => setTimeout(r, 20));
await sy.flushPendingPush();
global.fetch = savedFetch2;
ok(notices.some((n) => n.error && /offline/i.test(n.error)),
  `a failed background push is reported, not swallowed: ${notices.at(-1)?.error?.slice(0, 40)}`);

section('automatic pull when the app returns to the foreground');
await sy.configureSync({ autoPull: true, autoPullForeground: true });
await sy.pushNow({ force: true });
sy.cancelPendingPush();
sy.sync.lastCheckedAt = 0;   // as if the app had not checked for a while
const fg1 = await sy.autoPullOnForeground();
ok(fg1 && fg1.upToDate === true, `a foreground check after the cooldown runs (${JSON.stringify(fg1)})`);
const fg2 = await sy.autoPullOnForeground();
ok(fg2 && fg2.skipped === 'cooldown', 'a second check straight away is rate limited');
ok((await sy.autoPullOnForeground({ cooldownMs: 0 })).upToDate === true,
  'with the cooldown waived it runs again');

// a workout in progress must never be replaced underneath you
const guard = await store.startSession(autoR.id);
const fg3 = await sy.autoPullOnForeground({ cooldownMs: 0 });
ok(fg3 && fg3.skipped === 'workout-in-progress',
  'skipped entirely while a workout is in progress');
ok(store.state.active?.id === guard.id, 'the live session is untouched');
await store.discardSession();

// and it still refuses when there is unpushed work
await store.createRoutine({ name: 'Unpushed', entries: [{ name: 'Dip' }] });
sy.cancelPendingPush();
const fg4 = await sy.autoPullOnForeground({ cooldownMs: 0 });
ok(fg4 && fg4.conflict === true, 'declines when local work would be lost');
await sy.configureSync({ autoPullForeground: false });
ok(await sy.autoPullOnForeground({ cooldownMs: 0 }) === null, 'respects its own switch');
await sy.configureSync({ autoPullForeground: true });

console.log(`\n${failures === 0 ? 'ALL SYNC CHECKS PASSED' : `${failures} SYNC CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
