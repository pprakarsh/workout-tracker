// Presentation helpers: turn an entry into human-readable summary strings.
//
// These live outside js/views/ on purpose. The exporter needs the same wording as
// the screen does, and a core module must never import from a view — see the
// dependency rule in ARCHITECTURE.md. Everything here is a pure string builder:
// no DOM, no HTML, no escaping. Callers escape.
import { state } from './store.js';
import { fmtNum, fmtReps, fmtClock, fmtDur } from './util.js';

/** "60×10 · 70×8 · 80×5-6" for a per-set plan. */
export function planLine(e) {
  if (!e.setTargets) return '';
  return e.setTargets
    .map((t) => `${t.weight !== null ? fmtNum(t.weight) : ''}×${fmtReps(t.repsMin, t.repsMax) || '?'}`)
    .join(' · ');
}

/** What the routine asks for: "3 × 8-12 · @ 70 kg · rest 2:30". */
export function targetLine(e) {
  const bits = [];
  if (e.type === 'lift') {
    if (e.setTargets) {
      bits.push(`${e.setTargets.length} sets: ${planLine(e)} ${e.unit || state.settings.unit}`);
    } else {
      const reps = fmtReps(e.repsMin, e.repsMax);
      const sets = e.targetSets ? `${fmtNum(e.targetSets)} ×` : '';
      if (sets || reps) bits.push(`${sets} ${reps || '?'}`.trim());
      if (e.weight !== null && e.weight !== undefined) {
        bits.push(`@ ${fmtNum(e.weight)} ${e.unit || state.settings.unit}`);
      }
    }
  } else {
    if (e.targetDistance !== null && e.targetDistance !== undefined) {
      bits.push(`${fmtNum(e.targetDistance)} ${e.distanceUnit || state.settings.distanceUnit}`);
    }
    if (e.targetDuration) bits.push(fmtDur(e.targetDuration));
  }
  if (e.rest) bits.push(`rest ${fmtClock(e.rest)}`);
  return bits.join(' · ');
}

/** "5:19/km" from a distance and a duration in seconds. */
export function pace(distance, seconds, unit) {
  if (!distance || !seconds) return '';
  return `${fmtClock(seconds / distance)}/${unit || 'km'}`;
}

/** One-line summary of what was actually logged, for list views and exports. */
export function logSummary(e) {
  if (e.type === 'cardio') {
    const l = e.log || {};
    const bits = [];
    if (l.distance !== null && l.distance !== undefined) bits.push(`${fmtNum(l.distance)} ${l.distanceUnit || 'km'}`);
    if (l.duration) bits.push(fmtClock(l.duration));
    const p = pace(l.distance, l.duration, l.distanceUnit);
    if (p) bits.push(p);
    if (l.avgHr) bits.push(`avg ${fmtNum(l.avgHr)} bpm`);
    if (l.maxHr) bits.push(`max ${fmtNum(l.maxHr)} bpm`);
    if (l.elevation) bits.push(`${fmtNum(l.elevation)} m elev`);
    if (l.rpe) bits.push(`RPE ${fmtNum(l.rpe)}`);
    return bits.join(' · ');
  }
  const sets = (e.sets || []).filter((s) => s.done || s.reps !== null || s.weight !== null);
  if (!sets.length) return '';
  return sets.map((s) => {
    const w = s.weight !== null ? `${fmtNum(s.weight)}${s.unit || ''}` : '—';
    const r = s.reps !== null ? fmtNum(s.reps) : '—';
    return `${w}×${r}${s.rpe ? ` @${fmtNum(s.rpe)}` : ''}`;
  }).join('  ');
}

/**
 * Actual rest taken, per set, naming the gaps explicitly rather than implying a
 * value. A set you never started the timer for reads "no rest logged" — it is
 * not back-filled with the routine's target or any other default.
 */
export function restLine(e) {
  const sets = e.sets || [];
  const logged = sets
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.done || s.weight !== null || s.reps !== null);
  if (!logged.length) return '';
  if (!sets.some((s) => s.rest)) return 'Rest: no rest logged for any set';
  return `Rest after sets: ${logged
    .map(({ s, i }) => `${i + 1}) ${s.rest ? fmtClock(s.rest) : 'no rest logged'}`)
    .join(' · ')}`;
}
