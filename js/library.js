/* The notebook library: opening, creating, copying and deleting notebooks,
   notebook files, and backing up / restoring the whole shelf. */
import { state, makePage } from './state.js';
import { toast, download, dateStr, uid, slug } from './util.js';
import { db, kvGet, kvSet, saveNow, adopt, closeOpen, cleanMeta, metaRecord, pageRecord, pageFromRecord, pageFromFile, inkBytes } from './storage.js';
import { showNotebook } from './ui.js';

const DAY = 864e5;

export const listNotebooks = async () => (await db.all('notebooks')).sort((a, b) => a.created - b.created);
const pageRecords = id => db.all('pages', 'nb', id);

/* Opens a notebook onto the board. Saves the one that's open first. */
export async function openNotebook(id) {
  await saveNow();
  const meta = await db.get('notebooks', id);
  if (!meta) return false;
  adopt(cleanMeta(meta, meta.pageIds || []), await pageRecords(id));
  await kvSet('lastOpen', id);
  showNotebook();
  return true;
}

/* Creates a notebook with one page of the given paper, and opens it.
   It starts with the view settings of the notebook that was open. */
export async function createNotebook({ title, colour, tpl }) {
  const id = uid(), now = Date.now(), pg = makePage();
  pg.tpl = tpl || 'ruled';
  const meta = cleanMeta({ id, title, colour, created: now, updated: now,
    spread: state.spread, bookStart: state.bookStart, view: state.view }, [pg.id]);
  await db.write(['notebooks', 'pages'], (nbs, pages) => { nbs.put(meta); pages.put(pageRecord(pg, id)); });
  await openNotebook(id);
}

export async function updateNotebook(id, { title, colour }) {
  if (state.nb && state.nb.id === id) {
    Object.assign(state.nb, { title, colour });
    await saveNow();
    showNotebook(false);
    return;
  }
  const meta = await db.get('notebooks', id);
  if (meta) await db.write(['notebooks'], nbs => nbs.put({ ...meta, title, colour }));
}

export async function duplicateNotebook(id) {
  await saveNow();
  const meta = await db.get('notebooks', id);
  if (!meta) return;
  const recs = await pageRecords(id), byId = new Map(recs.map(r => [r.id, r]));
  const newId = uid(), now = Date.now();
  const copies = (meta.pageIds || []).filter(pid => byId.has(pid)).map(pid => ({ ...byId.get(pid), id: uid(), nb: newId }));
  const copy = cleanMeta({ ...meta, id: newId, title: `${meta.title} (copy)`, created: now, updated: now }, copies.map(r => r.id));
  await db.write(['notebooks', 'pages'], (nbs, pages) => { nbs.put(copy); copies.forEach(r => pages.put(r)); });
}

async function removeRecords(id) {
  const recs = await pageRecords(id);
  return db.write(['notebooks', 'pages'], (nbs, pages) => { nbs.delete(id); recs.forEach(r => pages.delete(r.id)); });
}
export async function deleteNotebook(id) {
  await saveNow();
  if (state.nb && state.nb.id === id) closeOpen();     // so nothing saves it back
  await removeRecords(id);
}

/* --- files --- */
function notebookJson(meta, pages) {
  const { id, title, colour, created, updated, cur, spread, bookStart, view } = meta;
  return { id, title, colour, created, updated, cur, spread, bookStart, view,
    pages: pages.map(p => ({ tpl: p.tpl, land: !!p.land, spacing: { ...p.spacing }, margin: { ...p.margin }, strokes: p.strokes })) };
}
async function loadForFile(id) {
  if (state.nb && state.nb.id === id) return notebookJson(metaRecord(), state.pages);
  const meta = await db.get('notebooks', id);
  if (!meta) return null;
  const byId = new Map((await pageRecords(id)).map(r => [r.id, r]));
  return notebookJson(meta, (meta.pageIds || []).filter(pid => byId.has(pid)).map(pid => pageFromRecord(byId.get(pid))));
}

