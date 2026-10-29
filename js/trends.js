// Progress analysis: what a run of logged sets says about getting better.
//
// Pure. State comes in as plain sessions, numbers go out. The views draw them,
// js/chart.js turns them into SVG, and nothing here knows about either.
//
// THE DESIGN PROBLEM, stated once because every function below bends to it:
// progress is multi-dimensional and the dimensions trade off. 100x5 -> 105x3
// raises the top set and lowers the volume; 100x8 -> 95x10 lowers the top set
// and raises both volume and estimated strength. Any single number called
// "progress" will therefore tell a lifter they are regressing when they are
// not. So every series here keeps the RAW SETS alongside the summary, and the
// views plot both.
import { num, fmtNum, fmtClock, toUnit, toDistance } from './util.js';
import { measureOf } from './measure.js';

/** Past this many reps an estimate stops meaning anything. See e1rm. */
export const E1RM_MAX_REPS = 12;
/** Past this, the estimate still computes but is marked uncertain. */
export const E1RM_SOFT_REPS = 10;
/** At or below this RPE the set was not near failure, so the estimate is weak. */
export const SUBMAX_RPE = 7;
/** At or above this many reps in reserve, likewise. */
export const SUBMAX_RIR = 3;

/**
 * Estimated one-rep max, Epley: w x (1 + r/30).
 *
 * Returns null rather than a number whenever the estimate would be fiction:
 *
 *  - above 12 reps. The formulas are materially less accurate past ~12, and
 *    they disagree with each other by 5-15% past 10, so a 20-rep set produces
 *    a confident-looking number that means nothing.
 *  - with no load. A bodyweight set's real load is the body, and this app
 *    refuses to invent a bodyweight anywhere else either (see sessionVolume).
 *    Pass `bodyweight` when the session recorded one and it is used properly.
 *
 * It is an ESTIMATE and every caller must label it as one.
 */
export function e1rm(weight, reps, { bodyweight = null, isBodyweight = false } = {}) {
  const r = num(reps);
  const w = num(weight);
  if (r === null || r < 1 || r > E1RM_MAX_REPS) return null;
  const load = isBodyweight
    ? (bodyweight === null ? null : bodyweight + (w || 0))
    : w;
  if (load === null || load <= 0) return null;
  // A single rep is not an estimate, it is the measurement. Epley would return
  // w x 31/30 here -- 103.3 for a 100 kg single -- inventing a PR you did not
  // lift and beating your own real max with arithmetic.
  if (r === 1) return Math.round(load * 10) / 10;
  return Math.round(load * (1 + (r / 30)) * 10) / 10;
}

/** Is this set too easy, or too long, for its estimate to carry weight? */
export function isWeakEstimate(set) {
  if (!set) return true;
  if (num(set.reps) !== null && num(set.reps) >= E1RM_SOFT_REPS) return true;
  if (num(set.rpe) !== null && num(set.rpe) <= SUBMAX_RPE) return true;
  if (num(set.rir) !== null && num(set.rir) >= SUBMAX_RIR) return true;
  return false;
}

/** Work done by one set, in the target unit. Reps only -- see countsTowardsVolume. */
function setVolume(set, unit, sessionBodyweight) {
  const reps = num(set.reps);
  if (reps === null) return 0;
  const w = toUnit(num(set.weight) ?? 0, set.unit || unit, unit);
  if (set.bodyweight) {
    if (sessionBodyweight === null || sessionBodyweight === undefined) return 0;
    return (toUnit(sessionBodyweight, unit, unit) + w) * reps;
  }
  return w * reps;
}

/**
 * Every logged working set of one exercise, newest session first, with each
 * set's weight converted into `unit`.
 *
 * Warmups and unticked sets are excluded, as everywhere else in the app: a
 * warmup is not working and an unticked row is plan, not history.
 */
