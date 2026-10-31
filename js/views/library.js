// "Exercise library" — the screen where an exercise is described once.
//
// A screen reached from the Routines tab, deliberately not a seventh tab: this
// is something you set up and then rarely open, and the tab bar is for the five
// things you touch mid-workout. Same arrangement as Settings.
//
// What lives here is knowledge ABOUT an exercise -- how it is measured, where
// the load comes from, whether it is one limb at a time, which muscles it
// trains. What does NOT live here is targets, rest or per-set plans: the same
// exercise is 3x8 in one routine and 5x5 in another, so those belong to the
// routine. The split is the whole reason a library is worth having.
import { state, exerciseFor } from '../store.js';
import {
  saveExercise, deleteExercise, renameExercise, seedExerciseLibrary,
  importLibrary, libraryObject,
} from '../exercisestore.js';
import { exerciseLibrary } from '../queries.js';
import { kindPills, kindLabel } from '../exercise.js';
import {
  CATALOG, CATEGORIES, catalogFor, catalogCounts, searchCatalog, categoryLabel,
  loadKind, asLibraryRecord, certainMatch, suggestFor,
} from '../catalog.js';
import { MEASURES } from '../measure.js';
import { groupPickerHtml, wireGroupPicker } from './exform.js';
import { esc, normName, relDay, download } from '../util.js';
import { openModal, closeModal, confirmDialog, toast } from '../ui.js';

const search = () => (state.nav.libQuery || '').trim();
const mode = () => (['browse', 'tag'].includes(state.nav.libMode) ? state.nav.libMode : 'mine');
const activeCat = () => state.nav.libCat || null;

/** Exercises known to the app but not yet described in the library. */
function untagged() {
  return exerciseLibrary()
    .filter((x) => !exerciseFor(x.key))
    .map((x) => ({ key: x.key, name: x.name, performed: x.performed, routines: x.routines }));
}

/** Described, but with no target muscle — so it contributes nothing to Trends. */
const ungrouped = () => state.exercises.filter((x) => !x.primary.length && x.type === 'lift');

/**
 * Everything in your library that is not fully described yet, with what the
 * catalogue thinks each one is.
 *
 * `certain` entries can be applied without asking; the rest get up to three
 * candidates to pick from, and anything the catalogue cannot place at all is
 * left for you to fill in by hand. Splitting them this way is the point: a
 * bulk action that guessed would mis-tag silently.
 */
export function needsTagging() {
  return state.exercises
    .filter((x) => !x.primary.length)
    .map((x) => {
      const certain = certainMatch(x.name);
      return {
        ex: x,
        certain,
        options: certain ? [] : suggestFor(x.name).map((s) => s.match),
      };
    });
}

