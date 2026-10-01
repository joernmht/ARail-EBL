# Layout file format

A layout file is a JSON document (format `arail-layout/1`) that describes one physical layout: its scale, the markers on it, the virtual objects placed on it, the services, simulations and scenarios. The app reads and writes it (Build → Export/Import layout); the examples are in [`web/layouts/`](../web/layouts).

```json
{
  "format": "arail-layout/1",
  "name": "EBL lab (example)",
  "description": "Two platforms of the railway operations lab ...",
  "scale": 87,
  "markers": { "dictionary": "ARUCO", "size_mm": 30, "origin": 0, "poses": { "0": [0, 0, 0], "1": [700.4, 18.9, 1.47] } },
  "services": { "rail_headway_s": 70, "rail_dwell_s": 24 },
  "simulations": [{ "type": "passengers" }],
  "objects": [
    { "id": "platform-1", "type": "platform", "name": "Platform 1", "number": "1", "between": [0, 1], "width_mm": 70 }
  ],
  "scenarios": [],
  "plugins": [],
  "view": { "image": "../media/ebl-lab.jpg" }
}
```

All fields are optional; missing ones get the defaults below.

## Units

- `_mm`: **model millimetres**, measured on the layout (positions, platform widths, marker sizes).
- `_m`: **prototype metres**, converted with the scale (sizes of buildings, trees, bus bays).
- `_s`: simulated seconds. `_deg`: degrees, counter-clockwise seen from above.

Positions are in the **layout frame**: millimetres on the layout, origin at the origin marker, x along the marker's printed "right", y along its "up" (see [Setting up a lab](lab-setup.md#the-marker-map)).

## Top level

