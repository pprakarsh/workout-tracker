// Shared renderer for one exercise (used by the Now view, the Session view and
// the read-only History view) plus the actions that belong to it.
import {
  state, findEntry, addSet, deleteSet, updateSet, toggleSetDone, toggleSkip,
  removeSessionEntry, moveSessionEntry, updateSessionEntry, startRest, entryStatus,
  lastLogFor, addSessionEntry, updateLog, working, editingPast, plannedSet, fillPlannedSets,
  parseSetTargets,
} from '../store.js';
import { esc, fmtNum, fmtReps, fmtClock, fmtDur, num, parseDur, parseReps, relDay } from '../util.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { unlockAudio } from '../timer.js';

/* ------------------------------------------------------------------ */
/* summaries                                                          */
/* ------------------------------------------------------------------ */

/** "60×10 · 70×8 · 80×5" for a per-set plan. */
export function planLine(e) {
  if (!e.setTargets) return '';
  return e.setTargets
    .map((t) => `${t.weight !== null ? fmtNum(t.weight) : ''}×${fmtReps(t.repsMin, t.repsMax) || '?'}`)
    .join(' · ');
}

export function targetLine(e) {
  const bits = [];
  if (e.type === 'lift') {
    if (e.setTargets) {
      bits.push(`${e.setTargets.length} sets: ${planLine(e)} ${e.unit || state.settings.unit}`);
    } else {
      const reps = fmtReps(e.repsMin, e.repsMax);
      const sets = e.targetSets ? `${fmtNum(e.targetSets)} ×` : '';
      if (sets || reps) bits.push(`${sets} ${reps || '?'}`.trim());
      if (e.weight !== null && e.weight !== undefined) bits.push(`@ ${fmtNum(e.weight)} ${e.unit || state.settings.unit}`);
    }
  } else {
    if (e.targetDistance !== null && e.targetDistance !== undefined) {
      bits.push(`${fmtNum(e.targetDistance)} ${e.distanceUnit || state.settings.distanceUnit}`);
    }
    if (e.targetDuration) bits.push(fmtDur(e.targetDuration));
  }
  if (e.rest) bits.push(`rest ${fmtClock(e.rest)}`);
  return bits.join(' · ');
}

export function pace(distance, seconds, unit) {
  if (!distance || !seconds) return '';
  return `${fmtClock(seconds / distance)}/${unit || 'km'}`;
}

/** One-line summary of what was actually logged, for list views and exports. */
export function logSummary(e) {
  if (e.type === 'cardio') {
    const l = e.log || {};
    const bits = [];
    if (l.distance !== null && l.distance !== undefined) bits.push(`${fmtNum(l.distance)} ${l.distanceUnit || 'km'}`);
    if (l.duration) bits.push(fmtClock(l.duration));
    const p = pace(l.distance, l.duration, l.distanceUnit);
    if (p) bits.push(p);
    if (l.avgHr) bits.push(`avg ${fmtNum(l.avgHr)} bpm`);
    if (l.maxHr) bits.push(`max ${fmtNum(l.maxHr)} bpm`);
    if (l.elevation) bits.push(`${fmtNum(l.elevation)} m elev`);
    if (l.rpe) bits.push(`RPE ${fmtNum(l.rpe)}`);
    return bits.join(' · ');
  }
  const sets = (e.sets || []).filter((s) => s.done || s.reps !== null || s.weight !== null);
  if (!sets.length) return '';
  return sets.map((s) => {
    const w = s.weight !== null ? `${fmtNum(s.weight)}${s.unit || ''}` : '—';
    const r = s.reps !== null ? fmtNum(s.reps) : '—';
    return `${w}×${r}${s.rpe ? ` @${fmtNum(s.rpe)}` : ''}`;
  }).join('  ');
}

