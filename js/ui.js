/* Toolbars, popovers, present mode, and the click / keyboard handlers. */
import { pageSize, PEN_COLOURS, HL_COLOURS, TEMPLATES } from './config.js';
import { state, page, makePage, visiblePages } from './state.js';
import { $, $$, toast } from './util.js';
import { stage, layout, renderBgFor, hideEraser } from './board.js';
import { drawTemplate } from './draw.js';
import { scheduleSave, saveNow } from './storage.js';
import { saveNotebookFile } from './library.js';
import { openShelf, shelfOpen, shelfEscape } from './shelf.js';
import { undo, redo, clearVisible, canUndo, canRedo } from './history.js';
import { stepPage, stepTarget, addPage, addPageAtEnd, deletePage, setTemplate, setLandscape, applyPaperToAll, toggleSpread, setBookStart } from './pages.js';
import { exportPng, printAll } from './export.js';
import { INSERTS, placeItem } from './shapes.js';
import { hasSelection, clearSelection, deleteSelection, duplicateSelection, recolourSelection } from './select.js';
import { hideDot } from './laser.js';
import { toggleRuler } from './ruler.js';
import { toggleCover, renderCovers } from './cover.js';
import { pastePicture, choosePictureFile } from './images.js';

/* --- tools --- */
export function buildSwatches() {
  $$('[data-swatches]').forEach(box => {
    box.innerHTML = PEN_COLOURS.map((_, i) => `<button class="swatch" data-colour="${i}" aria-label="Colour ${i + 1}"></button>`).join('');
  });
}
const sizeKey = () => ['pen', 'hl', 'eraser'].includes(state.tool) ? state.tool : 'pen';   // other tools use the pen's size
export function renderTools() {
  $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === state.tool));
  $$('[data-act="insert"]').forEach(b => b.classList.toggle('on', state.tool === 'insert'));
  const hl = state.tool === 'hl', er = state.tool === 'eraser', laser = state.tool === 'laser';
  if (state.tool !== 'select') clearSelection();
  if (!laser) hideDot();
  const cols = hl ? HL_COLOURS : PEN_COLOURS, ci = hl ? state.hlColour : state.penColour;
  $$('[data-swatches]').forEach(box => {
    box.classList.toggle('dim', er || laser);
    box.querySelectorAll('.swatch').forEach((sw, i) => { sw.style.background = cols[i]; sw.classList.toggle('on', !er && !laser && i === ci); });
  });
  const dots = er ? [9, 14, 21] : hl ? [8, 12, 17] : [5, 9, 14];
  $('#sizes').innerHTML = dots.map((d, i) =>
    `<button class="size${er ? ' ring' : ''}${state.size[sizeKey()] === i ? ' on' : ''}" data-size="${i}" aria-label="Size ${i + 1}"><i style="width:${d}px;height:${d}px"></i></button>`).join('');
  stage.classList.toggle('erasing', er);
  stage.classList.toggle('lasering', laser);
  $('#sizes').classList.toggle('dim', laser || state.tool === 'select');
  if (!er) hideEraser();
}
function setTool(t) { state.tool = t; state.insert = null; renderTools(); scheduleSave(); }

