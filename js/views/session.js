// "Session" — everything in today's workout: done, in progress and pending,
// with the log for each, plus reordering and session-level notes.
import {
  state, entryStatus, sessionProgress, sessionVolume, setCurrent, finishSession,
  discardSession, saveSessionBackToRoutine, updateSessionMeta, blockAt, working,
} from '../store.js';
import { esc, fmtDur, fmtNum, num } from '../util.js';
import { targetLine, logSummary } from '../format.js';
import { confirmDialog, toast, openModal } from '../ui.js';
import { autoPushIfEnabled } from '../sync.js';

const PILL = {
  done: '<span class="pill ok">done</span>',
  partial: '<span class="pill live">in progress</span>',
  skipped: '<span class="pill skip">skipped</span>',
  pending: '',
};

export function render() {
  const s = state.active;
  if (!s) {
    return `<div class="empty">No workout in progress.<br><br>
      <button type="button" class="btn primary" data-action="go-now">Go to Now to start one</button></div>`;
  }
  const { done, total } = sessionProgress(s);
  const curBlock = new Set(blockAt(s.entries, s.currentIdx));
  const vol = sessionVolume(s);

  const rows = s.entries.map((e, i) => {
    const st = entryStatus(e);
    const sum = logSummary(e);
    return `
      <div class="sess-item ${curBlock.has(i) ? 'current' : ''} ${st === 'done' ? 'doneAll' : ''}">
        <div class="ord">${i + 1}</div>
        <div class="body">
          <div class="nm">${esc(e.name)} ${e.group ? `<span class="pill grp">${esc(e.group)}</span>` : ''} ${PILL[st]}</div>
          ${targetLine(e) ? `<div class="sub">${esc(targetLine(e))}</div>` : ''}
          ${sum ? `<div class="loglines">${sum.split('  ').map((x) => `<code>${esc(x)}</code>`).join('')}</div>` : ''}
        </div>
        <div class="acts">
          <button type="button" class="btn icon ghost" title="Move up"   data-action="entry-up"   data-entry="${e.id}">↑</button>
          <button type="button" class="btn icon ghost" title="Move down" data-action="entry-down" data-entry="${e.id}">↓</button>
          <button type="button" class="btn icon ghost" title="Options"   data-action="entry-menu" data-entry="${e.id}">⋯</button>
          <button type="button" class="btn icon" title="Work on this"    data-action="sess-jump"  data-idx="${i}">▶</button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="card flat" style="margin-bottom:12px">
      <div class="strong" style="font-size:17px">${esc(s.routineName)}</div>
      <div class="small dim">${done}/${total} exercises done · ${esc(fmtDur((Date.now() - s.startedAt) / 1000))} elapsed${vol ? ` · ${fmtNum(vol)} ${esc(s.unit)} volume` : ''}</div>
      ${s.routineDescription ? `<p class="hint" style="white-space:pre-wrap">${esc(s.routineDescription)}</p>` : ''}
    </div>

    <h2>Today's exercises</h2>
    ${rows || '<div class="empty">Nothing here yet.</div>'}
    <div class="btn-row" style="margin-top:4px">
      <button type="button" class="btn" data-action="entry-add">+ Add exercise</button>
      ${s.modified && s.routineId ? '<button type="button" class="btn ghost" data-action="sess-save-routine">Save order to routine</button>' : ''}
    </div>

    <h2>Session log</h2>
    <div class="card" data-sessmeta="1">
      <div class="grid2">
        <label class="field"><span>Overall effort (RPE 1–10)</span>
          <input inputmode="decimal" data-sf="rpe" value="${esc(fmtNum(s.rpe))}"></label>
        <label class="field"><span>Bodyweight (${esc(s.unit)})</span>
          <input inputmode="decimal" data-sf="bodyweight" value="${esc(fmtNum(s.bodyweight))}"></label>
      </div>
      <label class="field" style="margin-bottom:0"><span>Notes</span>
        <textarea data-sf="notes" placeholder="How it felt, injuries, sleep, anything…">${esc(s.notes || '')}</textarea></label>
    </div>

    <div class="divider"></div>
    <button type="button" class="btn block ok" data-action="sess-finish">Finish workout</button>
    <button type="button" class="btn block danger" style="margin-top:8px" data-action="sess-discard">Discard this workout</button>`;
}

export const sessionActions = {
  'go-now': () => { state.tab = 'now'; },

  'sess-jump': async ({ idx }) => {
    await setCurrent(Number(idx));
    state.tab = 'now';
  },

  'sess-save-routine': async () => {
    const r = await saveSessionBackToRoutine();
    toast(r ? 'Routine updated' : 'No linked routine to update');
  },

  'sess-finish': async () => {
    const s = state.active;
    if (!s) return;
    const { done, total } = sessionProgress(s);
    const warn = done < total
      ? `${total - done} of ${total} exercises are not finished. `
      : '';
    openModal({
      title: 'Finish workout?',
      bodyHtml: `
        <p class="muted" style="margin-top:0">${esc(warn)}It will be saved to History and you can export it from there.</p>
        <div class="grid2">
          <label class="field"><span>Overall effort (RPE)</span>
            <input name="rpe" inputmode="decimal" value="${esc(fmtNum(s.rpe))}"></label>
          <label class="field"><span>Bodyweight (${esc(s.unit)})</span>
            <input name="bodyweight" inputmode="decimal" value="${esc(fmtNum(s.bodyweight))}"></label>
        </div>
        <label class="field"><span>Notes</span>
          <textarea name="notes">${esc(s.notes || '')}</textarea></label>`,
      okText: 'Finish',
      onSubmit: async (v) => {
        await updateSessionMeta({ rpe: num(v.rpe), bodyweight: num(v.bodyweight), notes: v.notes || '' }, { silent: true });
        const fin = await finishSession();
        state.tab = 'history';
        state.nav.sessionId = fin ? fin.id : null;
        toast('Workout saved');
        // opt-in: mirror the finished workout to the gist
        autoPushIfEnabled().then((res) => {
          if (!res) return;
          if (res.error) toast(`Gist push failed: ${res.error}`, 5000);
          else if (res.conflict) toast('Gist has newer data — push manually from Routines', 5000);
          else toast('Pushed to gist', 2500);
        });
        return true;
      },
    });
  },

  'sess-discard': async () => {
    if (await confirmDialog('Discard this workout and everything logged in it? This cannot be undone.', { okText: 'Discard' })) {
      await discardSession();
      state.tab = 'now';
      toast('Workout discarded');
    }
  },
};

/** Session-level field edits (data-sf). Called from app.js. */
export async function handleSessionField(target) {
  const f = target.dataset.sf;
  if (!f || !working()) return;
  const patch = {};
  patch[f] = f === 'notes' ? target.value : num(target.value);
  await updateSessionMeta(patch, { silent: true });
}
