/* Reveal cover: a card lying over the bottom of a page, hiding a worked example until
   it's uncovered line by line. Tap its tab to uncover the next line (or row of thirds);
   drag the tab to uncover several, or back up to hide them again. It always settles on
   a line. It's saved with the page (pg.cover), so it can be prepared before a lesson.
   Only the tab moves it, and the pen does nothing on the cover itself, so nothing hidden
   can be uncovered or rubbed out by accident. Saved images and prints leave it off. */
import { TOP_GAP, pageSize } from './config.js';
import { state, page } from './state.js';
import { $$, clamp, toast } from './util.js';
import { view, sheets, onLayout } from './board.js';
import { scheduleSave } from './storage.js';

/* Where the cover's top edge can rest on a page (mm from the top), top to bottom. */
export function coverStops(pg) {
  const [, H] = pageSize(pg), t = pg.tpl, sp = pg.spacing[t], out = [];
  if (t === 'ruled') {
    for (let y = TOP_GAP - 0.7 * sp; y < H; y += sp) out.push(y);          // just under each line, leaving room for tails
  } else if (t === 'thirds' || t === 'thirds2' || t === 'sky') {
    out.push(TOP_GAP - 1.5);                                                // the heading only
    for (let y = TOP_GAP + 3 * sp; y < H; y += 3 * sp) out.push(t === 'thirds' ? y - 0.8 : y + 0.6);   // a whole row at a time
  } else if (t === 'grid') {
    for (let y = (H % sp) / 2 + sp; y < H; y += sp) out.push(y);
  } else {
    for (let y = TOP_GAP; y < H; y += 10) out.push(y);
  }
  return out.filter(y => y > 1 && y < H - 3);
}

export const isCovered = (pg, y) => pg.cover != null && y >= pg.cover;

/* --- drawing: one card per sheet, positioned in the sheet --- */
export function renderCovers() {
  for (const s of sheets) {
    const el = s.el.querySelector('.reveal'), pg = s.kind === 'page' ? state.pages[s.pi] : null;
    const on = !!pg && pg.cover != null;
    el.classList.toggle('on', on);
    if (on) el.style.top = Math.min(pg.cover, pageSize(pg)[1]) * view.scale + 'px';
  }
  $$('[data-act="cover"]').forEach(b => b.classList.toggle('on', !!page() && page().cover != null));
}

let explained = false;
/* The Cover button: puts a cover on the current page (hiding everything below the heading), or takes it off. */
export function toggleCover() {
  const pg = page();
  if (pg.cover != null) pg.cover = null;
  else {
    pg.cover = coverStops(pg)[0] ?? TOP_GAP;
    if (!explained) { explained = true; toast("Drag the cover's tab to where the reveal should start. In class, tap the tab to uncover a line."); }
  }
  renderCovers(); scheduleSave();
}

let hinted = false;
export function coveredHint() {
  if (hinted) return;
  hinted = true;
  toast('That part is covered — drag the tab to uncover it.');
}

/* --- the tab: hit-testing and dragging --- */
export function coverTabAt(px, py) {
  for (const s of sheets) {
    if (s.kind !== 'page') continue;
    const el = s.el.querySelector('.reveal');
    if (!el.classList.contains('on')) continue;
    const r = el.querySelector('.tab').getBoundingClientRect();
    if (px >= r.left - 6 && px <= r.right + 6 && py >= r.top - 6 && py <= r.bottom + 6) return { sheet: s, pg: state.pages[s.pi] };
  }
  return null;
}
export function coverDown({ sheet, pg }, py) {
  return { sheet, pg, py, y0: pg.cover, t0: performance.now(), far: 0 };
}
export function coverMove(g, py) {
  g.far = Math.max(g.far, Math.abs(py - g.py));
  g.pg.cover = clamp(g.y0 + (py - g.py) / view.scale, 0, pageSize(g.pg)[1]);
  renderCovers();
}
export function coverUp(g) {
  const pg = g.pg, stops = coverStops(pg), H = pageSize(pg)[1];
  if (g.far < 8 && performance.now() - g.t0 < 400) {
    // A tap: uncover the next line.
    const next = stops.find(y => y > g.y0 + 0.5);
    pg.cover = next ?? null;
  } else {
    // A drag: settle on the nearest line (or come off, if it was pulled right to the bottom).
    const near = stops.concat([H]).reduce((a, b) => Math.abs(b - pg.cover) < Math.abs(a - pg.cover) ? b : a);
    pg.cover = near >= H ? null : near;
  }
  if (pg.cover == null) toast('All uncovered. Tap Cover to put it back.');
  renderCovers(); scheduleSave();
}

onLayout(renderCovers);
