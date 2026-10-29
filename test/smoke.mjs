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
await store.setRestTarget(120);
ok(state.timer.target === 120, 'target editable mid-rest');
const stopped = await store.stopRest();
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
await store.updateLog(cardio.id, { distance: 3.2, duration: 1020, avgHr: 152, maxHr: 171, elevation: 24, rpe: 7, note: 'easy', done: true });
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
const before = store.dataFingerprint();
ok(before.routines === 1 && before.sessions === 1 && before.loggedSets === 3,
  `fingerprint before: ${JSON.stringify(before)}`);
// simulate a second device: wipe everything
await store.restoreAll({ routines: [], sessions: [], settings: null });
ok(store.dataFingerprint().sessions === 0, 'device wiped');
const resR = await xi.importFromText(backup, { mode: 'replace' });
const after = store.dataFingerprint();
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
await store.startRest({ target: 90, entryId: live.entries[0].id, setId: live.entries[0].sets[0].id, label: 'Rest' });
const backup2 = JSON.stringify(xi.backupObject());
await store.restoreAll({ routines: [], sessions: [], settings: null });
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
ok(store.dataFingerprint().sessions === before.sessions, 'session count unchanged by a merge of the same backup');

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
const nLegs = await store.logAllRounds(iv.id);
ok(nLegs === 12, `one action logged all 12 legs (${nLegs})`);
ok(iv.log.legs.every((lg) => lg.done), 'every leg ticked');
ok(store.entryStatus(iv) === 'done', 'and the entry counts as done');
ok(fmt.logSummary(iv) === '6 rounds \u00b7 18:30 \u00b7 3.375 km',
  `summarised as rounds, time and distance (${fmt.logSummary(iv)})`);
ok(await store.logAllRounds(iv.id) === 0 && iv.log.legs.every((lg) => !lg.done),
  'tapping again clears the block');

section('one round can be corrected without touching the other five');
await store.logAllRounds(iv.id);
const slow = iv.log.legs.find((lg) => lg.round === 4 && lg.leg === 0);
await store.updateLeg(iv.id, slow.id, { duration: 108 });
ok(slow.duration === 108 && slow.edited === true, 'round 4 holds its own slower time');
ok(iv.log.legs.filter((lg) => lg.leg === 0 && lg.duration === 95).length === 5,
  'the other five working legs are untouched');
ok(fmt.logSummary(iv).includes('1 leg adjusted'), 'the summary says one leg was adjusted');

section('fixing the pattern leaves a hand-edited round alone');
await store.setIntervalPlan(iv.id, cardioLib.parseIntervals('1:40 @ 4:00/km + 1:30 walk @ 9:00/km x 6'));
ok(iv.log.legs.filter((lg) => lg.leg === 0 && lg.duration === 100).length === 5,
  'five working legs follow the new plan');
const stillSlow = iv.log.legs.find((lg) => lg.round === 4 && lg.leg === 0);
ok(stillSlow.duration === 108, `the edited round kept 1:48 (${stillSlow.duration}s)`);
ok(iv.log.legs.every((lg) => lg.done), 'and nothing was un-ticked by the change');
await store.resetLeg(iv.id, stillSlow.id);
ok(stillSlow.duration === 100 && stillSlow.edited === false, 'it can be put back on plan');

section('growing the round count keeps what is already logged');
await store.setIntervalPlan(iv.id, cardioLib.parseIntervals('1:40 @ 4:00/km + 1:30 walk @ 9:00/km x 8'));
ok(iv.log.legs.length === 16, `8 rounds now (${iv.log.legs.length} legs)`);
ok(iv.log.legs.filter((lg) => lg.done).length === 12, '12 legs stay logged, the new 4 do not');

section('a straight run derives the third number from the other two');
const jog = ivs.entries.find((e) => e.name === 'Warmup Jog');
await store.updateLog(jog.id, { duration: 1800 });
await store.updateLog(jog.id, { pace: 360 });
ok(jog.log.distance === 5, `30:00 at 6:00/km is 5 km (${jog.log.distance})`);
await store.updateLog(jog.id, { distance: 4 });
ok(jog.log.pace === 450, `shortening it to 4 km repaces to 7:30/km (${jog.log.pace})`);
await store.updateLog(jog.id, { duration: 2400 });
ok(jog.log.pace === 450 && jog.log.distance === 5.333,
  `editing the time holds the pace and moves the distance (${jog.log.distance})`);
