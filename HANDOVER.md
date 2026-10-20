# Same Page — handover notes

*Last updated 20 October 2026.*

## What it is

Same Page is a stylus whiteboard for teachers whose pages match the students' exercise books: true A4, with real millimetre line spacing. Microsoft Whiteboard, Vivi and OneNote never match a student's workbook, so what's modelled on the board isn't what students can actually do in their books. This app fixes that.

- **Live site:** <https://same-page-theta.vercel.app/>. It is installable as an app from Chrome or Edge, and works offline after the first visit.
- **Code:** <https://github.com/MrWanderingEmu/Same-Page>, branch `main`. Every push to `main` redeploys on Vercel within about a minute.
- **Main device:** a Lifebook laptop in tablet mode with a stylus, in Chromium (Edge or Chrome). That's about 1280 × 720 CSS pixels at 150% scaling, and both toolbars are tuned to fit that height.

## What we built

| Commit | What |
| --- | --- |
| `799f7ae` | The original single-file app ("Workbook Board"), kept as the starting point |
| `4b68655` | Split into HTML, CSS and ES modules with no build step. Added the **two-page view** (an open exercise book: cover, spine shadow, page 1 opposite the inside cover). Added offline support (service worker and manifest) |
| `d0b6eeb` | Renamed to **Same Page** |
| `8bc7a18` | **Notebooks shelf** (exercise-book covers with name, colour and starting paper). Each notebook keeps its own settings. Storage now saves one page at a time with compact ink. **Back up all** / restore, with a gentle reminder after 3 weeks. Older saved work moves over automatically |
| `ac863b3` | **Hold-to-snap shapes**, the **Insert** tool (6 shapes and 11 graphic organisers) and **double-tap** to switch between one and two pages. Also fixed a nearly invisible page counter |
| `f37c984` | **Lasso Select** (move, resize, recolour, duplicate, delete) and the **laser pointer** |
| `4998812` | After the first classroom test (19 Oct): **eraser fix**, **landscape pages**, **two-dotted** and **sky-grass-dirt** thirds, **Venn fills the half you tap**, **ruler** (details below) |
| `e22bfe4` | **Reveal cover** and the **smoke test** page (details below) |
| `7964c31` | **Toolbar palm guard** and the shelf's storage figure (details below) |
| `ae78d2c` | **Pictures:** paste, Paste picture button, files, drag and drop (details below) |
| *(next)* | **PDF pages** (details below) |

## First classroom test (19 Oct 2026) and what changed

The teacher used it with a class on the Lifebook with a stylus, and preferred it to Microsoft Whiteboard: no accidental button presses from the hand, no loading or sign-in, "it did the job it was designed to do really well". So writing, palm rejection and the toolbar layout hold up in real use. Feedback and the changes that followed:

- **Bug: erasing blanked the whole page.** The eraser only removed the strokes it touched, but the redraw crashed: `touched.forEach(renderInkFor)` passed the page in again as `renderInkFor`'s new `skip` argument (added with Select). The canvas was cleared and never redrawn, so the page looked empty; Undo redrew it, which is why Undo "worked". Fixed in `input.js`. Watch for `forEach(fn)` with functions that take a second argument.
- **Landscape pages:** per page (`pg.land`), set in the Paper popover; copied to new pages and by *Use this paper on all pages*. Ink keeps its millimetre position when the page is turned. In two-page view each sheet takes its own page's shape at one shared scale. Landscape pages print turned sideways on portrait A4.
- **Two new thirds papers** (colleague request): `thirds2`, which is solid, dotted, dotted, solid with rows touching, and `sky`, the same rows coloured sky, grass and dirt for early writers. The sky paper has no margin by default.
- **Venn placement:** tapping with Venn or Venn × 3 fills the top or bottom half of the page, whichever was tapped (`fit: 'half'` in `shapes.js`). Other organisers still fill the page.
- **Ruler** (colleague request, for modelling ruling up a margin): `ruler.js`. It is drawn in a fixed layer over the stage, so it can hang off the page without making it scroll. Input does the hit-testing: body = move, knob = turn (tap = level ↔ upright), within 7 mm outside / 3 mm inside a long edge = a ruled pen or highlighter stroke. The eraser and laser pass straight through it. Its position isn't saved.

## Reveal cover (19 Oct 2026)

