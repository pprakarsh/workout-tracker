// Export / import. Nothing leaves the device unless you tap one of these.
import { state, normalizeRoutine, saveRoutine, persistSession, sessionVolume, emit, restoreAll, dataFingerprint } from './store.js';
import {
  download, csvCell, isoDate, fmtTimeOfDay, fmtDate, fmtClock, fmtDur, fmtNum, fmtReps, uid,
} from './util.js';
import { pace, targetLine } from './format.js';

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
      if (e.setTargets) {
        // per-set plan: `sets` as a list, one object per set
        o.sets = e.setTargets.map((t) => {
          const row = {};
          if (t.weight !== null && t.weight !== undefined) row.weight = t.weight;
          const reps = fmtReps(t.repsMin, t.repsMax);
          if (reps) row.reps = reps;
          return row;
        });
      } else {
        if (e.targetSets !== null) o.sets = e.targetSets;
        const reps = fmtReps(e.repsMin, e.repsMax);
        if (reps) o.reps = reps;
        if (e.weight !== null) o.weight = e.weight;
      }
      if (e.targetDistance !== null) { o.distance = e.targetDistance; o.distanceUnit = e.distanceUnit || 'km'; }
      if (e.targetDuration) o.duration = fmtClock(e.targetDuration);
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

  const out = { mode, routines: 0, sessions: 0, skipped: 0, settings: false };
  const isRoutineish = (o) => o && typeof o === 'object' && (Array.isArray(o.entries) || Array.isArray(o.exercises));

  /* ---- a full backup ---- */
  if (isBackup(data)) {
    if (mode === 'replace') {
      const res = await restoreAll({
        routines: data.routines || [],
        sessions: data.sessions || [],
        settings: data.settings || null,
        activeSessionId: data.activeSessionId || null,
        timer: data.timer || null,
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
];

export function csvRows(sessions) {
  const rows = [CSV_COLS.join(',')];
  [...sessions].sort((a, b) => a.startedAt - b.startedAt).forEach((s) => {
    const base = [isoDate(s.startedAt), fmtTimeOfDay(s.startedAt), s.id, s.routineName];
    const tail = [fmtNum(s.rpe), fmtNum(s.bodyweight), s.notes || ''];
    s.entries.forEach((e) => {
      if (e.type === 'cardio') {
        const l = e.log || {};
        rows.push([...base, e.name, 'cardio', e.group || '',
          '', '', '', '', '', '',
          fmtNum(l.distance), l.distanceUnit || '', l.duration ?? '',
          pace(l.distance, l.duration, l.distanceUnit),
          fmtNum(l.avgHr), fmtNum(l.maxHr), fmtNum(l.elevation),
          l.done ? 'yes' : 'no', l.note || '', ...tail].map(csvCell).join(','));
      } else {
        (e.sets || []).forEach((x, i) => {
          rows.push([...base, e.name, 'lift', e.group || '',
            i + 1, fmtNum(x.weight), x.unit || '', fmtNum(x.reps), fmtNum(x.rpe), x.rest ?? '',
            '', '', '', '', '', '', '',
            x.done ? 'yes' : 'no', x.note || '', ...tail].map(csvCell).join(','));
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
    L.push(`## ${i + 1}. ${e.name}${e.group ? ` _(superset ${e.group})_` : ''}${e.skipped ? ' — SKIPPED' : ''}`);
    const tl = targetLine(e);
    if (tl) L.push(`Target: ${tl}`);
    if (e.notes) { L.push(''); L.push(e.notes.split('\n').map((line) => `> ${line}`).join('\n')); }
    L.push('');

    if (e.type === 'lift') {
      const sets = e.sets || [];
      if (!sets.length) { L.push('_nothing logged_'); return; }
      L.push('| Set | Weight | Reps | RPE | Rest | Done |');
      L.push('|---:|---:|---:|---:|---:|:--:|');
      sets.forEach((x, n) => {
        L.push(`| ${n + 1} | ${x.weight !== null ? `${fmtNum(x.weight)} ${x.unit || s.unit}` : '—'} | ${x.reps !== null ? fmtNum(x.reps) : '—'} | ${x.rpe !== null ? fmtNum(x.rpe) : '—'} | ${x.rest ? fmtClock(x.rest) : 'no rest logged'} | ${x.done ? '✓' : ''} |`);
      });
    } else {
      const l = e.log || {};
      const rows = [
        ['Distance', l.distance !== null && l.distance !== undefined ? `${fmtNum(l.distance)} ${l.distanceUnit || 'km'}` : null],
        ['Duration', l.duration ? fmtClock(l.duration) : null],
        ['Pace', pace(l.distance, l.duration, l.distanceUnit) || null],
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
