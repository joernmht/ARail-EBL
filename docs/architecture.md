# Architecture

ARail is a browser application without a build step. The framework (`web/arail/`) is a set of ES modules that also run in Node.js, which is how most of it is tested; it never touches the DOM and is deterministic (seeded random numbers). The app (`web/app/`) is the user interface. Python (`tools/`) provides the control-system bridge, camera calibration, the lab survey and synthetic test scenes.

## Data flow per frame

The app has two modes. Over the **camera image** the markers in each frame give the camera pose; in the **flyover** a virtual camera gives it, and no video is processed.

```
camera mode:                                           flyover mode:
camera frame ──> MarkerDetector ──> marker corners     FlyCamera (orbit: target, distance, yaw, pitch)
                                        │                    │
     MarkerMap <──> PlaneTracker ──> H layout→image          └──> H = K [r1 r2 t] and the pose
                                        │                                │
                                        └───────────> app.pose() <───────┘
                                                          │
World.step(dt): clock → scenarios → disruptions → services → transit → objects → simulations
                                                          │
View (camera, H; night from the clock; virtual in the flyover)
   flyover only: sky and floor, default table, orthophoto, grid, marker stickers
World.draw(View): objects → timetable vehicles → line buses → control-system trains → simulations → disruptions
   → sorted display list → canvas
```

The editor works in both modes through `app.pose()` and `app.eventToLayout()` (a pointer event → a point on the layout plane), so placing, selecting and dragging are the same on the camera image and in the flyover.

With rolling-stock markers (`markers.rolling`, model wagons of the [container terminal](container-terminal.md)) the camera mode reads a second marker family in the same pass:

```
camera frame ──> MarkerDetector.detectAll ──> markers ──> PlaneTracker.update ──> H (smoothed)
                                         └──> rolling ──> PlaneTracker.liftMarkers(rolling, camera, height) ──> tags on the deck plane
                                                                                                                    │
                                         TerminalSimulation.observe(tags, time) ──> RollingStock ──> model wagons W1, W2, …
```

The tags are lifted with the smoothed pose of the same frame, after `update`, so the wagons and their containers match what the `View` draws. The flyover processes no video: the model wagons keep their last pose there.

## Modules

