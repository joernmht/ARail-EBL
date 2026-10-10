# Architecture

ARail is a browser application without a build step. The framework (`web/arail/`) is a set of ES modules that also run in Node.js, which is how most of it is tested; it never touches the DOM and is deterministic (seeded random numbers). The app (`web/app/`) is the user interface. Python (`tools/`) provides the control-system bridge, camera calibration, the lab survey and synthetic test scenes.

The whole architecture is also drawn in UML on the **[architecture page](https://joernmht.github.io/ARail-EBL/architecture/)** (`web/architecture/`): the packages and their dependencies, the data flow, and for every model its classes, activity diagrams, settings, events and rules. It is drawn from `web/architecture/model.js` and `web/architecture/models/*.js`, which `tests/js/architecture.test.js` checks against the code; this text is cross-checked by hand whenever the code changes (see [CONTRIBUTING.md](../CONTRIBUTING.md#keeping-the-architecture-page-true)).

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
World.step(dt): docks, control-system trains (also paused) │ clock → scenarios → disruptions → services → transit → objects → simulations
                                                          │
View (camera, H; night from the clock; virtual in the flyover)
   flyover only: sky and floor, default table, orthophoto, grid, marker stickers
World.draw(View): objects → timetable vehicles → line buses → control-system trains → simulations → disruptions
   → sorted display list → canvas
```

The editor works in both modes through `app.pose()` and `app.eventToLayout()` (a pointer event → a point on the layout plane), so placing, selecting and dragging are the same on the camera image and in the flyover. Tooltips and info cards (`app/inspect.js`) use the view of the last frame drawn: `World.pick` projects the box of every person and vehicle and finds what is at the pixel, else a layout object (`core/pick.js`).

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
| `core/people.js` | the people of all simulations (town residents, crews, maintenance staff): `Person`, `Population` (ids, bird names in the languages of people living in Germany, random streams per person), homes (`pickHome`, `residentialBuildings`) |
| `core/layers.js` | layers of a layout file (the app's modules): composing the layers that are on, splitting edits back, simulation patches, exclusive layers and layouts of their own, the choice of modules |
| `core/layout.js`, `core/anchors.js` | layout files (defaults, validation, `grid`, `view.ortho`, `markers.rolling`, the settings check of simulations), marker-relative points |
| `core/object.js`, `objects/*` | `LayoutObject` and the built-in object types |
| `objects/building-kit.js`, `objects/houses.js`, `objects/building.js` | `BuildingBase` and `BuildingModel` (white-model look, lit windows, level of detail) and the house types |
| `objects/tabletop.js` | table modules, the default table of the flyover |
| `core/stops.js` | stop areas and docks, the common interface of stops |
| `core/services.js`, `core/vehicles.js` | timetable, vehicle life cycle, drawing trains and buses |
| `core/network.js`, `objects/road.js` | streets and the road network: junctions, places, routing, walks on the sidewalks around tracks, lanes |
| `core/transit.js`, `objects/bus-stop.js`, `objects/bus-line.js`, `objects/signs.js` | bus lines: routes through the stops, dispatching, driving and stopping buses, stop signs |
| `core/disruptions.js`, `core/scenarios.js` | disruption types and effects, scripted timelines |
| `core/trains.js`, `feeds/*` | control-system feed: protocol parsing, arrival detection, WebSocket client, in-browser simulator |
| `core/view.js` | projection, display list, primitives (polygons, prisms, faces, labels, lights), day/night lighting |
| `core/simple.js` | the simple view (Map, 2.5D): `SimpleView` draws objects as flat footprints and moving things as plain blocks |
| `core/colors.js` | the corporate-design colours (`CD`, `CD_LIGHT`, `OVERLAY`, `FONT`), the palette of the built-in objects, colour helpers |
| `core/registry.js`, `core/events.js`, `core/simulation.js` | extension points, event bus, base class of simulations |
| `core/pick.js` | pointing at things: what is under an image pixel (what moves, from the managers' and simulations' `pickables`, found in its projected box; else a layout object, also on the walls of tall ones) and its info card (`card`) |
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
| `infra/catalog.js`, `infra/config.js` | infrastructure: condition grades, disciplines, asset types (IFC 4.3 class, service life, costs, faults, inspection), interlocking generations, inspection methods, measures; settings, the example network, scenarios, validation |
| `infra/network.js`, `infra/assets.js`, `infra/export.js` | lines with km and alignment, the layout in the network, the georeference (UTM → WGS 84); assets with their wear, faults and what is known of them, the generated network; asset records and GeoJSON |
| `infra/staff.js`, `infra/engine.js` | the staff in shifts and on call; `InfraEngine`, the discrete-event simulation over years: wear, faults, report paths, dispatch, planned work, inspections, drones, measurement trains, proposals, decisions of the roles, money, the EBA audit, years and the score, recorded actions |
| `infra/projects.js`, `infra/factory.js` | projects through the HOAI phases with funding, the crossing agreement, planning approval, procurement and bids, possessions, acceptance and commissioning; the level crossing plant |
| `infra/simulation.js`, `infra/objects.js`, `infra/disruptions.js` | `InfrastructureSimulation`: the engine on the world's clock, the layout's assets, their state drawn, vans over the streets, drones, faults at the station's platforms; the asset objects, the maintenance base and the plant; the disruption types |
| `journeys/rail.js` | the journeys' trains: the timetable of the stations and lines (with `ops/`' `normalizeOps` and `tripTemplates`) and its trains at the platforms (planner of the services, docks in mode `plan`), or the trips of the rail operations when they run |
| `journeys/planner.js` | travel plans with transfers: walks over the sidewalks, bus connections of the transit, trains with one change; the times in clock minutes |
| `journeys/simulation.js` | `JourneysSimulation`: travellers following their plans through the passenger hand-over, missed and cancelled trains, the log and the results, validation |
| `app/app.js`, `app/ui.js` | sources, frame loop, HUD, recording; small DOM helpers |
| `app/editor.js`, `app/panels.js` | the Build panel (placing, inspector, marker map); the View (with the modules), Settings (simulation, control system) and Disruptions panels |
| `app/inspect.js` | hover and click: the tooltip of what the mouse points at, the info card of what was tapped, their outlines on the stage, Enter at the flyover's cross |
| `app/flyover.js` | the flyover: virtual camera, input, background, orthophoto, grid, markers |
| `app/survey.js` | Build → Marker map → Survey a video |
| `app/terminal.js` | the Terminal panel and picking containers and places on the stage |
| `app/operations.js` | the Operations panel: the day, fleet, workshop, crews, penalties; comparisons of setups in the page |
| `app/infra.js` | the Infrastructure panel: roles, running fast, overview, line map, assets and their records, decisions, projects, staff, results, saving games |
| `app/journeys.js` | the Journeys panel: making a traveller, the travel plans, the travellers and their logs, results and CSV |
| `index.js` | the framework's API: `registerBuiltins` (the core types, then those of the terminal, the operations, the infrastructure and the journeys), the default `registry`, `createWorld`, `loadPlugins` |
| `architecture/` | this architecture as data (`model.js`, `models/*.js`) and its UML diagrams (`uml.js`, laid out with dagre) on the architecture page |
| `markers/markers.js`, `markers/deck-cards.js` | the marker sheet page; deck cards for model wagons (geometry and SVG, testable in Node) |
| `tools/arail_tools/` | `bridge/` (control-system bridge and adapters), `calibrate.py`, `survey.py` (`arail-survey`), `synthetic.py`, `fixtures.py`, `stabilize.py` and `compose.py` (videos, see [Videos of the lab](videos.md)) |
| `tools/video/` | `render.mjs` (the app rendered frame by frame after a plan, in Chromium), `sky.js` (the town video's sky), the plans of the project page's videos |

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

**Survey** (`PlaneTracker._survey`). An unknown marker seen together with known ones gets its pose from each known marker via the relation above, weighted by 1/(d² + (5·size)²) because errors grow with the distance d. Estimates are averaged over frames (three frames before a marker is used in video, one frame in a photo). The marker with the lowest ID in the first frame with markers (or the configured origin marker) defines the layout frame. A *locked* map (`markers.locked`, Keep positions) is complete: nothing is surveyed, and markers that are not in it are ignored. *Moving* markers (`markers.moving`, on vehicles) are never surveyed nor used for the pose; `state.moving` reports their image corners and, with a pose, where their centre is seen on the layout plane and their heading (a marker above the plane appears shifted away from the camera).

**Pose** (`PlaneTracker._estimate`). The corners of all visible known markers give one least-squares homography layout→image (normalised DLT). With three or more markers, a marker whose mean reprojection error exceeds 20 % of its edge length (at least 3 px) is dropped as an outlier. A smoothing step blends the new homography with the previous one at the corners of the visible region: small changes (jitter) are damped, large changes (camera motion) are followed at once. If no marker is visible, the last pose is held for 1.5 s. How the project page's videos are stabilized further, offline, with the picture's own motion, and which of those steps could run live: [Videos of the lab](videos.md).

**Focal length** (`focalFromHomography`). With square pixels and the principal point at the image centre, the two rotation columns of *K⁻¹H* must be orthogonal and of equal length, which gives one estimate of *f* per frame. It is only taken when three or more markers spread over at least 40 mm in their thinnest direction and the plane is tilted 15–80° against the image; the median of the latest 600 estimates is used. Estimates outside 0.25–5 times the image width are dropped; a calibration or a focal length set by hand (View → Camera) is used instead of the estimate.

**Camera pose** (`poseFromHomography`). *K⁻¹H* scaled to unit column length gives the plane axes and origin in camera coordinates; their cross product is the plane normal. A point (x, y, z) above the layout is at x·a₁ + y·a₂ + a₃ + z·n. The scale's sign is chosen so that the layout lies in front of the camera where most of the picture shows it: a 3×3 grid of image points (corners, edge middles and the principal point) votes, since the plane point seen at pixel q, H⁻¹q, has the depth λ/w with w its third coordinate, and most of a picture of the layout lies below the plane's horizon. The layout origin itself may lie behind the camera: on a long layout filmed far away from marker 0 (the EBL table from the terminal to Bf Neustadt) an older rule, "the origin in front of the camera", flipped the pose, and nothing was drawn. The flyover's camera hands its pose to the `View` directly.

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

The **passenger simulation** is a social-force crowd model per stop area: people appear at an access point and are attracted to their target (a waiting spot, a door, an exit) and repelled by neighbours closer than 0.6 m; local density slows them down and worsens their mood. It also takes the people of other simulations at stops (`enter`, `alight`, `release`) and reports what happens to them (`passenger.boarded`, `passenger.exited`, `passenger.removed`).

The **town simulation** makes daily plans for the residents of the residential buildings (work, school, shopping, home, the train), walks them over the sidewalks of the road network (`world.network()`), chooses bus connections (`world.transit.connections`), hands them to the passenger simulation at stops, puts them into the `riders` of line buses and counts the people in each building (`world.occupancy`). Setting the clock (`clock.set`) places everybody anew.

The **container terminal** (`terminal/operations.js`) re-reads its infrastructure whenever objects, the marker map or the scale change, keeping the state of its cranes and reach stackers by object id. Each step it moves its trains, barges and trucks along their paths (one 1-D mover each), starts queued moves on free machines whose carriers are ready, and advances the machines through their phases (each phase lasts as long as a trapezoidal speed profile takes; the motion is eased with smoothstep). Its random numbers come from a stream of their own (`createRng(hashString(`${seed}:terminal`))`), so a terminal changes nothing in the other simulations. Runtime state stays out of object specs and out of the layout file.

The **rail operations** (`ops/`) are a discrete-event simulation of their own (`OpsEngine`, minutes since day 0, a heap of events). `OperationsSimulation` runs the engine up to the world's clock in each step and shows what it does: its trains at the platforms (the services' docks of its stations are in mode `plan`; it calls its vehicles with `services.call(dock, {source: "plan"})` and lets them leave), the boards (`statusLines`), crews walking between their houses and the depot over the road network, and the depot's units. The engine is built anew when its stations, lines or settings change, and runs the days before the clock's time quietly; setting the clock back moves it on to the next day (it never runs backwards). Its random numbers are streams keyed by what they decide (a unit and a trip, a person and a day), so the same seed gives the same failures and sick spells in every setup of a comparison.

The **infrastructure** (`infra/`) is a discrete-event simulation over years (minutes since 1 January of the start year). `InfrastructureSimulation` runs it with the world's clock (engine time = the clock's minutes plus an offset), or fast without the clock to the next decision of a student role or to the year's end, after which the clock shows the engine's time of day. Its assets on the layout come from the layout's objects (their positions give the km on the station's line and the place in the network); the drive to them is routed over the road network. Every action of a player goes through `act()` and is recorded: the engine is deterministic for a seed, so a game is saved as its actions and restored, or the engine rebuilt after an edit of the layout, by running them again. Its random numbers are streams keyed by what they decide (a day, for the wear and faults of all assets in turn; a project and a phase).

The **journeys** (`journeys/`) are travellers made by hand, each with a start, an aim, a departure time and a chosen travel plan (`Planner.plan`: walks, buses and trains with up to one change each, in clock minutes). The plan's walks use the road network; at a stop a traveller is handed to the passenger simulation with the line or the train it waits for (`enter` with `accept`), and on a bus it rides in the bus's `riders`. Its trains come from `TimetableRail`, a timetable of the module's stations and lines run on the world's clock (trains called with `services.call(dock, {source: "plan"})`, held and cancelled by the disruptions of their platform), or, when the rail operations run, from `OperationsRail`, a view of the operations' trips. A traveller whose train is gone or cancelled, or whose connection breaks, takes the next train of the same line; it keeps to the lines of its plan and does not plan anew. The module switches the other passengers and the town's residents off with *simulation patches* of its layer (`{"type": "passengers", "patch": true, "others": false}`): a patch changes the settings of the layout's own simulation of that type while the layer is on, and is taken off again when the layout is saved.

The **road network** is built lazily from the streets, building entrances, stop access points, the docks of bus stops and bus lanes, and cached until objects (`world.objectsVersion`), the marker map or the scale change. The **transit** and the **traffic** simulation drive their vehicles along driving lines on the right lane, keep their distance to each other (`roadUsers()`) and give way at junctions.

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
| `tests/js/network.test.js` | road network: junctions (end to end, T, X), routing, places, bus lanes, sidewalk offsets, walks on the sidewalks and around tracks, drawing, road traffic |
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
| `tests/js/infra-engine.test.js` | infrastructure without the world: grades, the wear law, asset types and IFC classes, settings and validation, km and the georeference, what is known of an asset, the shifts, the generated network, faults and their report paths, contractors, inspection plans and the audit, a renewal through the HOAI phases, upgrades and the benefit-cost ratio, level crossings with the crossing agreement and the plant, decisions of student roles, determinism and replaying a game, GeoJSON |
| `tests/js/infra-world.test.js` | infrastructure in the world: the example's assets on the layout, the clock, faults at the station holding the trains (also those of rail operations), the vans' routes, the disruption types, drawing, running fast, saving and restoring, adding it to a layout |
| `tests/js/ops-world.test.js` | rail operations in the world: the example, docks in mode `plan`, trains at the platforms with their labels, boards, crews walking, the depot drawing, the disruption types, closed platforms, the clock, one per layout |
| `tests/js/journeys.test.js` | journeys: the module of the lab example (the town at home, no other passengers, the trains to the timetable), travel plans with walks, buses and changes of trains, travellers on foot, by bus and by train out of and into the layout, a cancelled and a held train, saving and restoring, the rail operations' trains, a layout of its own, validation, one per layout |
| `tests/js/people.test.js` | people of all simulations: names (two birds of one language), stable for a seed, unique; simulations extend Person; homes on the layout, beyond it or away; crews from one population |
| `tests/js/simple.test.js`, `station.test.js` | the simple view (convex hulls, flat objects, blocks); the station building and the underpass by day and night |
| `tests/js/label-sheets.test.js` | label sheets on A4: one tag per container spot, centring, skipping and shifting, custom sheets |
| `tests/js/architecture.test.js` | the architecture page against the code: every file in a package and a model, the packages' dependencies are the imports, classes, attributes and operations with their parameters, the code named in activities and their structure, the event catalog, the registry, the settings of the simulations, the data flow |
| `tests/js/pick.test.js` | pointing at things: people, trains, buses and cars of the lab example found where they are seen, small objects before large ones, buildings on their walls, table modules at their edges, every card with a title and what the simulations add, keys that follow, the terminal's containers |
| `tests/js/layers.test.js` | layers (modules): composing and splitting layouts, simulation patches, exclusive layers and layouts of their own, switching modules, validation, the modules of the lab example |
| `tests/python/test_survey.py` | `arail-survey`: corner refinement, adjustment, synthetic video within 2 mm / 0.5°, layout priors, moved markers, scale, orthophoto, the lab photo, the command line |
| `tests/python/test_bridge.py`, `test_calibration.py`, `test_synthetic.py` | bridge protocol, adapters and WebSocket server end to end; calibration; the synthetic scene |
| `tests/python/test_stabilize.py` | videos: the picture's motion from a synthetic clip, the joined poses closer to the truth and slipping far less, markers that disagree, the command line; composing shots with crossfades, the bare picture and the loop, encoding |
| `tests/e2e/app.spec.js` | the app: tracking the examples, building, disruptions, control system, robustness of the panels |
| `tests/e2e/flyover.spec.js` | the flyover: drawing, navigation, table modules, snapping, the View panel, orthophoto, keyboard |
| `tests/e2e/houses.spec.js`, `streets.spec.js` | placing house types and estates; streets, bus stops, bus lines and the Stops board |
| `tests/e2e/marker-map.spec.js`, `survey.spec.js` | Keep positions, Unlock, moving markers; surveying a video in the app |
| `tests/e2e/design.spec.js`, `a11y.spec.js`, `site.spec.js` | the corporate design and the blue website; accessibility (axe, light and dark mode; also placing, the inspectors of the new object types, a locked map, the town, a phone screen, the Terminal, Operations, Infrastructure and Journeys panels, the modules); the project page, marker sheets and deck cards |
| `tests/e2e/terminal.spec.js` | the Terminal tab: the example in the flyover, moves from the panel and on the stage, trains, trucks, the start state, the scenario |
| `tests/e2e/infra.spec.js` | the Infrastructure tab: its views, roles and decisions, the line map and GeoJSON, a proposal, running fast, saving and restoring, a new game, a fault on the layout, adding it from Settings → Simulation, a phone |
| `tests/e2e/operations.spec.js` | the Operations tab: its views and short-term changes, trains at the platforms and boards, a comparison with CSV and the wide panel, adding operations to a layout, the tabs on a phone and with the keyboard, the disruption types |
| `tests/e2e/journeys.spec.js`, `modules.spec.js` | the Journeys tab: making travellers, choosing a plan, following a traveller, the results, adding journeys to another layout; the modules in the View panel: switching them, new objects in the chosen module, the terminal opening alone and back, the module links |
| `tests/e2e/simple.spec.js` | Map and 2.5D: the simple view from above and tilted, Build in the map |
| `tests/e2e/architecture.spec.js` | the architecture page: every diagram drawn without errors, the drop-downs, links to models, a phone, accessibility in light and dark mode |
| `tests/e2e/inspect.spec.js` | hover and click: the tooltip, the card of a train and a building, Escape, Build keeping its taps, the flyover's stop card, Enter at the cross, accessibility of the tooltip and the card |
| `tests/e2e/keyboard.spec.js` | keyboard only: switching panels, flying, placing an object in the flyover, setting the time; visible focus on the file buttons; stage buttons not hidden by the placing bar |

The JavaScript tests use images and a short video generated by `python -m arail_tools.fixtures` (`npm run fixtures`: synthetic scene rendered with OpenCV, marker strips, the lab photo, `synthetic-survey.webm`). The browser tests start their own server; `ARAIL_PORT` chooses its port (default 8123).
