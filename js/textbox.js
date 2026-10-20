/* The text panel: type or paste words and watch them settle onto the page's lines.
   Insert › Text, then tap where the text should start (tap again to move it). Pasting text
   with Ctrl+V does the same, starting near the top of the page in view. Tapping a text block
   with the Text tool, or Select › Edit, opens it again. Done adds it as one undoable step. */
import { pageSize, PEN_COLOURS } from './config.js';
import { state } from './state.js';
import { $, clamp } from './util.js';
import { stage, view, sheetFor, clearLive, renderInkFor } from './board.js';
import { drawStroke } from './draw.js';
import { pushUndo } from './history.js';
import { scheduleSave } from './storage.js';
import { renderTools } from './ui.js';
import { FONTS, guide, layout, textBox } from './text.js';
import { selectItems } from './select.js';

const panel = $('#textPanel'), input = $('#textIn'), note = $('#textNote');
let edit = null;      // { pg, item (the block being changed, or null), draft, back (tool to return to) }

export const textOpen = () => !!edit;

/* Where a block starting at page point (x, y) goes: the line at or just below y. */
function anchor(pg, [x, y]) {
  const g = guide(pg), [W] = pageSize(pg);
  const r = clamp(Math.ceil(g.rowAt(y) - 0.15), 0, Math.max(0, g.rows - 1));
  x = clamp(x, 2, W - 22);
  return { x: Math.round(x * 100) / 100, r, w: Math.round((W - 8 - x) * 100) / 100 };
}
/* Near the top of the part of the page in view, at the margin. */
function defaultSpot(pg) {
  const s = sheetFor(pg), g = guide(pg), m = !pg.bg && pg.margin && pg.margin[pg.tpl] ? pg.margin[pg.tpl] + 3 : 12;
  let y = g.base(0);
  if (s) {
    const top = (stage.getBoundingClientRect().top - s.el.getBoundingClientRect().top) / view.scale;
    if (top > 0) y = top + 10;
  }
  return [m, y];
}

/* Keeps the panel off the text: beside the page if there's room on the desk, otherwise
   at the top or bottom of the screen, whichever is further from the words. */
function placePanel(s, box) {
  const st = stage.getBoundingClientRect(), r = s.el.getBoundingClientRect(), gap = 14;
  const right = st.right - r.right, left = r.left - st.left, want = 260;
  const textTop = r.top + box.y0 * view.scale, textBottom = r.top + box.y1 * view.scale;
  let w, x, y;
  if (Math.max(right, left) >= want + 2 * gap) {
    const onRight = right >= left;
    w = Math.min(400, (onRight ? right : left) - 2 * gap);
    x = onRight ? r.right + gap : r.left - gap - w;
    panel.style.width = w + 'px';
    y = clamp(textTop - 50, st.top + 8, innerHeight - panel.offsetHeight - 8);
  } else {
    w = Math.min(400, innerWidth - 24); x = (innerWidth - w) / 2;
    panel.style.width = w + 'px';
    y = (textTop + textBottom) / 2 < innerHeight / 2 ? innerHeight - panel.offsetHeight - 12 : 12;
  }
  panel.style.left = Math.round(x) + 'px'; panel.style.top = Math.round(y) + 'px';
}

function preview() {
  if (!edit) return;
  const { pg, draft } = edit, s = sheetFor(pg);
  edit.draft = { ...draft, s: input.value };
  if (!s) return;
  clearLive(s);
  const ctx = s.ctxLive, b = textBox(pg, edit.draft);
  ctx.save();
  ctx.setLineDash([1.2, 1]); ctx.strokeStyle = '#2b59cf'; ctx.lineWidth = Math.max(0.25, 1.2 / view.scale);
  ctx.strokeRect(b.x0 - 1, b.y0 - 1, Math.max(edit.draft.w, b.x1 - b.x0) + 2, b.y1 - b.y0 + 2);
  ctx.restore();
  if (edit.draft.s) drawStroke(ctx, edit.draft, pg);
  placePanel(s, b);
  const { cut } = layout(pg, edit.draft);
  note.textContent = cut ? `${cut} line${cut > 1 ? 's don’t' : ' doesn’t'} fit on this page. Shorten the text or start it higher up.`
    : 'Tap the page to move where it starts.';
}
function renderStyles() {
  $('#textStyles').innerHTML = Object.entries(FONTS).map(([k, f]) =>
    `<button data-tstyle="${k}" class="${edit && edit.draft.f === k ? 'on' : ''}" title="${f.note}" style="font-family:${f.family.replace(/"/g, '&quot;')}">${f.label}</button>`).join('');
}

/* Opens the panel for a new block at page point `at`, or to change `item`. */
export function openText(pg, { at, item, text = '' } = {}) {
  if (edit) closeText(false);
  const back = state.tool === 'text' ? state.prevTool : state.tool;
  const draft = item ? { ...item } : { t: 'text', s: text, f: state.textStyle || 'print', c: PEN_COLOURS[state.penColour], ...anchor(pg, at || defaultSpot(pg)) };
  edit = { pg, item: item || null, draft, back };
  if (state.tool !== 'text') { state.prevTool = back === 'insert' ? 'pen' : back; state.tool = 'text'; state.insert = null; renderTools(); }
  if (item) renderInkFor(pg, new Set([item]));             // lift the old block off while it's being changed
  input.value = draft.s;
  panel.hidden = false;
  renderStyles();
  preview();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/* A tap on the page with the Text tool: moves the block being written, opens one that's there, or starts one. */
export function textTap(pg, pt) {
  if (edit && edit.pg === pg) { Object.assign(edit.draft, anchor(pg, pt)); preview(); input.focus(); return; }
  const hit = [...pg.strokes].reverse().find(s => {
    if (s.t !== 'text') return false;
    const b = textBox(pg, s); return pt[0] >= b.x0 - 1 && pt[0] <= b.x1 + 1 && pt[1] >= b.y0 - 1 && pt[1] <= b.y1 + 1;
  });
  if (edit) closeText(true);
  openText(pg, hit ? { item: hit } : { at: pt });
}

/* Done (keep = true) or Cancel. An empty block is removed. */
export function closeText(keep) {
  if (!edit) return;
  const { pg, item, back } = edit, draft = { ...edit.draft, s: input.value.replace(/\s+$/, '') };
  edit = null;
  panel.hidden = true; input.blur();
  const s = sheetFor(pg); if (s) clearLive(s);
  let placed = null;
  if (keep && state.pages.includes(pg) && (draft.s || item)) {
    const before = pg.strokes;
    if (!draft.s) pg.strokes = before.filter(x => x !== item);
    else { placed = draft; pg.strokes = item ? before.map(x => x === item ? draft : x) : before.concat([draft]); }
    pushUndo(pg, before);
    scheduleSave();
  }
  renderInkFor(pg);
  if (state.tool === 'text') { state.tool = back === 'select' ? 'select' : (state.prevTool || 'pen'); renderTools(); }
  if (placed && state.tool === 'select' && sheetFor(pg)) selectItems(pg, [placed]);
}

export function setTextStyle(f) {
  if (!edit || !FONTS[f]) return;
  edit.draft.f = f; state.textStyle = f; scheduleSave();
  renderStyles(); preview(); input.focus();
}
export function setTextColour(c) { if (edit) { edit.draft.c = c; preview(); } }

export function initText() {
  input.addEventListener('input', preview);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeText(false); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeText(true); }
  });
}
