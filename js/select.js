/* Select tool: lasso strokes (and pictures and text), then move, resize, recolour, duplicate or delete them.
   Text moves line to line; resizing it changes where it wraps, not its size (that comes from the paper).
   Strokes are never changed in place (undo keeps references to the old ones):
   a move or resize swaps in transformed copies, as one undoable step. */
import { PEN_COLOURS, HL_COLOURS } from './config.js';
import { state, isImg } from './state.js';
import { $ } from './util.js';
import { view, sheetFor, clearLive, renderInkFor, setOverlay } from './board.js';
import { drawStroke, tracePath } from './draw.js';
import { pushUndo } from './history.js';
import { guide, textBox, layout } from './text.js';
import { scheduleSave } from './storage.js';

const ACCENT = '#2b59cf', PAD = 2.5, HANDLE = 2.4;   // mm
const bar = $('#selbar');
let sel = null;            // { pg, strokes: [...], box: { x0, y0, x1, y1 } }

export const hasSelection = () => !!sel;

/* --- geometry --- */
const isText = s => s.t === 'text';
function boxOf(strokes, pg) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    if (isText(s)) { const b = textBox(pg, s); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); continue; }
    if (isImg(s)) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h); continue; }
    const h = s.w / 2;
    for (let i = 0; i < s.p.length; i += 3) {
      const x = s.p[i], y = s.p[i + 1];
      if (x - h < x0) x0 = x - h; if (x + h > x1) x1 = x + h; if (y - h < y0) y0 = y - h; if (y + h > y1) y1 = y + h;
    }
  }
  return { x0: x0 - PAD, y0: y0 - PAD, x1: x1 + PAD, y1: y1 + PAD };
}
function inside(x, y, poly) {                  // ray casting; poly = flat [x, y, ...]
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function nearStroke(s, x, y, r, pg) {
  if (isText(s)) { const b = textBox(pg, s); return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r; }
  if (isImg(s)) return x >= s.x - r && x <= s.x + s.w + r && y >= s.y - r && y <= s.y + s.h + r;
  const p = s.p, rr = r + s.w / 2;
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) <= rr;
  for (let i = 3; i < p.length; i += 3) {
    const ax = p[i - 3], ay = p[i - 2], dx = p[i] - ax, dy = p[i + 1] - ay, l = dx * dx + dy * dy;
    let t = l ? ((x - ax) * dx + (y - ay) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= rr) return true;
  }
  return false;
}
const r2 = v => Math.round(v * 100) / 100;
function map(s, f, pg) {
  if (isText(s)) {                             // its first line's start point moves; the row may be fractional until it's dropped
    const g = guide(pg), [x0, y0] = f(s.x, g.base(s.r)), [x1] = f(s.x + s.w, g.base(s.r));
    return { ...s, x: r2(x0), r: Math.max(0, g.rowAt(y0)), w: r2(Math.max(10, x1 - x0)) };
  }
  if (isImg(s)) { const [x0, y0] = f(s.x, s.y), [x1, y1] = f(s.x + s.w, s.y + s.h); return { ...s, x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) }; }
  return mapPts(s, f);
}
const settle = s => isText(s) ? { ...s, r: Math.round(s.r) } : s;   // text drops onto the nearest line
/* Points a lasso tests: a stroke's own points, or a 3 × 3 grid over a picture or text. */
const grid3 = b => [0, 0.5, 1].flatMap(i => [0, 0.5, 1].flatMap(j => [b.x0 + i * (b.x1 - b.x0), b.y0 + j * (b.y1 - b.y0), 0]));
const samples = (s, pg) => isText(s) ? grid3(textBox(pg, s)) : isImg(s) ? [0, 0.5, 1].flatMap(i => [0, 0.5, 1].flatMap(j => [s.x + i * s.w, s.y + j * s.h, 0])) : s.p;
const mapPts = (s, f) => { const p = s.p.slice(); for (let i = 0; i < p.length; i += 3) { const [x, y] = f(p[i], p[i + 1]); p[i] = Math.round(x * 100) / 100; p[i + 1] = Math.round(y * 100) / 100; } return { ...s, p }; };
const moveBy = (dx, dy) => (x, y) => [x + dx, y + dy];
const scaleFrom = (ox, oy, k) => (x, y) => [ox + (x - ox) * k, oy + (y - oy) * k];

