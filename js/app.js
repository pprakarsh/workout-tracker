// Bootstrap: load state, render the active tab, route delegated events.
import { state, init, subscribe } from './store.js';
import { exerciseNames } from './queries.js';
import { renderRestBar, timerActions, unlockAudio } from './timer.js';
import {
  initSync, autoPullOnLaunch, autoPullOnForeground, watchRoutines, setSyncNotifier,
  flushPendingPush,
} from './sync.js';
import { toast } from './ui.js';

import * as nowView from './views/now.js';
import * as sessionView from './views/session.js';
import * as historyView from './views/history.js';
import * as routinesView from './views/routines.js';
import { entryActions, handleFieldInput } from './views/entry.js';
import { cardioActions } from './views/cardio.js';
import * as planView from './views/plan.js';
import * as trendsView from './views/trends.js';

const VIEWS = {
  now: nowView,
  session: sessionView,
  plan: planView,
  history: historyView,
  trends: trendsView,
  routines: routinesView,
};

const TITLES = {
  now: 'Now',
  session: 'Session',
  plan: 'Plan',
  history: 'History',
  trends: 'Trends',
  routines: 'Routines',
};

const ACTIONS = {
  ...entryActions,
  ...cardioActions,
  ...nowView.nowActions,
  ...sessionView.sessionActions,
  ...planView.planActions,
  ...trendsView.trendsActions,
  ...historyView.historyActions,
  ...routinesView.routineActions,
  ...timerActions,
  tab: ({ to }) => { state.tab = to; },
};

/* ------------------------------------------------------------------ */
/* render                                                             */
/* ------------------------------------------------------------------ */

let rendering = false;
let lastScreen = '';

export function render() {
  if (!state.ready || rendering) return;
  rendering = true;
  try {
    const root = document.getElementById('viewRoot');
    const view = VIEWS[state.tab] || VIEWS.now;
    const screen = `${state.tab}|${state.nav.sessionId || ''}|${state.nav.routineId || ''}|${state.nav.trendName || ''}`;
    const y = window.scrollY;
    root.innerHTML = view.render();
    // same screen: keep your place. new screen: start at the top.
    window.scrollTo(0, screen === lastScreen ? y : 0);
    lastScreen = screen;

    document.getElementById('appTitle').textContent =
      (state.tab === 'now' || state.tab === 'session') && state.active
        ? state.active.routineName
        : TITLES[state.tab];

    document.querySelectorAll('#tabBar .tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === state.tab);
    });

    const dl = document.getElementById('exerciseNames');
    const names = exerciseNames();
    if (dl.dataset.count !== String(names.length)) {
      dl.innerHTML = names.map((n) => `<option value="${n.replace(/"/g, '&quot;')}"></option>`).join('');
      dl.dataset.count = String(names.length);
    }

    renderRestBar();
  } finally {
    rendering = false;
  }
}

/* ------------------------------------------------------------------ */
/* events                                                             */
/* ------------------------------------------------------------------ */

document.addEventListener('click', async (ev) => {
  const tabBtn = ev.target.closest('#tabBar .tab');
  if (tabBtn) {
    state.tab = tabBtn.dataset.tab;
    // tapping a tab always lands on that tab's top-level screen
    state.nav = {};
    state.editSessionId = null;
    render();
    return;
  }

  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const name = el.dataset.action;
  const fn = ACTIONS[name];
  if (!fn) return;
  ev.preventDefault();
  // Any tap is a user gesture: use it to keep the audio context alive for the beep.
  unlockAudio();
  try {
    await fn({ ...el.dataset });
  } catch (err) {
    console.error(`action ${name} failed`, err);
    toast(err?.message || 'Something went wrong');
  }
  render();
});

// Live field edits persist silently (no re-render) so the keyboard and caret stay put.
document.addEventListener('input', async (ev) => {
  const t = ev.target;
  if (t.dataset?.f || t.dataset?.lf) return handleFieldInput(t);
  if (t.dataset?.sf) return sessionView.handleSessionField(t);
  if (t.dataset?.rf) return routinesView.handleRoutineField(t);
  if (t.dataset?.hf) return historyView.handleHistoryField(t);
  return undefined;
});

/* ------------------------------------------------------------------ */
/* the +/- stepper strip                                              */
/* ------------------------------------------------------------------ */

// Which numeric field the stepper should act on: whatever was focused last.
let stepTarget = null;

function showStepBarFor(input) {
  const card = input.closest('.card[data-entry]');
  document.querySelectorAll('.stepbar').forEach((b) => { b.hidden = b.closest('.card') !== card; });
}

document.addEventListener('focusin', (ev) => {
  const t = ev.target;
  if (t.dataset?.f === 'weight' || t.dataset?.f === 'reps') {
    stepTarget = t;
    showStepBarFor(t);
  }
});

