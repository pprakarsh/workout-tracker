# Working on this codebase

Entry point for anyone — human or AI — editing this app. Read
[ARCHITECTURE.md](ARCHITECTURE.md) for how it works; this file is the rules and the recipes.

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

They run on jsdom + fake-indexeddb, so no browser and no network. What they **cannot** check:
visual layout, touch ergonomics, real iOS Safari behaviour, and real GitHub API responses. Say so
rather than implying those are verified.

Writing tests here: assert the *behaviour a user would notice*, and prefer a failing message that
names the actual value (`` `got ${x}` ``). Several real bugs were found by tests that checked a
claim made in documentation — keep doing that.

## Shipping

```bash
cd test && npm test                    # must be green
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

## Product decisions, so they are not re-litigated by accident

- **Local-first.** No account, no server. Sync is optional and additive; the app must stay fully
  usable offline with sync switched off.
- **The user starts and stops the rest timer.** Nothing auto-starts.
- **Sessions are snapshots.** Mid-workout changes stay in the session unless explicitly saved back.
- **No auto-progression.** Reference numbers only.
- **Unlogged data is named, not defaulted.** "no rest logged" rather than a blank or a target.
- **The exercise library is derived, never stored.** No second source of truth to drift.
- **Superset groups do not share a rest period.** Each exercise keeps its own target.
