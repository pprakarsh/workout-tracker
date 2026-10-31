# Architecture

How this app is built and why. Read this before changing anything structural.
For the rules and checklists you must follow while editing, see [AGENTS.md](AGENTS.md).

## Shape of the thing

A single-page PWA. ~3,000 lines of plain ES modules, no framework, no build step, no runtime
dependencies. It is served as static files and stores everything in IndexedDB on the device.
Optional sync pushes one JSON blob to a secret GitHub Gist.

```
index.html          app shell: header, #viewRoot, #restBar, #tabBar, #modalRoot, #toast, datalist
css/styles.css      all styling; dark, mobile-first, safe-area aware
sw.js               service worker: network-first with a cache fallback
manifest.webmanifest

js/app.js           boot, render loop, delegated event routing, action registry
js/store.js         ALL state and persistence; session and routine mutations
js/model.js         entry/routine SHAPE: normalisation, defaults, plan -> session expansion
js/queries.js       read-only derived queries: exercise library, history lookups and
                    windows (week/month/range), recent values
js/cardio.js        run maths: pace arithmetic, the interval pattern, round expansion
js/measure.js       what a set is measured in: reps, time (holds) or distance (carries)
js/plan.js          the 10-day plan: day keys, the window, and what a day means
js/planstore.js     writes for the plan -- the mirror of queries.js
js/cardiostore.js   writes for a cardio log: the run's numbers and a block's rounds
js/backupstore.js   whole-database replace (restore, device copy) + the confirmation counts
js/clockstore.js    the workout clock: rest, holds, the drop-set prompt (ticking is in timer.js)
js/exercise.js      exercise library SHAPE: muscle-group vocabulary, normaliser, per-group totals
js/exercisestore.js exercise library writes: CRUD, seed-from-history, JSON import
js/catalog.js       the built-in catalogue: parse, classify, search (read-only, shipped)
js/catalogdata.js   the catalogue's gym half: strength, power, Olympic, plyo, isometric, carry, core
js/catalogconditioning.js the catalogue's conditioning half: running, cardio, mobility, prehab
js/trends.js        progress analysis: e1RM, per-session series, PRs, weekly totals
js/chart.js         charts as SVG strings: scatter+line and bars. No dependency
js/timefield.js     a duration as h/m/s boxes, so no colon is ever typed. Markup only
js/db.js            thin promise wrapper over IndexedDB
js/sync.js          Gist sync: push/pull, conflict guards, device pairing
js/timer.js         rest + hold timer bar: ticking, beep, audio unlock
js/ui.js            modal / toast / confirm / clipboard primitives
js/util.js          formatting + parsing helpers, APP_VERSION
js/format.js        entry -> summary strings (targetLine, logSummary, restLine, pace)
js/exportimport.js  JSON backup, CSV, Markdown, import/normalisation entry point
js/views/entry.js   one exercise being PERFORMED: the card, set rows, confirm and effort
js/views/exform.js  one exercise being DEFINED: the form, its per-set grid, the picker
js/views/cardio.js  the cardio card: a straight run, or an interval block and its rounds
js/views/plan.js    "Plan" tab: ten day rows, assign a routine, mark done
js/views/trends.js  "Trends" tab: weekly totals, and progress for one exercise
js/views/settings.js "Settings" screen, reached from the header gear -- not a tab
js/views/library.js "Library" tab: your exercises, and browsing the built-in catalogue
js/views/now.js     "Now" tab
js/views/session.js "Session" tab
js/views/history.js "History" tab (read-only detail + edit mode)
js/views/routines.js "Routines" tab: library, editor, data, settings, samples, AI prompt
test/               four dev-only Node suites (jsdom + fake-indexeddb)
deploy.sh           publish to GitHub Pages
```

Dependency direction is one-way and enforced by a test:

```
js/app.js  (composition root — may import anything)
   ↓
js/views/*  →  store, queries, format, cardio, ui, util, timer, sync
   ↓
store, sync, exportimport, format, queries  →  model, cardio, db, util
   ↓
model  →  cardio, measure, util     cardio  →  util     measure  →  util
plan  →  util     trends  →  measure, util     chart  →  util
queries, planstore  →  store (for `state`), and the pure modules above
```

**Nothing outside `js/views/` may import a view**, `js/app.js` excepted. `js/format.js` exists for
exactly this reason: the exporter needs the same wording as the screen, so the summary builders live
in a core module that both can import. `js/queries.js` was split out of `store.js` when the
1000-line cap fired: the seam is **mutations (store) versus read-only derived queries (queries)**.
`js/model.js` was split out for the same reason a release later: the seam there is **what is stored
and when (store) versus what the stored thing looks like (model)**. The shape helpers are
re-exported from `store.js`, so the store stays the single front door for callers. (This rule was
broken once — `exportimport.js` imported `views/entry.js` — which is why there is now a test for it.)

Views never talk to `db.js` directly except `routines.js`, which uses `dbPut` for one
caret-preserving write. `ui.js` imports `emit` from the store so closing a modal repaints the view
behind it.

## Rendering model

There is no virtual DOM and no reactivity. The loop is deliberately dumb:

1. Something calls a store mutator.
2. The mutator writes to IndexedDB, then calls `emit()`.
3. `emit()` runs subscribers; `app.js` subscribed `render()`.
4. `render()` asks the active view for an HTML string and assigns it to `#viewRoot.innerHTML`.

```
tap → delegated click handler → ACTIONS[name](dataset) → store mutator → persist → emit → render
```

Consequences you must respect:

- **Views are pure string builders.** `render()` in each view returns HTML. They hold no DOM
  references and no state of their own. All escaping goes through `esc()` from `util.js`.
- **A re-render destroys every input in the view.** So live field edits persist *without* emitting
  (`{ silent: true }`), and the blur-triggered re-render is deferred and skipped while focus is
  still inside a field. See `app.js`'s `blur` listener.
- **Scroll position** is preserved across re-renders of the same screen and reset when the screen
  changes, keyed on `tab|nav.sessionId|nav.routineId`.

### Event routing

Everything is delegated from `document` in `app.js`. There are no per-element listeners except
inside modals, where a view wires them directly after `openModal()` returns the element.