function tagQueue() {
  const rows = needsTagging();
  if (!rows.length) {
    return `
      <div class="card">
        <div class="strong ok">Everything in your library has a target muscle.</div>
        <p class="hint" style="margin-top:4px">Per-muscle trends cover all
          ${state.exercises.length} of them.</p>
        <button type="button" class="btn block" data-action="lib-mode" data-mode="mine">Back to my library</button>
      </div>`;
  }
  const certain = rows.filter((r) => r.certain);
  const guessed = rows.filter((r) => !r.certain && r.options.length);
  const unknown = rows.filter((r) => !r.certain && !r.options.length);

  return `
    ${tabs()}
    <div class="card">
      <h2 style="margin-top:0">Fill in what is missing</h2>
      <p class="hint" style="margin-top:0">${rows.length} exercise${rows.length === 1 ? '' : 's'}
        in your library have no target muscle, so they are invisible to per-muscle trends. The
        catalogue can fill in the target muscles, whether it is unilateral, how it is measured and
        where the load comes from &mdash; for the ones it recognises.</p>
      ${certain.length ? `
        <button type="button" class="btn block primary" data-action="lib-apply-certain">
          Apply ${certain.length} exact match${certain.length === 1 ? '' : 'es'}</button>
        <p class="hint">Only names that reduce to exactly a catalogue exercise once shorthand and
          plurals are expanded &mdash; "DB Row", "RDL", "Pull Ups". Nothing is guessed here.</p>` : ''}
    </div>

    ${certain.length ? `
      <h2>Exact matches</h2>
      ${certain.map((r) => `
        <div class="sess-item exrow">
          <div class="body">
            <div class="nm">${esc(r.ex.name)} <span class="pill cat">&rarr; ${esc(r.certain.name)}</span></div>
            <div class="sub">${esc(describe(r.certain))}</div>
          </div>
          <button type="button" class="btn sm" data-action="lib-apply-one"
                  data-key="${esc(r.ex.key)}" data-from="${esc(r.certain.key)}">Apply</button>
        </div>`).join('')}` : ''}

    ${guessed.length ? `
      <h2>Best guesses &mdash; pick one</h2>
      <p class="hint">Not applied automatically: a wrong tag pollutes every per-muscle number and
        nothing would ever flag it.</p>
      ${guessed.map((r) => `
        <div class="card">
          <div class="strong">${esc(r.ex.name)}</div>
          <div class="btn-row" style="flex-direction:column;gap:6px;margin-top:8px">
            ${r.options.map((o) => `<button type="button" class="btn block" data-action="lib-apply-one"
              data-key="${esc(r.ex.key)}" data-from="${esc(o.key)}">${esc(o.name)}
              <span class="dim small">${esc(describe(o))}</span></button>`).join('')}
            <button type="button" class="btn block ghost" data-action="lib-edit"
                    data-key="${esc(r.ex.key)}">None of these &mdash; set it myself</button>
          </div>
        </div>`).join('')}` : ''}

    ${unknown.length ? `
      <h2>The catalogue does not know these</h2>
      <p class="hint">Your own movements. Tap one to set its target muscles by hand.</p>
      ${unknown.map((r) => `
        <div class="sess-item exrow mine" data-action="lib-edit" data-key="${esc(r.ex.key)}"
             role="button" tabindex="0">
          <div class="body"><div class="nm">${esc(r.ex.name)}
            <span class="pill mine">yours</span></div></div>
          <div class="dim">›</div>
        </div>`).join('')}` : ''}`;
}

/** A one-line summary of what a catalogue entry would set. */
function describe(ex) {
  return [
    ex.primary.join(' + ') || null,
    ex.secondary.length ? `+ ${ex.secondary.join(', ')}` : null,
    categoryLabel(ex.category),
    ex.bodyweight ? 'bodyweight' : ex.type === 'cardio' ? 'cardio' : 'external weight',
    ex.unilateral ? 'per side' : null,
  ].filter(Boolean).join(' · ');
}

/** The three marks every exercise carries: kind, load, and per-side. */
function marks(ex, cat) {
  const out = [];
  if (cat) out.push({ cls: 'cat', text: categoryLabel(cat.category) });
  const load = loadKind(ex);
  out.push({
    cls: load === 'bodyweight' ? 'bw' : load === 'none' ? '' : 'ext',
    text: load === 'bodyweight' ? 'bodyweight' : load === 'none' ? 'cardio' : 'external weight',
  });
  if (ex.measure === 'time' && ex.type !== 'cardio') out.push({ cls: 'iso', text: 'isometric' });
  if (ex.measure === 'distance') out.push({ cls: '', text: 'distance' });
  if (ex.unilateral) out.push({ cls: '', text: 'per side' });
  return out;
}

/**
 * One row in YOUR library.
 *
 * An exercise the catalogue has never heard of is marked as yours and styled
 * differently -- dashed edge, "yours" tag -- because the two are not the same
 * kind of thing. A catalogue entry is a shared definition you adopted; one you
 * invented is yours alone, nobody has checked it, and it is the one that will
 * look wrong if you mistyped the name.
 */
