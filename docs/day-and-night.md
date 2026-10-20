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
- **By car**: of the residents with a driving licence and a car ([Passenger mobility](#passenger-mobility)),
  `car_share` (30 %) drive their ways longer than `walk_max_m` in the town that day (visitors came by
  train: their car is elsewhere). A trip by car
  is not drawn (the road traffic has cars of its own): it takes the walk to the car (30 m) and from
  the car park (60 m) at their speed, loading and unloading (luggage, a pram, a wheelchair), the
  drive at 30 km/h on a way 1.3 times the straight line, and a minute to park. The others are
  *captive*: they walk or take the bus and the train. Trips to elsewhere stay by train.
- **Bus or tram**: a way longer than `walk_max_m` (150 m) is taken by bus or tram with probability
  `bus_share` (80 %; pupils and seniors a little more often) when a bus or tram line connects a stop
  within 300 m of the start with a stop within 300 m of the destination, and it is not much slower
  than walking at their own speed (a slow walker takes the bus sooner). People wait at the stop, board only their line, ride, get off at their stop and walk
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
shopping, on the bus, by car, at stops and away, the captive adults (no licence or no car), and how
often one of them gave up waiting at a stop or found it closed (a cancelled bus strands them: they have
no car to take instead).

### Trips from door to door

Every trip of a resident is recorded from its door (or the train it came by) to the door it goes
to, in clock minutes and in its parts: **on foot**, **waiting** at a stop, **at the doors** (getting
on and off), **riding**, **by car**. The card of a person lists today's trips ("07:12 to work:
23 min (on foot 9 min, waiting 6 min, riding 7 min)"). **Settings → Simulation → Town** shows the
mean of the trips that reached their building by group: everybody, children, adults, old people,
those with a walking stick, a rollator, a wheelchair or a pram, with heavy or bulky luggage, and
those without a licence or a car; **Download the trips (CSV)** gives every trip for the debriefing.
`town.tripStats()` and `town.tripsCSV()` give the same to scripts.

### Settings

| Field | Default | Meaning |
| --- | --- | --- |
| `people_per_100` | 12 | people shown per 100 residents |
| `max_people` | 300 | upper limit (phones); scales residents and visitors alike |
| `walk_max_m` | 150 | longest walk (prototype metres) before the bus is preferred |
| `bus_share` | 0.8 | share of long ways taken by bus when a line fits |
| `car_share` | 0.3 | of the people with a driving licence and a car, the share who drive their long ways in the town that day |
| `catchment_m` | 1500 | local area (prototype metres): places this close to a home, or on a line from near it, are its residents' first |
| `commuters_out` | 0.15 | share of workers who work elsewhere (by train) although there are jobs; those without a job in the town work elsewhere too |
| `commuters_in` | 0.6 | share of the jobs, school places and shop visits left empty that people from elsewhere take (by train); a value above 1 from an older layout (people per 100 local jobs) is read as hundredths |
| `shopping` | 0.5 | share of adults who go shopping on a day |

Setting the clock by hand puts everybody where their plan says they are at that time. When the
town is worked out again during the day (a building, a setting, the platforms or the stops of a
line changed), everybody who is still there carries on where they are, also on the way, at a stop
or on a bus; only the people the change adds are placed where their plan says, and only those it
takes away leave.

## Passenger mobility

All people of the simulations are one kind of person with a **profile** of characteristics
(`core/mobility.js`): the people at the stops, the town's residents, the journeys' travellers and the
people in the cars. There are no kinds of people; the traits combine (an old person with a rollator
and a suitcase):

| Trait | Values |
| --- | --- |
| `age` | child, adult, old (65 and older) |
| `aid` | none, walking stick, rollator, wheelchair, pram (Kinderwagen) |
| `luggage` | none, light (a bag, a backpack), heavy (a suitcase), bulky (a bike, skis) |
| `licence`, `car` | a driving licence; a car available |

A profile is drawn once from the person's own seeded random stream, so a run is reproducible. The
town's pupils are children and its seniors old; the luggage depends on the trip: heavy luggage on
3 % of the short trips (up to 5 km) and 35 % of the long ones (100 km), in between by the length, half
of it to work or school. The others at a station make a regional trip (30 km), at a bus or tram stop
a short one (4 km). A journeys traveller has what its maker chose. Drivers have a licence and a car.

From the profile follow:

- **Walking speed**: a base speed from a normal distribution, N(1.34 m/s, 0.26 m/s) cut to
  0.5–2.2 m/s (Weidmann 1993), times the factors of the traits: child 0.9, old 0.83 (Knoblauch et al.
  1996), walking stick 0.65, rollator 0.46, wheelchair 0.7 (Boyce et al. 1999), pram 0.9, heavy
  luggage 0.85 (Young 1999), bulky 0.8.
- **Getting on and off** (`boardingTime`): 1.5 s at a door at level boarding (Weidmann 1994), plus
  0.4 s per 10 cm of step, times the larger of the factors of age and aid, which are small at level
  boarding and large with a step (old 1.3 / 2.5, walking stick 1.5 / 3, rollator 2 / 4, pram 2 / 5,
  child 1.2 / 1.6: an old person with a rollator takes 3 s at level boarding and 9.2 s with a step of
  20 cm), plus loading heavy (3 s) or bulky luggage (8 s), twice as long with a step. Level
  boarding means the step between the platform (or kerb) and the vehicle's floor at the doors and the
  gap are at most 5 cm. A **wheelchair** gets on only at level boarding or with help: the ramp of a
  bus or tram, put out by the driver (60 s, TCQSM 2013; for a step of at most 25 cm), or the lift or
  ramp of the station's staff (120 s) where the platform has `assistance` (06:00–22:00). A ramp once
  out serves the next wheelchair user too.
- **The room it takes** (spaces): a person 1, a child 0.7; heavy luggage adds 0.5 (none in a train's
  luggage racks), a rollator 0.7, a pram, a wheelchair or bulky luggage 1.5. Squeezed, a person takes
  0.8, heavy luggage 0.2 (on the lap), a folded rollator 0.3, a pram 1.2; a wheelchair and bulky luggage
  are not squeezed.

At the stops this means:

- People go through a **door one after the other**, those getting off first, each as long as it
  takes them: a slow person holds up those behind. People with an aid, a pram or bulky luggage take
  the door of the multi-purpose area (the bus's and the tram's second door, the train's middle one).
- The **doors stay open** while somebody is in them (at most a minute past the dwell; as long as a
  ramp or a lift is in use), and for those waiting at a door at most 20 s past it: the dwell follows
  the boarding, and a wheelchair user's ramp keeps the bus 60 s.
  The card of a stop says how many seconds the doors were held past the dwell.
- **Vehicles hold spaces, not heads**: seats and standing room at 4 people per m² (VDV), a 12 m bus 32
  seats and 11 m² (76 spaces, 1 wheelchair place), a tram 60 seats and 30 m² (180, 2), a train per 26 m
  car 80 seats and 10 m² (120; 2 wheelchair places). A vehicle comes in with the riders of the town and
  the journeys who stay on and a quarter of its spaces of people riding through (more in the rush
  hours). A person gets on if its space fits; else squeezed, down to its least, which costs mood (0.05
  per squeezed space and minute of the ride); else it is **left behind** (`passenger.denied`: full, no
  wheelchair place, or no level boarding without help) and waits for the next one, its mood down.
- **Heights**: a platform is 0.76 m above the rails unless set (`height_m`: 0.38, 0.55, 0.76, 0.96;
  EBO § 13), a bus stop's or terminal's kerb 0.18 m (`kerb_m`, a raised bus kerb); a tram stop by its
  kind. The trains' floor at the doors is 0.76 m, a low-floor bus 0.32 m, a tram 0.30 m: a train at a
  0.55 m platform has a step of 21 cm, a bus at a raised kerb one of 14 cm (its ramp bridges it).

The card of a person shows its characteristics, walking speed, the room it takes and whether it can
drive; the card of a stop the step into its vehicles and the help there, how many got on and how long
they took at the doors (and what age, aids and luggage added), the share with luggage, those left
behind and squeezed in; the card of a bus or tram line the same for the people who got on its
vehicles; the card of a vehicle at a stop its load in spaces. **Settings → View → The
room people take** draws a circle on the ground under each person whose area is its space (a person
with a pram is visibly larger), and the load of each vehicle at a stop in spaces. The Overview lists
the vehicles at the stops by the room left in them.

### Settings of the people

The traits and their effects are settings of the passenger simulation, for the whole layout (the
town, the journeys and the road traffic use the same):

```json
{ "type": "passengers", "share_wheelchair": 0.02, "walk_mean_mps": 1.3, "board_old_step": 3 }
```

| Field | Default | Meaning (source) |
| --- | --- | --- |
| `share_child`, `share_old` | 0.15, 0.22 | children, people 65 and older (Destatis 2023) |
| `share_wheelchair` | 0.01 | wheelchair users (about 1.6 million in Germany; fewer of them travel) |
| `share_rollator`, `share_stick` | 0.06, 0.1 | of the old people (of the adults a tenth) |
| `share_pram` | 0.03 | of the adults (of the old a third) |
| `share_light`, `share_heavy`, `share_heavy_long`, `share_bulky` | 0.45, 0.03, 0.35, 0.02 | luggage: light; heavy on trips up to 5 km and of 100 km; bulky |
| `licence_adult`, `licence_old`, `car_share` | 0.87, 0.75, 0.75 | a driving licence; a car for those with one (MiD 2017) |
| `walk_mean_mps`, `walk_sd_mps` | 1.34, 0.26 | the normal distribution of the base speed (Weidmann 1993) |
| `speed_child`, `speed_old` | 0.9, 0.83 | walking speed factors (Knoblauch et al. 1996) |
| `speed_stick`, `speed_rollator`, `speed_wheelchair`, `speed_pram` | 0.65, 0.46, 0.7, 0.9 | (Boyce et al. 1999) |
| `speed_heavy`, `speed_bulky` | 0.85, 0.8 | with luggage (Young 1999) |
| `board_s`, `board_step_s` | 1.5, 0.4 | seconds at a door, and per 10 cm of step (Weidmann 1994) |
| `board_child`, `board_child_step`, `board_old`, `board_old_step`, … | 1.2, 1.6, 1.3, 2.5, … | boarding factors at level boarding and with a step: also `board_stick*` 1.5, 3; `board_rollator*` 2, 4; `board_pram*` 2, 5; `board_wheelchair` 2.5 |
| `ramp_s`, `lift_s` | 60, 120 | a vehicle's ramp, the staff's lift (TCQSM 2013) |
| `load_heavy_s`, `load_bulky_s` | 3, 8 | loading luggage (twice with a step) |
| `space_child`, `space_heavy`, `space_rollator`, `space_pram`, `space_wheelchair`, `space_bulky` | 0.7, 0.5, 0.7, 1.5, 1.5, 1.5 | spaces |
| `squeeze_person`, `squeeze_heavy`, `squeeze_rollator`, `squeeze_pram` | 0.8, 0.2, 0.3, 1.2 | the least, squeezed |
| `standing_per_m2` | 4 | people standing per m² (VDV) |
| `onboard_share` | 0.25 | the share of a vehicle's spaces taken by people riding through when it comes in |
| `squeeze_mood` | 0.05 | mood lost per squeezed space and minute of the ride |
| `car_luggage_s`, `car_pram_s`, `car_wheelchair_s` | 20, 60, 120 | at each end of a trip by car |

The values without a source are estimates for teaching; the architecture page lists every setting
with its source.

## For plugins: handing people over at stops

The passenger simulation can take care of people of other simulations at stops, so waiting,
boarding and alighting look the same for everybody (the full API is in [Extending
ARail](extending.md#handing-people-over-at-stops)):

```js
const pax = world.simulations.find((s) => s.constructor.type === "passengers");
// wait at a stop area for line "bus-line-1" at a given dock
const person = pax.enter(areaId, { agent: myAgent, dockId, line: "bus-line-1", at: [x, y], rideMin: 12 });
// let agents get off a vehicle standing at a dock
pax.alight(vehicle, dock, [agentA, agentB]);
pax.release(person); // give up waiting and walk to the exit
world.events.on("passenger.boarded", ({ agent, vehicle, dock }) => { /* on the vehicle now */ });
world.events.on("passenger.exited", ({ agent, pos }) => { /* left the stop at pos (layout mm) */ });
world.events.on("passenger.removed", ({ agent }) => { /* dropped (cleared, stop deleted) */ });
world.events.on("passenger.denied", ({ agent, reason }) => { /* left behind: "step", "full" or "wheelchair" */ });
```

An agent with a `profile` (`core/mobility.js`: `drawProfile`, `normalizeProfile`) walks, gets on and
takes room by it; without one the passenger simulation draws one. `rideMin` (clock minutes) is how
long it will ride: a squeezed space costs mood for so long.

Agents with a `colour` property are drawn in that colour (people colour "auto"/"purpose").
`drawPerson(view, [x, y], {dir, speed, phase, height, colour, ...personLooks(world, profile)})` draws a
person like the built-in simulations do, with its aid and luggage (and its room, with the setting). `world.setTime("06:30")` jumps the clock and emits `clock.set`.
