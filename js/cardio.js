// Cardio domain logic: pace arithmetic and the interval pattern.
//
// Pure functions over plain objects. No DOM, no state, no store, no imports
// beyond util.js -- which is what lets the store call in to compute, the views
// and the exporter call in to format, and the tests check the maths without
// standing up a session.
//
// Two ideas carry the whole module:
//
//  1. A run is a triple {distance, duration, pace} of which any two fix the
//     third: distance = duration / pace. `resolveRun` keeps the triple
//     consistent, treating DURATION as the anchor -- see the comment there.
//  2. An interval block is a short repeating PATTERN of legs plus a round
//     count, not N independent efforts. One pattern, logged once, expanded for
//     the record. `plannedLegs` does the expanding.
import { num, uid, parseDur, fmtClock, fmtNum } from './util.js';

/** An interval leg longer than this is almost certainly a mis-parse ("400m"). */
const MAX_LEG = 3600;
/** Rounds are tapped through by hand; a huge count is a typo, not a workout. */
const MAX_ROUNDS = 50;

const round3 = (n) => Math.round(n * 1000) / 1000;

/** "mins"/"minutes"/"secs" -> the short forms parseDur understands. */
const units = (s) => String(s)
  .replace(/\bmin(?:ute)?s?\b/gi, 'm')
  .replace(/\bsec(?:ond)?s?\b/gi, 's')
  .replace(/\bh(?:ou)?rs?\b/gi, 'h');

/* ------------------------------------------------------------------ */
/* pace                                                               */
/* ------------------------------------------------------------------ */

/**
 * Pace in SECONDS PER DISTANCE UNIT. Accepts "8:00", "8:00/km", "8 min/km",
 * "6 mins per km", "7.5".
 *
 * A bare number means MINUTES per unit, because that is how everybody writes a
 * pace: 6 is six minutes a kilometre, not six seconds. This is the opposite of
 * a bare rest value, which means seconds -- the two fields are different enough
 * that one rule cannot serve both, so each one states its own and is tested.
 */
export function parsePace(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = units(String(v).trim().toLowerCase())
    .replace(/\s*(?:\/|per\s+)\s*(?:km|kilometres?|kilometers?|mi|miles?)\s*$/, '')
    .trim();
  if (!s) return null;
  const n = parseDur(s, { bare: 'minutes' });
  return n !== null && n > 0 ? Math.round(n) : null;
}

/** "8:00/km" from seconds per unit. */
export function fmtPace(seconds, unit = 'km') {
  if (!seconds) return '';
  return `${fmtClock(seconds)}/${unit}`;
}

/** "5:19/km" from a distance and a duration. The inverse of parsePace. */
export function paceOf(distance, seconds, unit = 'km') {
  if (!distance || !seconds) return '';
  return fmtPace(seconds / distance, unit);
}

/**
 * Keep {distance, duration, pace} consistent after one of them is edited.
 *
 * DURATION IS THE ANCHOR. Time is the thing you always actually know -- the
 * clock ran -- so editing pace or distance recomputes the other from duration,
 * and editing duration keeps the PACE you set and recomputes distance. That
 * last choice is deliberate: on a treadmill pace is the dial you hold while the
 * time changes, so holding pace is what a runner expects.
 *
 * Pass `changed` as the name of the field just edited. With no `changed` it
 * only fills in a genuinely missing third value and rewrites nothing.
 */
export function resolveRun(log = {}, changed = null) {
  const out = { ...log };
  const d = num(out.distance);
  const t = num(out.duration);
  const p = num(out.pace);
  const setDist = () => { out.distance = round3(t / p); };
  const setDur = () => { out.duration = Math.round(d * p); };
  const setPace = () => { out.pace = Math.round(t / d); };

  if (changed === 'pace') {
    if (t && p) setDist(); else if (d && p) setDur();
  } else if (changed === 'distance') {
    if (t && d) setPace(); else if (d && p) setDur();
  } else if (changed === 'duration') {
    if (t && p) setDist(); else if (t && d) setPace();
  } else if (!t && d && p) setDur();
  else if (!d && t && p) setDist();
  else if (!p && d && t) setPace();
  return out;
}