function row(ex) {
  const cat = catalogFor(ex.key);
  const mine = !cat;
  const used = exerciseLibrary().find((x) => x.key === ex.key);
  return `
    <div class="sess-item exrow ${mine ? 'mine' : ''}" data-action="lib-edit"
         data-key="${esc(ex.key)}" role="button" tabindex="0">
      <div class="body">
        <div class="nm">${esc(ex.name)}
          ${mine ? '<span class="pill mine">yours</span>' : ''}
          ${marks(ex, cat).map((m) => `<span class="pill ${m.cls}">${esc(m.text)}</span>`).join('')}</div>
        <div class="sub">${ex.primary.length
    ? `<b>${esc(ex.primary.join(', '))}</b>${ex.secondary.length ? ` &middot; ${esc(ex.secondary.join(', '))}` : ''}`
    : '<span class="warnmsg">no target muscle &mdash; not counted in Trends</span>'}</div>
        ${used && used.lastPerformed
    ? `<div class="sub dim">last done ${esc(relDay(used.lastPerformed).toLowerCase())}</div>` : ''}
      </div>
      <div class="dim">›</div>
    </div>`;
}

/** One row in the catalogue browser. */
function catRow(ex) {
  const have = exerciseFor(ex.key);
  // Static action names per branch, not `data-action="${have ? a : b}"`: the
  // style guard's regex reads the markup literally and cannot see through an
  // interpolation, so an interpolated name reads as a dead handler.
  const body = `
      <div class="body">
        <div class="nm">${esc(ex.name)}
          ${marks(ex, ex).map((m) => `<span class="pill ${m.cls}">${esc(m.text)}</span>`).join('')}</div>
        <div class="sub">${ex.primary.length ? `<b>${esc(ex.primary.join(', '))}</b>` : ''}${
  ex.secondary.length ? ` &middot; ${esc(ex.secondary.join(', '))}` : ''}${
  ex.equipment !== 'none' ? ` &middot; ${esc(ex.equipment)}` : ''}</div>
      </div>`;
  return have
    ? `<div class="sess-item exrow built" data-action="lib-edit" data-key="${esc(ex.key)}"
            role="button" tabindex="0">${body}<div class="ok">✓</div></div>`
    : `<div class="sess-item exrow built" data-action="lib-add" data-key="${esc(ex.key)}"
            role="button" tabindex="0">${body}<div class="dim">+</div></div>`;
}

function tabs() {
  const n = state.exercises.length;
  const todo = state.exercises.filter((x) => !x.primary.length).length;
  return `
    <div class="hist-chips libtabs">
      <button type="button" class="chip ${mode() === 'mine' ? 'on' : ''}"
              data-action="lib-mode" data-mode="mine">Mine${n ? ` (${n})` : ''}</button>
      <button type="button" class="chip ${mode() === 'browse' ? 'on' : ''}"
              data-action="lib-mode" data-mode="browse">Browse all ${CATALOG.length}</button>
      ${todo ? `<button type="button" class="chip warn ${mode() === 'tag' ? 'on' : ''}"
              data-action="lib-mode" data-mode="tag">Fix ${todo}</button>` : ''}
    </div>`;
}

/**
 * Just the rows, so typing in the search box can repaint the list WITHOUT a
 * full re-render.
 *
 * A full render replaces #viewRoot, which destroys the input being typed into
 * and takes the keyboard with it. The exercise picker already solves this by
 * rewriting only its list container; the same trick applies here.
 */
export function listHtml() {
  if (mode() === 'browse') {
    const hits = searchCatalog(search(), { category: activeCat() });
    if (!hits.length) {
      return '<div class="empty">Nothing matches. Try a muscle name, or <b>+ New exercise</b> under Mine.</div>';
    }
    return hits.slice(0, 150).map(catRow).join('')
      + (hits.length > 150
        ? `<div class="small dim center">Showing 150 of ${hits.length} — narrow the search.</div>` : '');
  }
  const q = normName(search());
  const all = state.exercises;
  const shown = q ? all.filter((x) => x.key.includes(q) || x.primary.join(' ').toLowerCase().includes(q)
    || x.secondary.some((g) => g.toLowerCase().includes(q))) : all;
  if (shown.length) return shown.map(row).join('');
  return `<div class="empty">${all.length
    ? 'Nothing matches that search.'
    : `Your library is empty. <b>Browse all ${CATALOG.length}</b> to pick from the catalogue, or
       <b>+ New exercise</b> to describe your own.`}</div>`;
}

