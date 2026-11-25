# Day and night: the clock and the town

ARail runs a **fast clock** (a *Modellbahnuhr*) next to the simulation. It drives the lighting
(dawn, day, dusk, night), the timetables (rush hours, no service at night) and the **town
simulation**: residents of the layout's houses go to work, to school and shopping and come home
again, on foot, by bus and by train.

## The clock

Movement (trains, buses, cars, people) runs in *simulated seconds*: the speed button in the upper
right corner of the stage sets how many simulated seconds pass per real second (each click faster,
1×–30×). The clock shows a
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

In the app **Settings → Simulation** sets a whole situation at once (a winter weekday's morning rush, a
spring Sunday, …); under **Each on its own → Time of day** you can set the time with the presets
(morning, noon, evening, night), choose another fast-clock ratio, switch the day/night lighting
off and stop the clock. The time is shown at the top left of the stage (*07:32*, with *· night*
between sunset and sunrise).

### Light

Sunrise is at 06:00 and sunset at 20:30, each with a twilight of about an hour and a half; with a
date on the clock (Settings → Simulation, a situation or Each on its own → Season) the sun rises and sets as on that day
in Dresden, 08:06 to 16:01 on 21 December (see [Seasons and weather](weather.md)). At
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

With a date on the clock, a **Saturday or Sunday** has no rush hour: service and traffic start
later and stay at about the daytime level from late morning into the evening, the most in the early
afternoon (`WEEKEND_PROFILES`). Without a date every day is a working day.

| Saturday, Sunday | Trains and buses | Cars | Random passengers |
| --- | --- | --- | --- |
| 01:00–05:00 | no service | up to 0.2 | almost none |
| 06:00–08:00 | trains 0.3 → 0.5, buses 0.3 → 0.4 | 0.15 → 0.4 | 0.2 → 0.4 |
| 10:00–18:00 | trains up to 1, buses up to 0.9 | up to 1 | up to 1 |
| 18:00–20:00 | trains 0.9 → 0.7, buses 0.8 → 0.6 | 0.9 → 0.6 | 0.9 → 0.6 |
| 22:00–24:00 | trains 0.6 → 0.5, buses 0.5 → 0.4 | 0.4 → 0.2 | 0.5 → 0.4 |

