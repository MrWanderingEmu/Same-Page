/* Pure drawing: paper templates and ink strokes onto any 2D context already scaled to millimetres.
   Used for the screen, the page thumbnails and the exports. */
import { pageSize, TOP_GAP, LINE_COL, HL_ALPHA } from './config.js';

/* Draws a page's paper onto ctx. k = device pixels per mm. */
export function drawTemplate(ctx, pg, k) {
  const [W, H] = pageSize(pg);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const t = pg.tpl;
  if (t === 'blank') return;
  const sp = pg.spacing[t], m = pg.margin[t] || 0;
  const hair = Math.max(0.2, 1 / k);                         // never thinner than 1 device pixel
  const snap = v => (Math.round(v * k - 0.5) + 0.5) / k;     // crisp 1px lines
  const hline = (y, x0 = 0, x1 = W) => { const yy = snap(y); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); };
  const dotted = (ys, col, w) => {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash([0.9, 1.3]); ctx.beginPath();
    ys.forEach(y => hline(y)); ctx.stroke(); ctx.setLineDash([]);
  };

  ctx.lineCap = 'butt';
  if (t === 'ruled') {
    ctx.strokeStyle = LINE_COL.ruled; ctx.lineWidth = hair; ctx.beginPath();
    for (let y = TOP_GAP; y <= H - 6; y += sp) hline(y);
    ctx.stroke();
  } else if (t === 'thirds') {
    // Dotted thirds: solid head line, dotted middle line, solid base line, then a descender third.
    const rows = [];
    for (let y = TOP_GAP; y + 2 * sp <= H - 6; y += 3 * sp) rows.push(y);
    ctx.strokeStyle = LINE_COL.base; ctx.lineWidth = hair; ctx.beginPath();
    rows.forEach(y => hline(y)); ctx.stroke();
    ctx.strokeStyle = LINE_COL.base; ctx.lineWidth = hair * 1.4; ctx.beginPath();
    rows.forEach(y => hline(y + 2 * sp)); ctx.stroke();
    dotted(rows.map(y => y + sp), LINE_COL.thirds, hair * 1.2);
  } else if (t === 'thirds2' || t === 'sky') {
    // Rows of three equal bands touching each other: solid line, two dotted lines, solid line.
    // Sky, grass, dirt colours the bands: tall letters reach the sky, tails go down into the dirt.
    const rows = [];
    for (let y = TOP_GAP; y + 3 * sp <= H - 6; y += 3 * sp) rows.push(y);
    if (t === 'sky') {
      rows.forEach(y => ['sky', 'grass', 'dirt'].forEach((c, i) => { ctx.fillStyle = LINE_COL[c]; ctx.fillRect(0, y + i * sp, W, sp); }));
    }
    const solid = t === 'sky' ? LINE_COL.band : LINE_COL.base, dots = t === 'sky' ? LINE_COL.band : LINE_COL.thirds;
    ctx.strokeStyle = solid; ctx.lineWidth = hair; ctx.beginPath();
    rows.forEach(y => hline(y)); if (rows.length) hline(rows[rows.length - 1] + 3 * sp);
    ctx.stroke();
    dotted(rows.flatMap(y => [y + sp, y + 2 * sp]), dots, hair * 1.2);
  } else if (t === 'grid') {
    const ox = (W % sp) / 2, oy = (H % sp) / 2;
    ctx.strokeStyle = LINE_COL.grid; ctx.lineWidth = hair; ctx.beginPath();
    for (let x = ox; x <= W + 0.01; x += sp) { const xx = snap(x); ctx.moveTo(xx, 0); ctx.lineTo(xx, H); }
    for (let y = oy; y <= H + 0.01; y += sp) hline(y);
    ctx.stroke();
  }
  if (m > 0) {
    ctx.strokeStyle = LINE_COL.margin; ctx.lineWidth = hair * 1.3; ctx.beginPath();
    const xx = snap(m); ctx.moveTo(xx, 0); ctx.lineTo(xx, H); ctx.stroke();
  }
}

/* Pen strokes are drawn as smoothed quadratic segments through the midpoints of
   the recorded points; each segment takes its width from the pen pressure. */
const wAt = (s, i) => s.pr ? s.w * (0.45 + 1.1 * s.p[i * 3 + 2]) : s.w;

export function penStyle(ctx, s) { ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }

export function drawSeg(ctx, s, k) {   // segment ending near point k (k >= 1)
  const p = s.p, cx = p[(k - 1) * 3], cy = p[(k - 1) * 3 + 1];
  const sx = k === 1 ? cx : (p[(k - 2) * 3] + cx) / 2, sy = k === 1 ? cy : (p[(k - 2) * 3 + 1] + cy) / 2;
  const ex = (cx + p[k * 3]) / 2, ey = (cy + p[k * 3 + 1]) / 2;
  ctx.lineWidth = (wAt(s, k - 1) + wAt(s, k)) / 2;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
}
function drawTail(ctx, s) {            // last half-segment out to the final point
  const p = s.p, n = p.length / 3;
  if (n < 2) return;
  ctx.lineWidth = wAt(s, n - 1);
  ctx.beginPath();
  ctx.moveTo((p[(n - 2) * 3] + p[(n - 1) * 3]) / 2, (p[(n - 2) * 3 + 1] + p[(n - 1) * 3 + 1]) / 2);
  ctx.lineTo(p[(n - 1) * 3], p[(n - 1) * 3 + 1]); ctx.stroke();
}
export function drawDot(ctx, s) {
  ctx.beginPath(); ctx.arc(s.p[0], s.p[1], wAt(s, 0) / 2, 0, Math.PI * 2); ctx.fill();
}
export function tracePath(ctx, p) {    // one continuous smoothed path (used for highlighter)
  const n = p.length / 3;
  ctx.beginPath(); ctx.moveTo(p[0], p[1]);
  if (n === 1) { ctx.lineTo(p[0] + 0.01, p[1]); return; }
  for (let k = 1; k < n; k++) {
    const cx = p[(k - 1) * 3], cy = p[(k - 1) * 3 + 1];
    ctx.quadraticCurveTo(cx, cy, (cx + p[k * 3]) / 2, (cy + p[k * 3 + 1]) / 2);
  }
  ctx.lineTo(p[(n - 1) * 3], p[(n - 1) * 3 + 1]);
}
export function drawStroke(ctx, s) {
  if (s.t === 'hl') {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = HL_ALPHA;
    ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    tracePath(ctx, s.p); ctx.stroke();
    ctx.restore();
    return;
  }
  penStyle(ctx, s);
  const n = s.p.length / 3;
  if (n === 1) { drawDot(ctx, s); return; }
  for (let k = 1; k < n; k++) drawSeg(ctx, s, k);
  drawTail(ctx, s);
}
