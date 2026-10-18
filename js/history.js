/* Undo / redo. One history for the whole notebook, so in two-page view Undo steps back
   through whatever you did last on either page. Each entry is a list of
   { pg, strokes } — the page object and its stroke list before the change. */
import { MAX_UNDO } from './config.js';
import { state, isVisible, visiblePages } from './state.js';
import { toast } from './util.js';
import { renderInkFor } from './board.js';
import { scheduleSave } from './storage.js';
import { goPage } from './pages.js';
import { updateUndo } from './ui.js';

const hist = { undo: [], redo: [] };

export function resetHistory() { hist.undo = []; hist.redo = []; updateUndo(); }
export const canUndo = () => hist.undo.length > 0;
export const canRedo = () => hist.redo.length > 0;

export function record(changes) {
  if (!changes.length) return;
  hist.undo.push(changes);
  if (hist.undo.length > MAX_UNDO) hist.undo.shift();
  hist.redo = [];
  updateUndo();
}
export const pushUndo = (pg, before) => record([{ pg, strokes: before }]);

/* Drop history for a page that no longer exists. */
export function forgetPage(pg) {
  for (const k of ['undo', 'redo']) {
    hist[k] = hist[k].map(e => e.filter(c => c.pg !== pg)).filter(e => e.length);
  }
  updateUndo();
}

function step(from, to) {
  const changes = from.pop();
  if (!changes) return;
  to.push(changes.map(c => ({ pg: c.pg, strokes: c.pg.strokes })));
  changes.forEach(c => { c.pg.strokes = c.strokes; });
  const i = state.pages.indexOf(changes[0].pg);
  if (!isVisible(i)) goPage(i);                 // show the page the change happened on
  else changes.forEach(c => renderInkFor(c.pg));
  updateUndo(); scheduleSave();
}
export const undo = () => step(hist.undo, hist.redo);
export const redo = () => step(hist.redo, hist.undo);

/* Clears every page on screen (both pages in two-page view) as one undoable step. */
export function clearVisible() {
  const pgs = visiblePages().map(i => state.pages[i]).filter(p => p.strokes.length);
  if (!pgs.length) return;
  record(pgs.map(pg => ({ pg, strokes: pg.strokes })));
  pgs.forEach(pg => { pg.strokes = []; renderInkFor(pg); });
  scheduleSave();
  toast(pgs.length > 1 ? 'Both pages cleared — press Undo to bring them back.' : 'Page cleared — press Undo to bring it back.');
}

/* Quietly removes a stroke that was just added (the first dot of a double-tap),
   along with its undo step, as if it was never drawn. */
export function discardLast(pg, stroke) {
  const last = hist.undo[hist.undo.length - 1];
  if (!last || last.length !== 1 || last[0].pg !== pg || pg.strokes[pg.strokes.length - 1] !== stroke) return false;
  hist.undo.pop();
  pg.strokes = last[0].strokes;
  renderInkFor(pg); updateUndo(); scheduleSave();
  return true;
}
