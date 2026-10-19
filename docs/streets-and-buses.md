# Streets, trams, buses and road traffic

Streets in ARail are a **road network**: streets that meet or cross are connected, people walk on
their sidewalks, and buses, trams, cars, bikes and e-scooters drive on them. Every street has a
**cross-section** with the standard widths of the German guidelines: car lanes, and beside them
sidewalks, bike lanes or bike paths, tram tracks and parking. A **bus line** runs along the streets
from bus stop to bus stop, a **tram line** along the tram tracks from tram stop to tram stop: their
vehicles stop, open their doors, let passengers get off and on, and go on. **Road traffic** adds cars
with drivers and passengers that come in where streets leave the layout and park near where they go;
**bikes and e-scooters** ride on the streets, bike lanes and paths. **Traffic signs**, **traffic
lights**, **zebra crossings** and **railway crossings** are objects of their own, and every vehicle
obeys them.

## Building it in the app

All of it is in **Build → Add to the layout → Transport**. Streets and everything else are built on
table modules (**Build → Table**): a tap beside them places nothing (see
[Heights](#heights-table-modules-ramps-and-bridges)).

1. **Street**: tap the points along the street, then **Finish**. A tap near the end or a corner of
   another street (about 12 px) snaps onto it, and a tap on another street puts the point on its
   centre line, so streets connect. Choose the kind in the inspector: *street* (50 km/h),
   *residential street* (30 km/h), *main road* (wider), *footpath* (people only, or shared with
   bikes, or a bike path) or *tram track of its own* (no street, see [Trams](#trams)). The
   inspector shows only the settings that fit: the **cross-section** and the widths (see
   [Cross-sections](#cross-sections)), the lanes each way, tram tracks and street parking. The
   widths offer the standard values of the guidelines to tap; any other can be typed in.
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
4. **Tram stop** and **Tram line**: like bus stops and bus lines, but on tram tracks (see
   [Trams](#trams)).
5. **Traffic sign**, **Traffic lights**, **Zebra crossing**: beside the street (a sign, on the side
   of the traffic it is for), on the junction (lights), on the street (zebra crossing); see
   [Signs, lights and zebra crossings](#signs-lights-and-zebra-crossings).
6. **Railway crossing**: where a street crosses a track; see [Railway crossings](#railway-crossings).
7. **Parking lot**, **Parking garage**, **Bike stands**: see [Parking](#parking).

The route of a line is drawn in its colour along the right lane of the streets (along the track
for trams), with a dot at each stop. The board over each stop and the **Settings → Simulation →
Stops** board show the next bus or tram, e.g. *Bus 62 to Station in 6 min* (in clock minutes),
*Tram 1 to Neustadt Bf boarding*, or *Bus 62 arrives in 3 min (terminus)* on the side where buses
only arrive. The buses of a *loop* go round a ring, which the signs show like the Berlin Ringbahn:
*Bus 62 Ring ↻ in 4 min* (clockwise, seen from above) or *Ring ↺* (counter-clockwise); the bus
line's inspector says which way round. A bus or tram shows its line number and *to* … or *Ring ↻*
on its destination sign while it stands at a stop (*Not in service* on its way to the depot).

A stop on both sides of the street has **one board** for both sides: the name, the people waiting
on both sides, their mood and the next bus on each side. The board of a bus terminal shows the
next bus of each line that starts there (and *Bus 305 boarding* while one of the terminal's own
timetable buses stands in its bay). Seen from far away (the stop shorter
than 60 px on the screen, e.g. in the flyover's overview or on a phone) the board shrinks to a
small badge with the stop sign and the number of people waiting; zoom in for the full board.
Platforms and bus terminals are longer, so they keep their full boards unless they are tiny. The
**Stops** board of Settings → Simulation lists both sides of such a stop as *Stop A* and *Stop B* (the letters
on its signs).

## Cross-sections

The **cross-section** (`profile`) says what lies beside the car lanes. `width_m` is always the
width of the car lanes together: bike lanes and bike paths, tram tracks and parking make the street
wider, and the car lanes keep their width.

| Cross-section | Beside the car lanes | Bikes ride |
| --- | --- | --- |
| *plain street* | nothing (no sidewalks) | on the road |
| *with sidewalks* | sidewalks | on the road |
| *advisory bike lanes* (Schutzstreifen) | a dashed lane for bikes on the road, then sidewalks; cars may cross the line when they must | on the advisory lane |
| *bike lanes* (Radfahrstreifen, Zeichen 237) | a lane for bikes behind a solid line, then sidewalks | on the bike lane |
| *bike paths* (Radweg) | the curb, then a bike path at sidewalk level and the sidewalk | on the bike path |
| *shared paths* (gemeinsamer Geh- und Radweg, Zeichen 240) | the curb, then one path for people on foot and bikes | on the shared path, among the people |

A footpath (`kind: "path"`) is a *footpath* (people only), a *shared foot and bike path* (240) or a
*bike path* (237, bikes only). Streets of old layouts keep their look: with sidewalks, or plain
where `sidewalk_m` is 0.

**Widths** (prototype metres; the standard values are offered in the editors):

| Strip | Standard | Smallest | Guideline |
| --- | --- | --- | --- |
| car lanes of a two-way street | 4.50 (two cars), 5.50 (a truck and a car), 6.50 (two buses), 7.00 (often) | 4.10 | RASt 06 |
| a car lane (`lanes` 2 or 3 each way) | 3.25 (with buses), 3.00, 3.50 | 2.50 | RASt 06 |
| sidewalk | 2.50 (0.20 to the houses, 1.80 to pass, 0.50 to the cars); 1.80, 2.10, 3.30, 4.00, 5.00 | 2.50 | RASt 06, EFA 2002, DIN 18040-3 |
| advisory bike lane | 1.50; 1.25, 2.00 (4.50 m of car lanes between two) | 1.25 | ERA 2010 |
| bike lane (with its line) | 1.85; 1.50, 2.25 | 1.50 | ERA 2010, VwV-StVO |
| bike path (one way) | 2.00; 1.60, 2.50 | 1.60 | ERA 2010 |
| shared path | 2.50; 3.00, 4.00 (more where many walk and ride) | 2.50 | ERA 2010, VwV-StVO |
| safety strip to the car lanes / to parked cars | 0.50 / 0.75 | | ERA 2010 |
| parking strip: parallel, angled 45°, perpendicular | 2.00, 4.35, 5.20 deep (spaces 5.70, 3.75, 2.65 long) | | EAR 23 |
| tram: vehicle, track spacing, tram lane, track bed for two tracks / one | 2.65, 3.40, 3.25, 6.60 / 3.40 | | BOStrab §§ 31, 34 |

A width below the smallest one is allowed, but the street says what follows (in the inspector, its
card and the builder): *Car lanes 4 m: two cars cannot pass each other*, *Bike lane 1.2 m: below
the minimum of 1.5 m (ERA 2010, VwV-StVO); bikes ride in the car lane*, *Sidewalk 1.5 m: below the
2.5 m of RASt 06*, a parking strip whose cars have no room to drive in and out, two tracks on a
track bed too narrow for them. Two things act in the simulation:

- **Bikes hold up the cars** where a car cannot pass a bike at 1.5 m (StVO § 5) within its lane:
  on one lane each way narrower than 4.60 m, next to an advisory lane on such a street, or on a bike
  lane below its minimum. The cars follow the bike and overtake when the other lane is free (not a
  bike that waits in a queue or at a light, nor where they would still be on the other lane at the
  traffic lights of a tram stop).
- **People get angry** where riders and people on foot share too little room: on a shared path
  (often at 2.50 m, now and then at 3.00 m, rarely from 4.00 m), and next to a bike path below
  1.60 m or a sidewalk below 1.80 m. The street's card counts the conflicts of the last hour; the
  mood of the people on foot drops.

**Tram tracks** in a street (`tram`): *in the car lanes* (shared with cars, straßenbündig), *in
lanes of their own in the middle* (cars may cross them), or *on a track bed of their own in the
middle* (besonderer Bahnkörper, grass or ballast between curbs). `tram_tracks`: *two tracks*, *one
track, both directions*, or *one track, one direction* (in the direction the street was drawn). A
tram track of its own (`kind: "tram"`) has only its track bed.

**Street parking** (`parking`): *parallel*, *angled (45°)* or *perpendicular* to the curb, on
`parking_sides` (`both`, `right`, `left`), with a tariff (`parking_tariff`, `parking_price_eur`;
see [Parking](#parking)). A yearly tariff makes it residents' parking.

## In the builder

The [builder](world-builder.md) draws streets on a plan of the layout. Its street tools (street,
residential street, main road, footpath or bike path, tram track) come with the settings of **the
new street**: the cross-section, the widths with the standard values to click, the lanes, tram tracks
and parking. They are kept for each kind on the device; *Standard street* goes back to the defaults.
The Element tab shows the cross-section as a figure, its strips with their widths in words, and what
is below the guidelines; so does a selected street.

The builder puts bus stops, tram stops, bus terminals, parking, truck lanes and buildings at a
street, signs beside it, traffic lights on a junction, zebra and railway crossings on the street, and
checks that everything people and vehicles come to has a street to it: bus and tram stops and
platforms, the bus terminal's lane, the container terminal's truck lanes, the entrances of
buildings, the ways in of parking lots and garages. It also flags streets on their own, street ends
a few metres before another street, dead ends inside the layout, tram stops away from the tracks,
streets that cross a track without a railway crossing, and trams that would cross a railway at
street level, each with a fix where one is plain (`accessProblems(world)` and `applyFix(world, fix)`
in `web/arail/core/access.js`).

## How the buses run

- The line's route goes over the road network through all stops, on the side of the street in
  the direction of travel. A line *back and forth* serves the stops in order and then in reverse;
  at the ends it turns (a turning loop at a dead end, or round a block). A *loop* runs round.
  A stop on one side only is served in that direction; the inspector says so.
- At the first stop of each direction (the terminus) buses lay over with the doors open until
  their departure. A bus departs every `headway_s` simulated seconds × the time-of-day demand
  (more often in the rush hours, none between 01:00 and 04:30). A line without `headway_s` runs as
  often as the town needs: the long ways of its people between the line's stops decide a regular
  5, 10, 15, 20, 30 or 60 clock minutes (see [Day and night](day-and-night.md#what-the-town-needs-trains-buses-trams-and-other-passengers));
  without a town, or with `services.auto_interval` false, every 240 s (trams 300 s). Buses come in from the depot when
  none is waiting. A line keeps only as many buses as its timetable needs (one per departure
  during a round trip, and one to spare): after the rush hour, and at night, a bus that is not
  needed lets its passengers off at the terminus and goes to the depot (*Not in service*;
  nobody gets on). A line running late gets no more vehicles than it needs and one to spare.
- Buses accelerate and brake, keep to the speed limit of the street and the line's top speed,
  keep their distance to the vehicle ahead, and obey the junctions (see
  [Signs, lights and zebra crossings](#signs-lights-and-zebra-crossings)). At a stop the front of
  the bus stands 1.5 m before the end of the stop, and the doors open on the stop side; people get
  off, then the waiting passengers of this line get on. A bus laying over does not block the
  street: when a vehicle waits behind it (another bus for the stop, a bus of another line on its
  way to the next bay of a terminal, cars behind a terminus on the street) it leaves early with its
  next departure; while departures are suspended by a disruption it makes room by going to the
  depot.
- Bus lines can also use **bus terminals**: each line serving a terminal gets a bay of its own
  (the lines share the bays in the order of their ids); the terminal's bus lane is connected to
  the nearest streets. Bays that no line uses keep the terminal's own timetable buses.
- Disruptions work on line stops too: a *closure* makes buses pass the stop (they are not
  announced there, and its board does not show them arriving), a *delay* holds them at the
  stop, *cancellations* cancel departures from a terminus.
- Passengers come to a bus stop only while a bus line in operation serves it: nobody waits at a
  stop without a line (or whose lines have problems), and the people waiting there go when its
  last line is taken away.

## Trams

A **tram stop** goes onto the tram tracks of a street (or a tram track of its own); tap on or next to
the tracks. Two tracks get a stop on both sides (*Stop A* in the direction the street was drawn,
*Stop B* against it), one track a stop on one side. Its **kind** decides where people wait, whether
cars wait beside a standing tram (StVO § 20) and how people get on:

| Kind | Where people wait | Cars beside the tram |
| --- | --- | --- |
| *on the road* | on the sidewalk; they cross the lane to the door (no platform) | wait at the traffic lights |
| *raised road* (Zeitinsel) | on the sidewalk; the road is raised to the tram floor, they cross it to the door | wait at the traffic lights |
| *island* between track and car lane (Haltestelleninsel) | on an island; the street must leave a car lane of 3.00 m beside it | drive past; wait at the traffic lights while people cross to the island |
| *curb extension* (Haltestellenkap) | on the sidewalk built out to the track, like a bus stop | wait behind the tram |

**Traffic lights** (`lights`, on by default): where people cross a lane with cars or bikes to a tram
in the middle of the street (at a stop on the road or at a raised road), or to an island in a
street, the stop has a light on each side for the traffic in that lane; it stands at the curb, and
its stop line, 2 m before the stop, runs across the whole street. It is green for the cars and bikes
until a tram comes (moving, within 50 m; after 5 s of green at least) or people want to cross (after
12 s of green), then amber for 3 s, then red. People step onto the lane only while it is red and
no car or bike is left in it: while the tram stands there, else for 8 s (their green); the tram
opens its doors only then. It stays red while the tram comes or stands there and while people are
in the lane, and turns red-amber 2 s after the last of them has left it, then green. At an island
it changes for the people only: they cross the car lane at the island's end, on a crossing of 4 m,
towards the island on one half and away from it on the other. Trams pass the lights; at amber only
those stop who still can; nobody overtakes a bike there. The stop's card shows the lights now.
Without lights (`lights: false`) the cars wait beside the standing tram while its doors are open.

A stop is **step-free** (barrierefrei, DIN 18040-3) for a low-floor tram (floor about 0.30 m) when
the step up and the gap are at most 5 cm, it has tactile paving (DIN 32984), its platform is at
least 2.00 m wide (BOStrab § 31), and at an island in a street people get onto it at its own
traffic lights, or at a zebra crossing or traffic lights within 30 m. Its card says why it is not;
boarding there takes 1.3 times as long.

A **tram line** is placed like a bus line, through its tram stops, and its trams run like the buses
(the timetable, the depot, the boards and the disruptions are the same), with these differences:

- Trams run on tram tracks only, and never cross a railway at street level (BOStrab § 15): a street
  with tram tracks that crosses a track without a bridge or an underpass (a
  [railway crossing](#railway-crossings) over or under it) has no tram tracks for the routes there,
  and the line says *No way along the tram tracks … trams cannot cross the railway at street level*.
- Tram tracks bend in **arcs of at least 25 m** (the alignment rules under BOStrab, TRStrab
  Trassierung: 40 m as a rule, 25 m in exceptions). Where a line turns from one street into another
  (or a street bends more tightly), the corner is rounded into an arc tangent to both, and the rails
  are drawn along it; a street drawn as a gentler curve stays as it is. Where two corners are too
  close together for that, the curves are as large as there is room for, and the line says *A curve
  of 18 m at Ringstraße / Bahnhofstraße: tram tracks need at least 25 m. Give them more room there.*
  Trams brake for a curve in time, to √(0.8 m/s² × radius): about 16 km/h in a curve of 25 m,
  20 km/h in one of 40 m.
- On **one track, both directions** a tram goes onto the single track only when none comes the
  other way; it waits before it (the passing loop is where the street has two tracks again).
- At the end of a line the trams turn best in a **turning loop** (Wendeschleife): a tram track of
  its own, *one track, one direction*, that leaves the end of the line and comes back to where it
  began, in curves of at least 25 m; with a loop at each end the line is a *dog bone*. Trams go
  round it without changing ends, and a route never turns on the spot where a loop leads round. Lead
  the line's two tracks into one (a short single track, the neck) a few metres before the loop, so
  that the tracks join in a straight line: there the loop's two legs meet the neck at 40° each.
- At the end of a **stub track** (a track that ends) the tram stops, the driver changes ends (20 s)
  and it goes back on the other track once that is free, over a crossover; one tram at a time.
- Where cars and trams share the lanes, cars keep behind trams and trams behind cars. Trams need
  not stop at zebra crossings (StVO § 26), but they stop at traffic lights and give way like the
  other vehicles.

## Signs, lights and zebra crossings

A **traffic sign** is put beside a street and applies to the traffic on its side (seen in the
direction the street was drawn: on the right side in the drawing direction, on the left side
against it):

| Sign | Effect |
| --- | --- |
| Stop (206) | stop at the line once, then give way at the next junction |
| Give way (205) | give way at the next junction |
| Priority road (306) | priority at the next junction |
| One-way street (220) | cars, buses and bikes drive only in the direction of the traffic it is for |
| Mandatory direction (209–214), lane arrows (297) | only the directions allowed at the next junction (`turn`; `arrows` as `"left \| straight right"`, lanes from the left) |
| No stopping (283), restricted stopping (286) | no parking in the zone (`zone_m`, else to the next junction) |
| Footpath with *Radverkehr frei* or *E-Scooter frei* (239) | bikes or e-scooters may ride on the sidewalk |
| Bike path (237), shared path (240), separate paths (241), parking (314) | drawn; the cross-section of the street says what there is |

**Traffic lights** go onto a junction of three or more streets. The approaches along the main street
(`main`, else the first street at the junction) and those across it get green in turn: the main
street green for `split` % of `cycle_s`, amber 3 s, all red 2 s, then the cross street (red-amber
1 s, green, amber 3 s, all red 2 s). `offset_s` shifts the cycle, for a green wave.

**Zebra crossings** (Fußgängerüberweg, Zeichen 293 and 350) go onto a street: people on foot cross
there, and vehicles stop while people are on it or about to step on (trams need not, StVO § 26).
Nobody parks on it or 5 m before it (StVO § 12). Streets still get the painted zebra crossings next
to their junctions (`crossings`).

At a **junction** every vehicle has a priority: green or the priority road first, then no sign,
then give way, Stop or red. The one with the higher priority goes first, at the same priority the
one closer to the junction; ties go by the kind (tram, bus, car, bike) and then by the order in which
their simulation made them, so the same layout always runs the same way. Nobody drives into a
junction without room behind it (StVO § 11). Vehicles that wait for each other in a circle squeeze
past each other after 8 s, so nothing stays stuck.

## Railway crossings

A **railway crossing** is put where a street crosses a track. It is one object whose **kind** can be
changed at any time; each kind is a class of its own (`CrossingType` in
`web/arail/objects/crossings.js`):

| Kind | | What it needs |
| --- | --- | --- |
| `over` | **bridge**: the street over the track (Straßenüberführung) | height: 5.70 m over the rails of an electrified railway (4.90 m without), plus a 1.0 m deck |
| `under` | **underpass**: the street under the track (Eisenbahnüberführung) | height: 4.70 m for the street, plus a 1.5 m railway deck |
| `crossbuck` | level crossing with a St Andrew's cross only | not for a main road (EBO § 11: little traffic only) |
| `lights`, `half-barriers`, `full-barriers` | level crossing with light signals, with half barriers, with full barriers | closes while a train passes |

A bridge needs height: its street at least 6.7 m above the rails (77 mm in H0), an underpass 6.2 m
below them, a level crossing at their height. The crossing asks its street for that height over its
span (the tracks it crosses within 15 m, and 4 m beyond them); the street's heights follow from it
and from the levels of the table modules (see [Heights](#heights-table-modules-ramps-and-bridges)):
between two modules raised high enough the street runs straight over the tracks, otherwise it ramps up
(or down) at most 8 % (6 % with tram tracks) and the ramps take up length on both sides. The card shows
the clearance and the ramps; the crossing says when the ramps do not fit before the next junction or
the end of the street. The street draws the bridge: its deck over the tracks (trains pass under it,
cars on it), the edge of its deck, railings; for an underpass the railway's bridge. A level crossing
closes while a train of the control system is near or a timetable train comes in or leaves nearby,
else `trains_per_hour` times for `closed_min`; vehicles wait before it. Trams never cross a railway at
street level (BOStrab § 15): a level crossing on a street with tram tracks is an error, and the fix
makes it a bridge. New crossings of streets and railways are built over or under the track anyway
(EKrG § 2).

## Heights: table modules, ramps and bridges

Table modules lie at a **level** (`level_mm`): the height of their top above the track level, the top
of the real table. Houses, streets and the rest are built on table modules and stand at their level;
in a layout with table modules, what stands off them is a problem, and the editors do not place it
there. A street follows the modules it runs on (`web/arail/core/elevation.js`):

- from one level to another it climbs at most at its **gradient**: 8 % (RASt 06), 6 % with tram tracks
  and on footpaths (DIN 18040-3); the ramp lies on the lower side, so 80 mm in H0 take 1.0 m (8 %) or
  1.3 m (6 %);
- where it cannot come down to the ground between two higher parts it runs **straight from edge to
  edge**: between two modules 80 mm high over the tracks on the real table that is a bridge with 6.0 m
  clear above the rails; where it can, it goes down and up again;
- where it crosses a track without a railway crossing, the heights decide: 6.7 m or more above the
  rails it passes over (trams too), at their height it crosses at street level, between it runs into
  the track (an error of the street access check);
- streets meet at one height: a ramp that reaches into a junction, or a street that ends in the air,
  is a problem of the street.

The view draws everything at its height: what stands on a raised module up there, cars, bikes and
people on a bridge on its deck, the railway (tracks, platforms, signals, trains) on its module, so
trains pass under a bridge. Pointing at things and placing them find the point on a raised module
where it is seen. The levels change nothing in a layout whose modules all lie at the track level.

## Road traffic

Add the simulation to the layout (Settings shows nothing to set; edit the layout file):

```json
"simulations": [{ "type": "passengers" }, { "type": "traffic", "cars_per_km": 20 }]
```

Cars enter where streets end (dead ends at the edge of the layout) and leave again there. Their
number is `cars_per_km` per kilometre of street at normal daytime traffic, more in the rush hours
and few at night (`clock.demand("car")`). Every car has a **driver** and, by the purpose of the
trip, **passengers** (MiD 2017: about 1.1 people per car to work, 1.5 for shopping and leisure), and
a **planned route**:

- A share of the cars (`destinations`) drives to a building, by the time of day: to work in the
  morning, to the shops in the day, to visit people, home in the afternoon. The driver plans the
  drive on the map like a trip: the parking within 400 m of the building that the driver may use,
  each by the drive, the walk (counted 1.5 times) and the fee for the stay; a full one counts as a
  long search. On arrival the car takes the free space nearest to the building, pays, and the people
  walk there; it stays for its purpose (work 7 to 9 hours, shopping 20 to 60 minutes) and drives out
  again. With no free space it plans again (up to three times), else it leaves the layout.
- The others drive through, to another street end, on the fastest route (sometimes with a detour).
- At night the residents' cars stand in the residents' parking (`parked`, a share of its spaces);
  many leave in the morning.

Cars keep to the right lane and the speed limit, keep their distance to the vehicle ahead (cars,
buses, trams and the bikes they cannot pass), obey signs, lights, zebra crossings and level
crossings, and give way at junctions as above. On streets without dead ends (a ring) cars appear on
the streets and drive from place to place. When the streets change (a street drawn or moved, a bus
stop placed, the scale changed) the cars stay where they are on the new streets where they can;
cars that would end up on top of others leave. A car's card shows its driver and passengers, the
purpose, where it goes, the planned route, where it will park and what it costs, and the parking
the driver weighed. The example plugin [`road-traffic.js`](../web/plugins/road-traffic.js) is a much
simpler version of this.

## Parking

Cars park in the parking strips of streets, in **parking lots** and in **parking garages**:

- A **parking lot** (Parkplatz): rows of spaces with aisles (EAR 23), *perpendicular*, *angled* or
  *parallel*; its front, the way in, faces the street.
- A **parking garage**: a multi-storey car park (Parkhaus) or an underground garage (Tiefgarage)
  under a building, of which only the ramp and the stairs are seen; a space per 25 m² of each level
  unless `spaces` is set.

What it costs (`tariff`, `price_eur`): *free*, *by the hour* (usually 2 €; 1 € in the street), *by
the day* (15 €; 8 €), *by the week* (25 €; 20 €) or a *yearly permit* (120 €). A started hour, day
or week counts in full; a yearly permit costs nothing per stay. Who may park (`access`):
*everybody*, *residents with a permit* (the house it belongs to, or a resident nearby),
*customers of the owner* or *employees of the owner* (free for them, whatever the tariff), or *by
its owner* (`owner`): a supermarket's lot is free for its customers, a factory's for its employees,
a house's is for its residents.

Nobody parks within 5 m of a junction, on a zebra crossing or 5 m before it, at a bus or tram stop
or 15 m before and after it, or in a zone of no stopping (StVO § 12). A parked car's card shows
where and since when it stands, who drove it, where the people went and what it costs; a lot's card
how many spaces are taken.

**Bikes** are locked to street lamps (two at most) and to **bike stands** (Anlehnbügel, two bikes
each, 1.2 m apart) on a sidewalk.

## Bikes and e-scooters

Add the simulation to the layout:

```json
"simulations": [{ "type": "cycling", "riders_per_km": 8 }]
```

Riders on bikes (14 to 22 km/h) and e-scooters (15 to 20 km/h, eKFV) come in at the ends of the
streets and ride to another end, or to a building, where they lock the bike at a street lamp or bike
stand nearby for 20 to 240 minutes and ride on. A bike is drawn as a bike: two wheels, the frame,
saddle and handlebar, its rider pedalling (children on smaller bikes), with its lamp lit at night;
an e-scooter with its deck and stem, its rider standing on it. Where they ride:

- on the bike lane, advisory lane, bike path or shared path where the street has one (it must be
  used, StVO § 2 Abs. 4), else on the road near the curb;
- on the sidewalk only where a sign allows it (*Radverkehr frei* for bikes, *E-Scooter frei* for
  e-scooters, eKFV § 10), at walking pace; children under 10 may (under 8 must) ride on the
  sidewalk (StVO § 2 Abs. 5); rule-breakers (`rule_breakers`) ride on sidewalks where it is not
  allowed and now and then through a red light.

Behind people on foot riders slow to walking pace, and where they share too little room both may get
angry (see [Cross-sections](#cross-sections)). A rider's card shows where the rider rides, whether
the rules are kept, the mood, and whether the cars behind must wait. The street's card shows the
conflicts of the last hour and the bikes at its lamps.

## The example: Bf Neustadt

The layout **EBL Bf Neustadt** (`web/layouts/ebl-neustadt.json`) shows most of it. Two tram lines
start at *Lindenstraße* and run along Ringstraße and Bahnhofstraße: line 1 to *Neustadt Bf* and the
*Busbahnhof*, line 2 on a track of its own into the *Markt* (an island stop on the way into the
loop, where the trams stop before they go round it). Both turn in loops at both ends, each on a town
module of its own beyond a short single track: west of Lindenstraße, at the end of Bahnhofstraße
past the Busbahnhof, and behind the Markt; their tracks bend in curves of 25 m and more. Behind them
**Brückenstraße** crosses the main line at a level crossing with half barriers to Am Plattenring: no
tram goes over it (BOStrab § 15), and everything lies at the track level. Both lines share the car
lanes of Ringstraße with traffic lights at Brückenstraße and a zebra crossing at Am Park, and have
their own lanes in the middle of Bahnhofstraße, where people cross the car lane to the trams at the
lights of the stops. The stops are of all four kinds. Residents park on a lot with a yearly permit,
travellers on the P+R by the day; a Stop sign and a no-stopping zone stand at the streets; bikes and
e-scooters ride with the cars.

## Day and night

Street lamps (every 30 m on each side, staggered) and the shelters of bus and tram stops light up at
night; buses, trams and cars switch on their head and tail lights, and the windows of buses and
trams are lit.

## Layout file

See [Layout file format](layout-format.md#road-street) for the parameters of `road`, `bus-stop`,
`bus-line`, `tram-stop`, `tram-line`, `traffic-sign`, `traffic-light`, `zebra-crossing`,
`rail-crossing`, `parking-lot`, `parking-garage` and `bike-stand`, and
[`simulations`](layout-format.md#simulations) for the `traffic` and `cycling` simulations.

## Sources

The widths, gradients and rules come from these German guidelines and laws:

- **RASt 06**: Richtlinien für die Anlage von Stadtstraßen (FGSV 2006): car lanes, sidewalks,
  gradients of streets.
- **ERA 2010**: Empfehlungen für Radverkehrsanlagen (FGSV 2010): advisory and bike lanes, bike and
  shared paths, safety strips.
- **EFA 2002**: Empfehlungen für Fußgängerverkehrsanlagen (FGSV 2002): sidewalks by the houses along
  them.
- **EAR 23** (and EAR 05): Empfehlungen für Anlagen des ruhenden Verkehrs (FGSV): parking strips,
  lots and garages.
- **DIN 18040-3** (barrier-free public traffic and open space) and **DIN 32984** (tactile walking
  surface indicators): step-free stops.
- **BOStrab**: Verordnung über den Bau und Betrieb der Straßenbahnen, §§ 15 (no crossing with a
  railway at street level; curves and gradients that let trams run well), 17 (curves with little
  lateral acceleration), 31 (platforms), 34 (vehicle widths); **TRStrab Trassierung** (curves of
  40 m as a rule, 25 m in exceptions).
- **StVO**: Straßenverkehrs-Ordnung, §§ 2 (bike paths, children on sidewalks), 5 (passing at
  1.5 m), 11 (keep junctions clear), 12 (no parking), 20 (public transport at stops), 26 (zebra
  crossings); **VwV-StVO** (the administrative rules on it); **eKFV** § 10 (e-scooters).
- **EBO**: Eisenbahn-Bau- und Betriebsordnung, §§ 7 (gradients), 11 (level crossings); **EKrG** § 2
  (new crossings over or under the track); **RE-ING** (clearances of bridges).
- **MiD 2017**: Mobilität in Deutschland (people per car by purpose).

## For plugins and simulations

- `accessProblems(world)` (`core/access.js`) lists what has no street to it and the streets that
  make no sense, each `{key, level, id, text, at, fix}`; `applyFix(world, fix)` carries a fix out (a
  street, footpath or underpass to the nearest street, a street end moved onto the street it almost
  meets, a railway crossing where a street crosses a track, or another kind for a crossing).
- `world.network()` returns the road network (`core/network.js`), rebuilt when objects, the marker
  map or the scale change. Nodes are at street corners and junctions; edges have `kind` ("road",
  "path", "connector", "lane", "tram"), who may use them (`car`, `bus`, `tram`, `bike`, `walk`),
  `oneway`, `carDir` and `tramDir` (one-way streets and tracks), `speed` (m/s), `width`, where each
  goes across the street (`walkOffset`, `laneOffset`, `tramOffset`, `bikeOffset`, mm), `bikeWay`
  ("road", "advisory", "lane", "path", "shared", "none"), `obstruct` (a bike holds up the cars),
  `conflict` (riders and people on foot), `zebras` and `rails` (where it crosses a track, at a
  railway crossing or not). Nodes have the traffic rules of signs and lights (`rules`, `turns`,
  `signal`). Building entrances (`entrances()`) and stop access points are connected to the nearest
  street within 80 m whose connector crosses no track: `place("building:<id>:<i>")`,
  `place("area:<areaId>:<i>")`. Further: `nearestNode(p, {mode})` (for walking only a node reached
  in a straight line over no track), `route(a, b, {mode: "walk" | "car" | "bus" | "tram" | "bike"})`,
  `distance(a, b, mode)`, `routeDirected(...)` (vehicles, with U-turn penalties), `drivingLine(path)`
  (the right lane, the track or the bike lane), `junctionsAlong(...)` and `crossingsAlong(...)` (the
  junctions and zebra and railway crossings ahead), `boundaryNodes()` and `junctions()`. Without
  streets the queries return null.
- **Walks**: `walk(from, to, {fromKey, toKey})` → `{points, lengths, length, hidden, route}`, the
  line a pedestrian walks (`walkLine(route, from, to)`): each street on the sidewalk on the side
  the walk comes from (kept round corners), across at right angles at a zebra crossing on the way, or
  at the end of a street where the next place lies on the other side, footpaths and connectors
  joining the sidewalk, not the middle of the street. `hidden` lists the stretches out of sight
  (`[s0, s1]` in mm, the underpass); `hiddenAt(walk, s)` tells whether a walker is out of sight.
  People do not cross tracks on their own (`crossesBarrier(a, b)`): only on streets and footpaths
  over them. Where the streets do not connect start and goal, the whole walk is out of sight
  (`offstage`); without any streets it is straight (`straightWalk`), out of sight only over a track.
  The town, the journeys and the crews of the operations walk this way.
- Objects take part through methods: `roadInfo()` (a street: points, width, cross-section, speed,
  offsets), `entrances()` (doors of a building), `stopAreas()`, `busLane()` (a lane for buses),
  `walkBarrier()` (a polyline people do not cross on their own; tracks have it), `trafficRule()`
  (signs and lights), `crossingInfo()` (zebra crossings), `railCrossingInfo()` (railway crossings),
  `parkingInfo()` (parking facilities: a street's strips, lots, garages), `bikeParking()` (street
  lamps, bike stands), `noParking(road, side)` (stretches of a street where nobody parks), and for
  tram stops `dwellFactor()`, `blocksCars()` and `carLaneShift(dock)`.
- **Heights**: `world.elevation` (`core/elevation.js`, `Elevation`): `ground(x, y)` (the level of the
  table module there), `street(x, y)` (a street off the ground there, else the ground), `profile(id)`
  and `heightOn(id, s)` (a street's heights along it), `trackCrossings(id)` (where a street crosses a
  track: over, at street level, under or into it), `streetProblems(id)`, `onModules(points)`. Table
  modules give their level with `groundLevel()`; railway crossings ask their street for heights with
  `streetLevels(el)`. Objects and simulations say what they stand on with `elevation` (of the class or
  the instance): `"street"` (the default), `"ground"` (the railway: on its module, under bridges) or
  `"none"` (they draw their heights themselves); `World.draw` sets the view's `lift` for each.
  `world.problemsOf(o)` adds *Not on a table module* to an object's own problems (`offModules`; a tree
  stands on its trunk, `standsOn()`; `anywhere` for what may be anywhere). `surfacePoint(world, view,
  pixel)` (`core/pick.js`) is the point seen at a pixel on a raised module or a bridge.
- The cross-section: `crossSection(spec, kind)` (`objects/street-profile.js`) → the strips from the
  centre line out, the offsets of each kind of road user, `warnings`, `obstruct`, `conflict`;
  `NORMS` holds the widths, `widthChoices(key, spec)` the standard values offered in the editors.
- `world.parking` (`core/parking.js`, `ParkingSpaces`): `facilities()`, `occupied(id)`, `free(id)`,
  `take(id, car, near)`, `release(id, car)`, `bikeSpots()`, `lockBike(rider, p, maxMM)`,
  `unlockBike(rider)`. `parkingTerms(facility, driver)` says whether a driver may park and what it
  costs; `planDrive(world, {from, to, purpose, driver, stayMin})` (`sims/traffic.js`) plans a drive
  to a parking space.
- `world.transit` (`core/transit.js`): `lines` (id → `{id, label, color, vehicle, ok, problems,
  visits, directions: [{dir, from, destination, loop, stops, route}], circuit, turns, single,
  reversals}`; a loop's `destination` is `"Ring ↻"` or `"Ring ↺"` by its turning number `turns`,
  see `ringName()` and `turningNumber()`), `connections(fromAreaId, toAreaId)` → `[{lineId, dir,
  fromDockId, toDockId, stops, rideMM}]`, `vehicleAt(dockId)`, `statusFor(dockId)`, `buses` (each
  with `kind: "bus"` or `"tram"`, `line`, `lineId`, `direction`, `destination`, `riders`, `dock`,
  `phase`, `doorsOpen`, and `outOfService` on its way to the depot: nobody boards it). Line buses
  and trams emit the usual `vehicle.arriving`, `vehicle.arrived`, `vehicle.departing` and
  `vehicle.departed` events with `{vehicle, dock, area}` at the stop docks. The town simulation
  puts its people into `riders` and lets them get off when the vehicle arrives at their stop.
- Docks with `managed` set are left alone by the timetable (`core/services.js`).
- The texts of the boards come from `sims/passengers.js`: `statusLines(world, area)` (the most
  important first: a timetable vehicle at a dock, the next bus or tram of each line, the next
  timetable vehicle), `dockStatus(world, area)` (its first line) and `boardStatus(world, areas)` (the
  lines of a stop's board over all its areas, at most two).
- Simulations with vehicles on the streets can expose `roadUsers()` (`[{vehicle, front, rear, dir,
  approach}]`): buses, trams, the traffic and the cycling simulation keep their distance to them and
  give way at junctions (`mustYield`, `roomAfter`, `waitFor` in `core/transit.js`).
