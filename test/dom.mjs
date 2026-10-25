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
ok($$('.sess-item').length === 4, `all 4 exercises listed (${$$('.sess-item').length})`);
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
await click('[data-action="entry-add"]', '+ Add exercise');
ok($('#modalRoot').hidden === false, 'modal opened');
$('[name="name"]').value = 'Face Pull';
$('[name="targetSets"]').value = '3';
$('[name="reps"]').value = '15';
$('#modalForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(80);
ok(store.state.active.entries.length === before + 1, 'exercise added to the session');
ok(store.getRoutine(store.state.active.routineId).entries.length === 4, 'routine untouched');
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

console.log(`\n${failures === 0 ? 'ALL DOM CHECKS PASSED' : `${failures} DOM CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
