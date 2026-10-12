# Third-party notices

ARail-EBL includes or uses the following third-party components.

## Included in this repository

| Component | Where | License |
| --- | --- | --- |
| [js-aruco2](https://github.com/damianofalcioni/js-aruco2) 2.0.0 (`cv.js`, `aruco.js`), Copyright (c) 2020 Damiano Falcioni, (c) 2011 Juan Mellado | `web/vendor/js-aruco2/` | MIT |
| ArUco 4x4–7x7 dictionaries (extracted from OpenCV by js-aruco2), Copyright (C) 2013, OpenCV Foundation | `web/vendor/js-aruco2/dictionaries/aruco_*` | BSD-3-Clause |
| AprilTag 36h11 dictionary, Copyright (C) 2013-2016, The Regents of The University of Michigan | `web/vendor/js-aruco2/dictionaries/apriltag_36h11.js` | BSD-2-Clause |
| [dagre](https://github.com/dagrejs/dagre) 3.1.1 (`dist/dagre.esm.js`, which includes [graphlib](https://github.com/dagrejs/graphlib) 4.0.5), Copyright (c) 2012-2014 Chris Pettitt; lays out the diagrams of the architecture page | `web/vendor/dagre/` | MIT |

The full license texts are in `web/vendor/js-aruco2/LICENSE.txt`, `web/vendor/dagre/LICENSE.txt` and in the headers of the dictionary files. `LICENSE.txt` also contains the LGPL-3.0 text of AForge.NET, which covers js-aruco2's `posit1.js`, `posit2.js` and `svd.js`; these files are **not** included, so ARail-EBL contains no LGPL code.

### Logo of the Chair of Railway Operations

The logo of the Chair of Railway Operations (Professur für Bahnverkehr, öffentlicher Stadt- und Regionalverkehr), TU Dresden, with the chair's arrow mark, in `web/assets/cro-logo.svg` and `web/assets/cro-logo-white.svg`, is used with the chair's permission. It is **not** covered by the Apache License 2.0 of this repository and may not be reused outside of this project without permission of the chair. The logo of TU Dresden itself is not used. If you fork ARail-EBL for another lab, remove the logo (`web/app/index.html`, `web/index.html`) or replace it with your own. The colours and typeface of the chair's corporate design (Türkis, Noto Sans) are used for the app's interface.

## Fonts (self-hosted)

The fonts are served from `web/assets/fonts/`, not from Google's servers, so the pages send no visitor data to Google. `node tools/fetch-fonts.mjs` downloads them again (Latin and Latin Extended subsets, WOFF2).

| Component | Used by | License |
| --- | --- | --- |
| [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) and [Noto Sans Mono](https://fonts.google.com/noto/specimen/Noto+Sans+Mono) | the app and the project page (system fonts are used if unavailable) | SIL Open Font License 1.1 (`OFL-NotoSans.txt`, `OFL-NotoSansMono.txt`) |
| [Archivo](https://fonts.google.com/specimen/Archivo) and [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | the marker sheets (system fonts are used if unavailable) | SIL Open Font License 1.1 (`OFL-Archivo.txt`, `OFL-JetBrainsMono.txt`) |

## Python dependencies (installed with pip)

| Component | Used by | License |
| --- | --- | --- |
| [NumPy](https://numpy.org) | tools | BSD-3-Clause |
| [OpenCV](https://opencv.org) (`opencv-python` / `opencv-python-headless`) | calibration, synthetic scenes, test fixtures | Apache-2.0 |
| [aiohttp](https://github.com/aio-libs/aiohttp) | bridge | Apache-2.0 |
| [pytest](https://pytest.org), [ruff](https://github.com/astral-sh/ruff) | development | MIT |

## Development dependencies (npm)

| Component | Used by | License |
| --- | --- | --- |
| [Playwright](https://playwright.dev) | browser tests | Apache-2.0 |
| [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm) | accessibility tests | MPL-2.0 |
