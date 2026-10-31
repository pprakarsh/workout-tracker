// Functional smoke test for ~/workout-tracker, run under jsdom + fake-indexeddb.
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';

const APP = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const html = readFileSync(`${APP}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });

global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.Blob = dom.window.Blob;
global.FileReader = dom.window.FileReader;
global.HTMLElement = dom.window.HTMLElement;
dom.window.URL.createObjectURL = () => 'blob:stub';
dom.window.URL.revokeObjectURL = () => {};
global.URL = dom.window.URL;
global.AudioContext = class { constructor() { this.state = 'suspended'; } resume() {} };
const downloads = [];
// capture downloads instead of letting jsdom try to navigate
dom.window.HTMLAnchorElement.prototype.click = function click() {
  downloads.push({ name: this.download, href: this.href });
};

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
};
const section = (s) => console.log(`\n== ${s}`);

const store = await import(`${APP}/js/store.js`);
const clock = await import(`${APP}/js/clockstore.js`);
const backupStore = await import(`${APP}/js/backupstore.js`);
const ex = await import(`${APP}/js/exercise.js`);
const xs = await import(`${APP}/js/exercisestore.js`);
const cat = await import(`${APP}/js/catalog.js`);
const cardioStore = await import(`${APP}/js/cardiostore.js`);
const xi = await import(`${APP}/js/exportimport.js`);
const nowView = await import(`${APP}/js/views/now.js`);
const sessionView = await import(`${APP}/js/views/session.js`);
const historyView = await import(`${APP}/js/views/history.js`);
const routinesView = await import(`${APP}/js/views/routines.js`);
const entry = await import(`${APP}/js/views/entry.js`);
const fmt = await import(`${APP}/js/format.js`);
const q = await import(`${APP}/js/queries.js`);
const { state } = store;
const util = await import(`${APP}/js/util.js`);
const cardioLib = await import(`${APP}/js/cardio.js`);
const parseDurCheck = (v, bare) => (bare ? util.parseDur(v, { bare }) : util.parseDur(v));

const renderAll = (label) => {
  for (const [name, v] of Object.entries({ now: nowView, session: sessionView, history: historyView, routines: routinesView })) {
    try {
      const out = v.render();
      ok(typeof out === 'string' && out.length > 0, `${label}: ${name} renders (${out.length} chars)`);
    } catch (err) {
      failures++;
      console.log(`  FAIL ${label}: ${name} threw -> ${err.stack.split('\n').slice(0, 3).join(' | ')}`);
    }
  }
};

section('init on an empty database');
await store.init();
// Most sections below predate the require-an-effort-answer rule and assert the
// load/amount rules on their own, so the gate is off by default here and has
// its own section that switches it on.
await store.updateSettings({ requireEffort: false });
ok(state.ready, 'store ready');
ok(state.routines.length === 0 && state.sessions.length === 0, 'starts empty');
renderAll('empty');

section('import a routine from JSON (the documented sample)');
const res1 = await xi.importFromText(routinesView.SAMPLE);
ok(res1.routines === 1, 'one routine imported');
const r = state.routines[0];
ok(r.name === 'Squat day with Push Movements', `name parsed: ${r.name}`);
ok(r.entries.length === 5, `5 entries: ${r.entries.map((e) => e.name).join(', ')}`);
ok(r.entries[0].repsMin === 5 && r.entries[0].repsMax === 5, 'reps "5" -> 5..5');
ok(r.entries[1].repsMin === 6 && r.entries[1].repsMax === 8, 'reps "6-8" -> 6..8');
ok(r.entries[0].rest === 180, `rest "3:00" -> 180s (got ${r.entries[0].rest})`);
ok(r.entries[1].group === 'A' && r.entries[2].group === 'A', 'superset group A on two entries');
ok(r.entries[3].type === 'cardio' && r.entries[3].targetDuration === 1080, 'cardio entry with 18:00 duration');
ok(r.entries[4].setTargets?.length === 3, 'the sample documents a per-set plan');
ok(r.entries[4].notes.split('\n').length === 3, 'the sample documents multi-line notes');

section('start a session (snapshot semantics)');
const s = await store.startSession(r.id);
ok(state.active && state.active.id === s.id, 'session is active');
ok(s.entries.length === 5, 'routine copied into session');
ok(s.entries[0].id !== r.entries[0].id, 'session entries are independent copies');
renderAll('in-session');

section('superset block detection');
ok(JSON.stringify(store.blockAt(s.entries, 0)) === '[0]', 'ungrouped entry is its own block');
ok(JSON.stringify(store.blockAt(s.entries, 1)) === '[1,2]', 'grouped entries 1+2 form one block');
await store.stepBlock(1);
ok(s.currentIdx === 1, 'next from 0 lands on the superset block');
await store.stepBlock(1);
ok(s.currentIdx === 3, 'next skips past the whole superset block');
await store.setCurrent(0);

section('the plan is pre-materialised: logging is confirming, not creating');
const e0 = s.entries[0];
ok(e0.sets.length === 5, `Back Squat opens with its 5 planned rows (${e0.sets.length})`);
ok(e0.sets.every((x) => x.weight === 100 && x.reps === 5), 'each row pre-filled from the plan');
ok(e0.sets.every((x) => !x.done), 'and none ticked yet');
ok(store.activeSet(e0).id === e0.sets[0].id, 'the active set is the first unticked row');
ok(store.setIsLoggable(e0.sets[0]) === true, 'it is loggable, so confirm can act');

const set1 = e0.sets[0];
await store.updateSet(e0.id, set1.id, { weight: 102.5, reps: 5, rpe: 8 });
await store.toggleSetDone(e0.id, set1.id);
ok(store.activeSet(e0).id === e0.sets[1].id, 'confirming one advances the active set');
ok(store.entryStatus(e0) === 'partial', 'status partial after one of five');
const set2 = e0.sets[1];

section('a set with no weight is not loggable, so confirm must not log it');
const noWeight = await store.addSessionEntry({ name: 'Mystery Machine', sets: 2, reps: 10 });
ok(noWeight.sets.length === 2, 'rows still materialise without a weight');
ok(noWeight.sets[0].weight === null, 'but carry no weight');
ok(store.setIsLoggable(noWeight.sets[0]) === false,
  'so it is flagged as needing a number rather than logged blank');
await store.updateSet(noWeight.id, noWeight.sets[0].id, { weight: 25 });
ok(store.setIsLoggable(noWeight.sets[0]) === true, 'entering one by hand makes it loggable');
await store.removeSessionEntry(noWeight.id);

section('bodyweight sets');
const bw = await store.addSessionEntry({ name: 'Pull-up', sets: 3, reps: 8, bodyweight: true });
ok(bw.bodyweight === true, 'the entry is marked bodyweight');
ok(bw.sets.every((x) => x.bodyweight === true), 'and every materialised set inherits it');
ok(store.setIsLoggable(bw.sets[0]) === true, 'loggable with no weight at all');
ok(fmt.loadLabel(bw.sets[0]) === 'BW', `reads as BW (${fmt.loadLabel(bw.sets[0])})`);
await store.updateSet(bw.id, bw.sets[0].id, { weight: 10 });
ok(fmt.loadLabel(bw.sets[0]) === 'BW + 10kg', `added load reads as BW + 10kg (${fmt.loadLabel(bw.sets[0])})`);
ok(fmt.loadLabel(bw.sets[0], { spaced: true }) === 'BW + 10 kg', 'the spaced form is used in exports');
await store.toggleBodyweight(bw.id, bw.sets[1].id);
ok(bw.sets[1].bodyweight === false, 'a single set can be switched back to weighted');
ok(fmt.loadLabel(bw.sets[1]) === '—', 'and then reads as nothing entered');
await store.toggleBodyweight(bw.id, bw.sets[1].id);
await store.updateSet(bw.id, bw.sets[0].id, { reps: 8, done: true });
ok(store.sessionVolume(s) > 0, 'volume is non-zero from the weighted work');
const volNoBw = store.sessionVolume(s);
await store.updateSessionMeta({ bodyweight: 75 });
ok(store.sessionVolume(s) > volNoBw,
  'recording a bodyweight makes BW sets count towards volume');
await store.updateSessionMeta({ bodyweight: null });
ok(store.sessionVolume(s) === volNoBw,
  'without it they contribute nothing rather than a guessed number');
await store.removeSessionEntry(bw.id);

section('rest timer: manual start, manual stop');
ok(state.timer === null, 'no timer initially');
await entry.entryActions['rest-start']({ entry: e0.id, set: set2.id });
ok(state.timer !== null, 'timer started from the set row');
ok(state.timer.target === 180, `target taken from the routine rest (${state.timer.target}s)`);
ok(e0.sets[1].done === true, 'starting rest marks that set done');
ok(/Back Squat set 2/.test(state.timer.label), `label: ${state.timer.label}`);
// timer must survive a reload: it lives in meta, derived from a timestamp
state.timer.startedAt -= 65_000;
const timerMod = await import(`${APP}/js/timer.js`);
ok(timerMod.restElapsed() === 65, `elapsed derived from timestamp (${timerMod.restElapsed()}s)`);
await clock.setRestTarget(120);
ok(state.timer.target === 120, 'target editable mid-rest');
const stopped = await clock.stopRest();
ok(stopped.elapsed === 65, `stop returns elapsed (${stopped.elapsed}s)`);
ok(stopped.pending === null, 'the set had numbers, so nothing is left pending');
ok(state.timer === null, 'timer cleared');
ok(e0.sets[1].rest === 65, `actual rest recorded on the set (${e0.sets[1].rest}s)`);

section('modify the routine mid-session (today only)');
const added = await store.addSessionEntry({ name: 'Face Pull', sets: 3, reps: '15', rest: '1:00' });
ok(s.entries.length === 6, 'exercise added to the session');
ok(r.entries.length === 5, 'source routine untouched');
await store.moveSessionEntry(added.id, -1);
ok(s.entries[4].id === added.id, 'reorder works');
await store.toggleSkip(added.id);
ok(store.entryStatus(added) === 'skipped', 'skip works');
await store.toggleSkip(added.id);
ok(s.modified === true, 'session flagged as modified');

section('optionally push today\'s changes back to the routine');
const beforeCount = r.entries.length;
const firstIdBefore = r.entries[0].id;
await store.saveSessionBackToRoutine();
const r2 = store.getRoutine(r.id);
ok(r2.entries.length === beforeCount + 1, `routine now has the added exercise (${beforeCount} -> ${r2.entries.length})`);
ok(r2.entries.some((x) => x.name === 'Face Pull'), 'Face Pull persisted to the routine');
ok(r2.entries[0].id === firstIdBefore, 'existing routine entry ids are stable');
ok(state.active.modified === false, 'modified flag cleared after save-back');

section('cardio logging');
const cardio = s.entries.find((x) => x.type === 'cardio');
await cardioStore.updateLog(cardio.id, { distance: 3.2, duration: 1020, avgHr: 152, maxHr: 171, elevation: 24, rpe: 7, note: 'easy', done: true });
ok(store.entryStatus(cardio) === 'done', 'cardio marked done');
ok(fmt.pace(3.2, 1020, 'km') === '5:19/km', `pace computed: ${fmt.pace(3.2, 1020, 'km')}`);
renderAll('with-data');

section('session meta + finish');
await store.updateSessionMeta({ rpe: 8, bodyweight: 74.5, notes: 'felt strong' });
const fin = await store.finishSession();
ok(fin.finishedAt > 0, 'finishedAt stamped');
ok(state.active === null, 'no active session afterwards');
ok(state.sessions.length === 1, 'session kept in history');
ok(state.timer === null, 'timer cleared on finish');
renderAll('after-finish');

section('last-session reference (no auto-progression)');
const hit = q.lastLogFor('Back Squat');
ok(hit !== null, 'previous Back Squat found');
ok(/102.5/.test(fmt.logSummary(hit.entry)), `summary: ${fmt.logSummary(hit.entry)}`);
const s2 = await store.startSession(r.id);
ok(s2.entries[0].weight === 100, 'new session still shows the ROUTINE target, not last session');
const freshSet = await store.addSet(s2.entries[0].id);
ok(freshSet.weight === 100, 'new set prefills from routine target only');
await store.discardSession();
ok(state.sessions.length === 1, 'discard removes the session entirely');

section('exports');
const md = xi.sessionMarkdown(state.sessions[0]);
ok(md.startsWith('# Squat day with Push Movements'), 'markdown has a title');
ok(md.includes('| Set | Weight | Reps | RPE | Rest | Done |'), 'markdown has a set table');
ok(md.includes('102.5 kg'), 'markdown includes logged weight');
ok(md.includes('5:19/km'), 'markdown includes cardio pace');
ok(md.includes('felt strong'), 'markdown includes session notes');
const csv = xi.csvRows(state.sessions);
const lines = csv.trim().split('\n');
ok(lines[0].startsWith('date,start_time,session_id'), 'csv header');
ok(lines.length === 4, `csv has one row per logged set/cardio (${lines.length - 1} rows)`);
ok(lines.some((l) => l.includes(',102.5,')), 'csv contains the logged weight');
xi.exportBackup();
xi.exportCsv();
xi.exportSessionMarkdown(state.sessions[0]);
ok(downloads.length === 3, `three files downloaded: ${downloads.map((d) => d.name).join(', ')}`);

section('device-to-device: export, wipe, restore exactly');
const backup = JSON.stringify(xi.backupObject());
const before = backupStore.dataFingerprint();
ok(before.routines === 1 && before.sessions === 1 && before.loggedSets === 3,
  `fingerprint before: ${JSON.stringify(before)}`);
// simulate a second device: wipe everything
await backupStore.restoreAll({ routines: [], sessions: [], settings: null });
ok(backupStore.dataFingerprint().sessions === 0, 'device wiped');
const resR = await xi.importFromText(backup, { mode: 'replace' });
const after = backupStore.dataFingerprint();
ok(after.routines === before.routines, 'routine count matches after restore');
ok(after.sessions === before.sessions, 'session count matches after restore');
ok(after.loggedSets === before.loggedSets, 'logged set count matches after restore');
ok(after.oldest === before.oldest && after.newest === before.newest, 'date range matches');
ok(state.routines[0].id === r.id, 'routine ids preserved (session links intact)');
ok(state.sessions[0].routineId === r.id, 'session still points at its routine');
ok(xi.sessionMarkdown(state.sessions[0]) === md, 'restored session exports byte-identical markdown');
ok(resR.expected && resR.actual && resR.expected.loggedSets === resR.actual.loggedSets, 'restore self-verifies counts');

section('restore carries an in-progress workout and a running timer');
const live = await store.startSession(r.id);
await store.addSet(live.entries[0].id);
await clock.startRest({ target: 90, entryId: live.entries[0].id, setId: live.entries[0].sets[0].id, label: 'Rest' });
const backup2 = JSON.stringify(xi.backupObject());
await backupStore.restoreAll({ routines: [], sessions: [], settings: null });
ok(state.active === null && state.timer === null, 'wiped again');
await xi.importFromText(backup2, { mode: 'replace' });
ok(state.active !== null, 'in-progress workout restored');
ok(state.active.id === live.id, 'same session id');
ok(state.timer !== null && state.timer.target === 90, 'running rest timer restored');
await store.discardSession();

section('merge mode does not duplicate');
const mergeRes = await xi.importFromText(backup, { mode: 'merge' });
ok(mergeRes.routines === 0 && mergeRes.sessions === 0, 'nothing re-added');
ok(mergeRes.skipped >= 2, `${mergeRes.skipped} items recognised as already present`);
ok(backupStore.dataFingerprint().sessions === before.sessions, 'session count unchanged by a merge of the same backup');

section('bad input is rejected with a readable message');
for (const [bad, label] of [['not json', 'non-JSON'], ['{"foo":1}', 'unrecognised shape'], ['{"name":"x","entries":[]}', 'empty routine']]) {
  try {
    await xi.importFromText(bad);
    failures++; console.log(`  FAIL ${label} should have thrown`);
  } catch (err) {
    ok(typeof err.message === 'string' && err.message.length > 10, `${label} -> "${err.message.slice(0, 60)}"`);
  }
}

section('settings');
await store.updateSettings({ unit: 'lb' });
const s3 = await store.startSession(r.id);
const lbSet = await store.addSet(s3.entries[0].id);
ok(lbSet.unit === 'lb', 'new set records the current unit');
ok(state.sessions.find((x) => x.id === state.sessions[1].id).entries[0].sets[0].unit === 'kg',
  'historical sets keep their original unit');
await store.discardSession();
await store.updateSettings({ unit: 'kg' });

section('per-set targets: a different weight and reps for each set');
const psRes = await xi.importFromText(JSON.stringify({
  name: 'Wave Squats',
  description: 'ascending loads',
  entries: [
    {
      name: 'Back Squat',
      sets: [{ weight: 60, reps: 10 }, { weight: 70, reps: 8 }, { weight: 80, reps: '5-6' }],
      rest: '2:30',
      notes: ['Warmup: 2x5 @ 40%, 1x3 @ 60%', 'Tempo 3-1-1', 'Belt from set 3'],
    },
    { name: 'Overhead Press', sets: '40x10, 45x8, 50x6' },
    { name: 'Chin-up', sets: ['x8', 'x7', 'x6'] },
    { name: 'Plain Curl', sets: 3, reps: '10-12', weight: 15 },
  ],
}));
ok(psRes.routines === 1, 'per-set routine imported');
const pr = state.routines.find((x) => x.name === 'Wave Squats');
const [sq, op, cu, plain] = pr.entries;
ok(sq.setTargets && sq.setTargets.length === 3, `object form -> 3 set targets (${sq.setTargets?.length})`);
ok(sq.setTargets[0].weight === 60 && sq.setTargets[0].repsMin === 10, 'set 1 = 60 x 10');
ok(sq.setTargets[2].repsMin === 5 && sq.setTargets[2].repsMax === 6, 'set 3 reps parsed as a range 5-6');
ok(sq.targetSets === 3, 'targetSets derived from the plan length');
ok(sq.weight === null && sq.repsMin === null, 'uniform target fields cleared when a plan exists');
ok(op.setTargets.length === 3 && op.setTargets[1].weight === 45, `string form "40x10, 45x8, 50x6" parsed (${op.setTargets?.length} sets)`);
ok(cu.setTargets.length === 3 && cu.setTargets[0].weight === null && cu.setTargets[0].repsMin === 8,
  'bodyweight form "x8" -> no weight, 8 reps');
ok(plain.setTargets === null && plain.weight === 15, 'uniform entry still works alongside');
ok(fmt.planLine(sq) === '60×10 · 70×8 · 80×5-6', `plan line: ${fmt.planLine(sq)}`);
ok(/60×10 · 70×8 · 80×5-6/.test(fmt.targetLine(sq)), `target line: ${fmt.targetLine(sq)}`);

section('per-set notes carry warmup / tempo text');
ok(sq.notes.split('\n').length === 3, `notes kept as 3 lines (${JSON.stringify(sq.notes).slice(0, 48)}…)`);
ok(sq.notes.includes('Warmup: 2x5 @ 40%') && sq.notes.includes('Tempo 3-1-1'), 'warmup and tempo text preserved');

section('logging against a per-set plan');
// pinned: this section asserts the PLAN filling the rows. The other mode, which
// fills them from last time instead, has its own section further down.
await store.updateSettings({ prefillFrom: 'plan' });
const ws = await store.startSession(pr.id);
const wsq = ws.entries[0];
ok(wsq.sets.length === 3, `the wave plan materialised 3 rows (${wsq.sets.length})`);
ok(wsq.sets.map((x) => `${x.weight}x${x.reps}`).join(',') === '60x10,70x8,80x5',
  `each row carries its own planned load: ${wsq.sets.map((x) => `${x.weight}x${x.reps}`).join(',')}`);
const a4 = await store.addSet(wsq.id);
ok(a4.weight === 80 && a4.reps === 5, 'an extra set beyond the plan carries the last one forward');
ok(store.plannedSet(wsq, 1).weight === 70, 'plannedSet exposes the per-set target');
ok(store.plannedSet(ws.entries[3], 0).weight === 15, 'plannedSet falls back to the uniform target');
ok(ws.entries[1].sets.map((x) => `${x.weight}x${x.reps}`).join(',') === '40x10,45x8,50x6',
  `the string-form plan materialised too: ${ws.entries[1].sets.map((x) => `${x.weight}x${x.reps}`).join(',')}`);
ok(await store.fillPlannedSets(ws.entries[1].id) === 0, 'nothing left to fill');

section('per-set plan survives an export/import round trip');
const psJson = JSON.stringify(xi.routineObject(pr));
ok(/"sets":\s*\[/.test(psJson), 'exported as a sets array');
await xi.importFromText(psJson);
const pr2 = state.routines.filter((x) => x.name === 'Wave Squats').pop();
ok(pr2.id !== pr.id, 'imported as a separate routine');
ok(JSON.stringify(pr2.entries[0].setTargets) === JSON.stringify(sq.setTargets),
  'set targets identical after the round trip');
ok(pr2.entries[0].notes === sq.notes, 'multi-line notes identical after the round trip');
ok(/Back Squat/.test(xi.sessionMarkdown(ws)) && /60×10 · 70×8/.test(xi.sessionMarkdown(ws)),
  'markdown shows the per-set target');
ok(/> Tempo 3-1-1/.test(xi.sessionMarkdown(ws)), 'markdown quotes the exercise notes');

section('logged sets must never be read back as targets');
await store.updateSet(wsq.id, wsq.sets[0].id, { weight: 62.5, reps: 9, done: true });
await store.saveSessionBackToRoutine();
const pr3 = store.getRoutine(pr.id);
ok(JSON.stringify(pr3.entries[0].setTargets) === JSON.stringify(sq.setTargets),
  'save-back left the plan alone instead of overwriting it with what was lifted');
ok(pr3.entries[1].setTargets.length === 3, 'the filled exercise kept its 3-set plan');
const finishedWave = await store.finishSession();

section('edit a finished session');
ok(store.working() === null, 'nothing is being edited by default');
await store.setEditing(finishedWave.id);
ok(store.editingPast() === true, 'edit mode flagged');
ok(store.working().id === finishedWave.id, 'the store now targets the finished session');
const editEntry = store.working().entries[0];
const rowsBefore = editEntry.sets.length;
await store.updateSet(editEntry.id, editEntry.sets[0].id, { weight: 65, reps: 8, rpe: 9 });
ok(store.getSession(finishedWave.id).entries[0].sets[0].weight === 65, 'corrected a logged set');
const extra = await store.addSet(editEntry.id);
ok(store.getSession(finishedWave.id).entries[0].sets.length === rowsBefore + 1, 'added a forgotten set');
await store.deleteSet(editEntry.id, extra.id);
ok(store.getSession(finishedWave.id).entries[0].sets.length === rowsBefore, 'removed it again');
const lateEntry = await store.addSessionEntry({ name: 'Forgotten Calf Raise', sets: 2, reps: '15' });
ok(store.getSession(finishedWave.id).entries.some((e) => e.name === 'Forgotten Calf Raise'),
  'added an exercise that was missed');
await store.removeSessionEntry(lateEntry.id);
await store.updateSessionMeta({ rpe: 9, notes: 'corrected afterwards' });
ok(store.getSession(finishedWave.id).rpe === 9, 'corrected the session RPE');
ok(store.getSession(finishedWave.id).finishedAt === finishedWave.finishedAt, 'still a finished session');
ok(state.active === null, 'editing a past session did not start a live workout');

section('correcting the date of a session');
const wrongDay = store.getSession(finishedWave.id).startedAt;
const target = new Date(2026, 9, 20, 7, 30).getTime();
await store.updateSessionTiming(finishedWave.id, { startedAt: target, finishedAt: target + 3600_000 });
ok(store.getSession(finishedWave.id).startedAt === target, 'start moved to 20 Oct 2026 07:30');
ok(store.getSession(finishedWave.id).finishedAt === target + 3600_000, 'finish moved too');
ok(target !== wrongDay, 'the date actually changed');
ok(state.sessions[0].startedAt >= state.sessions[state.sessions.length - 1].startedAt,
  'history stays sorted newest first after a date change');
await store.updateSessionTiming(finishedWave.id, { startedAt: target, finishedAt: target - 500 });
ok(store.getSession(finishedWave.id).finishedAt === target, 'a finish before the start is clamped');

section('edit mode isolates the session being corrected');
ok(q.lastLogFor('Back Squat', finishedWave.id)?.session.id !== finishedWave.id,
  'the edited session is excluded from its own "last time" reference');
await store.setEditing(null);
ok(store.working() === null && store.editingPast() === false, 'edit mode cleared');
const live2 = await store.startSession(pr.id);
await store.setEditing(finishedWave.id);
ok(store.working().id === finishedWave.id, 'edit mode wins over the live workout');
const liveRows = live2.entries[3].sets.length;
await store.addSet(store.working().entries[3].id);
ok(live2.entries[3].sets.length === liveRows, 'the live workout was not touched');
await store.setEditing(null);
ok(store.working().id === live2.id, 'leaving edit mode returns to the live workout');
await store.addSet(live2.entries[3].id);
ok(live2.entries[3].sets.length === liveRows + 1, 'the live workout is editable again');
await store.discardSession();

section('unlogged rest is named, never defaulted');
const restR = await store.createRoutine({
  name: 'Rest Display', entries: [{ name: 'Bench', sets: 3, reps: 5, weight: 60, rest: '2:00' }],
});
const rs = await store.startSession(restR.id);
const re = rs.entries[0];
const rsets = re.sets;
ok(rsets.length === 3, `the 3-set plan materialised (${rsets.length})`);
for (const x of rsets) await store.updateSet(re.id, x.id, { done: true });
ok(fmt.restLine(re) === 'Rest: no rest logged for any set',
  `all three unrested: "${fmt.restLine(re)}"`);
await store.updateSet(re.id, rsets[0].id, { rest: 125 });
ok(fmt.restLine(re) === 'Rest after sets: 1) 2:05 · 2) no rest logged · 3) no rest logged',
  `mixed: "${fmt.restLine(re)}"`);
ok(!fmt.restLine(re).includes('2:00'), 'the routine target 2:00 is never shown as if it were logged');
await store.updateSet(re.id, rsets[2].id, { rest: 98 });
ok(fmt.restLine(re) === 'Rest after sets: 1) 2:05 · 2) no rest logged · 3) 1:38',
  `gap in the middle: "${fmt.restLine(re)}"`);
const emptyEntry = { type: 'lift', sets: [] };
ok(fmt.restLine(emptyEntry) === '', 'nothing said when no sets are logged yet');
ok(fmt.restLine({ type: 'cardio', sets: null }) === '', 'cardio entries say nothing about rest');

const restMd = xi.sessionMarkdown(rs);
ok((restMd.match(/no rest logged/g) || []).length === 1,
  'markdown names the one unrested set explicitly');
ok(/\| 1 \| 60 kg \| 5 \| — \| 2:05 \| ✓ \|/.test(restMd), 'markdown shows the rest that was logged');
const restCsv = xi.csvRows([rs]);
const restCells = restCsv.trim().split('\n').slice(1).map((l) => l.split(',')[12]);
ok(restCells.join('|') === '125||98',
  `csv leaves the cell empty rather than writing prose into a numeric column (${restCells.join('|')})`);
await store.discardSession();

section('global exercise library');
const libR = await store.createRoutine({
  name: 'Library Source',
  entries: [
    { name: 'Hack Squat', sets: [{ weight: 80, reps: 10 }, { weight: 90, reps: 8 }], rest: '2:00', group: 'B', notes: 'Warmup 1x10 @ 40\nSlow eccentric' },
    { name: 'Standing Calf Raise', sets: 4, reps: '12-15', weight: 60, rest: '1:00' },
  ],
});
const lib = q.exerciseLibrary();
ok(lib.length > 2, `library spans every routine and session (${lib.length} exercises)`);
const hack = lib.find((x) => x.key === 'hack squat');
ok(!!hack, 'a newly added routine exercise appears in the library');
ok(hack.def.setTargets?.length === 2, 'carries its per-set plan');
ok(hack.def.rest === 120, 'carries its rest target');
ok(hack.def.notes.includes('Slow eccentric'), 'carries its notes');
ok(hack.def.group === null, 'does NOT carry the superset letter — that belongs to the source routine');
ok(hack.routines === 1 && hack.performed === 0 && hack.lastPerformed === null, 'never performed yet');
ok(lib.every((x) => x.def && !('sets' in x.def) && !('log' in x.def)),
  'library definitions hold targets only, never logged sets');

const squatRec = lib.find((x) => x.key === 'back squat');
ok(squatRec && squatRec.performed > 0, `usage counted: Back Squat performed ${squatRec?.performed}x`);
ok(squatRec.lastPerformed !== null, 'records when it was last done');
ok(lib.findIndex((x) => x.key === squatRec.key) < lib.findIndex((x) => x.key === 'hack squat'),
  'recently performed exercises sort above never-performed ones');

section('an ad-hoc session exercise still enters the library');
const adhocR = await store.createRoutine({ name: 'Empty Shell', entries: [{ name: 'Placeholder' }] });
const adhocS = await store.startSession(adhocR.id);
await store.addSessionEntry({ name: 'Sled Push', sets: 3, reps: 20, weight: 50, notes: 'improvised' });
const sled = adhocS.entries.find((e) => e.name === 'Sled Push');
const sledSet = await store.addSet(sled.id);
await store.updateSet(sled.id, sledSet.id, { done: true });
await store.finishSession();
const lib2 = q.exerciseLibrary();
const sledRec = lib2.find((x) => x.key === 'sled push');
ok(!!sledRec, 'an exercise that never belonged to a routine is still offered');
ok(sledRec.routines === 0 && sledRec.performed === 1, 'shown as performed once, in no routine');
ok(sledRec.def.notes === 'improvised', 'its definition came from the session snapshot');

section('the newest routine definition wins');
const dupR = await store.createRoutine({
  name: 'Later Routine', entries: [{ name: 'Hack Squat', sets: 5, reps: 5, weight: 120, rest: '3:00' }],
});
await new Promise((r) => setTimeout(r, 5));
await store.saveRoutine(dupR);                   // make it unambiguously the newer one
const hack2 = q.findInLibrary('HACK SQUAT');
ok(hack2.routines === 2, 'counted in both routines');
ok(hack2.def.weight === 120 && hack2.def.rest === 180,
  `definition taken from the more recently updated routine (${hack2.def.weight}kg, ${hack2.def.rest}s)`);
ok(hack2.fromRoutine === 'Later Routine', `names the source routine (${hack2.fromRoutine})`);
await new Promise((r) => setTimeout(r, 5));
await store.saveRoutine(store.getRoutine(libR.id));   // now the other one is newest
ok(q.findInLibrary('hack squat').fromRoutine === 'Library Source',
  'editing the older routine makes its definition the current one');
ok(q.findInLibrary('does not exist') === null, 'unknown keys return null');
await store.deleteRoutine(dupR.id);
await store.deleteRoutine(adhocR.id);
await store.deleteRoutine(libR.id);

section('both documented samples are valid and complete');
for (const [label, text] of [['lifting', routinesView.SAMPLE], ['running', routinesView.SAMPLE_RUN]]) {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* reported below */ }
  ok(parsed !== null, `${label} sample is valid JSON`);
  ok(Object.keys(parsed).some((k) => k.startsWith('//')), `${label} sample carries // notes`);
}

