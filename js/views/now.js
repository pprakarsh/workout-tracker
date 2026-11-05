// "Now" — the single exercise (or superset block) you are working on.
import {
  state, blockAt, stepBlock, startSession, sessionProgress,
} from '../store.js';
import { lastSessionForRoutine } from '../queries.js';
import { esc, fmtDur, relDay } from '../util.js';
import { renderEntry } from './entry.js';
import { toast } from '../ui.js';
import { nudgeHtml, dismissNudge } from '../nudges.js';

function noSession() {
  const rs = state.routines;
  return `
    ${nudgeHtml()}
    <div class="card">
      <div class="strong" style="font-size:17px">No workout in progress</div>
      <p class="hint">Pick a routine to start today's session. Your routine is copied into the
        session, so anything you change today stays in today.</p>
    </div>
    <h2>Start a workout</h2>
    ${rs.length ? rs.map((r) => {
    const last = lastSessionForRoutine(r.id);
    return `
      <div class="card routine-card">
        <div class="rc-top">
          <div style="flex:1;min-width:0">
            <div class="rc-name">${esc(r.name)}</div>
            ${r.description ? `<div class="rc-desc">${esc(r.description)}</div>` : ''}
            <div class="rc-meta">${r.entries.length} exercise${r.entries.length === 1 ? '' : 's'}${last ? ` · last done ${esc(relDay(last.startedAt))}` : ' · never done'}</div>
          </div>
          <button type="button" class="btn primary" data-action="routine-start" data-id="${r.id}">Start</button>
        </div>
      </div>`;
  }).join('')
    : `<div class="empty">Nothing set up yet.</div>
       <p class="hint">A <b>routine</b> is the plan &mdash; which exercises, how many sets. Starting
         one makes a <b>session</b>, which is the log of what you actually did. Nothing you do in a
         session changes the routine unless you ask it to.</p>
       <button type="button" class="btn block primary" data-action="sample-start">Try a sample workout</button>
       <p class="hint center" style="margin:6px 0 14px">Four exercises with the numbers already in.
         One tap on a ✓ and you have seen how all of this works.</p>
       <button type="button" class="btn block" data-action="routine-how">How do I make my own?</button>
       <button type="button" class="btn block ghost" data-action="routine-new">+ Create a routine</button>
       <button type="button" class="btn block ghost" data-action="import-open">Import one from JSON</button>`}
    <div class="divider"></div>
    <button type="button" class="btn block ghost" data-action="start-empty">Start an empty workout</button>
    ${state.routines.length ? '' : `<p class="hint">Or just start an empty one and add exercises as
      you go &mdash; a session does not need a routine.</p>`}`;
}

export function render() {
  const s = state.active;
  if (!s) return noSession();

  if (!s.entries.length) {
    return `
      ${headerCard(s)}
      <div class="empty">This session has no exercises.<br>Add one to get going.</div>
      <button type="button" class="btn block primary" data-action="entry-add">+ Add exercise</button>`;
  }

  const idxs = blockAt(s.entries, s.currentIdx);
  const first = idxs[0];
  const last = idxs[idxs.length - 1];
  const group = s.entries[first].group;
  const total = s.entries.length;

  return `
    ${headerCard(s)}
    <div class="row" style="margin:2px 0 10px">
      <div class="tiny">Exercise ${first + 1}${idxs.length > 1 ? `–${last + 1}` : ''} of ${total}
        ${group ? ` · superset ${esc(group)}` : ''}</div>
      <div class="spacer"></div>
      <button type="button" class="btn xs ghost" data-action="now-prev" ${first === 0 ? 'disabled' : ''}>↑ Prev</button>
      <button type="button" class="btn xs ghost" data-action="now-next" ${last >= total - 1 ? 'disabled' : ''}>Next ↓</button>
    </div>
    ${idxs.map((i) => renderEntry(s.entries[i], { showLast: true })).join('')}
    <div class="btn-row" style="margin-top:12px">
      <button type="button" class="btn" data-action="entry-add">+ Add exercise</button>
      <button type="button" class="btn primary" data-action="now-next" ${last >= total - 1 ? 'disabled' : ''}>Next exercise →</button>
    </div>
    ${last >= total - 1 ? `<button type="button" class="btn block ok" style="margin-top:10px" data-action="sess-finish">Finish workout</button>` : ''}`;
}

function headerCard(s) {
  const { done, total } = sessionProgress(s);
  const mins = fmtDur((Date.now() - s.startedAt) / 1000);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `
    <div class="card flat" style="margin-bottom:12px">
      <div class="row">
        <div style="flex:1;min-width:0">
          <div class="strong" style="font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.routineName)}</div>
          <div class="small dim">${done}/${total} done · ${esc(mins)} elapsed${s.modified ? ' · modified today' : ''}</div>
        </div>
        <button type="button" class="btn sm ghost" data-action="go-session">Session ☰</button>
      </div>
      <div class="progress" role="progressbar" aria-valuenow="${done}" aria-valuemin="0"
           aria-valuemax="${total}" aria-label="${done} of ${total} exercises done">
        <div class="bar${done && done === total ? ' full' : ''}" style="width:${pct}%"></div>
      </div>
    </div>`;
}

export const nowActions = {
  'now-prev': async () => { await stepBlock(-1); },
  'now-next': async () => { await stepBlock(1); },
  'go-session': () => { state.tab = 'session'; },
  'routine-start': async ({ id }) => {
    if (state.active) { toast('Finish or discard the current workout first'); return; }
    await startSession(id);
  },
  'nudge-dismiss': async ({ id }) => { await dismissNudge(id); },

  'start-empty': async () => {
    if (state.active) { toast('Finish or discard the current workout first'); return; }
    await startSession(null);
  },
};
