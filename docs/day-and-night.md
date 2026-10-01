# Day and night: the clock and the town

ARail runs a **fast clock** (a *Modellbahnuhr*) next to the simulation. It drives the lighting
(dawn, day, dusk, night), the timetables (rush hours, no service at night) and the **town
simulation**: residents of the layout's houses go to work, to school and shopping and come home
again, on foot, by bus and by train.

## The clock

Movement (trains, buses, cars, people) runs in *simulated seconds*: the Speed buttons in the
Simulate panel set how many simulated seconds pass per real second (1×–30×). The clock shows a
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

In the app (**Simulate → Time of day**) you can set the time with the slider or the presets
(morning, noon, evening, night), choose another fast-clock ratio, switch the day/night lighting
off and stop the clock. The time is shown at the top left of the stage.

### Light

Sunrise is at 06:00 and sunset at 20:30, each with a twilight of about an hour and a half. At
night the camera image and everything ARail draws get darker and bluer (towards the chair's
Dunkelblau); lit windows, street lamps, head- and tail lights and the windows of trains and
buses keep their brightness. Labels and the editor's markings are never darkened. Switch it off
with **Day and night lighting** (Simulate panel) or `world.settings.lighting = false`.

### Demand over the day

With `clock.profiles`, services and traffic follow these factors (1 = normal daytime level;
the timetable settings such as "A train every 70 s" are the off-peak intervals):

| Time | Trains and buses | Cars | Random passengers |
| --- | --- | --- | --- |
| 01:00–04:30 | no service | 0.15 | almost none |
| 06:30–08:30 | 1.5 | up to 1.4 | 1.6 |
| 09:00–15:30 | 1 | 1 | 1 |
| 16:00–18:30 | 1.4 | up to 1.5 | 1.5 |
| from 21:00 | 0.6 → 0.3 | 0.4 → 0.15 | 0.5 → 0.3 |

The profiles are in `core/clock.js` (`PROFILES`); plugins can read `world.clock.demand(kind)`.

## The town simulation

Add it to the layout's simulations (it needs residential buildings; the passenger simulation
handles the stops):

```json
"simulations": [{ "type": "passengers" }, { "type": "town", "people_per_100": 12 }, { "type": "traffic" }]
```

### Who lives in the town

Every residential building (Plattenbau, Altbau block, single-family houses and estates, the
generic building with `"use": "residential"`) has residents according to its size and floors.
The town shows `people_per_100` people per 100 residents (12 by default, at most `max_people`).
They are:

| Role | Share | Day |
| --- | --- | --- |
| worker | the rest | leaves 06:30–08:00 for a job in an office, a factory, a shop or a school; back 15:30–17:30, sometimes via the supermarket |
| commuter | `commuters_out` of the workers (35 %) | walks or takes the bus to the station at 05:45–07:45 and leaves by train; comes back on a train between 16:00 and 18:30 |
| pupil | 15 % | to school at 07:00–07:40, home at 12:30–15:00 |
| senior / at home | 25 % | shopping in the morning (half of them) and sometimes in the afternoon |
| visitor | `commuters_in` per 100 local jobs (40) | comes by train at 06:30–09:00 to work in the town and leaves by train at 15:30–18:00 |

Some adults go shopping in the evening. Shops are open 07:00–21:00, schools 07:30–15:30. Without
platforms nobody commutes by train, without schools there are no pupils, and without shops
nobody goes shopping. Every day gets new, reproducible plans (from the layout seed).

### How they travel

- **Walking** over the street network, on the sidewalk on their right-hand side. Without streets
  people walk straight.
- **Bus**: a way longer than `walk_max_m` (150 m) is taken by bus with probability `bus_share`
  (80 %; pupils and seniors a little more often) when a bus line connects a stop within 300 m of
  the start with a stop within 300 m of the destination, and the bus is not much slower than
  walking. People wait at the stop, board only their line, ride, get off at their stop and walk
  on. Nobody waits longer than 20 clock minutes: then they walk (or go home instead of taking
  the train).
- **Train**: commuters walk to the nearest platform and take the next train on either side.
  Visitors and returning commuters get off arriving trains (up to 14 per train).

While people are inside a building they are not drawn; the building lights its windows at night
when people are in (`world.occupancy`).

### Colours

People in the town are coloured by the purpose of their trip, in the chair's corporate-design
colours: **to work** Türkis, **to school** Orange, **shopping** Gelb, **home** Brillantblau,
**to the train** Rot. Other passengers at platforms and stops keep the mood colours (Türkis = happy,
Gelb = so-so, Rot = annoyed). **Simulate → Town → Colour of people** switches between both, or
everybody by purpose or by mood. The Town section also counts who is at home, at work, at school,
shopping, on the bus, at stops and away.

### Settings

| Field | Default | Meaning |
| --- | --- | --- |
| `people_per_100` | 12 | people shown per 100 residents |
| `max_people` | 300 | upper limit (phones) |
| `walk_max_m` | 150 | longest walk (prototype metres) before the bus is preferred |
| `bus_share` | 0.8 | share of long ways taken by bus when a line fits |
| `commuters_out` | 0.35 | share of workers who work elsewhere and take the train |
| `commuters_in` | 40 | visitors coming by train, per 100 local jobs |
| `shopping` | 0.5 | share of adults who go shopping on a day |

Setting the clock by hand puts everybody where their plan says they are at that time.

## For plugins: handing people over at stops

The passenger simulation can take care of people of other simulations at stops, so waiting,
boarding and alighting look the same for everybody:

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