/* --- insert tool --- */
const ICON_BOX = { Shapes: [[9, 5], [39, 35]], Organisers: [[3, 3], [45, 37]] };
function insertIcon(item) {
  const [a, b] = item.id === 'line' || item.id === 'arrow' ? [[7, 33], [41, 7]] : ICON_BOX[item.group];
  return `<svg viewBox="0 0 48 40">${placeItem(item, a, b).map(pl =>
    `<polyline points="${pl.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>`).join('')}</svg>`;
}
const PICTURE_ICONS = {
  pastePic: '<rect x="13" y="7" width="22" height="28" rx="2.5"/><path d="M19 7V5h10v2"/><rect x="18" y="16" width="12" height="10" rx="1"/><path d="M18 24l3.5-3.5 3 3 2-2 3.5 3.5"/>',
  filePic: '<rect x="8" y="7" width="32" height="26" rx="2.5"/><circle cx="17" cy="15" r="2.6"/><path d="M8 29l10-9 7 6 5-4 10 8"/>',
};
function renderInsertPop() {
  const groups = [...new Set(INSERTS.map(i => i.group))];
  const pics = [['pastePic', 'Paste picture'], ['filePic', 'From a file']].map(([act, label]) =>
    `<button class="ins" data-act="${act}"><svg viewBox="0 0 48 40">${PICTURE_ICONS[act]}</svg>${label}</button>`).join('');
  $('#insertPop').innerHTML = `<div class="group">Pictures</div><div class="inserts">${pics}</div>` + groups.map(g => `<div class="group">${g}</div><div class="inserts">${INSERTS.filter(i => i.group === g).map(i =>
    `<button class="ins${state.tool === 'insert' && state.insert === i.id ? ' on' : ''}" data-insert="${i.id}">${insertIcon(i)}${i.label}</button>`).join('')}</div>`).join('') +
    '<p class="note" style="margin:0">Pick one, then drag a box on the page. For an organiser, tap the page instead to fill it (a Venn fills the half you tap).</p>';
}
function chooseInsert(id) {
  const item = INSERTS.find(i => i.id === id);
  if (state.tool !== 'insert') state.prevTool = state.tool === 'eraser' ? 'pen' : state.tool;
  state.tool = 'insert'; state.insert = id;
  closePops(); renderTools();
  const name = item.say || item.label.toLowerCase();
  toast(item.fit === 'page' ? `Drag a box for the ${name}, or tap the page to fill it.`
    : item.fit === 'half' ? `Drag a box for the ${name}, or tap the top or bottom half of the page.`
    : item.fit === 'band' ? `Drag to place the ${name}, or tap for the full width.` : `Drag on the page to draw a ${name}.`);
}
/* Back to the pen (or highlighter) after placing something, or on Esc. */
export function finishInsert() {
  state.tool = state.prevTool || 'pen'; state.insert = null;
  renderTools(); scheduleSave();
}

/* --- status --- */
export function updateUndo() {
  $$('[data-act="undo"]').forEach(b => b.disabled = !canUndo());
  $$('[data-act="redo"]').forEach(b => b.disabled = !canRedo());
}
export function updatePageUI() {
  const n = state.pages.length, vis = visiblePages();
  const html = state.spread
    ? `${vis.map(i => i + 1).join('–')}<small>of ${n}</small>`
    : `${state.cur + 1} / ${n}`;
  $$('[data-pagelabel]').forEach(l => l.innerHTML = html);
  $$('[data-act="prev"]').forEach(b => b.disabled = stepTarget(-1) < 0);
  $$('[data-act="next"]').forEach(b => b.disabled = stepTarget(1) < 0);
  $$('[data-act="delete"]').forEach(b => {
    b.disabled = n < 2;
    b.title = `Delete page ${state.cur + 1}`;
  });
  $$('[data-act="clear"]').forEach(b => b.title = vis.length > 1 ? 'Clear both pages on screen (can be undone)' : 'Clear this page (can be undone)');
  renderCovers();
}
/* Refreshes everything after a notebook is opened (full) or renamed / recoloured. */
export function showNotebook(full = true) {
  const nb = state.nb;
  $('#railNbTitle').textContent = nb ? nb.title : 'Notebooks';
  $('#shelfBtn').title = nb ? `Notebook: ${nb.title} — tap to see all your notebooks` : 'Your notebooks';
  document.documentElement.style.setProperty('--cover', nb ? nb.colour : '');
  if (!full) return;
  closePops();
  stage.scrollTop = 0;
  layout(); updatePageUI(); updateUndo(); updateViewBtns();
}
export function updateViewBtns() {
  $('#viewBtn span').textContent = state.view === 'page' ? 'Fit width' : 'Fit page';
  $$('[data-act="spread"]').forEach(b => b.classList.toggle('on', state.spread));
}

