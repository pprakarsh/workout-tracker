# Workout Tracker

A single-user workout tracker that runs as an installable web app (PWA). Plain HTML, CSS and
ES modules — no build step, no dependencies, no server, no account. Everything you log is
stored in IndexedDB on the device you logged it on.

Works on iOS, Android and desktop: it's a web app, so any modern browser runs it. The layout is
mobile-first and centred with a max width, so on a desktop it appears as a phone-width column.

---

## Run it

It's static files, so anything that serves a directory works:

```bash
cd ~/workout-tracker
python3 -m http.server 8000
# open http://localhost:8000
```

`localhost` counts as a secure context, so the service worker and offline support work there.
Opening `index.html` as a `file://` URL will **not** work — ES modules are blocked by CORS on
`file://`.

## Install it as an app

| Platform | How | Result |
|---|---|---|
| **iOS / iPadOS** | Open the URL in **Safari** → Share → *Add to Home Screen* | Real standalone app: own icon, no browser chrome, works offline |
| **Android** | Chrome → ⋮ → *Install app* / *Add to Home screen* | Standalone app, works offline |
| **Desktop** | Chrome/Edge → install icon in the address bar | App window |

Two iOS caveats worth knowing:

- **Chrome on iOS cannot do this properly.** Its "Add to Home Screen" creates a bookmark that
  opens inside Chrome. Only Safari produces a standalone, offline-capable app. (Every iOS browser
  is WebKit underneath, so you lose nothing by using Safari for this.)
- **Serving over plain HTTP from your laptop won't give you offline support.** Service workers
  require HTTPS (or localhost), so `http://192.168.x.x:8000` from your phone will run the app but
  not install it as a true offline app. For that, host the folder somewhere with HTTPS —
  GitHub Pages, Netlify, Vercel, Cloudflare Pages all serve static files for free. Hosting the app
  does **not** put your workout data online: the files are the app, your data never leaves the device.

---

## How it works

### Routines vs. sessions

A **routine** is a template: a name, a description, and an ordered list of exercises with targets.
Starting a workout **snapshots** the routine into a **session**. Anything you change during the
workout — reorder, add, remove, skip, retarget — affects only that session. If you decide a change
should stick, the Session tab has *Save order to routine*.

### The four tabs

- **Now** — just the exercise you're on, with its targets, what you did last time, and its set rows.
  Prev/Next step through the workout; a superset block (entries sharing a group letter) is shown
  together. When nothing is running, this tab is where you pick a routine and start.
- **Session** — today's full picture: every exercise in order with done / in progress / pending
  status and its logged sets inline. Reorder, add, remove, skip, jump to any exercise, and record
  session-level effort, bodyweight and notes. Finish or discard the workout here.
- **History** — past sessions, newest first. Open one for the full log, correct it, or export it.
- **Routines** — your routine library and editor, import/export, backup, and settings.

The rest timer bar sits above the tab bar and stays live across all four tabs.

### Correcting a finished session

Open a session from History and tap **Edit**. The log becomes editable in place, exactly like the
live Session view: fix weights, reps and RPE, add a set you forgot, delete one you didn't do, add or
remove an exercise, and correct the session RPE, bodyweight and notes. Changes save as you type.
The rest-timer buttons are hidden, since timing rest on a workout that already happened is
meaningless.

**Change date & time** also lets you move a session to the day it actually happened — so you can
log a workout you forgot by running it now and then moving it back. A finish time earlier than the
start is read as crossing midnight.

Editing a past session never touches your routines, and a live workout in progress is left alone:
the editor targets the session you opened, not the one you're doing.

### The rest timer

You start it and you stop it — nothing is automatic.

- Tap **⏱** on a set row when the set ends. That marks the set done and starts the clock.
- The target is pre-filled from that exercise's rest value in the routine (falling back to the
  default in Settings), and `+30s` / `−30s` adjust it mid-rest.
- Past the target it keeps counting **up in red**, so you can see how far over you went, and beeps
  once at the target.
- Tap **Stop** when you start your next set. The actual rest is recorded against the set.
- Elapsed time is computed from a stored timestamp, not accumulated by a ticker — locking the
  screen, switching apps, or reloading the page all still show the true elapsed time.
