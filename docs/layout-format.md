# Layout file format

A layout file is a JSON document (format `arail-layout/1`) that describes one physical layout: its scale, the markers on it, the virtual objects placed on it, the timetable, the clock, the simulations and the scenarios. The app reads and writes it (Build → Export/Import layout); the examples are in [`web/layouts/`](../web/layouts).

A shortened version of the EBL example ([`web/layouts/ebl-lab.json`](../web/layouts/ebl-lab.json)):

```json
{
  "format": "arail-layout/1",
  "name": "EBL lab (example)",
  "description": "Two platforms of the railway operations lab ...",
  "scale": 87,
  "markers": { "dictionary": "ARUCO", "size_mm": 30, "codes": 50, "origin": 0,
               "poses": { "0": [0, 0, 0], "1": [700.4, 18.9, 1.47] } },
  "services": { "rail_headway_s": 70, "rail_dwell_s": 24, "bus_headway_s": 80 },
  "clock": { "start": "07:00" },
  "simulations": [
    { "type": "passengers" },
    { "type": "town", "people_per_100": 25, "walk_max_m": 80, "bus_share": 0.85 },
    { "type": "traffic", "cars_per_km": 20 }
  ],
  "objects": [
    { "id": "platform-1", "type": "platform", "name": "Platform 1", "number": "1", "between": [0, 1], "width_mm": 70 },
    { "id": "table-lab", "type": "tabletop", "name": "EBL lab table", "kind": "physical", "position": [785, 340], "width_mm": 2170, "depth_mm": 1320 },
    { "id": "road-schulstrasse", "type": "road", "name": "Schulstraße", "points": [[650, -410], [650, -1700]] },
    { "id": "bus-stop-altmarkt", "type": "bus-stop", "name": "Altmarkt", "position": [650, -760], "side": "both" },
    { "id": "bus-line-62", "type": "bus-line", "number": "62", "mode": "loop", "stops": ["bus-terminal-1", "bus-stop-altmarkt"] },
    { "id": "plattenbau-1", "type": "plattenbau", "position": [166, -1844], "rotation_deg": 180, "series": "wbs70" }
  ],
  "scenarios": [],
  "plugins": ["../plugins/windmill.js"],
  "view": { "image": "../media/ebl-lab.jpg",
            "ortho": { "image": "../media/ebl-lab-ortho.jpg", "bounds_mm": [-300, -320.2, 1870.2, 700] } }
}
```

All fields are optional; missing ones get the defaults below.

## Units

- `_mm`: **model millimetres**, measured on the layout (positions, platform widths, marker sizes, table modules).
- `_m`: **prototype metres**, converted with the scale (sizes of buildings, trees, streets, bus stops).
- `_s`: simulated seconds. `_deg`: degrees, counter-clockwise seen from above. `_kmh`: km/h (prototype).

Positions are in the **layout frame**: millimetres on the layout, origin at the origin marker, x along the marker's printed "right", y along its "up" (see [Setting up a lab](lab-setup.md#the-marker-map)).

## Top level