/* --- popovers --- */
let openPop = null, openBtn = null;
function showPop(pop, btn) {
  if (openPop === pop) { closePops(); return; }
  closePops();
  pop.classList.add('open'); btn.classList.add('on');
  const r = btn.getBoundingClientRect();
  pop.style.top = Math.max(10, Math.min(r.top - 8, innerHeight - pop.offsetHeight - 10)) + 'px';
  openPop = pop; openBtn = btn;
}
export function closePops() {
  if (openPop) { openPop.classList.remove('open'); openBtn.classList.remove('on'); }
  openPop = openBtn = null;
}
export const paperPopOpen = () => $('#paperPop').classList.contains('open');

/* --- paper popover --- */
const PREVIEW = { ruled: 14, thirds: 9, thirds2: 9, sky: 9, grid: 15 };
const NOTES = {
  thirds: 'Each row: solid top line, dotted middle line, solid base line, then a space for tails.',
  thirds2: 'Each row: solid line, two dotted lines, solid line. Letters sit on the lower dotted line and tails drop to the solid line.',
  sky: 'Tall letters reach up into the sky, small letters sit on the grass, and tails dig down into the dirt.',
  blank: 'A plain page with no lines.',
};
/* A thumbnail of a paper type (exaggerated spacing so the pattern reads at this size). */
export function drawPreview(c, tpl, land = false) {
  const fake = makePage(); fake.tpl = tpl; fake.land = land;
  const [W, H] = pageSize(fake), cw = land ? 62 : 56, ch = Math.round(cw * H / W);
  const dpr = window.devicePixelRatio || 1, k = cw / W * dpr;
  c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
  c.style.width = cw + 'px'; c.style.height = ch + 'px';
  const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0);
  fake.spacing = { ...PREVIEW };
  fake.margin = Object.fromEntries(Object.keys(PREVIEW).map(t => [t, TEMPLATES[t].margin ? 34 : 0]));
  drawTemplate(ctx, fake, k);
}
export function renderPaperPop() {
  const pop = $('#paperPop'), pg = page(), t = pg.tpl, T = TEMPLATES[t];
  pop.innerHTML = `
    <h3>Paper — page ${state.cur + 1}</h3>
    <div class="seg orient"><button data-orient="port"${pg.land ? '' : ' class="on"'}>Portrait</button><button data-orient="land"${pg.land ? ' class="on"' : ''}>Landscape</button></div>
    <div class="tpls">${Object.keys(TEMPLATES).map(k =>
      `<button class="tpl${k === t ? ' on' : ''}" data-tpl="${k}"><canvas data-preview="${k}"></canvas>${TEMPLATES[k].label}</button>`).join('')}</div>
    ${T.spacing ? `
      <label class="field"><span class="row"><span>${T.spacing.label}</span><b id="spVal">${pg.spacing[t]} mm</b></span>
        <input type="range" id="spIn" min="${T.spacing.min}" max="${T.spacing.max}" step="${T.spacing.step}" value="${pg.spacing[t]}"></label>
      <label class="field"><span class="row"><span>Margin</span><b id="mgVal">${pg.margin[t] ? pg.margin[t] + ' mm' : 'None'}</b></span>
        <input type="range" id="mgIn" min="0" max="40" step="1" value="${pg.margin[t]}"></label>
      ${NOTES[t] ? `<p class="note">${NOTES[t]}</p>` : ''}`
      : `<p class="note">${NOTES.blank}</p>`}
    <button class="wide" data-act="applyAll">Use this paper on all pages</button>`;
  pop.querySelectorAll('[data-preview]').forEach(c => drawPreview(c, c.dataset.preview, pg.land));
  const sp = pop.querySelector('#spIn'), mg = pop.querySelector('#mgIn');
  if (sp) sp.oninput = () => { pg.spacing[t] = +sp.value; pop.querySelector('#spVal').textContent = sp.value + ' mm'; renderBgFor(pg); scheduleSave(); };
  if (mg) mg.oninput = () => { pg.margin[t] = +mg.value; pop.querySelector('#mgVal').textContent = +mg.value ? mg.value + ' mm' : 'None'; renderBgFor(pg); scheduleSave(); };
}

