/* Shapes: recognising a hand-drawn shape, and the geometry for every shape and
   graphic organiser the Insert tool can place. Everything is in millimetres and
   comes out as polylines ([[x, y], ...]), which become ordinary pen strokes. */
import { pageSize, TOP_GAP } from './config.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const pathLen = pts => pts.reduce((n, p, i) => i ? n + dist(pts[i - 1], p) : 0, 0);
function bounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* --- building blocks --- */
const line = (a, b) => [a, b];
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
function ellipse(cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2) {
  const n = Math.max(24, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) / 1.2));
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
}
function arrowHead(a, b, size) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = Math.min(size, dist(a, b) * 0.35);
  return [[b[0] - s * Math.cos(ang - 0.5), b[1] - s * Math.sin(ang - 0.5)], b, [b[0] - s * Math.cos(ang + 0.5), b[1] - s * Math.sin(ang + 0.5)]];
}

/* Points every `step` mm along a polyline (corners kept exactly), as a stroke's flat
   [x, y, pressure, ...] list. Dense points keep corners sharp with the smoothed pen. */
export function densify(poly, step = 0.8) {
  const out = [];
  const push = (x, y) => out.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100, 0.5);
  push(...poly[0]);
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i], n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) push(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n);
  }
  return out;
}

/* =========================================================================
   Recognition. Given a stroke's points, returns { name, polys } or null.
   ========================================================================= */
function rdp(pts, eps) {                     // Ramer–Douglas–Peucker simplification
  if (pts.length < 3) return pts.slice();
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts[pts.length - 1]); if (d > max) { max = d; idx = i; } }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}
const angleAt = (a, b, c) => {               // interior angle at b, degrees
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1)))) * 180 / Math.PI;
};
/* Corners of a closed hand-drawn shape. */
function corners(pts, perim) {
  let far = 0, fd = 0;
  pts.forEach((p, i) => { const d = dist(p, pts[0]); if (d > fd) { fd = d; far = i; } });
  const eps = perim * 0.035;
  let v = rdp(pts.slice(0, far + 1), eps).slice(0, -1).concat(rdp(pts.slice(far).concat([pts[0]]), eps).slice(0, -1));
  // drop vertices that are nearly straight or crowded together (the start/end overlap, wobbles)
  for (let changed = true; changed && v.length > 2;) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const a = v[(i - 1 + v.length) % v.length], b = v[i], c = v[(i + 1) % v.length];
      if (angleAt(a, b, c) > 150 || dist(a, b) < perim * 0.06) { v.splice(i, 1); changed = true; break; }
    }
  }
  return v;
}
const polyError = (pts, v) => pts.reduce((n, p) => n + Math.min(...v.map((a, i) => segDist(p, a, v[(i + 1) % v.length]))), 0) / pts.length;

function snapAngle(a, b) {                   // nearly horizontal / vertical lines become exactly so
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, d = dist(a, b);
  for (const t of [0, 90, 180, -90, -180]) {
    if (Math.abs(ang - t) < 6) { const r = t * Math.PI / 180; return [a[0] + d * Math.cos(r), a[1] + d * Math.sin(r)]; }
  }
  return b;
}

export function recognise(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 3) pts.push([flat[i], flat[i + 1]]);
  if (pts.length < 5) return null;
  const len = pathLen(pts);
  if (len < 8) return null;
  const a = pts[0], b = pts[pts.length - 1], chord = dist(a, b);

  // Straight line
  if (chord > 6 && len / chord < 1.15 && Math.max(...pts.map(p => segDist(p, a, b))) < Math.max(1.5, chord * 0.06)) {
    return { name: 'line', polys: [line(a, snapAngle(a, b))] };
  }

  // Everything else must be closed: the end comes back near the start.
  const bb = bounds(pts), diag = Math.hypot(bb.w, bb.h);
  if (chord > Math.max(diag * 0.28, 6) || Math.min(bb.w, bb.h) < 4) return null;
  const ring = pts.concat([pts[0]]), perim = pathLen(ring);

  // Triangle or four-sided shape
  const v = corners(pts, perim);
  if ((v.length === 3 || v.length === 4) && polyError(pts, v) < (perim / v.length) * 0.07) {
    if (v.length === 3) return { name: 'triangle', polys: [v.concat([v[0]])] };
    const square = v.every((p, i) => Math.abs(angleAt(v[(i + 3) % 4], p, v[(i + 1) % 4]) - 90) < 20);
    const level = v.every((p, i) => { const q = v[(i + 1) % 4], ang = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI) % 90; return ang < 14 || ang > 76; });
    if (square && level) {
      const r = bounds(v);
      if (Math.abs(r.w - r.h) < Math.max(r.w, r.h) * 0.12) { const s = (r.w + r.h) / 2; r.x += (r.w - s) / 2; r.y += (r.h - s) / 2; r.w = r.h = s; }
      return { name: r.w === r.h ? 'square' : 'rectangle', polys: [rect(r.x, r.y, r.w, r.h)] };
    }
    return { name: 'shape', polys: [v.concat([v[0]])] };
  }

  // Circle or oval
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  let rx = bb.w / 2, ry = bb.h / 2;
  const err = pts.reduce((n, p) => n + Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1), 0) / pts.length;
  if (err < 0.13) {
    const circle = Math.abs(rx - ry) < Math.max(rx, ry) * 0.15;
    if (circle) rx = ry = (rx + ry) / 2;
    return { name: circle ? 'circle' : 'oval', polys: [ellipse(cx, cy, rx, ry)] };
  }
  return null;
}

