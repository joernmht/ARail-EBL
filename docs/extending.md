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

The example layout does exactly this with the two example plugins in [`web/plugins/`](../web/plugins): [`windmill.js`](../web/plugins/windmill.js) (an object type with animation) and [`road-traffic.js`](../web/plugins/road-traffic.js) (a simulation). Read them next to this guide.

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
- Simulations work in prototype metres and **simulated seconds** (`dt` in `step(dt)`).

See [Architecture](architecture.md#coordinate-systems) for all frames.

## Object types

Extend `LayoutObject`, describe the parameters, compute the geometry, draw it.

```js
export default function register(arail) {
  const { LayoutObject, resolvePoint, rectFootprint, registry } = arail;

  class Kiosk extends LayoutObject {
    static type = "kiosk";                 // used in layout files
    static label = "Kiosk";                // shown in the editor
    static category = "Scenery";           // palette group: Transport, Scenery, Infrastructure, ...
    static placement = "point";            // point | segment | polygon | polyline | stops
    static description = "A small newspaper kiosk.";
    static params = [
      { key: "name", label: "Name", type: "text", default: "" },
      { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
      { key: "color", label: "Colour", type: "color", default: "#2f6f9f" },
    ];

    computeGeometry() {                    // called when the spec or the marker map changes
      const c = resolvePoint(this.world.map, this.spec.position);
      if (!c) return null;                 // null = cannot be placed (yet)
      const angle = (this.spec.rotation_deg * Math.PI) / 180;
      return { center: c, footprint: rectFootprint(c, this.mm(3), this.mm(2), angle) };
    }

    footprint() {                          // for selecting and dragging in the editor
      return this.geometry?.footprint ?? null;
    }

    draw(view) {                           // only called when this.geometry is not null
      view.prism(this.geometry.footprint, 0, view.m(2.6), { side: this.spec.color, top: "#dddddd" });
    }
  }

  registry.registerObject(Kiosk);
}
```

The editor builds the settings form from `params`. Parameter types: `number`, `text`, `select` (with `options: [[value, label], ...]`), `boolean`, `color`, `marker` (a marker ID), `object` (an object ID, optionally filtered with `objectType`). Use unit suffixes in keys (`_mm`, `_m`, `_s`, `_deg`) and add `help` texts where a value needs explaining.

What `LayoutObject` gives you:

| Member | Purpose |
| --- | --- |
| `this.spec` | the object's entry in the layout file, with defaults filled in |
| `this.world` | the world (see below) |
| `this.geometry` | cached result of `computeGeometry()` |
| `this.mm(m)`, `this.meters(mm)` | scale conversion |
| `set(patch)` | change parameters (updates the editor, stop areas and saving) |
| `translate(dx, dy)` | move (the default handles `position`, `from`/`to`, `points`) |
| `update(dt)` | per-step animation or state (simulated seconds) |
| `stopAreas()` | places where passengers wait and vehicles stop, see below |
| `drawSelection(view)` | highlight in the editor (default: the footprint) |
| `toJSON()` | the entry written to the layout file |

Geometry helpers from the API: `resolvePoint`, `resolvePoints`, `resolveSegment` (they understand `[x, y]` and marker-relative points), `translatePoint`, `pointRelativeTo`, plus the maths in `core/math.js` (vectors, polygons, polylines, poses, random numbers).

### Drawing with the view

`draw(view)` does not paint directly: it queues operations, which the view sorts (ground first, then 3D objects far to near, then labels) and draws over the camera image.

| Method | Draws |
| --- | --- |
| `view.polygon(points, style)` | a flat polygon on the layout (`style`: `fill`, `stroke`, `width` in CSS px, `alpha`, `dash`, `z`, `order`, `layer: "overlay"`) |
| `view.line(points, style)` | a line on the layout |
| `view.ribbon(points, widthMM, style)` | a band of constant width along a line (roads, platform edges) |
| `view.prism(footprint, z0, z1, colors)` | a vertical prism, shaded and back-face culled (`colors`: `side`, `top`, `alpha`, `outline`) |
| `view.faces(faces, ref, style)` | any set of 3D faces (`{pts, normal, color, alpha, twoSided, decals}`) as one solid |
| `view.label([x, y, z], text, style)` | a sign or text anchored at a layout point; labels avoid overlapping each other |
| `view.ground(order, fn)`, `view.solid(depth, fn)`, `view.overlay(fn)` | custom drawing with the canvas context: `fn(ctx, view)` |

Useful helpers: `view.project(x, y, z)` (image pixels or `null` if behind the camera), `view.depth(x, y, z)`, `view.pxPerMM(x, y, z)` (image scale, to size billboards), `view.m(metres)`, `view.px` (canvas pixels per CSS pixel), `view.time` (for animation), and `prismFaces`, `rectFootprint` from the API.

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

The passenger simulation, the services (timetable, calls, control-system feed) and the disruptions work with any stop area, so a new stop type needs no further code. A dock's `kind` selects the vehicle renderer: register a vehicle of the same kind (below), otherwise docks get trains (or buses for `bus`).

## Simulations

Extend `Simulation`. It is created from an entry in the layout's `simulations` list, e.g. `{"type": "road-traffic", "cars_per_km": 30}`, which arrives in `this.config` (with defaults from `params`).

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

Optional: `stats(areaId)` returns `{count, mood, inPerMin, outPerMin}` for the departure board, `clear()` removes everything simulated.

### World API

| Member | Purpose |
| --- | --- |
| `world.objects`, `getObject(id)`, `addObject(spec)`, `removeObject(id)` | the layout objects |
| `world.stopAreas()` | all stop areas with their docks |
| `world.services` | vehicles: `call(target)`, `vehicles()`, `forArea(areaId)`, `doors(vehicle)`, `placement(vehicle)` |
| `world.disruptions` | `start(spec)`, `stop(id)`, `active`, `effectsFor(area)` |
| `world.scenarios` | `play(id)`, `stop()` |
| `world.trains` | trains reported by the control system |
| `world.network()` | the road network of the streets: places, routes, sidewalks, lanes (see [Streets, bus lines and road traffic](streets-and-buses.md#for-plugins-and-simulations)) |
| `world.transit` | bus lines in operation: `lines`, `connections(fromAreaId, toAreaId)`, `vehicleAt(dockId)`, `statusFor(dockId)`, `buses` |
| `world.events` | the event bus: `on(name, fn)` returns an unsubscribe function |
| `world.time`, `speed`, `paused`, `demand`, `scale`, `rng` | simulation state; use `world.rng` for reproducible randomness |
| `world.settings` | display settings (`labels`, `trails`, `showTracks`, `feedVehicles`) |

### Events

| Event | Payload |
| --- | --- |
| `vehicle.arriving`, `vehicle.arrived`, `vehicle.departing`, `vehicle.departed`, `vehicle.cancelled` | `{vehicle, dock, area}` |
| `disruption.started`, `disruption.ended` | `{disruption}` |
| `scenario.started`, `scenario.ended`, `scenario.message` | `{scenario, text}` |
| `object.added`, `object.changed`, `object.removed` | `{object}` |
| `layout.loaded` | `{layout}` |
| `feed.status`, `feed.trains` | `{status, error}`, `{trains}` |

Please prefix your own events with your plugin's name.

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

See `core/vehicles.js` for the built-in train and bus.

## Testing plugins

The framework runs in Node.js too (without the camera), so plugins can be tested with `node --test`. See [`tests/js/world.test.js`](../tests/js/world.test.js): it loads the example plugins, creates a world from a layout, runs the simulation for a few simulated minutes and checks the results.

## Contributing a plugin

Generally useful object types, simulations and disruptions are welcome as contributions, either as plugins in `web/plugins/` or as built-ins. Lab-specific ones (e.g. an adapter for one control system) are best kept in your fork. See [CONTRIBUTING.md](../CONTRIBUTING.md).