| Field | Default | Meaning |
| --- | --- | --- |
| `format` | `"arail-layout/1"` | format identifier |
| `name`, `description` | | shown in the app |
| `scale` | `87` | model scale denominator: 87 = H0, 120 = TT, 160 = N, 220 = Z, 45 = 0, 32 = 1, 22.5 = G |
| `markers` | | see below |
| `services` | | timetable defaults, see below |
| `simulations` | `[{"type": "passengers"}]` | simulations to run, with their settings |
| `objects` | `[]` | the virtual objects |
| `scenarios` | `[]` | see [Disruptions and scenarios](disruptions-and-scenarios.md#scenarios) |
| `plugins` | `[]` | URLs of plugin modules, relative to the layout file (same origin only), see [Extending](extending.md) |
| `grid` | `{"size_mm": 50, "snap": true}` | grid of the flyover and the editor, see below |
| `view.image` | | example image shown when the layout is opened (relative to the layout file) |
| `view.ortho` | | photo of the table seen from straight above, drawn on the table in the flyover, see below |

## `grid`

The flyover (View → Flyover, key F) shows a grid on the layout plane; placed points, the corners of table modules and dragged objects snap to it (hold Alt/Option to place freely). Over the camera image the grid is only shown when "Grid in camera view" is ticked.

| Field | Default | Meaning |
| --- | --- | --- |
| `size_mm` | `50` | spacing of the grid lines; every tenth line is drawn stronger |
| `snap` | `true` | snap to the grid while it is shown |

## `view.ortho`

```json
"view": { "image": "../media/ebl-lab.jpg", "ortho": { "image": "../media/ebl-lab-ortho.jpg", "bounds_mm": [-200, -400, 1600, 600] } }
```

An orthophoto of the table (from `arail-survey --ortho`, see [the lab session](lab-session.md)): `image` is relative to the layout file, `bounds_mm` = `[xmin, ymin, xmax, ymax]` in the layout frame. Row 0 of the image is at `ymax`, column 0 at `xmin`; the centre of pixel (u, v) of a W × H image is at x = xmin + (u + 0.5)/W · (xmax − xmin), y = ymax − (v + 0.5)/H · (ymax − ymin). The flyover draws it in perspective on the table; where it covers platforms and tracks, their virtual surfaces are left out (the photo shows the real ones).

## `markers`

| Field | Default | Meaning |
| --- | --- | --- |
| `dictionary` | `"ARUCO"` | marker type: `ARUCO` (ArUco Original), `ARUCO_4X4_1000`, `ARUCO_5X5_1000`, `ARUCO_6X6_1000`, `ARUCO_7X7_1000`, `ARUCO_MIP_36h12`, `APRILTAG_36h11`, or `auto` |
| `size_mm` | `30` | edge of the black square |
| `sizes_mm` | `{}` | sizes of individual markers, e.g. `{"7": 60}` |
| `codes` | `50` | number of codes used: marker IDs `0 … codes-1`. More codes means fewer correctable bit errors. |
| `origin` | `null` | marker that defines the layout frame while surveying; usually `0` |
| `poses` | `{}` | known marker positions: `"id": [x_mm, y_mm, rotation_deg]`. Poses in the file are kept fixed; unknown markers are surveyed. |

## `services`

The built-in timetable (used when no control system is connected):

| Field | Default | Meaning |
| --- | --- | --- |
| `rail_headway_s` | `70` | average time between trains at a platform track (±30 %) |
| `rail_dwell_s` | `24` | how long a train stands at the platform |
| `bus_headway_s` | `90` | average time between buses at a bus bay |
| `bus_dwell_s` | `20` | how long a bus stands at the bay |
| `approach_s` | `6` | duration of the arrival and departure animations |

The defaults are short so that something happens in a demo; the Simulate panel sets the speed (simulated time per real time).

## Positions

A **point** is one of

- `[x, y]`: layout coordinates in mm, or
- `{"marker": 4, "offset": [dx, dy]}`: relative to a marker, offset in the marker's own frame (mm). The object then follows the marker if its position is re-surveyed.

A **segment** (platforms) is `"between": [idA, idB]` (the two marker centres) or `"from": point, "to": point`.

**Polygons and polylines** (`points`) are lists of points.

## Objects

Every object has a unique `id`, a `type` and an optional `name`. The other fields depend on the type. Parameters left out take the defaults listed here; the app omits defaults when exporting.

### `platform`: rail platform

Geometry: `between: [a, b]` or `from`/`to`. Trains stop along the long edges; *left* and *right* are seen from the first towards the second end.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `number` | `""` | shown on the platform sign and the board |
| `width_mm` | `50` | measured width of the platform |
| `offset_mm` | `0` | sideways shift from the line between the ends (positive = left) |
| `extend_mm` | `0` | length added at both ends (negative = shorter) |
| `sides` | `"both"` | where trains stop: `both`, `left`, `right`, `none` |
| `track_left`, `track_right` | `""` | names of the tracks in the control system |
| `lines` | `""` | line names for the timetable trains, comma-separated (`"RE 1, S 2"`) |
| `headway_s` | layout default | average time between trains |
| `canopy` | `false` | draw a canopy over the middle of the platform |

### `bus-terminal`

Geometry: `position` (centre). A waiting area with bays along a bus lane on its right side.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `rotation_deg` | `0` | direction of the bays (buses drive in this direction) |
| `bays` | `3` | number of bus bays |
| `bay_length_m` | `16` | length of a bay |
| `width_m` | `4.5` | width of the waiting area |
| `lane_width_m` | `3.5` | width of the bus lane |
| `lines` | `""` | line names, e.g. `"62, 85"` |
| `headway_s` | layout default | average time between buses per bay |
| `shelter` | `true` | shelters at the bays |

A bus line that has the terminal as a stop gets a bay of its own (its buses come over the streets
to the bus lane); the other bays keep the timetable buses.

### `building`

Geometry: `position` (centre).

A generic building. Like all buildings it looks like a white architectural model (neutral greys
from mid grey up to white; at night the windows light up, depending on the time of day and on how
many people are inside), has a use for the town simulation and a capacity from its size.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `rotation_deg` | `0` | `0`: the front (with the entrance) faces −y |
| `width_m`, `depth_m` | `12`, `9` | footprint (3–120 m, 3–80 m) |
| `floors` | `2` | 1–30 |
| `floor_height_m` | `3` | |
| `roof` | `"gable"` | `gable` or `flat` |
| `use` | `"residential"` | `residential`, `work`, `school`, `shop`, `other` |
| `color`, `roof_color` | `#f2f2f2`, `#a6a6a6` | wall and roof colour (older layouts set their own) |
| `windows` | `true` | |

### German house types

Geometry: `position` (centre) and `rotation_deg` (`0`: the street front with the entrances faces
−y); the estate has `points` (polygon) instead. Sizes are prototype metres. `seed` picks another
variant of the same building (neighbouring buildings differ anyway).

| Type | Parameters (defaults) | |
| --- | --- | --- |
| `plattenbau` | `series` (`wbs70`: WBS 70 with 6 floors, `wbs70-11`: 11 floors, `qp61`: QP 61 with 8 floors, `p2`: P2 with 5 floors), `sections` (4 entrances, 1–12), `floors` (empty: the series'), `balconies` (true: loggias on the garden side) | GDR slab block |
| `altbau-block` | `width_m` (60), `depth_m` (50), `wing_depth_m` (13), `floors` (5, 3–6), `form` (`closed`, `u`: open on one side, `row`), `rear_wings` (false: side wings and rear buildings in the courtyard), `roof` (`mansard`, `pitched`), `seed` (1) | Gründerzeit perimeter block of parcels, shops on the ground floor |
| `house` | `style` (`gable`, `hip`: Stadtvilla, `bungalow`, `semi`: semi-detached), `width_m` (10), `depth_m` (9), `floors` (1.5: a floor and an attic; 1–2), `garage` (true), `chimney` (true) | single-family house |
| `house-estate` | `plot_width_m` (16), `plot_depth_m` (28), `mix` (`mixed`, `gable`, `hip`, `bungalow`), `garages` (true), `density` (0.85: share of the plots built), `street_m` (12: room for a street between each pair of rows), `seed` (1) | rows of plots along the longest edge of the polygon; only plots completely inside |
| `office` | `width_m` (30), `depth_m` (15), `floors` (4, 1–20) | use `work` |
| `school` | `floors` (3), `gym` (true) | GDR "Typ Erfurt", 60 × 13 m; use `school` |
| `supermarket` | `width_m` (45), `depth_m` (30), `parking` (true) | use `shop` |
| `factory` | `width_m` (40), `depth_m` (25), `chimney` (true) | sawtooth roof; use `work` |

### `tree`

Geometry: `position`. Parameters: `kind` (`deciduous`, `conifer`), `height_m` (12), `color` (crown colour; empty = default).

### `forest`

Geometry: `points` (polygon), filled with trees. Parameters: `kind` (`mixed`, `deciduous`, `conifer`), `height_m` (14), `spacing_m` (8, average distance between trees), `seed` (1, change it for another arrangement). At most about 400 trees are drawn.

### `area`

Geometry: `points` (polygon). A coloured area: `kind` (`grass`, `field`, `water`, `sand`, `parking`, `plaza`, `forest`), `opacity` (0.55).

### `road`

A street (or footpath). Geometry: `points` (polyline). Streets whose ends meet, that end on another
street or that cross are connected (the road network, see [Streets, bus lines and road
traffic](streets-and-buses.md)).

| Parameter | Default | Meaning |
| --- | --- | --- |
| `kind` | `"street"` | `street` (50 km/h; the old value `road` means the same), `residential` (30 km/h), `main` (main road, 50 km/h, wider), `path` (footpath, no cars) |
| `width_m` | by kind | carriageway (path) width: 7 street, 6 residential, 10 main road, 3 footpath |
| `sidewalk_m` | `2.5` | sidewalk width on each side, 0 = none (footpaths have none) |
| `speed_kmh` | by kind | speed limit |
| `lamps` | `true` | street lamps every 30 m (lit at night) |
| `crossings` | `true` | zebra crossings next to junctions |

### `bus-stop`

Geometry: `position`, projected onto the nearest street (or the street in `road`). A waiting area
on the sidewalk where the buses of bus lines stop. Each side is a stop area with one dock
(`<id>:right`, `<id>:left`) that the bus lines serve (`managed`: the timetable leaves it alone).

| Parameter | Default | Meaning |
| --- | --- | --- |
| `road` | nearest street | id of the street |
| `side` | `"right"` | `right`, `left` or `both`, seen in the street's drawing direction; buses on the right side drive in that direction |
| `length_m` | `18` | length of the stop |
| `width_m` | `2.5` | width of the waiting area |
| `shelter` | `true` | a shelter |

### `bus-line`

Buses that run along the streets from stop to stop. Geometry: `stops`, the ids of bus stops (or
bus terminals) in the order they are served.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `number` | `""` | line number on buses and signs (empty: the name, else the number in the id) |
| `color` | `"#0A777F"` | colour of the route and of the stripe on the buses |
| `headway_s` | `240` | time between buses outside the rush hours (simulated seconds); more often in the rush hours, none at night |
| `mode` | `"back-and-forth"` | `back-and-forth` (in order, then in reverse) or `loop` (round, back to the first stop) |
| `speed_kmh` | `40` | top speed |
| `show_route` | `true` | draw the route |

### `track`

Geometry: `points` (polyline along the centre of a real track). Over the camera image it is not drawn unless "Tracks" is switched on in the View panel (the real track is in the image); the flyover draws the track itself (ballast, sleepers, rails) unless the orthophoto shows it. Used to place trains reported as "track + offset" by the control system.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `track_id` | `""` | name of the track in the control system |
| `offset_start_mm` | `0` | the offset the control system reports at the first point |

### `tabletop`: table module

Geometry: `position` (centre). A rectangular base plate whose top is the layout plane, with an 18 mm edge. In the editor (Build → Table) drag from one corner to the opposite one, or tap both corners; in the flyover the corners snap to the grid. Duplicate puts the copy right beside the original.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `kind` | `"extension"` | `extension`: a virtual table module beside the real table, drawn over the camera image too (it covers the floor there) and in the flyover; `physical`: the outline of a real table of the lab, only drawn in the flyover |
| `width_mm`, `depth_mm` | `1000`, `600` | size along its x and y axis |
| `rotation_deg` | `0` | |
| `surface` | `"grey"` | `grey` (light grey), `white`, `green` (model grass) |

Without a `physical` table module, the flyover draws a light-grey default table around the markers, the objects (except those on table extensions) and the orthophoto, with a margin of 100 mm.

### `label`

Geometry: `position`. Parameters: `text`, `style` (`board`: station name board on posts, `floating`: text only), `height_m` (3).

### Objects from plugins

Plugins add their own types (the example plugins add `windmill`). If a layout contains a type that is not registered, the object is kept unchanged when the layout is saved, and the app reports the missing plugin.

## `simulations`

A list of `{"type": ..., <settings>}`. Built in:

| Type | Settings |
| --- | --- |
| `passengers` | `base_rate` (0.5 people per second per 25 m of platform at normal demand), `max_per_area` (140), `enabled` (true) |
| `traffic` | `cars_per_km` (20 cars per km of street at normal daytime traffic), `enabled` (true): cars on the streets, see [Streets, bus lines and road traffic](streets-and-buses.md#road-traffic) |

Plugins can add more, e.g. `{"type": "road-traffic", "cars_per_km": 30, "speed_kmh": 40}`.

## Validation

The app and `validateLayout()` report duplicate or missing IDs, unknown types and malformed marker poses. The tests check the example layouts, so a broken example layout fails CI.
