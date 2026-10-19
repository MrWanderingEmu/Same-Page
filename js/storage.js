/* Browser storage (IndexedDB).
     notebooks  one small record per notebook: title, cover, page order, view settings
     pages      one record per page, so a pen stroke only re-saves the page it's on
     assets     set aside for images
     kv         app-wide preferences and housekeeping (last backup, last notebook open)
   Pen points are stored as whole numbers of 1/100 mm in an Int32Array: about half
   the space of plain numbers, and lossless because points are already rounded to 0.01. */
import { PEN_COLOURS, HL_COLOURS, COVER_COLOURS } from './config.js';
import { state, makePage, validStroke, cleanCover } from './state.js';
import { clamp, toast, uid } from './util.js';
import { resetHistory } from './history.js';

const DB_NAME = 'workbook-board';   // the app's original name, kept so existing saved work still loads

const done = tx => new Promise(res => { tx.oncomplete = () => res(true); tx.onerror = tx.onabort = () => res(false); });
const result = q => new Promise(res => { q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });

export const db = {
  h: null,
  async open() {
    try {
      this.h = await new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, 2);
        r.onupgradeneeded = () => {
          const d = r.result, has = n => d.objectStoreNames.contains(n);
          if (!has('kv')) d.createObjectStore('kv');
          if (!has('notebooks')) d.createObjectStore('notebooks', { keyPath: 'id' });
          if (!has('pages')) d.createObjectStore('pages', { keyPath: 'id' }).createIndex('nb', 'nb');
          if (!has('assets')) d.createObjectStore('assets', { keyPath: 'id' });
        };
        r.onblocked = () => toast('Close any other Same Page tabs to finish updating.');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      this.h.onversionchange = () => this.h.close();   // let a newer version in another tab upgrade
    } catch (e) { this.h = null; }
    return !!this.h;
  },
  get(store, key) {
    try { return result(this.h.transaction(store).objectStore(store).get(key)); } catch (e) { return Promise.resolve(undefined); }
  },
  async all(store, index, key) {
    try {
      const os = this.h.transaction(store).objectStore(store);
      return (await result(index ? os.index(index).getAll(key) : os.getAll())) || [];
    } catch (e) { return []; }
  },
  /* Runs fn(store, store, ...) in one read-write transaction; resolves true once it's committed. */
  write(stores, fn) {
    try { const tx = this.h.transaction(stores, 'readwrite'); fn(...stores.map(s => tx.objectStore(s))); return done(tx); }
    catch (e) { return Promise.resolve(false); }
  },
};
export const kvGet = k => db.get('kv', k);
export const kvSet = (k, v) => db.write(['kv'], kv => kv.put(v, k));

/* --- pages <-> records --- */
const encStroke = s => ({ t: s.t, c: s.c, w: s.w, pr: !!s.pr, p: Int32Array.from(s.p, v => Math.round(v * 100)) });
const decStroke = s => ({ t: s.t, c: s.c, w: s.w, pr: !!s.pr, p: Array.from(s.p || [], v => v / 100) });

export function pageRecord(pg, nbId) {
  return { id: pg.id, nb: nbId, tpl: pg.tpl, land: !!pg.land, cover: pg.cover, spacing: { ...pg.spacing }, margin: { ...pg.margin }, strokes: pg.strokes.map(encStroke) };
}
export function pageFromRecord(r) {
  const p = makePage(r, r.id);
  p.cover = cleanCover(p, r.cover);
  p.strokes = (r.strokes || []).map(decStroke).filter(validStroke);
  return p;
}
/* A page from a notebook file (plain arrays). */
export function pageFromFile(r) {
  const p = makePage(r);
  p.cover = cleanCover(p, r.cover);
  p.strokes = Array.isArray(r.strokes) ? r.strokes.filter(validStroke) : [];
  return p;
}
/* Approximate stored size of the ink, in bytes (shown on the shelf). */
export const inkBytes = pages => pages.reduce((n, pg) => n + pg.strokes.reduce((m, s) => m + s.p.length * 4 + 40, 0), 0);

/* Checks a notebook record (from storage or a file) and fills in anything missing. */
export function cleanMeta(m, pageIds) {
  const now = Date.now();
  return {
    id: m.id, pageIds,
    title: String(m.title || 'Untitled').slice(0, 60),
    colour: /^#[0-9a-f]{6}$/i.test(m.colour) ? m.colour : COVER_COLOURS[0],
    created: isFinite(m.created) ? +m.created : now,
    updated: isFinite(m.updated) ? +m.updated : now,
    cur: clamp(m.cur | 0, 0, Math.max(0, pageIds.length - 1)),
    spread: m.spread === true,
    bookStart: m.bookStart === 'left' ? 'left' : 'right',
    view: m.view === 'width' ? 'width' : 'page',
    size: isFinite(m.size) ? +m.size : 0,
  };
}

/* --- the open notebook --- */
/* What's already in storage, so a save only writes pages that changed. */
let saved = new WeakMap();    // page -> { strokes (array ref), n (length), paper (key) }
let savedIds = new Set();     // page ids stored for the open notebook
const paperKey = pg => pg.tpl + (pg.land ? 'L' : 'P') + pg.cover + JSON.stringify(pg.spacing) + JSON.stringify(pg.margin);   // and the cover
const mark = pg => ({ strokes: pg.strokes, n: pg.strokes.length, paper: paperKey(pg) });

