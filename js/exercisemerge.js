// Merging two names that are the same exercise.
//
// This exists because IDENTITY IN THIS APP IS THE NAME. There is no exercise
// id: every history lookup, prefill, PR and per-muscle total keys on
// normName(entry.name). That is what makes tagging retroactive and
// migration-free, and it is also why "DB Row" and "Dumbbell Row" are two
// different exercises with two separate histories until something rewrites one
// of the names.
//
// So a merge is not a library edit. It is a bulk rewrite of stored names across
// routines AND logged sessions, and the reason it only has to touch the stored
// `name` is that all nineteen name-keyed lookups in the codebase derive from it.
// Rewrite the names and everything downstream unifies by itself.
//
// Five fields reference an exercise by name, and all five are rewritten:
//
//   routine.entries[].name              the slot
//   routine.entries[].alternatives[]    Either/Or options
//   session.entries[].name              logged work, including the live session
//   session.entries[].alternatives[]    options as they were that day
//   session.entries[].swappedFrom       which slot a mid-workout swap came from
//
// A peer of store.js, like exercisestore.js: it imports state and the save
// primitives, and the store never imports it back.
import {
  state, emit, touch, saveRoutine, persistSession, exerciseFor,
} from './store.js';
import { metaGet, metaSet } from './db.js';
import { normName } from './util.js';
import { altNames } from './model.js';
import { reduceName, catalogFor } from './catalog.js';
import { saveExercise, deleteExercise } from './exercisestore.js';

/** Every name in use anywhere, with where it is used. */
function allNames() {
  const out = new Map();
  const touchName = (name, where) => {
    const key = normName(name);
    if (!key) return;
    if (!out.has(key)) out.set(key, { key, name: String(name).trim(), routines: 0, sessions: 0, sets: 0 });
    const rec = out.get(key);
    if (where === 'routine') rec.routines++;
    else rec.sessions++;
  };
  state.exercises.forEach((x) => touchName(x.name, 'library'));
  state.routines.forEach((r) => (r.entries || []).forEach((e) => touchName(e.name, 'routine')));
  state.sessions.forEach((s) => (s.entries || []).forEach((e) => {
    touchName(e.name, 'session');
    const rec = out.get(normName(e.name));
    if (rec) rec.sets += (e.sets || []).filter((x) => x.done).length;
  }));
  return [...out.values()];
}

/**
 * Names that look like the same exercise under different spellings.
 *
 * Grouped by their REDUCED word set -- shorthand expanded, plurals stripped,
 * order ignored -- which is the same reduction `certainMatch` uses. "DB Row"
 * and "Dumbbell Row" both reduce to {dumbbell, row}; "Face Pulls" and "Face
 * Pull" both reduce to {face, pull}.
 *
 * This finds SPELLINGS of one movement, not movements that merely resemble each
 * other. "Incline DB Press" and "DB Press" reduce differently and are left
 * alone, correctly -- they are different exercises. Anything subtler than a
 * spelling difference is a judgement call, and guessing at it would offer to
 * destroy history on a hunch.
 */
export function findDuplicates() {
  const byReduced = new Map();
  allNames().forEach((rec) => {
    const r = reduceName(rec.name);
    if (!r) return;
    if (!byReduced.has(r)) byReduced.set(r, []);
    byReduced.get(r).push(rec);
  });
  return [...byReduced.values()]
    .filter((group) => group.length > 1)
    // the one with the most logged history is the sensible default target
    .map((group) => group.slice().sort((a, b) => b.sets - a.sets
      || (b.routines + b.sessions) - (a.routines + a.sessions)
      || a.name.localeCompare(b.name)))
    .sort((a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name));
}

const shapeOf = (name) => {
  const lib = exerciseFor(name);
  if (lib) return { type: lib.type, measure: lib.measure, from: 'library' };
  const key = normName(name);
  for (const r of state.routines) {
    const hit = (r.entries || []).find((e) => normName(e.name) === key);
    if (hit) return { type: hit.type, measure: hit.measure || 'reps', from: 'routine' };
  }
  for (const s of state.sessions) {
    const hit = (s.entries || []).find((e) => normName(e.name) === key);
    if (hit) return { type: hit.type, measure: hit.measure || 'reps', from: 'session' };
  }
  return null;
};

