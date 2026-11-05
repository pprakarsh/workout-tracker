// The words this app uses, defined once, read where they appear.
//
// The app says RPE, RIR, e1RM, unilateral, isometric, drop set, superset,
// warmup set, direct and indirect sets, prefill, measure and interval leg. A
// beginner knows maybe three of those, and a glossary PAGE does not help: you
// have to already know a word is defined somewhere to go and look for it.
//
// So a term renders as the term itself, lightly marked, tappable in place. The
// definition opens where you were standing when you needed it.
//
// Two rules for every entry here:
//
//   SAY WHAT IT MEANS IN THIS APP, not what it means in the literature. The
//   useful sentence is "RIR is how many reps you had left", followed
//   immediately by "stored separately from RPE, never converted" -- because the
//   second sentence is the one that stops a wrong assumption about the data.
//
//   THREE SENTENCES. A definition that needs a paragraph belongs in the How
//   this works card, which is a different thing read at a different time.
//
// Not a view: pure data plus two pure functions, so anything can render a term.
import { esc } from './util.js';

export const TERMS = {
  rpe: {
    term: 'RPE',
    full: 'Rate of Perceived Exertion',
    body: 'How hard a set felt, 1 to 10, where 10 means nothing left. '
      + 'You record it after the set, per set — it is never a target in a routine. '
      + 'Stored separately from RIR and never converted between the two, so whichever you log is the one you see.',
  },
  rir: {
    term: 'RIR',
    full: 'Reps In Reserve',
    body: 'How many more reps you could have done. 0 means you failed the next one; 3 means you stopped three short. '
      + 'It is the same judgement as RPE from the other end, and this app keeps both, unconverted. '
      + 'Which one you are asked for is a setting.',
  },
  e1rm: {
    term: 'e1RM',
    full: 'estimated one-rep max',
    body: 'What your top single might be, calculated from a set you actually did. '
      + 'It is an estimate from a formula, not something you lifted, which is why it is labelled with an e and never called a PR. '
      + 'Useful for comparing a 5×100 to a 3×110; not useful as a number to chase.',
  },
  unilateral: {
    term: 'unilateral',
    body: 'One side at a time: single-arm rows, split squats, one-legged work. '
      + 'Marking an exercise unilateral splits every set into an L row and an R row, logged separately. '
      + 'That is the whole point — averaging the two sides hides exactly the imbalance you train one side at a time to find.',
  },
  isometric: {
    term: 'isometric',
    body: 'A hold, where the muscle works without the joint moving: planks, dead hangs, wall sits, L-sits. '
      + 'An isometric is measured in seconds rather than reps, so the amount column becomes time and the ⏱ times the hold for you. '
      + 'It is still an ordinary set otherwise — it can carry load, effort and rest like any other.',
  },
  warmup: {
    term: 'warmup set',
    body: 'A set you did to get ready, not to count. Tag it and it still appears in your log with its real numbers. '
      + 'What changes is that it is left out of volume, out of your personal bests and out of the prefilled numbers for next time. '
      + 'Everything you lifted is recorded; only what it counts towards differs.',
  },
  superset: {
    term: 'superset',
    body: 'Two or more exercises done back to back, which this app calls a group: give neighbouring exercises the same short label. '
      + 'They then show up on one screen, and Next skips past the whole block rather than stepping through its members. '
      + 'Each exercise still keeps its own rest value — a group does not share one rest period.',
  },
  dropset: {
    term: 'drop set',
    body: 'Hitting failure, stripping weight immediately, and carrying on with no rest. '
      + 'Logged as one set with several stages rather than as several sets, because that is what it is. '
      + 'The rest clock deliberately does not start between stages, and the effort question is not asked until the last one.',
  },
  direct: {
    term: 'direct sets',
    body: 'Sets where a muscle was the main target, counted from the muscle groups on the exercise. '
      + 'Indirect sets are the ones where it helped — the triceps in a bench press. '
      + 'The two are shown side by side and never added together, because one hard set for a muscle is not the same as one set where it assisted.',
  },
  prefill: {
    term: 'prefill',
    body: 'The numbers already in a set row when you get to it, taken from the last time you did that exercise, falling back to the routine\'s target. '
      + 'Nothing is logged until you confirm it, so a prefilled row that you skip records nothing at all. '
      + 'This is why logging here is tapping rather than typing — and why the app never raises those numbers for you.',
  },
  measure: {
    term: 'measure',
    body: 'What a set is counted in: reps, time (a hold), or distance (a loaded carry). '
      + 'It belongs to the exercise, not to the set, so a plank is seconds everywhere it appears. '
      + 'Set it wrong and the amount column asks for the wrong thing — which is the one mistake worth going back to fix.',
  },
  leg: {
    term: 'interval leg',
    body: 'One piece of an interval: a work leg or a recovery leg, each with a time and a target pace. '
      + 'A whole block is written as one pattern — "1:00 hard + 1:30 easy x 6" — and logged in a single tap. '
      + 'Any individual round can still be corrected afterwards.',
  },
  session: {
    term: 'session',
    body: 'One workout, as it actually happened. Starting a routine copies it into a new session, so the session is a snapshot. '
      + 'Changing anything during a session — a weight, an exercise, the order — never touches the routine it came from. '
      + 'Saving changes back to the routine is a separate, deliberate action.',
  },
  routine: {
    term: 'routine',
    body: 'The plan: which exercises, in what order, with what targets. You make it once and start it many times. '
      + 'Targets are optional, and an exercise with no numbers still logs fine. '
      + 'Nothing in a routine changes by itself — no automatic progression, by design.',
  },
};

/** A term rendered in place: the word itself, tappable. */
export function termHtml(key, label = null, { back = null } = {}) {
  const t = TERMS[key];
  if (!t) return esc(label || key);
  return `<button type="button" class="term" data-action="term-open" data-term="${esc(key)}"${back ? ` data-back="${esc(back)}"` : ''}
    aria-label="What ${esc(t.term)} means">${esc(label || t.term)}</button>`;
}

/** The definition, for the sheet that opens. */
export function termBodyHtml(key) {
  const t = TERMS[key];
  if (!t) return '<p class="muted">No definition for that.</p>';
  return `
    ${t.full ? `<div class="tiny">${esc(t.full)}</div>` : ''}
    <p class="muted" style="margin:4px 0 0">${esc(t.body)}</p>`;
}

export const termTitle = (key) => (TERMS[key] ? TERMS[key].term : 'Term');
