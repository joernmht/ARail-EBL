# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- **Flyover**: look at and edit the layout with a virtual camera instead of the camera image (button, View panel or key F). Mouse, touch, keyboard and on-screen buttons orbit, pan, zoom, tilt and switch to a plan view; the camera is kept per layout. It shows the lab floor, the table, the orthophoto of the table, a grid, the marker stickers and everything virtual, by day and by night.
- **Grid editing**: in the flyover (and over the camera image with "Grid in camera view") placed points, rectangle corners and dragged objects snap to a grid (`grid` in the layout; Alt for free placement). Inspector buttons ↺ 90° / ↻ 90° and the keys R / Shift+R turn objects. In the flyover objects can be placed with the keyboard alone: the arrows move the view, Enter puts a point at the cross in the middle.
- **Table modules** (`tabletop`, Build → Table): virtual extensions of the tabletop, drawn over the camera image too, or the outline of the real table for the flyover. Dragged out from corner to corner; Duplicate puts the copy right beside the original.
- **Orthophoto** of the table (`view.ortho`), drawn in perspective on the table in the flyover.
- **Streets** as a road network: street, residential street, main road and footpath, with sidewalks, junctions (end to end, T, X), zebra crossings and street lamps; street points snap to other streets in the editor.
- **Bus stops** (on one or both sides of a street) and **bus lines** (tap the stops in order): buses drive along the streets, keep their distance, give way at junctions, stop with their doors at the stop, lay over at the termini and run more often in the rush hours. Boards say "Bus 62 to Bahnhof in 3 min"; loop lines are rings ("Bus 62 Ring ↻ in 3 min"). Bus terminals can be stops of bus lines.
- **Road traffic** (simulation `traffic`): cars enter and leave where streets end, take varied routes, keep to the right lane and give way at junctions.
- **German house types** in the grey look of a white architectural model: Plattenbau (WBS 70 with 6 or 11 floors, QP 61, P2), Altbau block (closed, U-shaped or a row), single-family house, single-family estate, office building, school, supermarket and workshop. New palette group Buildings. At night windows light up by occupancy.
- **Fast clock and day/night lighting**: a time of day (layout `clock`) that runs faster than the simulation; the image and everything virtual get darker at night, while lit windows, street lamps and headlights keep their light. Timetables, bus lines, road traffic and random passengers follow the time of day (rush hours; no trains and buses from 01:00 to 04:30). Simulate → Time of day: slider, presets, fast-clock ratio, lighting on/off, stop the clock. The HUD shows the time; speeds up to 30×.
- **Town simulation** (`town`): residents go to work, to school and shopping and come home again, on foot, by bus and by train; visitors come by train. People are coloured by the purpose of their trip; Simulate → Town shows where everybody is.
- **Lab survey**: `arail-survey` measures all markers of a layout from videos and photos in one adjustment and writes a fixed layout, a report, an orthophoto and a check image; in the app, Build → Marker map → Survey a video does a quick survey. New guide [Lab session](docs/lab-session.md).
- **Locked marker map** (`markers.locked`): Keep positions locks the map, so live tracking uses only the measured markers, ignores unknown and misread IDs and reads fewer detector codes; Unlock opens it again. `arail-survey` writes locked layouts (`--unlocked` to skip).
- **Moving markers** (`markers.moving`, Build → Marker map → Moving markers, `arail-survey --moving`): markers on vehicles are never part of the map; the tracker reports where they are (`tracker.state.moving`).
- Stop boards: one board per stop (both sides of a bus stop together), a small badge when the stop is small on the screen, the next bus of every line at a terminal; the Stops panel names the sides of a stop *Stop A* and *Stop B*.
- Example layouts: a small town with streets, two bus lines, houses, people and cars on virtual table modules in front of the EBL table, and a table module with two streets, a bus line and a few houses in front of the synthetic layout.
- Plugin API: the CD colours and font (`CD`, `CD_LIGHT`, `OVERLAY`, `FONT`, `grey`); `BuildingBase` and `BuildingModel` for building types; day/night drawing (`view.night`, `view.dim`, `emissive`, `view.glow`, `view.lightPool`) and virtual cameras (`view.virtual`, `view.showsReal`, the `pose` option); `world.clock`, `world.setTime`, `world.network()`, `world.transit`, `world.occupancy`; handing people over at stops (`enter`, `alight`, `passenger.*` events), `drawPerson`, `statusLines`, `boardStatus`; object hooks `snapPoint`, `duplicateOffset`, `problems` and `static background`; placements `rect` and `stops`; events `clock.day` and `clock.set`.
- Documentation: [Day and night](docs/day-and-night.md), [Streets, bus lines and road traffic](docs/streets-and-buses.md), [Lab session](docs/lab-session.md); all other guides updated.

