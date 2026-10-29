// Shared renderer for one exercise (used by the Now view, the Session view and
// the read-only History view) plus the actions that belong to it.
import {
  state, findEntry, addSet, deleteSet, updateSet, toggleSetDone, toggleSkip,
  removeSessionEntry, moveEntryNext, moveSessionEntry, updateSessionEntry, startRest, entryStatus,
  addSessionEntry, updateLog, working, editingPast, plannedSet, fillPlannedSets,
  parseSetTargets, getRoutine, saveRoutine, normalizeEntry,
  setLabels, workingSets, toggleWarmup, toggleBodyweight, activeSet, setRestFor, undoSet,
  setIsLoggable, startRestForSet, stopRest,
} from '../store.js';
import { exerciseLibrary, findInLibrary, lastLogFor, recentWeights } from '../queries.js';
import { esc, fmtNum, fmtReps, fmtClock, num, parseDur, relDay, normName } from '../util.js';
import { parsePace, patternText, parseIntervals, isIntervals } from '../cardio.js';
import { builderHtml, wireBuilder, DEFAULT_LEGS } from './cardio.js';
import { readTimeDom } from '../timefield.js';
import {
  MEASURES, measureOf, fmtAmount, fmtAmountRange, parseAmount, amountFieldValue, parseMeasure,
} from '../measure.js';
import { planLine, targetLine, logSummary, restLine, loadLabel } from '../format.js';
import { cardioBody, cardioStatic, handleLegInput } from './cardio.js';
import { openModal, confirmDialog, toast } from '../ui.js';
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
  const running = !!(t && t.entryId === e.id && t.setId === s.id);
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
      ${allowRest ? `<button type="button" class="rest-btn ${running ? 'running' : ''}"
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
    ${stepBar(e)}
    ${confirmBar(e, allowRest)}
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
/* exercise form (add / edit) — shared with the routine editor         */
/* ------------------------------------------------------------------ */

/**
 * What each measure means, said where it is chosen. The range example matters:
 * without it nobody discovers that a plank target can be "30-45".
 */
const MEASURE_HINT = {
  reps: 'Normal sets. A target can be a single number or a range such as 8-12.',
  time: 'For holds: plank, dead hang, L-sit. Type seconds (45) or a clock value (1:15). A range works too: 30-45.',
  distance: 'For loaded carries: farmer carry, sled push, sandbag walk. Type metres (40). Weight is the load you carried.',
};

const stRow = (t = {}, measure = 'reps') => {
  const m = MEASURES[measure] || MEASURES.reps;
  return `
  <div class="strow" data-strow>
    <div class="idx"></div>
    <input data-stf="w" inputmode="decimal" placeholder="weight"
           value="${esc(fmtNum(t.weight))}" aria-label="Set weight">
    <input data-stf="r" inputmode="text" placeholder="${esc(m.placeholder)}"
           value="${esc(fmtAmountRange(t.repsMin ?? null, t.repsMax ?? null, m.key))}"
           aria-label="Set ${esc(m.label.toLowerCase())}">
    <button type="button" class="chk" data-strow-del title="Remove this set">✕</button>
  </div>`;
};

/**
 * One grid row per set. An exercise saved with a single target for all sets is
 * expanded into that many identical rows, so the grid is always the way targets
 * are entered and there is no mode to discover.
 */
function planRows(e) {
  const m = e.measure || 'reps';
  if (e.setTargets && e.setTargets.length) return e.setTargets.map((t) => stRow(t, m)).join('');
  const n = Math.min(Math.max(num(e.targetSets) ?? 3, 1), 30);
  const t = { weight: e.weight ?? null, repsMin: e.repsMin ?? null, repsMax: e.repsMax ?? null };
  return Array.from({ length: n }, () => stRow(t, m)).join('');
}

export function exerciseFormHtml(e = {}) {
  // Three choices on screen, two types underneath. An interval block is still a
  // cardio entry with `legs`, but it was invisible as a field buried below the
  // run targets -- the type selector is the first decision, so that is where a
  // kind of workout has to be offered.
  const kind = e.type === 'cardio' ? (isIntervals(e) ? 'intervals' : 'run') : 'lift';
  const type = e.type === 'cardio' ? 'cardio' : 'lift';
  const measure = e.measure || 'reps';
  const du = e.distanceUnit || state.settings.distanceUnit;
  return `
    <label class="field"><span>Exercise name</span>
      <input name="name" list="exerciseNames" autocapitalize="words" placeholder="e.g. Back Squat"
             value="${esc(e.name || '')}" required></label>
    <label class="field"><span>Type</span>
      <select name="type" id="exType">
        <option value="lift" ${kind === 'lift' ? 'selected' : ''}>Lifting / bodyweight (sets &amp; reps)</option>
        <option value="run" ${kind === 'run' ? 'selected' : ''}>Run &mdash; one effort (time, pace, distance)</option>
        <option value="intervals" ${kind === 'intervals' ? 'selected' : ''}>Intervals &mdash; repeating legs (1:00 hard + 1:30 easy &times; 6)</option>
      </select></label>

    <div id="exLift" ${type === 'cardio' ? 'hidden' : ''}>
      <label class="field"><span>Each set is measured in</span>
        <select name="measure" id="exMeasure">
          ${Object.values(MEASURES).map((m) => `<option value="${m.key}"
            ${measure === m.key ? 'selected' : ''}>${esc(m.long)}</option>`).join('')}
        </select></label>
      <p class="hint" id="exMeasureHint" style="margin-top:-4px">${esc(MEASURE_HINT[measure])}</p>
      <div class="tiny" style="margin:2px 0 7px">Sets — weight and <span id="exAmountWord">${esc((MEASURES[measure] || MEASURES.reps).label.toLowerCase())}</span> for each set</div>
      <div class="strow-hdr"><div>Set</div><div>Weight (${esc(state.settings.unit)})</div><div id="exAmountHdr">${esc((MEASURES[measure] || MEASURES.reps).header)}</div><div></div></div>
      <div id="exRows">${planRows(e)}</div>
      <div class="btn-row" style="margin:2px 0 8px">
        <button type="button" class="btn sm" id="exAddRow">+ Add set</button>
        <button type="button" class="btn sm ghost" id="exCopyDown" title="Copy set 1 into every set">Copy set 1 down</button>
      </div>
      <p class="hint" style="margin-top:0">Leave the weight blank for an unloaded set.</p>
    </div>

    <div id="exIntervals" ${kind === 'intervals' ? '' : 'hidden'}>
      <div class="tiny" style="margin:2px 0 7px">Build the pattern &mdash; tap, no typing needed</div>
      ${builderHtml(isIntervals(e) ? e.legs : DEFAULT_LEGS(), Math.max(1, e.rounds || 6), du)}
      <input type="hidden" name="pattern" id="exPattern"
             value="${esc(patternText(e.legs, e.rounds, du))}">
      <p class="hint" style="margin-top:0">The whole block logs in <b>one tap</b> when you train it,
        and any single round can still be corrected afterwards. Legs are <b>timed</b>, so a leg is a
        time plus an optional pace &mdash; write the time a leg takes, not a distance.</p>
    </div>

    <div id="exCardio" ${kind === 'run' ? '' : 'hidden'}>
      <div class="grid3">
        <label class="field"><span>Target time (m:ss)</span>
          <input name="targetDuration" inputmode="text" placeholder="28:30"
                 value="${e.targetDuration ? esc(fmtClock(e.targetDuration)) : ''}"></label>
        <label class="field"><span>Target pace (/${esc(e.distanceUnit || state.settings.distanceUnit)})</span>
          <input name="targetPace" inputmode="text" placeholder="6:00"
                 value="${e.targetPace ? esc(fmtClock(e.targetPace)) : ''}"></label>
        <label class="field"><span>Target distance (${esc(e.distanceUnit || state.settings.distanceUnit)})</span>
          <input name="targetDistance" inputmode="decimal" placeholder="5"
                 value="${esc(fmtNum(e.targetDistance))}"></label>
      </div>
      <p class="hint" style="margin-top:-4px">Give <b>any two</b>; the third follows.
        <b>Time</b> <code>28:30</code> or <code>28m</code>. <b>Pace</b> <code>6:00</code>, or a
        bare <code>6</code> meaning 6 min/km.</p>

      <p class="hint" style="margin-top:-4px">For a repeating block of legs, choose
        <b>Intervals</b> in the Type list above instead.</p>
    </div>

    <label class="field"><span>Rest between sets - 2:30, 90s, or a number of seconds</span>
      <input name="rest" inputmode="text" placeholder="2:00" value="${e.rest ? esc(fmtClock(e.rest)) : ''}"></label>
    <label class="field"><span>Load</span>
      <select name="bodyweight">
        <option value="0" ${e.bodyweight ? '' : 'selected'}>External weight (barbell, machine, dumbbells)</option>
        <option value="1" ${e.bodyweight ? 'selected' : ''}>Bodyweight (pull-ups, dips, push-ups)</option>
      </select></label>
    <p class="hint" style="margin-top:-4px">For a bodyweight exercise every set logs as
      <b>BW</b>, and any weight you enter counts as <b>added</b> load.</p>

    <label class="field"><span>Superset / circuit group — same label on consecutive exercises</span>
      <input name="group" maxlength="4" placeholder="e.g. A — leave blank for a normal exercise"
             value="${esc(e.group || '')}"></label>
    <label class="field"><span>Notes — warmup sets, tempo, cues, setup</span>
      <textarea name="notes" rows="4" placeholder="Warmup: 2×5 @ 50%, 1×3 @ 70%&#10;Tempo 3-1-1&#10;Belt from set 3">${esc(e.notes || '')}</textarea></label>`;
}

/**
 * Wire the set grid (add / remove / copy-down / renumber) and the lift-vs-cardio
 * switch. Call once after opening the form.
 */
export function wireExerciseForm(modal) {
  const rows = modal.querySelector('#exRows');
  const type = modal.querySelector('#exType');
  if (!rows || !type) return;

  const renumber = () => {
    const all = [...rows.querySelectorAll('[data-strow]')];
    all.forEach((row, i) => { row.querySelector('.idx').textContent = String(i + 1); });
    modal.querySelector('#exCopyDown').hidden = all.length < 2;
  };

  const show = () => {
    const k = type.value;
    modal.querySelector('#exLift').hidden = k !== 'lift';
    modal.querySelector('#exCardio').hidden = k !== 'run';
    modal.querySelector('#exIntervals').hidden = k !== 'intervals';
  };
  type.addEventListener('change', show);
  show();

  // The interval builder keeps its own state; it writes the canonical pattern
  // into a hidden field so readExerciseForm needs to know nothing about it.
  const ivBox = modal.querySelector('#exIntervals');
  if (ivBox) {
    const du = state.settings.distanceUnit;
    const seeded = parseIntervals(modal.querySelector('#exPattern').value);
    wireBuilder(ivBox, {
      legs: seeded ? seeded.legs : DEFAULT_LEGS(),
      rounds: seeded ? seeded.rounds : 6,
      du,
      onChange: (legs, rounds) => {
        modal.querySelector('#exPattern').value = legs.length ? patternText(legs, rounds, du) : '';
      },
    });
  }

  // Switching measure relabels the amount column and swaps the hint, so the
  // unit you are typing in is never ambiguous.
  const measure = modal.querySelector('#exMeasure');
  if (measure) {
    measure.addEventListener('change', () => {
      const m = MEASURES[measure.value] || MEASURES.reps;
      modal.querySelector('#exMeasureHint').textContent = MEASURE_HINT[m.key];
      modal.querySelector('#exAmountHdr').textContent = m.header;
      modal.querySelector('#exAmountWord').textContent = m.label.toLowerCase();
      rows.querySelectorAll('[data-stf="r"]').forEach((i) => {
        i.placeholder = m.placeholder;
        i.setAttribute('aria-label', `Set ${m.label.toLowerCase()}`);
      });
    });
  }

  modal.querySelector('#exAddRow').addEventListener('click', () => {
    const last = rows.querySelector('[data-strow]:last-child');
    rows.insertAdjacentHTML('beforeend', stRow({}, measure ? measure.value : 'reps'));
    const fresh = rows.querySelector('[data-strow]:last-child');
    if (last) {
      // carry the previous set forward as a starting point
      fresh.querySelector('[data-stf="w"]').value = last.querySelector('[data-stf="w"]').value;
      fresh.querySelector('[data-stf="r"]').value = last.querySelector('[data-stf="r"]').value;
    }
    renumber();
  });

  modal.querySelector('#exCopyDown').addEventListener('click', () => {
    const all = [...rows.querySelectorAll('[data-strow]')];
    if (all.length < 2) return;
    const w = all[0].querySelector('[data-stf="w"]').value;
    const r = all[0].querySelector('[data-stf="r"]').value;
    all.slice(1).forEach((row) => {
      row.querySelector('[data-stf="w"]').value = w;
      row.querySelector('[data-stf="r"]').value = r;
    });
  });

  rows.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-strow-del]');
    if (!btn) return;
    const all = rows.querySelectorAll('[data-strow]');
    if (all.length > 1) btn.closest('[data-strow]').remove();
    else btn.closest('[data-strow]').querySelectorAll('input').forEach((i) => { i.value = ''; });
    renumber();
  });

  renumber();
}

/** Read the exercise form. `modal` is required to read the set grid. */
export function readExerciseForm(v, modal = null) {
  const base = {
    // 'run' and 'intervals' are both cardio underneath -- see exerciseFormHtml
    type: (v.type === 'cardio' || v.type === 'run' || v.type === 'intervals') ? 'cardio' : 'lift',
    name: (v.name || '').trim(),
    targetDistance: num(v.targetDistance),
    targetDuration: parseDur(v.targetDuration, { bare: 'minutes' }),
    targetPace: parsePace(v.targetPace),
    rest: parseDur(v.rest),
    bodyweight: v.bodyweight === '1',
    measure: parseMeasure(v.measure),
    group: (v.group || '').trim() || null,
    notes: (v.notes || '').trim(),
  };

  if (base.type === 'cardio' || !modal) {
    // only an "intervals" entry keeps its pattern; switching to a plain run
    // must drop it, or the run would silently stay an interval block
    const spec = v.type === 'intervals'
      ? parseIntervals(v.pattern || '') || { legs: null, rounds: null }
      : { legs: null, rounds: null };
    return {
      ...base, setTargets: null, targetSets: null, repsMin: null, repsMax: null, weight: null,
      legs: spec.legs, rounds: spec.legs ? spec.rounds : null,
    };
  }

  const rowEls = [...modal.querySelectorAll('#exRows [data-strow]')];
  const raw = rowEls.map((row) => ({
    weight: num(row.querySelector('[data-stf="w"]').value),
    reps: row.querySelector('[data-stf="r"]').value,
  }));
  const parsed = parseSetTargets(
    raw.filter((t) => t.weight !== null || String(t.reps).trim() !== ''), base.measure,
  );

  if (!parsed) {
    // Rows exist but nothing was filled in: keep the set count, no loads.
    return {
      ...base, setTargets: null, targetSets: rowEls.length || null,
      repsMin: null, repsMax: null, weight: null,
    };
  }

  // All sets identical? Store the simpler uniform target so the summary reads
  // "3 × 8 @ 15 kg" instead of repeating the same row three times.
  const first = parsed[0];
  const allSame = parsed.every((t) => t.weight === first.weight
    && t.repsMin === first.repsMin && t.repsMax === first.repsMax);
  if (allSame) {
    return {
      ...base,
      setTargets: null,
      targetSets: parsed.length,
      weight: first.weight,
      repsMin: first.repsMin,
      repsMax: first.repsMax,
    };
  }

  return {
    ...base, setTargets: parsed, targetSets: parsed.length,
    repsMin: null, repsMax: null, weight: null,
  };
}

/* ------------------------------------------------------------------ */
/* exercise picker: reuse an exercise, or define a new one            */
/* ------------------------------------------------------------------ */

/** dest is either the string 'session' or a routine id. */
async function commitExercise(dest, patch) {
  if (dest === 'session') {
    await addSessionEntry(patch);
    toast('Added to this session only');
    return true;
  }
  const r = getRoutine(dest);
  if (!r) { toast('Routine not found'); return false; }
  r.entries.push(normalizeEntry(patch));
  await saveRoutine(r);
  return true;
}

function openExerciseForm(dest, prefill = {}, { title = 'Add exercise', okText = 'Add' } = {}) {
  const modal = openModal({
    title,
    bodyHtml: exerciseFormHtml(prefill),
    okText,
    onSubmit: async (v, m) => {
      const patch = readExerciseForm(v, m);
      if (!patch.name) { toast('Name is required'); return false; }
      return commitExercise(dest, patch);
    },
  });
  wireExerciseForm(modal);
}

function libraryRows(lib, dest) {
  if (!lib.length) return '<div class="empty">Nothing matches that search.</div>';
  return lib.map((x) => {
    const bits = [];
    if (x.def && targetLine(x.def)) bits.push(targetLine(x.def));
    if (x.routines) bits.push(`in ${x.routines} routine${x.routines === 1 ? '' : 's'}`);
    bits.push(x.lastPerformed ? `last done ${relDay(x.lastPerformed)}` : 'never performed');
    return `
      <div class="sess-item" data-action="ex-pick" data-dest="${esc(dest)}" data-key="${esc(x.key)}"
           role="button" tabindex="0">
        <div class="body">
          <div class="nm">${esc(x.name)}${x.def?.type === 'cardio' ? ' <span class="pill">cardio</span>' : ''}</div>
          <div class="sub">${esc(bits.join(' · '))}</div>
        </div>
        <div class="dim">›</div>
      </div>`;
  }).join('');
}

/**
 * Pick from every exercise already used anywhere, or define a new one.
 * With an empty library there is nothing to choose, so go straight to the form.
 */
export function openExercisePicker(dest, { title = 'Add exercise' } = {}) {
  const lib = exerciseLibrary();
  if (!lib.length) { openExerciseForm(dest, {}, { title }); return; }

  const modal = openModal({
    title,
    bodyHtml: `
      <button type="button" class="btn block primary" data-action="ex-new" data-dest="${esc(dest)}">
        + Create a new exercise</button>
      <div class="divider"></div>
      <label class="field"><span>Or reuse one of your ${lib.length} exercises</span>
        <input id="exSearch" placeholder="Search by name…" autocomplete="off" spellcheck="false"
               data-nofocus></label>
      <div id="exLib">${libraryRows(lib, dest)}</div>
      <p class="hint">Picking one copies its targets, rest and notes into the form so you can adjust
        them. The superset letter is not copied — that belongs to the routine it came from.</p>`,
    cancelText: 'Cancel',
  });

  const search = modal.querySelector('#exSearch');
  const list = modal.querySelector('#exLib');
  search.addEventListener('input', () => {
    const q = normName(search.value);
    list.innerHTML = libraryRows(
      q ? lib.filter((x) => x.key.includes(q)) : lib,
      dest,
    );
  });
}

/* ------------------------------------------------------------------ */
/* actions                                                            */
/* ------------------------------------------------------------------ */

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

  'set-effort': async ({ entry, set, field, value }) => {
    const e = findEntry(entry);
    const target = e?.sets?.find((x) => x.id === set);
    if (!target) return;
    const n = Number(value);
    // tapping the same chip clears it, so a mis-tap is one tap to fix
    await updateSet(entry, set, { [field]: target[field] === n ? null : n });
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

  'set-done': async ({ entry, set }) => { await toggleSetDone(entry, set); },

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