| Attribute | Handled by | Purpose |
|---|---|---|
| `data-action="name"` | `ACTIONS[name]({...dataset})` | every tap |
| `data-f` inside `[data-set]` | `handleFieldInput` | a set's weight/reps/RPE |
| `data-f` inside `[data-log]` | `handleFieldInput` | cardio log fields |
| `data-sf` | `handleSessionField` | session RPE/bodyweight/notes |
| `data-rf` inside `[data-routine]` | `handleRoutineField` | routine name/description |
| `data-tab` | tab bar | switches tab, clears `nav` and `editSessionId` |

`ACTIONS` is the merge of `entryActions`, `nowActions`, `sessionActions`, `historyActions`,
`routineActions` and `timerActions`. Action names are globally unique across those maps — a
collision silently shadows, so a test asserts there are none, and that every `data-action` in the
source has a handler and every handler is reachable.

## State

`store.js` owns one mutable `state` object. Nothing else may mutate it.

```js
state = {
  ready,            // false until init() finishes
  routines: [],     // sorted by name
  sessions: [],     // ALL sessions, newest first; includes the active one
  active,           // the in-progress session object, or null
  editSessionId,    // a FINISHED session opened for correction in History
  settings,         // { unit, distanceUnit, defaultRest, beep }
  timer,            // { kind:'rest'|'hold', startedAt, target, sessionId, entryId, setId, label, beeped }
  tab,              // 'now' | 'session' | 'history' | 'routines'
  nav,              // { sessionId?, routineId? } sub-navigation per tab
}
```

### `working()` — the single most important function

Every mutator that edits entries or sets resolves its target through `working()`:

```js
working() === state.editSessionId ? <that finished session> : state.active
```

This is why the live Session UI also serves as the History editor: the same `addSet`, `updateSet`,
`moveSessionEntry` etc. operate on whichever session is in play. **Never reintroduce a direct
`state.active` reference inside a mutator** — that was a real bug (session-level fields silently
ignored edits in History because one handler still checked `state.active`).

### Persistence

IndexedDB `workout-tracker`, version 1, three stores:

| Store | Key | Contents |
|---|---|---|
| `routines` | `id` | routine objects |
| `sessions` | `id` | session objects (index on `startedAt`) |
| `meta` | `key` | `settings`, `activeSessionId`, `timer`, `sync` |

The sync token lives under `meta.sync`, deliberately **not** in `settings`, so an exported backup
can never contain it. A test asserts that.

## Data model

A **routine** is a template. A **session** is one performance of it, created by snapshotting the
routine's entries. Editing a session never touches the routine.

```js
routine = { id, name, description, entries: [entry], createdAt, updatedAt }

entry = {
  id, type: 'lift'|'cardio', name, group,        // group = superset label
  measure: 'reps'|'time'|'distance',             // lift: what the per-set number means
  targetSets, setTargets,                        // setTargets = per-set plan or null
  repsMin, repsMax, weight,                      // uniform target; null when setTargets exists
  targetDistance, distanceUnit, targetDuration, targetPace,   // cardio, a straight run
  legs: [{label, duration, pace}]|null, rounds,  // cardio, an interval pattern
  rest, notes, unit,
}

session = {
  id, routineId, routineName, routineDescription,
  startedAt, finishedAt, updatedAt, unit,
  entries: [ { ...entry, sourceId, sets: [set]|null, log: cardioLog|null, skipped } ],
  currentIdx, rpe, bodyweight, notes, modified,
}

set       = { id, weight, unit, reps, rpe, rir, warmup, bodyweight,
              note, done, completedAt, rest }
            // bodyweight: the load is your body; `weight` then means ADDED load
cardioLog = { distance, distanceUnit, duration, pace,      // a straight run: any two fix the third
              legs: [loggedLeg]|null,                      // an interval block, expanded
              avgHr, maxHr, elevation, rpe, note, done, completedAt }
loggedLeg = { id, round, leg, label, duration, pace, done, edited }
```

Invariants worth knowing:

- A lift entry has either `setTargets` (a per-set plan) **or** the uniform `weight`/`repsMin`/
  `repsMax` trio — never both. `readExerciseForm` collapses identical grid rows back to the uniform
  form so summaries read `3 × 8-12 @ 15` rather than repeating a row.
- `unit` is stored **on each set** as it is logged, so switching units later never rewrites history.
- `sourceId` on a session entry points at the routine entry it came from, so "save order back to
  routine" can keep routine entry ids stable.
- `rest` on a set is the *actual* rest taken, recorded when you stop the timer. `null` means not
  timed, and is rendered as "no rest logged" — never back-filled from the target.
- **`warmup` sets are excluded from everything that counts**: `entryStatus` compares `targetSets`
  against working sets only, `sessionVolume` skips them, `plannedSet` is indexed by *working* set
  number so a warmup does not shift the plan, and `setLabels` numbers them `W1, W2` separately.
  Anything added later that aggregates sets (PRs, charts) must use `workingSets(e)`.
- **The plan's "done" is derived, not bookkept.** A planned day reads as done when a *finished*
  session for that routine exists on that local date, so finishing a workout ticks the plan with no
  second action. `doneAt` is a manual override for the one case history cannot know about — you
  trained without the app. `dayStatus` decides this, and also reports `swapped` when you logged a
  different routine that day rather than calling the day missed.
- The plan is a **blob in `meta`**, keyed by local ISO date, not its own object store: a few dozen
  records do not justify a database version bump, and it rides along in `backupObject` the way
  `settings` does. Local date, not UTC — "today" has to mean the day you are living in.
- **The Plan tab shows two windows, and a row means something different in each.** `planWindow` is
  today plus nine days, oldest first; `pastWindow` is the seven days behind, most recent first (the
  direction History reads). The past section renders *below* the plan so opening the tab still puts
  today at the top, and the renderer takes a `past` flag because the questions differ: a future row
  asks "what am I doing?" and offers *Plan a routine* and *Start*; a past row asks "did I do it?",
  cannot be planned, and shows what was actually logged — including an unplanned session, which
  `pastSummary` counts as a day trained, since a review that ignored it would misreport the week.
- **Progress is multi-dimensional, so no single number is "progress".** 100x5 to 105x3 raises the
  top set and lowers volume; 100x8 to 95x10 lowers the top set and raises both volume and estimated
  strength. Every series in `trends.js` therefore keeps the raw sets beside the summary, and the
  chart plots both: small dots for every working set, larger joined dots for the best of each
  session.
