# arail-tools

Python tools for [ARail-EBL](https://github.com/joernmht/ARail-EBL) (and three Node.js scripts,
[`ops-compare.mjs`](#comparing-operations-setups), [`fetch-fonts.mjs`](#updating-the-fonts) and
[`video/render.mjs`](#videos)):

| Command | What it does | Extra |
| --- | --- | --- |
| `arail-bridge` | connects a control system to the ARail web app (WebSocket feed) | `bridge` |
| `arail-calibrate` | camera calibration with the layout's markers, JSON output for the app | `opencv` |
| `arail-survey` | surveys a layout from a video or photos: fixed marker map, report, orthophoto of the table | `opencv` or `headless` |
| `arail-stabilize` | steadier poses for a video of the app: the markers' poses joined with the picture's own motion | `opencv` or `headless` |
| `arail-compose` | joins rendered shots into a video: crops, slow pushes, crossfades, a seamless loop; H.264 (ffmpeg) | `opencv` or `headless` |
| `arail-synthetic` | renders the synthetic test scene of the tests (`npm run fixtures`) | `opencv` or `headless` |
| `python -m arail_tools.fixtures` | generates the images and the short survey video for the tests | `opencv` or `headless` |

```bash
pip install -e "tools[bridge]"                 # only the bridge
pip install -e "tools[opencv,bridge]"          # everything, with OpenCV windows (desktop)
pip install -e "tools[headless,bridge,dev]"    # servers, CI, development
```

Install either `opencv` or `headless`, not both. See the documentation:
[control-system interface](../docs/control-system-interface.md), [calibration](../docs/calibration.md),
[lab session](../docs/lab-session.md).

## Surveying a layout

Stick markers all over the layout, film it, then:

```bash
arail-survey lab.mp4 photos/*.jpg --layout web/layouts/ebl-lab.json -o ebl-lab.json \
    --report report.json --ortho web/media/ebl-lab-ortho.jpg --check check.jpg
```

The marker poses of `--layout` are kept (markers that moved are measured again), all other markers
are surveyed, and the result is merged into the layout: `markers.poses` and `view.ortho` (the
orthophoto for the flyover). The marker map is written locked (`markers.locked`: the app then uses
only these markers; `--unlocked` to skip), and markers on vehicles (`markers.moving`, `--moving
40,41`) are left out of the map. `arail-survey --help` lists all options; the
[lab-session checklist](../docs/lab-session.md) covers stickers, filming and checking the report.
For a quick check in the lab, the app does a simpler survey of its own: Build → Marker map →
Survey a video.

## Videos

`video/render.mjs` (Node.js with the dev dependencies: Playwright and Chromium) renders the app's
augmented picture frame by frame after a plan: over a clip, a photo or in the flyover, at a fixed
frame rate. `arail-stabilize` makes the poses of a clip steadier, `arail-compose` joins the shots
into a video. The plans of the project page's videos are in `video/plans/`; `sh
tools/video/page-videos.sh` makes them again (ffmpeg needed):

```bash
node tools/video/render.mjs tools/video/plans/bus.json --only 0,120   # a quick look at two frames
arail-compose tools/video/plans/landing.json
```

The way from a clip to a video, the stabilization step by step and which steps could run live:
[Videos of the lab](../docs/videos.md).

## Comparing operations setups

`ops-compare.mjs` (Node.js, no Python) runs the [rail operations](../docs/operations.md) of a layout
for each setup under a stress test, as the app's **Operations → Compare** does, and prints the key
figures and the net penalties per party:

```bash
node tools/ops-compare.mjs web/layouts/ebl-lab.json --days 28 --seeds 3 --stress flu
node tools/ops-compare.mjs my-layout.json --setups integrated,distributed --csv results.csv
node tools/ops-compare.mjs web/layouts/ebl-lab.json --list   # the setups and stress tests
```

Options: `--days N` (measured days per run, 28), `--seeds N` (runs per setup, 3), `--stress ID`,
`--setups ID,ID` (default: the layout's setups, else the presets), `--csv FILE`, `--json FILE`.

## Updating the fonts

The pages load their fonts from `web/assets/fonts/`, never from Google. `fetch-fonts.mjs` (Node.js)
downloads them once from Google Fonts with their licence texts and writes the stylesheets
`fonts-app.css` and `fonts-markers.css`:

```bash
node tools/fetch-fonts.mjs
```
