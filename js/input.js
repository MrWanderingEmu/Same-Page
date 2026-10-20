/* Pointer input: pen, mouse, touch.
   - Pen and mouse draw. The pen's eraser end or side (barrel) button erases.
   - A stroke belongs to the page it starts on. The eraser works across both pages.
   - Touch: palms are ignored while the pen is near the screen. Fingers draw until
     a pen has been used ('auto'), then they scroll / swipe pages instead.
   - Hold the pen still at the end of a stroke and a rough shape snaps into a clean one.
   - Insert tool: drag a box to place a shape or organiser (or tap to use its default size).
   - Double-tap a page (pen or finger) to switch between one page and two.
   - Select tool (select.js), laser pointer (laser.js) and ruler (ruler.js) get their gestures from here too.
   - A pen or highlighter stroke started along the ruler's edge is ruled straight.
   - Reveal cover (cover.js): its tab is dragged or tapped from here; nothing else happens on the cover. */
import { PEN_COLOURS, HL_COLOURS, PEN_SIZES, HL_SIZES, ERASER_SIZES, HL_ALPHA } from './config.js';
import { state } from './state.js';
import { stage, view, sheets, sheetAt, clearLive, renderInkFor, showEraser, hideEraser } from './board.js';
import { penStyle, drawSeg, drawDot, tracePath, drawStroke } from './draw.js';
import { pushUndo, record, discardLast } from './history.js';
import { scheduleSave } from './storage.js';
import { setActive, stepPage, toggleFocus } from './pages.js';
import { closePops, updateMenu, finishInsert } from './ui.js';
import { recognise, densify, insertById, placeItem, tapBox } from './shapes.js';
import { selDown, selMove, selUp } from './select.js';
import { laserDown, laserMove, laserUp, showDot, hideDot } from './laser.js';
import { rulerHit, ruledPoint, rulerDown, rulerMove, rulerUp } from './ruler.js';
import { coverTabAt, coverDown, coverMove, coverUp, isCovered, coveredHint } from './cover.js';

let active = null;          // the current gesture
let lastPen = -1e9;         // time of the last pen event (hover counts)
const PALM_WINDOW = 700;    // ms after a pen event during which touches are ignored
const HOLD_MS = 450;        // keep the pen this still (ms) at the end of a stroke to snap it to a shape
const DOUBLE_MS = 350;      // two taps within this time make a double-tap
let lastTap = null;         // the previous tap, to spot double-taps
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
  if (e.pointerType === 'touch' && now - lastPen < PALM_WINDOW) return;  // palm rejection
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
  const rh = rulerHit(e.clientX, e.clientY);
  if (rh && rh.kind !== 'edge' && !wantsEraser(e) && state.tool !== 'laser') {   // move or turn the ruler
    e.preventDefault(); closePops(); capture(e.pointerId);
    active = { id: e.pointerId, ptype: e.pointerType, kind: 'ruler', g: rulerDown(rh, e.clientX, e.clientY) };
    return;
  }
  const tab = !rh && coverTabAt(e.clientX, e.clientY);
  if (tab) {                                                               // drag or tap the reveal cover's tab
    e.preventDefault(); closePops(); capture(e.pointerId);
    active = { id: e.pointerId, ptype: e.pointerType, kind: 'cover', g: coverDown(tab, e.clientY) };
    return;
  }
  if (e.pointerType === 'touch') {
    if (touchMode() === 'scroll') {
      active = { id: e.pointerId, ptype: 'touch', kind: 'pan', x: e.clientX, y: e.clientY, st: stage.scrollTop, sl: stage.scrollLeft, t0: now };
      capture(e.pointerId);
      return;
    }
  }
  const rects = sheets.map(s => s.el.getBoundingClientRect());
  const sheet = sheetAt(e.clientX, rects);
  if (sheet.kind !== 'page') return;                                      // inside cover / blank page
  e.preventDefault();
  closePops();
  capture(e.pointerId);
  const rect = rects[sheets.indexOf(sheet)];
  if (state.tool === 'laser' && !wantsEraser(e)) {                         // pointing doesn't change the active page
    active = { id: e.pointerId, ptype: e.pointerType, kind: 'laser', rect, trail: laserDown(sheet, toPage(e, rect)) };
    showDot(e.clientX, e.clientY);
    return;
  }
  if (isCovered(state.pages[sheet.pi], toPage(e, rect)[1])) { coveredHint(); return; }   // hidden work stays untouched
  setActive(sheet.pi);
  if (state.tool === 'select' && !wantsEraser(e)) {
    active = { id: e.pointerId, ptype: e.pointerType, kind: 'select', rect, g: selDown(sheet, toPage(e, rect)) };
    return;
  }
  if (wantsEraser(e)) {
    active = { id: e.pointerId, ptype: e.pointerType, kind: 'erase', rects, before: new Map(), lx: e.clientX, ly: e.clientY };
    eraseAlong(e.clientX, e.clientY);
    showEraser(e.clientX, e.clientY);
  } else if (state.tool === 'insert') {
    startInsert(e, sheet, rects[sheets.indexOf(sheet)]);
  } else {
    startStroke(e, sheet, rects[sheets.indexOf(sheet)], rh && rh.kind === 'edge' ? rh : null);
  }
}

