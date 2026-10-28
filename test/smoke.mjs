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
ok(warm.repeat === null, 'an entry without repeat has none');

ok(interval.repeat === 6, `intervals expressed as repeat: 6 on ONE entry (${interval.repeat})`);
ok(interval.group === 'I', 'with its own group label');
ok(interval.targetDuration === 95 && interval.targetDistance === 0.4 && interval.rest === 150,
  'carrying per-rep distance, duration and rest');
ok(interval.notes.split('\n').length === 2, 'cardio notes accept a list of lines');
ok(cool.rest === null, 'an entry with no rest target has none — not a default');

ok(inc.setTargets?.length === 3, 'per-set plan on the lifting entry');
ok(inc.setTargets[2].repsMin === 5 && inc.setTargets[2].repsMax === 6, 'rep range inside the plan');
ok(inc.rest === 150 && inc.group === 'B', 'rest and group on the lift');
ok(inc.notes.split('\n').length === 2, 'notes list joined into lines');
ok(chin.setTargets.length === 3 && chin.setTargets[0].weight === null && chin.setTargets[0].repsMin === 8,
  'bodyweight shorthand "x8" imported with no weight');

section('intervals expand into one effort per repetition at session start');
const ivs = await store.startSession(run.id);
ok(ivs.entries.length === 10, `5 routine entries became 10 session entries (${ivs.entries.length})`);
const reps = ivs.entries.filter((e) => e.name === '400m Repeat');
ok(reps.length === 6, `6 separate efforts to log (${reps.length})`);
ok(reps.every((e) => e.group === 'I'), 'all sharing the group label');
ok(reps.map((e) => e.repIndex).join(',') === '1,2,3,4,5,6', 'numbered 1..6 for display');
ok(reps.every((e) => e.repTotal === 6), 'each knows the total');
ok(reps.every((e) => e.log && e.sets === null), 'each has its own cardio log');
ok(store.blockAt(ivs.entries, ivs.entries.indexOf(reps[0])).length === 6,
  'and they form a single block, so Next skips the whole set of intervals');
ok(reps.every((e) => e.rest === 150), 'each rep carries the rest target');
await store.updateLog(reps[0].id, { distance: 0.4, duration: 96, done: true });
await store.updateLog(reps[1].id, { distance: 0.4, duration: 98, done: true });
ok(store.entryStatus(reps[0]) === 'done' && store.entryStatus(reps[2]) === 'pending',
  'reps are completed independently');

section('saving back collapses the expanded intervals again');
await store.saveSessionBackToRoutine();
const runAfter = store.getRoutine(run.id);
ok(runAfter.entries.length === 5, `routine stays 5 entries, not 10 (${runAfter.entries.length})`);
const ivAfter = runAfter.entries.find((e) => e.name === '400m Repeat');
ok(ivAfter.repeat === 6, `repeat preserved as ${ivAfter.repeat}`);
await store.discardSession();

section('auto group labels when intervals have none');
const noGroup = await store.createRoutine({
  name: 'Bare Intervals',
  entries: [
    { type: 'cardio', name: 'Hill Sprint', repeat: 3, duration: '0:30', rest: '2:00' },
    { type: 'cardio', name: 'Flat Sprint', repeat: 2, duration: '0:20', rest: '1:30' },
  ],
});
const bg = await store.startSession(noGroup.id);
ok(bg.entries.length === 5, `3 + 2 efforts (${bg.entries.length})`);
const g1 = [...new Set(bg.entries.filter((e) => e.name === 'Hill Sprint').map((e) => e.group))];
const g2 = [...new Set(bg.entries.filter((e) => e.name === 'Flat Sprint').map((e) => e.group))];
ok(g1.length === 1 && g2.length === 1, 'each interval set got one label');
ok(g1[0] !== g2[0], `and the two sets got different labels (${g1[0]} vs ${g2[0]})`);
ok(store.blockAt(bg.entries, 0).length === 3 && store.blockAt(bg.entries, 3).length === 2,
  'so they form two separate blocks of 3 and 2');
await store.discardSession();
await store.deleteRoutine(noGroup.id);

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
  ['that one cardio entry is one effort', 'one cardio entry logs ONE effort'],
  ['that intervals use repeat', 'express intervals with "repeat"'],
  ['that warmups and RIR are logged, not targeted', 'NOT IN THE SCHEMA'],
  ['the repeat field', '"repeat"'],
  ['that pace and HR are not targetable', 'NO target fields for pace'],
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
const promptText = routinesView.AI_PROMPT;
const between = (startMark, endMark) => {
  const a = promptText.indexOf(startMark);
  const b = endMark ? promptText.indexOf(endMark) : promptText.length;
  return promptText.slice(a + startMark.length, b === -1 ? promptText.length : b);
};
const ex1Raw = between('running + upper body ================', '================ WORKED EXAMPLE 2');
const ex2Raw = between('superset + per-set plan ================', '================ CHECKLIST');
let ex1 = null; let ex2 = null;
try { ex1 = JSON.parse(ex1Raw.trim()); } catch (e) { /* reported below */ }
try { ex2 = JSON.parse(ex2Raw.trim()); } catch (e) { /* reported below */ }
ok(ex1 !== null, 'example 1 inside the prompt is parseable JSON on its own');
ok(ex2 !== null, 'example 2 inside the prompt is parseable JSON on its own');
ok(ex1?.name === 'Run with Upper Body' && ex1?.entries?.length === 5,
  `example 1 is the full running routine (${ex1?.entries?.length} entries)`);
ok(ex2?.name === 'Squat day with Push Movements' && ex2?.entries?.length === 5,
  `example 2 is the full lifting routine (${ex2?.entries?.length} entries)`);
ok(ex1.entries.some((e) => e.type === 'cardio' && e.rest) && ex1.entries.some((e) => e.repeat === 6),
  'example 1 still carries cardio rest and the interval repeat after being embedded');
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
ok(header.slice(25).join(',') === 'rir,warmup,set_label,interval_rep,interval_of',
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
