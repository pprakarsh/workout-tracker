// "Routines" — your library of routines, the routine editor, and data/settings.
import {
  state, getRoutine, saveRoutine, createRoutine, deleteRoutine, duplicateRoutine,
  normalizeEntry, lastSessionForRoutine, updateSettings, dataFingerprint,
} from '../store.js';
import { dbPut } from '../db.js';
import { esc, fmtDate, fmtClock, relDay, parseDur } from '../util.js';
import { targetLine, exerciseFormHtml, readExerciseForm } from './entry.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { exportBackup, exportCsv, exportRoutine, importFromText } from '../exportimport.js';

/* ------------------------------------------------------------------ */
/* editor                                                             */
/* ------------------------------------------------------------------ */

function editor(r) {
  const rows = r.entries.map((e, i) => `
    <div class="sess-item">
      <div class="ord">${i + 1}</div>
      <div class="body">
        <div class="nm">${esc(e.name)} ${e.group ? `<span class="pill grp">${esc(e.group)}</span>` : ''}
          ${e.type === 'cardio' ? '<span class="pill">cardio</span>' : ''}</div>
        ${targetLine(e) ? `<div class="sub">${esc(targetLine(e))}</div>` : ''}
        ${e.notes ? `<div class="sub" style="color:var(--warn)">${esc(e.notes)}</div>` : ''}
      </div>
      <div class="acts">
        <button type="button" class="btn icon ghost" data-action="rentry-up"   data-id="${r.id}" data-entry="${e.id}">↑</button>
        <button type="button" class="btn icon ghost" data-action="rentry-down" data-id="${r.id}" data-entry="${e.id}">↓</button>
        <button type="button" class="btn icon ghost" data-action="rentry-edit" data-id="${r.id}" data-entry="${e.id}">✎</button>
        <button type="button" class="btn icon ghost" data-action="rentry-del"  data-id="${r.id}" data-entry="${e.id}">✕</button>
      </div>
    </div>`).join('');

  return `
    <button type="button" class="btn sm ghost" data-action="routines-back">← All routines</button>
    <div class="card" style="margin-top:12px" data-routine="${r.id}">
      <label class="field"><span>Routine name</span>
        <input data-rf="name" value="${esc(r.name)}" autocapitalize="words"></label>
      <label class="field" style="margin-bottom:0"><span>Description</span>
        <textarea data-rf="description" placeholder="e.g. Heavy squat day paired with pressing. 75 min.">${esc(r.description)}</textarea></label>
    </div>

    <h2>Exercises (${r.entries.length})</h2>
    ${rows || '<div class="empty">No exercises yet.</div>'}
    <button type="button" class="btn block primary" style="margin-top:4px" data-action="rentry-add" data-id="${r.id}">+ Add exercise</button>

    <h2>This routine</h2>
    <div class="btn-row">
      <button type="button" class="btn ok" data-action="routine-start" data-id="${r.id}">Start workout</button>
      <button type="button" class="btn" data-action="routine-export" data-id="${r.id}">Export JSON</button>
    </div>
    <div class="btn-row" style="margin-top:8px">
      <button type="button" class="btn ghost" data-action="routine-dupe" data-id="${r.id}">Duplicate</button>
      <button type="button" class="btn danger" data-action="routine-del" data-id="${r.id}">Delete routine</button>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* list + data                                                        */
/* ------------------------------------------------------------------ */

export function render() {
  if (state.nav.routineId) {
    const r = getRoutine(state.nav.routineId);
    if (r) return editor(r);
    state.nav.routineId = null;
  }

  const fp = dataFingerprint();

  return `
    <h2>Routines</h2>
    ${state.routines.length ? state.routines.map((r) => {
    const last = lastSessionForRoutine(r.id);
    const names = r.entries.slice(0, 5).map((e) => e.name);
    return `
      <div class="card routine-card">
        <div class="rc-top">
          <div style="flex:1;min-width:0" data-action="routine-open" data-id="${r.id}" role="button" tabindex="0">
            <div class="rc-name">${esc(r.name)}</div>
            ${r.description ? `<div class="rc-desc">${esc(r.description)}</div>` : ''}
            <div class="rc-meta">${r.entries.length} exercise${r.entries.length === 1 ? '' : 's'}${last ? ` · last done ${esc(relDay(last.startedAt))}` : ' · never done'}</div>
            ${names.length ? `<div class="swatch">${names.map((n) => `<span class="pill">${esc(n)}</span>`).join('')}${r.entries.length > 5 ? `<span class="pill">+${r.entries.length - 5}</span>` : ''}</div>` : ''}
          </div>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button type="button" class="btn sm ok" data-action="routine-start" data-id="${r.id}">Start</button>
          <button type="button" class="btn sm ghost" data-action="routine-open" data-id="${r.id}">Edit</button>
        </div>
      </div>`;
  }).join('')
    : '<div class="empty">No routines yet — create one, or import from JSON.</div>'}

    <div class="btn-row" style="margin-top:4px">
      <button type="button" class="btn primary" data-action="routine-new">+ New routine</button>
      <button type="button" class="btn" data-action="import-open">Import</button>
    </div>

    <h2>Backup &amp; transfer</h2>
    <div class="card">
      <div class="kv"><span>Routines</span><span>${fp.routines}</span></div>
      <div class="kv"><span>Sessions</span><span>${fp.sessions}</span></div>
      <div class="kv"><span>Logged sets</span><span>${fp.loggedSets}</span></div>
      ${fp.oldest ? `<div class="kv"><span>Date range</span><span>${esc(fmtDate(fp.oldest))} → ${esc(fmtDate(fp.newest))}</span></div>` : ''}
      <p class="hint" style="margin-bottom:0">Compare these four numbers on the other device after a restore —
        if they match, the transfer was complete.</p>
    </div>
    <div class="btn-row">
      <button type="button" class="btn" data-action="export-backup">Export full backup (JSON)</button>
      <button type="button" class="btn" data-action="export-csv">Export sets (CSV)</button>
    </div>
    <button type="button" class="btn block ghost" style="margin-top:8px" data-action="import-open">Import / restore from backup</button>

    <h2>Settings</h2>
    <div class="card">
      <div class="kv"><span>Weight unit</span><span>${esc(state.settings.unit)}</span></div>
      <div class="kv"><span>Distance unit</span><span>${esc(state.settings.distanceUnit)}</span></div>
      <div class="kv"><span>Default rest</span><span>${esc(fmtClock(state.settings.defaultRest))}</span></div>
      <div class="kv"><span>Beep at rest target</span><span>${state.settings.beep ? 'on' : 'off'}</span></div>
      <button type="button" class="btn block ghost" style="margin-top:10px" data-action="settings-open">Change settings</button>
    </div>

    <h2>Import format</h2>
    <div class="card">
      <p class="hint" style="margin-top:0">Paste or load JSON shaped like this (every field except
        <code>name</code> is optional):</p>
      <pre class="code">${esc(SAMPLE)}</pre>
      <button type="button" class="btn sm ghost" data-action="sample-copy">Copy sample</button>
    </div>
    <p class="hint center" style="margin-top:18px">All data is stored on this device only.</p>`;
}

export const SAMPLE = `{
  "name": "Squat day with Push Movements",
  "description": "Heavy squats, then pressing. ~75 min.",
  "entries": [
    { "name": "Back Squat", "sets": 5, "reps": "5", "weight": 100, "rest": "3:00" },
    { "name": "Bench Press", "sets": 4, "reps": "6-8", "weight": 70, "rest": "2:30",
      "group": "A", "notes": "pause on chest" },
    { "name": "Chest-Supported Row", "sets": 4, "reps": "10-12", "rest": "2:30", "group": "A" },
    { "type": "cardio", "name": "Treadmill Run", "distance": 3,
      "distanceUnit": "km", "duration": "18:00" }
  ]
}`;

/* ------------------------------------------------------------------ */
/* actions                                                            */
/* ------------------------------------------------------------------ */

function mutateRoutineEntries(id, fn) {
  const r = getRoutine(id);
  if (!r) return null;
  fn(r);
  return saveRoutine(r);
}

export const routineActions = {
  'routines-back': () => { state.nav.routineId = null; },
  'routine-open': ({ id }) => { state.nav.routineId = id; state.tab = 'routines'; },

  'routine-new': () => {
    openModal({
      title: 'New routine',
      bodyHtml: `
        <label class="field"><span>Name</span>
          <input name="name" placeholder="e.g. Run with Upper Body" autocapitalize="words" required></label>
        <label class="field"><span>Description</span>
          <textarea name="description" placeholder="What this day is for, how long it takes, anything."></textarea></label>`,
      okText: 'Create',
      onSubmit: async (v) => {
        if (!v.name.trim()) { toast('Give it a name'); return false; }
        const r = await createRoutine({ name: v.name.trim(), description: (v.description || '').trim() });
        state.nav.routineId = r.id;
        state.tab = 'routines';
        return true;
      },
    });
  },

  'routine-dupe': async ({ id }) => {
    const r = await duplicateRoutine(id);
    if (r) { state.nav.routineId = r.id; toast('Duplicated'); }
  },

  'routine-del': async ({ id }) => {
    const r = getRoutine(id);
    if (!r) return;
    if (await confirmDialog(`Delete the routine "${r.name}"? Past sessions you did with it are kept.`)) {
      await deleteRoutine(id);
      state.nav.routineId = null;
      toast('Routine deleted');
    }
  },

  'routine-export': ({ id }) => {
    const r = getRoutine(id);
    if (r) exportRoutine(r);
  },

  'rentry-add': ({ id }) => {
    openModal({
      title: 'Add exercise',
      bodyHtml: exerciseFormHtml({}),
      okText: 'Add',
      onSubmit: async (v) => {
        const e = readExerciseForm(v);
        if (!e.name) { toast('Name is required'); return false; }
        await mutateRoutineEntries(id, (r) => r.entries.push(normalizeEntry(e)));
        return true;
      },
    });
  },

  'rentry-edit': ({ id, entry }) => {
    const r = getRoutine(id);
    const e = r?.entries.find((x) => x.id === entry);
    if (!e) return;
    openModal({
      title: 'Edit exercise',
      bodyHtml: exerciseFormHtml(e),
      onSubmit: async (v) => {
        const patch = readExerciseForm(v);
        if (!patch.name) { toast('Name is required'); return false; }
        await mutateRoutineEntries(id, (rr) => {
          const i = rr.entries.findIndex((x) => x.id === entry);
          rr.entries[i] = normalizeEntry({ ...rr.entries[i], ...patch });
        });
        return true;
      },
    });
  },

  'rentry-del': async ({ id, entry }) => {
    await mutateRoutineEntries(id, (r) => { r.entries = r.entries.filter((x) => x.id !== entry); });
  },

  'rentry-up': async ({ id, entry }) => {
    await mutateRoutineEntries(id, (r) => {
      const i = r.entries.findIndex((x) => x.id === entry);
      if (i > 0) [r.entries[i - 1], r.entries[i]] = [r.entries[i], r.entries[i - 1]];
    });
  },

  'rentry-down': async ({ id, entry }) => {
    await mutateRoutineEntries(id, (r) => {
      const i = r.entries.findIndex((x) => x.id === entry);
      if (i >= 0 && i < r.entries.length - 1) [r.entries[i + 1], r.entries[i]] = [r.entries[i], r.entries[i + 1]];
    });
  },

  'export-backup': () => { exportBackup(); toast('Backup exported'); },
  'export-csv': () => { exportCsv(); toast('CSV exported'); },

  'sample-copy': async () => {
    try { await navigator.clipboard.writeText(SAMPLE); toast('Sample copied'); }
    catch { toast('Copy not allowed — select the text instead'); }
  },

  'settings-open': () => {
    const s = state.settings;
    openModal({
      title: 'Settings',
      bodyHtml: `
        <div class="grid2">
          <label class="field"><span>Weight unit</span>
            <select name="unit">
              <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option>
              <option value="lb" ${s.unit === 'lb' ? 'selected' : ''}>lb</option>
            </select></label>
          <label class="field"><span>Distance unit</span>
            <select name="distanceUnit">
              <option value="km" ${s.distanceUnit === 'km' ? 'selected' : ''}>km</option>
              <option value="mi" ${s.distanceUnit === 'mi' ? 'selected' : ''}>mi</option>
            </select></label>
        </div>
        <label class="field"><span>Default rest when a routine doesn't set one</span>
          <input name="defaultRest" value="${esc(fmtClock(s.defaultRest))}" inputmode="text" placeholder="2:00"></label>
        <label class="field"><span>Beep when the rest target is reached</span>
          <select name="beep">
            <option value="1" ${s.beep ? 'selected' : ''}>On</option>
            <option value="0" ${!s.beep ? 'selected' : ''}>Off</option>
          </select></label>
        <p class="hint">The unit is stored on each set as you log it, so switching later
          never rewrites your history.</p>`,
      onSubmit: async (v) => {
        await updateSettings({
          unit: v.unit, distanceUnit: v.distanceUnit,
          defaultRest: parseDur(v.defaultRest) ?? 120,
          beep: v.beep === '1',
        });
        toast('Settings saved');
        return true;
      },
    });
  },

  'import-open': () => {
    const modal = openModal({
      title: 'Import / restore',
      bodyHtml: `
        <label class="field"><span>Pick a .json file</span>
          <input type="file" name="file" id="impFile" accept=".json,application/json" data-nofocus></label>
        <label class="field"><span>…or paste JSON</span>
          <textarea name="text" id="impText" placeholder='{ "name": "My routine", "entries": [ … ] }' style="min-height:140px"></textarea></label>
        <label class="field"><span>If this is a full backup</span>
          <select name="mode">
            <option value="merge">Merge — add what's missing, keep what's here</option>
            <option value="replace">Replace — wipe this device and restore exactly</option>
          </select></label>
        <p class="hint"><b>Replace</b> makes this device an exact copy of the backup: same routines,
          same sessions, same ids, including any workout that was still in progress.
          It deletes everything currently on this device first.</p>`,
      okText: 'Import',
      onSubmit: async (v) => {
        const text = (v.text || '').trim();
        if (!text) { toast('Choose a file or paste JSON'); return false; }
        if (v.mode === 'replace') {
          // confirmDialog takes over the modal root, so whatever happens next
          // this modal is already gone.
          const ok = await confirmDialog(
            'Replace ALL data on this device with the contents of this backup? Everything currently here is deleted.',
            { okText: 'Replace everything' },
          );
          if (!ok) { toast('Import cancelled'); return true; }
        }
        try {
          const res = await importFromText(text, { mode: v.mode });
          const parts = [];
          if (res.routines) parts.push(`${res.routines} routine${res.routines === 1 ? '' : 's'}`);
          if (res.sessions) parts.push(`${res.sessions} session${res.sessions === 1 ? '' : 's'}`);
          if (res.skipped) parts.push(`${res.skipped} already present`);
          toast(parts.length ? `Imported ${parts.join(', ')}` : 'Nothing new to import', 3200);
          if (res.expected && res.actual) {
            const match = res.expected.sessions === res.actual.sessions
              && res.expected.routines === res.actual.routines
              && res.expected.loggedSets === res.actual.loggedSets;
            setTimeout(() => toast(match
              ? `Verified: ${res.actual.routines} routines, ${res.actual.sessions} sessions, ${res.actual.loggedSets} sets`
              : `Warning: counts differ — expected ${res.expected.sessions} sessions / ${res.expected.loggedSets} sets, got ${res.actual.sessions} / ${res.actual.loggedSets}`, 5000), 3400);
          }
          state.nav = {};
          return true;
        } catch (err) {
          toast(err.message, 4800);
          return false;
        }
      },
    });

    // load a chosen file into the textarea
    const file = modal.querySelector('#impFile');
    const text = modal.querySelector('#impText');
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => { text.value = String(fr.result || ''); toast(`Loaded ${f.name}`); };
      fr.onerror = () => toast('Could not read that file');
      fr.readAsText(f);
    });
  },
};

/** Routine name/description edits (data-rf). Called from app.js. */
export async function handleRoutineField(target) {
  const f = target.dataset.rf;
  const box = target.closest('[data-routine]');
  if (!f || !box) return;
  const r = getRoutine(box.dataset.routine);
  if (!r) return;
  r[f] = target.value;
  r.updatedAt = Date.now();
  // persist without a re-render so the caret stays put
  await dbPut('routines', r);
}
