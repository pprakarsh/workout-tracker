// Presentation helpers: turn an entry into human-readable summary strings.
//
// These live outside js/views/ on purpose. The exporter needs the same wording as
// the screen does, and a core module must never import from a view — see the
// dependency rule in ARCHITECTURE.md. Everything here is a pure string builder:
// no DOM, no HTML, no escaping. Callers escape.
import { state } from './store.js';
import { setLabels } from './model.js';
import {
  isIntervals, patternText, paceOf, fmtPace, intervalSummary, totalsText,
} from './cardio.js';
import { fmtNum, fmtClock, fmtDur } from './util.js';
import { fmtAmount, fmtAmountRange, measureOf } from './measure.js';

/** "60×10 · 70×8 · 80×5-6" for a per-set plan, or "×45s" for a timed one. */
/**
 * The per-set plan as one line: "100×8 · 100×8 · 100×8".
 *
 * A drop stage is joined with `>` rather than `·`, so a drop set reads as the
 * one set it is -- "100×8 > 80×6 > 60×5" -- and matches the notation the
 * exercise form accepts as input.
 */
export function planLine(e) {
  if (!e.setTargets) return '';
  const m = e.measure || 'reps';
  return e.setTargets
    .map((t, i) => {
      const cell = `${t.weight !== null ? fmtNum(t.weight) : ''}×${fmtAmountRange(t.repsMin, t.repsMax, m) || '?'}`;
      if (i === 0) return cell;
      return `${t.drop ? ' > ' : ' · '}${cell}`;
    })
    .join('');
}

/** What the routine asks for: "3 × 8-12 · @ 70 kg · rest 2:30". */
export function targetLine(e) {
  const bits = [];
  if (e.type === 'lift') {
    if (e.setTargets) {
      bits.push(`${e.setTargets.length} sets: ${planLine(e)} ${e.unit || state.settings.unit}`);
    } else {
      const reps = fmtAmountRange(e.repsMin, e.repsMax, e.measure);
      const sets = e.targetSets ? `${fmtNum(e.targetSets)} ×` : '';
      if (sets || reps) bits.push(`${sets} ${reps || '?'}`.trim());
      if (e.bodyweight) {
        bits.push(e.weight ? `BW + ${fmtNum(e.weight)} ${e.unit || state.settings.unit}` : 'bodyweight');
      } else if (e.weight !== null && e.weight !== undefined) {
        bits.push(`@ ${fmtNum(e.weight)} ${e.unit || state.settings.unit}`);
      }
    }
  } else if (isIntervals(e)) {
    // the pattern says it all: "1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6"
    const unit = e.distanceUnit || state.settings.distanceUnit;
    bits.push(patternText(e.legs, e.rounds, unit));
    const totals = totalsText(e.legs, e.rounds, unit);
    if (totals) bits.push(totals);
  } else {
    if (e.targetDistance !== null && e.targetDistance !== undefined) {
      bits.push(`${fmtNum(e.targetDistance)} ${e.distanceUnit || state.settings.distanceUnit}`);
    }
    if (e.targetDuration) bits.push(fmtDur(e.targetDuration));
    if (e.targetPace) bits.push(fmtPace(e.targetPace, e.distanceUnit || state.settings.distanceUnit));
  }
  if (e.rest) bits.push(`rest ${fmtClock(e.rest)}`);
  return bits.join(' \u00b7 ');
}

/** "5:19/km" from a distance and a duration in seconds. */
export const pace = paceOf;

/**
 * How a set's load reads: "BW", "BW+10kg", "102.5kg", or an em dash when nothing
 * has been entered yet. A bodyweight set's `weight` is ADDED load.
 */
export function loadLabel(s, { spaced = false } = {}) {
  if (!s) return '—';
  const gap = spaced ? ' ' : '';
  if (s.bodyweight) {
    return s.weight ? `BW + ${fmtNum(s.weight)}${gap}${s.unit || ''}` : 'BW';
  }
  return s.weight !== null && s.weight !== undefined
    ? `${fmtNum(s.weight)}${gap}${s.unit || ''}` : '—';
}

