// "Routines" — your library of routines, the routine editor, and data/settings.
import {
  state, getRoutine, saveRoutine, createRoutine, deleteRoutine, duplicateRoutine,
  normalizeEntry, lastSessionForRoutine, updateSettings, dataFingerprint,
} from '../store.js';import { dbPut } from '../db.js';
import { esc, fmtDate, fmtClock, fmtTimeOfDay, relDay, parseDur, APP_VERSION } from '../util.js';
import {
  exerciseFormHtml, readExerciseForm, wireExerciseForm, openExercisePicker,
} from './entry.js';
import { targetLine } from '../format.js';
import { openModal, confirmDialog, toast, copyText } from '../ui.js';
import { exportBackup, exportCsv, exportRoutine, importFromText } from '../exportimport.js';
import {
  sync, syncConfigured, configureSync, disconnectSync, pushNow, pullNow,
  pairingCode, parsePairing,
} from '../sync.js';

/* ------------------------------------------------------------------ */
/* editor                                                             */
/* ------------------------------------------------------------------ */

function editor(r) {
  const rows = r.entries.map((e, i) => `
    <div class="sess-item">
      <div class="ord">${i + 1}</div>
      <div class="body">
        <div class="nm">${esc(e.name)} ${e.group ? `<span class="pill grp">${esc(e.group)}</span>` : ''}
          ${e.type === 'cardio' ? '<span class="pill">cardio</span>' : ''}</div>
        ${targetLine(e) ? `<div class="sub">${esc(targetLine(e))}</div>` : ''}
        ${e.notes ? `<div class="sub" style="color:var(--warn);white-space:pre-wrap">${esc(e.notes)}</div>` : ''}
      </div>
      <div class="acts">
        <button type="button" class="btn icon ghost" data-action="rentry-up"   data-id="${r.id}" data-entry="${e.id}">↑</button>
        <button type="button" class="btn icon ghost" data-action="rentry-down" data-id="${r.id}" data-entry="${e.id}">↓</button>
        <button type="button" class="btn icon ghost" data-action="rentry-edit" data-id="${r.id}" data-entry="${e.id}">✎</button>
        <button type="button" class="btn icon ghost" data-action="rentry-del"  data-id="${r.id}" data-entry="${e.id}">✕</button>
      </div>
    </div>`).join('');

  return `
    <button type="button" class="btn sm ghost" data-action="routines-back">← All routines</button>
    <div class="card" style="margin-top:12px" data-routine="${r.id}">
      <label class="field"><span>Routine name</span>
        <input data-rf="name" value="${esc(r.name)}" autocapitalize="words"></label>
      <label class="field" style="margin-bottom:0"><span>Description</span>
        <textarea data-rf="description" placeholder="e.g. Heavy squat day paired with pressing. 75 min.">${esc(r.description)}</textarea></label>
    </div>

    <h2>Exercises (${r.entries.length})</h2>
    ${rows || '<div class="empty">No exercises yet.</div>'}
    <button type="button" class="btn block primary" style="margin-top:4px" data-action="rentry-add" data-id="${r.id}">+ Add exercise</button>

    <h2>This routine</h2>
    <div class="btn-row">
      <button type="button" class="btn ok" data-action="routine-start" data-id="${r.id}">Start workout</button>
      <button type="button" class="btn" data-action="routine-export" data-id="${r.id}">Export JSON</button>
    </div>
    <div class="btn-row" style="margin-top:8px">
      <button type="button" class="btn ghost" data-action="routine-dupe" data-id="${r.id}">Duplicate</button>
      <button type="button" class="btn danger" data-action="routine-del" data-id="${r.id}">Delete routine</button>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* gist sync card                                                     */
/* ------------------------------------------------------------------ */

const whenShort = (ts) => (ts ? `${relDay(ts)}, ${fmtTimeOfDay(ts)}` : 'never');

function syncCard() {
  if (!syncConfigured()) {
    return `
      <div class="card">
        <p class="hint" style="margin-top:0">Keep a copy of everything in a private (secret) gist on
          your GitHub account. Each push is a gist revision, so you get free version history, and
          a second device can pull the same copy.</p>
        <button type="button" class="btn block primary" data-action="sync-setup">Set up Gist sync</button>
      </div>`;
  }
  return `
    <div class="card">
      <div class="kv"><span>Gist</span><span>${sync.gistId ? `${esc(sync.gistId.slice(0, 10))}…` : 'not created yet'}</span></div>
      <div class="kv"><span>Last pushed</span><span>${esc(whenShort(sync.lastPushedAt))}</span></div>
      <div class="kv"><span>Last pulled</span><span>${esc(whenShort(sync.lastPulledAt))}</span></div>
      <div class="kv"><span>Push when a workout is finished</span><span>${sync.autoPush ? 'on' : 'off'}</span></div>
      <div class="kv"><span>Pull when the app opens</span><span>${sync.autoPull ? 'on' : 'off'}</span></div>
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn primary" data-action="sync-push">Push ↑</button>
        <button type="button" class="btn" data-action="sync-pull">Pull ↓</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn sm ghost" data-action="sync-setup">Settings</button>
        ${sync.gistId ? '<button type="button" class="btn sm ghost" data-action="sync-open">Open on GitHub</button>' : ''}
        <button type="button" class="btn sm ghost" data-action="sync-copy-pairing" ${sync.gistId ? '' : 'disabled'}>Pair a device</button>
      </div>
      <p class="hint" style="margin-bottom:0">Pull <b>replaces</b> everything on this device with the
        gist's copy. Both directions check whether the other side moved on first.</p>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* list + data                                                        */
/* ------------------------------------------------------------------ */

export function render() {
  if (state.nav.routineId) {
    const r = getRoutine(state.nav.routineId);
    if (r) return editor(r);
    state.nav.routineId = null;
  }

  const fp = dataFingerprint();

  return `
    <h2>Routines</h2>
    ${state.routines.length ? state.routines.map((r) => {
    const last = lastSessionForRoutine(r.id);
    const names = r.entries.slice(0, 5).map((e) => e.name);
    return `
      <div class="card routine-card">
        <div class="rc-top">
          <div style="flex:1;min-width:0" data-action="routine-open" data-id="${r.id}" role="button" tabindex="0">
            <div class="rc-name">${esc(r.name)}</div>
            ${r.description ? `<div class="rc-desc">${esc(r.description)}</div>` : ''}
            <div class="rc-meta">${r.entries.length} exercise${r.entries.length === 1 ? '' : 's'}${last ? ` · last done ${esc(relDay(last.startedAt))}` : ' · never done'}</div>
            ${names.length ? `<div class="swatch">${names.map((n) => `<span class="pill">${esc(n)}</span>`).join('')}${r.entries.length > 5 ? `<span class="pill">+${r.entries.length - 5}</span>` : ''}</div>` : ''}
          </div>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button type="button" class="btn sm ok" data-action="routine-start" data-id="${r.id}">Start</button>
          <button type="button" class="btn sm ghost" data-action="routine-open" data-id="${r.id}">Edit</button>
        </div>
      </div>`;
  }).join('')
    : '<div class="empty">No routines yet — create one, or import from JSON.</div>'}

    <div class="btn-row" style="margin-top:4px">
      <button type="button" class="btn primary" data-action="routine-new">+ New routine</button>
      <button type="button" class="btn" data-action="import-open">Import</button>
    </div>

    <h2>Backup &amp; transfer</h2>
    <div class="card">
      <div class="kv"><span>Routines</span><span>${fp.routines}</span></div>
      <div class="kv"><span>Sessions</span><span>${fp.sessions}</span></div>
      <div class="kv"><span>Logged sets</span><span>${fp.loggedSets}</span></div>
      ${fp.oldest ? `<div class="kv"><span>Date range</span><span>${esc(fmtDate(fp.oldest))} → ${esc(fmtDate(fp.newest))}</span></div>` : ''}
      <p class="hint" style="margin-bottom:0">Compare these four numbers on the other device after a restore —
        if they match, the transfer was complete.</p>
    </div>
    <div class="btn-row">
      <button type="button" class="btn" data-action="export-backup">Export full backup (JSON)</button>
      <button type="button" class="btn" data-action="export-csv">Export sets (CSV)</button>
    </div>
    <button type="button" class="btn block ghost" style="margin-top:8px" data-action="import-open">Import / restore from backup</button>

    <h2>Sync to a secret GitHub Gist</h2>
    ${syncCard()}

    <h2>Settings</h2>
    <div class="card">
      <div class="kv"><span>Weight unit</span><span>${esc(state.settings.unit)}</span></div>
      <div class="kv"><span>Distance unit</span><span>${esc(state.settings.distanceUnit)}</span></div>
      <div class="kv"><span>Default rest</span><span>${esc(fmtClock(state.settings.defaultRest))}</span></div>
      <div class="kv"><span>Beep at rest target</span><span>${state.settings.beep ? 'on' : 'off'}</span></div>
      <button type="button" class="btn block ghost" style="margin-top:10px" data-action="settings-open">Change settings</button>
    </div>

    <h2>Generate a routine with an AI tool</h2>
    <div class="card">
      <p class="hint" style="margin-top:0">Copy the prompt below, paste it into any AI chat tool,
        fill in the <b>WHAT I WANT</b> block at the top, and paste the JSON it returns into
        <b>Import</b>. The prompt carries the whole schema — every field, both set-target shapes,
        how <code>group</code> works, how to express intervals — plus two worked examples, so the
        tool has everything it needs without you explaining the format.</p>
      <button type="button" class="btn block primary" data-action="sample-copy" data-which="prompt">
        Copy the full prompt</button>
      <p class="hint center" style="margin:6px 0 0">Copies all ${AI_PROMPT.split('\n').length} lines:
        the instructions, the complete schema, and both JSON examples.</p>
      <details style="margin-top:10px">
        <summary>Show exactly what gets copied</summary>
        <pre class="code">${esc(AI_PROMPT)}</pre>
      </details>
    </div>

    <h2>Import format</h2>
    <div class="card">
      <p class="hint" style="margin-top:0">Paste or load JSON shaped like this. Only
        <code>name</code> is required on each exercise, and keys starting with <code>//</code> are
        notes that are ignored on import.</p>
      <div class="tiny" style="margin-bottom:5px">Lifting day</div>
      <pre class="code">${esc(SAMPLE)}</pre>
      <button type="button" class="btn sm ghost" data-action="sample-copy" data-which="lift">Copy this sample</button>

      <div class="divider"></div>
      <div class="tiny" style="margin-bottom:5px">Running / mixed day</div>
      <pre class="code">${esc(SAMPLE_RUN)}</pre>
      <button type="button" class="btn sm ghost" data-action="sample-copy" data-which="run">Copy this sample</button>

      <div class="divider"></div>
      <div class="tiny">What <code>group</code> does</div>
      <p class="hint" style="margin-top:4px">It marks a <b>superset or circuit</b>. Give two or more
        <b>consecutive</b> exercises the same short label and the app treats them as one block:
        they appear together on the Now screen, and <b>Next</b> jumps past the whole block instead of
        stepping through them one at a time. The letter also shows as a badge in the Session and
        routine lists, and in exports.</p>
      <p class="hint">Each exercise still keeps its <b>own</b> rest target — grouping changes how they
        are presented and navigated, not how rest is timed. Use any short label
        (<code>A</code>, <code>B</code>, <code>I</code>); the value itself has no meaning beyond
        matching its neighbours. Non-adjacent exercises sharing a label form separate blocks, so keep
        the members of a superset next to each other.</p>

      <div class="divider"></div>
      <div class="tiny">Targets vs. what you log</div>
      <p class="hint" style="margin-top:4px">A routine holds <b>targets</b> only. For cardio you can
        target <code>distance</code>, <code>duration</code> and <code>rest</code>; pace, average and
        max heart rate, elevation and perceived effort have no target fields — you record them while
        logging. Put a pace or heart-rate instruction in <code>notes</code> if you want it on screen
        during the run.</p>
    </div>
    <p class="hint center" style="margin-top:18px">All data is stored on this device only.<br>
      <span class="dim">build ${esc(APP_VERSION)}</span></p>`;
}

export const SAMPLE = `{
  "//": "group = superset. Same letter on CONSECUTIVE exercises makes them one block:",
  "//2": "they share the Now screen and Next skips past both. Omit it for a normal exercise.",
  "name": "Squat day with Push Movements",
  "description": "Heavy squats, then pressing. ~75 min.",
  "entries": [
    { "name": "Back Squat", "sets": 5, "reps": "5", "weight": 100, "rest": "3:00" },
    { "name": "Bench Press", "sets": 4, "reps": "6-8", "weight": 70, "rest": "2:30",
      "group": "A", "notes": "pause on chest" },
    { "name": "Chest-Supported Row", "sets": 4, "reps": "10-12", "rest": "2:30", "group": "A" },
    { "type": "cardio", "name": "Treadmill Run", "distance": 3,
      "distanceUnit": "km", "duration": "18:00" },
    { "name": "Overhead Press", "rest": "2:00",
      "sets": [
        { "weight": 40, "reps": 10 },
        { "weight": 45, "reps": 8 },
        { "weight": 50, "reps": "5-6" }
      ],
      "notes": [
        "Warmup: 2x8 @ 20kg, 1x5 @ 30kg",
        "Tempo 2-0-1, no leg drive",
        "Stop the set if the bar path drifts forward"
      ] }
  ]
}`;

export const SAMPLE_RUN = `{
  "//": "Running / mixed day. Shows every field the app understands.",
  "//2": "Each cardio entry logs ONE effort, so for intervals add one entry per",
  "//3": "rep and give them the same group label to keep them as one block.",
  "name": "Run with Upper Body",
  "description": "Zone 2 base, 2 x 400m, then pressing and pulling. ~60 min.",
  "entries": [
    { "type": "cardio", "name": "Warmup Jog",
      "distance": 1.2, "distanceUnit": "km", "duration": "8:00", "rest": "1:30",
      "notes": "Easy, nose breathing only" },

    { "type": "cardio", "name": "400m Repeat", "group": "I",
      "distance": 0.4, "distanceUnit": "km", "duration": "1:35", "rest": "2:30",
      "notes": ["Target 1:35", "Walk the rest, do not sit down"] },
    { "type": "cardio", "name": "400m Repeat", "group": "I",
      "distance": 0.4, "distanceUnit": "km", "duration": "1:35", "rest": "2:30" },

    { "type": "cardio", "name": "Cooldown Jog",
      "distance": 1.5, "distanceUnit": "km", "duration": "11:00" },

    { "name": "Incline Bench Press", "group": "B", "rest": "2:30",
      "sets": [
        { "weight": 50, "reps": 8 },
        { "weight": 55, "reps": 6 },
        { "weight": 55, "reps": "5-6" }
      ],
      "notes": ["Warmup: 1x10 @ 30kg", "Tempo 2-1-1"] },
    { "name": "Chin-up", "group": "B", "sets": ["x8", "x7", "x6"], "rest": "2:30",
      "notes": "Add weight when all three sets hit 8" }
  ]
}`;

/**
 * A ready-to-paste prompt for an AI tool. Built from the same sample constants
 * the app documents, so the prompt and the importer cannot drift apart.
 */
export const AI_PROMPT = `I use a local-first workout tracker app that imports routines as JSON.
Write me a routine as ONE JSON object I can paste straight into its Routines -> Import box.

================ WHAT I WANT (fill these in) ================
Routine name:     <e.g. "Squat day with Push Movements" or "Run with Upper Body">
Goal:             <e.g. get stronger on squat/bench; also run a 10k in under 50 min>
Session length:   <e.g. 60-75 minutes>
Days per week:    <e.g. 4 - and which of those days this routine is>
Experience:       <e.g. 3 years lifting; squat 1RM 140 kg, bench 1RM 95 kg>
Equipment:        <e.g. full commercial gym, treadmill, no specialty bars>
Units:            <kg and km   OR   lb and mi>
Constraints:      <injuries, movements to avoid, anything to work around>

================ OUTPUT RULES ================
1. Output ONLY the JSON. No markdown code fences, no explanation before or after.
2. It must be strictly valid JSON: double quotes, no trailing commas, no JS comments.
3. Record any assumptions you had to make in the "description" field.
4. One JSON object = one training day. If I asked for several days, output a JSON
   ARRAY of such objects instead.
5. Order "entries" exactly as I should perform them, warmups and cooldowns included.
6. Put real target numbers in, based on what I told you. Leave no placeholders.

================ SCHEMA ================
Top level:
  "name"         string, REQUIRED. Short title for the day.
  "description"  string, optional. Purpose, expected duration, your assumptions.
  "entries"      array, REQUIRED. The exercises, in performance order.
  Any key starting with "//" is ignored by the importer, so you may use "//" keys
  for notes to me. Nothing outside this schema is read.

Every entry:
  "name"   string, REQUIRED. The exercise name as a lifter would say it.
  "type"   "lift" (the default - omit it) or "cardio".
  "rest"   rest target. Accepts "2:30" | "90s" | "2m" | "1:05:00". A bare number
           with no unit means SECONDS here, so prefer an explicit form.
  "group"  superset / circuit label. See GROUP below.
  "notes"  string, OR an array of strings for multiple lines. Use it for warmup
           sets, tempo prescriptions, cues, setup, pace or heart-rate instructions.

LIFTING entries ("type":"lift", or omit "type") - pick ONE of two shapes:

  A) The same target for every set:
       { "name": "Bench Press", "sets": 4, "reps": "6-8", "weight": 70, "rest": "2:30" }
     "sets"   = how many sets (a number)
     "reps"   = a number (5) or a range string ("6-8")
     "weight" = the load in my units

  B) A DIFFERENT target per set - use this for ascending loads, pyramids, waves:
       { "name": "Back Squat", "rest": "3:00",
         "sets": [ {"weight":60,"reps":10}, {"weight":70,"reps":8}, {"weight":80,"reps":"5-6"} ] }
     The number of sets comes from the length of the list.
     Shorthands meaning the same: ["60x10","70x8","80x5-6"]  or  "60x10, 70x8, 80x5-6"
     For bodyweight work omit the weight: {"reps":8} or "x8".
     Prefer shape B whenever the sets genuinely differ; prefer A when they do not.

CARDIO entries ("type":"cardio"):
  "distance"      number, expressed in "distanceUnit"
  "distanceUnit"  "km" or "mi"
  "duration"      target time: "18:00" | "1:05:00" | "20m" | "90s". A bare number
                  with no unit means MINUTES here.
  "rest"          rest after this effort - use it between intervals
  IMPORTANT: one cardio entry is ONE effort that I log once. For interval work, emit
  one entry PER REPETITION and give them all the same "group" label. Do not try to
  express intervals with "sets" - cardio entries have no sets.
  There are NO target fields for pace, heart rate, elevation or perceived effort; I
  record those while logging. Put pace or HR targets in "notes" instead.

GROUP - supersets and circuits:
  "group" is a short label (up to 4 characters) marking a superset or circuit.
  - Give CONSECUTIVE entries the same label to make them one block.
  - The app then shows that block's exercises together on one screen, and "Next"
    skips past the whole block instead of stepping through its members one by one.
  - Each exercise still keeps its OWN "rest" value. A group does NOT share one rest
    period, so set "rest" on every member.
  - The label is arbitrary: "A", "B", "I". Only matching your neighbour matters.
  - Entries with the same label that are NOT adjacent form SEPARATE blocks, so keep
    the members of a superset next to each other in the array.
  - Omit "group" entirely for a normal standalone exercise.

================ WORKED EXAMPLE 1: running + upper body ================
${SAMPLE_RUN}

================ WORKED EXAMPLE 2: lifting day, superset + per-set plan ================
${SAMPLE}

================ CHECKLIST BEFORE YOU ANSWER ================
- Valid JSON, no code fences, nothing but the JSON.
- Every entry has a "name".
- Lifting entries use shape A or shape B, never both.
- Cardio entries use distance/duration, never "sets".
- Interval reps are separate entries sharing one "group" label, and are adjacent.
- Every member of a group has its own "rest".
- All loads and distances are in the units I specified.
- Durations and rests use an explicit form such as "2:30", "90s" or "20m".
- Assumptions recorded in "description".`;

function mutateRoutineEntries(id, fn) {
  const r = getRoutine(id);
  if (!r) return null;
  fn(r);
  return saveRoutine(r);
}

export const routineActions = {
  'routines-back': () => { state.nav.routineId = null; },
  'routine-open': ({ id }) => { state.nav.routineId = id; state.tab = 'routines'; },

  'routine-new': () => {
    openModal({
      title: 'New routine',
      bodyHtml: `
        <label class="field"><span>Name</span>
          <input name="name" placeholder="e.g. Run with Upper Body" autocapitalize="words" required></label>
        <label class="field"><span>Description</span>
          <textarea name="description" placeholder="What this day is for, how long it takes, anything."></textarea></label>`,
      okText: 'Create',
      onSubmit: async (v) => {
        if (!v.name.trim()) { toast('Give it a name'); return false; }
        const r = await createRoutine({ name: v.name.trim(), description: (v.description || '').trim() });
        state.nav.routineId = r.id;
        state.tab = 'routines';
        return true;
      },
    });
  },

  'routine-dupe': async ({ id }) => {
    const r = await duplicateRoutine(id);
    if (r) { state.nav.routineId = r.id; toast('Duplicated'); }
  },

  'routine-del': async ({ id }) => {
    const r = getRoutine(id);
    if (!r) return;
    if (await confirmDialog(`Delete the routine "${r.name}"? Past sessions you did with it are kept.`)) {
      await deleteRoutine(id);
      state.nav.routineId = null;
      toast('Routine deleted');
    }
  },

  'routine-export': ({ id }) => {
    const r = getRoutine(id);
    if (r) exportRoutine(r);
  },

  'rentry-add': ({ id }) => {
    openExercisePicker(id, { title: 'Add exercise to this routine' });
  },

  'rentry-edit': ({ id, entry }) => {
    const r = getRoutine(id);
    const e = r?.entries.find((x) => x.id === entry);
    if (!e) return;
    const modal = openModal({
      title: 'Edit exercise',
      bodyHtml: exerciseFormHtml(e),
      onSubmit: async (v, m) => {
        const patch = readExerciseForm(v, m);
        if (!patch.name) { toast('Name is required'); return false; }
        await mutateRoutineEntries(id, (rr) => {
          const i = rr.entries.findIndex((x) => x.id === entry);
          rr.entries[i] = normalizeEntry({ ...rr.entries[i], ...patch });
        });
        return true;
      },
    });
    wireExerciseForm(modal);
  },

  'rentry-del': async ({ id, entry }) => {
    await mutateRoutineEntries(id, (r) => { r.entries = r.entries.filter((x) => x.id !== entry); });
  },

  'rentry-up': async ({ id, entry }) => {
    await mutateRoutineEntries(id, (r) => {
      const i = r.entries.findIndex((x) => x.id === entry);
      if (i > 0) [r.entries[i - 1], r.entries[i]] = [r.entries[i], r.entries[i - 1]];
    });
  },

  'rentry-down': async ({ id, entry }) => {
    await mutateRoutineEntries(id, (r) => {
      const i = r.entries.findIndex((x) => x.id === entry);
      if (i >= 0 && i < r.entries.length - 1) [r.entries[i + 1], r.entries[i]] = [r.entries[i], r.entries[i + 1]];
    });
  },

  'export-backup': () => { exportBackup(); toast('Backup exported'); },
  'export-csv': () => { exportCsv(); toast('CSV exported'); },

  /* ---------------- gist sync ---------------- */

  'sync-setup': () => {
    const code = pairingCode();
    openModal({
      title: 'Gist sync',
      bodyHtml: `
        <label class="field"><span>GitHub token, or a pairing code from another device</span>
          <input type="password" name="token" autocomplete="off" spellcheck="false"
                 placeholder="ghp_… or github_pat_… or a pairing code" value="${esc(sync.token || '')}"></label>
        <p class="hint" style="margin-top:-4px">Make one at github.com → Settings → Developer
          settings → <b>Personal access tokens (classic)</b> → Generate new token, and tick the
          single <b>gist</b> scope — nothing else. That scope is what the gists API documents as
          required, so it is the path that reliably works.<br><br>
          A <i>fine-grained</i> token with <b>Gists: Read and write</b> may also work, but GitHub's
          support for gists via fine-grained tokens has been inconsistent; if Push returns 403, use
          a classic token instead.<br><br>
          The token is stored on this device only and is never included in an exported backup.</p>
        <label class="field"><span>Gist id (blank = create a new one on first push)</span>
          <input name="gistId" autocomplete="off" spellcheck="false" placeholder="created on first push"
                 value="${esc(sync.gistId || '')}"></label>
        <div class="grid2">
          <label class="field"><span>Push after finishing a workout</span>
            <select name="autoPush">
              <option value="0" ${sync.autoPush ? '' : 'selected'}>Off</option>
              <option value="1" ${sync.autoPush ? 'selected' : ''}>On</option>
            </select></label>
          <label class="field"><span>Pull when the app opens</span>
            <select name="autoPull">
              <option value="1" ${sync.autoPull ? 'selected' : ''}>On</option>
              <option value="0" ${sync.autoPull ? '' : 'selected'}>Off</option>
            </select></label>
        </div>
        <p class="hint" style="margin-top:-4px">Opening the app pulls a newer copy only when nothing
          here would be lost. If this device has unpushed work, it leaves it alone and says so.</p>
        ${code ? `<div class="divider"></div>
          <div class="tiny">Set up another device</div>
          <p class="hint" style="margin-top:4px">Copy this one string and paste it into the token field
            on your phone — it carries the token and the gist id, and the app will pull straight away.
            Treat it like a password.</p>
          <button type="button" class="btn block" data-action="sync-copy-pairing">Copy pairing code</button>` : ''}
        ${syncConfigured() ? '<button type="button" class="btn block danger" style="margin-top:8px" data-action="sync-disconnect">Disconnect and forget the token</button>' : ''}`,
      okText: 'Save',
      onSubmit: async (v) => {
        const raw = String(v.token || '').trim();
        if (!raw) { toast('Paste a token or pairing code, or use Disconnect'); return false; }
        const paired = parsePairing(raw);
        await configureSync({
          token: paired ? paired.token : raw,
          gistId: paired && paired.gistId ? paired.gistId : v.gistId,
          autoPush: v.autoPush === '1',
          autoPull: v.autoPull === '1',
        });
        toast(paired ? 'Paired with the other device' : 'Gist sync configured');

        // If we now know a gist and this device has nothing, fetch it right away
        // so a fresh phone is populated without a second tap.
        if (sync.gistId) {
          const empty = state.sessions.length === 0 && state.routines.length === 0;
          if (empty) {
            try {
              const pulled = await pullNow();
              if (pulled.ok) {
                toast(`Pulled ${pulled.actual.sessions} sessions, ${pulled.actual.routines} routines`, 4000);
              }
            } catch (err) {
              toast(`Could not pull: ${err.message}`, 5000);
            }
          }
        }
        return true;
      },
    });
  },

  'sync-copy-pairing': async () => {
    const code = pairingCode();
    if (!code) { toast('Push once first so there is a gist to share'); return; }
    if (await copyText(code)) toast('Pairing code copied - treat it like a password', 4000);
    else toast('Copy was blocked; open Settings on this device to read the token', 5000);
  },

  'sync-disconnect': async () => {
    if (await confirmDialog('Forget the GitHub token and gist id on this device? The gist itself and your local data are untouched.', { okText: 'Disconnect' })) {
      await disconnectSync();
      toast('Disconnected');
    }
  },

  'sync-push': async ({ force }) => {
    toast('Pushing…', 1200);
    const res = await pushNow({ force: force === '1' });
    if (res.conflict) {
      const r = res.remote;
      openModal({
        title: 'The gist has newer data',
        bodyHtml: `
          <p class="muted" style="margin-top:0">The gist was last written
            ${esc(whenShort(r.remotePushedAtMs))}${r.remoteDevice && r.remoteDevice !== sync.deviceId ? ' by another device' : ''},
            which is after this device last synced.</p>
          ${r.counts ? `<div class="card" style="margin:0 0 10px">
            <div class="kv"><span>In the gist</span><span>${r.counts.sessions} sessions · ${r.counts.loggedSets} sets</span></div>
            <div class="kv"><span>On this device</span><span>${dataFingerprint().sessions} sessions · ${dataFingerprint().loggedSets} sets</span></div>
          </div>` : ''}
          <p class="hint">Pushing replaces the gist with this device's copy. Pull first if the gist has
            something you need — the previous content stays in the gist's revision history either way.</p>`,
        okText: 'Push anyway',
        danger: true,
        onSubmit: async () => {
          const forced = await pushNow({ force: true });
          toast(`Pushed ${forced.counts.sessions} sessions, ${forced.counts.loggedSets} sets`, 3200);
          return true;
        },
      });
      return;
    }
    toast(`Pushed ${res.counts.sessions} sessions, ${res.counts.loggedSets} sets`, 3200);
  },

  'sync-pull': async () => {
    toast('Pulling…', 1200);
    const res = await pullNow();
    if (res.conflict) {
      const list = res.localNewer.slice(0, 6)
        .map((x) => `<li>${esc(x.kind)}: ${esc(x.name)} — ${esc(whenShort(x.at))}</li>`).join('');
      openModal({
        title: 'This device has unpushed changes',
        bodyHtml: `
          <p class="muted" style="margin-top:0">${res.localNewer.length} record${res.localNewer.length === 1 ? '' : 's'}
            here ${res.localNewer.length === 1 ? 'is' : 'are'} newer than the gist's copy.
            Pulling replaces everything on this device and those changes are gone.</p>
          <ul class="plain small">${list}${res.localNewer.length > 6 ? `<li>…and ${res.localNewer.length - 6} more</li>` : ''}</ul>
          <p class="hint">Push instead if this device is the one that's ahead.</p>`,
        okText: 'Pull and overwrite',
        danger: true,
        onSubmit: async () => {
          const forced = await pullNow({ force: true });
          toast(`Pulled ${forced.actual.sessions} sessions, ${forced.actual.loggedSets} sets`, 3200);
          state.nav = {};
          return true;
        },
      });
      return;
    }
    toast(`Pulled ${res.actual.sessions} sessions, ${res.actual.loggedSets} sets`, 3200);
    state.nav = {};
  },

  'sync-open': () => {
    if (sync.gistId) window.open(`https://gist.github.com/${sync.gistId}`, '_blank', 'noopener');
  },

  'sample-copy': async ({ which }) => {
    const text = which === 'prompt' ? AI_PROMPT : which === 'run' ? SAMPLE_RUN : SAMPLE;
    const kb = Math.round(text.length / 102.4) / 10;
    const label = which === 'prompt'
      ? `Full prompt copied (${text.split('\n').length} lines, ${kb} KB) — paste it into your AI tool`
      : 'Sample copied';
    if (await copyText(text)) toast(label, 3800);
    else toast('Copy was blocked — open the block below and select the text by hand', 5000);
  },

  'settings-open': () => {
    const s = state.settings;
    openModal({
      title: 'Settings',
      bodyHtml: `
        <div class="grid2">
          <label class="field"><span>Weight unit</span>
            <select name="unit">
              <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option>
              <option value="lb" ${s.unit === 'lb' ? 'selected' : ''}>lb</option>
            </select></label>
          <label class="field"><span>Distance unit</span>
            <select name="distanceUnit">
              <option value="km" ${s.distanceUnit === 'km' ? 'selected' : ''}>km</option>
              <option value="mi" ${s.distanceUnit === 'mi' ? 'selected' : ''}>mi</option>
            </select></label>
        </div>
        <label class="field"><span>Default rest when a routine sets none - 2:00, 90s, or seconds</span>
          <input name="defaultRest" value="${esc(fmtClock(s.defaultRest))}" inputmode="text" placeholder="2:00"></label>
        <label class="field"><span>Beep when the rest target is reached</span>
          <select name="beep">
            <option value="1" ${s.beep ? 'selected' : ''}>On</option>
            <option value="0" ${!s.beep ? 'selected' : ''}>Off</option>
          </select></label>
        <p class="hint">The unit is stored on each set as you log it, so switching later
          never rewrites your history.</p>`,
      onSubmit: async (v) => {
        await updateSettings({
          unit: v.unit, distanceUnit: v.distanceUnit,
          defaultRest: parseDur(v.defaultRest) ?? 120,
          beep: v.beep === '1',
        });
        toast('Settings saved');
        return true;
      },
    });
  },

  'import-open': () => {
    const modal = openModal({
      title: 'Import / restore',
      bodyHtml: `
        <label class="field"><span>Pick a .json file</span>
          <input type="file" name="file" id="impFile" accept=".json,application/json" data-nofocus></label>
        <label class="field"><span>…or paste JSON</span>
          <textarea name="text" id="impText" placeholder='{ "name": "My routine", "entries": [ … ] }' style="min-height:140px"></textarea></label>
        <label class="field"><span>If this is a full backup</span>
          <select name="mode">
            <option value="merge">Merge — add what's missing, keep what's here</option>
            <option value="replace">Replace — wipe this device and restore exactly</option>
          </select></label>
        <p class="hint"><b>Replace</b> makes this device an exact copy of the backup: same routines,
          same sessions, same ids, including any workout that was still in progress.
          It deletes everything currently on this device first.</p>`,
      okText: 'Import',
      onSubmit: async (v) => {
        const text = (v.text || '').trim();
        if (!text) { toast('Choose a file or paste JSON'); return false; }
        if (v.mode === 'replace') {
          // confirmDialog takes over the modal root, so whatever happens next
          // this modal is already gone.
          const ok = await confirmDialog(
            'Replace ALL data on this device with the contents of this backup? Everything currently here is deleted.',
            { okText: 'Replace everything' },
          );
          if (!ok) { toast('Import cancelled'); return true; }
        }
        try {
          const res = await importFromText(text, { mode: v.mode });
          const parts = [];
          if (res.routines) parts.push(`${res.routines} routine${res.routines === 1 ? '' : 's'}`);
          if (res.sessions) parts.push(`${res.sessions} session${res.sessions === 1 ? '' : 's'}`);
          if (res.skipped) parts.push(`${res.skipped} already present`);
          toast(parts.length ? `Imported ${parts.join(', ')}` : 'Nothing new to import', 3200);
          if (res.expected && res.actual) {
            const match = res.expected.sessions === res.actual.sessions
              && res.expected.routines === res.actual.routines
              && res.expected.loggedSets === res.actual.loggedSets;
            setTimeout(() => toast(match
              ? `Verified: ${res.actual.routines} routines, ${res.actual.sessions} sessions, ${res.actual.loggedSets} sets`
              : `Warning: counts differ — expected ${res.expected.sessions} sessions / ${res.expected.loggedSets} sets, got ${res.actual.sessions} / ${res.actual.loggedSets}`, 5000), 3400);
          }
          state.nav = {};
          return true;
        } catch (err) {
          toast(err.message, 4800);
          return false;
        }
      },
    });

    // load a chosen file into the textarea
    const file = modal.querySelector('#impFile');
    const text = modal.querySelector('#impText');
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => { text.value = String(fr.result || ''); toast(`Loaded ${f.name}`); };
      fr.onerror = () => toast('Could not read that file');
      fr.readAsText(f);
    });
  },
};

/** Routine name/description edits (data-rf). Called from app.js. */
export async function handleRoutineField(target) {
  const f = target.dataset.rf;
  const box = target.closest('[data-routine]');
  if (!f || !box) return;
  const r = getRoutine(box.dataset.routine);
  if (!r) return;
  r[f] = target.value;
  r.updatedAt = Date.now();
  // persist without a re-render so the caret stays put
  await dbPut('routines', r);
}
