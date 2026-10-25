// "History" — past sessions, newest first, a read-only detail view, and an
// editable mode for correcting a finished session.
import {
  state, deleteSession, getSession, sessionProgress, sessionVolume,
  setEditing, updateSessionTiming,
} from '../store.js';
import {
  esc, fmtDate, fmtTimeOfDay, fmtDur, fmtNum, relDay, isoDate,
} from '../util.js';
import { renderEntryStatic, renderEntry } from './entry.js';
import { logSummary } from '../format.js';
import { exportSessionMarkdown, exportSessionJson, exportCsv } from '../exportimport.js';
import { confirmDialog, toast, openModal } from '../ui.js';

/* ------------------------------------------------------------------ */
/* editable detail (correcting a finished session)                    */
/* ------------------------------------------------------------------ */

function editDetail(s) {
  const end = s.finishedAt || s.updatedAt || Date.now();
  const { done, total } = sessionProgress(s);
  return `
    <div class="card flat" style="margin-bottom:12px">
      <div class="row">
        <div style="flex:1;min-width:0">
          <div class="strong" style="font-size:17px">${esc(s.routineName)}</div>
          <div class="small dim">Editing · ${esc(fmtDate(s.startedAt))} · ${done}/${total} done</div>
        </div>
        <button type="button" class="btn ok" data-action="hist-edit-done">Done</button>
      </div>
      <p class="hint" style="margin-bottom:0">Changes save as you type. This only edits the
        recorded session — the routine is untouched.</p>
    </div>

    <div class="btn-row">
      <button type="button" class="btn" data-action="hist-timing" data-id="${s.id}">Change date &amp; time</button>
      <button type="button" class="btn" data-action="entry-add">+ Add exercise</button>
    </div>

    <h2>Log</h2>
    ${s.entries.map((e) => renderEntry(e, { showLast: false, allowRest: false })).join('')
      || '<div class="empty">No exercises. Add one above.</div>'}

    <h2>Session totals</h2>
    <div class="card" data-sessmeta="1">
      <div class="grid2">
        <label class="field"><span>Overall effort (RPE 1–10)</span>
          <input inputmode="decimal" data-sf="rpe" value="${esc(fmtNum(s.rpe))}"></label>
        <label class="field"><span>Bodyweight (${esc(s.unit)})</span>
          <input inputmode="decimal" data-sf="bodyweight" value="${esc(fmtNum(s.bodyweight))}"></label>
      </div>
      <label class="field" style="margin-bottom:0"><span>Notes</span>
        <textarea data-sf="notes">${esc(s.notes || '')}</textarea></label>
    </div>

    <div class="divider"></div>
    <div class="small dim center">Recorded ${esc(fmtTimeOfDay(s.startedAt))}–${esc(fmtTimeOfDay(end))}
      · ${esc(fmtDur((end - s.startedAt) / 1000))}</div>
    <button type="button" class="btn block ok" style="margin-top:12px" data-action="hist-edit-done">Done editing</button>`;
}

/* ------------------------------------------------------------------ */
/* read-only detail                                                   */
/* ------------------------------------------------------------------ */

function detail(s) {
  const end = s.finishedAt || s.updatedAt || Date.now();
  const { done, total } = sessionProgress(s);
  const vol = sessionVolume(s);
  return `
    <button type="button" class="btn sm ghost" data-action="hist-back">← All sessions</button>
    <div class="card" style="margin-top:12px">
      <div class="row">
        <div style="flex:1;min-width:0">
          <div class="strong" style="font-size:18px">${esc(s.routineName)}</div>
          <div class="small dim" style="margin-top:3px">
            ${esc(fmtDate(s.startedAt))} · ${esc(fmtTimeOfDay(s.startedAt))}–${esc(fmtTimeOfDay(end))}
            · ${esc(fmtDur((end - s.startedAt) / 1000))}${s.finishedAt ? '' : ' · unfinished'}
          </div>
        </div>
        <button type="button" class="btn sm" data-action="hist-edit" data-id="${s.id}">Edit</button>
      </div>
      <div class="divider"></div>
      <div class="kv"><span>Exercises completed</span><span>${done}/${total}</span></div>
      ${vol ? `<div class="kv"><span>Total volume</span><span>${fmtNum(vol)} ${esc(s.unit)}</span></div>` : ''}
      ${s.rpe !== null && s.rpe !== undefined ? `<div class="kv"><span>Overall effort</span><span>RPE ${fmtNum(s.rpe)}</span></div>` : ''}
      ${s.bodyweight !== null && s.bodyweight !== undefined ? `<div class="kv"><span>Bodyweight</span><span>${fmtNum(s.bodyweight)} ${esc(s.unit)}</span></div>` : ''}
    </div>
    ${s.notes ? `<div class="card"><div class="tiny">Notes</div><div style="white-space:pre-wrap;margin-top:4px">${esc(s.notes)}</div></div>` : ''}

    <h2>Log</h2>
    ${s.entries.map(renderEntryStatic).join('') || '<div class="empty">Nothing logged.</div>'}

    <h2>Export this session</h2>
    <div class="btn-row">
      <button type="button" class="btn" data-action="hist-md"   data-id="${s.id}">Markdown</button>
      <button type="button" class="btn" data-action="hist-json" data-id="${s.id}">JSON</button>
    </div>
    <button type="button" class="btn block danger" style="margin-top:14px" data-action="hist-del" data-id="${s.id}">Delete this session</button>`;
}