/* --- menu popover --- */
export function updateMenu() {
  $$('#bookStartSeg button').forEach(b => b.classList.toggle('on', b.dataset.bookstart === state.bookStart));
  $$('#fingerSeg button').forEach(b => b.classList.toggle('on', b.dataset.finger === state.finger));
  $$('#pressureSeg button').forEach(b => b.classList.toggle('on', (b.dataset.pressure === 'on') === state.pressure));
  $$('#snapSeg button').forEach(b => b.classList.toggle('on', (b.dataset.snap === 'on') === state.snap));
  $('#fingerNote').textContent = {
    auto: state.penSeen ? 'Pen detected: fingers scroll and swipe between pages.' : 'Fingers draw until you use the pen, then they scroll.',
    scroll: 'Fingers scroll the page and swipe between pages.',
    draw: 'Fingers draw. (Palms are still ignored while the pen is near.)',
  }[state.finger];
  $('#pngLabel').textContent = visiblePages().length > 1 ? 'Save these two pages as an image' : 'Save this page as an image';
}

/* --- present mode --- */
let presentFs = false;
async function togglePresent() {
  closePops();
  state.presenting = !state.presenting;
  document.body.classList.toggle('presenting', state.presenting);
  if (state.presenting) {
    try { if (document.documentElement.requestFullscreen) { await document.documentElement.requestFullscreen(); presentFs = true; } } catch (e) { presentFs = false; }
  } else if (document.fullscreenElement) {
    presentFs = false;
    try { await document.exitFullscreen(); } catch (e) {}
  }
  layout();
}

/* --- palm guard for the toolbars ---
   The page already ignores palms while the pen is near; the buttons didn't, so the side of a
   (left) hand resting on the rail could switch tools. A touch press on a button is now dropped
   while the pen is hovering or was used in the last second. Pen, mouse and keyboard presses,
   and finger taps with the pen away, work as before. */
const TOOLBAR_PALM_MS = 1000;
let lastPenAt = -1e9;     // time of the last pen event anywhere (hover counts)
let palmPress = null;     // the button a palm just pressed, so its click is ignored
function onPointerAnywhere(e) {
  const now = performance.now();
  if (e.pointerType === 'pen') lastPenAt = now;
  if (e.type === 'pointerdown')
    palmPress = e.pointerType === 'touch' && now - lastPenAt < TOOLBAR_PALM_MS ? e.target.closest('button') : null;
}