The profiles are in `core/clock.js` (`PROFILES`, `WEEKEND_PROFILES`); plugins can read `world.clock.demand(kind)`.
The town's residents still go to work and school on every day of the week.

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
place (`capacity().visitors`) at a fifth full. Shops on the ground floor of a house or office
(`shops`: an Altbau block's shop windows, a Plattenbau's or office's shop sections, the generic
building's shop front) count as shops too: their jobs and visits come on top of the building's own
residents or jobs.

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

### Households, and who goes with whom

The people of a house live in **households** (`together`, on by default): families of one to three
children with one or two adults (a grandparent where no parent is left), couples and singles, among
the old as among the others; each house from its own random stream, so the same seed gives the same
households. A household **shares its cars**: one for each of its people who would have one, two at
most, and whoever of them has a driving licence can take one while one stands at home. A person's
card says who they live with, and whether the household's car is out.

The people of a house plan their day together, and some ways are made **together**:

- A child younger than 10 is **taken to school** by an adult of the household: by the one at home by
  day, else by one on the way to work or to the train, who goes on from the school.
- Pupils of a house who go to the same school **walk together**, two to four of them, there and back.
- When an adult goes **shopping**, the partner at home often goes along, and so do the children.

A group walks at the pace of its slowest, two abreast, in single file when somebody comes the other
way or the group crosses a street; a child strays a little ahead and back. At a stop each waits and
gets on for themselves, and when they got apart there (the bus was full for one of them), the others
wait for them where they get off. A car takes them all. Each has the trip in their own record
(`with others` in the CSV). Who is led by another waits for them 25 clock minutes, then goes alone.

### What the town needs: trains, buses, trams and other passengers

From the same numbers the town tells the stops what it needs:

- **How often vehicles run.** For the platforms: half the morning trips by train (commuters,
  pupils and visitors, who spread over about two hours) and the busiest hour's share of the
  other trips (0.3 trips by train a resident and day: errands, leisure, visits), shared by the
  platform tracks. For a bus or tram line: of the long ways of the morning (longer than
  `walk_max_m`) between two of its stops, the share that takes the bus or tram, as the choice of the
  modes gives it for ways of that length (and, once the town has made some hundred long trips, half
  of it what its people really took). For the bays of a bus terminal: 0.2 trips by
  bus a resident and day. The interval is the longest of 5, 10, 15, 20, 30 and 60 clock minutes
  whose vehicles carry that at a comfortable 70 % (a regional train 140 people, a bus 49, a tram
  4.2 per metre of its length), with the rush-hour frequency (× 1.5). A small town gets a train an
  hour on each track and a bus or tram an hour too: few take the bus where everything is near. This holds for platforms, bays and lines without a
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
- **Among the others and the vehicles** (`world.walking`, `core/walking.js`): where a walk leaves
  the sidewalk for a street, people stop at the kerb and look: they step onto the street only when no
  vehicle stands in their way and none would be there before they are across, with 2 s to spare (the
  gap people accept; after 15 s at the kerb half a second is enough). They cross in front of a
  vehicle that stands, never through one: where a queue stands on the crossing they go round it, a
  few steps along the kerb. At a zebra crossing the vehicles that can still stop will, so only those
  too close count, and trams. Vehicles brake for people on the street all the same (the driver who
  turns into a side street lets them cross); a vehicle that had to brake hard is a near miss
  (`world.walking.nearMisses`). Where many people cross, vehicles and people take turns: a vehicle
  that has waited 6 s goes before those who come to the kerb now. People waiting at a kerb stand
  beside each other, the next ones behind them. On the sidewalk people keep to the right when
  somebody comes, pass a slower one where there is room and walk behind them where there is none;
  through a door they come one after the other.
- **The mode** of a way longer than `walk_max_m` (150 m) is **chosen**: on foot, by bike, by bus or
  tram, by car (see [How people choose their mode](#how-people-choose-their-mode-and-what-they-learn)).
  Shorter ways are walked.
- **By car**: for those with a driving licence while a car of their household stands at home (people
  from elsewhere came by train: their car is elsewhere). Where the layout has road traffic
  (`traffic`), the car is one of its cars: it comes out near the door, drives the streets with
  everybody else, parks in a space near the building as a driver of the road traffic plans it
  (`planDrive`), and its people walk from there; it stays there until they come back for it. A drive
  takes as long as the streets let it. Without road traffic the trip is not drawn: it takes the walk
  to the car (30 m) and from the car park (60 m), loading and unloading (luggage, a pram, a
  wheelchair), the drive at 30 km/h on a way 1.3 times the straight line, and a minute to park.
- **By bike**: for those who have one (four in five; nobody with a rollator, a pram or a suitcase),
  where the layout has bikes (`cycling`): the rider is one of its riders, on the bike lanes and paths,
  and locks the bike to a lamp or a bike stand near the door. A child under 10 rides on the sidewalk.
  To the station too: the bike waits there for the way back.
- **A car or a bike that is out** comes along: whoever drove to work drives on from there and home,
  and walks back to where it stands first when it is somewhere else.
- **Bus or tram**: where a bus or tram line connects a stop within 300 m of the start with a stop
  within 300 m of the destination, and it is not much slower than walking at their own speed (a slow
  walker takes the bus sooner). People wait at the stop, board only their line, ride, get off at their
  stop and walk on. Nobody waits longer than 20 clock minutes, or a little longer than the interval of
  what they wait for (an hourly train is worth waiting for): then they walk (or go home instead of
  taking the train).
- **Train**: commuters go to the nearest platform and take the next train on either side. A
  long way to the platform is taken by bus like any other (see above): to a stop near the
  platform, e.g. the station's bus terminal, and on foot to the platform. Visitors and returning
  commuters get off arriving trains (up to 30 per train) and walk, or take the bus when it is far,
  to work, school, home or the shop. Riders whose stop is taken off the line get off at the next stop.

### How people choose their mode, and what they learn

Each mode a person has for a way costs them what its parts are expected to take, in minutes as people
feel them (`core/modes.js`, `perceived`):

- a minute on foot counts 1.6 minutes on board, a minute of waiting 2, a minute on the bike 1.3
  (Wardman 2004; Abrantes and Wardman 2011);
- fares, what the drive costs and parking fees count as time (12 € an hour);
- a **constant** for what the minutes do not tell (walking needs nothing; a bike is fetched and
  locked), and the person's **own liking** of the mode (people differ);
- the **weather and the dark**: a minute on foot or at a stop counts 1.3 in rain (1.6 in heavy rain,
  more on snow and ice, in frost and in the dark); of the cyclists of a mild dry day only the
  weather's share still rides ([Seasons and weather](weather.md): half in rain, a fifth on snow);
- the **person**: old people and those with a stick, a rollator, a pram or a suitcase walk and wait
  less gladly; children and old people mind the dark more, on foot and on the bike; a group goes as
  its most burdened member can.

A logit over these costs chooses: the cheapest mode is taken most often, the others now and then. The
constants are fitted to the shares of the modes by the length of the trip of MiD 2017, for somebody
who has all four: of 100 trips of half a kilometre about 60 on foot, 13 by bike, 22 by car and 4 by
bus or tram; of one and a half kilometres about 25, 22, 44 and 9.

Nobody knows the traffic before they have been in it. People **plan** with what a trip takes on
empty streets and with a timetable that holds, and **learn** what it really takes:

- A **person** remembers for each of their ways and each mode how the last trips went against what
  they expected, and whether they went **badly**: a jam (the drive took twice its plan), left behind
  at the stop or given up waiting, soaked on foot or on the bike. A bad trip costs mood, and a mode
  that keeps going badly counts as dearer; the mode taken last time counts as cheaper (habit).
- The **town** remembers the same for everybody, by mode and hour of the day, on working days and at
  weekends (`world.experience`): what one hears from the others. An hour's trips move what is
  expected of that hour by a third, so one bad morning does not turn the town round. A person plans
  with the town's experience until their own says otherwise; for the car also with the traffic news
  (how the cars on the streets are doing now).

So people who stand in a jam every morning come to expect it, are unhappy with the car, and some
take the tram or the bike instead, until the streets carry those who are left: the shares settle at
what the town's streets, stops and parking can take. It is a simple form of reinforcement learning
(a softmax over learned expected costs), the day-to-day learning of traffic assignment (Horowitz
1984; MATSim). The cars from beyond the layout learn the same way, as one crowd (see
[Road traffic](streets-and-buses.md#road-traffic)), and the buses and trams run as often as the
people who really take them need.

**A layout's town is smaller than a real one**, so most of its ways would be walked. `stretch` says
how many times as long its ways count in the choice, as if the town were of real size (Bf Neustadt:
3, so a way of 300 m is weighed like one of 900 m); the walk to a stop and the waiting there count as
they are. It changes the choice, not how long anything takes.

**The Overview → Measured** shows the *Modal split* (the shares of all trips, and of the longer ways)
and *What the town has learned* (how long a drive takes now against empty streets, bus and tram
against their timetable, the share of drives that were a jam). A person's card shows what was weighed
for the way they are on, and what they have learned on their ways. `town.modalSplit({purpose, from,
to, long})` gives the shares to scripts, and the trips' CSV names the mode of each trip.

#### Working it out ahead

What a town learns takes it a week or two. `tools/mobility-learn.mjs` runs a layout for some days
without the app and keeps what the town has learned in the layout (`experience`), so that the first
morning in the app starts where the learning ends; in the app the learning goes on from there. Run it
**after a layout's streets, lines, buildings or simulations were changed**:

```bash
node tools/mobility-learn.mjs web/layouts/ebl-neustadt.json --days 14 --write
node tools/mobility-learn.mjs web/layouts/ebl-neustadt.json --check     # still the layout's own?
```

It shows each day's traffic (the cars' speed, how many stand, the drives that were a jam), the shares
of the modes and what the town expects of the car and the bus. The experience is kept with a key of
what it was learned for (`experience.for`); `--check` says when the layout was changed since, and so
does a test for Bf Neustadt (`tests/js/modes.test.js`).

While people are inside a building they are not drawn; the building lights its windows at night
when people are in (`world.occupancy`).

### Colours

People in the town are coloured by the purpose of their trip, in the chair's corporate-design
colours: **to work** Türkis, **to school** Orange, **shopping** Gelb, **home** Brillantblau,
**to the train** Rot. Other passengers at platforms and stops keep the mood colours (Türkis = happy,
Gelb = so-so, Rot = annoyed). **Settings → View → Show → Colour of people** switches between both, or
everybody by purpose or by mood. The **Overview → Measured → Town** counts the people of the town and
how many are on their way, on the bus, by bike and by car; `town.townStats()` also counts who is at home, at
work, at school, shopping, at stops and away, the captive adults (no licence or no car), and how
often one of them gave up waiting at a stop or found it closed (a cancelled bus strands them: they have
no car to take instead).

### Trips from door to door

Every trip of a resident is recorded from its door (or the train it came by) to the door it goes
to, in clock minutes and in its parts: **on foot**, **waiting** at a stop, **at the doors** (getting
on and off), **riding**, **by car**, **by bike**. The card of a person lists today's trips ("07:12 to work:
23 min (on foot 9 min, waiting 6 min, riding 7 min)"). **Overview → Measured → Door to door** shows the
mean minutes of all trips that reached their building; **Download the trips (CSV)** there gives every
trip for the debriefing. `town.tripStats()` gives the mean by group to scripts (everybody, children,
adults, old people, those with a walking stick, a rollator, a wheelchair or a pram, with heavy or
bulky luggage, and those without a licence or a car), in all and in each part, and `town.tripsCSV()`
every trip.

### Settings

| Field | Default | Meaning |
| --- | --- | --- |
| `people_per_100` | 12 | people shown per 100 residents |
| `max_people` | 300 | upper limit (phones); scales residents and visitors alike. Bf Neustadt sets 3000, so that its 25 per 100 of 9,300 residents are all shown (with 300, one in forty was) |
| `walk_max_m` | 150 | ways up to this length (prototype metres) are walked; longer ones are chosen for |
| `stretch` | 1 | how many times as long the ways count when people choose their mode: a layout's town is smaller than a real one (Bf Neustadt: 3) |
| `modes` | | the tastes: a table like the people's, a row for `everybody` (`sharpness` 0.07 per min, `wait` 2, `eur_min` 0.2, `habit` 7 min, `learn` 0.3, `hearsay` 2 trips, `anger` 14 min, `jam` 2, `quit` 2.2) and one per mode: `walk` (`constant` −30 min, `minute` 1.6), `bike` (0, 1.3, `own` 0.8), `transit` (10, 1, `fare_eur` 0.6), `car` (−7, 1, `eur_km` 0.2), each with a `spread` of the people's own likings. A layout sets only the cells it changes: `"modes": {"car": {"constant": 0}}` |
| `together` | true | households that share their cars; children taken to school, partners and schoolmates going together |
| `bus_share` | 0.5 | 0: nobody takes the bus or the tram; 1: everybody does where a line fits; in between people choose (before the choice of the modes it was the share of long ways by bus) |
| `car_share` | 0.5 | 0: nobody drives in the town; 1: everybody who can; in between people choose |
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
  A story's train and bus keep to the time of their step and do not wait: nobody queues at their doors.
- The **doors stay open** while somebody is in them (at most a minute past the dwell; as long as a
  ramp or a lift is in use), and for those waiting at a door at most 20 s past it: the dwell follows
  the boarding, and a wheelchair user's ramp keeps the bus 60 s.
  The card of a stop says how many seconds the doors were held past the dwell.
- **Vehicles hold spaces, not heads**: seats and standing room at 4 people per m² (VDV), a 12 m bus 32
  seats and 11 m² (76 spaces, 1 wheelchair place), a tram 60 seats and 30 m² (180, 2), a train per 26 m
  car 80 seats and 10 m² (120; 2 wheelchair places). A vehicle comes in with the riders of the town and
  the journeys who stay on and a quarter of its spaces of people riding through (more in the rush
  hours); those getting off make room, however full it came in. A train of the rail package with a
  consist also counts heads against its places (its card: *On board*, *Left behind*). A person gets on if its space fits; else squeezed, down to its least, which costs mood (0.05
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

The traits and their effects are one table of the passenger simulation, `people`, for the whole
layout (the town, the journeys and the road traffic use the same): a row for everybody and one per
trait, a cell per effect. A layout sets only the cells it changes; the others keep their defaults:

```json
{ "type": "passengers", "people": { "wheelchair": { "share": 0.02 }, "everybody": { "walk_mps": 1.3 }, "old": { "board_step": 3 } } }
```

| Row | `share` | `speed` | `board`, `board_step` | `load_s` | `space`, `squeeze` | `car_s` | Also |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `child` | 0.15 | 0.9 | 1.2, 1.6 | | 0.7 | | |
| `adult` | | | | | | | `licence` 0.87 |
| `old` | 0.22 | 0.83 | 1.3, 2.5 | | | | `licence` 0.75 |
| `stick` | 0.1 | 0.65 | 1.5, 3 | | | | |
| `rollator` | 0.06 | 0.46 | 2, 4 | | 0.7, 0.3 | | |
| `wheelchair` | 0.01 | 0.7 | 2.5 | | 1.5 | 120 | `ramp_s` 60, `lift_s` 120 |
| `pram` | 0.03 | 0.9 | 2, 5 | | 1.5, 1.2 | 60 | |
| `light` | 0.45 | | | | | | |
| `heavy` | 0.03 | 0.85 | | 3 | 0.5, 0.2 | 20 | `share_long` 0.35 |
| `bulky` | 0.02 | 0.8 | | 8 | 1.5 | 20 | |

- `share`: children, old people and wheelchair users of the people (Destatis 2023; about 1.6 million
  wheelchair users in Germany, fewer of them travel); a stick and a rollator of the old people (of the
  adults a tenth); a pram of the adults (of the old a third); luggage of the trips: heavy on trips up
  to 5 km, `share_long` on trips of 100 km and more (in between by the length, half of it to work or
  school). `licence`: a driving licence (MiD 2017).
- `speed`: the factors of the walking speed (Knoblauch et al. 1996, Boyce et al. 1999, Young 1999).
- `board`, `board_step`: the boarding factors at level boarding and with a step (a wheelchair only
  at level boarding or on the help); `load_s`: seconds to load the luggage (twice with a step);
  `ramp_s`, `lift_s`: a vehicle's ramp and the staff's lift (TCQSM 2013).
- `space`: a child's own room (a person 1), or the room an aid or luggage adds (heavy luggage none in
  a train's racks); `squeeze`: the least it takes squeezed (without one, as a wheelchair and bulky
  luggage, it is not squeezed).
- `car_s`: seconds at each end of a trip by car.

| `everybody` | Default | Meaning (source) |
| --- | --- | --- |
| `walk_mps`, `walk_sd_mps` | 1.34, 0.26 | the normal distribution of the base speed (Weidmann 1993) |
| `board_s`, `board_step_s` | 1.5, 0.4 | seconds at a door, and per 10 cm of step (Weidmann 1994) |
| `squeeze` | 0.8 | a person squeezed takes this much of its room |
| `squeeze_mood` | 0.05 | mood lost per squeezed space and minute of the ride |
| `car` | 0.75 | a car for those with a driving licence (MiD 2017) |

Two more settings of the passenger simulation are about the vehicles:

| Field | Default | Meaning (source) |
| --- | --- | --- |
| `standing_per_m2` | 4 | people standing per m² (VDV) |
| `onboard_share` | 0.25 | the share of a vehicle's spaces taken by people riding through when it comes in |

The values without a source are estimates for teaching; the architecture page lists every row
with its cells, and `core/mobility.js` (`PEOPLE`) every cell with its range and source.

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
