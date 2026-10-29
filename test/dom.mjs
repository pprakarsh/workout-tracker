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
  el.focus();                       // as a user would, so blur fires on leaving
  el.value = value;
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await sleep(25);
}

const store = await import(`${APP}/js/store.js`);
const cardio = await import(`${APP}/js/cardio.js`);
const planLib = await import(`${APP}/js/plan.js`);
const xi = await import(`${APP}/js/exportimport.js`);
const routinesView = await import(`${APP}/js/views/routines.js`);
await import(`${APP}/js/app.js`);   // boots itself
await sleep(150);

section('boot');
ok(store.state.ready, 'store initialised');
ok(view().length > 0, 'something rendered');
ok($$('#tabBar .tab').length === 5, `five tabs present (${[...$$('#tabBar .tab')].map((b) => b.dataset.tab).join(',')})`);

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

section('the plan is already on screen: confirming, not creating');
ok($$('.set-row').length === 5, `Back Squat opens with its 5 planned rows (${$$('.set-row').length})`);
ok($('.set-row input[data-f="weight"]').value === '100', 'each row pre-filled from the plan');
ok($('[data-action="set-confirm"]') !== null, 'one confirm button is offered');
ok(/100kg . 5/.test($('.confirm .big').textContent.replace(/\s+/g, ' ')),
  `it states exactly what will be logged: "${$('.confirm .big').textContent.trim()}"`);
ok(/set 1/.test($('.confirm .sub').textContent), 'and which set that is');
ok($('[data-action="set-add"]').textContent.includes('Extra set'),
  'adding a set is demoted to the exception it is');

section('typing still works, and still does not re-render');
await type('.set-row input[data-f="weight"]', '102.5');
await type('.set-row input[data-f="reps"]', '5');
await type('.set-row input[data-f="rpe"]', '8');
const liveSet = store.state.active.entries[0].sets[0];
ok(liveSet.weight === 102.5 && liveSet.reps === 5 && liveSet.rpe === 8,
  `typing persisted: ${liveSet.weight} x ${liveSet.reps} @ ${liveSet.rpe}`);
ok($$('.set-row').length === 5, 'no re-render, so the rows are untouched');

section('moving between fields must not destroy the keyboard');
const wA = $$('.set-row input[data-f="weight"]')[1];
const rA = $$('.set-row input[data-f="reps"]')[1];
wA.focus();
rA.focus();                       // fires blur on wA
await sleep(40);
ok(rA.isConnected, 'the newly focused input survived the blur of the previous one');
ok(document.activeElement === rA, 'focus stayed where the user put it');
rA.blur();
await sleep(40);
ok($$('.set-row').length === 5, 'all rows still present after a full blur');

section('one tap logs the set and starts the clock');
ok($('#restBar').hidden, 'rest bar hidden before starting');
await click('[data-action="set-confirm"]', 'confirm set 1');
ok($$('.set-row')[0].classList.contains('done'), 'the set was ticked');
ok(!$('#restBar').hidden, 'and the rest bar is running');
ok(/Rest after Back Squat set 1/.test($('#restBar').textContent), 'bar names the set it follows');
ok(/target 3:00/.test($('#restBar').textContent), 'target came from the routine');
ok(store.state.timer !== null, 'timer running in state');
ok(/set 2/.test($('.confirm .sub').textContent), 'and the confirm button has advanced to set 2');

section('the rest panel is where effort and corrections live');
ok(/102.5kg/.test($('#restBar').textContent), 'it shows what was just logged');
const rpeChip = [...$$('#restBar [data-action="set-effort"]')].find((b) => b.textContent.trim() === '9');
ok(!!rpeChip, `effort chips are offered (${$$('#restBar [data-action="set-effort"]').length} of them)`);
rpeChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(50);
ok(store.state.active.entries[0].sets[0].rpe === 9, 'tapping a chip records the effort');
const rpeChip9 = [...$$('#restBar [data-action="set-effort"]')].find((b) => b.textContent.trim() === '9');
ok(rpeChip9?.classList.contains('on'), 'and shows as selected');
rpeChip9.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(50);
ok(store.state.active.entries[0].sets[0].rpe === null, 'tapping it again clears it, so a mis-tap is one tap to fix');
ok($('#restBar [data-action="set-undo"]') !== null, 'undo is reachable while resting');
ok($('#restBar [data-action="set-rest-edit"]') !== null, 'and so is editing the rest');

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
let restChip2;
const restedSet = store.state.active.entries.find((e) => e.name === firstName).sets[0];
ok(restedSet.rest === 95, `actual rest recorded: ${restedSet.rest}s`);
await click('#tabBar .tab[data-tab="now"]', 'Now tab');
ok(/1\) 1:35/.test(view()), 'the card reports the rest that was timed');
ok(!/2:00/.test($('.restedit')?.textContent || ''),
  'the routine target is not passed off as logged rest');

