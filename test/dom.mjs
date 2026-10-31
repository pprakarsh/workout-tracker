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
const clock = await import(`${APP}/js/clockstore.js`);
const cardioStore = await import(`${APP}/js/cardiostore.js`);
const cardio = await import(`${APP}/js/cardio.js`);
const planLib = await import(`${APP}/js/plan.js`);
const planStore = await import(`${APP}/js/planstore.js`);
const xi = await import(`${APP}/js/exportimport.js`);
const routinesView = await import(`${APP}/js/views/routines.js`);
await import(`${APP}/js/app.js`);   // boots itself
await sleep(150);
// The sections below predate the require-an-effort-answer rule and assert the
// load/amount rules on their own, so the gate is off by default here. It has
// its own section further down that switches it on.
await store.updateSettings({ requireEffort: false });

section('boot');
ok(store.state.ready, 'store initialised');
ok(view().length > 0, 'something rendered');
ok($$('#tabBar .tab').length === 7, `seven tabs present (${[...$$('#tabBar .tab')].map((b) => b.dataset.tab).join(',')})`);

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
$('#exType').value = 'run';
$('#exType').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await sleep(30);
ok($('#exLift').hidden === true, 'set grid hidden for a run');
ok($('#exCardio').hidden === false, 'run fields shown');
ok($('#exIntervals').hidden === true, 'and the interval builder stays out of the way');
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
ok(/Nothing matches/.test($('#modalRoot').textContent),
  'a miss says so rather than showing everything');
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
ok($('#modalRoot [data-b-legs]') !== null, 'the builder opened');
ok($$('[data-bleg]').length === 2, `the existing two legs are loaded for editing (${$$('[data-bleg]').length})`);
ok($('#modalRoot [data-b-rounds]').textContent === '6', `and its round count (${$('#modalRoot [data-b-rounds]').textContent})`);
ok($('#modalRoot [data-b-preview]').textContent.includes('1:00 @ 8:00/km + 1:30 walk @ 6:00/km'),
  'with a live preview of the canonical pattern');
ok($$('[data-b-preset]').length >= 4, 'common blocks are one tap away');

// every number is reachable with a stepper, so no colon is ever typed
const leg0 = $('[data-bleg="0"]');
const plus15 = [...leg0.querySelectorAll('[data-b-step="duration"]')].find((b) => b.textContent === '+15s');
plus15.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(20);
ok($('[data-bleg="0"] [data-b-out="duration"]').textContent === '1:15',
  `+15s stepped the first leg to 1:15 (${$('[data-bleg="0"] [data-b-out="duration"]').textContent})`);
ok($('#modalRoot [data-b-preview]').textContent.includes('1:15 @ 8:00/km'), 'and the preview followed');

const minus5 = [...$('[data-bleg="0"]').querySelectorAll('[data-b-step="pace"]')].find((b) => b.textContent === '\u22125s');
minus5.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(20);
ok($('[data-bleg="0"] [data-b-out="pace"]').textContent === '7:55',
  `pace steps in seconds per km (${$('[data-bleg="0"] [data-b-out="pace"]').textContent})`);

await click('#modalRoot [data-b-rounds-by="1"]');
ok($('#modalRoot [data-b-rounds]').textContent === '7', `rounds step too (${$('#modalRoot [data-b-rounds]').textContent})`);
await click('#modalRoot [data-b-rounds-by="-1"]');

const legsBefore = $$('[data-bleg]').length;
await click('#modalRoot [data-b-dup]');
ok($$('[data-bleg]').length === legsBefore + 1, 'a leg can be duplicated rather than re-entered');
await click('[data-bleg="2"] [data-b-del]');
ok($$('[data-bleg]').length === legsBefore, 'and removed again');

section('a preset replaces the whole block in one tap');
const tabata = [...$$('[data-b-preset]')].find((b) => /Tabata/.test(b.textContent));
tabata.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(20);
ok($('#modalRoot [data-b-preview]').textContent.includes('0:20 hard + 0:10 rest'),
  `the preset loaded (${$('#modalRoot [data-b-preview]').textContent.trim().slice(0, 40)})`);
ok($('#modalRoot [data-b-rounds]').textContent === '8', 'including its round count');

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
await cardioStore.setIntervalPlan(ivE.id, cardio.parseIntervals('1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6'));
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
const tfBox = (key, part) => $(`[data-tf="${key}"][data-tp="${part}"]`);
ok(tfBox('pace', 'm') !== null, 'pace is a field you log, not just a derived number');
ok(tfBox('duration', 'h') !== null && tfBox('duration', 'm') !== null && tfBox('duration', 's') !== null,
  'time has separate hour, minute and second boxes - no colon to type');
ok(tfBox('pace', 'h') === null, 'pace has no hours box, since a pace never needs one');
ok(tfBox('duration', 'h').inputMode === 'numeric', 'each box asks for the number keypad');
ok(`${tfBox('duration', 'm').value}:${tfBox('duration', 's').value}` === '28:30',
  `the time is pre-filled from the plan (${tfBox('duration', 'm').value}:${tfBox('duration', 's').value})`);
ok(tfBox('pace', 'm').value === '6' && tfBox('pace', 's').value === '0', 'and so is the pace');
ok($('input[data-f="distance"]').value === '4.75', `with the distance derived (${$('input[data-f="distance"]').value})`);
ok($('[data-tf-echo="duration"]').textContent === '28:30',
  `the total is echoed back as a clock (${$('[data-tf-echo="duration"]').textContent})`);
const runCard = $('.card[data-entry]').textContent;
ok(/any two/i.test(runCard), 'the card says any two numbers are enough');
ok(runCard.includes('28:30') && runCard.includes('6:00'),
  'and gives a worked example of each format');
ok(/counts as/i.test(runCard) && /0/.test(runCard),
  'and spells out that an empty box counts as zero');
const paceM = tfBox('pace', 'm');
paceM.focus();
paceM.value = '5';
paceM.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(40);
ok(runE.log.pace === 300 && runE.log.distance === 5.7,
  `re-pacing from the minutes box moves the distance (${runE.log.distance} km)`);
ok(document.activeElement === paceM, 'and the keyboard stays in the box');
ok($('[data-tf-echo="pace"]').textContent === '5:00',
  `the echo follows (${$('[data-tf-echo="pace"]').textContent})`);

section('a blank box counts as zero, and all blank means nothing entered');
const durS = tfBox('duration', 's');
durS.focus();
durS.value = '';
durS.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(40);
ok(runE.log.duration === 28 * 60, `clearing the seconds leaves 28:00 (${runE.log.duration}s)`);
tfBox('duration', 'm').value = '';
tfBox('duration', 'm').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(40);
ok(runE.log.duration === null, 'emptying every box means no value at all, not zero');
tfBox('duration', 'm').value = '30';
tfBox('duration', 'm').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(40);
ok(runE.log.duration === 1800, `and typing one box back fills it again (${runE.log.duration}s)`);

section('a seconds box over 59 is accepted, not scolded');
tfBox('duration', 's').value = '90';
tfBox('duration', 's').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(40);
ok(runE.log.duration === 1890, `30 minutes and 90 seconds is 31:30 (${runE.log.duration}s)`);
ok($('[data-tf-echo="duration"]').textContent === '31:30',
  `echoed as a real clock value (${$('[data-tf-echo="duration"]').textContent})`);
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('the routine editor teaches the pattern format too');
await click('#tabBar .tab[data-tab="routines"]');
await click(`[data-action="routine-open"][data-id="${prR.id}"]`);
await openBlankExerciseForm('[data-action="rentry-add"]', '+ Add exercise');
const form = $('#modalForm');
ok(form !== null && form.querySelector('[name="targetPace"]') !== null,
  'the exercise form has a target pace field');
ok([...form.querySelectorAll('#exType option')].map((o) => o.value).join(',') === 'lift,run,intervals',
  'and Intervals is offered as its own kind of exercise, not a buried field');