function browse() {
  const counts = catalogCounts();
  return `
    ${tabs()}
    <div class="card flat">
      <input id="libSearch" data-lib-search inputmode="search"
             placeholder="Search ${CATALOG.length} exercises by name, muscle or kit"
             value="${esc(search())}" aria-label="Search the exercise catalogue">
    </div>
    <div class="chip-wrap">
      <button type="button" class="chip ${activeCat() ? '' : 'on'}"
              data-action="lib-cat" data-cat="">All</button>
      ${CATEGORIES.filter((c) => counts[c.key]).map((c) => `<button type="button"
        class="chip ${activeCat() === c.key ? 'on' : ''}" data-action="lib-cat" data-cat="${c.key}"
        title="${esc(c.hint)}">${esc(c.label)} ${counts[c.key]}</button>`).join('')}
    </div>
    <p class="hint">Every exercise is marked with its <b>kind</b> (strength, isometric, running,
      mobility&hellip;), where the <b>load</b> comes from, and whether it is <b>per side</b>. Tap one
      to add it to your library; a <span class="ok">&#10003;</span> means you already have it.</p>
    <div id="libList">${listHtml()}</div>`;
}

export function render() {
  if (mode() === 'browse') return browse();
  if (mode() === 'tag') return tagQueue();

  const all = state.exercises;
  const missing = untagged();
  const noGroup = ungrouped();
  const ownCount = all.filter((x) => !catalogFor(x.key)).length;

  return `
    ${tabs()}

    <div class="card">
      <p class="hint" style="margin-top:0">Describe an exercise once and every routine, every
        session and every trend that uses the name picks it up &mdash; including sessions you logged
        before. Targets and rest stay on the routine, because the same exercise is three sets of
        eight in one and five of five in another.</p>
      <div class="kv"><span>In your library</span><span class="strong">${all.length}</span></div>
      <div class="kv"><span>Your own, not in the catalogue</span><span>${ownCount}</span></div>
      <div class="kv"><span>Seen but not described</span><span>${missing.length}</span></div>
      <div class="kv"><span>Without a volume group</span><span>${noGroup.length}</span></div>
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn primary" data-action="lib-new">+ New exercise</button>
        <button type="button" class="btn" data-action="lib-mode" data-mode="browse">Browse catalogue</button>
        ${noGroup.length ? `<button type="button" class="btn" data-action="lib-mode" data-mode="tag">Fill in ${noGroup.length} missing tags</button>` : ''}
        ${missing.length ? `<button type="button" class="btn" data-action="lib-seed">Add the ${missing.length} missing</button>` : ''}
      </div>
    </div>

    ${missing.length ? `
      <div class="card" style="border-color:var(--warn)">
        <div class="tiny" style="color:var(--warn);font-weight:700">NOT IN THE LIBRARY YET</div>
        <p class="hint" style="margin-top:4px">These are in a routine or a logged session but have
          no record here, so Trends cannot group them. <b>Add the ${missing.length} missing</b> creates
          a record for each, carrying over what the old data already knew &mdash; timed or not,
          bodyweight or not. Muscle groups are left blank on purpose: guessing them from a name
          would quietly poison every trend built on top.</p>
        <div class="chip-wrap">${missing.slice(0, 40).map((x) => `<button type="button" class="chip"
          data-action="lib-new" data-name="${esc(x.name)}">${esc(x.name)}</button>`).join('')}</div>
      </div>` : ''}

    <div class="card flat">
      <input id="libSearch" data-lib-search inputmode="search" placeholder="Search name or muscle"
             value="${esc(search())}" aria-label="Search your exercise library">
    </div>

    <div id="libList">${listHtml()}</div>

    <div class="card" style="margin-top:12px">
      <h2 style="margin-top:0">Import / export</h2>
      <p class="hint" style="margin-top:0">A plain JSON list. Export it, edit it on a laptop, import
        it back &mdash; or write one from scratch. Only <code>name</code> is required; everything else
        is optional and anything you leave out keeps its default.</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="lib-export">Export JSON</button>
        <button type="button" class="btn" data-action="lib-copy">Copy to clipboard</button>
        <button type="button" class="btn primary" data-action="lib-import">Import JSON</button>
      </div>
      <details style="margin-top:10px">
        <summary class="tiny">What the file looks like</summary>
        <pre class="code">${esc(SAMPLE_LIBRARY)}</pre>
        <p class="hint"><b>measure</b> is <code>reps</code>, <code>time</code> (an isometric hold) or
          <code>distance</code> (a loaded carry) &mdash; <code>isometric</code> is accepted and means
          <code>time</code>. <b>bodyweight</b> and <b>measure</b> are separate questions on purpose: a
          plank is timed <em>and</em> unloaded, and a weighted plank is timed and loaded, so neither
          one can be a single three-way choice. Muscle names are matched loosely, so
          <code>pecs</code>, <code>Chest</code> and <code>chest</code> all land on Chest, and a group
          this app has never heard of is kept as you spelled it.</p>
      </details>
    </div>`;
}

