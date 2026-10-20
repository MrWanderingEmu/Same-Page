/* The bookshelf: every notebook as an exercise-book cover. Open, create, rename,
   recolour, copy, save to a file, delete; back up and restore the whole shelf. */
import { COVER_COLOURS, TEMPLATES } from './config.js';
import { state } from './state.js';
import { $, esc, toast } from './util.js';
import { db, saveNow } from './storage.js';
import { listNotebooks, openNotebook, createNotebook, updateNotebook, duplicateNotebook, deleteNotebook,
  saveNotebookFile, backupAll, importFile, backupDue, snoozeBackup } from './library.js';
import { closePops, drawPreview } from './ui.js';

const shelf = $('#shelf'), grid = $('#shelfGrid'), menu = $('#nbMenu'), dialog = $('#nbDialog'), form = $('#nbForm');
let notebooks = [];          // as last listed
let menuFor = null;          // notebook id the options menu is for
let editing = null;          // notebook id being renamed, or null when creating
let pick = { colour: COVER_COLOURS[0], tpl: 'ruled' };

export const shelfOpen = () => document.body.classList.contains('shelf-open');

export async function openShelf() {
  if (!db.h) { toast("Notebooks need browser storage, which isn't available here."); return; }
  closePops();
  await saveNow();
  document.body.classList.add('shelf-open');
  await renderShelf();
}
export function closeShelf() {
  if (!state.nb) return;            // nothing to go back to
  closeMenu(); closeDialog();
  document.body.classList.remove('shelf-open');
}
/* Esc: close the topmost thing. */
export function shelfEscape() {
  if (dialog.classList.contains('open')) closeDialog();
  else if (menuFor) closeMenu();
  else closeShelf();
}

const pages = n => `${n} page${n === 1 ? '' : 's'}`;
function edited(t) {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (days <= 0) return 'Edited today';
  if (days === 1) return 'Edited yesterday';
  if (days < 7) return `Edited ${days} days ago`;
  return 'Edited ' + d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const mb = bytes => bytes < 1e6 ? `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB` : bytes < 1e9 ? `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB` : `${(bytes / 1e9).toFixed(1)} GB`;

export async function renderShelf() {
  notebooks = await listNotebooks();
  const cur = state.nb && state.nb.id;
  grid.innerHTML = notebooks.map(nb => `
    <div class="nb${nb.id === cur ? ' current' : ''}">
      <button class="nb-cover" data-open="${nb.id}" style="--c:${nb.colour}" aria-label="Open ${esc(nb.title)}">
        <span class="nb-label"><b>${esc(nb.title)}</b><small>${pages((nb.pageIds || []).length)}</small></span>
      </button>
      <div class="nb-foot">
        <span>${nb.id === cur ? '<strong>Open now</strong>' : edited(nb.updated)}</span>
        <button class="nb-more" data-more="${nb.id}" aria-label="Options for ${esc(nb.title)}"><svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/></svg></button>
      </div>
    </div>`).join('') + `
    <div class="nb">
      <button class="nb-new" data-shelf="new"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>New notebook</button>
      <div class="nb-foot"></div>
    </div>`;
  $('#shelfClose').hidden = !state.nb;
  updateBackupNotice();
  // The notebooks' own size, not navigator.storage.estimate(): the browser's figure includes the
  // offline copy of the app and only shrinks when it gets round to tidying its database files,
  // so it seemed to go up and never down, even after deleting notebooks.
  const bytes = notebooks.reduce((n, nb) => n + (nb.size || 0), 0);
  $('#storageInfo').textContent = `${notebooks.length} notebook${notebooks.length === 1 ? '' : 's'}` +
    (notebooks.length ? ` · about ${mb(bytes)}` : '') +
    ' · saved automatically on this device';
}

export async function updateBackupNotice() {
  const due = await backupDue();
  $('#backupBanner').hidden = !due;
  const dot = $('#shelfBtn .badge'); if (dot) dot.hidden = !due;
}

/* --- options menu for one notebook --- */
function openMenu(id, btn) {
  closeMenu();
  menuFor = id;
  menu.classList.add('open');
  const r = btn.getBoundingClientRect();
  menu.style.left = Math.max(10, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 10)) + 'px';
  menu.style.top = (r.bottom + menu.offsetHeight + 10 < innerHeight ? r.bottom + 6 : r.top - menu.offsetHeight - 6) + 'px';
}
function closeMenu() { menuFor = null; menu.classList.remove('open'); }

