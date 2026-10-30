// Rest timer: the persistent bar above the tab bar.
//
// Elapsed time is derived from a stored start timestamp, never accumulated by a
// tick, so locking the screen / backgrounding the app / reloading the page all
// still show the true elapsed time.
import {
  state, stopRest, stopHold, setRestTarget, markBeeped, findEntry, setLabels,
  setEffort, toggleSetDone,
} from './store.js';
import { loadLabel } from './format.js';
import { toast, openModal, closeModal } from './ui.js';
import { timeFieldHtml, readTimeValues, wireTimeFields } from './timefield.js';
import { fmtClock, fmtNum, esc, parseDur } from './util.js';

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
  const e = t.entryId ? findEntry(t.entryId) : null;
  const set = e && t.setId ? (e.sets || []).find((x) => x.id === t.setId) : null;
  const label = set ? setLabels(e.sets)[e.sets.indexOf(set)] : null;
  const key = `${t.startedAt}|${t.target}|${t.label}|${set ? `${set.weight}/${set.reps}/${set.rpe}/${set.rir}/${set.bodyweight}` : ''}`;

  // A HOLD is its own bar: counting up, one action, nothing else. The rest bar's
  // panel of corrections is there because resting is when there is attention to
  // spare -- mid-plank there is none.
  if (t.kind === 'hold') {
    const hkey = `hold|${t.startedAt}|${t.label}`;
    if (hkey !== lastKey) {
      lastKey = hkey;
      bar.hidden = false;
      bar.innerHTML = `
        <div class="restbar-top">
          <div class="clock hold" id="restClock">0:00</div>
          <div class="meta">
            <div class="t1">Holding &mdash; ${esc(t.label || '')}</div>
            <div id="restSub"></div>
          </div>
        </div>
        <button class="btn primary block" data-action="hold-stop" type="button">
          Stop &mdash; log the time</button>`;
    }
    paint();
    startTicking();
    return;
  }

  if (key !== lastKey) {
    lastKey = key;
    bar.hidden = false;
    // Resting is the only time there is attention to spare, so this is where
    // effort, corrections and undo live -- not on the row mid-set.
    bar.innerHTML = `
      <div class="restbar-top">
        <div class="clock" id="restClock">0:00</div>
        <div class="meta">
          <div class="t1">${esc(t.label || 'Rest')}</div>
          <div id="restSub"></div>
        </div>
        <div class="nudge">
          <button type="button" data-action="rest-nudge" data-by="30">+30s</button>
          <button type="button" data-action="rest-nudge" data-by="-30">&minus;30s</button>
        </div>
      </div>
      ${set ? `
      <div class="restbar-logged">
        <span class="tiny">Logged</span>
        <b>${esc(loadLabel(set))} &times; ${esc(fmtNum(set.reps))}</b>
        <span class="spacer"></span>
        <button type="button" class="chip" data-action="set-rest-edit"
                data-entry="${e.id}" data-set="${set.id}">edit rest</button>
        <button type="button" class="chip warn" data-action="set-undo"
                data-entry="${e.id}" data-set="${set.id}">undo</button>
      </div>
      ${effortRow(e, set)}` : ''}
      <div class="restbar-edit">
        <span class="tiny">Change the plan</span>
        <button type="button" class="chip" data-action="rest-target">rest target</button>
        ${e ? `<button type="button" class="chip" data-action="entry-edit" data-entry="${e.id}">this exercise</button>` : ''}
        <button type="button" class="chip" data-action="entry-add">+ exercise</button>
        <button type="button" class="chip" data-action="go-session">reorder</button>
      </div>
      <button class="btn primary block" data-action="rest-stop" type="button">
        I'm starting my set</button>`;
  }
  paint();
  startTicking();
}

/** Effort as fat chips: a tap, not a 50px numeric field. */
function effortRow(e, set) {
  const scale = state.settings.effortScale;
  const rows = [];
  if (scale !== 'rir') {
    rows.push(`
      <div class="restbar-effort">
        <span class="tiny">RPE</span>
        ${[6, 7, 8, 9, 10].map((n) => `<button type="button"
          class="chip ${set.rpe === n ? 'on' : ''}" data-action="set-effort"
          data-entry="${e.id}" data-set="${set.id}" data-field="rpe" data-value="${n}">${n}</button>`).join('')}
      </div>`);
  }
  if (scale === 'rir' || scale === 'both') {
    rows.push(`
      <div class="restbar-effort">
        <span class="tiny">RIR</span>
        ${[0, 1, 2, 3, 4].map((n) => `<button type="button"
          class="chip ${set.rir === n ? 'on' : ''}" data-action="set-effort"
          data-entry="${e.id}" data-set="${set.id}" data-field="rir" data-value="${n}">${n}</button>`).join('')}
      </div>`);
  }
  return rows.join('');
}

