// Export / import. Nothing leaves the device unless you tap one of these.
import {
  state, normalizeRoutine, saveRoutine, persistSession, sessionVolume, emit, setLabels,
} from './store.js';
import { restoreAll, dataFingerprint } from './backupstore.js';
import { importLibrary, LIBRARY_SCHEMA } from './exercisestore.js';
import {
  download, csvCell, isoDate, fmtTimeOfDay, fmtDate, fmtClock, fmtDur, fmtNum, uid,
} from './util.js';
import { pace, targetLine, loadLabel } from './format.js';
import { patternText, legTotals, byRound, intervalSummary, fmtPace } from './cardio.js';
import { MEASURES, measureOf, fmtAmountRange, fmtAmount } from './measure.js';

export const SCHEMA = 'workout-tracker/v1';

const safeName = (s) => String(s || 'workout').replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/* ------------------------------------------------------------------ */
/* JSON                                                               */
/* ------------------------------------------------------------------ */

export function backupObject() {
  return {
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    app: 'workout-tracker',
    counts: dataFingerprint(),
    settings: state.settings,
    // The in-progress workout and a running rest timer travel with the backup,
    // so a replace-restore on another device resumes exactly where you were.
    activeSessionId: state.active ? state.active.id : null,
    timer: state.timer,
    routines: state.routines,
    sessions: state.sessions,
    // the exercise library travels too: the attributes are knowledge about your
    // training, not a derivative of it, and nothing could rebuild them
    exercises: state.exercises,
    // the 10-day plan travels too: a restore on a new phone should know what
    // you intended this week, not just what you have already done
    plan: state.plan,
  };
}

export function exportBackup() {
  download(`workout-backup-${isoDate(Date.now())}.json`,
    JSON.stringify(backupObject(), null, 2), 'application/json');
}

export const isBackup = (data) =>
  !!data && !Array.isArray(data) && typeof data === 'object' && Array.isArray(data.routines);

export function routineObject(r) {
  return {
    schema: SCHEMA,
    name: r.name,
    description: r.description,
    entries: r.entries.map((e) => {
      const o = { type: e.type, name: e.name };
      if (e.group) o.group = e.group;
      if (e.alternatives && e.alternatives.length) o.alternatives = e.alternatives;
      if (e.bodyweight) o.bodyweight = true;
      if (e.setTargets) {
        // per-set plan: `sets` as a list, one object per set
        o.sets = e.setTargets.map((t) => {
          const row = {};
          if (t.weight !== null && t.weight !== undefined) row.weight = t.weight;
          const reps = fmtAmountRange(t.repsMin, t.repsMax, e.measure);
          if (reps) row.reps = reps;
          if (t.drop) row.drop = true;
          return row;
        });
      } else {
        if (e.targetSets !== null) o.sets = e.targetSets;
        const reps = fmtAmountRange(e.repsMin, e.repsMax, e.measure);
        if (reps) o.reps = reps;
        if (e.weight !== null) o.weight = e.weight;
      }
      if (e.measure && e.measure !== 'reps') o.measure = e.measure;
      if (e.targetDistance !== null) { o.distance = e.targetDistance; o.distanceUnit = e.distanceUnit || 'km'; }
      if (e.targetDuration) o.duration = fmtClock(e.targetDuration);
      if (e.targetPace) o.pace = fmtClock(e.targetPace);
      // one readable string instead of a nested legs array: it round-trips
      // through parseIntervals and a human can edit it
      if (e.legs && e.legs.length) o.pattern = patternText(e.legs, e.rounds, e.distanceUnit || 'km');
      if (e.rest) o.rest = fmtClock(e.rest);
      if (e.notes) o.notes = e.notes;
      return o;
    }),
  };
}

export function exportRoutine(r) {
  download(`routine-${safeName(r.name)}.json`, JSON.stringify(routineObject(r), null, 2), 'application/json');
}

/**
 * Import from text.
 *  mode 'replace' — wipe this device and restore the backup verbatim (same ids,
 *                   same in-progress session). Use this to clone a device.
 *  mode 'merge'   — add anything whose id isn't already here, keep what is.
 * Returns a summary object. Throws with a readable message on bad input.
 */
