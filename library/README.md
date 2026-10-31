# Tagged exercise libraries

Ready-to-import files for the **Library** tab → **Import JSON**.

Both cover the 42 exercises used across this app's routines and logged sessions, with
target muscles and assisting muscles filled in. Import them with **update** mode.

| file | what it sets |
|---|---|
| `my-exercises-muscles-only.json` | **target + other muscles only.** Nothing else is mentioned, so `update` mode cannot change how anything is measured or loaded. The safe one. |
| `my-exercises-full.json` | the above **plus** `measure`, `bodyweight` and `unilateral` — which corrects stretches that were set to reps, bodyweight movements marked as loaded, and single-side movements marked bilateral. |

Import mode matters: **update** only overwrites the fields each record actually
mentions (see `mentioned()` in `js/exercisestore.js`), which is why the muscles-only
file is non-destructive by construction rather than by promise.

These are data, not code — nothing here is loaded by the app at runtime, and the
folder can be deleted once imported.
