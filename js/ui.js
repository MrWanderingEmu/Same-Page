/* Toolbars, popovers, present mode, and the click / keyboard handlers. */
import { PAGE_W, PEN_COLOURS, HL_COLOURS, TEMPLATES } from './config.js';
import { state, page, makePage, visiblePages } from './state.js';
import { $, $$ } from './util.js';
import { stage, layout, renderBgFor, hideEraser } from './board.js';
import { drawTemplate } from './draw.js';
import { scheduleSave, saveNow } from './storage.js';
import { saveNotebookFile } from './library.js';
import { openShelf, shelfOpen, shelfEscape } from './shelf.js';
import { undo, redo, clearVisible, canUndo, canRedo } from './history.js';
import { stepPage, stepTarget, addPage, addPageAtEnd, deletePage, setTemplate, applyPaperToAll, toggleSpread, setBookStart } from './pages.js';
import { exportPng, printAll } from './export.js';

/* --- tools --- */
export function buildSwatches() {
  $$('[data-swatches]').forEach(box => {
    box.innerHTML = PEN_COLOURS.map((_, i) => `<button class="swatch" data-colour="${i}" aria-label="Colour ${i + 1}"></button>`).join('');
  });
}
export function renderTools() {
  $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === state.tool));
  const hl = state.tool === 'hl', er = state.tool === 'eraser';
  const cols = hl ? HL_COLOURS : PEN_COLOURS, ci = hl ? state.hlColour : state.penColour;
  $$('[data-swatches]').forEach(box => {
    box.classList.toggle('dim', er);
    box.querySelectorAll('.swatch').forEach((sw, i) => { sw.style.background = cols[i]; sw.classList.toggle('on', !er && i === ci); });
  });
  const dots = er ? [9, 14, 21] : hl ? [8, 12, 17] : [5, 9, 14];
  $('#sizes').innerHTML = dots.map((d, i) =>
    `<button class="size${er ? ' ring' : ''}${state.size[state.tool] === i ? ' on' : ''}" data-size="${i}" aria-label="Size ${i + 1}"><i style="width:${d}px;height:${d}px"></i></button>`).join('');
  stage.classList.toggle('erasing', er);
  if (!er) hideEraser();
}
function setTool(t) { state.tool = t; renderTools(); scheduleSave(); }

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
const PREVIEW = { ruled: 14, thirds: 9, grid: 15 };
/* A thumbnail of a paper type (exaggerated spacing so the pattern reads at this size). */
export function drawPreview(c, tpl) {
  const dpr = window.devicePixelRatio || 1, k = 56 / PAGE_W * dpr;
  c.width = Math.round(56 * dpr); c.height = Math.round(79 * dpr);
  const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0);
  const fake = makePage(); fake.tpl = tpl;
  fake.spacing = { ...PREVIEW }; fake.margin = { ruled: 34, thirds: 34, grid: 0 };
  drawTemplate(ctx, fake, k);
}
export function renderPaperPop() {
  const pop = $('#paperPop'), pg = page(), t = pg.tpl, T = TEMPLATES[t];
  pop.innerHTML = `
    <h3>Paper — page ${state.cur + 1}</h3>
    <div class="tpls">${Object.keys(TEMPLATES).map(k =>
      `<button class="tpl${k === t ? ' on' : ''}" data-tpl="${k}"><canvas data-preview="${k}"></canvas>${TEMPLATES[k].label}</button>`).join('')}</div>
    ${T.spacing ? `
      <label class="field"><span class="row"><span>${T.spacing.label}</span><b id="spVal">${pg.spacing[t]} mm</b></span>
        <input type="range" id="spIn" min="${T.spacing.min}" max="${T.spacing.max}" step="${T.spacing.step}" value="${pg.spacing[t]}"></label>
      <label class="field"><span class="row"><span>Margin</span><b id="mgVal">${pg.margin[t] ? pg.margin[t] + ' mm' : 'None'}</b></span>
        <input type="range" id="mgIn" min="0" max="40" step="1" value="${pg.margin[t]}"></label>
      ${t === 'thirds' ? '<p class="note">Each row: solid top line, dotted middle line, solid base line, then a space for tails.</p>' : ''}`
      : '<p class="note">A plain page with no lines.</p>'}
    <button class="wide" data-act="applyAll">Use this paper on all pages</button>`;
  pop.querySelectorAll('[data-preview]').forEach(c => drawPreview(c, c.dataset.preview));
  const sp = pop.querySelector('#spIn'), mg = pop.querySelector('#mgIn');
  if (sp) sp.oninput = () => { pg.spacing[t] = +sp.value; pop.querySelector('#spVal').textContent = sp.value + ' mm'; renderBgFor(pg); scheduleSave(); };
  if (mg) mg.oninput = () => { pg.margin[t] = +mg.value; pop.querySelector('#mgVal').textContent = +mg.value ? mg.value + ' mm' : 'None'; renderBgFor(pg); scheduleSave(); };
}

/* --- menu popover --- */
export function updateMenu() {
  $$('#bookStartSeg button').forEach(b => b.classList.toggle('on', b.dataset.bookstart === state.bookStart));
  $$('#fingerSeg button').forEach(b => b.classList.toggle('on', b.dataset.finger === state.finger));
  $$('#pressureSeg button').forEach(b => b.classList.toggle('on', (b.dataset.pressure === 'on') === state.pressure));
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

/* --- one click handler for every button --- */
function onClick(e) {
  const b = e.target.closest('button'); if (!b || b.closest('#shelf, #nbMenu, .modal')) return;
  if (b.id === 'shelfBtn') return openShelf();
  if (b.dataset.tool) return setTool(b.dataset.tool);
  if (b.dataset.colour != null) {
    const i = +b.dataset.colour;
    if (state.tool === 'hl') state.hlColour = i;
    else { state.penColour = i; state.tool = 'pen'; }
    renderTools(); scheduleSave(); return;
  }
  if (b.dataset.size != null) { state.size[state.tool] = +b.dataset.size; renderTools(); scheduleSave(); return; }
  if (b.dataset.tpl) return setTemplate(b.dataset.tpl);
  if (b.dataset.bookstart) { setBookStart(b.dataset.bookstart); updateMenu(); return; }
  if (b.dataset.finger) { state.finger = b.dataset.finger; updateMenu(); scheduleSave(); return; }
  if (b.dataset.pressure) { state.pressure = b.dataset.pressure === 'on'; updateMenu(); scheduleSave(); return; }
  if (b.id === 'paperBtn') { if (openPop !== $('#paperPop')) renderPaperPop(); showPop($('#paperPop'), b); return; }
  if (b.id === 'menuBtn') { updateMenu(); showPop($('#menuPop'), b); return; }
  switch (b.dataset.act) {
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
  if (ctrl || e.altKey) return;
  if (k === 'p') setTool('pen');
  else if (k === 'h') setTool('hl');
  else if (k === 'e') setTool('eraser');
  else if (k === 'f') togglePresent();
  else if (k === 'b') toggleSpread();
  else if (k === 'arrowdown' || k === 'pagedown' || (k === 'arrowright' && !e.shiftKey)) { e.preventDefault(); stepPage(1); }
  else if (k === 'arrowup' || k === 'pageup' || k === 'arrowleft') { e.preventDefault(); stepPage(-1); }
  else if (k === 'escape') { if (openPop) closePops(); else if (state.presenting) togglePresent(); }
}

export function initUI() {
  buildSwatches();
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
