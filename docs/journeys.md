# Journeys: travellers with travel plans

An exercise for the railway operations lab: instead of a town full of generated people, **every
attendee makes one traveller** with a start and an aim, asks for **travel plans with transfers**
and chooses one. Then everybody follows their traveller on the layout: it walks to the bus stop or
the platform, waits, gets on, changes at the station, rides out to a station beyond the layout or
comes in from one. What a traveller meets on the way is what the operations do: a train held at the
platform makes it late, a cancelled one makes it wait for the next of its line, a tight change breaks
with a few minutes of delay. At the end the results compare the planned and the real arrivals.

The journeys are a simulation (`{"type": "journeys"}` in the layout's `simulations`), offered as the
module **Journeys** of the lab example. The exercise and its **Journeys** tab are on the **game page**
(`game/`); the app's **Journeys** tab tells a traveller's story to click through instead,
[the journeys story](#the-journeys-story) on Bf Neustadt (see
[Getting started](getting-started.md#the-game-page)).

## The journeys story

`app/?layout=../layouts/ebl-neustadt.json&layers=journeys#journeys` opens Bf Neustadt (the layout of
the lab survey of 9 October 2026) with its module **Journeys**. The **Journeys** tab tells a
traveller's view of the station in eleven steps. Ada, a student, has an exam in Altstadt at 09:30;
her plan is RB 31 (Bergheim – Neustadt – Talsee) at 07:42 from platform 1 and, in Talsee, the RE 3
at 08:10 to Altstadt, there at 08:46.

| Step | What happens on the layout |
| --- | --- |
| 1. Ada sets off | Ada (taller than everybody, in Brillantblau, in an Orange ring with her name) leaves her flat in the WBS 70 on Bahnhofstraße at 07:30 and walks along the sidewalk to the station; the camera looks from the street at her front door. |
| 2. The departure board | She stops at the station's entrance: the departure board (Abfahrtstafel) shows RB 31 to Talsee at 07:42, platform 1; her phone shows her plan. |
| 3. On platform 1 | She walks through the underpass (out of sight, her name goes along) to platform 1 and waits beside its display (Zugzielanzeiger): RB 31 Talsee 07:42, on time. Her track G1 is kept free for her train. |
| 4. RB 31 is 20 minutes late | At 07:38 the display changes and the platform shows the delay (a level crossing fault near Bergheim); RB 31 will leave at 08:02. |
| 5. The connection in Talsee is lost | Her app: RB 31 reaches Talsee at 08:24, the RE 3 leaves at 08:10; the next one is in Altstadt at 09:46, 60 minutes late, after the start of her exam. |
| 6. Her app finds a bus | The express bus 270 (PlusBus) from the bus station Neustadt Bf at 07:48, in Altstadt at 08:58; her ticket of the transport association is valid on it. The way to the bus is drawn on the layout. |
| 7. To the bus station | Back through the underpass and along Bahnhofstraße to bay B of the bus station. The bus station's bays are kept free for her bus from now on. |
| 8. Bus 270 leaves with Ada | The bus comes up Marktstraße and along Bahnhofstraße into the bus station, stops at bay B, Ada and the other travellers get on, and it leaves the way it came. |
| 9. Meanwhile: RB 31 comes in | At 08:02, 20 minutes late, RB 31 stops at track G1: the people waiting there get on, others get off. Whoever changes in Talsee now waits there an hour. |
| 10. Ada in Altstadt: her journey in numbers | Her whole way on the layout (walked dashed, by bus solid) and a card: planned 07:42 → 08:46, real 07:48 → 08:58 by bus (12 minutes late), had she waited 08:02 → 09:46 (60 minutes late). |
| 11. Her rights as a passenger | The card of the passenger rights (Fahrgastrechte): what counts is the delay at the destination, a missed connection included; from 20 minutes another train, from 60 minutes 25 % of the fare back, from 120 minutes 50 %, paid from 4 €; had she waited, 25 %. The transport association's mobility guarantee (Mobilitätsgarantie): from 20 minutes a taxi, up to 30 €. |

**Back**, **Next**, a step from the list, **Play** and **Start again**; a presenter's clicker works too
(Page Down, Page Up). Every step looks the same each time it is shown. **Camera follows** opens the
flyover and keeps its camera with Ada, her bus and the late train, and shows her whole way at the
end; her walk from home it sees from the street, facing her front door (from the other side the
houses would hide her), everything else facing the station's front. Each step sets the clock to its
time when the clock is more than five minutes away (07:30 when she leaves, 08:00 when the late train
comes in, 08:58 at the end), the first step as soon as the story begins, so the clock of the page and
the times of the story agree; the cards at the end never set it back.

While the story keeps a track or a bay for its own train or bus, the timetable's trains and buses
keep off it: track G1 from step 3 to step 9, both bays of the bus station in steps 7 and 8 (her bus
drives through bay A to bay B). It does so with the stories' disruption *story-train* (with the
passengers waiting for the story's train and bus), hidden in the Disruptions tab and quiet: the
platform shows its message, a bay says nothing, and the top bar counts it only while it has a message. When the story's train or bus stops and leaves, it tells the world as
the timetable's vehicles do, so the passengers waiting there get on and others get off; going to
another step while it stands at its dock lets it leave, so nobody is left walking to its doors.

The story is the simulation `journeys-story` in the layer's `simulations`:

```json
{"type": "journeys-story", "name": "Ada's journey", "traveller": "Ada", "home": "plattenbau-1", "track": "track-g1", "bus_terminal": "bus-terminal-1", "delay_min": 20}
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `traveller` | `Ada` | Her name. |
| `home` | `plattenbau-1` | The building she leaves from (one with an entrance; else the layout's first). |
| `track` | `track-g1` | The track of her train at a platform; she waits on that platform, the track is kept free for her train. |
| `bus_terminal` | `bus-terminal-1` | The bus station; her bus stops at its last bay. |
| `bus_street` | `road-marktstrasse` | The bus comes in and leaves by the end of this street at the edge of the layout (else by the ends nearest to the bus lane). |
| `delay_min` | `20` | The delay of her train, 10 to 90 minutes: the times of the texts, the RE she would wait for and the refund follow it (from 64 minutes she would be 120 minutes late: 50 %). |
| `steps` | | The steps retold: `[{"id": "late", "title": "…", "text": "…"}]` over the built-in ones (ids `home`, `board`, `platform`, `late`, `connection`, `alternative`, `walk`, `bus`, `train`, `arrive`, `rights`). |

The lines, the times, Talsee, Bergheim and Altstadt and the bus are invented; the rules of the
passenger rights are those of the EU regulation 2021/782 as Germany applies them, simplified (no
exceptions for force majeure; season tickets have rules of their own). A mobility guarantee is
offered by many German transport associations, each with its own conditions; the story's is an
example.

## Running the exercise

1. Open the lab example on the game page and switch on the module **Journeys** (Overview → Modules, or
   `game/?layout=../layouts/ebl-lab.json&layers=journeys#journeys`). The town's residents stay at
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

- **walk** over the road network: sidewalks, footpaths and the underpass, at the traveller's own
  walking speed (1.34 m/s for an adult without aids or luggage, see below);
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

### What the traveller is like

A traveller is an adult without aids or luggage unless its maker chooses otherwise: its **age**
(child, adult, old), a **walking aid** (walking stick, rollator, wheelchair, pram) and its
**luggage** (light, heavy, bulky). These are the characteristics of every person of the
simulations ([Passenger mobility](day-and-night.md#passenger-mobility)): an old traveller with a
rollator walks at 1.34 × 0.83 × 0.46 ≈ 0.5 m/s and takes 3 s at a level door, 9 s where there is a
step of 20 cm. The planner plans with them: the walks at its speed, getting off at its pace. A
**wheelchair user** only gets plans it can take: a train only from and to platforms with level
boarding (the platform as high as the train's floor at the doors) or where the station's staff help
at that hour, a bus or tram only at stops whose step its ramp bridges. So a plan that is fine for one
traveller may not exist for another.

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
  on, and a bus driver waits a little for a traveller at the door. People go through a door one
  after the other, at their own pace; a vehicle that is full, or has no free wheelchair place, or
  cannot take a wheelchair at that stop, leaves the traveller behind ("Could not get on S 8: the
  vehicle was full"): it waits for the next one.
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

From door to door the trip is recorded in its parts (clock minutes): **walk** (to the first and from
the last vehicle), **wait** (at the stop, beyond the layout, outside a closed stop), **at the doors**
(getting on and off), **ride** and **transfer** (the walks between two vehicles), each next to its
planned value. The card of a traveller shows them; the results and their CSV have them for
everybody, so the debriefing can compare where the time went, e.g. for an old traveller with a
suitcase and one without.

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

## The Journeys tab of the game page

- **New traveller**: name, from, to, leaves at, transfer time, its age, walking aid and luggage;
  **Find travel plans** lists the plans
  with their legs (walks, buses with their headway, trains with their platform and arrival, the time
  for each change); **Choose** makes the traveller.
- **Travellers**: per traveller its number and colour (as on the layout), what it is doing, the
  planned and expected arrival, **Show** (follow it in the flyover; again to stop), **Start again**,
  **Remove**, and its plan and log.
- **Results**: planned and real arrival, the delay and the missed trains of everybody, the minutes
  from door to door (planned in brackets) and how they were spent; CSV (with every part, planned
  and real);
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
      "id": "t1", "name": "Ada", "number": 1, "colour": "#C85000", "profile": {"age": "adult", "aid": "none", "luggage": "heavy"},
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

A traveller has its `id`, `name`, `number` and `colour`, its `profile` (`age`: `child`, `adult`,
`old`; `aid`: `none`, `stick`, `rollator`, `wheelchair`, `pram`; `luggage`: `none`, `light`,
`heavy`, `bulky`; an adult without any by default), its start and aim (`{"kind": "building" |
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
const profile = { age: "old", aid: "rollator", luggage: "heavy" };
const plans = journeys.plan({ from, to, leave: "07:20", transfer: 3, profile });
const ada = journeys.addTraveller({ name: "Ada", from, to, plan: plans[0], profile });
journeys.status(ada);   // {text, tone, planned, expected, delay}
journeys.results();     // one row per traveller, with its characteristics and the parts of its trip
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
- Step-free ways on foot are not planned yet: a wheelchair user walks the underpass like everybody
  (lifts and ramps on the way are [#66](https://github.com/joernmht/ARail-EBL/issues/66)).
- Beyond the layout the trains are only times: there is nothing to see of them.
