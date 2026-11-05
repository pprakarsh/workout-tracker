// Nudges: a feature introduced by the user's own data, once, dismissibly.
//
// The problem this solves is DISCOVERY, not explanation. The app already
// explains itself well in place -- hints under fields, units in headers,
// formats in placeholders, empty states that say why they are empty. But you
// cannot read a hint on a screen you never open, and there are about twenty
// features here. A new user finds three and concludes that is all there is.
//
// The wrong fix is a carousel (skipped) or a help page (never found). The right
// fix is to say nothing until the user's own log proves they would benefit, and
// then say exactly one thing.
//
// So every rule here is EARNED. It reads only stored data, fires at a threshold
// that means the pattern is a habit rather than an accident, appears once, and
// can be dismissed forever. A nudge that fires on a guess is worse than no
// nudge: it teaches the user that this app's advice is noise.
//
// Three deliberate restraints:
//
//   ONE AT A TIME.  activeNudge() returns a single nudge, never a list. A stack
//                   of advice cards is a help page wearing a disguise.
//   NEVER MID-SET.  The only surface is the Now screen with no workout running.
//                   Interrupting someone under a loaded bar to teach them about
//                   Trends is hostile.
//   NEVER GUESS.    A rule that cannot be grounded in stored data is not here.
//                   The two shape rules below fire only when the shipped
//                   catalogue disagrees with what was logged AND the user has
//                   not stated a preference of their own -- a library record
//                   saying "reps" is a decision, and decisions are respected.
//
// Dismissals live in `meta.dismissed` and deliberately do NOT travel in the
// backup: a nudge is not data, and a genuinely new device has genuinely not
// seen them yet.
//
// A peer of the store, like queries.js: it reads state and never writes it
// except through its own dismissal, and nothing in the store imports it back.
import { state, exerciseFor } from './store.js';
import { completedSessions } from './queries.js';
import { catalogFor } from './catalog.js';
import { syncState } from './sync.js';
import { normName, esc } from './util.js';
import { metaSet } from './db.js';

/* ------------------------------------------------------------------ */
/* what the rules get to look at                                      */
/* ------------------------------------------------------------------ */

/**
 * One pass over the logged history, tallied per exercise name.
 *
 * Built once per evaluation and handed to every rule, so adding a rule costs
 * nothing at render time and no rule can quietly walk the sessions again.
 */
function exerciseFacts(sessions) {
  const out = new Map();
  sessions.forEach((s) => (s.entries || []).forEach((e) => {
    const key = normName(e.name);
    if (!key || e.type === 'cardio') return;
    if (!(e.sets || []).some((x) => x.done)) return;
    if (!out.has(key)) {
      out.set(key, { key, name: String(e.name).trim(), logged: 0, asReps: 0, asBilateral: 0 });
    }
    const f = out.get(key);
    f.logged++;
    if ((e.measure || 'reps') === 'reps') f.asReps++;
    if (!e.unilateral) f.asBilateral++;
  }));
  return [...out.values()];
}

/**
 * The user has not contradicted the catalogue about this exercise.
 *
 * A library record is a deliberate statement, so if one exists and disagrees
 * with the catalogue, the user wins and no nudge fires. Absence of a record is
 * what makes the catalogue's opinion worth raising at all.
 */
const unstated = (key, field, catalogValue) => {
  const rec = exerciseFor(key);
  return !rec || rec[field] === catalogValue;
};

/* ------------------------------------------------------------------ */
/* the rules                                                          */
/* ------------------------------------------------------------------ */

/**
 * Ordered by consequence, not by cleverness. `backup` is first because it is
 * the only one whose absence loses data; everything below it costs accuracy or
 * convenience, which is recoverable.
 *
 * `{name}` placeholders in title and body are filled from what `when` returns.
 * `when` returns those values when the rule fires, or null when it does not.
 */