The teacher picked this next. Their choices: prepared ahead and saved with the page (not a lesson-only overlay); one sheet sliding down from the top (not tap-away boxes); snapping to the paper's lines; revealed by pen or finger (no clicker).

- `pg.cover` is the cover's top edge in mm, or `null`. It's saved in page records and notebook files, but isn't part of the paper, so new pages and *Use this paper on all pages* don't copy it. It isn't in Undo either, like the laser.
- `coverStops(pg)` in `cover.js` gives where it can rest. Ruled: 0.3 of a line gap under each line, leaving room for tails. Thirds: a whole row at a time, just above the next head line. Two dotted and sky: just under each row's bottom line. Grid: each line. Blank: every 10 mm. The first stop shows only the heading area.
- Tap the tab = next stop (the last one takes it off). Drag = settles on the nearest stop, or comes off if pulled to the bottom. Only the tab moves it; pointer-down on the covered area does nothing (one hint toast), and the eraser skips covered points.
- The card is a DOM element inside each sheet, so it follows the page; exports draw the canvases only, so it never prints.
- Known gap: a Select lasso started above the cover can still pick up strokes under it.

## Feedback of 20 Oct 2026 and what changed

- **Toolbar palm guard.** The teacher is left-handed. Starting to write at the top left, the side of their hand sometimes tapped Highlight on the left rail. The page already ignored palms, but the buttons didn't. Now a touch press on any toolbar button is dropped while the pen is hovering or was used in the last second (`TOOLBAR_PALM_MS` in `ui.js`). Pen, mouse, keyboard and finger taps with the pen away work as before. If palms still get through on the device, the fallback is a "toolbar: pen only" setting.
- **Shelf storage figure.** It showed `navigator.storage.estimate()`, which includes the offline copy of the app and only shrinks when the browser tidies its database files, so it seemed never to go down after deleting notebooks (the deletes were real). It now adds up the notebooks' own sizes.
- **Colleague requests, in the agreed order:** images (done, below), PDF pages (a few pages at most, with a page limit), text that sits on the paper's lines, then a page overview (reorder, move or copy pages between notebooks, combine notebooks). **OneDrive is parked**, including the linked folder: the teacher sees no need. Sharing a notebook with a colleague means saving it to a file and sending it, which already works.

## Pictures (20 Oct 2026)

The teacher pastes from the Snipping Tool; colleagues copy pictures from Google or use saved files. No camera photos.