- While it runs, the whole app stays usable: log weights and reps for any exercise, reorder the
  routine, read last week's session.

One limitation to be aware of: a PWA on iOS cannot reliably play a sound or fire a notification
while fully backgrounded, so the target beep only plays if the app is open. The clock itself is
always correct when you come back. (Android and desktop also vibrate; iOS Safari ignores vibration.)

### Progression

The app shows you what you did last time as a reference line and nothing more. Sets prefill from
the per-set plan for that set number, or from the uniform routine target, or from the previous set
in the same exercise. There is no auto-progression.

---

## Importing a routine

Routines tab → **Import**, then either pick a `.json` file or paste JSON. Only `name` is required
on each exercise.

```json
{
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
}
```

| Field | Applies to | Notes |
|---|---|---|
| `name` | all | **Required.** |
| `type` | all | `lift` (default) or `cardio`. |
| `sets` | lift | A **number** for one target across all sets, or a **list** for a per-set plan (see below). |
| `reps` | lift | `"5"`, `"6-8"`, or a number. Ranges are kept as a range. Ignored when `sets` is a per-set plan. |
| `weight` | lift | Target load, in your configured unit. Ignored when `sets` is a per-set plan. |
| `distance`, `distanceUnit` | cardio | `km` or `mi`. |
| `duration` | cardio | `"18:00"`, `"1:05:00"`, `"20m"`, `"90s"`. A bare number means minutes. |
| `rest` | all | Rest target between sets, and between cardio efforts. Same formats as `duration`. |
| `group` | all | Superset / circuit label — see below. |
| `notes` | all | Warmup sets, tempo, cues, setup. A string, or a **list of lines** for multi-line notes. |

Keys beginning with `//` are treated as comments and ignored, so you can annotate a file.

### Supersets and circuits: the `group` field

`group` marks a superset or circuit. Give two or more **consecutive** exercises the same short
label and the app treats them as one block:

- Both appear **together on the Now screen**, so you can alternate between them without navigating.
- **Next** jumps past the whole block rather than stepping through its members one at a time.
- The label shows as a badge in the Session list and the routine editor, and as `_(superset A)_` in
  the Markdown export and a `group` column in the CSV.

Things worth knowing:

- **Each exercise keeps its own rest target.** Grouping changes presentation and navigation, not
  how rest is timed — you still start and stop the timer per set, per exercise. (An earlier draft of
  this app was going to share one rest period per group; it does not.)
- The label itself is arbitrary — `A`, `B`, `I`, anything up to 4 characters. It only matters that
  neighbours match.
- **Non-adjacent exercises sharing a label form separate blocks.** Keep the members of a superset
  next to each other; reorder with the ↑↓ buttons if they drift apart.
- Leave it blank for an ordinary exercise, which is then its own block.
- Picking an exercise from the library does **not** copy its group label, since the label describes
  the arrangement of the routine it came from.

### Targets vs. what you log

A routine holds **targets** only. For cardio you can target `distance`, `duration` and `rest`;
pace, average and max heart rate, elevation and perceived effort have no target fields — you record
those while logging. Put a pace or heart-rate instruction in `notes` if you want it on screen during
the run.

Each cardio entry logs **one** effort, so for intervals add one entry per repetition and give them
the same `group` label to keep them together. The running sample below does exactly that.

### A complete running / mixed example

Every field the app understands, in one routine:

```json
{
  "//": "Each cardio entry logs ONE effort, so intervals are one entry per rep.",
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
}
```

Both samples are also shown in the app under Routines → *Import format*, each with a copy button,
and both are covered by tests that assert every field in them survives an import/export round trip.

### Per-set targets

For ascending loads, pyramids, or anything where each set differs, make `sets` a list instead of a
count. Three equivalent forms are accepted:

```json
"sets": [ { "weight": 60, "reps": 10 }, { "weight": 70, "reps": 8 }, { "weight": 80, "reps": "5-6" } ]
"sets": [ "60x10", "70x8", "80x5-6" ]
"sets": "60x10, 70x8, 80x5-6"
```