export const RULES = [
  {
    id: 'backup',
    title: 'Your log lives only on this phone',
    body: 'There is no account and no server: {sessions} sessions of work exist in this browser\'s '
      + 'storage and nowhere else. Clearing site data, or losing the phone, loses all of it. Sync '
      + 'copies it to a secret GitHub Gist, which also gets it onto a second device. An exported '
      + 'backup file works too, and needs no account at all.',
    cta: { action: 'routines-go', label: 'Set up sync, or export a backup' },
    when: ({ sessions, synced }) => (sessions.length >= 10 && !synced
      ? { sessions: sessions.length } : null),
  },
  {
    id: 'hold-measure',
    title: 'Logging a hold in reps?',
    body: 'You have logged <b>{name}</b> {n} times counted in reps. It is normally measured in '
      + 'seconds. Set it to a hold and the amount column becomes time, with a timer that records '
      + 'the hold on the same clock as your rest.',
    cta: { action: 'library-go', label: 'Open the exercise library' },
    when: ({ facts }) => {
      const hit = facts.find((f) => f.asReps >= 3
        && catalogFor(f.key)?.measure === 'time'
        && unstated(f.key, 'measure', 'time'));
      return hit ? { name: hit.name, n: hit.asReps } : null;
    },
  },
  {
    id: 'unilateral',
    title: 'One side at a time?',
    body: '<b>{name}</b> is logged as one set covering both sides, {n} times over. It is normally '
      + 'done one side at a time. Mark it unilateral and each set splits into L and R, so a '
      + 'difference between your sides becomes visible instead of averaged away.',
    cta: { action: 'library-go', label: 'Open the exercise library' },
    when: ({ facts }) => {
      const hit = facts.find((f) => f.asBilateral >= 5
        && catalogFor(f.key)?.unilateral === true
        && unstated(f.key, 'unilateral', true));
      return hit ? { name: hit.name, n: hit.asBilateral } : null;
    },
  },
  {
    id: 'rest-timer',
    title: 'The rest clock records what you actually took',
    body: 'Across {sessions} sessions, no set has a rest time on it. The ⏱ on a set starts a clock '
      + 'and writes the real gap onto the next set. Rest is the one number you cannot reconstruct '
      + 'afterwards: weights and reps you can always type in later, the two minutes you stood '
      + 'there you cannot.',
    when: ({ sessions, restsLogged }) => (sessions.length >= 5 && restsLogged === 0
      ? { sessions: sessions.length } : null),
  },
  {
    id: 'stale-targets',
    title: 'Same targets, {n} sessions in',
    body: 'You have run <b>{name}</b> {n} times without ever changing it. Nothing here progresses '
      + 'by itself, deliberately. This costs you nothing day to day, because the prefilled numbers '
      + 'come from your last session rather than from the routine, but the plan no longer says what '
      + 'you actually do. <b>Save session back to routine</b> on a finished workout fixes that in '
      + 'one tap.',
    cta: { action: 'routines-go', label: 'Open routines' },
    when: ({ sessions }) => {
      const runs = new Map();
      sessions.forEach((s) => {
        if (s.routineId) runs.set(s.routineId, (runs.get(s.routineId) || 0) + 1);
      });
      for (const [id, n] of runs) {
        if (n < 8) continue;
        const r = state.routines.find((x) => x.id === id);
        // saved within a minute of creation == never deliberately edited since
        if (r && (r.updatedAt || 0) - (r.createdAt || 0) < 60000) return { name: r.name, n };
      }
      return null;
    },
  },
];

/* ------------------------------------------------------------------ */
/* evaluation                                                         */
/* ------------------------------------------------------------------ */

/** The facts every rule shares, computed once per evaluation. */
export function nudgeContext() {
  const sessions = completedSessions();
  let restsLogged = 0;
  sessions.forEach((s) => (s.entries || []).forEach((e) => (e.sets || []).forEach((x) => {
    if (x.done && x.rest != null) restsLogged++;
  })));
  return {
    sessions,
    facts: exerciseFacts(sessions),
    restsLogged,
    synced: syncState().configured,
  };
}

/** `{name}` -> vars.name, escaped. The rule text is ours; the values are not. */
const fill = (tpl, vars) => String(tpl)
  .replace(/\{(\w+)\}/g, (_, k) => (k in vars ? esc(String(vars[k])) : ''));

/**
 * The one nudge to show, or null.
 *
 * The highest-consequence rule that both fires and has not been dismissed.
 */
export function activeNudge(ctx = nudgeContext()) {
  for (const rule of RULES) {
    if ((state.dismissed || []).includes(rule.id)) continue;
    let vars = null;
    try {
      vars = rule.when(ctx);
    } catch {
      vars = null;   // a broken rule must never take the screen down with it
    }
    if (!vars) continue;
    return {
      id: rule.id,
      title: fill(rule.title, vars),
      body: fill(rule.body, vars),
      cta: rule.cta || null,
    };
  }
  return null;
}

/** Gone for good. Persisted, because being told twice is the whole failure. */
export async function dismissNudge(id) {
  if (!id || (state.dismissed || []).includes(id)) return;
  state.dismissed = [...(state.dismissed || []), id];
  await metaSet('dismissed', state.dismissed);
}

/** Markup for the current nudge, or '' when there is nothing earned to say. */
export function nudgeHtml(n = activeNudge()) {
  if (!n) return '';
  const cta = n.cta
    ? `<button type="button" class="btn sm block" style="margin-top:8px" data-action="${esc(n.cta.action)}">${esc(n.cta.label)}</button>`
    : '';
  return `
    <div class="card nudge" data-nudge="${esc(n.id)}">
      <div class="row">
        <div class="tiny" style="flex:1;min-width:0">Noticed in your log</div>
        <button type="button" class="btn xs ghost" data-action="nudge-dismiss" data-id="${esc(n.id)}"
                aria-label="Dismiss this tip">✕</button>
      </div>
      <div class="strong" style="margin-top:2px">${n.title}</div>
      <p class="hint" style="margin:4px 0 0">${n.body}</p>
      ${cta}
    </div>`;
}