export function exerciseSets(sessions, key, normKey, unit) {
  const out = [];
  let converted = 0;
  sessions.forEach((s) => {
    if (!s.finishedAt) return;                 // an unfinished session is not a result
    s.entries.forEach((e) => {
      if (normKey(e.name) !== key || e.type !== 'lift') return;
      (e.sets || []).forEach((x) => {
        if (!x.done || x.warmup) return;
        const from = x.unit || s.unit || unit;
        if (from !== unit && num(x.weight) !== null) converted++;
        out.push({
          at: x.completedAt || s.startedAt,
          sessionId: s.id,
          sessionAt: s.startedAt,
          measure: e.measure || 'reps',
          weight: num(x.weight) === null ? null : toUnit(num(x.weight), from, unit),
          reps: num(x.reps),
          rpe: num(x.rpe),
          rir: num(x.rir),
          bodyweight: !!x.bodyweight,
          sessionBodyweight: num(s.bodyweight),
          unit,
        });
      });
    });
  });
  return { sets: out, converted };
}

/** The metric a measure is judged on. Not everything is weight x reps. */
export function metricFor(measure) {
  if (measure === 'time') {
    return {
      key: 'time', title: 'Longest hold', axis: 'Hold (s)',
      value: (x) => num(x.reps),
      fmt: (v) => (v >= 60 ? fmtClock(v) : `${fmtNum(v)}s`),
      estimate: false,
    };
  }
  if (measure === 'distance') {
    return {
      key: 'distance', title: 'Furthest carry', axis: 'Distance (m)',
      value: (x) => num(x.reps),
      fmt: (v) => `${fmtNum(v)} m`,
      estimate: false,
    };
  }
  return {
    key: 'e1rm', title: 'Estimated 1RM', axis: 'e1RM',
    value: (x) => e1rm(x.weight, x.reps, {
      bodyweight: x.sessionBodyweight, isBodyweight: x.bodyweight,
    }),
    fmt: (v, unit = '') => `${fmtNum(Math.round(v * 10) / 10)}${unit ? ` ${unit}` : ''}`,
    estimate: true,
  };
}

/**
 * Group sets into one entry per session, carrying that session's best value.
 * Oldest first, which is the order a chart reads in.
 */
export function bySession(sets, metric) {
  const map = new Map();
  sets.forEach((x) => {
    const v = metric.value(x);
    const row = map.get(x.sessionId) || {
      sessionId: x.sessionId, at: x.sessionAt, sets: [], best: null, bestSet: null,
    };
    row.sets.push(x);
    if (v !== null && (row.best === null || v > row.best)) { row.best = v; row.bestSet = x; }
    map.set(x.sessionId, row);
  });
  return [...map.values()].sort((a, b) => a.at - b.at);
}

/** A set's load as text: "100 kg", "BW + 10 kg", "BW". */
export function setLoad(x, unit) {
  if (x.bodyweight) return x.weight ? `BW + ${fmtNum(x.weight)} ${unit}` : 'BW';
  return x.weight === null ? '--' : `${fmtNum(x.weight)} ${unit}`;
}

/**
 * Personal bests. Each is the single set that holds the record, with ties
 * broken by the EARLIEST date -- you set the record the first time you hit it,
 * not the most recent time you matched it.
 */
export function personalBests(sets, measure, unit) {
  const metric = metricFor(measure);
  const pick = (score) => {
    let hit = null;
    let bestScore = null;
    [...sets].sort((a, b) => a.at - b.at).forEach((x) => {
      const v = score(x);
      if (v === null || v === undefined) return;
      if (bestScore === null || v > bestScore) { bestScore = v; hit = x; }
    });
    return hit === null ? null : { set: hit, value: bestScore };
  };

  if (measure === 'time' || measure === 'distance') {
    const top = pick((x) => num(x.reps));
    const loaded = pick((x) => (x.weight === null ? null : x.weight));
    return [
      top && { label: metric.title, value: metric.fmt(top.value), set: top.set },
      loaded && { label: 'Heaviest', value: `${fmtNum(loaded.value)} ${unit}`, set: loaded.set },
    ].filter(Boolean);
  }

  const heaviest = pick((x) => (x.bodyweight ? null : x.weight));
  const best1rm = pick((x) => metric.value(x));
  const bestVol = pick((x) => (x.reps === null || x.weight === null ? null : x.weight * x.reps));
  const mostReps = pick((x) => x.reps);
  return [
    heaviest && { label: 'Heaviest set', value: `${fmtNum(heaviest.value)} ${unit} \u00d7 ${fmtNum(heaviest.set.reps)}`, set: heaviest.set },
    best1rm && { label: 'Best est. 1RM', value: `${fmtNum(best1rm.value)} ${unit}`, set: best1rm.set, estimate: true },
    bestVol && { label: 'Best set volume', value: `${fmtNum(Math.round(bestVol.value))} ${unit}`, set: bestVol.set },
    mostReps && { label: 'Most reps', value: `${fmtNum(mostReps.value)} @ ${setLoad(mostReps.set, unit)}`, set: mostReps.set },
  ].filter(Boolean);
}

