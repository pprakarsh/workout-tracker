// "Setup" — the hub for the three things you configure rather than do.
//
// Seven tabs was one or two too many: at 375px each tab had about 53px, which
// forced 10px labels and an ellipsis, and the bar is the most-tapped control in
// the app. The fix is not smaller text, it is fewer tabs.
//
// The split is by HOW OFTEN AND WHEN, not by subject matter:
//
//   in the bar   Now, Session, Plan, History, Trends -- touched during or
//                around training, often several times a session
//   in here      Routines, Exercise library, Settings -- set up once, revisited
//                occasionally and deliberately
//
// Each row carries live counts rather than just a name, so the hub answers
// "is there anything to do in there?" without being opened.
import { state } from '../store.js';
import { dataFingerprint } from '../backupstore.js';
import { syncState } from '../sync.js';
import { exerciseLibrary } from '../queries.js';
import { exerciseFor } from '../store.js';
import { findDuplicates } from '../exercisemerge.js';
import { esc, fmtNum, APP_VERSION } from '../util.js';

const rowBody = (icon, title, sub, badge = '') => `
    <div class="setup-ico" aria-hidden="true">${icon}</div>
    <div class="body">
      <div class="nm">${esc(title)}${badge ? ` <span class="pill warn">${esc(badge)}</span>` : ''}</div>
      <div class="sub dim">${sub}</div>
    </div>
    <div class="dim">›</div>`;

/**
 * What in here is asking to be dealt with, if anything.
 *
 * Shared with the tab bar, which shows a dot when this is non-empty. Depth
 * behind a hub tab is invisible otherwise: the whole cost of folding three
 * screens behind one button is that nothing in there can ask for attention.
 *
 * Deliberately only things with a next action and a real consequence. A count
 * that is merely low ("you have two routines") is not attention, it is noise,
 * and a dot that is always on is a dot that is never read.
 */
export function needsAttention() {
  const out = [];
  const fp = dataFingerprint();
  if (fp.sessions >= 3 && !syncState().configured) out.push('no backup yet');
  const untagged = state.exercises.filter((x) => !x.primary.length).length;
  if (untagged) out.push(`${untagged} exercise${untagged === 1 ? '' : 's'} need muscle tags`);
  const dupes = findDuplicates().length;
  if (dupes) out.push(`${dupes} duplicate name${dupes === 1 ? '' : 's'}`);
  return out;
}

export function render() {
  const s = state.settings;
  const fp = dataFingerprint();
  const sync = syncState();
  const untagged = state.exercises.filter((x) => !x.primary.length).length;
  const unknown = exerciseLibrary().filter((x) => !exerciseFor(x.key)).length;
  const dupes = findDuplicates().length;
  const attention = needsAttention();

  const libSub = state.exercises.length
    ? `${state.exercises.length} described${unknown ? ` · ${unknown} not yet in it` : ''}`
    : 'Not set up — describe what each exercise is';
  const libBadge = untagged ? `${untagged} need tags` : dupes ? `${dupes} duplicate${dupes === 1 ? '' : 's'}` : '';

  return `
    <h2>Set up</h2>
    ${attention.length ? `
      <div class="card attn">
        <div class="tiny">Worth dealing with</div>
        <ul class="attn-list">${attention.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        <p class="hint" style="margin:6px 0 0">None of these stops you training. They are here
          because the dot on this tab means these, and nothing else.</p>
      </div>` : ''}
    <div class="setup-row" data-action="routines-go" role="button" tabindex="0">
      ${rowBody('📋', 'Routines', state.routines.length
    ? `${state.routines.length} routine${state.routines.length === 1 ? '' : 's'} · ${fp.sessions} session${fp.sessions === 1 ? '' : 's'} logged`
    : 'No routines yet — create your first')}
    </div>
    <div class="setup-row" data-action="library-go" role="button" tabindex="0">
      ${rowBody('📚', 'Exercise library', libSub, libBadge)}
    </div>
    <div class="setup-row" data-action="settings-go" role="button" tabindex="0">
      ${rowBody('⚙', 'Settings',
    `${esc(s.unit)} · ${esc(s.distanceUnit)} · rest ${fmtNum(Math.round(s.defaultRest / 60))} min`
    + ` · ${s.firstSide === 'R' ? 'right' : 'left'} side first`)}
    </div>

    <h2>This device</h2>
    <div class="card">
      <div class="kv"><span>Logged</span><span class="strong">${fp.sessions} session${fp.sessions === 1 ? '' : 's'} · ${fp.loggedSets} sets</span></div>
      <div class="kv"><span>Exercise library</span><span>${fp.exercises}</span></div>
      <div class="kv"><span>Sync</span><span>${sync.gistId
    ? `on · ${sync.lastPushedAt ? 'pushed' : 'never pushed'}`
    : '<span class="dim">not set up</span>'}</span></div>
      <div class="kv"><span>App version</span><span class="dim">build ${esc(APP_VERSION)}</span></div>
      <p class="hint" style="margin-bottom:0">Everything lives on this device. Backup, export and
        device-to-device sync are under <b>Routines</b>.</p>
    </div>`;
}

export const setupActions = {
  'routines-go': () => { state.nav = {}; state.tab = 'routines'; },
};
