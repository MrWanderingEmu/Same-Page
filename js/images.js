/* Putting pictures on the page: paste (Ctrl+V, or Insert › Paste picture for tablet mode),
   choose a file, or drag one onto the page. A new picture lands in view on the active page,
   selected, so it can be moved and resized straight away. It sits under the ink, so it can be
   written and highlighted on. */
import { pageSize } from './config.js';
import { state, page } from './state.js';
import { $, toast, clamp } from './util.js';
import { stage, sheets, sheetAt, sheetFor, view, renderInkFor } from './board.js';
import { pushUndo } from './history.js';
import { scheduleSave } from './storage.js';
import { addImage } from './assets.js';
import { selectItems } from './select.js';
import { renderTools, closePops } from './ui.js';
import { importPdf } from './pdf.js';
import { openText, textOpen } from './textbox.js';

const MAX_AT_ONCE = 10;
const NO_PICTURE = 'There’s no picture to paste. Copy one first: use the Snipping Tool, or right-click a picture and choose Copy image.';
const LINK_ONLY = 'That copied a link, not the picture itself. Right-click the picture, choose Copy image, then paste again.';

/* Where a new picture goes and how big: the size it was on screen, shrunk to fit the page,
   centred on `at` (page mm) or on the part of the page in view. */
function placement(pg, px, at) {
  const [W, H] = pageSize(pg);
  const css = 1 / (window.devicePixelRatio || 1) / view.scale;           // a screenshot's pixels -> mm at the page's size on screen
  let w = px.w * css, h = px.h * css;
  const k = Math.min(1, (W - 30) / w, (H * 0.55) / h);
  w *= k; h *= k;
  if (!at) {
    const s = sheetFor(pg), r = s ? s.el.getBoundingClientRect() : null, st = stage.getBoundingClientRect();
    at = r ? [((Math.max(r.left, st.left) + Math.min(r.right, st.right)) / 2 - r.left) / view.scale,
      ((Math.max(r.top, st.top) + Math.min(r.bottom, st.bottom)) / 2 - r.top) / view.scale] : [W / 2, H / 3];
  }
  const r2 = v => Math.round(v * 100) / 100;
  return { x: r2(clamp(at[0] - w / 2, 0, W - w)), y: r2(clamp(at[1] - h / 2, 0, H - h)), w: r2(w), h: r2(h) };
}

/* Adds pictures (Files or Blobs) to a page as one undoable step, and selects them. */
export async function insertPictures(blobs, pg = page(), at = null) {
  blobs = blobs.filter(Boolean);
  if (!blobs.length || !state.pages.includes(pg)) return [];
  if (blobs.length > MAX_AT_ONCE) { toast(`Adding the first ${MAX_AT_ONCE} pictures.`); blobs = blobs.slice(0, MAX_AT_ONCE); }
  const slow = setTimeout(() => toast('Adding the picture…'), 400);
  const added = [];
  for (const b of blobs) {
    const a = await addImage(b);
    if (!a) continue;
    const spot = at && [at[0] + added.length * 8, at[1] + added.length * 8];
    const item = { t: 'img', a: a.id, ...placement(pg, a, spot) };
    if (!at && added.length) { item.x += added.length * 8; item.y += added.length * 8; }   // fan out a few at once
    added.push(item);
  }
  clearTimeout(slow);
  if (!added.length) { toast("That isn't a picture Same Page can use."); return []; }
  pushUndo(pg, pg.strokes.slice());
  pg.strokes.push(...added);
  renderInkFor(pg);
  scheduleSave();
  state.tool = 'select'; state.insert = null; renderTools();
  if (sheetFor(pg)) selectItems(pg, added);
  toast('Picture added. Drag it to move it, or its corner dot to resize. Tap Pen to write on it.');
  return added;
}

