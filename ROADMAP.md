# Roadmap

Candidate features, roughly in the order I'd build them. Effort is S (hours), M (a day or two),
L (longer). "Depends on" means it will be built wrong or need redoing without that first.

Nothing here is a commitment. The point is to keep the reasoning next to the idea, so a future
session doesn't re-derive it — and to record what was deliberately rejected, so it isn't quietly
reintroduced.

Grounded in what Strong, Hevy, Boostcamp, Alpha Progression and Jefit compete on, plus the gaps
visible in this app's own data model. The recurring theme in app comparisons is that logging a set
is table stakes; the difference is what happens *around* it — how effort is captured, whether a
plate calculator is offered, and whether your history becomes more than a list.

## Shipped

| Feature | Notes |
|---|---|
| Routines with per-set targets, supersets, multi-line notes | `sets` accepts a count or a per-set plan |
| Session snapshots — mid-workout edits stay in the session | Optional "save back to routine" |
| Manual rest timer, timestamp-based | Survives screen lock, app switching, reload |
| Warmup sets | Excluded from targets, volume and the last-time reference |
| RPE and RIR per set | Stored independently, never converted |
| ± stepper on weight and reps | Keeps focus, no re-render |
| Cardio: a run is time + pace + distance, any two | The third is derived; duration is the anchor |
| Holds and carries — `measure: time` / `distance` | A plank is a lift measured in seconds, not a cardio entry |
| Session progress bar | Entry completion, in the Now header |
| 10-day Plan tab | Assign a routine per day, rest days, push/pull a day; done is derived from history |
| History filters | All / week / month / a date or date range, steppable, with a per-window summary |
| Explicit dates in History, and closing a stranded session | `markSessionFinished` times it to the last set logged |
| "Do this next" | Moves a whole block behind the current one, from the session list |
| Tap-driven interval builder | Steppers, presets and a live preview; typing is the fallback |
| Units on every column, formats in every placeholder | A unit you can still see once a value is typed |
| Cardio intervals as one `pattern`, logged in one tap | `1:00 @ 8:00/km + 1:30 walk @ 6:00/km x 6`; any round still editable |
| Exercise library | Derived from all routines and sessions |
| Editing finished sessions, including the date | Same UI as the live session |
| Export: JSON backup, CSV, per-session Markdown | CSV column order is a contract |
| Secret-Gist sync with conflict guards and device pairing | Blob sync, last-write-wins, guarded |
| AI prompt that generates importable routine JSON | Built from the same samples the app documents |

## Next

| # | Feature | Why | Effort | Depends on |
|---|---|---|---|---|
| 1 | **Plate calculator** — per-side loading for a target weight, given bar weight and available plates | Named as a differentiator in every app comparison; removes real mid-set arithmetic | S | — |
| 2 | **PR detection** — best weight at a rep count, best estimated 1RM, best session volume, flagged when you beat it | Free from data already stored; the main motivational payoff of keeping a log | S | warmup flag (done) |
| 3 | **Screen wake lock** during a workout | `navigator.wakeLock` is supported in iOS Safari 16.4+. Stops you unlocking the phone between every set | S | verify support on your iOS version |
| 4 | **Set notes UI** | `set.note` already exists in the model with no input | S | — |
| 5 | **Rest suggestion from your own history** — default to the median rest you actually took for that exercise | Logged rest is currently write-only | S | — |
| 6 | **Per-exercise history screen** — every past set for one movement, best set, estimated 1RM trend | Turns years of logs into something you'd open. Today only "last time" is surfaced | M | — |

## Later

| Feature | Why | Effort | Notes |
|---|---|---|---|
| **Progress charts** — bodyweight, weekly volume, e1RM per lift | Makes trends visible | M | Needs one small inline SVG helper; no dependency |
| **Muscle-group tags per exercise** → weekly volume and balance per muscle | Answers "am I neglecting pulling?" | M | Tag once per exercise in the library; don't guess from names |
| **Repeat a past session** as a new workout | Covers ad-hoc days with no routine | S | — |
| **Calendar / streak view** in History | Training pattern at a glance | M | — |
| **Search History by exercise or note** | Date filtering is done; text search is the other half | S | — |
| **Distance-based interval legs** | `400m @ 4:00/km` instead of a time. Legs are timed today, which covers treadmill work; this is for track sessions | S | `parseLeg` must disambiguate `400m` from 400 minutes |
| **Rest as an interval leg** | A rest leg is timed by the clock rather than planned | S | Would let the block drive the rest timer |
| **Hold/carry PRs** | Longest plank, furthest carry at a load | S | Needs `measure` awareness in whatever PR code gets written |
| **Import from Strong / Hevy CSV** | Only if you migrate from another app | M | — |
| **Per-record sync with tombstones** | Real merge instead of last-write-wins | L | Do this when you start logging on two devices in the same week |
| **Repeat last week's plan** | Copy the previous seven days forward in one tap | S | Builds on the Plan tab |
| **Accounts + cloud sync (Firebase Auth + Firestore)** | What "log in on a new phone and everything is there" actually needs. Replaces the Gist transport; keeps IndexedDB as the source of truth | L | Per-record, not a blob — Firestore caps a document at 1 MiB. Brings privacy-policy, in-app account deletion and Sign in with Apple obligations |
| **Capacitor shell for the App Store and Play** | Ships the existing codebase as a native app without a rewrite | M | Needs real native integration to pass Apple guideline 4.2 |

## Ideas specific to this app

Not things the commercial apps do — they fall out of this app's particular shape.

| Feature | Why |
|---|---|
| **Sync health badge** — warn when the last push is more than a few days old | Blob sync is manual-ish, and Safari evicts storage after 7 idle days if the app isn't home-screen-installed. This guards the one failure mode that loses everything |
| **Post-workout completeness nudge** — after finishing, list sets with no rest or no effort logged and offer to fill them | Finished sessions are already editable; catch gaps while you still remember |
| **Routine linting** — warn on a superset label spread across non-adjacent entries, a one-row per-set plan, or a routine with no rest targets | Each of those is a real footgun already documented in ARCHITECTURE.md |
| **Scope check** — compare actual session duration against the sum of targets plus rests | Tells you whether your "60 minute" routine is really a 90 minute routine |

## Not possible on an iOS PWA

Don't start these; the platform refuses. These are the real reasons people pay for native apps.

- Apple Watch, Live Activity, Dynamic Island rest countdown.
- Sound, notification or vibration while the app is fully backgrounded — the rest beep only plays
  with the app open, and iOS Safari ignores `navigator.vibrate`.
- Reliable background GPS, so a run cannot be tracked with the screen off.
- HealthKit read or write.

## Deliberately rejected

Changing any of these is a product decision, not a feature request. See the end of
[AGENTS.md](AGENTS.md).

| Rejected | Why |
|---|---|
| **Auto-progression / suggested next weights** | Explicit decision: show last session's numbers as a reference and nothing more |
| **Converting RPE to RIR or vice versa** | A value you typed must never be overwritten by one the app inferred |
| **A social feed, profiles, leaderboards** | Needs a server and an account; both are the opposite of this app |
| **Analytics, telemetry, crash reporting** | Nothing leaves the device without an explicit tap |
| **A framework, bundler or runtime dependency** | The app must still run in five years with no toolchain |
| **Sharing one rest period across a superset** | Each exercise keeps its own rest target |