/** The fewest sessions worth drawing a trend from. Two points make a line, not a trend. */
export const MIN_TREND_SESSIONS = 3;

/**
 * The headline change: a FACT, not a verdict.
 *
 * First session's best against the last, with the span, and nothing else. No
 * regression line (it implies a forecast the data cannot support) and no
 * "stalled" warning (four flat weeks during a deload is correct training, and
 * this app cannot tell the difference). Returns null below MIN_TREND_SESSIONS.
 */
export function trendDelta(rows) {
  const usable = rows.filter((r) => r.best !== null);
  if (usable.length < MIN_TREND_SESSIONS) {
    return { enough: false, have: usable.length, need: MIN_TREND_SESSIONS };
  }
  const first = usable[0];
  const last = usable[usable.length - 1];
  const weeks = Math.max(1, Math.round((last.at - first.at) / (7 * 86400000)));
  return {
    enough: true,
    from: first.best,
    to: last.best,
    change: Math.round((last.best - first.best) * 10) / 10,
    sessions: usable.length,
    weeks,
  };
}

/* ------------------------------------------------------------------ */
/* across all exercises                                              */
/* ------------------------------------------------------------------ */

/** Monday-keyed buckets of total volume and set count, oldest first. */
export function weeklyTotals(sessions, unit, weeks, startOfWeek, addWeeks, now = Date.now(), distUnit = 'km') {
  const first = addWeeks(startOfWeek(now), -(weeks - 1));
  const buckets = [];
  for (let i = 0; i < weeks; i++) {
    const from = addWeeks(first, i);
    buckets.push({
      from, to: addWeeks(from, 1), volume: 0, sets: 0, sessions: 0,
      cardioDistance: 0, cardioSeconds: 0, cardioEfforts: 0,
    });
  }
  const find = (ts) => buckets.find((b) => ts >= b.from && ts < b.to) || null;
  sessions.forEach((s) => {
    if (!s.finishedAt) return;
    const b = find(s.startedAt);
    if (!b) return;
    b.sessions++;
    s.entries.forEach((e) => {
      if (e.type === 'cardio') {
        // A runner's week is distance and time, not tonnage. Without this the
        // overview showed a runner nothing at all.
        const r = cardioEffort(e, s);
        if (!r) return;
        b.cardioEfforts++;
        b.cardioSeconds += r.duration || 0;
        if (r.distance) b.cardioDistance += toDistance(r.distance, r.unit, distUnit);
        return;
      }
      const m = measureOf(e);
      (e.sets || []).forEach((x) => {
        if (!x.done || x.warmup) return;
        b.sets++;
        if (m.key === 'reps') b.volume += setVolume(x, unit, num(s.bodyweight));
      });
    });
  });
  return buckets.map((b) => ({
    ...b,
    volume: Math.round(b.volume),
    cardioDistance: Math.round(b.cardioDistance * 100) / 100,
  }));
}