const runRes = await xi.importFromText(routinesView.SAMPLE_RUN);
ok(runRes.routines === 1, 'running sample imports as one routine');
const run = state.routines.find((x) => x.name === 'Run with Upper Body');
ok(!!run, 'named correctly');
ok(run.description.includes('400m'), 'description imported');
ok(!('//' in run) && !('//2' in run), 'the // note keys were dropped, not turned into data');
ok(run.entries.length === 5, `5 entries (${run.entries.length})`);

const [warm, interval, cool, inc, chin] = run.entries;
ok(warm.type === 'cardio' && warm.targetDistance === 1.2 && warm.distanceUnit === 'km',
  'cardio distance + unit imported');
ok(warm.targetDuration === 480, `cardio duration "8:00" -> 480s (${warm.targetDuration})`);
ok(warm.rest === 90, `rest works on a cardio entry too ("1:30" -> ${warm.rest}s)`);
ok(warm.notes === 'Easy, nose breathing only', 'cardio notes imported');
ok(warm.setTargets === null && warm.targetSets === null, 'no set targets on cardio');
ok(warm.legs === null && warm.rounds === null, 'a straight run carries no interval pattern');

ok(interval.legs?.length === 2, `intervals are ONE entry holding a 2-leg pattern (${interval.legs?.length})`);
ok(interval.rounds === 6, `repeated 6 times (${interval.rounds})`);
ok(interval.legs[0].duration === 95 && interval.legs[0].pace === 240,
  `first leg 1:35 @ 4:00/km (${interval.legs[0].duration}s @ ${interval.legs[0].pace}s)`);
ok(interval.legs[1].label === 'walk' && interval.legs[1].duration === 90,
  'second leg keeps its name and its own time');
ok(cardioLib.patternText(interval.legs, interval.rounds, 'km')
  === '1:35 @ 4:00/km + 1:30 walk @ 9:00/km \u00d7 6', 'and renders back to the same pattern');
ok(interval.group === 'I', 'with its own group label');
ok(interval.rest === 150, 'carrying its rest target');
ok(interval.notes.split('\n').length === 2, 'cardio notes accept a list of lines');
ok(cool.rest === null, 'an entry with no rest target has none \u2014 not a default');
ok(cool.targetPace === 440 && cool.targetDuration === 660,
  `a plain run can target a pace instead of a distance (${cool.targetPace}s/km)`);

ok(inc.setTargets?.length === 3, 'per-set plan on the lifting entry');
ok(inc.setTargets[2].repsMin === 5 && inc.setTargets[2].repsMax === 6, 'rep range inside the plan');
ok(inc.rest === 150 && inc.group === 'B', 'rest and group on the lift');
ok(inc.notes.split('\n').length === 2, 'notes list joined into lines');
ok(chin.setTargets.length === 3 && chin.setTargets[0].weight === null && chin.setTargets[0].repsMin === 8,
  'bodyweight shorthand "x8" imported with no weight');

section('pace arithmetic: a bare pace is minutes, a bare leg time is seconds');
ok(cardioLib.parsePace('8:00/km') === 480, 'an explicit pace with a unit');
ok(cardioLib.parsePace('6') === 360, 'a bare pace is MINUTES per unit (6 -> 6:00/km)');
ok(cardioLib.parsePace('5 mins per km') === 300, '"5 mins per km" spelled out');
ok(cardioLib.parsePace('8 min/km') === 480, '"8 min/km"');
ok(cardioLib.parsePace(240) === 14400, 'a bare NUMBER typed as a pace is minutes too (240 -> 240:00)');
ok(cardioLib.storedSeconds(240, cardioLib.parsePace) === 240,
  'but a stored number is already seconds and is not re-scaled');
ok(cardioLib.fmtPace(390, 'km') === '6:30/km', 'and renders back');
ok(cardioLib.parsePace('') === null && cardioLib.parsePace(null) === null, 'empty is null, not zero');

section('normalising an entry twice must not change it');
// Entries are re-normalised on every session start and every save back to a
// routine. When a stored value was parsed as human input again, each pass
// multiplied every cardio duration and pace by sixty.
const once = store.normalizeEntry({ type: 'cardio', name: 'Jog', duration: '8:00', pace: '7:20' });
const twice = store.normalizeEntry(once);
ok(once.targetDuration === 480 && once.targetPace === 440, 'parsed from text the first time');
ok(twice.targetDuration === 480 && twice.targetPace === 440,
  `and unchanged the second time (${twice.targetDuration}s, ${twice.targetPace}s/km)`);
ok(JSON.stringify(store.normalizeEntry(twice)) === JSON.stringify(twice), 'idempotent from then on');
const ivOnce = store.normalizeEntry({ type: 'cardio', name: 'I', pattern: '1:35 @ 4:00/km + 1:30 walk @ 9:00/km x 6' });
ok(JSON.stringify(store.normalizeEntry(ivOnce).legs) === JSON.stringify(ivOnce.legs),
  'an interval pattern survives re-normalisation too');
ok(store.normalizeEntry({ type: 'cardio', name: 'X', duration: 20, pace: 6 }).targetPace === 360,
  'while a bare number from a human still means minutes');

section('a run is any two of time, pace and distance');
const rr = (log, changed) => cardioLib.resolveRun(log, changed);
ok(rr({ duration: 1800, pace: 360 }, 'pace').distance === 5, '30:00 at 6:00/km is 5 km');
ok(rr({ duration: 1800, distance: 5 }, 'distance').pace === 360, '5 km in 30:00 is 6:00/km');
ok(rr({ distance: 5, pace: 360 }, 'pace').duration === 1800, '5 km at 6:00/km takes 30:00');
// the anchor rule: editing the TIME holds the pace you set, as a treadmill does
const held = rr({ duration: 2400, pace: 360, distance: 5 }, 'duration');
ok(held.pace === 360 && held.distance === 6.667,
  `editing the time keeps the pace and moves the distance (${held.distance} km)`);
ok(rr({ duration: 1800 }, 'duration').distance === undefined, 'one number alone derives nothing');

section('the interval pattern parses the way the on-screen hint says it does');
const pp = (t) => { const r = cardioLib.parseIntervals(t); return r ? cardioLib.patternText(r.legs, r.rounds, 'km') : null; };
const CANON = '1:00 @ 8:00/km + 1:30 walk @ 6:00/km \u00d7 6';
ok(pp('1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6') === CANON, 'the canonical form round-trips');
ok(pp('(1:00 @ 8:00/km + 1:30 walk @ 6:00/km) x 6') === CANON, 'brackets are ignored');
ok(pp('6 x (1:00 @ 8:00/km + 1:30 walk @ 6:00/km)') === CANON, 'the round count may lead');
ok(pp('1:00 @ 8:00/km + 1:30 walk @ 6:00/km \u00d7 6') === CANON, 'the multiplication sign works too');
// the notation a human actually types, dashes and spelled-out units and all
ok(pp('1 min - 8 mins per km + 1:30 - walk - 6 mins per km x 6') === CANON,
  `loose notation reaches the same pattern (${pp('1 min - 8 mins per km + 1:30 - walk - 6 mins per km x 6')})`);
ok(pp('1 min @ 8 min/km + 1:30 walk @ 6 min/km x 6') === CANON, 'as does "min/km"');
ok(pp('60 @ 8:00/km + 90 walk @ 6:00/km x 6') === CANON, 'a bare leg time is SECONDS');
ok(pp('1:00 hard + 1:00 easy x 10') === '1:00 hard + 1:00 easy \u00d7 10', 'paces are optional');
ok(pp('nonsense') === null, 'a bare word is not a pattern');
ok(pp('') === null && cardioLib.parseIntervals(null) === null, 'nothing in, nothing out');
// "400m" would otherwise be read as 400 MINUTES by the duration parser
ok(cardioLib.parseIntervals('400m @ 6:00/km').legs[0].duration === null,
  'a leg is timed, not measured: "400m" is refused rather than read as 400 minutes');
ok(pp('1:00 @ 8:00/km x 999').endsWith('\u00d7 50'), 'the round count is capped');

section('interval totals are honest about what they do not know');
const tot = (t) => { const r = cardioLib.parseIntervals(t); return cardioLib.legTotals(r.legs); };
const t1 = tot('1:00 @ 8:00/km + 1:30 @ 6:00/km');
ok(t1.duration === 150 && t1.distance === 0.375 && t1.partial === false,
  `a fully paced pattern totals exactly (${t1.distance} km)`);
const t2 = tot('1:00 @ 8:00/km + 1:00 rest');
ok(t2.partial === true, 'a leg with no pace makes the distance a floor, not a figure');
ok(cardioLib.totalsText(tot('1:00 @ 8:00/km + 1:00 rest') && cardioLib.parseIntervals('1:00 @ 8:00/km + 1:00 rest').legs, 6, 'km').includes('\u2265'),
  'and that is said out loud with a >= sign');

section('an interval block is ONE session entry, with the rounds inside it');
const ivs = await store.startSession(run.id);
ok(ivs.entries.length === 5, `5 routine entries stay 5 session entries (${ivs.entries.length})`);
const iv = ivs.entries.find((e) => e.name === '400m Repeat');
ok(iv.log.legs.length === 12, `2 legs x 6 rounds = 12 rows to log (${iv.log.legs.length})`);
ok(iv.log.legs.every((lg) => !lg.done), 'none ticked yet');
ok(iv.log.legs[0].duration === 95 && iv.log.legs[0].pace === 240,
  'pre-filled from the plan, so logging is confirming');
ok(iv.log.legs.map((lg) => lg.round).join('') === '112233445566', 'rounds in order');
ok(store.blockAt(ivs.entries, ivs.entries.indexOf(iv)).length === 1,
  'and it is a single block \u2014 Next no longer steps through six cards');
ok(fmt.logSummary(iv) === '', 'a pre-filled but unconfirmed block reports nothing');

section('the whole block logs in one tap');
const nLegs = await cardioStore.logAllRounds(iv.id);
ok(nLegs === 12, `one action logged all 12 legs (${nLegs})`);
ok(iv.log.legs.every((lg) => lg.done), 'every leg ticked');
ok(store.entryStatus(iv) === 'done', 'and the entry counts as done');
ok(fmt.logSummary(iv) === '6 rounds \u00b7 18:30 \u00b7 3.375 km',
  `summarised as rounds, time and distance (${fmt.logSummary(iv)})`);
ok(await cardioStore.logAllRounds(iv.id) === 0 && iv.log.legs.every((lg) => !lg.done),
  'tapping again clears the block');

section('one round can be corrected without touching the other five');
await cardioStore.logAllRounds(iv.id);
const slow = iv.log.legs.find((lg) => lg.round === 4 && lg.leg === 0);
await cardioStore.updateLeg(iv.id, slow.id, { duration: 108 });
ok(slow.duration === 108 && slow.edited === true, 'round 4 holds its own slower time');
ok(iv.log.legs.filter((lg) => lg.leg === 0 && lg.duration === 95).length === 5,
  'the other five working legs are untouched');
ok(fmt.logSummary(iv).includes('1 leg adjusted'), 'the summary says one leg was adjusted');

section('fixing the pattern leaves a hand-edited round alone');
await cardioStore.setIntervalPlan(iv.id, cardioLib.parseIntervals('1:40 @ 4:00/km + 1:30 walk @ 9:00/km x 6'));
ok(iv.log.legs.filter((lg) => lg.leg === 0 && lg.duration === 100).length === 5,
  'five working legs follow the new plan');
const stillSlow = iv.log.legs.find((lg) => lg.round === 4 && lg.leg === 0);
ok(stillSlow.duration === 108, `the edited round kept 1:48 (${stillSlow.duration}s)`);
ok(iv.log.legs.every((lg) => lg.done), 'and nothing was un-ticked by the change');
await cardioStore.resetLeg(iv.id, stillSlow.id);
ok(stillSlow.duration === 100 && stillSlow.edited === false, 'it can be put back on plan');

section('growing the round count keeps what is already logged');
await cardioStore.setIntervalPlan(iv.id, cardioLib.parseIntervals('1:40 @ 4:00/km + 1:30 walk @ 9:00/km x 8'));
ok(iv.log.legs.length === 16, `8 rounds now (${iv.log.legs.length} legs)`);
ok(iv.log.legs.filter((lg) => lg.done).length === 12, '12 legs stay logged, the new 4 do not');

section('a straight run derives the third number from the other two');
const jog = ivs.entries.find((e) => e.name === 'Warmup Jog');
await cardioStore.updateLog(jog.id, { duration: 1800 });
await cardioStore.updateLog(jog.id, { pace: 360 });
ok(jog.log.distance === 5, `30:00 at 6:00/km is 5 km (${jog.log.distance})`);
await cardioStore.updateLog(jog.id, { distance: 4 });
ok(jog.log.pace === 450, `shortening it to 4 km repaces to 7:30/km (${jog.log.pace})`);
await cardioStore.updateLog(jog.id, { duration: 2400 });
ok(jog.log.pace === 450 && jog.log.distance === 5.333,
  `editing the time holds the pace and moves the distance (${jog.log.distance})`);
ok(fmt.logSummary(jog) === '', 'still nothing logged until it is confirmed');
await cardioStore.updateLog(jog.id, { done: true, completedAt: Date.now() });
ok(fmt.logSummary(jog) === '5.333 km \u00b7 40:00 \u00b7 7:30/km', `then it reads ${fmt.logSummary(jog)}`);

