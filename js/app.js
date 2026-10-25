// Bootstrap: load state, render the active tab, route delegated events.
import { state, init, subscribe, exerciseNames } from './store.js';
import { renderRestBar, timerActions, unlockAudio } from './timer.js';
import { toast } from './ui.js';

import * as nowView from './views/now.js';
import * as sessionView from './views/session.js';
import * as historyView from './views/history.js';
import * as routinesView from './views/routines.js';
import { entryActions, handleFieldInput } from './views/entry.js';

const VIEWS = {
  now: nowView,
  session: sessionView,
  history: historyView,
  routines: routinesView,
};

const TITLES = {
  now: 'Now',
  session: 'Session',
  history: 'History',
  routines: 'Routines',
};

const ACTIONS = {
  ...entryActions,
  ...nowView.nowActions,
  ...sessionView.sessionActions,
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
    const screen = `${state.tab}|${state.nav.sessionId || ''}|${state.nav.routineId || ''}`;
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
    if (state.tab === 'history') state.nav.sessionId = null;
    if (state.tab === 'routines') state.nav.routineId = state.nav.routineId || null;
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
  if (t.dataset?.f) return handleFieldInput(t);
  if (t.dataset?.sf) return sessionView.handleSessionField(t);
  if (t.dataset?.rf) return routinesView.handleRoutineField(t);
  return undefined;
});

// Re-render on blur so derived values (pace, volume, status pills) catch up.
document.addEventListener('blur', (ev) => {
  if (ev.target?.dataset && (ev.target.dataset.f || ev.target.dataset.sf)) render();
}, true);

// Enter in a set field moves to the next field instead of submitting anything.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' || !ev.target.dataset?.f) return;
  ev.preventDefault();
  const inputs = [...document.querySelectorAll('#viewRoot input[data-f]')];
  const i = inputs.indexOf(ev.target);
  if (i >= 0 && i < inputs.length - 1) inputs[i + 1].focus();
  else ev.target.blur();
});

subscribe(render);

/* ------------------------------------------------------------------ */
/* start                                                              */
/* ------------------------------------------------------------------ */

(async function start() {
  try {
    await init();
    // Land on the workout if one is running, otherwise on the routine library.
    state.tab = state.active ? 'now' : (state.routines.length ? 'now' : 'routines');
    render();
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
