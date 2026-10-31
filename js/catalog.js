// The built-in exercise catalogue: parsing, classification and search.
//
// Pure. Reads the two data files once at module load and exposes them as
// records shaped exactly like an exercise-library record, so anything that can
// display or add a library exercise can do the same with a catalogue one.
//
// The data is split in two -- js/catalogdata.js is the gym (strength, power,
// Olympic, plyometric, isometric, carry, core) and js/catalogconditioning.js is
// running, other cardio, mobility and prehab -- only so that neither file
// passes the 1000-line module cap. They share one format and one parser.
//
// WHY A CATALOGUE AND A LIBRARY BOTH:
//   the catalogue is what the APP knows      -- shipped, read-only, never synced
//   the library   is what YOU have decided   -- yours, editable, synced, backed up
//
// Adding a catalogue exercise copies it into your library. From then on it is
// yours to edit, and the catalogue is only its origin. That is why a library
// record stores no "source" flag: provenance is derived by asking the catalogue
// whether it knows the name (`catalogFor`), so an exercise the catalogue gains
// in a later release stops being marked as homemade without a migration.
import { normName } from './util.js';
import { CATALOG_LINES } from './catalogdata.js';
import { CONDITIONING_LINES } from './catalogconditioning.js';
import { parseGroups } from './exercise.js';

/**
 * The kinds of training the catalogue distinguishes, in the order they are
 * shown. This is the mark carried by EVERY catalogue exercise -- the answer to
 * "is this strength, isometric, running, mobility or something else".
 *
 * It is a separate axis from how a set is MEASURED (reps/time/distance) and
 * from where the LOAD comes from (your bodyweight or an external one). Those
 * three answer different questions and a single label cannot carry all of them:
 * a plank is isometric + timed + bodyweight, and a weighted plank is isometric
 * + timed + externally loaded.
 */