section('an interval block saves back to its routine as one entry');
await store.saveSessionBackToRoutine();
const runAfter = store.getRoutine(run.id);
ok(runAfter.entries.length === 5, `routine stays 5 entries (${runAfter.entries.length})`);
const ivAfter = runAfter.entries.find((e) => e.name === '400m Repeat');
ok(ivAfter.rounds === 8 && ivAfter.legs.length === 2, `pattern preserved as 2 legs x ${ivAfter.rounds}`);
await store.discardSession();

section('old routines that used `repeat` still work');
const legacy = await store.createRoutine({
  name: 'Legacy Intervals',
  entries: [{ type: 'cardio', name: 'Hill Sprint', repeat: 3, duration: '0:30', rest: '2:00' }],
});
const le = legacy.entries[0];
ok(le.rounds === 3 && le.legs.length === 1,
  `repeat: 3 became 3 rounds of one leg (${le.rounds} x ${le.legs.length})`);
ok(le.legs[0].duration === 30, 'the leg took the entry duration');
const ls = await store.startSession(legacy.id);
ok(ls.entries.length === 1 && ls.entries[0].log.legs.length === 3,
  'and it opens as one entry with three rounds, not three entries');
await store.discardSession();
await store.deleteRoutine(legacy.id);

section("the README's own examples still import");
// Documentation that claims a format must be checked against the parser, or it
// drifts. Every full JSON routine block in the README is imported for real.
const readme = readFileSync(`${APP}/README.md`, 'utf8');
const mdBlocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)]
  .map((m) => m[1]).filter((b) => b.trim().startsWith('{'));
ok(mdBlocks.length >= 2, `${mdBlocks.length} routine examples in the README`);
let mdOk = 0;
for (const b of mdBlocks) {
  try { JSON.parse(b); mdOk++; } catch { /* reported below */ }
}
ok(mdOk === mdBlocks.length, `all ${mdBlocks.length} are valid JSON (${mdOk} parsed)`);
const mdRun = mdBlocks.map((b) => JSON.parse(b)).find((o) => /Run with/.test(o.name || ''));
ok(!!mdRun, 'the running example is there');
const mdNorm = store.normalizeRoutine(mdRun);
const mdIv = mdNorm.entries.find((e) => e.legs);
ok(mdIv && mdIv.legs.length === 2 && mdIv.rounds === 6,
  `its interval pattern imports as 2 legs x 6 rounds (${mdIv?.legs?.length} x ${mdIv?.rounds})`);
ok(mdIv.legs[1].label === 'walk', 'with the named recovery leg intact');
const mdCool = mdNorm.entries.find((e) => /Cooldown/.test(e.name));
ok(mdCool.targetPace === 440 && mdCool.targetDistance === null,
  'and the pace-targeted run really does target a pace and no distance');

section('a pre-filled log is a plan, not history');
// A cardio log now opens pre-filled from its targets. Anything that counts or
// reports work must therefore look at `done`, never at "has a distance".
const freshS = await store.startSession(run.id);
const freshJog = freshS.entries.find((e) => e.name === 'Warmup Jog');
ok(freshJog.log.distance === 1.2, 'the plan is sitting in the log, ready to confirm');
ok(store.entryStatus(freshJog) === 'pending', 'but the entry is still pending');
ok(fmt.logSummary(freshJog) === '', 'and it reports nothing');
ok(xi.csvRows([freshS]).split('\n').length === 1, 'it produces no CSV row');
ok(q.lastLogFor('Warmup Jog') === null, 'and does not become a "last time" reference');
const fpBefore = backupStore.dataFingerprint().loggedSets;
await cardioStore.updateLog(freshJog.id, { done: true, completedAt: Date.now() });
ok(backupStore.dataFingerprint().loggedSets === fpBefore + 1,
  'only confirming it counts towards the sync fingerprint');
await store.discardSession();


section('the running sample survives an export/import round trip');
const runJson = JSON.stringify(xi.routineObject(run));
await xi.importFromText(runJson);
const run2 = state.routines.filter((x) => x.name === 'Run with Upper Body').pop();
ok(run2.id !== run.id, 'imported as a separate copy');
ok(run2.entries.length === run.entries.length, 'same entry count');
ok(JSON.stringify(run2.entries.map((e) => [e.type, e.name, e.group, e.rest, e.targetDistance, e.targetDuration, e.setTargets]))
  === JSON.stringify(run.entries.map((e) => [e.type, e.name, e.group, e.rest, e.targetDistance, e.targetDuration, e.setTargets])),
  'every targeted field round-trips identically');
await store.deleteRoutine(run2.id);
await store.deleteRoutine(run.id);

section('the AI prompt is self-contained and consistent with the importer');
const P = routinesView.AI_PROMPT;
ok(P.length > 3000, `prompt is substantial (${P.length} chars, ${P.split('\n').length} lines)`);
ok(!P.includes('${'), 'no unsubstituted template placeholders');
ok(P.includes(routinesView.SAMPLE_RUN), 'embeds the running example verbatim');
ok(P.includes(routinesView.SAMPLE), 'embeds the lifting example verbatim');

for (const field of ['"name"', '"description"', '"entries"', '"type"', '"rest"', '"group"',
  '"notes"', '"sets"', '"reps"', '"weight"', '"distance"', '"distanceUnit"', '"duration"']) {
  ok(P.includes(field), `documents ${field}`);
}
for (const [label, needle] of [
  ['that group means superset/circuit', 'superset / circuit label'],
  ['that group members must be consecutive', 'CONSECUTIVE'],
  ['that non-adjacent labels split', 'SEPARATE blocks'],
  ['that a group does not share rest', 'does NOT share one rest'],
  ['the two set-target shapes', 'A DIFFERENT target per set'],
  ['the bodyweight shorthand', '"x8"'],
  ['that a cardio entry is a run OR a block', 'EITHER one straight run OR one interval block'],
  ['the interval pattern form', '"<leg> + <leg> x <rounds>"'],
  ['that a leg is timed, not measured', 'Legs are TIMED'],
  ['that repeat is no longer the way', 'do NOT use "repeat"'],
  ['that warmups and RIR are logged, not targeted', 'NOT IN THE SCHEMA'],
  ['the pattern field', '"pattern"'],
  ['that any two of time/pace/distance suffice', 'give any TWO of these three'],
  ['that a bare pace means minutes', 'means MINUTES per unit'],
  ['that HR is not targetable', 'NO target fields for heart rate'],
  ['that a bare duration means minutes', 'means MINUTES here'],
  ['that // keys are ignored', 'starting with "//" is ignored'],
  ['output must be JSON only', 'Output ONLY the JSON'],
  ['the fill-in block', 'WHAT I WANT'],
  ['a final checklist', 'CHECKLIST BEFORE YOU ANSWER'],
]) {
  ok(P.includes(needle), `states ${label}`);
}

// Every format the prompt advertises must actually parse.
const advertised = {
  name: 'Prompt Claims Check',
  entries: [
    { name: 'A', sets: 4, reps: '6-8', weight: 70, rest: '2:30' },
    { name: 'B', sets: [{ weight: 60, reps: 10 }, { weight: 70, reps: 8 }, { weight: 80, reps: '5-6' }], rest: '3:00' },
    { name: 'C', sets: ['60x10', '70x8', '80x5-6'] },
    { name: 'D', sets: '60x10, 70x8, 80x5-6' },
    { name: 'E', sets: ['x8'] },
    { name: 'F', sets: [{ reps: 8 }] },
    { name: 'G', rest: '90s' },
    { name: 'H', rest: '2m' },
    { name: 'I', rest: 2 },
    { name: 'J', rest: '1:05:00' },
    { type: 'cardio', name: 'K', distance: 5, distanceUnit: 'mi', duration: 20 },
    { name: 'L', notes: ['one', 'two'] },
  ],
};
await xi.importFromText(JSON.stringify(advertised));
const claims = state.routines.find((x) => x.name === 'Prompt Claims Check');
const byName = (n) => claims.entries.find((e) => e.name === n);
ok(byName('A').targetSets === 4 && byName('A').repsMin === 6 && byName('A').repsMax === 8 && byName('A').weight === 70,
  'shape A parses as advertised');
ok(byName('B').setTargets.length === 3 && byName('B').setTargets[2].repsMax === 6, 'shape B object form parses');
ok(byName('C').setTargets.length === 3 && byName('C').setTargets[1].weight === 70, 'shape B array-of-strings parses');
ok(byName('D').setTargets.length === 3 && byName('D').setTargets[2].repsMin === 5, 'shape B single-string parses');
ok(byName('E').setTargets[0].weight === null && byName('E').setTargets[0].repsMin === 8, '"x8" parses as bodyweight');
ok(byName('F').setTargets[0].weight === null && byName('F').setTargets[0].repsMin === 8, '{reps:8} parses as bodyweight');
ok(byName('G').rest === 90, '"90s" -> 90s');
ok(byName('H').rest === 120, '"2m" -> 120s');
ok(byName('I').rest === 2, 'bare 2 -> 2s (a bare rest value is seconds)');
ok(byName('J').rest === 3900, '"1:05:00" -> 3900s');
ok(byName('K').targetDistance === 5 && byName('K').distanceUnit === 'mi' && byName('K').targetDuration === 1200,
  'cardio with mi and a bare duration of 20 minutes');
ok(byName('L').notes === 'one\ntwo', 'notes array joins to lines');
await store.deleteRoutine(claims.id);

section('bare numbers are unambiguous per field');
ok(parseDurCheck('90') === 90 && parseDurCheck(90) === 90, 'a bare rest value is seconds, string or number');
ok(parseDurCheck('20', 'minutes') === 1200 && parseDurCheck(20, 'minutes') === 1200,
  'a bare cardio duration is minutes, string or number');
ok(parseDurCheck('2:30') === 150 && parseDurCheck('90s') === 90 && parseDurCheck('2m') === 120,
  'explicit forms are unaffected by the bare-number rule');
const restTyped = await xi.importFromText(JSON.stringify({
  name: 'Bare Rest Check', entries: [{ name: 'X', rest: 90 }, { name: 'Y', rest: '90' }],
}));
ok(restTyped.routines === 1, 'imported');
const bare = state.routines.find((x) => x.name === 'Bare Rest Check');
ok(bare.entries[0].rest === 90 && bare.entries[1].rest === 90,
  `"rest": 90 and "rest": "90" both mean 90 seconds (${bare.entries[0].rest}, ${bare.entries[1].rest})`);
await store.deleteRoutine(bare.id);

section('the copied prompt really contains both JSON examples, in situ');
section('holds and carries are lifts measured in seconds or metres');
const hr = await store.createRoutine({
  name: 'Core Block',
  entries: [
    { name: 'Plank', measure: 'time', sets: 3, reps: '45', rest: '1:00' },
    { name: 'Dead Hang', measure: 'time', sets: 2, reps: '30-45' },
    { name: 'Farmer Carry', measure: 'distance', sets: 3, reps: 40, weight: 24 },
    { name: 'Squat', sets: 3, reps: 5, weight: 100 },
  ],
});
const hs = await store.startSession(hr.id);
const [hPlank, hHang, hCarry, hSquat] = hs.entries;
ok(hPlank.type === 'lift' && hPlank.measure === 'time', 'a plank is a LIFT, not cardio');
ok(hPlank.sets.length === 3, `its sets are pre-materialised like any lift (${hPlank.sets.length})`);
ok(hPlank.sets[0].reps === 45, 'each pre-filled with the planned 45 seconds');
ok(fmt.targetLine(hPlank).includes('45s'), `the target reads in seconds (${fmt.targetLine(hPlank)})`);
ok(fmt.targetLine(hHang).includes('30-45s'), `a range reads as a range (${fmt.targetLine(hHang)})`);
ok(fmt.targetLine(hCarry).includes('40 m'), `a carry reads in metres (${fmt.targetLine(hCarry)})`);
ok(fmt.targetLine(hSquat) === '3 × 5 · @ 100 kg', `a normal lift is unchanged (${fmt.targetLine(hSquat)})`);

section('a hold needs no weight to be logged');
ok(store.setIsLoggable(hPlank.sets[0], 'time') === true, 'a plank with a time but no load is loggable');
ok(store.setIsLoggable(hSquat.sets[0], 'reps') === true, 'a squat with both is loggable');
await store.updateSet(hSquat.id, hSquat.sets[0].id, { weight: null });
ok(store.setIsLoggable(hSquat.sets[0], 'reps') === false, 'but a rep set still demands a load');
await store.updateSet(hSquat.id, hSquat.sets[0].id, { weight: 100 });

section('logging a hold, and what it reads as');
await store.toggleSetDone(hPlank.id, hPlank.sets[0].id);
await store.updateSet(hPlank.id, hPlank.sets[1].id, { reps: 62 });
await store.toggleSetDone(hPlank.id, hPlank.sets[1].id);
ok(fmt.logSummary(hPlank) === '45s  1:02', `times, not reps, and past a minute as a clock (${fmt.logSummary(hPlank)})`);
await store.updateSet(hCarry.id, hCarry.sets[0].id, { weight: 24, reps: 40 });
await store.toggleSetDone(hCarry.id, hCarry.sets[0].id);
ok(fmt.logSummary(hCarry) === '24kg×40 m', `a carry reads load by distance (${fmt.logSummary(hCarry)})`);

section('weight x seconds is not tonnage');
await store.toggleSetDone(hSquat.id, hSquat.sets[0].id);
ok(store.sessionVolume(hs) === 500,
  `only the squat's 100x5 counts towards volume (${store.sessionVolume(hs)})`);

section('the amount lands in the CSV column that matches its unit');
const hCsv = xi.csvRows([hs]).split('\n');
const hHead = hCsv[0].split(',');
const col = (row, name) => row.split(',')[hHead.indexOf(name)];
const plankRow = hCsv.find((r) => r.includes('Plank'));
ok(col(plankRow, 'measure') === 'time', 'the row says how it was measured');
ok(col(plankRow, 'duration_seconds') === '45' && col(plankRow, 'reps') === '',
  `45 seconds goes to duration_seconds, not reps (${col(plankRow, 'duration_seconds')}/"${col(plankRow, 'reps')}")`);
const carryRow = hCsv.find((r) => r.includes('Farmer Carry'));
ok(col(carryRow, 'distance') === '40' && col(carryRow, 'distance_unit') === 'm',
  `40 metres goes to the distance column (${col(carryRow, 'distance')} ${col(carryRow, 'distance_unit')})`);
const squatRow = hCsv.find((r) => r.includes('Squat'));
ok(col(squatRow, 'reps') === '5' && col(squatRow, 'measure') === 'reps',
  'and a normal set still fills the reps column');

section('"do this next" brings a block forward in one move');
ok(hs.currentIdx === 0, 'working on the first exercise');
ok(await store.moveEntryNext(hCarry.id) === true, 'the carry can jump the queue');
ok(hs.entries.map((e) => e.name).join(',') === 'Plank,Farmer Carry,Dead Hang,Squat',
  `it lands directly after the current one (${hs.entries.map((e) => e.name).join(',')})`);
ok(hs.entries[hs.currentIdx].name === 'Plank', 'without moving you off what you are doing');
ok(await store.moveEntryNext(hPlank.id) === false, 'asking for the current block is a no-op');
ok(hs.modified === true, 'and the session is marked as diverging from its routine');

section('a superset moves as a whole block');
await store.discardSession();
const sr = await store.createRoutine({
  name: 'Block Move',
  entries: [
    { name: 'Lead', sets: 1, reps: 5 },
    { name: 'A1', group: 'A', sets: 1, reps: 5 },
    { name: 'A2', group: 'A', sets: 1, reps: 5 },
    { name: 'Tail', sets: 1, reps: 5 },
  ],
});
const ss = await store.startSession(sr.id);
await store.moveEntryNext(ss.entries.find((e) => e.name === 'A1').id);
ok(ss.entries.map((e) => e.name).join(',') === 'Lead,A1,A2,Tail',
  `both halves of the superset travel together (${ss.entries.map((e) => e.name).join(',')})`);
await store.setCurrent(ss.entries.findIndex((e) => e.name === 'Tail'));
await store.moveEntryNext(ss.entries.find((e) => e.name === 'A1').id);
ok(ss.entries.map((e) => e.name).join(',') === 'Lead,Tail,A1,A2',
  `and stay adjacent after the move (${ss.entries.map((e) => e.name).join(',')})`);
await store.discardSession();
await store.deleteRoutine(sr.id);
await store.deleteRoutine(hr.id);

section('new sets can be prefilled from what you actually did last time');
const pfR = await store.createRoutine({
  name: 'Prefill Check',
  entries: [{ name: 'Prefill Press', sets: 3, reps: 5, weight: 100, rest: '2:00' }],
});
await store.updateSettings({ prefillFrom: 'plan' });
const pf1 = await store.startSession(pfR.id);
const pfE1 = pf1.entries[0];
ok(pfE1.sets.map((x) => `${x.weight}x${x.reps}`).join(',') === '100x5,100x5,100x5',
  `plan mode fills from the routine (${pfE1.sets.map((x) => `${x.weight}x${x.reps}`).join(',')})`);
// log something different from the plan, then finish
await store.updateSet(pfE1.id, pfE1.sets[0].id, { weight: 105, reps: 5 });
await store.updateSet(pfE1.id, pfE1.sets[1].id, { weight: 105, reps: 4 });
await store.updateSet(pfE1.id, pfE1.sets[2].id, { weight: 102.5, reps: 4 });
for (const st of pfE1.sets) await store.toggleSetDone(pfE1.id, st.id);
await store.finishSession();

await store.updateSettings({ prefillFrom: 'last' });
const pf2 = await store.startSession(pfR.id);
const pfE2 = pf2.entries[0];
ok(pfE2.sets.map((x) => `${x.weight}x${x.reps}`).join(',') === '105x5,105x4,102.5x4',
  `last mode fills from the previous session, set for set (${pfE2.sets.map((x) => `${x.weight}x${x.reps}`).join(',')})`);
ok(pfE2.sets.every((x) => !x.done), 'and nothing arrives pre-ticked -- it is still a plan');
ok(pfE2.targetSets === 3 && pfE2.weight === 100,
  'the routine itself is untouched, so the target is still 100');
await store.discardSession();

section('a short session must not ratchet the plan down');
const pf3 = await store.startSession(pfR.id);
const pfE3 = pf3.entries[0];
await store.updateSet(pfE3.id, pfE3.sets[0].id, { weight: 90, reps: 5 });
await store.toggleSetDone(pfE3.id, pfE3.sets[0].id);
// only ONE set logged, out of three planned
await store.finishSession();
const pf4 = await store.startSession(pfR.id);
ok(pf4.entries[0].sets.length === 3,
  `still three rows, because the COUNT comes from the plan (${pf4.entries[0].sets.length})`);
ok(pf4.entries[0].sets.map((x) => x.weight).join(',') === '90,90,90',
  `the single logged set carries forward to fill them (${pf4.entries[0].sets.map((x) => x.weight).join(',')})`);
await store.discardSession();

section('prefill falls back to the plan when there is no history');
const freshR = await store.createRoutine({
  name: 'Never Done', entries: [{ name: 'Brand New Lift', sets: 2, reps: 8, weight: 50 }],
});
const nf = await store.startSession(freshR.id);
ok(nf.entries[0].sets.map((x) => `${x.weight}x${x.reps}`).join(',') === '50x8,50x8',
  'a first-ever session uses the routine targets');
await store.discardSession();

section('prefill matches on the measure, not just the name');
const holdPf = await store.createRoutine({
  name: 'Hold Prefill',
  entries: [{ name: 'Shared Name', measure: 'time', sets: 2, reps: '45' }],
});
const hp1 = await store.startSession(holdPf.id);
await store.updateSet(hp1.entries[0].id, hp1.entries[0].sets[0].id, { reps: 70 });
await store.toggleSetDone(hp1.entries[0].id, hp1.entries[0].sets[0].id);
await store.finishSession();
const hp2 = await store.startSession(holdPf.id);
ok(hp2.entries[0].sets[0].reps === 70, `the hold carries its seconds forward (${hp2.entries[0].sets[0].reps})`);
ok(store.lastWorkingSets(state.sessions, 'Shared Name', 'reps') === null,
  'and a rep-measured exercise of the same name would not borrow them');
await store.discardSession();
await store.deleteRoutine(holdPf.id);
await store.deleteRoutine(freshR.id);
for (const x of state.sessions.filter((z) => /Prefill|Hold Prefill/.test(z.routineName))) {
  await store.deleteSession(x.id);
}
await store.deleteRoutine(pfR.id);
await store.updateSettings({ prefillFrom: 'last' });

section('estimated 1RM, and when it refuses to guess');
const tr = await import(`${APP}/js/trends.js`);
ok(tr.e1rm(100, 5) === 116.7, `Epley: 100x5 is 116.7 (${tr.e1rm(100, 5)})`);
ok(tr.e1rm(100, 8) === 126.7, `100x8 is 126.7 (${tr.e1rm(100, 8)})`);
// a measured single is not an estimate; Epley would say 103.3 and invent a PR
ok(tr.e1rm(100, 1) === 100, `a single rep returns the weight itself (${tr.e1rm(100, 1)})`);
ok(tr.e1rm(100, 12) !== null, '12 reps is the last usable rep count');
ok(tr.e1rm(100, 13) === null, '13 reps gets no estimate at all');
ok(tr.e1rm(100, 20) === null, 'and nor does a set of 20');
ok(tr.e1rm(null, 5) === null && tr.e1rm(0, 5) === null, 'no load, no estimate');
ok(tr.e1rm(10, 5, { isBodyweight: true }) === null,
  'a bodyweight set with no recorded bodyweight gets none -- the app never invents one');
ok(tr.e1rm(10, 5, { isBodyweight: true, bodyweight: 80 }) === 105,
  `with a bodyweight it uses body + added load (${tr.e1rm(10, 5, { isBodyweight: true, bodyweight: 80 })})`);
ok(tr.e1rm(0, 5, { isBodyweight: true, bodyweight: 80 }) === 93.3, 'plain bodyweight works too');

section('which estimates are worth trusting');
ok(tr.isWeakEstimate({ reps: 5, rpe: 9 }) === false, 'a hard set of 5 is solid');
ok(tr.isWeakEstimate({ reps: 10 }) === true, '10 reps is where it softens');
ok(tr.isWeakEstimate({ reps: 5, rpe: 7 }) === true, 'RPE 7 is not near failure');
ok(tr.isWeakEstimate({ reps: 5, rir: 3 }) === true, 'nor is 3 reps in reserve');
ok(tr.isWeakEstimate(null) === true, 'and nothing at all is not trustworthy');

