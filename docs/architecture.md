# Architecture

ARail is a browser application without a build step. The framework (`web/arail/`) is a set of ES modules that also run in Node.js, which is how most of it is tested. Python (`tools/`) provides the control-system bridge, camera calibration and synthetic test scenes.

## Data flow per frame

```
camera frame ──> MarkerDetector ──> marker corners (px)
                                        │
                     MarkerMap <──> PlaneTracker ──> homography layout→image, focal length samples
                                        │
World.step(dt): scenarios → disruptions → services (vehicles) → objects → simulations
                                        │
World.draw(View): objects, vehicles, trains, simulations, disruption signs → sorted display list → canvas
```

## Modules

| Module | Responsibility |
| --- | --- |
| `core/math.js` | vectors, 2D poses, linear solver, homographies (exact and normalised least squares), polygons, polylines, seeded RNG |
| `core/geometry.js` | marker geometry without calibration: relative marker pose, focal length from a homography, camera pose of the plane |
| `core/camera.js` | pinhole camera with estimated, manual or calibrated intrinsics and OpenCV lens distortion |
| `core/detector.js` | marker detection on top of js-aruco2: sub-pixel corners, centre-of-cell bit sampling, dictionary voting |
| `core/tracker.js` | `MarkerMap` (marker poses in the layout frame) and `PlaneTracker` (survey, pose, smoothing, hold) |
| `core/world.js` | the loaded layout: objects, simulations, services, disruptions, scenarios, trains; `step` and `draw` |
| `core/object.js`, `objects/*` | `LayoutObject` and the built-in object types |
| `core/stops.js` | stop areas and docks, the common interface of stops |
| `core/services.js`, `core/vehicles.js` | timetable, vehicle life cycle, drawing trains and buses |
| `core/network.js`, `objects/road.js` | streets and the road network: junctions, places, routing, sidewalks and lanes |
| `core/transit.js`, `objects/bus-stop.js`, `objects/bus-line.js` | bus lines: routes through the stops, dispatching, driving and stopping buses |
| `core/disruptions.js`, `core/scenarios.js` | disruption types and effects, scripted timelines |
| `core/trains.js`, `feeds/*` | control-system feed: protocol parsing, arrival detection, WebSocket client, in-browser simulator |
| `core/view.js` | projection, display list, primitives (polygons, prisms, faces, labels) |
| `core/flycam.js` | the flyover's virtual orbit camera: homography and pose for the `View`, orbit, pan, zoom, fit; grid lines |
| `core/registry.js`, `core/events.js`, `core/layout.js` | extension points, event bus, layout files |
| `sims/passengers.js` | the example passenger simulation |
| `sims/traffic.js` | cars on the road network |
| `app/*` | the user interface (no framework): sources, panels, editor |

## Coordinate systems

| Frame | Units | Used for |
| --- | --- | --- |
| image | pixels of the displayed frame | detections, drawing |
| marker | mm, x right, y up as printed, origin at the marker centre | marker homographies |
| layout | mm on the layout plane, z up; origin and axes of the origin marker | positions of markers and objects |
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

**Camera pose** (`poseFromHomography`). *K⁻¹H* scaled to unit column length gives the plane axes and origin in camera coordinates; their cross product is the plane normal. A point (x, y, z) above the layout is at x·a₁ + y·a₂ + a₃ + z·n.

Measured accuracy (automated tests, synthetic H0 scene with known camera, 960×540 video): platform corners within 1 px (median) and 1.8 px (maximum) with a map surveyed from scratch; focal length within 0.3 %; surveyed marker positions within 5 mm over 700 mm.

## Marker detection

js-aruco2 finds candidate quadrilaterals (adaptive threshold, contours). ARail then

1. keeps all candidates. js-aruco2 would drop the smaller of two nearby outlines, but for small markers the outline of the white paper border lies within a few pixels of the black square, so the marker itself would be dropped;
2. refines the corners to sub-pixel accuracy by fitting lines to grey-value edges;
3. samples the centre of every code cell (3×3 samples per cell, margins ignored) instead of counting whole cells, and thresholds with Otsu over the cell means;
4. checks the black border, decodes against the first *N* codes of the dictionary (accepting only bit errors that can be corrected safely) and keeps one detection per ID, the one read with the fewest bit errors. A locked marker map needs only the codes up to its highest ID; for fewer than 50 codes the codes are compared in all four orientations, and no more bit errors are accepted than keep chance matches as rare as with 50 codes (`acceptedBitErrors`).

Steps 1 and 3 make small and steeply viewed markers decodable. On the synthetic camera path, 301 of 302 visible markers are found (235 when nearby candidates are dropped as js-aruco2 does), without false detections; on the lab photo a marker of 28×37 px seen at a grazing angle is found; on the lab video the detector finds about as many markers as OpenCV. The corner order (and so the marker orientation) matches OpenCV for all dictionaries; js-aruco2's AprilTag codes are rotated by 180°, which ARail corrects.

## Simulation

`World.step(dt)` advances simulated time (`dt` = real time × speed, in sub-steps of at most 0.25 s): scenario steps, expiry of disruptions, services (timetables, vehicle life cycles), object animations, and simulations. Services and simulations communicate through **events** and the **effects** of disruptions, so each part can be replaced or extended independently.

The passenger simulation is a social-force crowd model per stop area: people are attracted to their target (entrance, waiting spot, door, exit) and repelled by neighbours closer than 0.6 m; local density slows them down and worsens their mood.

## Rendering

The `View` projects layout points with the camera pose and queues drawing operations in three layers: ground (flat things, in order), solids (3D, painter's algorithm by depth, back faces culled, faces shaded by a fixed light direction) and overlays (labels, placed so they do not overlap). Everything is drawn with the Canvas 2D API over the camera image.

## Tests

| Suite | Checks |
| --- | --- |
| `tests/js/math.test.js` | linear algebra, homographies, poses, polygons, RNG, marker geometry, focal length, camera distortion |
| `tests/js/detector.test.js` | js-aruco2 vs OpenCV (IDs, corner order, printable bits) for 7 dictionaries; markers on the real lab photo |
| `tests/js/tracker.test.js` | survey from an empty map along a synthetic camera path with occlusions; accuracy thresholds above |
| `tests/js/world.test.js` | example layouts, round trips, passengers, disruptions, scenarios, control-system feed, plugins |
| `tests/python/*` | calibration, synthetic scene, bridge protocol, adapters, WebSocket server end to end |
| `tests/e2e/*` | the app, the project page and the marker sheets in Chromium |

The JavaScript tests use images generated by `python -m arail_tools.fixtures` (synthetic scene rendered with OpenCV, marker strips, the lab photo).