// the cardio half is revealed by the type selector, not a separate screen
const typeSel = form.querySelector('#exType');
typeSel.value = 'run';
typeSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await sleep(20);
const exCardio = form.querySelector('#exCardio');
ok(exCardio.hidden === false, 'choosing cardio reveals the cardio fields');
ok(/any two/i.test(exCardio.textContent), 'the any-two rule for a straight run');
ok(/Intervals/.test(exCardio.textContent), 'and it points at Intervals for a repeating block');

section('choosing Intervals gives the same tap builder as logging does');
typeSel.value = 'intervals';
typeSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await sleep(30);
const exIv = form.querySelector('#exIntervals');
ok(exIv.hidden === false, 'the interval section is revealed');
ok(form.querySelector('#exCardio').hidden === true, 'and the run fields step aside');
ok(exIv.querySelector('[data-b-legs]') !== null, 'with the builder, not a text box');
ok(exIv.querySelectorAll('[data-bleg]').length === 2, 'seeded with two legs');
ok(exIv.querySelectorAll('[data-b-preset]').length >= 4, 'and the presets');
ok(form.querySelector('#exPattern').value.length > 0,
  `the hidden field already holds a pattern (${form.querySelector('#exPattern').value})`);
ok(/one tap/i.test(exIv.textContent), 'it says what logging will feel like');
ok(/timed/i.test(exIv.textContent), 'and that legs are timed, not measured');

const ivPlus = [...exIv.querySelectorAll('[data-b-step="duration"]')].find((b) => b.textContent === '+15s');
ivPlus.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(20);
ok(/1:15/.test(form.querySelector('#exPattern').value),
  `stepping a leg updates the saved pattern (${form.querySelector('#exPattern').value})`);
await click('[data-b-rounds-by="1"]');
await sleep(20);
ok(/\u00d7 7$/.test(form.querySelector('#exPattern').value),
  `and so does the round count (${form.querySelector('#exPattern').value})`);
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
ok($('#exRows [data-stf="r"]').placeholder === '45',
  `the grid placeholder asks for plain seconds, not a colon the keypad lacks (${$('#exRows [data-stf="r"]').placeholder})`);
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

section('Settings is a screen reached from the header, not a seventh tab');
ok($$('#tabBar .tab').length === 7, 'the tab bar stays at seven');
ok($('#appHeader [data-action="settings-go"]') !== null, 'the gear is in the header, visible everywhere');
await click('#tabBar .tab[data-tab="history"]');
await click('[data-action="settings-go"]');
ok(store.state.tab === 'settings', 'it opens as its own screen');
ok($('#appTitle').textContent === 'Settings', `with its own title (${$('#appTitle').textContent})`);
ok(view().includes('Units') && view().includes('Rest timer') && view().includes('Sync'),
  'carrying every section');
ok($('[data-cf="unit"]') !== null && $('[data-cf="prefillFrom"]') !== null, 'and the controls');
ok($('[data-action="settings-close"]') !== null, 'with a way out');

section('settings save as you change them, with no Save button');
ok($('#modalForm') === null, 'it is not a modal');
const startUnit = store.state.settings.unit;
const other = startUnit === 'kg' ? 'lb' : 'kg';
// a select repaints the screen, so the element has to be looked up again
const setUnit = async (v) => {
  const el = $('[data-cf="unit"]');
  el.value = v;
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await sleep(50);
};
await setUnit(other);
ok(store.state.settings.unit === other, `the unit saved immediately (${store.state.settings.unit})`);
await setUnit(startUnit);
ok(store.state.settings.unit === startUnit, `and back again (${store.state.settings.unit})`);

const stepIn = $('[data-cf="weightStep"]');
stepIn.focus();
stepIn.value = '5';
stepIn.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(50);
ok(store.state.settings.weightStep === 5, `typing saves too (${store.state.settings.weightStep})`);
ok(document.activeElement === stepIn, 'without stealing the keyboard');
stepIn.value = '2.5';
stepIn.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(40);

section('closing settings returns you where you were');
await click('[data-action="settings-close"]');
ok(store.state.tab === 'history', `back to History (${store.state.tab})`);

section('the prefill mode is switchable from Settings');
await click('[data-action="settings-go"]');
const pfSel = $('[data-cf="prefillFrom"]');
ok(pfSel.value === store.state.settings.prefillFrom, 'the control reflects the setting');
ok(/ratchet|shrink/i.test(view()), 'and the screen warns that the set count never shrinks');
const setPrefill = async (v) => {
  const el = $('[data-cf="prefillFrom"]');
  el.value = v;
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await sleep(50);
};
await setPrefill('plan');
ok(store.state.settings.prefillFrom === 'plan', 'switched to plan targets');
await setPrefill('last');
ok(store.state.settings.prefillFrom === 'last', 'and back to last time');
await click('[data-action="settings-close"]');

section('the Trends tab opens on an overview of everything logged');
await click('#tabBar .tab[data-tab="trends"]');
ok(view().includes('Logged'), 'it shows how much has been logged');
ok($$('.chart').length >= 1, `with at least one chart (${$$('.chart').length})`);
ok(view().includes('Sets per week'), 'sets per week is always there');
ok($('.chart[role="img"]') !== null, 'and the chart is labelled for a screen reader');
ok($('.chart[aria-label]').getAttribute('aria-label').length > 10, 'with a real description');
ok($$('[data-action="trend-open"]').length >= 1, 'every trained exercise is tappable');
ok($$('.cbar').length >= 4, `bars are drawn, one per week (${$$('.cbar').length})`);
ok($('.cbar.now') !== null, 'with the current week highlighted');

section('tapping an exercise shows how it is progressing');
const trendTarget = [...$$('[data-action="trend-open"]')][0];
const trendName = trendTarget.dataset.name;
await click(`[data-action="trend-open"][data-name="${trendName}"]`);
ok(store.state.nav.trendName === trendName, `opened ${trendName}`);
ok(view().includes(trendName), 'the heading names it');
ok($('[data-action="trend-back"]') !== null, 'with a way back');
ok($$('[data-action="trend-range"]').length === 3, 'three ranges to choose from');
ok($('[data-action="trend-range"][data-range="all"]').classList.contains('on'), 'all time by default');
ok($('.trend-table') !== null, 'the session table is there — the real readout on a phone');
ok($$('.trend-table .tr').length >= 2, 'with a header and at least one row');
ok($('.trend-table .tr.hd') !== null, 'the table has column headings');

section('a thin history says so instead of drawing a trend');
const detailText = view();
const hasDelta = $('.trend-delta') !== null;
ok(hasDelta || /more and a trend appears/.test(detailText),
  'either a delta or an explicit "not enough yet" — never a line through two points');
if (!hasDelta) {
  ok(/session/.test(detailText), 'and it says how many sessions there are');
}

section('switching range re-filters without leaving the exercise');
await click('[data-action="trend-range"][data-range="3m"]');
ok(store.state.trendRange === '3m', 'the range changed');
ok(store.state.nav.trendName === trendName, 'and we are still on the same exercise');
ok($('[data-action="trend-range"][data-range="3m"]').classList.contains('on'), 'the chip reflects it');
await click('[data-action="trend-range"][data-range="all"]');

section('the exercise can be swapped from inside the detail');
await click('[data-action="trend-pick"]');
ok($('#modalRoot [data-action="trend-open"]') !== null, 'the picker lists exercises');
await click('[data-mclose]');
await click('[data-action="trend-back"]');
ok(store.state.nav.trendName === null, 'back returns to the overview');
ok(view().includes('Sets per week'), 'which is the overview again');