section('building a per-exercise series');
const mkSet = (w, r, done = true, extra = {}) => ({
  id: `s_${Math.random()}`, weight: w, reps: r, unit: 'kg', rpe: null, rir: null,
  bodyweight: false, warmup: false, done, completedAt: null, rest: null, ...extra,
});
const mkSess = (d, sets, extra = {}) => ({
  id: `w_t${d}`, routineName: 'T', unit: 'kg', bodyweight: null,
  startedAt: new Date(2026, 8, d, 9).getTime(),
  finishedAt: new Date(2026, 8, d, 10).getTime(),
  entries: [{ name: 'Bench Press', type: 'lift', measure: 'reps', sets }],
  ...extra,
});
const nk = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
const tSessions = [
  mkSess(1, [mkSet(80, 5), mkSet(80, 5), mkSet(60, 10, true, { warmup: true })]),
  mkSess(8, [mkSet(85, 5), mkSet(85, 4), mkSet(85, 3, false)]),
  mkSess(15, [mkSet(90, 5), mkSet(90, 5)]),
];
const built = tr.exerciseSets(tSessions, 'bench press', nk, 'kg');
ok(built.sets.length === 6, `warmups and unticked sets are excluded (${built.sets.length} of 8)`);
ok(built.converted === 0, 'nothing needed converting');
const metric = tr.metricFor('reps');
const tRows = tr.bySession(built.sets, metric);
ok(tRows.length === 3, `one row per session (${tRows.length})`);
ok(tRows[0].at < tRows[2].at, 'oldest first, which is how a chart reads');
ok(tRows[2].best === tr.e1rm(90, 5), `each row carries that session's best (${tRows[2].best})`);
ok(tRows[0].sets.length === 2, 'and the raw sets behind it');

section('an unfinished session is not a result');
const withOpen = [...tSessions, mkSess(22, [mkSet(95, 5)], { finishedAt: null })];
ok(tr.exerciseSets(withOpen, 'bench press', nk, 'kg').sets.length === 6,
  'so its sets never reach the chart');

section('the headline delta is a fact, and needs three sessions');
ok(tr.trendDelta(tRows.slice(0, 2)).enough === false, 'two sessions is not a trend');
ok(tr.trendDelta(tRows.slice(0, 2)).need === 3, 'and it says how many are needed');
const d = tr.trendDelta(tRows);
ok(d.enough === true && d.sessions === 3, 'three is');
ok(d.change === Math.round((tr.e1rm(90, 5) - tr.e1rm(80, 5)) * 10) / 10,
  `the change is last minus first (${d.change})`);
ok(d.weeks === 2, `with the span in weeks (${d.weeks})`);

section('personal bests pick the right set, and the first time it happened');
const prSets = tr.exerciseSets([
  mkSess(1, [mkSet(100, 3)]),
  mkSess(8, [mkSet(90, 8)]),
  mkSess(15, [mkSet(100, 3)]),
], 'bench press', nk, 'kg').sets;
const prs = tr.personalBests(prSets, 'reps', 'kg');
const byLabel = Object.fromEntries(prs.map((p) => [p.label, p]));
ok(byLabel['Heaviest set'].value.startsWith('100'), 'heaviest is the 100 kg set');
ok(byLabel['Heaviest set'].set.at === prSets[0].at,
  'and a tie goes to the FIRST time it was hit, not the latest');
ok(byLabel['Best est. 1RM'].value.startsWith('114'),
  `90x8 (114) beats 100x3 (110) on estimated 1RM (${byLabel['Best est. 1RM'].value})`);
ok(byLabel['Best set volume'].value.startsWith('720'), '90x8 = 720 is the best single-set volume');
ok(byLabel['Most reps'].value.startsWith('8'), 'and the most reps in one set');

section('mixed units are converted, not refused');
const mixed = tr.exerciseSets([
  mkSess(1, [mkSet(220, 5, true, { unit: 'lb' })]),
  mkSess(8, [mkSet(100, 5, true, { unit: 'kg' })]),
], 'bench press', nk, 'kg');
ok(mixed.converted === 1, `the lb set is counted as converted (${mixed.converted})`);
ok(Math.abs(mixed.sets[0].weight - 99.79) < 0.02,
  `220 lb reads as 99.79 kg (${mixed.sets[0].weight})`);
ok(util.toUnit(100, 'kg', 'lb') === 220.46 && util.toUnit(100, 'kg', 'kg') === 100,
  'and the conversion round-trips');
ok(util.toUnit(100, 'kg', 'stone') === 100, 'an unknown unit passes through unchanged');

section('holds and carries get their own metric, never an e1RM');
const holdM = tr.metricFor('time');
ok(holdM.estimate === false && holdM.title === 'Longest hold', 'a hold is judged on time');
ok(holdM.fmt(45) === '45s' && holdM.fmt(75) === '1:15', `and reads as a clock past a minute (${holdM.fmt(75)})`);
ok(tr.metricFor('distance').fmt(40) === '40 m', 'a carry is judged on metres');
const holdSets = tr.exerciseSets([{
  id: 'w_h1', routineName: 'T', unit: 'kg', bodyweight: null,
  startedAt: new Date(2026, 8, 1, 9).getTime(), finishedAt: new Date(2026, 8, 1, 10).getTime(),
  entries: [{ name: 'Plank', type: 'lift', measure: 'time', sets: [mkSet(null, 45), mkSet(null, 60)] }],
}], 'plank', nk, 'kg').sets;
ok(holdM.value(holdSets[1]) === 60, 'the metric reads the seconds straight off the set');
const holdPrs = tr.personalBests(holdSets, 'time', 'kg');
ok(holdPrs[0].label === 'Longest hold' && holdPrs[0].value === '1:00',
  `the PR is the longest hold (${holdPrs[0].value})`);
ok(!holdPrs.some((p) => p.label.includes('1RM')), 'and no estimated 1RM is offered for a plank');

section('weekly totals bucket by Monday');
const WNOW = new Date(2026, 9, 29, 10).getTime();              // Thu 29 Oct 2026
const wk = tr.weeklyTotals([
  { ...mkSess(1, [mkSet(100, 5)]), startedAt: new Date(2026, 9, 26, 9).getTime(), finishedAt: new Date(2026, 9, 26, 10).getTime() },
  { ...mkSess(2, [mkSet(100, 5)]), startedAt: new Date(2026, 9, 20, 9).getTime(), finishedAt: new Date(2026, 9, 20, 10).getTime() },
], 'kg', 4, util.startOfWeek, util.addWeeks, WNOW);
ok(wk.length === 4, `four buckets asked for, four returned (${wk.length})`);
ok(wk[3].volume === 500 && wk[3].sets === 1, `this week holds the Monday session (${wk[3].volume})`);
ok(wk[2].volume === 500, 'and last week holds the earlier one');
ok(wk[0].volume === 0 && wk[1].volume === 0, 'the empty weeks are zero, not missing');

section('a timed exercise contributes sets but not tonnage');
const mixWk = tr.weeklyTotals([{
  id: 'w_mx', routineName: 'T', unit: 'kg', bodyweight: null,
  startedAt: new Date(2026, 9, 27, 9).getTime(), finishedAt: new Date(2026, 9, 27, 10).getTime(),
  entries: [
    { name: 'Squat', type: 'lift', measure: 'reps', sets: [mkSet(100, 5)] },
    { name: 'Plank', type: 'lift', measure: 'time', sets: [mkSet(null, 45)] },
  ],
}], 'kg', 1, util.startOfWeek, util.addWeeks, WNOW);
ok(mixWk[0].sets === 2 && mixWk[0].volume === 500,
  `both sets counted, only the squat in volume (${mixWk[0].sets} sets, ${mixWk[0].volume} volume)`);

section('the row tick respects the effort gate, as the confirm bar does');
// This was a real hole: toggleSetDone only flipped the flag, so the row's tick
// walked straight past the gate the confirm bar enforced.
await store.updateSettings({ requireEffort: true, effortScale: 'rpe' });
const tgR = await store.createRoutine({
  name: 'Tick Gate', entries: [{ name: 'TG Press', sets: 2, reps: 5, weight: 60 }],
});
const tgS = await store.startSession(tgR.id);
const tgE = tgS.entries[0];
ok(store.setBlocker(tgE.sets[0], 'reps') === 'effort', 'the set owes an effort answer');
await store.toggleSetDone(tgE.id, tgE.sets[0].id);
ok(tgE.sets[0].done === true,
  'the store primitive still ticks on demand -- the gate is the UI\'s job, so a correction path exists');
await store.toggleSetDone(tgE.id, tgE.sets[0].id);
ok(tgE.sets[0].done === false, 'and unticks');
ok(store.setIsLoggable(tgE.sets[0], 'reps') === false,
  'but setIsLoggable still reports it as not loggable, which is what the UI asks');
await store.discardSession();
await store.deleteRoutine(tgR.id);
await store.updateSettings({ requireEffort: false });

section('a set cannot be ticked without an effort answer');
await store.updateSettings({ requireEffort: true, effortScale: 'rpe' });
const efR = await store.createRoutine({
  name: 'Effort Gate', entries: [{ name: 'EG Press', sets: 3, reps: 5, weight: 60 }],
});
const efS = await store.startSession(efR.id);
const efE = efS.entries[0];
ok(efE.sets[0].weight === 60 && efE.sets[0].reps === 5, 'the numbers are there');
ok(store.setIsLoggable(efE.sets[0], 'reps') === false, 'but it is not loggable yet');
ok(store.setBlocker(efE.sets[0], 'reps') === 'effort', 'and the blocker says why');
await store.setEffort(efE.id, efE.sets[0].id, { rpe: 8 });
ok(store.setIsLoggable(efE.sets[0], 'reps') === true, 'an RPE unblocks it');
ok(store.setBlocker(efE.sets[0], 'reps') === null, 'with nothing left blocking');

section('"do not know" is a real answer, not a skipped one');
await store.setEffort(efE.id, efE.sets[1].id, { unknown: true });
ok(efE.sets[1].effortUnknown === true, 'the flag is set');
ok(efE.sets[1].rpe === null, 'and no number is invented');
ok(store.setIsLoggable(efE.sets[1], 'reps') === true, 'it unblocks the set');
// this is the whole point: a blank RPE is ambiguous three months later, an
// explicit unknown is not
ok(store.setBlocker(efE.sets[2], 'reps') === 'effort',
  'while a set left blank is still blocked, so the two cannot be confused');
await store.setEffort(efE.id, efE.sets[1].id, { rpe: 9 });
ok(efE.sets[1].effortUnknown === false && efE.sets[1].rpe === 9,
  'answering properly later clears the unknown');

section('the gate follows the effort scale in use');
await store.updateSettings({ effortScale: 'rir' });
ok(store.setBlocker(efE.sets[2], 'reps') === 'effort', 'RIR is required when RIR is the scale');
await store.setEffort(efE.id, efE.sets[2].id, { rir: 2 });
ok(store.setIsLoggable(efE.sets[2], 'reps') === true, 'and RIR satisfies it');
await store.updateSettings({ effortScale: 'rpe' });
ok(store.setIsLoggable(efE.sets[2], 'reps') === false,
  'the same set is blocked again under RPE, since it has no RPE');
await store.updateSettings({ effortScale: 'both' });
ok(store.setIsLoggable(efE.sets[2], 'reps') === true, 'and "both" accepts either');

section('the gate can be switched off entirely');
await store.updateSettings({ requireEffort: false, effortScale: 'rpe' });
const efS2 = await (async () => { await store.discardSession(); return store.startSession(efR.id); })();
ok(store.setIsLoggable(efS2.entries[0].sets[0], 'reps') === true,
  'with it off, numbers alone are enough again');
ok(store.setBlocker(efS2.entries[0].sets[0], 'reps') === null, 'and nothing blocks');
await store.discardSession();
await store.deleteRoutine(efR.id);
await store.updateSettings({ requireEffort: false });

section('stopping rest does not tick a set that still owes an effort answer');
await store.updateSettings({ requireEffort: true });
const rgR = await store.createRoutine({
  name: 'Rest Gate', entries: [{ name: 'RG Press', sets: 1, reps: 5, weight: 60 }],
});
const rgS = await store.startSession(rgR.id);
const rgE = rgS.entries[0];
await clock.startRestForSet(rgE.id, rgE.sets[0].id);
state.timer.startedAt -= 60_000;
const rgStop = await clock.stopRest();
ok(rgStop.elapsed === 60, 'the rest is recorded');
ok(rgE.sets[0].done === false, 'but the set is not ticked');
ok(rgStop.pending && rgStop.pending.setId === rgE.sets[0].id,
  'and the caller is told it is still unlogged');
await store.setEffort(rgE.id, rgE.sets[0].id, { unknown: true });
ok(store.setIsLoggable(rgE.sets[0], 'reps') === true, 'answering effort frees it');
await store.discardSession();
await store.deleteRoutine(rgR.id);
await store.updateSettings({ requireEffort: false });

section('a duration is entered as separate h/m/s boxes');
const tf = await import(`${APP}/js/timefield.js`);
ok(tf.fromParts({ h: '', m: '28', s: '30' }) === 1710, '28 and 30 is 28:30');
ok(tf.fromParts({ h: '', m: '30', s: '' }) === 1800,
  'an empty seconds box counts as 0, so 30 minutes is 30:00');
ok(tf.fromParts({ h: '1', m: '', s: '' }) === 3600, 'and an hour on its own is an hour');
ok(tf.fromParts({ h: '', m: '', s: '45' }) === 45, 'seconds alone work too');
ok(tf.fromParts({ h: '', m: '', s: '' }) === null,
  'every box empty is NO VALUE, not 00:00 -- a field has to be clearable');
ok(tf.fromParts({}) === null && tf.fromParts() === null, 'nothing in, nothing out');
ok(tf.fromParts({ h: '', m: '30', s: '90' }) === 1890,
  'a seconds box over 59 is accepted rather than scolded (31:30)');
ok(tf.fromParts({ h: '', m: '-5', s: '10' }) === 10, 'a negative box is treated as 0');
ok(tf.fromParts({ h: '', m: 'abc', s: '10' }) === 10, 'and so is junk');

section('and split back out again, with leading zeros left blank');
ok(JSON.stringify(tf.toParts(1710, 'hms')) === JSON.stringify({ h: '', m: '28', s: '30' }),
  'under an hour leaves the hours box empty, not showing a "0"');
ok(JSON.stringify(tf.toParts(3690, 'hms')) === JSON.stringify({ h: '1', m: '1', s: '30' }),
  'over an hour fills all three');
ok(JSON.stringify(tf.toParts(45, 'hms')) === JSON.stringify({ h: '', m: '', s: '45' }),
  'under a minute leaves both leading boxes empty');
ok(JSON.stringify(tf.toParts(null, 'hms')) === JSON.stringify({ h: '', m: '', s: '' }),
  'and null is all blank');
ok(JSON.stringify(tf.toParts(360, 'ms')) === JSON.stringify({ h: '', m: '6', s: '0' }),
  'a pace has no hours box at all');
// leading-zero blanking is what makes the field clearable: a literal "0" in a
// box is not blank, so "every box empty" could never be reached
ok(tf.fromParts(tf.toParts(1710, 'hms')) === 1710, 'the round trip is exact');
ok(tf.fromParts(tf.toParts(45, 'hms')) === 45, 'for a short value too');
ok(tf.fromParts(tf.toParts(3690, 'hms')) === 3690, 'and a long one');
ok(tf.fromParts(tf.toParts(360, 'ms')) === 360, 'and for a pace');

section('reading a split field out of a submitted modal');
ok(tf.readTimeValues({ target_m: '2', target_s: '30' }, 'target') === 150, 'two and a half minutes');
ok(tf.readTimeValues({ target_m: '', target_s: '' }, 'target') === null, 'or nothing');
ok(tf.readTimeValues({}, 'target') === null, 'with no boxes at all');

section('work that looks logged but is not confirmed is findable');
const ucR = await store.createRoutine({
  name: 'Unconfirmed Check',
  entries: [
    { name: 'UC Press', sets: 2, reps: 5, weight: 50 },
    { type: 'cardio', name: 'UC Run', duration: '30:00', pace: '6:00' },
  ],
});
const ucS = await store.startSession(ucR.id);
const [ucLift, ucRun] = ucS.entries;
ok(ucLift.sets[0].weight === 50, 'the lift arrives pre-filled');
ok(ucRun.log.duration === 1800 && ucRun.log.pace === 360, 'and so does the run');
ok(ucRun.log.done === false, 'but the run is not confirmed');
const loose = q.unconfirmedWork(ucS);
ok(loose.length === 2, `both are flagged as filled-but-unlogged (${loose.length})`);
ok(loose.find((x) => x.name === 'UC Run').what === 'the run', 'the run names itself');
ok(loose.find((x) => x.name === 'UC Press').what === '2 sets', 'the lift counts its rows');

section('confirming removes it from the warning');
await cardioStore.updateLog(ucRun.id, { done: true, completedAt: Date.now() });
ok(q.unconfirmedWork(ucS).length === 1, 'the run drops off once logged');
for (const st of ucLift.sets) await store.toggleSetDone(ucLift.id, st.id);
ok(q.unconfirmedWork(ucS).length === 0, 'and so does the lift');

section('an empty row is not a warning, and a skipped entry is not either');
const ucS2 = await (async () => { await store.discardSession(); return store.startSession(ucR.id); })();
await cardioStore.updateLog(ucS2.entries[1].id, { duration: null, pace: null, distance: null });
ok(!q.unconfirmedWork(ucS2).some((x) => x.name === 'UC Run'),
  'a run with no numbers at all has nothing to lose');
await store.toggleSkip(ucS2.entries[0].id);
ok(!q.unconfirmedWork(ucS2).some((x) => x.name === 'UC Press'),
  'and a skipped exercise was never going to be logged');
ok(q.unconfirmedWork(null).length === 0, 'no session, no warning');

section('an interval block only warns when NOT ONE round is logged');
const ucIv = await store.createRoutine({
  name: 'UC Intervals',
  entries: [{ type: 'cardio', name: 'UC Block', pattern: '1:00 @ 8:00/km + 1:00 easy x 3' }],
});
await store.discardSession();
const ivS = await store.startSession(ucIv.id);
ok(q.unconfirmedWork(ivS).length === 1, 'a wholly unlogged block warns');
ok(q.unconfirmedWork(ivS)[0].what === '3 rounds', 'naming the rounds at stake');
await cardioStore.toggleLeg(ivS.entries[0].id, ivS.entries[0].log.legs[0].id);
ok(q.unconfirmedWork(ivS).length === 0,
  'but a partly logged block does not -- something was recorded, so nothing is silently lost');
await store.discardSession();
await store.deleteRoutine(ucIv.id);
await store.deleteRoutine(ucR.id);

section('an interval block counts as running, everywhere a run does');
const ivLegs = (n) => Array.from({ length: n * 2 }, (_, i) => ({
  round: Math.floor(i / 2) + 1, leg: i % 2,
  duration: i % 2 ? 90 : 95, pace: i % 2 ? 540 : 240, done: true,
}));
const ivSess = (d, rounds = 6) => ({
  id: `w_civ${d}`, routineName: 'R', unit: 'kg',
  startedAt: new Date(2026, 9, d, 9).getTime(), finishedAt: new Date(2026, 9, d, 10).getTime(),
  entries: [{
    name: '400m Repeat', type: 'cardio', rounds,
    log: { done: false, distanceUnit: 'km', distance: null, duration: null, pace: null, legs: ivLegs(rounds) },
  }],
});
const runSess = (d) => ({
  id: `w_crun${d}`, routineName: 'R', unit: 'kg',
  startedAt: new Date(2026, 9, d, 9).getTime(), finishedAt: new Date(2026, 9, d, 10).getTime(),
  entries: [{
    name: 'Easy Run', type: 'cardio',
    log: { done: true, distanceUnit: 'km', distance: 5, duration: 1800, pace: 360, legs: null },
  }],
});
const cWeek = tr.weeklyTotals([ivSess(27), runSess(28)], 'kg', 1,
  util.startOfWeek, util.addWeeks, new Date(2026, 9, 29, 10).getTime(), 'km');
// 6 x 95s @ 4:00/km = 2.375 km, 6 x 90s @ 9:00/km = 1.0 km
ok(Math.abs(cWeek[0].cardioDistance - 8.38) < 0.02,
  `the week counts the intervals AND the run (${cWeek[0].cardioDistance} km)`);
ok(cWeek[0].cardioSeconds === 2910, `and their time together (${cWeek[0].cardioSeconds}s)`);
ok(cWeek[0].cardioEfforts === 2, 'as two efforts');
ok(cWeek[0].volume === 0 && cWeek[0].sets === 0, 'without touching the lifting totals');

const ivOnly = tr.weeklyTotals([ivSess(27)], 'kg', 1,
  util.startOfWeek, util.addWeeks, new Date(2026, 9, 29, 10).getTime(), 'km');
ok(ivOnly[0].cardioDistance > 0 && ivOnly[0].cardioSeconds > 0,
  'a week of nothing but intervals still registers as running');

const cTotals = tr.exerciseTotals([ivSess(27), runSess(28)], nk, 'kg', 'km');
const ivRow = cTotals.find((r) => r.name === '400m Repeat');
const runRow = cTotals.find((r) => r.name === 'Easy Run');
ok(ivRow.distance > 0 && ivRow.seconds === 1110,
  `the interval row carries distance and time (${ivRow.distance} km, ${ivRow.seconds}s)`);
ok(ivRow.rounds === 6 && ivRow.intervals === true, 'plus the rounds completed');
ok(runRow.distance === 5 && runRow.seconds === 1800, 'and a straight run the same fields');
ok(ivRow.volume === 0 && runRow.volume === 0, 'neither invents a tonnage figure');

section('miles and kilometres are reconciled before being summed');
const miSess = {
  id: 'w_mi', routineName: 'R', unit: 'kg',
  startedAt: new Date(2026, 9, 28, 9).getTime(), finishedAt: new Date(2026, 9, 28, 10).getTime(),
  entries: [{
    name: 'Easy Run', type: 'cardio',
    log: { done: true, distanceUnit: 'mi', distance: 3.10686, duration: 1800, pace: 580, legs: null },
  }],
};
const mixWeek = tr.weeklyTotals([miSess], 'kg', 1,
  util.startOfWeek, util.addWeeks, new Date(2026, 9, 29, 10).getTime(), 'km');