/* --- new / rename dialog --- */
function openDialog(nb) {
  closeMenu();
  editing = nb ? nb.id : null;
  pick = { colour: nb ? nb.colour : COVER_COLOURS[notebooks.length % COVER_COLOURS.length], tpl: 'ruled' };
  $('#nbDialogTitle').textContent = nb ? 'Rename notebook' : 'New notebook';
  $('#nbSubmit').textContent = nb ? 'Save' : 'Create';
  $('#nbPaperBox').hidden = !!nb;
  $('#nbNameInput').value = nb ? nb.title : '';
  renderPicks();
  dialog.classList.add('open');
  setTimeout(() => $('#nbNameInput').focus(), 30);
}
function closeDialog() { dialog.classList.remove('open'); }
function renderPicks() {
  $('#nbColours').innerHTML = COVER_COLOURS.map(c =>
    `<button type="button" class="cover-sw${c === pick.colour ? ' on' : ''}" data-cover="${c}" style="background:${c}" aria-label="Cover colour"></button>`).join('');
  $('#nbPaper').innerHTML = Object.keys(TEMPLATES).map(k =>
    `<button type="button" class="tpl${k === pick.tpl ? ' on' : ''}" data-newtpl="${k}"><canvas data-preview="${k}"></canvas>${TEMPLATES[k].label}</button>`).join('');
  dialog.querySelectorAll('[data-preview]').forEach(c => drawPreview(c, c.dataset.preview));
}
async function submitDialog() {
  const title = $('#nbNameInput').value.trim() || (editing ? 'Untitled' : 'New notebook');
  closeDialog();
  if (editing) { await updateNotebook(editing, { title, colour: pick.colour }); await renderShelf(); }
  else { await createNotebook({ title, colour: pick.colour, tpl: pick.tpl }); closeShelf(); toast(`“${title}” is ready.`); }
}

async function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.open) {
    if (!(state.nb && state.nb.id === d.open)) await openNotebook(d.open);
    return closeShelf();
  }
  if (d.more) return menuFor === d.more ? closeMenu() : openMenu(d.more, b);
  if (d.cover) { pick.colour = d.cover; return renderPicks(); }
  if (d.newtpl) { pick.tpl = d.newtpl; return renderPicks(); }
  const nb = notebooks.find(n => n.id === menuFor);
  switch (d.shelf) {
    case 'close': return closeShelf();
    case 'new': return openDialog(null);
    case 'cancel': return closeDialog();
    case 'backup': if (await backupAll()) updateBackupNotice(); return;
    case 'snooze': await snoozeBackup(); return updateBackupNotice();
    case 'import': return $('#fileInput').click();
    case 'rename': return nb && openDialog(nb);
    case 'duplicate': closeMenu(); if (nb) { await duplicateNotebook(nb.id); await renderShelf(); toast(`Made a copy of “${nb.title}”.`); } return;
    case 'export': closeMenu(); return nb && saveNotebookFile(nb.id);
    case 'delete':
      closeMenu();
      if (!nb) return;
      if (!confirm(`Delete “${nb.title}”?\n\nIts ${pages((nb.pageIds || []).length)} will be removed from this browser. This can't be undone.`)) return;
      await deleteNotebook(nb.id);
      await renderShelf();
      toast(`“${nb.title}” deleted.`);
      return;
  }
}

export function initShelf() {
  shelf.addEventListener('click', onClick);
  menu.addEventListener('click', onClick);
  dialog.addEventListener('click', e => { if (e.target === dialog) closeDialog(); else onClick(e); });
  form.addEventListener('submit', e => { e.preventDefault(); submitDialog(); });
  document.addEventListener('pointerdown', e => {
    if (menuFor && !menu.contains(e.target) && !e.target.closest('[data-more]')) closeMenu();
  }, true);
  $('#fileInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    const r = f && await importFile(f);
    if (r === true) closeShelf(); else if (r) renderShelf();
  });
}
