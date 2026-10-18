# Day and night: the clock and the town

ARail runs a **fast clock** (a *Modellbahnuhr*) next to the simulation. It drives the lighting
(dawn, day, dusk, night), the timetables (rush hours, no service at night) and the **town
simulation**: residents of the layout's houses go to work, to school and shopping and come home
again, on foot, by bus and by train.

## The clock

Movement (trains, buses, cars, people) runs in *simulated seconds*: the Speed buttons in
Settings → Simulation set how many simulated seconds pass per real second (1×–30×). The clock shows a
time of day that runs `factor` times faster than the simulation, 12 by default: one clock hour
per five simulated minutes. A walk of 150 m (about two simulated minutes) takes 25 clock minutes,
and at 10× a whole day passes in twelve minutes.

| Layout field | Default | Meaning |
| --- | --- | --- |
| `clock.start` | `"07:00"` | time of day when the layout is opened |
| `clock.factor` | `12` | clock seconds per simulated second (1 = real time) |
| `clock.profiles` | `true` | timetables, road traffic and passenger numbers follow the time of day |

```json
"clock": { "start": "06:30", "factor": 12, "profiles": true }
```

In the app (**Settings → Simulation → Time of day**) you can set the time with the slider or the presets
(morning, noon, evening, night), choose another fast-clock ratio, switch the day/night lighting
off and stop the clock. The time is shown at the top left of the stage (*07:32*, with *· night*
between sunset and sunrise).

### Light

Sunrise is at 06:00 and sunset at 20:30, each with a twilight of about an hour and a half. At
night the camera image and everything ARail draws get darker and bluer (towards the chair's
Dunkelblau); lit windows, street lamps, head- and tail lights and the windows of trains and
buses keep their brightness. Labels and the editor's markings are never darkened. Switch it off
with **Day and night lighting** (Settings → Simulation) or `world.settings.lighting = false`.

### Demand over the day

With `clock.profiles`, services and traffic follow these factors (1 = normal daytime level;
the timetable settings such as "A train every 70 s" are the off-peak intervals):

| Time | Trains and buses | Cars | Random passengers |
| --- | --- | --- | --- |
| 01:00–04:30 | no service | 0.15 | almost none |
| 06:30–08:30 | 1.5 | up to 1.4 | 1.6 |
| 09:00–15:30 | 1 | 1 → 1.2 | 1 |
| 16:00–18:30 | 1.4 | up to 1.5 | 1.5 |
| 21:00–24:00 | trains 0.6 → 0.4, buses 0.5 → 0.3 | 0.5 → 0.15 | 0.5 → 0.3 |

The profiles are in `core/clock.js` (`PROFILES`); plugins can read `world.clock.demand(kind)`.

## The town simulation

Add it to the layout's simulations (it needs residential buildings; the passenger simulation
handles the stops):

```json
"simulations": [{ "type": "passengers" }, { "type": "town", "people_per_100": 12 }, { "type": "traffic" }]
```

### Who lives in the town

Every residential building (Plattenbau, Altbau block, single-family houses and estates, the
generic building with `"use": "residential"`) has residents according to its size and floors:
60 % workers, 15 % pupils, 25 % seniors and others at home by day. The other buildings do not
bring people of their own. Their jobs, school places and shop visits are **places**, and the
residents fill them first:

1. Each worker takes a job, each pupil a school place, each adult who shops a shop visit, within
   reach of the home, the nearest first. Within reach means in the local area (`catchment_m`,
   1500 m) or on a bus or tram line between stops within 300 m of both. A place is taken once.
2. Only the balance crosses the edge of the town, by train. Workers without a job in the town work
   elsewhere, and so do `commuters_out` (15 %) of the others anyway. Pupils without a school place
   go to school elsewhere. Of the jobs, school places and shop visits the residents leave empty,
   `commuters_in` (60 %) are taken by people from elsewhere.
3. Without platforms nobody comes or goes: the workers and pupils without a place stay at home by
   day, and empty places stay empty.

So an office or a supermarket among the homes adds nobody: its jobs and visits go to the residents
(and fewer commute). The same office far from any home, or a big school in a small town, draws
people in by train. The card of a building says how many of its places the town takes, how many
people from elsewhere, and how many stay empty. A shop takes 28 half-hour visits a day per visitor
place (`capacity().visitors`) at a fifth full.

The town shows `people_per_100` people per 100 real people (12 by default; at most `max_people`, which
scales residents and people from elsewhere alike). They are:

| Role | Who | Day |
| --- | --- | --- |
| worker | workers with a job in the town | leaves 06:30–08:00 for the job; back 15:30–17:30, sometimes via the supermarket |
| commuter | workers without a job in the town, and `commuters_out` of the others | walks or takes the bus to the station at 05:45–07:45 and leaves by train; comes back on a train between 16:00 and 18:30 |
| commuter (school) | pupils without a school place in the town | to the station at 06:30–07:15, back on a train between 13:00 and 15:30 |
| pupil | pupils with a school place | to school at 07:00–07:40, home at 12:30–15:00 |
| senior / at home | 25 % (and, without platforms, those without a place) | shopping in the morning (half of them) and sometimes in the afternoon |
| visitor | `commuters_in` of the empty jobs, school places and shop visits | by train: to work at 06:30–09:00, back at 15:30–18:00; to school at 06:45–07:30, back at 12:30–15:00; to a shop between 08:00 and 18:00 for 30–75 minutes |

