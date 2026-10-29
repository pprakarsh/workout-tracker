// "Plan" — the next ten days, and which routine is meant to happen on each.
//
// The whole surface is one row per day. A row is either empty (tap to plan it),
// a planned routine, or a rest day. Today's row carries the start button, so
// the plan is also the shortest path into a workout.
//
// Nothing here decides what a day MEANS: js/plan.js does that, reading the
// session history so a day you trained reads as done without being ticked.
import { state, startSession, getRoutine } from '../store.js';
import {
  setPlanDay, clearPlanDay, togglePlanDone, movePlanDay,
} from '../planstore.js';
import {
  planWindow, pastWindow, planSummary, pastSummary, keyToTs, dayKey, addDays, PLAN_DAYS,
} from '../plan.js';
import { lastSessionForRoutine } from '../queries.js';
import { esc, fmtDate, fmtDur } from '../util.js';
import {
  openModal, closeModal, confirmDialog, toast,
} from '../ui.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Tomorrow", "Thu 30" — short, because the row is narrow. */
function dayLabel(ts, offset) {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  const d = new Date(ts);
  return `${DAYS[d.getDay()]} ${d.getDate()}`;
}

const PILL = {
  done: '<span class="pill ok">done</span>',
  swapped: '<span class="pill grp">did something else</span>',
  missed: '<span class="pill skip">missed</span>',
  rest: '<span class="pill">rest</span>',
  today: '<span class="pill grp">today</span>',
  open: '',
  upcoming: '',
};

function dayRow(day, { past = false } = {}) {
  const { key, ts, entry, status } = day;
  const r = entry.routineId ? getRoutine(entry.routineId) : null;
  const gone = entry.routineId && !r;      // the routine was deleted since
  const label = dayLabel(ts, status.offset);
  const isToday = status.offset === 0;
  const sess = status.session;

  const body = () => {
    if (entry.rest) return '<div class="pd-rest">Rest day</div>';
    if (gone) return '<div class="pd-name dim">routine no longer exists</div>';
    if (!r) {
      // Yesterday cannot be planned. A past day with nothing on it either shows
      // what you actually did, or says plainly that nothing was logged.
      if (past) {
        return sess
          ? `<div class="pd-name">${esc(sess.routineName)}</div>
             <div class="pd-sub dim">not planned &mdash; logged anyway</div>`
          : '<div class="pd-rest dim">nothing logged</div>';
      }
      return `<button type="button" class="pd-add" data-action="plan-pick" data-key="${key}">
        + Plan a routine</button>`;
    }
    const last = lastSessionForRoutine(r.id);
    return `
      <div class="pd-name">${esc(r.name)}</div>
      <div class="pd-sub">${past ? `${r.entries.length} exercise${r.entries.length === 1 ? '' : 's'} planned`
    : `${r.entries.length} exercise${r.entries.length === 1 ? '' : 's'}${
      last ? ` · last done ${esc(fmtDate(last.startedAt)).slice(0, 10)}` : ' · never done'}`}</div>
      ${entry.note ? `<div class="pd-note">${esc(entry.note)}</div>` : ''}`;
  };

  return `
    <div class="pd-row ${status.state}${isToday ? ' is-today' : ''}${past ? ' is-past' : ''}" data-plan-row="${key}">
      <div class="pd-when">
        <div class="pd-day">${esc(label)}</div>
        <div class="pd-date">${esc(fmtDate(ts).slice(4))}</div>
      </div>
      <div class="pd-main">
        ${body()}
        ${PILL[status.state] || ''}
        ${status.state === 'swapped' && sess
    ? `<div class="pd-sub dim">logged: ${esc(sess.routineName)}</div>` : ''}
        ${status.state === 'done' && status.manual ? '<div class="pd-sub dim">ticked by hand</div>' : ''}
        ${status.restPlanned ? '<div class="pd-sub dim">was down as a rest day</div>' : ''}
        ${status.state === 'done' && sess
    ? `<div class="pd-sub dim">${esc(fmtDur((sess.finishedAt - sess.startedAt) / 1000))} · ${sess.entries.length} exercises</div>` : ''}
      </div>
      <div class="pd-acts">
        ${r && isToday && !state.active && status.state !== 'done'
    ? `<button type="button" class="btn sm primary" data-action="plan-start" data-key="${key}">Start</button>` : ''}
        ${past && status.state === 'missed'
    ? `<button type="button" class="btn sm" data-action="past-log" data-id="${entry.routineId}" data-key="${key}">Log it</button>` : ''}
        ${sess
    ? `<button type="button" class="btn icon ghost" title="Open this workout" data-action="plan-open" data-id="${sess.id}">↗</button>` : ''}
        ${past && !entry.routineId && !entry.rest && !sess
    ? `<button type="button" class="btn icon ghost" title="Mark as a rest day" data-action="plan-rest" data-key="${key}">z</button>` : ''}
        ${entry.routineId || entry.rest || past
    ? `<button type="button" class="btn icon ghost" title="Day options" data-action="plan-menu" data-key="${key}">⋯</button>`
    : `<button type="button" class="btn icon ghost" title="Mark as a rest day" data-action="plan-rest" data-key="${key}">z</button>`}
      </div>
    </div>`;
}