section('a recorded rest is editable, for a missed or mis-tapped timer');
const restChip = $('.restedit [data-action="set-rest-edit"]');
ok(!!restChip, 'each rest reading is tappable');
restChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(50);
ok($('#modalRoot').hidden === false, 'the rest editor opened');
ok($('[name="rest"]').value === '1:35', `pre-filled with what was recorded (${$('[name="rest"]').value})`);
$('[name="rest"]').value = '2:45';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
const fixed = store.state.active.entries.find((e) => e.name === firstName).sets[0];
ok(fixed.rest === 165, `corrected to 2:45 = 165s (${fixed.rest})`);
ok(/2:45/.test(view()), 'and the card shows the corrected value');

restChip2 = $('.restedit [data-action="set-rest-edit"]');
restChip2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(50);
await click('[data-action="set-rest-clear"]', 'Clear - no rest logged');
await sleep(60);
ok(store.state.active.entries.find((e) => e.name === firstName).sets[0].rest === null,
  'clearing records no rest rather than a zero');
ok(/not logged/.test(view()), 'and it reads as not logged');
await click('#tabBar .tab[data-tab="session"]', 'back to Session');

section('nudging the target');
await click('.sess-item [data-action="sess-jump"]', 'jump to an exercise');
ok(store.state.tab === 'now', 'jumping switches to Now');
await click('[data-action="set-confirm"]', 'confirm the next set');
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
ok($$('.set-row').length === 3, `all 3 planned rows are already on screen (${$$('.set-row').length})`);
ok($$('.set-row input[data-f="weight"]').map((i) => i.value).join(',') === '40,45,50',
  `each row carries its own planned weight (${$$('.set-row input[data-f="weight"]').map((i) => i.value).join(',')})`);
ok($$('.set-row input[data-f="reps"]').map((i) => i.value).join(',') === '10,8,5',
  'and its own planned reps, with the range taking the bottom');
ok(/40kg . 10/.test($('.confirm .big').textContent.replace(/\s+/g, ' ')),
  'the confirm button offers plan row 1');
await click('[data-action="set-confirm"]', 'confirm set 1');
await click('#restBar [data-action="rest-stop"]', 'Stop');
ok(/45kg . 8/.test($('.confirm .big').textContent.replace(/\s+/g, ' ')),
  'and then advances to plan row 2, not a copy of row 1');
await click('[data-action="set-del-last"]', '- Remove last');
ok($$('.set-row').length === 2, 'a row can still be removed');
ok($('[data-action="set-fill"]') !== null, 'and the missing planned row can be restored');
await click('[data-action="set-fill"]', '+ 1 planned');
ok($$('.set-row').length === 3, `back to 3 rows (${$$('.set-row').length})`);
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

ok($$('.set-row').length === 2, 'the 2-set plan is already materialised');
ok($('[data-action="set-add-warmup"]') !== null, 'a + Warmup button is offered');
await click('[data-action="set-add-warmup"]', '+ Warmup');
ok($$('.set-row').length === 3, 'three rows');
ok([...$$('.set-row .idx')].map((b) => b.textContent).join(',') === 'W1,1,2',
  `the warmup lands FIRST, not appended (${[...$$('.set-row .idx')].map((b) => b.textContent).join(',')})`);
ok($$('.set-row')[0].classList.contains('warm'), 'the warmup row is styled as one');
ok($$('.set-row')[1].querySelector('input[data-f="weight"]').value === '50',
  'the working rows keep the plan, unshifted by the warmup');

await click('.set-row .idx', 'tap the set label to toggle warmup');
ok([...$$('.set-row .idx')].map((b) => b.textContent).join(',') === '1,2,3',
  'tapping the label promotes it to a working set and renumbers');
await click('.set-row .idx', 'tap again');
ok([...$$('.set-row .idx')].map((b) => b.textContent).join(',') === 'W1,1,2', 'and back again');

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
ok($$('.set-row').length === 3, 'no re-render happened, so the rows are untouched');

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