- **e1RM returns null rather than fiction.** Above 12 reps the formulas are materially less accurate
  and disagree with each other by 5-15%, so there is no estimate. A bodyweight set with no recorded
  session bodyweight has no estimate either — the app refuses to invent a bodyweight here exactly as
  `sessionVolume` does. And a single rep returns the weight itself: Epley would return 103.3 for a
  100 kg single, inventing a PR you did not lift. Sets of 10+ reps or logged at RPE <= 7 / RIR >= 3
  still compute but are drawn hollow, because the estimate means less there.
- **An interval block's metric is its WORK LEG's pace, not the average across the block.** Blending
  the recovery leg in means the trend "improves" when you simply walk your rest faster, which is the
  opposite of what the session is for. `cardioEffort` reports `workPace` (the fastest logged leg),
  `restPace` (the slowest) and the blended `pace` separately, and `metricPace` is the one to chart:
  the work leg for intervals, the overall pace for a straight run. A test pins that speeding up the
  recovery leg leaves `metricPace` untouched.
- **Intervals count as running on exactly the same footing as a straight run.** `cardioEffort` is
  the single place a cardio entry becomes numbers, so the weekly distance/time chart and the
  per-exercise totals both get a block's legs summed without either caller knowing the difference.
  Distances are reconciled through `toDistance` before being added, so a mile run and a kilometre
  run do not silently sum.
- **A trend needs three sessions.** Below that the view says how many more are needed instead of
  drawing a line through two points. The headline is a plain delta ("+9 kg over 6 sessions") — never
  a verdict, no regression line, no "stalled" warning, because four flat weeks during a deload is
  correct training and the app cannot tell the difference. This is the same decision as the
  rejection of auto-progression.
- **Weights convert on the way into a chart.** `unit` is stored per set, so a history spanning a
  kg/lb switch holds both; `toUnit` converts everything into the unit on display and the screen says
  how many sets were converted. A 2.2x step in the middle of a progress line is worse than a
  rounding difference.
- **Settings is a screen, not a tab.** Six tabs is already past what a phone tab bar holds, and
  settings is somewhere you visit rarely and leave. The gear in the header is one tap from anywhere,
  which beats a seventh tab you have to hunt for. `state.lastTab` remembers where to go back to.
  Its fields save on change (`data-cf`), with no Save button — a settings screen with one invites
  you to leave without pressing it.
