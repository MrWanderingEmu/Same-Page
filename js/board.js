/* The page engine: sizes the sheets to the screen and paints them.
   There are always two sheets in the DOM. In one-page view only the first is shown;
   in two-page view they sit side by side as an open book, and each one shows a page,
   the inside front cover, or a faint blank page after the last one. */
import { $, $$ } from './util.js';
import { pageSize, ERASER_SIZES } from './config.js';
import { state, spreadOf } from './state.js';
import { drawTemplate, drawPaper, drawItems } from './draw.js';

export const stage = $('#stage');
const wrap = $('#pagewrap'), book = $('#book'), ecur = $('#ecursor'), folios = $$('#folios span');
export const view = { scale: 1, dpr: 1 };   // scale = CSS px per mm

/* kind: 'page' (pi = page index) | 'cover' | 'ghost' | 'off' */
export const sheets = $$('.sheet').map(el => {
  const [bg, ink, live] = ['bg', 'ink', 'live'].map(c => el.querySelector('canvas.' + c));
  return {
    el, bg, ink, live, pi: -1, kind: 'off', w: 0, h: 0,   // w, h = size on screen, CSS px
    ctxBg: bg.getContext('2d'), ctxInk: ink.getContext('2d'),
    ctxLive: live.getContext('2d', { desynchronized: true }),   // lower pen latency where supported
  };
});

/* The paper size (mm) a sheet shows: its page's, the last page's for the blank page after it,
   and the facing page's for the inside cover. Pages can be portrait or landscape. */
function sheetMm(s, other) {
  const pg = s.kind === 'page' ? state.pages[s.pi] : s.kind === 'ghost' ? state.pages[state.pages.length - 1]
    : other && other.kind === 'page' ? state.pages[other.pi] : null;
  return pageSize(pg);
}

/* Sizes the sheets to the screen and redraws everything. Every sheet shares one scale,
   so a millimetre is the same size on both pages. */
export function layout() {
  assignSheets();
  const sw = stage.clientWidth, sh = stage.clientHeight;
  if (!sw || !sh) return;
  const spread = state.spread;
  const pad = state.presenting ? 10 : 22;
  const cover = spread ? (state.presenting ? 8 : 10) : 0;          // cover showing around the pages
  const folioH = spread && !state.presenting ? 28 : 0;             // page numbers under the book
  const fitPage = state.presenting || state.view === 'page';
  const side = state.presenting ? 86 : pad;                        // keep clear of the floating toolbar
  const aw = sw - side * 2 - cover * 2, ah = sh - pad * 2 - cover * 2 - folioH;
  const shown = spread ? sheets : [sheets[0]];
  const mm = shown.map((s, i) => sheetMm(s, shown[1 - i]));
  const totalW = mm.reduce((n, [w]) => n + w, 0), maxH = Math.max(...mm.map(([, h]) => h));
  let scale = aw / totalW;
  if (fitPage) scale = Math.min(scale, ah / maxH);
  scale = Math.max(scale, (spread ? 240 : 160) / totalW);
  const h = Math.round(maxH * scale);

  stage.classList.toggle('fit', fitPage);
  book.classList.toggle('spread', spread);
  book.classList.toggle('single', !spread);
  book.style.setProperty('--cover-pad', cover + 'px');
  let biggest = 0;
  shown.forEach((s, i) => {
    s.w = Math.round(mm[i][0] * scale); s.h = Math.round(mm[i][1] * scale);
    s.el.style.width = s.w + 'px'; s.el.style.height = s.h + 'px';
    folios[i].style.width = s.w + 'px';
    biggest = Math.max(biggest, s.w * s.h);
  });
  wrap.style.paddingTop = Math.max(pad, Math.floor((sh - h - cover * 2 - folioH) / 2)) + 'px';
  wrap.style.paddingBottom = pad + 'px';

  // Keep each canvas under ~9 megapixels (~6 in two-page view) so large screens stay fast.
  let dpr = window.devicePixelRatio || 1;
  dpr = Math.min(dpr, Math.sqrt((spread ? 6e6 : 9e6) / biggest));
  view.dpr = dpr; view.scale = scale;
  for (const s of shown) {
    const cw = Math.round(s.w * dpr), ch = Math.round(s.h * dpr);
    if (s.bg.width !== cw || s.bg.height !== ch) for (const c of [s.bg, s.ink, s.live]) { c.width = cw; c.height = ch; }
  }
  paint();
  layoutHooks.forEach(fn => fn());
}
/* Things positioned over the pages (the ruler) that must follow the layout. */
const layoutHooks = [];
export const onLayout = fn => layoutHooks.push(fn);

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
  if (pg && s.kind === 'page') drawPaper(s.ctxBg, pg, view.scale * view.dpr);
  else if (pg) drawTemplate(s.ctxBg, pg, view.scale * view.dpr);     // a new page wouldn't copy a PDF page
}
function renderInk(s, skip) {
  prep(s.ctxInk);
  if (s.kind === 'page') drawItems(s.ctxInk, state.pages[s.pi].strokes, skip, state.pages[s.pi]);
}
export function clearLive(s) { prep(s.ctxLive); }

/* Something drawn on top of the ink (the lasso selection) that must survive a redraw. */
let overlay = null;
export const setOverlay = fn => { overlay = fn; };

/* Redraws everything. Goes through layout(), since a page turn can show a page of another shape. */
export const renderAll = () => layout();
function paint() {
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
