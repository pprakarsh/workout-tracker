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
| `rest` | all | Rest target between sets. Same formats as `duration`. |
| `group` | all | Same letter on consecutive exercises = one superset/circuit. |
| `notes` | all | Warmup sets, tempo, cues, setup. A string, or a **list of lines** for multi-line notes. |

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

In the app, the exercise form has a *Set targets* selector — switch it to **Different weight / reps
per set** to get an editable grid instead of the single weight/reps fields.

### Notes

Notes are per exercise and per routine, so warmup protocols and tempo prescriptions live with the
movement rather than in your head. They're shown on the exercise card in the Now and Session views,
preserved line-for-line, and quoted in the Markdown export. Use the list form in JSON to avoid
embedding `\n` by hand.

Also accepted: a **JSON array of routine objects**, a **bare array of exercises** (wrapped into one
routine), or a **full backup file** (see below). Aliases `exercises`/`title`/`desc`/`restSeconds`/
`targetWeight`/`setTargets` are understood too, so hand-written or LLM-generated files usually just
work. Bad input is rejected with a specific message rather than partially imported.

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

## Tests

Three Node suites cover the store, timer, per-set targets, import/export and round-trip restore; a
jsdom pass that drives the real UI through clicks and typing; and a style pass that resolves
computed `display` to catch overlays that fail to hide. They are dev-only; the app itself has no
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
js/views/entry.js       exercise card + set rows (shared by Now/Session/History)
js/views/{now,session,history,routines}.js
test/                   dev-only test suites
```