export async function importFromText(text, { mode = 'merge' } = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`That is not valid JSON: ${err.message}`);
  }

  const out = { mode, routines: 0, sessions: 0, exercises: 0, skipped: 0, settings: false };
  const isRoutineish = (o) => o && typeof o === 'object' && (Array.isArray(o.entries) || Array.isArray(o.exercises));

  /* ---- an exercise library ---- */
  // Routed on the SCHEMA line, not on the shape. `exercises` is also the legacy
  // key for a routine's entries (see normalizeRoutine), so a bare
  // `{ exercises: [...] }` is genuinely ambiguous and keeps its old meaning --
  // breaking an import that used to work would be worse than asking a library
  // file to carry one line saying what it is.
  if (data && data.schema === LIBRARY_SCHEMA) {
    const lib = await importLibrary(data, { mode: mode === 'replace' ? 'replace' : 'update' });
    return { ...out, library: lib, exercises: lib.added + lib.updated };
  }

  /* ---- a full backup ---- */
  if (isBackup(data)) {
    if (mode === 'replace') {
      const res = await restoreAll({
        routines: data.routines || [],
        sessions: data.sessions || [],
        exercises: data.exercises || [],
        settings: data.settings || null,
        activeSessionId: data.activeSessionId || null,
        timer: data.timer || null,
        // `plan` was in the backup and accepted by restoreAll, but was never
        // passed through here, so a replace-restore silently dropped the week
        // you had planned.
        plan: data.plan || null,
      });
      return { ...out, ...res, settings: !!data.settings, expected: data.counts || null, actual: dataFingerprint() };
    }

    // merge: ids are preserved where they don't collide, which keeps each
    // session's link to its routine intact.
    for (const r of (data.routines || [])) {
      const incoming = normalizeRoutine(r);
      const clash = state.routines.some((x) => x.id === incoming.id);
      if (clash) { out.skipped++; continue; }
      await saveRoutine(incoming);
      out.routines++;
    }
    // The library merges by name in "add" mode: a merge must not overwrite
    // attributes this device has that the backup does not.
    if (Array.isArray(data.exercises) && data.exercises.length) {
      const lib = await importLibrary({ exercises: data.exercises }, { mode: 'add' });
      out.exercises = lib.added;
    }
    for (const s of (data.sessions || [])) {
      if (!s || !s.id || !s.startedAt) continue;
      if (state.sessions.some((x) => x.id === s.id)) { out.skipped++; continue; }
      await persistSession({ ...s });
      out.sessions++;
    }
    state.sessions.sort((a, b) => b.startedAt - a.startedAt);
    emit();
    return { ...out, actual: dataFingerprint() };
  }

  /* ---- one routine, a list of routines, or a bare list of exercises ---- */
  let routines = [];
  if (Array.isArray(data)) {
    routines = data.length && data.every(isRoutineish)
      ? data
      : [{ name: 'Imported routine', description: '', entries: data }];
  } else if (isRoutineish(data)) {
    routines = [data];
  } else {
    throw new Error('Expected a routine object, a list of routines, or a full backup file.');
  }

  for (const r of routines) {
    const norm = normalizeRoutine({ ...r, id: uid('r') });
    if (!norm.entries.length) throw new Error(`Routine "${norm.name}" has no exercises.`);
    await saveRoutine(norm);
    out.routines++;
  }
  return { ...out, actual: dataFingerprint() };
}

/* ------------------------------------------------------------------ */
/* CSV — one row per set / per cardio log                             */
/* ------------------------------------------------------------------ */

const CSV_COLS = [
  'date', 'start_time', 'session_id', 'routine', 'exercise', 'type', 'group',
  'set_index', 'weight', 'unit', 'reps', 'rpe', 'rest_seconds',
  'distance', 'distance_unit', 'duration_seconds', 'pace',
  'avg_hr', 'max_hr', 'elevation_m', 'done', 'note',
  'session_rpe', 'bodyweight', 'session_notes',
  // appended, never inserted: existing columns keep their positions
  'rir', 'warmup', 'set_label', 'interval_rep', 'interval_of',
  // the interval redesign: one row per LEG of one round, so a treadmill block
  // exports as data instead of a single collapsed line
  'leg_label', 'leg_index', 'pace_seconds',
  // holds and carries: the amount goes to the column that matches its unit, so
  // 45 seconds of plank never lands in the reps column
  'measure',
];

