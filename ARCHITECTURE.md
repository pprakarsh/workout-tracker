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
js/trends.js        progress analysis: e1RM, per-session series, PRs, weekly totals
js/chart.js         charts as SVG strings: scatter+line and bars. No dependency
js/db.js            thin promise wrapper over IndexedDB
js/sync.js          Gist sync: push/pull, conflict guards, device pairing
js/timer.js         rest timer bar: ticking, beep, audio unlock
js/ui.js            modal / toast / confirm / clipboard primitives
js/util.js          formatting + parsing helpers, APP_VERSION
js/format.js        entry -> summary strings (targetLine, logSummary, restLine, pace)
js/exportimport.js  JSON backup, CSV, Markdown, import/normalisation entry point
js/views/entry.js   the exercise card and set rows, the exercise form, the library picker
js/views/cardio.js  the cardio card: a straight run, or an interval block and its rounds
js/views/plan.js    "Plan" tab: ten day rows, assign a routine, mark done
js/views/trends.js  "Trends" tab: weekly totals, and progress for one exercise
js/views/settings.js "Settings" screen, reached from the header gear -- not a tab
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
  timer,            // { startedAt, target, sessionId, entryId, setId, label, beeped }
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
8. **Units only in placeholders.** A placeholder vanishes the moment a value is typed, so a unit
   shown only there cannot be checked while reading your own numbers back. Units belong in the
   column header or the field label; placeholders carry the *format*. Both are tested.
9. **Re-parsing your own stored values.** See normalisation above: a value that was parsed on the
   way in must not be parsed again on the way back through. It cost a 60× inflation of every cardio
   target, twice — once for `duration`, once for `pace`.
10. **Modal submit didn't repaint.** A modal that changes the tab or data must repaint the view
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
