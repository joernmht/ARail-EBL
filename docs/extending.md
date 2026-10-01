# Extending ARail

ARail is built to be extended without touching its core: **plugins** add object types, simulations, disruption types and vehicle kinds. A plugin is a plain ES module; there is no build step and no framework.

```js
// web/plugins/my-plugin.js
export default function register(arail) {
  // `arail` is the public API (web/arail/index.js)
  arail.registry.registerObject(MyObjectClass);
  arail.registry.registerSimulation(MySimulationClass);
  arail.registry.registerDisruption(myDisruptionDefinition);
  arail.registry.registerVehicle(myVehicleDefinition);
}
```

A layout loads its plugins by URL, relative to the layout file (same origin only):

```json
{ "plugins": ["../plugins/windmill.js", "../plugins/road-traffic.js"] }
```

There are two example plugins in [`web/plugins/`](../web/plugins): [`windmill.js`](../web/plugins/windmill.js) (an object type with animation; the EBL lab example loads it for the windmill in its fields) and [`road-traffic.js`](../web/plugins/road-traffic.js) (a simulation, a much simpler version of the built-in `traffic`). Read them next to this guide.

In your own page or a test, load the API and call the plugin yourself:

```js
import * as ARail from "../arail/index.js";
import registerMine from "./my-plugin.js";
registerMine(ARail);
const world = ARail.createWorld(layoutJson);
```

## Units and coordinates