| Module | Responsibility |
| --- | --- |
| `core/math.js` | vectors, 2D poses, linear solver, homographies (exact and normalised least squares), polygons, polylines, seeded RNG |
| `core/geometry.js` | marker geometry without calibration: relative marker pose, focal length from a homography, camera pose of the plane, the camera centre and the homography of a plane above the layout |
| `core/camera.js` | pinhole camera with estimated, manual or calibrated intrinsics and OpenCV lens distortion |
| `core/detector.js` | marker detection on top of js-aruco2: sub-pixel corners, centre-of-cell bit sampling, error correction per code count, dictionary voting; the rolling-stock family in the same pass (`detectAll`) |
| `core/tracker.js` | `MarkerMap` (marker poses in the layout frame; locked and moving markers) and `PlaneTracker` (survey, pose, smoothing, hold, moving markers, rolling-stock tags lifted to their height) |
| `core/flycam.js` | the flyover's virtual orbit camera: homography and pose for the `View`, orbit, pan, zoom, twist, fit, plan view; grid lines and snapping |
| `core/world.js` | the loaded layout: objects, simulations, services, bus lines, disruptions, scenarios, trains, the clock; `step` and `draw` |
| `core/clock.js` | the fast clock: time of day, daylight, demand profiles over the day |
| `core/layout.js`, `core/anchors.js` | layout files (defaults, validation, `grid`, `view.ortho`, `markers.rolling`, the settings check of simulations), marker-relative points |
| `core/object.js`, `objects/*` | `LayoutObject` and the built-in object types |
| `objects/building-kit.js`, `objects/houses.js`, `objects/building.js` | `BuildingBase` and `BuildingModel` (white-model look, lit windows, level of detail) and the house types |
| `objects/tabletop.js` | table modules, the default table of the flyover |
| `core/stops.js` | stop areas and docks, the common interface of stops |
| `core/services.js`, `core/vehicles.js` | timetable, vehicle life cycle, drawing trains and buses |
| `core/network.js`, `objects/road.js` | streets and the road network: junctions, places, routing, sidewalks and lanes |
| `core/transit.js`, `objects/bus-stop.js`, `objects/bus-line.js`, `objects/signs.js` | bus lines: routes through the stops, dispatching, driving and stopping buses, stop signs |
| `core/disruptions.js`, `core/scenarios.js` | disruption types and effects, scripted timelines |
| `core/trains.js`, `feeds/*` | control-system feed: protocol parsing, arrival detection, WebSocket client, in-browser simulator |
| `core/view.js` | projection, display list, primitives (polygons, prisms, faces, labels, lights), day/night lighting |
| `core/colors.js` | the corporate-design colours (`CD`, `CD_LIGHT`, `OVERLAY`, `FONT`), the palette of the built-in objects, colour helpers |
| `core/registry.js`, `core/events.js`, `core/simulation.js` | extension points, event bus, base class of simulations |
| `sims/passengers.js` | the passenger simulation at stops; hand-over of other simulations' people; boards |
| `sims/town.js` | the town: residents' daily routines on foot, by bus and by train |
| `sims/traffic.js` | cars on the road network |
| `terminal/model.js` | the container terminal's rules: container sizes, check digits, carrier types (wagons, truck, yard block, barge), the inventory with its stacking rules and reservations |
| `terminal/objects.js` | the infrastructure objects: container yard block, gantry crane, truck lane, quay, reach stacker |
| `terminal/operations.js`, `terminal/handlers.js`, `terminal/visits.js`, `terminal/movers.js` | `TerminalSimulation`: requests, moves and their assignment, cranes and reach stackers, trains, trucks and barges on their paths, loading, the start state, validation, scenario requests |
| `terminal/rolling.js` | model wagons from rolling-stock tags: tag IDs, fusion, smoothing, snapping, states |
| `terminal/draw.js`, `terminal/types.js` | drawing containers, wagons, trucks, barges, cranes and the ground; picking boxes; event names and shared types |
| `ops/config.js`, `ops/util.js` | rail operations: defaults, the network from the platforms, presets of setups and stress tests, normalization and validation; working hours, the event queue, seeded random streams |
| `ops/timetable.js`, `ops/fleet.js`, `ops/crew.js` | trips and rotations; units, maintenance counters, wear and the failure model; duties (working-time rules), stand-by and the staff |
| `ops/engine.js`, `ops/crewdesk.js`, `ops/contracts.js` | `OpsEngine`, the discrete-event simulation: dispatching, failures, the maintenance planning and the workshop (ECM functions 1–4), messages between parties; the roster, absences, the way to work and the dispatcher; the penalty ledger |
| `ops/experiment.js` | key figures, runs of setups under stress tests (`runOne`, `runExperiment`), summaries, CSV |
| `ops/simulation.js`, `ops/depot.js`, `ops/disruptions.js` | `OperationsSimulation`: the engine on the world's clock, trains at the platforms (docks in mode `plan`), boards, crews walking; the depot object; the disruption types |
| `app/app.js`, `app/ui.js` | sources, frame loop, HUD, recording; small DOM helpers |
| `app/editor.js`, `app/panels.js` | the Build panel (placing, inspector, marker map); the View, Simulate, Disruptions and Control panels |
| `app/flyover.js` | the flyover: virtual camera, input, background, orthophoto, grid, markers |
| `app/survey.js` | Build → Marker map → Survey a video |
| `app/terminal.js` | the Terminal panel and picking containers and places on the stage |
| `app/operations.js` | the Operations panel: the day, fleet, workshop, crews, penalties; comparisons of setups in the page |
| `markers/markers.js`, `markers/deck-cards.js` | the marker sheet page; deck cards for model wagons (geometry and SVG, testable in Node) |
| `tools/arail_tools/` | `bridge/` (control-system bridge and adapters), `calibrate.py`, `survey.py` (`arail-survey`), `synthetic.py`, `fixtures.py` |

## Coordinate systems

| Frame | Units | Used for |
| --- | --- | --- |
| image | pixels of the displayed frame | detections, drawing |
| marker | mm, x right, y up as printed, origin at the marker centre | marker homographies |
| layout | mm on the layout plane, z up; origin and axes of the origin marker | positions of markers and objects |
| building | prototype metres: x along the building, y across (front = −y), z up | `BuildingModel` |
| stop area | prototype metres: `s` along, `t` across (+ = left) | passengers, vehicles |
| camera | mm, z forward | projection |

Model millimetres and prototype metres are related by the layout's `scale` (1 m prototype = 1000/87 mm in H0).

