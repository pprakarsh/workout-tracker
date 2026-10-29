// "History" — past sessions, newest first, a read-only detail view, and an
// editable mode for correcting a finished session.
import {
  state, deleteSession, getSession, sessionProgress, sessionVolume,
  setEditing, updateSessionTiming, setHistFilter, markSessionFinished,
} from '../store.js';
import { historyWindow, sessionsIn, groupByMonth } from '../queries.js';
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

  const all = state.sessions.filter((s) => !(state.active && s.id === state.active.id));
  const f = state.histFilter;
  const win = historyWindow(f);
  const list = sessionsIn(all, win);

  if (!all.length) {
    return `<div class="empty">No finished workouts yet.${state.active ? '<br>Your current session shows up here once you finish it.' : ''}</div>`;
  }

  return `
    ${filterBar(f, win, all.length)}
    ${summaryCard(list, win)}
    ${list.length
    ? groupByMonth(list).map((g) => `
      ${f.mode === 'all' || f.mode === 'range' ? `<div class="hist-month">${esc(g.heading)}</div>` : ''}
      ${g.sessions.map(sessionRow).join('')}`).join('')
    : `<div class="empty">Nothing logged in ${esc(win.label.toLowerCase())}.</div>`}
    <div class="divider"></div>
    <button type="button" class="btn block ghost" data-action="hist-csv">Export all sessions as CSV</button>`;
}

/**
 * One row. The DATE is always spelled out, not only the relative label: once
 * there are a few hundred sessions, "3 days ago" stops being the thing you are
 * looking for and "Tue 27 Oct" starts being it. Both are shown, because the
 * relative form is still the faster read for anything recent.
 */
function sessionRow(s) {
  const { done, total } = sessionProgress(s);
  const end = s.finishedAt || s.updatedAt || s.startedAt;
  const top = s.entries.map((e) => logSummary(e) && e.name).filter(Boolean).slice(0, 4).join(' · ');
  const rel = relDay(s.startedAt);
  const abs = fmtDate(s.startedAt);
  return `
    <div class="sess-item${s.finishedAt ? '' : ' open'}" data-action="hist-open" data-id="${s.id}" role="button" tabindex="0">
      <div class="body">
        <div class="nm">${esc(s.routineName)}
          ${s.finishedAt ? '' : '<span class="pill skip">unfinished</span>'}</div>
        <div class="sub"><b>${esc(abs)}</b>${rel === abs ? '' : ` · ${esc(rel)}`}
          · ${esc(fmtTimeOfDay(s.startedAt))} · ${esc(fmtDur((end - s.startedAt) / 1000))} · ${done}/${total} done</div>
        ${top ? `<div class="loglines">${esc(top)}</div>` : ''}
        ${s.finishedAt ? '' : `<button type="button" class="btn xs" style="margin-top:6px"
            data-action="hist-finish" data-id="${s.id}">Mark as done</button>`}
      </div>
      <div class="dim">›</div>
    </div>`;
}

/** Week and month can be stepped; a range needs two date inputs. */
function filterBar(f, win, totalCount) {
  const chip = (mode, label) => `<button type="button"
    class="chip ${f.mode === mode ? 'on' : ''}" data-action="hist-filter" data-mode="${mode}">${label}</button>`;
  const steppable = f.mode === 'week' || f.mode === 'month';
  return `
    <div class="hist-filter">
      <div class="hist-chips">
        ${chip('all', 'All')}${chip('week', 'Week')}${chip('month', 'Month')}${chip('range', 'Dates')}
      </div>
      ${steppable ? `
        <div class="hist-step">
          <button type="button" class="btn icon ghost" data-action="hist-step" data-by="-1"
                  aria-label="Previous ${f.mode}">‹</button>
          <div class="hist-label">
            <div class="strong">${esc(win.label)}</div>
            ${win.sub && win.sub !== win.label ? `<div class="tiny dim">${esc(win.sub)}</div>` : ''}
          </div>
          <button type="button" class="btn icon ghost" data-action="hist-step" data-by="1"
                  ${f.offset >= 0 ? 'disabled' : ''} aria-label="Next ${f.mode}">›</button>
        </div>` : ''}
      ${f.mode === 'range' ? `
        <div class="grid2" data-histrange>
          <label class="field"><span>From</span>
            <input type="date" data-hf="from" value="${esc(f.from || '')}"></label>
          <label class="field"><span>To — leave blank for a single day</span>
            <input type="date" data-hf="to" value="${esc(f.to || '')}"></label>
        </div>
        <p class="hint" style="margin-top:-2px">Set both to the same day, or fill only one, to see
          that one date.</p>` : ''}
      ${f.mode === 'all' ? `<div class="tiny dim">All ${totalCount} session${totalCount === 1 ? '' : 's'}</div>` : ''}
    </div>`;
}

/** What the visible slice adds up to. The reason to filter at all. */
function summaryCard(list, win) {
  if (!list.length) return '';
  const secs = list.reduce((n, s) => n + (((s.finishedAt || s.updatedAt || s.startedAt) - s.startedAt) / 1000), 0);
  const vol = list.reduce((n, s) => n + sessionVolume(s), 0);
  const unit = list[0].unit || 'kg';
  const days = new Set(list.map((s) => isoDate(s.startedAt))).size;
  return `
    <div class="card flat" style="margin-bottom:10px">
      <div class="kv"><span>${esc(win.label)}</span>
        <span class="strong">${list.length} session${list.length === 1 ? '' : 's'}${days !== list.length ? ` on ${days} day${days === 1 ? '' : 's'}` : ''}</span></div>
      <div class="kv"><span>Time training</span><span>${esc(fmtDur(secs))}</span></div>
      ${vol ? `<div class="kv"><span>Total volume</span><span>${fmtNum(Math.round(vol))} ${esc(unit)}</span></div>` : ''}
    </div>`;
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

  'hist-filter': ({ mode }) => {
    setHistFilter({ mode, offset: 0 });
  },

  'hist-step': ({ by }) => {
    // forward is capped at the current week/month: there is no history ahead
    const next = Math.min(0, (state.histFilter.offset || 0) + Number(by));
    setHistFilter({ offset: next });
  },

  'hist-finish': async ({ id }) => {
    const s = getSession(id);
    if (!s) return;
    if (await confirmDialog(
      `Mark the ${fmtDate(s.startedAt)} "${s.routineName}" session as done? Its finish time is set to the last set you logged.`,
      { okText: 'Mark as done', danger: false },
    )) {
      const out = await markSessionFinished(id);
      toast(out ? 'Marked as done' : 'Already done');
    }
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

/** The two date inputs in the range filter. Called from app.js. */
export function handleHistoryField(target) {
  const field = target.dataset.hf;
  if (!field) return;
  setHistFilter({ [field]: target.value || null, mode: 'range' });
}
