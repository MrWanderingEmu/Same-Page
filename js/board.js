/* The page engine: sizes the sheets to the screen and paints them.
   There are always two sheets in the DOM. In one-page view only the first is shown;
   in two-page view they sit side by side as an open book, and each one shows a page,
   the inside front cover, or a faint blank page after the last one. */
import { $, $$ } from './util.js';
import { PAGE_W, PAGE_H, ERASER_SIZES } from './config.js';
import { state, spreadOf } from './state.js';
import { drawTemplate, drawStroke } from './draw.js';

export const stage = $('#stage');
const wrap = $('#pagewrap'), book = $('#book'), ecur = $('#ecursor'), folios = $$('#folios span');
export const view = { scale: 1, dpr: 1, w: 0, h: 0 };   // scale = CSS px per mm

/* kind: 'page' (pi = page index) | 'cover' | 'ghost' | 'off' */
export const sheets = $$('.sheet').map(el => {
  const [bg, ink, live] = ['bg', 'ink', 'live'].map(c => el.querySelector('canvas.' + c));
  return {
    el, bg, ink, live, pi: -1, kind: 'off',
    ctxBg: bg.getContext('2d'), ctxInk: ink.getContext('2d'),
    ctxLive: live.getContext('2d', { desynchronized: true }),   // lower pen latency where supported
  };
});

export function layout() {
  const sw = stage.clientWidth, sh = stage.clientHeight;
  if (!sw || !sh) return;
  const spread = state.spread;
  const pad = state.presenting ? 10 : 22;
  const cover = spread ? (state.presenting ? 8 : 10) : 0;          // cover showing around the pages
  const folioH = spread && !state.presenting ? 28 : 0;             // page numbers under the book
  const fitPage = state.presenting || state.view === 'page';
  const side = state.presenting ? 86 : pad;                        // keep clear of the floating toolbar
  const aw = sw - side * 2 - cover * 2, ah = sh - pad * 2 - cover * 2 - folioH;
  let w = aw / (spread ? 2 : 1);
  if (fitPage) w = Math.min(w, ah * PAGE_W / PAGE_H);
  w = Math.max(spread ? 120 : 160, Math.floor(w));
  const h = Math.round(w * PAGE_H / PAGE_W);

  stage.classList.toggle('fit', fitPage);
  book.classList.toggle('spread', spread);
  book.classList.toggle('single', !spread);
  book.style.setProperty('--cover-pad', cover + 'px');
  for (const s of sheets) { s.el.style.width = w + 'px'; s.el.style.height = h + 'px'; }
  folios.forEach(f => f.style.width = w + 'px');
  wrap.style.paddingTop = Math.max(pad, Math.floor((sh - h - cover * 2 - folioH) / 2)) + 'px';
  wrap.style.paddingBottom = pad + 'px';

  // Keep each canvas under ~9 megapixels (~6 in two-page view) so large screens stay fast.
  let dpr = window.devicePixelRatio || 1;
  dpr = Math.min(dpr, Math.sqrt((spread ? 6e6 : 9e6) / (w * h)));
  const changed = w !== view.w || h !== view.h || dpr !== view.dpr;
  view.w = w; view.h = h; view.dpr = dpr; view.scale = w / PAGE_W;
  if (changed) {
    for (const s of sheets) for (const c of [s.bg, s.ink, s.live]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  }
  renderAll();
}

function prep(ctx) {           // clear a canvas and set its units to millimetres
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const k = view.scale * view.dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
}

/* Decide what each sheet shows for the current page and view. */
function assignSheets() {
  const n = state.pages.length;
  const idx = state.spread ? spreadOf(state.cur) : [state.cur, null];
  sheets.forEach((s, i) => {
    const pi = idx[i];
    s.pi = pi;
    s.kind = pi === null ? 'off' : pi < 0 ? 'cover' : pi >= n ? 'ghost' : 'page';
    s.el.classList.toggle('off', s.kind === 'off');
    s.el.classList.toggle('cover', s.kind === 'cover');
    s.el.classList.toggle('ghost', s.kind === 'ghost');
  });
}

function renderBg(s) {
  prep(s.ctxBg);
  // The blank page after the last one previews the paper a new page would get.
  const pg = s.kind === 'page' ? state.pages[s.pi] : s.kind === 'ghost' ? state.pages[state.pages.length - 1] : null;
  if (pg) drawTemplate(s.ctxBg, pg, view.scale * view.dpr);
}
function renderInk(s, skip) {
  prep(s.ctxInk);
  if (s.kind === 'page') for (const st of state.pages[s.pi].strokes) if (!skip || !skip.has(st)) drawStroke(s.ctxInk, st);
}
export function clearLive(s) { prep(s.ctxLive); }

/* Something drawn on top of the ink (the lasso selection) that must survive a redraw. */
let overlay = null;
export const setOverlay = fn => { overlay = fn; };

export function renderAll() {
  assignSheets();
  for (const s of sheets) { renderBg(s); renderInk(s); clearLive(s); }
  updateFolios();
  if (overlay) overlay();
}
export const sheetFor = pg => sheets.find(s => s.kind === 'page' && state.pages[s.pi] === pg);
/* Redraws a page's ink; skip = a Set of strokes to leave out (e.g. ones being dragged). */
export function renderInkFor(pg, skip) {
  const s = sheetFor(pg);
  if (s) renderInk(s, skip);
  if (overlay && !skip) overlay();
}
export function renderBgFor(pg) {
  for (const s of sheets) if ((s.kind === 'page' && state.pages[s.pi] === pg) || s.kind === 'ghost') renderBg(s);
}

/* Page numbers under the open book; the active page is highlighted. */
export function updateFolios() {
  folios.forEach((f, i) => {
    const s = sheets[i];
    f.textContent = s.kind === 'page' ? s.pi + 1 : '';
    f.classList.toggle('on', s.kind === 'page' && s.pi === state.cur);
  });
}

/* Which sheet a screen x-coordinate belongs to (the nearer one if it's off the pages). */
export function sheetAt(clientX, rects) {
  if (!state.spread) return sheets[0];
  return clientX < rects[0].right ? sheets[0] : sheets[1];
}

/* Eraser ring, positioned in screen coordinates so it can travel across both pages. */
export function showEraser(clientX, clientY) {
  const b = book.getBoundingClientRect(), rp = ERASER_SIZES[state.size.eraser] * view.scale;
  ecur.style.display = 'block';
  ecur.style.width = ecur.style.height = rp * 2 + 'px';
  ecur.style.transform = `translate(${clientX - b.left - rp}px, ${clientY - b.top - rp}px)`;
}
export function hideEraser() { ecur.style.display = 'none'; }
