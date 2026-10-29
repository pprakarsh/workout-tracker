# Working on this codebase

Entry point for anyone — human or AI — editing this app. Read
[ARCHITECTURE.md](ARCHITECTURE.md) for how it works; this file is the rules and the recipes.
[ROADMAP.md](ROADMAP.md) holds the candidate feature list, with what is impossible on an iOS PWA
and what has been deliberately rejected — check it before building something new.

Plain ES modules, no framework, no build step, no runtime dependencies. Keep it that way: the whole
point is that it deploys as static files and will still run in five years.

## Before you start

```bash
cd ~/workout-tracker
python3 -m http.server 8000 --bind 127.0.0.1   # http://localhost:8000
cd test && npm install && npm test             # four suites, ~520 assertions
```

`localhost` is a secure context, so the service worker works there. `file://` will **not** work —
ES modules are blocked by CORS.

## Hard rules

1. **No dependencies, no build step, no framework.** No npm packages in the app (`test/` may have
   dev-only ones). No transpiling, no bundling, no JSX.
2. **Run `npm test` before you claim anything works.** All four suites must pass. If you changed
   behaviour, change or add the assertion that proves it.
3. **Bump `APP_VERSION` in `js/util.js` and the `CACHE` name in `sw.js` together** on any change to
   a shipped file. A test fails if they disagree. The build number shows in the Routines tab, which
   is how you tell a stale cache from a real bug.
4. **Only `store.js` mutates `state` or touches IndexedDB** (one documented exception: `routines.js`
   uses `dbPut` for a caret-preserving write).
5. **Views return HTML strings.** No DOM refs, no local state. Escape every interpolated value with
   `esc()`. The only direct listeners live inside modals, wired after `openModal()` returns.
6. **Mutators resolve their target with `working()`, never `state.active`.** Otherwise the History
   editor silently stops working.
7. **Field edits persist with `{ silent: true }`** so typing does not trigger a re-render.
8. **Shell scripts stay ASCII.** macOS bash 3.2 mangles non-ASCII bytes after a variable.
9. **Never widen what an export contains without checking for secrets.** The sync token lives in
   `meta.sync`, outside `settings`, precisely so backups cannot leak it.
10. **Do not add auto-progression.** A deliberate product decision: the app shows last session's
    numbers as a reference and nothing more.

## Recipes

### Add a field to an exercise

1. `store.js` → `normalizeEntry`: read it, with aliases, and give it a sane default. Add it to
   `definitionOf` if the exercise library should carry it.
2. `views/entry.js` → `exerciseFormHtml` (input), `readExerciseForm` (parse), `targetLine` (display).
3. `exportimport.js` → `routineObject` (export), and `sessionMarkdown` if it belongs in the report.
4. `views/routines.js` → `SAMPLE` / `SAMPLE_RUN` and `AI_PROMPT` if users should know about it.
5. Tests: a round-trip assertion in `test/smoke.mjs`, and a prompt-coverage assertion if you touched
   `AI_PROMPT`.

### Add a button

1. Render `data-action="my-thing"` plus any `data-*` parameters it needs.
2. Add `'my-thing': async ({ myParam }) => { ... }` to the relevant `*Actions` map.
3. That is it — `app.js` merges the maps and routes the tap. Names must be globally unique; a test
   catches collisions, dead handlers and actions with no handler.

### Add a tab or screen

Add a module exporting `render()` and an actions map, register it in `VIEWS` and `TITLES` in
`app.js`, add a `.tab` button in `index.html`, and **add the file to `ASSETS` in `sw.js`** or it
will not work offline. A test fails if a shipped file is missing from that list.

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

There is no migration framework. `normalizeEntry` is the compatibility layer: make new fields
optional and default them so old backups and old IndexedDB rows still load. Before changing a
stored shape, check `restoreAll` (verbatim restore), `backupObject` (what ships to the gist) and
`csvRows` (column order is a published contract).

## Tests

| Suite | What it covers |
|---|---|
| `test/style.mjs` | computed `display` of overlays, CSS sanity, the SW asset manifest, version sync, action registry integrity, ASCII shell scripts |
| `test/smoke.mjs` | store, timer maths, per-set targets, the exercise library, import/export, device restore, the AI prompt's claims |
| `test/sync.mjs` | gist sync against a fake GitHub API: push/pull, both conflict directions, clock skew, truncation, bad tokens, offline |
| `test/dom.mjs` | the real UI under jsdom: clicks, typing, focus retention, modals, the full finish-a-workout flow |

### Judge a run by its exit code, never by its output

`npm test` chains the four suites with `&&`, so a non-zero exit is the only signal you need —
and the only one you may trust. Do not conclude a suite passed because its output contained
`PASSED` or did not contain `FAIL`. A suite that dies before running anything (a syntax error, a
bad import, a throw at module scope) prints neither, and a grep-based check reads that silence as
success. This exact mistake shipped build 18 while `smoke.mjs` could not be parsed.