/* ------------------------------------------------------------------ */
/* the interval pattern                                               */
/* ------------------------------------------------------------------ */

/** A pace always carries a unit marker; that is how it is told from a duration. */
const PACE_RE = /(\d+(?::\d{1,2})?(?:\.\d+)?)\s*(?:m|min(?:ute)?s?)?\s*(?:\/|per\s+)\s*(?:km|kilometres?|kilometers?|mi|miles?)\b/i;
const DUR_RE = /(\d+:\d{1,2}|\d+(?:\.\d+)?\s*(?:h|m|s)\b|\d+(?:\.\d+)?)/i;

/**
 * A leg duration. Bare numbers are SECONDS here: an interval leg written `90`
 * means ninety seconds, never ninety minutes. Anything over an hour is refused
 * rather than accepted as nonsense -- it catches `400m`, which parseDur would
 * otherwise read as four hundred minutes.
 */
function parseLegDur(v) {
  const n = parseDur(units(v), { bare: 'seconds' });
  if (n === null || n <= 0 || n > MAX_LEG) return null;
  return n;
}

/**
 * Read a value that may be either human input or our own stored number.
 *
 * A NUMBER is already canonical seconds -- that is how we store it -- and must
 * pass through untouched. Re-parsing it would multiply it by sixty on every
 * round trip, because a bare number from a human means minutes for a pace and
 * for a run duration. Entries ARE re-normalised routinely: on every session
 * start and every save back to a routine. A STRING is human input and gets
 * parsed. Hand-written routines should therefore use strings ("8:00"), which is
 * what the AI prompt and the sample JSON both show.
 */
export const storedSeconds = (v, parse) => {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  return parse(v);
};

/**
 * One leg: a duration, an optional pace and whatever words are left over as a
 * label. Pulled out by pattern rather than split on a separator, so `1:30 walk
 * @ 6:00/km`, `1:30 - walk - 6 mins per km` and `1:30 walk` all work.
 */