function paint() {
  const t = state.timer;
  if (!t || !bar || bar.hidden) return;
  const el = Math.round((Date.now() - t.startedAt) / 1000);
  const clock = bar.querySelector('#restClock');
  const sub = bar.querySelector('#restSub');
  const over = t.target > 0 && el > t.target;
  if (clock) clock.textContent = fmtClock(el);
  if (t.kind === 'hold') {
    // a hold counts UP, so passing the planned time is doing well, not an alarm
    if (sub) {
      sub.textContent = t.target > 0
        ? (over ? `${fmtClock(el - t.target)} past the planned ${fmtClock(t.target)}` : `planned ${fmtClock(t.target)}`)
        : 'counting up';
    }
    if (clock) clock.classList.toggle('past', over);
    return;
  }
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
  /** Set the rest target precisely, rather than only nudging it by 30s. */
  'rest-target': () => {
    const t = state.timer;
    if (!t) return;
    const m = openModal({
      title: 'Rest target',
      bodyHtml: `
        ${timeFieldHtml({ key: 'target', label: 'Target for this rest', seconds: t.target, parts: 'ms' })}
        <p class="hint">Leave a box empty and it counts as <b>0</b>, so 2 in minutes is 2:00.
          Changes this rest only. To change it for every set of the exercise, use
          <b>this exercise</b> and set its rest there.</p>`,
      onSubmit: async (v) => {
        const secs = readTimeValues(v, 'target');
        if (secs === null) { toast('Enter a target'); return false; }
        await setRestTarget(secs);
        toast(`Target set to ${fmtClock(secs)}`);
        return true;
      },
    });
    wireTimeFields(m);
  },

  'hold-stop': async () => {
    const res = await stopHold();
    if (!res) return;
    toast(`Held ${fmtClock(res.elapsed)}`, 2600);
    // the time is in; now the set needs whatever else it owes
    if (res.loggable) {
      await toggleSetDone(res.entryId, res.setId);
      toast(`Logged ${fmtClock(res.elapsed)}`, 2200);
    } else {
      askHoldEffort(res.entryId, res.setId, fmtClock(res.elapsed));
    }
  },

  'rest-stop': async () => {
    const res = await stopRest();
    if (res && res.pending) {
      // the rest was timed but the set still has no numbers -- say so instead of
      // quietly leaving it out of the log
      toast('Rest saved. That set still needs a weight to count as logged.', 4200);
    }
  },
  'rest-nudge': async ({ by }) => {
    if (!state.timer) return;
    await setRestTarget(Math.max(0, state.timer.target + Number(by)));
  },
};

/**
 * After a hold, the time is in but effort may still be owed. Ask, then tick --
 * the same bargain the set row makes, kept here so stopping a plank runs
 * through to a logged set in one gesture.
 */
function askHoldEffort(entryId, setId, held) {
  const scale = state.settings.effortScale;
  const chips = (field, name, values) => `
    <div class="effrow" style="margin-bottom:8px">
      <span class="tiny">${name}</span>
      ${values.map((n) => `<button type="button" class="chip big"
        data-hold-field="${field}" data-hold-value="${n}">${n}</button>`).join('')}
    </div>`;
  const modal = openModal({
    title: `Held ${held} \u2014 how hard?`,
    bodyHtml: `
      ${scale !== 'rir' ? chips('rpe', 'RPE', [6, 7, 8, 9, 10]) : ''}
      ${scale === 'rir' || scale === 'both' ? chips('rir', 'RIR', [0, 1, 2, 3, 4]) : ''}
      <button type="button" class="btn block ghost" data-hold-field="unknown" data-hold-value="1">
        I don't know</button>
      <p class="hint">The time is already saved. This logs the set.</p>`,
    cancelText: 'Later',
  });
  modal.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-hold-field]');
    if (!btn) return;
    const field = btn.dataset.holdField;
    await setEffort(entryId, setId, field === 'unknown'
      ? { unknown: true } : { [field]: Number(btn.dataset.holdValue) });
    await toggleSetDone(entryId, setId);
    closeModal();
    toast('Logged', 1800);
  });
}