ok(fmt.logSummary(jog) === '', 'still nothing logged until it is confirmed');
await store.updateLog(jog.id, { done: true, completedAt: Date.now() });
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
const fpBefore = store.dataFingerprint().loggedSets;
await store.updateLog(freshJog.id, { done: true, completedAt: Date.now() });
ok(store.dataFingerprint().loggedSets === fpBefore + 1,
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

section('a day means something only once a routine is on it');
const planRoutine = await store.createRoutine({ name: 'Push Day', entries: [{ name: 'Bench', sets: 3, reps: 5, weight: 60 }] });
await store.setPlanDay(k(0), { routineId: planRoutine.id });
await store.setPlanDay(k(1), { rest: true });
await store.setPlanDay(k(2), { routineId: planRoutine.id });
ok(state.plan[k(0)].routineId === planRoutine.id, 'the routine is on today');
ok(state.plan[k(1)].rest === true && state.plan[k(1)].routineId === null,
  'a rest day holds no routine');
await store.setPlanDay(k(1), { routineId: planRoutine.id });
ok(state.plan[k(1)].rest === false, 'and planning a routine clears the rest flag');
await store.setPlanDay(k(1), { rest: true });
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
await store.togglePlanDone(k(2));
ok(Number.isFinite(state.plan[k(2)].doneAt), 'a timestamp is recorded');
const win5 = planLib.planWindow(state.plan, [], T0);
ok(win5[2].status.state === 'done' && win5[2].status.manual === true,
  'the row says it was ticked by hand');
await store.togglePlanDone(k(2));
ok(state.plan[k(2)].doneAt === null, 'and it can be un-ticked');

section('moving a day, and swapping when the target is taken');
await store.setPlanDay(k(5), { routineId: planRoutine.id });
ok(await store.movePlanDay(k(5), k(6)) === true, 'an empty target just takes it');
ok(!state.plan[k(5)] && state.plan[k(6)].routineId === planRoutine.id, 'and the old day is cleared');
await store.setPlanDay(k(5), { rest: true });
await store.movePlanDay(k(5), k(6));
ok(state.plan[k(6)].rest === true && state.plan[k(5)].routineId === planRoutine.id,
  'a taken target swaps rather than overwrites');
ok(await store.movePlanDay(k(7), k(8)) === false, 'moving an empty day is a no-op');

section('the plan is pruned, persisted and travels in the backup');
await store.setPlanDay(k(4), { note: '   ' });
ok(!state.plan[k(4)], 'a day with nothing on it is not kept');
const planBackup = xi.backupObject();
ok(typeof planBackup.plan === 'object' && planBackup.plan[k(0)].routineId === planRoutine.id,
  'the plan is in the backup');
const planned0 = JSON.stringify(state.plan);
await store.restoreAll({ routines: state.routines, sessions: state.sessions, plan: planBackup.plan });
ok(JSON.stringify(state.plan) === planned0, 'and comes back verbatim from a restore');
await store.restoreAll({ routines: state.routines, sessions: state.sessions });
ok(JSON.stringify(state.plan) === planned0,
  'an older backup with no plan leaves the current one alone');
ok(JSON.stringify(planLib.normalizePlan({ nonsense: 1, '2026-13-99': {}, [k(0)]: { routineId: 'x' } }))
  === JSON.stringify({ [k(0)]: { routineId: 'x', rest: false, doneAt: null, note: '' } }),
  'junk keys are dropped on the way in');

await store.deleteRoutine(planRoutine.id);
for (const key of Object.keys(state.plan)) await store.clearPlanDay(key);

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

const started = await store.startRestForSet(fe.id, fe.sets[0].id);
ok(started.started === true, 'the clock still starts — time is not recoverable, a number is');
ok(state.timer.setId === fe.sets[0].id, 'and it is attached to that specific set');
ok(state.timer.target === 90, 'using the exercise rest target');
ok(fe.sets[0].done === false, 'the set is NOT marked done just because rest started');

section('the numbers can be entered during the rest, and the set then ticks on stop');
await store.updateSet(fe.id, fe.sets[0].id, { weight: 40 });
ok(store.setIsLoggable(fe.sets[0]) === true, 'typing the weight mid-rest makes it loggable');
state.timer.startedAt -= 95_000;
const stopA = await store.stopRest();
ok(stopA.elapsed === 95, `rest recorded (${stopA.elapsed}s)`);
ok(stopA.pending === null, 'nothing pending');
ok(fe.sets[0].done === true, 'and stopping ticks the set now that it has numbers');
ok(fe.sets[0].rest === 95, 'with the measured rest attached');

section('stopping with still no numbers keeps the rest but says the set is unlogged');
await store.startRestForSet(fe.id, fe.sets[1].id);
state.timer.startedAt -= 60_000;
const stopB = await store.stopRest();
ok(stopB.elapsed === 60, 'rest measured');
ok(stopB.pending && stopB.pending.setId === fe.sets[1].id,
  'the caller is told which set is still unlogged');
ok(fe.sets[1].done === false, 'it is not ticked with no load');
ok(fe.sets[1].rest === 60, 'but the rest is kept, not thrown away');
ok(fmt.restLine(fe).includes('2) 1:00'),
  `and it shows in the rest line despite being unticked (${fmt.restLine(fe)})`);

section('starting rest for another set banks the running one first');
await store.startRestForSet(fe.id, fe.sets[1].id);
state.timer.startedAt -= 30_000;
const sw = await store.startRestForSet(fe.id, fe.sets[2].id);
ok(sw.started === true, 'the new rest started');
ok(fe.sets[1].rest === 30, `the previous set kept what it measured (${fe.sets[1].rest}s), not discarded`);
ok(state.timer.setId === fe.sets[2].id, 'and the clock moved to the new set');
ok((await store.startRestForSet(fe.id, fe.sets[2].id)).already === true,
  'tapping the same set again is a no-op, not a restart');
await store.stopRest();
await store.discardSession();
await store.deleteRoutine(freeR.id);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
