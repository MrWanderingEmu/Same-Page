/* Entry point: open the last notebook used, wire up the UI, and draw. */
import { COVER_COLOURS } from './config.js';
import { state, page, makePage } from './state.js';
import { toast } from './util.js';
import { stage, layout, sheets } from './board.js';
import { setPictureSource } from './draw.js';
import { bitmap, onAssetReady, pruneAssets } from './assets.js';
import { initImages, insertPictures } from './images.js';
import { initText } from './textbox.js';
import { loadFonts } from './text.js';
import { db, kvGet, migrate, applyPrefs } from './storage.js';
import { listNotebooks, openNotebook, createNotebook } from './library.js';
import { undo, redo } from './history.js';
import { goPage, addPage, setTemplate, toggleSpread } from './pages.js';
import { initUI, renderTools, showNotebook } from './ui.js';
import { initShelf, openShelf, updateBackupNotice } from './shelf.js';
import { initInput } from './input.js';

(async function init() {
  initUI();
  initShelf();
  initInput();
  initImages();
  initText();
  loadFonts(() => layout());    // redraw any text once the handwriting fonts have arrived
  // Redraw once a picture on screen has loaded.
  setPictureSource(bitmap);
  let redrawSoon = 0;
  onAssetReady(id => {
    const shown = sheets.some(s => s.kind === 'page' && (state.pages[s.pi].strokes.some(x => x.a === id) || (state.pages[s.pi].bg || {}).a === id));
    if (shown && !redrawSoon) redrawSoon = requestAnimationFrame(() => { redrawSoon = 0; layout(); });
  });
  // ?test (used by tests/smoke.html) runs on a blank in-memory notebook and never touches saved work.
  const testing = new URLSearchParams(location.search).has('test');
  if (!testing && await db.open()) {
    await migrate();
    await pruneAssets();          // pictures no page uses any more (nothing is open yet, so nothing can be undone back)
    applyPrefs(await kvGet('prefs'));
    const last = await kvGet('lastOpen');
    if (!(last && await openNotebook(last))) {
      const nbs = await listNotebooks();
      if (nbs.length) await openNotebook(nbs[nbs.length - 1].id);
      else await createNotebook({ title: 'My notebook', colour: COVER_COLOURS[0], tpl: 'ruled' });
    }
    updateBackupNotice();
    // Ask the browser not to clear this site's storage when the disk gets full (granted silently, or not at all).
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } else {
    // No browser storage (e.g. some private windows): work in memory only.
    state.nb = { id: 'temp', title: 'My notebook', colour: COVER_COLOURS[0], created: Date.now(), updated: Date.now() };
    state.pages = [makePage()];
    showNotebook();
    if (!testing) toast("Auto-save isn't available here — use More › Save this notebook to a file.");
  }
  renderTools();
  new ResizeObserver(() => requestAnimationFrame(layout)).observe(stage);
  window.__wb = { state, page, undo, redo, goPage, addPage, setTemplate, toggleSpread, layout, openShelf, insertPictures }; // handy for testing
})();

// Offline support: once loaded over http(s), the app keeps working without a connection.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