export function render() {
  const win = planWindow(state.plan, state.sessions);
  const past = pastWindow(state.plan, state.sessions);
  const { planned, done, rest, open } = planSummary(win);
  const back = pastSummary(past);
  const pct = planned ? Math.round((done / planned) * 100) : 0;

  return `
    <div class="card flat" style="margin-bottom:12px">
      <div class="row">
        <div style="flex:1;min-width:0">
          <div class="strong" style="font-size:16px">Next ${PLAN_DAYS} days</div>
          <div class="small dim">${planned} planned · ${done} done · ${rest} rest · ${open} open</div>
        </div>
        <button type="button" class="btn sm ghost" data-action="plan-clear">Clear</button>
      </div>
      <div class="progress" role="progressbar" aria-valuenow="${done}" aria-valuemin="0"
           aria-valuemax="${planned}" aria-label="${done} of ${planned} planned workouts done">
        <div class="bar${planned && done === planned ? ' full' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="small dim" style="margin-top:8px">Last ${back.days} days:
        <b>${back.trained} trained</b>${back.missed ? ` · ${back.missed} missed` : ''}${back.rest ? ` · ${back.rest} rest` : ''}</div>
    </div>

    <div class="pd-list">${win.map((d) => dayRow(d)).join('')}</div>

    <h2>Previous ${back.days} days</h2>
    <div class="pd-list">${past.map((d) => dayRow(d, { past: true })).join('')}</div>

    <p class="hint">A day ticks itself when you finish that routine on it &mdash; the plan reads your
      history, so there is nothing to mark twice. Use <b>&#8226;&#8226;&#8226; &rarr; Mark done</b>
      only for a workout the app never saw. Days roll forward automatically: the plan always starts
      today, and the week behind it always ends yesterday.</p>`;
}

/* ------------------------------------------------------------------ */
/* actions                                                            */
/* ------------------------------------------------------------------ */

/** Pick a routine for a day. Also the "change it" path. */
function openRoutinePicker(key) {
  const rs = state.routines;
  const when = `${dayLabel(keyToTs(key), 0) === 'Today' ? '' : ''}${fmtDate(keyToTs(key))}`;
  if (!rs.length) {
    toast('No routines yet — create one in the Routines tab first', 4000);
    return;
  }
  const current = state.plan[key]?.routineId || null;
  openModal({
    title: `Plan ${when}`,
    bodyHtml: `
      <div class="btn-row" style="flex-direction:column;gap:8px">
        ${rs.map((r) => `
          <button type="button" class="btn block ${r.id === current ? 'primary' : ''}"
                  data-action="plan-set" data-key="${key}" data-id="${r.id}">
            ${esc(r.name)}
            <span class="dim small">${r.entries.length} exercise${r.entries.length === 1 ? '' : 's'}</span>
          </button>`).join('')}
        <div class="divider"></div>
        <button type="button" class="btn block" data-action="plan-rest" data-key="${key}">Rest day</button>
        ${current || state.plan[key]?.rest
    ? `<button type="button" class="btn block danger" data-action="plan-clear-day" data-key="${key}">Clear this day</button>` : ''}
      </div>`,
    cancelText: 'Close',
  });
}

