// Guards the CSS rules that decide whether anything is visible at all.
// jsdom does no layout, but it does resolve the cascade for `display`, which is
// enough to catch overlays that ignore the `hidden` attribute.
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync } from 'node:fs';

const APP = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const html = readFileSync(`${APP}/index.html`, 'utf8');
const css = readFileSync(`${APP}/css/styles.css`, 'utf8');

// Inline the stylesheet so jsdom applies it without needing to fetch.
const dom = new JSDOM(html.replace('</head>', `<style>${css}</style></head>`), {
  url: 'https://example.test/',
  pretendToBeVisual: true,
});
const { document, getComputedStyle } = dom.window;

let failures = 0;
const ok = (c, l) => { if (c) console.log(`  ok   ${l}`); else { failures++; console.log(`  FAIL ${l}`); } };
const display = (id) => getComputedStyle(document.getElementById(id)).display;

console.log('\n== overlays must obey the hidden attribute');
for (const id of ['modalRoot', 'restBar', 'toast']) {
  const el = document.getElementById(id);
  ok(el.hasAttribute('hidden'), `#${id} starts hidden in the markup`);
  ok(display(id) === 'none', `#${id} computes to display:none while hidden (got "${display(id)}")`);
  el.removeAttribute('hidden');
  ok(display(id) !== 'none', `#${id} becomes visible when shown (got "${display(id)}")`);
  el.setAttribute('hidden', '');
  ok(display(id) === 'none', `#${id} hides again (got "${display(id)}")`);
}

console.log('\n== the shell itself must be visible');
ok(display('viewRoot') !== 'none', `#viewRoot is visible (${display('viewRoot')})`);
ok(display('tabBar') === 'flex', `#tabBar lays out as flex (${display('tabBar')})`);
ok(display('appHeader') === 'flex', `#appHeader lays out as flex (${display('appHeader')})`);
ok(document.querySelectorAll('#tabBar .tab').length === 6, 'six tab buttons exist');