/* The picture a copied bit of web page points at, if any. */
function imgSrc(html) {
  const m = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html || '');
  return m ? m[1].replace(/&amp;/g, '&') : null;
}
/* Fetches a picture from a link. Most websites don't allow this, so the usual answer is a hint. */
async function fromLink(url, pg, at) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    const blob = res.ok ? await res.blob() : null;
    if (blob && blob.type.startsWith('image/')) return insertPictures([blob], pg, at);
  } catch (e) {}
  toast(LINK_ONLY);
}
const looksLikeImageLink = t => /^(https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?|data:image\/\S+)$/i.test((t || '').trim());

/* Ctrl+V anywhere on the board. */
function onPaste(e) {
  if (document.body.classList.contains('shelf-open') || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const cd = e.clipboardData; if (!cd) return;
  const files = [...cd.items].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile());
  if (files.length) { e.preventDefault(); insertPictures(files); return; }
  const src = imgSrc(cd.getData('text/html')), text = cd.getData('text/plain');
  if (src) { e.preventDefault(); fromLink(src); return; }
  if (looksLikeImageLink(text)) { e.preventDefault(); fromLink(text.trim()); return; }
  if (text && text.trim() && !textOpen()) { e.preventDefault(); openText(page(), { text: text.trim() }); }   // words: onto the lines
}

/* Insert › Paste picture: reads the clipboard without a keyboard (the browser asks once). */
export async function pastePicture() {
  closePops();
  if (!navigator.clipboard || !navigator.clipboard.read) { toast('Press Ctrl+V to paste a picture.'); return; }
  let items;
  try { items = await navigator.clipboard.read(); }
  catch (e) { toast('Same Page isn’t allowed to see the clipboard. Allow it from the icon in the address bar, or press Ctrl+V.'); return; }
  for (const it of items) {
    const t = it.types.find(t => t.startsWith('image/'));
    if (t) { insertPictures([await it.getType(t)]); return; }
  }
  for (const it of items) {
    if (it.types.includes('text/html')) {
      const src = imgSrc(await (await it.getType('text/html')).text());
      if (src) { fromLink(src); return; }
    }
    if (it.types.includes('text/plain')) {
      const text = await (await it.getType('text/plain')).text();
      if (looksLikeImageLink(text)) { fromLink(text.trim()); return; }
    }
  }
  toast(NO_PICTURE);
}
export function choosePictureFile() { closePops(); $('#imgInput').click(); }

/* Dragging a picture file (or a picture from a web page) onto a page puts it where it's dropped. */
const draggable = dt => dt && [...dt.types].some(t => t === 'Files' || t === 'text/uri-list' || t === 'text/html');
function dropTarget(e) {
  const rects = sheets.map(s => s.el.getBoundingClientRect()), sheet = sheetAt(e.clientX, rects);
  if (sheet.kind !== 'page') return null;
  const r = rects[sheets.indexOf(sheet)];
  return { pg: state.pages[sheet.pi], at: [(e.clientX - r.left) / view.scale, (e.clientY - r.top) / view.scale] };
}
function onDrop(e) {
  if (!draggable(e.dataTransfer)) return;
  e.preventDefault();
  const t = dropTarget(e); if (!t) return;
  const pdf = [...e.dataTransfer.files].find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (pdf) { importPdf(pdf); return; }
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (files.length) { insertPictures(files, t.pg, t.at); return; }
  const src = imgSrc(e.dataTransfer.getData('text/html')) || e.dataTransfer.getData('text/uri-list').split('\n').find(l => l && !l.startsWith('#'));
  if (src) fromLink(src.trim(), t.pg, t.at);
  else if (e.dataTransfer.files.length) toast("That isn't a picture Same Page can use.");
}

export function initImages() {
  document.addEventListener('paste', onPaste);
  stage.addEventListener('dragover', e => { if (draggable(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  stage.addEventListener('drop', onDrop);
  $('#pdfInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; importPdf(f); });
  $('#imgInput').addEventListener('change', e => {
    const files = [...e.target.files]; e.target.value = '';
    insertPictures(files);
  });
}
