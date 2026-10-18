/* Pointer input: pen, mouse, touch.
   - Pen and mouse draw. The pen's eraser end or side (barrel) button erases.
   - A stroke belongs to the page it starts on. The eraser works across both pages.
   - Touch: palms are ignored while the pen is near the screen. Fingers draw until
     a pen has been used ('auto'), then they scroll / swipe pages instead. */
import { PEN_COLOURS, HL_COLOURS, PEN_SIZES, HL_SIZES, ERASER_SIZES, HL_ALPHA } from './config.js';
import { state } from './state.js';
import { stage, view, sheets, sheetAt, clearLive, renderInkFor, showEraser, hideEraser } from './board.js';
import { penStyle, drawSeg, drawDot, tracePath, drawStroke } from './draw.js';
import { pushUndo, record } from './history.js';
import { scheduleSave } from './storage.js';
import { setActive, stepPage } from './pages.js';
import { closePops, updateMenu } from './ui.js';

let active = null;          // the current gesture
let lastPen = -1e9;         // time of the last pen event (hover counts)
const PALM_WINDOW = 700;    // ms after a pen event during which touches are ignored
function capture(id) { try { stage.setPointerCapture(id); } catch (e) {} }

const touchMode = () => state.finger !== 'auto' ? state.finger : (state.penSeen ? 'scroll' : 'draw');
const toPage = (ev, r) => [(ev.clientX - r.left) / view.scale, (ev.clientY - r.top) / view.scale];
function wantsEraser(e) {
  if (state.tool === 'eraser') return true;
  if (e.pointerType === 'pen' && (e.buttons & 32)) return true;          // eraser end
  if ((e.pointerType === 'pen' || e.pointerType === 'mouse') && (e.buttons & 2)) return true; // barrel / right button
  return false;
}

function onDown(e) {
  if (e.target.closest('button')) return;                                 // e.g. "Add page" on the blank page
  const now = performance.now();
  if (e.pointerType === 'pen') {
    lastPen = now;
    if (!state.penSeen) { state.penSeen = true; scheduleSave(); updateMenu(); }
  }
  if (active) {
    // A pen always beats a finger or palm that got there first.
    if (e.pointerType !== 'touch' && active.ptype === 'touch') { if (active.sheet) clearLive(active.sheet); active = null; }
    else return;
  }
  if (e.pointerType === 'touch') {
    if (now - lastPen < PALM_WINDOW) return;                              // palm rejection
    if (touchMode() === 'scroll') {
      active = { id: e.pointerId, ptype: 'touch', kind: 'pan', x: e.clientX, y: e.clientY, st: stage.scrollTop, sl: stage.scrollLeft };
      capture(e.pointerId);
      return;
    }
  }
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
  const rects = sheets.map(s => s.el.getBoundingClientRect());
  const sheet = sheetAt(e.clientX, rects);
  if (sheet.kind !== 'page') return;                                      // inside cover / blank page
  e.preventDefault();
  closePops();
  capture(e.pointerId);
  setActive(sheet.pi);
  if (wantsEraser(e)) {
    active = { id: e.pointerId, ptype: e.pointerType, kind: 'erase', rects, before: new Map(), lx: e.clientX, ly: e.clientY };
    eraseAlong(e.clientX, e.clientY);
    showEraser(e.clientX, e.clientY);
  } else {
    startStroke(e, sheet, rects[sheets.indexOf(sheet)]);
  }
}

function onMove(e) {
  if (e.pointerType === 'pen') lastPen = performance.now();
  if (!active || e.pointerId !== active.id) { hoverCursor(e); return; }
  if (active.kind === 'pan') {
    stage.scrollTop = active.st - (e.clientY - active.y);
    stage.scrollLeft = active.sl - (e.clientX - active.x);
    return;
  }
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
  if (active.kind === 'stroke') {
    const { s, sheet, rect } = active;
    if (s.t === 'pen') penStyle(sheet.ctxLive, s);
    for (const ev of evs) {
      const [x, y] = toPage(ev, rect);
      if (addPoint(ev, x, y) && s.t === 'pen') drawSeg(sheet.ctxLive, s, s.p.length / 3 - 1);
    }
    if (s.t === 'hl') drawHlLive(sheet, s);
  } else {
    for (const ev of evs) eraseAlong(ev.clientX, ev.clientY);
    showEraser(e.clientX, e.clientY);
  }
}

function onEnd(e) {
  if (!active || e.pointerId !== active.id) return;
  const a = active; active = null;
  if (a.kind === 'pan') {
    // Swipe left/right to change page (or spread) when the page isn't scrollable.
    const dx = e.clientX - a.x, dy = e.clientY - a.y;
    const scrollable = stage.scrollHeight > stage.clientHeight + 2;
    if (!scrollable && Math.abs(dx) > 90 && Math.abs(dx) > 2 * Math.abs(dy)) stepPage(dx < 0 ? 1 : -1);
  } else if (a.kind === 'stroke') {
    commitStroke(a);
  } else if (a.kind === 'erase') {
    if (a.before.size) { record([...a.before].map(([pg, strokes]) => ({ pg, strokes }))); scheduleSave(); }
    if (state.tool !== 'eraser' || e.pointerType === 'touch') hideEraser();
  }
}