- **Prefill mode changes where a new set's numbers come from, never how many there are.**
  `settings.prefillFrom` is `'last'` (what you actually did) or `'plan'` (the routine's targets).
  The SET COUNT always comes from the routine: taking it from last time too would ratchet a plan
  down for good, since cutting a 5x5 short once would make every later session open as a 3x5.
  `lastWorkingSets` is pure and takes sessions as an argument, so `model.js` never imports state.
- **History's filter is a lens, not data.** `state.histFilter` lives on `state` rather than in
  `state.nav`, because `app.js` clears `nav` on every tab change and a filter you lose by glancing
  at Now is worse than no filter. It is never persisted and never appears in a backup. The window
  maths is in `queries.js` (`historyWindow`, `sessionsIn`, `groupByMonth`); the week starts
  **Monday**, because a training week is counted Monday-to-Sunday and a Sunday start splits every
  weekend across two of them. Stepping forward is capped at the current week or month — there is no
  history ahead of today.
- **A backdated session is created FINISHED and handed to the History editor**, never made
  `state.active`. `createPastSession` exists because the alternative — starting a real session with
  an old `startedAt` — breaks three things at once: a workout already in progress would block it,
  a rest clock would start for a session that ended on Tuesday, and the Now header would report
  "3 days elapsed". The finished-session editor is already the right surface: the same set grid,
  minus the timing machinery you do not want when backfilling. Its sets prefill from the last
  session *before* that date (`lastWorkingSets(..., before)`) — filling Tuesday's rows from
  Thursday's numbers would be prefilling from the future. Future dates are refused outright, and a
  finish time before the start collapses to zero rather than going negative.
- **A session can be stranded unfinished** if the app closes mid-workout. `markSessionFinished`
  closes it from History, and sets `finishedAt` to the **last thing actually logged**, not now, so a
  workout abandoned on Tuesday does not claim to have ended on Friday. Until it is closed it reads
  "unfinished", is skipped by the plan's done check, and never reaches an export.
- `rpe` and `rir` are both stored and neither is derived from the other, even though
  RIR ≈ 10 − RPE. `settings.effortScale` decides which columns are shown, not which are stored.
- **A plank is a lift, not cardio.** `measure` on a lift entry says what the per-set number means:
  `reps` (the default), `time` (seconds — planks, hangs) or `distance` (metres — loaded carries).
  Everything built for lifts then applies unchanged: sets, warmups, RPE, rest, per-set targets,
  the pre-materialised plan. See `js/measure.js`.
- **The amount lives in `set.reps` and the target range in `repsMin`/`repsMax` whatever the
  measure.** Those names are historical. The alternative — parallel `seconds`/`distance` fields —
  meant branching every reader, exporter, stepper and target parser, plus a migration for data
  already on the phone. Nothing reinterprets an existing entry, because an entry with no `measure`
  is `reps`, exactly as before. Read through `fmtAmount`, write through `parseAmount`, and ask
  `setIsLoggableFor` rather than testing `reps` and `weight` yourself. A timed or carried set needs
  **no load** to be logged, and contributes nothing to `sessionVolume` — weight × seconds is not
  tonnage.
- A cardio entry is **one entry**, whether it is a straight run or a block of 6 intervals. It used
  to fan out into one entry per round, which meant opening six cards to record one treadmill block;
  the rounds now live in `log.legs` inside the single entry, so the block logs in one tap
  (`logAllRounds`) and a single round can still be corrected (`updateLeg`). Old routines written
  with `repeat: 6` still work — `intervalSpec` turns them into 6 rounds of one leg.
- A run is the triple `{distance, duration, pace}` of which **any two fix the third**, and
  `resolveRun` keeps them consistent. **Duration is the anchor**: editing pace or distance
  recomputes the other from the time, and editing the time holds the *pace* and moves the distance,
  because on a treadmill pace is the dial you hold while the time changes.
- A leg marked `edited` was changed by hand, which exempts it from a later edit of the pattern.
  "Round 4 was slower" has to survive "the plan was actually 1:15 throughout" (`reconcileLegs`).
- **A set will not log until effort is ANSWERED, and "don't know" is an answer.** `requireEffort`
  (default on) adds `effort` to the reasons `setBlocker` can give. `effortUnknown` exists because a
  null RPE is ambiguous — three months later it cannot tell you whether the set was easy or you
  forgot to fill it in — and an explicit unknown preserves that difference. The gate follows
  `settings.effortScale`, so someone logging RIR only is never asked for an RPE they do not use.
  The chips live on the card as well as in the rest panel: the rest panel only helps if you are
  resting, and a set logged without starting the clock had nothing but a 48px numeric column.
- **A bodyweight set's added load defaults to 0, not blank.** An empty box reads as "no
  information" when the answer is almost always zero, and showing 0 is what makes it obvious the
  field is there and editable. `toggleBodyweight` translates rather than carries: going to
  bodyweight the weight becomes 0 (keeping the 60 kg you were pressing would claim a 60 kg weighted
  pull-up), and coming back a 0 reverts to null, since 0 is not an external weight anyone lifts.
- **Pre-filling makes a filled row and a recorded row look identical, so finishing warns about the
  difference.** Every row opens pre-filled, which is what makes logging a confirmation rather than
  typing — but an unconfirmed row contributes to nothing: not History, not the exports, not Trends,
  not the plan's done check. A run is the easy one to lose, because a lifter learns to tick each set
  while a runner sees numbers already in the boxes. Two defences: the run's confirm is a full-width
  `.confirm` bar carrying the same weight as a lift's, and `unconfirmedWork(session)` feeds the
  finish prompt a list of what would be saved as nothing, with a one-tap fix. A partly logged
  interval block does not warn — something was recorded, so nothing is silently lost.
- **`cardioLogged(log)` is the only way to ask whether a cardio entry recorded anything.** The log
  opens pre-filled from its targets, so `log.distance !== null` stopped meaning "was run" — exactly
  the plan-vs-history trap the lift side already had. Three call sites had to be corrected when the
  pre-fill landed.

### Normalisation is the import boundary

`normalizeEntry` / `normalizeRoutine` accept loosely-shaped input (hand-written JSON, LLM output,
old backups) and return the canonical shape. Every import path goes through them. They also absorb
aliases (`exercises`, `title`, `restSeconds`, `targetWeight`, `setTargets`, `perSet`) and ignore
unknown keys, which is what makes `"//"` comment keys work.

Two traps live here:

- `sets` is **overloaded**: a number is a set count, an array or an `x`-containing string is a
  per-set plan. Logged sets carry `id`/`done`, and `normalizeEntry` explicitly refuses to read those
  as targets — without that check, saving a session back to its routine overwrote the plan with
  whatever you happened to lift.
- A unitless duration is ambiguous, so `parseDur` takes an explicit `{ bare: 'seconds'|'minutes' }`.
  `rest` reads a bare number as seconds, cardio `duration` as minutes, a **pace** as minutes per
  unit (`6` is 6:00/km) and an **interval leg time** as seconds (`90` is 1:30). Each rule is stated
  next to the field that uses it, both in the UI and in a test. Previously `90` meant 90 seconds in
  JSON but 90 *minutes* when typed.
- **Normalisation must be idempotent.** Entries are re-normalised on every session start and every
  save back to a routine. The `bare: 'minutes'` fields were being re-parsed each time, so a cardio
  target of `8:00` became 8 hours, then 20 days. The fix is to separate the field names: `duration`
  and `pace` are human input and get parsed, `targetDuration` and `targetPace` are our own stored
  seconds and pass through `storedSeconds` untouched. The same rule covers numbers inside a `legs`
  array, which is why hand-written routines should use the `pattern` string instead.

## Flows

### Starting and logging a workout

```
Routines/Now: tap Start
  → startSession(routineId)
      snapshot routine.entries → session.entries (fresh ids, sourceId kept)
      persist, meta.activeSessionId = id, tab = 'now'

Now: + Add set → addSet(entryId)
      prefill from setTargets[index], else the previous set, else the uniform target
Now: type in a row → handleFieldInput → updateSet(..., {silent:true})   // no re-render
Now: tap ⏱       → marks the set done, startRest({target: entry.rest ?? settings.defaultRest})
restBar: Stop     → stopRest() writes the elapsed seconds onto that set
Session: Finish   → finishSession() stamps finishedAt, clears active + timer, autoPushIfEnabled()
```

### Logging is confirming, not creating

`startSession()` runs `materializePlan()` on every lift entry, so the rows the plan calls for exist
before you log anything. That changes several things, and all of them are load-bearing:

- **`activeSet(e)`** is the first unticked row — what the confirm button acts on.
- **`setIsLoggable(set)`** gates it: a set needs reps and either a weight or `bodyweight`. When it
  fails, the UI asks for the number instead of logging a blank.
- **Summaries and exports must filter on `done`.** An unticked pre-materialised row is *plan*, not
  history; before this, `logSummary` and the CSV/Markdown exporters reported it as if it had
  happened. `dataFingerprint` counts ticked sets only for the same reason.
- **Warmups splice in before the working sets** rather than appending, or a warmup added to a
  pre-materialised exercise would sort after the sets it precedes.
- **`plannedSet` is indexed by working set**, so a warmup never shifts the planned loads.

### The rest clock is never gated

`startRestForSet(entryId, setId)` is deliberately independent of whether the set has a weight, reps
or a tick. Rest is time-critical; the numbers are not, and can be typed during the rest. An earlier
design refused to start the clock without a weight, which was backwards.

Consequences:

- `stopRest()` returns `{ elapsed, pending }`. It records the rest, and ticks the set **if it has
  become loggable**; otherwise `pending` names the set so the caller can say it is still unlogged.
- Starting rest for a different set calls `stopRest()` first, so the running measurement is banked
  rather than discarded. Re-tapping the same set returns `{ already: true }`.
- `restLine` includes a set with a recorded rest even when unticked, since that state is now
  reachable.

### The +/- stepper — the one deliberate exception to the render loop

Tapping a stepper button must not re-render, or the keyboard closes and the caret is lost. So the
strip in `app.js`:

1. reveals itself on `focusin` of a weight/reps field and remembers that element;
2. cancels `pointerdown` so the focused input keeps focus;
3. writes the new value straight into `input.value` and dispatches an `input` event, which runs the
   normal silent-save path — no `emit()`, no re-render.

The event is constructed from `input.ownerDocument.defaultView.Event` rather than the ambient
global, so it works whichever realm the element belongs to (and is therefore testable under jsdom).

### The rest timer

`state.timer` holds a **start timestamp**, never a countdown. Elapsed time is always
`Date.now() - startedAt`, so screen lock, app switching and reloads all show the truth. `timer.js`
repaints the clock on a 250 ms interval and re-syncs on `visibilitychange`. The target beep needs an
`AudioContext` unlocked inside a user gesture, which is why `app.js` calls `unlockAudio()` on every
tap. iOS cannot vibrate from a PWA and cannot fire a sound while fully backgrounded.

### Timing a hold on the same clock

A plank, a dead hang and an L-sit are timed *work*, not recovery, but the timing problem is
identical — so `state.timer` carries `kind: 'rest' | 'hold'` and one ticking mechanism serves both.
Building a second one would mean re-earning reload-, lock- and app-switch-survival, and two clocks
eventually disagree.

What `kind` changes:

| | `rest` | `hold` |
|---|---|---|
| direction | counts toward `target`, beeps at it | counts up; passing `target` is doing well, not an alarm |
| on stop | elapsed → `set.rest` | elapsed → `set.reps` (the measured seconds) |
| ticks the set | if it has numbers | only once effort is answered too |

- `startHold(entryId, setId)` refuses any exercise whose `measure` is not `time` — there would be no
  field to write seconds into. It banks a running clock first, exactly as `startRestForSet` does.
- `stopHold()` writes what the clock *saw*, overwriting the planned seconds. That is the whole point
  of timing it.
- `stopRest()` delegates to `stopHold()` when `kind === 'hold'`, so there is one stop path and a hold
  can never be mistakenly recorded as rest.
- Neither one auto-ticks. `stopHold` returns `{ elapsed, entryId, setId, loggable }`; `timer.js` ticks
  the set when `loggable`, and otherwise opens the effort prompt (`askHoldEffort`) so stopping a plank
  still runs through to a logged set in one gesture.

Manual entry is untouched: the seconds box is still on the row, and the clock is an offer that fills
it in for you. The card shows a full-width **⧗ Start set N** button, and every timed row keeps its own
`⧗` so a set you forgot to time can still be timed.

### Either / Or: one slot, several exercises

A routine entry can carry `alternatives: [name, …]` — "Leg Press OR Hack Squat OR Back Squat" — for
the ordinary case where the machine you planned on is taken.

This works because **identity in this app is the exercise name**, normalised through `normName`.
There is no exercise id: `lastWorkingSets`, `lastLogFor`, `recentWeights` and the PR queries all key
on the name, so changing `entry.name` re-points every history lookup at the new exercise for free.

`swapEntryExercise(entryId, name)` does the three things a bare rename would get wrong:

1. **`measure`.** `lastWorkingSets` matches on name **and** measure, so a stale measure silently
   finds no history at all. It comes from `knownDefinition()` — a pure lookup over routines then
   sessions, in model.js so the store can use it without importing the query layer.
2. **The prefilled numbers.** Those were materialised at session start from the *original*
   exercise's history. 60 kg of leg press is not 60 kg of hack squat, so the rows are rebuilt with
   `materializePlan` against the new exercise's own last session. The set **count** still comes from
   the routine — the plan decides how many, last time decides what goes in them.
3. **Work already logged.** A swap is refused (`{ blocked: 'logged' }`) once any set is ticked, and
   the swap row disappears from the card at the same moment. A logged set is a fact about work that
   happened under that name; silently relabelling it would be a lie.

`swappedFrom` records the slot's original name, and `saveSessionBackToRoutine` writes that name back
rather than the substitute, moving the one you actually used into the options. A busy machine today
is not a decision about next week.

Four allowlists have to name the field or it silently vanishes, because there is no migration
framework and each is an explicit object literal rather than a spread: `normalizeEntry` (model.js),
`definitionOf` (queries.js), `saveSessionBackToRoutine` (store.js) and `routineObject`
(exportimport.js). The same audit found `measure` missing from two of them — saving a session back
to its routine turned a 45-second plank into 45 reps.

### Drop sets: one set, several loads, no rest between

A drop set is one set taken to failure, then continued at a lighter load with **no rest**. That last
part is the whole design problem: the app's default reaction to confirming a set is to start a
two-minute countdown, which is the exact opposite of what a drop needs.

**Shape.** A drop stage is a set with `drop: true` — the same shape as the existing `warmup` flag,
in the same place, so `workingSets`, volume, prefill and the exports already handle it. It is not a
separate entity.

**Authoring.** Two ways in, both producing the same `setTargets`:

- the compact string, where `>` chains a drop onto the set before it:
  `"60x10, 60x10 > 45x8 > 35x6"` is **three** sets, the last of which has two drop stages
- the per-set grid in the exercise form, where each row has a `↓` toggle

`readExerciseForm` will not collapse a per-set plan into a uniform target when any row is a drop: a
uniform target has nowhere to record which row is the drop, so collapsing would throw it away.

**Labels.** A drop takes its parent's number with an arrow per stage — `1`, `2`, `2↓`, `2↓↓` —
because it is not a third set, it is the second set at a lighter load. `setLabels` owns this, and the
exercise form's grid calls the same function so the plan and the workout never disagree.

**The hand-off, which is the actual feature.** Three things fire at the moment it matters:

1. The confirm button for the set *before* a drop reads `set 2 — then DROP to 45 kg, no rest`
   **before** it is tapped, and is styled differently. You learn what is coming while you can still
   plan for it.
2. Confirming it calls `startDropNow` instead of `startRestForSet`. Same clock, `kind: 'drop'`: no
   target, no beep, counting **up**, with the bar saying `Drop now — no rest` and one action,
   `Strip to 45 kg — go`. A bar appears rather than nothing, because silence after a tap looks like
   a bug.
3. The count-up is the nudge: past fifteen seconds it says *a drop needs to be immediate* and turns
   red. A drop that starts forty seconds later is two sets.

`stopRest` special-cases `kind: 'drop'` to record **nothing**. The clock is attached to the set you
are about to do, and `set.rest` means the rest taken *after* a set, so writing those seconds
anywhere would state something false.

**The effort gate does not apply to a drop stage.** A drop is taken to failure by definition, so the
answer is already known, and stopping a lifter mid-drop to tap an RPE chip breaks the one property
the whole technique depends on. The parent set's effort covers the chain; the chips are still there
if you want them.

**Escape hatches.** `+ Drop set` adds a stage to the last working set in one tap, starting 20% below
it and rounded to `settings.weightStep` so it is a load you can actually make with the plates you
have — deciding to drop usually happens at the moment the bar stops moving, which is the worst time
to go looking for the exercise editor. `Skip the drop` on the bar deletes the stage and starts the
rest that was being skipped for it.

### The exercise library

`state.exercises` is one record per exercise **name**, keyed on `normName`, in its own IndexedDB
store (DB version 2 — every store is created behind a `contains()` guard, so an upgrade on an
existing device adds only what is missing and touches no data).

It exists because the derived `exerciseLibrary()` query in queries.js can only know what a routine or
a session happened to record. **Nothing in a logged set says a dumbbell row is unilateral or that it
trains your lats.** That is knowledge *about* an exercise, and it has nowhere to live unless it is
stored once, by name, and read by everything that shares the name — including sessions logged before
the record existed. The name-as-identity rule is what makes that retroactive and migration-free.

**The library owns what an exercise IS; the routine owns what it ASKS OF IT.** Measure, load source,
unilateral, muscle groups → library. Sets, reps, load, rest, order → routine. The same exercise is
3×8 in one routine and 5×5 in another, which is exactly why the split is worth having.

**"Isometric / bodyweight / external weight" is two questions, not one three-way choice.** `measure`
says what the number means (`reps` / `time` / `distance`); `bodyweight` says where the load comes
from. A bodyweight plank is *both* timed and unloaded, and a weighted plank is timed and loaded — no
single enum can express that pair, so they stay orthogonal and `kindLabel` renders them as the one
phrase a human would say. `parseMeasure` already accepted `isometric` as a spelling of `time`.

**The library wins, and the form writes to it.** `withLibraryDefaults` *overwrites* those five fields
on any entry being created, rather than filling blanks. It has to: `normalizeEntry` eagerly defaults
`unilateral` to `false` and `secondary` to `[]`, so "the routine did not say" and "the routine said
no" are the same value by then. That is only safe because the exercise form calls
`syncLibrary(patch)` on submit from all three places it is used, so editing an attribute in the
routine editor updates the library rather than creating a second, disagreeing copy. Entries already
inside a logged session keep their own snapshot — editing the library never reshapes a workout you
already did.

**Seeding never guesses.** `seedExerciseLibrary()` creates a record for every exercise already in a
routine or a session, carrying over what the old data knew (timed or not, bodyweight or not). Muscle
groups and unilateral are left **blank on purpose**: "Row" could be a barbell row or a rowing
machine, and a wrong tag is worse than no tag because it silently pollutes every trend built on it.

**Import has three modes**, because "import" means three different things: `add` (only new ones,
never touch what you have — the default), `update` (add, plus overwrite only the fields each incoming
record actually *mentions*, which is why `mentioned()` reads the raw keys before normalisation gives
everything a value), and `replace` (the file becomes the library). Routing is on the `schema` line,
not the shape: `exercises` is also the legacy key for a routine's entries, so a bare
`{ exercises: [...] }` keeps its old meaning.

The library travels in the backup object, so it syncs through the gist automatically. Four collection
sites had to learn about it: `init`, `restoreAll`, `backupObject` and `dataFingerprint`. Auditing
them turned up that `importFromText`'s replace path had never passed `plan` through, so a
replace-restore silently dropped the week you had planned.

### Unilateral exercises: left and right kept apart

A unilateral exercise logs **each planned set twice, once per side**, because a left arm and a right
arm are not interchangeable and averaging them hides the imbalance you train unilaterally to find.

`targetSets` keeps meaning **planned** sets — "3 sets" of a single-arm row is three per side, six
rows. That invariant is what stops the routine form, the exports and every existing routine from
needing to know this feature exists. The doubling lives in three small pure helpers (`rowsPerSet`,
`plannedRowCount`, `planIndexFor`) which the row-index consumers go through: `materializePlan`,
`plannedSet`, `fillPlannedSets`, `addSet` and `entryStatus`. Before this, `entryStatus` compared
ticked rows against `targetSets` directly and would have called a six-row exercise done after three.

- `set.side` is `'L' | 'R' | null`, a property of the **set** so a correction can un-side one row.
- `setLabels` gives `1L`, `1R`, `2L`, `2R` — the two sides share the set's number, because numbering
  them 1 and 2 would claim you did two sets. It tracks how many sides of the current set it has
  emitted: "the other side of this set" and "the first side of the next set" both look like *a side
  differing from the one before*, so the count is the only thing that distinguishes them.
- `settings.firstSide` decides which side gets the top row, and **prefill matches by side, not by
  position** — flip the setting and positional matching would fill your right arm from your left
  arm's numbers.
- Rest belongs after the **second** side. `nextSideAfter` is the same question `nextDropAfter` asks:
  confirming the first side must move you on, not start a two-minute countdown mid-set. It compares
  set *numbers* from `setLabels` rather than just "the next row has a different side", because set
  2's left row also differs from set 1's right.

### Per-muscle trends: direct and indirect, never blended

`groupTotals` reports **direct** sets (the exercise's volume group) and **indirect** sets (its "other
muscles") as two separate columns. The tempting move is to count a secondary muscle as half a set and
report one number per group, but that fraction is invented — nothing in the data supports 0.5 over
0.3 — and once blended the real counts cannot be recovered. They also answer different questions:
"am I training chest" and "is my chest getting worked anyway".

The muscle-group vocabulary is deliberately **flat**. Lats are part of your back, but a hierarchy
would mean deciding whether a pulldown's lat sets also count as back sets, and any answer to that is
an opinion dressed as data. `parseGroup` normalises synonyms (`pecs` → Chest) and **keeps an
unrecognised group as you spelled it**, so importing someone else's library never fails on a group
this app has not heard of.

An entry's own tags beat the library's, so a session keeps the meaning it had when logged. An empty
`secondary` counts as "not set" rather than "deliberately none", because `normalizeEntry` gives every
entry `secondary: []` and treating that as an answer would mean the library's list could never apply
to anything. An untagged exercise contributes **no row at all** — better than a wrong row.

### The built-in catalogue

**751 exercises** ship with the app, as one line each across two data files -- `js/catalogdata.js`
(the gym: strength, power, Olympic, plyometric, isometric, carry, core) and
`js/catalogconditioning.js` (running, other cardio, mobility, prehab). `js/catalog.js` parses and
searches both. Split that way so no file fights the 1000-line cap: data there, mechanism here. For
calibration, the well-known public datasets run 650-900 exercises and the paywalled ones claim
11,000+, which is mostly variations-of-variations; this sits in the same band as the good free ones
and the Library tab's **+ New exercise** covers whatever it does not know.
Nothing in it is state — it ships with the app, is never written to, and is never synced.

```
Name | category | equipment | measure[:flags] | primary | secondary,…
Single-arm Dumbbell Row|strength|dumbbell|reps:uni|Back|Lats,Biceps
Front Plank|isometric|bodyweight|time:bw|Core|Shoulders
Easy Run|running|none|cardio|Full Body|
```

**Every exercise carries three independent marks**, because they answer three different questions
and no single label can carry all of them:

| | what it says | values |
|---|---|---|
| `category` | what KIND of training this is | strength, power, olympic, plyo, isometric, carry, core, running, cardio, mobility, prehab |
| `measure` | what the number on a set means | reps, time, distance (or cardio → duration + pace) |
| `bodyweight` | where the load comes from | your own body, or an external one |

A plank is isometric + timed + bodyweight; a weighted plank is isometric + timed + externally
loaded; a push-up is strength + reps + bodyweight; a run is running + cardio + no load at all.
Cardio gets its own `loadKind` bucket rather than being forced to claim "external weight".

**Catalogue vs library.** The catalogue is what the *app* knows — shipped, read-only. The library is
what *you* have decided — yours, editable, synced, backed up. Adopting a catalogue exercise **copies**
it into your library; from then on it is yours to edit and the catalogue is only its origin.

**Provenance is asked, not stored.** A library record keeps no `source` flag; `catalogFor(name)`
answers "did the app ship this?" on demand. A stored flag would go stale the moment the catalogue
gained an exercise, and would need a migration to fix. `asLibraryRecord` deliberately drops
`builtIn`, `category` and `equipment` for the same reason — all three are re-derivable by name.

**That is what the UI styles.** An exercise the catalogue has never heard of gets a dashed accent
edge and a `yours` tag. The two are not the same kind of thing: a catalogue entry is a shared
definition you adopted, and one you invented is yours alone, unchecked, and the one that will look
wrong if you mistyped the name.

**Browse without typing.** The Library tab has two modes. *Mine* is your library; *Browse* is the
catalogue with a filter chip per kind and a count, so it can be explored by tapping rather than by
guessing a search term. Search covers name, muscle group and equipment, with word-prefix ranking so
"press" puts Bench Press above something that merely contains the letters.

**The routine picker searches both.** Adding an exercise offers your own exercises first (they carry
targets and history worth reusing) and catalogue matches second under their own heading. A catalogue
pick fills in measure, load, side and muscles and leaves **sets, reps and rest blank** — the
catalogue has no opinion on those, and a made-up 3×10 in your routine would be worse than a blank.

The live search repaints **only** the list container (`#libList`), not the view: a full re-render
replaces the input being typed into and takes the keyboard with it. The exercise picker already
worked this way; the Library tab now does too.

### One exercise, several target muscles

`primary` is a **list**, not a single group. A deadlift's prime movers really are hamstrings, glutes
and erectors; a bench press really is chest, triceps and front delts. Forcing one would mean picking
arbitrarily, and the arbitrary pick would then decide every per-muscle number downstream.

**A set counts once per group it is tagged with.** Three sets of a bench press tagged Chest +
Triceps is three direct chest sets *and* three direct triceps sets. That is how per-muscle volume is
counted, and it means the direct column sums to more than your total set count — correct, not a bug,
and the Trends copy says so.

`secondary` is still separate and still counted as indirect, so the distinction survives: *target*
muscles versus *also worked*.

**Every reader runs tags through `parseGroups` rather than reading the field.** An entry stored
before these became lists has `primary: 'Chest'` as a bare string sitting in IndexedDB. There is no
migration framework, so the readers tolerate both shapes — the same contract `normalizeEntry` keeps
for every other field.

### Filling in tags in bulk

The Library tab's **Fix N** queue exists because a library seeded from history has names but no
attributes, and tagging a few hundred exercises one modal at a time is not a thing anyone will do.
It splits them three ways, and the split *is* the design:

| | what it does |
|---|---|
| **Exact matches** | applied in one tap, all at once |
| **Best guesses** | up to three candidates, you pick |
| **Not recognised** | listed for you to fill in by hand |

`certainMatch(name)` is deliberately strict: the name has to reduce to **exactly** the same words as
a catalogue entry once shorthand and plurals are expanded, and exactly one entry may match. That
catches "RDL" → Romanian Deadlift, "Pull Ups" → Pull-up, "Hammer Curls" → Hammer Curl, "OHP" →
Overhead Press, and refuses "Leg Curl", because lying, seated and standing leg curls are different
exercises and picking one would be a coin toss.

`suggestFor(name)` ranks candidates by token overlap in **both** directions — how much of what you
typed the candidate covers, and how much the candidate adds that you never said. Without the second
half, "Row" scores perfectly against every row in the catalogue and the winner is whichever sorted
first.

**Nothing is treated as noise.** An earlier version of the matcher dropped equipment words, which
made "DB Row" an *exact* match for "Barbell Row" — the two words that distinguish them were the two
it threw away — and "Leg Curl" a confident match for a bicep curl, because it treated "leg" as
filler. A matcher that is confidently wrong is worse than one that admits it does not know: a wrong
tag pollutes every per-muscle number and nothing ever flags it. There are tests pinning both of
those specific wrong answers as wrong.

**Applying never renames.** Identity in this app is the name, so the attributes are copied onto your
record and your name stays. You keep calling it "DB Row"; it now knows it trains your back, and
every set ever logged under that name still belongs to it.

### Picking muscle groups

The target-muscle fields are a **native `<select>` that appends to a chip list**, not a text box and
not `<select multiple>`.

The constraint is that `primary` is a list, so one `<select>` cannot hold the answer — and
`<select multiple>` on a phone is a cramped scrolling box with no visible affordance for
multi-select. A free-text field with a `<datalist>` was what shipped first, and `datalist` support on
iOS Safari is a thin suggestion strip, which is barely a picker at all.

So: the dropdown **adds** whatever you choose, each chosen group becomes a chip that removes itself
when tapped, and the dropdown resets after each pick so the next one adds rather than replaces.
Twenty groups are arranged into `<optgroup>`s — Push, Pull, Core, Legs, Other — because that is the
order someone deciding what a movement trains is already thinking in, and because twenty flat
options on an iOS wheel is a long scroll. A `Something else…` option keeps custom groups reachable:
the vocabulary is a convenience, not a whitelist.

The real value lives in a **hidden input** carrying the comma-joined list, the same trick the
interval builder uses for its pattern. `readExerciseForm` stays a pure read of named fields and
knows nothing about the widget, and `openModal` picks it up because it reads every `[name]`.

Wiring is **imperative**, via `wireGroupPicker(modal)`, not `data-action`. An action dispatch
re-renders the whole view, which would destroy the modal mid-edit — the same reason the set grid and
the interval builder are wired by hand. It lives in `views/exform.js` (an exercise being *defined*)
and `views/library.js` imports it, keeping the existing one-way seam.

### Editing a finished session

```
History → open a session → Edit
  → setEditing(id)  → state.editSessionId = id
  → history.js renders the SAME editable cards as the live session, with allowRest: false
  → all mutators now resolve to that session via working()
  → Done / switching tab → setEditing(null)
```

### Sync (blob, last-write-wins, guarded)

```
push: build backupObject() + {sync:{device,pushedAtMs}} → PATCH/POST the gist
      refuses first if remote.pushedAtMs > sync.lastSeenRemoteMs (another device moved on)
pull: GET the gist → importFromText(mode:'replace') → restoreAll() wipes and rewrites verbatim
      refuses first if unsyncedLocalChanges() is non-empty
launch: autoPullOnLaunch() pulls when the device is empty, or behind with nothing local at risk
```

Four automatic triggers, all going through the guards above:

| Trigger | Where | Notes |
|---|---|---|
| after finishing a workout | `autoPushIfEnabled()` from `session.js` | immediate, with a toast |
| routine library changed | `watchRoutines()` subscribes to the store | debounced 4s |
| launch | `autoPullOnLaunch()` from `app.js` | after first render, never blocking boot |
| returning to the foreground | `autoPullOnForeground()` on `visibilitychange` | 5 min cooldown, skipped during a workout |

`watchRoutines()` subscribes to `emit()` and compares a cheap routine signature
(`length:maxUpdatedAt`) rather than calling a push from each of the ten routine mutation sites,
where one would eventually be forgotten. Session changes deliberately do not trigger it. The one
path it cannot see is `handleRoutineField`, which writes without emitting to preserve the caret, so
that function calls `scheduleRoutinePush()` itself.

`unsyncedLocalChanges()` compares record `updatedAt` against **this device's** last sync time, never
the timestamp inside the remote payload — a device with a wrong clock must not be able to make your
unpushed work look stale. The comparison is `>=` so a record saved in the same millisecond as the
marker counts as unsynced; erring that way costs a question, erring the other way loses a set.

## Known gotchas

Each of these was a real bug. They are cheap to reintroduce.

1. **`hidden` vs CSS `display`.** `#modalRoot` and `#restBar` are toggled with the `hidden`
   attribute, but an ID-specificity `display:flex` beats the UA `[hidden]{display:none}`. Both use
   `#id:not([hidden]){display:flex}`. Symptom: a permanent blurred overlay covering the app.
2. **Blur re-render steals focus.** Re-rendering on blur destroys the input the user is tabbing
   into. The handler defers and bails if `document.activeElement` is still a field.
3. **Service worker staleness.** Cache-first meant the outgoing worker served old JS for one more
   load, so a change "didn't happen" until the second reload. It is network-first now, and both
   `APP_VERSION` and the `sw.js` `CACHE` name must be bumped together (a test enforces it).
4. **Logged sets read as targets.** See normalisation above.
5. **Clock skew in sync.** See sync above.
6. **Non-ASCII in shell scripts.** macOS bash 3.2 folds the bytes of a non-ASCII character that
   follows a variable into the variable name: `"$BRANCH…"` aborted under `set -u`. `deploy.sh` is
   ASCII-only and a test enforces it.
7. **Undefined tie-breaks.** The exercise library picked a definition by iteration order
   (alphabetical by routine name) when two routines shared a timestamp. Sorts that can tie need an
   explicit second key.
8. **Asking for a character the keyboard cannot produce.** A duration reads as "28:30", so the
   fields asked for a colon while requesting `inputmode="numeric"` — which gives iOS a digits-only
   keypad with no colon on it. Durations are entered in separate h/m/s boxes now (`js/timefield.js`):
   a blank box counts as 0, all blank is null, and the total is echoed back as a clock while you
   type. The two dense grids that cannot hold more boxes — the set row and the interval leg rows —
   take plain seconds for a time and plain minutes for a pace instead, so neither needs a colon.
9. **Units only in placeholders.** A placeholder vanishes the moment a value is typed, so a unit
   shown only there cannot be checked while reading your own numbers back. Units belong in the
   column header or the field label; placeholders carry the *format*. Both are tested.
10. **Re-parsing your own stored values.** See normalisation above: a value that was parsed on the
   way in must not be parsed again on the way back through. It cost a 60× inflation of every cardio
   target, twice — once for `duration`, once for `pace`.
11. **Modal submit didn't repaint.** A modal that changes the tab or data must repaint the view
   behind it; `closeModal()` calls `emit()` for this.

## What the platform will not allow

Worth knowing before promising a feature:

- No background sound, notification or vibration from an iOS PWA — the rest beep only plays with the
  app open, and iOS Safari ignores `navigator.vibrate`.
- No Apple Watch, no Live Activity, no Dynamic Island.
- No reliable background GPS; a PWA cannot track a run with the screen off.
- Safari evicts script-writable storage after 7 days without interaction **unless** the app was
  added to the home screen. Installing is therefore not optional for real use.
- Gist files over 1 MB are not inlined by the API; the app falls back to the raw URL and says so
  clearly if that fails. At ~1 MB/year of training this is years away.