/** Exercises by how much they were trained in a window, most first. */
export function exerciseTotals(sessions, normKey, unit, distUnit = 'km') {
  const map = new Map();
  sessions.forEach((s) => {
    if (!s.finishedAt) return;
    s.entries.forEach((e) => {
      const key = normKey(e.name);
      if (!key) return;
      const row = map.get(key) || {
        key, name: e.name, type: e.type, measure: e.measure || 'reps',
        sets: 0, volume: 0, sessions: new Set(), lastAt: 0,
        // a run's "how much" is distance and time, not tonnage. An interval
        // block counts here on exactly the same footing as a straight run:
        // cardioEffort sums its legs, so six 400s are six 400s of running.
        distance: 0, seconds: 0, rounds: 0, intervals: false,
      };
      let touched = false;
      if (e.type === 'lift') {
        (e.sets || []).forEach((x) => {
          if (!x.done || x.warmup) return;
          row.sets++;
          touched = true;
          if ((e.measure || 'reps') === 'reps') row.volume += setVolume(x, unit, num(s.bodyweight));
        });
      } else if (e.type === 'cardio') {
        const r = cardioEffort(e, s);
        if (r) {
          row.sets++;
          touched = true;
          row.seconds += r.duration || 0;
          if (r.distance) row.distance += toDistance(r.distance, r.unit, distUnit);
          if (r.intervals) { row.intervals = true; row.rounds += r.rounds || 0; }
        }
      }
      if (!touched) return;
      row.sessions.add(s.id);
      if (s.startedAt > row.lastAt) { row.lastAt = s.startedAt; row.name = e.name; }
      map.set(key, row);
    });
  });
  return [...map.values()]
    .map((r) => ({
      ...r,
      sessions: r.sessions.size,
      volume: Math.round(r.volume),
      distance: Math.round(r.distance * 100) / 100,
      seconds: Math.round(r.seconds),
    }))
    .sort((a, b) => b.sets - a.sets || b.lastAt - a.lastAt);
}

/* ------------------------------------------------------------------ */
/* cardio                                                            */
/* ------------------------------------------------------------------ */

/**
 * One point per logged run. Pace is the metric, because distance and duration
 * both move freely between runs and neither alone says you got faster.
 * Intervals contribute the average pace of their logged legs.
 */
export function cardioEffort(e, s) {
  const l = e.log || {};
  const unit = l.distanceUnit || 'km';
  const legs = (l.legs || []).filter((x) => x.done);

  if (legs.length) {
    let secs = 0;
    let dist = 0;
    legs.forEach((x) => {
      secs += x.duration || 0;
      if (x.duration && x.pace) dist += x.duration / x.pace;
    });
    const paces = legs.map((x) => x.pace).filter((p) => Number.isFinite(p) && p > 0);
    // THE WORK LEG IS THE METRIC, not the average across the block. Blending the
    // recovery leg in means the trend "improves" when you walk your rest faster,
    // which is the opposite of what the session is for. The fastest leg is the
    // work leg -- a lower pace is faster.
    const workPace = paces.length ? Math.min(...paces) : null;
    const restPace = paces.length ? Math.max(...paces) : null;
    const overall = dist ? Math.round(secs / dist) : null;
    if (workPace === null && overall === null) return null;
    return {
      at: s.startedAt, sessionId: s.id, unit, intervals: true,
      rounds: new Set(legs.map((x) => x.round)).size,
      roundsPlanned: e.rounds || null,
      legs: legs.length,
      duration: secs,
      distance: dist ? Math.round(dist * 1000) / 1000 : null,
      pace: overall,
      workPace,
      restPace: restPace === workPace ? null : restPace,
      metricPace: workPace ?? overall,
    };
  }

  if (!l.done) return null;
  const pace = l.pace ?? (l.distance && l.duration ? Math.round(l.duration / l.distance) : null);
  if (pace === null && !l.duration) return null;
  return {
    at: s.startedAt, sessionId: s.id, unit, intervals: false, rounds: 0,
    roundsPlanned: null, legs: 0,
    duration: l.duration ?? null, distance: l.distance ?? null,
    pace, workPace: null, restPace: null, metricPace: pace,
  };
}

/**
 * One point per logged effort of this exercise, oldest first.
 *
 * `metricPace` is the number to chart: the overall pace for a straight run, the
 * WORK LEG's pace for an interval block. See cardioEffort for why.
 */
export function cardioRuns(sessions, key, normKey) {
  const out = [];
  sessions.forEach((s) => {
    if (!s.finishedAt) return;
    s.entries.forEach((e) => {
      if (e.type !== 'cardio' || normKey(e.name) !== key) return;
      const r = cardioEffort(e, s);
      if (r) out.push(r);
    });
  });
  return out.sort((a, b) => a.at - b.at);
}