/* =========================================================================
   Insertable shapes and organisers. Each make() takes the box the teacher
   dragged ({ x, y, w, h }) plus the drag's start and end points, and returns polylines.
   fit: what a tap (rather than a drag) does — 'size' = a default size at the tap,
   'page' = fill the page's writing area, 'half' = fill the top or bottom half (whichever
   was tapped), 'band' = full width at the tap.
   ========================================================================= */
const ARROW = 4.5;
export const INSERTS = [
  { id: 'line', group: 'Shapes', label: 'Line', fit: 'size', make: (r, a, b) => [line(a, b)] },
  { id: 'arrow', group: 'Shapes', label: 'Arrow', fit: 'size', make: (r, a, b) => [line(a, b), arrowHead(a, b, ARROW)] },
  { id: 'rect', group: 'Shapes', label: 'Rectangle', fit: 'size', make: r => [rect(r.x, r.y, r.w, r.h)] },
  { id: 'circle', group: 'Shapes', label: 'Circle', fit: 'size', square: true, make: r => [ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2)] },
  { id: 'triangle', group: 'Shapes', label: 'Triangle', fit: 'size', make: r => [[[r.x, r.y + r.h], [r.x + r.w / 2, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]] },
  { id: 'right', group: 'Shapes', label: 'Right angle', say: 'right-angled triangle', fit: 'size', make: r => [[[r.x, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h], [r.x, r.y]]] },

  { id: 'tchart', group: 'Organisers', label: 'T-chart', say: 'T-chart', fit: 'page', make: r => {
    const head = r.y + Math.min(r.h * 0.14, 16);
    return [line([r.x, head], [r.x + r.w, head]), line([r.x + r.w / 2, r.y], [r.x + r.w / 2, r.y + r.h])];
  } },
  { id: 'venn2', group: 'Organisers', label: 'Venn', say: 'Venn diagram', fit: 'half', make: r => {
    const rad = Math.min(r.w / 3.1, r.h / 2), d = rad * 1.1, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    return [ellipse(cx - d / 2, cy, rad, rad), ellipse(cx + d / 2, cy, rad, rad)];
  } },
  { id: 'venn3', group: 'Organisers', label: 'Venn × 3', say: 'three-circle Venn diagram', fit: 'half', make: r => {
    const rad = Math.min(r.w / 3.1, r.h / 2.95), d = rad * 1.1, cx = r.x + r.w / 2, cy = r.y + r.h / 2 - d * 0.145;
    return [ellipse(cx - d / 2, cy - d * 0.29, rad, rad), ellipse(cx + d / 2, cy - d * 0.29, rad, rad), ellipse(cx, cy + d * 0.58, rad, rad)];
  } },
  { id: 'ychart', group: 'Organisers', label: 'Y-chart', say: 'Y-chart', fit: 'page', make: r => {
    const c = [r.x + r.w / 2, r.y + r.h * 0.42];
    return [rect(r.x, r.y, r.w, r.h), line(c, [r.x, r.y]), line(c, [r.x + r.w, r.y]), line(c, [c[0], r.y + r.h])];
  } },
  { id: 'kwl', group: 'Organisers', label: '3 columns', say: 'three-column chart', fit: 'page', make: r => {
    const head = r.y + Math.min(r.h * 0.12, 14);
    return [rect(r.x, r.y, r.w, r.h), line([r.x, head], [r.x + r.w, head]),
      line([r.x + r.w / 3, r.y], [r.x + r.w / 3, r.y + r.h]), line([r.x + r.w * 2 / 3, r.y], [r.x + r.w * 2 / 3, r.y + r.h])];
  } },
  { id: 'frayer', group: 'Organisers', label: 'Frayer', say: 'Frayer model', fit: 'page', make: r => {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w * 0.2, ry = Math.min(r.h * 0.13, rx * 0.75);
    return [rect(r.x, r.y, r.w, r.h), ellipse(cx, cy, rx, ry),
      line([r.x, cy], [cx - rx, cy]), line([cx + rx, cy], [r.x + r.w, cy]),
      line([cx, r.y], [cx, cy - ry]), line([cx, cy + ry], [cx, r.y + r.h])];
  } },
  { id: 'grid4', group: 'Organisers', label: '2 × 2 grid', fit: 'page', make: r => [rect(r.x, r.y, r.w, r.h),
    line([r.x + r.w / 2, r.y], [r.x + r.w / 2, r.y + r.h]), line([r.x, r.y + r.h / 2], [r.x + r.w, r.y + r.h / 2])] },
  { id: 'story', group: 'Organisers', label: 'Story mountain', fit: 'page', make: r => {
    const base = r.y + r.h * 0.88;
    return [[[r.x, base], [r.x + r.w * 0.16, base], [r.x + r.w * 0.58, r.y + r.h * 0.1], [r.x + r.w * 0.84, base], [r.x + r.w, base]]];
  } },
  { id: 'mindmap', group: 'Organisers', label: 'Mind map', fit: 'page', make: r => {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, crx = r.w * 0.17, cry = Math.min(r.h * 0.1, crx * 0.7);
    const orx = r.w * 0.13, ory = Math.min(r.h * 0.075, orx * 0.6), out = [ellipse(cx, cy, crx, cry)];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a);
      const ox = cx + (r.w / 2 - orx) * ca, oy = cy + (r.h / 2 - ory) * sa;
      out.push(ellipse(ox, oy, orx, ory), line([cx + crx * ca, cy + cry * sa], [ox - orx * ca, oy - ory * sa]));
    }
    return out;
  } },
  { id: 'numline', group: 'Organisers', label: 'Number line', fit: 'band', bandH: 16, make: r => {
    const y = r.y + r.h / 2, a = [r.x, y], b = [r.x + r.w, y], t = Math.min(4, r.h * 0.3), inset = r.w * 0.06, out = [line(a, b), arrowHead(b, a, 3.5), arrowHead(a, b, 3.5)];
    for (let i = 0; i <= 10; i++) { const x = r.x + inset + (r.w - 2 * inset) * i / 10; out.push(line([x, y - t], [x, y + t])); }
    return out;
  } },
  { id: 'sequence', group: 'Organisers', label: 'Sequence', fit: 'band', bandH: 40, make: r => {
    const across = r.w >= r.h, n = 3, gap = (across ? r.w : r.h) * 0.09, size = ((across ? r.w : r.h) - gap * (n - 1)) / n, out = [];
    for (let i = 0; i < n; i++) {
      const o = i * (size + gap);
      out.push(across ? rect(r.x + o, r.y, size, r.h) : rect(r.x, r.y + o, r.w, size));
      if (i < n - 1) {
        const a = across ? [r.x + o + size + gap * 0.18, r.y + r.h / 2] : [r.x + r.w / 2, r.y + o + size + gap * 0.18];
        const b = across ? [r.x + o + size + gap * 0.82, r.y + r.h / 2] : [r.x + r.w / 2, r.y + o + size + gap * 0.82];
        out.push(line(a, b), arrowHead(a, b, Math.min(3.5, gap * 0.4)));
      }
    }
    return out;
  } },
];
export const insertById = id => INSERTS.find(i => i.id === id);