- Layout coordinates are **model millimetres** on the layout plane, z up (mm).
- Sizes of virtual things are usually given in **prototype metres**; convert with `view.m(metres)` (drawing) or `this.mm(metres)` / `this.meters(mm)` (objects).
- Simulations work in prototype metres and **simulated seconds** (`dt` in `step(dt)`). The time of day comes from the fast clock (`world.clock`, see [below](#time-of-day)).

See [Architecture](architecture.md#coordinate-systems) for all frames.

## Colours and type

The app follows the corporate design (CD) of the Chair of Railway Operations. Use these exports instead of hard-coded colours, so that plugins fit in:

| Export | Contents |
| --- | --- |
| `CD` | the CD colours: `tuerkis` `#0A777F` (main colour), `brillantblau` `#00008C`, `rot` `#D20F41`, `orange` `#C85000` (accent), `gelb` `#FFC700` (diagrams and details), `dunkelblau` `#001450`, `black`, `white` |
| `CD_LIGHT` | lighter variants for dark backgrounds and lines over the camera image: `tuerkis` `#36b8bf`, `orange` `#f0922e`, `rot` `#ff667e` |
| `OVERLAY` | colours of what is drawn over the layout: `label` (Dunkelblau board), `labelText`, `status` (Gelb status line), `alert`, `sign` (Türkis badge), `busStop` (the green of the German "H" sign), `selection` (Orange), `tracked`, `trackedFill`, `danger` (Rot), `dangerLabel` |
| `FONT` | the canvas font family (Noto Sans with system fallbacks): `ctx.font = \`700 ${12 * view.px}px ${FONT}\`` |
| `PALETTE` | colours of the built-in objects, e.g. `train` (Türkis), `bus` (Gelb), `litWindow` (warm light at night), `signBlue` (Türkis; the name is kept for plugins) |
| `grey(v)` | a neutral grey, 0 = black … 1 = white (buildings are greyscale, like a white architectural model) |
| `moodColor(m)` | the mood scale Rot (0, annoyed) → Gelb (0.5) → Türkis (1, happy) |
| `rgba`, `mix`, `shade`, `parseColor`, `parseRgba` | colour helpers |

The roles follow the CD's 60/30/10 rule: Türkis for signs and badges, Dunkelblau for label boards, Orange for what the user is working on (selection, placing), Rot for disruptions.

## Object types

Extend `LayoutObject`, describe the parameters, compute the geometry, draw it.

```js
export default function register(arail) {
  const { LayoutObject, resolvePoint, rectFootprint, registry, CD, grey } = arail;

  class Kiosk extends LayoutObject {
    static type = "kiosk";                 // used in layout files
    static label = "Kiosk";                // shown in the editor
    static category = "Scenery";           // palette group
    static placement = "point";            // how the editor places it, see below
    static description = "A small newspaper kiosk.";
    static params = [
      { key: "name", label: "Name", type: "text", default: "" },
      { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
      { key: "color", label: "Colour", type: "color", default: CD.tuerkis },
    ];

    computeGeometry() {                    // called when the spec, the marker map or the scale changes
      const c = resolvePoint(this.world.map, this.spec.position);
      if (!c) return null;                 // null = cannot be placed (yet)
      const angle = (this.spec.rotation_deg * Math.PI) / 180;
      return { center: c, footprint: rectFootprint(c, this.mm(3), this.mm(2), angle) };
    }

    footprint() {                          // for selecting and dragging in the editor
      return this.geometry?.footprint ?? null;
    }

    draw(view) {                           // only called when this.geometry is not null
      view.prism(this.geometry.footprint, 0, view.m(2.6), { side: this.spec.color, top: grey(0.85) });
    }
  }

  registry.registerObject(Kiosk);
}
```

### Static fields

| Field | Meaning |
| --- | --- |
| `type`, `label`, `description` | name in layout files, name and tooltip in the editor |
| `category` | palette group: `Transport`, `Buildings`, `Scenery`, `Infrastructure`, `Table` (in this order), or a new group of your own (shown after them) |
| `placement` | how the editor places a new object, and what it writes into the spec (below) |
| `params` | the editable parameters (below) |
| `background` | `true`: picked only at its edges unless selected, so that a drag over it pans the flyover (table modules) |
| `stopTypes` | for placement `stops`: the object types that can be tapped (default `["bus-stop", "bus-terminal"]`) |

| Placement | The user | The spec gets |
| --- | --- | --- |
| `point` | taps once | `position` (and `rotation_deg` of the nearest platform, if the type has that parameter) |
| `segment` | taps two ends (a tap on a marker anchors the end to it) | `between: [a, b]` or `from` / `to` |
| `polygon` | taps the corners, then Finish | `points` |
| `polyline` | taps the points, then Finish | `points` |
| `rect` | drags from one corner to the opposite one, or taps both | `position` (centre), `width_mm`, `depth_mm`, `rotation_deg: 0` |
| `stops` | taps stop objects in order, then Finish | `stops: [objectId, ...]` |

The editor builds the settings form from `params`. Parameter types: `number`, `text`, `select` (with `options: [[value, label], ...]`), `boolean`, `color`, `marker` (a marker ID), `object` (an object ID, optionally filtered with `objectType`). Use unit suffixes in keys (`_mm`, `_m`, `_s`, `_deg`) and add `help` texts where a value needs explaining. A parameter called `rotation_deg` gives the object the rotate buttons and the keys R / Shift+R.

### What `LayoutObject` gives you

| Member | Purpose |
| --- | --- |
| `this.spec` | the object's entry in the layout file, with defaults filled in |
| `this.world` | the world (see below) |
| `this.geometry` | cached result of `computeGeometry()` (recomputed when the spec, the marker map or the scale change) |
| `this.mm(m)`, `this.meters(mm)` | scale conversion |
| `set(patch)` | change parameters; the geometry, stop areas and road network follow, and `object.changed` is emitted |
| `translate(dx, dy)` | move (the default handles `position`, `from`/`to`, `points`) |
| `footprint()`, `contains(p, tol)`, `anchorPoint()` | outline for selection and hit testing, and where labels and the editor handle go |
| `update(dt)` | per-step animation or state (simulated seconds) |
| `stopAreas()` | places where passengers wait and vehicles stop, see below |
| `drawSelection(view)` | highlight in the editor (default: the footprint, dashed Orange) |
| `toJSON()` | the entry written to the layout file (parameters at their default are left out) |

Optional methods the editor and the other parts look for:

| Method | Used by |
| --- | --- |
| `snapPoint()` | the editor: the point that snaps to the grid while the object is dragged. Without it, the first point drawn (`points[0]` or `from`) snaps, else `anchorPoint()`. Table modules return a corner, so their edges stay on grid lines. |
| `duplicateOffset()` | the editor's **Duplicate**: where the copy goes (`[dx, dy]` mm; default 5 prototype metres in x and in y). Table modules put the copy right beside the original. |
| `problems()` | the inspector: a list of texts shown in red (e.g. "Not next to a street") |
| `roadInfo()` | the road network: the object is a street (`{points, width, sidewalk, speed, car, ...}`, see `objects/road.js`) |
| `entrances()` | the road network and the town: doors `[{pos: [x, y], dir: [ux, uy]}]` |
| `busLane()` | the road network: a one-way lane for buses (`{points, width}`, see `objects/bus-terminal.js`) |

Geometry helpers from the API: `resolvePoint`, `resolvePoints`, `resolveSegment` (they understand `[x, y]` and marker-relative points), `translatePoint`, `pointRelativeTo`, `markersUsed(spec)` (the markers an object is placed relative to), plus the maths in `core/math.js` (vectors, polygons, polylines, poses, random numbers) and `snapToGrid`.

### Buildings

New building types extend `BuildingBase` (from `objects/building-kit.js`): it draws, lights the windows at night and answers the questions of the town simulation. The geometry is built with a `BuildingModel` in a local frame in **prototype metres** (x along the building, y across, z up; the street front is the local −y side, so at `rotation_deg` 0 the building faces −y):

```js
export default function register(arail) {
  const { BuildingBase, TONES, capacityFor, grey, registry } = arail;

  class CornerShop extends BuildingBase {
    static type = "corner-shop";
    static label = "Corner shop";
    static use = "shop";                   // residential | work | school | shop | other
    static params = [
      { key: "name", label: "Name", type: "text", default: "" },
      { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
      { key: "width_m", label: "Width", type: "number", unit: "m", min: 8, max: 40, step: 1, default: 16 },
    ];

    computeGeometry() {
      const m = this.model();              // frame at `position`, turned by `rotation_deg`; null if not placed
      if (!m) return null;
      const w = +this.spec.width_m / 2, d = 6, h = 4.5;
      const body = m.box(-w, -d, w, d, 0, h, { wall: m.wallTone(), top: grey(TONES.flatRoof) });
      for (let s = 1; s + 2.5 < 2 * w; s += 3.5) m.window(body.walls[0], s, s + 2.5, 0.6, 3.2, { group: "shop" });
      m.part(body.faces);
      m.shadow(m.rect(-w, -d, w, d), h);
      m.entrance(0, -d);                   // a door on the front
      return m.finish({ footprint: m.rect(-w, -d, w, d), height: h, capacity: capacityFor("shop", 4 * w * d) });
    }
  }

  registry.registerObject(CornerShop);
}
```

| `BuildingBase` | Meaning |
| --- | --- |
| `static use`, `use()` | what the building is for; `use()` returns the `use` parameter if the type has one |
| `capacity()` | `{residents, jobs, pupils, visitors}` in real people (from `finish({capacity})`; `capacityFor(use, floorArea)` gives typical values) |
| `entrances()` | the doors on the street front (`m.entrance(x, y)`); the road network connects them to the nearest street |
| `floorsCount()`, `heightMM()` | for the town and for drawing |
| `occupancy()` | 0 … 1: from the town simulation (`world.occupancy`, building id → people inside), else a typical value for the use and the time of day |
| `model()`, `seed()` | a `BuildingModel` at the object's position; the seed (from the id and a `seed` parameter, if any) varies the greys and which windows are lit |

`BuildingModel` builds faces and details: `box`, `wall`, `face`, `decal` and `band` (details on a face, in three tiers: always, with the windows, only close up), `window` (lights up at night; group `"main"` follows the occupancy, `"shop"` the shop hours), `part` (a group of faces drawn as one solid; `after` and `facing` for things on or in front of it), `shadow`, `plate` and `line` (on the ground), `entrance`, `setAnchor` (level of detail per house of an estate) and `finish`. Roof helpers: `gableRoof`, `hipRoof`, `parapetRoof`, `blockPiece` (perimeter blocks), `sawtoothRoof`. Keep to the white-model look: `grey()` tones between about 0.45 and 1 (see `TONES`); lit windows are the only colour. Windows are left out when they would be smaller than about 1.5 px on the screen. [`objects/houses.js`](../web/arail/objects/houses.js) has the built-in types as examples.

### Drawing with the view

`draw(view)` does not paint directly: it queues operations, which the view sorts (ground first, then 3D objects far to near, then labels) and draws over the camera image.

| Method | Draws |
| --- | --- |
| `view.polygon(points, style)` | a flat polygon on the layout (`style`: `fill`, `stroke`, `width` in CSS px, `alpha`, `dash`, `z`, `order`, `layer: "overlay"`, `emissive`) |
| `view.line(points, style)` | a line on the layout |
| `view.ribbon(points, widthMM, style)` | a band of constant width along a line (platform edges) |
| `view.prism(footprint, z0, z1, colors)` | a vertical prism, shaded and back-face culled (`colors`: `side`, `top`, `alpha`, `outline`) |
| `view.faces(faces, ref, style)` | any set of 3D faces (`{pts, normal, color, alpha, twoSided, emissive, decals}`) as one solid |
| `view.label([x, y, z], text, style)` | a sign or text anchored at a layout point; labels avoid overlapping each other |
| `view.glow([x, y, z], radiusMM, colour, strength)` | a soft light (lamp, headlight), drawn only at night |
| `view.lightPool([x, y], radiusMM, colour, strength)` | light falling on the ground (under a street lamp), only at night |
| `view.ground(order, fn)`, `view.solid(depth, fn)`, `view.overlay(fn)` | custom drawing with the canvas context: `fn(ctx, view)` |

Useful helpers: `view.project(x, y, z)` (image pixels or `null` if behind the camera), `view.depth(x, y, z)`, `view.pxPerMM(x, y, z)` (image scale, to size billboards and for the level of detail), `view.inImage(x, y, z)`, `view.m(metres)`, `view.px` (canvas pixels per CSS pixel), `view.time` (for animation), and `prismFaces`, `rectFootprint` from the API.

**Day and night.** `view.night` (0 = day … 1 = night) is set by `World.draw` from the clock (0 while the lighting is switched off); `view.darkness` is the same value clamped to 0 … 1. At night the view darkens the camera image and every ground and solid item towards Dunkelblau. Colours marked `emissive: true` (polygons, faces, decals) keep their brightness: lit windows, lamps, headlights. Labels and overlays are never darkened. In your own canvas code (`view.ground`, `view.solid`) use `view.dim(colour, amount)` for colours that should darken, and draw lights with `view.glow` and `view.lightPool`.

**Virtual camera.** In the flyover there is no camera image: `view.virtual` is true and objects also draw what is real in the lab (a platform its surface, a track its sleepers and rails, a real table its top). `view.showsReal(points)` is true where the real lab is visible anyway: always over the camera image, and in the flyover where the orthophoto (`view.groundPhoto`) covers all the points. A `View` for your own virtual camera takes the camera pose as an option (`pose`, as returned by `FlyCamera.homography()`); otherwise it recovers the pose from `H`.

### Stops for passengers

An object becomes a stop by returning `StopArea`s: a rectangle with local coordinates `s` (along, 0…L) and `t` (across, ±W/2) in prototype metres, and **docks** along its long edges where vehicles stop.

```js
stopAreas() {
  const g = this.geometry;
  return [new arail.StopArea({
    id: this.id, owner: this, kind: "tram",
    origin: g.start, dir: g.direction, lengthMM: g.length, widthMM: g.width, scale: this.world.scale,
    docks: [{ id: `${this.id}:stop`, side: -1, kind: "tram", label: "Tram stop", headway: 120, dwell: 20 }],
  })];
}
```

The passenger simulation, the services (timetable, calls, control-system feed) and the disruptions work with any stop area, so a new stop type needs no further code. A dock's `kind` selects the vehicle renderer: register a vehicle of the same kind (below), otherwise docks get trains (or buses for `bus`). A dock with `managed` set (e.g. `"line"`) is served by something else than the timetable: the services leave it alone (bus stops and the bays that bus lines use).

## Simulations

Extend `Simulation`. It is created from an entry in the layout's `simulations` list, e.g. `{"type": "road-traffic", "cars_per_km": 30}`, which arrives in `this.config` (with defaults from `params`). `this.enabled` is false when the entry says `"enabled": false`.

```js
class Pigeons extends arail.Simulation {
  static type = "pigeons";
  static label = "Pigeons";
  static params = [{ key: "count", label: "Pigeons per platform", type: "number", default: 5 }];

  constructor(world, config) {
    super(world, config);
    this.flock = new Map();
    this.off = world.events.on("vehicle.arrived", ({ area }) => this.scare(area.id));
  }
  step(dt) { /* move pigeons around each world.stopAreas() entry */ }
  draw(view) { /* view.solid(...) for each pigeon */ }
  scare(areaId) { /* pigeons fly up when a train arrives */ }
  dispose() { this.off(); }       // unsubscribe when the layout is reloaded
}
arail.registry.registerSimulation(Pigeons);
```

Optional: `stats(areaId)` returns `{count, mood, inPerMin, outPerMin}` for the departure board, `clear()` removes everything simulated (Simulate → Clear passengers), and `roadUsers()` returns the vehicles a simulation drives on the streets (`[{vehicle, front, rear, dir, approach}]`): line buses and the road traffic keep their distance to them and give way at junctions.

### Handing people over at stops

The passenger simulation can take care of the people of other simulations at stops, so that waiting, boarding and alighting look the same for everybody (the town simulation does this):

```js
const pax = world.simulations.find((s) => s.constructor.type === "passengers");
// wait at a stop area, here only for the buses of one line at one dock
const person = pax.enter(areaId, { agent: myAgent, dockId, line: "bus-line-62", at: [x, y] });
// let agents get off a vehicle standing at a dock
pax.alight(vehicle, dock, [agentA, agentB]);
pax.release(person);   // give up waiting and walk to the nearest exit
pax.removeAgents();    // drop all agents silently (e.g. before placing everybody anew)
world.events.on("passenger.boarded", ({ agent, vehicle, dock, area }) => { /* on the vehicle now */ });
world.events.on("passenger.exited", ({ agent, pos, area }) => { /* left the stop at pos (layout mm) */ });
world.events.on("passenger.removed", ({ agent }) => { /* dropped (cleared, stop deleted) */ });
```

`enter()` options: `agent` (your object, returned in the events), `dockId` (wait at this dock; without it any dock), `line` (board only vehicles with this `lineId`), `anyDock`, `at` (where the person comes from), `mood`. An agent with a `colour` property is drawn in that colour while people show trip purposes (Simulate → Town → Colour of people).

To draw people like the built-in simulations do: `drawPerson(view, [x, y], {dir, speed, phase, height, colour, legs})` (a figure with a shadow, half as dark at night). Texts for boards come from `statusLines(world, area)` (all status texts of a stop area, the most important first), `dockStatus(world, area)` (its first line) and `boardStatus(world, areas, max)` (the lines of a stop's board over all its areas). Below `BOARD_MIN_PX` (60 CSS px) on the screen the built-in boards shrink to a badge.

### World API

| Member | Purpose |
| --- | --- |
| `world.objects`, `getObject(id)`, `addObject(spec)`, `removeObject(id)` | the layout objects |
| `world.objectsVersion` | counts object changes (for caches of derived data) |
| `world.stopAreas()`, `getStopArea(id)` | all stop areas with their docks |
| `world.services` | timetable vehicles: `call(target)`, `vehicles()`, `forArea(areaId)`, `doors(vehicle)`, `placement(vehicle)` |
| `world.network()` | the road network of the streets: places, routes, sidewalks, lanes (see [Streets, bus lines and road traffic](streets-and-buses.md#for-plugins-and-simulations)) |
| `world.transit` | bus lines in operation: `lines`, `connections(fromAreaId, toAreaId)`, `vehicleAt(dockId)`, `statusFor(dockId)`, `buses` |
| `world.clock`, `world.setTime(t)`, `world.night()` | the time of day (below); `night()` is the darkness used for drawing (0 when the lighting is off) |
| `world.occupancy` | `Map` building id → people inside, written by the town simulation |
| `world.disruptions` | `start(spec)`, `stop(id)`, `active`, `effectsFor(area)` |
| `world.scenarios` | `play(id)`, `stop()` |
| `world.trains` | trains reported by the control system |
| `world.map` | the marker map (`MarkerMap`: poses, `locked`, `moving`) |
| `world.events` | the event bus: `on(name, fn)` returns an unsubscribe function |
| `world.time`, `speed`, `paused`, `demand`, `scale`, `rng` | simulation state; use `world.rng` (or `createRng(seed)`) for reproducible randomness, never `Math.random` |
| `world.settings` | display settings: `labels`, `trails`, `showTracks`, `feedVehicles`, `lighting` (day/night lighting on), `peopleColour` (`auto`, `purpose`, `mood`) |

### Time of day

`world.clock` is the fast clock (`core/clock.js`; see [Day and night](day-and-night.md)):

| Member | Purpose |
| --- | --- |
| `minutes`, `hours`, `day`, `label()` | time of day (minutes after midnight), days since the start, `"07:32"` |
| `factor`, `frozen` | clock seconds per simulated second; true while the clock is stopped |
| `daylight()`, `night()` | 0 … 1, with a smooth twilight around sunrise (06:00) and sunset (20:30) |
| `demand(kind)` | demand factor for `"rail"`, `"bus"`, `"car"` or `"passengers"` (1 = normal daytime level; 0 at night for rail and bus; 1 when profiles are off) |
| `set(t)`, `secondsUntil(t)` | jump to `"HH:MM"` (or minutes); simulated seconds until the clock shows `t` |

Use `world.setTime("06:30")` rather than `clock.set`: it also emits `clock.set`, so simulations can put their people where they belong at that time. `formatTime`, `parseTime`, `profileAt` and `PROFILES` are exported too.

### Events

| Event | Payload |
| --- | --- |
| `vehicle.arriving`, `vehicle.arrived`, `vehicle.departing`, `vehicle.departed`, `vehicle.cancelled` | `{vehicle, dock, area}` (timetable vehicles and line buses) |
| `passenger.boarded` | `{agent, person, vehicle, dock, area}` |
| `passenger.exited` | `{agent, person, pos, area}` |
| `passenger.removed` | `{agent, person}` |
| `clock.day` | `{day}` at midnight |
| `clock.set` | `{minutes}` after `world.setTime()` |
| `disruption.started`, `disruption.ended` | `{disruption}` |
| `scenario.started`, `scenario.ended`, `scenario.message` | `{scenario, text}` |
| `object.added`, `object.changed`, `object.removed` | `{object}` |
| `layout.loaded` | `{layout}` |
| `feed.status`, `feed.trains` | `{status, error}`, `{trains}` |

Please prefix your own events with your plugin's name.

## Tracking: moving markers

Markers listed in `markers.moving` (e.g. stickers on container wagons) are never part of the marker map. The tracker reports where they are seen in every frame, as the groundwork for virtual loads on real vehicles:

```js
const state = tracker.update(detections, time, camera);
for (const [id, m] of Object.entries(state.moving)) {
  // m.corners: image corners (px); m.center: [x, y] on the layout plane (mm) or null without a pose;
  // m.heading: direction of the marker's x axis in the layout frame (radians) or null
}
```

A marker on a vehicle lies above the layout plane, so `center` is shifted away from the camera by its height. `world.map.locked`, `lock()`, `unlock()`, `setMoving(ids)` and `detectionCodes(codes)` are the marker map's side of Keep positions and the Moving markers field.

## Disruption types

A disruption type is a definition object. Its `effects` are what services and simulations react to (see [Disruptions and scenarios](disruptions-and-scenarios.md#effects)).

```js
arail.registry.registerDisruption({
  type: "heat",
  label: "Heat wave",
  description: "Passengers get uncomfortable faster; fewer people travel.",
  targets: "any",                                  // "rail", "bus" or "any"
  params: [{ key: "minutes", label: "Duration", type: "number", unit: "min", default: 20 }],
  duration: (p) => p.minutes * 60,                 // seconds, or null = until stopped
  effects: (d, area, world) => ({ mood: -0.01, demand: 0.7, messages: ["Heat wave"] }),
  // optional: appliesTo(area, d, world), draw(view, d, world), onStart(d, world), onStop(d, world)
});
```

## Vehicle kinds

```js
arail.registry.registerVehicle({
  kind: "tram",
  width_m: 2.65, height_m: 3.6, floor_m: 0.3, gap_m: 0.3, overhang_m: 0,
  extent: (dock) => [dock.s1 - 32, dock.s1],                       // where it stands along the dock (m)
  doors: (dock) => [dock.s1 - 28, dock.s1 - 18, dock.s1 - 8],      // door positions for boarding (m)
  draw(view, vehicle, place) { /* place: {s0, s1, t0, t1} in stop-area metres */ },
});
```

See `core/vehicles.js` for the built-in train and bus. Line buses (`core/transit.js`) use the bus's `extent` and `doors`, so passengers board them like any other bus.

## Testing plugins

The framework runs in Node.js too (without the camera), so plugins can be tested with `node --test`. See [`tests/js/world.test.js`](../tests/js/world.test.js): it loads the example plugins, creates a world from a layout, runs the simulation for a few simulated minutes and checks the results. [`tests/js/houses.test.js`](../tests/js/houses.test.js) draws buildings through a fake canvas.

## Contributing a plugin

Generally useful object types, simulations and disruptions are welcome as contributions, either as plugins in `web/plugins/` or as built-ins. Lab-specific ones (e.g. an adapter for one control system) are best kept in your fork. See [CONTRIBUTING.md](../CONTRIBUTING.md).
