# Same Page

A modelling whiteboard for teachers whose pages match the students' exercise books: A4 pages with ruled, dotted-thirds, grid or blank paper, at true millimetre spacing. Write with a stylus and what students see on the screen is exactly what's possible in their own books.

- **A shelf of notebooks:** the *Notebooks* button (top of the right toolbar) shows every notebook as an exercise-book cover: one for spelling, one for novel study, one for maths examples, and so on. Each has its own name, cover colour and starting paper, and remembers its own last page and view.
- **One page or two:** *Two pages* (or press **B**) shows the book lying open: two A4 pages side by side with the spine down the middle. By default page 1 sits on the right, opposite the inside cover, like a real exercise book; *More › Two-page view starts with* changes that to pages 1 and 2 together.
- **Pen, highlighter, eraser** with pressure, palm rejection, and the pen's eraser end or side button.
- **Paper per page:** line spacing, margin, and template; *Use this paper on all pages* copies it to every page.
- **Present mode** (**F**): full screen with a small floating toolbar.
- **Saves automatically** in the browser, one page at a time, so big notebooks stay quick. *Back up all* on the shelf saves every notebook into one file (a reminder appears on the shelf if it's been 3 weeks), and *Open a file* restores a backup or adds a single notebook file. *Print or save as PDF* prints every page at true A4.
- **Works offline** once it has been opened, and can be installed as an app from the browser's address bar.

## Keyboard

| Key | Action |
| --- | --- |
| P / H / E | Pen / highlighter / eraser |
| B | One page ↔ two pages |
| F | Present (Esc to stop) |
| ↑ ↓ ← → / PgUp PgDn | Previous / next page (or pair of pages) |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S | Save this notebook to a file |
| Esc | Leave present mode, close a menu, or close the shelf |

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
js/input.js           pen / mouse / touch, palm rejection, eraser
js/history.js         undo / redo across the whole notebook
js/pages.js           navigating, adding, deleting pages; paper settings
js/export.js          image export and print / PDF
js/library.js         notebooks: open, create, copy, delete; notebook files; back up and restore
js/shelf.js           the Notebooks shelf screen
js/ui.js              toolbars, popovers, present mode, keyboard
sw.js                 offline support (add any new file to its FILES list)
manifest.webmanifest  install-as-app details
```

Browser storage holds four stores: `notebooks` (one small record each), `pages` (one record per page, ink stored compactly as whole hundredths of a millimetre), `assets` (reserved for images) and `kv` (settings). Notebook and backup files are plain JSON; single-notebook files can still be opened by the first version of the app.

All ink and paper geometry is stored in millimetres on a 210 × 297 page, so it scales to any screen and exports at true A4 size.
