// Rest timer: the persistent bar above the tab bar.
//
// Elapsed time is derived from a stored start timestamp, never accumulated by a
// tick, so locking the screen / backgrounding the app / reloading the page all
// still show the true elapsed time.
import { state, stopRest, setRestTarget, markBeeped } from './store.js';
import { fmtClock, esc } from './util.js';

let bar, tickHandle = null, lastKey = '';

/* ---------------- audio ---------------- */
let ac = null;
/** Must be called from inside a user gesture for iOS to allow sound later. */
export function unlockAudio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch { /* no audio available; the timer still works */ }
}
function beep() {
  if (!state.settings.beep) return;
  try {
    unlockAudio();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    [0, 0.22, 0.44].forEach((offset) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    });
  } catch { /* ignore */ }
  // Android / desktop Chrome support this; iOS Safari ignores it.
  if (navigator.vibrate) { try { navigator.vibrate([120, 80, 120]); } catch { /* ignore */ } }
}

/* ---------------- render ---------------- */

export const restElapsed = () =>
  state.timer ? Math.max(0, Math.round((Date.now() - state.timer.startedAt) / 1000)) : 0;

export function renderRestBar() {
  bar = bar || document.getElementById('restBar');
  const t = state.timer;
  if (!t) {
    bar.hidden = true;
    bar.innerHTML = '';
    lastKey = '';
    stopTicking();
    return;
  }
  const key = `${t.startedAt}|${t.target}|${t.label}`;
  if (key !== lastKey) {
    lastKey = key;
    bar.hidden = false;
    bar.innerHTML = `
      <div class="clock" id="restClock">0:00</div>
      <div class="meta">
        <div class="t1">${esc(t.label || 'Rest')}</div>
        <div id="restSub"></div>
      </div>
      <div class="nudge">
        <button type="button" data-action="rest-nudge" data-by="30">+30s</button>
        <button type="button" data-action="rest-nudge" data-by="-30">−30s</button>
      </div>
      <button class="btn primary" data-action="rest-stop" type="button">Stop</button>`;
  }
  paint();
  startTicking();
}

function paint() {
  const t = state.timer;
  if (!t || !bar || bar.hidden) return;
  const el = Math.round((Date.now() - t.startedAt) / 1000);
  const clock = bar.querySelector('#restClock');
  const sub = bar.querySelector('#restSub');
  const over = t.target > 0 && el > t.target;
  if (clock) clock.textContent = fmtClock(el);
  if (sub) {
    sub.textContent = t.target > 0
      ? (over ? `${fmtClock(el - t.target)} over target ${fmtClock(t.target)}` : `target ${fmtClock(t.target)}`)
      : 'no target — counting up';
  }
  bar.classList.toggle('over', over);
  if (over && !t.beeped) { markBeeped(); beep(); }
}

function startTicking() {
  if (tickHandle) return;
  tickHandle = setInterval(paint, 250);
}
function stopTicking() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}

/** Re-sync immediately when the app comes back to the foreground. */
document.addEventListener('visibilitychange', () => { if (!document.hidden) paint(); });
window.addEventListener('focus', paint);

/* ---------------- actions (wired by app.js) ---------------- */
export const timerActions = {
  'rest-stop': async () => { await stopRest(); },
  'rest-nudge': async ({ by }) => {
    if (!state.timer) return;
    await setRestTarget(Math.max(0, state.timer.target + Number(by)));
  },
};
