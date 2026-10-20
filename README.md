# Same Page

A modelling whiteboard for teachers whose pages match the students' exercise books: A4 pages, portrait or landscape, with ruled, dotted-thirds, sky-grass-dirt, grid or blank paper, at true millimetre spacing. Write with a stylus and what students see on the screen is exactly what's possible in their own books.

- **A shelf of notebooks:** the *Notebooks* button (top of the right toolbar) shows every notebook as an exercise-book cover: one for spelling, one for novel study, one for maths examples, and so on. Each has its own name, cover colour and starting paper, and remembers its own last page and view.
- **One page or two:** *Two pages* (or press **B**) shows the book lying open: two A4 pages side by side with the spine down the middle. By default page 1 sits on the right, opposite the inside cover, like a real exercise book; *More › Two-page view starts with* changes that to pages 1 and 2 together.
- **Pen, highlighter, eraser** with pressure, palm rejection (on the page and on the toolbars: a hand brushing a button while the pen is near doesn't press it), and the pen's eraser end or side button.
- **Shape snapping:** draw a line, circle, oval, rectangle or triangle and hold the pen still at the end; it tidies into a clean shape (lines snap level when they're close). Works with the highlighter too, and can be turned off under *More*.
- **Insert** shapes (line, arrow, rectangle, circle, triangles) and graphic organisers (T-chart, Venn, three-circle Venn, Y-chart, three columns, Frayer model, 2 × 2 grid, story mountain, mind map, number line, sequence). Drag a box to place one, or tap to fill the page (a Venn fills the top or bottom half, whichever you tap). They're drawn in pen ink, so Undo and the eraser work on them.
- **Ruler** (**R**): a see-through 30 cm ruler at true size. Start a pen or highlighter stroke along either long edge and it comes out dead straight, for modelling ruling up a margin or underlining. Drag the ruler to move it; drag the round knob to turn it (it clicks to level, upright and 45°), or tap the knob to swap between level and upright.
- **Select:** draw a loop round anything (or tap one line) to select it, then drag to move it, drag the corner handle to resize, tap a colour to recolour, or use *Duplicate* / *Delete*.
- **Reveal cover:** *Cover* (right toolbar) lays a card over the page below the heading. Drag its tab to where the reveal should start; in class, tap the tab to uncover one line (or one row of thirds) at a time, or drag it to uncover several or hide them again. It always settles on a line. The cover is saved with the page, so a worked example can be prepared ahead. The pen and eraser do nothing on the covered part, and saved images and prints leave the cover off.
- **Laser pointer:** a glowing red dot follows the pen, and anything you draw with it fades away a moment later. Nothing is saved.
- **Double-tap a page** (pen or finger) to focus on it from two-page view; double-tap again to see both pages.
- **Paper per page:** portrait or landscape, line spacing, margin, and paper type: ruled, dotted thirds (solid, dotted, solid, then a space for tails), two-dotted thirds (solid, dotted, dotted, solid), sky-grass-dirt (coloured bands for early writers), grid or blank. *Use this paper on all pages* copies it to every page. Landscape pages print sideways on A4.
- **Present mode** (**F**): full screen with a small floating toolbar.
- **Saves automatically** in the browser, one page at a time, so big notebooks stay quick. *Back up all* on the shelf saves every notebook into one file (a reminder appears on the shelf if it's been 3 weeks), and *Open a file* restores a backup or adds a single notebook file. *Print or save as PDF* prints every page at true A4.
- **Works offline** once it has been opened, and can be installed as an app from the browser's address bar.

## Keyboard

| Key | Action |
| --- | --- |
| P / H / E | Pen / highlighter / eraser |
| S / L / I | Select / laser pointer / insert a shape or organiser |
| R | Show or hide the ruler |
| Delete, Ctrl+D | Delete or duplicate the selection |
| B | One page ↔ two pages |
| F | Present (Esc to stop) |
| ↑ ↓ ← → / PgUp PgDn | Previous / next page (or pair of pages) |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S | Save this notebook to a file |
| Esc | Close a menu, deselect, cancel Insert, leave present mode, or close the shelf |

## Running it on your computer

The app uses JavaScript modules, so it needs to be served over http (double-clicking `index.html` won't work). From this folder:

```bash
python -m http.server 5173
```

then open <http://localhost:5173>. Any static server works (for example `npx serve`).

## Hosting

There's no build step: the folder is the website. Push it to GitHub, then either:

- **GitHub Pages:** in the repository, go to *Settings › Pages*, set *Source* to *Deploy from a branch*, choose `main` and `/ (root)`, and save. The site appears at `https://<username>.github.io/<repo>/`.
- **Vercel:** *Add New › Project*, import the repository, set *Framework Preset* to **Other**, leave the build command empty and the output directory as the root, then *Deploy*. Every push to `main` redeploys automatically, and other branches get preview links.

Notebooks auto-save per website address, so a notebook on one address (or on `localhost`) won't appear on another. Use *Save notebook to file* and *Open notebook file* to move it.

## Code layout

```
index.html            page structure
css/styles.css        all styles
js/main.js            start-up: load the saved notebook, wire everything up
js/config.js          page size, colours, pen sizes, paper templates
js/state.js           app state, page model, which pages are on screen
js/storage.js         auto-save (IndexedDB): only the pages that changed; moving older saved work over
js/draw.js            drawing paper templates and ink (pure canvas code)
js/board.js           sizing the page(s) to the screen, one- and two-page view
js/input.js           pen / mouse / touch, palm rejection, eraser, hold-to-snap, inserting, double-tap
js/shapes.js          recognising drawn shapes; geometry for every shape and organiser
js/select.js          lasso selection: move, resize, recolour, duplicate, delete
js/laser.js           laser pointer trails and dot
js/ruler.js           the ruler: moving and turning it, ruling strokes along its edge
js/cover.js           the reveal cover: where it can stop on each paper, its tab
js/history.js         undo / redo across the whole notebook
js/pages.js           navigating, adding, deleting pages; paper settings
js/export.js          image export and print / PDF
js/library.js         notebooks: open, create, copy, delete; notebook files; back up and restore
js/shelf.js           the Notebooks shelf screen
js/ui.js              toolbars, popovers, present mode, keyboard
sw.js                 offline support (add any new file to its FILES list)
manifest.webmanifest  install-as-app details
tests/smoke.html      quick in-browser check of the basics (see below)
```

## Smoke test

With the server running, open <http://localhost:5173/tests/smoke.html>. It loads the app with `?test` (a blank notebook in memory, so saved notebooks are never touched), then writes, erases, undoes, clears, changes paper and orientation, turns pages, places a Venn, rules a line and uses the reveal cover with simulated pen input. It fails on any wrong result or console error. Run it before pushing; it takes a few seconds.

Browser storage holds four stores: `notebooks` (one small record each), `pages` (one record per page, ink stored compactly as whole hundredths of a millimetre), `assets` (reserved for images) and `kv` (settings). Notebook and backup files are plain JSON; single-notebook files can still be opened by the first version of the app.

All ink and paper geometry is stored in millimetres on a 210 × 297 page (297 × 210 for a landscape page), so it scales to any screen and exports at true A4 size.