export const SAMPLE_LIBRARY = `{
  "schema": "workout-tracker/exercise-library@1",
  "exercises": [
    { "name": "Barbell Bench Press", "primary": "Chest",
      "secondary": ["Triceps", "Shoulders"] },
    { "name": "Pull-up", "bodyweight": true, "primary": "Lats",
      "secondary": ["Biceps", "Forearms"] },
    { "name": "Front Plank", "measure": "isometric", "bodyweight": true,
      "primary": "Core" },
    { "name": "Single-arm Dumbbell Row", "unilateral": true, "primary": "Back",
      "secondary": ["Lats", "Biceps"] },
    { "name": "Farmer Carry", "measure": "distance", "primary": "Forearms",
      "secondary": ["Traps", "Core"] }
  ]
}`;

/* ------------------------------------------------------------------ */
/* the one-exercise form                                              */
/* ------------------------------------------------------------------ */

function exerciseForm(ex) {
  const e = ex || {};
  return `
    <label class="field"><span>Exercise name</span>
      <input name="name" list="exerciseNames" autocapitalize="words" required
             placeholder="e.g. Single-arm Dumbbell Row" value="${esc(e.name || '')}"></label>
    <label class="field"><span>Each set is measured in</span>
      <select name="measure">
        ${Object.values(MEASURES).map((m) => `<option value="${m.key}"
          ${(e.measure || 'reps') === m.key ? 'selected' : ''}>${esc(m.long)}</option>`).join('')}
      </select></label>
    <label class="field"><span>The load is</span>
      <select name="bodyweight">
        <option value="0" ${e.bodyweight ? '' : 'selected'}>External weight (barbell, machine, dumbbells)</option>
        <option value="1" ${e.bodyweight ? 'selected' : ''}>Your own bodyweight</option>
      </select></label>
    <p class="hint" style="margin-top:-4px">These two are independent: a plank is
      <b>timed</b> and <b>bodyweight</b>, a weighted plank is timed and loaded.</p>
    <label class="field"><span>One side at a time?</span>
      <select name="unilateral">
        <option value="0" ${e.unilateral ? '' : 'selected'}>Both sides together</option>
        <option value="1" ${e.unilateral ? 'selected' : ''}>Unilateral &mdash; one arm / one leg</option>
      </select></label>
    <p class="hint" style="margin-top:-4px">A unilateral exercise logs every planned set
      <b>twice</b>, once per side, so a routine asking for 3 sets opens 6 rows &mdash; left and right
      kept apart, which is the point of training one side at a time.</p>
    ${groupPickerHtml('primary', 'Target muscle groups', e.primary || [],
    'Counted as <b>direct</b> sets in Trends. One exercise can target several &mdash; a bench '
    + 'press really is chest <em>and</em> triceps.')}
    ${groupPickerHtml('secondary', 'Other muscles worked', e.secondary || [],
    'Counted as <b>indirect</b> sets, side by side with the direct ones and never blended '
    + '&mdash; any single number would need a made-up weighting.')}
    <label class="field"><span>Notes (optional)</span>
      <textarea name="notes" rows="2" placeholder="Setup, cues, pin position…">${esc(e.notes || '')}</textarea></label>`;
}

