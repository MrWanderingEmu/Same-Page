/* PDF pages: each page of a PDF becomes a page of the notebook, like a worksheet glued
   into the book, ready to write on. The PDF page is drawn as the page's paper (pg.bg),
   so Select, the eraser and Clear never touch it.
   Uses Mozilla's PDF.js (vendor/pdfjs, Apache 2.0), loaded only the first time a PDF is
   opened; after that the offline cache keeps it. */
import { state, page, makePage, fitBg } from './state.js';
import { toast } from './util.js';
import { addImage } from './assets.js';
import { goPage } from './pages.js';
import { scheduleSave } from './storage.js';
import { closePops } from './ui.js';

const LIB = new URL('../vendor/pdfjs/', import.meta.url).href;
export const MAX_PAGES = 10;        // at a time: each page is stored as a picture
const MAX_MB = 60;
const PX = 2200;                    // longest side of each page as stored (about 190 dpi on A4): crisp text in Fit width

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import(LIB + 'pdf.min.js');
    lib.GlobalWorkerOptions.workerSrc = LIB + 'pdf.worker.min.js';
  }
  return lib;
}

/* "1-3, 5, 8-9" -> [1, 2, 3, 5, 8, 9] (page numbers within 1..n, in order, no repeats), or null. */
export function parsePages(text, n) {
  const out = [];
  for (const part of String(text).split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) return null;
    let a = +m[1], b = m[2] ? +m[2] : a;
    if (a > b) [a, b] = [b, a];
    for (let i = Math.max(1, a); i <= Math.min(n, b); i++) if (!out.includes(i)) out.push(i);
  }
  return out.length ? out.sort((x, y) => x - y) : null;
}

/* Which pages to add: all of them, or (for a long PDF) the ones the teacher asks for. */
function choosePages(n) {
  const all = Array.from({ length: n }, (_, i) => i + 1);
  if (n <= MAX_PAGES) return all;
  const ans = prompt(`This PDF has ${n} pages. Same Page adds up to ${MAX_PAGES} at a time.\n\nWhich pages? For example: 1-${MAX_PAGES}, or 2, 4, 6-8`, `1-${MAX_PAGES}`);
  if (ans == null) return null;
  const nums = parsePages(ans, n);
  if (!nums) { toast('Those page numbers didn’t make sense, so nothing was added.'); return null; }
  if (nums.length > MAX_PAGES) toast(`Adding the first ${MAX_PAGES} of those pages.`);
  return nums.slice(0, MAX_PAGES);
}

/* One PDF page as a picture: white behind it, longest side PX. */
async function renderPage(doc, num) {
  const p = await doc.getPage(num);
  const base = p.getViewport({ scale: 1 });
  const vp = p.getViewport({ scale: PX / Math.max(base.width, base.height) });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await p.render({ canvasContext: ctx, viewport: vp }).promise;
  p.cleanup();
  let blob = await new Promise(res => c.toBlob(res, 'image/webp', 0.9));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
  return { blob, land: base.width > base.height, ratio: base.width / base.height };
}

/* Adds pages from a PDF file after the current page and shows the first of them.
   Each new page keeps the current page's paper underneath (hidden), so pages added
   after it carry on with the notebook's usual paper. Resolves to the new pages. */
export async function importPdf(file) {
  closePops();
  if (!file) return [];
  if (file.size > MAX_MB * 1e6) { toast(`That PDF is too big (over ${MAX_MB} MB).`); return []; }
  toast('Opening the PDF…');
  let doc;
  try {
    const L = await pdfjs();
    doc = await L.getDocument({ data: new Uint8Array(await file.arrayBuffer()), standardFontDataUrl: LIB + 'standard_fonts/', isEvalSupported: false }).promise;
  } catch (e) {
    toast(e && e.name === 'PasswordException' ? 'That PDF is password-protected. Save a copy without a password and try again.'
      : !lib ? 'The PDF reader couldn’t load. Check the internet connection and try again.' : 'That PDF couldn’t be opened.');
    return [];
  }
  try {
    const nums = choosePages(doc.numPages);
    if (!nums) return [];
    const src = page(), added = [];
    for (const [i, num] of nums.entries()) {
      if (nums.length > 1) toast(`Adding page ${i + 1} of ${nums.length}…`);
      const r = await renderPage(doc, num);
      const a = r.blob && await addImage(r.blob, { ready: true });
      if (!a) continue;
      const pg = makePage(src);
      pg.land = r.land;
      pg.bg = fitBg(pg, r.ratio, a.id);
      added.push(pg);
    }
    if (!added.length) { toast('That PDF couldn’t be opened.'); return []; }
    const at = state.cur + 1;
    state.pages.splice(at, 0, ...added);
    goPage(at, true);
    scheduleSave();
    const s = added.length > 1 ? 's' : '';
    toast(`Added ${added.length} page${s} from the PDF. Write on ${s ? 'them' : 'it'}; Clear wipes the writing and keeps the PDF.`);
    return added;
  } catch (e) {
    toast('Something went wrong reading that PDF.');
    return [];
  } finally {
    doc.destroy();
  }
}
