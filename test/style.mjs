// Guards the CSS rules that decide whether anything is visible at all.
// jsdom does no layout, but it does resolve the cascade for `display`, which is
// enough to catch overlays that ignore the `hidden` attribute.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

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
ok(document.querySelectorAll('#tabBar .tab').length === 4, 'four tab buttons exist');

console.log('\n== no stray CSS placeholders');
ok(!/#1f3character|TODO|FIXME/.test(css), 'no broken colour values or leftover markers');
const openBraces = (css.match(/\{/g) || []).length;
const closeBraces = (css.match(/\}/g) || []).length;
ok(openBraces === closeBraces, `braces balanced (${openBraces} open / ${closeBraces} close)`);

console.log('\n== offline manifest covers every shipped file');
const sw = readFileSync(`${APP}/sw.js`, 'utf8');
const listed = new Set([...sw.matchAll(/^\s*'([^']+)',/gm)].map((m) => m[1]));
const { readdirSync, statSync } = await import('node:fs');
const walk = (dir, prefix = '') => readdirSync(dir).flatMap((n) => {
  const full = `${dir}/${n}`;
  const rel = prefix ? `${prefix}/${n}` : n;
  if (statSync(full).isDirectory()) return n === 'test' || n === 'node_modules' || n.startsWith('.') ? [] : walk(full, rel);
  return /\.(js|css|html|webmanifest|png)$/.test(n) ? [rel] : [];
});
const shipped = walk(APP).filter((f) => f !== 'sw.js');
const missing = shipped.filter((f) => !listed.has(f));
ok(missing.length === 0, `every file is in the service worker list${missing.length ? ` — missing: ${missing.join(', ')}` : ` (${shipped.length} files)`}`);
ok(/network-first|fetch\(req\)\s*$|fetch\(req\)\n/.test(sw) || sw.includes('fetch(req)'), 'service worker goes to the network before the cache');
ok(/const CACHE = 'workout-v\d+'/.test(sw), 'cache name is versioned');

console.log(`\n${failures === 0 ? 'ALL STYLE CHECKS PASSED' : `${failures} STYLE CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
