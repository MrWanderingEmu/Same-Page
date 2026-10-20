/* App state, the page model, and which pages are on screen. */
import { TEMPLATES, pageSize } from './config.js';
import { clamp, uid } from './util.js';
import { cleanText } from './text.js';

export const state = {
  nb: null,              // the open notebook: { id, title, colour, created, updated }
  pages: [], cur: 0,     // cur = the active page (the one last drawn on, or navigated to)
  // Saved with each notebook:
  view: 'page',          // 'page' = whole page fits, 'width' = page fills width and scrolls
  spread: false,         // true = two pages side by side, like an open book
  bookStart: 'right',    // 'right' = page 1 sits opposite the inside cover; 'left' = pages 1 and 2 together
  // Saved once for the whole app:
  tool: 'pen', penColour: 0, hlColour: 0,
  insert: null,          // the shape or organiser the Insert tool will place (see shapes.js)
  textStyle: 'print',    // the last text style used: 'print' | 'cursive' | 'plain' (text.js)
  prevTool: 'pen',       // tool to go back to after inserting
  snap: true,            // hold the pen still at the end of a stroke to snap it to a shape
  size: { pen: 1, hl: 1, eraser: 1 },
  finger: 'auto',        // 'auto' | 'scroll' | 'draw'
  pressure: true,
  penSeen: false,        // set the first time a stylus is used (drives finger 'auto')
  presenting: false,
};

/* A new page, copying the paper (not the ink) of src if given.
   land = the page is turned on its side (landscape).
   cover = where the reveal cover's top edge sits (mm from the top), or null for no cover.
   bg = a page from a PDF lying over the paper, or null: { a: asset id, x, y, w, h } in mm.
   It belongs to the paper, not the ink: Select, the eraser and Clear leave it alone,
   and new pages don't copy it. */
const LINED = Object.keys(TEMPLATES).filter(k => TEMPLATES[k].spacing);
export function makePage(src, id) {
  const p = {
    id: typeof id === 'string' && id ? id : uid(),
    tpl: 'ruled', land: false, cover: null, bg: null,
    spacing: Object.fromEntries(LINED.map(k => [k, TEMPLATES[k].spacing.def])),
    margin:  Object.fromEntries(LINED.map(k => [k, TEMPLATES[k].margin])),
    strokes: [],
  };
  if (src) {
    if (TEMPLATES[src.tpl]) p.tpl = src.tpl;
    p.land = src.land === true;
    for (const k of LINED) {
      const t = TEMPLATES[k];
      if (src.spacing && isFinite(src.spacing[k])) p.spacing[k] = clamp(+src.spacing[k], t.spacing.min, t.spacing.max);
      if (src.margin && isFinite(src.margin[k])) p.margin[k] = clamp(+src.margin[k], 0, 60);
    }
  }
  return p;
}
/* A box of aspect ratio `ratio` (width / height) fitted inside a pg-sized page, centred: where a PDF page goes. */
export function fitBg(pg, ratio, a) {
  const [W, H] = pageSize(pg), r2 = v => Math.round(v * 100) / 100;
  const w = Math.min(W, H * ratio), h = w / ratio;
  return { a, x: r2((W - w) / 2), y: r2((H - h) / 2), w: r2(w), h: r2(h) };
}
/* A saved PDF page, checked, or null. */
export const cleanBg = b => b && typeof b.a === 'string' && [b.x, b.y, b.w, b.h].every(isFinite) && b.w > 0 && b.h > 0
  ? { a: b.a, x: +b.x, y: +b.y, w: +b.w, h: +b.h } : null;
/* A saved cover position, checked: a number of mm down the page, or null. */
export const cleanCover = (pg, v) => typeof v === 'number' && isFinite(v) ? clamp(v, 0, pageSize(pg)[1]) : null;
export const page = () => state.pages[state.cur];
export const hasInk = () => state.pages.some(p => p.strokes.length);

/* A stroke: { t:'pen'|'hl', c:colour, w:width mm, pr:pressure-on, p:[x,y,pressure, x,y,pressure, ...] }
   A picture lives in the same list, so Undo, Select and saving treat it like ink:
   { t:'img', a:asset id (assets.js), x, y, w, h } in mm. It's always drawn under the ink.
   So does a block of typed text (text.js): { t:'text', s, f, c, x, r, w }. */
export const isImg = s => s.t === 'img';
export function validStroke(s) {
  if (s && s.t === 'text') return !!cleanText(s);
  if (s && s.t === 'img') return typeof s.a === 'string' && [s.x, s.y, s.w, s.h].every(isFinite) && s.w > 0 && s.h > 0;
  return s && Array.isArray(s.p) && s.p.length >= 3 && s.p.length % 3 === 0 &&
    typeof s.c === 'string' && isFinite(s.w) && (s.t === 'pen' || s.t === 'hl');
}

/* The [left, right] page indices of the spread containing page i.
   -1 is the inside front cover; an index >= pages.length is the blank page after the last one. */
export function spreadOf(i) {
  if (state.bookStart === 'right') { const s = Math.floor((i + 1) / 2); return [2 * s - 1, 2 * s]; }
  const s = Math.floor(i / 2); return [2 * s, 2 * s + 1];
}
/* Real pages currently on screen, left to right. */
export function visiblePages() {
  if (!state.spread) return [state.cur];
  return spreadOf(state.cur).filter(i => i >= 0 && i < state.pages.length);
}
export const isVisible = i => visiblePages().includes(i);
