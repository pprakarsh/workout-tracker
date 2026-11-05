# Working on this codebase

Entry point for anyone — human or AI — editing this app. This file is the **rules and recipes**.
[ARCHITECTURE.md](ARCHITECTURE.md) is **how it works and why**. [ROADMAP.md](ROADMAP.md) is **what is
built, what is next, and what was deliberately rejected** — check it before building something new,
because several obvious-sounding features are refused on purpose.

Plain ES modules, no framework, no build step, no runtime dependencies. Keep it that way: the whole
point is that it deploys as static files and will still run in five years.

## Orient yourself in five minutes

```bash
cd ~/workout-tracker
python3 -m http.server 8000 --bind 127.0.0.1   # http://localhost:8000
cd test && npm install && npm test             # four suites; must exit 0
wc -l ../js/*.js ../js/views/*.js | sort -rn | head   # where the weight is
grep -n APP_VERSION ../js/util.js              # the build number
```

`localhost` is a secure context, so the service worker works there. `file://` will **not** work —
ES modules are blocked by CORS.

Then read, in this order:

1. **ARCHITECTURE.md § Core invariants** — four facts that explain most of the design. If you only
   read one thing, read that.
2. **ARCHITECTURE.md § Shape of the thing** — the module map and the dependency direction.
3. **This file's Hard rules** below.

## Hard rules

1. **No dependencies, no build step, no framework.** No npm packages in the app (`test/` may have
   dev-only ones). No transpiling, no bundling, no JSX.
2. **Run `npm test` and judge it by the exit code.** See *Judging a test run* below — this has a
   history and it matters.
3. **Bump `APP_VERSION` in `js/util.js` and the `CACHE` name in `sw.js` together** on any change to
   a shipped file. A test fails if they disagree. The build number shows on the **Set up** tab,
   which is how you tell a stale cache from a real bug.
4. **Only the store modules mutate `state` or persist.** That is `js/store.js` plus its peers, each
   of which imports `state` from the store and is never imported *by* it:

   | module | owns | persists via |
   |---|---|---|
   | `js/store.js` | sessions, routines, entries, sets, settings; the `state` object itself | its own db calls |
   | `js/planstore.js` | the 10-day plan | `metaSet` |
   | `js/cardiostore.js` | a cardio log's numbers and rounds | `touch()` |
   | `js/clockstore.js` | the rest / hold / drop clock | `metaSet` + `touch()` |
   | `js/backupstore.js` | whole-database replace, and the confirmation counts | its own db calls |
   | `js/exercisestore.js` | the exercise library: CRUD, seeding, JSON import | its own db calls |
   | `js/exercisemerge.js` | merging two names into one, across routines and history | the store's save primitives |
   | `js/nudges.js` | `meta.dismissed` — which earned nudges this device has waved off | `metaSet` |

   Two documented exceptions: `js/sync.js` writes its own `meta.sync` record, and
   `js/views/routines.js` uses `dbPut` for one caret-preserving write. **If you add a peer store,
   add it to this table** — a test enforces that every direct IndexedDB writer is listed here,
   because this rule said "only store.js" long after that stopped being true.
5. **Views return HTML strings.** No DOM refs, no local state. Escape every interpolated value with
   `esc()`. Direct listeners live only inside modals, wired after `openModal()` returns.
6. **Mutators resolve their target with `working()`, never `state.active`.** Otherwise the History
   editor silently stops working.
7. **Field edits persist with `{ silent: true }`** so typing does not trigger a re-render.
8. **A template that emits `data-action` takes the literal name at the call site.** Never
   `data-action="${x ? 'a' : 'b'}"` and never `data-action="${action}"` from a helper. The action
   registry test reads markup as text and cannot see through an interpolation, so it reports the
   handler as dead. This has been caught three times.
9. **Shell scripts stay ASCII.** macOS bash 3.2 mangles non-ASCII bytes after a variable.
10. **Never widen what an export contains without checking for secrets.** The sync token lives in
    `meta.sync`, outside `settings`, precisely so backups cannot leak it.
