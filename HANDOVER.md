# Same Page — handover notes

*Last updated 19 October 2026.*

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

## First classroom test (19 Oct 2026) and what changed

The teacher used it with a class on the Lifebook with a stylus, and preferred it to Microsoft Whiteboard: no accidental button presses from the hand, no loading or sign-in, "it did the job it was designed to do really well". So writing, palm rejection and the toolbar layout hold up in real use. Feedback and the changes that followed:

- **Bug: erasing blanked the whole page.** The eraser only removed the strokes it touched, but the redraw crashed: `touched.forEach(renderInkFor)` passed the page in again as `renderInkFor`'s new `skip` argument (added with Select). The canvas was cleared and never redrawn, so the page looked empty; Undo redrew it, which is why Undo "worked". Fixed in `input.js`. Watch for `forEach(fn)` with functions that take a second argument.
- **Landscape pages:** per page (`pg.land`), set in the Paper popover; copied to new pages and by *Use this paper on all pages*. Ink keeps its millimetre position when the page is turned. In two-page view each sheet takes its own page's shape at one shared scale. Landscape pages print turned sideways on portrait A4.
- **Two new thirds papers** (colleague request): `thirds2`, which is solid, dotted, dotted, solid with rows touching, and `sky`, the same rows coloured sky, grass and dirt for early writers. The sky paper has no margin by default.
- **Venn placement:** tapping with Venn or Venn × 3 fills the top or bottom half of the page, whichever was tapped (`fit: 'half'` in `shapes.js`). Other organisers still fill the page.
- **Ruler** (colleague request, for modelling ruling up a margin): `ruler.js`. It is drawn in a fixed layer over the stage, so it can hang off the page without making it scroll. Input does the hit-testing: body = move, knob = turn (tap = level ↔ upright), within 7 mm outside / 3 mm inside a long edge = a ruled pen or highlighter stroke. The eraser and laser pass straight through it. Its position isn't saved.

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
- **Check the console after testing.** The eraser bug threw an error on every erase, but the page looked fine in a quick synthetic test. Read the console's error messages after any input test.

## Not yet tested or known gaps

- **Real stylus:** writing has been used in a lesson and works well. Not yet confirmed on the device:
  - the eraser fix (stylus eraser end and the Eraser button)
  - the ruler: how easily a stroke catches its edge (7 mm outside / 3 mm inside), and whether the pen moves it by accident
  - hold-to-snap: `HOLD_MS` = 450 ms
  - double-tap: `DOUBLE_MS` = 350 ms, 2.5 mm apart
  - laser hover dot
- **Safari and iPad:** not tested. Safari also clears website data after 7 days without a visit, unless the app is added to the Home Screen.
- **Strokes stay on their own page:** a stroke or laser trail that crosses the spine is cut off at the edge of the page it started on, and a selection can't be dragged onto the other page.
- **Snapped ovals** are always level (never tilted). A tilted four-sided shape keeps its angle and gets straight edges.
- **No sync:** notebooks live in one browser on one device. Moving them means *Back up all* and then *Open a file* on the other device.
- **No pinch-to-zoom**, and no automated tests yet.
- **Ruler:** turns only by its knob (no two-finger twist), and its position resets each time it's shown.
- **Landscape preview in the new-notebook dialog:** new notebooks always start portrait; turn a page to landscape and use *Use this paper on all pages*.

## Possible next steps (rough priority)

1. **Use it in class again with the stylus:** check the eraser fix and the ruler, and tune the timings above from real use.
2. **Insert and paste images.** This has been asked for. Storage already has an empty `assets` space for it. The agreed plan:
   - shrink photos to about 200–400 KB each
   - store each image only once (matched by its content)
   - pages refer to images rather than holding copies
   - once images are placed, they move and resize with Select
3. **Reveal cover:** a sheet over the page that slides down to uncover a worked example step by step.
4. **Writing replay:** replay a page stroke by stroke to show letter formation or the order of a method. Stroke order is already stored.
5. **Page overview:** thumbnails of every page, to jump to one or drag to reorder.
6. **Protractor** overlay for modelling angles (the ruler is done). Maybe two-finger twist to turn the ruler.
7. **Quick notebook switcher** in the toolbar. It was offered alongside the shelf, but the teacher chose the shelf only.
8. **Linked OneDrive folder:** save notebooks as files in a synced folder, for backup and school ↔ home use. This works in Chrome and Edge only.
9. **Copy and paste between pages and notebooks;** drag a selection across the spine.
10. **Automated tests** (e.g. Playwright) for shape recognition, storage migration and backup/restore. Even a short smoke test (draw, erase, undo, turn the page, with no console errors) would have caught the eraser bug before a lesson.