function onMove(e) {
  if (e.pointerType === 'pen') lastPen = performance.now();
  if (!active || e.pointerId !== active.id) { hoverCursor(e); return; }
  if (active.kind === 'ruler') { rulerMove(active.g, e.clientX, e.clientY); return; }
  if (active.kind === 'cover') { coverMove(active.g, e.clientY); return; }
  if (active.kind === 'pan') {
    stage.scrollTop = active.st - (e.clientY - active.y);
    stage.scrollLeft = active.sl - (e.clientX - active.x);
    return;
  }
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
  if (active.kind === 'stroke') {
    const { s, sheet, rect } = active;
    if (active.snapped) return;                                  // already a clean shape: wait for the pen to lift
    if (s.t === 'pen') penStyle(sheet.ctxLive, s);
    for (const ev of evs) {
      const [x, y] = strokePoint(ev);
      if (addPoint(ev, x, y) && s.t === 'pen') drawSeg(sheet.ctxLive, s, s.p.length / 3 - 1);
    }
    if (s.t === 'hl') drawHlLive(sheet, s);
    if (!active.edge) watchHold(toPage(e, rect));
  } else if (active.kind === 'insert') {
    active.b = toPage(e, active.rect);
    previewInsert(active);
  } else if (active.kind === 'laser') {
    for (const ev of evs) laserMove(active.trail, toPage(ev, active.rect));
    showDot(e.clientX, e.clientY);
  } else if (active.kind === 'select') {
    selMove(active.g, toPage(e, active.rect));
  } else {
    for (const ev of evs) eraseAlong(ev.clientX, ev.clientY);
    showEraser(e.clientX, e.clientY);
  }
}

function onEnd(e) {
  if (!active || e.pointerId !== active.id) return;
  const a = active; active = null;
  clearTimeout(a.holdTimer);
  const now = performance.now();
  if (a.kind === 'ruler') { rulerUp(a.g); return; }
  if (a.kind === 'cover') { coverUp(a.g); return; }
  if (a.kind === 'pan') {
    // Swipe left/right to change page (or spread) when the page isn't scrollable.
    const dx = e.clientX - a.x, dy = e.clientY - a.y;
    const scrollable = stage.scrollHeight > stage.clientHeight + 2;
    if (!scrollable && Math.abs(dx) > 90 && Math.abs(dx) > 2 * Math.abs(dy)) stepPage(dx < 0 ? 1 : -1);
    else if (Math.hypot(dx, dy) < 10 && now - a.t0 < 300) {                       // a finger tap
      const prev = lastTap;
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      if (prev && !prev.pg && now - prev.t < DOUBLE_MS && Math.hypot(prev.x - e.clientX, prev.y - e.clientY) < 30) {
        lastTap = null;
        const sheet = sheetAt(e.clientX, sheets.map(s => s.el.getBoundingClientRect()));
        if (sheet.kind === 'page') toggleFocus(sheet.pi);
      }
    }
  } else if (a.kind === 'stroke') {
    if (a.snapped) { commitStrokes(a, a.snapped); lastTap = null; return; }
    const tap = isTap(a, now), x = a.s.p[0], y = a.s.p[1], prev = lastTap;
    if (tap && prev && prev.pg === a.pg && now - prev.t < DOUBLE_MS && Math.hypot(prev.x - x, prev.y - y) < 2.5) {
      // A double-tap with the pen: take away the first dot, don't add the second.
      clearLive(a.sheet);
      discardLast(prev.pg, prev.stroke);
      lastTap = null;
      toggleFocus(state.pages.indexOf(a.pg));
      return;
    }
    commitStrokes(a, [a.s]);
    lastTap = tap ? { t: now, pg: a.pg, x, y, stroke: a.s } : null;
  } else if (a.kind === 'laser') {
    laserUp(a.trail);
    if (e.pointerType === 'touch') hideDot();
  } else if (a.kind === 'select') {
    selUp(a.g, toPage(e, a.rect));
  } else if (a.kind === 'insert') {
    let p = a.a, q = a.b;
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 3) ({ a: p, b: q } = tapBox(a.item, p, a.pg));
    commitStrokes(a, shapeStrokes(placeItem(a.item, p, q), 'pen', PEN_COLOURS[state.penColour], PEN_SIZES[state.size.pen]));
    finishInsert();
  } else if (a.kind === 'erase') {
    if (a.before.size) { record([...a.before].map(([pg, strokes]) => ({ pg, strokes }))); scheduleSave(); }
    if (state.tool !== 'eraser' || e.pointerType === 'touch') hideEraser();
  }
}