function startStroke(e, sheet, rect) {
  const hl = state.tool === 'hl';
  const s = {
    t: hl ? 'hl' : 'pen',
    c: hl ? HL_COLOURS[state.hlColour] : PEN_COLOURS[state.penColour],
    w: hl ? HL_SIZES[state.size.hl] : PEN_SIZES[state.size.pen],
    pr: !hl && state.pressure && e.pointerType === 'pen',
    p: [],
  };
  active = { id: e.pointerId, ptype: e.pointerType, kind: 'stroke', s, sheet, rect, pg: state.pages[sheet.pi] };
  const [x, y] = toPage(e, rect);
  addPoint(e, x, y);
  clearLive(sheet);
  if (hl) drawHlLive(sheet, s); else { penStyle(sheet.ctxLive, s); drawDot(sheet.ctxLive, s); }
}

function addPoint(ev, x, y) {
  const p = active.s.p;
  let pr = ev.pointerType === 'pen' ? (ev.pressure || 0.5) : 0.5;
  if (p.length) {
    const dx = x - p[p.length - 3], dy = y - p[p.length - 2];
    if (dx * dx + dy * dy < 0.0225) return false;               // ignore moves under 0.15 mm
    pr = p[p.length - 1] * 0.65 + pr * 0.35;                    // smooth pressure
  }
  p.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(pr * 100) / 100);
  return true;
}

function drawHlLive(sheet, s) {
  const ctx = sheet.ctxLive;
  clearLive(sheet);
  ctx.save();
  ctx.globalAlpha = HL_ALPHA; ctx.strokeStyle = s.c; ctx.lineWidth = s.w;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  tracePath(ctx, s.p); ctx.stroke();
  ctx.restore();
}

function commitStroke({ s, sheet, pg }) {
  clearLive(sheet);
  if (!s.p.length || !state.pages.includes(pg)) return;
  pushUndo(pg, pg.strokes.slice());
  pg.strokes.push(s);
  if (sheet.kind === 'page' && state.pages[sheet.pi] === pg) drawStroke(sheet.ctxInk, s);
  else renderInkFor(pg);
  scheduleSave();
}

/* --- eraser: removes whole strokes it touches --- */
const bbCache = new WeakMap();
function bbox(s) {
  let b = bbCache.get(s);
  if (!b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < s.p.length; i += 3) {
      const x = s.p[i], y = s.p[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    b = [x0 - s.w, y0 - s.w, x1 + s.w, y1 + s.w]; bbCache.set(s, b);
  }
  return b;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function hits(s, x, y, r) {
  const b = bbox(s);
  if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) return false;
  const p = s.p, n = p.length / 3, rr = r + s.w / 2;
  if (n === 1) return Math.hypot(p[0] - x, p[1] - y) <= rr;
  for (let i = 1; i < n; i++) if (segDist(x, y, p[i * 3 - 3], p[i * 3 - 2], p[i * 3], p[i * 3 + 1]) <= rr) return true;
  return false;
}
function eraseAt(pg, x, y, r) {      // replaces pg.strokes (never mutates it), so the old array is the undo snapshot
  const keep = pg.strokes.filter(s => !hits(s, x, y, r));
  if (keep.length === pg.strokes.length) return false;
  pg.strokes = keep;
  return true;
}
/* Erase from the last point to (cx, cy) in screen pixels, filling in fast swipes
   so nothing is skipped, and following the eraser onto whichever page it's over. */
function eraseAlong(cx, cy) {
  const a = active, r = ERASER_SIZES[state.size.eraser];
  const steps = Math.max(1, Math.ceil(Math.hypot(cx - a.lx, cy - a.ly) / (r * view.scale * 0.5)));
  const touched = new Set();
  for (let i = 1; i <= steps; i++) {
    const x = a.lx + (cx - a.lx) * i / steps, y = a.ly + (cy - a.ly) * i / steps;
    const sheet = sheetAt(x, a.rects);
    if (sheet.kind !== 'page') continue;
    const pg = state.pages[sheet.pi], rect = a.rects[sheets.indexOf(sheet)], before = pg.strokes;
    if (eraseAt(pg, (x - rect.left) / view.scale, (y - rect.top) / view.scale, r)) {
      if (!a.before.has(pg)) a.before.set(pg, before);
      touched.add(pg);
    }
  }
  a.lx = cx; a.ly = cy;
  touched.forEach(renderInkFor);
}
function hoverCursor(e) {
  if (e.pointerType === 'touch') return;
  const eraserish = state.tool === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32));
  if (eraserish) showEraser(e.clientX, e.clientY); else hideEraser();
}

export function initInput() {
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onEnd);
  stage.addEventListener('pointercancel', onEnd);
  stage.addEventListener('pointerleave', () => { if (!active) hideEraser(); });
  stage.addEventListener('contextmenu', e => e.preventDefault());
}
