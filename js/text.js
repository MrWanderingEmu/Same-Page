/* Typed text that sits on the paper's lines, the way a student would write it.
   A text block is an item in pg.strokes, like a picture:
     { t:'text', s: the words, f: 'print' | 'cursive' | 'plain', c: colour, x, r, w }
   x = left edge (mm), r = the row its first line sits on, w = width it wraps at (mm).
   Where the rows are and how big the letters are come from the page's paper when it's drawn,
   so if the paper or its spacing changes, the text moves onto the new lines by itself.
     ruled, grid   letters sit on each line; small letters about 0.42 of the gap
     thirds        small letters fill the middle third, tall ones reach the head line
     two dotted    letters rest on the bottom solid line: small letters fill the bottom third,
                   tall ones reach into the middle third, tails hang into the next row
     sky           small letters fill the grass, tall ones reach the sky, tails go into the dirt
     blank, PDF    as if ruled at 8 mm
   Pure layout and drawing: no storage or DOM beyond a canvas for measuring. */
import { pageSize, TOP_GAP } from './config.js';

export const FONTS = {
  print:   { label: 'Print',   family: '"Same Page Print", "Comic Sans MS", sans-serif', note: 'Label print, like the early years' },
  cursive: { label: 'Cursive', family: '"Same Page Cursive", cursive', note: 'Victorian-style cursive, from Year 3 or 4' },
  plain:   { label: 'Plain',   family: 'Arial, "Helvetica Neue", Helvetica, sans-serif', note: 'Plain type for older students' },
};
export const fontOf = s => FONTS[s.f] || FONTS.print;

/* The rows on a page: base(r) = where row r's letters sit (mm), xh = small-letter height,
   rows = how many fit, rowAt(y) = the (fractional) row at height y. */
export function guide(pg) {
  const [, H] = pageSize(pg), t = pg.bg ? 'blank' : pg.tpl;
  const sp = (pg.spacing && pg.spacing[t]) || 8;
  let first, step, xh;
  if (t === 'thirds') { first = TOP_GAP + 2 * sp; step = 3 * sp; xh = sp; }
  else if (t === 'thirds2') { first = TOP_GAP + 3 * sp; step = 3 * sp; xh = sp; }
  else if (t === 'sky') { first = TOP_GAP + 2 * sp; step = 3 * sp; xh = sp; }
  else if (t === 'grid') { first = (H % sp) / 2 + Math.ceil((TOP_GAP - (H % sp) / 2) / sp) * sp; step = sp; xh = 0.42 * sp; }
  else if (t === 'ruled') { first = TOP_GAP; step = sp; xh = 0.42 * sp; }
  else { first = TOP_GAP; step = 8; xh = 3.4; }
  const rows = Math.max(0, Math.floor((H - 4 - first) / step) + 1);
  return { first, step, xh, rows, base: r => first + r * step, rowAt: y => (y - first) / step };
}

/* --- measuring --- */
const mctx = document.createElement('canvas').getContext('2d');
const SCALE = 10;                     // text is measured and drawn 10× larger, then scaled down: fine sizes at small mm
const xRatio = {};                    // small-letter height as a fraction of the font size, per style
function ratio(f) {
  if (!xRatio[f]) {
    mctx.font = `100px ${FONTS[f].family}`;
    const m = mctx.measureText('x').actualBoundingBoxAscent;
    if (!fontsReady) return m > 0 ? m / 100 : 0.5;    // don't cache a fallback font's figure
    xRatio[f] = m > 0 ? m / 100 : 0.5;
  }
  return xRatio[f];
}
let fontsReady = false;
const cache = new WeakMap();          // item -> { key, lines, width }
/* Loads the two handwriting fonts; calls done() when they're ready so pages can be redrawn. */
export function loadFonts(done) {
  if (!document.fonts || !document.fonts.load) { fontsReady = true; return; }
  Promise.all(['print', 'cursive'].map(f => document.fonts.load(`20px ${FONTS[f].family}`)))
    .catch(() => {}).then(() => { fontsReady = true; for (const k in xRatio) delete xRatio[k]; done && done(); });
}

/* The font size (mm) for a block on a page. */
export const sizeOn = (pg, s) => guide(pg).xh / ratio(s.f in FONTS ? s.f : 'print');

/* Breaks the words into lines no wider than w (mm) at font size fs (mm). Keeps the writer's own line breaks. */
function wrap(s, fs) {
  const key = `${fs.toFixed(3)}|${s.w}|${s.f}|${fontsReady}`, hit = cache.get(s);
  if (hit && hit.key === key) return hit;
  mctx.font = `${fs * SCALE}px ${fontOf(s).family}`;
  const width = t => mctx.measureText(t).width / SCALE, lines = [];
  for (const para of String(s.s).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const next = line ? line + ' ' + word : word;
      if (!line || width(next) <= s.w) { line = next; }
      else { lines.push(line); line = word; }
      while (width(line) > s.w && line.length > 1) {          // a word longer than the line: break it
        let n = line.length - 1;
        while (n > 1 && width(line.slice(0, n)) > s.w) n--;
        lines.push(line.slice(0, n)); line = line.slice(n);
      }
    }
    lines.push(line);
  }
  const out = { key, lines, width: Math.max(0, ...lines.map(width)) };
  cache.set(s, out);
  return out;
}

/* Where a block's lines go on a page: [{ text, y }] for the lines that fit, and how many didn't. */
export function layout(pg, s) {
  const g = guide(pg), fs = sizeOn(pg, s), { lines, width } = wrap(s, fs);
  const shown = [];
  lines.forEach((text, i) => { const r = s.r + i; if (r >= 0 && r < g.rows) shown.push({ text, y: g.base(r) }); });
  return { fs, lines: shown, width, cut: lines.length - shown.length, all: lines.length };
}

/* The box a block covers (mm), for selecting it. */
export function textBox(pg, s) {
  const g = guide(pg), fs = sizeOn(pg, s), { lines, width } = wrap(s, fs);
  const top = g.base(s.r) - fs * 0.95, bottom = g.base(s.r + Math.max(1, lines.length) - 1) + fs * 0.3;
  return { x0: s.x, y0: top, x1: s.x + Math.max(width, 2), y1: Math.max(bottom, top + 2) };
}

export function drawText(ctx, pg, s) {
  if (!pg) return;
  const { fs, lines } = layout(pg, s);
  ctx.save();
  ctx.fillStyle = s.c; ctx.textBaseline = 'alphabetic';
  ctx.font = `${fs * SCALE}px ${fontOf(s).family}`;
  for (const l of lines) {
    ctx.save(); ctx.translate(s.x, l.y); ctx.scale(1 / SCALE, 1 / SCALE);
    ctx.fillText(l.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/* A text block checked from storage or a file, or null. */
export function cleanText(s) {
  if (!s || typeof s.s !== 'string' || ![s.x, s.r, s.w].every(isFinite) || typeof s.c !== 'string') return null;
  return { t: 'text', s: s.s.slice(0, 5000), f: s.f in FONTS ? s.f : 'print', c: s.c, x: +s.x, r: Math.max(0, Math.round(s.r)), w: Math.max(10, +s.w) };
}