/* edge = the ruler edge the stroke started on, if any: every point then slides onto that edge. */
function startStroke(e, sheet, rect, edge) {
  const hl = state.tool === 'hl';
  const s = {
    t: hl ? 'hl' : 'pen',
    c: hl ? HL_COLOURS[state.hlColour] : PEN_COLOURS[state.penColour],
    w: hl ? HL_SIZES[state.size.hl] : PEN_SIZES[state.size.pen],
    pr: !hl && state.pressure && e.pointerType === 'pen',
    p: [],
  };
  active = { id: e.pointerId, ptype: e.pointerType, kind: 'stroke', s, sheet, rect, pg: state.pages[sheet.pi], t0: performance.now(), edge };
  const [x, y] = strokePoint(e);
  addPoint(e, x, y);
  clearLive(sheet);
  if (hl) drawHlLive(sheet, s); else { penStyle(sheet.ctxLive, s); drawDot(sheet.ctxLive, s); }
  if (!edge) watchHold([x, y]);
}
/* Where a pointer event puts ink on the stroke's page (mm), slid onto the ruler's edge for a ruled stroke. */
function strokePoint(ev) {
  const { edge, rect, s } = active;
  if (!edge) return toPage(ev, rect);
  const [cx, cy] = ruledPoint(edge, ev.clientX, ev.clientY, s.w / 2);
  return toPage({ clientX: cx, clientY: cy }, rect);
}

/* A quick touch that barely moved: a dot, or half of a double-tap. */
function isTap(a, now) {
  if (now - a.t0 > 300) return false;
  const p = a.s.p;
  for (let i = 3; i < p.length; i += 3) if (Math.abs(p[i] - p[0]) > 1.2 || Math.abs(p[i + 1] - p[1]) > 1.2) return false;
  return true;
}

/* --- hold to snap: if the pen stays still for HOLD_MS, try to recognise the stroke as a shape --- */
function watchHold(pt) {
  const a = active;
  if (!state.snap || a.snapped) return;
  if (a.hold && Math.hypot(pt[0] - a.hold[0], pt[1] - a.hold[1]) < 0.8) return;   // still holding still
  a.hold = pt;
  clearTimeout(a.holdTimer);
  a.holdTimer = setTimeout(() => {
    if (active !== a || a.snapped) return;
    const shape = recognise(a.s.p);
    if (!shape) return;
    a.snapped = shapeStrokes(shape.polys, a.s.t, a.s.c, a.s.w);
    clearLive(a.sheet);
    a.snapped.forEach(st => drawStroke(a.sheet.ctxLive, st));
  }, HOLD_MS);
}
const shapeStrokes = (polys, t, c, w) => polys.map(pl => ({ t, c, w, pr: false, p: densify(pl) }));

/* --- insert tool: drag out a box --- */
function startInsert(e, sheet, rect) {
  const item = insertById(state.insert);
  if (!item) { finishInsert(); return; }
  const p = toPage(e, rect);
  active = { id: e.pointerId, ptype: e.pointerType, kind: 'insert', item, sheet, rect, pg: state.pages[sheet.pi], a: p, b: p };
}
function previewInsert(a) {
  clearLive(a.sheet);
  if (Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]) < 3) return;
  shapeStrokes(placeItem(a.item, a.a, a.b), 'pen', PEN_COLOURS[state.penColour], PEN_SIZES[state.size.pen])
    .forEach(st => drawStroke(a.sheet.ctxLive, st));
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

/* Adds strokes to the gesture's page as one undoable step. */
function commitStrokes({ sheet, pg }, strokes) {
  clearLive(sheet);
  strokes = strokes.filter(s => s.p.length);
  if (!strokes.length || !state.pages.includes(pg)) return;
  pushUndo(pg, pg.strokes.slice());
  pg.strokes.push(...strokes);
  if (sheet.kind === 'page' && state.pages[sheet.pi] === pg) strokes.forEach(s => drawStroke(sheet.ctxInk, s));
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
  if (s.t === 'img') return false;          // the eraser rubs out writing on a picture, never the picture (Select › Delete does)
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
    const mx = (x - rect.left) / view.scale, my = (y - rect.top) / view.scale;
    if (isCovered(pg, my)) continue;
    if (eraseAt(pg, mx, my, r)) {
      if (!a.before.has(pg)) a.before.set(pg, before);
      touched.add(pg);
    }
  }
  a.lx = cx; a.ly = cy;
  touched.forEach(pg => renderInkFor(pg));   // not forEach(renderInkFor): Set.forEach would pass pg again as `skip`
}
function hoverCursor(e) {
  if (e.pointerType === 'touch') return;
  if (state.tool === 'laser') { showDot(e.clientX, e.clientY); return; }
  const eraserish = state.tool === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32));
  if (eraserish) showEraser(e.clientX, e.clientY); else hideEraser();
}

export function initInput() {
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onEnd);
  stage.addEventListener('pointercancel', onEnd);
  stage.addEventListener('pointerleave', () => { if (!active) { hideEraser(); hideDot(); } });
  stage.addEventListener('contextmenu', e => e.preventDefault());
}
