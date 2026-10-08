# Journeys: travellers with travel plans

An exercise for the railway operations lab: instead of a town full of generated people, **every
attendee makes one traveller** with a start and an aim, asks for **travel plans with transfers**
and chooses one. Then everybody follows their traveller on the layout: it walks to the bus stop or
the platform, waits, gets on, changes at the station, rides out to a station beyond the layout or
comes in from one. What a traveller meets on the way is what the operations do: a train held at the
platform makes it late, a cancelled one makes it wait for the next of its line, a tight change breaks
with a few minutes of delay. At the end the results compare the planned and the real arrivals.

The journeys are a simulation (`{"type": "journeys"}` in the layout's `simulations`), offered as the
module **Journeys** of the lab example.

## Running the exercise

1. Open the lab example and switch on the module **Journeys** (View → Modules, or
   `app/?layout=../layouts/ebl-lab.json&layers=journeys#journeys`). The town's residents stay at
   home and no other passengers come; the trains run to the timetable.
2. Set the time of day (Settings → Simulation → Time of day, e.g. 07:00) and pause (Space) while the travellers
   are made.
3. Each attendee, in the **Journeys** tab: a name (or the one offered), **From** and **To** (a
   building of the town or a station beyond the layout), **Leaves at** and the **transfer time**,
   then **Find travel plans** and **Choose** one of them. The traveller gets a number and a colour.
4. Resume. **Show** follows a traveller with the flyover's camera; its box says what it is doing
   ("Waiting for S 8 → Waldau 07:41 at Platform 2", "On RE 1 to Bahnhof, arrives 08:59").
5. Disturb the operations: the Disruptions tab (switch on the module **Disruptions**) holds or cancels the trains at a platform; with the
   module **Rail operations** on as well, drivers call in sick and units fail.
6. Talk about the **Results**: who arrived when, how late, how many trains were missed or cancelled;
   **Download results (CSV)** for the debriefing.
7. Again: **Start all again** and set the clock back to before the first departure.

The travellers are kept with the layout (in the browser, and in the file with Build → Export
layout), so a prepared exercise can be handed out as a layout file.

## The example

The module **Journeys** of [`web/layouts/ebl-lab.json`](../web/layouts/ebl-lab.json) has three
simulation entries:

```json
"simulations": [
  {"type": "passengers", "patch": true, "others": false},
  {"type": "town", "patch": true, "enabled": false},
  {"type": "journeys", "name": "EBL regional network", "transfer_min": 3, "stations": ["…"], "lines": ["…"]}
]
```

The first two are [patches](layout-format.md#layers) of the base's simulations: no other passengers
at the stops, and the town switched off while the module is on (the box *Generated people too* in
the Journeys tab brings them back). The journeys have the network of the rail operations: the
station **Bahnhof** with platforms 1 and 2 and four lines out to stations beyond the layout, **RE 1**
to Altstadt (47 min, hourly), **RB 33** to Bergheim (35 min, hourly), **S 2** to Talsee (25 min) and
**S 8** to Waldau (24 min), both every 30 minutes. The RE and the RB stop at platform 1, the S-Bahn
lines at platform 2; the underpass links the platforms with each other and with both sides of the
tracks. The town's two bus lines, 62 and 85, run round the town from the bus station Bahnhof.

The module can be combined with the others: with **Rail operations** the travellers take the trains
of the operations, with their delays and cancellations; with **Infrastructure** faults at the station
hold the trains.

## Places and travel plans

A traveller goes from a **building** of the layout (one with an entrance: houses, the school, the
office, the station building, …) or a **station beyond the layout** to another one. The planner
looks for ways with these legs:

- **walk** over the road network: sidewalks, footpaths and the underpass, at 1.3 m/s;
- **bus**: a bus line from a stop near the start to a stop near the aim, directly or with one change
  of buses. Buses run at a headway, not to a timetable, so the planner expects half the headway of
  waiting and the line's average pace: bus times are estimates ("~07:52", "every 13 min");
- **train**: a trip of the timetable, with its planned departure and arrival, directly or with one
  change of trains. Changing at the station on the layout includes the walk from one platform to the
  other.

Walks and buses move on the layout at their real speed while the clock runs faster (1:12 by
default, see [Day and night](day-and-night.md)): in clock minutes they take long. A walk of 100 m
takes about 15 clock minutes, a bus ride from one stop to the next about 8.

The **transfer time** (`transfer_min`, set per traveller) is the least time the plan keeps between
getting to a platform (or off a train or bus) and the next train; the walk off the platform is
counted on top of it. Short transfer times make fast plans that break with a little delay; long
ones are safe but slow.

Plans are ranked by arrival, then by the number of changes and by walking. Up to six are offered;
of each way (the same modes and lines) the next two departures. The fastest plan and the one with
the fewest changes are marked. A time that passed more than half an hour ago is taken as tomorrow's.

## On the way

At its departure time the traveller leaves its building (or, beyond the layout, waits at its station
for its train) and takes its plan leg by leg:

- At a stop it is handed to the passenger simulation, like the town's residents: it walks onto the
  stop, waits near where its vehicle stops and gets on through the doors. It gets on a bus of its
  line, and a train of its line that goes to its station: the planned one, or, if that one left
  without it or is cancelled, the next one of the line ("S 8 08:11 instead of 07:41"). A train or
  bus that already stands there is boarded at once; trains wait a few seconds for people getting
  on, and a bus driver waits a little for a traveller at the door.
- When its train stands at another platform of the station (a change of platforms), it goes over
  there.
- Beyond the layout it rides along the timetable: it arrives at its station at the trip's time plus
  the delay the train had when it left the layout. Coming in, it gets off when its train arrives at
  the platform and leaves the platform by the exit its next walk starts from.
- A stop that is closed: it waits outside and goes in when the stop opens again.

Every step is logged ("07:42 S 8 → Waldau 07:41 from Platform 2", "S 8 07:41 is cancelled. Next:
08:11.", "08:35 Arrived at Waldau, 30 min late"). The box of a traveller shows its state, the planned
arrival and the expected one: from the trains it is on or will catch (the next of its line where it
will miss one) and what is left of its plan.

The journeys themselves are not saved: after loading the layout, every traveller starts again at
its departure time. Setting the clock back to before a traveller's departure starts it again too.

## The trains

Without rail operations the journeys run the trains at the platforms of the stations on the layout
themselves (as the services' planner: the tracks are in mode `plan`, the built-in timetable and the
keys 1–9 leave them alone):

- Every line runs to its timetable (`takt_min` from `first` to `last`, `run_min` to the far end,
  `turn_min` to turn there; the format of the [rail operations](operations.md#layout-file)).
- A train for a trip that starts here comes out of the sidings 4 minutes before it leaves (at a very
  fast clock at least 20 simulated seconds), on one of its line's tracks, and leaves at its time
  when nobody is getting on any more (at most 30 seconds later).
- A train that ends here turns round for its line's next departure when that leaves within 20
  minutes; otherwise it goes to the sidings after its passengers got off.
- Disruptions at the platforms: *Delay* and *Signal failure* hold the trains (they come in and leave
  late), *Cancellations*, *Closure* and *Rail replacement bus* cancel them. The boards show the next
  departures ("S 8 → Waldau 07:41 +3", "RE 1 07:15 cancelled").

With the module **Rail operations** on, its trains run instead (and the journeys plan with their
timetable). With a control system, the travellers take the trains that stop at the platforms by the
name of their line (the feed's `line`, e.g. "S 8").

Without `stations` and `lines`, the network is made from the platforms' line names, as in the rail
operations: every line named on a platform runs out to a station beyond the layout and back.

## The Journeys tab

- **New traveller**: name, from, to, leaves at, transfer time; **Find travel plans** lists the plans
  with their legs (walks, buses with their headway, trains with their platform and arrival, the time
  for each change); **Choose** makes the traveller.
- **Travellers**: per traveller its number and colour (as on the layout), what it is doing, the
  planned and expected arrival, **Show** (follow it in the flyover; again to stop), **Start again**,
  **Remove**, and its plan and log.
- **Results**: planned and real arrival, the delay and the missed trains of everybody; CSV;
  **Start all again**, **Remove all** (a second click does it).
- *Generated people too*: the town's residents and the other passengers on or off.

On the layout a traveller is drawn in its colour with its number and name over it; before it leaves,
a dot at its door shows where it starts. The traveller followed has an orange ring, also in the
underpass.

## Layout file

```json
{
  "type": "journeys",
  "transfer_min": 3,
  "start_weekday": "mon",
  "stations": [{"id": "hbf", "name": "Bahnhof", "platforms": ["platform-1", "platform-2"]}, {"id": "waldau", "name": "Waldau"}],
  "lines": [{"id": "S 8", "route": ["hbf", "waldau"], "run_min": 24, "takt_min": 30, "first": "05:11", "last": "00:11", "turn_min": 6, "docks": {"hbf": ["platform-2:right", "platform-2:left"]}}],
  "travellers": [
    {
      "id": "t1", "name": "Ada", "number": 1, "colour": "#C85000",
      "from": {"kind": "building", "id": "plattenbau-2"}, "to": {"kind": "station", "id": "waldau"},
      "leave": 440, "transfer_min": 3,
      "plan": {"dep": 440, "arr": 485, "transfers": 0, "legs": ["…"]}
    }
  ]
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `transfer_min` | `3` | transfer time offered for new travellers (clock minutes) |
| `start_weekday` | `"mon"` | weekday of the world's first day (lines can run on some days only) |
| `stations`, `lines` | from the platforms | the rail network, as in the [rail operations](operations.md#layout-file): stations with `platforms` are on the layout; lines with `route`, `run_min`, `km`, `takt_min`, `first`, `last`, `turn_min`, `dwell_min`, `days` and `docks` (the tracks at the stations on the layout, the first ones first) |
| `travellers` | `[]` | the travellers made in the app |
| `enabled` | `true` | `false` switches the journeys off |

A traveller has its `id`, `name`, `number` and `colour`, its start and aim (`{"kind": "building" |
"station", "id": …}`), its departure `leave` (minutes after 00:00 of its day), its `transfer_min`
and the `plan` chosen: `dep`, `arr` (minutes, like `leave`) and the `legs`. A leg is
`{"type": "walk", "from", "to", "min", "m"}` (places `{"kind": "building", "id", "entrance"}` or
`{"kind": "area", "id", "access"}`: a building's door or a stop's way in), `{"type": "bus", "line",
"fromArea", "fromDock", "toArea", "toDock", "every"}` or `{"type": "train", "line", "trip", "day",
"from", "to", "area", "toArea"}` (`trip`: the key of the trip in the timetable, e.g. `"S 8:out:5"`;
`day`: its service day relative to the traveller's), each with its planned `dep` and `arr` and the
names shown. The app writes them; a layout file can carry them, e.g. a prepared exercise.

## For plugins and scripts

```js
import { createWorld, journeysOf } from "../arail/index.js";
const world = createWorld(layout);
const journeys = journeysOf(world);
const from = { kind: "building", id: "plattenbau-2" }, to = { kind: "station", id: "waldau" };
const plans = journeys.plan({ from, to, leave: "07:20", transfer: 3 });
const ada = journeys.addTraveller({ name: "Ada", from, to, plan: plans[0] });
journeys.status(ada);   // {text, tone, planned, expected, delay}
journeys.results();     // one row per traveller
```

`plan()` takes `leave` as a time of day or a world time (clock minutes since 00:00 of the world's
day 0) and returns plans with world times. The events `journeys.traveller.added` and
`journeys.traveller.arrived` (`{traveller, delay}`) tell when a traveller is made and when it
arrives. The trains come from `journeys.rail()`: the journeys' timetable or the rail operations'
trips, both as trip records `{id, key, line, name, from, to, stops: [{station, arr, dep}], delay,
cancelled}` in world time.

The journeys use the passenger simulation's hand-over (see [Extending](extending.md#handing-people-over-at-stops)):
`enter()` with `accept`, a function that says which vehicles a person takes.

## Limits

- Buses run at a headway, not to a timetable: their times in a plan are estimates.
- At most one change of trains and one change of buses per plan; a traveller keeps to the lines of
  its plan and does not plan anew (it only takes the next train of its line).
- Everything runs on one device: attendees take turns at the shared screen (or a projector), or
  prepare their travellers in a layout file.
- Beyond the layout the trains are only times: there is nothing to see of them.