/** The per-day menu: change, move, note, tick, clear. */
function openDayMenu(key) {
  const entry = state.plan[key] || {};
  const r = entry.routineId ? getRoutine(entry.routineId) : null;
  openModal({
    title: fmtDate(keyToTs(key)),
    bodyHtml: `
      <div class="btn-row" style="flex-direction:column;gap:8px">
        <button type="button" class="btn block" data-action="plan-pick" data-key="${key}">
          ${r ? 'Change routine' : 'Plan a routine'}</button>
        <button type="button" class="btn block" data-action="past-log"
                ${entry.routineId ? `data-id="${entry.routineId}" ` : ''}data-key="${key}">Log a workout for this day</button>
        <button type="button" class="btn block" data-action="plan-shift" data-key="${key}" data-by="1">Push to the next day &rarr;</button>
        <button type="button" class="btn block" data-action="plan-shift" data-key="${key}" data-by="-1">Pull to the day before &larr;</button>
        <button type="button" class="btn block" data-action="plan-rest" data-key="${key}">
          ${entry.rest ? 'Not a rest day after all' : 'Mark as a rest day'}</button>
        <button type="button" class="btn block" data-action="plan-note" data-key="${key}">${entry.note ? 'Edit note' : 'Add a note'}</button>
        <button type="button" class="btn block" data-action="plan-done" data-key="${key}">
          ${entry.doneAt ? 'Un-mark done' : 'Mark done'}</button>
        <button type="button" class="btn block danger" data-action="plan-clear-day" data-key="${key}">Clear this day</button>
      </div>
      <p class="hint">Marking done by hand is only for a workout you did without the app. Finishing
        the routine on the day ticks it on its own.</p>`,
    cancelText: 'Close',
  });
}

export const planActions = {
  'plan-pick': async ({ key }) => { openRoutinePicker(key); },
  'plan-menu': async ({ key }) => { openDayMenu(key); },

  // These are reached from a sheet of choices, so each one is a decision: make
  // it and get out of the way. Leaving the sheet open after a tap looks like
  // the tap did not register.
  'plan-set': async ({ key, id }) => {
    await setPlanDay(key, { routineId: id, rest: false });
    const r = getRoutine(id);
    closeModal();
    toast(`${r ? r.name : 'Routine'} planned for ${fmtDate(keyToTs(key))}`);
  },

  'plan-rest': async ({ key }) => {
    const cur = state.plan[key];
    await setPlanDay(key, { rest: !(cur && cur.rest), routineId: null });
    closeModal();
    toast(cur && cur.rest ? 'Rest day cleared' : 'Marked as a rest day');
  },

  'plan-clear-day': async ({ key }) => {
    await clearPlanDay(key);
    closeModal();
    toast('Day cleared');
  },

  'plan-done': async ({ key }) => {
    const next = await togglePlanDone(key);
    closeModal();
    toast(next.doneAt ? 'Marked done' : 'No longer marked done');
  },

  'plan-shift': async ({ key, by }) => {
    const to = dayKey(addDays(keyToTs(key), Number(by)));
    const moved = await movePlanDay(key, to);
    closeModal();
    toast(moved ? `Moved to ${fmtDate(keyToTs(to))}` : 'Nothing to move');
  },

  'plan-note': async ({ key }) => {
    const entry = state.plan[key] || {};
    openModal({
      title: 'Note for this day',
      bodyHtml: `
        <label class="field"><span>Note — a focus, a reminder, why it moved</span>
          <input name="note" placeholder="e.g. squat is a top single today"
                 value="${esc(entry.note || '')}"></label>`,
      onSubmit: async (v) => { await setPlanDay(key, { note: v.note }); return true; },
    });
  },

  'plan-start': async ({ key }) => {
    const entry = state.plan[key];
    if (!entry?.routineId) return;
    closeModal();
    if (state.active) { toast('Finish or discard the current workout first'); return; }
    await startSession(entry.routineId);
    state.tab = 'now';
  },

  'plan-open': async ({ id }) => {
    state.nav.sessionId = id;
    state.tab = 'history';
  },

  'plan-clear': async () => {
    if (!Object.keys(state.plan).length) { toast('Nothing planned yet'); return; }
    if (await confirmDialog('Clear the whole plan? Your logged workouts are not touched.', { okText: 'Clear plan' })) {
      for (const key of Object.keys(state.plan)) await clearPlanDay(key);
      toast('Plan cleared');
    }
  },
};