/** The effort suffix for a set: "@8" for RPE, "r2" for reps-in-reserve. */
export function effortTag(s) {
  const bits = [];
  if (s.rpe !== null && s.rpe !== undefined) bits.push(`@${fmtNum(s.rpe)}`);
  if (s.rir !== null && s.rir !== undefined) bits.push(`r${fmtNum(s.rir)}`);
  return bits.length ? ` ${bits.join(' ')}` : '';
}

/**
 * One-line summary of what was actually logged, for list views and exports.
 * Warmups are prefixed "W". Pass { workingOnly } where warmups would be noise,
 * such as the "last time" reference while you are logging.
 */
export function logSummary(e, { workingOnly = false } = {}) {
  if (e.type === 'cardio') {
    const l = e.log || {};
    const unit = l.distanceUnit || 'km';
    // an interval block reports as rounds; only ticked legs count
    if (l.legs && l.legs.length) {
      const iv = intervalSummary(l, unit);
      const extra = [];
      if (l.avgHr) extra.push(`avg ${fmtNum(l.avgHr)} bpm`);
      if (l.rpe) extra.push(`RPE ${fmtNum(l.rpe)}`);
      return iv ? [iv, ...extra].join(' \u00b7 ') : '';
    }
    // a plain run reports nothing until it is confirmed: the numbers are
    // pre-filled from the plan, so an unticked log is intent, not history
    if (!l.done) return '';
    const bits = [];
    if (l.distance !== null && l.distance !== undefined) bits.push(`${fmtNum(l.distance)} ${unit}`);
    if (l.duration) bits.push(fmtClock(l.duration));
    const p = l.pace ? fmtPace(l.pace, unit) : paceOf(l.distance, l.duration, unit);
    if (p) bits.push(p);
    if (l.avgHr) bits.push(`avg ${fmtNum(l.avgHr)} bpm`);
    if (l.maxHr) bits.push(`max ${fmtNum(l.maxHr)} bpm`);
    if (l.elevation) bits.push(`${fmtNum(l.elevation)} m elev`);
    if (l.rpe) bits.push(`RPE ${fmtNum(l.rpe)}`);
    return bits.join(' \u00b7 ');
  }
  // Only ticked sets. Since the plan is pre-materialised, an unticked row is
  // intent, not history -- showing it would report the plan as if it happened.
  const sets = (e.sets || []).filter((s) => s.done && !(workingOnly && s.warmup));
  if (!sets.length) return '';
  const m = e.measure || 'reps';
  return sets.map((s) => {
    const r = s.reps !== null ? fmtAmount(s.reps, m) : '—';
    // a timed or carried set with no load reads "45s", not "—×45s"
    const load = loadLabel(s);
    return `${s.warmup ? 'W ' : ''}${load === '—' && m !== 'reps' ? '' : `${load}×`}${r}${effortTag(s)}`;
  }).join('  ');
}

/**
 * Actual rest taken, per set, naming the gaps explicitly rather than implying a
 * value. A set you never started the timer for reads "no rest logged" — it is
 * not back-filled with the routine's target or any other default.
 */
export function restLine(e) {
  const sets = e.sets || [];
  const labels = setLabels(sets);
  // include a set that has a rest recorded but is not ticked yet: the timer can
  // be started for a set whose numbers have not been entered
  const logged = sets
    .map((s, i) => ({ s, label: labels[i] }))
    .filter(({ s }) => s.done || s.rest !== null);
  if (!logged.length) return '';
  if (!logged.some(({ s }) => s.rest)) return 'Rest: no rest logged for any set';
  return `Rest after sets: ${logged
    .map(({ s, label }) => `${label}) ${s.rest ? fmtClock(s.rest) : 'no rest logged'}`)
    .join(' · ')}`;
}