Some adults go shopping in the evening. Shops are open 07:00–21:00, schools 07:30–15:30. Without
shops nobody goes shopping. Every day gets new, reproducible plans (from the world's random seed).

### What the town needs: trains, buses, trams and other passengers

From the same numbers the town tells the stops what it needs:

- **How often vehicles run.** For the platforms: half the morning trips by train (commuters,
  pupils and visitors, who spread over about two hours) and the busiest hour's share of the
  other trips (0.3 trips by train a resident and day: errands, leisure, visits), shared by the
  platform tracks. For a bus or tram line: the long ways of the morning (longer than
  `walk_max_m`) between two of its stops, by `bus_share`. For the bays of a bus terminal: 0.2 trips by
  bus a resident and day. The interval is the longest of 5, 10, 15, 20, 30 and 60 clock minutes
  whose vehicles carry that at a comfortable 70 % (a regional train 140 people, a bus 49, a tram
  4.2 per metre of its length), with the rush-hour frequency (× 1.5). A small town gets a train an
  hour on each track and a bus every half hour. This holds for platforms, bays and lines without a
  `headway_s` of their own, while `services.auto_interval` is true (the default); a set interval
  stays. The card of a stop shows each interval, and says so when it is what the town needs.
- **Other passengers.** People the town's agents do not stand for (errands, leisure, visits,
  changes between train and bus) come to the stops from the residents: 0.3 trips a day by train
  for each resident (shared by the platforms), 0.2 by bus or tram for the residents within 300 m
  of a stop, at the scale of the town's people, over the day as the clock's profile says. As many
  get off a vehicle as came to the stops in its interval. The card of a stop shows them an
  hour. Without a town, the passenger simulation's `base_rate` applies.

### How they travel

- **Walking** over the street network, on the sidewalks: a street on the side they come from,
  crossing at right angles at a zebra crossing on the way or where they must; never over a track
  except on a street or footpath over it. Where the streets do not connect start and goal, they
  walk out of sight. Without any streets people walk straight. A bike that comes too close on the
  sidewalk (or a shared path) makes them angry for a while.
- **Bus or tram**: a way longer than `walk_max_m` (150 m) is taken by bus or tram with probability
  `bus_share` (80 %; pupils and seniors a little more often) when a bus or tram line connects a stop
  within 300 m of the start with a stop within 300 m of the destination, and it is not much slower
  than walking. People wait at the stop, board only their line, ride, get off at their stop and walk
  on. Nobody waits longer than 20 clock minutes, or a little longer than the interval of what they
  wait for (an hourly train is worth waiting for): then they walk (or go home instead of taking
  the train).
- **Train**: commuters go to the nearest platform and take the next train on either side. A
  long way to the platform is taken by bus like any other (see above): to a stop near the
  platform, e.g. the station's bus terminal, and on foot to the platform. Visitors and returning
  commuters get off arriving trains (up to 30 per train) and walk, or take the bus when it is far,
  to work, school, home or the shop. Riders whose stop is taken off the line get off at the next stop.

While people are inside a building they are not drawn; the building lights its windows at night
when people are in (`world.occupancy`).

### Colours

People in the town are coloured by the purpose of their trip, in the chair's corporate-design
colours: **to work** Türkis, **to school** Orange, **shopping** Gelb, **home** Brillantblau,
**to the train** Rot. Other passengers at platforms and stops keep the mood colours (Türkis = happy,
Gelb = so-so, Rot = annoyed). **Settings → Simulation → Town → Colour of people** switches between both, or
everybody by purpose or by mood. The Town section also counts who is at home, at work, at school,
shopping, on the bus, at stops and away.

### Settings

| Field | Default | Meaning |
| --- | --- | --- |
| `people_per_100` | 12 | people shown per 100 residents |
| `max_people` | 300 | upper limit (phones); scales residents and visitors alike |
| `walk_max_m` | 150 | longest walk (prototype metres) before the bus is preferred |
| `bus_share` | 0.8 | share of long ways taken by bus when a line fits |
| `catchment_m` | 1500 | local area (prototype metres): places this close to a home, or on a line from near it, are its residents' first |
| `commuters_out` | 0.15 | share of workers who work elsewhere (by train) although there are jobs; those without a job in the town work elsewhere too |
| `commuters_in` | 0.6 | share of the jobs, school places and shop visits left empty that people from elsewhere take (by train); a value above 1 from an older layout (people per 100 local jobs) is read as hundredths |
| `shopping` | 0.5 | share of adults who go shopping on a day |

Setting the clock by hand puts everybody where their plan says they are at that time. When the
town is worked out again during the day (a building, a setting, the platforms or the stops of a
line changed), everybody who is still there carries on where they are, also on the way, at a stop
or on a bus; only the people the change adds are placed where their plan says, and only those it
takes away leave.

## For plugins: handing people over at stops

The passenger simulation can take care of people of other simulations at stops, so waiting,
boarding and alighting look the same for everybody (the full API is in [Extending
ARail](extending.md#handing-people-over-at-stops)):

```js
const pax = world.simulations.find((s) => s.constructor.type === "passengers");
// wait at a stop area for line "bus-line-1" at a given dock
const person = pax.enter(areaId, { agent: myAgent, dockId, line: "bus-line-1", at: [x, y] });
// let agents get off a vehicle standing at a dock
pax.alight(vehicle, dock, [agentA, agentB]);
pax.release(person); // give up waiting and walk to the exit
world.events.on("passenger.boarded", ({ agent, vehicle, dock }) => { /* on the vehicle now */ });
world.events.on("passenger.exited", ({ agent, pos }) => { /* left the stop at pos (layout mm) */ });
world.events.on("passenger.removed", ({ agent }) => { /* dropped (cleared, stop deleted) */ });
```

Agents with a `colour` property are drawn in that colour (people colour "auto"/"purpose").
`drawPerson(view, [x, y], {dir, speed, phase, height, colour})` draws a person like the built-in
simulations do. `world.setTime("06:30")` jumps the clock and emits `clock.set`.