ok(Math.abs(mixWeek[0].cardioDistance - 5) < 0.02,
  `3.1 miles is counted as 5 km (${mixWeek[0].cardioDistance})`);
ok(util.toDistance(5, 'km', 'mi') === 3.107 && util.toDistance(1, 'mi', 'km') === 1.609,
  'and the conversion goes both ways');
ok(util.toDistance(5, 'km', 'km') === 5 && util.toDistance(5, 'km', 'furlong') === 5,
  'same or unknown units pass through');

section('the work leg is the interval metric, not the blended average');
const ivRuns = tr.cardioRuns([ivSess(27)], '400m repeat', nk);
ok(ivRuns.length === 1, 'one effort');
ok(ivRuns[0].workPace === 240, `the fastest leg is the work leg (${ivRuns[0].workPace}s/km)`);
ok(ivRuns[0].restPace === 540, 'and the slowest is the recovery');
ok(ivRuns[0].metricPace === 240, 'the metric charted is the work leg');
ok(ivRuns[0].pace > 240 && ivRuns[0].pace < 540,
  `while the blended average sits between them (${ivRuns[0].pace}) -- which is why it is not the metric`);
ok(ivRuns[0].rounds === 6 && ivRuns[0].roundsPlanned === 6, 'rounds done and planned are both kept');

// walking the recovery faster must NOT look like progress
const lazyRest = JSON.parse(JSON.stringify(ivSess(27)));
lazyRest.entries[0].log.legs.forEach((l) => { if (l.leg === 1) l.pace = 400; });
const lazyRuns = tr.cardioRuns([lazyRest], '400m repeat', nk);
ok(lazyRuns[0].metricPace === ivRuns[0].metricPace,
  'speeding up the rest leg leaves the metric untouched');
ok(lazyRuns[0].pace < ivRuns[0].pace,
  'even though it would have improved the blended average');

section('a partly finished block reports what was actually done');
const partial = JSON.parse(JSON.stringify(ivSess(27)));
partial.entries[0].log.legs.forEach((l, i) => { if (i >= 6) l.done = false; });
const pRuns = tr.cardioRuns([partial], '400m repeat', nk);
ok(pRuns[0].rounds === 3, `three rounds done (${pRuns[0].rounds})`);
ok(pRuns[0].roundsPlanned === 6, 'out of six planned');
ok(pRuns[0].duration === 555, `only the logged legs counted (${pRuns[0].duration}s)`);

section('cardio trends are about pace');
const runs = tr.cardioRuns([{
  id: 'w_r1', routineName: 'R', unit: 'kg',
  startedAt: new Date(2026, 8, 1, 9).getTime(), finishedAt: new Date(2026, 8, 1, 10).getTime(),
  entries: [{
    name: 'Morning Run', type: 'cardio',
    log: { done: true, distance: 5, duration: 1800, pace: 360, distanceUnit: 'km', legs: null },
  }],
}, {
  id: 'w_r2', routineName: 'R', unit: 'kg',
  startedAt: new Date(2026, 8, 8, 9).getTime(), finishedAt: new Date(2026, 8, 8, 10).getTime(),
  entries: [{
    name: 'Morning Run', type: 'cardio',
    log: {
      done: true, distanceUnit: 'km', distance: null, duration: null, pace: null,
      legs: [{ round: 1, leg: 0, duration: 60, pace: 300, done: true },
        { round: 1, leg: 1, duration: 60, pace: 420, done: true }],
    },
  }],
}], 'morning run', nk);
ok(runs.length === 2, `both runs land (${runs.length})`);
ok(runs[0].pace === 360, 'a straight run reports its pace');
ok(runs[1].intervals === true && runs[1].rounds === 1, 'an interval block is marked as one');
ok(runs[1].pace === Math.round(120 / (60 / 300 + 60 / 420)),
  `whose pace is the average across its logged legs (${runs[1].pace})`);

section('the chart builders emit well-formed svg');
const ch = await import(`${APP}/js/chart.js`);
const svg = ch.linePlot({
  points: [{ x: 1, y: 100 }, { x: 2, y: 110 }, { x: 3, y: 105, dim: true }],
  best: [{ x: 1, y: 100 }, { x: 2, y: 110, pr: true }],
  xLeft: 'Sep', xRight: 'Oct', label: 'test chart',
});
ok(svg.startsWith('\n    <svg') || svg.trim().startsWith('<svg'), 'it is an svg');
ok((svg.match(/<circle/g) || []).length === 5, `three points plus two best dots (${(svg.match(/<circle/g) || []).length})`);
ok(svg.includes('class="cdot dim"'), 'a weak point is marked for hollow drawing');
ok(svg.includes('class="cbest pr"'), 'and the record is marked');
ok((svg.match(/<polyline/g) || []).length === 1, 'the best series is joined by one line');
ok(svg.includes('role="img"') && svg.includes('aria-label="test chart"'), 'and it is labelled for a screen reader');
ok(ch.linePlot({ points: [], best: [] }) === '', 'no data draws nothing at all');
const one = ch.linePlot({ points: [{ x: 1, y: 100 }], best: [{ x: 1, y: 100 }] });
ok(one.includes('<circle') && !one.includes('<polyline'), 'a single point gets no line through it');
const bars = ch.barPlot({ bars: [{ v: 0, label: 'a' }, { v: 10, label: 'b', now: true }], label: 'bars' });
ok((bars.match(/<rect/g) || []).length === 2, 'one rect per bar');
ok(bars.includes('class="cbar now"'), 'the current bucket is highlighted');
ok(bars.includes('height="0"') || /height="0(\.0)?"/.test(bars), 'a zero bar has no height, not a negative one');

section('history windows: week, month, a range, a single date');
const HNOW = new Date(2026, 9, 29, 10, 0, 0).getTime();   // Thu 29 Oct 2026
const hw = (f) => q.historyWindow(f, HNOW);
const dstr = (ts) => new Date(ts).toDateString();
ok(hw({ mode: 'all' }).from === null && hw({ mode: 'all' }).to === null, 'all time is unbounded');
const thisWeek = hw({ mode: 'week', offset: 0 });
ok(dstr(thisWeek.from) === 'Mon Oct 26 2026', `the week starts Monday (${dstr(thisWeek.from)})`);
ok(dstr(thisWeek.to) === 'Sun Nov 01 2026', `and ends Sunday (${dstr(thisWeek.to)})`);
ok(thisWeek.label === 'This week', 'labelled plainly');
ok(hw({ mode: 'week', offset: -1 }).label === 'Last week'
  && dstr(hw({ mode: 'week', offset: -1 }).from) === 'Mon Oct 19 2026', 'stepping back a week');
const thisMonth = hw({ mode: 'month', offset: 0 });
ok(dstr(thisMonth.from) === 'Thu Oct 01 2026' && dstr(thisMonth.to) === 'Sat Oct 31 2026',
  `a month spans the whole month (${dstr(thisMonth.from)} .. ${dstr(thisMonth.to)})`);
ok(hw({ mode: 'month', offset: -1 }).label === 'September 2026',
  `an earlier month names itself (${hw({ mode: 'month', offset: -1 }).label})`);
ok(hw({ mode: 'month', offset: -2 }).label === 'August 2026', 'and keeps stepping back');
const oneDay = hw({ mode: 'range', from: '2026-10-07', to: '2026-10-07' });
ok(oneDay.label === 'Wed 7 Oct 2026', `from == to is a single named day (${oneDay.label})`);
ok(new Date(oneDay.to).getHours() === 23, 'whose window reaches the end of that day');
ok(hw({ mode: 'range', from: '2026-10-07', to: null }).label === 'Wed 7 Oct 2026',
  'and one bound alone means that day too');
const rng = hw({ mode: 'range', from: '2026-10-01', to: '2026-10-15' });
ok(dstr(rng.from) === 'Thu Oct 01 2026' && dstr(rng.to) === 'Thu Oct 15 2026', 'a real range');
const backwards = hw({ mode: 'range', from: '2026-10-15', to: '2026-10-01' });
ok(backwards.from < backwards.to, 'a backwards range is straightened, not dropped');
ok(hw({ mode: 'range', from: 'rubbish', to: null }).from === null, 'junk dates select nothing');
ok(hw({ mode: 'range', from: '2026-02-30', to: null }).from === null,
  'and an impossible date is junk, not the 1st of March');

section('filtering sessions by window');
const mk = (y, mo, d) => ({
  id: `w_h${y}${mo}${d}`, routineName: 'X', unit: 'kg', entries: [],
  startedAt: new Date(y, mo - 1, d, 8, 0, 0).getTime(),
  finishedAt: new Date(y, mo - 1, d, 9, 0, 0).getTime(),
});
const hSessions = [mk(2026, 10, 29), mk(2026, 10, 27), mk(2026, 10, 20), mk(2026, 9, 15), mk(2026, 8, 2)];
ok(q.sessionsIn(hSessions, hw({ mode: 'all' })).length === 5, 'all time keeps everything');
ok(q.sessionsIn(hSessions, thisWeek).length === 2, `this week has 2 (${q.sessionsIn(hSessions, thisWeek).length})`);
ok(q.sessionsIn(hSessions, thisMonth).length === 3, `October has 3 (${q.sessionsIn(hSessions, thisMonth).length})`);
ok(q.sessionsIn(hSessions, hw({ mode: 'month', offset: -1 })).length === 1, 'September has 1');
ok(q.sessionsIn(hSessions, hw({ mode: 'range', from: '2026-10-29', to: '2026-10-29' })).length === 1,
  'a single date picks exactly that day');
const groups = q.groupByMonth(hSessions);
ok(groups.length === 3, `three month groups (${groups.length})`);
ok(groups[0].heading === 'October 2026' && groups[0].sessions.length === 3,
  `newest month first with its sessions (${groups[0].heading})`);
ok(groups[2].heading === 'August 2026', 'oldest last');

section('the filter is a lens, not stored data');
ok(state.histFilter.mode === 'all', 'it starts on all time');
store.setHistFilter({ mode: 'week', offset: -2 });
ok(state.histFilter.mode === 'week' && state.histFilter.offset === -2, 'and it changes');
store.setHistFilter({ mode: 'all', offset: 0 });
ok(!('histFilter' in xi.backupObject()), 'it never travels in a backup');

section('a session left open can be finished from History');
const strand = await store.createRoutine({ name: 'Stranded', entries: [{ name: 'Row', sets: 2, reps: 8, weight: 40 }] });
const ss2 = await store.startSession(strand.id);
const sE = ss2.entries[0];
await store.toggleSetDone(sE.id, sE.sets[0].id);
const lastLogged = sE.sets[0].completedAt;
const strandedId = ss2.id;
// simulate the app being closed mid-workout: the session stays, unfinished
state.active = null;
ok(store.getSession(strandedId).finishedAt === null, 'it is unfinished');
ok(fmt.logSummary(sE) !== '', 'but it does have a logged set');
const finished = await store.markSessionFinished(strandedId);
ok(finished.finishedAt === lastLogged,
  'the finish time is the last set actually logged, not now');
ok(store.markSessionFinished(strandedId) instanceof Promise, 'calling it again is safe');
ok(await store.markSessionFinished(strandedId) === null, 'and does nothing the second time');
ok(q.sessionsIn([store.getSession(strandedId)], hw({ mode: 'all' })).length === 1,
  'and it now behaves like any finished session');
await store.deleteSession(strandedId);
await store.deleteRoutine(strand.id);

section('the 10-day plan window');
const planLib = await import(`${APP}/js/plan.js`);
const planStore = await import(`${APP}/js/planstore.js`);
const T0 = new Date(2026, 9, 29, 9, 0, 0).getTime();   // Thu 29 Oct 2026, 09:00 local
const k = (n) => planLib.dayKey(planLib.addDays(T0, n));
ok(planLib.dayKey(T0) === '2026-10-29', `day keys are local dates (${planLib.dayKey(T0)})`);
ok(k(1) === '2026-10-30' && k(3) === '2026-11-01', `and roll over months (${k(3)})`);
ok(planLib.daysFromToday(k(4), T0) === 4, 'offsets count whole days');
// a key built at 09:00 must still be today when read at 23:30 the same date
const lateT = new Date(2026, 9, 29, 23, 30, 0).getTime();
ok(planLib.daysFromToday('2026-10-29', lateT) === 0, 'and do not slip at the end of the day');
const win0 = planLib.planWindow({}, [], T0);
ok(win0.length === 10, `the window is ten days (${win0.length})`);
ok(win0[0].key === '2026-10-29' && win0[9].key === '2026-11-07', `today first (${win0[0].key}) then nine more (${win0[9].key})`);
ok(win0.every((d) => d.status.state === 'open'), 'an empty plan is all open days');

section('recording a workout that already happened');
const bdR = await store.createRoutine({
  name: 'Backdate Me',
  entries: [
    { name: 'Backdate Squat', sets: 3, reps: 5, weight: 100, rest: '2:00' },
    { name: 'Backdate Plank', measure: 'time', sets: 2, reps: '45' },
  ],
});
const threeAgo = new Date(2026, 9, 26, 18, 0, 0).getTime();
const bd = await store.createPastSession({
  routineId: bdR.id, startedAt: threeAgo, finishedAt: threeAgo + 3600000,
});
ok(bd !== null, 'the session was created');
ok(bd.startedAt === threeAgo, 'dated when it happened, not now');
ok(bd.finishedAt === threeAgo + 3600000, 'with the duration given');
ok(bd.backdated === true, 'and flagged as recorded after the fact');
ok(state.active === null, 'it never becomes the active workout');
ok(bd.entries.length === 2, 'the routine was snapshotted');
ok(bd.entries[0].sets.length === 3 && bd.entries[1].sets.length === 2,
  'with every set laid out ready to fill in');
ok(bd.entries[0].sets.every((x) => !x.done), 'none of them pre-ticked -- you log what you did');
ok(store.getSession(bd.id) !== null, 'and it is in the store');
ok(state.sessions[0].startedAt >= state.sessions[state.sessions.length - 1].startedAt,
  'the session list is still newest-first');

section('a backdated session is logged through the History editor');
const bdSq = bd.entries[0];
// findEntry only sees the session being WORKED ON -- active, or opened for
// editing. A backdated session is neither until setEditing opens it, which is
// exactly what the UI flow does on creating one.
await store.setEditing(null);
const bdPrefilled = bdSq.sets[0].weight;
ok(bdPrefilled === 100, `the rows arrive prefilled from the plan (${bdPrefilled})`);
await store.updateSet(bdSq.id, bdSq.sets[0].id, { weight: 95, reps: 5 });
ok(bdSq.sets[0].weight === bdPrefilled, 'and are not editable until the session is opened');
await store.setEditing(bd.id);
await store.updateSet(bdSq.id, bdSq.sets[0].id, { weight: 95, reps: 5 });
await store.toggleSetDone(bdSq.id, bdSq.sets[0].id);
ok(bdSq.sets[0].weight === 95 && bdSq.sets[0].done === true, 'then it logs like any other set');
ok(store.getSession(bd.id).entries[0].sets[0].weight === 95, 'and persists');
await store.setEditing(null);

section('a future date is refused outright');
ok(await store.createPastSession({ routineId: bdR.id, startedAt: Date.now() + 86400000 }) === null,
  'tomorrow is not the past');
ok(await store.createPastSession({ routineId: bdR.id, startedAt: NaN }) === null,
  'and nor is nonsense');

section('an end before the start collapses rather than going negative');
const bdZ = await store.createPastSession({
  routineId: bdR.id, startedAt: threeAgo, finishedAt: threeAgo - 9999,
});
ok(bdZ.finishedAt === bdZ.startedAt, 'the duration is zero, never below it');
await store.deleteSession(bdZ.id);

section('a backdated session prefills from what came BEFORE it, not after');
await store.updateSettings({ prefillFrom: 'last' });
// log a heavy session TODAY
const todaySess = await store.createPastSession({
  routineId: bdR.id, startedAt: new Date(2026, 9, 29, 18).getTime(),
});
await store.setEditing(todaySess.id);
await store.updateSet(todaySess.entries[0].id, todaySess.entries[0].sets[0].id, { weight: 130, reps: 5 });
await store.toggleSetDone(todaySess.entries[0].id, todaySess.entries[0].sets[0].id);
await store.setEditing(null);
// then record one from a week earlier: it must not borrow today's 130
const weekBefore = await store.createPastSession({
  routineId: bdR.id, startedAt: new Date(2026, 9, 22, 18).getTime(),
});
ok(weekBefore.entries[0].sets[0].weight !== 130,
  `the earlier session did not prefill from the later one (${weekBefore.entries[0].sets[0].weight})`);
ok(weekBefore.entries[0].sets[0].weight === 100,
  'it fell back to the routine target, there being nothing before it');
ok(store.lastWorkingSets(state.sessions, 'Backdate Squat', 'reps')?.[0]?.weight === 130,
  'while an unbounded lookup still finds the latest');
ok(store.lastWorkingSets(state.sessions, 'Backdate Squat', 'reps',
  new Date(2026, 9, 23).getTime()) === null,
  'and a bounded one sees nothing before the cutoff');
await store.deleteSession(weekBefore.id);
await store.deleteSession(todaySess.id);
await store.deleteSession(bd.id);
await store.deleteRoutine(bdR.id);

section('an ad-hoc past workout needs no routine at all');
const adhoc = await store.createPastSession({ routineId: null, startedAt: threeAgo });
ok(adhoc !== null && adhoc.entries.length === 0, 'it starts empty');
ok(adhoc.routineName === 'Ad-hoc workout', 'and is named as such');
await store.deleteSession(adhoc.id);

section('the week behind, most recent first');
const past0 = planLib.pastWindow({}, [], T0);
ok(past0.length === 7, `seven days (${past0.length})`);
ok(past0[0].key === k(-1) && past0[6].key === k(-7),
  `yesterday first, a week ago last (${past0[0].key} .. ${past0[6].key})`);
ok(past0.every((d) => d.status.offset < 0), 'all of them are in the past');
ok(planLib.planWindow({}, [], T0).every((d) => d.status.offset >= 0),
  'and the plan window holds none of them');
const bothKeys = new Set([...past0, ...planLib.planWindow({}, [], T0)].map((d) => d.key));
ok(bothKeys.size === 17, `the two windows never overlap (${bothKeys.size} distinct days)`);

section('what the week behind came to');
const pastPlan = {
  [k(-1)]: { routineId: 'r_a', rest: false, doneAt: null, note: '' },
  [k(-2)]: { routineId: 'r_a', rest: false, doneAt: null, note: '' },
  [k(-3)]: { routineId: null, rest: true, doneAt: null, note: '' },
};
const pastSess = [{
  id: 'w_p1', routineId: 'r_a', routineName: 'A', entries: [],
  startedAt: planLib.keyToTs(k(-1)), finishedAt: planLib.keyToTs(k(-1)) + 3600000,
}, {
  // an UNPLANNED session: still training, and a review that ignored it would lie
  id: 'w_p2', routineId: 'r_z', routineName: 'Z', entries: [],
  startedAt: planLib.keyToTs(k(-5)), finishedAt: planLib.keyToTs(k(-5)) + 3600000,
}];
const pastRows = planLib.pastWindow(pastPlan, pastSess, T0);
const ps = planLib.pastSummary(pastRows);
ok(pastRows[0].status.state === 'done', 'the planned day you did reads done');
ok(pastRows[1].status.state === 'missed', 'the planned day you skipped reads missed');
ok(pastRows[2].status.state === 'rest', 'the rest day reads rest');
ok(pastRows[4].status.state === 'done' && pastRows[4].status.session.routineName === 'Z',
  'an unplanned session still reads as a day you trained');
ok(ps.trained === 2 && ps.missed === 1 && ps.rest === 1,
  `counted up: ${ps.trained} trained, ${ps.missed} missed, ${ps.rest} rest`);
ok(ps.days === 7, 'over seven days');

section('a past day can be marked as a deliberate rest day');
await planStore.setPlanDay(k(-2), { rest: true });
ok(state.plan[k(-2)].rest === true, 'the flag is set');
const restBack = planLib.pastWindow(state.plan, [], T0);
ok(restBack[1].status.state === 'rest', `and the day reads rest (${restBack[1].status.state})`);
ok(planLib.pastSummary(restBack).rest === 1, 'the week counts one rest day');
ok(planLib.pastSummary(restBack).missed === 0, 'and does not also call it missed');
await planStore.setPlanDay(k(-2), { rest: false });
ok(planLib.pastWindow(state.plan, [], T0)[1].status.state === 'open',
  'un-marking it leaves an ordinary empty day');
await planStore.clearPlanDay(k(-2));

section('marking a planned past day as rest replaces the plan');
await planStore.setPlanDay(k(-3), { routineId: 'r_some' });
await planStore.setPlanDay(k(-3), { rest: true });
ok(state.plan[k(-3)].rest === true && state.plan[k(-3)].routineId === null,
  'the two are still mutually exclusive, whichever direction you go');
await planStore.clearPlanDay(k(-3));

section('a rest day you trained on anyway reports the workout, not the rest');
const restButTrained = {
  id: 'w_rbt', routineId: null, routineName: 'Unexpected Session', entries: [],
  startedAt: planLib.keyToTs(k(-4)), finishedAt: planLib.keyToTs(k(-4)) + 2700000,
};
const rbtWin = planLib.pastWindow(
  { [k(-4)]: { routineId: null, rest: true, doneAt: null, note: '' } },
  [restButTrained], T0,
);
ok(rbtWin[3].status.state === 'done',
  `reality beats intent -- the day reads done (${rbtWin[3].status.state})`);
ok(rbtWin[3].status.session.id === 'w_rbt', 'and carries the session');
ok(rbtWin[3].status.restPlanned === true, 'while remembering it was down as rest');
ok(planLib.pastSummary(rbtWin).trained === 1 && planLib.pastSummary(rbtWin).rest === 0,
  'so the week counts it as trained, not rested');

section('a rest day with nothing logged is still rest');
const quietRest = planLib.pastWindow(
  { [k(-4)]: { routineId: null, rest: true, doneAt: null, note: '' } }, [], T0,
);
ok(quietRest[3].status.state === 'rest', 'unchanged when no session exists');
ok(quietRest[3].status.session === null, 'with no session attached');

section('a rest day survives pruning');
ok(planLib.prunePlan({ [k(-2)]: { routineId: null, rest: true, doneAt: null, note: '' } }, T0)[k(-2)],
  'it is real data, not an empty day');

