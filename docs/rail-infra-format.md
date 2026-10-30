# The format rail-infra/1: railway infrastructure as plain data

`rail-infra/1` describes the infrastructure of a railway, or of a part of one, as a JSON file: tracks,
platforms, signals, switches and the other elements, the operating points, the table modules or rooms
they stand on, and labels. It is the common ground of ARail and the EBL's digital twin:

- **ARail** writes it from a layout (`layoutToInfra`, `web/arail/plan/infra.js`), and draws any file of
  it as a plan sheet in its [plan documents](plan-documents.md).
- **The EBL's digital twin** (`ebl_twin/infra.py` in the lab's own repository) writes it from the lab
  files: the schematic **track plan** in kilometre order and the **hall plan**, every track where it
  stands in the lab. Its server hands both out at `/api/infra?frame=plan|hall`.

Later integrations (an API between the twin and ARail, other labs, GIS) can build on the same
keys. The format is deliberately small: what a plan needs, and the keys that tie it to a control system.

## Shared keys

| What | Key | In ARail | In the EBL's twin |
| --- | --- | --- | --- |
| A track in the control system | `track` | the track's `track_id` (`G16`) | the lab's track string (`"24"`, *Strecke 24*), as the Zentralrechner reports a train position |
| A place on a track | `track` + `km` | (not known yet) | the line kilometre of the lab software |
| An operating point | `operating_points[].id`, `elements[].op` | (not known yet) | the station's abbreviation: `IN` Neustadt, `IW` Waldhof, `IA` Adorf, … |
| An element | `name` | the object's name (`Exit signal N1`) | the name in the lab data (`ASig 3N1`, `W60`) |
| An interlocking | `interlocking` | (the object of type `interlocking`) | the signal box (`ESTW IW`, `GsIISp IA`) |

The plan view shows a signal's name without its kind (`N1`, `3N1`). Matching the two sides element by
element is the next step: an ARail layout of a part of the EBL names its operating point and the lab's
track strings and kilometres; then a train the Zentralrechner reports at (track, km) can be placed on
ARail's camera image directly.

## The file

```json
{
  "format": "rail-infra/1",
  "name": "EBL track plan",
  "source": {"generator": "ebl_twin", "owner": "EBL, TU Dresden", "file": "Labordateien/IEL-Normal.str", "date": "2026-10-30"},
  "frame": {"id": "ebl-track-plan", "unit": "lane", "note": "schematic track plan in kilometre order"},
  "operating_points": [{"id": "IW", "name": "Waldhof", "kind": "station", "km": [33.525, 36.548], "box": [1092.4, -19.4, 1188.3, -3.6]}],
  "tracks": [{"id": "p12", "name": "Strecke 10", "track": "10", "points": [[1092.4, -4], [1188.3, -4]], "kms": [33.5, 36.5]}],
  "platforms": [{"id": "pl.10.12.0", "name": "p1", "tracks": ["10"], "points": [[1100, -3.7], [1105, -3.7], [1105, -3.3], [1100, -3.3]]}],
  "elements": [{"id": "10.31", "type": "signal", "kind": "main", "side": "right", "name": "ASig 3N1", "op": "IW", "track": "10", "km": 35.324, "dir": -1, "at": [1150.2, -4.6], "heading_deg": 180}],
  "areas": [],
  "labels": []
}
```

| Field | Meaning |
| --- | --- |
| `format` | `"rail-infra/1"` |
| `name` | the title of the plan |
| `source` | where it came from: `generator` (`arail`, `ebl_twin`), `owner`, `file`, `date`, and optionally `number` and `revision` (the drawing number and its revision in the title block); `unplaced`: how many objects of the source could not be placed (ARail: objects on markers that are not in the marker map, such as moving markers) |
| `frame` | the coordinate system of all points: `id`, `unit` (`mm`, or `lane` for a schematic plan: one lane is the distance of two tracks), `scale` (the model scale, 87 for H0, when the unit is model mm), `lane_mm` (what a lane is on the layout, if anything), `note` |
| `operating_points` | stations, block posts, halts: `id`, `name`, `kind`, `km` ([from, to]), `at` (a point) or `box` ([x0, y0, x1, y1], the station limits), `interlocking` |
| `tracks` | `id` (unique), `name`, `track` (the name in the control system; pieces of one track share it), `points` (the centre line), `kms` (the line kilometre of each point, if known), `kind` (`link`: a switch connection), `virtual` (not on the real layout), `hidden` (under the table, e.g. the staging yard), `level` |
| `platforms` | `id`, `name`, `number`, `tracks` (the tracks at its edges), `points` (its outline) |
| `elements` | `id`, `type` (below), `name`, `at` (a point) and `heading_deg` (counter-clockwise from x: for a signal the direction of the trains it applies to, for a switch the track's direction), or `points` (linear elements); `track`, `km`, `dir` (+1 with the kilometres, −1 against them), `op`, `interlocking`; per type: a signal's `kind` and `side` (`right`, `left` of the track), a switch's `hand` (`left`, `right`: where its branch goes), `to` (`{track, km}`: the branch) and `length_m`, a speed sign's `speed_kmh`; `real` (the object is real in the lab) |
| `areas` | `id`, `kind` (`table`, `room`), `name`, `points` (the outline), `holes` (outlines inside it, e.g. the middle of a ring of tables), `virtual` |
| `labels` | `id`, `text`, `at` |

Points are `[x, y]` in the frame's unit, `y` pointing up (in the hall frame of the survey: towards the
windows). Every `id` is unique in the file, across all lists.

