# Testing & bug fixes

This documents the test suites and the bugs found by them (and by code audit)
in the October 2026 full-app review, plus how to run everything.

## How to run

```bash
npm test               # unit tests: geometry, styles, conflicts, furniture,
                       # prompts, AI provider adapters (no browser needed)
npm run test:browser   # end-to-end tests in a real headless Chromium
npm run test:all       # both
```

The browser tests need **no installation and no GPU**: a headless Chromium
with software WebGL (SwiftShader) ships as the devDependency
`@sparticuz/chromium` and is unpacked into the OS temp directory on first
run (`test/browser/helpers/browser.mjs`). Tests that need a server spawn the
real `server/index.js` on a test port; the static-build tests build `dist/`
and serve it with a plain static file server, exactly like GitHub Pages.

## What the browser suite covers

- App boot with a clean console and working WebGL2
- `/api/config` capability reporting without API keys
- Sample photo loading, quality badges, room-size estimation
- Full free-preview renders for **every room type** (living, bedroom,
  kitchen, bathroom, exterior)
- Before/after slider (pointer + touch), side-by-side, after-only views
- Style switching with auto-update of stale renders
- Single-element edits (flooring) and element-editor form building for every
  element on interior, kitchen and exterior photos
- Reference images: add, label, remove, use in a render
- Saved renders gallery (save, download, open, remove)
- Project flows: rename, create, switch, **delete without resurrection**,
  persistence across reloads (IndexedDB)
- Room-box fitting editor with draggable corners
- 3D house build, walkthrough playback, explore mode
- MP4 export start/progress/cancel and GLB model download
- Rejection of unsupported files with a friendly message
- Mobile viewport (375×667): no horizontal overflow on any tab, sticky tab
  bar, touch-driven slider, no page errors
- The static build (`dist/`): loads, falls back to the free engine, renders

## Bugs found and fixed

| # | Where | Bug | Fix |
| --- | --- | --- | --- |
| 1 | `public/js/state.js` | **Deleted projects resurrected.** Deleting a project called `switchProject()`/`createProject()`, which saved the still-current (deleted) project back to IndexedDB first. The "deleted" project reappeared in the list and after reload. | The deletion flow now switches without saving the outgoing project. |
| 2 | `public/js/ui/elementEditor.js` | **Element edits leaked between photos.** A pending (unapplied) flooring/wall/... change made on photo A stayed in the form after switching to photo B, where "Apply" would change B. | Drafts are scoped to the photo they were started on; switching photos discards them. |
| 3 | `public/js/main.js` | Saving on page close relied on `beforeunload` only, which is unreliable (and never fires as expected on mobile Safari) for async IndexedDB writes. | Also listen to `pagehide`. |
| 4 | `public/js/state.js` | `migrate()` crashed for a stored project missing `photos`/`references`, breaking app start. | Both arrays are defaulted. |
| 5 | `public/js/ui/house.js` | The walkthrough play button dereferenced `timeline.duration` before any house existed (crash if triggered early). | Guarded: playing requires a timeline. |
| 6 | `public/js/three/videoExport.js` | A failed `canvas.toBlob` (memory pressure) pushed `null` into the server-encoding frame stream, producing a broken video. | Explicit error instead. |
| 7 | `public/js/ui/compare.js` | The downloaded before/after image's caption could run off the right edge with long photo/style names; a `toBlob` failure resolved with `null`. | Caption truncated to fit; encode failure surfaced as an error. |
| 8 | `public/js/ui/uploads.js` | Clicking "Try sample photos" twice duplicated every sample photo. | Re-selects the existing samples instead. |
| 9 | `public/css/styles.css` | **iOS input zoom**: form controls rendered at 15px, so iPhone Safari zoomed the whole page whenever a select/input was focused. | 16px controls on small screens. |
| 10 | `public/css/styles.css` | Mobile layout gaps: no sticky navigation, room-order rows pushed reorder buttons off-screen, long file names/chips caused horizontal scrolling, notch/home-indicator overlaps. | Sticky tab bar, wrapping and min-width fixes, safe-area insets, larger touch targets. |

## Notes on the mobile work

The app keeps a single responsive codebase (no separate mobile site): the
design grid collapses to one column below 980px, the compare slider works
with touch (`touch-action: pan-y` + pointer events), and the section tabs
stick to the top of the screen while scrolling so switching Design / 3D
house / Saved never requires scrolling back up. The mobile test asserts
all of this against a 375×667 touch viewport.