export function csvRows(sessions) {
  const rows = [CSV_COLS.join(',')];
  [...sessions].sort((a, b) => a.startedAt - b.startedAt).forEach((s) => {
    const base = [isoDate(s.startedAt), fmtTimeOfDay(s.startedAt), s.id, s.routineName];
    const tail = [fmtNum(s.rpe), fmtNum(s.bodyweight), s.notes || ''];
    s.entries.forEach((e) => {
      if (e.type === 'cardio') {
        const l = e.log || {};
        const du = l.distanceUnit || '';
        if (l.legs && l.legs.length) {
          // one row per logged leg; an unticked leg is plan, not history
          l.legs.filter((lg) => lg.done).forEach((lg) => {
            const dist = lg.duration && lg.pace ? Math.round((lg.duration / lg.pace) * 1000) / 1000 : '';
            rows.push([...base, e.name, 'cardio', e.group || '',
              '', '', '', '', '', '',
              fmtNum(dist), du, lg.duration ?? '',
              lg.pace ? fmtPace(lg.pace, du || 'km') : '',
              fmtNum(l.avgHr), fmtNum(l.maxHr), fmtNum(l.elevation),
              'yes', l.note || '', ...tail,
              '', '', '', lg.round, e.rounds ?? '',
              lg.label || '', lg.leg + 1, lg.pace ?? '', ''].map(csvCell).join(','));
          });
          return;
        }
        if (!l.done) return;
        rows.push([...base, e.name, 'cardio', e.group || '',
          '', '', '', '', '', '',
          fmtNum(l.distance), du, l.duration ?? '',
          l.pace ? fmtPace(l.pace, du || 'km') : pace(l.distance, l.duration, du),
          fmtNum(l.avgHr), fmtNum(l.maxHr), fmtNum(l.elevation),
          'yes', l.note || '', ...tail,
          '', '', '', '', '',
          '', '', l.pace ?? '', ''].map(csvCell).join(','));
      } else {
        const labels = setLabels(e.sets || []);
        // only ticked sets: an unticked pre-materialised row is plan, not log
        (e.sets || []).forEach((x, i) => {
          if (!x.done) return;
          const mk = measureOf(e).key;
          rows.push([...base, e.name, 'lift', e.group || '',
            i + 1, fmtNum(x.weight), x.unit || '',
            mk === 'reps' ? fmtNum(x.reps) : '', fmtNum(x.rpe), x.rest ?? '',
            mk === 'distance' ? fmtNum(x.reps) : '', mk === 'distance' ? 'm' : '',
            mk === 'time' ? (x.reps ?? '') : '', '', '', '', '',
            x.done ? 'yes' : 'no', x.note || '', ...tail,
            fmtNum(x.rir), x.warmup ? 'yes' : 'no', labels[i], '', '',
            '', '', '', mk].map(csvCell).join(','));
        });
      }
    });
  });
  return rows.join('\n');
}

export function exportCsv(sessions = state.sessions) {
  download(`workout-sets-${isoDate(Date.now())}.csv`, csvRows(sessions), 'text/csv');
}

/* ------------------------------------------------------------------ */
/* Markdown — one session                                             */
/* ------------------------------------------------------------------ */

