# Streets, bus lines and road traffic

Streets in ARail are a **road network**: streets that meet or cross are connected, people walk on
their sidewalks, and buses and cars drive on them. A **bus line** runs along the streets from bus
stop to bus stop: its buses stop, open their doors, let passengers get off and on, and go on.
**Road traffic** adds cars that come in where streets leave the layout.

## Building it in the app

All three are in **Build → Add to the layout → Transport**.

1. **Street**: tap the points along the street, then **Finish**. A tap near the end or a corner of
   another street (about 12 px) snaps onto it, and a tap on another street puts the point on its
   centre line, so streets connect. Choose the kind in the inspector: *street* (50 km/h),
   *residential street* (30 km/h), *main road* (wider) or *footpath* (people only).
2. **Bus stop**: tap on or next to a street. The stop goes to the nearest point of the street, on
   the **right side** seen in the direction the street was drawn. A line that runs back and forth
   needs stops on **both sides** (*Side: both sides*): buses on the right side drive in the
   drawing direction, on the left side in the other one. A stop that is not next to a street is
   outlined in red and says so in the inspector.
3. **Bus line**: tap the bus stops (or bus terminals) in the order the buses serve them, then
   **Finish**. Taps on anything else are ignored. In the inspector: the line number shown on the
   buses ("62"), its colour, how often a bus runs (*A bus every*, outside the rush hours), *back
   and forth* or *loop*, the top speed, and whether the route is drawn. **Pick the stops again**
   changes the stops. Problems (a stop away from the streets, a stop that buses in one direction
   cannot reach, no way along the streets) are listed in the inspector.

The route of a line is drawn in its colour along the right lane of the streets, with a dot at
each stop. Stop signs and the **Simulate → Stops** board show the next bus, e.g. *Bus 62 to
Station in 6 min* (in clock minutes), *Bus 62 to Station boarding*, or *Bus 62 arrives in
3 min (terminus)* on the side where buses only arrive.

## How the buses run

- The line's route goes over the road network through all stops, on the side of the street in
  the direction of travel. A line *back and forth* serves the stops in order and then in reverse;
  at the ends it turns (a turning loop at a dead end, or round a block). A *loop* runs round.
  A stop on one side only is served in that direction; the inspector says so.
- At the first stop of each direction (the terminus) buses lay over with the doors open until
  their departure. A bus departs every `headway_s` simulated seconds × the time-of-day demand
  (more often in the rush hours, none between 01:00 and 04:30). Buses come in from the depot when
  none is waiting and go back to it when they are not needed (at night).
- Buses accelerate and brake, keep to the speed limit of the street and the line's top speed,
  keep their distance to the vehicle ahead, and give way at junctions to vehicles that are already
  crossing. At a stop the front of the bus stands 1.5 m before the end of the stop, and the doors
  open on the stop side; people get off, then the waiting passengers of this line get on. A bus
  laying over at a stop leaves early when another bus waits behind it.
- Bus lines can also use **bus terminals**: each line serving a terminal gets a bay of its own
  (the lines share the bays in the order of their ids); the terminal's bus lane is connected to
  the nearest streets. Bays that no line uses keep the terminal's own timetable buses.
- Disruptions work on line stops too: a *closure* makes buses pass the stop, a *delay* holds
  them at the stop, *cancellations* cancel departures from a terminus.

## Road traffic

Add the simulation to the layout (Simulate shows nothing to set; edit the layout file):

```json
"simulations": [{ "type": "passengers" }, { "type": "traffic", "cars_per_km": 20 }]
```

Cars enter where streets end (dead ends at the edge of the layout), drive to another street end on
the fastest route (sometimes with a detour), keep to the right lane and the speed limit, keep
their distance to the vehicle ahead (cars and buses), wait before a junction while another
vehicle crosses it or is closer to it (at most 4 s, so nothing gets stuck) and leave the layout
again. Their number is `cars_per_km` per kilometre of street at normal daytime traffic, more in the
rush hours and few at night (`clock.demand("car")`). On streets without dead ends (a ring) cars
appear on the streets and drive from place to place. The example plugin
[`road-traffic.js`](../web/plugins/road-traffic.js) is a much simpler version of this.

## Day and night

Street lamps (every 30 m, alternating sides) and the shelters of bus stops light up at night;
buses and cars switch on their head and tail lights, and the windows of buses are lit.

## Layout file

See [Layout file format](layout-format.md#road) for the parameters of `road`, `bus-stop` and
`bus-line`, and the `traffic` simulation.

## For plugins and simulations

- `world.network()` returns the road network (`core/network.js`), rebuilt when objects, the marker
  map or the scale change. Nodes are at street corners and junctions; edges have `kind` ("road",
  "path", "connector", "lane"), `car`, `bus`, `walk`, `oneway`, `speed` (m/s), `width`,
  `walkOffset` and `laneOffset` (mm). Building entrances (`entrances()`) and stop access points
  are connected to the nearest street within 80 m: `place("building:<id>:<i>")`,
  `place("area:<areaId>:<i>")`. Further: `nearestNode(p, {mode})`, `route(a, b, {mode: "walk" |
  "car" | "bus"})`, `distance(a, b, mode)`, `routeDirected(...)` (vehicles, with U-turn
  penalties), `pathAt(path, s)` → `{point, dir, walkOffset}` (people walk on the right-hand
  sidewalk), `drivingLine(path)` (the right lane), `boundaryNodes()` and `junctions()`. Without
  streets the queries return null.
- Objects take part through methods: `roadInfo()` (a street: points, width, sidewalk, speed,
  offsets), `entrances()` (doors of a building), `stopAreas()` and `busLane()` (a lane for buses).
- `world.transit` (`core/transit.js`): `lines` (id → `{id, label, color, ok, problems, visits,
  directions: [{dir, from, destination, stops, route}], circuit}`), `connections(fromAreaId,
  toAreaId)` → `[{lineId, dir, fromDockId, toDockId, stops, rideMM}]`, `vehicleAt(dockId)`,
  `statusFor(dockId)`, `buses` (each with `kind: "bus"`, `line`, `lineId`, `direction`,
  `destination`, `riders`, `dock`, `phase`, `doorsOpen`). Line buses emit the usual
  `vehicle.arriving`, `vehicle.arrived`, `vehicle.departing` and `vehicle.departed` events with
  `{vehicle, dock, area}` at the stop docks. The town simulation puts its people into `riders`
  and lets them get off when the bus arrives at their stop.
- Docks with `managed` set are left alone by the timetable (`core/services.js`).
- Simulations with vehicles on the streets can expose `roadUsers()` (`[{vehicle, front, rear, dir,
  approach}]`): buses and the traffic simulation keep their distance to them and give way at
  junctions.