## Tracking without calibration

Each detected marker gives a homography *H* from its own plane (mm) to the image. Three results make calibration boards unnecessary:

**Relative position of two markers** (`relativeMarkerPose`). Along the image line through both marker centres, the perspective map is a 1D projectivity. For such a map the true distance between the centres is

  distance = pixel distance / √(s<sub>a</sub> · s<sub>b</sub>),

where s<sub>a</sub>, s<sub>b</sub> are the local scales (pixels per mm along that line) at both markers, taken from the Jacobians of their homographies. Only the well-determined local geometry of each marker enters, not an extrapolation of one small marker over the whole layout. The directions of the line in each marker's frame give the relative rotation.

**Survey** (`PlaneTracker._survey`). An unknown marker seen together with known ones gets its pose from each known marker via the relation above, weighted by 1/(d² + (5·size)²) because errors grow with the distance d. Estimates are averaged over frames (three frames before a marker is used in video, one frame in a photo). The first marker seen (or the configured origin marker) defines the layout frame. A *locked* map (`markers.locked`, Keep positions) is complete: nothing is surveyed, and markers that are not in it are ignored. *Moving* markers (`markers.moving`, on vehicles) are never surveyed nor used for the pose; `state.moving` reports their image corners and, with a pose, where their centre is seen on the layout plane and their heading (a marker above the plane appears shifted away from the camera).

**Pose** (`PlaneTracker._estimate`). The corners of all visible known markers give one least-squares homography layout→image (normalised DLT). With three or more markers, a marker whose mean reprojection error exceeds 20 % of its edge length (at least 3 px) is dropped as an outlier. A smoothing step blends the new homography with the previous one at the corners of the visible region: small changes (jitter) are damped, large changes (camera motion) are followed at once. If no marker is visible, the last pose is held for 1.5 s.

**Focal length** (`focalFromHomography`). With square pixels and the principal point at the image centre, the two rotation columns of *K⁻¹H* must be orthogonal and of equal length, which gives one estimate of *f* per frame. It is only taken when three or more markers spread over at least 40 mm in their thinnest direction and the plane is tilted 15–80° against the image; the median of the latest 600 estimates is used.

**Camera pose** (`poseFromHomography`). *K⁻¹H* scaled to unit column length gives the plane axes and origin in camera coordinates; their cross product is the plane normal. A point (x, y, z) above the layout is at x·a₁ + y·a₂ + a₃ + z·n. This assumes that the layout origin is in front of the camera, which is always true for a real camera looking at the markers; the flyover's camera can have the origin behind it, so it hands its pose to the `View` directly.

**Virtual camera** (`FlyCamera`). An orbit camera around a target point on the layout plane (yaw, pitch from 8° to 90° = plan view, distance, field of view). Its image is described like a real camera's: H = K [r₁ r₂ t] with the intrinsics K of a pinhole camera of focal length *f*, so the `View`, the editor and everything else work unchanged with a `Camera` of that focal length.

Measured accuracy (automated tests, synthetic H0 scene with known camera, 960×540 video): platform corners within 1 px (median) and 1.8 px (maximum) with a map surveyed from scratch; focal length within 0.3 %; surveyed marker positions within 5 mm over 700 mm. The offline survey (`arail-survey`, a bundle adjustment of all marker poses and one homography per frame) places the markers of the synthetic test video within 2 mm and 0.5°.

## Marker detection

js-aruco2 finds candidate quadrilaterals (adaptive threshold, contours). ARail then

1. keeps all candidates. js-aruco2 would drop the smaller of two nearby outlines, but for small markers the outline of the white paper border lies within a few pixels of the black square, so the marker itself would be dropped;
2. refines the corners to sub-pixel accuracy by fitting lines to grey-value edges;
3. samples the centre of every code cell (3×3 samples per cell, margins ignored) instead of counting whole cells, and thresholds with Otsu over the cell means;
4. checks the black border, decodes against the first *N* codes of the dictionary (accepting only bit errors that can be corrected safely) and keeps one detection per ID, the one read with the fewest bit errors. A locked marker map needs only the codes up to its highest ID; for fewer than 50 codes the codes are compared in all four orientations, and no more bit errors are accepted than keep chance matches as rare as with 50 codes (`acceptedBitErrors`).

