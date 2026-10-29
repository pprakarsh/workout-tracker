// Charts, as SVG strings. No dependency, no canvas, no build step.
//
// Pure functions in, markup out: nothing here touches the DOM or the store, so
// a chart can be asserted in a test by reading the string. A `viewBox` with no
// width or height does the responsive work -- the browser scales the whole
// drawing to whatever the card is wide, which is why none of this needs to know
// the screen size.
//
// Deliberately plain: no gradients, no animation, no tooltips. A touch target
// on a 6px dot does not exist on a phone, so the exact numbers live in a table
// beside the chart and the chart is there for the SHAPE of the thing. That also
// makes the accessible version free -- the table IS the data, and the svg is
// labelled `role="img"` with a one-line summary.
import { esc, fmtNum } from './util.js';

const W = 320;      // logical units; the viewBox scales them
const H = 150;
const PAD = { l: 34, r: 8, t: 10, b: 18 };
const PLOT = { w: W - PAD.l - PAD.r, h: H - PAD.t - PAD.b };

const round1 = (n) => Math.round(n * 10) / 10;

/** Nice-ish bounds: pad the range by 6% so points never sit on the frame. */
function bounds(values) {
  const nums = values.filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  let lo = Math.min(...nums);
  let hi = Math.max(...nums);
  if (lo === hi) { lo -= Math.max(1, Math.abs(lo) * 0.05); hi += Math.max(1, Math.abs(hi) * 0.05); }
  const pad = (hi - lo) * 0.06;
  return { lo: lo - pad, hi: hi + pad };
}

const scaler = (lo, hi, from, to) => (v) => from + ((v - lo) / (hi - lo)) * (to - from);

function frame(yLo, yHi, yFmt, xLeft, xRight) {
  const y = scaler(yLo, yHi, PAD.t + PLOT.h, PAD.t);
  const mid = (yLo + yHi) / 2;
  const line = (v) => `<line x1="${PAD.l}" y1="${round1(y(v))}" x2="${W - PAD.r}" y2="${round1(y(v))}" class="cg"/>`;
  const label = (v) => `<text x="${PAD.l - 4}" y="${round1(y(v)) + 3}" class="cyl">${esc(yFmt(v))}</text>`;
  return `
    ${line(yLo)}${line(mid)}${line(yHi)}
    ${label(yHi)}${label(mid)}${label(yLo)}
    <text x="${PAD.l}" y="${H - 5}" class="cxl">${esc(xLeft)}</text>
    <text x="${W - PAD.r}" y="${H - 5}" class="cxl" text-anchor="end">${esc(xRight)}</text>`;
}

/**
 * Scatter of every point, with a highlighted series joined by a line.
 *
 * points:  [{ x, y, dim }]      every working set; `dim` draws it hollow
 * best:    [{ x, y, pr }]       one per session; `pr` rings the all-time best
 * x is any number (a timestamp); y is the metric.
 */
export function linePlot({
  points = [], best = [], yFmt = fmtNum, xLeft = '', xRight = '', label = '',
} = {}) {
  const yb = bounds([...points.map((p) => p.y), ...best.map((p) => p.y)]);
  const xb = bounds([...points.map((p) => p.x), ...best.map((p) => p.x)]);
  if (!yb || !xb) return '';
  const x = scaler(xb.lo, xb.hi, PAD.l, W - PAD.r);
  const y = scaler(yb.lo, yb.hi, PAD.t + PLOT.h, PAD.t);
  const path = best.length > 1
    ? `<polyline class="cline" points="${best.map((p) => `${round1(x(p.x))},${round1(y(p.y))}`).join(' ')}"/>`
    : '';
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${frame(yb.lo, yb.hi, yFmt, xLeft, xRight)}
      ${path}
      ${points.map((p) => `<circle class="cdot${p.dim ? ' dim' : ''}" cx="${round1(x(p.x))}" cy="${round1(y(p.y))}" r="2.4"/>`).join('')}
      ${best.map((p) => `<circle class="cbest${p.pr ? ' pr' : ''}" cx="${round1(x(p.x))}" cy="${round1(y(p.y))}" r="${p.pr ? 4.6 : 3.4}"/>`).join('')}
    </svg>`;
}

/**
 * Bars, one per bucket. Used for volume and sets per week, where the thing
 * being compared is a total over a period rather than a moment in time.
 */
export function barPlot({ bars = [], yFmt = fmtNum, label = '' } = {}) {
  const vals = bars.map((b) => b.v);
  if (!vals.length) return '';
  const hi = Math.max(...vals, 1);
  const y = scaler(0, hi, PAD.t + PLOT.h, PAD.t);
  const slot = PLOT.w / bars.length;
  const bw = Math.max(2, Math.min(18, slot * 0.62));
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${frame(0, hi, yFmt, bars[0].label || '', bars[bars.length - 1].label || '')}
      ${bars.map((b, i) => {
    const cx = PAD.l + (slot * i) + (slot / 2);
    const top = round1(y(b.v));
    const h = Math.max(0, round1(PAD.t + PLOT.h - top));
    return `<rect class="cbar${b.now ? ' now' : ''}" x="${round1(cx - bw / 2)}" y="${top}"
      width="${round1(bw)}" height="${h}" rx="2"><title>${esc(`${b.label}: ${yFmt(b.v)}`)}</title></rect>`;
  }).join('')}
    </svg>`;
}
