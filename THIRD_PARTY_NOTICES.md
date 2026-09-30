# Third-party notices

ARail-EBL includes or uses the following third-party components.

## Included in this repository

| Component | Where | License |
| --- | --- | --- |
| [js-aruco2](https://github.com/damianofalcioni/js-aruco2) 2.0.0 (`cv.js`, `aruco.js`), Copyright (c) 2020 Damiano Falcioni, (c) 2011 Juan Mellado | `web/vendor/js-aruco2/` | MIT |
| ArUco 4x4–7x7 dictionaries (extracted from OpenCV by js-aruco2), Copyright (C) 2013, OpenCV Foundation | `web/vendor/js-aruco2/dictionaries/aruco_*` | BSD-3-Clause |
| AprilTag 36h11 dictionary, Copyright (C) 2013-2016, The Regents of The University of Michigan | `web/vendor/js-aruco2/dictionaries/apriltag_36h11.js` | BSD-2-Clause |

The full license texts are in `web/vendor/js-aruco2/LICENSE.txt` and in the headers of the dictionary files.

## Loaded at runtime

| Component | Used by | License |
| --- | --- | --- |
| [Archivo](https://fonts.google.com/specimen/Archivo) and [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) via Google Fonts | web pages (system fonts are used if unavailable) | SIL Open Font License 1.1 |

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
