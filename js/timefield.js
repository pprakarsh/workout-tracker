// A time input split into hours / minutes / seconds.
//
// WHY THIS EXISTS: a duration reads as "28:30", but `inputmode="numeric"` gives
// iOS a digits-only keypad with no colon on it. So the app was asking for a
// character the keyboard it requested cannot produce. The alternatives are all
// worse: `inputmode="text"` brings up a full QWERTY to type three digits,
// `decimal` offers a point that means nothing here, and auto-inserting a colon
// while typing fights the caret.
//
// Separate boxes sidestep the character entirely. Each box is a plain number,
// the keypad is right, and there is nothing to mis-type.
//
// BLANK MEANS ZERO, except when every box is blank, which means no value at
// all. "30" minutes with the seconds box empty is 30:00, not invalid; a wholly
// empty field is null rather than 00:00:00, because an empty field has to be
// allowed to mean "nothing entered".
import { esc, fmtNum } from './util.js';

/**
 * Split seconds into parts for display. Null stays null, not zeroes.
 *
 * LEADING zero components render BLANK, not "0". Two reasons: a 28-minute run
 * showing "0" in its hours box is noise, and more importantly a box holding a
 * literal "0" is not blank — which would make "every box empty" unreachable and
 * so make it impossible to clear the field back to no value.
 */
export function toParts(seconds, parts = 'hms') {
  if (seconds === null || seconds === undefined || seconds === '') {
    return { h: '', m: '', s: '' };
  }
  const n = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(n / 3600);
  const m = parts === 'ms' ? Math.floor(n / 60) : Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (parts === 'ms') {
    return { h: '', m: m === 0 ? '' : String(m), s: String(s) };
  }
  return {
    h: h === 0 ? '' : String(h),
    m: (h === 0 && m === 0) ? '' : String(m),
    s: String(s),
  };
}

/**
 * Parts back to seconds. Any blank box counts as zero; all blank is null.
 * Minutes or seconds over 59 are not rejected -- typing 90 in the seconds box
 * meaning a minute and a half is a reasonable thing to do, and refusing it
 * would be pedantry.
 */
export function fromParts({ h = '', m = '', s = '' } = {}) {
  const raw = [h, m, s].map((v) => String(v ?? '').trim());
  if (raw.every((v) => v === '')) return null;
  const n = (v) => {
    const x = Number(v === '' ? 0 : v);
    return Number.isFinite(x) && x >= 0 ? x : 0;
  };
  return Math.round((n(raw[0]) * 3600) + (n(raw[1]) * 60) + n(raw[2]));
}

const box = (key, part, value, label, max) => `
  <span class="tf-box">
    <input inputmode="numeric" enterkeyhint="next" class="tf-in"
           name="${key}_${part}" data-tf="${key}" data-tp="${part}"
           value="${esc(value)}" placeholder="0" maxlength="${String(max).length}"
           aria-label="${esc(label)}">
    <span class="tf-unit">${part}</span>
  </span>`;

/**
 * `parts` is 'hms' or 'ms'. Use 'ms' wherever hours are meaningless -- a pace,
 * a rest period, an interval leg -- so the user is not given a box that will
 * never hold anything.
 */
export function timeFieldHtml({
  key, label, seconds = null, parts = 'hms', hint = '', suffix = '',
} = {}) {
  const p = toParts(seconds, parts);
  return `
    <div class="field tf-field" data-tf-group="${key}">
      <span>${label}${suffix ? ` <span class="dim">${esc(suffix)}</span>` : ''}</span>
      <div class="tf-row">
        ${parts === 'hms' ? box(key, 'h', p.h, `${label} hours`, 99) : ''}
        ${box(key, 'm', p.m, `${label} minutes`, 999)}
        ${box(key, 's', p.s, `${label} seconds`, 99)}
        <output class="tf-echo" data-tf-echo="${key}"></output>
      </div>
      ${hint ? `<p class="hint" style="margin:4px 0 0">${hint}</p>` : ''}
    </div>`;
}

/** Read one field's parts out of a modal's collected `name` values. */
export const readTimeValues = (v = {}, key) => fromParts({
  h: v[`${key}_h`], m: v[`${key}_m`], s: v[`${key}_s`],
});

/** Read one field's parts straight from the DOM, for live-saving fields. */
export function readTimeDom(root, key) {
  const get = (part) => {
    const el = root.querySelector(`[data-tf="${key}"][data-tp="${part}"]`);
    return el ? el.value : '';
  };
  return fromParts({ h: get('h'), m: get('m'), s: get('s') });
}

const clock = (n) => {
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/**
 * Show each field's total back as a clock, live. This is what makes the split
 * boxes safe: you can see that 1 / 30 reads as 1:30 before you commit to it.
 * Call once after rendering a container that holds time fields.
 */
export function wireTimeFields(root) {
  if (!root) return;
  const groups = [...root.querySelectorAll('[data-tf-group]')];
  const paint = (key) => {
    const echo = root.querySelector(`[data-tf-echo="${key}"]`);
    if (!echo) return;
    const total = readTimeDom(root, key);
    echo.textContent = total === null ? '' : clock(total);
  };
  groups.forEach((g) => paint(g.dataset.tfGroup));
  root.addEventListener('input', (ev) => {
    const key = ev.target.dataset?.tf;
    if (key) paint(key);
  });
}

/** For a suffix like "/km" on a pace field. */
export const paceSuffix = (unit) => `per ${fmtNum(1)} ${unit}`.replace('1 ', '');