/* --- drawing the selection (on the page's live canvas) --- */
function paint(sheet, strokes, box, pg) {
  const ctx = sheet.ctxLive;
  clearLive(sheet);
  ctx.save();
  for (const s of strokes) {                   // tint what's selected
    if (isText(s)) { const b = textBox(pg, s); ctx.globalAlpha = 0.12; ctx.fillStyle = ACCENT; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); continue; }
    if (isImg(s)) { ctx.globalAlpha = 0.5; ctx.strokeStyle = ACCENT; ctx.lineWidth = 0.8; ctx.strokeRect(s.x, s.y, s.w, s.h); continue; }
    ctx.globalAlpha = 0.35; ctx.strokeStyle = ACCENT; ctx.lineWidth = s.w + 0.8; ctx.lineCap = ctx.lineJoin = 'round';
    tracePath(ctx, s.p); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(43,89,207,0.05)'; ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.setLineDash([1.6, 1.2]); ctx.lineWidth = Math.max(0.25, 1.4 / view.scale); ctx.strokeStyle = ACCENT;
  ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(box.x1, box.y1, HANDLE, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = Math.max(0.35, 2 / view.scale); ctx.stroke();
  ctx.restore();
}
function placeBar(sheet) {
  const r = sheet.el.getBoundingClientRect(), b = sel.box, k = view.scale;
  bar.hidden = false;
  bar.querySelector('[data-act="selEdit"]').hidden = !selectedText();
  const w = bar.offsetWidth, h = bar.offsetHeight;
  let top = r.top + b.y0 * k - h - 10;
  if (top < 8) top = r.top + b.y1 * k + 14;
  bar.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + ((b.x0 + b.x1) / 2) * k - w / 2)) + 'px';
  bar.style.top = Math.min(innerHeight - h - 8, top) + 'px';
}
/* Redraws the selection, or drops it if its page or strokes have gone (page turned, undo...). */
function redraw() {
  if (!sel) return;
  const sheet = sheetFor(sel.pg);
  if (!sheet || !state.pages.includes(sel.pg) || !sel.strokes.every(s => sel.pg.strokes.includes(s))) { clearSelection(); return; }
  paint(sheet, sel.strokes, sel.box, sel.pg);
  placeBar(sheet);
}
setOverlay(redraw);

function select(pg, strokes) {
  sel = strokes.length ? { pg, strokes, box: boxOf(strokes, pg) } : null;
  if (sel) redraw(); else bar.hidden = true;
}
export function clearSelection() {
  if (!sel) return;
  const sheet = sheetFor(sel.pg);
  sel = null; bar.hidden = true;
  if (sheet) clearLive(sheet);
}

/* Swaps some strokes for new versions as one undoable step, and selects the new ones. */
function replace(changes) {
  const pg = sel.pg, before = pg.strokes;
  pg.strokes = before.map(s => changes.get(s) || s);
  pushUndo(pg, before);
  sel.strokes = sel.strokes.map(s => changes.get(s) || s);
  sel.box = boxOf(sel.strokes, pg);
  renderInkFor(pg);
  scheduleSave();
}