11. **Do not add auto-progression.** A deliberate product decision: the app shows last session's
    numbers as a reference and nothing more.

## Judging a test run

`npm test` chains the four suites with `&&`, so **a zero exit is the only signal you may trust.**

Do not conclude a suite passed because its output contained `PASSED`, or did not contain `FAIL`. A
suite that dies before running anything — a syntax error, a bad import, a throw at module scope —
prints neither, and a grep-based check reads that silence as success. This exact mistake shipped
build 18 while `smoke.mjs` could not be parsed.

To run suites individually, branch on the status:

```bash
cd test && for f in style smoke sync dom; do
  node $f.mjs >/tmp/$f.log 2>&1 && echo "PASS $f" || { echo "FAIL $f"; grep FAIL /tmp/$f.log | head; }
done
```

### Never run tests in the same batch as a file write

If you are an agent that can issue parallel tool calls: **writes and the verification of those
writes go in separate, sequential calls.** Batching them has repeatedly produced phantom failures —
most often two `sync.mjs` assertions — that vanish on a sequential re-run, and once produced a
`style.mjs` version-mismatch failure because the suite read `js/util.js` after the bump and `sw.js`
before it. Parallel calls are fine when every call is read-only.

The same applies to editing: two edits to the *same file* in one batch clobber each other, and a
`read` batched with a write returns the pre-write content, which looks like the edit silently failed.

## Recipes

### Add a field to an exercise (the definition)

1. `js/model.js` → `normalizeEntry`: read it with aliases, default it so old data still loads.
2. `js/exercise.js` → `normalizeExercise` if the **library** should carry it, and
   `exerciseDefaults` if it should flow onto new entries.
3. `js/views/exform.js` → `exerciseFormHtml` (input), `readExerciseForm` (parse), and
   `syncLibrary` if the form should write it back to the library.
4. `js/format.js` → `targetLine` if it belongs in the summary line.
5. **Four field allowlists drop unknown keys.** Add it to any that should carry it:
   `normalizeEntry` (model.js), `definitionOf` (queries.js), `saveSessionBackToRoutine` (store.js),
   `routineObject` (exportimport.js). Forgetting one is the single most common bug in this
   codebase — it is how `measure` was silently lost twice.
6. `js/views/routines.js` → `SAMPLE*` and `AI_PROMPT` if users should know about it.
7. Tests: a round-trip assertion in `test/smoke.mjs`.

### Add a field to a set

`blankSet` (model.js) → the set row in `views/entry.js` → `setLabels` if it changes numbering →
`format.js` summaries → the CSV columns (**append only**) → ARCHITECTURE data model.

### Add a button

1. Render `data-action="my-thing"` plus any `data-*` parameters — **literal name**, see rule 8.
2. Add `'my-thing': async ({ myParam }) => { … }` to the relevant `*Actions` map.
3. `app.js` merges the maps and routes the tap. Names are globally unique; a test catches
   collisions, dead handlers and actions with no handler.

### Add a view or tab

1. A module exporting `render()` and an actions map.
2. Register in `VIEWS` and `TITLES` in `app.js`, and merge the actions map into `ACTIONS`.
3. A `.tab` button in `index.html` **only if it earns one** — see ARCHITECTURE § Navigation. Setup
   surfaces belong behind the **Set up** hub; a view can be routable without a button.
4. Add the file to `ASSETS` in `sw.js`, or it will not work offline.
5. Add it to `viewFiles` and the actions-map list in `test/style.mjs`, and to the module map in
   ARCHITECTURE.md. Tests fail on all three.

### Add a store mutator

```js
export async function doThing(id, patch, opts) {
  const s = working();            // never state.active
  if (!s) return;
  // ...mutate...
  await touch(opts);              // persists, then emits unless { silent: true }
}
```

### Change the data model

There is no migration framework. **Every reader tolerates both the old and the new shape.** Make
new fields optional and default them. When a field changes *kind* — as `primary` did, from a string
to a list — run it through its parser at every read site rather than trusting the stored value;
`groupTotals` does exactly that so a session written last month still counts.