- **A picture is an item in `pg.strokes`:** `{ t:'img', a: assetId, x, y, w, h }` in mm. That's why Undo, Select, Clear, saving changed pages, duplicating notebooks and the save diff all work without changes. `drawItems()` in `draw.js` draws every picture before any ink, so writing is always on top whatever the list order. Anything that reads `s.p` must skip pictures (the eraser, the landscape check, Select's geometry already do).
- **The eraser never removes a picture,** so rubbing out writing on a worksheet can't take the worksheet with it. *Select › Delete* does. Recolour skips pictures. Resizing keeps the shape (one corner handle, uniform scale).
- **Storage (`assets.js`):** the `assets` store holds `{ id, blob, w, h }`, where the id is the first 128 bits of the SHA-256 of the stored bytes, so the same picture is stored once. Pictures are shrunk to 1600 px on the longest side and re-encoded as WebP (PNG or JPEG where WebP isn't available), unless one is already under 350 KB and small enough. A 1.6 MB 4000 × 3000 test picture came out at 217 KB.
- **Tidying:** `pruneAssets()` deletes pictures no saved page uses. It runs at start-up and after deleting a notebook or restoring a backup, but it keeps anything loaded this session, because Undo may bring it back. So a deleted notebook's pictures go at the next start.
- **Files:** notebook files and backups carry each notebook's pictures as data URLs under `assets`. Older versions of the app simply drop the picture items (they fail `validStroke`).
- **Placing:** a picture lands at the size it was on screen, shrunk to fit (page width − 30 mm, 55 % of the height), centred on the part of the page in view, or where it was dropped. It's then selected with the Select tool on. A picture that hasn't loaded yet draws as a faint box, and `onAssetReady` redraws when it arrives.
- **Pasting from the web:** "Copy image" gives real picture data. Copying a selection of a web page gives HTML with a link; the app tries to fetch it, but most sites block that, so it shows a hint to use *Copy image*.
- **Pictures are opaque,** like a worksheet glued into the book: a white background covers the lines beneath it.

## PDF pages (20 Oct 2026)

Colleague request: put in a PDF and write on it. The teacher said PDFs would be a few pages at most, and asked for a limit.

- **A PDF page is the page's paper, not an item on it:** `pg.bg = { a: assetId, x, y, w, h }`, fitted inside the page and centred (`fitBg` in `state.js`). `drawPaper()` draws it on the background canvas on white, in place of the lines. So Select can't drag the worksheet by accident, the eraser can't touch it, and Clear wipes the writing but keeps it, which makes a sheet reusable.
- **The page underneath keeps the notebook's paper** (copied from the page you were on), hidden. Pages added after a PDF page carry on with the usual paper, and the blank page after the last one previews that paper, not the PDF. *Use this paper on all pages* doesn't turn PDF pages round. The Paper popover on a PDF page shows only portrait/landscape and a note. Turning one refits the worksheet.
- **`pdf.js`:** each chosen page is rendered with PDF.js at 2200 px on its longest side (about 190 dpi on A4, so text stays sharp in Fit width), saved as WebP 0.9 (JPEG where WebP isn't available), and stored as an asset with `addImage(blob, { ready: true })`, which skips the usual shrinking. The pages go in after the current page, the right way round, and the view jumps to the first of them. A simple worksheet page came out at 35 KB.
- **Limits:** 10 pages at a time (`MAX_PAGES`); for a longer PDF a `prompt()` asks which pages ("1-3, 5"), parsed by `parsePages`. Files over 60 MB are refused. Password-protected PDFs get their own message.
- **PDF.js** (`vendor/pdfjs/`, 4.10.38, checksum checked against npm) is loaded with a dynamic `import()` only the first time a PDF is opened. It isn't in the service worker's precache list (it's about 2 MB), but the worker caches every file it fetches, so it works offline after its first use. The `.mjs` files were renamed `.js` so any static host serves them with a JavaScript type. `standard_fonts/` is there for PDFs that use non-embedded fonts like Helvetica. The CJK `cmaps/` were left out. `.gitattributes` keeps `vendor/` byte-for-byte.
- **Not undoable:** adding PDF pages works like *Add page*, which isn't in Undo either. Delete the page to remove it.

The features themselves, and the keyboard shortcuts, are described in [README.md](README.md).

## Decisions worth knowing (and why)

- **No build step.** The repo folder *is* the website: plain ES modules, so it can be hosted anywhere as-is. It must be opened over http(s), not by double-clicking `index.html`. Locally, run `python -m http.server 5173`.
- **Everything is measured in millimetres** on a 210 × 297 page (297 × 210 when it's landscape). That's what keeps the board true to the real book at any screen size, and what lets exports print at true A4.
- **Shape snapping uses a pen hold, not auto-correct.** Auto-correcting every stroke would wreck handwriting (every "o" would become a circle).
- **Inserted shapes and organisers are ordinary ink, without printed headings.** They look ruled-up like a student's book, Undo and the eraser work on them, and the teacher writes the headings, just as students do.
- **Strokes are never changed in place.** The undo history keeps references to old strokes, so Select's move, resize and recolour swap in new copies instead.
- **Undo is one history for the whole notebook**, not one per page, which makes sense when two pages are on screen at once.
- **The saved data keeps its old name.** The browser database and the file tag are still called `workbook-board`, so older saved work and notebook files still open. Don't rename them.
- **The eraser removes whole strokes**, not parts of them. It's quick, and printed letters are only a few strokes each. If the teacher writes joined-up, one stroke can be a whole word; partial erasing (splitting strokes) is the fix if that comes up.
- **Content is low stakes.** The teacher said it's for modelling, not planning documents. That's why backups are a gentle nudge on the shelf and never interrupt a lesson.

## Housekeeping rules

- **Commit identity:** commits must be signed as `MrWanderingEmu <187715490+MrWanderingEmu@users.noreply.github.com>`, which is set in this repo's own git config. Never use the owner's real name or personal email.
- **New files:** if you add a file, add it to the `FILES` list in `sw.js` and bump `CACHE` (it's at `same-page-v5` now), or it won't work offline.
- **Storage changes:** if the database layout changes, bump the version in `db.open()` in `js/storage.js` and handle the upgrade. Existing notebooks must keep loading.
- **Simulating pen input in the browser preview:** the hidden preview pane gives the page zero size and slows animation to about 2 frames a second. Set a window size (e.g. 1280 × 720) first, and don't judge animation timing (like the laser fade) there. Screenshots of a 1280 × 720 window may come back cropped; copying the page canvases into one scaled-down image overlay is a reliable way to see the whole page.
- **Run the smoke test before pushing:** <http://localhost:5173/tests/smoke.html> (see the README). It would have caught the eraser bug, and it does if that bug is put back. Add a check to it whenever a feature is added. It runs the app with `?test`, which skips IndexedDB, so it's safe to run anywhere.
- **Toolbar room:** at 1280 × 720 the left rail is exactly full; the right rail has about 60 px spare. A new left-rail button needs something else to move.
- **Check the console after testing.** The eraser bug threw an error on every erase, but the page looked fine in a quick synthetic test. Read the console's error messages after any input test.

## Not yet tested or known gaps

- **Real stylus:** writing has been used in a lesson and works well. Not yet confirmed on the device:
  - the toolbar palm guard (does a left hand on the rail still press buttons?)
  - *Insert › Paste picture* (the browser asks once to see the clipboard), and pasting from Snipping Tool and from Google with Ctrl+V
  - PDF pages from real worksheets (Word exports, scanned sheets), and how sharp they look in Fit width
  - the eraser fix (stylus eraser end and the Eraser button)
  - the reveal cover's tab: big enough, and not grabbed by accident
  - the ruler: how easily a stroke catches its edge (7 mm outside / 3 mm inside), and whether the pen moves it by accident
  - hold-to-snap: `HOLD_MS` = 450 ms
  - double-tap: `DOUBLE_MS` = 350 ms, 2.5 mm apart
  - laser hover dot
- **Safari and iPad:** not tested. Safari also clears website data after 7 days without a visit, unless the app is added to the Home Screen.
- **Strokes stay on their own page:** a stroke or laser trail that crosses the spine is cut off at the edge of the page it started on, and a selection can't be dragged onto the other page.
- **Snapped ovals** are always level (never tilted). A tilted four-sided shape keeps its angle and gets straight edges.
- **No sync:** notebooks live in one browser on one device. Moving them means *Back up all* and then *Open a file* on the other device.
- **No pinch-to-zoom**, and no automated tests yet.
- **Quick stylus check (evening of 19 Oct):** after the reveal cover went live, the teacher tried the new features with the stylus: "feels great". More detailed feedback is due on 20 Oct; start the next session by asking for it before building anything new.
- **Reveal cover:** not yet used in a lesson; the tab is 40 px tall.
- **Ruler:** turns only by its knob (no two-finger twist), and its position resets each time it's shown.
- **Landscape preview in the new-notebook dialog:** new notebooks always start portrait; turn a page to landscape and use *Use this paper on all pages*.

## Possible next steps (rough priority)

1. **Real-device check** of the toolbar palm guard and pictures, and tune the timings above from real use.
2. **Text that sits on the lines:** paste or type text that flows onto the paper's lines from where you tap, sized to the paper and wrapping at the margin. Three styles: a Sassoon Primary-like print (closed loops, a plain 'a') for the early years, a Victorian Modern Cursive-like hand from Years 3/4, and a plain font like Arial for older students. Check font licences: free look-alikes may be needed.
3. **Writing replay:** replay a page stroke by stroke to show letter formation or the order of a method. Stroke order is already stored.
4. **Page overview** (colleague request): thumbnails of every page, to jump to one or drag to reorder; move or copy pages to another notebook; add a whole notebook into this one. Pictures come along for free, since pages only refer to them.
5. **Protractor** overlay for modelling angles (the ruler is done). Maybe two-finger twist to turn the ruler.
6. **Quick notebook switcher** in the toolbar. It was offered alongside the shelf, but the teacher chose the shelf only.
7. ~~Linked OneDrive folder~~: parked on 20 Oct 2026 at the teacher's request.
8. **Copy and paste between pages and notebooks;** drag a selection across the spine.
9. **More automated tests:** the smoke test covers the basics; still untested are shape recognition, storage migration, and backup/restore.