export function sessionMarkdown(s) {
  const L = [];
  const end = s.finishedAt || s.updatedAt || Date.now();
  L.push(`# ${s.routineName}`);
  L.push('');
  L.push(`**${fmtDate(s.startedAt)}** · ${fmtTimeOfDay(s.startedAt)}–${fmtTimeOfDay(end)} · ${fmtDur((end - s.startedAt) / 1000)}`);
  const meta = [];
  if (s.rpe !== null && s.rpe !== undefined) meta.push(`Overall RPE **${fmtNum(s.rpe)}**`);
  if (s.bodyweight !== null && s.bodyweight !== undefined) meta.push(`Bodyweight **${fmtNum(s.bodyweight)} ${s.unit}**`);
  const vol = sessionVolume(s);
  if (vol) meta.push(`Volume **${fmtNum(vol)} ${s.unit}**`);
  if (meta.length) { L.push(''); L.push(meta.join(' · ')); }
  if (s.routineDescription) { L.push(''); L.push(`> ${s.routineDescription.replace(/\n/g, '\n> ')}`); }

  s.entries.forEach((e, i) => {
    L.push('');
    L.push(`## ${i + 1}. ${e.name}${e.repTotal ? ` (${e.repIndex}/${e.repTotal})` : ''}${e.group ? ` _(superset ${e.group})_` : ''}${e.skipped ? ' — SKIPPED' : ''}`);
    const tl = targetLine(e);
    if (tl) L.push(`Target: ${tl}`);
    if (e.notes) { L.push(''); L.push(e.notes.split('\n').map((line) => `> ${line}`).join('\n')); }
    L.push('');

    if (e.type === 'lift') {
      const allRows = e.sets || [];
      const labels = setLabels(allRows);
      const sets = allRows.filter((x) => x.done);
      if (!sets.length) { L.push('_nothing logged_'); return; }
      const anyRir = sets.some((x) => x.rir !== null && x.rir !== undefined);
      const mh = (MEASURES[e.measure] || MEASURES.reps).header;
      L.push(`| Set | Weight | ${mh} | RPE |${anyRir ? ' RIR |' : ''} Rest | Done |`);
      L.push(`|---:|---:|---:|---:|${anyRir ? '---:|' : ''}---:|:--:|`);
      sets.forEach((x) => {
        const rir = anyRir ? ` ${x.rir !== null && x.rir !== undefined ? fmtNum(x.rir) : '—'} |` : '';
        L.push(`| ${labels[allRows.indexOf(x)]} | ${loadLabel({ ...x, unit: x.unit || s.unit }, { spaced: true })} | ${x.reps !== null ? fmtAmount(x.reps, e.measure) : '—'} | ${x.rpe !== null ? fmtNum(x.rpe) : '—'} |${rir} ${x.rest ? fmtClock(x.rest) : 'no rest logged'} | ${x.done ? '✓' : ''} |`);
      });
      if (sets.some((x) => x.warmup)) L.push('');
      if (sets.some((x) => x.warmup)) L.push('_W = warmup set; excluded from volume._');
    } else {
      const l = e.log || {};
      const du = l.distanceUnit || 'km';
      // an interval block: a table of rounds, which is what you actually ran
      if (l.legs && l.legs.length) {
        const multi = (e.legs || []).length > 1;
        L.push(`**Pattern** \`${patternText(e.legs, e.rounds, du)}\``);
        const summary = intervalSummary(l, du);
        L.push(summary ? `**Logged** ${summary}` : '_nothing logged_');
        L.push('');
        L.push('| Round | Leg | Time | Pace | Dist | ✓ |');
        L.push('|---:|:--|---:|---:|---:|:--:|');
        byRound(l.legs).forEach((group, r) => group.forEach((lg, i) => {
          const t = legTotals([lg]);
          L.push(`| ${r + 1}${multi ? String.fromCharCode(97 + i) : ''} | ${lg.label || '—'} | ${
            lg.duration ? fmtClock(lg.duration) : '—'} | ${
            lg.pace ? fmtPace(lg.pace, du) : '—'} | ${
            t.distance ? `${fmtNum(t.distance)} ${du}` : '—'} | ${lg.done ? '✓' : ''} |`);
        }));
        const extra = [
          l.avgHr ? `avg HR ${fmtNum(l.avgHr)}` : null,
          l.maxHr ? `max HR ${fmtNum(l.maxHr)}` : null,
          l.rpe !== null && l.rpe !== undefined ? `RPE ${fmtNum(l.rpe)}` : null,
          l.note || null,
        ].filter(Boolean);
        if (extra.length) { L.push(''); L.push(`_${extra.join(' · ')}_`); }
        return;
      }
      if (!l.done) { L.push('_nothing logged_'); return; }
      const rows = [
        ['Distance', l.distance !== null && l.distance !== undefined ? `${fmtNum(l.distance)} ${du}` : null],
        ['Time', l.duration ? fmtClock(l.duration) : null],
        ['Pace', l.pace ? fmtPace(l.pace, du) : (pace(l.distance, l.duration, du) || null)],
        ['Avg HR', l.avgHr ? `${fmtNum(l.avgHr)} bpm` : null],
        ['Max HR', l.maxHr ? `${fmtNum(l.maxHr)} bpm` : null],
        ['Elevation', l.elevation ? `${fmtNum(l.elevation)} m` : null],
        ['RPE', l.rpe !== null && l.rpe !== undefined ? fmtNum(l.rpe) : null],
        ['Note', l.note || null],
      ].filter(([, v]) => v);
      if (!rows.length) { L.push('_nothing logged_'); return; }
      L.push('| Metric | Value |');
      L.push('|---|---|');
      rows.forEach(([k, v]) => L.push(`| ${k} | ${v} |`));
    }
  });

  if (s.notes) { L.push(''); L.push('## Notes'); L.push(''); L.push(s.notes); }
  L.push('');
  return L.join('\n');
}

export function exportSessionMarkdown(s) {
  download(`workout-${isoDate(s.startedAt)}-${safeName(s.routineName)}.md`, sessionMarkdown(s), 'text/markdown');
}

export function exportSessionJson(s) {
  download(`workout-${isoDate(s.startedAt)}-${safeName(s.routineName)}.json`,
    JSON.stringify({ schema: SCHEMA, sessions: [s], routines: [] }, null, 2), 'application/json');
}