Before changing a stored shape, check `restoreAll` (verbatim restore), `backupObject` (what ships to
the gist) and `csvRows` (column order is a published contract).

### Add an IndexedDB store

Bump `DB_VERSION` in `js/db.js` and add the `createObjectStore` behind a `contains()` guard, so an
upgrade on an existing device adds only what is missing and touches no data. Then: `init()` loads
it, `restoreAll` replaces it, `backupObject` ships it, `dataFingerprint` counts it. Missing one of
those four is how the exercise library nearly shipped without syncing.

## Tests

| Suite | What it covers |
|---|---|
| `test/style.mjs` | computed `display` of overlays, CSS sanity, the SW asset manifest, version sync, action-registry integrity, dependency direction, the module line cap, docs coverage, ASCII shell scripts |
| `test/smoke.mjs` | store, timer maths, per-set targets, measures, Either/Or, drop sets, unilateral, the exercise library, the catalogue, merging, import/export, device restore |
| `test/sync.mjs` | gist sync against a fake GitHub API: push/pull, both conflict directions, clock skew, truncation, bad tokens, offline |
| `test/dom.mjs` | the real UI under jsdom: clicks, typing, focus retention, modals, full workout flows, navigation |

They run on jsdom + fake-indexeddb, so no browser and no network. What they **cannot** check: visual
layout, touch ergonomics, real iOS Safari behaviour, and real GitHub API responses. Say so rather
than implying those are verified.

**Writing tests here:** assert the *behaviour a user would notice*, and make the failure message
name the actual value (`` `got ${x}` ``). Several real bugs were found by tests that checked a claim
made in a comment or in the docs — keep doing that.

**Two recurring test-authoring traps:**

- `test/style.mjs` rejects a top-level binding declared twice in a suite, including via
  destructuring, because a module-scope `SyntaxError` prints neither a pass nor a failure. Prefix
  new identifiers in long suites (`mz*`, `gp*`, `lc*`) to avoid collisions.
- `smoke.mjs` and `dom.mjs` accumulate state across sections. Scope an assertion to the fixture it
  is about — pass one session to `groupTotals`, not `state.sessions` — or an unrelated earlier
  section will break it.

## Shipping

```bash
cd test && npm test                    # must exit 0 — do not read the output instead
# bump APP_VERSION in js/util.js and CACHE in sw.js
git add -A && git commit -m "..."      # Conventional Commits
./deploy.sh                            # pushes main, enables Pages, prints the URL
```

`deploy.sh` refuses to publish if `gh` is authenticated as the wrong account or if the latest commit
carries a corporate email. **Do not batch the commit and the deploy** — `deploy.sh` pushes, so a
parallel call can push before the commit exists. Afterwards, verify against the live site rather
than assuming:

```bash
gh api repos/pprakarsh/workout-tracker/pages/builds/latest --jq '.commit[0:7] + " " + .status'
curl -s "https://pprakarsh.github.io/workout-tracker/js/util.js?cb=$RANDOM" | grep APP_VERSION
```

A Pages build takes a minute or two; a `404` on a new file means it has not finished yet.

## Debugging checklist

| Symptom | Look at |
|---|---|
| Change doesn't appear in the browser | Stale service worker. Check the build number on **Set up**; hard-reload or unregister the SW. **Never** "Clear site data" — that deletes the user's log |
| A full-screen haze over everything | An overlay ignoring `hidden`; see gotcha 1 in ARCHITECTURE.md |
| Keyboard closes while typing | Something re-renders on input. Field handlers pass `{ silent: true }`; a live-filtering list must repaint only its own container, not the view |
| Edits in History do nothing | A handler checking `state.active` instead of `working()` |
| Import produces odd targets | `normalizeEntry` — probably the overloaded `sets` field or a bare duration |
| Sync overwrote something | `unsyncedLocalChanges()` and the `lastSeenRemoteMs` marker |
| Tap does nothing | Action name typo, an interpolated `data-action` (rule 8), or a map not merged into `ACTIONS` |
| A tag or attribute "won't save" | One of the four field allowlists is dropping it — see *Add a field* |
| Per-muscle trends show nothing | An exercise with no `primary`, or an entry whose tags are `[]`; an empty list means "not set", and the library's value then applies |
| Two of the same exercise with separate histories | Two spellings of one name. **Library → Mine** surfaces them; merging rewrites both |

