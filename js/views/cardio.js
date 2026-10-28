// The cardio logging surface: one straight run, or an interval block.
//
// Split out of views/entry.js because it is a different shape of thing. A lift
// is a column of sets; a run is two or three numbers, and an interval block is
// a PATTERN plus a round count that gets confirmed in one tap.
//
// Design rule for this screen: never make the user visit six cards to record
// one treadmill block. The pattern is the unit of logging; individual rounds
// are there for the exceptions.
import {
  state, findEntry, updateLog, updateLeg, logAllRounds, toggleLeg, resetLeg,
  setIntervalPlan, toggleRounds,
} from '../store.js';
import {
  isIntervals, patternText, totalsText, byRound, parseIntervals,
  parsePace, intervalSummary, roundLines,
} from '../cardio.js';
import { esc, fmtNum, fmtClock, parseDur } from '../util.js';
import { openModal, toast } from '../ui.js';

/* ------------------------------------------------------------------ */
/* format help -- shown where the typing happens, not in a manual     */
/* ------------------------------------------------------------------ */

/**
 * The accepted notation, next to the field that accepts it. Both hints are
 * deliberately concrete: a worked example beats a grammar, and the bare-number
 * rule has to be stated because it differs between pace and leg time.
 */
const RUN_HINT = `
  <p class="hint">Fill in <b>any two</b> and the third is worked out for you.
    <br><b>Time</b> <code>28:30</code>, <code>28m</code>, <code>1:05:00</code>.
    <b>Pace</b> <code>6:00</code>, or a bare <code>6</code> meaning 6 min/km.
    <br><span class="dim">Change the time and your pace is kept, so the distance
    follows - which is how a treadmill behaves.</span></p>`;

const PATTERN_HINT = `
  <p class="hint"><b>Format</b> <code>leg + leg &times; rounds</code>, where a leg is
    <code>time</code>, then an optional name, then <code>@ pace</code>.
    <br><b>Example</b> <code>1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6</code>
    <br><span class="dim">A bare leg time is <b>seconds</b> (<code>90</code> = 1:30), a bare
    pace is <b>minutes</b> per km (<code>8</code> = 8:00/km). <code>min</code>, <code>mins per
    km</code>, <code>-</code> instead of <code>@</code>, and brackets all work:
    <code>(1 min - 8 mins per km + 1:30 - walk - 6 mins per km) x 6</code> reads the same.
    Legs are timed, not measured - write the time, not <code>400m</code>.</span></p>`;

/* ------------------------------------------------------------------ */
/* a straight run                                                     */
/* ------------------------------------------------------------------ */