### Element types

| `type` | What | German |
| --- | --- | --- |
| `signal` | `kind`: `main`, `distant`, `combined` (main signal with the distant signal of the next), `shunting`, `block` | Signal (Hauptsignal, Vorsignal, Mehrabschnittssignal, Rangiersignal, Blocksignal) |
| `switch` | a switch (turnout) | Weiche |
| `buffer-stop` | the end of a track | Prellbock |
| `km-post` | a kilometre post | Hektometertafel |
| `stop-board` | where trains stop at a platform | Haltetafel |
| `speed-sign` | a change of the permitted speed | Geschwindigkeitssignal (Lf) |
| `level-crossing` | | Bahnübergang |
| `balise` | a balise group or a PZB magnet | Balise / Gleismagnet |
| `train-protection` | a change of train protection, an LZB/ETCS block marker | Zugbeeinflussung |
| `derailer` | | Gleissperre |
| `catenary-end` | | Fahrleitungsende |
| `section-insulator` | | Streckentrenner |
| `swing-bridge` | | Drehbrücke |
| `system-change` | where traction power or train protection change | Systemwechsel |
| `interlocking`, `passenger-display`, `gsmr-mast`, `lift`, `maintenance-base` | buildings and equipment | Stellwerk, Zugzielanzeiger, GSM-R-Mast, Aufzug, Instandhaltungsstützpunkt |
| `catenary`, `cable-route` | linear (`points`) | Oberleitung, Kabelkanal |
| `other` | anything else | Sonstiges |

A new type is added in both places: `ELEMENT_TYPES` in `web/arail/plan/infra.js` (with its symbol in
`drawing.js` and its German label in `web/arail/i18n/de/plan.js`, which the German column above
follows) and `ELEMENT_OF` in the twin's `ebl_twin/infra.py`.

## What ARail and the twin write

| | ARail (`layoutToInfra`) | Twin, track plan | Twin, hall plan |
| --- | --- | --- | --- |
| `frame` | `layout`, mm (model mm from the origin marker), `scale` | `ebl-track-plan`, lanes: x 32 lanes per km, widened in stations; the staging yard below | `ebl-hall`, mm in the hall frame of the survey of 9 October 2026, `scale` 87; good to 1–2 m |
| tracks | `track` objects; `track` = `track_id` | the pieces of the lab's tracks with their kilometres; switch connections as `link` | the same, wound round the hall; the S-Bahn's line |
| elements | signals, switches, balises, level crossings, interlockings, displays, masts, lifts, maintenance bases, overhead lines, cable routes, system changes | every signal, switch, buffer stop, stop board, speed sign, balise, train protection point, derailer, end of catenary, section insulator, swing bridge, system change of the lab files, at its kilometre | the same, placed by their kilometre along their track |
| platforms | `platform` objects as outlines | from the stop boards and their platform side | – |
| areas | table modules (`virtual` unless physical) | – | the two rings of tables (the hall; room 06, schematic) |
| operating points | – | stations (with their limits) and block posts | stations, block posts and the S-Bahn's stops |

`infraProblems(doc)` (ARail) and `infra.check(doc)` (twin) check a file by the same rules: the
format, the frame's unit, lists of objects with unique ids, points and an element's numbers (`km`,
`heading_deg`, `length_m`, `speed_kmh`) that are numbers, an operating point's `km` as [from, to], `kms` with one number per point, element types of the
vocabulary, and that every `track` an element names is a track of the file. They never throw,
whatever the file holds. `cleanInfra(doc)` is what of a file can be drawn: the plan sheet and the DXF
draw that, so a file with mistakes is drawn as far as it can be.
