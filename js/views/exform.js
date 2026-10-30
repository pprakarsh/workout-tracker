// The exercise FORM: defining what an exercise is, as opposed to logging one.
//
// Split out of views/entry.js when it reached its 1000-line cap. The seam is
// real rather than arbitrary: this file is about an exercise's DEFINITION --
// its type, measure, targets, per-set plan and notes -- and is shared by the
// routine editor and the mid-session "add exercise" flow. views/entry.js is
// about one exercise being PERFORMED.
import { state, parseSetTargets, getRoutine, saveRoutine, normalizeEntry, addSessionEntry } from '../store.js';
import { exerciseLibrary, findInLibrary } from '../queries.js';
import { esc, fmtNum, fmtClock, num, parseDur, relDay, normName } from '../util.js';
import { parsePace, patternText, parseIntervals, isIntervals } from '../cardio.js';
import { builderHtml, wireBuilder, DEFAULT_LEGS } from './cardio.js';
import { MEASURES, fmtAmountRange, parseMeasure } from '../measure.js';
import { targetLine } from '../format.js';
import { openModal, toast } from '../ui.js';

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

export function openExerciseForm(dest, prefill = {}, { title = 'Add exercise', okText = 'Add' } = {}) {
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
