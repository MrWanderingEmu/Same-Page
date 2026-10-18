/* IndexedDB auto-save, preferences, and saving / opening notebook files. */
import { PEN_COLOURS, HL_COLOURS } from './config.js';
import { state, makePage, validStroke, hasInk } from './state.js';
import { clamp, toast, download, dateStr } from './util.js';
import { resetHistory } from './history.js';
import { goPage } from './pages.js';

export const db = {
  h: null,
  async open() {
    try {
      this.h = await new Promise((res, rej) => {
        const r = indexedDB.open('workbook-board', 1);     // original name, kept so existing saved work still loads
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    } catch (e) { this.h = null; }
    return !!this.h;
  },
  get(k) {
    return new Promise(res => {
      try { const q = this.h.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }
      catch (e) { res(null); }
    });
  },
  set(k, v) {
    return new Promise(res => {
      try {
        const tx = this.h.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res(true); tx.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  },
};

export function serialise() {
  return {
    app: 'workbook-board', version: 1,                    // file tag kept from the original name so older files still open
    saved: new Date().toISOString(), cur: state.cur,
    pages: state.pages.map(p => ({ tpl: p.tpl, spacing: { ...p.spacing }, margin: { ...p.margin }, strokes: p.strokes })),
  };
}
export function loadNotebook(nb) {
  const raw = nb && Array.isArray(nb.pages) ? nb.pages : [];
  const pages = raw.map(r => { const p = makePage(r); p.strokes = Array.isArray(r.strokes) ? r.strokes.filter(validStroke) : []; return p; });
  if (!pages.length) pages.push(makePage());
  state.pages = pages;
  state.cur = clamp((nb && nb.cur) | 0, 0, pages.length - 1);
  resetHistory();
}
function prefs() {
  const { tool, penColour, hlColour, size, view, spread, bookStart, finger, pressure, penSeen } = state;
  return { tool, penColour, hlColour, size, view, spread, bookStart, finger, pressure, penSeen };
}
export function applyPrefs(p) {
  if (!p) return;
  if (['pen', 'hl', 'eraser'].includes(p.tool)) state.tool = p.tool;
  if (p.penColour in PEN_COLOURS) state.penColour = p.penColour | 0;
  if (p.hlColour in HL_COLOURS) state.hlColour = p.hlColour | 0;
  if (p.size) for (const k of ['pen', 'hl', 'eraser']) if (p.size[k] in [0, 1, 2]) state.size[k] = p.size[k] | 0;
  if (['page', 'width'].includes(p.view)) state.view = p.view;
  if (typeof p.spread === 'boolean') state.spread = p.spread;
  if (['right', 'left'].includes(p.bookStart)) state.bookStart = p.bookStart;
  if (['auto', 'scroll', 'draw'].includes(p.finger)) state.finger = p.finger;
  if (typeof p.pressure === 'boolean') state.pressure = p.pressure;
  state.penSeen = !!p.penSeen;
}

let saveTimer = 0, saveWarned = false;
export function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); }
export async function saveNow() {
  clearTimeout(saveTimer);
  if (!db.h) return;
  const ok = await db.set('state', { notebook: serialise(), prefs: prefs() });
  if (!ok && !saveWarned) { saveWarned = true; toast('Auto-save failed — use More › Save notebook to file.'); }
}

export function saveFile() {
  download(new Blob([JSON.stringify(serialise())], { type: 'application/json' }), `same-page-${dateStr()}.json`);
  toast('Notebook saved to your Downloads.');
}
export function openFile(file) {
  const r = new FileReader();
  r.onload = () => {
    let data;
    try { data = JSON.parse(r.result); } catch (e) { toast("That file couldn't be read."); return; }
    if (!data || data.app !== 'workbook-board') { toast("That doesn't look like a Same Page notebook."); return; }
    if (hasInk() && !confirm('Open this notebook? It will replace the one on screen (save it to file first if you want to keep it).')) return;
    loadNotebook(data);
    goPage(state.cur, true);
    saveNow();
    toast(`Opened notebook — ${state.pages.length} page${state.pages.length > 1 ? 's' : ''}.`);
  };
  r.readAsText(file);
}