section('an interval block is one card, logged in one tap');
await xi.importFromText(JSON.stringify({
  name: 'Interval Check',
  entries: [{
    type: 'cardio', name: 'Treadmill Intervals', rest: '1:30',
    pattern: '1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6',
  }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const ivR = store.state.routines.find((r) => r.name === 'Interval Check');
await click(`[data-action="routine-start"][data-id="${ivR.id}"]`, 'Start');
ok(store.state.active.entries.length === 1, `one card, not six (${store.state.active.entries.length})`);
ok($$('.card[data-entry]').length === 1, 'and one card on screen');
const ivE = store.state.active.entries[0];
ok(ivE.log.legs.length === 12, `holding 12 legs (${ivE.log.legs.length})`);
ok(view().includes('1:00 @ 8:00/km + 1:30 walk @ 6:00/km'), 'the pattern is shown on the card');
ok(view().includes('Log all 6 rounds'), 'with a single button for the whole block');

section('the pattern is built by tapping, not typing');
ok($('[data-action="cardio-pattern"]') !== null, 'the pattern is editable from the card');
await click('[data-action="cardio-pattern"]');
ok($('#bLegs') !== null, 'the builder opened');
ok($$('[data-bleg]').length === 2, `the existing two legs are loaded for editing (${$$('[data-bleg]').length})`);
ok($('#bRounds').textContent === '6', `and its round count (${$('#bRounds').textContent})`);
ok($('#bPreview').textContent.includes('1:00 @ 8:00/km + 1:30 walk @ 6:00/km'),
  'with a live preview of the canonical pattern');
ok($$('[data-b-preset]').length >= 4, 'common blocks are one tap away');

// every number is reachable with a stepper, so no colon is ever typed
const leg0 = $('[data-bleg="0"]');
const plus15 = [...leg0.querySelectorAll('[data-b-step="duration"]')].find((b) => b.textContent === '+15s');
plus15.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(20);
ok($('[data-bleg="0"] [data-b-out="duration"]').textContent === '1:15',
  `+15s stepped the first leg to 1:15 (${$('[data-bleg="0"] [data-b-out="duration"]').textContent})`);
ok($('#bPreview').textContent.includes('1:15 @ 8:00/km'), 'and the preview followed');

const minus5 = [...$('[data-bleg="0"]').querySelectorAll('[data-b-step="pace"]')].find((b) => b.textContent === '\u22125s');
minus5.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(20);
ok($('[data-bleg="0"] [data-b-out="pace"]').textContent === '7:55',
  `pace steps in seconds per km (${$('[data-bleg="0"] [data-b-out="pace"]').textContent})`);

await click('[data-b-rounds="1"]');
ok($('#bRounds').textContent === '7', `rounds step too (${$('#bRounds').textContent})`);
await click('[data-b-rounds="-1"]');

const legsBefore = $$('[data-bleg]').length;
await click('#bDup');
ok($$('[data-bleg]').length === legsBefore + 1, 'a leg can be duplicated rather than re-entered');
await click('[data-bleg="2"] [data-b-del]');
ok($$('[data-bleg]').length === legsBefore, 'and removed again');

section('a preset replaces the whole block in one tap');
const tabata = [...$$('[data-b-preset]')].find((b) => /Tabata/.test(b.textContent));
tabata.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(20);
ok($('#bPreview').textContent.includes('0:20 hard + 0:10 rest'),
  `the preset loaded (${$('#bPreview').textContent.trim().slice(0, 40)})`);
ok($('#bRounds').textContent === '8', 'including its round count');

section('typing is still available, and still explains the format');
const pat = $('#ivPattern');
ok(pat !== null, 'the text field is there for anyone who prefers it');
ok(/leg \+ leg/.test($('#modalForm').textContent), 'it states the format');
ok($('#modalForm').textContent.includes('1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6'),
  'with a worked example');
ok(/bare leg time is/i.test($('#modalForm').textContent),
  'and spells out what a bare number means');
ok(/using the builder/i.test($('#ivEcho').textContent), 'empty means the builder wins');
pat.value = '1 min - 8 mins per km + 1:30 - walk - 6 mins per km x 6';
pat.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(20);
ok($('#ivEcho').textContent.includes('1:00 @ 8:00/km + 1:30 walk @ 6:00/km'),
  `loose notation echoes the canonical form (${$('#ivEcho').textContent.trim().slice(0, 60)})`);
pat.value = 'nonsense';
pat.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(20);
ok(/not understood/i.test($('#ivEcho').textContent), 'and says so when it cannot read it');
pat.value = '';
pat.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(20);

section('saving the builder writes the pattern');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(80);
ok(ivE.legs.length === 2 && ivE.rounds === 8,
  `the Tabata block was saved (${ivE.legs.length} legs x ${ivE.rounds})`);
ok(ivE.log.legs.length === 16, `and expanded to 16 rows (${ivE.log.legs.length})`);
// put the original pattern back for the tests that follow
await store.setIntervalPlan(ivE.id, cardio.parseIntervals('1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6'));
await sleep(40);

section('one tap logs every round');
await click('[data-action="cardio-log-all"]');
ok(ivE.log.legs.every((lg) => lg.done), 'all 12 legs ticked from one tap');
ok(view().includes('All 6 rounds logged'), 'and the button says so');

section('a single round can still be corrected');
await click('[data-action="cardio-rounds"]');
const legRows = $$('.legrow[data-entry-leg]');
ok(legRows.length === 12, `all 12 rounds listed on request (${legRows.length})`);
const target = ivE.log.legs.find((lg) => lg.round === 3 && lg.leg === 0);
const tInput = $(`.legrow[data-entry-leg="${target.id}"] input[data-lf="duration"]`);
ok(tInput !== null && tInput.value === '1:00', `round 3 shows its planned time (${tInput?.value})`);
tInput.focus();
tInput.value = '1:12';
tInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(30);
ok(target.duration === 72 && target.edited === true, `just round 3 changed (${target.duration}s)`);
ok(ivE.log.legs.filter((lg) => lg.leg === 0 && lg.duration === 60).length === 5,
  'the other five are untouched');
ok(document.activeElement === tInput, 'and the keyboard stayed in the field');
await click(`.legrow[data-entry-leg="${target.id}"] [data-action="cardio-leg"]`);
ok(target.done === false, 'its tick can be cleared on its own');

await click('#tabBar .tab[data-tab="session"]');
ok($$('.sess-item').length === 1, 'one row in the session list, not six');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('a straight run logs a time and a pace, and explains the format there');
await xi.importFromText(JSON.stringify({
  name: 'Plain Run Check',
  entries: [{ type: 'cardio', name: 'Evening Run', duration: '28:30', pace: '6:00' }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const prR = store.state.routines.find((r) => r.name === 'Plain Run Check');
await click(`[data-action="routine-start"][data-id="${prR.id}"]`, 'Start');
const runE = store.state.active.entries[0];
ok($('input[data-f="pace"]') !== null, 'pace is a field you log, not just a derived number');
ok($('input[data-f="duration"]').value === '28:30', 'the time is pre-filled from the plan');
ok($('input[data-f="pace"]').value === '6:00', 'and so is the pace');
ok($('input[data-f="distance"]').value === '4.75', `with the distance derived (${$('input[data-f="distance"]').value})`);
const runCard = $('.card[data-entry]').textContent;
ok(/any two/i.test(runCard), 'the card says any two numbers are enough');
ok(runCard.includes('28:30') && runCard.includes('6:00'),
  'and gives a worked example of each format');
ok(/bare/i.test(runCard), 'and spells out what a bare number means');
const paceIn = $('input[data-f="pace"]');
paceIn.focus();
paceIn.value = '5:00';
paceIn.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(30);
ok(runE.log.pace === 300 && runE.log.distance === 5.7,
  `re-pacing moves the distance (${runE.log.distance} km)`);
ok(document.activeElement === paceIn, 'and the keyboard stays in the field');
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('the routine editor teaches the pattern format too');
await click('#tabBar .tab[data-tab="routines"]');
await click(`[data-action="routine-open"][data-id="${prR.id}"]`);
await openBlankExerciseForm('[data-action="rentry-add"]', '+ Add exercise');
const form = $('#modalForm');
ok(form !== null && form.querySelector('[name="pattern"]') !== null,
  'the exercise form has a pattern field');
ok(form.querySelector('[name="targetPace"]') !== null, 'and a target pace field');
// the cardio half is revealed by the type selector, not a separate screen
const typeSel = form.querySelector('#exType');
typeSel.value = 'cardio';
typeSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await sleep(20);
const exCardio = form.querySelector('#exCardio');
ok(exCardio.hidden === false, 'choosing cardio reveals the cardio fields');
ok(exCardio.textContent.includes('1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6'),
  'with the worked example beside the field');
ok(/leg \+ leg/.test(exCardio.textContent), 'the format spelled out');
ok(/one tap/i.test(exCardio.textContent), 'and what logging it will feel like');
ok(/bare leg time is/i.test(exCardio.textContent), 'including the bare-number rule');
ok(/any two/i.test(exCardio.textContent), 'and the any-two rule for a straight run');
await click('[data-mclose]');

section('the header shows a progress bar you can read at a glance');
await xi.importFromText(JSON.stringify({
  name: 'Progress Check',
  entries: [
    { name: 'Plank', measure: 'time', sets: 2, reps: '45', rest: '0:45' },
    { name: 'Farmer Carry', measure: 'distance', sets: 1, reps: 40, weight: 24 },
  ],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const pgR = store.state.routines.find((r) => r.name === 'Progress Check');
await click(`[data-action="routine-start"][data-id="${pgR.id}"]`, 'Start');
const bar = $('.progress .bar');
ok(bar !== null, 'the bar is there');
ok(bar.style.width === '0%', `empty at the start (${bar.style.width})`);
ok($('.progress').getAttribute('aria-valuemax') === '2', 'and reports the total for screen readers');

section('a plank logs in seconds, with the unit on the column');
const pgPlank = store.state.active.entries[0];
ok($('.set-hdr').textContent.includes('Time (s)'),
  `the amount column names its unit (${$('.set-hdr').textContent.trim().replace(/\s+/g, ' ')})`);
const amtIn = $('.set-row input[data-f="reps"]');
ok(amtIn.value === '45', 'pre-filled with the planned 45 seconds');
ok(amtIn.placeholder === '45' || amtIn.getAttribute('aria-label').includes('Time'),
  'and labelled as a time');
ok(view().includes('45s'), 'the confirm button offers the time, not a weight');
ok([...$$('.stepbar button')].some((b) => b.textContent.includes('5s')),
  `the stepper moves in seconds (${[...$$('.stepbar button')].map((b) => b.textContent).join(' ')})`);
amtIn.focus();
amtIn.value = '1:05';
amtIn.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(30);
ok(pgPlank.sets[0].reps === 65, `a clock value is accepted and stored as seconds (${pgPlank.sets[0].reps})`);
ok(document.activeElement === amtIn, 'focus stayed put');

await click('[data-action="set-confirm"]');
await sleep(40);
ok(pgPlank.sets[0].done === true, 'confirming works with no weight at all');
await click('[data-action="rest-stop"]');
await sleep(40);
await click(`[data-action="set-done"][data-set="${pgPlank.sets[1].id}"]`);
await sleep(40);
ok($('.progress .bar').style.width === '50%',
  `one of two exercises done moves the bar to half (${$('.progress .bar').style.width})`);

section('the carry column reads in metres');
await click('[data-action="now-next"]');
ok($('.set-hdr').textContent.includes('Dist (m)'),
  `metres, not reps (${$('.set-hdr').textContent.trim().replace(/\s+/g, ' ')})`);
ok($('.set-hdr').textContent.includes('kg'), 'and the weight column names its unit');

section('"do this next" is one tap from the session list');
// the Now screen shows only the current block, so the exercise you want to pull
// forward is reached from the Session tab -- which is where its menu lives
const pgCarry = store.state.active.entries[1];
await store.setCurrent(0);
await click('#tabBar .tab[data-tab="session"]');
ok($(`[data-action="entry-menu"][data-entry="${pgCarry.id}"]`) !== null,
  'every exercise in the list has its menu');
await click(`[data-action="entry-menu"][data-entry="${pgCarry.id}"]`);
ok($('[data-action="entry-next-up"]') !== null, 'the menu offers "Do this next"');
await click('[data-action="entry-next-up"]');
await sleep(60);
ok(store.state.active.entries.map((e) => e.name).join(',') === 'Plank,Farmer Carry',
  `the carry sits behind the current exercise (${store.state.active.entries.map((e) => e.name).join(',')})`);
ok(store.state.active.entries[store.state.active.currentIdx].name === 'Plank',
  'and you have not been moved off what you were doing');

section('the exercise form explains each measure where it is chosen');
await click(`[data-action="entry-menu"][data-entry="${pgCarry.id}"]`);
await click('[data-action="entry-edit"]');
const mSel = $('#exMeasure');
ok(mSel !== null && mSel.value === 'distance', `the form remembers the measure (${mSel?.value})`);
ok($('#exAmountHdr').textContent === 'Dist (m)', `the grid column follows it (${$('#exAmountHdr').textContent})`);
ok(/carries/i.test($('#exMeasureHint').textContent), 'with a hint naming real exercises');
mSel.value = 'time';
mSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await sleep(20);
ok($('#exAmountHdr').textContent === 'Time (s)', 'switching measure relabels the column live');
ok(/plank|hang/i.test($('#exMeasureHint').textContent), 'and swaps the hint');
ok($('#exRows [data-stf="r"]').placeholder.includes('1:15'),
  `the grid placeholder shows the accepted format (${$('#exRows [data-stf="r"]').placeholder})`);
await click('[data-mclose]');

await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('History spells the date out on every row');
await click('#tabBar .tab[data-tab="history"]');
const histRows = $$('.sess-item');
ok(histRows.length > 0, `there are sessions to look at (${histRows.length})`);
const firstSub = histRows[0].querySelector('.sub').textContent;
ok(/\d{4}/.test(firstSub), `the row carries a full date with a year (${firstSub.trim().slice(0, 40)})`);
ok($('.sess-item .sub b') !== null, 'with the date emphasised over the rest of the line');

section('the filter narrows to a week, a month or a date range');
ok($$('[data-action="hist-filter"]').length === 4, 'four ways to slice it');
ok($('[data-action="hist-filter"][data-mode="all"]').classList.contains('on'), 'all time to begin with');
const allCount = $$('.sess-item').length;

await click('[data-action="hist-filter"][data-mode="week"]');
ok(store.state.histFilter.mode === 'week', 'switched to week');
ok(view().includes('This week'), 'the header names the window');
ok($('[data-action="hist-step"][data-by="1"]').disabled === true,
  'you cannot step forward past the current week');
const weekCount = $$('.sess-item').length;
ok(weekCount <= allCount, `the week shows no more than all time (${weekCount} of ${allCount})`);

await click('[data-action="hist-step"][data-by="-1"]');
ok(store.state.histFilter.offset === -1, 'stepped back one week');
ok(view().includes('Last week'), 'and says so');
ok($('[data-action="hist-step"][data-by="1"]').disabled === false, 'forward is available again');

await click('[data-action="hist-filter"][data-mode="month"]');
ok(store.state.histFilter.offset === 0, 'changing mode resets the step');
ok(view().includes('This month'), 'now showing the month');

section('a specific date, via the range inputs');
await click('[data-action="hist-filter"][data-mode="range"]');
const fromIn = $('input[data-hf="from"]');
ok(fromIn !== null && $('input[data-hf="to"]') !== null, 'two date inputs');
const todayIso = store.state.sessions.length ? new Date(store.state.sessions[0].startedAt) : new Date();
const iso = `${todayIso.getFullYear()}-${String(todayIso.getMonth() + 1).padStart(2, '0')}-${String(todayIso.getDate()).padStart(2, '0')}`;
fromIn.value = iso;
fromIn.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(40);
ok(store.state.histFilter.from === iso, `the filter took the date (${store.state.histFilter.from})`);
ok($$('.sess-item').length >= 1, 'and that day has its session');
ok(!view().includes('Nothing logged'), 'so the list is not empty');

const emptyDay = '2020-01-01';
$('input[data-hf="from"]').value = emptyDay;
$('input[data-hf="from"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(40);
ok(view().includes('Nothing logged'), 'a day with no workout says so rather than showing everything');

section('the filter survives a trip to another tab');
await click('#tabBar .tab[data-tab="now"]');
await click('#tabBar .tab[data-tab="history"]');
ok(store.state.histFilter.mode === 'range' && store.state.histFilter.from === emptyDay,
  'the lens is still where you left it');
await click('[data-action="hist-filter"][data-mode="all"]');
ok($$('.sess-item').length === allCount, 'and All brings everything back');
ok($('.hist-month') !== null, 'with month headings once the range is wide');

section('an unfinished session can be marked done from History');
// a routine with at least one lift entry, so there is a set to log
const openR = store.state.routines.find((r) => r.entries.some((e) => e.type !== 'cardio'));
ok(openR !== undefined, 'found a routine to strand');
await click('#tabBar .tab[data-tab="now"]');
await click(`[data-action="routine-start"][data-id="${openR.id}"]`, 'Start');
ok(store.state.active !== null, 'the session started');
const openId = store.state.active.id;
const oe = store.state.active.entries.find((e) => e.sets && e.sets.length);
ok(oe !== undefined, 'with a materialised set to tick');
await store.toggleSetDone(oe.id, oe.sets[0].id);
const loggedAt = oe.sets[0].completedAt;
store.state.active = null;                       // as if the app had been closed
await click('#tabBar .tab[data-tab="history"]');
const openRow = [...$$('.sess-item')].find((r) => r.dataset.id === openId);
ok(openRow !== undefined, 'the stranded session is listed');
ok(openRow.textContent.includes('unfinished'), 'flagged as unfinished');
ok(openRow.classList.contains('open'), 'and visibly different');
await click(`[data-action="hist-finish"][data-id="${openId}"]`, 'Mark as done');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
ok(store.getSession(openId).finishedAt === loggedAt,
  'it is finished, timed to the last set logged');
const closedRow = [...$$('.sess-item')].find((r) => r.dataset.id === openId);
ok(!closedRow.textContent.includes('unfinished'), 'and the row stops saying unfinished');
await store.deleteSession(openId);

section('the Plan tab shows ten days and plans one in two taps');
await xi.importFromText(JSON.stringify({
  name: 'Plan Day A', entries: [{ name: 'Bench', sets: 3, reps: 5, weight: 60 }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="plan"]');
ok($$('.pd-row').length === 10, `ten day rows (${$$('.pd-row').length})`);
ok($$('.pd-row')[0].textContent.includes('Today'), 'the first row is today');
ok($$('.pd-row')[1].textContent.includes('Tomorrow'), 'then tomorrow');
ok($$('.pd-row')[0].classList.contains('is-today'), 'today is marked');
ok(view().includes('0 planned'), 'nothing planned yet');
ok($$('[data-action="plan-pick"]').length === 10, 'every empty day invites a routine');

const todayKey = planLib.dayKey(Date.now());
const planR = store.state.routines.find((r) => r.name === 'Plan Day A');
await click(`[data-action="plan-pick"][data-key="${todayKey}"]`);
ok($$('[data-action="plan-set"]').length === store.state.routines.length,
  `the picker lists every routine (${$$('[data-action="plan-set"]').length})`);
await click(`[data-action="plan-set"][data-key="${todayKey}"][data-id="${planR.id}"]`);
ok($('#modalRoot').hidden === true, 'and the sheet closes once you choose');
await sleep(60);
ok(store.state.plan[todayKey]?.routineId, 'the routine landed on today');
ok($$('.pd-row')[0].textContent.includes('Plan Day A'), 'and the row names it');
ok(view().includes('1 planned'), 'the header counts it');
ok($('[data-action="plan-start"]') !== null, "today's row offers Start");

section('a rest day, and the two are mutually exclusive');
const tomorrowKey = planLib.dayKey(planLib.addDays(Date.now(), 1));
await click(`[data-action="plan-rest"][data-key="${tomorrowKey}"]`);
await sleep(60);
ok(store.state.plan[tomorrowKey].rest === true, 'tomorrow is a rest day');
ok($$('.pd-row')[1].textContent.includes('Rest day'), 'and says so');
await click(`[data-action="plan-menu"][data-key="${tomorrowKey}"]`);
// scope to the sheet: the ten rows behind it carry the same action
await click('#modalRoot [data-action="plan-pick"]');
await click(`[data-action="plan-set"][data-key="${tomorrowKey}"][data-id="${planR.id}"]`);
await sleep(60);
ok(store.state.plan[tomorrowKey].rest === false && store.state.plan[tomorrowKey].routineId,
  'planning a routine over a rest day replaces it');

section('a day can be pushed to the next one');
await click(`[data-action="plan-menu"][data-key="${tomorrowKey}"]`);
await click('#modalRoot [data-action="plan-shift"][data-by="1"]');
await sleep(60);
const dayAfter = planLib.dayKey(planLib.addDays(Date.now(), 2));
ok(!store.state.plan[tomorrowKey] && store.state.plan[dayAfter]?.routineId,
  'it moved a day later and left the old day empty');

section('starting from the plan begins the workout and lands on Now');
await click('[data-action="plan-start"]');
await sleep(80);
ok(store.state.active !== null, 'the workout started');
ok(store.state.tab === 'now', 'and the app moved to Now');
ok(store.state.active.routineName === 'Plan Day A', 'running the planned routine');

section('finishing it ticks the plan with no second action');
const pSets = store.state.active.entries[0].sets;
for (const st of pSets) await store.toggleSetDone(store.state.active.entries[0].id, st.id);
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-finish"]', 'Finish');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(120);
await click('#tabBar .tab[data-tab="plan"]');
ok($$('.pd-row')[0].classList.contains('done'),
  `today reads done straight from history (${$$('.pd-row')[0].className})`);
ok($$('.pd-row')[0].textContent.includes('done'), 'with a done pill');
ok(store.state.plan[todayKey].doneAt === null, 'and no flag was written to get there');
ok($('[data-action="plan-open"]') !== null, 'the row links to the workout it matched');
ok($('[data-action="plan-start"]') === null, 'and no longer offers Start');

section('the plan can be cleared');
await click('[data-action="plan-clear"]', 'Clear plan');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(80);
ok(Object.keys(store.state.plan).length === 0, 'the plan is empty');
ok(view().includes('0 planned'), 'and the header agrees');

section('a plan with no weight: manual entry, or bodyweight');
await xi.importFromText(JSON.stringify({
  name: 'No Weight Check',
  entries: [
    { name: 'Machine Row', sets: 2, reps: 10 },
    { name: 'Pull-up', sets: 3, reps: 8, bodyweight: true },
  ],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const nwR = store.state.routines.find((r) => r.name === 'No Weight Check');
await click(`[data-action="routine-start"][data-id="${nwR.id}"]`, 'Start');

ok($$('.set-row').length === 2, 'rows still materialise without a planned weight');
ok($('.set-row input[data-f="weight"]').value === '', 'the weight field is empty');
ok($('[data-action="set-confirm"]') === null, 'the confirm-as-planned path is not offered with no load');
ok($('.confirm [data-action="set-rest-toggle"]') !== null
  || $('.confirm').dataset.action === 'set-rest-toggle', 'but the clock is still offered');
ok(/Start rest after set 1/.test($('.confirm .big').textContent),
  `it offers to start the clock (${$('.confirm .big').textContent.trim()})`);
ok(/enter it while you rest/.test($('.confirm .sub').textContent),
  'and says the number can come later');

await click('.confirm', 'start rest with no weight entered');
ok(!$('#restBar').hidden, 'the clock started despite no weight -- time is not recoverable');
ok(store.state.timer.setId === store.state.active.entries[0].sets[0].id,
  'attached to that specific set');
ok(store.state.active.entries[0].sets[0].done === false,
  'and the set was NOT ticked just because rest began');

await type('.set-row input[data-f="weight"]', '42.5');
$('.set-row input[data-f="weight"]').blur();
await sleep(60);
ok(store.state.active.entries[0].sets[0].weight === 42.5, 'weight typed during the rest persisted');
store.state.timer.startedAt -= 70_000;
await click('#restBar [data-action="rest-stop"]', "I'm starting my set");
const caught = store.state.active.entries[0].sets[0];
ok(caught.done === true, 'stopping ticks the set now that it has numbers');
ok(caught.rest === 70, `with the measured rest kept (${caught.rest}s)`);

section('a bodyweight exercise needs no weight at all');
await store.setCurrent(1);
await click('#tabBar .tab[data-tab="now"]');
ok(/Pull-up/.test(view()), 'on the bodyweight exercise');
ok(/bodyweight/.test(view()), 'the target line says so');
ok($('.set-hdr').textContent.includes('+kg'),
  `the weight column reads as ADDED load, with its unit (${$('.set-hdr').textContent.trim().replace(/\s+/g, ' ')})`);
ok($('.set-row input[data-f="weight"]').placeholder === 'BW', 'and the field hints BW');
ok($('[data-action="set-confirm"]') !== null, 'confirm is offered with no weight entered');
ok(/BW . 8/.test($('.confirm .big').textContent.replace(/\s+/g, ' ')),
  `reading as BW x 8 (${$('.confirm .big').textContent.trim()})`);
await click('[data-action="set-confirm"]', 'confirm the BW set');
const bwSet = store.state.active.entries[1].sets[0];
ok(bwSet.done === true && bwSet.bodyweight === true && bwSet.weight === null,
  'logged as bodyweight with no load');
await click('#restBar [data-action="rest-stop"]', 'Stop');

// row 2 is now the active set; adding load to it must read as BW + added
const bwRow2 = $$('.set-row input[data-f="weight"]')[1];
bwRow2.focus();
bwRow2.value = '10';
bwRow2.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
bwRow2.blur();
await sleep(60);
ok(store.state.active.entries[1].sets[1].weight === 10, 'added load persisted');
ok(/BW \+ 10kg . 8/.test($('.confirm .big').textContent.replace(/\s+/g, ' ')),
  `confirm reads as BW + added load (${$('.confirm .big').textContent.trim()})`);

section('BW can be toggled per set from the stepper');
const w2 = $$('.set-row input[data-f="weight"]')[1];
w2.focus();
await sleep(30);
const bwChip = $('.stepbar [data-action="set-bw"]');
ok(!!bwChip, 'a BW chip is offered next to the steppers');
bwChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(60);
ok(store.state.active.entries[1].sets[1].bodyweight === false,
  'tapping it switches that one set to a weighted set');

await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('a per-set timer button, so a missed set can still be timed');
await xi.importFromText(JSON.stringify({
  name: 'Per-Set Clock',
  entries: [{ name: 'Row Machine', sets: 3, reps: 10, weight: 50, rest: '1:30' }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const psR = store.state.routines.find((r) => r.name === 'Per-Set Clock');
await click(`[data-action="routine-start"][data-id="${psR.id}"]`, 'Start');
const clockEntry = () => store.state.active.entries[0];
ok($$('.set-row').length === 3, `3 rows (${$$('.set-row').length})`);
ok($$('.set-row .rest-btn').length === 3, 'every row has its own timer button');
ok($('#restBar').hidden, 'nothing running');

$$('.set-row')[2].querySelector('.rest-btn')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(60);
ok(!$('#restBar').hidden, 'tapping row 3 started the clock');
ok(store.state.timer.setId === clockEntry().sets[2].id,
  'for row 3 specifically, not the active set');
ok(/set 3/.test($('#restBar').textContent), `the bar names it (${$('#restBar .t1').textContent.trim()})`);
ok($$('.set-row')[2].querySelector('.rest-btn').classList.contains('running'),
  'and that row shows as running');

section('the same button stops it');
store.state.timer.startedAt -= 45_000;
$$('.set-row')[2].querySelector('.rest-btn')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(60);
ok($('#restBar').hidden, 'stopped');
ok(clockEntry().sets[2].rest === 45,
  `and recorded 45s against row 3 (${clockEntry().sets[2].rest})`);

section('starting another set banks the running rest rather than losing it');
$$('.set-row')[0].querySelector('.rest-btn')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(60);
store.state.timer.startedAt -= 20_000;
$$('.set-row')[1].querySelector('.rest-btn')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(70);
ok(clockEntry().sets[0].rest === 20,
  `row 1 kept its 20s (${clockEntry().sets[0].rest})`);
ok(store.state.timer.setId === clockEntry().sets[1].id, 'and the clock moved to row 2');

section('the plan can be changed from the rest panel');
ok($('#restBar [data-action="rest-target"]') !== null, 'rest target is editable there');
ok($('#restBar [data-action="entry-add"]') !== null, 'a new exercise can be added there');
ok($('#restBar [data-action="entry-edit"]') !== null, 'and this exercise edited');
ok($('#restBar [data-action="go-session"]') !== null, 'with reorder one tap away');
await click('#restBar [data-action="rest-target"]', 'rest target');
ok($('[name="target"]') !== null, 'the target editor opened');
$('[name="target"]').value = '3:15';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(80);
ok(store.state.timer.target === 195, `target set precisely to 3:15 (${store.state.timer.target}s)`);
await click('#restBar [data-action="rest-stop"]', 'Stop');
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

console.log(`\n${failures === 0 ? 'ALL DOM CHECKS PASSED' : `${failures} DOM CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