/* The box an item fills when the teacher taps instead of dragging. */
export function tapBox(item, [x, y], pg) {
  if (item.fit === 'size') {
    if (item.id === 'line' || item.id === 'arrow') return { a: [x - 30, y], b: [x + 30, y] };
    const s = 40; return { a: [x - s / 2, y - s / 2], b: [x + s / 2, y + s / 2] };
  }
  const [W, H] = pageSize(pg), m = pg.margin[pg.tpl] || 0, left = m > 0 ? m + 5 : 12, right = W - 12;
  const top = TOP_GAP + 6, bottom = H - 14, mid = (top + bottom) / 2;
  if (item.fit === 'band') { const h = item.bandH; return { a: [left, y - h / 2], b: [right, y + h / 2] }; }
  if (item.fit === 'half') return y < mid ? { a: [left, top], b: [right, mid - 4] } : { a: [left, mid + 4], b: [right, bottom] };
  return { a: [left, top], b: [right, bottom] };
}

/* Polylines for an item placed from a to b (the drag's start and end). */
export function placeItem(item, a, b) {
  if (item.square) {                         // circles stay round: the larger side wins
    const s = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    b = [a[0] + Math.sign(b[0] - a[0] || 1) * s, a[1] + Math.sign(b[1] - a[1] || 1) * s];
  }
  const r = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
  return item.make(r, a, b);
}
