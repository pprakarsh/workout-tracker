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
const { state } = store;

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
ok(r.entries.length === 4, `4 entries: ${r.entries.map((e) => e.name).join(', ')}`);
ok(r.entries[0].repsMin === 5 && r.entries[0].repsMax === 5, 'reps "5" -> 5..5');
ok(r.entries[1].repsMin === 6 && r.entries[1].repsMax === 8, 'reps "6-8" -> 6..8');
ok(r.entries[0].rest === 180, `rest "3:00" -> 180s (got ${r.entries[0].rest})`);
ok(r.entries[1].group === 'A' && r.entries[2].group === 'A', 'superset group A on two entries');
ok(r.entries[3].type === 'cardio' && r.entries[3].targetDuration === 1080, 'cardio entry with 18:00 duration');

section('start a session (snapshot semantics)');
const s = await store.startSession(r.id);
ok(state.active && state.active.id === s.id, 'session is active');
ok(s.entries.length === 4, 'routine copied into session');
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

section('log sets');
const e0 = s.entries[0];
const set1 = await store.addSet(e0.id);
ok(e0.sets.length === 1, 'set added');
ok(set1.weight === 100 && set1.reps === 5, `prefilled from target: ${set1.weight}x${set1.reps}`);
await store.updateSet(e0.id, set1.id, { weight: 102.5, reps: 5, rpe: 8 });
const set2 = await store.addSet(e0.id);
ok(set2.weight === 102.5, 'second set prefills from the previous set');
ok(store.entryStatus(e0) === 'pending', 'status pending before anything is ticked');
await store.toggleSetDone(e0.id, set1.id);
ok(store.entryStatus(e0) === 'partial', 'status partial after one set');

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
const elapsed = await store.stopRest();
ok(elapsed === 65, `stop returns elapsed (${elapsed}s)`);
ok(state.timer === null, 'timer cleared');
ok(e0.sets[1].rest === 65, `actual rest recorded on the set (${e0.sets[1].rest}s)`);

section('modify the routine mid-session (today only)');
const added = await store.addSessionEntry({ name: 'Face Pull', sets: 3, reps: '15', rest: '1:00' });
ok(s.entries.length === 5, 'exercise added to the session');
ok(r.entries.length === 4, 'source routine untouched');
await store.moveSessionEntry(added.id, -1);
ok(s.entries[3].id === added.id, 'reorder works');
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
ok(entry.pace(3.2, 1020, 'km') === '5:19/km', `pace computed: ${entry.pace(3.2, 1020, 'km')}`);
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
const hit = store.lastLogFor('Back Squat');
ok(hit !== null, 'previous Back Squat found');
ok(/102.5/.test(entry.logSummary(hit.entry)), `summary: ${entry.logSummary(hit.entry)}`);
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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