/* --- one click handler for every button --- */
function onClick(e) {
  const b = e.target.closest('button'); if (!b || b.closest('#shelf, #nbMenu, .modal')) return;
  if (palmPress) { const p = palmPress; palmPress = null; if (p === b) return; }
  if (b.id === 'shelfBtn') return openShelf();
  if (b.dataset.tool) return setTool(b.dataset.tool);
  if (b.dataset.colour != null) {
    const i = +b.dataset.colour;
    if (state.tool === 'select' && hasSelection()) { recolourSelection(i); return; }
    if (state.tool === 'hl') state.hlColour = i;
    else { state.penColour = i; if (state.tool !== 'insert') state.tool = 'pen'; }
    renderTools(); scheduleSave(); return;
  }
  if (b.dataset.size != null) { state.size[sizeKey()] = +b.dataset.size; renderTools(); scheduleSave(); return; }
  if (b.dataset.insert) return chooseInsert(b.dataset.insert);
  if (b.dataset.act === 'insert') { renderInsertPop(); showPop($('#insertPop'), b); return; }
  if (b.dataset.snap) { state.snap = b.dataset.snap === 'on'; updateMenu(); scheduleSave(); return; }
  if (b.dataset.tpl) return setTemplate(b.dataset.tpl);
  if (b.dataset.orient) return setLandscape(b.dataset.orient === 'land');
  if (b.dataset.bookstart) { setBookStart(b.dataset.bookstart); updateMenu(); return; }
  if (b.dataset.finger) { state.finger = b.dataset.finger; updateMenu(); scheduleSave(); return; }
  if (b.dataset.pressure) { state.pressure = b.dataset.pressure === 'on'; updateMenu(); scheduleSave(); return; }
  if (b.id === 'paperBtn') { if (openPop !== $('#paperPop')) renderPaperPop(); showPop($('#paperPop'), b); return; }
  if (b.id === 'menuBtn') { updateMenu(); showPop($('#menuPop'), b); return; }
  switch (b.dataset.act) {
    case 'selDup': return duplicateSelection();
    case 'selDel': return deleteSelection();
    case 'undo': return undo();
    case 'redo': return redo();
    case 'clear': return clearVisible();
    case 'prev': return stepPage(-1);
    case 'next': return stepPage(1);
    case 'add': return addPage();
    case 'addEnd': return addPageAtEnd();
    case 'delete': return deletePage();
    case 'applyAll': return applyPaperToAll();
    case 'spread': return toggleSpread();
    case 'ruler': return toggleRuler();
    case 'pastePic': return pastePicture();
    case 'filePic': return choosePictureFile();
    case 'cover': return toggleCover();
    case 'view': state.view = state.view === 'page' ? 'width' : 'page'; updateViewBtns(); stage.scrollTop = 0; layout(); scheduleSave(); return;
    case 'present': return togglePresent();
    case 'saveFile': closePops(); return saveNotebookFile();
    case 'png': closePops(); return exportPng();
    case 'print': return printAll();
  }
}

/* --- keyboard --- */
function onKey(e) {
  if (shelfOpen()) { if (e.key === 'Escape') shelfEscape(); return; }
  if (e.target.tagName === 'INPUT') return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && k === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && k === 's') { e.preventDefault(); saveNotebookFile(); return; }
  if (ctrl && k === 'd' && hasSelection()) { e.preventDefault(); duplicateSelection(); return; }
  if (ctrl || e.altKey) return;
  if (k === 'p') setTool('pen');
  else if (k === 'h') setTool('hl');
  else if (k === 'e') setTool('eraser');
  else if (k === 'f') togglePresent();
  else if (k === 'b') toggleSpread();
  else if (k === 's') setTool('select');
  else if (k === 'l') setTool('laser');
  else if (k === 'r') toggleRuler();
  else if ((k === 'delete' || k === 'backspace') && hasSelection()) { e.preventDefault(); deleteSelection(); }
  else if (k === 'i') { const b = state.presenting ? $('#mini [data-act="insert"]') : $('.rail [data-act="insert"]'); renderInsertPop(); showPop($('#insertPop'), b); }
  else if (k === 'arrowdown' || k === 'pagedown' || (k === 'arrowright' && !e.shiftKey)) { e.preventDefault(); stepPage(1); }
  else if (k === 'arrowup' || k === 'pageup' || k === 'arrowleft') { e.preventDefault(); stepPage(-1); }
  else if (k === 'escape') { if (openPop) closePops(); else if (hasSelection()) clearSelection(); else if (state.tool === 'insert') finishInsert(); else if (state.presenting) togglePresent(); }
}

export function initUI() {
  buildSwatches();
  ['pointerdown', 'pointermove', 'pointerup'].forEach(t => document.addEventListener(t, onPointerAnywhere, true));
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', e => {
    if (openPop && !openPop.contains(e.target) && !openBtn.contains(e.target)) closePops();
  }, true);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && presentFs && state.presenting) { presentFs = false; togglePresent(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  document.addEventListener('selectstart', e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
}