/* One notebook as a file. The format is readable by the first version of the app too. */
export async function saveNotebookFile(id = state.nb && state.nb.id) {
  const nb = id && await loadForFile(id);
  if (!nb) return;
  const data = { app: 'workbook-board', version: 1, saved: new Date().toISOString(), ...nb };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${slug(nb.title)}-${dateStr()}.json`);
  toast(`“${nb.title}” saved to your Downloads.`);
}

/* Every notebook in one file. */
export async function backupAll() {
  await saveNow();
  const metas = await listNotebooks();
  if (!metas.length) { toast('There are no notebooks to back up yet.'); return false; }
  const notebooks = [];
  for (const m of metas) notebooks.push(await loadForFile(m.id));
  const data = { app: 'workbook-board', kind: 'library', version: 2, saved: new Date().toISOString(), notebooks };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `same-page-backup-${dateStr()}.json`);
  await kvSet('lastBackup', Date.now());
  toast(`Backed up ${metas.length} notebook${metas.length > 1 ? 's' : ''} to your Downloads.`);
  return true;
}

/* Writes a notebook from a file into storage; returns its id. */
async function storeFromFile(nb, { keepId } = {}) {
  const id = keepId && typeof nb.id === 'string' && nb.id ? nb.id : uid();
  const pages = (Array.isArray(nb.pages) ? nb.pages : []).map(pageFromFile);
  if (!pages.length) pages.push(makePage());
  const meta = cleanMeta({ ...nb, id, size: inkBytes(pages), ...(keepId ? {} : { created: Date.now(), updated: Date.now() }) },
    pages.map(p => p.id));
  await db.write(['notebooks', 'pages'], (nbs, store) => { nbs.put(meta); pages.forEach(p => store.put(pageRecord(p, id))); });
  return meta;
}

/* Opens a notebook file (added to the shelf as a new notebook and opened: returns true)
   or a backup (restored onto the shelf: returns 'restored'). */
export async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast("That file couldn't be read."); return false; }
  if (!data || data.app !== 'workbook-board') { toast("That doesn't look like a Same Page notebook or backup."); return false; }
  if (data.kind === 'library') return restoreBackup(data);
  if (!Array.isArray(data.pages)) { toast("That file doesn't contain any pages."); return false; }
  const meta = await storeFromFile({ title: file.name.replace(/\.json$/i, ''), ...data });
  await openNotebook(meta.id);
  toast(`Added “${meta.title}” to your notebooks.`);
  return true;
}

async function restoreBackup(data) {
  const list = (Array.isArray(data.notebooks) ? data.notebooks : []).filter(n => n && Array.isArray(n.pages));
  if (!list.length) { toast('That backup has no notebooks in it.'); return false; }
  const have = new Set((await listNotebooks()).map(n => n.id));
  const replacing = list.filter(n => have.has(n.id)).length;
  const s = list.length > 1 ? 's' : '';
  if (!confirm(`Restore ${list.length} notebook${s} from this backup?` +
    (replacing ? `\n\n${replacing} of them ${replacing > 1 ? 'are' : 'is'} already on your shelf and will be replaced by the backed-up copy.` : ''))) return false;
  await saveNow();
  const reopen = state.nb && list.some(n => n.id === state.nb.id) ? state.nb.id : null;
  if (reopen) closeOpen();
  for (const nb of list) {
    if (have.has(nb.id)) await removeRecords(nb.id);
    await storeFromFile(nb, { keepId: true });
  }
  if (reopen) await openNotebook(reopen);
  toast(`Restored ${list.length} notebook${s}.`);
  return 'restored';
}

/* --- backup reminder: due after 3 weeks without a backup, if anything has changed since --- */
export async function backupDue() {
  if (!db.h) return false;
  const [last, snooze, first] = await Promise.all([kvGet('lastBackup'), kvGet('backupSnooze'), kvGet('firstUse')]);
  const now = Date.now();
  if (snooze && now < snooze) return false;
  if (now - (last || first || now) < 21 * DAY) return false;
  return (await listNotebooks()).some(n => n.size > 0 && n.updated > (last || 0));
}
export const snoozeBackup = () => kvSet('backupSnooze', Date.now() + 7 * DAY);

