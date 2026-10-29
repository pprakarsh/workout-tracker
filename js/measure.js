// What a set is measured in: reps, time, or distance.
//
// Planks, dead hangs and L-sits are measured in SECONDS. Farmer carries, sled
// pushes and sandbag walks are measured in METRES. Both are otherwise ordinary
// strength sets -- they have a load, warmups, RPE, per-set targets and rest --
// so this is one axis on a lift entry, not a third entry type. Everything
// built for lifts keeps working; only the number's unit changes.
//
// WHERE THE NUMBER LIVES: in `set.reps`, and the target range in
// `repsMin`/`repsMax`, whatever the measure. Those names are historical. The
// alternative was parallel `seconds`/`distance` fields, which would have meant
// branching every reader, exporter and stepper, and a migration for data that
// is already on the user's phone. `measure` on the entry says what the number
// means, and nothing reinterprets an existing entry: an entry without a
// measure is `reps`, exactly as it was. Read it through `fmtAmount` and write
// it through `parseAmount` rather than touching `reps` directly.
import { num, fmtNum, fmtClock, parseDur, parseReps } from './util.js';

export const MEASURES = {
  reps: {
    key: 'reps',
    label: 'Reps',
    long: 'Reps (normal sets)',
    short: 'reps',
    // the column header: carries the UNIT, and stays visible once a value is typed
    header: 'Reps',
    // the placeholder: carries the FORMAT, shown only while the field is empty
    placeholder: '8 or 8-12',
    step: 1,
    stepLabel: ' rep',
    // a count: 8, or the range 8-12
    inputmode: 'numeric',
    needsLoad: true,
  },
  time: {
    key: 'time',
    label: 'Time',
    long: 'Time in seconds (plank, dead hang, L-sit)',
    short: 'sec',
    header: 'Time (s)',
    // SECONDS, not a clock value: the numeric keypad this field asks for has no
    // colon on it. 90 is a minute and a half, and the confirm bar echoes it
    // back as 1:30 so the conversion is visible.
    placeholder: '45',
    step: 5,
    stepLabel: 's',
    inputmode: 'numeric',
    // a plank has no external load; requiring one would block logging it
    needsLoad: false,
  },
  distance: {
    key: 'distance',
    label: 'Distance',
    long: 'Distance in metres (farmer carry, sled push)',
    short: 'm',
    header: 'Dist (m)',
    placeholder: '40',
    step: 5,
    stepLabel: ' m',
    inputmode: 'decimal',
    needsLoad: false,
  },
};

/** Normalise any spelling of a measure to a key. Anything unknown is reps. */
export function parseMeasure(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['time', 'seconds', 'secs', 'sec', 'duration', 'hold', 'isometric', 'isometrics'].includes(s)) return 'time';
  if (['distance', 'metres', 'meters', 'm', 'carry', 'loaded carry'].includes(s)) return 'distance';
  return 'reps';
}

export const measureOf = (e) => MEASURES[e?.measure] || MEASURES.reps;

/**
 * Render an amount with its unit: "12", "45s", "1:30" or "40 m".
 * Times over a minute read as a clock, because "90s" is harder to picture than
 * "1:30" and planks go past a minute.
 */
export function fmtAmount(n, measure = 'reps') {
  if (n === null || n === undefined || n === '') return '';
  const m = MEASURES[measure] || MEASURES.reps;
  if (m.key === 'time') return Number(n) >= 60 ? fmtClock(Number(n)) : `${fmtNum(n)}s`;
  if (m.key === 'distance') return `${fmtNum(n)} m`;
  return fmtNum(n);
}

/** Render a target range: "8-12", "30-45s", "40 m". */
export function fmtAmountRange(min, max, measure = 'reps') {
  if (min === null && max === null) return '';
  if (min !== null && max !== null && min !== max) {
    const m = MEASURES[measure] || MEASURES.reps;
    if (m.key === 'time') return `${fmtNum(min)}-${fmtAmount(max, 'time')}`;
    if (m.key === 'distance') return `${fmtNum(min)}-${fmtAmount(max, 'distance')}`;
    return `${fmtNum(min)}-${fmtNum(max)}`;
  }
  return fmtAmount(min ?? max, measure);
}

/**
 * Parse what the user typed into an amount. A bare number is the measure's own
 * unit -- seconds for time, metres for distance -- and a time also accepts
 * "1:30", so a long hold can be entered the way it reads on a clock.
 */
export function parseAmount(v, measure = 'reps') {
  const m = MEASURES[measure] || MEASURES.reps;
  if (m.key === 'time') return parseDur(v, { bare: 'seconds' });
  return num(v);
}

/**
 * Parse a target range in the entry's own unit: "8-12", "30-45", "1:00",
 * "0:30-1:30". Returns {min, max} with nulls allowed, like parseReps, which it
 * delegates to for ordinary rep counts.
 */
export function parseAmountRange(v, measure = 'reps') {
  if (v === null || v === undefined || v === '') return { min: null, max: null };
  if (measure !== 'time') {
    if (typeof v === 'object') return { min: num(v.min), max: num(v.max) };
    return parseReps(v);
  }
  if (typeof v === 'object') return { min: num(v.min), max: num(v.max) };
  if (typeof v === 'number') return { min: Math.round(v), max: Math.round(v) };
  const s = String(v).trim();
  // split on a dash that is not part of a clock value
  const m = s.match(/^(.+?)\s*(?:-|\u2013|to)\s*(.+)$/);
  if (m) {
    const lo = parseDur(m[1], { bare: 'seconds' });
    const hi = parseDur(m[2], { bare: 'seconds' });
    if (lo !== null || hi !== null) return { min: lo, max: hi };
  }
  const one = parseDur(s, { bare: 'seconds' });
  return { min: one, max: one };
}

/** The value for the editable field: a time shows as a clock past a minute. */
export function amountFieldValue(n, measure = 'reps') {
  if (n === null || n === undefined) return '';
  if (measure === 'time' && Number(n) >= 60) return fmtClock(Number(n));
  return fmtNum(n);
}

/**
 * Is there enough on this set to call it logged? An amount always, plus a load
 * for ordinary rep sets. A plank or a carry may legitimately carry no weight,
 * so demanding one would make them impossible to tick.
 */
export function setIsLoggableFor(set, measure = 'reps') {
  if (!set) return false;
  if (set.reps === null || set.reps === undefined) return false;
  if (!(MEASURES[measure] || MEASURES.reps).needsLoad) return true;
  return set.bodyweight || set.weight !== null;
}

/** Does this measure contribute to tonnage? weight x seconds is not volume. */
export const countsTowardsVolume = (measure = 'reps') => measure === 'reps' || !measure;