console.log('\n== no stray CSS placeholders');
ok(!/#1f3character|TODO|FIXME/.test(css), 'no broken colour values or leftover markers');
const openBraces = (css.match(/\{/g) || []).length;
const closeBraces = (css.match(/\}/g) || []).length;
ok(openBraces === closeBraces, `braces balanced (${openBraces} open / ${closeBraces} close)`);

const { readdirSync: _rd, statSync: _st } = await import('node:fs');
const walk = (dir, prefix = '') => _rd(dir).flatMap((n) => {
  const full = `${dir}/${n}`;
  const rel = prefix ? `${prefix}/${n}` : n;
  if (_st(full).isDirectory()) return walk(full, rel);
  return n.endsWith('.js') ? [rel] : [];
});

console.log('\n== offline manifest covers every shipped file');
const sw = readFileSync(`${APP}/sw.js`, 'utf8');
const listed = new Set([...sw.matchAll(/^\s*'([^']+)',/gm)].map((m) => m[1]));
const walkShipped = (dir, prefix = '') => _rd(dir).flatMap((n) => {
  const full = `${dir}/${n}`;
  const rel = prefix ? `${prefix}/${n}` : n;
  if (_st(full).isDirectory()) return n === 'test' || n === 'node_modules' || n.startsWith('.') ? [] : walkShipped(full, rel);
  return /\.(js|css|html|webmanifest|png)$/.test(n) ? [rel] : [];
});
const shipped = walkShipped(APP).filter((f) => f !== 'sw.js');
const missing = shipped.filter((f) => !listed.has(f));
ok(missing.length === 0, `every file is in the service worker list${missing.length ? ` — missing: ${missing.join(', ')}` : ` (${shipped.length} files)`}`);
ok(/network-first|fetch\(req\)\s*$|fetch\(req\)\n/.test(sw) || sw.includes('fetch(req)'), 'service worker goes to the network before the cache');
ok(/const CACHE = 'workout-v\d+'/.test(sw), 'cache name is versioned');

console.log('\n== shell scripts must stay ASCII');
const sh = readFileSync(`${APP}/deploy.sh`, 'utf8');
const nonAscii = [...sh].map((c, i) => [c, i]).filter(([c]) => c.charCodeAt(0) > 126);
// macOS ships bash 3.2, which folds the bytes of a non-ASCII character that
// directly follows a variable into the variable name: "$BRANCH<ellipsis>"
// became an unbound-variable error under `set -u`.
ok(nonAscii.length === 0,
  `deploy.sh is pure ASCII${nonAscii.length ? ` — found ${nonAscii.map(([c]) => JSON.stringify(c)).join(', ')}` : ''}`);
ok(/^set -euo pipefail$/m.test(sh), 'deploy.sh fails fast on errors and unset variables');

console.log('\n== test suites must be loadable');
// A suite with two top-level `const x` at module scope throws SyntaxError before
// its first assertion, printing neither a pass nor a failure. That silence once
// shipped a release. These files are long and append-only, so collisions are
// easy; this catches them without running anything.
//
// Destructuring counts: `const [hPlank, hCurl] = ...` binds two names, and an
// earlier version of this check only looked at plain `const x =`, so a repeated
// `const [hPlank, ...]` sailed past it and crashed the suite anyway.
const bindingsIn = (line) => {
  const m = line.match(/^(?:const|let)\s+(\[[^\]]*\]|\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=/);
  if (!m) return [];
  const target = m[1];
  if (!/^[[{]/.test(target)) return [target];
  return target.slice(1, -1).split(',')
    // `{ state }` and `{ a: b }` both bind the LAST identifier of the part
    .map((part) => (part.split(':').pop().match(/[A-Za-z_$][\w$]*/) || [])[0])
    .filter(Boolean);
};
for (const suite of ['style.mjs', 'smoke.mjs', 'sync.mjs', 'dom.mjs']) {
  const lines = readFileSync(`${APP}/test/${suite}`, 'utf8').split('\n');
  const seen = new Map();
  const dupes = [];
  lines.forEach((line, i) => {
    for (const name of bindingsIn(line)) {
      if (seen.has(name)) dupes.push(`${name} (lines ${seen.get(name)} and ${i + 1})`);
      else seen.set(name, i + 1);
    }
  });
  ok(dupes.length === 0,
    `${suite} declares each top-level binding once${dupes.length ? ` — repeated: ${dupes.join(', ')}` : ` (${seen.size})`}`);
}

console.log('\n== release invariants');
const utilSrc = readFileSync(`${APP}/js/util.js`, 'utf8');
const appVersion = (utilSrc.match(/APP_VERSION = '([^']+)'/) || [])[1];
const cacheName = (sw.match(/const CACHE = '([^']+)'/) || [])[1];
ok(!!appVersion, `APP_VERSION is set (${appVersion})`);
// Bumping one and not the other means users get a stale app or a pointless cache wipe.
ok(cacheName === `workout-v${appVersion}`,
  `sw.js CACHE matches APP_VERSION (CACHE="${cacheName}", expected "workout-v${appVersion}")`);

console.log('\n== action registry integrity');
const viewFiles = ['js/views/entry.js', 'js/views/cardio.js', 'js/views/now.js', 'js/views/session.js',
  'js/views/plan.js', 'js/views/history.js', 'js/views/trends.js', 'js/views/routines.js',
  'js/views/settings.js', 'js/views/exform.js', 'js/views/library.js', 'js/views/setup.js',
  'js/views/newroutine.js', 'js/nudges.js', 'js/views/howitworks.js', 'js/glossary.js', 'js/timer.js'];
const sources = Object.fromEntries(viewFiles.map((f) => [f, readFileSync(`${APP}/${f}`, 'utf8')]));
const allSource = Object.values(sources).join('\n');

// handlers declared in an *Actions map, e.g.  'set-add': async (...
const declared = new Map();
for (const [file, src] of Object.entries(sources)) {
  for (const m of src.matchAll(/^ {2}'([a-z][a-z0-9-]*)':/gm)) {
    if (declared.has(m[1])) {
      failures++;
      console.log(`  FAIL action "${m[1]}" declared twice (${declared.get(m[1])} and ${file}) — one silently shadows the other`);
    }
    declared.set(m[1], file);
  }
}
ok(declared.size > 40, `${declared.size} actions declared across the view modules`);

// actions referenced from rendered markup
// index.html carries the app shell's own buttons (the settings gear), so it is
// markup the registry has to be checked against as well.
const used = new Set([...`${allSource}\n${html}`.matchAll(/data-action="([a-z][a-z0-9-]*)"/g)].map((m) => m[1]));
// plus the ones dispatched from code rather than markup
const dispatched = new Set([...allSource.matchAll(/entryActions\['([a-z-]+)'\]/g)].map((m) => m[1]));
const appSrc = readFileSync(`${APP}/js/app.js`, 'utf8');
const builtin = new Set(['tab']); // app.js handles the tab bar itself

const orphanUsed = [...used].filter((a) => !declared.has(a) && !builtin.has(a));
ok(orphanUsed.length === 0,
  `every data-action has a handler${orphanUsed.length ? ` — missing: ${orphanUsed.join(', ')}` : ''}`);

const unreachable = [...declared.keys()]
  .filter((a) => !used.has(a) && !dispatched.has(a) && !builtin.has(a));
ok(unreachable.length === 0,
  `every handler is reachable from markup${unreachable.length ? ` — dead: ${unreachable.join(', ')}` : ''}`);

// every actions map must actually be merged into ACTIONS in app.js
for (const map of ['entryActions', 'cardioActions', 'nowActions', 'sessionActions', 'planActions',
  'historyActions', 'trendsActions', 'settingsActions', 'routineActions', 'libraryActions',
  'setupActions', 'newRoutineActions', 'howActions',
  'timerActions']) {
  ok(appSrc.includes(map), `${map} is merged into the ACTIONS registry`);
}

console.log('\n== documentation exists and points at real things');
for (const doc of ['README.md', 'ARCHITECTURE.md', 'AGENTS.md', 'ROADMAP.md']) {
  const body = readFileSync(`${APP}/${doc}`, 'utf8');
  ok(body.length > 500, `${doc} is present (${Math.round(body.length / 1024)} KB)`);
  // every js/... path a doc mentions must exist
  const referenced = [...body.matchAll(/`?(js\/[\w./]+\.js)`?/g)].map((m) => m[1]);
  const missing = [...new Set(referenced)].filter((p) => !existsSync(`${APP}/${p}`));
  ok(missing.length === 0, `${doc} references only real files${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`);
}

console.log('\n== documentation matches the code it describes');
// These three checks exist because all three of these facts drifted silently.
// A wrong doc is worse than no doc: it is read as current and acted on.
const archDoc = readFileSync(`${APP}/ARCHITECTURE.md`, 'utf8');
const agentsDoc = readFileSync(`${APP}/AGENTS.md`, 'utf8');
const storeSrc = readFileSync(`${APP}/js/store.js`, 'utf8');
const dbSrc = readFileSync(`${APP}/js/db.js`, 'utf8');

// 1. every top-level key of `state` is documented
const stateBlock = (storeSrc.match(/export const state = \{([\s\S]*?)\n\};/) || [])[1] || '';
const stateKeys = [...stateBlock.matchAll(/^ {2}(\w+)[:,]/gm)].map((m) => m[1]);
const undocKeys = stateKeys.filter((k) => !new RegExp(`\\b${k}\\b`).test(archDoc));
ok(stateKeys.length > 10 && undocKeys.length === 0,
  `ARCHITECTURE.md documents all ${stateKeys.length} state keys${undocKeys.length ? ` — missing: ${undocKeys.join(', ')}` : ''}`);

// 2. the persistence table states the real DB version and store count
const dbVersion = (dbSrc.match(/DB_VERSION = (\d+)/) || [])[1];
const storeCount = (dbSrc.match(/createObjectStore/g) || []).length;
ok(new RegExp(`version \\*\\*${dbVersion}\\*\\*|version ${dbVersion}\\b`).test(archDoc),
  `ARCHITECTURE.md states DB version ${dbVersion}`);
const countWord = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][storeCount];
ok(new RegExp(`${countWord} stores`, 'i').test(archDoc),
  `and that there are ${countWord} (${storeCount}) object stores`);

// 3. every module that writes to IndexedDB is named in the AGENTS.md ownership
//    table. "Only store.js touches IndexedDB" survived six new peer stores.
const writers = ['js/store.js', 'js/planstore.js', 'js/cardiostore.js', 'js/clockstore.js',
  'js/backupstore.js', 'js/exercisestore.js', 'js/exercisemerge.js', 'js/sync.js', 'js/tombstones.js',
  'js/views/routines.js']
  .filter((f) => existsSync(`${APP}/${f}`));
const actualWriters = [...walk(`${APP}/js`).map((f) => `js/${f}`)]
  .filter((m) => /\b(dbPut|dbDel|dbClear|metaSet)\(/.test(readFileSync(`${APP}/${m}`, 'utf8')))
  .filter((m) => m !== 'js/db.js');
const unlisted = actualWriters.filter((m) => !agentsDoc.includes(m));
ok(unlisted.length === 0,
  `AGENTS.md lists every direct IndexedDB writer (${actualWriters.length})${unlisted.length ? ` — missing: ${unlisted.join(', ')}` : ''}`);
// A listed module must still be a store: it either writes the database itself or
// persists through the store's touch(). Not every peer does its own db calls --
// cardiostore mutates nested session data and lets touch() write it -- so the
// looser test is the honest one.
const stale = [...agentsDoc.matchAll(/`(js\/[\w]+store\.js|js\/exercisemerge\.js)`/g)]
  .map((m) => m[1])
  .filter((f, i, a) => a.indexOf(f) === i)
  .filter((f) => {
    if (!existsSync(`${APP}/${f}`)) return true;
    const src = readFileSync(`${APP}/${f}`, 'utf8');
    return !/\b(dbPut|dbDel|dbClear|metaSet|touch|emit)\(/.test(src);
  });
ok(stale.length === 0,
  `and every store it lists still persists something${stale.length ? ` — stale: ${stale.join(', ')}` : ''}`);

console.log('\n== the backend contract covers what the code actually stores');
// A meta key with no declared scope is the bug this prevents: the first sync
// implementation would have had to guess, and guessing `timer` wrong lands a
// running rest clock on a device sitting in a drawer.
const schemaSrc = readFileSync(`${APP}/js/syncschema.js`, 'utf8');
const scopeBlock = (schemaSrc.match(/export const META_SCOPE = \{([\s\S]*?)\n\};/) || [])[1] || '';
const scoped = new Set([...scopeBlock.matchAll(/^\s*(\w+):\s*'(user|device)'/gm)].map((m) => m[1]));
const metaWritten = new Set();
for (const f of walk(`${APP}/js`)) {
  const src = readFileSync(`${APP}/js/${f}`, 'utf8');
  for (const m of src.matchAll(/meta(?:Set|Get)\('(\w+)'/g)) metaWritten.add(m[1]);
}
ok(metaWritten.size >= 6, `${metaWritten.size} meta keys are used by the code`);
const unscoped = [...metaWritten].filter((k) => !scoped.has(k));
ok(unscoped.length === 0,
  `every meta key has a declared sync scope${unscoped.length ? ` — undeclared: ${unscoped.join(', ')}` : ''}`);
const phantom = [...scoped].filter((k) => !metaWritten.has(k));
ok(phantom.length === 0,
  `and META_SCOPE names no key the code does not use${phantom.length ? ` — stale: ${phantom.join(', ')}` : ''}`);

// Every record store named in the contract must be a store db.js actually makes.
const storeNames = [...dbSrc.matchAll(/createObjectStore\('(\w+)'/g)].map((m) => m[1]);
const recordBlock = (schemaSrc.match(/export const RECORD_STORES = \[([^\]]*)\]/) || [])[1] || '';
const recordStores = [...recordBlock.matchAll(/'(\w+)'/g)].map((m) => m[1]);
const notAStore = recordStores.filter((n) => !storeNames.includes(n));
ok(recordStores.length > 0 && notAStore.length === 0,
  `RECORD_STORES names only real object stores${notAStore.length ? ` — missing: ${notAStore.join(', ')}` : ''}`);
ok(!recordStores.includes('meta'), 'and does not include meta, which is configuration rather than records');

console.log('\n== maintainability invariants');
const modules = [...walk(`${APP}/js`).map((f) => `js/${f}`)];
ok(modules.length >= 13, `${modules.length} app modules`);

// 1. one-way dependencies: nothing outside js/views may import a view.
// js/app.js is the composition root — wiring views together is its whole job.
const core = modules.filter((m) => !m.startsWith('js/views/') && m !== 'js/app.js');
const upward = core.filter((m) => /from '\.(\/|\.\/)?views\//.test(readFileSync(`${APP}/${m}`, 'utf8')));
ok(upward.length === 0,
  `no core module imports a view${upward.length ? ` — violated by: ${upward.join(', ')}` : ''}`);

// 2. the module map in ARCHITECTURE.md must list every module
const arch = readFileSync(`${APP}/ARCHITECTURE.md`, 'utf8');
const undocumented = modules.filter((m) => !arch.includes(m) && !arch.includes(m.replace('js/views/', '')));
ok(undocumented.length === 0,
  `ARCHITECTURE.md documents every module${undocumented.length ? ` — missing: ${undocumented.join(', ')}` : ''}`);

// 3. no module may grow past the hard cap; split it instead
const CAP = 1000;
const oversized = modules
  .map((m) => [m, readFileSync(`${APP}/${m}`, 'utf8').split('\n').length])
  .filter(([, n]) => n > CAP);
ok(oversized.length === 0,
  `every module is under ${CAP} lines${oversized.length ? ` — over: ${oversized.map(([m, n]) => `${m} (${n})`).join(', ')}` : ''}`);

// 4. no leftover debug logging; console.error/warn in a catch is fine
const debugLogs = modules.filter((m) => /console\.(log|debug|info)\(/.test(readFileSync(`${APP}/${m}`, 'utf8')));
ok(debugLogs.length === 0,
  `no stray console.log${debugLogs.length ? ` — found in: ${debugLogs.join(', ')}` : ''}`);

console.log(`\n${failures === 0 ? 'ALL STYLE CHECKS PASSED' : `${failures} STYLE CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
