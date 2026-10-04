# Contributing to ARail-EBL

Thank you for helping. ARail-EBL is meant to be useful for many railway labs, so contributions of all kinds are welcome: bug reports from lab sessions, photos and videos of layouts that do not track well, new object types and simulations, adapters for control systems, documentation and translations.

## Ways to contribute

- **Report a problem** with the [bug report form](https://github.com/joernmht/ARail-EBL/issues/new/choose). For tracking problems, attach a photo or a short video: it lets us reproduce the problem.
- **Suggest a feature** or describe your lab's setup with the corresponding forms.
- **Send a pull request.** For larger changes, please open an issue first so we can agree on the approach.

## Development setup

Requirements: Node.js 22 or newer, Python 3.10 or newer, git.

```bash
git clone https://github.com/joernmht/ARail-EBL.git
cd ARail-EBL
npm install                                   # only dev tools (Playwright)
python -m venv .venv && source .venv/bin/activate
pip install -e "tools[headless,bridge,dev]"   # or [opencv,...] for the calibration window
npm run fixtures                              # generates tests/fixtures (images and a short video for the tests)
npm start                                     # http://localhost:8000
```

The web app has **no build step**: edit files in `web/` and reload the page. `npm start` only accepts connections from this computer; to try the app on a phone in the same network, use `node tools/serve.mjs web 8000 0.0.0.0` (without https the phone can open photos and videos, but not the live camera).

## Tests

```bash
npm test                          # JavaScript unit and integration tests (node:test)
python -m pytest tests/python     # Python tests
npx playwright install chromium   # once
npm run test:e2e                  # browser tests (the app, the project page, the marker sheets, accessibility)
```

The browser tests start a server on port 8123; set `ARAIL_PORT` to use another one (`ARAIL_PORT=8200 npm run test:e2e`).

Run the fixtures again after changing `tools/arail_tools/synthetic.py` or the example images. CI runs all three suites on every pull request.

Tracking changes must keep the accuracy thresholds in `tests/js/tracker.test.js`. If you improve the detector, please also report the effect on the lab photo and video (see `docs/architecture.md`).

## Code style

- **JavaScript**: modern ES modules, no framework, no build step, no runtime dependencies besides the vendored js-aruco2. 2-space indentation, double quotes, semicolons. Keep modules focused and document public functions with JSDoc. Everything in `web/arail/` must also run in Node.js (no DOM access outside `web/app/`) and stay deterministic (use `world.rng` or `createRng(seed)`, never `Math.random`).
- **Python**: formatted and linted with ruff: `cd tools && ruff format . ../tests/python && ruff check . ../tests/python`.
- **Units in names**: `_mm` for model millimetres, `_m` for prototype metres, `_s` for seconds, `_deg` for degrees.
- **User-facing text** in English, plain and specific ("Train arriving", "No markers in view"), sentence case.
- **Colours and type**: the app follows the corporate design of the Chair of Railway Operations. Use the tokens of `web/app/app.css` in the interface and `CD`, `OVERLAY`, `FONT` and `PALETTE` (`web/arail/core/colors.js`) on the canvas instead of new hard-coded colours; buildings stay greyscale. Text must keep a contrast of at least 4.5:1 in light and dark mode (the accessibility tests check it). The project page (`web/index.html`) and the marker sheets (`web/markers/`) load `app.css` and use the same tokens.

## Adding things

- **Object types, simulations, disruptions, vehicles**: see [docs/extending.md](docs/extending.md) (new building types extend `BuildingBase`). Generally useful ones can become built-ins (register them in `web/arail/index.js`, document them in `docs/layout-format.md`, add tests); specialised ones fit well as example plugins in `web/plugins/`.
- **Control-system adapters**: see [docs/control-system-interface.md](docs/control-system-interface.md). Adapters for widely used systems are welcome; add a test with recorded data.
- **Layouts of your lab**: example layouts help others; please add a photo of the layout with its markers.

## Pull requests

- One topic per pull request, with tests for new behaviour.
- Update the documentation and `CHANGELOG.md` (section "Unreleased").
- Describe how you tested it, ideally including a photo or video of a real layout for tracking and rendering changes.
- By contributing, you agree that your contribution is licensed under the MIT license of this project.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Please be kind and constructive.