function runBody(e, allowRest) {
  const l = e.log || {};
  const du = l.distanceUnit || state.settings.distanceUnit;
  return `
    <div class="sets" data-entry="${e.id}" data-log="1">
      <div class="grid3">
        <label class="field"><span>Time</span>
          <input inputmode="numeric" data-f="duration" placeholder="28:30"
                 value="${l.duration ? esc(fmtClock(l.duration)) : ''}"></label>
        <label class="field"><span>Pace (/${esc(du)})</span>
          <input inputmode="numeric" data-f="pace" placeholder="6:00"
                 value="${l.pace ? esc(fmtClock(l.pace)) : ''}"></label>
        <label class="field"><span>Distance (${esc(du)})</span>
          <input inputmode="decimal" data-f="distance" placeholder="5"
                 value="${esc(fmtNum(l.distance))}"></label>
      </div>
      ${RUN_HINT}
      <div class="grid3">
        <label class="field"><span>Avg HR</span>
          <input inputmode="numeric" data-f="avgHr" value="${esc(fmtNum(l.avgHr))}"></label>
        <label class="field"><span>Max HR</span>
          <input inputmode="numeric" data-f="maxHr" value="${esc(fmtNum(l.maxHr))}"></label>
        <label class="field"><span>Elev (m)</span>
          <input inputmode="numeric" data-f="elevation" value="${esc(fmtNum(l.elevation))}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Perceived effort (RPE 1-10)</span>
          <input inputmode="decimal" data-f="rpe" value="${esc(fmtNum(l.rpe))}"></label>
        <label class="field"><span>Note</span>
          <input type="text" data-f="note" value="${esc(l.note || '')}"></label>
      </div>
    </div>
    <div class="set-foot">
      <button type="button" class="btn sm ${l.done ? 'ok' : 'primary'}" data-action="cardio-done" data-entry="${e.id}">
        ${l.done ? '\u2713 Logged' : 'Log run'}</button>
      <button type="button" class="btn sm ghost" data-action="cardio-pattern" data-entry="${e.id}">Make it intervals</button>
      ${allowRest ? `<button type="button" class="btn sm ghost" data-action="rest-start" data-entry="${e.id}">\u23f1 Rest</button>` : ''}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* an interval block                                                  */
/* ------------------------------------------------------------------ */

const legRow = (lg, label, du) => `
  <div class="legrow${lg.done ? ' done' : ''}${lg.edited ? ' edited' : ''}" data-entry-leg="${lg.id}">
    <button type="button" class="chk${lg.done ? ' on' : ''}" data-action="cardio-leg"
            data-entry="${lg.entryId}" data-leg="${lg.id}"
            aria-label="Log round ${label}">${lg.done ? '\u2713' : ''}</button>
    <div class="idx">${esc(label)}</div>
    <input inputmode="numeric" data-leg="${lg.id}" data-entry="${lg.entryId}" data-lf="duration"
           placeholder="time" value="${lg.duration ? esc(fmtClock(lg.duration)) : ''}"
           aria-label="Time for round ${label}">
    <input inputmode="numeric" data-leg="${lg.id}" data-entry="${lg.entryId}" data-lf="pace"
           placeholder="pace" value="${lg.pace ? esc(fmtClock(lg.pace)) : ''}"
           aria-label="Pace for round ${label}">
    <div class="legd dim">${lg.duration && lg.pace ? esc(`${fmtNum(Math.round((lg.duration / lg.pace) * 1000) / 1000)} ${du}`) : ''}</div>
    ${lg.edited ? `<button type="button" class="chk" data-action="cardio-leg-reset"
            data-entry="${lg.entryId}" data-leg="${lg.id}" title="Back to the planned numbers">\u21ba</button>`
    : '<div></div>'}
  </div>`;

function roundsTable(e, du) {
  const legs = (e.log.legs || []).map((lg) => ({ ...lg, entryId: e.id }));
  const rounds = byRound(legs);
  const multi = (e.legs || []).length > 1;
  return `
    <div class="legs">
      <div class="legrow hdr"><div></div><div>#</div><div>Time</div><div>Pace</div><div>Dist</div><div></div></div>
      ${rounds.map((group, r) => group.map((lg, i) => legRow(
    lg,
    multi ? `${r + 1}${String.fromCharCode(97 + i)}` : String(r + 1),
    du,
  )).join('')).join('')}
    </div>
    <p class="hint">Tap a row's tick to log just that round, or type over its time or pace -
      an edited round is marked <b>&#8226;</b> and keeps its own numbers if you later change the
      pattern. <code>&#8634;</code> puts it back on plan.</p>`;
}

function intervalBody(e, allowRest) {
  const l = e.log || {};
  const du = l.distanceUnit || state.settings.distanceUnit;
  const legs = l.legs || [];
  const total = legs.length;
  const done = legs.filter((x) => x.done).length;
  const allDone = total > 0 && done === total;
  const open = state.openRounds.has(e.id);
  const rounds = e.rounds || 1;
  const summary = intervalSummary(l, du);

  return `
    <div class="ivblock" data-entry="${e.id}">
      <div class="ivplan">
        <code class="ivpat">${esc(patternText(e.legs, rounds, du))}</code>
        <button type="button" class="btn sm ghost" data-action="cardio-pattern" data-entry="${e.id}">Edit</button>
      </div>
      <div class="small dim">planned ${esc(totalsText(e.legs, rounds, du) || '-')}${
  summary ? ` &nbsp;|&nbsp; <span class="strong">logged ${esc(summary)}</span>` : ''}</div>

      <button type="button" class="confirm${allDone ? ' done-all' : ''}" data-action="cardio-log-all" data-entry="${e.id}">
        <span class="big">${allDone ? `\u2713 All ${rounds} rounds logged` : `\u2713 Log all ${rounds} rounds`}</span>
        <span class="sub">${allDone ? 'tap to clear the block' : `takes the plan as run${done ? ` - ${done} of ${total} legs already logged` : ''}`}</span>
      </button>

      <div class="set-foot">
        <button type="button" class="btn sm ghost" data-action="cardio-rounds" data-entry="${e.id}">
          ${open ? 'Hide rounds' : `Show ${rounds} rounds`}</button>
        ${allowRest ? `<button type="button" class="btn sm ghost" data-action="rest-start" data-entry="${e.id}">\u23f1 Rest</button>` : ''}
      </div>
      ${open ? roundsTable(e, du) : ''}

      <div class="sets" data-entry="${e.id}" data-log="1">
        <div class="grid3">
          <label class="field"><span>Avg HR</span>
            <input inputmode="numeric" data-f="avgHr" value="${esc(fmtNum(l.avgHr))}"></label>
          <label class="field"><span>Max HR</span>
            <input inputmode="numeric" data-f="maxHr" value="${esc(fmtNum(l.maxHr))}"></label>
          <label class="field"><span>Effort (RPE)</span>
            <input inputmode="decimal" data-f="rpe" value="${esc(fmtNum(l.rpe))}"></label>
        </div>
        <label class="field"><span>Note</span>
          <input type="text" data-f="note" value="${esc(l.note || '')}"></label>
      </div>
    </div>`;
}