// Cancel pointerdown so the focused input keeps focus (and the keyboard stays up).
document.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest?.('.stepbar button')) ev.preventDefault();
});

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest?.('.stepbar button[data-step]');
  if (!btn) return;
  ev.preventDefault();
  const field = btn.dataset.step;
  // act on the focused field when it matches, else the first matching field in this card
  let input = stepTarget && stepTarget.isConnected && stepTarget.dataset.f === field ? stepTarget : null;
  if (!input) {
    const card = btn.closest('.card[data-entry]');
    const rows = [...(card?.querySelectorAll(`.set-row input[data-f="${field}"]`) || [])];
    input = rows.find((i) => !i.value) || rows[rows.length - 1] || null;
  }
  if (!input) { toast('Add a set first'); return; }

  let next;
  if (btn.dataset.setTo !== undefined) {
    next = Number(btn.dataset.setTo);          // a recent-value chip
  } else {
    const current = Number(String(input.value).replace(',', '.'));
    const base = Number.isFinite(current) ? current : 0;
    next = Math.round((base + Number(btn.dataset.delta)) * 1000) / 1000;
  }
  input.value = next > 0 ? String(next) : '';
  // Reuse the normal silent-save path; no re-render, so focus and caret survive.
  // Build the event from the element's own window rather than the ambient global,
  // so this works regardless of which realm the element belongs to.
  const Ev = input.ownerDocument?.defaultView?.Event || Event;
  input.dispatchEvent(new Ev('input', { bubbles: true }));
  stepTarget = input;
}, true);

// Re-render on blur so derived values (pace, volume, status pills) catch up — but not
// while you are moving between fields, which would destroy the focused input.
document.addEventListener('blur', (ev) => {
  if (!(ev.target?.dataset?.f || ev.target?.dataset?.sf)) return;
  setTimeout(() => {
    const ae = document.activeElement;
    if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return;
    render();
  }, 0);
}, true);

// Enter in a set field moves to the next field instead of submitting anything.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  const kind = ev.target.dataset?.f ? 'f' : (ev.target.dataset?.lf ? 'lf' : null);
  if (!kind) return;
  ev.preventDefault();
  const inputs = [...document.querySelectorAll(`#viewRoot input[data-${kind}]`)];
  const i = inputs.indexOf(ev.target);
  if (i >= 0 && i < inputs.length - 1) inputs[i + 1].focus();
  else ev.target.blur();
});

subscribe(render);

/* ------------------------------------------------------------------ */
/* background sync triggers                                           */
/* ------------------------------------------------------------------ */

// An installed PWA resumes rather than cold-starting, so returning to the app is
// the moment that matters, not page load.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  autoPullOnForeground().then((res) => {
    if (!res || res.skipped) return;
    if (res.error) toast(`Gist sync: ${res.error}`, 5000);
    else if (res.conflict) toast('This device has unpushed changes - sync from Routines', 5000);
    else if (res.ok) toast(`Updated from gist: ${res.actual.sessions} sessions`, 3000);
  });
});

// A queued routine push may have been scheduled while offline.
window.addEventListener('online', () => { flushPendingPush(); });

/* ------------------------------------------------------------------ */
/* screen wake lock                                                   */
/* ------------------------------------------------------------------ */

// Supported in iOS Safari 16.4+ and Android. Without it the phone locks between
// sets and every set starts with unlocking it.
let wakeLock = null;

async function refreshWakeLock() {
  const want = !!state.active && state.settings.keepAwake !== false;
  if (!want) {
    if (wakeLock) { try { await wakeLock.release(); } catch { /* already gone */ } wakeLock = null; }
    return;
  }
  if (wakeLock || !navigator.wakeLock || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;    // refused (low battery, no support) -- not worth a toast
  }
}

subscribe(refreshWakeLock);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
  else refreshWakeLock();
});

/* ------------------------------------------------------------------ */
/* start                                                              */
/* ------------------------------------------------------------------ */

/** How background sync reports in. Quiet on success, loud on anything else. */
function syncNotice(res) {
  if (!res) return;
  if (res.error) toast(`Gist sync: ${res.error}`, 5000);
  else if (res.conflict) toast('Gist has newer data - sync manually from Routines', 5000);
  else if (res.ok && res.reason === 'routine') toast('Routine changes pushed to gist', 2200);
}

(async function start() {
  try {
    await init();
    await initSync();
    setSyncNotifier(syncNotice);
    watchRoutines();
    // Land on the workout if one is running, otherwise on the routine library.
    state.tab = state.active ? 'now' : (state.routines.length ? 'now' : 'routines');
    render();

    // Pull a newer copy from the gist in the background. Deliberately after the
    // first render: a network hiccup must never delay or block opening the app.
    autoPullOnLaunch().then((res) => {
      if (!res) return;
      if (res.error) toast(`Gist sync: ${res.error}`, 5000);
      else if (res.conflict) toast('This device has unpushed changes — sync from Routines', 5000);
      else if (res.ok && res.firstRun) {
        state.tab = state.routines.length ? 'now' : 'routines';
        render();
        toast(`Loaded ${res.actual.sessions} sessions and ${res.actual.routines} routines from your gist`, 5000);
      } else if (res.ok) {
        toast(`Updated from gist: ${res.actual.sessions} sessions`, 3500);
      }
    });
  } catch (err) {
    console.error(err);
    document.getElementById('viewRoot').innerHTML =
      `<div class="empty">Could not open local storage.<br><br>
       <span class="small">${String(err.message || err)}</span><br><br>
       <span class="small">If you are in Safari Private Browsing, storage is unavailable — open the app in a normal tab.</span></div>`;
  }
}());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support simply unavailable */ });
  });
}
