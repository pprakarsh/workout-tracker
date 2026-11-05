// Where a routine comes from: you write it, an AI writes it, or you import JSON.
//
// Split out of views/routines.js, which is at its line cap and already serves
// two audiences (the routine editor, and the data/settings screen). This file
// serves a third: someone who has no routine yet and does not know which of the
// three doors to walk through.
//
// The part worth understanding is aiPrompt().
//
// IDENTITY IN THIS APP IS THE EXERCISE NAME. There is no exercise id -- every
// history lookup, prefill, personal best and muscle-group total keys on
// normName(entry.name), which is what makes tagging retroactive (see
// js/exercisemerge.js for the full argument). The cost is that an AI writing
// "DB Row" where the user's history says "Dumbbell Row" silently starts a
// second history for one movement.
//
// A reference link cannot fix that. The user's own library lives in IndexedDB
// on one device and has no URL at all, so there is nothing to link to. The only
// reliable channel to the AI tool is the prompt text itself, which is why
// aiPrompt() pastes the names in rather than pointing at them. The built-in
// catalogue DOES have a URL, because it ships as a static file, so it is offered
// as an optional extra for tools that can browse -- never as the mechanism.
//
// Injection is a nudge, not a guarantee, so there are three layers:
//   prevent   this prompt block
//   detect    Library's "not in the library yet" list flags invented names
//   repair    the Fix queue maps one to the catalogue in a tap, or Merge...
// A name the AI invents is therefore never a dead end, which is why the prompt
// tells it to go ahead and invent one when nothing in the list fits. Picking a
// worse exercise to match an existing name would be the real damage.
import { namesInUse } from '../exercisemerge.js';
import { CATALOG } from '../catalog.js';
import { esc } from '../util.js';
import { openModal, toast, copyText } from '../ui.js';
import { AI_PROMPT } from './routines.js';

/** How many names to paste in. Enough to cover a real training history, short
 *  enough that the list does not drown the instructions around it. */
const NAME_CAP = 150;

/** Where the names block is spliced in: high up, before the output rules. */
const RULES_MARK = '================ OUTPUT RULES ================';

/**
 * The names to offer, most-used first, capped.
 *
 * Sorted by logged sets rather than alphabetically because the cap has to bite
 * somewhere, and the exercise with 200 logged sets is the one whose history an
 * AI must not split.
 */
export function promptNames({ cap = NAME_CAP } = {}) {
  return namesInUse()
    .sort((a, b) => (b.sets - a.sets)
      || ((b.routines + b.sessions) - (a.routines + a.sessions))
      || a.name.localeCompare(b.name))
    .slice(0, cap)
    .map((x) => x.name);
}

/** Names as indented, wrapped, semicolon-separated lines. */
function nameLines(names, width = 74) {
  const lines = [];
  let cur = '';
  names.forEach((n, i) => {
    const piece = i === names.length - 1 ? n : `${n}; `;
    if (cur && cur.length + piece.length > width) { lines.push(cur); cur = ''; }
    cur += piece;
  });
  if (cur) lines.push(cur);
  return lines.map((l) => `  ${l.replace(/; $/, ';')}`).join('\n');
}

/**
 * The catalogue's public URL, or null when the app is not served over http.
 *
 * Derived from the document rather than hardcoded, so it is right wherever this
 * is hosted and absent when it would be a lie -- a file:// path is not something
 * an AI tool can fetch.
 */
export function catalogUrls() {
  try {
    const base = document.baseURI;
    if (!/^https?:/.test(base)) return [];
    return ['js/catalogdata.js', 'js/catalogconditioning.js']
      .map((f) => new URL(f, base).href);
  } catch {
    return [];
  }
}

/** The block aiPrompt() adds. Exported so the UI can show exactly what it is. */
export function namesBlock() {
  const names = promptNames();
  const total = namesInUse().length;
  const urls = catalogUrls();

  const head = `================ USE MY EXERCISE NAMES ================
My tracker has no exercise ids. Every history lookup, prefill, personal best and
muscle-group total keys on the exercise NAME, so "DB Row" and "Dumbbell Row" are
two different exercises with two separate histories. The spelling IS the
identity, so it matters more here than it looks.

1. If a movement you want is in my list below, use that name EXACTLY -
   CHARACTER FOR CHARACTER. Same words, same order, same capitalisation. Do not
   tidy it up, expand it, abbreviate it or pluralise it.
2. If a movement you want is NOT in my list, use it anyway and name it yourself.
   Never swap in a worse exercise just to match a name I already have. Write the
   standard full name a lifter would use - "Romanian Deadlift", not "RDL";
   "Dumbbell Shoulder Press", not "DB OHP" - and list every name you had to
   invent in a top-level "//newExercises" array, so I can see what is new:
     "//newExercises": ["Romanian Deadlift", "Pallof Press"]
3. Never put equipment, load, set counts or cues inside a name. "Bench Press",
   not "Bench Press (barbell) 3x8". That belongs in "notes".`;

  const mine = names.length
    ? `
Exercises I already use${total > names.length ? `, my ${names.length} most-used of ${total}` : ` (${names.length})`}, most-used first:
${nameLines(names)}`
    : `
Exercises I already use: NONE YET. This is my first routine, so there is nothing
of mine to match. Name every exercise by rule 2 above and list them all in
"//newExercises".`;

  const cat = urls.length
    ? `
OPTIONAL, only if your tool can browse the web: my app also ships a built-in
catalogue of ${CATALOG.length} exercises, already tagged with their muscle groups, as two
plain-text files - one exercise per line, name first, pipe-separated:
${urls.map((u) => `  ${u}`).join('\n')}
A name taken from that catalogue arrives pre-tagged in my app, so prefer one of
those over a name you invent. If you cannot fetch those files, do not guess at
their contents - just follow rules 1-3 above.`
    : '';

  return `${head}\n${mine}\n${cat}`.replace(/\n{3,}/g, '\n\n');
}