export function render() {
  if (state.nav.sessionId) {
    const s = getSession(state.nav.sessionId);
    if (s) return state.editSessionId === s.id ? editDetail(s) : detail(s);
    state.nav.sessionId = null;
    state.editSessionId = null;
  }

  const list = state.sessions.filter((s) => !(state.active && s.id === state.active.id));
  if (!list.length) {
    return `<div class="empty">No finished workouts yet.${state.active ? '<br>Your current session shows up here once you finish it.' : ''}</div>`;
  }

  return `
    <h2>${list.length} session${list.length === 1 ? '' : 's'}</h2>
    ${list.map((s) => {
    const { done, total } = sessionProgress(s);
    const end = s.finishedAt || s.updatedAt || s.startedAt;
    const top = s.entries.map((e) => logSummary(e) && e.name).filter(Boolean).slice(0, 4).join(' · ');
    return `
      <div class="sess-item" data-action="hist-open" data-id="${s.id}" role="button" tabindex="0">
        <div class="body">
          <div class="nm">${esc(s.routineName)}</div>
          <div class="sub">${esc(relDay(s.startedAt))} · ${esc(fmtTimeOfDay(s.startedAt))} · ${esc(fmtDur((end - s.startedAt) / 1000))} · ${done}/${total} done${s.finishedAt ? '' : ' · unfinished'}</div>
          ${top ? `<div class="loglines">${esc(top)}</div>` : ''}
        </div>
        <div class="dim">›</div>
      </div>`;
  }).join('')}
    <div class="divider"></div>
    <button type="button" class="btn block ghost" data-action="hist-csv">Export all sessions as CSV</button>`;
}

export const historyActions = {
  'hist-open': ({ id }) => { state.nav.sessionId = id; },
  'hist-back': async () => { state.nav.sessionId = null; await setEditing(null); },
  'hist-edit': async ({ id }) => { state.nav.sessionId = id; await setEditing(id); },
  'hist-edit-done': async () => { await setEditing(null); toast('Changes saved'); },

  'hist-timing': ({ id }) => {
    const s = getSession(id);
    if (!s) return;
    const end = s.finishedAt || s.updatedAt || s.startedAt;
    openModal({
      title: 'Date & time',
      bodyHtml: `
        <label class="field"><span>Date</span>
          <input type="date" name="date" value="${esc(isoDate(s.startedAt))}"></label>
        <div class="grid2">
          <label class="field"><span>Started</span>
            <input type="time" name="start" value="${esc(fmtTimeOfDay(s.startedAt))}"></label>
          <label class="field"><span>Finished</span>
            <input type="time" name="end" value="${esc(fmtTimeOfDay(end))}"></label>
        </div>
        <p class="hint">Use this to move a workout to the day it actually happened — handy if you
          logged it late. A finish time earlier than the start is treated as next-day.</p>`,
      onSubmit: async (v) => {
        const [y, mo, d] = String(v.date || '').split('-').map(Number);
        if (!y || !mo || !d) { toast('Pick a valid date'); return false; }
        const at = (hhmm, dayOffset = 0) => {
          const [h, mi] = String(hhmm || '00:00').split(':').map(Number);
          return new Date(y, mo - 1, d + dayOffset, h || 0, mi || 0).getTime();
        };
        const startedAt = at(v.start);
        let finishedAt = at(v.end);
        if (finishedAt < startedAt) finishedAt = at(v.end, 1); // crossed midnight
        await updateSessionTiming(id, { startedAt, finishedAt });
        toast('Date updated');
        return true;
      },
    });
  },

  'hist-md': ({ id }) => { const s = getSession(id); if (s) exportSessionMarkdown(s); },
  'hist-json': ({ id }) => { const s = getSession(id); if (s) exportSessionJson(s); },
  'hist-csv': () => { exportCsv(); toast('CSV exported'); },
  'hist-del': async ({ id }) => {
    const s = getSession(id);
    if (!s) return;
    if (await confirmDialog(`Delete the ${fmtDate(s.startedAt)} "${s.routineName}" session? This cannot be undone.`)) {
      await deleteSession(id);
      state.nav.sessionId = null;
      await setEditing(null);
      toast('Session deleted');
    }
  },
};