function lastRefHtml(e) {
  const hit = lastLogFor(e.name, working()?.id);
  if (!hit) return '<div class="lastref dim">No previous log for this exercise.</div>';
  const sum = logSummary(hit.entry);
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
        <div class="ex-name">${esc(e.name)}
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

function setRow(e, s, i, allowRest) {
  const unit = s.unit || e.unit || state.settings.unit;
  const plan = plannedSet(e, i);
  const wPh = plan && plan.weight !== null && plan.weight !== undefined ? fmtNum(plan.weight) : esc(unit);
  const rPh = plan && fmtReps(plan.repsMin, plan.repsMax) ? fmtReps(plan.repsMin, plan.repsMax) : 'reps';
  return `
    <div class="set-row ${s.done ? 'done' : ''}" data-entry="${e.id}" data-set="${s.id}">
      <div class="idx">${i + 1}</div>
      <input inputmode="decimal" enterkeyhint="next" data-f="weight" placeholder="${wPh}"
             value="${esc(fmtNum(s.weight))}" aria-label="Weight set ${i + 1}">
      <input inputmode="numeric" enterkeyhint="next" data-f="reps" placeholder="${esc(rPh)}"
             value="${esc(fmtNum(s.reps))}" aria-label="Reps set ${i + 1}">
      <input inputmode="decimal" enterkeyhint="done" data-f="rpe" placeholder="RPE"
             value="${esc(fmtNum(s.rpe))}" aria-label="RPE set ${i + 1}">
      <button type="button" class="chk ${s.done ? 'on' : ''}" title="Mark set done"
              data-action="set-done" data-entry="${e.id}" data-set="${s.id}">✓</button>
      ${allowRest ? `<button type="button" class="rest-btn" title="Finish set and start rest"
              data-action="rest-start" data-entry="${e.id}" data-set="${s.id}">⏱</button>`
    : '<div></div>'}
    </div>`;
}

function liftBody(e, allowRest) {
  const rows = (e.sets || []).map((s, i) => setRow(e, s, i, allowRest)).join('');
  const planned = e.setTargets ? e.setTargets.length : (e.targetSets ?? 0);
  const missing = Math.max(0, planned - (e.sets || []).length);
  const restNote = (e.sets || []).some((s) => s.rest)
    ? `<div class="small dim" style="margin-top:6px">Rest taken: ${(e.sets || [])
      .map((s, i) => (s.rest ? `set ${i + 1}: ${fmtClock(s.rest)}` : null))
      .filter(Boolean).join(' · ')}</div>`
    : '';
  return `
    <div class="sets">
      <div class="set-hdr"><div>#</div><div>Weight</div><div>Reps</div><div>RPE</div><div></div><div></div></div>
      ${rows || '<p class="hint" style="margin:2px 0 8px">No sets logged yet.</p>'}
    </div>
    <div class="set-foot">
      <button type="button" class="btn sm primary" data-action="set-add" data-entry="${e.id}">+ Add set</button>
      ${missing > 1 ? `<button type="button" class="btn sm" data-action="set-fill" data-entry="${e.id}">+ All ${missing} planned</button>` : ''}
      ${(e.sets || []).length ? `<button type="button" class="btn sm ghost" data-action="set-del-last" data-entry="${e.id}">− Remove last</button>` : ''}
    </div>
    ${restNote}`;
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
  return `
  <div class="card">
    <div class="ex-name">${esc(e.name)} ${e.group ? `<span class="pill grp">${esc(e.group)}</span>` : ''}
      ${e.skipped ? '<span class="pill skip">skipped</span>' : ''}</div>
    ${targetLine(e) ? `<div class="ex-target">target: ${esc(targetLine(e))}</div>` : ''}
    ${sum ? `<div class="loglines" style="margin-top:7px">${sum.split('  ').map((x) => `<code>${esc(x)}</code>`).join('')}</div>`
      : '<div class="loglines dim" style="margin-top:7px">nothing logged</div>'}
    ${e.notes ? `<div class="ex-notes">${esc(e.notes)}</div>` : ''}
    ${e.type === 'cardio' && e.log?.note ? `<div class="small dim" style="margin-top:5px">${esc(e.log.note)}</div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* exercise form (add / edit) — shared with the routine editor         */
/* ------------------------------------------------------------------ */

const stRow = (i, t = {}) => `
  <div class="strow" data-strow>
    <div class="idx"></div>
    <input data-stf="w" inputmode="decimal" placeholder="weight"
           value="${esc(fmtNum(t.weight))}" aria-label="Set weight">
    <input data-stf="r" inputmode="text" placeholder="reps"
           value="${esc(fmtReps(t.repsMin ?? null, t.repsMax ?? null))}" aria-label="Set reps">
    <button type="button" class="chk" data-strow-del title="Remove this set">✕</button>
  </div>`;

export function exerciseFormHtml(e = {}) {
  const type = e.type === 'cardio' ? 'cardio' : 'lift';
  const perSet = !!(e.setTargets && e.setTargets.length);
  const rows = perSet ? e.setTargets.map((t, i) => stRow(i, t)).join('') : stRow(0);
  return `
    <label class="field"><span>Exercise name</span>
      <input name="name" list="exerciseNames" autocapitalize="words" placeholder="e.g. Back Squat"
             value="${esc(e.name || '')}" required></label>
    <label class="field"><span>Type</span>
      <select name="type">
        <option value="lift" ${type === 'lift' ? 'selected' : ''}>Lifting / bodyweight (sets & reps)</option>
        <option value="cardio" ${type === 'cardio' ? 'selected' : ''}>Cardio / run (distance & time)</option>
      </select></label>

    <label class="field" style="margin-bottom:6px"><span>Set targets</span>
      <select name="mode" id="exMode">
        <option value="uniform" ${perSet ? '' : 'selected'}>Same target for every set</option>
        <option value="perset" ${perSet ? 'selected' : ''}>Different weight / reps per set</option>
      </select></label>

    <div id="exUniform" ${perSet ? 'hidden' : ''}>
      <p class="hint" style="margin-top:0">For ascending loads or a pyramid, switch the selector
        above to <b>Different weight / reps per set</b>.</p>
      <div class="grid2">
        <label class="field"><span>Target sets</span>
          <input name="targetSets" inputmode="numeric" value="${esc(fmtNum(e.targetSets))}"></label>
        <label class="field"><span>Target reps (e.g. 8-12)</span>
          <input name="reps" inputmode="text" value="${esc(fmtReps(e.repsMin ?? null, e.repsMax ?? null))}"></label>
      </div>
      <label class="field"><span>Target weight</span>
        <input name="weight" inputmode="decimal" value="${esc(fmtNum(e.weight))}"></label>
    </div>

    <div id="exPerSet" ${perSet ? '' : 'hidden'}>
      <div class="strow-hdr"><div>Set</div><div>Weight</div><div>Reps</div><div></div></div>
      <div id="exRows">${rows}</div>
      <button type="button" class="btn sm" id="exAddRow" style="margin:2px 0 10px">+ Add a set</button>
      <p class="hint" style="margin-top:0">Leave a weight blank for bodyweight. Reps can be a
        range such as <code>8-12</code>.</p>
    </div>

    <label class="field"><span>Rest between sets (mm:ss or 90s)</span>
      <input name="rest" inputmode="text" placeholder="2:00" value="${e.rest ? esc(fmtClock(e.rest)) : ''}"></label>

    <div class="grid2">
      <label class="field"><span>Target distance (cardio)</span>
        <input name="targetDistance" inputmode="decimal" value="${esc(fmtNum(e.targetDistance))}"></label>
      <label class="field"><span>Target duration (cardio)</span>
        <input name="targetDuration" inputmode="text" placeholder="30:00"
               value="${e.targetDuration ? esc(fmtClock(e.targetDuration)) : ''}"></label>
    </div>
    <label class="field"><span>Superset / circuit group (optional — same letter = grouped)</span>
      <input name="group" maxlength="4" placeholder="A" value="${esc(e.group || '')}"></label>
    <label class="field"><span>Notes — warmup sets, tempo, cues, setup</span>
      <textarea name="notes" rows="4" placeholder="Warmup: 2×5 @ 50%, 1×3 @ 70%&#10;Tempo 3-1-1&#10;Belt from set 3">${esc(e.notes || '')}</textarea></label>`;
}

/**
 * Wire the add/remove/renumber behaviour of the per-set grid, and the toggle
 * between uniform and per-set mode. Call once after opening the form.
 */
export function wireExerciseForm(modal) {
  const mode = modal.querySelector('#exMode');
  const uniform = modal.querySelector('#exUniform');
  const perSet = modal.querySelector('#exPerSet');
  const rows = modal.querySelector('#exRows');
  if (!mode || !rows) return;

  const renumber = () => {
    [...rows.querySelectorAll('[data-strow]')].forEach((row, i) => {
      row.querySelector('.idx').textContent = String(i + 1);
    });
  };
  const applyMode = () => {
    const per = mode.value === 'perset';
    uniform.hidden = per;
    perSet.hidden = !per;
  };

  mode.addEventListener('change', applyMode);
  modal.querySelector('#exAddRow').addEventListener('click', () => {
    const last = rows.querySelector('[data-strow]:last-child');
    rows.insertAdjacentHTML('beforeend', stRow(0));
    // carry the previous row's weight forward, which is usually what you want
    const fresh = rows.querySelector('[data-strow]:last-child');
    if (last) {
      fresh.querySelector('[data-stf="w"]').value = last.querySelector('[data-stf="w"]').value;
      fresh.querySelector('[data-stf="r"]').value = last.querySelector('[data-stf="r"]').value;
    }
    renumber();
  });
  rows.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-strow-del]');
    if (!btn) return;
    if (rows.querySelectorAll('[data-strow]').length > 1) btn.closest('[data-strow]').remove();
    else {
      btn.closest('[data-strow]').querySelectorAll('input').forEach((i) => { i.value = ''; });
    }
    renumber();
  });

  renumber();
  applyMode();
}

