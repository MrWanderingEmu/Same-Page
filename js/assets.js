/* Pictures. Each one is stored once in the 'assets' store, named by a hash of its bytes,
   and pages refer to it by that name, so a picture used on several pages (or in a copied
   notebook) costs nothing extra. Big pictures are shrunk before they're stored.
     asset record: { id, blob, w, h }   (w, h = pixels)
   Decoded pictures are kept in memory while the app is open, ready to draw. */
import { db } from './storage.js';
import { uid } from './util.js';

const MAX_PX = 1600;            // longest side once stored: sharp across a whole A4 page on screen
const KEEP_BYTES = 350e3;       // a picture already this small (and not too big) is kept as it is
const cache = new Map();        // id -> { blob, w, h, bmp: ImageBitmap | HTMLImageElement | null, ready: Promise }
const readyHooks = [];
export const onAssetReady = fn => readyHooks.push(fn);

/* What's needed to draw a picture now, or null while it's still loading (or missing). */
export const bitmap = id => (cache.get(id) || {}).bmp || null;
export const assetBytes = id => { const a = cache.get(id); return a && a.blob ? a.blob.size : 0; };
export const assetIds = () => [...cache.keys()];

async function decode(blob) {
  try { return await createImageBitmap(blob); } catch (e) {}
  // Fallback (e.g. SVG): an <img> can draw anything the browser can show.
  const url = URL.createObjectURL(blob), img = new Image();
  img.src = url;
  try { await img.decode(); return img; } catch (e) { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
const sizeOf = b => [b.naturalWidth || b.width, b.naturalHeight || b.height];

async function hashOf(blob) {
  try {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
    return Array.from(d.slice(0, 16), v => v.toString(16).padStart(2, '0')).join('');
  } catch (e) { return uid(); }
}
function canvasBlob(c, type, q) { return new Promise(res => c.toBlob(res, type, q)); }
function hasAlpha(ctx, w, h) {
  const px = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < px.length; i += 16) if (px[i] < 250) return true;   // every 4th pixel is plenty
  return false;
}

/* Shrinks a picture to MAX_PX and re-encodes it, unless it's already small enough. */
async function prepare(blob, bmp) {
  const [w0, h0] = sizeOf(bmp), k = Math.min(1, MAX_PX / Math.max(w0, h0));
  if (k === 1 && blob.size <= KEEP_BYTES && /^image\/(png|jpeg|webp|gif)$/.test(blob.type)) return { blob, w: w0, h: h0 };
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  let out = await canvasBlob(c, 'image/webp', 0.86);                     // small, sharp text, keeps transparency
  if (!out || out.type !== 'image/webp') out = await canvasBlob(c, hasAlpha(ctx, w, h) ? 'image/png' : 'image/jpeg', 0.88);
  if (!out) return null;
  if (k === 1 && out.size >= blob.size) out = blob;                      // re-encoding didn't help
  return { blob: out, w, h };
}

/* Adds a picture (a File or Blob). Resolves to { id, w, h } in pixels, or null if it isn't a picture.
   ready = it's already the right size and format (a rendered PDF page), so store it as it is. */
export async function addImage(file, { ready = false } = {}) {
  const bmp = await decode(file);
  if (!bmp) return null;
  const p = ready ? { blob: file, w: sizeOf(bmp)[0], h: sizeOf(bmp)[1] } : await prepare(file, bmp);
  if (!p) return null;
  const id = await hashOf(p.blob);
  if (!cache.has(id)) {
    const shown = p.blob === file ? bmp : await decode(p.blob);
    cache.set(id, { blob: p.blob, w: p.w, h: p.h, bmp: shown, ready: Promise.resolve() });
    await db.write(['assets'], s => s.put({ id, blob: p.blob, w: p.w, h: p.h }));   // false with no storage: memory only
  }
  return { id, w: p.w, h: p.h };
}

/* Makes sure these pictures are in memory; redraws (via onAssetReady) as each one arrives. */
export function loadAssets(ids) {
  return Promise.all([...new Set(ids)].map(id => {
    if (cache.has(id)) return cache.get(id).ready;
    const a = { blob: null, w: 0, h: 0, bmp: null };
    a.ready = (async () => {
      const r = await db.get('assets', id);
      if (!r || !r.blob) { cache.delete(id); return; }
      Object.assign(a, { blob: r.blob, w: r.w, h: r.h, bmp: await decode(r.blob) });
      readyHooks.forEach(fn => fn(id));
    })();
    cache.set(id, a);
    return a.ready;
  }));
}

/* The pictures referred to by some pages (or page records): pictures on them and PDF pages under them. */
export const imageIds = pages => [...new Set(pages.flatMap(pg =>
  (pg.strokes || []).filter(s => s.t === 'img').map(s => s.a).concat(pg.bg && pg.bg.a ? [pg.bg.a] : [])))];

/* --- files: pictures travel inside notebook files as data URLs --- */
const toDataUrl = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
export async function assetsForFile(ids) {
  await loadAssets(ids);
  const out = {};
  for (const id of ids) { const a = cache.get(id); if (a && a.blob) out[id] = await toDataUrl(a.blob); }
  return out;
}
/* Stores the pictures from a file. Returns the total size in bytes. */
export async function assetsFromFile(map) {
  if (!map || typeof map !== 'object') return 0;
  let bytes = 0;
  for (const [id, url] of Object.entries(map)) {
    if (typeof url !== 'string' || !/^data:image\//.test(url) || !/^[\w-]{1,64}$/.test(id)) continue;
    const blob = await (await fetch(url)).blob(), bmp = await decode(blob);
    if (!bmp) continue;
    const [w, h] = sizeOf(bmp);
    bytes += blob.size;
    if (!cache.has(id) || !cache.get(id).blob) cache.set(id, { blob, w, h, bmp, ready: Promise.resolve() });
    await db.write(['assets'], s => s.put({ id, blob, w, h }));
  }
  return bytes;
}

/* Removes stored pictures that no page uses any more. Pictures loaded this session are kept,
   since Undo may still bring them back. */
export async function pruneAssets() {
  if (!db.h) return;
  const used = new Set(imageIds(await db.all('pages')));
  cache.forEach((_, id) => used.add(id));
  const ids = await new Promise(res => {
    try { const q = db.h.transaction('assets').objectStore('assets').getAllKeys(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }
    catch (e) { res([]); }
  });
  const gone = ids.filter(id => !used.has(id));
  if (gone.length) await db.write(['assets'], s => gone.forEach(id => s.delete(id)));
}
