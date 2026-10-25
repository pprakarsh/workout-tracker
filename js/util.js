// Small shared helpers. No dependencies.

export const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** '' / null / junk -> null, otherwise a finite number. */
export function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Trim a number for display: 62.5 -> "62.5", 62.0 -> "62" */
export const fmtNum = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? ''
    : String(Math.round(Number(n) * 1000) / 1000);

/** seconds -> "m:ss" (or "h:mm:ss" past an hour) */
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** seconds -> "1h 12m" / "12m" / "45s" */
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Permissive duration parser. Accepts:
 *   "20:00" "1:20:00" "20m" "1h5m" "90s" "1200s"
 * A value with no unit is ambiguous, so the caller says what it means:
 *   parseDur(90)                      -> 90 seconds
 *   parseDur(20, {bare:'minutes'})    -> 1200 seconds
 * Numbers and numeric strings behave identically. Returns seconds, or null.
 */
export function parseDur(v, { bare = 'seconds' } = {}) {
  if (v === '' || v === null || v === undefined) return null;
  const scale = (n) => Math.round(bare === 'minutes' ? n * 60 : n);
  if (typeof v === 'number') return Number.isFinite(v) ? scale(v) : null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p.trim()));
    if (parts.some((p) => !Number.isFinite(p))) return null;
    return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
  }
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/);
  if (m && (m[1] || m[2] || m[3])) {
    return Math.round((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0));
  }
  const n = num(s);
  return n === null ? null : scale(n);
}

/** "8-12" | 10 | {min,max} -> {min,max} with nulls allowed */
export function parseReps(v) {
  if (v === null || v === undefined || v === '') return { min: null, max: null };
  if (typeof v === 'object') return { min: num(v.min), max: num(v.max) };
  if (typeof v === 'number') return { min: v, max: v };
  const s = String(v).trim();
  const m = s.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/i);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const n = num(s.replace(/[^\d.]/g, ''));
  return { min: n, max: n };
}

export function fmtReps(min, max) {
  if (min === null && max === null) return '';
  if (min !== null && max !== null && min !== max) return `${fmtNum(min)}-${fmtNum(max)}`;
  return fmtNum(min ?? max);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtTimeOfDay(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function isoDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** "Today" / "Yesterday" / "Tue 21 Oct 2026" */
export function relDay(ts) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(new Date(ts))) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  return fmtDate(ts);
}

/** Trigger a file download in the browser. */
export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Shown in the Routines tab so you can tell which build is actually loaded. */
export const APP_VERSION = '14';

/** CSV field quoting. */
export function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