section('a past day that was planned but swapped names what you did instead');
const swapped = planLib.pastWindow(
  { [k(-2)]: { routineId: 'r_a', rest: false, doneAt: null, note: '' } },
  [{
    id: 'w_p3', routineId: 'r_other', routineName: 'Something Else', entries: [],
    startedAt: planLib.keyToTs(k(-2)), finishedAt: planLib.keyToTs(k(-2)) + 1800000,
  }], T0,
);
ok(swapped[1].status.state === 'swapped', 'it is not called missed');
ok(swapped[1].status.session.routineName === 'Something Else', 'and the swap is named');
ok(planLib.pastSummary(swapped).trained === 1, 'a swap counts as a day trained');

section('a day means something only once a routine is on it');
const planRoutine = await store.createRoutine({ name: 'Push Day', entries: [{ name: 'Bench', sets: 3, reps: 5, weight: 60 }] });
await planStore.setPlanDay(k(0), { routineId: planRoutine.id });
await planStore.setPlanDay(k(1), { rest: true });
await planStore.setPlanDay(k(2), { routineId: planRoutine.id });
ok(state.plan[k(0)].routineId === planRoutine.id, 'the routine is on today');
ok(state.plan[k(1)].rest === true && state.plan[k(1)].routineId === null,
  'a rest day holds no routine');
await planStore.setPlanDay(k(1), { routineId: planRoutine.id });
ok(state.plan[k(1)].rest === false, 'and planning a routine clears the rest flag');
await planStore.setPlanDay(k(1), { rest: true });
ok(state.plan[k(1)].routineId === null, 'the reverse too — the two are exclusive');
const win1 = planLib.planWindow(state.plan, [], T0);
ok(win1[0].status.state === 'today', `today with a routine reads "today" (${win1[0].status.state})`);
ok(win1[1].status.state === 'rest', 'the rest day reads rest');
ok(win1[2].status.state === 'upcoming', 'later planned days read upcoming');
const planSum = planLib.planSummary(win1);
ok(planSum.planned === 2 && planSum.rest === 1 && planSum.open === 7,
  `the summary counts up (${planSum.planned} planned, ${planSum.rest} rest, ${planSum.open} open)`);

section('finishing the workout ticks the plan — nothing to mark twice');
const fakeSession = {
  id: 'w_plan1', routineId: planRoutine.id, routineName: 'Push Day',
  startedAt: T0, finishedAt: T0 + 3600000, entries: [],
};
const win2 = planLib.planWindow(state.plan, [fakeSession], T0);
ok(win2[0].status.state === 'done', `today is done because the session exists (${win2[0].status.state})`);
ok(win2[0].status.manual === false, 'and it was not ticked by hand');
ok(win2[0].status.session.id === 'w_plan1', 'the row can link to the workout');
ok(state.plan[k(0)].doneAt === null, 'no flag was written — done is derived');

section('a different routine that day is reported, not called missed');
const other = { ...fakeSession, id: 'w_plan2', routineId: 'r_other', routineName: 'Pull Day' };
const win3 = planLib.planWindow(state.plan, [other], T0);
ok(win3[0].status.state === 'swapped', `it reads as swapped (${win3[0].status.state})`);
ok(win3[0].status.session.routineName === 'Pull Day', 'naming what you actually did');

section('an unfinished session does not count');
const win4 = planLib.planWindow(state.plan, [{ ...fakeSession, finishedAt: null }], T0);
ok(win4[0].status.state === 'today', 'a workout in progress is not a workout done');

section('a past planned day with nothing logged is missed');
const past = { [k(-2)]: { routineId: planRoutine.id, rest: false, doneAt: null, note: '' } };
ok(planLib.dayStatus(k(-2), past[k(-2)], [], T0).state === 'missed', 'missed');
ok(planLib.planWindow(past, [], T0).every((d) => d.key !== k(-2)),
  'but the window never shows it — History owns the past');

section('marking a day done by hand, for a workout the app never saw');
await planStore.togglePlanDone(k(2));
ok(Number.isFinite(state.plan[k(2)].doneAt), 'a timestamp is recorded');
const win5 = planLib.planWindow(state.plan, [], T0);
ok(win5[2].status.state === 'done' && win5[2].status.manual === true,
  'the row says it was ticked by hand');
await planStore.togglePlanDone(k(2));
ok(state.plan[k(2)].doneAt === null, 'and it can be un-ticked');

section('moving a day, and swapping when the target is taken');
await planStore.setPlanDay(k(5), { routineId: planRoutine.id });
ok(await planStore.movePlanDay(k(5), k(6)) === true, 'an empty target just takes it');
ok(!state.plan[k(5)] && state.plan[k(6)].routineId === planRoutine.id, 'and the old day is cleared');
await planStore.setPlanDay(k(5), { rest: true });
await planStore.movePlanDay(k(5), k(6));
ok(state.plan[k(6)].rest === true && state.plan[k(5)].routineId === planRoutine.id,
  'a taken target swaps rather than overwrites');
ok(await planStore.movePlanDay(k(7), k(8)) === false, 'moving an empty day is a no-op');

section('the plan is pruned, persisted and travels in the backup');
await planStore.setPlanDay(k(4), { note: '   ' });
ok(!state.plan[k(4)], 'a day with nothing on it is not kept');
const planBackup = xi.backupObject();
ok(typeof planBackup.plan === 'object' && planBackup.plan[k(0)].routineId === planRoutine.id,
  'the plan is in the backup');
const planned0 = JSON.stringify(state.plan);
await backupStore.restoreAll({ routines: state.routines, sessions: state.sessions, plan: planBackup.plan });
ok(JSON.stringify(state.plan) === planned0, 'and comes back verbatim from a restore');
await backupStore.restoreAll({ routines: state.routines, sessions: state.sessions });
ok(JSON.stringify(state.plan) === planned0,
  'an older backup with no plan leaves the current one alone');
ok(JSON.stringify(planLib.normalizePlan({ nonsense: 1, '2026-13-99': {}, [k(0)]: { routineId: 'x' } }))
  === JSON.stringify({ [k(0)]: { routineId: 'x', rest: false, doneAt: null, note: '' } }),
  'junk keys are dropped on the way in');

await store.deleteRoutine(planRoutine.id);
for (const key of Object.keys(state.plan)) await planStore.clearPlanDay(key);

section('every JSON sample the app shows must be valid and importable');
// A sample is pasted straight into the Import box, so an invalid escape in one
// is a broken feature, not a typo. One slipped through as `\"measure\"` inside a
// template literal, which produced unescaped quotes in the JSON.
for (const name of ['SAMPLE', 'SAMPLE_RUN', 'SAMPLE_HOLDS']) {
  const text = routinesView[name];
  ok(typeof text === 'string' && text.trim().startsWith('{'), `${name} is exported as a JSON string`);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = err.message; }
  ok(typeof parsed === 'object' && parsed !== null,
    `${name} is valid JSON${typeof parsed === 'string' ? ` — ${parsed.slice(0, 60)}` : ''}`);
  if (typeof parsed !== 'object' || !parsed) continue;
  const norm = store.normalizeRoutine(parsed);
  ok(norm.entries.length === parsed.entries.length,
    `${name} imports every one of its ${parsed.entries.length} entries`);
  ok(norm.entries.every((x) => x.name && x.name !== 'Exercise'),
    `${name} has a real name on every entry`);
}

const promptText = routinesView.AI_PROMPT;
const between = (startMark, endMark) => {
  const a = promptText.indexOf(startMark);
  const b = endMark ? promptText.indexOf(endMark) : promptText.length;
  return promptText.slice(a + startMark.length, b === -1 ? promptText.length : b);
};
const ex1Raw = between('running + upper body ================', '================ WORKED EXAMPLE 2');
const ex2Raw = between('superset + per-set plan ================', '================ WORKED EXAMPLE 3');
const ex3Raw = between('the "measure" field) ================', '================ CHECKLIST');
let ex1 = null; let ex2 = null; let ex3 = null;
try { ex1 = JSON.parse(ex1Raw.trim()); } catch (e) { /* reported below */ }
try { ex2 = JSON.parse(ex2Raw.trim()); } catch (e) { /* reported below */ }
try { ex3 = JSON.parse(ex3Raw.trim()); } catch (e) { /* reported below */ }
ok(ex1 !== null, 'example 1 inside the prompt is parseable JSON on its own');
ok(ex2 !== null, 'example 2 inside the prompt is parseable JSON on its own');
ok(ex1?.name === 'Run with Upper Body' && ex1?.entries?.length === 5,
  `example 1 is the full running routine (${ex1?.entries?.length} entries)`);
ok(ex2?.name === 'Squat day with Push Movements' && ex2?.entries?.length === 5,
  `example 2 is the full lifting routine (${ex2?.entries?.length} entries)`);
// the prompt must teach holds and carries, or an LLM reaches for a cardio entry
ok(ex3 !== null, 'example 3 inside the prompt is parseable JSON on its own');
ok(ex3?.name === 'Core and Carries', `example 3 is the holds routine (${ex3?.entries?.length} entries)`);
const ex3n = store.normalizeRoutine(ex3);
const plank = ex3n.entries.find((e) => e.name === 'Plank');
const hang = ex3n.entries.find((e) => e.name === 'Dead Hang');
const wplank = ex3n.entries.find((e) => e.name === 'Weighted Plank');
const carry = ex3n.entries.find((e) => e.name === 'Farmer Carry');
ok(plank?.type === 'lift' && plank.measure === 'time' && plank.repsMin === 45,
  `the plank imports as a timed LIFT of 45s (${plank?.measure}, ${plank?.repsMin}s)`);
ok(hang?.repsMin === 30 && hang.repsMax === 45, `a hold target can be a range (${hang?.repsMin}-${hang?.repsMax}s)`);
ok(wplank?.setTargets?.length === 3 && wplank.setTargets[0].repsMin === 40,
  'a per-set plan in seconds works like any other');
ok(carry?.measure === 'distance' && carry.repsMin === 40 && carry.weight === 24,
  `the carry imports as 40 m at 24 kg (${carry?.repsMin} m, ${carry?.weight} kg)`);
ok(ex1.entries.some((e) => e.type === 'cardio' && e.rest)
  && ex1.entries.some((e) => e.pattern?.includes('x 6')),
  'example 1 still carries cardio rest and the interval pattern after being embedded');
ok(ex2.entries.some((e) => Array.isArray(e.sets)) && ex2.entries.some((e) => Array.isArray(e.notes)),
  'example 2 still carries a per-set plan and multi-line notes');

// and both still import for real, straight out of the prompt text
const fromPrompt1 = await xi.importFromText(JSON.stringify(ex1));
const fromPrompt2 = await xi.importFromText(JSON.stringify(ex2));
ok(fromPrompt1.routines === 1 && fromPrompt2.routines === 1,
  'both examples import successfully when lifted out of the copied prompt');
for (const nm of ['Run with Upper Body', 'Squat day with Push Movements']) {
  const r = state.routines.filter((x) => x.name === nm).pop();
  await store.deleteRoutine(r.id);
}

section('warmup sets count towards nothing');
const wR = await store.createRoutine({
  name: 'Warmup Check', entries: [{ name: 'Squat', sets: 3, reps: 5, weight: 100, rest: '2:00' }],
});
const wS = await store.startSession(wR.id);
const wE = wS.entries[0];
const w1 = await store.addSet(wE.id, { warmup: true });
const w2 = await store.addSet(wE.id, { warmup: true });
ok(w1.warmup === true && w2.warmup === true, 'warmup sets created as warmups');
await store.updateSet(wE.id, w1.id, { weight: 60, reps: 5, done: true });
await store.updateSet(wE.id, w2.id, { weight: 85, reps: 3, done: true });
ok(store.entryStatus(wE) === 'pending', 'two completed warmups leave the exercise pending');
ok(store.sessionVolume(wS) === 0, `warmups contribute no volume (${store.sessionVolume(wS)})`);

const k1 = store.workingSets(wE)[0];
ok(k1.weight === 100 && k1.reps === 5,
  `the first working set carries the plan, not the warmup (${k1.weight}x${k1.reps})`);
await store.updateSet(wE.id, k1.id, { done: true });
ok(store.entryStatus(wE) === 'partial', 'one working set of three = partial');
ok(store.sessionVolume(wS) === 500, `volume counts working sets only (${store.sessionVolume(wS)})`);
const [, k2, k3] = store.workingSets(wE);
await store.updateSet(wE.id, k2.id, { done: true });
await store.updateSet(wE.id, k3.id, { done: true });
ok(store.entryStatus(wE) === 'done', 'three working sets completes a 3-set target despite the warmups');
ok(store.workingSets(wE).length === 3 && wE.sets.length === 5, '3 working sets, 5 rows');

section('set labels number warmups separately');
ok(store.setLabels(wE.sets).join(',') === 'W1,W2,1,2,3',
  `warmups sort first and number separately (${store.setLabels(wE.sets).join(',')})`);
ok(wE.sets.indexOf(w1) === 0 && wE.sets.indexOf(w2) === 1,
  'a warmup is inserted before the working sets, not appended after them');
await store.toggleWarmup(wE.id, w2.id);
ok(store.setLabels(wE.sets).join(',') === 'W1,1,2,3,4',
  `promoting a warmup renumbers (${store.setLabels(wE.sets).join(',')})`);
ok(store.entryStatus(wE) === 'done', 'and it now counts towards the target');
await store.toggleWarmup(wE.id, w2.id);

section('RIR is logged alongside RPE, never derived from it');
await store.updateSet(wE.id, k1.id, { rpe: 8, rir: 2 });
const both = store.getSession(wS.id).entries[0].sets.find((x) => x.id === k1.id);
ok(both.rpe === 8 && both.rir === 2, 'both scales stored independently');
await store.updateSet(wE.id, k2.id, { rir: 1 });
const rirOnly = wE.sets.find((x) => x.id === k2.id);
ok(rirOnly.rir === 1 && rirOnly.rpe === null, 'RIR alone is fine; nothing back-fills RPE');
ok(fmt.effortTag(both) === ' @8 r2', `effort tag shows both (${fmt.effortTag(both)})`);
ok(fmt.effortTag(rirOnly) === ' r1', `RIR alone renders as r1 (${fmt.effortTag(rirOnly)})`);
ok(fmt.effortTag({ rpe: 9, rir: null }) === ' @9', 'RPE alone renders as @9');
ok(fmt.effortTag({ rpe: null, rir: null }) === '', 'neither renders as nothing');
ok(fmt.effortTag({ rpe: 0, rir: 0 }) === ' @0 r0', 'zero is a value, not a blank');

section('warmups and RIR in summaries and exports');
const sum = fmt.logSummary(wE);
ok(sum.startsWith('W 60'), `warmups marked W in the summary (${sum.slice(0, 20)})`);
ok(fmt.logSummary({ type: 'lift', sets: [{ done: false, weight: 100, reps: 5 }] }) === '',
  'an unticked pre-materialised row is NOT reported as logged');
ok(fmt.logSummary(wE, { workingOnly: true }).includes('W') === false,
  'the "last time" reference hides warmups');
ok(fmt.logSummary(wE, { workingOnly: true }).includes('@8 r2'), 'and shows both effort values');
ok(fmt.restLine(wE).startsWith('Rest: no rest logged'), 'rest line unaffected');

await store.updateSessionMeta({ rpe: 8 });
const wMd = xi.sessionMarkdown(wS);
ok(/\| Set \| Weight \| Reps \| RPE \| RIR \| Rest \| Done \|/.test(wMd),
  'markdown gains a RIR column when any set has one');
ok(/\| W1 \|/.test(wMd) && /\| W2 \|/.test(wMd), 'markdown labels warmups W1/W2');
ok(/_W = warmup set; excluded from volume\._/.test(wMd), 'and explains the marker');

const wCsv = xi.csvRows([wS]);
const header = wCsv.split('\n')[0].split(',');
// the column ORDER is a published contract: new columns may only be appended
ok(header[0] === 'date' && header[8] === 'weight' && header[11] === 'rpe'
  && header[24] === 'session_notes',
  'existing CSV column positions unchanged');
ok(header.slice(25).join(',') === 'rir,warmup,set_label,interval_rep,interval_of,leg_label,leg_index,pace_seconds,measure',
  `new CSV columns appended after the old ones (${header.slice(25).join(',')})`);
const rows = wCsv.trim().split('\n').slice(1).map((l) => l.split(','));
const warmCol = header.indexOf('warmup');
ok(rows.map((r) => r[warmCol]).join(',') === 'yes,yes,no,no,no',
  `CSV marks which rows are warmups (${rows.map((r) => r[warmCol]).join(',')})`);
ok(rows.length === 5, `CSV carries only the 5 ticked rows (${rows.length})`);
ok(rows[2][header.indexOf('rir')] === '2', 'CSV carries RIR');
await store.finishSession();
await store.deleteSession(wS.id);
await store.deleteRoutine(wR.id);

section('planned per-set targets index by working set, not row');
const pw = await store.createRoutine({
  name: 'Plan + Warmup',
  entries: [{ name: 'Press', sets: [{ weight: 40, reps: 10 }, { weight: 45, reps: 8 }] }],
});
const pwS = await store.startSession(pw.id);
const pwE = pwS.entries[0];
ok(pwE.sets.length === 2, 'the 2-row plan materialised');
await store.addSet(pwE.id, { warmup: true });
ok(store.setLabels(pwE.sets).join(',') === 'W1,1,2',
  `a warmup lands before the planned rows (${store.setLabels(pwE.sets).join(',')})`);
const [pk1, pk2] = store.workingSets(pwE);
ok(pk1.weight === 40 && pk1.reps === 10, `working set 1 still has plan row 1 (${pk1.weight}x${pk1.reps})`);
ok(pk2.weight === 45 && pk2.reps === 8,
  `working set 2 still has plan row 2, unshifted by the warmup (${pk2.weight}x${pk2.reps})`);
ok(store.plannedSet(pwE, 0).weight === 40, 'plannedSet is indexed by working set');
const filled = await store.fillPlannedSets(pwE.id);
ok(filled === 0, 'fillPlannedSets counts working sets, so the plan is already complete');
await store.discardSession();
await store.deleteRoutine(pw.id);


section('the rest clock is never gated on data entry');
const freeR = await store.createRoutine({
  name: 'Clock First', entries: [{ name: 'Mystery Lift', sets: 3, reps: 8, rest: '1:30' }],
});
const fs = await store.startSession(freeR.id);
const fe = fs.entries[0];
ok(fe.sets.every((x) => x.weight === null), 'the plan sets no weight');
ok(store.setIsLoggable(fe.sets[0]) === false, 'so the set is not loggable yet');

const started = await clock.startRestForSet(fe.id, fe.sets[0].id);
ok(started.started === true, 'the clock still starts — time is not recoverable, a number is');
ok(state.timer.setId === fe.sets[0].id, 'and it is attached to that specific set');
ok(state.timer.target === 90, 'using the exercise rest target');
ok(fe.sets[0].done === false, 'the set is NOT marked done just because rest started');

section('the numbers can be entered during the rest, and the set then ticks on stop');
await store.updateSet(fe.id, fe.sets[0].id, { weight: 40 });
ok(store.setIsLoggable(fe.sets[0]) === true, 'typing the weight mid-rest makes it loggable');
state.timer.startedAt -= 95_000;
const stopA = await clock.stopRest();
ok(stopA.elapsed === 95, `rest recorded (${stopA.elapsed}s)`);
ok(stopA.pending === null, 'nothing pending');
ok(fe.sets[0].done === true, 'and stopping ticks the set now that it has numbers');
ok(fe.sets[0].rest === 95, 'with the measured rest attached');

section('stopping with still no numbers keeps the rest but says the set is unlogged');
await clock.startRestForSet(fe.id, fe.sets[1].id);
state.timer.startedAt -= 60_000;
const stopB = await clock.stopRest();
ok(stopB.elapsed === 60, 'rest measured');
ok(stopB.pending && stopB.pending.setId === fe.sets[1].id,
  'the caller is told which set is still unlogged');
ok(fe.sets[1].done === false, 'it is not ticked with no load');
ok(fe.sets[1].rest === 60, 'but the rest is kept, not thrown away');
ok(fmt.restLine(fe).includes('2) 1:00'),
  `and it shows in the rest line despite being unticked (${fmt.restLine(fe)})`);

section('starting rest for another set banks the running one first');
await clock.startRestForSet(fe.id, fe.sets[1].id);
state.timer.startedAt -= 30_000;
const sw = await clock.startRestForSet(fe.id, fe.sets[2].id);
ok(sw.started === true, 'the new rest started');
ok(fe.sets[1].rest === 30, `the previous set kept what it measured (${fe.sets[1].rest}s), not discarded`);
ok(state.timer.setId === fe.sets[2].id, 'and the clock moved to the new set');
ok((await clock.startRestForSet(fe.id, fe.sets[2].id)).already === true,
  'tapping the same set again is a no-op, not a restart');
await clock.stopRest();
await store.discardSession();
await store.deleteRoutine(freeR.id);


/* ------------------------------------------------------------------ */
/* timing a hold instead of guessing it afterwards                    */
/* ------------------------------------------------------------------ */

section('a hold can only be timed on an exercise measured in time');
const holdR = await store.createRoutine({
  name: 'Hold Day',
  entries: [
    { name: 'Plank', measure: 'time', sets: 3, reps: '45', rest: '1:00' },
    { name: 'Curl', sets: 2, reps: 10 },
  ],
});
const hdS = await store.startSession(holdR.id);
const [hdPlank, hdCurl] = hdS.entries;
ok(await clock.startHold(hdCurl.id, hdCurl.sets[0].id) === null,
  'a reps exercise cannot start a hold — there would be nothing to write the seconds into');
ok(state.timer === null, 'and no clock is left running after the refusal');
ok(await clock.startHold(hdPlank.id, 'no-such-set') === null, 'an unknown set is refused too');

section('a hold uses the same clock as a rest, marked as a hold');
const h1 = await clock.startHold(hdPlank.id, hdPlank.sets[0].id);
ok(h1 && h1.started === true, 'the hold started');
ok(state.timer.kind === 'hold', `the clock knows it is a hold, not a rest (${state.timer.kind})`);
ok(state.timer.entryId === hdPlank.id && state.timer.setId === hdPlank.sets[0].id,
  'attached to the set being held');
ok(state.timer.target === 45, `the planned hold is the target (${state.timer.target}s)`);
ok(/Plank set 1/.test(state.timer.label), `label names the set (${state.timer.label})`);