section('effort chips are on the card, not only in the rest panel');
await store.updateSettings({ requireEffort: true, effortScale: 'rpe' });
await xi.importFromText(JSON.stringify({
  name: 'Effort UI Check',
  entries: [{ name: 'EU Press', sets: 2, reps: 5, weight: 60 }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const euR = store.state.routines.find((r) => r.name === 'Effort UI Check');
await click(`[data-action="routine-start"][data-id="${euR.id}"]`, 'Start');
const euE = store.state.active.entries[0];
ok($('.effbar') !== null, 'the chips are on the card itself');
ok($('.effbar').classList.contains('need'), 'flagged because the set still owes an answer');
ok($$('.effbar [data-action="set-effort"][data-field="rpe"]').length === 5,
  'five RPE chips, no typing into a 48px box');
ok($('.effbar [data-field="unknown"]') !== null, "and a don't-know chip");
ok($$('.effbar [data-field="rir"]').length === 0, 'no RIR chips, since RPE is the scale in use');

section('the confirm bar asks for effort rather than refusing');
ok($('[data-action="set-confirm"]') === null, 'it is not a plain confirm yet');
ok($('[data-action="set-effort-then"]') !== null, 'but it is still a button, not a dead end');
ok(/ask how hard/i.test(view()), 'and says what tapping it will do');

section('tapping the row tick asks for effort too -- it used to walk past the gate');
const euTick = $(`.set-row [data-action="set-done"][data-set="${euE.sets[0].id}"]`);
ok(euTick !== null, 'the row has its own tick');
await click(`.set-row [data-action="set-done"][data-set="${euE.sets[0].id}"]`);
ok(euE.sets[0].done === false, 'it does not log the set on its own');
ok($('#modalRoot').hidden === false, 'it opens the effort prompt instead');
ok(/How hard was set/i.test($('#modalRoot').textContent), 'asking the question directly');
ok($$('#modalRoot [data-eff-field="rpe"]').length === 5, 'with five RPE chips');
ok($('#modalRoot [data-eff-field="unknown"]') !== null, "and I don't know");
await click('#modalRoot [data-eff-field="rpe"][data-eff-value="7"]');
await sleep(60);
ok(euE.sets[0].rpe === 7, 'choosing records the effort');
ok(euE.sets[0].done === true, 'AND completes the tick that was blocked -- one gesture, not two');
ok($('#modalRoot').hidden === true, 'the prompt closes itself');
await store.updateSet(euE.id, euE.sets[0].id, { rpe: null, done: false });
await sleep(40);

section('unticking is never gated');
await store.updateSet(euE.id, euE.sets[0].id, { rpe: 8 });
await click(`.set-row [data-action="set-done"][data-set="${euE.sets[0].id}"]`);
await sleep(40);
ok(euE.sets[0].done === true, 'ticked with an effort present, no prompt');
await click(`.set-row [data-action="set-done"][data-set="${euE.sets[0].id}"]`);
await sleep(40);
ok(euE.sets[0].done === false, 'and untickable without being asked anything');

section('the big confirm bar routes through the same prompt');
await store.updateSet(euE.id, euE.sets[0].id, { rpe: null });
await sleep(40);
await click('[data-action="set-effort-then"]');
ok(/How hard was set/i.test($('#modalRoot').textContent), 'the prompt opens');
await click("#modalRoot [data-eff-field='unknown']");
await sleep(80);
ok(euE.sets[0].effortUnknown === true, "don't know is recorded");
ok(euE.sets[0].done === true, 'and the set logs');
ok(/don.t know/i.test(view()) || $('.effbar [data-field="unknown"]').classList.contains('on'),
  'the card reflects it');

section('the card chips answer it ahead of time, and toggle off');
const euS2 = euE.sets[1];
await click(`.effbar [data-field="rpe"][data-value="8"]`);
ok(euS2.rpe === 8 || euE.sets[0].rpe === 8, 'a chip records the effort for the active set');

section('sets filled in but not ticked are called out on the card');
// set 2 is pre-filled from the plan but has no effort answer yet
await store.updateSet(euE.id, euE.sets[1].id, { rpe: null, rir: null, effortUnknown: false });
await sleep(50);
ok(euE.sets[1].weight === 60 && euE.sets[1].reps === 5, 'set 2 is pre-filled');
ok(euE.sets[1].done === false, 'and unticked');
ok($('.unticked') !== null, 'so the card says so');
ok(/filled in but not logged/i.test($('.unticked').textContent), 'in plain words');
ok(/finish the row first/i.test($('.unticked').textContent),
  `and says what is missing while it still owes an effort answer (${$('.unticked').textContent.replace(/\s+/g, ' ').trim()})`);
await click('.effbar [data-field="rpe"][data-value="9"]');
await sleep(40);
ok($('.unticked [data-action="set-tick-loose"]') !== null,
  'once it is ready, the hint offers to log it');
await click('[data-action="set-tick-loose"]');
await sleep(60);
ok(euE.sets[1].done === true, 'one tap logs it');
ok($('.unticked') === null, 'and the hint goes away');

await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);
await store.updateSettings({ requireEffort: false });

section('a run is confirmed with the same big bar a lift uses');
await xi.importFromText(JSON.stringify({
  name: 'Confirm Run Check',
  entries: [{ type: 'cardio', name: 'CR Run', duration: '30:00', pace: '6:00' }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const crR = store.state.routines.find((r) => r.name === 'Confirm Run Check');
await click(`[data-action="routine-start"][data-id="${crR.id}"]`, 'Start');
const crE = store.state.active.entries[0];
const crBar = $('.confirm[data-action="cardio-done"]');
ok(crBar !== null, 'the run has a full-width confirm bar, not a small footer button');
ok(crBar.textContent.includes('30:00') && crBar.textContent.includes('6:00/km'),
  `showing what it will record (${crBar.textContent.replace(/\s+/g, ' ').trim().slice(0, 50)})`);
ok(/nothing is recorded until/i.test(crBar.textContent),
  'and saying plainly that the numbers on screen are not yet logged');
ok(crE.log.done === false, 'it starts unconfirmed');

section('finishing warns about work that was never confirmed');
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-finish"]');
ok(/Filled in but not logged/i.test($('#modalForm').textContent),
  'the finish prompt flags it');
ok($('#modalForm').textContent.includes('CR Run'), 'naming the run');
ok(/saved as .{0,12}nothing/i.test($('#modalForm').textContent.replace(/\s+/g, ' ')),
  'and spelling out that it would be saved as nothing');
ok($('[data-action="sess-confirm-loose"]') !== null, 'with a one-tap fix');

section('the one-tap fix logs it and returns to finishing');
await click('[data-action="sess-confirm-loose"]');
await sleep(90);
ok(crE.log.done === true, 'the run is logged');
ok($('#modalForm') !== null, 'and the finish prompt is back');
ok(!/Filled in but not logged/i.test($('#modalForm').textContent), 'with nothing left to warn about');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(140);
ok(store.state.active === null, 'the workout finished');

section('and now it reaches Trends');
await click('#tabBar .tab[data-tab="trends"]');
ok(view().includes('Running per week'), 'the running chart appears');
ok([...$$('[data-action="trend-open"]')].some((b) => b.dataset.name === 'CR Run'),
  'and the run is listed as something you train');

section('an interval block gets a running trend of its own');
await xi.importFromText(JSON.stringify({
  name: 'Trend Intervals',
  entries: [{
    type: 'cardio', name: 'Trend 400s', rest: '2:00',
    pattern: '1:35 @ 4:00/km + 1:30 walk @ 9:00/km x 4',
  }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const tiR = store.state.routines.find((r) => r.name === 'Trend Intervals');
await click(`[data-action="routine-start"][data-id="${tiR.id}"]`, 'Start');
await click('[data-action="cardio-log-all"]');
await sleep(40);
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-finish"]', 'Finish');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(140);

await click('#tabBar .tab[data-tab="trends"]');
ok(view().includes('Running per week'), 'the overview now has a running chart');
const ivListRow = [...$$('[data-action="trend-open"]')].find((b) => b.dataset.name === 'Trend 400s');
ok(ivListRow !== undefined, 'the interval block is listed as something you train');
ok(/rounds/.test(ivListRow.textContent), `with its rounds counted (${ivListRow.querySelector('.sub').textContent.replace(/\s+/g, ' ').trim()})`);
ok(/km/.test(ivListRow.textContent), 'and the distance it came to');

await click('[data-action="trend-open"][data-name="Trend 400s"]');
ok(view().includes('Best work-leg pace'),
  'the headline is the WORK leg, not an average across the block');
ok(view().includes('4:00/km'), `which is the fast leg (${/4:00\/km/.test(view())})`);
ok(!view().includes('9:00/km') || view().includes('rest'),
  'the recovery pace only appears labelled as rest');
ok(/work leg/i.test(view()), 'and the card explains why that is the metric');
ok(view().includes('Personal bests'), 'PRs apply to running too');
ok(/Fastest work leg/.test(view()), 'named for intervals');
ok(/Most rounds/.test(view()), 'including rounds completed');
ok(/Distance covered/.test(view()) && /Time running/.test(view()),
  'with the totals the block contributed');
ok($('.trend-table') !== null, 'and a table of efforts');
ok(/4 of 4 rounds|4 rounds/.test($('.trend-table').textContent),
  `whose row reports the rounds done (${$('.trend-table').textContent.replace(/\s+/g, ' ').slice(0, 70)})`);
await click('[data-action="trend-back"]');

section('a plank trend is measured in seconds, with no estimated 1RM');
await xi.importFromText(JSON.stringify({
  name: 'Trend Hold', entries: [{ name: 'Trend Plank', measure: 'time', sets: 2, reps: '45' }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const thR = store.state.routines.find((r) => r.name === 'Trend Hold');
await click(`[data-action="routine-start"][data-id="${thR.id}"]`, 'Start');
const thE = store.state.active.entries[0];
for (const st of thE.sets) await store.toggleSetDone(thE.id, st.id);
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-finish"]', 'Finish');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(120);
await click('#tabBar .tab[data-tab="trends"]');
await click('[data-action="trend-open"][data-name="Trend Plank"]');
ok(view().includes('Longest hold'), 'the headline is the longest hold');
ok(!view().includes('Estimated 1RM'), 'and no estimated 1RM is offered');
ok(view().includes('45s'), `with the hold in seconds (${/45s/.test(view())})`);
ok(view().includes('Personal bests'), 'PRs still apply');
await click('[data-action="trend-back"]');

section('the Plan tab shows ten days and plans one in two taps');
await xi.importFromText(JSON.stringify({
  name: 'Plan Day A', entries: [{ name: 'Bench', sets: 3, reps: 5, weight: 60 }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="plan"]');
ok($$('.pd-row').length === 17, `ten days ahead plus seven behind (${$$('.pd-row').length})`);
ok($$('.pd-row:not(.is-past)').length === 10, 'ten of them are the plan');
ok($$('.pd-row.is-past').length === 7, 'and seven are the week behind');
ok($$('.pd-row')[0].textContent.includes('Today'), 'the FIRST row is today, not a week ago');
ok($$('.pd-row')[1].textContent.includes('Tomorrow'), 'then tomorrow');
ok($$('.pd-row')[0].classList.contains('is-today'), 'today is marked');
ok(view().includes('Previous 7 days'), 'the week behind has its own heading, below the plan');
const firstPast = $('.pd-row.is-past');
ok(firstPast.textContent.includes('Yesterday'), 'which starts at yesterday');
ok($$('.pd-row.is-past')[6].dataset.planRow === planLib.dayKey(planLib.addDays(Date.now(), -7)),
  'and the last of them is seven days back');
ok(firstPast.querySelector('[data-action="plan-pick"]') === null,
  'a past day offers no "plan a routine" — yesterday cannot be planned');
ok(firstPast.textContent.includes('nothing logged'), 'it says plainly that nothing was logged');
ok(firstPast.querySelector('[data-action="plan-menu"]') !== null,
  'but its menu is there, so a workout the app never saw can still be ticked');
ok(/Last 7 days/.test(view()), 'and the header summarises the week behind');
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

section('a finished workout shows up in the week behind, on its own day');
// a session dated yesterday, as if logged then
const yKey = planLib.dayKey(planLib.addDays(Date.now(), -1));
const ySess = {
  id: 'w_yesterday', routineId: pgR ? pgR.id : null, routineName: 'Plan Day A', unit: 'kg',
  startedAt: planLib.keyToTs(yKey), finishedAt: planLib.keyToTs(yKey) + 3600000,
  updatedAt: planLib.keyToTs(yKey) + 3600000, entries: [], currentIdx: 0,
  rpe: null, bodyweight: null, notes: '', modified: false,
};
store.state.sessions.unshift(ySess);
store.emit();
await sleep(50);
const yRow = [...$$('.pd-row.is-past')].find((r) => r.dataset.planRow === yKey);
ok(yRow.textContent.includes('Plan Day A'), 'the row names what was logged');
ok(yRow.textContent.includes('not planned'), 'and says it was not planned, since it was not');
ok(yRow.classList.contains('done'), 'it reads as done');
ok(yRow.querySelector('[data-action="plan-open"]') !== null, 'with a link to the workout');
const backLine = [...$$('.card.flat .small.dim')].map((d) => d.textContent.replace(/\s+/g, ' '))
  .find((t) => t.includes('Last 7 days')) || '';
ok(/Last 7 days: 1 trained/.test(backLine),
  `and the header counts it, planned or not (${backLine.trim()})`);

section('a planned day that came and went reads as missed');
await planStore.setPlanDay(planLib.dayKey(planLib.addDays(Date.now(), -3)), { routineId: pgR.id });
await sleep(50);
const mKey = planLib.dayKey(planLib.addDays(Date.now(), -3));
const mRow = [...$$('.pd-row.is-past')].find((r) => r.dataset.planRow === mKey);
ok(mRow.classList.contains('missed'), 'the row is marked missed');
ok(mRow.textContent.includes('missed'), 'and says so');
ok(mRow.querySelector('[data-action="plan-start"]') === null, 'with no Start button on a past day');
await click(`[data-action="plan-menu"][data-key="${mKey}"]`);
await click('#modalRoot [data-action="plan-done"]');
await sleep(50);
const mRow2 = [...$$('.pd-row.is-past')].find((r) => r.dataset.planRow === mKey);
ok(mRow2.classList.contains('done'), 'ticking it by hand closes it off');
ok(mRow2.textContent.includes('by hand'), 'and the row admits it was manual');
store.state.sessions = store.state.sessions.filter((x) => x.id !== 'w_yesterday');
await planStore.clearPlanDay(mKey);

section('an empty past day can be called a rest day in one tap');
const restKey = planLib.dayKey(planLib.addDays(Date.now(), -5));
const restRow = () => [...$$('.pd-row.is-past')].find((r) => r.dataset.planRow === restKey);
ok(restRow().textContent.includes('nothing logged'), 'it starts as an empty day');
ok(restRow().querySelector('[data-action="plan-rest"]') !== null,
  'with the rest button right on the row');
await click(`[data-action="plan-rest"][data-key="${restKey}"]`);
await sleep(60);
ok(store.state.plan[restKey].rest === true, 'tapping it marks the day');
ok(restRow().classList.contains('rest'), 'the row restyles');
ok(restRow().textContent.includes('Rest day'), 'and says Rest day');
ok(restRow().querySelector('[data-action="plan-rest"]') === null,
  'the inline button steps aside once there is something on the day');
ok(/1 rest/.test([...$$('.card.flat .small.dim')].map((d) => d.textContent).join(' ')),
  'and the week behind counts it');

section('and un-marked again from its menu');
await click(`[data-action="plan-menu"][data-key="${restKey}"]`);
ok(/Not a rest day after all/.test($('#modalRoot').textContent),
  'the menu offers to undo it, worded for a day already marked');
await click('#modalRoot [data-action="plan-rest"]');
await sleep(60);
ok(store.state.plan[restKey] === undefined || store.state.plan[restKey].rest === false,
  'it is no longer a rest day');
ok(restRow().textContent.includes('nothing logged'), 'and reads as empty again');

section('a planned day can be turned into a rest day from the menu too');
const swapKey = planLib.dayKey(planLib.addDays(Date.now(), 3));
await planStore.setPlanDay(swapKey, { routineId: pgR.id });
await sleep(50);
await click(`[data-action="plan-menu"][data-key="${swapKey}"]`);
ok(/Mark as a rest day/.test($('#modalRoot').textContent),
  'the option is there for a planned day, which previously needed clearing first');
await click('#modalRoot [data-action="plan-rest"]');
await sleep(60);
ok(store.state.plan[swapKey].rest === true && store.state.plan[swapKey].routineId === null,
  'and it replaces the routine rather than sitting alongside it');
await planStore.clearPlanDay(swapKey);
await sleep(40);

section('a missed day can be logged after the fact, from the Plan tab');
const lateKey = planLib.dayKey(planLib.addDays(Date.now(), -4));
await planStore.setPlanDay(lateKey, { routineId: pgR.id });
await sleep(50);
const lateRow = [...$$('.pd-row.is-past')].find((r) => r.dataset.planRow === lateKey);
ok(lateRow.classList.contains('missed'), 'the day reads missed');
ok(lateRow.querySelector('[data-action="past-log"]') !== null,
  'and offers "Log it" right on the row, where the intent is obvious');
await click(`[data-action="past-log"][data-key="${lateKey}"]`);
ok($('input[name="date"]') !== null, 'the when-did-you-do-it sheet opened');
ok($('input[name="date"]').value === lateKey,
  `with the date already set from the row (${$('input[name="date"]').value})`);
ok($('input[name="date"]').max === planLib.dayKey(Date.now()),
  'and no future date selectable');
ok($('input[name="start"]').value.length === 5 && $('input[name="end"]').value.length === 5,
  'plus start and end times');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(140);
ok(store.state.tab === 'history', 'it lands in History');
const madeId = store.state.nav.sessionId;
ok(madeId && store.getSession(madeId) !== null, 'with the new session open');
ok(store.state.editSessionId === madeId, 'and already in edit mode, ready to fill in');
ok(planLib.dayKey(store.getSession(madeId).startedAt) === lateKey,
  'dated to the day it happened');
ok(store.state.active === null, 'no workout was started -- this is a recording, not a session');
ok($$('.set-row').length >= 1, `the set grid is there to fill in (${$$('.set-row').length} rows)`);
ok($('[data-action="rest-start"]') === null && $('[data-action="set-rest-toggle"]') === null,
  'but no rest timer, which a four-day-old workout has no use for');

section('filling it in flips the planned day to done');
const madeE = store.getSession(madeId).entries.find((e) => e.sets && e.sets.length);
for (const st of madeE.sets) await store.toggleSetDone(madeE.id, st.id);
await sleep(60);
await click('[data-action="hist-edit-done"]');
await click('#tabBar .tab[data-tab="plan"]');
const fixedRow = [...$$('.pd-row.is-past')].find((r) => r.dataset.planRow === lateKey);
ok(fixedRow.classList.contains('done'),
  `the missed day now reads done, straight from the session (${fixedRow.className})`);
ok(fixedRow.querySelector('[data-action="past-log"]') === null, 'and stops offering to log it');
ok(store.state.plan[lateKey].doneAt === null, 'with no manual flag needed');
await store.deleteSession(madeId);
await planStore.clearPlanDay(lateKey);

section('a past workout can also be logged from History, routine chosen there');
await click('#tabBar .tab[data-tab="history"]');
ok($('[data-action="past-log"]') !== null, 'the list offers it too');
await click('[data-action="past-log"]');
ok($$('#modalRoot [data-action="past-log"]').length >= 2,
  'which asks which routine, plus an empty-workout option');
await click('[data-mclose]');
// hand the following section the tab it expects to be on
await click('#tabBar .tab[data-tab="plan"]');

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
ok(bwSet.done === true && bwSet.bodyweight === true && bwSet.weight === 0,
  `logged as bodyweight with zero added load (${bwSet.weight})`);
ok($('.set-row input[data-f="weight"]').value === '0',
  'and the added-load box shows 0, so it is obvious you can put a number in it');
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
ok($('[data-tf="target"][data-tp="m"]') !== null, 'the target editor opened, with split boxes');
ok($('[data-tf="target"][data-tp="h"]') === null, 'and no hours box on a rest period');
$('[data-tf="target"][data-tp="m"]').value = '3';
$('[data-tf="target"][data-tp="s"]').value = '15';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(80);
ok(store.state.timer.target === 195, `target set precisely to 3:15 (${store.state.timer.target}s)`);
await click('#restBar [data-action="rest-stop"]', 'Stop');
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('timing a hold instead of guessing the seconds afterwards');
await xi.importFromText(JSON.stringify({
  name: 'Hold Day',
  entries: [
    { name: 'Front Plank', measure: 'time', sets: 3, reps: '45', rest: '1:00' },
    { name: 'Biceps Curl', sets: 2, reps: 10, weight: 20 },
  ],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const hbR = store.state.routines.find((r) => r.name === 'Hold Day');
await click(`[data-action="routine-start"][data-id="${hbR.id}"]`, 'Start');
const hbPlank = () => store.state.active.entries[0];
ok(/Front Plank/.test(view()), 'the plank is the first exercise');
ok($('.confirm[data-action="hold-start"]') !== null, 'a timed exercise offers to start the clock');
ok(/Start set 1/.test($('.confirm[data-action="hold-start"]').textContent),
  `the big button names the set (${$('.confirm[data-action="hold-start"] .big').textContent.trim()})`);
ok(/planned 45s/.test($('.confirm[data-action="hold-start"]').textContent),
  `and states the planned hold (${$('.confirm[data-action="hold-start"] .sub').textContent.trim()})`);
ok($$('.set-row .rest-btn.hold').length === 3,
  `every timed row has its own hold button too (${$$('.set-row .rest-btn.hold').length})`);
ok($('.set-row input[data-f="reps"]') !== null,
  'and the seconds box is still there — timing it is an offer, not the only way');

section('the hold bar counts up while holding');
await click('.confirm[data-action="hold-start"]', 'Start set 1');
ok(!$('#restBar').hidden, 'the bar is up');
ok(store.state.timer.kind === 'hold', `and it knows it is a hold (${store.state.timer.kind})`);
ok(/Holding/.test($('#restBar').textContent), `the bar says what is happening (${$('#restBar .t1').textContent.trim()})`);
ok(/Front Plank set 1/.test($('#restBar').textContent), 'naming the set being held');
ok($('#restBar .clock').classList.contains('hold'),
  'the clock is styled as a hold, not a countdown');
ok($('#restBar [data-action="hold-stop"]') !== null, 'stopping is the primary action');
ok($('#restBar [data-action="rest-nudge"]') === null,
  'and there is nothing to nudge — a hold has no target to extend');
ok($('[data-action="hold-stop"].confirm') !== null, 'the card button flipped to Stop as well');

section('stopping writes the measured seconds into the set and logs it');
store.state.timer.startedAt -= 52_000;
await click('#restBar [data-action="hold-stop"]', 'Stop the hold');
await sleep(60);
ok($('#restBar').hidden, 'the bar is gone');
ok(hbPlank().sets[0].reps === 52,
  `the set holds what the clock saw, not the planned 45 (${hbPlank().sets[0].reps})`);
ok(hbPlank().sets[0].done === true, 'and the set is logged in the same gesture');
ok(hbPlank().sets[0].rest == null, 'the time counted as work, not as rest');
ok(/Start set 2/.test(view()), 'the card has moved on to set 2');

section('a per-row hold button times a row that is not the active one');
$$('.set-row')[2].querySelector('.rest-btn.hold')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(70);
ok(store.state.timer && store.state.timer.kind === 'hold', 'a hold started from the row');
ok(store.state.timer.setId === hbPlank().sets[2].id, 'for row 3 specifically');
store.state.timer.startedAt -= 61_000;
await click('#restBar [data-action="hold-stop"]', 'Stop');
await sleep(60);
ok(hbPlank().sets[2].reps === 61, `row 3 got its 61s (${hbPlank().sets[2].reps})`);

section('with the effort gate on, stopping a hold asks for effort before logging');
await store.updateSettings({ requireEffort: true, effortScale: 'rpe' });
await sleep(40);
await click('.confirm[data-action="hold-start"]', 'Start set 2');
ok(store.state.timer !== null && store.state.timer.kind === 'hold', 'the hold started');
store.state.timer.startedAt -= 40_000;
await click('#restBar [data-action="hold-stop"]', 'Stop');
await sleep(80);
ok(hbPlank().sets[1].reps === 40, `the time is saved first (${hbPlank().sets[1].reps}s)`);
ok(hbPlank().sets[1].done === false, 'but the set is not logged yet');
ok(!$('#modalRoot').hidden, 'a prompt opened instead of silently dropping the set');
ok(/Held 0:40/.test($('#modalRoot').textContent),
  `the prompt states what was held (${($('#modalRoot .modal-title') || $('#modalRoot')).textContent.trim().slice(0, 40)})`);
ok(/already saved/.test($('#modalRoot').textContent),
  'and reassures that the time is not at risk');
const hbChip = $$('#modalRoot [data-hold-field="rpe"]').find((b) => b.textContent.trim() === '8');
ok(!!hbChip, `RPE chips are offered (${$$('#modalRoot [data-hold-field="rpe"]').length})`);
ok($('#modalRoot [data-hold-field="unknown"]') !== null, "and an honest \"I don't know\"");
hbChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(90);
ok(hbPlank().sets[1].rpe === 8, `the effort landed (RPE ${hbPlank().sets[1].rpe})`);
ok(hbPlank().sets[1].done === true, 'and answering logged the set');
ok($('#modalRoot').hidden, 'the prompt closed itself');

section('a reps exercise is never offered a hold');
await click('[data-action="now-next"]', 'next exercise');
await sleep(60);
ok(/Biceps Curl/.test(view()), 'now on the curl');
ok($('.confirm[data-action="hold-start"]') === null, 'no hold button on a reps exercise');
ok($('.set-row .rest-btn.hold') === null, 'and none on its rows either');
ok($('.set-row .rest-btn') !== null, 'but the ordinary rest timer is still there');

await store.updateSettings({ requireEffort: false });
await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('Either / Or: swapping a slot from the card');
await xi.importFromText(JSON.stringify({
  name: 'Machine Roulette',
  entries: [
    { name: 'Leg Press', alternatives: 'Hack Squat, Back Squat', sets: 3, reps: 10, weight: 100 },
  ],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const eoR = store.state.routines.find((r) => r.name === 'Machine Roulette');
await click(`[data-action="routine-start"][data-id="${eoR.id}"]`, 'Start');
const eoE = () => store.state.active.entries[0];
ok(/Leg Press/.test(view()), 'the slot opens as the leg press');
ok($$('.altrow [data-action="entry-swap"]').length === 2,
  `both alternatives are offered on the card (${$$('.altrow [data-action="entry-swap"]').length})`);
ok(/machine taken/.test($('.altrow').textContent),
  `with the reason it exists said in place (${$('.altrow .dim').textContent.trim()})`);
const eoHack = $$('.altrow [data-action="entry-swap"]').find((b) => b.textContent.trim() === 'Hack Squat');
ok(!!eoHack, 'the hack squat is one tap away');

eoHack.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
ok(eoE().name === 'Hack Squat', 'tapping it swaps the slot');
ok(/Hack Squat/.test($('.ex-name').textContent), 'and the card says so');
ok($$('.set-row').length === 3, 'the routine still asks for 3 sets');
const eoBack = $$('.altrow [data-action="entry-swap"]').map((b) => b.textContent.trim());
ok(eoBack.includes('Leg Press'), `the leg press is now the swap back (${eoBack.join(', ')})`);
ok(!eoBack.includes('Hack Squat'), 'and the exercise in the slot is not offered to itself');

section('the swap row goes away once the question is settled');
await type('.set-row input[data-f="weight"]', '70');
await type('.set-row input[data-f="reps"]', '9');
await click('.set-row [data-action="set-done"]', 'tick set 1');
await sleep(80);
ok(eoE().sets[0].done === true, 'set 1 is logged');
ok($('.altrow') === null, 'the swap options are gone — there is work logged under this name now');
await click('[data-action="entry-menu"]', 'exercise options');
ok($('#modalRoot [data-action="entry-swap"]') === null,
  'and the menu does not offer a swap either');
await click('#modalRoot [data-mclose]', 'Close');
await sleep(50);

await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('drop sets: the hand-off from the parent set is the whole feature');
await xi.importFromText(JSON.stringify({
  name: 'Drop Day',
  entries: [{ name: 'Lat Pulldown', sets: '60x10, 60x10 > 45x8', rest: '1:30' }],
}));
await sleep(60);
await click('#tabBar .tab[data-tab="now"]');
const drR = store.state.routines.find((r) => r.name === 'Drop Day');
await click(`[data-action="routine-start"][data-id="${drR.id}"]`, 'Start');
const drE = () => store.state.active.entries[0];
ok($$('.set-row').length === 3, `three rows: two sets and a drop (${$$('.set-row').length})`);
ok($$('.set-row')[2].classList.contains('drop'), 'the third row is marked as a drop');
ok(!$$('.set-row')[1].classList.contains('drop'), 'and the second is not');
ok($$('.set-row')[2].querySelector('.idx').textContent.trim() === '2\u2193',
  `the drop row is labelled as a drop of set 2 (${$$('.set-row')[2].querySelector('.idx').textContent.trim()})`);

section('set 1 behaves normally: it has a rest after it');
ok(/logs it and starts rest/.test($('.confirm[data-action="set-confirm"]').textContent),
  `set 1 promises a rest (${$('.confirm[data-action="set-confirm"] .sub').textContent.trim()})`);
await click('.confirm[data-action="set-confirm"]', 'confirm set 1');
await sleep(70);
ok(store.state.timer && store.state.timer.kind === 'rest', 'and a rest clock starts');
await click('#restBar [data-action="rest-stop"]', 'Stop');
await sleep(60);

section('the set BEFORE a drop says so before you tap it');
const drSub = $('.confirm[data-action="set-confirm"] .sub').textContent;
ok(/DROP/.test(drSub), `the button announces the drop (${drSub.trim()})`);
ok(/no rest/.test(drSub), 'and that there is no rest');
ok(/45/.test(drSub), 'naming the weight to strip to, so you know before you start');
ok($('.confirm[data-action="set-confirm"]').classList.contains('todrop'),
  'and it is styled differently from an ordinary confirm');

section('confirming it raises the drop prompt instead of a rest countdown');
await click('.confirm[data-action="set-confirm"]', 'confirm set 2');
await sleep(80);
ok(drE().sets[1].done === true, 'set 2 is logged');
ok(store.state.timer && store.state.timer.kind === 'drop',
  `the clock is a drop prompt, not a rest (${store.state.timer?.kind})`);
ok(!$('#restBar').hidden, 'the bar is up — silence would look like a bug');
ok(/Drop now/.test($('#restBar').textContent),
  `saying the one thing that matters (${$('#restBar .t1').textContent.trim()})`);
ok(/no rest/.test($('#restBar').textContent), 'and that there is no rest');
ok(/Strip to/.test($('#restBar [data-action="drop-go"]').textContent),
  `the action names the load to strip to (${$('#restBar [data-action="drop-go"]').textContent.trim()})`);
ok($('#restBar [data-action="rest-nudge"]') === null,
  'with nothing to nudge: there is no rest period to extend');
ok($('#restBar .clock').classList.contains('drop'), 'the clock is styled as a drop');

section('acknowledging the prompt records no rest and gets out of the way');
store.state.timer.startedAt -= 7_000;
await click('#restBar [data-action="drop-go"]', 'Strip to 45kg');
await sleep(70);
ok($('#restBar').hidden, 'the prompt is gone');
ok(drE().sets[2].rest == null, 'and no rest was written against the drop row');
ok(drE().sets[1].rest == null, 'nor against the set it dropped from');

section('the drop row is the active set, and says it is a drop');
const drActive = $('.confirm[data-action="set-confirm"] .sub').textContent;
ok(/drop 2\u2193/.test(drActive), `the confirm names the drop stage (${drActive.trim()})`);
ok(/logs it, then rest/.test(drActive),
  'and that a rest follows the last stage, said once rather than twice');
ok($('.confirm[data-action="set-confirm"]').classList.contains('isdrop'), 'styled as a drop');

section('a drop logs without an RPE even with the effort gate on');
await store.updateSettings({ requireEffort: true, effortScale: 'rpe' });
await sleep(40);
ok(/drop 2\u2193/.test($('.confirm[data-action="set-confirm"] .sub').textContent),
  'the gate does not block the drop — mid-drop there is no time to tap a chip');
await click('.confirm[data-action="set-confirm"]', 'confirm the drop');
await sleep(80);
ok(drE().sets[2].done === true, 'the drop is logged');
ok(drE().sets[2].rpe === null, 'with no effort answer invented for it');
await store.updateSettings({ requireEffort: false });
await sleep(40);

section('a drop can be added mid-workout, one tap');
ok($('[data-action="set-add-drop"]') !== null, 'the button is on the card');
const drBefore = drE().sets.length;
await click('[data-action="set-add-drop"]', '+ Drop set');
await sleep(70);
ok(drE().sets.length === drBefore + 1, 'a row was added');
const drNew = drE().sets[drE().sets.length - 1];
ok(drNew.drop === true, 'as a drop');
ok(drNew.weight === 35,
  `at 20% off the 45 it drops from, rounded to the weight step (${drNew.weight})`);

section('and the drop can be declined, which puts the rest back');
await type('.set-row.drop:last-of-type input[data-f="reps"]', '5');
await click('#tabBar .tab[data-tab="now"]');
await sleep(40);
await store.updateSet(drE().id, drE().sets[2].id, { done: false });
await sleep(40);
const drSkipTarget = drE().sets[3];
await clock.startDropNow(drE().id, drSkipTarget.id);
await sleep(50);
ok($('#restBar [data-action="drop-skip"]') !== null, 'declining is offered on the bar');
await click('#restBar [data-action="drop-skip"]', 'Skip the drop');
await sleep(90);
ok(!drE().sets.some((s) => s.id === drSkipTarget.id), 'the drop row is removed');
ok(store.state.timer && store.state.timer.kind === 'rest',
  `and the rest that was skipped for it starts instead (${store.state.timer?.kind})`);
await click('#restBar [data-action="rest-stop"]', 'Stop');

await click('#tabBar .tab[data-tab="session"]');
await click('[data-action="sess-discard"]', 'Discard');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(90);

section('the exercise library: described once, used everywhere');
await click('#tabBar .tab[data-tab="routines"]');
ok(/Exercise library/.test(view()), 'the Routines tab offers the library');
await click('#tabBar .tab[data-tab="library"]', 'Library tab');
await sleep(60);
ok(store.state.tab === 'library', 'the library is its own tab');
ok(/Browse all/.test(view()), 'the library screen opened, offering the catalogue');
ok(/In your library/.test(view()), 'and your own side of it');
ok($('[data-action="lib-new"]') !== null, 'a new exercise can be described');
ok(/NOT IN THE LIBRARY YET/.test(view()),
  'and it names the exercises it has seen but has no record for');
ok($('[data-action="lib-seed"]') !== null, 'with one tap to add them all');

await click('[data-action="lib-seed"]', 'Add the missing');
await sleep(120);
ok(store.state.exercises.length > 0, `seeding filled the library (${store.state.exercises.length})`);
ok(!/NOT IN THE LIBRARY YET/.test(view()), 'and the warning is gone');
const lbPlank = store.state.exercises.find((x) => x.key === 'plank' || x.key === 'front plank');
ok(!lbPlank || lbPlank.measure === 'time',
  'a plank came through as timed, because the old data already knew that');
ok(store.state.exercises.every((x) => x.primary === null),
  'but nothing was given a muscle group — guessing one from a name would poison every trend');
ok(/no volume group/.test(view()), 'and each row says so, so it is obvious what is missing');

section('describing an exercise is a form, and it reaches Trends');
await click('[data-action="lib-new"]', '+ New exercise');
await sleep(60);
ok($('#modalRoot select[name="measure"]') !== null, 'measure is asked for');
ok($('#modalRoot select[name="bodyweight"]') !== null, 'where the load comes from, separately');
ok($('#modalRoot select[name="unilateral"]') !== null, 'and whether it is one side at a time');
ok($('#modalRoot input[name="primary"]') !== null, 'with a volume group');
ok($('#modalRoot input[name="secondary"]') !== null, 'and other muscles');
ok(/independent/.test($('#modalRoot').textContent),
  'the form explains that timed and bodyweight are separate questions');
await type('#modalRoot input[name="name"]', 'Cable Fly');
await type('#modalRoot input[name="primary"]', 'pecs');
await type('#modalRoot input[name="secondary"]', 'shoulders');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(110);
const lbFly = store.state.exercises.find((x) => x.key === 'cable fly');
ok(!!lbFly, 'the exercise was added');
ok(lbFly.primary === 'Chest', `"pecs" was understood as Chest (${lbFly?.primary})`);
ok(lbFly.secondary.join() === 'Shoulders', 'and the other muscle normalised too');

section('the library exports and imports as JSON');
ok($('[data-action="lib-export"]') !== null, 'export is offered');
ok($('[data-action="lib-import"]') !== null, 'and import');
await click('[data-action="lib-import"]', 'Import JSON');
await sleep(60);
ok($('#modalRoot select[name="mode"]') !== null, 'the merge mode is asked, not guessed');
ok(/never change what I have/.test($('#modalRoot').textContent), 'with the safe option first');
await type('#modalRoot textarea[name="json"]',
  '{"exercises":[{"name":"Cable Fly","secondary":["Biceps"]},{"name":"Zercher Squat","primary":"Quads"}]}');
$('#modalRoot select[name="mode"]').value = 'update';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(140);
ok(store.state.exercises.find((x) => x.key === 'zercher squat')?.primary === 'Quads',
  'the new exercise arrived');
const lbFly2 = store.state.exercises.find((x) => x.key === 'cable fly');
ok(lbFly2.secondary.join() === 'Biceps', 'the mentioned field was updated');
ok(lbFly2.primary === 'Chest',
  'and the volume group the file never mentioned was left alone');

section('unilateral exercises log left and right separately');
await xi.importFromText(JSON.stringify({
  schema: 'workout-tracker/exercise-library@1',
  exercises: [{ name: 'Split Squat', unilateral: true, primary: 'Quads', secondary: ['Glutes'] }],
}));
await sleep(80);
ok(store.state.exercises.find((x) => x.key === 'split squat')?.unilateral === true,
  'a library file can declare it');
await xi.importFromText(JSON.stringify({
  name: 'Uni Day', entries: [{ name: 'Split Squat', sets: 2, reps: 10, weight: 20 }],
}));
await sleep(80);
await click('#tabBar .tab[data-tab="now"]');
const uR = store.state.routines.find((r) => r.name === 'Uni Day');
await click(`[data-action="routine-start"][data-id="${uR.id}"]`, 'Start');
await sleep(60);
const uE = () => store.state.active.entries[0];
ok(uE().unilateral === true,
  'the routine never said so — the library did, and the session picked it up');
ok($$('.set-row').length === 4, `2 planned sets opened 4 rows (${$$('.set-row').length})`);
const uLabels = $$('.set-row').map((r) => r.querySelector('.idx').textContent.trim());
ok(uLabels.join(',') === '1L,1R,2L,2R', `labelled per side (${uLabels.join(',')})`);
ok($$('.set-row')[1].classList.contains('sideR'), 'the right-side rows are marked');

section('no rest between the two sides; the rest comes after the second');
ok(/then the right side/.test($('.confirm[data-action="set-confirm"] .sub').textContent),
  `the first side says what follows (${$('.confirm[data-action="set-confirm"] .sub').textContent.trim()})`);
ok(/no rest yet/.test($('.confirm[data-action="set-confirm"] .sub').textContent),
  'and that no rest starts yet');
await click('.confirm[data-action="set-confirm"]', 'confirm the left side');
await sleep(80);
ok(uE().sets[0].done === true, 'the left side is logged');
ok(store.state.timer === null, 'and NO clock started — left and right are one set of work');
ok(/right/.test($('.confirm[data-action="set-confirm"] .big').textContent),
  `the card moved to the right side (${$('.confirm[data-action="set-confirm"] .big').textContent.trim()})`);
ok(/logs it and starts rest/.test($('.confirm[data-action="set-confirm"] .sub').textContent),
  'which now promises the rest');
await click('.confirm[data-action="set-confirm"]', 'confirm the right side');
await sleep(80);
ok(store.state.timer !== null && store.state.timer.kind === 'rest',
  'confirming the second side starts the rest');
await click('#restBar [data-action="rest-stop"]', 'Stop');
await sleep(60);

section('per-muscle trends appear once exercises are tagged');
for (const s of uE().sets) await store.updateSet(uE().id, s.id, { weight: 20, reps: 10, done: true });
await store.finishSession();
await sleep(80);
await click('#tabBar .tab[data-tab="trends"]');
await sleep(80);
ok(/Muscle groups/.test(view()), 'Trends has a muscle-group section');
ok(/Quads/.test(view()), 'the tagged group shows up');
ok($$('.grp-row').length > 0, `with a row per group (${$$('.grp-row').length})`);
ok(/Direct/.test(view()) && /Indirect/.test(view()),
  'direct and indirect are separate columns');
ok(/never added together/.test(view()),
  'and it says they are not blended, because any single number would need an invented weighting');
const trQuads = $$('.grp-row').find((r) => /Quads/.test(r.textContent));
ok(!!trQuads, 'Quads is listed');
trQuads.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
ok(!$('#modalRoot').hidden, 'tapping a group opens its detail');
ok(/Split Squat/.test($('#modalRoot').textContent),
  'naming the exercises that produced the sets');
await click('#modalRoot [data-mclose]', 'Close');
await sleep(50);

section('the catalogue is browsable from its own tab, without typing');
await click('#tabBar .tab[data-tab="library"]', 'Library tab');
await sleep(60);
await click('[data-action="lib-mode"][data-mode="browse"]', 'Browse all');
await sleep(80);
ok(/Browse all/.test(view()), 'browse mode opened');
ok($$('[data-action="lib-cat"]').length > 8,
  `a filter chip per kind, so it can be browsed with taps (${$$('[data-action="lib-cat"]').length})`);
ok($$('.exrow.built').length > 20, `catalogue rows are listed (${$$('.exrow.built').length})`);
const lcIso = $$('[data-action="lib-cat"]').find((b) => /Isometric/.test(b.textContent));
ok(!!lcIso, 'Isometric is one of the kinds');
lcIso.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
ok(store.state.nav.libCat === 'isometric', 'tapping it filters to that kind');
ok($$('.exrow.built').length > 10, 'and shows them');
ok(/isometric/.test($('.exrow.built').textContent),
  'with the kind marked on every row');
ok(/bodyweight|external weight/.test($('.exrow.built').textContent),
  'and where the load comes from');

const lcRun = $$('[data-action="lib-cat"]').find((b) => /Running/.test(b.textContent));
ok(!!lcRun, 'Running is one of the kinds');
lcRun.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(80);
ok($$('.exrow.built').length > 10, 'running has its own list');
ok(/cardio/.test($('.exrow.built').textContent), 'marked as cardio rather than as a weight');
const lcCardio = $$('[data-action="lib-cat"]').find((b) => /Cardio/.test(b.textContent));
ok(!!lcCardio, 'and Cardio is a kind of its own, beside Running');

section('adding from the catalogue is one tap, and then it is yours to edit');
await click('[data-action="lib-cat"][data-cat=""]', 'All');
await sleep(60);
await type('#libSearch', 'turkish');
await sleep(80);
const lcAdd = $('[data-action="lib-add"]');
ok(!!lcAdd, 'the search found it with an add affordance');
const lcBefore = store.state.exercises.length;
lcAdd.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
await sleep(100);
ok(store.state.exercises.length === lcBefore + 1, 'tapping it added one exercise');
const lcTgu = store.state.exercises.find((x) => x.key === 'turkish get-up');
ok(!!lcTgu, 'the right one');
ok(lcTgu.unilateral === true && lcTgu.primary === 'Core',
  'with its attributes, so nothing had to be typed');
await sleep(40);
ok($('[data-action="lib-add"][data-key="turkish get-up"]') === null
  && $('[data-action="lib-edit"][data-key="turkish get-up"]') !== null,
  'and the row now opens for editing instead of offering to add it again');

section('your own exercises look different from the ones the app shipped');
await click('[data-action="lib-mode"][data-mode="mine"]', 'Mine');
await sleep(80);
await click('[data-action="lib-new"]', '+ New exercise');
await sleep(60);
await type('#modalRoot input[name="name"]', 'Prakarsh Special Raise');
await type('#modalRoot input[name="primary"]', 'Shoulders');
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(120);
const lcMineRow = $$('.exrow').find((r) => /Prakarsh Special Raise/.test(r.textContent));
ok(!!lcMineRow, 'the invented exercise is listed');
ok(lcMineRow.classList.contains('mine'),
  'and styled as yours, because nobody has checked it and it is the one that will look wrong');
ok(/yours/.test(lcMineRow.textContent), 'with an explicit tag saying so');
const lcBuiltRow = $$('.exrow').find((r) => /Turkish Get-up/.test(r.textContent));
ok(!!lcBuiltRow && !lcBuiltRow.classList.contains('mine'),
  'while an adopted catalogue exercise is not marked as yours');
ok(!/yours/.test(lcBuiltRow.textContent), 'and carries no "yours" tag');
ok(/Power/.test(lcBuiltRow.textContent),
  `but does carry the kind the catalogue gave it (${lcBuiltRow.querySelector('.nm').textContent.trim()})`);

section('adding an exercise to a routine can pick from the catalogue');
await click('#tabBar .tab[data-tab="routines"]');
await sleep(60);
const lcR = store.state.routines[0];
await click(`[data-action="routine-open"][data-id="${lcR.id}"]`, 'open a routine');
await sleep(60);
await click('[data-action="rentry-add"]', '+ Add exercise');
await sleep(80);
ok($('#exSearch') !== null, 'the picker opened with one search box');
ok(/catalogue/.test($('#modalRoot').textContent), 'and says the catalogue is searchable too');
$('#exSearch').value = 'zercher';
$('#exSearch').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(60);
ok($('#exCat [data-action="ex-catalog"]') !== null,
  'a catalogue match is offered when adding to a routine');
ok(/FROM THE CATALOGUE/.test($('#modalRoot').textContent),
  'under a heading that separates it from your own');
await click('#exCat [data-action="ex-catalog"]', 'Zercher Squat');
await sleep(90);
ok($('#modalRoot input[name="name"]')?.value === 'Zercher Squat',
  `the form opened prefilled with the catalogue name (${$('#modalRoot input[name="name"]')?.value})`);
ok($('#modalRoot input[name="primary"]')?.value === 'Quads',
  'and its volume group, so nothing has to be retyped');
ok($('#modalRoot select[name="measure"]')?.value === 'reps', 'and how it is measured');
await click('#modalRoot [data-mclose]', 'Cancel');
await sleep(60);
store.state.nav = {};

console.log(`\n${failures === 0 ? 'ALL DOM CHECKS PASSED' : `${failures} DOM CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