/** The whole cardio body, run or intervals. Called from views/entry.js. */
export function cardioBody(e, allowRest) {
  return isIntervals(e) ? intervalBody(e, allowRest) : runBody(e, allowRest);
}

/** Read-only detail for the History card: the rounds, one line each. */
export function cardioStatic(e) {
  const l = e.log || {};
  if (!l.legs || !l.legs.length) return '';
  const du = l.distanceUnit || state.settings.distanceUnit;
  return `<div class="loglines" style="margin-top:6px">${
    roundLines(l, du).map((line) => `<code>${esc(line)}</code>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ */
/* actions                                                            */
/* ------------------------------------------------------------------ */

/** The pattern editor. Echoes the parse back so a mis-typed pattern is visible. */
function openPatternEditor(entryId) {
  const e = findEntry(entryId);
  if (!e) return;
  const du = e.distanceUnit || state.settings.distanceUnit;
  const current = patternText(e.legs, e.rounds, du);
  const modal = openModal({
    title: isIntervals(e) ? 'Interval pattern' : 'Make it intervals',
    bodyHtml: `
      <label class="field"><span>Pattern</span>
        <input name="pattern" id="ivPattern" autocapitalize="off" autocomplete="off" spellcheck="false"
               placeholder="1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6"
               value="${esc(current)}"></label>
      <div class="small" id="ivEcho" aria-live="polite"></div>
      ${PATTERN_HINT}
      <p class="hint">Leave it empty to go back to logging one straight run.</p>`,
    okText: 'Save pattern',
    onSubmit: async (v) => {
      const text = (v.pattern || '').trim();
      if (!text) { await setIntervalPlan(entryId, { legs: null, rounds: null }); return true; }
      const spec = parseIntervals(text);
      if (!spec) { toast('Could not read that pattern'); return false; }
      await setIntervalPlan(entryId, spec);
      toast(`Pattern set: ${patternText(spec.legs, spec.rounds, du)}`);
      return true;
    },
  });

  // Live echo of the parse. This is the real safety net for a forgiving
  // parser: you see what the app understood before you commit to it.
  const input = modal.querySelector('#ivPattern');
  const echo = modal.querySelector('#ivEcho');
  const show = () => {
    if (!input.value.trim()) { echo.innerHTML = '<span class="dim">one straight run</span>'; return; }
    const spec = parseIntervals(input.value);
    if (!spec) {
      echo.innerHTML = '<span class="warnmsg">Not understood yet - check the format below.</span>';
      return;
    }
    const t = totalsText(spec.legs, spec.rounds, du);
    echo.innerHTML = `reads as <code>${esc(patternText(spec.legs, spec.rounds, du))}</code>${
      t ? ` <span class="dim">- ${esc(t)}</span>` : ''}`;
  };
  input.addEventListener('input', show);
  show();
}

export const cardioActions = {
  'cardio-done': async ({ entry }) => {
    const e = findEntry(entry);
    if (!e) return;
    await updateLog(entry, { done: !e.log.done, completedAt: e.log.done ? null : Date.now() });
  },

  'cardio-log-all': async ({ entry }) => {
    const n = await logAllRounds(entry);
    toast(n ? `Logged ${n} legs` : 'Block cleared');
  },

  'cardio-leg': async ({ entry, leg }) => { await toggleLeg(entry, leg); },

  'cardio-leg-reset': async ({ entry, leg }) => { await resetLeg(entry, leg); },

  'cardio-rounds': async ({ entry }) => { await toggleRounds(entry); },

  'cardio-pattern': async ({ entry }) => { openPatternEditor(entry); },
};

/**
 * Field edits inside a leg row. Called from the field router in views/entry.js.
 * A leg's time is parsed as a clock value and its pace as a pace, so `90` in
 * the time column is a minute and a half and `6` in the pace column is 6:00/km.
 */
export async function handleLegInput(target) {
  const field = target.dataset.lf;
  if (!field) return false;
  const { entry, leg } = target.dataset;
  const value = field === 'pace'
    ? parsePace(target.value)
    : parseDur(target.value, { bare: 'seconds' });
  await updateLeg(entry, leg, { [field]: value }, { silent: true });
  return true;
}