/**
 * What a merge would do, and what stands in its way. No writes.
 *
 * Always call this first: a merge rewrites logged history, so the user has to
 * be shown the real scope and the real objections before agreeing to it.
 */
export function mergePreview(fromName, intoName) {
  const fromKey = normName(fromName);
  const intoKey = normName(intoName);
  const out = {
    fromKey,
    intoKey,
    fromName: String(fromName || '').trim(),
    intoName: String(intoName || '').trim(),
    routines: [],
    sessions: 0,
    sets: 0,
    alternatives: 0,
    swaps: 0,
    collisions: [],
    liveSession: false,
    blockers: [],
    warnings: [],
  };
  if (!fromKey || !intoKey) { out.blockers.push('Both names are required.'); return out; }
  if (fromKey === intoKey) { out.blockers.push('Those are already the same exercise.'); return out; }

  const a = shapeOf(fromName);
  const b = shapeOf(intoName);
  if (!a) { out.blockers.push(`Nothing uses "${out.fromName}".`); return out; }

  // A lift logs sets; a cardio entry logs one effort. They are different shapes
  // with different readers, so one name cannot mean both.
  if (b && a.type !== b.type) {
    out.blockers.push(
      `"${out.fromName}" is ${a.type === 'cardio' ? 'cardio' : 'a lift'} and "${out.intoName}" is `
      + `${b.type === 'cardio' ? 'cardio' : 'a lift'}. Those are logged differently and cannot be one exercise.`,
    );
  }
  // Measure is forceable, because the usual reason to merge is that one of them
  // was set wrong -- but 45 seconds silently becoming 45 reps has to be said.
  if (b && a.type === b.type && a.measure !== b.measure) {
    out.warnings.push(
      `"${out.fromName}" is measured in ${a.measure} and "${out.intoName}" in ${b.measure}. `
      + `Everything already logged keeps its number, so those values will now read as ${b.measure}.`,
    );
  }

  state.routines.forEach((r) => {
    const hits = (r.entries || []).filter((e) => normName(e.name) === fromKey).length;
    const already = (r.entries || []).filter((e) => normName(e.name) === intoKey).length;
    const alts = (r.entries || []).filter((e) => (e.alternatives || [])
      .some((n) => normName(n) === fromKey)).length;
    if (hits || alts) out.routines.push({ id: r.id, name: r.name, entries: hits, alternatives: alts });
    out.alternatives += alts;
    if (hits && already) out.collisions.push(`${r.name} uses both names`);
  });

  state.sessions.forEach((s) => {
    const hits = (s.entries || []).filter((e) => normName(e.name) === fromKey);
    const alts = (s.entries || []).filter((e) => (e.alternatives || [])
      .some((n) => normName(n) === fromKey)).length;
    const swaps = (s.entries || []).filter((e) => normName(e.swappedFrom || '') === fromKey).length;
    if (hits.length || alts || swaps) out.sessions++;
    out.sets += hits.reduce((n, e) => n + (e.sets || []).filter((x) => x.done).length, 0);
    out.alternatives += alts;
    out.swaps += swaps;
    if (hits.length && (s.entries || []).some((e) => normName(e.name) === intoKey)) {
      out.collisions.push(`a session on ${new Date(s.startedAt).toDateString()} has both`);
    }
    if (state.active && s.id === state.active.id && (hits.length || alts || swaps)) out.liveSession = true;
  });

  if (out.collisions.length) {
    out.warnings.push(
      'Both names appear together in the same routine or session. Those stay as separate entries '
      + 'under one name rather than being combined, because two blocks of work really happened.',
    );
  }
  return out;
}

/**
 * Do the merge. Rewrites names across routines, sessions and the library.
 *
 * The previous names are snapshotted to `meta.lastMerge` first, keyed by entry
 * id, so `undoLastMerge` can put them back. One level of undo, because this is
 * destructive enough to need one and a full history would be a different
 * feature with a different cost.
 */