export const CATEGORIES = [
  { key: 'strength', label: 'Strength', hint: 'Sets and reps against a load' },
  { key: 'power', label: 'Power', hint: 'Fast, explosive, usually submaximal' },
  { key: 'olympic', label: 'Olympic', hint: 'Snatch, clean and jerk and their partials' },
  { key: 'plyo', label: 'Plyometric', hint: 'Jumps, bounds and throws' },
  { key: 'isometric', label: 'Isometric', hint: 'Held still, measured in seconds' },
  { key: 'carry', label: 'Carry', hint: 'Loaded walking, measured in metres' },
  { key: 'core', label: 'Core', hint: 'Trunk work in reps' },
  { key: 'running', label: 'Running', hint: 'Runs, intervals, walks and rucks' },
  { key: 'cardio', label: 'Cardio', hint: 'Bike, row, swim, rope and machines' },
  { key: 'mobility', label: 'Mobility', hint: 'Stretches, drills and warm-ups' },
  { key: 'rehab', label: 'Prehab', hint: 'Cuffs, bands and small-muscle work' },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
export const categoryLabel = (key) => CATEGORY_LABEL[key] || key || '';

/** How the load is supplied. The third axis, independent of category and measure. */
export const LOADS = [
  { key: 'external', label: 'External weight' },
  { key: 'bodyweight', label: 'Bodyweight' },
  { key: 'none', label: 'No load' },
];

/**
 * Which load bucket an exercise falls in.
 *
 * Cardio carries no load at all, so calling it "external weight" would be a
 * lie by omission -- it gets its own bucket rather than being forced into one
 * of the two lifting answers.
 */
export function loadKind(ex) {
  if (!ex) return 'none';
  if (ex.type === 'cardio') return 'none';
  return ex.bodyweight ? 'bodyweight' : 'external';
}

function parseLine(line) {
  const [name, category, equipment, measureSpec, primary, secondary] = line.split('|');
  const [measure, ...flags] = String(measureSpec || 'reps').split(':');
  const isCardio = measure === 'cardio';
  const p = parseGroups(primary);
  return {
    key: normName(name),
    name: String(name).trim(),
    type: isCardio ? 'cardio' : 'lift',
    measure: isCardio ? 'reps' : measure,
    bodyweight: flags.includes('bw'),
    unilateral: flags.includes('uni'),
    primary: p,
    secondary: parseGroups(secondary, p),
    category: String(category || 'strength').trim(),
    equipment: String(equipment || 'none').trim(),
    notes: '',
    // marks this record as coming from the shipped catalogue rather than from
    // the user's library. Only ever true on these objects.
    builtIn: true,
  };
}

/**
 * The parsed catalogue. Built once, at module load.
 *
 * Blank lines and `#` comments are dropped, so the data file can be grouped and
 * annotated without the parser caring.
 */
export const CATALOG = `${CATALOG_LINES}\n${CONDITIONING_LINES}`
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map(parseLine)
  .filter((x) => x.key)
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_KEY = new Map(CATALOG.map((x) => [x.key, x]));

/**
 * The catalogue record for a name, or null. Provenance is asked, not stored.
 */
export const catalogFor = (name) => {
  const k = normName(name);
  return k ? BY_KEY.get(k) || null : null;
};

/**
 * Shorthand people actually type, mapped to catalogue words.
 *
 * Only unambiguous expansions belong here. "db" is always a dumbbell; "pull"
 * could be a pull-up or a clean pull, so it is absent.
 */
const ALIASES = {
  db: 'dumbbell', bb: 'barbell', kb: 'kettlebell', ez: 'ez',
  rdl: 'romanian deadlift', sldl: 'stiff-leg deadlift', ohp: 'overhead press',
  bp: 'bench press', gm: 'good morning', bss: 'bulgarian split squat',
  tri: 'triceps', tris: 'triceps', bi: 'biceps', bis: 'biceps',
  pec: 'chest', pecs: 'chest', lat: 'lats', quad: 'quads', ham: 'hamstrings',
  hams: 'hamstrings', glute: 'glutes', calf: 'calves', abs: 'core', ab: 'core',
  pullup: 'pull-up', pullups: 'pull-up', chinup: 'chin-up', chinups: 'chin-up',
  pushup: 'push-up', pushups: 'push-up', situp: 'sit-up', situps: 'sit-up',
  ohe: 'overhead extension', skullcrusher: 'skull crusher',
  ghr: 'glute-ham raise', ghd: 'glute-ham raise', hspu: 'handstand push-up',
  t2b: 'toes-to-bar', c2b: 'chest-to-bar pull-up', du: 'double-unders',
};

/** Only true noise: words that never distinguish one exercise from another. */
const STOP = new Set(['the', 'a', 'an', 'and', 'with', 'on', 'in', 'of', 'to', 'for', 'variation', 'var']);

/** Crude singular: "curls" -> "curl" and "ups" -> "up", but never "press" -> "pres". */
const singular = (w) => (w.length >= 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

function words(s) {
  return normName(s)
    .replace(/[^a-z0-9- ]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .flatMap((w) => (ALIASES[w] ? ALIASES[w].split(/[\s-]+/) : [w]))
    .map(singular)
    .filter((w) => !STOP.has(w));
}

/**
 * Rank catalogue entries against a name the catalogue does not know exactly.
 *
 * For filling in attributes on exercises already in a library, where the names
 * are whatever got typed at the gym: "DB Row", "Lat Pulldown Machine", "RDL".
 *
 * Scoring is token overlap in BOTH directions -- how much of what you typed the
 * candidate covers, and how much the candidate adds that you never said. The
 * second half matters: without it "Row" scores perfectly against every row in
 * the catalogue and the winner is whichever sorted first.
 *
 * Nothing here drops equipment words. An earlier version treated "barbell" and
 * "db" as noise, which made "DB Row" an exact match for "Barbell Row" -- the
 * two words that distinguish them were the two it threw away. A matcher that is
 * confidently wrong is worse than one that admits it does not know, because a
 * wrong tag pollutes every per-muscle number and nothing ever flags it.
 *
 * Returns up to `limit` candidates, best first.
 */
export function suggestFor(name, { limit = 3, min = 0.25 } = {}) {
  const want = words(name);
  if (!want.length) return [];
  const scored = [];
  for (const x of CATALOG) {
    const have = words(x.name);
    const hits = want.filter((w) => have.includes(w)).length;
    if (!hits) continue;
    const covered = hits / want.length;        // of what you typed
    const extra = hits / have.length;          // of what it is
    const score = (covered * 2 + extra) / 3;   // what you said matters more
    if (score >= min) scored.push({ match: x, score });
  }
  scored.sort((a, b) => b.score - a.score || a.match.name.localeCompare(b.match.name));
  return scored.slice(0, limit);
}

/**
 * The single match safe to apply WITHOUT asking.
 *
 * Deliberately strict: the name has to reduce to exactly the same words as the
 * catalogue entry, after expanding shorthand and singulars. That catches "DB
 * Row" -> "Dumbbell Row", "Pull Ups" -> "Pull-up" and "RDL" -> "Romanian
 * Deadlift", and refuses everything else to a human. Anything less strict and a
 * bulk apply would quietly mis-tag a library.
 */
export function certainMatch(name) {
  const exact = catalogFor(name);
  if (exact) return exact;
  const want = words(name).slice().sort().join(' ');
  if (!want) return null;
  const hits = CATALOG.filter((x) => words(x.name).slice().sort().join(' ') === want);
  // two catalogue entries reducing to the same words is an ambiguity, not a match
  return hits.length === 1 ? hits[0] : null;
}

/** Is this name one the app ships, as opposed to one the user invented? */
export const isBuiltIn = (name) => catalogFor(name) !== null;

/** How many of each category, for the browse screen's counts. */
export function catalogCounts() {
  const out = {};
  CATALOG.forEach((x) => { out[x.category] = (out[x.category] || 0) + 1; });
  return out;
}

/** Every muscle group the catalogue actually uses, sorted. */
export function catalogGroups() {
  const set = new Set();
  CATALOG.forEach((x) => {
    x.primary.forEach((g) => set.add(g));
    x.secondary.forEach((g) => set.add(g));
  });
  return [...set].sort();
}

/**
 * Search the catalogue.
 *
 * Matching is on the name, the muscle groups and the equipment, so "dumbbell",
 * "lats" and "row" all find a dumbbell row. Word-prefix matching rather than a
 * plain substring: "press" should find "Bench Press" and "Overhead Press" but
 * not be beaten to the top by something that merely contains the letters.
 */
export function searchCatalog(query = '', { category = null, group = null, load = null } = {}) {
  const q = normName(query);
  const terms = q ? q.split(' ').filter(Boolean) : [];
  const hits = CATALOG.filter((x) => {
    if (category && x.category !== category) return false;
    if (load && loadKind(x) !== load) return false;
    if (group && !x.primary.includes(group) && !x.secondary.includes(group)) return false;
    if (!terms.length) return true;
    const hay = `${x.key} ${x.primary.join(' ').toLowerCase()} `
      + `${x.secondary.join(' ').toLowerCase()} ${x.equipment} ${x.category}`;
    return terms.every((t) => hay.includes(t));
  });
  if (!terms.length) return hits;
  // a name that starts with what was typed is almost always the one meant
  const starts = (x) => (x.key.startsWith(terms[0]) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name));
}

/**
 * A catalogue record as a library record: the fields exercisestore stores.
 *
 * `builtIn`, `category` and `equipment` are dropped on purpose. The first two
 * are derivable from the catalogue by name at any time, and storing a copy
 * would go stale the moment the catalogue changed.
 */
export function asLibraryRecord(ex) {
  if (!ex) return null;
  return {
    name: ex.name,
    type: ex.type,
    measure: ex.measure,
    bodyweight: ex.bodyweight,
    unilateral: ex.unilateral,
    primary: ex.primary,
    secondary: ex.secondary,
  };
}
