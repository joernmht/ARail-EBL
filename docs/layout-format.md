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
| `view.image` | | example image shown when the layout is opened (relative to the layout file) |

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

### `building`

Geometry: `position` (centre).

| Parameter | Default | Meaning |
| --- | --- | --- |
| `rotation_deg` | `0` | |
| `width_m`, `depth_m` | `12`, `9` | footprint |
| `floors` | `2` | |
| `floor_height_m` | `3` | |
| `roof` | `"gable"` | `gable` or `flat` |
| `color`, `roof_color` | `#e2d3b8`, `#9b4a3c` | |
| `windows` | `true` | |

### `tree`

Geometry: `position`. Parameters: `kind` (`deciduous`, `conifer`), `height_m` (12), `color` (crown colour; empty = default).

### `forest`

Geometry: `points` (polygon), filled with trees. Parameters: `kind` (`mixed`, `deciduous`, `conifer`), `height_m` (14), `spacing_m` (8, average distance between trees), `seed` (1, change it for another arrangement). At most about 400 trees are drawn.

### `area`

Geometry: `points` (polygon). A coloured area: `kind` (`grass`, `field`, `water`, `sand`, `parking`, `plaza`, `forest`), `opacity` (0.55).

### `road`

Geometry: `points` (polyline). Parameters: `kind` (`road`, `path`), `width_m` (7). Roads wider than 5 m get a centre line. The example plugin `road-traffic` drives cars on them.

### `track`

Geometry: `points` (polyline along the centre of a real track). Not drawn unless "Tracks" is switched on in the View panel. Used to place trains reported as "track + offset" by the control system.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `track_id` | `""` | name of the track in the control system |
| `offset_start_mm` | `0` | the offset the control system reports at the first point |

### `label`

Geometry: `position`. Parameters: `text`, `style` (`board`: station name board on posts, `floating`: text only), `height_m` (3).

### Objects from plugins

Plugins add their own types (the example plugins add `windmill`). If a layout contains a type that is not registered, the object is kept unchanged when the layout is saved, and the app reports the missing plugin.

## `simulations`

A list of `{"type": ..., <settings>}`. Built in:

| Type | Settings |
| --- | --- |
| `passengers` | `base_rate` (0.5 people per second per 25 m of platform at normal demand), `max_per_area` (140), `enabled` (true) |

Plugins can add more, e.g. `{"type": "road-traffic", "cars_per_km": 30, "speed_kmh": 40}`.

## Validation

The app and `validateLayout()` report duplicate or missing IDs, unknown types and malformed marker poses. The tests check the example layouts, so a broken example layout fails CI.