The target set count comes from the length of the list. Omit the weight for bodyweight work
(`"x8"` or `{ "reps": 8 }`). Reps can still be a range per set. When you log the workout, set 1
prefills from the first planned entry, set 2 from the second, and so on; any set beyond the plan
carries the previous set forward. The exercise card shows a **+ All N planned** button that creates
every planned row at once.

In the app, every lifting exercise is entered as a grid with one row per set, each row holding its
own weight and reps — there is no separate "same for every set" mode to find. **Copy set 1 down**
fills the whole grid when the sets really are identical, and in that case the app stores and
displays it as the simpler `3 × 8-12 @ 15 kg` rather than repeating the row. Editing such an
exercise expands it back into rows, so changing just set 3 turns it into a per-set plan again.

### Notes

Notes are per exercise and per routine, so warmup protocols and tempo prescriptions live with the
movement rather than in your head. They're shown on the exercise card in the Now and Session views,
preserved line-for-line, and quoted in the Markdown export. Use the list form in JSON to avoid
embedding `\n` by hand.

Also accepted: a **JSON array of routine objects**, a **bare array of exercises** (wrapped into one
routine), or a **full backup file** (see below). Aliases `exercises`/`title`/`desc`/`restSeconds`/
`targetWeight`/`setTargets` are understood too, so hand-written or LLM-generated files usually just
work. Bad input is rejected with a specific message rather than partially imported.

### The exercise library

Every exercise you have ever put in a routine or logged in a session is reusable. Tapping **+ Add
exercise** — in the routine editor or mid-workout — offers two paths: *Create a new exercise*, or
pick from a searchable list of everything you already use. Each row shows the exercise's targets,
how many routines contain it, and when you last performed it; the list is ordered by most recently
performed.

Picking one opens the normal form pre-filled with its type, set grid, rest target and notes, so you
can adjust anything before adding it. Two deliberate choices there:

- The **superset letter is not copied**, because a group letter describes one routine's arrangement
  and carrying it over would create accidental supersets.
- Only **targets** come across, never logged sets — the library holds intent, not history.

Where an exercise appears in several routines, the definition comes from the most recently updated
one, then the most recently created. An exercise you only ever added ad-hoc during a workout is
still offered, defined from that session.

The library needs no setup and nothing to maintain: it is derived from your data on the fly, so
renaming or deleting routines is reflected immediately. The name field also keeps its free-text
autocomplete, so you can still just type.

## Exporting

| Where | Format | Contents |
|---|---|---|
| Routines → Export full backup | JSON | Everything: routines, every session, settings, the in-progress workout |
| Routines → Export sets | CSV | One row per logged set and per cardio log, across all sessions — for spreadsheets |
| Routines → routine → Export JSON | JSON | That one routine, in the import format above |
| History → session → Markdown | Markdown | That one session: header, per-exercise set tables, notes |
| History → session → JSON | JSON | That one session |

---

## Moving everything to another device

The full backup is a complete, loss-free copy, and **Replace** mode restores it verbatim — same
routines, same sessions, same internal ids (so every session keeps its link to its routine), the
same settings, and even a workout that was still in progress with its rest timer still running.

1. **Old device** → Routines tab → note the four numbers in **Backup & transfer**
   (routines / sessions / logged sets / date range).
2. Tap **Export full backup (JSON)** and put the file somewhere the new device can reach it
   (AirDrop, Files, iCloud Drive, email to yourself — your choice; nothing is uploaded by the app).
3. **New device** → install the app → Routines tab → **Import / restore from backup**.
4. Choose the file, set the mode to **Replace — wipe this device and restore exactly**, and confirm.
5. The app reports what it imported and then self-verifies: it compares the counts recorded inside
   the backup against what actually landed, and warns you if they differ.
6. Compare those four numbers against step 1. Matching numbers mean the transfer was complete.

**Merge** mode is the other option: it adds only what isn't already present (matching on id) and
leaves everything else alone, so re-importing the same backup twice is a no-op rather than a
duplicate. Use Replace to clone a device, Merge to fold in data from a second one.

Two things to keep in mind:

- This is a manual transfer, not sync. Two devices used in parallel will diverge, and Replace
  resolves that by discarding one side. Treat one device as the source of truth.
