/* Laser pointer: a glowing red dot that follows the pen (hovering or touching), and red
   trails that fade a moment after the pen lifts. Nothing is saved or added to undo. */
import { $ } from './util.js';
import { view, clearLive } from './board.js';
import { tracePath } from './draw.js';

const HOLD = 900, FADE = 600;      // ms a trail stays after lifting, then ms to fade out
const dot = $('#laserdot');
let trails = [];                   // { sheet, p: [x, y, 0, ...], end }
let painted = new Set();           // sheets with laser ink on them last frame
let raf = 0;

const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

function frame(now) {
  raf = 0;
  trails = trails.filter(t => !t.end || now - t.end < HOLD + FADE);
  const sheets = new Set(trails.map(t => t.sheet));
  for (const s of new Set([...painted, ...sheets])) clearLive(s);
  for (const t of trails) {
    const a = t.end ? Math.max(0, Math.min(1, 1 - (now - t.end - HOLD) / FADE)) : 1;
    const ctx = t.sheet.ctxLive;
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.globalAlpha = a;
    ctx.shadowColor = 'rgba(255,30,30,0.85)'; ctx.shadowBlur = 10 * view.dpr;
    ctx.strokeStyle = '#ff2b2b'; ctx.lineWidth = 1.5;
    tracePath(ctx, t.p); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,235,235,0.9)'; ctx.lineWidth = 0.45;
    tracePath(ctx, t.p); ctx.stroke();
    ctx.restore();
  }
  painted = sheets;
  if (trails.length) kick();
}

export function laserDown(sheet, [x, y]) { const t = { sheet, p: [x, y, 0], end: 0 }; trails.push(t); kick(); return t; }
export function laserMove(t, [x, y]) { t.p.push(x, y, 0); kick(); }
export function laserUp(t) { t.end = performance.now(); kick(); }

export function showDot(clientX, clientY) {
  dot.style.display = 'block';
  dot.style.transform = `translate(${clientX}px, ${clientY}px)`;
}
export function hideDot() { dot.style.display = 'none'; }
