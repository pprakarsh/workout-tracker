// Shared renderer for one exercise (used by the Now view, the Session view and
// the read-only History view) plus the actions that belong to it.
import {
  state, findEntry, addSet, deleteSet, updateSet, toggleSetDone, toggleSkip,
  removeSessionEntry, moveSessionEntry, updateSessionEntry, startRest, entryStatus,
  lastLogFor, addSessionEntry, updateLog, working, editingPast, plannedSet, fillPlannedSets,
  parseSetTargets, exerciseLibrary, findInLibrary, getRoutine, saveRoutine, normalizeEntry,
  setLabels, workingSets, toggleWarmup,
} from '../store.js';
import { esc, fmtNum, fmtReps, fmtClock, num, parseDur, relDay, normName } from '../util.js';
import { planLine, targetLine, pace, logSummary, restLine } from '../format.js';
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
  const unit = s.unit || e.unit || state.settings.unit;
  const plan = s.warmup ? null : plannedSet(e, workingIdx);
  const wPh = plan && plan.weight !== null && plan.weight !== undefined ? fmtNum(plan.weight) : esc(unit);
  const rPh = plan && fmtReps(plan.repsMin, plan.repsMax) ? fmtReps(plan.repsMin, plan.repsMax) : 'reps';
  return `
    <div class="set-row ${rowClass()} ${s.done ? 'done' : ''} ${s.warmup ? 'warm' : ''}"
         data-entry="${e.id}" data-set="${s.id}">
      <button type="button" class="idx" data-action="set-warmup" data-entry="${e.id}" data-set="${s.id}"
              title="${s.warmup ? 'Make this a working set' : 'Mark as a warmup set'}"
              aria-label="Set ${esc(label)}, tap to toggle warmup">${esc(label)}</button>
      <input inputmode="decimal" enterkeyhint="next" data-f="weight" placeholder="${wPh}"
             value="${esc(fmtNum(s.weight))}" aria-label="Weight set ${esc(label)}">
      <input inputmode="numeric" enterkeyhint="next" data-f="reps" placeholder="${esc(rPh)}"
             value="${esc(fmtNum(s.reps))}" aria-label="Reps set ${esc(label)}">
      ${showRpe() ? `<input inputmode="decimal" enterkeyhint="next" data-f="rpe" placeholder="RPE"
             value="${esc(fmtNum(s.rpe))}" aria-label="RPE set ${esc(label)}">` : ''}
      ${showRir() ? `<input inputmode="decimal" enterkeyhint="done" data-f="rir" placeholder="RIR"
             value="${esc(fmtNum(s.rir))}" aria-label="Reps in reserve, set ${esc(label)}">` : ''}
      <button type="button" class="chk ${s.done ? 'on' : ''}" title="Mark set done"
              data-action="set-done" data-entry="${e.id}" data-set="${s.id}">✓</button>
      ${allowRest ? `<button type="button" class="rest-btn" title="Finish set and start rest"
              data-action="rest-start" data-entry="${e.id}" data-set="${s.id}">⏱</button>`
    : '<div></div>'}
    </div>`;
}

/**
 * The +/- strip. It is hidden until a numeric field in this card is focused, and
 * acts on whatever is focused. Buttons cancel pointerdown so focus is not lost,
 * and they write through an input event so the normal silent-save path runs
 * without a re-render — which is what keeps the keyboard up.
 */
function stepBar(e) {
  const w = fmtNum(state.settings.weightStep);
  return `
    <div class="stepbar" data-stepbar="${e.id}" hidden>
      <button type="button" data-step="weight" data-delta="-${w}">−${w}</button>
      <button type="button" data-step="weight" data-delta="${w}">+${w}</button>
      <button type="button" data-step="reps" data-delta="-1">−1 rep</button>
      <button type="button" data-step="reps" data-delta="1">+1 rep</button>
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
      <div class="set-hdr ${rowClass()}">
        <div>Set</div><div>Weight</div><div>Reps</div>
        ${showRpe() ? '<div>RPE</div>' : ''}${showRir() ? '<div>RIR</div>' : ''}
        <div></div><div></div>
      </div>
      ${rows || '<p class="hint" style="margin:2px 0 8px">No sets logged yet.</p>'}
    </div>
    ${stepBar(e)}
    <div class="set-foot">
      <button type="button" class="btn sm primary" data-action="set-add" data-entry="${e.id}">+ Add set</button>
      <button type="button" class="btn sm ghost" data-action="set-add-warmup" data-entry="${e.id}">+ Warmup</button>
      ${missing > 1 ? `<button type="button" class="btn sm" data-action="set-fill" data-entry="${e.id}">+ All ${missing} planned</button>` : ''}
      ${sets.length ? `<button type="button" class="btn sm ghost" data-action="set-del-last" data-entry="${e.id}">− Remove last</button>` : ''}
    </div>
    ${rest ? `<div class="small dim" style="margin-top:6px">${esc(rest)}</div>` : ''}`;
}

