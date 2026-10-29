// "Settings" — its own screen, reached from the gear in the header.
//
// Not a seventh tab on purpose. Six tabs is already past what a phone tab bar
// comfortably holds, and settings is a place you visit rarely and leave; the
// gear is one tap from anywhere, which is strictly better reach than a tab you
// have to hunt for among seven. `state.tab` still drives it, so it is a real
// screen with its own title, not a modal you lose by tapping outside.
import { state, updateSettings, dataFingerprint } from '../store.js';
import { syncState } from '../sync.js';
import { esc, fmtNum, fmtClock, parseDur, relDay, APP_VERSION } from '../util.js';
import { toast } from '../ui.js';

const sel = (name, value, opts, label, hint = '') => `
  <label class="field"><span>${label}</span>
    <select data-cf="${name}">
      ${opts.map(([v, t]) => `<option value="${v}" ${String(value) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select></label>
  ${hint ? `<p class="hint" style="margin-top:-4px">${hint}</p>` : ''}`;

export function render() {
  const s = state.settings;
  const sync = syncState();
  const fp = dataFingerprint();

  return `
    <div class="card flat" style="margin-bottom:12px">
      <div class="row">
        <div style="flex:1;min-width:0">
          <div class="strong" style="font-size:16px">Settings</div>
          <div class="small dim">changes save as you make them</div>
        </div>
        <button type="button" class="btn sm ghost" data-action="settings-close">Done</button>
      </div>
    </div>

    <h2>Units</h2>
    <div class="card">
      <div class="grid2">
        ${sel('unit', s.unit, [['kg', 'kg'], ['lb', 'lb']], 'Weight')}
        ${sel('distanceUnit', s.distanceUnit, [['km', 'km'], ['mi', 'mi']], 'Distance')}
      </div>
      <p class="hint" style="margin-bottom:0">The unit is stored on each set as you log it, so
        switching never rewrites your history. Charts and totals convert older sets into whichever
        unit is selected here.</p>
    </div>

    <h2>Logging</h2>
    <div class="card">
      ${sel('prefillFrom', s.prefillFrom, [
    ['last', 'What you did last time'],
    ['plan', "The routine's targets"],
  ], 'Fill new sets with', `When a session opens, every set arrives already filled in so logging is
      confirming rather than typing. <b>Last time</b> starts you where you actually finished;
      <b>targets</b> starts you at what the routine asks for.
      <br><span class="dim">Either way the NUMBER of sets always comes from the routine, so cutting
      a session short never shrinks the plan. Your routine is never edited by logging.</span>`)}
      ${sel('effortScale', s.effortScale, [
    ['rpe', 'RPE only'], ['rir', 'RIR only'], ['both', 'Both'],
  ], 'Effort logged per set', `RPE is how hard a set felt (1-10). RIR is how many reps you had
      left. Two scales for the same thing, stored separately &mdash; nothing is ever converted
      between them.`)}
      <label class="field"><span>Weight step for the +/- buttons</span>
        <input data-cf="weightStep" inputmode="decimal" value="${esc(fmtNum(s.weightStep))}"></label>
    </div>

    <h2>Rest timer</h2>
    <div class="card">
      <label class="field"><span>Default rest when a routine sets none &mdash; 2:00, 90s, or seconds</span>
        <input data-cf="defaultRest" inputmode="text" placeholder="2:00"
               value="${esc(fmtClock(s.defaultRest))}"></label>
      ${sel('beep', s.beep ? '1' : '0', [['1', 'On'], ['0', 'Off']], 'Beep when the target is reached')}
      ${sel('keepAwake', s.keepAwake === false ? '0' : '1', [['1', 'On'], ['0', 'Off']], 'Keep the screen awake while training',
    'Stops the phone locking between sets. Supported on iOS 16.4 and later.')}
    </div>

    <h2>Sync</h2>
    <div class="card">
      <div class="kv"><span>Status</span><span class="strong">${esc(sync.label)}</span></div>
      ${sync.lastAt ? `<div class="kv"><span>Last synced</span><span>${esc(relDay(sync.lastAt))}</span></div>` : ''}
      <div class="kv"><span>On this device</span>
        <span>${fp.routines} routines · ${fp.sessions} sessions · ${fp.loggedSets} sets</span></div>
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn" data-action="sync-setup">Sync settings</button>
        ${sync.configured ? '<button type="button" class="btn ghost" data-action="sync-now">Sync now</button>' : ''}
      </div>
      <p class="hint" style="margin-bottom:0">Routines, the plan and finished sessions push on their
        own a few seconds after they change, and pull when you open the app or bring it back to the
        front. Nothing pushes mid-workout &mdash; the session goes up when you finish it.</p>
    </div>

    <h2>Data</h2>
    <div class="card">
      <div class="btn-row">
        <button type="button" class="btn" data-action="export-backup">Backup JSON</button>
        <button type="button" class="btn" data-action="hist-csv">Export CSV</button>
        <button type="button" class="btn" data-action="import-open">Import</button>
      </div>
      <p class="hint" style="margin-bottom:0">All data lives on this device. Nothing leaves it
        except when you tap one of these, or through the gist sync you set up above.</p>
    </div>

    <p class="hint center" style="margin-top:18px">
      <span class="dim">build ${esc(APP_VERSION)}</span></p>`;
}

export const settingsActions = {
  'settings-close': () => { state.tab = state.lastTab || 'now'; },
  'settings-go': () => {
    state.lastTab = state.tab === 'settings' ? (state.lastTab || 'now') : state.tab;
    state.tab = 'settings';
  },
};

/**
 * Field edits here save immediately -- there is no Save button, because a
 * settings screen with one invites you to leave without pressing it. Called
 * from the field router in app.js.
 */
export async function handleSettingsField(target) {
  const field = target.dataset.cf;
  if (!field) return;
  const v = target.value;
  const patch = {};
  if (field === 'beep' || field === 'keepAwake') patch[field] = v === '1';
  else if (field === 'defaultRest') patch[field] = parseDur(v) ?? 120;
  else if (field === 'weightStep') patch[field] = Math.abs(Number(v)) || 2.5;
  else patch[field] = v;
  // a text field is mid-edit: save without repainting, or the keyboard closes
  const isSelect = target.tagName === 'SELECT';
  await updateSettings(patch, { silent: !isSelect });
  if (isSelect) toast('Saved');
}
