# Contributing

Thanks for helping make Home Finish Visualizer better! Bug reports, ideas, new styles, translations, docs and code are all welcome.

## Ways to help

- **Report a bug or suggest a feature**: [open an issue](https://github.com/roshanshaji786/house_baithul_hamd/issues/new/choose). For rendering problems, attach the photo (if you're happy to share it) and a screenshot.
- **Add a style preset**: presets live in `public/js/catalog.js` (name, description, swatches) and `public/js/render/styles.js` (`BASE` and `EXTERIOR`). Add before/after images in your PR.
- **Add a material**: generators live in `public/js/render/materials.js`, and options in `FLOOR_OPTIONS`, `ACCENT_OPTIONS` or `TILE_OPTIONS` in `styles.js`.
- **Improve furniture**: planning and three.js models live in `public/js/render/furniture.js`.
- **Improve the docs**: the [user guide](docs/USER_GUIDE.md) and [architecture](docs/ARCHITECTURE.md) docs.

## Development setup

```bash
git clone https://github.com/roshanshaji786/house_baithul_hamd.git
cd house_baithul_hamd
npm install
npm run dev     # http://localhost:3000, restarts on changes
npm test
```

There is no front-end build step: edit files in `public/` and reload the page. AI engines are optional; copy `.env.example` to `.env` to try them.

## Guidelines

- **Keep it free and private by default.** Features must work without an API key and without uploading photos, unless they are clearly optional AI features.
- **Match the surrounding code**: plain ES modules, small functions, and a short comment for anything non-obvious. Run `npm test` before opening a PR.
- **Add tests** for pure logic (geometry, styles, planning, prompts). See the `test/` folder.
- **Accessibility**: controls need labels, keyboard support and visible focus. Check the layout at phone width (390 px).
- **No trademarked products or logos** in presets, prompts or sample images.
- Keep pull requests focused, and describe what you changed and how you tested it. Screenshots help a lot for visual changes.

## Code of conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). Be kind and constructive.
