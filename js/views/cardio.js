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
  parsePace, fmtPace, intervalSummary, roundLines,
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

/** What the confirm bar commits: "28:30 - 6:00/km - 4.75 km". */
function runLabel(l, du) {
  const bits = [];
  if (l.duration) bits.push(fmtClock(l.duration));
  if (l.pace) bits.push(fmtPace(l.pace, du));
  if (l.distance !== null && l.distance !== undefined) bits.push(`${fmtNum(l.distance)} ${du}`);
  return bits.length ? bits.join(' \u00b7 ') : 'Log this run';
}

function runBody(e, allowRest) {
  const l = e.log || {};
  const du = l.distanceUnit || state.settings.distanceUnit;
  return `
    <div class="sets" data-entry="${e.id}" data-log="1">
      <div class="grid3">
        <label class="field"><span>Time (m:ss)</span>
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
        <label class="field"><span>Avg HR (bpm)</span>
          <input inputmode="numeric" data-f="avgHr" placeholder="152" value="${esc(fmtNum(l.avgHr))}"></label>
        <label class="field"><span>Max HR (bpm)</span>
          <input inputmode="numeric" data-f="maxHr" placeholder="171" value="${esc(fmtNum(l.maxHr))}"></label>
        <label class="field"><span>Elev (m)</span>
          <input inputmode="numeric" data-f="elevation" placeholder="24" value="${esc(fmtNum(l.elevation))}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Perceived effort (RPE)</span>
          <input inputmode="decimal" data-f="rpe" placeholder="1-10" value="${esc(fmtNum(l.rpe))}"></label>
        <label class="field"><span>Note</span>
          <input type="text" data-f="note" value="${esc(l.note || '')}"></label>
      </div>
    </div>
    <button type="button" class="confirm${l.done ? ' done-all' : ''}" data-action="cardio-done" data-entry="${e.id}">
      <span class="big">${l.done ? '\u2713 Logged' : `\u2713\u00a0 ${esc(runLabel(l, du))}`}</span>
      <span class="sub">${l.done ? 'tap to un-log it' : 'nothing is recorded until you tap this'}</span>
    </button>
    <div class="set-foot">
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
           placeholder="1:00" value="${lg.duration ? esc(fmtClock(lg.duration)) : ''}"
           aria-label="Time in minutes and seconds for round ${label}">
    <input inputmode="numeric" data-leg="${lg.id}" data-entry="${lg.entryId}" data-lf="pace"
           placeholder="8:00" value="${lg.pace ? esc(fmtClock(lg.pace)) : ''}"
           aria-label="Pace per ${du} for round ${label}">
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
      <div class="legrow hdr"><div></div><div>#</div><div>Time (m:ss)</div>
        <div>Pace (/${esc(du)})</div><div>Dist (${esc(du)})</div><div></div></div>
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
          <label class="field"><span>Avg HR (bpm)</span>
            <input inputmode="numeric" data-f="avgHr" placeholder="152" value="${esc(fmtNum(l.avgHr))}"></label>
          <label class="field"><span>Max HR (bpm)</span>
            <input inputmode="numeric" data-f="maxHr" placeholder="171" value="${esc(fmtNum(l.maxHr))}"></label>
          <label class="field"><span>Effort (RPE)</span>
            <input inputmode="decimal" data-f="rpe" placeholder="1-10" value="${esc(fmtNum(l.rpe))}"></label>
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

/* ------------------------------------------------------------------ */
/* the pattern builder: tap, don't type                               */
/* ------------------------------------------------------------------ */

/** Starting points, so the common blocks need no typing at all. */
const PRESETS = [
  { name: '30/30', pattern: '0:30 hard + 0:30 easy x 10' },
  { name: '1:1 min', pattern: '1:00 hard + 1:00 easy x 8' },
  { name: 'Tabata', pattern: '0:20 hard + 0:10 rest x 8' },
  { name: '400m reps', pattern: '1:35 @ 4:00/km + 1:30 walk @ 9:00/km x 6' },
  { name: 'Pyramid up', pattern: '1:00 hard + 1:00 easy + 2:00 hard + 1:00 easy + 3:00 hard x 1' },
];

/** Time steps in seconds; pace steps in seconds per unit. */
const T_STEPS = [-30, -15, -5, 5, 15, 30];
const P_STEPS = [-30, -15, -5, 5, 15, 30];

const bRow = (lg, i, du) => `
  <div class="bleg" data-bleg="${i}">
    <div class="bleg-hd">
      <b>Leg ${i + 1}</b>
      <input class="bleg-name" data-b="label" placeholder="name, e.g. walk"
             value="${esc(lg.label || '')}" aria-label="Name for leg ${i + 1}" maxlength="16">
      <button type="button" class="chk" data-b-del title="Remove this leg">✕</button>
    </div>
    <div class="bleg-f">
      <span class="tiny">Time (m:ss)</span>
      <output data-b-out="duration">${esc(lg.duration ? fmtClock(lg.duration) : '0:00')}</output>
      ${T_STEPS.map((d) => `<button type="button" class="chip" data-b-step="duration" data-d="${d}"
        >${d > 0 ? '+' : '\u2212'}${Math.abs(d)}s</button>`).join('')}
    </div>
    <div class="bleg-f">
      <span class="tiny">Pace (/${esc(du)})</span>
      <output data-b-out="pace">${lg.pace ? esc(fmtClock(lg.pace)) : '\u2014'}</output>
      ${P_STEPS.map((d) => `<button type="button" class="chip" data-b-step="pace" data-d="${d}"
        >${d > 0 ? '+' : '\u2212'}${Math.abs(d)}s</button>`).join('')}
      <button type="button" class="chip" data-b-step="pace" data-d="clear">none</button>
    </div>
  </div>`;

/**
 * Build a pattern by tapping. Typing `1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6`
 * on a phone keyboard means hunting for a colon, a slash and an at-sign nine
 * times; every one of those characters is a chance to get it wrong. Steppers
 * move in the units the thing is measured in, so the only typing left is an
 * optional name. The text field is still there for anyone who prefers it.
 */
/**
 * The builder's markup, free of any entry. Used by the logging sheet and by the
 * routine form, which is why it takes ids as a prefix rather than assuming one
 * host -- two of these must be able to exist without colliding.
 */
export function builderHtml(legs, rounds, du) {
  return `
    <div class="bpresets">
      <span class="tiny">Start from</span>
      ${PRESETS.map((p, i) => `<button type="button" class="chip" data-b-preset="${i}">${esc(p.name)}</button>`).join('')}
    </div>
    <div data-b-legs></div>
    <div class="btn-row" style="margin:2px 0 10px">
      <button type="button" class="btn sm" data-b-add>+ Add leg</button>
      <button type="button" class="btn sm ghost" data-b-dup>Duplicate last</button>
    </div>
    <div class="bleg-f" style="margin-bottom:10px">
      <span class="tiny">Rounds</span>
      <output data-b-rounds>${rounds}</output>
      ${[-5, -1, 1, 5].map((d) => `<button type="button" class="chip" data-b-rounds-by="${d}"
        >${d > 0 ? '+' : '\u2212'}${Math.abs(d)}</button>`).join('')}
    </div>
    <div class="bpreview" data-b-preview aria-live="polite"></div>`;
}

/**
 * Wire a builder inside `root`. Returns a getter for the current plan, so the
 * host decides when and where to save it. Nothing is persisted from here.
 */
export function wireBuilder(root, { legs, rounds, du, onChange = null }) {
  let L = legs.map((lg) => ({ ...lg }));
  let R = rounds;
  const legBox = root.querySelector('[data-b-legs]');
  const preview = root.querySelector('[data-b-preview]');
  const usable = () => L.filter((lg) => lg.duration || lg.pace);

  const repaintPreview = () => {
    const u = usable();
    const t = totalsText(u, R, du);
    preview.innerHTML = u.length
      ? `<code>${esc(patternText(u, R, du))}</code>${t ? `<div class="dim small">${esc(t)}</div>` : ''}`
      : '<span class="warnmsg">Give at least one leg a time.</span>';
    if (onChange) onChange(u, R);
  };
  const paint = () => {
    legBox.innerHTML = L.map((lg, i) => bRow(lg, i, du)).join('');
    root.querySelector('[data-b-rounds]').textContent = String(R);
    repaintPreview();
  };

  legBox.addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-bleg]');
    if (!row) return;
    const i = Number(row.dataset.bleg);
    if (ev.target.closest('[data-b-del]')) {
      if (L.length > 1) L.splice(i, 1);
      paint();
      return;
    }
    const step = ev.target.closest('[data-b-step]');
    if (!step) return;
    const field = step.dataset.bStep;
    if (step.dataset.d === 'clear') { L[i].pace = null; paint(); return; }
    const base = L[i][field] ?? (field === 'pace' ? 360 : 0);
    L[i][field] = Math.max(field === 'pace' ? 60 : 0, base + Number(step.dataset.d));
    paint();
  });

  legBox.addEventListener('input', (ev) => {
    const row = ev.target.closest('[data-bleg]');
    if (!row || ev.target.dataset.b !== 'label') return;
    L[Number(row.dataset.bleg)].label = ev.target.value.trim().slice(0, 16);
    repaintPreview();        // not paint(): redrawing the rows would steal the caret
  });

  root.addEventListener('click', (ev) => {
    const r = ev.target.closest('[data-b-rounds-by]');
    if (r) { R = Math.min(50, Math.max(1, R + Number(r.dataset.bRoundsBy))); paint(); return; }
    const p = ev.target.closest('[data-b-preset]');
    if (p) {
      const spec = parseIntervals(PRESETS[Number(p.dataset.bPreset)].pattern);
      if (spec) { L = spec.legs.map((lg) => ({ ...lg })); R = spec.rounds; paint(); }
      return;
    }
    if (ev.target.closest('[data-b-add]')) { L.push({ label: '', duration: 60, pace: null }); paint(); return; }
    if (ev.target.closest('[data-b-dup]')) { L.push({ ...L[L.length - 1] }); paint(); }
  });

  paint();
  return () => ({ legs: usable(), rounds: R });
}

/** The two legs a brand-new interval block starts from. */
export const DEFAULT_LEGS = () => [
  { label: '', duration: 60, pace: null },
  { label: 'easy', duration: 60, pace: null },
];

function openPatternBuilder(entryId) {
  const e = findEntry(entryId);
  if (!e) return;
  const du = e.distanceUnit || state.settings.distanceUnit;
  const legs = isIntervals(e) ? e.legs : DEFAULT_LEGS();
  const rounds = Math.max(1, e.rounds || 6);

  const modal = openModal({
    title: isIntervals(e) ? 'Interval pattern' : 'Make it intervals',
    wide: true,
    bodyHtml: `
      ${builderHtml(legs, rounds, du)}
      <details id="bRaw">
        <summary>Or type it instead</summary>
        <label class="field"><span>Pattern</span>
          <input name="pattern" id="ivPattern" autocapitalize="off" autocomplete="off" spellcheck="false"
                 placeholder="1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6" value=""></label>
        <div class="small" id="ivEcho" aria-live="polite"></div>
        ${PATTERN_HINT}
        <p class="hint">Typing here overrides the builder above. Leave it empty to use the builder.</p>
      </details>`,
    okText: 'Save pattern',
    onSubmit: async (v) => {
      const typed = (v.pattern || '').trim();
      if (typed) {
        const spec = parseIntervals(typed);
        if (!spec) { toast('Could not read that pattern'); return false; }
        await setIntervalPlan(entryId, spec);
        toast(`Pattern set: ${patternText(spec.legs, spec.rounds, du)}`);
        return true;
      }
      const built = read();
      if (!built.legs.length) { toast('Give at least one leg a time'); return false; }
      await setIntervalPlan(entryId, built);
      toast(`Pattern set: ${patternText(built.legs, built.rounds, du)}`);
      return true;
    },
  });

  const read = wireBuilder(modal, { legs, rounds, du });

  const raw = modal.querySelector('#ivPattern');
  const echo = modal.querySelector('#ivEcho');
  const showEcho = () => {
    if (!raw.value.trim()) { echo.innerHTML = '<span class="dim">using the builder above</span>'; return; }
    const spec = parseIntervals(raw.value);
    if (!spec) { echo.innerHTML = '<span class="warnmsg">Not understood yet - check the format below.</span>'; return; }
    const t = totalsText(spec.legs, spec.rounds, du);
    echo.innerHTML = `reads as <code>${esc(patternText(spec.legs, spec.rounds, du))}</code>${
      t ? ` <span class="dim">- ${esc(t)}</span>` : ''}`;
  };
  raw.addEventListener('input', showEcho);
  showEcho();
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

  'cardio-pattern': async ({ entry }) => { openPatternBuilder(entry); },
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
