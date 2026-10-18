/* Navigating, adding and deleting pages; paper settings; one- or two-page view. */
import { state, page, makePage, spreadOf, visiblePages } from './state.js';
import { clamp, toast } from './util.js';
import { stage, layout, renderAll, renderBgFor, updateFolios } from './board.js';
import { scheduleSave } from './storage.js';
import { forgetPage } from './history.js';
import { updatePageUI, updateUndo, renderPaperPop, paperPopOpen, updateViewBtns } from './ui.js';

export function goPage(i, force) {
  i = clamp(i, 0, state.pages.length - 1);
  if (i === state.cur && !force) return;
  const sameSpread = state.spread && !force && spreadOf(i)[0] === spreadOf(state.cur)[0];
  state.cur = i;
  if (sameSpread) updateFolios();
  else { stage.scrollTop = 0; renderAll(); }
  updatePageUI(); updateUndo();
  if (paperPopOpen()) renderPaperPop();
  scheduleSave();
}

/* Make page i the active one without moving the view (e.g. when you start writing on it). */
export function setActive(i) {
  if (i === state.cur) return;
  state.cur = i;
  updateFolios(); updatePageUI(); scheduleSave();
}

/* The page that Prev / Next would go to, or -1. Moves a whole spread in two-page view. */
export function stepTarget(dir) {
  const n = state.pages.length;
  if (!state.spread) { const i = state.cur + dir; return i >= 0 && i < n ? i : -1; }
  const vis = visiblePages();
  const t = dir > 0 ? vis[vis.length - 1] + 1 : vis[0] - 1;
  if (t < 0 || t >= n) return -1;
  const [l, r] = spreadOf(t);
  return l >= 0 ? l : r;
}
export function stepPage(dir) { const t = stepTarget(dir); if (t >= 0) goPage(t); }

export function addPage() {
  state.pages.splice(state.cur + 1, 0, makePage(page()));     // new page copies this page's paper
  goPage(state.cur + 1, true);
}
export function addPageAtEnd() {
  state.pages.push(makePage(state.pages[state.pages.length - 1]));
  goPage(state.pages.length - 1, true);
}
export function deletePage() {
  if (state.pages.length < 2) return;
  const n = state.cur + 1;
  if (page().strokes.length && !confirm(`Delete page ${n}? This can't be undone.`)) return;
  forgetPage(page());
  state.pages.splice(state.cur, 1);
  goPage(Math.min(state.cur, state.pages.length - 1), true);
  toast(`Page ${n} deleted.`);
}

export function setTemplate(t) {
  page().tpl = t; renderBgFor(page()); renderPaperPop(); scheduleSave();
}
export function applyPaperToAll() {
  const src = page();
  state.pages.forEach(p => { p.tpl = src.tpl; p.spacing = { ...src.spacing }; p.margin = { ...src.margin }; });
  renderAll();
  toast(`Paper applied to all ${state.pages.length} pages.`);
  scheduleSave();
}

export function toggleSpread() {
  state.spread = !state.spread;
  stage.scrollTop = 0;
  layout(); updatePageUI(); updateViewBtns(); scheduleSave();
}
export function setBookStart(v) {
  if (state.bookStart === v) return;
  state.bookStart = v;
  if (state.spread) { renderAll(); updatePageUI(); }
  scheduleSave();
}