/**
 * The full prompt to hand an AI tool: the static schema prompt plus this
 * device's exercise names.
 *
 * AI_PROMPT itself stays static and exported, because it is the documented
 * schema and is asserted against directly by the test suite. This composes.
 */
export function aiPrompt() {
  const block = namesBlock();
  return AI_PROMPT.includes(RULES_MARK)
    ? AI_PROMPT.replace(RULES_MARK, () => `${block}\n\n${RULES_MARK}`)
    : `${AI_PROMPT}\n\n${block}`;
}

/* ------------------------------------------------------------------ */
/* screens                                                            */
/* ------------------------------------------------------------------ */

function chooserHtml() {
  return `
    <p class="hint" style="margin-top:0">A <b>routine</b> is the plan — which exercises, in what
      order, with what targets. You only make it once; starting it makes a <b>session</b>, and
      nothing you change during a session touches the routine unless you ask it to. So none of
      these three choices is permanent.</p>

    <div class="card">
      <div class="strong">Write it yourself</div>
      <p class="hint" style="margin:4px 0 8px">Pick this when you already know what you want to
        do. Add exercises one at a time and set targets as you go. Targets are optional — an
        exercise with no numbers still logs fine.</p>
      <button type="button" class="btn block" data-action="routine-new">+ Create an empty routine</button>
    </div>

    <div class="card">
      <div class="strong">Let an AI write one</div>
      <p class="hint" style="margin:4px 0 8px">Pick this when you want a plan and don't know where
        to start. You copy one long prompt, describe yourself in eight lines, and paste the JSON it
        gives back. The prompt carries the whole format${promptNames().length
    ? ' <b>and your exercise names</b>, so it reuses the history you already have' : ''}.</p>
      <button type="button" class="btn block primary" data-action="ai-routine">Show me how</button>
    </div>

    <div class="card">
      <div class="strong">Import JSON</div>
      <p class="hint" style="margin:4px 0 8px">Pick this when you already have a file — a routine
        exported from this app, or JSON an AI tool wrote earlier.</p>
      <button type="button" class="btn block ghost" data-action="import-open">Open import</button>
    </div>`;
}

function aiHtml() {
  const names = promptNames();
  const text = aiPrompt();
  const kb = Math.round(text.length / 102.4) / 10;
  return `
    <div class="tiny" style="margin-bottom:5px">Step 1 — copy the prompt</div>
    <button type="button" class="btn block primary" data-action="ai-prompt-copy">Copy the prompt</button>
    <p class="hint center" style="margin:6px 0 0">${text.split('\n').length} lines, ${kb} KB: the whole
      JSON format, three worked examples${names.length
    ? `, and the ${names.length} exercise name${names.length === 1 ? '' : 's'} you already use`
    : ', and a note that you have no exercises logged yet'}.</p>

    <div class="divider"></div>
    <div class="tiny" style="margin-bottom:5px">Step 2 — paste it into any AI chat tool</div>
    <p class="hint" style="margin:0">Then fill in the <b>WHAT I WANT</b> block at the top. It asks
      for your goal, session length, days per week, experience and current numbers, equipment,
      units, and anything to work around. The more honest those eight lines are, the less of the
      answer you will have to fix.</p>

    <div class="divider"></div>
    <div class="tiny" style="margin-bottom:5px">Step 3 — paste the JSON back here</div>
    <button type="button" class="btn block" data-action="import-open">Open import</button>
    <p class="hint" style="margin:6px 0 0">Paste the whole thing into the text box. If it came back
      wrapped in <code>\`\`\`</code> fences, that is fine — import strips them.</p>

    <div class="divider"></div>
    <div class="tiny" style="margin-bottom:5px">Step 4 — about the exercise names</div>
    <p class="hint" style="margin:0">${names.length
    ? `Your ${names.length} name${names.length === 1 ? '' : 's'} travel inside the prompt, because this
      app keys your history on the exercise name and your library only exists on this phone — there
      is no link to give an AI. The prompt tells it to copy your spelling exactly.`
    : `You have no exercises yet, so there is nothing to match — the prompt asks for standard
      full names instead.`}
      Where nothing of yours fits, it is told to name the exercise itself and list what it invented.
      Those names show up in <b>Library</b> under <i>Not in the library yet</i>, where <b>Fix</b>
      maps one to the built-in catalogue in a tap, or <b>Merge…</b> folds it into a name you
      already use.</p>

    <details style="margin-top:10px">
      <summary>Show the exercise-name part that gets added</summary>
      <pre class="code">${esc(namesBlock())}</pre>
    </details>`;
}

export const newRoutineActions = {
  'routine-how': () => {
    openModal({ title: 'Three ways to get a routine', bodyHtml: chooserHtml(), cancelText: 'Close', wide: true });
  },

  'ai-routine': () => {
    openModal({ title: 'Have an AI write your routine', bodyHtml: aiHtml(), cancelText: 'Close', wide: true });
  },

  'ai-prompt-copy': async () => {
    const text = aiPrompt();
    const n = promptNames().length;
    const what = n ? `, including ${n} of your exercise names` : '';
    if (await copyText(text)) toast(`Prompt copied — ${text.split('\n').length} lines${what}`, 4200);
    else toast('Copy was blocked — open the block at the bottom and select it by hand', 5000);
  },
};
