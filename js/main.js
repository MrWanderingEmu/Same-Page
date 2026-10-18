/* Entry point: load the saved notebook, wire up the UI, and draw. */
import { state, page } from './state.js';
import { toast } from './util.js';
import { stage, layout } from './board.js';
import { db, loadNotebook, applyPrefs } from './storage.js';
import { undo, redo } from './history.js';
import { goPage, addPage, setTemplate, toggleSpread } from './pages.js';
import { initUI, renderTools, updatePageUI, updateUndo, updateViewBtns } from './ui.js';
import { initInput } from './input.js';

(async function init() {
  initUI();
  initInput();
  const ok = await db.open();
  const saved = ok ? await db.get('state') : null;
  if (saved && saved.notebook) { loadNotebook(saved.notebook); applyPrefs(saved.prefs); }
  else loadNotebook(null);
  if (!ok) toast("Auto-save isn't available here — use More › Save notebook to file.");
  renderTools(); updatePageUI(); updateUndo(); updateViewBtns();
  layout();
  new ResizeObserver(() => requestAnimationFrame(layout)).observe(stage);
  window.__wb = { state, page, undo, redo, goPage, addPage, setTemplate, toggleSpread, layout }; // handy for testing
})();

// Offline support: once loaded over http(s), the app keeps working without a connection.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
