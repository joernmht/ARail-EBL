# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

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
- Tests (node:test, pytest, Playwright), CI and GitHub Pages deployment; documentation.

### Changed compared with the prototype

- English throughout.
- One common layout frame for all objects instead of per-platform marker pairs.
- The Python desktop viewer was replaced by the browser app; calibration and synthetic scenes remain as Python tools.
