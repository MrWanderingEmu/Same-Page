/* App state, the page model, and which pages are on screen. */
import { TEMPLATES } from './config.js';
import { clamp } from './util.js';

export const state = {
  pages: [], cur: 0,     // cur = the active page (the one last drawn on, or navigated to)
  tool: 'pen', penColour: 0, hlColour: 0,
  size: { pen: 1, hl: 1, eraser: 1 },
  view: 'page',          // 'page' = whole page fits, 'width' = page fills width and scrolls
  spread: false,         // true = two pages side by side, like an open book
  bookStart: 'right',    // 'right' = page 1 sits opposite the inside cover; 'left' = pages 1 and 2 together
  finger: 'auto',        // 'auto' | 'scroll' | 'draw'
  pressure: true,
  penSeen: false,        // set the first time a stylus is used (drives finger 'auto')
  presenting: false,
};

export function makePage(src) {
  const p = {
    tpl: 'ruled',
    spacing: { ruled: TEMPLATES.ruled.spacing.def, thirds: TEMPLATES.thirds.spacing.def, grid: TEMPLATES.grid.spacing.def },
    margin:  { ruled: TEMPLATES.ruled.margin, thirds: TEMPLATES.thirds.margin, grid: TEMPLATES.grid.margin },
    strokes: [],
  };
  if (src) {
    if (TEMPLATES[src.tpl]) p.tpl = src.tpl;
    for (const k of ['ruled', 'thirds', 'grid']) {
      const t = TEMPLATES[k];
      if (src.spacing && isFinite(src.spacing[k])) p.spacing[k] = clamp(+src.spacing[k], t.spacing.min, t.spacing.max);
      if (src.margin && isFinite(src.margin[k])) p.margin[k] = clamp(+src.margin[k], 0, 60);
    }
  }
  return p;
}
export const page = () => state.pages[state.cur];
export const hasInk = () => state.pages.some(p => p.strokes.length);

/* A stroke: { t:'pen'|'hl', c:colour, w:width mm, pr:pressure-on, p:[x,y,pressure, x,y,pressure, ...] } */
export function validStroke(s) {
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