function readForm(v) {
  return {
    name: (v.name || '').trim(),
    measure: v.measure,
    bodyweight: v.bodyweight === '1',
    unilateral: v.unilateral === '1',
    primary: v.primary || '',
    secondary: v.secondary || '',
    notes: v.notes || '',
  };
}

export const libraryActions = {
  'library-go': () => { state.nav = { libQuery: '', libMode: 'mine' }; state.tab = 'library'; },
  'lib-mode': ({ mode: m }) => {
    state.nav.libMode = ['browse', 'tag'].includes(m) ? m : 'mine';
    state.nav.libQuery = '';
    state.nav.libCat = null;
  },
  'lib-cat': ({ cat }) => { state.nav.libCat = cat || null; },

  /**
   * Copy a catalogue entry's attributes onto one of your exercises.
   *
   * The NAME is untouched. Identity in this app is the name, so renaming would
   * orphan every set ever logged under the old one -- you keep calling it "DB
   * Row" and it now knows it trains your back.
   */
  'lib-apply-one': async ({ key, from }) => {
    const mine = exerciseFor(key);
    const src = catalogFor(from);
    if (!mine || !src) return;
    await saveExercise({ ...asLibraryRecord(src), name: mine.name, notes: mine.notes });
    toast(`${mine.name}: ${describe(src)}`, 4200);
  },

  /** Apply every unambiguous match at once. Nothing guessed is included. */
  'lib-apply-certain': async () => {
    const rows = needsTagging().filter((r) => r.certain);
    for (const r of rows) {
      await saveExercise({ ...asLibraryRecord(r.certain), name: r.ex.name, notes: r.ex.notes });
    }
    const left = needsTagging().length;
    toast(rows.length
      ? `${rows.length} tagged from the catalogue.${left ? ` ${left} still need you.` : ' All done.'}`
      : 'No exact matches to apply', 5000);
  },

  /**
   * Adopt a catalogue exercise into your library.
   *
   * A copy, not a reference. From here on it is yours to edit, and the
   * catalogue is only where it came from -- which is why nothing stores a
   * "source" flag: provenance is re-derived by name, so the marks stay right
   * even if the catalogue changes in a later release.
   */
  'lib-add': async ({ key }) => {
    const hit = catalogFor(key);
    if (!hit) return;
    if (exerciseFor(key)) { toast(`${hit.name} is already in your library`); return; }
    await saveExercise(asLibraryRecord(hit));
    toast(`${hit.name} added — ${kindLabel(hit)}${hit.primary.length ? `, ${hit.primary.join(' + ')}` : ''}`, 3800);
  },

  'lib-new': ({ name }) => {
    const modal = openModal({
      title: name ? `Describe ${name}` : 'New exercise',
      bodyHtml: exerciseForm(name ? { name } : null),
      okText: 'Save',
      onSubmit: async (v) => {
        const patch = readForm(v);
        if (!patch.name) { toast('An exercise needs a name'); return false; }
        if (exerciseFor(patch.name)) {
          toast(`${patch.name} is already in the library — open it to edit`, 4000);
          return false;
        }
        await saveExercise(patch);
        toast(`${patch.name} added`);
        return true;
      },
    });
    wireGroupPicker(modal);
  },

  'lib-edit': ({ key }) => {
    const ex = exerciseFor(key);
    if (!ex) return;
    const modal = openModal({
      title: ex.name,
      bodyHtml: `
        ${exerciseForm(ex)}
        <p class="hint">${esc(kindLabel(ex))}.</p>
        <button type="button" class="btn block danger" data-action="lib-del"
                data-key="${esc(ex.key)}">Remove from the library</button>`,
      okText: 'Save',
      onSubmit: async (v) => {
        const patch = readForm(v);
        if (!patch.name) { toast('An exercise needs a name'); return false; }
        // A rename here does not touch history, because identity in this app is
        // the name: the old sets stay under the old name. Say so rather than
        // quietly orphaning them.
        if (normName(patch.name) !== ex.key) {
          await renameExercise(ex.key, patch.name);
          await saveExercise({ ...patch, createdAt: ex.createdAt });
          toast(`Renamed. Sets logged as "${ex.name}" keep that name — history is keyed on it.`, 6000);
          return true;
        }
        await saveExercise({ ...patch, createdAt: ex.createdAt });
        toast('Saved');
        return true;
      },
    });
    wireGroupPicker(modal);
  },

  'lib-del': async ({ key }) => {
    const ex = exerciseFor(key);
    if (!ex) return;
    const yes = await confirmDialog(
      `Only the library record goes. Every routine and every logged set keeps the name and stays `
      + `exactly as it is — but ${ex.name} will stop being counted in the per-muscle trends `
      + 'until it is described again.',
      { title: `Remove ${ex.name}?`, okText: 'Remove', danger: true },
    );
    if (!yes) return;
    await deleteExercise(key);
    closeModal();
    toast(`${ex.name} removed from the library`);
  },

  'lib-seed': async () => {
    const res = await seedExerciseLibrary();
    toast(res.added
      ? `${res.added} exercise${res.added === 1 ? '' : 's'} added. Tag them with a volume group to see per-muscle trends.`
      : 'Nothing to add — every exercise is already described.', 5000);
  },

  'lib-export': () => {
    download('exercise-library.json', JSON.stringify(libraryObject(), null, 2), 'application/json');
    toast('Exported');
  },

  'lib-copy': async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(libraryObject(), null, 2));
      toast('Library copied to the clipboard');
    } catch {
      toast('Could not reach the clipboard — use Export instead');
    }
  },

  'lib-import': () => {
    openModal({
      title: 'Import an exercise library',
      bodyHtml: `
        <label class="field"><span>What should happen to exercises already in the library?</span>
          <select name="mode">
            <option value="add" selected>Add only the new ones — never change what I have</option>
            <option value="update">Add new ones AND update the fields the file mentions</option>
            <option value="replace">Replace the library with this file</option>
          </select></label>
        <p class="hint" style="margin-top:-4px"><b>Update</b> only touches the fields each record
          actually contains, so a file carrying nothing but muscle groups will not reset anything
          else. <b>Replace</b> deletes any exercise the file does not list.</p>
        <label class="field"><span>Paste the JSON</span>
          <textarea name="json" rows="9" placeholder='{ "exercises": [ { "name": "…" } ] }'></textarea></label>
        <p class="hint">Nothing leaves this device.</p>`,
      okText: 'Import',
      onSubmit: async (v) => {
        const text = (v.json || '').trim();
        if (!text) { toast('Paste the JSON first'); return false; }
        try {
          const r = await importLibrary(text, { mode: v.mode || 'add' });
          const bits = [];
          if (r.added) bits.push(`${r.added} added`);
          if (r.updated) bits.push(`${r.updated} updated`);
          if (r.unchanged) bits.push(`${r.unchanged} left alone`);
          if (r.removed) bits.push(`${r.removed} removed`);
          if (r.skipped) bits.push(`${r.skipped} skipped (no name)`);
          toast(bits.length ? bits.join(' · ') : 'Nothing to do', 6000);
          return true;
        } catch (err) {
          toast(err.message, 7000);
          return false;
        }
      },
    });
  },
};

/**
 * Live search. Repaints only the list, so the input keeps focus and the
 * on-screen keyboard stays up -- a full re-render would replace the very
 * element being typed into.
 */
export function handleLibrarySearch(el) {
  state.nav.libQuery = el.value;
  const list = document.getElementById('libList');
  if (list) list.innerHTML = listHtml();
}
