// Shared renderer for one exercise (used by the Now view, the Session view and
// the read-only History view) plus the actions that belong to it.
import {
  state, findEntry, addSet, deleteSet, updateSet, toggleSetDone, toggleSkip,
  removeSessionEntry, moveEntryNext, moveSessionEntry, updateSessionEntry, startRest, entryStatus,
  addSessionEntry, working, editingPast, plannedSet, fillPlannedSets,
  setLabels, workingSets, toggleWarmup, toggleBodyweight, activeSet, setRestFor, undoSet,
  setIsLoggable, setBlocker, setEffort, startRestForSet, stopRest, startHold,
} from '../store.js';
import { findInLibrary, lastLogFor, recentWeights } from '../queries.js';
import { esc, fmtNum, fmtReps, fmtClock, num, parseDur, relDay, normName } from '../util.js';
import { readTimeDom } from '../timefield.js';
import { updateLog } from '../cardiostore.js';
import {
  measureOf, fmtAmount, fmtAmountRange, parseAmount, amountFieldValue,
} from '../measure.js';
import { targetLine, logSummary, restLine, loadLabel } from '../format.js';
import { cardioBody, cardioStatic, handleLegInput } from './cardio.js';
import {
  exerciseFormHtml, readExerciseForm, wireExerciseForm, openExercisePicker, openExerciseForm,
} from './exform.js';
import { openModal, closeModal, confirmDialog, toast } from '../ui.js';
import { unlockAudio } from '../timer.js';

/* ------------------------------------------------------------------ */
/* summaries                                                          */
/* ------------------------------------------------------------------ */

function lastRefHtml(e) {
  const hit = lastLogFor(e.name, working()?.id);
  if (!hit) return '<div class="lastref dim">No previous log for this exercise.</div>';
  const sum = logSummary(hit.entry, { workingOnly: true });
  if (!sum) return '';
  return `<div class="lastref">Last (${esc(relDay(hit.session.startedAt))}): <b>${esc(sum)}</b></div>`;
}

/**
 * Per-set rest, with every entry tappable so a rest that was never started,
 * stopped late, or started by a mis-tap can be corrected -- now or days later.
 */
function restEditLine(e) {
  const sets = e.sets || [];
  const labels = setLabels(sets);
  const shown = sets
    .map((s, i) => ({ s, label: labels[i] }))
    .filter(({ s }) => s.done || s.weight !== null || s.reps !== null);
  if (!shown.length) return '';
  return `
    <div class="restedit">
      <span class="tiny">Rest</span>
      ${shown.map(({ s, label }) => `
        <button type="button" class="chip ${s.rest ? '' : 'none'}" data-action="set-rest-edit"
                data-entry="${e.id}" data-set="${s.id}"
                title="Edit the rest recorded after set ${esc(label)}">
          ${esc(label)}) ${s.rest ? esc(fmtClock(s.rest)) : 'not logged'}
        </button>`).join('')}
    </div>`;
}

/**
 * renderEntry(entry, { showLast, allowRest })
 * The editable card. allowRest is false when correcting a finished session,
 * where starting a rest timer makes no sense.
 */
