/* PNG export (the page or pages on screen) and print-to-PDF (every page, true A4). */
import { pageSize } from './config.js';
import { state, visiblePages } from './state.js';
import { $, toast, download, dateStr, slug } from './util.js';
import { drawPaper, drawItems } from './draw.js';
import { closePops } from './ui.js';
import { loadAssets, imageIds } from './assets.js';

/* Renders pages side by side at pxPerMm. Each page's ink is clipped to its own page. */
function renderPagesCanvas(pgs, pxPerMm) {
  const sizes = pgs.map(pageSize);
  const c = document.createElement('canvas');
  c.width = Math.round(sizes.reduce((n, [w]) => n + w, 0) * pxPerMm); c.height = Math.round(Math.max(...sizes.map(([, h]) => h)) * pxPerMm);
  const ctx = c.getContext('2d');
  let x = 0;
  pgs.forEach((pg, i) => {
    const [W, H] = sizes[i];
    ctx.setTransform(pxPerMm, 0, 0, pxPerMm, Math.round(x * pxPerMm), 0);
    drawPaper(ctx, pg, pxPerMm);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    drawItems(ctx, pg.strokes);
    ctx.restore();
    x += W;
  });
  return c;
}
/* A landscape page turned a quarter-turn (top to the left) so it prints on portrait A4. */
function upright(c) {
  const r = document.createElement('canvas');
  r.width = c.height; r.height = c.width;
  const ctx = r.getContext('2d');
  ctx.translate(0, r.height); ctx.rotate(-Math.PI / 2); ctx.drawImage(c, 0, 0);
  return r;
}

export async function exportPng() {
  const idx = visiblePages();
  await loadAssets(imageIds(idx.map(i => state.pages[i])));
  renderPagesCanvas(idx.map(i => state.pages[i]), 8).toBlob(b => {            // ~200 dpi
    if (!b) { toast("Couldn't create the image."); return; }
    download(b, `${slug(state.nb ? state.nb.title : "same-page")}-${dateStr()}-p${idx.map(i => i + 1).join('-')}.png`);
    toast(idx.length > 1 ? 'Pages saved as an image.' : 'Page saved as an image.');
  }, 'image/png');
}

export async function printAll() {
  const box = $('#print'); box.innerHTML = '';
  toast('Preparing pages…');
  await loadAssets(imageIds(state.pages));
  for (const pg of state.pages) {
    const img = new Image();
    const c = renderPagesCanvas([pg], 6);                                  // ~150 dpi
    img.src = (pg.land ? upright(c) : c).toDataURL('image/jpeg', 0.92);
    box.appendChild(img);
    try { await img.decode(); } catch (e) {}
  }
  closePops();
  setTimeout(() => window.print(), 50);
}
window.addEventListener('afterprint', () => { $('#print').innerHTML = ''; });
