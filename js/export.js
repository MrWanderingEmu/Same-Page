/* PNG export (the page or pages on screen) and print-to-PDF (every page, true A4). */
import { PAGE_W, PAGE_H } from './config.js';
import { state, visiblePages } from './state.js';
import { $, toast, download, dateStr, slug } from './util.js';
import { drawTemplate, drawStroke } from './draw.js';
import { closePops } from './ui.js';

/* Renders pages side by side at pxPerMm. Each page's ink is clipped to its own page. */
function renderPagesCanvas(pgs, pxPerMm) {
  const c = document.createElement('canvas');
  c.width = Math.round(PAGE_W * pgs.length * pxPerMm); c.height = Math.round(PAGE_H * pxPerMm);
  const ctx = c.getContext('2d');
  pgs.forEach((pg, i) => {
    ctx.setTransform(pxPerMm, 0, 0, pxPerMm, Math.round(i * PAGE_W * pxPerMm), 0);
    drawTemplate(ctx, pg, pxPerMm);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, PAGE_W, PAGE_H); ctx.clip();
    for (const s of pg.strokes) drawStroke(ctx, s);
    ctx.restore();
  });
  return c;
}

export function exportPng() {
  const idx = visiblePages();
  renderPagesCanvas(idx.map(i => state.pages[i]), 8).toBlob(b => {            // ~200 dpi
    if (!b) { toast("Couldn't create the image."); return; }
    download(b, `${slug(state.nb ? state.nb.title : "same-page")}-${dateStr()}-p${idx.map(i => i + 1).join('-')}.png`);
    toast(idx.length > 1 ? 'Pages saved as an image.' : 'Page saved as an image.');
  }, 'image/png');
}

export async function printAll() {
  const box = $('#print'); box.innerHTML = '';
  toast('Preparing pages…');
  for (const pg of state.pages) {
    const img = new Image();
    img.src = renderPagesCanvas([pg], 6).toDataURL('image/jpeg', 0.92);   // ~150 dpi
    box.appendChild(img);
    try { await img.decode(); } catch (e) {}
  }
  closePops();
  setTimeout(() => window.print(), 50);
}
window.addEventListener('afterprint', () => { $('#print').innerHTML = ''; });