/* Makes a notebook the open one. records = its page records as found in storage. */
export function adopt(meta, records) {
  const byId = new Map(records.map(r => [r.id, r]));
  let pages = meta.pageIds.map(id => byId.has(id) ? pageFromRecord(byId.get(id)) : makePage(null, id));
  if (!pages.length) pages = [makePage()];
  state.nb = { id: meta.id, title: meta.title, colour: meta.colour, created: meta.created, updated: meta.updated };
  state.pages = pages;
  state.cur = clamp(meta.cur | 0, 0, pages.length - 1);
  state.spread = meta.spread; state.bookStart = meta.bookStart; state.view = meta.view;
  saved = new WeakMap();
  pages.forEach(pg => { if (byId.has(pg.id)) saved.set(pg, mark(pg)); });
  savedIds = new Set(byId.keys());     // includes any stray pages, so the next save tidies them away
  resetHistory();
}
export function closeOpen() { state.nb = null; saved = new WeakMap(); savedIds = new Set(); }

export function metaRecord() {
  return cleanMeta({ ...state.nb, cur: state.cur, spread: state.spread, bookStart: state.bookStart, view: state.view, size: inkBytes(state.pages) },
    state.pages.map(p => p.id));
}

function prefs() {
  const { penColour, hlColour, size, finger, pressure, penSeen, snap } = state;
  return { tool: state.tool === 'insert' ? state.prevTool : state.tool, penColour, hlColour, size, finger, pressure, penSeen, snap };
}
export function applyPrefs(p) {
  if (!p) return;
  if (['pen', 'hl', 'eraser', 'select', 'laser'].includes(p.tool)) state.tool = p.tool;
  if (p.penColour in PEN_COLOURS) state.penColour = p.penColour | 0;
  if (p.hlColour in HL_COLOURS) state.hlColour = p.hlColour | 0;
  if (p.size) for (const k of ['pen', 'hl', 'eraser']) if (p.size[k] in [0, 1, 2]) state.size[k] = p.size[k] | 0;
  if (['auto', 'scroll', 'draw'].includes(p.finger)) state.finger = p.finger;
  if (typeof p.pressure === 'boolean') state.pressure = p.pressure;
  if (typeof p.snap === 'boolean') state.snap = p.snap;
  state.penSeen = !!p.penSeen;
}

let saveTimer = 0, saveWarned = false, queue = Promise.resolve();
export function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); }
/* Saves now. Saves run one after another, so callers can await everything being stored. */
export function saveNow() { clearTimeout(saveTimer); return (queue = queue.then(doSave)); }

async function doSave() {
  if (!db.h) return;
  if (!state.nb) { await kvSet('prefs', prefs()); return; }
  const nbId = state.nb.id, changed = [], marks = [];
  for (const pg of state.pages) {
    const m = mark(pg), s = saved.get(pg);
    if (s && s.strokes === m.strokes && s.n === m.n && s.paper === m.paper) continue;
    changed.push(pageRecord(pg, nbId)); marks.push([pg, m]);
  }
  const ids = new Set(state.pages.map(p => p.id));
  const gone = [...savedIds].filter(id => !ids.has(id));
  if (changed.length || gone.length) state.nb.updated = Date.now();
  const meta = metaRecord();
  const ok = await db.write(['notebooks', 'pages', 'kv'], (nbs, pages, kv) => {
    nbs.put(meta);
    changed.forEach(r => pages.put(r));
    gone.forEach(id => pages.delete(id));
    kv.put(prefs(), 'prefs'); kv.put(nbId, 'lastOpen');
  });
  if (ok) { marks.forEach(([pg, m]) => saved.set(pg, m)); savedIds = ids; }
  else if (!saveWarned) { saveWarned = true; toast('Auto-save failed — use More › Save this notebook to a file.'); }
}

/* One-time move from the single-notebook version: the notebook already in this browser
   becomes "My notebook" on the shelf, keeping its view settings. */
export async function migrate() {
  if (await kvGet('migrated')) return;
  const old = await kvGet('state'), now = Date.now();
  await db.write(['notebooks', 'pages', 'kv'], (nbs, pagesStore, kv) => {
    if (old && old.notebook && Array.isArray(old.notebook.pages)) {
      const pages = old.notebook.pages.map(pageFromFile);
      if (!pages.length) pages.push(makePage());
      const p = old.prefs || {}, id = uid();
      const meta = cleanMeta({ id, title: 'My notebook', created: now, updated: now, cur: old.notebook.cur,
        spread: p.spread, bookStart: p.bookStart, view: p.view, size: inkBytes(pages) }, pages.map(pg => pg.id));
      nbs.put(meta);
      pages.forEach(pg => pagesStore.put(pageRecord(pg, id)));
      kv.put(p, 'prefs'); kv.put(id, 'lastOpen'); kv.delete('state');
    }
    kv.put(true, 'migrated'); kv.put(now, 'firstUse');
  });
}