- Export a backup periodically. The data lives only in this browser's storage: clearing site
  data, deleting the app on iOS, or (rarely) Safari evicting storage for an app you haven't opened
  in a long time will take it with them. Safari Private Browsing has no persistent storage at all —
  the app will tell you if it can't open its database.

---

## Syncing to a secret GitHub Gist

Optional. The app stays local-first — this only adds a copy in a private gist on your GitHub
account, so a second device can load the same data and you have an off-device backup.

**Set up on the first device:** Routines tab → *Set up Gist sync*. Paste a GitHub
**fine-grained personal access token** (github.com → Settings → Developer settings → Personal
access tokens) with the **Gists: Read and write** account permission and nothing else. Leave the
gist id blank. Tap **Push ↑** — that creates a secret gist and uploads the backup.

**Set up a second device:** on the first device, *Settings* → **Copy pairing code**. That single
string carries both the token and the gist id. On the new device, open *Set up Gist sync* and paste
it into the token field. Because the new device is empty, it pulls immediately — no second tap, no
typing a token on a phone keyboard. Treat the pairing code like a password.

**After that it is automatic.** Opening the app pulls a newer copy from the gist in the background,
and *Push after finishing a workout* (off by default) uploads when you finish one. Both can be
turned off, and both are also available as manual Push/Pull buttons.

### What it will and won't do

This is **blob sync**: the whole dataset is one JSON file, so a push or pull replaces everything
rather than merging record by record. That is fine for one person moving between a phone and a
laptop, and it is why both directions refuse to act blindly:

- **Pull** stops if this device has records changed since it last synced, listing them, and only
  overwrites if you confirm. A device holding data that has *never* synced always asks.
- **Push** stops if the gist was written after this device last synced — e.g. by your other phone —
  showing both record counts before you choose.
- The comparison uses *this device's* last-sync time, never the timestamp inside the remote file, so
  a device with a wrong clock cannot make your unpushed work look stale.
- Every push is a gist revision, so even a forced overwrite is recoverable from the gist's history
  on github.com.

What it is **not**: real merge sync. Log on two devices in parallel without syncing in between and
one side's session has to lose. Treat one device as the source of truth, or push before switching.

Two limits worth knowing: the gist API inlines files up to 1 MB, beyond which the app falls back to
a raw download (and tells you clearly if that fails) — at roughly 1 MB per year of training that is
years away, and the fix then is per-record sync. And the token lives in this device's IndexedDB; it
is deliberately kept out of `settings` so an exported backup never contains it.

## Deploying to GitHub Pages

```bash
gh auth login        # once, interactive — opens a browser
./deploy.sh          # creates the repo, pushes, enables Pages, prints the URL
```

Re-run `./deploy.sh` to ship an update. It publishes a **public** repo, which is what GitHub Pages
serves on the free plan — the app code becomes public, your workout data does not (it never leaves
your device except into your own private gist). Keep exported backup `.json` files outside the repo
folder; `.gitignore` does not know about them.

Set `REPO_NAME=something-else ./deploy.sh` to use a different repo name.



## Tests

Four Node suites cover the store, timer, per-set targets, import/export and round-trip restore;
gist sync against a fake GitHub API (push/pull, conflict guards, clock skew, error paths); a jsdom
pass that drives the real UI through clicks and typing; and a style pass that resolves computed
`display` to catch overlays that fail to hide. They are dev-only; the app itself has no
dependencies.

```bash
cd test
npm install
npm test
```

## Layout

```
index.html              app shell: header, view container, rest bar, tab bar
manifest.webmanifest    PWA metadata
sw.js                   offline cache (bump CACHE after editing files)
css/styles.css
js/app.js               boot, render loop, delegated events
js/store.js             state, persistence, session/routine logic, restore
js/db.js                IndexedDB wrapper
js/timer.js             rest timer bar
js/ui.js                modal / toast / confirm
js/util.js              formatting and parsing helpers
js/exportimport.js      JSON backup, CSV, Markdown, import
js/sync.js              secret-Gist sync: push/pull, conflict guards, device pairing
js/views/entry.js       exercise card + set rows (shared by Now/Session/History)
js/views/{now,session,history,routines}.js
test/                   dev-only test suites
```