If you must run a suite alone, branch on the status:

```bash
cd test && for f in style smoke sync dom; do
  node $f.mjs >/tmp/$f.log 2>&1 && echo "PASS $f" || echo "FAIL $f"
done
```

They run on jsdom + fake-indexeddb, so no browser and no network. What they **cannot** check:
visual layout, touch ergonomics, real iOS Safari behaviour, and real GitHub API responses. Say so
rather than implying those are verified.

Writing tests here: assert the *behaviour a user would notice*, and prefer a failing message that
names the actual value (`` `got ${x}` ``). Several real bugs were found by tests that checked a
claim made in documentation — keep doing that.

## Shipping

```bash
cd test && npm test                    # must exit 0 -- do not read the output instead
# bump APP_VERSION in js/util.js and CACHE in sw.js
git add -A && git commit -m "..."      # Conventional Commits
./deploy.sh                            # pushes main, enables Pages, prints the URL
```

`deploy.sh` refuses to publish if `gh` is authenticated as the wrong account or if the latest commit
carries a corporate email. After deploying, confirm the live build number:

```bash
curl -s https://pprakarsh.github.io/workout-tracker/js/util.js | grep APP_VERSION
```

## Debugging checklist

| Symptom | Look at |
|---|---|
| Change doesn't appear in the browser | Stale service worker. Check the build number in Routines; hard-reload or unregister the SW. **Never** "Clear site data" — that deletes the user's log |
| A full-screen haze over everything | An overlay ignoring `hidden`; see gotcha 1 in ARCHITECTURE.md |
| Keyboard closes while typing | Something is re-rendering on input; field handlers must pass `{ silent: true }` |
| Edits in History do nothing | A handler checking `state.active` instead of `working()` |
| Import produces odd targets | `normalizeEntry` — probably the overloaded `sets` field or a bare duration |
| Sync overwrote something | `unsyncedLocalChanges()` and the `lastSeenRemoteMs` marker |
| Tap does nothing | Action name typo, or the handler lives in a map that is not merged into `ACTIONS` |

## Keeping it maintainable

The rules above stop you breaking what exists. This section is about not letting it rot.

### Conventions

- **Names say what, comments say why.** The code should need no comment to explain *what* it does;
  comments exist to record the reason, especially the non-obvious ones. Every comment in this
  codebase that explains a workaround names the bug it prevents — keep that up, because the next
  person's instinct will be to "simplify" it away.
- **Functions do one thing and are readable without scrolling.** If you need a section comment
  inside a function, it wanted to be two functions.
- **No abbreviations in exported names.** `sessionProgress`, not `sessProg`. Local `e`/`s`/`r` for
  entry/session/routine is established and fine.
- **Store mutators are `async` and persist before they emit.** Never mutate and leave the write for
  later; a mid-workout reload must find the truth on disk.
- **Guard clauses over nesting.** `if (!s) return;` at the top.
- **Nothing in the app may `console.log`.** `console.error` in a catch is fine. Enforced by a test.

### Complexity budget

| | Soft target | Hard cap (tested) | Today |
|---|---|---|---|
| Lines per module | 500 | 1000 | store 845, routines 756, entry 549 |
| Runtime dependencies | 0 | 0 | 0 |
| Build steps | 0 | 0 | 0 |

`store.js` and `views/routines.js` are the two to watch. When one needs splitting, the seams are
already visible: `store.js` → session logic vs. routine/library logic; `routines.js` → the routine
editor vs. the data/settings/samples screen. Split on those lines rather than inventing new ones.

A module over ~500 lines is a signal, not a sin. Split when it has two audiences, not when it has
many lines.

### Anti-patterns — refuse these even if asked

- **A second source of truth.** The exercise library is derived from routines and sessions on every
  read, deliberately. Never cache it into a store. Same for anything else derivable.
- **Schema knowledge in more than one place.** Field names and formats live in `normalizeEntry`.
  The samples, the AI prompt and the README describe it; they must not re-implement it.
- **A framework, a bundler, or a dependency.** The whole value proposition is that this still runs
  in five years with no toolchain.
- **Storing derived values** (volume, e1RM, progress) on a session. Compute them.
- **Silent failure.** Every error path either shows a toast with the real message or is commented
  with why swallowing it is correct.
- **Mutating `state` outside `store.js`.**

### Before you commit

```
[ ] npm test — all four suites green
[ ] every behaviour change has an assertion that fails without it
[ ] APP_VERSION and the sw.js CACHE name bumped together
[ ] new files added to ASSETS in sw.js
[ ] new modules added to the ARCHITECTURE.md module map
[ ] no console.log, no commented-out code, no dead handlers
[ ] docs updated per the map below
[ ] Conventional Commit message explaining what and why
```

