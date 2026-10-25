// "History" — past sessions, newest first, plus a read-only detail view.
import { state, deleteSession, getSession, sessionProgress, sessionVolume } from '../store.js';
import { esc, fmtDate, fmtTimeOfDay, fmtDur, fmtNum, relDay } from '../util.js';
import { renderEntryStatic, logSummary } from './entry.js';
import { exportSessionMarkdown, exportSessionJson, exportCsv } from '../exportimport.js';
import { confirmDialog, toast } from '../ui.js';

function detail(s) {
  const end = s.finishedAt || s.updatedAt || Date.now();
  const { done, total } = sessionProgress(s);
  const vol = sessionVolume(s);
  return `
    <button type="button" class="btn sm ghost" data-action="hist-back">← All sessions</button>
    <div class="card" style="margin-top:12px">
      <div class="strong" style="font-size:18px">${esc(s.routineName)}</div>
      <div class="small dim" style="margin-top:3px">
        ${esc(fmtDate(s.startedAt))} · ${esc(fmtTimeOfDay(s.startedAt))}–${esc(fmtTimeOfDay(end))}
        · ${esc(fmtDur((end - s.startedAt) / 1000))}${s.finishedAt ? '' : ' · unfinished'}
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
    if (s) return detail(s);
    state.nav.sessionId = null;
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
  'hist-back': () => { state.nav.sessionId = null; },
  'hist-md': ({ id }) => { const s = getSession(id); if (s) exportSessionMarkdown(s); },
  'hist-json': ({ id }) => { const s = getSession(id); if (s) exportSessionJson(s); },
  'hist-csv': () => { exportCsv(); toast('CSV exported'); },
  'hist-del': async ({ id }) => {
    const s = getSession(id);
    if (!s) return;
    if (await confirmDialog(`Delete the ${fmtDate(s.startedAt)} "${s.routineName}" session? This cannot be undone.`)) {
      await deleteSession(id);
      state.nav.sessionId = null;
      toast('Session deleted');
    }
  },
};