## Keeping it maintainable

### Conventions

- **Names say what, comments say why.** Every comment here that explains a workaround names the bug
  it prevents — keep that up, because the next person's instinct will be to "simplify" it away.
- **Functions do one thing and read without scrolling.** If you need a section comment inside a
  function, it wanted to be two functions.
- **No abbreviations in exported names.** Local `e`/`s`/`r` for entry/session/routine is fine.
- **Store mutators are `async` and persist before they emit.** A mid-workout reload must find the
  truth on disk.
- **Guard clauses over nesting.** `if (!s) return;` at the top.
- **Nothing in the app may `console.log`.** `console.error` in a catch is fine. Enforced by a test.

### Complexity budget

| | Soft target | Hard cap (tested) |
|---|---|---|
| Lines per module | 500 | 1000 |
| Runtime dependencies | 0 | 0 |
| Build steps | 0 | 0 |

Run `wc -l js/*.js js/views/*.js | sort -rn | head` for today's numbers rather than trusting a
figure written here — that is how this table went stale before.

A module over ~500 lines is a signal, not a sin. **Split when it has two audiences, not when it has
many lines**, and split on a seam that already exists. Every split so far named its seam:

| Split | Seam |
|---|---|
| `queries.js` out of `store.js` | mutations vs read-only derived queries |
| `model.js` out of `store.js` | what is stored and when vs what the stored thing looks like |
| `planstore.js`, `cardiostore.js` | one sub-domain's writes |
| `clockstore.js` out of `store.js` | the one part of state that is a timestamp, not a record |
| `backupstore.js` out of `store.js` | incremental state vs replacing everything at once |
| `exform.js` out of `views/entry.js` | an exercise DEFINED vs PERFORMED |
| `catalogdata.js` / `catalogconditioning.js` | data vs the mechanism that reads it |
| `views/setup.js` | things you do vs things you configure |

### Anti-patterns — refuse these even if asked

- **A second source of truth for a derived value.** History lookups, PRs, volume and the *derived*
  exercise library (`queries.js → exerciseLibrary()`) are computed on every read. Never cache them.
  Note the distinction: the **stored** library (`state.exercises`) is not derived — it holds
  knowledge *about* an exercise that nothing else records — and the two coexist deliberately.
- **Schema knowledge in more than one place.** Field names and formats live in `normalizeEntry` and
  `normalizeExercise`. The samples, the AI prompt and the README *describe* them; they must not
  re-implement them.
- **A framework, a bundler, or a dependency.**
- **Storing derived values** (volume, e1RM, progress) on a session. Compute them.
- **Guessing an exercise's attributes from its name.** Seeding and matching both refuse to. A wrong
  tag silently pollutes every per-muscle number and nothing ever flags it; a blank one is visible.
- **Silent failure.** Every error path either shows a toast with the real message, or carries a
  comment saying why swallowing it is correct.
- **Mutating `state` outside a store module.**

### Before you commit

```
[ ] npm test — exit code 0, run after the last write and not alongside it
[ ] every behaviour change has an assertion that fails without it
[ ] APP_VERSION and the sw.js CACHE name bumped together
[ ] new files in ASSETS in sw.js, viewFiles in style.mjs, the ARCHITECTURE module map
[ ] a new IndexedDB writer added to the Hard rule 4 table
[ ] no console.log, no commented-out code, no dead handlers, no interpolated data-action
[ ] docs updated per the map below
[ ] Conventional Commit explaining what and why
[ ] after deploy: Pages status is `built` AND the live APP_VERSION matches
```

### When you change X, update Y

