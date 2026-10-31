// "Trends" — progress, by exercise and across the whole log.
//
// Two screens: an overview (weekly volume, what you train most) and a detail
// for one exercise. Tapping an exercise anywhere lands on its detail.
//
// The reading order on the detail screen is deliberate, and matches the order a
// lifter actually asks things: am I getting stronger (headline + chart), what
// is my best ever (PRs), am I doing enough (consistency), what exactly did I do
// (the table). The table is not an afterthought -- on a phone it is the primary
// readout, because a 6px dot has no touch target, and it doubles as the
// accessible version of the chart.
import { state } from '../store.js';
import {
  exerciseTrend, weeklyVolume, trainedExercises,
} from '../queries.js';
import {
  metricFor, personalBests, trendDelta, setLoad, isWeakEstimate, MIN_TREND_SESSIONS,
} from '../trends.js';
import { linePlot, barPlot } from '../chart.js';
import { fmtPace } from '../cardio.js';
import { measureOf, MEASURES } from '../measure.js';
import { esc, fmtNum, fmtDate, fmtClock, fmtDur, relDay } from '../util.js';
import { groupTotals } from '../exercise.js';
import { exerciseFor } from '../store.js';
import { openModal, toast } from '../ui.js';

const RANGES = [
  { key: '3m', label: '3M', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null },
];

const shortDate = (ts) => fmtDate(ts).slice(4, -5);   // "29 Oct"

/* ------------------------------------------------------------------ */
/* overview                                                          */
/* ------------------------------------------------------------------ */

function overview() {
  const unit = state.settings.unit;
  const done = state.sessions.filter((s) => s.finishedAt);
  if (!done.length) {
    return `<div class="empty">No finished workouts yet.<br>
      Trends appear here once you have logged a session or two.</div>`;
  }

  const weeks = weeklyVolume(12, unit);
  const trained = trainedExercises(done, unit);
  const last4 = weeks.slice(-4);
  const perWeek = Math.round((last4.reduce((n, w) => n + w.sessions, 0) / 4) * 10) / 10;
  const anyVolume = weeks.some((w) => w.volume > 0);

  return `
    <div class="card flat" style="margin-bottom:12px">
      <div class="kv"><span>Logged</span>
        <span class="strong">${done.length} session${done.length === 1 ? '' : 's'}</span></div>
      <div class="kv"><span>Last 4 weeks</span><span>${perWeek} per week</span></div>
      <div class="kv"><span>Exercises trained</span><span>${trained.length}</span></div>
    </div>

    ${anyVolume ? `
      <h2>Volume per week</h2>
      <div class="card">
        ${barPlot({
    bars: weeks.map((w, i) => ({
      v: w.volume, label: shortDate(w.from), now: i === weeks.length - 1,
    })),
    yFmt: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : fmtNum(Math.round(v))),
    label: `Volume per week for the last ${weeks.length} weeks, in ${unit}`,
  })}
        <div class="small dim center">total load lifted each week, in ${esc(unit)}
          &mdash; timed and carried work is counted in sets, not here</div>
      </div>` : ''}

    <h2>Sets per week</h2>
    <div class="card">
      ${barPlot({
    bars: weeks.map((w, i) => ({ v: w.sets, label: shortDate(w.from), now: i === weeks.length - 1 })),
    yFmt: (v) => fmtNum(Math.round(v)),
    label: `Working sets per week for the last ${weeks.length} weeks`,
  })}
      <div class="small dim center">working sets, warmups excluded</div>
    </div>

    ${trained.some((x) => x.type === 'cardio') && !weeks.some((w) => w.cardioDistance > 0 || w.cardioSeconds > 0) ? `
      <h2>Running per week</h2>
      <div class="card">
        <p class="hint" style="margin:0">You have logged running, but none in the last
          ${weeks.length} weeks. Pick it from the list below to see its whole history.</p>
      </div>` : ''}
    ${!trained.some((x) => x.type === 'cardio') ? `
      <h2>Running per week</h2>
      <div class="card">
        <p class="hint" style="margin:0">Nothing yet. A run or an interval block only counts once
          its card is <b>confirmed</b> &mdash; the big tick on the run, or <b>Log all rounds</b> on
          a block. Numbers sitting in the fields are the plan until you tap it.</p>
      </div>` : ''}
    ${weeks.some((w) => w.cardioDistance > 0 || w.cardioSeconds > 0) ? `
      <h2>Running per week</h2>
      <div class="card">
        ${barPlot({
    bars: weeks.map((w, i) => ({
      v: w.cardioDistance, label: shortDate(w.from), now: i === weeks.length - 1,
    })),
    yFmt: (v) => fmtNum(Math.round(v * 10) / 10),
    label: `Distance per week for the last ${weeks.length} weeks, in ${state.settings.distanceUnit}`,
  })}
        <div class="small dim center">distance each week in ${esc(state.settings.distanceUnit)} &mdash;
          ${esc(fmtDur(weeks.reduce((n, w) => n + w.cardioSeconds, 0)))} of running logged in total</div>
      </div>` : ''}

    ${groupSection()}

    <h2>What you train</h2>
    ${trained.map((x) => `
      <div class="sess-item" data-action="trend-open" data-name="${esc(x.name)}" role="button" tabindex="0">
        <div class="body">
          <div class="nm">${esc(x.name)}
            ${x.type === 'cardio' ? '<span class="pill">cardio</span>' : ''}
            ${x.measure !== 'reps' ? `<span class="pill">${esc((MEASURES[x.measure] || MEASURES.reps).label.toLowerCase())}</span>` : ''}</div>
          <div class="sub">${x.sessions} session${x.sessions === 1 ? '' : 's'} ·
            ${x.sets} ${x.type === 'cardio' ? 'effort' : 'set'}${x.sets === 1 ? '' : 's'}${
  x.rounds ? ` · ${x.rounds} rounds` : ''}${
  x.volume ? ` · ${fmtNum(x.volume)} ${esc(unit)} total` : ''}${
  x.distance ? ` · ${fmtNum(x.distance)} ${esc(state.settings.distanceUnit)}` : ''}${
  x.seconds ? ` · ${esc(fmtDur(x.seconds))}` : ''} ·
            last ${esc(relDay(x.lastAt).toLowerCase())}</div>
        </div>
        <div class="dim">›</div>
      </div>`).join('')}`;
}