| Field | Default | Meaning |
| --- | --- | --- |
| `format` | `"arail-layout/1"` | format identifier |
| `name`, `description` | `"Untitled layout"`, `""` | shown in the app |
| `scale` | `87` | model scale denominator: 87 = H0, 120 = TT, 160 = N, 220 = Z, 64 = S, 45 = 0, 32 = 1, 22.5 = G |
| `markers` | | the markers and the marker map, see below |
| `services` | | timetable defaults, see below |
| `clock` | `{"start": "07:00", "factor": 12, "profiles": true}` | the fast clock, see below |
| `grid` | `{"size_mm": 50, "snap": true}` | grid of the flyover and the editor, see below |
| `simulations` | `[{"type": "passengers"}]` | simulations to run, with their settings, see below |
| `objects` | `[]` | the virtual objects |
| `scenarios` | `[]` | see [Disruptions and scenarios](disruptions-and-scenarios.md#scenarios) |
| `plugins` | `[]` | URLs of plugin modules, relative to the layout file (same origin only), see [Extending](extending.md) |
| `view.image` | | example image shown when the layout is opened (relative to the layout file) |
| `view.ortho` | | photo of the table seen from straight above, drawn on the table in the flyover, see below |
| `view.start` | | `"flyover"`: the app opens the layout in the flyover (the [container terminal example](container-terminal.md#the-example) does) |

The app writes `clock`, `grid` and all other sections when it exports a layout; `markers.rolling`, `markers.locked` and `markers.moving` only when they are set.

## `markers`

| Field | Default | Meaning |
| --- | --- | --- |
| `dictionary` | `"ARUCO"` | marker type: `ARUCO` (ArUco Original), `ARUCO_4X4_1000`, `ARUCO_5X5_1000`, `ARUCO_6X6_1000`, `ARUCO_7X7_1000`, `ARUCO_MIP_36h12`, `APRILTAG_36h11`, or `auto` |
| `size_mm` | `30` | edge of the black square |
| `sizes_mm` | `{}` | sizes of individual markers, e.g. `{"7": 60}` |
| `codes` | `50` | number of codes used: marker IDs `0 … codes-1`. Set it to the number of stickers you printed (IDs 0 … N−1, see [choosing a dictionary and the IDs](lab-setup.md#choosing-a-dictionary-and-the-ids)). Fewer codes mean more correctable bit errors. With a locked map the app reads only the codes up to the highest ID in `poses` and `moving`. |
| `origin` | `null` | marker that defines the layout frame while surveying; usually `0` (`null`: the lowest ID among the first markers seen) |
| `rolling` | | tags on model wagons, a marker family of their own, see [below](#markersrolling) |
| `locked` | `false` | the marker map is complete (**Keep positions** in the app, or `arail-survey`): live tracking surveys nothing, markers that are not in `poses` are ignored, and misread or moved markers are dropped from the pose as outliers |
| `moving` | `[]` | IDs of markers of the layout's type on vehicles, e.g. `[40, 41]` (the older way; model wagons of the container terminal carry tags of their own, see `rolling`): never part of the map and never used for the pose, locked or not (a pose for such an ID is ignored). They must be below `codes`, must not be the origin, and objects cannot be placed relative to them. The tracker reports where they are seen (`tracker.state.moving`, see [Extending](extending.md#tracking-moving-markers)). |
| `poses` | `{}` | known marker positions: `"id": [x_mm, y_mm, rotation_deg]`. Poses in the file are kept fixed; unknown markers are surveyed (unless the map is locked). |

### `markers.rolling`

Rolling-stock markers: the tags on the deck cards of model wagons for the [container terminal](container-terminal.md#markers-on-rolling-stock). They are a marker family of their own, with IDs of their own: never part of the marker map, never used for the pose, and not affected by `codes`, `locked` or `moving`. Tag ID = (wagon number − 1) × `stride` + spot, with spot 0 at the wagon's A end.

```json
"rolling": { "dictionary": "APRILTAG_36h11", "codes": 64, "size_mm": 20, "height_mm": 15, "stride": 4, "max_bit_errors": 3 }
```

| Field | Default | Meaning |
| --- | --- | --- |
| `dictionary` | `"APRILTAG_36h11"` | marker type of the tags; it must differ from `markers.dictionary` (AprilTag 36h11 is the only type never misread as ArUco Original). The marker sheet page prints deck cards only in AprilTag 36h11, so with AprilTag 36h11 layout markers use another layout marker type (e.g. ArUco Original) |
| `codes` | `64` | tag IDs `0 … codes − 1` (1–1000, and at most the IDs of the family: 587 for AprilTag 36h11, 250 for ArUco MIP 36h12; more are reported and count as all of them) |
| `size_mm` | `20` | edge of the black square (5–100; at most 23 mm fit on an H0 deck card) |
| `height_mm` | `15` | height of the tags above the layout plane, measured in the lab (0–200); the terminal's `rolling_stock[].height_mm` overrides it per wagon |
| `stride` | `4` | IDs per wagon (1–8); at least the container spots of every wagon type used (3 for an Sgns, 4 for an Sggrss), so that every spot has a tag; the terminal's validation reports fewer |
| `max_bit_errors` | `3` | most bit errors corrected in a tag (0–6) |

Invalid values fall back to the defaults and are reported. With rolling-stock markers, set `markers.dictionary` to the layout's marker type, not `auto`.

## `services`

The built-in timetable of the platforms and bus terminals (used when no control system is connected):

| Field | Default | Meaning |
| --- | --- | --- |
| `rail_headway_s` | `70` | average time between trains at a platform track (±30 %) |
| `rail_dwell_s` | `24` | how long a train stands at the platform |
| `bus_headway_s` | `90` | average time between buses at a bus bay of a terminal |
| `bus_dwell_s` | `20` | how long a bus stands at a bay; also the dwell time of line buses at bus stops (at least 8 s) |
| `approach_s` | `6` | duration of the arrival and departure animations |

The defaults are short so that something happens in a demo; the Simulate panel sets the speed (simulated time per real time). With `clock.profiles` these intervals are the off-peak values: trains and buses run more often in the rush hours and not at all between 01:00 and 04:30. Bus lines have their own interval (`headway_s` of the `bus-line`).

## `clock`

The fast clock (see [Day and night](day-and-night.md)):

| Field | Default | Meaning |
| --- | --- | --- |
| `start` | `"07:00"` | time of day when the layout is opened (`"HH:MM"`) |
| `factor` | `12` | clock seconds per simulated second (1 = real time; 12 = one clock hour in five simulated minutes) |
| `profiles` | `true` | timetables, bus lines, road traffic and random passengers follow the time of day |

The app writes the start time, not the time shown when the layout is exported.

## `grid`

The flyover (View → Flyover, key F) shows a grid on the layout plane; placed points, the corners of table modules and dragged objects snap to it (hold Alt/Option to place freely). Over the camera image the grid (and snapping) is only on when "Grid in camera view" is ticked.

| Field | Default | Meaning |
| --- | --- | --- |
| `size_mm` | `50` | spacing of the grid lines (above 0, at most 10000); every tenth line is drawn stronger |
| `snap` | `true` | snap to the grid while it is shown |

## `view.ortho`

```json
"view": { "image": "../media/ebl-lab.jpg", "ortho": { "image": "../media/ebl-lab-ortho.jpg", "bounds_mm": [-300, -320.2, 1870.2, 700] } }
```

An orthophoto of the table (from `arail-survey --ortho`, see [the lab session](lab-session.md)): `image` is relative to the layout file, `bounds_mm` = `[xmin, ymin, xmax, ymax]` in the layout frame (xmin < xmax, ymin < ymax). Row 0 of the image is at `ymax`, column 0 at `xmin`; the centre of pixel (u, v) of a W × H image is at x = xmin + (u + 0.5)/W · (xmax − xmin), y = ymax − (v + 0.5)/H · (ymax − ymin). The flyover draws it in perspective on the table; its uncovered (light grey) border is left out. Where it covers platforms and tracks, their virtual surfaces are left out too (the photo shows the real ones). Table modules of the kind `extension` lie above the photo, real tables (`physical`) below it.

## Positions

A **point** is one of

- `[x, y]`: layout coordinates in mm, or
- `{"marker": 4, "offset": [dx, dy]}`: relative to a marker, offset in the marker's own frame (mm). The object then follows the marker if its position is re-surveyed.

A **segment** (platforms) is `"between": [idA, idB]` (the two marker centres) or `"from": point, "to": point`.

**Polygons and polylines** (`points`) are lists of points. **Rectangles** (table modules) are a `position` (the centre) with `width_mm`, `depth_mm` and `rotation_deg`. **Stops** (bus lines) are `"stops": [objectId, ...]`, the ids of bus stops and bus terminals.

## Objects

Every object has a unique `id`, a `type` and, except labels, an optional `name`. The other fields depend on the type. Parameters left out take the defaults listed here; when it exports, the app leaves out parameters that are at their default and were set neither in the file nor in the editor.

| Type | Editor label (palette group) | Geometry |
| --- | --- | --- |
| [`platform`](#platform-rail-platform) | Rail platform (Transport) | segment |
| [`bus-terminal`](#bus-terminal) | Bus terminal (Transport) | `position` |
| [`road`](#road-street) | Street (Transport) | `points` (polyline) |
| [`bus-stop`](#bus-stop) | Bus stop (Transport) | `position` |
| [`bus-line`](#bus-line) | Bus line (Transport) | `stops` |
| [`building`](#building) | Building (Buildings) | `position` |
| [`plattenbau`, `altbau-block`, `house`, `house-estate`, `office`, `school`, `supermarket`, `factory`](#german-house-types) | Plattenbau, Altbau block, Single-family house, Single-family estate, Office building, School, Supermarket, Workshop / factory (Buildings) | `position`; the estate `points` (polygon) |
| [`tree`](#tree) | Tree (Scenery) | `position` |
| [`forest`](#forest) | Forest (Scenery) | `points` (polygon) |
| [`area`](#area) | Landscape area (Scenery) | `points` (polygon) |
| [`track`](#track) | Track (Infrastructure) | `points` (polyline) |
| [`label`](#label) | Label / sign (Infrastructure) | `position` |
| [`tabletop`](#tabletop-table-module) | Table module (Table) | rectangle |
| [`container-yard`](#container-yard-container-yard-block) | Container yard block (Terminal) | rectangle |
| [`gantry-crane`](#gantry-crane) | Gantry crane (Terminal) | rectangle |
| [`truck-lane`](#truck-lane) | Truck lane (Terminal) | `points` (polyline) |
| [`quay`](#quay-quay-and-fairway) | Quay and fairway (Terminal) | `points` (polyline) |
| [`reach-stacker`](#reach-stacker) | Reach stacker (Terminal) | `position` |
| [`depot`](#depot-depot-and-workshop) | Depot and workshop (Transport) | `position` |

### `platform`: rail platform

Geometry: `between: [a, b]` or `from`/`to`. Trains stop along the long edges; *left* and *right* are seen from the first towards the second end. The stop area has the id of the platform and one dock per side, `<id>:left` and `<id>:right`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `number` | `""` | shown on the platform sign and the board |
| `width_mm` | `50` | measured width of the platform (5–400) |
| `offset_mm` | `0` | sideways shift from the line between the ends (positive = left) |
| `extend_mm` | `0` | length added at both ends (negative = shorter) |
| `sides` | `"both"` | where trains stop: `both`, `left`, `right`, `none` |
| `track_left`, `track_right` | `""` | names of the tracks in the control system |
| `lines` | `""` | line names for the timetable trains, comma-separated (`"RE 1, S 2"`) |
| `headway_s` | layout default | average time between trains |
| `canopy` | `false` | draw a canopy over the middle of the platform |

Over the camera image the platform surface is the real one; in the flyover the platform draws a concrete surface with edge stones and a safety line, unless the orthophoto shows it.

### `bus-terminal`

Geometry: `position` (centre). A waiting area with bays along a bus lane on its right side (seen in the direction of `rotation_deg`). The docks are `<id>:bay1`, `<id>:bay2`, … (signs A, B, …).

| Parameter | Default | Meaning |
| --- | --- | --- |
| `rotation_deg` | `0` | direction of the bays (buses drive in this direction) |
| `bays` | `3` | number of bus bays (1–8) |
| `bay_length_m` | `16` | length of a bay |
| `width_m` | `4.5` | width of the waiting area |
| `lane_width_m` | `3.5` | width of the bus lane |
| `lines` | `""` | line names of the timetable buses, e.g. `"305, 328"` |
| `headway_s` | layout default | average time between timetable buses per bay |
| `shelter` | `true` | shelters at the bays |

A bus line that has the terminal as a stop gets a bay of its own (the lines share the first bays in the order of their ids; their buses come over the streets to the bus lane); the other bays keep the timetable buses.

### `road`: street

A street (or footpath). Geometry: `points` (polyline). Streets whose ends meet, that end on another street or that cross are connected (the road network, see [Streets, bus lines and road traffic](streets-and-buses.md)).

| Parameter | Default | Meaning |
| --- | --- | --- |
| `kind` | `"street"` | `street` (50 km/h; the old value `road` means the same), `residential` (30 km/h), `main` (main road, 50 km/h, wider), `path` (footpath, no cars) |
| `width_m` | by kind | carriageway (path) width: 7 street, 6 residential, 10 main road, 3 footpath |
| `sidewalk_m` | `2.5` | sidewalk width on each side, 0 = none (footpaths have none) |
| `speed_kmh` | by kind | speed limit |
| `lamps` | `true` | street lamps every 30 m on each side, staggered (lit at night; footpaths: on one side) |
| `crossings` | `true` | zebra crossings next to junctions |

### `bus-stop`

Geometry: `position`, projected onto the nearest street (or the street in `road`; not a footpath). A waiting area on the sidewalk where the buses of bus lines stop. Each side is a stop area with one dock: `<id>:right` (*Stop A*, an A on its sign) and `<id>:left` (*Stop B*); a stop on one side only has no letter. The bus lines serve the docks (`managed`: the timetable leaves them alone). A stop more than 15 m beyond the sidewalk of every street is outlined in red and reports the problem in the inspector.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `road` | nearest street | id of the street |
| `side` | `"right"` | `right`, `left` or `both`, seen in the street's drawing direction; buses on the right side drive in that direction, on the left side in the other one |
| `length_m` | `18` | length of the stop |
| `width_m` | `2.5` | width of the waiting area |
| `shelter` | `true` | a shelter |

### `bus-line`

Buses that run along the streets from stop to stop. Geometry: `stops`, the ids of bus stops (or bus terminals) in the order they are served, at least two.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `number` | `""` | line number on buses and signs (empty: the name, else the number in the id) |
| `color` | `"#0A777F"` | colour of the route and of the stripe on the buses (Türkis) |
| `headway_s` | `240` | time between buses outside the rush hours (simulated seconds, 30–3600); more often in the rush hours, none at night |
| `mode` | `"back-and-forth"` | `back-and-forth` (in order, then in reverse) or `loop` (round, back to the first stop; the signs say *Ring ↻* or *Ring ↺*) |
| `speed_kmh` | `40` | top speed |
| `show_route` | `true` | draw the route |

### `building`

Geometry: `position` (centre). A generic building. Like all buildings it looks like a white architectural model (neutral greys from mid grey up to white; at night the windows light up, depending on the time of day and on how many people are inside), has a use for the town simulation and a capacity from its size.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `rotation_deg` | `0` | `0`: the front (with the entrance) faces −y |
| `width_m`, `depth_m` | `12`, `9` | footprint (3–120 m, 3–80 m) |
| `floors` | `2` | 1–30 |
| `floor_height_m` | `3` | 2.4–6 |
| `roof` | `"gable"` | `gable` or `flat` |
| `use` | `"residential"` | `residential`, `work`, `school`, `shop`, `other` |
| `color`, `roof_color` | `#f2f2f2`, `#a6a6a6` | wall and roof colour (older layouts set their own) |
| `windows` | `true` | |

### German house types

Geometry: `position` (centre) and `rotation_deg` (default `0`: the street front with the entrances faces −y); the estate has `points` (polygon) instead. Sizes are prototype metres. All are grey like the generic building. The variation of a building (wall greys, which windows are lit) comes from its id, so neighbours differ; `seed` picks another variant.

| Type | Parameters (defaults) | Use, notes |
| --- | --- | --- |
| `plattenbau` | `series` (`wbs70`: WBS 70 with 6 floors, `wbs70-11`: 11 floors, `qp61`: QP 61 with 8 floors, `p2`: P2 with 5 floors), `sections` (4: entrances of about 12 m each, 1–12), `floors` (empty: the series'; 2–25), `balconies` (true: loggias on the garden side) | residential; GDR slab block |
| `altbau-block` | `width_m` (60), `depth_m` (50), `wing_depth_m` (13), `floors` (5, 3–6), `form` (`closed`, `u`: open at the back, `row`), `rear_wings` (false: side wings and rear buildings in the courtyard), `roof` (`mansard`, `pitched`), `seed` (1) | residential with shops on the ground floor; Gründerzeit perimeter block of parcels; falls back to `row` when no courtyard fits |
| `house` | `style` (`gable`, `hip`: Stadtvilla, `bungalow`, `semi`: semi-detached), `width_m` (10; semi: both halves), `depth_m` (9), `floors` (1.5: a floor and an attic; 1–2 in steps of 0.5), `garage` (true), `chimney` (true) | residential; single-family house |
| `house-estate` | `plot_width_m` (16), `plot_depth_m` (28), `mix` (`mixed`, `gable`, `hip`, `bungalow`), `garages` (true), `density` (0.85: share of the plots built, 0.5–1), `street_m` (12: room for a street between each pair of rows, 0 = none), `seed` (1) | residential; rows of plots along the longest edge of the polygon, only plots completely inside, one entrance per house |
| `office` | `width_m` (30), `depth_m` (15), `floors` (4, 1–20) | work; ribbon windows |
| `school` | `floors` (3, 2–5), `gym` (true) | school; GDR "Typ Erfurt", 60 × 13 m with a stair tower and a gym hall |
| `supermarket` | `width_m` (45), `depth_m` (30), `parking` (true) | shop; glass front, parking lot in front, lit while open |
| `factory` | `width_m` (40), `depth_m` (25), `chimney` (true) | work; sawtooth roof |

### `tree`

Geometry: `position`. Parameters: `kind` (`deciduous`, `conifer`), `height_m` (12), `color` (crown colour; empty = default).

### `forest`

Geometry: `points` (polygon), filled with trees. Parameters: `kind` (`mixed`, `deciduous`, `conifer`), `height_m` (14), `spacing_m` (8, average distance between trees), `seed` (1, change it for another arrangement). At most about 400 trees are drawn.

### `area`

Geometry: `points` (polygon). A coloured area: `kind` (`grass`, `field`, `water`, `sand`, `parking`, `plaza`, `forest`), `opacity` (0.55).

### `track`

Geometry: `points` (polyline along the centre of a real track). Over the camera image it is drawn only when "Tracks" is switched on in the View panel (the real track is in the image); the flyover draws the track itself (ballast, sleepers, rails) unless the orthophoto shows it. Used to place trains reported as "track + offset" by the control system.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `track_id` | `""` | name of the track in the control system |
| `offset_start_mm` | `0` | the offset the control system reports at the first point |

### `label`

Geometry: `position`. Parameters: `text` (`"Station"`), `style` (`board`: station name board on posts, `floating`: text only), `height_m` (3).

### `tabletop`: table module

Geometry: a rectangle, `position` (centre). A base plate whose top is the layout plane, with an 18 mm edge. In the editor (Build → Table) drag from one corner to the opposite one, or tap both corners; in the flyover the corners snap to the grid. Duplicate puts the copy right beside the original.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `kind` | `"extension"` | `extension`: a virtual table module beside the real table, drawn over the camera image too (it covers the floor there) and in the flyover; `physical`: the outline of a real table of the lab, only drawn in the flyover |
| `width_mm`, `depth_mm` | `1000`, `600` | size along its x and y axis (20–20000) |
| `rotation_deg` | `0` | |
| `surface` | `"grey"` | `grey` (light grey), `white`, `green` (model grass) |

Without a `physical` table module, the flyover draws a light-grey default table around the markers, the objects (except those on table extensions) and the orthophoto, with a margin of 100 mm.

### `container-yard`: container yard block

The infrastructure of the [container terminal](container-terminal.md): it needs a `terminal` simulation (below), which reads these objects. Geometry: a rectangle, `position` (centre). Container stacks in a grid: bays of 6.9 m along the rectangle's width, rows of 2.9 m across it, as many as fit (Block A of the example, 952 × 134 mm in H0, has 12 bays and 4 rows).

| Parameter | Default | Meaning |
| --- | --- | --- |
| `width_mm` | `476` | length along the bays (50–5000) |
| `depth_mm` | `134` | depth across the rows (30–2000) |
| `rotation_deg` | `0` | |
| `tiers` | `3` | containers per stack at most (1–5) |

Making a block smaller removes the containers in the cells that disappear.

### `gantry-crane`

A rail-mounted gantry crane. Geometry: a rectangle, `position` (centre): the area between its rails, which run along the width. It reaches its outreach beyond each rail, but not the last 8 m at the ends of the runway. Like table modules, it is picked at its edges unless selected.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `width_mm` | `1150` | runway length, along the rails (100–5000) |
| `depth_mm` | `345` | span between the rails (100–1500) |
| `rotation_deg` | `0` | |
| `outreach_m` | `8` | how far it reaches beyond each rail (0–20) |
| `lift_m` | `15` | lifting height (8–25) |
| `speed` | `1` | speed factor of all its motions (0.25–5) |

### `truck-lane`

The lane of the trucks under the crane. Geometry: `points` (polyline in the driving direction; the first point is the entry). Trucks stop at evenly spaced positions (19 m apart) around its middle; they come and go on a passing lane beside it. Around the positions the lane should bend by at most 10° within a truck length (16.5 m), or trucks passing or turning in overlap there; the editor warns about sharper bends.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `positions` | `3` | truck positions (1–6) |
| `passing_side` | `"left"` | side of the passing lane, `left` or `right`, seen in the driving direction |

### `quay`: quay and fairway

Geometry: `points` (polyline along the middle of the fairway; the first point is where the barges come from). Barges berth with the bow at the last point, beside the quay wall. Picked at its edges unless selected.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `berth_m` | `60` | length of the quay wall before the last point (20–200) |
| `water_m` | `16` | width of the fairway (10–60) |
| `quay_side` | `"right"` | side of the quay wall, `left` or `right`, seen in the sailing direction |

### `reach-stacker`

Geometry: `position`, its parking place. It moves containers where no crane reaches: between wagons, trucks and yard blocks, not barges.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `rotation_deg` | `0` | |
| `tiers` | `3` | the highest tier it stacks to (1–4) |
| `speed` | `1` | speed factor (0.25–5) |

### `depot`: depot and workshop

Geometry: `position` (centre). A maintenance depot (Betriebswerk): a glass workshop hall with its
tracks and inspection pits, stabling tracks behind it and the crew room at the front, whose door
(entrance 0) is where crews sign on. With [rail operations](operations.md) it shows the units in
the workshop and on the stabling tracks (a unit outlined in Orange is being worked on, one outlined in Rot has failed)
and a board with the state of the workshop; the operations name it in
`maintenance.workshop.object`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `rotation_deg` | `0` | direction of the tracks |
| `length_m` | `64` | length of the hall and the tracks (30–250) |
| `bays` | `2` | workshop tracks in the hall (1–6); the operations work on as many as `maintenance.workshop.bays` |
| `stabling` | `3` | stabling tracks (0–10), two units each |

### Objects from plugins

Plugins add their own types (the example plugin [`windmill.js`](../web/plugins/windmill.js) adds `windmill`). If a layout contains a type that is not registered, the object is kept unchanged when the layout is saved, and the app reports the missing plugin.

## `simulations`

A list of `{"type": ..., <settings>}`. The built-in simulations also take `"enabled": false`, which switches them off and keeps their settings. Built in:

| Type | Settings (defaults) | |
| --- | --- | --- |
| `passengers` | `base_rate` (0.5 people per second per 25 m of platform at normal demand), `max_per_area` (140) | random passengers at all stops, their moods, boarding and alighting; it also handles the town's people at stops |
| `town` | `people_per_100` (12 people shown per 100 residents), `max_people` (300), `walk_max_m` (150: longer ways by bus), `bus_share` (0.8), `commuters_out` (0.35 of the workers take the train), `commuters_in` (40 visitors by train per 100 local jobs), `shopping` (0.5 of the adults per day) | residents go to work, school and shopping and come home, on foot, by bus and by train, see [Day and night](day-and-night.md#the-town-simulation) |
| `traffic` | `cars_per_km` (20 cars per km of street at normal daytime traffic) | cars on the streets, see [Streets, bus lines and road traffic](streets-and-buses.md#road-traffic) |
| `terminal` | `name`, `default_wagon` (`sgns60`), `rolling_stock`, `trains`, `barges`, `trucks`, `containers`, `fill` | the container terminal: trains, trucks and barges, cranes and reach stackers moving containers, model wagons with deck cards; see [Container terminal](container-terminal.md#layout-file) for the keys. One per layout. |
| `operations` | `name`, `stations`, `lines` (default: from the platforms' `lines`), `fleet`, `maintenance`, `parties`, `ecm`, `contracts`, `crew`, `dispatch`, `costs`, `setups`, `stress` | rail operations: units with maintenance and failures, the four ECM functions, penalties between the parties, crews with duties and rosters; its trains run at the platforms of its stations (their tracks are in mode `plan`); see [Rail operations](operations.md#layout-file) for the keys. One per layout. |

The town needs residential buildings and works best with the passenger simulation (for the stops), streets and bus lines. Plugins can add more simulations, e.g. `{"type": "road-traffic", "cars_per_km": 30, "speed_kmh": 40}` from the example plugin [`road-traffic.js`](../web/plugins/road-traffic.js). Settings of a simulation whose plugin is missing are kept when the layout is saved.

## Validation

The app and `validateLayout()` report:

- an unknown `format` and a scale that is not a positive number;
- malformed marker poses, a `locked` that is not true or false, a `moving` that is not a list of marker IDs, moving markers at or above `codes`, a moving origin marker, poses given for moving markers, and a locked map without poses;
- objects without an id, duplicate ids, objects without a type, unknown types (missing plugin?) and objects placed relative to a moving marker;
- a malformed `grid` or `view.ortho`, and scenarios without an id or steps;
- in `markers.rolling`: a value that is not an object, an unknown marker type, the layout's own marker type, a type that is misread as ArUco Original (`ARUCO_4X4_1000`, `ARUCO_MIP_36h12` on an ArUco Original layout), numbers out of range, and `markers.dictionary: "auto"` together with rolling-stock markers;
- the settings of simulations that check them (`static validate`, see [Extending](extending.md#checking-the-settings)), prefixed with `simulations[i] (type): `. The terminal reports lists that are not lists, missing or duplicate visit ids, ids with `/` or like `W1`, tracks, quays, truck lanes and yards that do not exist, unknown wagon types and sizes, wrong check digits, containers that cannot stand where they are (e.g. `simulations[0] (terminal): containers[13] (ARLU 100007 1): Nothing to stand on`), fill shares outside 0–1, model wagons whose tag IDs exceed `markers.rolling.codes`, `rolling_stock` without `markers.rolling`, and a second terminal. The operations report stations, platforms, docks, parties, vehicle types and depots that do not exist, malformed times and day sets, contracts whose payer is their payee, and setups and stress events without an id or type (e.g. `simulations[3] (operations): lines[0] (RE 1): no station "altstadt"`).

The layout loads anyway, with unusable entries left out; the app logs the problems and shows the first one when a layout is imported. The tests check the example layouts, so a broken example layout fails CI.