export function renderEntry(e, { showLast = true, allowRest = true } = {}) {
  const st = entryStatus(e);
  const pill = st === 'done' ? '<span class="pill ok">done</span>'
    : st === 'skipped' ? '<span class="pill skip">skipped</span>'
      : st === 'partial' ? '<span class="pill live">in progress</span>' : '';
  return `
  <div class="card" data-entry="${e.id}" style="${e.skipped ? 'opacity:.55' : ''}">
    <div class="ex-head">
      <div style="flex:1;min-width:0">
        <div class="ex-name">${esc(e.name)}${e.repTotal ? ` <span class="dim">${e.repIndex}/${e.repTotal}</span>` : ''}
          ${e.group ? `<span class="pill grp">${esc(e.group)}</span>` : ''} ${pill}</div>
        ${targetLine(e) ? `<div class="ex-target">${esc(targetLine(e))}</div>` : ''}
        ${e.notes ? `<div class="ex-notes">${esc(e.notes)}</div>` : ''}
      </div>
      <button type="button" class="btn icon ghost" title="Exercise options"
              data-action="entry-menu" data-entry="${e.id}">⋯</button>
    </div>
    ${showLast ? lastRefHtml(e) : ''}
    ${e.type === 'lift' ? liftBody(e, allowRest) : cardioBody(e, allowRest)}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* editable card                                                      */
/* ------------------------------------------------------------------ */

const showRpe = () => state.settings.effortScale !== 'rir';
const showRir = () => state.settings.effortScale === 'rir' || state.settings.effortScale === 'both';

/** Grid template must match the number of effort columns on show. */
function rowClass() {
  const n = (showRpe() ? 1 : 0) + (showRir() ? 1 : 0);
  return n === 2 ? 'cols-2eff' : 'cols-1eff';
}

function setRow(e, s, label, workingIdx, allowRest) {
  const t = state.timer;
  const running = !!(t && t.kind !== 'hold' && t.entryId === e.id && t.setId === s.id);
  const holding = !!(t && t.kind === 'hold' && t.entryId === e.id && t.setId === s.id);
  const unit = s.unit || e.unit || state.settings.unit;
  const plan = s.warmup ? null : plannedSet(e, workingIdx);
  const wPh = s.bodyweight ? 'BW'
    : (plan && plan.weight !== null && plan.weight !== undefined ? fmtNum(plan.weight) : esc(unit));
  const m = measureOf(e);
  const planned = plan ? fmtAmountRange(plan.repsMin, plan.repsMax, m.key) : '';
  const rPh = planned || m.placeholder;
  return `
    <div class="set-row ${rowClass()} ${s.done ? 'done' : ''} ${s.warmup ? 'warm' : ''}"
         data-entry="${e.id}" data-set="${s.id}">
      <button type="button" class="idx" data-action="set-warmup" data-entry="${e.id}" data-set="${s.id}"
              title="${s.warmup ? 'Make this a working set' : 'Mark as a warmup set'}"
              aria-label="Set ${esc(label)}, tap to toggle warmup">${esc(label)}</button>
      <input inputmode="decimal" enterkeyhint="next" data-f="weight" placeholder="${wPh}"
             value="${esc(fmtNum(s.weight))}" aria-label="Weight set ${esc(label)}">
      <input inputmode="${m.inputmode}" enterkeyhint="next" data-f="reps" placeholder="${esc(rPh)}"
             value="${esc(amountFieldValue(s.reps, m.key))}"
             aria-label="${esc(m.label)} set ${esc(label)}">
      ${showRpe() ? `<input inputmode="decimal" enterkeyhint="next" data-f="rpe" placeholder="1-10"
             value="${esc(fmtNum(s.rpe))}" aria-label="RPE set ${esc(label)}">` : ''}
      ${showRir() ? `<input inputmode="decimal" enterkeyhint="done" data-f="rir" placeholder="0-5"
             value="${esc(fmtNum(s.rir))}" aria-label="Reps in reserve, set ${esc(label)}">` : ''}
      <button type="button" class="chk ${s.done ? 'on' : ''}"
              title="${s.done ? 'Un-tick this set' : 'Tick without starting rest'}"
              data-action="set-done" data-entry="${e.id}" data-set="${s.id}">✓</button>
      ${allowRest && m.key === 'time' ? (holding
    ? `<button type="button" class="rest-btn hold running" title="Stop the hold and log the time"
              data-action="hold-stop" data-entry="${e.id}" data-set="${s.id}">■</button>`
    : `<button type="button" class="rest-btn hold" title="Time this hold"
              data-action="hold-start" data-entry="${e.id}" data-set="${s.id}">⧗</button>`)
    : allowRest ? `<button type="button" class="rest-btn ${running ? 'running' : ''}"
              title="${running ? 'Stop resting and record the time' : 'Start resting after this set'}"
              data-action="set-rest-toggle" data-entry="${e.id}" data-set="${s.id}"
              >${running ? '■' : '⏱'}</button>` : '<div></div>'}
    </div>`;
}

/**
 * The one action that matters during a set: confirm what you just did. It ticks
 * the set and starts the rest clock in a single tap, because those are the same
 * moment. If the plan carries no weight it refuses and sends you to the field
 * instead -- a set with no load recorded is worse than one extra tap.
 */
function confirmBar(e, allowRest) {
  const s = activeSet(e);
  if (!s) {
    return `<div class="confirm done-all">All ${workingSets(e).length} sets done
      <span class="dim small">&mdash; tap a row to correct it</span></div>`;
  }
  const labels = setLabels(e.sets || []);
  const label = labels[(e.sets || []).indexOf(s)];
  const m = measureOf(e);
  const blocker = setBlocker(s, m.key);
  if (blocker === 'effort') {
    return `
      <button type="button" class="confirm needs" data-action="set-effort-then"
              data-entry="${e.id}" data-set="${s.id}">
        <span class="big">&#10003;&nbsp; ${esc(loadLabel(s))} &times; ${esc(fmtAmount(s.reps, m.key))}</span>
        <span class="sub">tap to log it &mdash; it will ask how hard set ${esc(label)} was</span>
      </button>`;
  }
  if (!setIsLoggable(s, m.key)) {
    // No numbers yet. Start the clock anyway: the rest is time-critical and the
    // weight is not -- it can be typed during the rest.
    return `
      <button type="button" class="confirm needs" data-action="set-rest-toggle"
              data-entry="${e.id}" data-set="${s.id}">
        <span class="big">&#9201;&nbsp; Start rest after set ${esc(label)}</span>
        <span class="sub">no ${s.reps === null ? esc(m.short) : 'weight'} yet &mdash; enter it while you rest</span>
      </button>`;
  }
  return `
    <button type="button" class="confirm" data-action="set-confirm" data-entry="${e.id}" data-set="${s.id}">
      <span class="big">&#10003;&nbsp; ${loadLabel(s) === '—' && m.key !== 'reps' ? '' : `${esc(loadLabel(s))} &times; `}${esc(fmtAmount(s.reps, m.key))}</span>
      <span class="sub">set ${esc(label)}${allowRest ? ' &mdash; logs it and starts rest' : ' &mdash; log it'}</span>
    </button>`;
}

/**
 * The +/- strip. It is hidden until a numeric field in this card is focused, and
 * acts on whatever is focused. Buttons cancel pointerdown so focus is not lost,
 * and they write through an input event so the normal silent-save path runs
 * without a re-render — which is what keeps the keyboard up.
 */
function stepBar(e) {
  const m = measureOf(e);
  const w = fmtNum(state.settings.weightStep);
  const recent = recentWeights(e.name);
  const active = activeSet(e);
  return `
    <div class="stepbar" data-stepbar="${e.id}" hidden>
      <div class="steprow">
        <button type="button" data-step="weight" data-delta="-${w}">&minus;${w}</button>
        <button type="button" data-step="weight" data-delta="${w}">+${w}</button>
        <button type="button" data-step="reps" data-delta="-${m.step}">&minus;${m.step}${esc(m.stepLabel)}</button>
        <button type="button" data-step="reps" data-delta="${m.step}">+${m.step}${esc(m.stepLabel)}</button>
      </div>
      <div class="steprow chips">
        <button type="button" class="chip bw" data-action="set-bw"
                data-entry="${e.id}" data-set="${active ? active.id : ''}"
                title="Log this set as bodyweight">BW</button>
        ${recent.map((v) => `<button type="button" class="chip" data-step="weight" data-set-to="${v}">${esc(fmtNum(v))}</button>`).join('')}
        ${recent.length ? '<span class="tiny dim" style="align-self:center">recent</span>' : ''}
      </div>
    </div>`;
}

/**
 * Column headers carry the UNIT, placeholders carry the FORMAT.
 *
 * A placeholder vanishes the moment a value is typed, so a unit shown only
 * there is a unit you cannot check while reading your own numbers back. The
 * header stays put, costs one 10px row per exercise rather than space in every
 * field, and is the only place that can honestly say "kg" when the field holds
 * "52.5".
 */
function setHeader(e) {
  const m = measureOf(e);
  const unit = e.unit || state.settings.unit;
  return `
      <div class="set-hdr ${rowClass()}">
        <div>Set</div>
        <div>${e.bodyweight ? `+${esc(unit)}` : esc(unit)}</div>
        <div>${esc(m.header)}</div>
        ${showRpe() ? '<div>RPE</div>' : ''}${showRir() ? '<div>RIR</div>' : ''}
        <div></div><div></div>
      </div>`;
}

/**
 * Effort as fat chips for the ACTIVE set, on the card itself.
 *
 * The rest panel has had these for a while, but that only helps if you are
 * resting. A set logged without starting the clock, or corrected afterwards,
 * had only the 48px numeric column -- so effort went unlogged. These are the
 * same chips, available whenever the card is.
 *
 * "?" is not a skip. It writes `effortUnknown`, which is an ANSWER: it keeps
 * "I did not judge this one" distinguishable from "I forgot", which a blank
 * cannot do.
 */
/**
 * Start the clock on a hold, rather than guessing the seconds afterwards.
 *
 * Only for a time-measured exercise, and only the active set -- a plank is
 * timed while it happens or not at all. Manual entry stays: the row's box is
 * still there, and stopping the clock just fills it in for you.
 */
function holdBar(e, allowRest) {
  if (measureOf(e).key !== 'time' || !allowRest) return '';
  const s = activeSet(e);
  if (!s) return '';
  const t = state.timer;
  const holding = !!(t && t.kind === 'hold' && t.setId === s.id);
  const labels = setLabels(e.sets || []);
  const label = labels[(e.sets || []).indexOf(s)];
  const planned = s.reps ? fmtAmount(s.reps, 'time') : null;
  return `
    ${holding
    ? `<button type="button" class="confirm holding" data-action="hold-stop"
               data-entry="${e.id}" data-set="${s.id}">
        <span class="big">\u25a0\u00a0 Stop the hold</span>
        <span class="sub">the time goes straight into the set</span>
      </button>`
    : `<button type="button" class="confirm" data-action="hold-start"
               data-entry="${e.id}" data-set="${s.id}">
        <span class="big">\u29d7\u00a0 Start set ${esc(label)}</span>
        <span class="sub">time it instead of guessing${planned ? ` \u2014 planned ${esc(planned)}` : ''}</span>
      </button>`}`;
}

function effortBar(e) {
  const s = activeSet(e);
  if (!s) return '';
  const scale = state.settings.effortScale;
  const need = state.settings.requireEffort && setBlocker(s, measureOf(e).key) === 'effort';
  const row = (field, label, values) => `
    <div class="effrow">
      <span class="tiny">${label}</span>
      ${values.map((n) => `<button type="button" class="chip ${s[field] === n ? 'on' : ''}"
        data-action="set-effort" data-entry="${e.id}" data-set="${s.id}"
        data-field="${field}" data-value="${n}">${n}</button>`).join('')}
    </div>`;
  return `
    <div class="effbar${need ? ' need' : ''}" data-effbar="${e.id}">
      ${scale !== 'rir' ? row('rpe', 'RPE', [6, 7, 8, 9, 10]) : ''}
      ${scale === 'rir' || scale === 'both' ? row('rir', 'RIR', [0, 1, 2, 3, 4]) : ''}
      <div class="effrow">
        <button type="button" class="chip ${s.effortUnknown ? 'on' : ''}"
                data-action="set-effort" data-entry="${e.id}" data-set="${s.id}"
                data-field="unknown" data-value="1"
                title="Record that you did not judge this set">don't know</button>
        ${need ? '<span class="tiny warnmsg">needed before this set can be logged</span>' : ''}
      </div>
    </div>`;
}

/**
 * Sets that have numbers in them but were never ticked, named on the card.
 *
 * The finish prompt already catches these, but by then the workout is over and
 * you are guessing. Saying it on the card, while the exercise is in front of
 * you, is the difference between remembering and reconstructing.
 */
function untickedHint(e) {
  const labels = setLabels(e.sets || []);
  const loose = (e.sets || [])
    .map((x, i) => ({ x, label: labels[i] }))
    .filter(({ x }) => !x.done && !x.warmup && (x.reps !== null || x.weight !== null));
  if (!loose.length) return '';
  const ready = loose.filter(({ x }) => setIsLoggable(x, measureOf(e).key));
  return `
    <div class="unticked">
      <span class="tiny">Set${loose.length === 1 ? '' : 's'} ${loose.map((l) => l.label).join(', ')}
        filled in but not logged</span>
      ${ready.length ? `<button type="button" class="chip warn" data-action="set-tick-loose"
        data-entry="${e.id}">Log ${ready.length === loose.length ? 'them' : `${ready.length}`}</button>`
    : '<span class="tiny dim">finish the row first</span>'}
    </div>`;
}

function liftBody(e, allowRest) {
  const sets = e.sets || [];
  const labels = setLabels(sets);
  let working = -1;
  const rows = sets.map((s, i) => {
    if (!s.warmup) working++;
    return setRow(e, s, labels[i], s.warmup ? -1 : working, allowRest);
  }).join('');
  const planned = e.setTargets ? e.setTargets.length : (e.targetSets ?? 0);
  const missing = Math.max(0, planned - workingSets(e).length);
  const rest = restLine(e);
  return `
    <div class="sets">
      ${setHeader(e)}
      ${rows || '<p class="hint" style="margin:2px 0 8px">No sets planned. Add one below.</p>'}
    </div>
    ${holdBar(e, allowRest)}
    ${stepBar(e)}
    ${effortBar(e)}
    ${confirmBar(e, allowRest)}
    ${untickedHint(e)}
    <div class="set-foot">
      <button type="button" class="btn sm ghost" data-action="set-add" data-entry="${e.id}">+ Extra set</button>
      <button type="button" class="btn sm ghost" data-action="set-add-warmup" data-entry="${e.id}">+ Warmup</button>
      ${missing > 0 ? `<button type="button" class="btn sm" data-action="set-fill" data-entry="${e.id}">+ ${missing} planned</button>` : ''}
      ${sets.length ? `<button type="button" class="btn sm ghost" data-action="set-del-last" data-entry="${e.id}">− Remove last</button>` : ''}
    </div>
    ${restEditLine(e)}`;
}

/** Read-only version for History. */
export function renderEntryStatic(e) {
  const sum = logSummary(e);
  const rest = restLine(e);
  return `
  <div class="card">
    <div class="ex-name">${esc(e.name)} ${e.group ? `<span class="pill grp">${esc(e.group)}</span>` : ''}
      ${e.skipped ? '<span class="pill skip">skipped</span>' : ''}</div>
    ${targetLine(e) ? `<div class="ex-target">target: ${esc(targetLine(e))}</div>` : ''}
    ${sum ? `<div class="loglines" style="margin-top:7px">${sum.split('  ').map((x) => `<code>${esc(x)}</code>`).join('')}</div>`
    : '<div class="loglines dim" style="margin-top:7px">nothing logged</div>'}
    ${cardioStatic(e)}
    ${rest ? `<div class="small dim" style="margin-top:5px">${esc(rest)}</div>` : ''}
    ${e.notes ? `<div class="ex-notes">${esc(e.notes)}</div>` : ''}
    ${e.type === 'cardio' && e.log?.note ? `<div class="small dim" style="margin-top:5px">${esc(e.log.note)}</div>` : ''}
  </div>`;
}


/* ------------------------------------------------------------------ */
/* actions                                                            */
/* ------------------------------------------------------------------ */

/**
 * Ask how hard a set was, then carry on with whatever was being done.
 *
 * Shown at the moment of ticking, because that is when you know the answer and
 * when you are being asked for it. Choosing any chip runs `then` -- so the tap
 * that was blocked completes itself rather than making you tap again.
 */
function askEffort(e, s, then) {
  const scale = state.settings.effortScale;
  const labels = setLabels(e.sets || []);
  const label = labels[(e.sets || []).indexOf(s)];
  const row = (field, name, values) => `
    <div class="effrow" style="margin-bottom:8px">
      <span class="tiny">${name}</span>
      ${values.map((n) => `<button type="button" class="chip big"
        data-eff-field="${field}" data-eff-value="${n}">${n}</button>`).join('')}
    </div>`;
  const modal = openModal({
    title: `How hard was set ${label}?`,
    bodyHtml: `
      ${scale !== 'rir' ? row('rpe', 'RPE', [6, 7, 8, 9, 10]) : ''}
      ${scale === 'rir' || scale === 'both' ? row('rir', 'RIR', [0, 1, 2, 3, 4]) : ''}
      <button type="button" class="btn block ghost" data-eff-field="unknown" data-eff-value="1">
        I don't know</button>
      <p class="hint">${scale === 'rir'
    ? 'RIR is how many more reps you could have done.'
    : 'RPE 10 is all-out; 8 is about two reps left.'}
        <b>I don't know</b> is a real answer &mdash; it keeps "did not judge this one" apart from
        "forgot", which a blank cannot do. Turn this prompt off in Settings.</p>`,
    cancelText: 'Not yet',
  });
  modal.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-eff-field]');
    if (!btn) return;
    const field = btn.dataset.effField;
    const value = Number(btn.dataset.effValue);
    await setEffort(e.id, s.id, field === 'unknown' ? { unknown: true } : { [field]: value });
    closeModal();
    await then();
  });
}

function restLabelFor(e, setIdx) {
  return setIdx === null ? `Rest — ${e.name}` : `Rest after ${e.name} set ${setIdx + 1}`;
}

export const entryActions = {
  'set-add': async ({ entry }) => { await addSet(entry); },

  'set-add-warmup': async ({ entry }) => { await addSet(entry, { warmup: true }); },

  'set-warmup': async ({ entry, set }) => { await toggleWarmup(entry, set); },

  'set-bw': async ({ entry, set }) => {
    const e = findEntry(entry);
    const target = set ? e?.sets?.find((x) => x.id === set) : activeSet(e);
    if (!target) { toast('No set to change'); return; }
    await toggleBodyweight(entry, target.id);
    toast(target.bodyweight ? 'Logged as bodyweight' : 'Back to a weighted set', 1800);
  },

  // The one action during a set: tick it and start the clock in a single tap.
  'hold-start': async ({ entry, set }) => {
    if (editingPast()) { toast('No timer on a workout already finished'); return; }
    unlockAudio();
    const res = await startHold(entry, set);
    if (!res) { toast('Only a timed exercise can be held'); return; }
  },

  'set-effort-then': async ({ entry, set }) => {
    const e = findEntry(entry);
    const s = e?.sets?.find((x) => x.id === set);
    if (!e || !s) return;
    askEffort(e, s, async () => { await entryActions['set-confirm']({ entry, set }); });
  },

  'set-confirm': async ({ entry, set }) => {
    unlockAudio();
    const e = findEntry(entry);
    if (!e) return;
    const target = set ? e.sets.find((x) => x.id === set) : activeSet(e);
    if (!target) return;
    if (!target.done) await toggleSetDone(entry, target.id);
    if (editingPast()) return;            // no clock on a workout already done
    await startRestForSet(entry, target.id);
  },

  /**
   * Start or stop resting after one specific set. Never gated on data: if the
   * timer is running for this set it stops and records, otherwise it starts.
   * A timer running for a different set is stopped first, not discarded.
   */
  'set-rest-toggle': async ({ entry, set }) => {
    unlockAudio();
    if (editingPast()) { toast('No timer on a workout already finished'); return; }
    const t = state.timer;
    if (t && t.entryId === entry && t.setId === set) {
      const res = await stopRest();
      toast(res?.pending
        ? 'Rest saved. That set still needs a weight to count as logged.'
        : 'Rest recorded', res?.pending ? 4200 : 1800);
      return;
    }
    const switching = !!t;
    await startRestForSet(entry, set);
    const e = findEntry(entry);
    const labels = setLabels(e?.sets || []);
    const idx = (e?.sets || []).findIndex((x) => x.id === set);
    toast(switching
      ? `Previous rest saved — now resting after set ${labels[idx]}`
      : `Resting after set ${labels[idx]}`, switching ? 3200 : 1800);
  },

  'set-undo': async ({ entry, set }) => {
    const e = findEntry(entry);
    const labels = setLabels(e?.sets || []);
    const idx = (e?.sets || []).findIndex((x) => x.id === set);
    await undoSet(entry, set);
    toast(`Undid set ${labels[idx] || ''} — rest discarded`, 2600);
  },

  'set-rest-edit': ({ entry, set }) => {
    const e = findEntry(entry);
    const target = e?.sets?.find((x) => x.id === set);
    if (!target) return;
    const labels = setLabels(e.sets);
    const label = labels[e.sets.indexOf(target)];
    openModal({
      title: `Rest after set ${label}`,
      bodyHtml: `
        <label class="field"><span>Rest taken &mdash; 2:30, 90s, or a number of seconds</span>
          <input name="rest" inputmode="text" placeholder="not logged"
                 value="${target.rest ? esc(fmtClock(target.rest)) : ''}"></label>
        <p class="hint">Use this if you forgot to start the timer, stopped it late, or started it by
          mistake. Leave it empty to record no rest for this set.</p>
        <button type="button" class="btn block ghost" data-action="set-rest-clear"
                data-entry="${e.id}" data-set="${target.id}">Clear &mdash; no rest logged</button>`,
      onSubmit: async (v) => {
        const raw = String(v.rest || '').trim();
        if (!raw) { await setRestFor(entry, target.id, null); toast('Rest cleared'); return true; }
        const secs = parseDur(raw);
        if (secs === null) { toast('Could not read that as a time'); return false; }
        await setRestFor(entry, target.id, secs);
        toast(`Rest for set ${label} set to ${fmtClock(secs)}`, 2600);
        return true;
      },
    });
  },

  // Shared by the rest panel's chips and the card's. `field` is 'rpe', 'rir',
  // or 'unknown' -- the last writes an explicit "I did not judge this set",
  // which is an ANSWER and keeps that case distinguishable from a blank.
  'set-effort': async ({ entry, set, field, value }) => {
    const e = findEntry(entry);
    const target = e?.sets?.find((x) => x.id === set);
    if (!target) return;
    if (field === 'unknown') {
      // tapping it again takes the answer back, rather than being one-way
      await setEffort(entry, set, target.effortUnknown
        ? { rpe: null, rir: null } : { unknown: true });
      return;
    }
    const n = Number(value);
    // tapping the same chip clears it, so a mis-tap is one tap to fix
    await setEffort(entry, set, { [field]: target[field] === n ? null : n });
  },

  'set-rest-clear': async ({ entry, set }) => {
    await setRestFor(entry, set, null);
    toast('Rest cleared');
  },

  'set-fill': async ({ entry }) => {
    const n = await fillPlannedSets(entry);
    if (n) toast(`Added ${n} planned set${n === 1 ? '' : 's'}`);
  },

  'set-del-last': async ({ entry }) => {
    const e = findEntry(entry);
    const last = e?.sets?.[e.sets.length - 1];
    if (last) await deleteSet(entry, last.id);
  },

  /**
   * The row's tick. If effort is required and unanswered this asks for it
   * rather than refusing: a dead button teaches you nothing, and silently
   * ticking anyway was the bug -- toggleSetDone only flipped the flag, so the
   * row tick walked straight past the gate the confirm bar enforced.
   */
  'set-done': async ({ entry, set }) => {
    const e = findEntry(entry);
    const s = e?.sets?.find((x) => x.id === set);
    if (!s) return;
    if (s.done) { await toggleSetDone(entry, set); return; }   // unticking is never gated
    if (setBlocker(s, measureOf(e).key) === 'effort') {
      askEffort(e, s, async () => { await toggleSetDone(entry, set); });
      return;
    }
    await toggleSetDone(entry, set);
  },

  /** Tick every set on this card that is filled in and ready. */
  'set-tick-loose': async ({ entry }) => {
    const e = findEntry(entry);
    if (!e) return;
    let n = 0;
    for (const x of (e.sets || [])) {
      if (!x.done && !x.warmup && setIsLoggable(x, measureOf(e).key)) {
        await toggleSetDone(e.id, x.id);
        n++;
      }
    }
    toast(n ? `Logged ${n} set${n === 1 ? '' : 's'}` : 'Nothing ready to log');
  },

  // You press this when the set ends; it marks the set done and starts the clock.
  'rest-start': async ({ entry, set }) => {
    if (editingPast()) return;   // no sense timing rest on a workout already done
    unlockAudio(); // we're inside a user gesture: lets the target beep play later
    const e = findEntry(entry);
    if (!e) return;
    let idx = null;
    if (set) {
      const s = e.sets.find((x) => x.id === set);
      idx = e.sets.indexOf(s);
      if (s && !s.done) await toggleSetDone(entry, set);
    }
    await startRest({
      target: e.rest ?? state.settings.defaultRest,
      entryId: entry,
      setId: set || null,
      label: restLabelFor(e, idx),
    });
  },

  'entry-menu': async ({ entry }) => {
    const e = findEntry(entry);
    if (!e) return;
    openModal({
      title: e.name,
      bodyHtml: `
        <div class="btn-row" style="flex-direction:column;gap:8px">
          <button type="button" class="btn block" data-action="entry-edit" data-entry="${e.id}">Edit exercise & targets</button>
          <button type="button" class="btn block primary" data-action="entry-next-up" data-entry="${e.id}">Do this next &#10514;</button>
          <button type="button" class="btn block" data-action="entry-up" data-entry="${e.id}">Move earlier ↑</button>
          <button type="button" class="btn block" data-action="entry-down" data-entry="${e.id}">Move later ↓</button>
          <button type="button" class="btn block" data-action="entry-skip" data-entry="${e.id}">${e.skipped ? 'Un-skip' : 'Mark as skipped'}</button>
          <button type="button" class="btn block danger" data-action="entry-del" data-entry="${e.id}">Remove from this session</button>
        </div>`,
      cancelText: 'Close',
    });
  },

  'entry-edit': async ({ entry }) => {
    const e = findEntry(entry);
    if (!e) return;
    const modal = openModal({
      title: 'Edit exercise',
      bodyHtml: exerciseFormHtml(e),
      onSubmit: async (v, m) => {
        const patch = readExerciseForm(v, m);
        if (!patch.name) { toast('Name is required'); return false; }
        if (patch.type !== e.type) {
          // switching type needs the matching log container
          patch.sets = patch.type === 'lift' ? (e.sets || []) : null;
          patch.log = patch.type === 'cardio'
            ? (e.log || {
              distance: null, distanceUnit: state.settings.distanceUnit, duration: null,
              avgHr: null, maxHr: null, elevation: null, rpe: null, note: '', done: false, completedAt: null,
            })
            : null;
        }
        await updateSessionEntry(entry, patch);
        return true;
      },
    });
    wireExerciseForm(modal);
  },

  'entry-up': async ({ entry }) => { await moveSessionEntry(entry, -1); },
  'entry-down': async ({ entry }) => { await moveSessionEntry(entry, 1); },

  'entry-next-up': async ({ entry }) => {
    const e = findEntry(entry);
    const moved = await moveEntryNext(entry);
    toast(moved ? `${e?.name || 'Exercise'} is next` : 'Already next up');
  },
  'entry-skip': async ({ entry }) => { await toggleSkip(entry); },

  'entry-del': async ({ entry }) => {
    const e = findEntry(entry);
    if (!e) return;
    if (await confirmDialog(`Remove "${e.name}" from this session? Its logged sets are deleted too. The routine itself is unchanged.`, { okText: 'Remove' })) {
      await removeSessionEntry(entry);
    }
  },

  'entry-add': async () => { openExercisePicker('session', { title: 'Add exercise to this session' }); },

  'ex-new': ({ dest }) => {
    openExerciseForm(dest, {}, { title: 'New exercise' });
  },

  'ex-pick': ({ dest, key }) => {
    const hit = findInLibrary(key);
    if (!hit || !hit.def) { toast('Could not load that exercise'); return; }
    openExerciseForm(dest, hit.def, { title: hit.name });
  },
};

/** Field edits inside set rows / cardio forms. Called from app.js. */
export async function handleFieldInput(target) {
  // an interval leg row owns its own parsing rules
  if (target.dataset.lf) { await handleLegInput(target); return; }
  const field = target.dataset.f;
  if (!field) return;
  const row = target.closest('[data-set]');
  if (row) {
    const patch = {};
    // the amount column is reps, seconds or metres depending on the entry
    patch[field] = field === 'reps'
      ? parseAmount(target.value, measureOf(findEntry(row.dataset.entry)).key)
      : num(target.value);
    await updateSet(row.dataset.entry, row.dataset.set, patch, { silent: true });
    return;
  }
  const logBox = target.closest('[data-log]');
  if (logBox) {
    const patch = {};
    patch[field] = field === 'note' ? target.value
      : field === 'duration' ? parseDur(target.value, { bare: 'minutes' })
        : field === 'pace' ? parsePace(target.value)
          : num(target.value);
    await updateLog(logBox.dataset.entry, patch, { silent: true });
  }
}

/**
 * One box of a split time field changed, so recompute the whole value from all
 * of its boxes. Saved silently, like every other field being typed into.
 */
export async function handleTimeField(target) {
  const key = target.dataset.tf;
  if (!key) return;
  const logBox = target.closest('[data-log]');
  if (!logBox) return;
  const total = readTimeDom(logBox, key);
  await updateLog(logBox.dataset.entry, { [key]: total }, { silent: true });
}