/** Read the exercise form. `modal` is required to read the per-set grid. */
export function readExerciseForm(v, modal = null) {
  const reps = parseReps(v.reps);
  const base = {
    type: v.type === 'cardio' ? 'cardio' : 'lift',
    name: (v.name || '').trim(),
    targetDistance: num(v.targetDistance),
    targetDuration: parseDur(v.targetDuration),
    rest: parseDur(v.rest),
    group: (v.group || '').trim() || null,
    notes: (v.notes || '').trim(),
  };

  if (v.mode === 'perset' && modal) {
    const setTargets = [...modal.querySelectorAll('#exRows [data-strow]')]
      .map((row) => ({
        weight: num(row.querySelector('[data-stf="w"]').value),
        reps: row.querySelector('[data-stf="r"]').value,
      }))
      .filter((t) => t.weight !== null || String(t.reps).trim() !== '');
    const parsed = parseSetTargets(setTargets);
    if (parsed) {
      return {
        ...base, setTargets: parsed, targetSets: parsed.length,
        repsMin: null, repsMax: null, weight: null,
      };
    }
  }

  return {
    ...base,
    setTargets: null,
    targetSets: num(v.targetSets),
    repsMin: reps.min,
    repsMax: reps.max,
    weight: num(v.weight),
  };
}

/* ------------------------------------------------------------------ */
/* actions                                                            */
/* ------------------------------------------------------------------ */

function restLabelFor(e, setIdx) {
  return setIdx === null ? `Rest — ${e.name}` : `Rest after ${e.name} set ${setIdx + 1}`;
}

export const entryActions = {
  'set-add': async ({ entry }) => { await addSet(entry); },

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

  'entry-add': async () => {
    const modal = openModal({
      title: 'Add exercise to this session',
      bodyHtml: exerciseFormHtml({}),
      okText: 'Add',
      onSubmit: async (v, m) => {
        const e = readExerciseForm(v, m);
        if (!e.name) { toast('Name is required'); return false; }
        await addSessionEntry(e);
        toast('Added to this session only');
        return true;
      },
    });
    wireExerciseForm(modal);
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
      : field === 'duration' ? parseDur(target.value)
        : num(target.value);
    await updateLog(logBox.dataset.entry, patch, { silent: true });
  }
}
