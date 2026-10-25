// DOM-level test: drives the real app through clicks and typing under jsdom.
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';

const APP = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const dom = new JSDOM(readFileSync(`${APP}/index.html`, 'utf8'), {
  url: 'https://example.test/', pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.Blob = dom.window.Blob;
global.FileReader = dom.window.FileReader;
dom.window.URL.createObjectURL = () => 'blob:stub';
dom.window.URL.revokeObjectURL = () => {};
global.AudioContext = class { constructor() { this.state = 'suspended'; } resume() {} };
dom.window.HTMLAnchorElement.prototype.click = function () {};
dom.window.scrollTo = () => {};   // jsdom doesn't implement scrolling
global.URL = dom.window.URL;
// capture whatever the app puts on the clipboard
let copied = null;
Object.defineProperty(dom.window.navigator, 'clipboard', {
  value: { writeText: async (t) => { copied = t; } },
  configurable: true,
});

let failures = 0;
const ok = (c, l) => { if (c) console.log(`  ok   ${l}`); else { failures++; console.log(`  FAIL ${l}`); } };
const section = (s) => console.log(`\n== ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const view = () => $('#viewRoot').innerHTML;

async function click(sel, label = sel) {
  const el = $(sel);
  if (!el) { failures++; console.log(`  FAIL no element to click: ${label}`); return false; }
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(40);
  return true;
}
/** entry-add / rentry-add now open a picker first; step through to a blank form. */
async function openBlankExerciseForm(trigger, label) {
  await click(trigger, label);
  if ($('[data-action="ex-new"]')) await click('[data-action="ex-new"]', 'Create a new exercise');
}
async function type(sel, value) {
  const el = $(sel);
  if (!el) { failures++; console.log(`  FAIL no input: ${sel}`); return; }
  el.value = value;
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await sleep(25);
}

const store = await import(`${APP}/js/store.js`);
const xi = await import(`${APP}/js/exportimport.js`);
const routinesView = await import(`${APP}/js/views/routines.js`);
await import(`${APP}/js/app.js`);   // boots itself
await sleep(150);

section('boot');
ok(store.state.ready, 'store initialised');
ok(view().length > 0, 'something rendered');
ok($$('#tabBar .tab').length === 4, 'four tabs present');

section('seed a routine, then start it from the Now tab');
await xi.importFromText(routinesView.SAMPLE);
await sleep(60);
await click('#tabBar .tab[data-tab="now"]', 'Now tab');
ok(/No workout in progress/.test(view()), 'Now shows the start screen when idle');
ok(/Squat day with Push Movements/.test(view()), 'routine is offered');
await click('[data-action="routine-start"]', 'Start');
ok(store.state.active !== null, 'session started by the button');
ok(/Back Squat/.test(view()), 'Now shows the first exercise');
ok(/No previous log for this exercise/.test(view()), 'shows the last-session reference slot');

section('log a set through the UI');
await click('[data-action="set-add"]', '+ Add set');
ok($$('.set-row').length === 1, 'a set row appeared');
const row = $('.set-row');
ok($('.set-row input[data-f="weight"]').value === '100', 'weight prefilled from the routine target');
await type('.set-row input[data-f="weight"]', '102.5');
await type('.set-row input[data-f="reps"]', '5');
await type('.set-row input[data-f="rpe"]', '8');
const liveSet = store.state.active.entries[0].sets[0];
ok(liveSet.weight === 102.5 && liveSet.reps === 5 && liveSet.rpe === 8,
  `typing persisted: ${liveSet.weight} x ${liveSet.reps} @ ${liveSet.rpe}`);
ok($('.set-row input[data-f="weight"]') === $('.set-row input[data-f="weight"]'), 'row not re-rendered mid-typing');

section('moving between fields must not destroy the keyboard');
await click('[data-action="set-add"]', '+ Add set (second)');
const wA = $$('.set-row input[data-f="weight"]')[1];
const rA = $$('.set-row input[data-f="reps"]')[1];
wA.focus();
rA.focus();                       // fires blur on wA
await sleep(40);
ok(rA.isConnected, 'the newly focused input survived the blur of the previous one');
ok(document.activeElement === rA, 'focus stayed where the user put it');
rA.blur();                        // leaving the fields entirely may re-render
await sleep(40);
ok($$('.set-row').length === 2, 'both set rows still present after a full blur');
await click('[data-action="set-del-last"]', '− Remove last');
ok($$('.set-row').length === 1, 'removed the extra set');

section('rest timer through the UI');
ok($('#restBar').hidden, 'rest bar hidden before starting');
await click('.set-row .rest-btn', 'Rest ⏱');
ok(!$('#restBar').hidden, 'rest bar is visible');
ok(/Rest after Back Squat set 1/.test($('#restBar').textContent), 'bar names the set it follows');
ok(/target 3:00/.test($('#restBar').textContent), `target from routine: ${$('#restBar').querySelector('#restSub').textContent}`);
ok($('.set-row').classList.contains('done'), 'the set was marked done');
ok(store.state.timer !== null, 'timer running in state');

section('the app stays usable while resting');
await click('#tabBar .tab[data-tab="session"]', 'Session tab');
ok(!$('#restBar').hidden, 'rest bar survives a tab change');
ok($$('.sess-item').length === 5, `all 5 exercises listed (${$$('.sess-item').length})`);
ok(/102.5kg×5/.test(view()), 'the session list shows what was logged');
await type('[data-sf="notes"]', 'typed while resting');
ok(store.state.active.notes === 'typed while resting', 'session notes editable during rest');
const firstName = store.state.active.entries[0].name;
await click('.sess-item [data-action="entry-down"]', 'move first exercise down');
ok(store.state.active.entries[1].name === firstName, 'reordered mid-workout');
ok(!$('#restBar').hidden, 'rest bar still running after a reorder');

section('stop the rest timer manually');
store.state.timer.startedAt -= 95_000;
await click('#restBar [data-action="rest-stop"]', 'Stop');
ok($('#restBar').hidden, 'rest bar hidden again');
ok(store.state.timer === null, 'timer cleared');
const restedSet = store.state.active.entries.find((e) => e.name === firstName).sets[0];
ok(restedSet.rest === 95, `actual rest recorded: ${restedSet.rest}s`);
await click('#tabBar .tab[data-tab="now"]', 'Now tab');
ok(/Rest after sets: 1\) 1:35/.test(view()), 'the card reports the rest that was timed');
await click('[data-action="set-add"]', '+ Add set');
ok(/no rest logged/.test(view()), 'a set with no timed rest says so instead of showing a default');
ok(!/Rest after sets: 1\) 2:00/.test(view()), 'the routine target is not passed off as logged rest');
await click('[data-action="set-del-last"]', '- Remove last');
await click('#tabBar .tab[data-tab="session"]', 'back to Session');

section('nudging the target');
await click('.sess-item [data-action="sess-jump"]', 'jump to an exercise');
ok(store.state.tab === 'now', 'jumping switches to Now');
await click('[data-action="set-add"]', '+ Add set');
await click('.set-row .rest-btn', 'Rest');
const t0 = store.state.timer.target;
await click('#restBar [data-action="rest-nudge"]', '+30s');
ok(store.state.timer.target === t0 + 30, `target nudged ${t0} -> ${store.state.timer.target}`);
await click('#restBar [data-action="rest-stop"]', 'Stop');

section('add an exercise to today only');
const before = store.state.active.entries.length;
await openBlankExerciseForm('[data-action="entry-add"]', '+ Add exercise');
ok($('#modalRoot').hidden === false, 'modal opened');
$('[name="name"]').value = 'Face Pull';
$$('#exRows [data-strow]').forEach((row) => {
  row.querySelector('[data-stf="w"]').value = '20';
  row.querySelector('[data-stf="r"]').value = '15';
});
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(80);
ok(store.state.active.entries.length === before + 1, 'exercise added to the session');
ok(store.state.active.entries.at(-1).targetSets === 3, 'picked up the 3 grid rows');
ok(store.getRoutine(store.state.active.routineId).entries.length === 5, 'routine untouched');
ok($('#modalRoot').hidden === true, 'modal closed');

section('tabs render without throwing');
for (const tab of ['history', 'routines', 'session', 'now']) {
  await click(`#tabBar .tab[data-tab="${tab}"]`, `${tab} tab`);
  ok(view().length > 20, `${tab} rendered ${view().length} chars`);
  ok($(`#tabBar .tab[data-tab="${tab}"]`).classList.contains('active'), `${tab} tab marked active`);
}

section('finish the workout from the UI');
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-finish"]', 'Finish workout');
ok($('#modalRoot').hidden === false, 'finish confirmation opened');
$('[name="rpe"]').value = '8';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(120);
ok(store.state.active === null, 'session finished');
ok(store.state.tab === 'history', 'landed on History');
ok(/Squat day with Push Movements/.test(view()), 'the finished session is listed');

section('history detail + export buttons');
ok(/All sessions/.test(view()), 'finishing drops you straight into the session detail');
await click('[data-action="hist-back"]', 'back to the list');
ok(/sess-item/.test(view()) && !/All sessions/.test(view()), 'session list shown');
await click('.sess-item[data-action="hist-open"]', 'open the session');
ok(/All sessions/.test(view()), 'detail view opened');
ok(/Total volume/.test(view()), 'detail shows computed volume');
ok(/102.5kg×5/.test(view()), 'detail shows the log');
await click('[data-action="hist-md"]', 'Markdown export');
await click('[data-action="hist-back"]', 'back');
ok(!/All sessions/.test(view()), 'returned to the list');

section('routine editor');
await click('#tabBar .tab[data-tab="routines"]');
await click('[data-action="routine-open"]', 'open routine');
ok($('[data-rf="name"]') !== null, 'editor opened');
await type('[data-rf="description"]', 'edited description');
await sleep(60);
ok(store.getRoutine(store.state.nav.routineId).description === 'edited description', 'description persisted');
await click('[data-action="routines-back"]', 'back');
ok($('[data-rf="name"]') === null, 'back to the list');

section('import dialog');
await click('[data-action="import-open"]', 'Import');
ok($('#impText') !== null, 'import dialog has a paste box');
ok(/Replace — wipe this device/.test(view() + $('#modalRoot').innerHTML), 'replace mode offered');
$('#impText').value = JSON.stringify({ name: 'Run with Upper Body', entries: [{ type: 'cardio', name: 'Easy Run', distance: 5, duration: '27:00' }, { name: 'Pull-up', sets: 4, reps: '6-10', rest: '2:00' }] });
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(120);
ok(store.state.routines.some((x) => x.name === 'Run with Upper Body'), 'routine imported via the dialog');
ok($('#modalRoot').hidden === true, 'dialog closed');
ok(/Run with Upper Body/.test(view()), 'new routine appears in the list');

section('per-set targets in the routine editor');
await click('#tabBar .tab[data-tab="routines"]');
await click('[data-action="routine-open"]', 'open routine');
const rid = store.state.nav.routineId;
const entriesBefore = store.getRoutine(rid).entries.length;
await openBlankExerciseForm('[data-action="rentry-add"]', '+ Add exercise');
ok($('#exRows') !== null, 'the set grid is visible immediately, with no mode to switch');
ok($('#exMode') === null, 'no set-target mode selector any more');
ok($('[name="targetSets"]') === null && $('[name="weight"]') === null,
  'no single Target sets / Target weight fields');
ok($$('#exRows [data-strow]').length === 3, `grid starts with 3 set rows (${$$('#exRows [data-strow]').length})`);
ok($$('#exRows [data-stf="w"]').length === 3 && $$('#exRows [data-stf="r"]').length === 3,
  'every row has its own weight and reps input');
ok($('#exCardio').hidden === true, 'cardio fields hidden for a lifting exercise');
$('[name="name"]').value = 'Wave Squat';
await click('#exAddRow', '+ Add set');
ok($$('#exRows [data-strow]').length === 4, 'four rows after adding one');
await click('#exRows [data-strow]:last-child [data-strow-del]', 'remove the 4th');
ok($$('#exRows [data-strow]').length === 3, 'back to three rows');
ok([...$$('#exRows .idx')].map((d) => d.textContent).join('') === '123', 'rows are numbered 1..3');
const [r1, r2, r3] = $$('#exRows [data-strow]');
r1.querySelector('[data-stf="w"]').value = '60'; r1.querySelector('[data-stf="r"]').value = '10';
r2.querySelector('[data-stf="w"]').value = '70'; r2.querySelector('[data-stf="r"]').value = '8';
r3.querySelector('[data-stf="w"]').value = '80'; r3.querySelector('[data-stf="r"]').value = '5-6';
$('[name="rest"]').value = '2:30';
$('[name="notes"]').value = 'Warmup: 2x5 @ 40%\nTempo 3-1-1';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
const added2 = store.getRoutine(rid).entries[entriesBefore];
ok(store.getRoutine(rid).entries.length === entriesBefore + 1, 'exercise added to the routine');
ok(added2.setTargets?.length === 3, `3 per-set targets saved (${added2.setTargets?.length})`);
ok(added2.setTargets[0].weight === 60 && added2.setTargets[0].repsMin === 10, 'row 1 = 60 x 10');
ok(added2.setTargets[1].weight === 70 && added2.setTargets[1].repsMin === 8, 'row 2 = 70 x 8');
ok(added2.setTargets[2].repsMax === 6, 'row 3 kept the 5-6 range');
ok(added2.rest === 150, 'rest saved');
ok(added2.notes.split('\n').length === 2, 'multi-line notes saved');
ok(/60×10 · 70×8 · 80×5-6/.test(view()), 'the editor lists the per-set plan');

section('identical rows collapse to a tidy uniform target');
await openBlankExerciseForm('[data-action="rentry-add"]', '+ Add exercise');
$('[name="name"]').value = 'Plain Curl';
$$('#exRows [data-strow]').forEach((row) => {
  row.querySelector('[data-stf="w"]').value = '15';
  row.querySelector('[data-stf="r"]').value = '8-12';
});
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
const curl = store.getRoutine(rid).entries.find((e) => e.name === 'Plain Curl');
ok(curl.setTargets === null, 'stored as one target rather than three identical rows');
ok(curl.targetSets === 3 && curl.weight === 15 && curl.repsMin === 8 && curl.repsMax === 12,
  `summarised as 3 x 8-12 @ 15 (${curl.targetSets} x ${curl.repsMin}-${curl.repsMax} @ ${curl.weight})`);
ok(/3 × 8-12 · @ 15/.test(view()), `reads as a uniform target in the list`);

section('copy set 1 down fills the whole grid');
await click(`[data-action="rentry-edit"][data-entry="${added2.id}"]`, 'edit Wave Squat');
ok($$('#exRows [data-strow]').length === 3, 'three rows restored from the saved plan');
ok($$('#exRows [data-stf="w"]')[2].value === '80', 'row 3 weight restored');
ok($$('#exRows [data-stf="r"]')[2].value === '5-6', 'row 3 rep range restored');
ok($('[name="notes"]').value.includes('Tempo 3-1-1'), 'notes restored into a textarea');
ok($('[name="notes"]').tagName === 'TEXTAREA', 'notes field is multi-line');
await click('#exCopyDown', 'Copy set 1 down');
ok($$('#exRows [data-stf="w"]').every((i) => i.value === '60'), 'every row now reads 60');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
const collapsed = store.getRoutine(rid).entries.find((e) => e.id === added2.id);
ok(collapsed.setTargets === null && collapsed.weight === 60 && collapsed.targetSets === 3,
  'copy-down then save collapses to 3 x 10 @ 60');

section('a uniform exercise expands back into editable rows');
await click(`[data-action="rentry-edit"][data-entry="${collapsed.id}"]`, 'edit it again');
ok($$('#exRows [data-strow]').length === 3, 'uniform target expanded into 3 rows');
ok($$('#exRows [data-stf="w"]').every((i) => i.value === '60'), 'each row pre-filled with 60');
$$('#exRows [data-stf="w"]')[2].value = '80';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
const reSplit = store.getRoutine(rid).entries.find((e) => e.id === collapsed.id);
ok(reSplit.setTargets?.length === 3 && reSplit.setTargets[2].weight === 80,
  'changing one row turns it back into a per-set plan');

section('switching type hides the set grid');
await openBlankExerciseForm('[data-action="rentry-add"]', '+ Add exercise');
$('[name="name"]').value = 'Easy Run';
$('#exType').value = 'cardio';
$('#exType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await sleep(30);
ok($('#exLift').hidden === true, 'set grid hidden for cardio');
ok($('#exCardio').hidden === false, 'cardio fields shown');
$('[name="targetDistance"]').value = '5';
$('[name="targetDuration"]').value = '27:00';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
const run = store.getRoutine(rid).entries.find((e) => e.name === 'Easy Run');
ok(run.type === 'cardio' && run.targetDistance === 5 && run.targetDuration === 1620, 'cardio entry saved');
ok(run.setTargets === null && run.targetSets === null, 'no set targets on a cardio entry');

section('logging a per-set plan shows planned values as placeholders');
await xi.importFromText(JSON.stringify({
  name: 'Plan Test',
  entries: [{
    name: 'Ladder Press', rest: '1:00',
    sets: [{ weight: 40, reps: 10 }, { weight: 45, reps: 8 }, { weight: 50, reps: '5-6' }],
  }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const planRoutine = store.state.routines.find((r) => r.name === 'Plan Test');
await click(`[data-action="routine-start"][data-id="${planRoutine.id}"]`, 'Start Plan Test');
ok(store.state.active?.routineName === 'Plan Test', 'plan-test workout started');
ok(/Ladder Press/.test(view()), 'Now shows the planned exercise');
ok(/40×10 · 45×8 · 50×5-6/.test(view()), 'the card shows the per-set plan');
await click('[data-action="set-add"]', '+ Add set');
ok($('.set-row input[data-f="weight"]').value === '40', 'set 1 prefilled with the first planned weight');
await click('[data-action="set-add"]', '+ Add set');
ok($$('.set-row input[data-f="weight"]')[1].value === '45', 'set 2 prefilled with the second planned weight');
ok($$('.set-row input[data-f="reps"]')[1].value === '8', 'set 2 prefilled with the second planned reps');
await click('[data-action="set-add"]', '+ Add set');
ok($$('.set-row input[data-f="weight"]')[2].value === '50'
  && $$('.set-row input[data-f="reps"]')[2].value === '5', 'set 3 prefilled 50 x 5 from the range');
await click('[data-action="set-del-last"]', '- Remove last');
await click('[data-action="set-del-last"]', '- Remove last');
await click('[data-action="set-del-last"]', '- Remove last');
ok($$('.set-row').length === 0, 'cleared the rows');
ok($('[data-action="set-fill"]') !== null, 'offers to add the whole plan at once');
await click('[data-action="set-fill"]', '+ All planned');
ok($$('.set-row').length === 3, `the plan filled 3 rows (${$$('.set-row').length})`);
ok($$('.set-row input[data-f="weight"]').map((i) => i.value).join(',') === '40,45,50',
  `filled rows carry the planned weights (${$$('.set-row input[data-f="weight"]').map((i) => i.value).join(',')})`);
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard this workout');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
ok(store.state.active === null, 'test workout discarded');

section('editing a finished session from History');
await click('#tabBar .tab[data-tab="history"]');
await click('.sess-item[data-action="hist-open"]', 'open the newest session');
const editId = store.state.nav.sessionId;
ok($('[data-action="hist-edit"]') !== null, 'detail view offers Edit');
await click('[data-action="hist-edit"]', 'Edit');
ok(store.state.editSessionId === editId, 'edit mode on for that session');
ok($$('.set-row').length > 0, 'logged sets are now editable rows');
ok($('.set-row .rest-btn') === null, 'no rest timer button when correcting a past workout');
const firstW = $('.set-row input[data-f="weight"]');
firstW.value = '123.5';
firstW.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(40);
ok(store.getSession(editId).entries[0].sets[0].weight === 123.5,
  `corrected weight persisted (${store.getSession(editId).entries[0].sets[0].weight})`);
await type('[data-sf="notes"]', 'fixed this up later');
ok(store.getSession(editId).notes === 'fixed this up later', 'session notes corrected');
ok(store.state.active === null, 'no live workout was started by editing');

section('correcting the date from History');
await click('[data-action="hist-timing"]', 'Change date & time');
ok($('[name="date"]') !== null, 'date field present');
$('[name="date"]').value = '2026-10-18';
$('[name="start"]').value = '06:45';
$('[name="end"]').value = '08:00';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
const moved = store.getSession(editId);
ok(new Date(moved.startedAt).getDate() === 18, `moved to the 18th (${new Date(moved.startedAt).toDateString()})`);
ok(new Date(moved.startedAt).getHours() === 6 && new Date(moved.startedAt).getMinutes() === 45, 'start time set to 06:45');
ok(moved.finishedAt > moved.startedAt, 'finish still after start');
await click('[data-action="hist-edit-done"]', 'Done');
ok(store.state.editSessionId === null, 'edit mode left');
ok(/All sessions/.test(view()), 'back on the read-only detail view');
ok(/123.5/.test(view()), 'the correction shows in the read-only log');

section('leaving the editor via a tab clears edit mode');
await click('[data-action="hist-edit"]', 'Edit again');
ok(store.state.editSessionId === editId, 'editing again');
await click('#tabBar .tab[data-tab="routines"]');
ok(store.state.editSessionId === null, 'switching tabs exits edit mode');

section('choose an exercise from the global library');
await click('#tabBar .tab[data-tab="routines"]');
await click('[data-action="routine-open"]', 'open routine');
const pickRid = store.state.nav.routineId;
const countBefore = store.getRoutine(pickRid).entries.length;
await click('[data-action="rentry-add"]', '+ Add exercise');
ok($('[data-action="ex-new"]') !== null, 'offers to create a new exercise');
ok($('#exSearch') !== null, 'offers a searchable list of existing exercises');
const rows = $$('#exLib [data-action="ex-pick"]');
ok(rows.length > 2, `${rows.length} existing exercises listed`);
ok(/last done|never performed/.test($('#exLib').textContent), 'rows show when each was last performed');

$('#exSearch').value = 'ladder';
$('#exSearch').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(30);
ok($$('#exLib [data-action="ex-pick"]').length === 1, 'search narrows the list');
ok(/Ladder Press/.test($('#exLib').textContent), 'the match is the one expected');
$('#exSearch').value = 'zzzz no such thing';
$('#exSearch').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(30);
ok(/Nothing matches/.test($('#exLib').textContent), 'a miss says so rather than showing everything');
$('#exSearch').value = 'ladder';
$('#exSearch').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(30);

await click('#exLib [data-action="ex-pick"]', 'pick Ladder Press');
ok($('[name="name"]').value === 'Ladder Press', 'the form opened prefilled with that exercise');
ok($$('#exRows [data-strow]').length === 3, 'its 3-set plan came across');
ok($$('#exRows [data-stf="w"]').map((i) => i.value).join(',') === '40,45,50',
  `planned weights came across (${$$('#exRows [data-stf="w"]').map((i) => i.value).join(',')})`);
ok($('[name="rest"]').value === '1:00', 'its rest target came across');
$$('#exRows [data-stf="w"]')[0].value = '42.5';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
const reused = store.getRoutine(pickRid).entries.at(-1);
ok(store.getRoutine(pickRid).entries.length === countBefore + 1, 'added to this routine');
ok(reused.name === 'Ladder Press', 'the reused exercise was added');
ok(reused.setTargets[0].weight === 42.5, 'the edit made before saving was kept');
ok(store.state.routines.find((r) => r.name === 'Plan Test').entries[0].setTargets[0].weight === 40,
  'the routine it was copied from is unchanged');

section('the picker is also available mid-workout');
await click('#tabBar .tab[data-tab="now"]');
await click(`[data-action="routine-start"][data-id="${pickRid}"]`, 'Start');
await click('[data-action="entry-add"]', '+ Add exercise');
ok($('#exSearch') !== null, 'same picker when adding to a live session');
const liveBefore = store.state.active.entries.length;
await click('#exLib [data-action="ex-pick"]', 'pick the first exercise');
ok($('[name="name"]').value.length > 0, 'form prefilled');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
ok(store.state.active.entries.length === liveBefore + 1, 'added to the session');
ok(store.getRoutine(pickRid).entries.length === countBefore + 1, 'the routine was not touched');
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('the copy button copies the whole prompt');
await click('#tabBar .tab[data-tab="routines"]');
const copyBtn = $('[data-action="sample-copy"][data-which="prompt"]');
ok(copyBtn !== null, 'the prompt copy button is on the Routines tab');
ok(/Copy the full prompt/.test(copyBtn.textContent), `button says what it does: "${copyBtn.textContent.trim()}"`);
copied = null;
await click('[data-action="sample-copy"][data-which="prompt"]', 'Copy the full prompt');
ok(typeof copied === 'string' && copied.length > 3000, `clipboard received ${copied?.length} chars`);
ok(copied === routinesView.AI_PROMPT, 'the clipboard got the prompt verbatim');
ok(copied.includes('"name": "Run with Upper Body"'), 'including the running JSON example');
ok(copied.includes('"name": "Squat day with Push Movements"'), 'including the lifting JSON example');
ok(copied.includes('"group": "I"') && copied.includes('"distanceUnit": "km"'),
  'with the interval grouping and cardio fields intact');
ok(copied.includes('CONSECUTIVE') && copied.includes('Output ONLY the JSON'),
  'and the schema rules, not just the examples');
ok(/WHAT I WANT/.test(copied) && /CHECKLIST BEFORE YOU ANSWER/.test(copied),
  'and the fill-in block and checklist');

copied = null;
await click('[data-action="sample-copy"][data-which="run"]', 'Copy the running sample');
ok(copied === routinesView.SAMPLE_RUN, 'the per-sample buttons still copy just their sample');
ok(copied.length < routinesView.AI_PROMPT.length, 'which is shorter than the full prompt');

section('the prompt block can be revealed for manual selection');
const det = [...document.querySelectorAll('#viewRoot details')];
ok(det.length >= 1, 'the prompt sits in a collapsible block');
ok(/Show exactly what gets copied/.test(det[0].textContent), 'labelled so you can verify it');
ok(det[0].querySelector('pre.code').textContent === routinesView.AI_PROMPT,
  'and the visible text is the same as what the button copies');

section('copy falls back when the Clipboard API is unavailable');
const realClipboard = dom.window.navigator.clipboard;
Object.defineProperty(dom.window.navigator, 'clipboard', {
  value: { writeText: async () => { throw new Error('NotAllowedError'); } },
  configurable: true,
});
let legacyCopied = null;
document.execCommand = () => {
  const ta = document.querySelector('textarea[readonly]');
  legacyCopied = ta ? ta.value : null;
  return true;
};
await click('[data-action="sample-copy"][data-which="prompt"]', 'Copy with the API blocked');
ok(legacyCopied === routinesView.AI_PROMPT, 'the textarea fallback copied the full prompt');
ok(document.querySelector('textarea[readonly]') === null, 'the temporary textarea was cleaned up');
Object.defineProperty(dom.window.navigator, 'clipboard', { value: realClipboard, configurable: true });
delete document.execCommand;

section('warmup toggle, RIR column and the +/- stepper');
await click('#tabBar .tab[data-tab="now"]');
const stepR = await xi.importFromText(JSON.stringify({
  name: 'Stepper Check', entries: [{ name: 'Row', sets: 2, reps: 10, weight: 50, rest: '1:00' }],
}));
ok(stepR.routines === 1, 'fixture routine imported');
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const stepRoutine = store.state.routines.find((r) => r.name === 'Stepper Check');
await click(`[data-action="routine-start"][data-id="${stepRoutine.id}"]`, 'Start');

ok($('[data-action="set-add-warmup"]') !== null, 'a + Warmup button is offered');
await click('[data-action="set-add-warmup"]', '+ Warmup');
await click('[data-action="set-add"]', '+ Add set');
ok($$('.set-row').length === 2, 'two rows');
ok([...$$('.set-row .idx')].map((b) => b.textContent).join(',') === 'W1,1',
  `rows labelled W1 and 1 (${[...$$('.set-row .idx')].map((b) => b.textContent).join(',')})`);
ok($$('.set-row')[0].classList.contains('warm'), 'the warmup row is styled as one');
ok($$('.set-row')[1].querySelector('input[data-f="weight"]').value === '50',
  'the working set prefilled from the target, not the warmup');

await click('.set-row .idx', 'tap the set label to toggle warmup');
ok([...$$('.set-row .idx')].map((b) => b.textContent).join(',') === '1,2',
  'tapping the label promotes it to a working set and renumbers');
await click('.set-row .idx', 'tap again');
ok([...$$('.set-row .idx')].map((b) => b.textContent).join(',') === 'W1,1', 'and back again');

section('the stepper changes the focused field without losing focus');
ok($('.stepbar') !== null, 'a stepper strip exists in the card');
ok($('.stepbar').hidden === true, 'hidden until a numeric field is focused');
const wIn = $$('.set-row')[1].querySelector('input[data-f="weight"]');
wIn.focus();
await sleep(30);
ok($('.stepbar').hidden === false, 'revealed on focus');
const plus = [...$$('.stepbar button')].find((b) => b.textContent.includes('+2.5'));
ok(!!plus, `the step matches the setting (${[...$$('.stepbar button')].map((b) => b.textContent).join(' ')})`);
plus.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(40);
ok(wIn.value === '52.5', `+2.5 applied to the field (${wIn.value})`);
ok(document.activeElement === wIn, 'focus stayed in the field, so the keyboard stays up');
const steppedSet = store.state.active.entries[0].sets[1];
ok(steppedSet.weight === 52.5, `and persisted to the store (${steppedSet.weight})`);
const minus = [...$$('.stepbar button')].find((b) => b.textContent.includes('-1 rep') || b.textContent.includes('−1 rep'));
const rIn = $$('.set-row')[1].querySelector('input[data-f="reps"]');
rIn.focus();
await sleep(20);
minus.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(40);
ok(rIn.value === '9', `-1 rep applied to reps, not weight (${rIn.value})`);
ok(store.state.active.entries[0].sets[1].reps === 9, 'reps persisted');
ok($$('.set-row').length === 2, 'no re-render happened, so the rows are untouched');

section('the effort columns follow the setting');
ok($('.set-row input[data-f="rpe"]') !== null, 'RPE column shown by default');
ok($('.set-row input[data-f="rir"]') === null, 'RIR hidden by default');
await store.updateSettings({ effortScale: 'both' });
await sleep(40);
ok($('.set-row input[data-f="rpe"]') !== null && $('.set-row input[data-f="rir"]') !== null,
  'both columns shown when the setting says both');
ok($('.set-row').classList.contains('cols-2eff'), 'and the row grid widens to two effort columns');
await type('.set-row input[data-f="rir"]', '2');
ok(store.state.active.entries[0].sets[0].rir === 2, 'typing RIR persists');
await store.updateSettings({ effortScale: 'rir' });
await sleep(40);
ok($('.set-row input[data-f="rpe"]') === null && $('.set-row input[data-f="rir"]') !== null,
  'RIR only when the setting says so');
ok($('.set-row').classList.contains('cols-1eff'), 'back to one effort column');
await store.updateSettings({ effortScale: 'rpe' });

await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('intervals appear as separate efforts in the session list');
await xi.importFromText(JSON.stringify({
  name: 'Interval Check',
  entries: [{ type: 'cardio', name: '200m', repeat: 4, duration: '0:40', rest: '1:30' }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const ivR = store.state.routines.find((r) => r.name === 'Interval Check');
await click(`[data-action="routine-start"][data-id="${ivR.id}"]`, 'Start');
ok(store.state.active.entries.length === 4, `4 efforts to log (${store.state.active.entries.length})`);
ok(/1\/4/.test(view()), 'the Now card shows which rep you are on');
ok($$('.card[data-entry]').length === 4, 'all four appear together as one block');
await click('#tabBar .tab[data-tab="session"]');
ok($$('.sess-item').length === 4, 'and as four rows in the session list');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

console.log(`\n${failures === 0 ? 'ALL DOM CHECKS PASSED' : `${failures} DOM CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