Steps 1 and 3 make small and steeply viewed markers decodable. On the synthetic camera path, 301 of 302 visible markers are found (235 when nearby candidates are dropped as js-aruco2 does), without false detections; on the lab photo a marker of 28×37 px seen at a grazing angle is found; on the lab video the detector finds about as many markers as OpenCV. The corner order (and so the marker orientation) matches OpenCV for all dictionaries; js-aruco2's AprilTag codes are rotated by 180°, which ARail corrects.

**Rolling-stock tags** (`markers.rolling`, option `rolling` of the detector) are read from the same candidates: the cells are sampled for both families' grid sizes, every candidate is decoded in both, and a candidate that reads in both keeps the reading with the smaller share of bit errors (on a tie, the layout marker). Tags correct at most `max_bit_errors` (3) bit errors. In automatic mode the rolling family is not a candidate for the layout's dictionary, and the votes count only the reads that are left after this comparison, so tags can never decide the layout's marker type. Without `rolling` everything, votes included, is as before. Lifted to their height (`PlaneTracker.liftMarkers`), tags whose edge is not within ±15 % of their size are ignored by the terminal.

## Simulation

`World.step(dtReal)` first keeps the service docks in line with the stop areas and moves the trains of the control system (in real time, also while paused). Unless the simulation is paused, it then advances simulated time: `dt` = real time (at most 0.1 s per frame) × speed, in sub-steps of at most 0.25 s. Each sub-step runs, in this order:

1. the **clock** (`world.clock.advance`; event `clock.day` at midnight),
2. **scenario** steps that are due,
3. the expiry of **disruptions**,
4. the **services**: timetable trains and buses at platforms and bus bays, and their life cycles,
5. the **transit**: line buses dispatched, driving, stopping and dwelling at their stops,
6. **object** animations (`update(dt)`),
7. the **simulations**, in the order of the layout's list: usually passengers, town and traffic.

Services, line buses and simulations communicate through **events** (`vehicle.*`, `passenger.*`, `clock.*`) and the **effects** of disruptions, so each part can be replaced or extended independently. The time of day changes the demand: timetables, bus lines, road traffic and random passengers follow `clock.demand(kind)`.

The **passenger simulation** is a social-force crowd model per stop area: people are attracted to their target (entrance, waiting spot, door, exit) and repelled by neighbours closer than 0.6 m; local density slows them down and worsens their mood. It also takes the people of other simulations at stops (`enter`, `alight`) and reports what happens to them (`passenger.boarded`, `passenger.exited`).

The **town simulation** makes daily plans for the residents of the residential buildings (work, school, shopping, home, the train), walks them over the sidewalks of the road network (`world.network()`), chooses bus connections (`world.transit.connections`), hands them to the passenger simulation at stops, puts them into the `riders` of line buses and counts the people in each building (`world.occupancy`). Setting the clock (`clock.set`) places everybody anew.

The **container terminal** (`terminal/operations.js`) re-reads its infrastructure whenever objects, the marker map or the scale change, keeping the state of its cranes and reach stackers by object id. Each step it moves its trains, barges and trucks along their paths (one 1-D mover each), starts queued moves on free machines whose carriers are ready, and advances the machines through their phases with trapezoidal speed profiles. Its random numbers come from a stream of their own (`createRng(hash(seed + ":terminal"))`), so a terminal changes nothing in the other simulations. Runtime state stays out of object specs and out of the layout file.

The **rail operations** (`ops/`) are a discrete-event simulation of their own (`OpsEngine`, minutes since day 0, a heap of events). `OperationsSimulation` runs the engine up to the world's clock in each step and shows what it does: its trains at the platforms (the services' docks of its stations are in mode `plan`; it calls its vehicles with `services.call(dock, {source: "plan"})` and lets them leave), the boards (`statusLines`), crews walking between their houses and the depot over the road network, and the depot's units. The engine is built anew when its stations, lines or settings change, and runs the days before the clock's time quietly; setting the clock back moves it on to the next day (it never runs backwards). Its random numbers are streams keyed by what they decide (a unit and a trip, a person and a day), so the same seed gives the same failures and sick spells in every setup of a comparison.

The **road network** is built lazily from the streets, building entrances, stop access points and bus lanes, and cached until objects (`world.objectsVersion`), the marker map or the scale change. The **transit** and the **traffic** simulation drive their vehicles along driving lines on the right lane, keep their distance to each other (`roadUsers()`) and give way at junctions.

## Rendering