function cardioBody(e, allowRest) {
  const l = e.log || {};
  const du = l.distanceUnit || state.settings.distanceUnit;
  const p = pace(l.distance, l.duration, du);
  return `
    <div class="sets" data-entry="${e.id}" data-log="1">
      <div class="grid2">
        <label class="field"><span>Distance (${esc(du)})</span>
          <input inputmode="decimal" data-f="distance" value="${esc(fmtNum(l.distance))}"></label>
        <label class="field"><span>Duration (mm:ss)</span>
          <input inputmode="numeric" data-f="duration" placeholder="24:30" value="${l.duration ? esc(fmtClock(l.duration)) : ''}"></label>
      </div>
      <div class="grid3">
        <label class="field"><span>Avg HR</span>
          <input inputmode="numeric" data-f="avgHr" value="${esc(fmtNum(l.avgHr))}"></label>
        <label class="field"><span>Max HR</span>
          <input inputmode="numeric" data-f="maxHr" value="${esc(fmtNum(l.maxHr))}"></label>
        <label class="field"><span>Elev (m)</span>
          <input inputmode="numeric" data-f="elevation" value="${esc(fmtNum(l.elevation))}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Perceived effort (RPE 1–10)</span>
          <input inputmode="decimal" data-f="rpe" value="${esc(fmtNum(l.rpe))}"></label>
        <label class="field"><span>Note</span>
          <input type="text" data-f="note" value="${esc(l.note || '')}"></label>
      </div>
      ${p ? `<p class="hint" style="margin-top:-2px">Pace: <b class="strong">${esc(p)}</b></p>` : ''}
    </div>
    <div class="set-foot">
      <button type="button" class="btn sm ${l.done ? 'ok' : 'primary'}" data-action="cardio-done" data-entry="${e.id}">
        ${l.done ? '✓ Logged' : 'Mark done'}</button>
      ${allowRest ? `<button type="button" class="btn sm ghost" data-action="rest-start" data-entry="${e.id}">⏱ Rest</button>` : ''}
    </div>`;
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
    ${rest ? `<div class="small dim" style="margin-top:5px">${esc(rest)}</div>` : ''}
    ${e.notes ? `<div class="ex-notes">${esc(e.notes)}</div>` : ''}
    ${e.type === 'cardio' && e.log?.note ? `<div class="small dim" style="margin-top:5px">${esc(e.log.note)}</div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* exercise form (add / edit) — shared with the routine editor         */
/* ------------------------------------------------------------------ */

const stRow = (t = {}) => `
  <div class="strow" data-strow>
    <div class="idx"></div>
    <input data-stf="w" inputmode="decimal" placeholder="weight"
           value="${esc(fmtNum(t.weight))}" aria-label="Set weight">
    <input data-stf="r" inputmode="text" placeholder="reps"
           value="${esc(fmtReps(t.repsMin ?? null, t.repsMax ?? null))}" aria-label="Set reps">
    <button type="button" class="chk" data-strow-del title="Remove this set">✕</button>
  </div>`;

/**
 * One grid row per set. An exercise saved with a single target for all sets is
 * expanded into that many identical rows, so the grid is always the way targets
 * are entered and there is no mode to discover.
 */
function planRows(e) {
  if (e.setTargets && e.setTargets.length) return e.setTargets.map((t) => stRow(t)).join('');
  const n = Math.min(Math.max(num(e.targetSets) ?? 3, 1), 30);
  const t = { weight: e.weight ?? null, repsMin: e.repsMin ?? null, repsMax: e.repsMax ?? null };
  return Array.from({ length: n }, () => stRow(t)).join('');
}

export function exerciseFormHtml(e = {}) {
  const type = e.type === 'cardio' ? 'cardio' : 'lift';
  return `
    <label class="field"><span>Exercise name</span>
      <input name="name" list="exerciseNames" autocapitalize="words" placeholder="e.g. Back Squat"
             value="${esc(e.name || '')}" required></label>
    <label class="field"><span>Type</span>
      <select name="type" id="exType">
        <option value="lift" ${type === 'lift' ? 'selected' : ''}>Lifting / bodyweight (sets & reps)</option>
        <option value="cardio" ${type === 'cardio' ? 'selected' : ''}>Cardio / run (distance & time)</option>
      </select></label>

    <div id="exLift" ${type === 'cardio' ? 'hidden' : ''}>
      <div class="tiny" style="margin:2px 0 7px">Sets — weight and reps for each set</div>
      <div class="strow-hdr"><div>Set</div><div>Weight</div><div>Reps</div><div></div></div>
      <div id="exRows">${planRows(e)}</div>
      <div class="btn-row" style="margin:2px 0 8px">
        <button type="button" class="btn sm" id="exAddRow">+ Add set</button>
        <button type="button" class="btn sm ghost" id="exCopyDown" title="Copy set 1 into every set">Copy set 1 down</button>
      </div>
      <p class="hint" style="margin-top:0">Reps can be a range such as <code>8-12</code>.
        Leave the weight blank for bodyweight.</p>
    </div>

    <div id="exCardio" ${type === 'lift' ? 'hidden' : ''}>
      <div class="grid2">
        <label class="field"><span>Target distance</span>
          <input name="targetDistance" inputmode="decimal" value="${esc(fmtNum(e.targetDistance))}"></label>
        <label class="field"><span>Target duration</span>
          <input name="targetDuration" inputmode="text" placeholder="30:00"
                 value="${e.targetDuration ? esc(fmtClock(e.targetDuration)) : ''}"></label>
      </div>
      <label class="field"><span>Repeat (intervals)</span>
        <input name="repeat" inputmode="numeric" placeholder="1"
               value="${esc(fmtNum(e.repeat))}"></label>
      <p class="hint" style="margin-top:-4px">A cardio entry logs one effort. Set this to 6 for
        6 × 400m and starting a workout creates six efforts, grouped together, each logged and
        rested separately.</p>
    </div>

    <label class="field"><span>Rest between sets - 2:30, 90s, or a number of seconds</span>
      <input name="rest" inputmode="text" placeholder="2:00" value="${e.rest ? esc(fmtClock(e.rest)) : ''}"></label>
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

  type.addEventListener('change', () => {
    const cardio = type.value === 'cardio';
    modal.querySelector('#exLift').hidden = cardio;
    modal.querySelector('#exCardio').hidden = !cardio;
  });

  modal.querySelector('#exAddRow').addEventListener('click', () => {
    const last = rows.querySelector('[data-strow]:last-child');
    rows.insertAdjacentHTML('beforeend', stRow());
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
    type: v.type === 'cardio' ? 'cardio' : 'lift',
    name: (v.name || '').trim(),
    targetDistance: num(v.targetDistance),
    targetDuration: parseDur(v.targetDuration, { bare: 'minutes' }),
    rest: parseDur(v.rest),
    group: (v.group || '').trim() || null,
    notes: (v.notes || '').trim(),
  };

  if (base.type === 'cardio' || !modal) {
    return {
      ...base, setTargets: null, targetSets: null, repsMin: null, repsMax: null, weight: null,
      repeat: base.type === 'cardio' ? num(v.repeat) : null,
    };
  }

  const rowEls = [...modal.querySelectorAll('#exRows [data-strow]')];
  const raw = rowEls.map((row) => ({
    weight: num(row.querySelector('[data-stf="w"]').value),
    reps: row.querySelector('[data-stf="r"]').value,
  }));
  const parsed = parseSetTargets(raw.filter((t) => t.weight !== null || String(t.reps).trim() !== ''));

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

  'cardio-done': async ({ entry }) => {
    const e = findEntry(entry);
    if (!e) return;
    await updateLog(entry, { done: !e.log.done, completedAt: e.log.done ? null : Date.now() });
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
  const field = target.dataset.f;
  if (!field) return;
  const row = target.closest('[data-set]');
  if (row) {
    const patch = {};
    patch[field] = num(target.value);
    await updateSet(row.dataset.entry, row.dataset.set, patch, { silent: true });
    return;
  }
  const logBox = target.closest('[data-log]');
  if (logBox) {
    const patch = {};
    patch[field] = field === 'note' ? target.value
      : field === 'duration' ? parseDur(target.value, { bare: 'minutes' })
        : num(target.value);
    await updateLog(logBox.dataset.entry, patch, { silent: true });
  }
}
