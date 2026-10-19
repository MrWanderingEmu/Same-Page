/* Constants: page size, colours, sizes, templates.
   All ink and template geometry is in millimetres on a 210 x 297 page,
   so it scales to any screen and exports at true A4 size. */
export const PAGE_W = 210, PAGE_H = 297;          // A4, millimetres
/* A page's [width, height] in mm: portrait, or turned on its side (pg.land). */
export const pageSize = pg => pg && pg.land ? [PAGE_H, PAGE_W] : [PAGE_W, PAGE_H];
export const TOP_GAP = 20;                         // mm of space above the first line (heading area)
export const PEN_COLOURS = ['#1f1d1a', '#1f4fd1', '#d12f2f', '#1d8a43', '#7a3fc4', '#e2700f'];
export const HL_COLOURS  = ['#ffe14d', '#ff9fd0', '#8fefa6', '#8fd2ff', '#ffbb66', '#cfb0ff'];
export const PEN_SIZES    = [0.5, 0.9, 1.6];       // stroke width, mm
export const HL_SIZES     = [4, 7, 11];            // highlighter width, mm
export const ERASER_SIZES = [2.5, 5, 10];          // eraser radius, mm
export const HL_ALPHA = 0.45;
export const TEMPLATES = {
  ruled:  { label: 'Ruled',  spacing: { min: 5, max: 14, step: 0.5, def: 8,  label: 'Line spacing' }, margin: 25 },
  thirds: { label: 'Thirds', spacing: { min: 4, max: 12, step: 0.5, def: 7,  label: 'Gap between lines' }, margin: 25 },
  thirds2:{ label: 'Two dotted', spacing: { min: 4, max: 15, step: 0.5, def: 7, label: 'Gap between lines' }, margin: 25 },
  sky:    { label: 'Sky, grass, dirt', spacing: { min: 5, max: 20, step: 0.5, def: 10, label: 'Height of each band' }, margin: 0 },
  grid:   { label: 'Grid',   spacing: { min: 4, max: 20, step: 0.5, def: 10, label: 'Square size' }, margin: 0 },
  blank:  { label: 'Blank',  spacing: null, margin: 0 },
};
export const LINE_COL = { ruled: '#9ec3e6', thirds: '#9ec3e6', base: '#6f9fd2', grid: '#b6d0ea', margin: '#e48b8b',
  sky: '#c9e4f7', grass: '#d8ecc6', dirt: '#e8cfb2', band: '#8a96a3' };
export const MAX_UNDO = 200;
export const COVER_COLOURS = ['#35507a', '#a33d3d', '#3c7a4e', '#c8901e', '#6a4c98', '#c0577f', '#2c7b84', '#59626d'];