export async function mergeExercises(fromName, intoName, { force = false } = {}) {
  const plan = mergePreview(fromName, intoName);
  if (plan.blockers.length) return { ok: false, plan };
  if (plan.warnings.length && !force) return { ok: false, needsForce: true, plan };

  const { fromKey, intoKey } = plan;
  const target = exerciseFor(intoKey) || catalogFor(intoKey);
  // the display spelling the survivor keeps
  const intoDisplay = (target && target.name) || plan.intoName;
  const undo = {
    at: Date.now(), fromKey, intoKey, fromName: plan.fromName, intoName: intoDisplay, entries: [],
  };

  const rewrite = (e) => {
    let changed = false;
    const before = { name: e.name, alternatives: e.alternatives, swappedFrom: e.swappedFrom };
    if (normName(e.name) === fromKey) { e.name = intoDisplay; changed = true; }
    if ((e.alternatives || []).some((n) => normName(n) === fromKey)) {
      // rewrite, dedupe, and drop a reference to the entry's own name: after a
      // merge an Either/Or slot can end up offering itself as the alternative
      e.alternatives = altNames(
        (e.alternatives || []).map((n) => (normName(n) === fromKey ? intoDisplay : n)),
        e.name,
      );
      changed = true;
    }
    if (normName(e.swappedFrom || '') === fromKey) { e.swappedFrom = intoDisplay; changed = true; }
    return changed ? before : null;
  };

  for (const r of state.routines) {
    let dirty = false;
    (r.entries || []).forEach((e) => {
      const before = rewrite(e);
      if (before) {
        undo.entries.push({ kind: 'routine', id: r.id, entryId: e.id, ...before });
        dirty = true;
      }
    });
    if (dirty) await saveRoutine(r);
  }

  for (const s of state.sessions) {
    let dirty = false;
    (s.entries || []).forEach((e) => {
      const before = rewrite(e);
      if (before) {
        undo.entries.push({ kind: 'session', id: s.id, entryId: e.id, ...before });
        dirty = true;
      }
    });
    if (dirty) await persistSession(s);
  }

  // The library: the survivor keeps the richer tagging rather than whichever
  // record happened to be the target, so merging a tagged name into an untagged
  // one does not throw the tags away.
  const fromRec = exerciseFor(fromKey);
  const intoRec = exerciseFor(intoKey);
  if (fromRec || intoRec) {
    const base = intoRec || { ...fromRec, name: intoDisplay };
    const merged = {
      ...base,
      name: intoDisplay,
      primary: (intoRec?.primary?.length ? intoRec.primary : fromRec?.primary) || [],
      secondary: (intoRec?.secondary?.length ? intoRec.secondary : fromRec?.secondary) || [],
      notes: [intoRec?.notes, fromRec?.notes].filter(Boolean).join('\n').trim(),
    };
    undo.removed = fromRec ? { ...fromRec } : null;
    undo.replaced = intoRec ? { ...intoRec } : null;
    await saveExercise(merged);
    if (fromRec) await deleteExercise(fromKey);
  }

  await metaSet('lastMerge', undo);
  await touch({ silent: true });
  emit();
  return { ok: true, plan, undoable: true };
}

/** The merge that can still be undone, or null. */
export const lastMerge = () => metaGet('lastMerge', null);

/**
 * Put the previous names back.
 *
 * Best-effort and says so: entries are matched by id, and anything deleted
 * since the merge is skipped rather than recreated. Restoring a name onto an
 * entry that no longer exists is not possible, and inventing one would be worse
 * than reporting the gap.
 */
export async function undoLastMerge() {
  const undo = await metaGet('lastMerge', null);
  if (!undo || !undo.entries) return null;
  let restored = 0;
  let missing = 0;

  const byKind = { routine: state.routines, session: state.sessions };
  for (const rec of undo.entries) {
    const owner = (byKind[rec.kind] || []).find((o) => o.id === rec.id);
    const e = owner && (owner.entries || []).find((x) => x.id === rec.entryId);
    if (!e) { missing++; continue; }
    e.name = rec.name;
    if (rec.alternatives !== undefined) e.alternatives = rec.alternatives;
    if (rec.swappedFrom !== undefined) e.swappedFrom = rec.swappedFrom;
    restored++;
    if (rec.kind === 'routine') await saveRoutine(owner);
    else await persistSession(owner);
  }

  if (undo.removed) await saveExercise(undo.removed);
  if (undo.replaced) await saveExercise(undo.replaced);
  else if (!undo.replaced && undo.removed) await deleteExercise(undo.intoKey);

  await metaSet('lastMerge', null);
  await touch({ silent: true });
  emit();
  return { restored, missing, fromName: undo.fromName, intoName: undo.intoName };
}