function parseLeg(raw) {
  // Normalise unit words FIRST. "1 min" must reach DUR_RE as "1 m", or the
  // bare-number branch matches the "1" alone and reads it as one second.
  let text = units(String(raw ?? '')).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const cut = (m) => { text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.trim(); };

  let pace = null;
  const pm = text.match(PACE_RE);
  if (pm) { pace = parsePace(pm[1]); cut(pm); }

  let duration = null;
  const dm = text.match(DUR_RE);
  if (dm) { duration = parseLegDur(dm[1]); cut(dm); }

  const label = text.replace(/[@\-\u2013\u2014,:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  // A leg needs a TIME or a PACE. A bare word is not a leg -- without this,
  // "nonsense" parses as a one-leg pattern and the editor claims to understand
  // it. Keeping a pace-only leg is deliberate: it renders as "? @ 6:00/km",
  // which tells you the time is what was not understood.
  if (duration === null && pace === null) return null;
  return { label, duration, pace };
}

/**
 * Parse a whole pattern: "1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6".
 *
 * Deliberately forgiving about punctuation, because this is typed on a phone
 * between sets: `+` or `,` separates legs, `@` or `-` separates a leg's parts,
 * `x`/`X`/`*` or the multiplication sign gives the round count at either end,
 * and wrapping parentheses are ignored. Returns null when nothing usable is
 * found -- callers show the canonical form back so a mis-read is visible.
 */
export function parseIntervals(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;

  let rounds = null;
  let m = s.match(/[x\u00d7*]\s*(\d{1,3})\s*$/i);
  if (m) { rounds = Number(m[1]); s = s.slice(0, m.index).trim(); } else {
    m = s.match(/^(\d{1,3})\s*[x\u00d7*]\s*/i);
    if (m) { rounds = Number(m[1]); s = s.slice(m[0].length).trim(); }
  }
  s = s.replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();

  const legs = s.split(/\s*[+,;]\s*/).map(parseLeg).filter(Boolean);
  if (!legs.length) return null;
  return {
    legs,
    rounds: rounds && rounds > 1 ? Math.min(Math.round(rounds), MAX_ROUNDS) : 1,
  };
}

/** One leg as text: "1:30 walk @ 6:00/km". */
export function legText(lg, unit = 'km') {
  if (!lg) return '';
  const bits = [lg.duration ? fmtClock(lg.duration) : '?'];
  if (lg.label) bits.push(lg.label);
  if (lg.pace) bits.push(`@ ${fmtPace(lg.pace, unit)}`);
  return bits.join(' ');
}

/** The canonical pattern string. Echoed back in the UI so a typo is obvious. */
export function patternText(legs, rounds, unit = 'km') {
  if (!legs || !legs.length) return '';
  const body = legs.map((lg) => legText(lg, unit)).join(' + ');
  return rounds && rounds > 1 ? `${body} \u00d7 ${rounds}` : body;
}

/** Does this entry describe an interval block rather than one straight run? */
export const isIntervals = (e) => !!(e && e.legs && e.legs.length);

/**
 * Read an interval plan out of a loosely-shaped object -- hand-written JSON,
 * an old backup, or the routine form. Accepts, in order of preference:
 *
 *   pattern/intervals: "1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6"   (a string)
 *   legs: [{duration, pace, label}, ...]  with  rounds: 6
 *   repeat/rounds: 6                      the pre-pattern form: N efforts of
 *                                         the entry's own duration and pace
 *
 * The last case is why old routines keep working. `repeat: 6` used to explode
 * into six separate entries; it now becomes six rounds of one leg inside a
 * single entry, which is the same workout with one place to log it.
 */
export function intervalSpec(raw = {}, fallback = {}) {
  const text = raw.pattern ?? (typeof raw.intervals === 'string' ? raw.intervals : null);
  const parsed = text ? parseIntervals(text) : null;
  if (parsed) return parsed;

  const declared = num(raw.rounds ?? raw.repeat ?? (typeof raw.intervals === 'number' ? raw.intervals : null));
  const rounds = declared && declared > 1 ? Math.min(Math.round(declared), MAX_ROUNDS) : 1;

  if (Array.isArray(raw.legs) && raw.legs.length) {
    const legs = raw.legs.map((lg) => (typeof lg === 'string' ? parseLeg(lg) : {
      label: String(lg.label ?? lg.name ?? '').trim().slice(0, 24),
      duration: storedSeconds(lg.duration ?? lg.time, parseLegDur),
      pace: storedSeconds(lg.pace, parsePace),
    })).filter((lg) => lg && (lg.duration !== null || lg.pace !== null || lg.label));
    if (legs.length) return { legs, rounds };
  }

  // No pattern, but a round count: one leg built from the entry's own targets.
  if (rounds > 1) {
    return {
      legs: [{
        label: '',
        duration: fallback.duration ?? null,
        pace: fallback.pace ?? null,
      }],
      rounds,
    };
  }
  return { legs: null, rounds: 1 };
}

/**
 * Total time, plus total distance for the legs that name a pace. `partial` says
 * some leg had no pace, so the distance is a floor rather than the real figure:
 * a recovery leg that covers no ground and a leg whose pace was never entered
 * are indistinguishable from here, so we report the gap instead of guessing.
 */
export function legTotals(legs = []) {
  let duration = 0;
  let distance = 0;
  let partial = false;
  legs.forEach((lg) => {
    duration += num(lg.duration) || 0;
    if (lg.duration && lg.pace) distance += lg.duration / lg.pace;
    else partial = true;
  });
  return { duration, distance: distance ? round3(distance) : null, partial };
}

/**
 * The pattern, expanded: one row per leg per round, pre-filled from the plan so
 * the block opens as something to confirm rather than a form to fill in. Same
 * principle as a lift's pre-materialised sets.
 */
export function plannedLegs(entry) {
  if (!isIntervals(entry)) return null;
  const rounds = Math.min(Math.max(Math.round(entry.rounds || 1), 1), MAX_ROUNDS);
  const out = [];
  for (let r = 1; r <= rounds; r++) {
    entry.legs.forEach((lg, i) => out.push({
      id: uid('lg'),
      round: r,
      leg: i,
      label: lg.label || '',
      duration: lg.duration ?? null,
      pace: lg.pace ?? null,
      done: false,
      // set when this row is changed by hand, which exempts it from a later
      // edit of the pattern -- "modify one round" must survive "fix the plan"
      edited: false,
    }));
  }
  return out;
}

/**
 * Re-expand after the pattern changed, keeping what the user has already done:
 * ticks survive, and a leg edited by hand keeps its own numbers.
 */
export function reconcileLegs(entry, existing = []) {
  const next = plannedLegs(entry);
  if (!next) return null;
  const prior = new Map(existing.map((x) => [`${x.round}:${x.leg}`, x]));
  return next.map((x) => {
    const was = prior.get(`${x.round}:${x.leg}`);
    if (!was) return x;
    return {
      ...x,
      id: was.id,
      done: was.done,
      edited: was.edited,
      duration: was.edited ? was.duration : x.duration,
      pace: was.edited ? was.pace : x.pace,
      label: was.edited ? was.label : x.label,
    };
  });
}

/** Group the flat leg list back into rounds for display. */
export function byRound(legs = []) {
  const out = [];
  legs.forEach((lg) => {
    const i = lg.round - 1;
    (out[i] = out[i] || []).push(lg);
  });
  return out.filter(Boolean);
}

/**
 * What an interval block actually came to: rounds completed, time on the clock
 * and distance covered, counting ticked legs only. An unticked leg is still
 * plan, not history.
 */
export function intervalSummary(log, unit = 'km') {
  const legs = (log?.legs || []).filter((x) => x.done);
  if (!legs.length) return '';
  const rounds = new Set(legs.map((x) => x.round)).size;
  const { duration, distance, partial } = legTotals(legs);
  const bits = [`${rounds} round${rounds === 1 ? '' : 's'}`];
  if (duration) bits.push(fmtClock(duration));
  if (distance) bits.push(`${partial ? '\u2265 ' : ''}${fmtNum(distance)} ${unit}`);
  const edited = legs.filter((x) => x.edited).length;
  if (edited) bits.push(`${edited} leg${edited === 1 ? '' : 's'} adjusted`);
  return bits.join(' \u00b7 ');
}

/** "15:00 - 2.25 km" for the plan, as shown beside the log-everything button. */
export function totalsText(legs, rounds, unit = 'km') {
  if (!legs || !legs.length) return '';
  const one = legTotals(legs);
  const n = Math.max(1, rounds || 1);
  const bits = [];
  if (one.duration) bits.push(fmtClock(one.duration * n));
  if (one.distance) bits.push(`${one.partial ? '\u2265 ' : ''}${fmtNum(round3(one.distance * n))} ${unit}`);
  return bits.join(' \u00b7 ');
}

/**
 * Did this cardio entry actually record anything?
 *
 * Ticked legs, or a confirmed run -- never the pre-filled numbers on their own.
 * A cardio log now opens pre-filled from its targets, exactly as a lift's sets
 * are pre-materialised, so "has a distance" stopped meaning "was run". Every
 * caller asking that question must come through here.
 */
export const cardioLogged = (log) => {
  if (!log) return false;
  if (log.legs && log.legs.length) return log.legs.some((x) => x.done);
  return !!log.done;
};

/** Per-round detail lines for exports and the read-only history card. */
export function roundLines(log, unit = 'km') {
  return byRound(log?.legs || []).map((legs, i) => {
    const body = legs.map((lg) => `${legText(lg, unit)}${lg.done ? '' : ' (not logged)'}`).join(' + ');
    return `${i + 1}) ${body}`;
  });
}