/* --- gestures (called from input.js, points in page mm) --- */
export function selDown(sheet, [x, y]) {
  const pg = state.pages[sheet.pi], b = sel && sel.pg === pg ? sel.box : null;
  bar.hidden = true;
  if (b && Math.hypot(x - b.x1, y - b.y1) < HANDLE + 3) return { kind: 'scale', sheet, pg, x, y };
  if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { kind: 'move', sheet, pg, x, y };
  clearSelection();
  return { kind: 'lasso', sheet, pg, pts: [x, y] };
}
function transformFor(g, x, y) {
  if (g.kind === 'move') return moveBy(x - g.x, y - g.y);
  const b = sel.box, k = Math.min(8, Math.max(0.15, Math.max((x - b.x0) / (g.x - b.x0), (y - b.y0) / (g.y - b.y0))));
  return scaleFrom(b.x0, b.y0, k);
}
export function selMove(g, [x, y]) {
  if (g.kind === 'lasso') {
    g.pts.push(x, y);
    const ctx = g.sheet.ctxLive;
    clearLive(g.sheet);
    ctx.save(); ctx.setLineDash([1.4, 1.1]); ctx.strokeStyle = ACCENT; ctx.lineWidth = Math.max(0.3, 1.6 / view.scale);
    ctx.beginPath(); ctx.moveTo(g.pts[0], g.pts[1]);
    for (let i = 2; i < g.pts.length; i += 2) ctx.lineTo(g.pts[i], g.pts[i + 1]);
    ctx.stroke(); ctx.restore();
    return;
  }
  if (!g.moving) { g.moving = true; renderInkFor(g.pg, new Set(sel.strokes)); }   // lift the selection off the page
  const f = transformFor(g, x, y), moved = sel.strokes.map(s => map(s, f, g.pg));
  paint(g.sheet, moved, boxOf(moved, g.pg), g.pg);
  g.sheet.ctxLive.save();
  moved.forEach(s => drawStroke(g.sheet.ctxLive, s, g.pg));
  g.sheet.ctxLive.restore();
}
export function selUp(g, [x, y]) {
  if (g.kind === 'lasso') {
    const pts = g.pts;
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (len < 3) {                                       // a tap: pick the stroke under it
      const top = [...g.pg.strokes].reverse(), near = s => nearStroke(s, pts[0], pts[1], isImg(s) || isText(s) ? 0 : 2.5, g.pg);
      const hit = top.find(s => !isImg(s) && near(s)) || top.find(s => isImg(s) && near(s));   // ink sits on top of pictures
      select(g.pg, hit ? [hit] : []);
    } else {                                             // a loop: strokes mostly inside it
      select(g.pg, g.pg.strokes.filter(s => {
        const p = samples(s, g.pg);
        let n = 0;
        for (let i = 0; i < p.length; i += 3) if (inside(p[i], p[i + 1], pts)) n++;
        return n / (p.length / 3) >= 0.5;
      }));
    }
    if (!sel) clearLive(g.sheet);
    return;
  }
  if (!sel) return;
  if (!g.moving) { redraw(); return; }                  // a tap inside the selection: nothing to do
  const f = transformFor(g, x, y);
  replace(new Map(sel.strokes.map(s => [s, settle(map(s, f, g.pg))])));
}

/* --- actions --- */
export function deleteSelection() {
  if (!sel) return;
  const pg = sel.pg, gone = new Set(sel.strokes), before = pg.strokes;
  pg.strokes = before.filter(s => !gone.has(s));
  pushUndo(pg, before);
  clearSelection();
  renderInkFor(pg); scheduleSave();
}
export function duplicateSelection() {
  if (!sel) return;
  const pg = sel.pg, before = pg.strokes;
  const copies = sel.strokes.map(s => isText(s) ? { ...s, r: s.r + layout(pg, s).all } : map(s, moveBy(6, 6), pg));   // text: on the lines below it
  pg.strokes = before.concat(copies);
  pushUndo(pg, before);
  sel.strokes = copies; sel.box = boxOf(copies, pg);
  renderInkFor(pg); scheduleSave();
}
/* Recolours the selection: pen strokes and text take pen colour i, highlights take highlighter colour i. */
export function recolourSelection(i) {
  if (!sel) return;
  const ink = sel.strokes.filter(s => !isImg(s));                  // pictures keep their colours
  if (ink.length) replace(new Map(ink.map(s => [s, { ...s, c: (s.t === 'hl' ? HL_COLOURS : PEN_COLOURS)[i] }])));
}
/* Selects these items on a page (a picture just inserted). The Select tool must already be on. */
export function selectItems(pg, items) { select(pg, items); }
/* The selected text block, if the selection is exactly one: { pg, item }. */
export const selectedText = () => sel && sel.strokes.length === 1 && isText(sel.strokes[0]) ? { pg: sel.pg, item: sel.strokes[0] } : null;