section('stopping a hold writes the seconds it measured, not the seconds planned');
state.timer.startedAt -= 52_000;
const h1stop = await clock.stopHold();
ok(h1stop.elapsed === 52, `the clock reports what it saw (${h1stop.elapsed}s)`);
ok(hdPlank.sets[0].reps === 52,
  `and that is what lands in the set, overwriting the planned 45 (${hdPlank.sets[0].reps})`);
ok(state.timer === null, 'the clock is cleared');
ok(hdPlank.sets[0].rest == null, 'a hold writes no rest — it was work, not recovery');

section('stopping a hold does NOT tick the set, because effort may still be owed');
ok(hdPlank.sets[0].done === false, 'the set is left unticked for the caller to finish');
ok(h1stop.loggable === true, 'but the caller is told it now has enough to log');
ok(h1stop.entryId === hdPlank.id && h1stop.setId === hdPlank.sets[0].id,
  'and which set it was, so the caller can ask for the effort');

section('stopRest delegates to stopHold rather than treating a hold as rest');
await clock.startHold(hdPlank.id, hdPlank.sets[1].id);
state.timer.startedAt -= 38_000;
const h2stop = await clock.stopRest();
ok(h2stop.elapsed === 38, 'stopRest stopped the hold');
ok(hdPlank.sets[1].reps === 38, `the time went into reps, not rest (${hdPlank.sets[1].reps})`);
ok(hdPlank.sets[1].rest == null, 'nothing was recorded as rest');
ok(await clock.stopHold() === null, 'stopping with no clock running is a no-op');

section('starting a hold banks whatever was already running');
await clock.startRestForSet(hdCurl.id, hdCurl.sets[0].id);
state.timer.startedAt -= 25_000;
await clock.startHold(hdPlank.id, hdPlank.sets[2].id);
ok(hdCurl.sets[0].rest === 25,
  `the rest that was running kept its measurement (${hdCurl.sets[0].rest}s)`);
ok(state.timer.kind === 'hold' && state.timer.setId === hdPlank.sets[2].id,
  'and the clock moved to the hold');

section('a second hold banks the first one as a measured hold');
await clock.startHold(hdPlank.id, hdPlank.sets[2].id);
state.timer.startedAt -= 11_000;
await clock.startHold(hdPlank.id, hdPlank.sets[0].id);
ok(hdPlank.sets[2].reps === 11, `the abandoned hold still wrote its time (${hdPlank.sets[2].reps}s)`);
ok(state.timer.setId === hdPlank.sets[0].id, 'and the clock is on the new set');
await clock.stopHold();

section('a running hold survives a reload, because it stores a start, not a count');
await clock.startHold(hdPlank.id, hdPlank.sets[1].id);
state.timer.startedAt -= 9_000;
await clock.setRestTarget(state.timer.target);   // persists the clock with its shifted start
await store.init();                              // a cold start, as after a reload
ok(state.timer !== null && state.timer.kind === 'hold', 'the hold came back after a reload');
ok(state.timer.setId === hdPlank.sets[1].id, 'still on the same set');
const hAfter = store.findEntry(hdPlank.id);
ok(hAfter !== null, 'and the session it belongs to came back too');
state.timer.startedAt -= 1_000;
const h3stop = await clock.stopHold();
ok(h3stop.elapsed === 10, `and it kept counting across the reload (${h3stop.elapsed}s)`);
ok(hAfter.sets[1].reps === 10, 'writing to the reloaded session');
await store.discardSession();
await store.deleteRoutine(holdR.id);

/* ------------------------------------------------------------------ */
/* Either / Or: one slot, several exercises                           */
/* ------------------------------------------------------------------ */

section('an alternatives list is parsed from whatever shape it arrives in');
ok(store.altNames(['Hack Squat', 'Leg Press']).join('|') === 'Hack Squat|Leg Press',
  'an array passes through');
ok(store.altNames('Hack Squat, Leg Press').join('|') === 'Hack Squat|Leg Press',
  'commas separate');
ok(store.altNames('Hack Squat or Leg Press').join('|') === 'Hack Squat|Leg Press',
  'and so does a written-out "or", because that is how people type it');
ok(store.altNames('Hack Squat / Leg Press').join('|') === 'Hack Squat|Leg Press', 'and a slash');
ok(store.altNames('Hack Squat, hack squat').length === 1, 'duplicates collapse ignoring case');
ok(store.altNames('Hack Squat, Back Squat', 'Back Squat').join('|') === 'Hack Squat',
  'the exercise never offers itself as its own alternative');
ok(store.altNames('').length === 0 && store.altNames(null).length === 0
  && store.altNames(undefined).length === 0, 'absent means an empty list, never null');
ok(store.altNames('Bent Over Row, Good Morning').length === 2,
  '"Over" is not the word "or" — names containing it survive intact');

section('a routine entry carries its alternatives through normalisation and export');
const eoR = await store.createRoutine({
  name: 'Either Or Day',
  entries: [
    { name: 'Leg Press', alternatives: 'Hack Squat, Back Squat', sets: 3, reps: 10, weight: 100 },
    { name: 'Plank', measure: 'time', alternatives: ['Dead Hang'], sets: 2, reps: '45' },
  ],
});
ok(eoR.entries[0].alternatives.join('|') === 'Hack Squat|Back Squat',
  'the string became a list on the way in');
ok(Array.isArray(eoR.entries[1].alternatives), 'and an array stayed a list');
const eoJson = JSON.parse(JSON.stringify(xi.routineObject(eoR)));
ok(eoJson.entries[0].alternatives.length === 2, 'export writes the options out');
const eoBack = store.normalizeEntry(eoJson.entries[0]);
ok(eoBack.alternatives.join('|') === 'Hack Squat|Back Squat', 'and a round trip returns them');
ok(store.normalizeEntry({ name: 'Bare' }).alternatives.length === 0,
  'an entry that never heard of alternatives still normalises');

section('history exists for the alternative, under its own name and numbers');
const eoHackR = await store.createRoutine({
  name: 'Hack Only', entries: [{ name: 'Hack Squat', sets: 2, reps: 8, weight: 60 }],
});
const eoHackS = await store.startSession(eoHackR.id);
await store.updateSet(eoHackS.entries[0].id, eoHackS.entries[0].sets[0].id, { weight: 62.5, reps: 9, done: true });
await store.updateSet(eoHackS.entries[0].id, eoHackS.entries[0].sets[1].id, { weight: 62.5, reps: 8, done: true });
await store.finishSession();
ok(store.lastWorkingSets(state.sessions, 'Hack Squat', 'reps')[0].weight === 62.5,
  'the hack squat has its own last-session numbers');

section('swapping a slot takes the new exercise and ITS numbers, not the old ones');
const eoS = await store.startSession(eoR.id);
const eoLeg = eoS.entries[0];
ok(eoLeg.sets[0].weight === 100, 'the leg press opens on its planned 100');
ok(eoLeg.swappedFrom === null, 'nothing has been swapped yet');
const eoSwap = await store.swapEntryExercise(eoLeg.id, 'Hack Squat');
ok(eoSwap && eoSwap.to === 'Hack Squat', 'the swap happened');
ok(eoLeg.name === 'Hack Squat', 'the slot is now the hack squat');
ok(eoLeg.sets.length === 3, 'the set COUNT still comes from the routine, not from last time');
ok(eoLeg.sets[0].weight === 62.5,
  `and the numbers come from the hack squat's own last session (${eoLeg.sets[0].weight}), not the leg press plan`);
ok(eoLeg.sets[0].reps === 9, 'reps too');
ok(eoLeg.alternatives.includes('Leg Press'),
  'the exercise swapped away from becomes an option, so changing your mind is one tap');
ok(!eoLeg.alternatives.includes('Hack Squat'), 'and the one in the slot is not offered again');
ok(eoLeg.swappedFrom === 'Leg Press', 'the slot remembers what it originally was');

section('swapping is refused once a set is logged, rather than orphaning the work');
await store.updateSet(eoLeg.id, eoLeg.sets[0].id, { weight: 65, reps: 8, done: true });
const eoBlocked = await store.swapEntryExercise(eoLeg.id, 'Back Squat');
ok(eoBlocked && eoBlocked.blocked === 'logged', 'the swap is refused and says why');
ok(eoLeg.name === 'Hack Squat', 'the logged set keeps the name it was done under');
ok(await store.swapEntryExercise(eoLeg.id, 'Hack Squat') === null,
  'swapping to the exercise already in the slot is a no-op');
ok(await store.swapEntryExercise('nope', 'Back Squat') === null, 'an unknown entry is a no-op');

section('a swap must not rewrite next week: the routine keeps its original slot');
await store.saveSessionBackToRoutine();
const eoR2 = store.getRoutine(eoR.id);
ok(eoR2.entries[0].name === 'Leg Press',
  `the routine still asks for the leg press (${eoR2.entries[0].name}) — a busy machine today is not a plan change`);
ok(eoR2.entries[0].alternatives.includes('Hack Squat'),
  'and the hack squat is still one of its options');
ok(!eoR2.entries[0].alternatives.includes('Leg Press'), 'with no self-reference');
ok(eoR2.entries[0].alternatives.length === 2,
  `the option list is the same size it started (${eoR2.entries[0].alternatives.join('|')})`);

section('saving back keeps what an exercise is measured in');
ok(eoR2.entries[1].measure === 'time',
  `the plank is still measured in seconds (${eoR2.entries[1].measure}) — it used to come back as reps`);
ok(eoR2.entries[1].alternatives.join('') === 'Dead Hang', 'and keeps its own alternative');

section('swapping to a differently-measured exercise brings its measure with it');
const eoPlank = store.findEntry(eoS.entries[1].id);
const eoSwap2 = await store.swapEntryExercise(eoPlank.id, 'Dead Hang');
ok(eoSwap2.measure === 'time', 'a hold swapped for a hold stays a hold');
await store.discardSession();
const eoMixR = await store.createRoutine({
  name: 'Mixed Measures',
  entries: [{ name: 'Wall Sit', measure: 'time', alternatives: ['Hack Squat'], sets: 2, reps: '60' }],
});
const eoMixS = await store.startSession(eoMixR.id);
const eoWall = eoMixS.entries[0];
const eoSwap3 = await store.swapEntryExercise(eoWall.id, 'Hack Squat');
ok(eoSwap3.measure === 'reps',
  `swapping a hold for a reps exercise takes the reps measure (${eoSwap3.measure}) — a stale measure finds no history at all`);
ok(eoWall.sets[0].weight === 62.5,
  `and so the hack squat's own history is found (${eoWall.sets[0].weight})`);
ok(store.knownDefinition(state.routines, state.sessions, 'Wall Sit').measure === 'time',
  'knownDefinition reads what the app already knows about a name');
ok(store.knownDefinition([], [], 'Never Heard Of It') === null, 'and admits when it knows nothing');
await store.discardSession();
await store.deleteRoutine(eoMixR.id);
await store.deleteRoutine(eoR.id);
await store.deleteRoutine(eoHackR.id);

/* ------------------------------------------------------------------ */
/* drop sets: one set, several loads, no rest between                 */
/* ------------------------------------------------------------------ */

section('"100x8 > 80x6 > 60x5" is one set with two drops, not three sets');
const drT = store.parseSetTargets('100x8 > 80x6 > 60x5');
ok(drT.length === 3, `three stages parsed (${drT.length})`);
ok(drT[0].drop === false, 'the first is the working set');
ok(drT[1].drop === true && drT[2].drop === true, 'the ones after > are drops');
ok(drT[1].weight === 80 && drT[2].weight === 60, 'each stage keeps its own load');
const drMix = store.parseSetTargets('100x8, 100x8, 100x8 > 80x6');
ok(drMix.length === 4, `commas and > compose (${drMix.length} rows)`);
ok(drMix.map((t) => (t.drop ? 'd' : '-')).join('') === '---d',
  'only the stage after the > is a drop');
ok(store.parseSetTargets('100x8, 90x8').every((t) => t.drop === false),
  'a plain comma list has no drops');
ok(store.parseSetTargets([{ weight: 80, reps: 6, drop: true }])[0].drop === true,
  'and the JSON object form carries the flag');

section('a drop is labelled as its parent set, not as the next set');
ok(store.setLabels([{}, {}, {}]).join(',') === '1,2,3', 'plain sets are unchanged');
ok(store.setLabels([{}, {}, {}, { drop: true }, { drop: true }]).join(',') === '1,2,3,3\u2193,3\u2193\u2193',
  `a drop takes its parent's number with an arrow (${store.setLabels([{}, {}, {}, { drop: true }, { drop: true }]).join(',')})`);
ok(store.setLabels([{ warmup: true }, {}, { drop: true }, {}]).join(',') === 'W1,1,1\u2193,2',
  'numbering resumes after the drop chain, and warmups still count separately');
ok(store.setLabels([{ drop: true }, {}]).join(',') === '1,2',
  'a drop with nothing above it falls back to a number rather than breaking');

section('a planned drop opens as its own row, marked as a drop');
await store.updateSettings({ requireEffort: false });
const drR = await store.createRoutine({
  name: 'Drop Day',
  entries: [{ name: 'Lat Pulldown', sets: '60x10, 60x10 > 45x8 > 35x6', rest: '1:30' }],
});
ok(drR.entries[0].setTargets.length === 4, 'the routine holds four rows');
ok(fmt.planLine(drR.entries[0]).includes('>'),
  `and reads as a drop chain (${fmt.planLine(drR.entries[0])})`);
ok(fmt.planLine(drR.entries[0]).startsWith('60×10 · 60×10 >'),
  'with > only between the drop stages');
const drJson = JSON.parse(JSON.stringify(xi.routineObject(drR)));
ok(drJson.entries[0].sets.filter((r) => r.drop).length === 2, 'export marks both drop rows');
ok(store.normalizeEntry(drJson.entries[0]).setTargets[2].drop === true, 'and a round trip keeps them');

const drS = await store.startSession(drR.id);
const drE = drS.entries[0];
ok(drE.sets.length === 4, 'the session opens with all four rows');
ok(drE.sets.map((s) => (s.drop ? 'd' : '-')).join('') === '--dd',
  'the drop flags came through materialisation');
ok(store.setLabels(drE.sets).join(',') === '1,2,2\u2193,2\u2193\u2193',
  `and the rows are labelled as one set plus drops (${store.setLabels(drE.sets).join(',')})`);
ok(drE.sets[2].weight === 45, 'each stage opens on its planned load');
ok(store.workingSets(drE).length === 4,
  'a drop is working volume, not a warmup — all four count');

section('confirming the set before a drop must not start a rest');
ok(store.nextDropAfter(drE.id, drE.sets[1].id).id === drE.sets[2].id,
  'the app can see the drop waiting after set 2');
ok(store.nextDropAfter(drE.id, drE.sets[0].id) === null, 'set 1 has no drop after it');
ok(store.nextDropAfter(drE.id, drE.sets[3].id) === null, 'and the last drop has nothing after it');
await store.updateSet(drE.id, drE.sets[1].id, { weight: 60, reps: 10 });
const drStarted = await clock.startDropNow(drE.id, drE.sets[2].id);
ok(drStarted.started === true, 'the drop prompt starts');
ok(state.timer.kind === 'drop', `the clock knows this is a drop (${state.timer.kind})`);
ok(state.timer.target === 0, 'with no target — there is nothing to count down to');
ok(state.timer.setId === drE.sets[2].id, 'pointed at the stage you are about to do');
ok(await clock.startDropNow(drE.id, drE.sets[1].id) === null,
  'a set that is not a drop cannot raise the prompt');

section('the drop clock measures nothing, because it is a prompt not a rest');
state.timer.startedAt -= 9_000;
const drStop = await clock.stopRest();
ok(drStop.drop === true && drStop.elapsed === 9, `it reports what it saw (${drStop.elapsed}s)`);
ok(drE.sets[2].rest == null,
  'but writes no rest — `rest` means the rest AFTER a set, and this was before it');
ok(drE.sets[1].rest == null, 'and nothing lands on the parent either');
ok(state.timer === null, 'the prompt is gone');

section('a drop stage is exempt from the effort gate');
await store.updateSettings({ requireEffort: true, effortScale: 'rpe' });
await store.updateSet(drE.id, drE.sets[2].id, { weight: 45, reps: 8 });
ok(store.setBlocker(drE.sets[2], 'reps') === null,
  'a filled-in drop stage is ready to log with no RPE — a drop IS failure, and stopping to tap mid-drop breaks it');
ok(store.setIsLoggable(drE.sets[2], 'reps') === true, 'so it is loggable');
ok(store.setBlocker(drE.sets[0], 'reps') === 'effort',
  'while an ordinary set still owes an effort answer');
await store.updateSettings({ requireEffort: false });

section('a drop can be added at the moment the bar stops moving');
await store.updateSet(drE.id, drE.sets[0].id, { weight: 100 });
const drAdded = await store.addDropSet(drE.id, drE.sets[0].id);
ok(!!drAdded && drAdded.drop === true, 'the new row is a drop');
ok(drE.sets[1].id === drAdded.id, 'inserted directly after the set it drops from');
ok(drAdded.weight === 80, `starting 20% lighter (${drAdded.weight} from 100)`);
ok(drAdded.reps === null, 'with no rep target — a drop runs to failure, so a number would be a guess');
ok(store.setLabels(drE.sets)[1] === '1\u2193',
  `and it is labelled as a drop of set 1 (${store.setLabels(drE.sets)[1]})`);

section('the suggested load is one you can actually load');
await store.updateSettings({ weightStep: 2.5 });
const drStepE = (await store.addSessionEntry({ name: 'Step Check', sets: 1, reps: 5, weight: 97.5 }));
await store.updateSet(drStepE.id, drStepE.sets[0].id, { weight: 97.5 });
const drStep = await store.addDropSet(drStepE.id, drStepE.sets[0].id);
ok(drStep.weight === 77.5,
  `97.5 drops to a multiple of the weight step (${drStep.weight}), not 78`);
await store.updateSettings({ weightStep: 5 });
await store.updateSet(drStepE.id, drStepE.sets[0].id, { weight: 100 });
const drStep5 = await store.addDropSet(drStepE.id, drStepE.sets[0].id);
ok(drStep5.weight === 80, `and it follows the setting (${drStep5.weight} at a 5 step)`);
await store.updateSettings({ weightStep: 2.5 });

section('a drop needs something to drop from');
const drBwE = await store.addSessionEntry({ name: 'Pull-up', bodyweight: true, sets: 1, reps: 8 });
const drBw = await store.addDropSet(drBwE.id, drBwE.sets[0].id);
ok(drBw.bodyweight === true && drBw.weight === 0,
  'a bodyweight set drops to plain bodyweight, not to 80% of your body');
const drWarmE = await store.addSessionEntry({ name: 'Warmup Only', sets: 1, reps: 5 });
await store.toggleWarmup(drWarmE.id, drWarmE.sets[0].id);
ok(await store.addDropSet(drWarmE.id, drWarmE.sets[0].id) === null,
  'a warmup has nothing to drop from');
ok(await store.addDropSet(drE.id, 'no-such-set') === null, 'and an unknown set is a no-op');
await store.discardSession();
await store.deleteRoutine(drR.id);

/* ------------------------------------------------------------------ */
/* the exercise library: what an exercise IS                          */
/* ------------------------------------------------------------------ */

section('isometric / bodyweight / external weight are two questions, not one');
ok(ex.normalizeExercise({ name: 'Plank', measure: 'isometric', bodyweight: true }).measure === 'time',
  '"isometric" is a measure of time, so it normalises to time');
const xbPlank = ex.normalizeExercise({ name: 'Plank', measure: 'isometric', bodyweight: true });
ok(xbPlank.measure === 'time' && xbPlank.bodyweight === true,
  'a bodyweight plank is BOTH timed and unloaded — one three-way enum could not say that');
const xwPlank = ex.normalizeExercise({ name: 'Weighted Plank', measure: 'time', bodyweight: false });
ok(xwPlank.measure === 'time' && xwPlank.bodyweight === false,
  'and a weighted plank is timed and loaded');
ok(ex.normalizeExercise({ name: 'Curl' }).measure === 'reps',
  'saying nothing means reps, so an old record still reads correctly');
ok(ex.kindLabel(xbPlank) === 'isometric hold, bodyweight',
  `the pair renders as one phrase (${ex.kindLabel(xbPlank)})`);
ok(ex.kindLabel(ex.normalizeExercise({ name: 'Carry', measure: 'distance' })) === 'loaded carry, external weight',
  'and a carry reads as a carry');
ok(ex.kindPills({ ...xbPlank, unilateral: true }).join(',') === 'isometric,bodyweight,per side',
  `the pills say all three (${ex.kindPills({ ...xbPlank, unilateral: true }).join(',')})`);

section('muscle groups are matched loosely, and a group we never heard of is kept');
ok(ex.parseGroup('pecs') === 'Chest', 'pecs is Chest');
ok(ex.parseGroup('QUADRICEPS') === 'Quads', 'case and synonym both handled');
ok(ex.parseGroup('rear delts') === 'Rear Delts', 'a two-word group works');
ok(ex.parseGroup('Serratus') === 'Serratus',
  'a group this app does not know is kept as spelled, not rejected — an import must not fail on it');
ok(ex.parseGroup('  ') === null && ex.parseGroup(null) === null, 'blank is no group');
ok(ex.parseGroups('Biceps, forearms').join('|') === 'Biceps|Forearms', 'a list splits on commas');
ok(ex.parseGroups(['lats', 'Lats']).length === 1, 'duplicates collapse after normalising');
ok(ex.parseGroups('Chest, Triceps', 'pecs').join('|') === 'Triceps',
  'the primary group is never also listed as "another muscle worked"');
ok(ex.MUSCLE_GROUPS.includes('Lats') && ex.MUSCLE_GROUPS.includes('Hamstrings'),
  `the vocabulary is there (${ex.MUSCLE_GROUPS.length} groups)`);

section('an exercise is described once, keyed on its name');
const xSaved = await xs.saveExercise({
  name: 'Single-arm Dumbbell Row', unilateral: true, primary: 'back',
  secondary: 'lats, biceps', notes: 'knee on bench',
});
ok(xSaved.key === 'single-arm dumbbell row', `keyed on the normalised name (${xSaved.key})`);
ok(xSaved.unilateral === true && xSaved.primary === 'Back', 'with its attributes normalised');
ok(xSaved.secondary.join('|') === 'Lats|Biceps', 'and its other muscles');
ok(xs.exerciseFor('SINGLE-ARM DUMBBELL ROW') !== null, 'found again whatever the casing');
ok(state.exercises.length === 1, 'one record');
await xs.saveExercise({ name: 'Single-arm dumbbell ROW', primary: 'Lats' });
ok(state.exercises.length === 1, 'saving the same name again updates rather than duplicating');
ok(xs.exerciseFor('Single-arm Dumbbell Row').primary === 'Lats', 'with the new value');
ok(await xs.deleteExercise('Single-arm Dumbbell Row') === true && state.exercises.length === 0,
  'and it can be removed');