Every bug fixed here got a test that fails without the fix. That is the single habit keeping this
codebase honest — four real bugs were caught that way during its first week (the SW cache, the
focus-stealing blur, the clock-skew comparison, logged sets read as targets).

### When you change X, update Y

| Changed | Also update |
|---|---|
| A field on an entry | `normalizeEntry`, the exercise form, `routineObject`, `SAMPLE`/`SAMPLE_RUN`, `AI_PROMPT`, README field table |
| A field on a set | `blankSet`, the set row, `effortTag`/`logSummary`, the Markdown table, the CSV columns (append only), ARCHITECTURE data model |
| Anything that aggregates sets | use `workingSets(e)` so warmups stay excluded |
| The CSV columns | README export table — the column order is a published contract someone's spreadsheet depends on |
| Anything about `group`, units or durations | `AI_PROMPT`, the in-app *Import format* card, README |
| A stored shape | `restoreAll`, `backupObject`, and check an old backup still imports |
| A new module | `sw.js` ASSETS, ARCHITECTURE.md module map |
| The render loop, state shape or event routing | ARCHITECTURE.md — this is the doc that stops the next person guessing |
| A fixed bug whose cause was subtle | the gotchas list in ARCHITECTURE.md |

### Current known debt

Honest list, with the trigger for paying it off rather than a vague "someday":

| Debt | Trigger to fix |
|---|---|
| Sync is a whole-file blob, so it cannot merge two devices | When you start logging on two devices in the same week. Needs per-record push/pull plus deletion tombstones |
| No schema migration framework; `normalizeEntry` absorbs everything | When a field must *change meaning* rather than be added |
| ~~Volume counts warmup sets~~ | **Done.** `workingSets(e)` is the accessor; any new aggregate must use it |
| ~~Cardio intervals are expanded entries~~ | **Done.** One entry holds a `pattern` and expands into `log.legs`; `cardioLogged(log)` is the only way to ask whether a cardio entry recorded anything |
| Interval legs are timed, never measured | When you want `400m @ 4:00/km` on a track. `parseLeg` currently refuses `400m` rather than guess |
| A set's amount is stored in `reps` for every measure | If a set ever needs reps *and* a time together. Until then `measure` plus `fmtAmount`/`parseAmount` is cheaper than parallel fields and a migration |
| ~~`store.js` is at its 1000-line cap~~ | **Done.** The plan's writes moved to `js/planstore.js`, the mirror of `queries.js`: both import `state` from the store and neither is imported by it. store.js is back to 913. The same seam is available again for the rest timer if needed |
| Trends has no muscle-group view | When you want weekly volume per muscle. Nothing tags an exercise, and names must never be guessed from |
| One unexplained test flake | If it recurs. `npm test` failed once in roughly 70 runs and did not reproduce in 56 individual suite runs or 14 further gates afterwards. No assertion was captured. The likely shape is a `sleep()` in `dom.mjs` being too short under load; if it returns, raise the waits rather than hunting it blind |
| Sync is still blob last-write-wins | Two devices used in the same week. The triggers are now tight (routines, plan, finished sessions, launch, foreground) but two edits between pushes still means one wins. The fix is per-record sync with tombstones, or the Firebase move |
| No charts, so years of logs stay a list | When you have enough history to want a trend |
| Exercises have no muscle-group tags | When you want weekly volume per muscle |
| Gist files over 1 MB rely on a raw-URL fallback | Around year 3–5 of daily logging |

### Baselines not to regress

- **Performance.** `render()` rebuilds the whole view on every state change. That is fine at this
  data size (a few hundred sessions, a few KB each). If a view ever gets slow, cap what it renders
  (paginate History) before reaching for a framework.
- **Accessibility.** Inputs stay at 16px so iOS does not zoom on focus; touch targets stay ~34px
  minimum; set inputs carry `aria-label`s; the tab bar is real `<button>`s. Keep all of that.
- **Privacy.** Nothing leaves the device without an explicit tap. The sync token lives outside
  `settings` so exports cannot contain it. Do not add analytics, telemetry or a crash reporter.

## Product decisions, so they are not re-litigated by accident

These are also listed as "deliberately rejected" in [ROADMAP.md](ROADMAP.md) with reasons.

- **Local-first.** No account, no server. Sync is optional and additive; the app must stay fully
  usable offline with sync switched off.
- **The user starts and stops the rest timer.** Nothing auto-starts.
- **Sessions are snapshots.** Mid-workout changes stay in the session unless explicitly saved back.
- **No auto-progression.** Reference numbers only.
- **Unlogged data is named, not defaulted.** "no rest logged" rather than a blank or a target.
- **The exercise library is derived, never stored.** No second source of truth to drift.
- **Superset groups do not share a rest period.** Each exercise keeps its own target.