The `View` projects layout points with the camera pose and queues drawing operations in three layers: ground (flat things, in order), solids (3D, painter's algorithm by depth, back faces culled, faces shaded by a fixed light direction) and overlays (labels, placed so they do not overlap). Everything is drawn with the Canvas 2D API over the camera image, or, in the flyover, over a drawn background.

**Night lighting.** `World.draw` sets `view.night` from the clock (0 = day … 1 = night; 0 while the lighting is switched off). At night `render()` first darkens the whole background (camera image or flyover) with a Dunkelblau veil, and every ground and solid colour is darkened towards Dunkelblau when it is drawn. Colours marked `emissive` (lit windows, lamps, the windows of trains and buses, headlights) keep their brightness; `glow()` and `lightPool()` add light only at night. Overlays (labels, the editor's markings) are never darkened. Buildings light a share of their windows that follows their occupancy and the time of day; a stable hash per window decides which ones.

**Level of detail.** The whole world is drawn every frame, also on phones: buildings leave out windows and fine details that would be smaller than about 1.5 px (0.8 px) on the screen and skip groups that are off screen; streets draw their pieces as one path per layer; stop boards shrink to a badge when the stop is shorter than 60 px on the screen. Polygons, lines, faces, lights and trees that lie entirely outside the image are not queued at all (over the camera image of the EBL example most of the town on the table extensions is outside the picture). Each queued drawing starts with the canvas state from before (a save/restore around it), except the view's own "plain" drawings (polygons, lines and faces without a dash, people), which set everything they use: a run of them shares one save/restore. Night colours (`view.dim`) are remembered per view.

**Survey and caches.** Objects cache their geometry, and the world its stop areas and road network, until the marker map changes. While the map is surveyed (live camera or video, unlocked map), a marker seen in more than 10 frames is written into the map only every 8 frames, or at once when its estimate moved by more than 0.25 mm or 0.03° (`SURVEY_WRITE`); otherwise all of this would be worked out anew in every frame.

**Flyover.** The flyover draws the sky and the lab floor (with the horizon where the camera's pitch puts it), the default table or the real table modules, the orthophoto (`view.ortho`) split into affine pieces where perspective needs it (with mipmaps, cached while the camera stands still), the grid and the marker stickers, then the world with `view.virtual = true`: platforms, tracks and real tables draw their surfaces where the orthophoto does not show them. Flat polygons and lines are cut off at the camera's near plane, so a close camera looking along the table still sees them.

## Tests

| Suite | Checks |
| --- | --- |
| `tests/js/math.test.js` | linear algebra, homographies, poses, polygons, RNG, marker geometry, focal length, camera distortion |
| `tests/js/detector.test.js` | js-aruco2 vs OpenCV (IDs, corner order, printable bits) for 7 dictionaries; markers on the real lab photo; error correction with fewer codes; best match per ID |
| `tests/js/tracker.test.js` | survey from an empty map along a synthetic camera path with occlusions; accuracy thresholds above; locked maps, moving markers, detector codes; how often the survey writes into the map |
| `tests/js/world.test.js` | example layouts (also the lab town and the container terminal), round trips, passengers, disruptions, scenarios, control-system feed, plugins, locked and moving markers in layout files |
| `tests/js/services.test.js` | timetable intervals and holds, frequency 0, missing plugins, docks during a survey, feed edge cases, WebSocket reconnects |
| `tests/js/clock.test.js` | the fast clock, daylight, demand profiles, the night break of the timetable |
| `tests/js/handover.test.js` | handing agents to the passenger simulation: waiting, line filter, alighting, removal |
| `tests/js/town.test.js` | the town's daily routine, lit homes in the evening, setting the clock, reproducible runs, layouts without platforms, schools or shops |
| `tests/js/houses.test.js` | house types and the building kit: geometry, capacity, entrances, estate plots, JSON round trips, drawing by day and night |
| `tests/js/network.test.js` | road network: junctions (end to end, T, X), routing, places, bus lanes, sidewalk offsets, drawing, road traffic |
| `tests/js/transit.test.js` | bus stops and lines: stop geometry, routing, a bus serving every stop, boarding, managed docks, status texts, town people riding |
| `tests/js/lines.test.js` | bus lines over a day: lay-overs, bus counts, cars after edits, riders whose stop disappears, ring lines, boards and badges, commuters by bus, door side |
| `tests/js/flycam.test.js` | the flyover camera (projection, pose, navigation, fit), the grid, table modules, drawing for a virtual camera |
| `tests/js/design.test.js` | the corporate-design colours and font on the canvas, text contrast of the app's theme in light and dark mode |
| `tests/js/view.test.js` | drawing without visible change: nothing queued outside the image, shared save/restores (a frame of the example town drawn both ways, operation by operation), night colours remembered per view, crowd forces |
| `tests/js/layout-rolling.test.js` | `markers.rolling` in layout files: defaults, round trips, validation messages; the `static validate` hook of simulations; the terminal example |
| `tests/js/rolling-markers.test.js` | both marker families in rasterised scenes: every ID in its own family, `detect()` unchanged without `rolling`, the bit-error cap, no vote for the rolling family; `cameraCentre`, `planeHomography`, `liftMarkers` within 1.5 mm |
| `tests/js/terminal-model.test.js` | check digits, stacking rules of every carrier type, lifting, free places, reservations, the inventory under random operations; the geometry of the infrastructure objects |
| `tests/js/terminal-ops.test.js` | moves between all kinds of carriers, refusals, waiting, departures, trucks (gate, leaving, never overlapping), crane phases and timing, cancelling, unload and load, scenario requests, determinism, isolation, round trips, reset, validation, model wagons, edits of the infrastructure |
| `tests/js/terminal-draw.test.js` | drawing every terminal part by day and night, container colours, label contrast, culling, level of detail, picking, sort keys and the drawing budget of the example |
| `tests/js/terminal-rolling.test.js`, `deck-cards.test.js` | model wagons from 1, 2 and 3 tags, the size check, outliers, states over time, snapping; deck-card geometry and SVG |
| `tests/js/ops-engine.test.js` | rail operations without the world: settings and validation, timetable and rotations, duties and the working-time rules, four weeks of operation, determinism, the failure hazard, maintenance limits, distributed vs integrated ECM, the penalty ledger, staff sizing, sick calls and stand-by, rest time, the way to work, stress tests, comparisons and CSV |
| `tests/js/ops-world.test.js` | rail operations in the world: the example, docks in mode `plan`, trains at the platforms with their labels, boards, crews walking, the depot drawing, the disruption types, closed platforms, the clock, one per layout |
| `tests/python/test_survey.py` | `arail-survey`: corner refinement, adjustment, synthetic video within 2 mm / 0.5°, layout priors, moved markers, scale, orthophoto, the lab photo, the command line |
| `tests/python/test_bridge.py`, `test_calibration.py`, `test_synthetic.py` | bridge protocol, adapters and WebSocket server end to end; calibration; the synthetic scene |
| `tests/e2e/app.spec.js` | the app: tracking the examples, building, disruptions, control system, robustness of the panels |
| `tests/e2e/flyover.spec.js` | the flyover: drawing, navigation, table modules, snapping, the View panel, orthophoto, keyboard |
| `tests/e2e/houses.spec.js`, `streets.spec.js` | placing house types and estates; streets, bus stops, bus lines and the Stops board |
| `tests/e2e/marker-map.spec.js`, `survey.spec.js` | Keep positions, Unlock, moving markers; surveying a video in the app |
| `tests/e2e/design.spec.js`, `a11y.spec.js`, `site.spec.js` | the corporate design and the blue website; accessibility (axe, light and dark mode; also placing, the inspectors of the new object types, a locked map, the town, a phone screen, the Terminal and Operations panels); the project page, marker sheets and deck cards |
| `tests/e2e/terminal.spec.js` | the Terminal tab: the example in the flyover, moves from the panel and on the stage, trains, trucks, the start state, the scenario |
| `tests/e2e/operations.spec.js` | the Operations tab: its views and short-term changes, trains at the platforms and boards, a comparison with CSV and the wide panel, adding operations to a layout, the tabs on a phone and with the keyboard, the disruption types |
| `tests/e2e/keyboard.spec.js` | keyboard only: switching panels, flying, placing an object in the flyover, setting the time; visible focus on the file buttons; stage buttons not hidden by the placing bar |

The JavaScript tests use images and a short video generated by `python -m arail_tools.fixtures` (`npm run fixtures`: synthetic scene rendered with OpenCV, marker strips, the lab photo, `synthetic-survey.webm`). The browser tests start their own server; `ARAIL_PORT` chooses its port (default 8123).
