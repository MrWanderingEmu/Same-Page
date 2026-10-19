/* Ruler: a see-through 30 cm school ruler lying on the page, at true size.
   - Drag it (pen, mouse or finger) to move it.
   - Drag the round knob to turn it (it clicks to level, upright and 45°); tap the knob to
     swap between level and upright.
   - A pen or highlighter stroke started along either long edge is ruled: it follows the
     edge in a dead-straight line, the way you'd model ruling up a margin.
   It sits in a layer over the stage (so it can hang off the page without making the page
   scroll), and remembers its place in millimetres from the corner of the first page. */
import { $, $$ } from './util.js';
import { stage, view, sheets, onLayout } from './board.js';
import { state } from './state.js';

const LEN = 320, WID = 36;           // mm: 0–30 cm, with 10 mm spare at each end
const ZERO = 10;                     // mm from the left end to the 0 mark
const KNOB = [LEN - 17, WID / 2 + 4], KNOB_R = 6.5;
const EDGE_IN = 3, EDGE_OUT = 7;     // a stroke starting this close to an edge (inside / outside, mm) is ruled
const SNAP = 4;                      // degrees: turning clicks to the nearest 45° within this

const layer = $('#rulerlayer'), el = $('#ruler'), angleLabel = el.querySelector('.angle');
const r = { on: false, x: 0, y: 0, a: 0 };   // centre (mm from the first page's top-left) and angle (radians)

export const rulerShown = () => r.on;

/* --- the drawing: ticks every millimetre, numbers every centimetre --- */
function build() {
  let ticks = '', nums = '';
  for (let i = 0; i <= 300; i++) {
    const x = ZERO + i, h = i % 10 === 0 ? 7.5 : i % 5 === 0 ? 5 : 3;
    ticks += `M${x} 0V${h}`;
    if (i % 10 === 0) nums += `<text x="${x}" y="12.6">${i / 10}</text>`;
  }
  const [kx, ky] = KNOB;
  el.querySelector('svg').innerHTML = `
    <rect class="body" x="0.25" y="0.25" width="${LEN - 0.5}" height="${WID - 0.5}" rx="1.6"/>
    <path class="ticks" d="${ticks}"/>${nums}
    <text class="cm" x="${ZERO + 3}" y="${WID - 4}">cm</text>
    <g class="knob"><circle cx="${kx}" cy="${ky}" r="${KNOB_R}"/>
      <path d="M${kx + 3.2} ${ky - 1.6}a3.6 3.6 0 1 0 .4 3.2M${kx + 3.4} ${ky - 4.2}v2.8h-2.8"/></g>`;
}

/* --- where it is on screen --- */
function pose() {
  const o = sheets[0].el.getBoundingClientRect(), k = view.scale;
  return { cx: o.left + r.x * k, cy: o.top + r.y * k, k, ux: Math.cos(r.a), uy: Math.sin(r.a) };
}
/* A screen point in the ruler's own millimetres: u along it from the left end, v down from the top edge. */
function local(px, py, p = pose()) {
  const dx = (px - p.cx) / p.k, dy = (py - p.cy) / p.k;
  return [dx * p.ux + dy * p.uy + LEN / 2, -dx * p.uy + dy * p.ux + WID / 2];
}
function toScreen(u, v, p = pose()) {
  const du = u - LEN / 2, dv = v - WID / 2;
  return [p.cx + (du * p.ux - dv * p.uy) * p.k, p.cy + (du * p.uy + dv * p.ux) * p.k];
}

function place() {
  if (!r.on) return;
  const s = stage.getBoundingClientRect(), p = pose(), w = LEN * p.k, h = WID * p.k;
  Object.assign(layer.style, { left: s.left + 'px', top: s.top + 'px', width: s.width + 'px', height: s.height + 'px' });
  el.style.width = w + 'px'; el.style.height = h + 'px';
  el.style.transform = `translate(${p.cx - s.left - w / 2}px, ${p.cy - s.top - h / 2}px) rotate(${r.a}rad)`;
}

export function toggleRuler() {
  r.on = !r.on;
  layer.hidden = !r.on;
  $$('[data-act="ruler"]').forEach(b => b.classList.toggle('on', r.on));
  if (!r.on) return;
  // Lay it level across the middle of the part of the current page that's on screen.
  const sheet = sheets.find(s => s.kind === 'page' && s.pi === state.cur) || sheets[0];
  const b = sheet.el.getBoundingClientRect(), st = stage.getBoundingClientRect(), o = sheets[0].el.getBoundingClientRect();
  const cx = (Math.max(b.left, st.left) + Math.min(b.right, st.right)) / 2;
  const cy = (Math.max(b.top, st.top) + Math.min(b.bottom, st.bottom)) / 2;
  r.x = (cx - o.left) / view.scale; r.y = (cy - o.top) / view.scale; r.a = 0;
  place();
}

/* --- what a pointer at (px, py) would touch: 'turn' (the knob), 'move' (the body),
       { edge: top|bottom } (close to a long edge, for ruling), or null --- */
export function rulerHit(px, py) {
  if (!r.on) return null;
  const [u, v] = local(px, py);
  if (Math.hypot(u - KNOB[0], v - KNOB[1]) <= KNOB_R + 2) return { kind: 'turn' };
  if (u < 0 || u > LEN) return null;
  if (v >= EDGE_IN && v <= WID - EDGE_IN) return { kind: 'move' };
  if (v > -EDGE_OUT && v < EDGE_IN) return { kind: 'edge', v: 0 };
  if (v > WID - EDGE_IN && v < WID + EDGE_OUT) return { kind: 'edge', v: WID };
  return null;
}
/* Slides a screen point onto the ruler edge, set out by half the pen's width (mm) so the ink just touches it. */
export function ruledPoint(edge, px, py, half) {
  const p = pose(), [u] = local(px, py, p);
  const off = half + 0.15;
  return toScreen(Math.max(0, Math.min(LEN, u)), edge.v === 0 ? -off : WID + off, p);
}

/* --- moving and turning --- */
export function rulerDown(hit, px, py) {
  const p = pose();
  return { kind: hit.kind, px, py, x: r.x, y: r.y, a: r.a, start: Math.atan2(py - p.cy, px - p.cx), t0: performance.now(), far: 0 };
}
export function rulerMove(g, px, py) {
  g.far = Math.max(g.far, Math.hypot(px - g.px, py - g.py));
  if (g.kind === 'move') {
    r.x = g.x + (px - g.px) / view.scale; r.y = g.y + (py - g.py) / view.scale;
  } else {
    const p = pose();
    let deg = (g.a + Math.atan2(py - p.cy, px - p.cx) - g.start) * 180 / Math.PI;
    const near = Math.round(deg / 45) * 45;
    if (Math.abs(deg - near) < SNAP) deg = near;
    r.a = deg * Math.PI / 180;
    let shown = Math.round(((deg % 180) + 180) % 180);
    if (shown > 90) shown = 180 - shown;                       // the angle to the lines, 0–90°
    angleLabel.textContent = shown + '°';
    angleLabel.hidden = false;
  }
  place();
}
export function rulerUp(g) {
  angleLabel.hidden = true;
  if (g.kind === 'turn' && g.far < 8 && performance.now() - g.t0 < 400) {
    // A tap on the knob: level <-> upright.
    const upright = Math.abs(Math.sin(r.a)) > 0.7;
    r.a = upright ? 0 : Math.PI / 2;
    place();
  }
}

build();
onLayout(place);
stage.addEventListener('scroll', place, { passive: true });