| Changed | Also update |
|---|---|
| A field on an entry | `normalizeEntry`, the four allowlists, the exercise form, `SAMPLE*`, `AI_PROMPT`, README field table |
| A field on a set | `blankSet`, the set row, `setLabels`, `format.js`, the CSV columns (append only), ARCHITECTURE data model |
| A field on a library exercise | `normalizeExercise`, `exerciseDefaults`, `libraryObject`, `mentioned()` in exercisestore, the form, `asLibraryRecord` in catalog.js |
| Anything that aggregates sets | use `workingSets(e)` so warmups stay excluded |
| The CSV columns | README export table — a published contract someone's spreadsheet depends on |
| The `state` shape | the state block in ARCHITECTURE.md — **a test asserts every top-level key is documented** |
| `DB_VERSION` or a store | the persistence table in ARCHITECTURE.md — **also tested** |
| A stored shape | `restoreAll`, `backupObject`, and check an old backup still imports |
| A new module | `sw.js` ASSETS, `test/style.mjs` lists, ARCHITECTURE module map |
| A new IndexedDB writer | the Hard rule 4 table here — **tested** |
| The render loop, state shape or event routing | ARCHITECTURE.md — the doc that stops the next person guessing |
| A fixed bug whose cause was subtle | the gotchas list in ARCHITECTURE.md |

### Current known debt

Honest list, each with the trigger for paying it off rather than a vague "someday".

| Debt | Trigger to fix |
|---|---|
| Sync is a whole-file blob, last-write-wins | Two devices used in the same week. Needs per-record push/pull plus deletion tombstones, or the Firebase move |
| No schema migration framework | When a field must *change meaning* rather than be added. `primary` changing from string to list was absorbed by parsing at every read; a true meaning change would not be |
| A set's amount lives in `reps` for every measure | If a set ever needs reps *and* a time together |
| Interval legs are timed, never measured | When you want `400m @ 4:00/km` on a track. `parseLeg` refuses `400m` rather than guess |
| Merge undo is one level deep, and best-effort | If a mis-merge is ever hard to recover. It snapshots by entry id and skips entries deleted since |
| Duplicate detection only finds spelling variants | If near-duplicates become common. Anything looser would offer to destroy history on a hunch, so the manual **Merge…** route exists instead |
| Gist files over 1 MB rely on a raw-URL fallback | Around year 3–5 of daily logging |
| One unexplained test flake | If it recurs. `npm test` failed once in ~70 runs and never reproduced. Likely a `sleep()` in `dom.mjs` too short under load; raise the waits rather than hunting it blind |

### Baselines not to regress

- **Performance.** `render()` rebuilds the whole view on every state change. Fine at this data size.
  If a view gets slow, cap what it renders (paginate History) before reaching for a framework. The
  one deliberate exception is a live-filtering list, which repaints only its own container so the
  keyboard survives.
- **Accessibility.** Inputs stay at 16px so iOS does not zoom on focus; touch targets ~44px; set
  inputs carry `aria-label`s; the tab bar is real `<button>`s.
- **Privacy.** Nothing leaves the device without an explicit tap. The sync token lives outside
  `settings` so exports cannot contain it. No analytics, no telemetry, no crash reporter.

## Product decisions, so they are not re-litigated by accident

Also listed as "deliberately rejected" in [ROADMAP.md](ROADMAP.md) with reasons.

- **Local-first.** No account, no server. Sync is optional and additive; the app stays fully usable
  offline with sync off.
- **The user starts and stops the rest timer.** Nothing auto-starts.
- **Sessions are snapshots.** Mid-workout changes stay in the session unless explicitly saved back.
- **No auto-progression.** Reference numbers only.
- **Unlogged data is named, not defaulted.** "no rest logged", never a blank or a target.
- **Identity is the exercise NAME.** No exercise ids. This is what makes tagging retroactive and
  migration-free, and it is why merging two spellings has to rewrite history. Do not add ids
  without reading ARCHITECTURE § Core invariants first.
- **Direct and indirect sets are never blended** into one per-muscle number. Any single figure needs
  an invented weighting.
- **Superset groups do not share a rest period.** Each exercise keeps its own target.