### Changed

- The app follows the corporate design of the Chair of Railway Operations, TU Dresden: Türkis app bar with the chair's logo, Noto Sans, Orange for pressed and active things, Rot for disruptions, Dunkelblau boards, and a Dunkelblau dark mode. The project website and the marker sheets keep their blue design.
- Colours drawn over the layout follow the CD too: mood Rot → Gelb → Türkis, selection and placing preview Orange, markers used for the pose light Türkis and the others Orange, virtual trains Türkis, buses Gelb, disruption areas Rot.
- Buildings are grey: the generic building's default colours are `#f2f2f2` and `#a6a6a6` (colours set in layouts are kept), and it has a `use` for the town.
- `road` objects are now labelled "Street" and form the road network; the old kind `road` still loads and means `street`.
- With fewer detector codes (a locked map) more bit errors are corrected, but never so many that chance matches become more likely than with 50 codes.
- The EBL example layout: the coloured village on the real table is replaced by the town on table modules in front of it; it uses the built-in road traffic instead of the `road-traffic` plugin. Both examples have an orthophoto.
- Tracks are drawn in the flyover (ballast, sleepers, rails) where the orthophoto does not show them.
- Labels of things far outside the picture are no longer pulled to its edge.

### Fixed

- Marker detection: with a single code (`markers.codes: 1`) any pattern was read as marker 0; for each ID the first matching candidate was taken instead of the one with the fewest bit errors.
- Mistyped building sizes (e.g. a width of 1e6 m) froze the app; sizes now stay within the ranges of their parameters.
- Overlapping roads were drawn darker where they overlap.
- The hidden file inputs made the page much taller than the Build panel.
- Keyboard focus was invisible on the buttons that open files (Take photo, Record video, Open file, Load calibration, Import layout, Survey a video).
- While placing, the placing bar covered the Flyover, Freeze and Full screen buttons; it now sits above the stage buttons (and beside the flyover's camera buttons).
- The list of example layouts showed "Layouts…" but was named "Example" for screen readers and speech input; it is named "Layouts" now.

## [0.1.0] – 2026-09-30

First open-source version, built from the "Bahnsteig-AR" prototype (Python + browser, German), which is kept in the git history.

### Added

- Web app (`web/app`): photo, video and live camera sources; editor for placing, moving and configuring objects; simulation, disruption and control-system panels; import/export of layouts; recording of the stage as video.
- Framework (`web/arail`) as ES modules without a build step, usable in the browser and in Node.js.
- Marker map with automatic survey: markers anywhere on the layout, positions measured from the images; one least-squares pose from all visible markers; focal length estimate; optional lens-distortion calibration.
- Marker detection on top of js-aruco2 with sub-pixel corners, centre-of-cell sampling and no dropping of nearby candidates (finds small, steeply viewed markers: 301 of 302 on the synthetic test path, 235 with js-aruco2's candidate filter); corner order matches OpenCV for all seven supported dictionaries.
- Object types: platform, bus terminal, building, tree, forest, landscape area, road, track, label. Plugin API for object types, simulations, disruption types and vehicle kinds; example plugins (windmill, road traffic).
- Services: timetable per platform track and bus bay, manual calls, arrival/departure animations of trains and buses.
- Passenger simulation (example) for all stop areas, with moods, boarding and alighting at doors.
- Disruptions: delay, cancellations, closure, rail replacement bus, crowd surge, signal failure; scripted scenarios.
- Control-system interface: feed protocol `arail-feed/1`, WebSocket client, in-browser simulated control system; Python bridge with simulator, replay and TCP JSON-lines adapters and an adapter template.
- Printable marker sheets with a scale check bar.
- Python tools: camera calibration with markers (JSON output for the app), synthetic test scenes.
- Tests (node:test, pytest, Playwright with accessibility checks), CI and GitHub Pages deployment; documentation.

### Changed compared with the prototype

- English throughout.
- One common layout frame for all objects instead of per-platform marker pairs.
- The Python desktop viewer was replaced by the browser app; calibration and synthetic scenes remain as Python tools.