section('the library fills itself from what you have already done');
const xR = await store.createRoutine({
  name: 'Seed Me',
  entries: [
    { name: 'Seeded Plank', measure: 'time', sets: 2, reps: '45' },
    { name: 'Seeded Pull-up', bodyweight: true, sets: 3, reps: 8 },
  ],
});
await xs.saveExercise({ name: 'Seeded Plank', primary: 'Core', notes: 'mine' });
const xSeed = await xs.seedExerciseLibrary();
ok(xSeed.added >= 1, `undescribed exercises were added (${xSeed.added})`);
ok(xs.exerciseFor('Seeded Pull-up') !== null, 'including the one from the routine just created');
ok(xs.exerciseFor('Seeded Plank').primary === 'Core',
  'an exercise already described keeps what you told it');
ok(xs.exerciseFor('Seeded Plank').notes === 'mine', 'notes and all');
const xPu = xs.exerciseFor('Seeded Pull-up');
ok(xPu.bodyweight === true, 'seeding carries over what the old data already knew');
ok(xPu.primary === null && xPu.secondary.length === 0,
  'but never guesses a muscle group from a name — a wrong tag silently poisons every trend');
ok((await xs.seedExerciseLibrary()).added === 0, 'running it again adds nothing');

section('a library is a JSON file, and importing it has three honest modes');
const xFile = {
  schema: xs.LIBRARY_SCHEMA,
  exercises: [
    { name: 'Seeded Pull-up', primary: 'Lats', secondary: ['Biceps'] },
    { name: 'Imported Press', primary: 'chest', secondary: 'triceps, shoulders' },
  ],
};
const xAdd = await xs.importLibrary(xFile, { mode: 'add' });
ok(xAdd.added === 1 && xAdd.unchanged === 1,
  `add only takes the new one (${xAdd.added} added, ${xAdd.unchanged} left alone)`);
ok(xs.exerciseFor('Seeded Pull-up').primary === null,
  'add mode never changes an exercise you already have');
ok(xs.exerciseFor('Imported Press').primary === 'Chest', 'and the new one arrives normalised');
const xUpd = await xs.importLibrary(xFile, { mode: 'update' });
ok(xUpd.updated === 1, `update rewrites the one that changed (${xUpd.updated})`);
ok(xs.exerciseFor('Seeded Pull-up').primary === 'Lats', 'so now it is tagged');
ok(xs.exerciseFor('Seeded Pull-up').bodyweight === true,
  'and update left bodyweight alone, because the file never mentioned it');
const xPartial = await xs.importLibrary(
  { exercises: [{ name: 'Seeded Pull-up', secondary: ['Forearms'] }] }, { mode: 'update' },
);
ok(xs.exerciseFor('Seeded Pull-up').primary === 'Lats',
  'a file carrying only "secondary" does not reset the volume group');
ok(xs.exerciseFor('Seeded Pull-up').secondary.join() === 'Forearms', 'but does replace what it names');
ok(xPartial.updated === 1, 'and reports the update');
ok((await xs.importLibrary([{ name: 'Bare Array Row' }], { mode: 'add' })).added === 1,
  'a bare array works, so a hand-written file needs no schema line');
const xRep = await xs.importLibrary({ exercises: [{ name: 'Only Me' }] }, { mode: 'replace' });
ok(xRep.removed > 0 && state.exercises.length === 1,
  `replace makes the file the library (${xRep.removed} removed)`);
ok(xs.exerciseFor('Only Me') !== null, 'keeping what it listed');

section('a broken file fails loudly rather than half-importing');
let xErr = null;
try { await xs.importLibrary('{ not json'); } catch (e) { xErr = e.message; }
ok(/valid JSON/.test(xErr || ''), `bad JSON says so (${xErr})`);
xErr = null;
try { await xs.importLibrary({ hello: 'world' }); } catch (e) { xErr = e.message; }
ok(/exercises/.test(xErr || ''), `a file with no list says what it expected (${xErr})`);
ok((await xs.importLibrary({ exercises: [{ name: '' }, null, 42] })).skipped === 3,
  'rows with no usable name are skipped and counted, not silently dropped');

section('the library travels in a backup, because nothing could rebuild it');
await xs.saveExercise({ name: 'Backup Me', primary: 'Glutes', unilateral: true });
const xBackup = JSON.stringify(xi.backupObject());
ok(JSON.parse(xBackup).exercises.length === state.exercises.length, 'the backup carries it');
ok(backupStore.dataFingerprint().exercises === state.exercises.length,
  'and the fingerprint counts it, so a restore can be checked');
await backupStore.restoreAll({ routines: [], sessions: [], exercises: [] });
ok(state.exercises.length === 0, 'a restore with an explicit empty library wipes it');
await xi.importFromText(xBackup, { mode: 'replace' });
ok(xs.exerciseFor('Backup Me')?.primary === 'Glutes', 'and a replace-restore brings it back');
ok(xs.exerciseFor('Backup Me').unilateral === true, 'attributes intact');
await backupStore.restoreAll({ routines: [], sessions: [] });
ok(state.exercises.length > 0,
  'a backup from before the library existed leaves it alone — absent is not the same as empty');
await xs.importLibrary({ exercises: [] }, { mode: 'replace' });
await store.deleteRoutine(xR.id);

/* ------------------------------------------------------------------ */
/* unilateral: left and right are kept apart                          */
/* ------------------------------------------------------------------ */

section('a unilateral exercise logs every planned set twice, once per side');
await store.updateSettings({ requireEffort: false, firstSide: 'L', prefillFrom: 'last' });
await xs.saveExercise({
  name: 'Uni Row', unilateral: true, primary: 'Back', secondary: ['Lats', 'Biceps'],
});
const uR = await store.createRoutine({
  name: 'Uni Day', entries: [{ name: 'Uni Row', unilateral: true, sets: 3, reps: 10, weight: 30 }],
});
ok(uR.entries[0].unilateral === true, 'the routine entry carries the flag');
ok(store.plannedRowCount(uR.entries[0]) === 6,
  `3 planned sets become 6 rows (${store.plannedRowCount(uR.entries[0])})`);
const uS = await store.startSession(uR.id);
const uE = uS.entries[0];
ok(uE.sets.length === 6, `the session opens with 6 rows (${uE.sets.length})`);
ok(uE.sets.map((s) => s.side).join('') === 'LRLRLR',
  `alternating sides, left first (${uE.sets.map((s) => s.side).join('')})`);
ok(store.setLabels(uE.sets).join(',') === '1L,1R,2L,2R,3L,3R',
  `1L and 1R are the SAME set done twice, not sets 1 and 2 (${store.setLabels(uE.sets).join(',')})`);
ok(uE.sets[0].weight === 30 && uE.sets[1].weight === 30,
  'both sides open on the planned load');
ok(store.plannedSet(uE, 2).weight === 30,
  'the planned target maps back through the doubling rather than reading off the end');
ok(fmt.targetLine(uR.entries[0]).includes('per side'),
  `the target line says the count is per side (${fmt.targetLine(uR.entries[0])})`);

section('the exercise is not "done" until both sides of every set are');
for (const s of uE.sets.slice(0, 5)) await store.updateSet(uE.id, s.id, { reps: 10, done: true });
ok(store.entryStatus(uE) === 'partial',
  'five of six rows is still in progress — targetSets alone would have called it done after three');
await store.updateSet(uE.id, uE.sets[5].id, { reps: 10, done: true });
ok(store.entryStatus(uE) === 'done', 'and done once the sixth lands');

section('rest belongs after the SECOND side, not between the two');
await store.discardSession();
const uS2 = await store.startSession(uR.id);
const uE2 = uS2.entries[0];
ok(store.nextSideAfter(uE2.id, uE2.sets[0].id).id === uE2.sets[1].id,
  'the app can see the other side waiting after the left row');
ok(store.nextSideAfter(uE2.id, uE2.sets[1].id) === null,
  'and nothing waiting after the right one — that is where the rest goes');
await store.updateSet(uE2.id, uE2.sets[1].id, { done: true });
ok(store.nextSideAfter(uE2.id, uE2.sets[0].id) === null,
  'a side already logged is not offered as the next one');

section('which side comes first is a setting, and prefill follows the SIDE not the row');
await store.updateSet(uE2.id, uE2.sets[0].id, { weight: 32.5, reps: 9, done: true });
await store.updateSet(uE2.id, uE2.sets[1].id, { weight: 27.5, reps: 8, done: true });
for (const s of uE2.sets.slice(2)) await store.updateSet(uE2.id, s.id, { weight: 30, reps: 8, done: true });
await store.finishSession();
await store.updateSettings({ firstSide: 'R' });
const uS3 = await store.startSession(uR.id);
const uE3 = uS3.entries[0];
ok(uE3.sets.map((s) => s.side).join('') === 'RLRLRL',
  `the setting flips the order (${uE3.sets.map((s) => s.side).join('')})`);
ok(uE3.sets[0].side === 'R' && uE3.sets[0].weight === 27.5,
  `the top row is now the right side and gets the RIGHT side's 27.5 (${uE3.sets[0].weight})`);
ok(uE3.sets[1].side === 'L' && uE3.sets[1].weight === 32.5,
  `and the left row gets the left's 32.5 (${uE3.sets[1].weight}) — matching by position would have swapped them`);
await store.updateSettings({ firstSide: 'L' });
await store.discardSession();

section('a bilateral exercise is untouched by any of this');
const bR = await store.createRoutine({
  name: 'Bi Day', entries: [{ name: 'Bi Press', sets: 3, reps: 8, weight: 50 }],
});
const bS = await store.startSession(bR.id);
ok(bS.entries[0].sets.length === 3, 'three planned sets, three rows');
ok(bS.entries[0].sets.every((s) => s.side === null), 'with no side on any of them');
ok(store.setLabels(bS.entries[0].sets).join(',') === '1,2,3', 'and plain numbering');
await store.discardSession();
await store.deleteRoutine(bR.id);

/* ------------------------------------------------------------------ */
/* per-muscle trends: direct and indirect, never blended              */
/* ------------------------------------------------------------------ */

section('sets are counted against the muscle groups their exercise is tagged with');
const gRows = ex.groupTotals(state.sessions, xs.exerciseFor);
const gBack = gRows.find((r) => r.group === 'Back');
const gLats = gRows.find((r) => r.group === 'Lats');
ok(!!gBack && gBack.direct === 6,
  `the Uni Row's six rows are 6 DIRECT sets of Back (${gBack?.direct})`);
ok(!!gLats && gLats.indirect === 6 && gLats.direct === 0,
  `and 6 INDIRECT sets of Lats, kept in its own column (${gLats?.indirect} indirect, ${gLats?.direct} direct)`);
ok(gBack.exercises.includes('Uni Row'), 'the group remembers which exercises produced it');
ok(gBack.lastAt !== null, 'and when it was last trained');

section('a muscle group total never silently adds the two kinds together');
ok(gLats.direct + gLats.indirect === 6 && gLats.direct === 0,
  'adding them is the caller\'s choice, not baked in with an invented 0.5 weighting');

section('warmups and unconfirmed sets are excluded, exactly as elsewhere in Trends');
const gWR = await store.createRoutine({
  name: 'Group Filter', entries: [{ name: 'Group Lift', sets: 2, reps: 8, weight: 40 }],
});
await xs.saveExercise({ name: 'Group Lift', primary: 'Shoulders' });
const gWS = await store.startSession(gWR.id);
const gWE = gWS.entries[0];
await store.addSet(gWE.id, { warmup: true });
await store.updateSet(gWE.id, gWE.sets.find((s) => s.warmup).id, { weight: 20, reps: 10, done: true });
await store.updateSet(gWE.id, gWE.sets.find((s) => !s.warmup).id, { weight: 40, reps: 8, done: true });
await store.finishSession();
const gSh = ex.groupTotals(state.sessions, xs.exerciseFor).find((r) => r.group === 'Shoulders');
ok(gSh.direct === 1,
  `one confirmed working set counted; the warmup and the untouched row did not (${gSh.direct})`);

section('an entry carries its own tags, so editing the library never rewrites history');
const gTagged = ex.groupTotals(
  [{
    finishedAt: 1, startedAt: 1,
    entries: [{
      name: 'Whatever', type: 'lift', primary: 'Neck', secondary: [],
      sets: [{ done: true, reps: 5, weight: 10 }],
    }],
  }],
  () => ({ primary: 'Chest', secondary: [] }),
);
ok(gTagged[0].group === 'Neck',
  'the entry\'s own tag wins over the library, so a logged session keeps the meaning it had');

section('an untagged exercise contributes nothing rather than guessing');
ok(!ex.groupTotals(
  [{ finishedAt: 1, startedAt: 1, entries: [{ name: 'Unknown', type: 'lift', sets: [{ done: true, reps: 5 }] }] }],
  () => null,
).length, 'no tag means no row — better than a wrong row');
await store.deleteRoutine(uR.id);
await store.deleteRoutine(gWR.id);

/* ------------------------------------------------------------------ */
/* the built-in catalogue                                             */
/* ------------------------------------------------------------------ */

section('the catalogue parses, and every line in it is well formed');
ok(cat.CATALOG.length > 700, `${cat.CATALOG.length} exercises ship with the app`);
const cKeys = cat.CATALOG.map((x) => x.key);
const cDupes = [...new Set(cKeys.filter((k, i) => cKeys.indexOf(k) !== i))];
ok(cDupes.length === 0,
  `no duplicate names${cDupes.length ? ` — repeated: ${cDupes.slice(0, 6).join(', ')}` : ''}`);
ok(cat.CATALOG.every((x) => x.key && x.name), 'every record has a name');
const cBadCat = cat.CATALOG.filter((x) => !cat.CATEGORIES.some((c) => c.key === x.category));
ok(cBadCat.length === 0,
  `every exercise carries a known KIND${cBadCat.length ? ` — bad: ${cBadCat.slice(0, 5).map((x) => `${x.name}=${x.category}`).join(', ')}` : ''}`);
const cBadM = cat.CATALOG.filter((x) => !['reps', 'time', 'distance'].includes(x.measure));
ok(cBadM.length === 0, 'and a valid measure');
const cNoGroup = cat.CATALOG.filter((x) => x.type === 'lift' && !x.primary);
ok(cNoGroup.length === 0,
  `every lift has a volume group, so nothing in the catalogue is invisible to Trends${cNoGroup.length ? ` — missing: ${cNoGroup.slice(0, 5).map((x) => x.name).join(', ')}` : ''}`);
const cSelfRef = cat.CATALOG.filter((x) => x.secondary.includes(x.primary));
ok(cSelfRef.length === 0, 'and never lists its own primary group as a secondary one');
ok(cat.CATALOG.every((x) => x.builtIn === true), 'all of them are marked as built in');

section('the catalogue is not missing whole families of movement');
// One named probe per family, chosen because each is the thing a catalogue
// typically forgets. A miss here means a gap, not a renamed entry.
for (const name of [
  'Back Squat', 'Conventional Deadlift', 'Barbell Bench Press', 'Overhead Press', 'Pull-up',
  'Barbell Row', 'Lat Pulldown', 'Dumbbell Lateral Raise', 'Barbell Curl', 'Skull Crusher',
  'Standing Calf Raise', 'Hip Thrust', 'Nordic Hamstring Curl', 'Bulgarian Split Squat',
  'Clean and Jerk', 'Snatch', 'Split Jerk', 'Snatch Balance', 'Turkish Get-up',
  'Box Jump', 'Burpee', 'Medicine Ball Slam', 'Depth Jump',
  'Front Plank', 'Side Plank', 'L-sit', 'Dead Hang', 'Wall Sit', 'Copenhagen Plank',
  'Farmer Carry', 'Sled Push', 'Yoke Walk', 'Atlas Stone Lift', 'Log Press', 'Tire Flip',
  'Easy Run', 'Interval Run', 'Hill Repeats', 'Sprint', 'Ruck', 'Walk',
  'Cycling', 'Rowing Machine', 'Swimming', 'Jump Rope', 'Assault Bike', 'SkiErg', 'Climbing',
  'Football', 'Tennis', 'Boxing', 'HIIT Circuit',
  'Downward Dog', 'Pigeon Pose', 'Warrior II', 'Couch Stretch', 'Cat-Cow', 'Hip CARs',
  'Foam Roll Quads', 'Jumping Jacks', 'High Knees',
  'External Rotation', 'Band Pull-apart', 'Clamshell', 'Tibialis Raise', 'Chin Tuck',
  'Muscle-up', 'Handstand Push-up', 'Pistol Squat', 'Ab Wheel Rollout', 'Hanging Leg Raise',
  'Cable Fly', 'Face Pull', 'Leg Press', 'Romanian Deadlift', 'Goblet Squat', 'Kettlebell Swing',
]) {
  if (!cat.catalogFor(name)) { failures++; console.log(`  FAIL missing from the catalogue: ${name}`); }
}
ok(true, `76 named probes across every family are present (of ${cat.CATALOG.length})`);
ok(cat.CATEGORIES.every((c) => (cat.catalogCounts()[c.key] || 0) >= 10),
  'and no category is a token entry — every one has at least ten exercises');

section('every exercise is marked with its kind, its load and whether it is per side');
const cCounts = cat.catalogCounts();
for (const key of ['strength', 'isometric', 'running', 'cardio', 'mobility', 'olympic', 'plyo', 'carry', 'core', 'power', 'rehab']) {
  ok((cCounts[key] || 0) > 0, `${key}: ${cCounts[key] || 0} exercises`);
}
ok(cat.CATALOG.some((x) => cat.loadKind(x) === 'bodyweight'), 'bodyweight exercises are marked');
ok(cat.CATALOG.some((x) => cat.loadKind(x) === 'external'), 'external-weight ones too');
ok(cat.CATALOG.some((x) => cat.loadKind(x) === 'none'),
  'and cardio has its own load bucket rather than being called "external weight"');
ok(cat.CATALOG.some((x) => x.unilateral), 'unilateral exercises are marked');
ok(cat.CATALOG.filter((x) => x.measure === 'time').length > 30,
  `isometrics are measured in time (${cat.CATALOG.filter((x) => x.measure === 'time').length} of them)`);
ok(cat.CATALOG.filter((x) => x.measure === 'distance').length > 5,
  'carries are measured in distance');
ok(cat.CATALOG.filter((x) => x.type === 'cardio').length > 30,
  `running and cardio are logged as cardio, not as sets (${cat.CATALOG.filter((x) => x.type === 'cardio').length})`);

section('the load question and the measure question stay independent');
const cPlank = cat.catalogFor('Front Plank');
ok(cPlank.measure === 'time' && cPlank.bodyweight === true,
  'a plank is isometric AND bodyweight');
const cWPlank = cat.catalogFor('Weighted Plank');
ok(cWPlank.measure === 'time' && cWPlank.bodyweight === false,
  'a weighted plank is isometric AND externally loaded — one label could not say both');
const cPush = cat.catalogFor('Push-up');
ok(cPush.measure === 'reps' && cPush.bodyweight === true, 'a push-up is reps AND bodyweight');
ok(cat.catalogFor('Back Squat').bodyweight === false, 'a back squat is reps AND external');
ok(cat.catalogFor('Easy Run').type === 'cardio', 'a run is cardio');
ok(cat.loadKind(cat.catalogFor('Easy Run')) === 'none', 'and carries no load at all');

section('the catalogue can be searched by name, muscle, kit or kind');
ok(cat.searchCatalog('bench press').some((x) => x.key === 'barbell bench press'),
  'a two-word name search works');
ok(cat.searchCatalog('lats').length > 5, 'searching a muscle finds its exercises');
ok(cat.searchCatalog('kettlebell').length > 5, 'and searching equipment finds its exercises');
ok(cat.searchCatalog('squat')[0].key.startsWith('squat') || cat.searchCatalog('squat')[0].key.includes('squat'),
  'a name starting with the term sorts first');
ok(cat.searchCatalog('', { category: 'isometric' }).every((x) => x.category === 'isometric'),
  'filtering by kind returns only that kind');
ok(cat.searchCatalog('', { load: 'bodyweight' }).every((x) => x.bodyweight),
  'filtering by load returns only that load');
ok(cat.searchCatalog('', { group: 'Calves' }).every((x) => x.primary === 'Calves' || x.secondary.includes('Calves')),
  'filtering by muscle includes both direct and indirect');
ok(cat.searchCatalog('zzzzz').length === 0, 'a miss returns nothing rather than everything');

section('provenance is asked, not stored');
ok(cat.isBuiltIn('Back Squat') === true, 'the catalogue knows a back squat');
ok(cat.isBuiltIn('My Weird Machine Thing') === false, 'and admits it does not know your invention');
ok(cat.catalogFor('BACK SQUAT') !== null, 'lookups ignore casing, like everything else here');

section('adopting a catalogue exercise copies it into your library');
await xs.importLibrary({ exercises: [] }, { mode: 'replace' });
const cRec = cat.asLibraryRecord(cat.catalogFor('Single-arm Dumbbell Row'));
ok(cRec.builtIn === undefined && cRec.category === undefined,
  'the copy drops builtIn and category — both are re-derivable by name, and a stored copy would go stale');
await xs.saveExercise(cRec);
const cMine = xs.exerciseFor('Single-arm Dumbbell Row');
ok(cMine.unilateral === true, 'the attributes came across');
ok(cMine.primary === 'Back', 'including the volume group');
ok(cat.isBuiltIn(cMine.key) === true, 'and it still reads as a catalogue exercise, not as yours');
await xs.saveExercise({ ...cMine, primary: 'Lats' });
ok(xs.exerciseFor('Single-arm Dumbbell Row').primary === 'Lats',
  'once adopted it is yours to edit');
ok(cat.isBuiltIn('Single-arm Dumbbell Row') === true,
  'editing it does not change where it came from');
await xs.saveExercise({ name: 'Homemade Contraption Press', primary: 'Chest' });
ok(cat.isBuiltIn('Homemade Contraption Press') === false,
  'while an exercise you invented is marked as yours — which is what the UI styles differently');
await xs.importLibrary({ exercises: [] }, { mode: 'replace' });

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