/**
 * Per-muscle volume: direct sets, indirect sets, and what is being neglected.
 *
 * Two columns rather than one score. The tempting move is to count a secondary
 * muscle as half a set and report a single number per group, but that fraction
 * is invented and once blended the real counts cannot be recovered. Direct and
 * indirect answer different questions -- "am I training chest" and "is my chest
 * getting worked anyway" -- so they stay apart.
 */
function groupSection() {
  const tagged = state.exercises.filter((x) => x.primary || x.secondary.length);
  // same cutoff convention as inRange, so the range chips mean one thing
  const r = RANGES.find((x) => x.key === state.trendRange) || RANGES[2];
  const rows = groupTotals(state.sessions, exerciseFor,
    { from: r.days ? Date.now() - (r.days * 86400000) : null });

  if (!state.exercises.length) {
    return `
      <h2>Muscle groups</h2>
      <div class="card">
        <p class="hint" style="margin:0">Nothing to group by yet. Tag each exercise with a
          <b>volume group</b> in the <b>Exercise library</b> (Routines tab) and this becomes a
          per-muscle readout &mdash; the one view that cannot be built from set data alone, because
          nothing in a logged set says what a dumbbell row trains.</p>
        <button type="button" class="btn block primary" style="margin-top:10px"
                data-action="library-go">Open the exercise library</button>
      </div>`;
  }
  if (!tagged.length) {
    return `
      <h2>Muscle groups</h2>
      <div class="card">
        <p class="hint" style="margin:0">Your library has ${state.exercises.length}
          exercise${state.exercises.length === 1 ? '' : 's'}, but none has a <b>volume group</b> yet.
          Add one per exercise and this fills in, retroactively, for everything you have already
          logged.</p>
        <button type="button" class="btn block primary" style="margin-top:10px"
                data-action="library-go">Open the exercise library</button>
      </div>`;
  }
  if (!rows.length) {
    return `
      <h2>Muscle groups</h2>
      <div class="card"><p class="hint" style="margin:0">No tagged exercise has been logged in this
        range. Widen it above, or tag more of your library.</p></div>`;
  }

  const hi = Math.max(...rows.map((r) => r.direct + r.indirect), 1);
  // groups in the library that this range never saw: the useful negative result
  const trained = new Set(rows.map((r) => r.group));
  const idle = [...new Set(tagged.flatMap((x) => [x.primary, ...x.secondary].filter(Boolean)))]
    .filter((g) => !trained.has(g)).sort();

  return `
    <h2>Muscle groups</h2>
    <div class="card">
      ${rangeChips(state.trendRange)}
      <div class="grp-hdr"><div>Muscle</div><div>Direct</div><div>Indirect</div></div>
      ${rows.map((r) => `
        <div class="grp-row" data-action="trend-group" data-group="${esc(r.group)}" role="button" tabindex="0">
          <div class="grp-name">${esc(r.group)}
            <div class="grp-bar"><span class="d" style="width:${Math.round((r.direct / hi) * 100)}%"></span><span
              class="i" style="width:${Math.round((r.indirect / hi) * 100)}%"></span></div>
          </div>
          <div class="grp-n strong">${r.direct}</div>
          <div class="grp-n dim">${r.indirect}</div>
        </div>`).join('')}
      <div class="small dim center" style="margin-top:8px">
        <b>direct</b> = sets of an exercise whose volume group is that muscle &middot;
        <b>indirect</b> = sets where it is listed under "other muscles".
        Counted separately, never added together.
      </div>
      ${idle.length ? `<div class="small" style="margin-top:8px;color:var(--warn)">
        Not trained in this range: ${esc(idle.join(', '))}</div>` : ''}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* one exercise                                                      */
/* ------------------------------------------------------------------ */

function rangeChips(active) {
  return `<div class="hist-chips">${RANGES.map((r) => `<button type="button"
    class="chip ${active === r.key ? 'on' : ''}" data-action="trend-range" data-range="${r.key}"
    >${r.label}</button>`).join('')}</div>`;
}

function inRange(rows, rangeKey) {
  const r = RANGES.find((x) => x.key === rangeKey) || RANGES[2];
  if (!r.days) return rows;
  const from = Date.now() - (r.days * 86400000);
  return rows.filter((x) => x.at >= from);
}

/** A straight run or an interval block: pace is the thing that got better. */
function cardioDetail(t) {
  const runs = inRange(t.runs, state.trendRange);
  if (!runs.length) {
    return `<div class="empty">Nothing logged for ${esc(t.name)} in this range.</div>`;
  }
  const unit = runs[runs.length - 1].unit || 'km';
  const anyIv = runs.some((r) => r.intervals);
  // a LOWER pace is faster, so the axis is inverted by negating the values
  const paced = runs.filter((r) => Number.isFinite(r.metricPace));
  const best = paced.reduce((a, b) => (a === null || b.metricPace < a.metricPace ? b : a), null);
  const far = runs.reduce((a, b) => (a === null || (b.distance || 0) > (a.distance || 0) ? b : a), null);
  const longest = runs.reduce((a, b) => (a === null || (b.duration || 0) > (a.duration || 0) ? b : a), null);
  const totalDist = Math.round(runs.reduce((n, r) => n + (r.distance || 0), 0) * 100) / 100;
  const totalSecs = runs.reduce((n, r) => n + (r.duration || 0), 0);
  const mostRounds = anyIv
    ? runs.reduce((a, b) => (a === null || b.rounds > a.rounds ? b : a), null) : null;

  return `
    <div class="card">
      <div class="row">
        <div style="flex:1;min-width:0">
          <div class="tiny">${anyIv ? 'Best work-leg pace' : 'Best pace'}</div>
          <div class="trend-big">${best ? esc(fmtPace(best.metricPace, unit)) : '--'}</div>
        </div>
        <div style="text-align:right">
          <div class="tiny dim">${runs.length} effort${runs.length === 1 ? '' : 's'}</div>
          <div class="tiny dim">${esc(fmtDur(totalSecs))} total</div>
        </div>
      </div>
      ${anyIv ? `<p class="hint" style="margin-bottom:0">For an interval block the pace charted is
        the <b>work leg</b>, not the average across the block &mdash; blending the recovery in would
        make the trend improve when you simply walk your rest faster.</p>` : ''}
    </div>

    ${paced.length > 1 ? `
      <div class="card">
        ${linePlot({
    points: paced.map((r) => ({ x: r.at, y: -r.metricPace })),
    best: paced.map((r) => ({ x: r.at, y: -r.metricPace, pr: r === best })),
    yFmt: (v) => fmtClock(-v),
    xLeft: shortDate(paced[0].at),
    xRight: shortDate(paced[paced.length - 1].at),
    label: `${anyIv ? 'Work-leg pace' : 'Pace'} per ${unit} across ${paced.length} efforts, faster is higher`,
  })}
        <div class="small dim center">pace per ${esc(unit)} &mdash; higher is faster</div>
      </div>` : ''}

    <h2>Personal bests</h2>
    <div class="card">
      ${best ? `<div class="kv"><span>${anyIv ? 'Fastest work leg' : 'Fastest pace'}</span>
        <span><b>${esc(fmtPace(best.metricPace, unit))}</b> <span class="dim small">${esc(shortDate(best.at))}</span></span></div>` : ''}
      ${far && far.distance ? `<div class="kv"><span>Furthest</span>
        <span><b>${fmtNum(far.distance)} ${esc(unit)}</b> <span class="dim small">${esc(shortDate(far.at))}</span></span></div>` : ''}
      ${longest && longest.duration ? `<div class="kv"><span>Longest</span>
        <span><b>${esc(fmtClock(longest.duration))}</b> <span class="dim small">${esc(shortDate(longest.at))}</span></span></div>` : ''}
      ${mostRounds && mostRounds.rounds ? `<div class="kv"><span>Most rounds</span>
        <span><b>${mostRounds.rounds}</b> <span class="dim small">${esc(shortDate(mostRounds.at))}</span></span></div>` : ''}
    </div>

    <div class="card flat">
      <div class="kv"><span>Distance covered</span><span>${fmtNum(totalDist)} ${esc(unit)}</span></div>
      <div class="kv"><span>Time running</span><span>${esc(fmtDur(totalSecs))}</span></div>
    </div>

    <h2>${anyIv ? 'Efforts' : 'Runs'}</h2>
    <div class="trend-table">
      <div class="tr hd"><div>Date</div><div>${anyIv ? 'Rounds' : 'Distance'}</div><div>${anyIv ? 'Work' : 'Pace'}</div></div>
      ${[...runs].reverse().map((r) => `
        <div class="tr">
          <div>${esc(shortDate(r.at))}</div>
          <div class="sets">
            ${r.intervals
    ? `<code>${r.rounds}${r.roundsPlanned && r.roundsPlanned !== r.rounds ? ` of ${r.roundsPlanned}` : ''} rounds</code>
               ${r.distance ? `<code>${fmtNum(r.distance)} ${esc(r.unit)}</code>` : ''}
               <code>${esc(fmtClock(r.duration || 0))}</code>
               ${r.restPace ? `<code class="dim">rest ${esc(fmtPace(r.restPace, r.unit))}</code>` : ''}`
    : `<code>${r.distance ? `${fmtNum(r.distance)} ${esc(r.unit)}` : '--'}</code>
               <code>${r.duration ? esc(fmtClock(r.duration)) : '--'}</code>`}
          </div>
          <div class="strong">${Number.isFinite(r.metricPace) ? esc(fmtPace(r.metricPace, r.unit)) : '--'}</div>
        </div>`).join('')}
    </div>`;
}

function liftDetail(t) {
  const unit = t.unit;
  const metric = t.metric || metricFor(t.measure);
  const rows = inRange(t.rows, state.trendRange);
  const sets = rows.flatMap((r) => r.sets);
  if (!rows.length) {
    return `<div class="empty">Nothing logged for ${esc(t.name)} in this range.</div>`;
  }

  const withValue = rows.filter((r) => r.best !== null);
  const delta = trendDelta(rows);
  const prs = personalBests(sets, t.measure, unit);
  const allTimeBest = withValue.reduce((a, b) => (a === null || b.best > a.best ? b : a), null);
  const fmtV = (v) => metric.fmt(v, metric.key === 'e1rm' ? unit : '');
  const latest = withValue.length ? withValue[withValue.length - 1] : null;
  const days = rows.length > 1
    ? Math.max(1, Math.round((rows[rows.length - 1].at - rows[0].at) / 86400000)) : 0;
  const perWeek = days ? Math.round((rows.length / (days / 7)) * 10) / 10 : rows.length;

  return `
    <div class="card">
      <div class="row">
        <div style="flex:1;min-width:0">
          <div class="tiny">${esc(metric.title)}${metric.estimate ? ' (estimated)' : ''}</div>
          <div class="trend-big">${latest ? esc(fmtV(latest.best)) : '--'}</div>
        </div>
        ${delta.enough ? `
          <div style="text-align:right">
            <div class="trend-delta ${delta.change > 0 ? 'up' : delta.change < 0 ? 'down' : ''}">
              ${delta.change > 0 ? '▲' : delta.change < 0 ? '▼' : '='} ${esc(fmtV(Math.abs(delta.change)))}</div>
            <div class="tiny dim">over ${delta.sessions} sessions · ${delta.weeks} week${delta.weeks === 1 ? '' : 's'}</div>
          </div>` : ''}
      </div>
      ${delta.enough ? '' : `<p class="hint" style="margin-bottom:0">${delta.have} session${delta.have === 1 ? '' : 's'}
        with a usable number so far. ${MIN_TREND_SESSIONS - delta.have} more and a trend appears here &mdash;
        two points make a line, not a trend.</p>`}
      ${metric.estimate ? `<p class="hint" style="margin-bottom:0">Estimated from your best set each
        session (Epley). Sets of ${esc(String(10))} or more reps, or logged easy, are drawn hollow
        because the estimate means less there.</p>` : ''}
    </div>

    ${withValue.length > 1 ? `
      <div class="card">
        ${linePlot({
    points: sets.map((x) => ({ x: x.sessionAt, y: metric.value(x), dim: metric.estimate && isWeakEstimate(x) }))
      .filter((p) => p.y !== null),
    best: withValue.map((r) => ({ x: r.at, y: r.best, pr: r === allTimeBest })),
    yFmt: (v) => fmtV(v),
    xLeft: shortDate(rows[0].at),
    xRight: shortDate(rows[rows.length - 1].at),
    label: `${metric.title} for ${t.name} across ${withValue.length} sessions`,
  })}
        <div class="small dim center">every working set, with the best of each session joined</div>
      </div>` : ''}

    ${prs.length ? `
      <h2>Personal bests</h2>
      <div class="card">
        ${prs.map((p) => `<div class="kv"><span>${esc(p.label)}${p.estimate ? ' <span class="dim">est.</span>' : ''}</span>
          <span><b>${p.value}</b> <span class="dim small">${esc(shortDate(p.set.at))}</span></span></div>`).join('')}
      </div>` : ''}

    <div class="card flat">
      <div class="kv"><span>Sessions in range</span><span>${rows.length}</span></div>
      <div class="kv"><span>Working sets</span><span>${sets.length}</span></div>
      <div class="kv"><span>Frequency</span><span>${perWeek} per week</span></div>
      ${t.converted ? `<div class="kv"><span>Converted</span>
        <span class="dim">${t.converted} set${t.converted === 1 ? '' : 's'} logged in another unit, shown in ${esc(unit)}</span></div>` : ''}
    </div>

    <h2>Session log</h2>
    <div class="trend-table">
      <div class="tr hd"><div>Date</div><div>Sets</div><div>${esc(metric.estimate ? 'e1RM' : metric.axis)}</div></div>
      ${[...rows].reverse().map((r) => `
        <div class="tr">
          <div>${esc(shortDate(r.at))}</div>
          <div class="sets">${r.sets.map((x) => `<code>${esc(setLabelFor(x, t.measure, unit))}</code>`).join('')}</div>
          <div class="strong">${r.best === null ? '--' : esc(fmtV(r.best))}</div>
        </div>`).join('')}
    </div>`;
}

/** "100 kg × 5 @8" for reps, "45s" for a hold, "40 m @ 24 kg" for a carry. */
function setLabelFor(x, measure, unit) {
  const eff = [
    x.rpe !== null ? `@${fmtNum(x.rpe)}` : null,
    x.rir !== null ? `r${fmtNum(x.rir)}` : null,
  ].filter(Boolean).join(' ');
  const tail = eff ? ` ${eff}` : '';
  if (measure === 'time') {
    const t = x.reps >= 60 ? fmtClock(x.reps) : `${fmtNum(x.reps)}s`;
    return `${t}${x.weight ? ` @ ${fmtNum(x.weight)} ${unit}` : ''}${tail}`;
  }
  if (measure === 'distance') {
    return `${fmtNum(x.reps)} m${x.weight ? ` @ ${fmtNum(x.weight)} ${unit}` : ''}${tail}`;
  }
  return `${setLoad(x, unit)} \u00d7 ${x.reps === null ? '--' : fmtNum(x.reps)}${tail}`;
}

function detail(name) {
  const t = exerciseTrend(name);
  if (!t) { state.nav.trendName = null; return overview(); }
  return `
    <button type="button" class="btn sm ghost" data-action="trend-back">← All trends</button>
    <div class="row" style="margin:12px 0 8px">
      <div style="flex:1;min-width:0">
        <h2 style="margin:0">${esc(t.name)}</h2>
        <div class="tiny dim">${t.type === 'cardio' ? 'cardio'
    : esc((MEASURES[t.measure] || MEASURES.reps).label.toLowerCase())}</div>
      </div>
      <button type="button" class="btn sm" data-action="trend-pick">Change</button>
    </div>
    ${rangeChips(state.trendRange)}
    ${t.type === 'cardio' ? cardioDetail(t) : liftDetail(t)}`;
}

export function render() {
  return state.nav.trendName ? detail(state.nav.trendName) : overview();
}

/* ------------------------------------------------------------------ */
/* actions                                                           */
/* ------------------------------------------------------------------ */

export const trendsActions = {
  'trend-open': ({ name }) => { state.nav.trendName = name; },
  'trend-back': () => { state.nav.trendName = null; },
  'trend-range': ({ range }) => { state.trendRange = range; },

  /** Which exercises actually produced a muscle group's sets. */
  'trend-group': ({ group }) => {
    const r = RANGES.find((x) => x.key === state.trendRange) || RANGES[2];
    const from = r.days ? Date.now() - (r.days * 86400000) : null;
    const rec = groupTotals(state.sessions, exerciseFor, { from }).find((x) => x.group === group);
    if (!rec) return;
    openModal({
      title: group,
      bodyHtml: `
        <div class="kv"><span>Direct sets</span><span class="strong">${rec.direct}</span></div>
        <div class="kv"><span>Indirect sets</span><span>${rec.indirect}</span></div>
        ${rec.volume ? `<div class="kv"><span>Volume</span><span>${fmtNum(rec.volume)} ${esc(state.settings.unit)}</span></div>` : ''}
        <div class="kv"><span>Last trained</span><span>${rec.lastAt ? esc(relDay(rec.lastAt)) : '—'}</span></div>
        <p class="hint">From these exercises:</p>
        <div class="btn-row" style="flex-direction:column;gap:8px">
          ${rec.exercises.map((n) => `<button type="button" class="btn block"
            data-action="trend-open" data-name="${esc(n)}">${esc(n)}</button>`).join('')}
        </div>
        <p class="hint">Volume counts only sets measured in reps, and only where a load is
          known &mdash; a timed hold is real work that tonnage cannot express.</p>`,
      cancelText: 'Close',
    });
  },

  'trend-pick': () => {
    const list = trainedExercises();
    if (!list.length) { toast('Nothing logged yet'); return; }
    openModal({
      title: 'Which exercise?',
      bodyHtml: `
        <div class="btn-row" style="flex-direction:column;gap:8px">
          ${list.map((x) => `<button type="button" class="btn block" data-action="trend-open"
            data-name="${esc(x.name)}">${esc(x.name)}
            <span class="dim small">${x.sessions} session${x.sessions === 1 ? '' : 's'}</span></button>`).join('')}
        </div>`,
      cancelText: 'Close',
    });
  },
};
