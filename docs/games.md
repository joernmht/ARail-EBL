# Games: a game for every role

ARail has two faces. The **app** (`app/`) presents the lab: its modules' cases are stories to click
through on Bf Neustadt (see [Getting started](getting-started.md)). The **games** let students take
decisions themselves and live with their consequences. This guide describes how the games are meant
to fit together, and the first role game, the signaller of Bf Neustadt.

- [The idea](#the-idea): every role, from the politician to the cleaning staff
- [The roles](#the-roles): the role catalogue
- [A mini game](#a-mini-game): what each role's game has
- [The game core](#the-game-core): what the games share in the code, and the engine that joins
  them ([The game core: one engine for every role](game-core.md))
- [Two ways to play them together](#two-ways-to-play-them-together): the career mode (a graph of
  possibilities, with the career planner), the railway undertaking's simulator, and the big game
- [The signaller of Bf Neustadt](#the-signaller-of-bf-neustadt): the first role game, and
  [its shift on the table](#the-shift-on-the-table): the game on the lab's layout, in augmented
  reality, with the maintenance dispatcher's district beside it
- [German mode](#german-mode): an endless game, the load rising until nothing moves
- [How a game looks](#how-a-game-looks): a line or two, a picture of where you work
- [What a mission needs](#what-a-mission-needs): the rules for a new mission ([How to develop the game](mission-design.md))
- [Where the games are](#where-the-games-are) and [what comes next](#what-comes-next)

## The idea

The railway is many people deciding at once, each with their own means and limits: a member of
parliament votes on the budget, a transport authority tenders a regional network, an asset manager
plans renewals, a signaller sets routes, a train driver brakes for a caution signal, a cleaner has
eight minutes for a train at the terminus. ARail's games make these roles playable:

- **Each role's game works on its own**, isolated: 5 to 30 minutes, one role's dilemmas, playable in
  a lecture or alone, with a debrief.
- **All roles join into one big game**: what one role decides is what another role has to work with
  (a budget, a timetable, a closed track, a late train, a fault report).
- **Two ways to play the whole**: a **career mode**, one person's working life through roles, and a
  **simulator of a railway undertaking (EVU)** and the system around it, economics and logistics.
- **Knowledge-driven and simulation-driven games**: some have a right answer (a rule, a calculation, a
  term), some answer by a simulation (decisions under uncertainty), many are both.

The issues behind this are #102 (a homogeneous, modular game architecture), #103 (the common game
core), #104 (game modes, time scales and difficulty), #105 (missions as data), #106 (multiplayer),
#123 (knowledge-based games) and #124 (role-play-based games); the game mechanics that were in the
app are parked on the game page (#144).

## The roles

The role catalogue collects the roles of the German railway system, in English with their German
names, grouped in families: politics, public authorities and regulators; the infrastructure manager's
operations and capacity; its assets, maintenance and construction (with the construction companies);
the railway undertakings' passenger services; freight and logistics; rolling stock, workshops and
industry; stations, passengers and the public; corporate functions, safety, education and research.

For each role it says what a game designer needs: whether the work is **operational** (a control
room, a train, a shift), **field** (outdoors on site), **office** or **mixed**; the **decisions**
the person takes and their **effects**; the **budgets and means** at hand, with orders of magnitude;
the **rules and limits** (laws, regulations, contracts, physics); the **personal risks** (liability,
injury, licence, stress, shift work, public exposure); the **career**: how one becomes it, where one
often comes from and goes, pay, and its **ways in** (below); what the role is **measured by**; the
**rhythm** of its decisions (seconds to a legislature); the roles it **works with or against**; and a
**mini game** for it.

Each role also has its **party** (the infrastructure manager, a railway undertaking, a transport
authority, …), its **scale** (the rhythm of its routine decisions) and what it **gives** to other
roles: typed flows such as a budget, a train path, a possession, a fault report, a penalty, each
with what exactly is handed over and the roles it goes to; what a role **takes** is what the
others give it. Across the catalogue these are about 2,900 flows from one role to another: the
wiring diagram of the railway, and of the big game ([The game core](game-core.md#flows)).

Next to the roles the catalogue holds the **qualifications** that the ways in need: school
certificates, apprenticeships (such as Eisenbahner/in im Betriebsdienst), degrees and state exams,
function trainings for career changers, licences (the train driver's licence), certificates and
exams, each with what it needs first, how long it takes and whether it can be done alongside a job.

The catalogue is described in [docs/roles.md](roles.md) and can be browsed on the game's roles page
(`game/roles/`).

## A mini game

Every role's game has the same parts, so that it can stand alone and join the big game:

| Part | What it is | The signaller's |
| --- | --- | --- |
| The role | One role of the catalogue, its setting and its rhythm | Signaller (Fahrdienstleiter) in a relay interlocking, operational, seconds to minutes |
| The loop | What the player sees, decides, and what happens | The panel; routes from a start signal to a destination; trains run by them |
| Means and limits | Budgets, staff, time, authority; the rules | The interlocking's logic, the timetable, Ril 408 (simplified) |
| Decisions | With options, a deadline and a default if nobody decides | Report the failed signal; close the track for the repair team; open it again |
| Knowledge | What the player must know or learns | The substitute signal and its checks, closures for works, short questions |
| Objectives | Weighted, each reached 0–1, a score 0–100 | Punctuality, safety, connections and platforms, the failure, questions |
| Failure | What ends a round as failed, whatever the score | A danger to people (rule broken with severity 3), a train not through |
| Into the big game | What it takes from and gives to other roles | Takes the timetable and its delays; gives delays, the fault report, closures |

## The game core

`web/arail/game/core.js` is the common game core (#103); [The game core: one engine for every
role](game-core.md) describes it and what is built on it: the flows between roles, sessions in turns
and shifts, missions as data. The role games have their own entry, `web/arail/game/index.js` (the
core, the flows, sessions and missions, the catalogue's checks, the career model, the role games): the framework's entry `web/arail/index.js` does not export them, and no part of
the framework imports them, so a layout, a simulation or a plugin loads none of their code (see
[Using ARail for research](research.md)). A **game** (`class Game`) is one role at work:

- a **clock** in simulated seconds (`t`), stepped by the page (`step(dt)`), with the game's own `tick`;
- **resources** (`resource`, `add`, `value`): money, time, staff, counters;
- **decisions** (`ask`, `decide`, `open`): a title, options, a deadline and a fallback taken at the
  deadline; what an option does is the game's handler;
- **moves** (`act`): everything a player does, by the name of its method, kept so that a game can
  be played again;
- **ports** (`takes`, `gives`, `give`, `take`): the flows a role takes from other roles and gives
  them; alone, a game plays the other end itself;
- **rules** (`violate`): a rule broken, with its severity: 1 a slip, 2 a breach, 3 a danger to people;
- **objectives** (`objectives`) with weights, and the **score** (`score`, 0–100);
- a **log** and **events** for the page (`log`, `decision`, `decided`, `violation`, `move`, `give`,
  `receive`, `over`), and a **view** (`view`) from which a page can draw a game it does not know;
- the **result** of a round (`result`): score, rules broken, passed or not, the decisions taken. A
  round is passed with a score of at least 50 and no danger to people. The result is what the career
  mode and the big game take from a round.

Games run without the world and without the DOM, in Node and in the browser, and are deterministic:
the same seed and the same moves at the same times give the same game (random numbers come from
streams keyed by the seed and their purpose). They can be tested and replayed, and later played by
computer players for roles nobody plays (a game's `static player`).

## Two ways to play them together

**The career mode** follows one person through roles. It is not a path laid out in advance but a
**graph of possibilities**: the person starts from a school certificate, and at every point some
jobs are open and some educations can be started; the player chooses. Each job has its **ways in**,
alternatives of qualifications and years of experience in other roles: the signaller in a relay
interlocking after the apprenticeship in railway operations, or as a career changer after a function
training; an asset manager after a degree and years as an engineer; a minister by appointment after
years in politics. Many roles can only be reached through an education first (studying, an
apprenticeship, a training, a licence), and each qualification needs others before it. Educations
that cannot be done alongside a job mean leaving the role for their time. How a role is filled
(an application, a move within the organisation, an election, an appointment), a minimum age and the
fitness needed are part of its way in; after a year in a role, what it gains (a supplementary
certificate, a recognition) is held. The typical moves of the catalogue (where a role's people often
come from and go) are hints, not rules.

In the full game each step is a round of that role's game: a passed round counts towards the next
step, a failed one means another round with an instructor, a danger to people ends with an
investigation (an interview, a licence suspended for a while); applications and elections can fail.
Pay, reputation and qualifications are the career's resources; stress and shift work its costs.

The **career planner** (`game/career/`) is a first prototype: start from a school certificate, see
what is open, take a job, start an education, work on, step back; aim at any role and see, on each of
its ways in, what is there, what is missing, and what each missing qualification needs first. Its
model is `web/arail/game/career.js` (`options`, `takeRole`, `study`, `work`, `roleStatus`,
`reachable`); a test checks that every job of the catalogue can be reached from leaving school.

**The railway undertaking's simulator** is the economic and logistic whole: the fleet and its
maintenance, crews and rosters, contracts with the transport authority and their penalties, track
access, energy; the operations module (on the game page) is its first part. Here the roles are the
undertaking's departments; the player runs the company over months and years.

**The big game** connects both through what the roles give each other: the budget of the federal
government and the Länder flows to the infrastructure manager and the transport authorities; their
tenders and timetables to the railway undertakings; the undertakings' trains to the signallers and
dispatchers; their delays and faults back to maintenance, customer service and, in the end, to
politics. The roles run on different time scales (seconds for a signaller, years for a minister); the
big game couples them by what they give each other (#104): a session plays the slow roles in turns
and the fast ones in shifts, a turn's decisions reach the shift as state (a staff plan, the
condition of the assets), and the shift's reports reach the next turn; a shift is a sample of its
period ([The game core](game-core.md#turns-and-shifts)). Roles nobody plays are played by the
computer. The first roles are joined: the signaller of Bf Neustadt and the maintenance dispatcher
of its district for a morning (the mission `neustadt-morning`), the train dispatcher above the
signaller, between three undertakings (`whose-minutes`), the yard master at the hump yard west
of the station (`last-wagon`, alone so far), the workshop manager in the hall of Betriebswerk
Neustadt (`fit-to-run`, alone so far), the maintenance district manager for a week of works
(`short-notice`, alone so far), and with the undertaking's
operations control, the asset manager, the transport authority's contract manager and the budget
committee's rapporteur for three budget years (`neustadt-years`): the budget is the district's
money, the district's plan is the dispatcher's teams and the signal's chance to fail, the contract
is what a late train costs the undertaking, and the morning's reports are the year's delay minutes
and the contract's incident list. On the lab's own timetable the operations
are the EBL's simulation (`lab-morning`). All of them are played on the play page (`game/play/`).

The morning is the mission worked out furthest, as the model for the others:

- **Pictures.** The signaller works on the track panel, the dispatcher on a map of the district
  with the vans; what is chosen in the picture offers its moves.
- **Choices that give something up.** The dispatcher's teams are of two trades, a fault's cause
  is known only when a team has looked, a quick repair may not hold, a team that guards a danger
  repairs nothing, a technician on call costs overtime. The computer's dispatcher plays by simple
  rules and can be beaten.
- **What led to what.** The result shows every fault on the time line of the shift: whose each
  stretch of its time out of order was (the signaller's, the dispatcher's, the road, the work),
  where the teams were while it waited, and what it did to the trains
  ([The game core](game-core.md#what-led-to-what)).

## The signaller of Bf Neustadt

`game/signaller/` is the first role game: the signaller (Fahrdienstleiter) of Bf Neustadt in a relay
interlocking with a track diagram panel, half an hour of a morning, simplified for teaching from the
German rules for signallers (Ril 408). The station is that of the lab survey and of the app's
maintenance story: platform tracks G1 (platform 1), G2 and G3 (the island platform 2, 750 m long),
the double-track line from Bergheim (west) to Talsee (east), the entry signals A and F, the exit
signals N1–N3 (east) and P2, P3 (west), the points W1–W6.

**How to play.** Choose a start signal on the panel (or in *Routes*) and then its destination: the
interlocking checks that the route's sections are clear, not locked by another route and not closed;
it moves the points (6 s each), locks the route and clears the signal. The train takes the route; the
signal goes back to stop behind it; the sections and their points are released behind the train's
tail. A route can be cancelled as long as no train runs towards its signal on it (approach locking).
The panel's colours: a locked route Türkis, an occupied section red, a closed track orange; the lamps:
stop, proceed, and the substitute signal Zs 1. *Pause*, *1×*, *5×*, *10×* set the speed; *P* pauses,
*Escape* lets go of a start signal.

**The trains.** Regional trains RB 31–36 stop at platform 2, where each eastbound train has a
connection to the westbound train on the other side of the platform: the westbound train should wait
until the passengers have changed. Freight train GZ 47 waits in G3 until intercity IC 2045 has passed
on G1 (an overtaking); GZ 49 runs through westbound. Trains brake for a signal at stop; a train that
passes the distant signal (1000 m before a main signal) at caution brakes as if to stop until it sees
the signal clear (400 m): a route set late costs time.

**The failure.** At 08:13 exit signal N2 fails (a lamp failure, as in the maintenance story): its
route can be set, but the signal stays at stop. The player

1. **reports the fault** to the maintenance dispatcher (the repair team drives out from the
   maintenance base);
2. lets RB 33 leave G2 with the **substitute signal Zs 1**: after checking that the route is set and
   locked and the track ahead is clear, and recording the reason with the counter reading; the train
   then runs at up to 40 km/h through the points;
3. **closes track G2** for the repair team when it asks (once G2 is clear), and plans the trains of G2
   onto other tracks meanwhile;
4. **opens G2 again** only when the team reports that it has finished and left the track.

Short questions come with these moments (what lets a train pass a failed signal, how fast on Zs 1,
what comes before the team goes onto the track, when the track may be opened).

**The score.** Punctuality 35 (the average delay at departure or passing, weighted: intercity 2,
regional 1, freight 0.5; nothing left at 6 min), safety 30, connections and platforms 15, the failure
10 (reported within 2 minutes: all of it), questions 10. Rules broken: Zs 1 without a locked route or
into an occupied section, or opening the track with the team on it, is a danger to people (the round
fails); Zs 1 without the checks is a breach; no or the wrong reason recorded is a slip. A shift is
passed with 50 points, no danger to people and every train through.

**Levels.** *Training*: no failures. *Normal*: the signal fails at 08:13. *Hard*: trains up to three
minutes late, the signal fails at 08:11:40, one more freight train. A mission can say which trains
come late, whatever the level (the seat's option `late`: a train's id and its seconds), and how
far each may come earlier or later than it was announced (`spread`, drawn by the seed): the
neighbouring station's forecast is then told first, and the true figure when the train is on its
way.

**In the big game.** The signaller takes the timetable (from the capacity planning and the railway
undertakings) and the trains' delays; gives delays to the undertakings' dispatchers and to
passenger information, fault reports to the maintenance dispatcher (the maintenance story's repair
team), and closures and reopenings for works. With a train dispatcher seated it takes the
dispatcher's orders: a train waits for another at most so many minutes (for its passengers, or to
let it go first: a freight train then no longer waits for a late train planned before it), and a
train that is still to come takes another platform track, unless its entry route is set already (then
it comes where that route leads, and the dispatcher is told). In the career mode the role is open after the
apprenticeship in railway operations or, for career changers, after the signaller's function training
(in a lab like the EBL); from it, among other ways, the dispatcher of an operations centre, the
instructor or the emergency manager become possible.

The code: `web/arail/game/signaller.js` (the interlocking, the trains, the failure, the score; Node
tests in `tests/js/signaller.test.js`), the page `web/game/signaller/` (browser tests in
`tests/e2e/signaller.spec.js`).

### The shift on the table

In a mission the signaller does not only work on the panel: the shift is played **on the table**,
the lab's layout of Bf Neustadt, as the app shows it. The picture behind the game is then the game
itself. The trains of the timetable run on the real tracks as cars (a railcar for a regional train,
a locomotive with coaches for the intercity, a long freight train), stop at the real platforms and
open their doors; a route is a Türkis band on the rails it locks (it pulses while its points move);
the signals stand beside their tracks as masts with a red or green lamp, the three white lights of
Zs 1, and a ring on the ground. The people of the layout's world wait on the platforms and get on
the game's trains.

**Nothing is written on the table** (the rule of [how a game looks](#how-a-game-looks)): no train
numbers, no names of signals or tracks, no times. What needs the player pulses where it is: a
signal pulses orange when a train comes to it within two minutes, or stands before it ready to go,
and no route is set from it. The names, the trains on the lines and their delays are on the panel
beside the table; the table's controls are in the side bar, its notes in the line at the top.

**How to play.** Click a signal on the table (the one that pulses, to begin with), then where its
route goes: one of the marks that pulse, or the platform track itself. A click on a platform track chooses it (to
close or open it); a second click lets go. The panel stands small in the lower right corner and
works as before: what is chosen in one is chosen in the other, and a signal chosen on the panel
brings the table's camera to it. Everything else (the questions, the fault report, Zs 1 with its
checks, the desk) is as on the panel: the table is another picture of the same game and makes the
same moves, so the score, the stars and a saved session are the same.

**Three ways to see the table** (in the side bar: the button *The table*):

| | What it shows | For |
| --- | --- | --- |
| **Table** | The photo of the real table (the layout's orthophoto) from above, with the town behind it. The camera is yours: *Bergheim end*, *Platforms*, *Talsee end*, *Whole station*; a drag slides the table, the wheel, two fingers, **+** and **−** go nearer and farther, the arrows slide it, **0** shows the whole station (with the right button or Shift a drag turns and tilts) | playing anywhere |
| **Lab photo** | A photo of the lab. The camera's place is found from the table's markers, and the game is drawn onto the real table (where the markers are not found in it, the line at the top says so) | seeing what it is in the lab |
| **Camera** | The camera of your tablet or phone (held wide), in the lab: point it at the table and its markers, and the shift runs on the real table in front of you. Without markers in view only the camera image is shown, and a note says so; without a camera the table stays as it was | playing in the lab (it needs https) |

**T** (or *Play on the table*, behind the side bar's button) switches the table off and on; the
choice is kept in the browser. Whether the table's markers are in view, and why a camera cannot be
used, is said in the line at the top (where the markers cannot be searched in the browser, choosing
the photo or the camera again tries once more). The table is there wherever the live picture runs (not in a narrow window, where less
motion is asked for, or where the device is too slow: there the panel is the picture, as before).

**How the station lies on the table.** `TABLE` in `web/game/table.js` gives every section of the
panel's station its way on the layout, along the real rails as the table's orthophoto shows them:
the platform tracks G1 to G3 beside the two platforms, the ladder of points towards Bergheim
(W1 to W3), the point of track G3 and the crossover towards Talsee (W6, W5, W4), the two lines
out to the ends of the table. The game's east is the layout's −x: a train to Talsee runs on the
track towards the windows. The table is shorter than the station, as every model railway is: the
platform tracks set the scale (about 3.6 mm of table per metre, the 750 m of track G2 on 2.7 m),
a train is drawn as long as it is at that scale, a section with a point is as long as its real
rails are (a train passes it faster or slower in between, never backwards), and of the 1800 m of
open line only the stretch next to the station is on the table. `tableProblems()` checks that
every section has its way and that the ways of every route meet.

**The dispatcher's district is on the table too.** The maintenance dispatcher's shift is played
there as the signaller's is, and the two share one table: whoever sits at the signaller's seat sees
the dispatcher's vans come, whoever sits at the dispatcher's sees the trains that wait for them.

- **The base** stands behind the station, at the end of Bahnhofstraße: a hall and a yard, with a
  van for every team (an orange roof for the signalling team, a Türkis one for the track team; a
  technician on call comes with a smaller one).
- **A fault** is a ring at its asset, with a lamp on a post: red and pulsing for a danger nobody
  guards, orange and pulsing while it waits and holds trains, Türkis while a team is at it, green
  for a moment when it is repaired. The faults of Bf Neustadt are where their assets stand (exit
  signal N2, the lift at the pedestrian tunnel). The table is smaller than the district, as every
  model railway is: a fault at Bergheim lies on the line at the Bergheim end of the table, one at
  Talsee on the line at the Talsee end (the level crossing of Brückenstraße is the layout's own),
  one on the branch to Waldau on the light-rail strip at the windows.
- **A team** drives the layout's streets to its fault, in the time the game gives it (the first
  minutes it gets ready). Its people stand beside the van while they wait for the closure, and at
  the asset while they look for the cause, work or guard a danger. A track asked for is a band that
  pulses on its rails; closed, it is steady. Where no signaller's game runs the station (*Fault
  Night*), a platform track closed for a team is kept free of the layout's own trains.

**How to play.** Click a fault, then the van to send (the vans that can go pulse); or a van first,
then where it goes (a van is marked while there is a fault it can be sent to). A click on the base
offers the technicians on call, while one can still be called. The district's map stands
small in the lower right corner, as the signaller's panel does: it has the names and the minutes,
what is chosen says below it what is known of it, and its moves are buttons there. The decisions
(the closure, a repair for good or a quick one, guarding a danger) are asked at the bottom as
before. *Fault Night* is a late shift, 22:00 to 22:40: the town's windows are lit, and the lamps of
the faults and the vans' beacons glow.

**The undertaking's trains are on the table too.** *Transportleitung* is played on the table of
the signaller's game that runs the same morning: the signaller's seat is the computer's, and the
mission says which feeders come late (RB 31, RB 33 and RB 35). The regional trains have a thin
ring where they are; a late one is marked at the end of the table it will come in at as soon as it
is announced, and a train of later in the day that is cancelled has one on platform 1, where its
passengers wait. A ring pulses orange while the train's passengers have not been told of its delay,
and in the choice's colour while a question is about it: the feeder out on the line and the train
at platform 2 that could wait for it. A click on a train chooses it; *Tell the passengers* is its
move, below the picture of the connections (a row for each: the feeder, how many change, the train
they change to; green once it is kept, red once it is missed), which stands small beside the table.
A hold that is asked for is the signaller's to keep: the train stands at the platform with its
doors open until the changers have crossed. Code: `web/game/control.js` (`ControlBoard`; Node
tests in `tests/js/game-control.test.js`).

**The dispatcher's trains are on the table too.** *Whose minutes?* is played on the table of the
signaller's game that runs the same morning: the signaller's seat is the computer's, and the
mission says which trains come late and how far their forecasts may be off (the intercity, RB 33
and RB 35). Every train has a thin ring: Türkis while it runs as planned, orange once it is known
to be late; a train that waits by an order has a full ring, and the trains a question is about
pulse in the choice's colour (the freight train in G3 and the intercity it could let pass). A click
on a train chooses it; its orders are its moves, below the picture of the tracks beside the table:
a chart of the three platform tracks over the morning, with a thin line where each train is
planned on its track and a thick one where it is expected now (green as planned, orange late,
red where two trains are expected on one track at once). What is ordered happens on the table:
the freight train stands in G3 until its wait is over, a train sent to G1 runs in there, the
people on platform 2 wait for the train that is held for them. Code: `web/game/dispatch.js`
(`DispatchBoard`, a `ControlBoard`; Node tests in `tests/js/game-control.test.js`, the game's in
`tests/js/game-dispatcher.test.js`, browser tests in `tests/e2e/dispatcher.spec.js`).

**The hump yard is on the table too.** *The last wagon* is the yard master's first half hour of an
early shift, 06:00 to 06:35 in the frost, at the layout's module Hump yard west of the station (off
by default; the table switches it on, and the camera stays over it: a board says which modules
are on with it, where the camera may look and what the parts of its picture are called). The
game's world is ARail's [hump simulation](hump-yard.md), and while the game is shown the layout's
hump yard draws the game's run instead of its own: the train pushed over the crest, the cuts
rolling through the retarders (orange while they brake) into six classification tracks, a wagon
red after an impact too hard, a track emptied when its train is pulled out. Three trains stand in
the arrival tracks and a fourth comes late by a forecast; four trains go out, each from its own
track at its cut-off, and a booked wagon that is not in then stays behind for twelve hours. The
yard master says which train goes over the hump next (one of a few) and how fast it is pushed (a
number, 0.8 to 2 m/s: up to 1.4 the automatic gets every switch between two cuts; faster, a
train is over sooner, and a good runner catches up the bad runner ahead), how long an outbound
train waits for its last wagons (a number of minutes: three its path forgives, beyond that the
path is lost), and what the one locomotive does besides pushing (take the wagon that must not be
humped round to its track, fetch a cut from the wrong track, close up a track): while it does one
thing, everything else waits. The board marks what can be chosen: a ring at the crest (orange
above the automatic's limit), one at the end of each track with an outbound train (orange once
it is due and wagons are missing, full while it waits), one round a cut in the wrong track. A tap
on the crest changes the pushing speed while a train is pushed (faster, slower, stop): slower just
before a good runner follows a bad one is what a hump master does by hand. The picture of the
yard beside the table has the arrival tracks, the train on the hump with each wagon in the colour
of how it rolls, the six tracks with their wagons, and for each its train's cut-off and how many
of its booked wagons are in. Three people count differently: the hump operator the impacts and
the speed, the production dispatcher the minutes a train leaves late, the customer service agent
the wagons left behind; below a mark each phones and asks for a promise that another of them
pays, and at the end of their patience the operator stops the hump and the other two put it in
writing. Code: `web/arail/game/yard.js` (`YardGame`), `web/game/yard.js` (`YardBoard`),
`web/game/missions/last-wagon.json`; Node tests in `tests/js/game-yard.test.js`, browser tests in
`tests/e2e/yard.spec.js`.

**And the workshop hall.** *Fit to run* is a night in the hall of Betriebswerk Neustadt, 22:00 to
05:24 in 37 minutes (its shift has a pace: a second is twelve of the night), on the layout's
module Workshop hall beside the hump yard's. The module's object is a hall seen inside, without
its roof: the pit with its roof platforms, the lifting jacks, the underfloor wheel lathe, three
stabling tracks outside and the one throat every move goes through. While the game is shown the
hall draws the game's night: a unit moving out through the throat and in again, raised on the
jacks with its bogies left on the rails, fitters beside the unit they work on, the lathe's chips
glowing, a lamp at each track in the colour of its unit's state, a driver at the door of a unit
that is released and not yet returned to operation. The player is maintenance delivery, the
fourth of the four functions of the entity in charge of maintenance, and the mission teaches who
decides what by what the workshop may not decide: a finding beyond the order is fleet
management's (phone and wait while the pit stands, repair it under the standing order and hope
it is small, or write it into the release), a limit is maintenance development's (measure again,
change the part, ask for a concession, or take the reading), and a unit released to service runs
only once fleet management has returned it to operation. How deep the lathe cuts and what time
the operator's dispatcher is given are numbers. The board marks every unit (orange while its work
waits for a word, full once it can be released) and every free track; a tap on a unit offers its
moves: a track, the release, the phone. Guide: [The workshop hall](workshop.md). Code:
`web/arail/game/workshop.js` (`WorkshopGame`), `web/arail/ops/workshop.js` (`WorkshopHall`),
`web/game/workshop.js` (`WorkshopBoard`), `web/game/missions/fit-to-run.json`; Node tests in
`tests/js/game-workshop.test.js`, browser tests in `tests/e2e/workshop.spec.js`.

**And a week of works.** *Short notice* is a working week in the maintenance district around Bf
Neustadt, Monday 06:00 to Friday 06:00 in 32 minutes (a second is three minutes of the week), on
the station's table by day and by night. Four works are in the plan: the contractor's tamping
machine at Bergheim in the night of Wednesday, the inspection of two points in the station's
standing window, a rail with a known defect at Talsee that must be changed by Thursday midnight,
the trees along the branch to Waldau. A driver's report of a hard knock, a point that fails in the
morning peak and a storm come unplanned. Five technicians do the work, and each has a home and a
week: two children and a partner on night shifts, a mother to care for, an evening school, the
fire brigade, 45 km to drive. Four people must hear of it, each in their time: the possession
planner a day and a half ahead (later, the undertakings claim), the works council a day ahead and
before the people (else: the labour court), the people two days ahead, the town between three days
and one (earlier is forgotten, later is a fine), the railway operations manager within the hour of
a dangerous event. What is told and then moved must be told again; what nobody needed costs
patience too. On the table the people are vans: each drives from its home to the base in the
morning and back, to a night's site, to a fault. A work is a ring at its site while it is planned
(orange while something is missing for it) and a building site while it runs: its possession a
band on the rails, the tamping machine, lamps in the dark. The trains a work or a fault holds are
discs beside the track, more of them in the peak; the houses beside a night's site show a note at
the door, or lit windows and a red ring when nobody told them. The four people are pins where they
sit (operations at the platform tracks, the works council and the team at the base, the town at
the town hall, safety at the station building), in the colour of their patience. A tap on a van
and then on a site puts the person on the work, a pin and then a site tells of it, a fault and
then a van sends somebody. In the storm the layout's weather is the storm. Beside the table the
week is a chart: the nights shaded, a bar for every work at its slot, a line where its period
ends, a row for every person with the hours their life forbids. Code: `web/arail/game/works.js`
(`WorksGame`), `web/game/works.js` (`WorksBoard`), `web/game/missions/short-notice.json`; Node
tests in `tests/js/game-works.test.js`, browser tests in `tests/e2e/works.spec.js`.

**A turn is on the table too.** The asset manager, the contract manager and the budget
rapporteur decide for a year or a month: their games have no trains to run, but what they decide
about lies on the layout. In their turns the table shows the scene of their game, thing by thing:

| Thing | On the table | Whose |
| --- | --- | --- |
| The condition of the track | A tint on every rail, from green (good) through yellow to red | asset manager, budget rapporteur |
| The staff plan | The maintenance base with a van for every team, a smaller one for the technician on call | asset manager |
| The renewals | Building sites on the rails: barriers, a machine, people at work; more of them the more is built | asset manager |
| The speed restrictions | Yellow stretches of rail with their board on a post | asset manager |
| Last year's faults | Red lamps that flash at the signals, the points, the level crossing: a few at a time, more the more faults the year had | asset manager |
| The trips of a period | A tally of twenty discs along platform 1: on time, late, cancelled | contract manager |
| The constituency's project | The stages of the line towards Bergheim: built ones a band with a new mast, the next one pulsing | budget rapporteur |

What an open decision is about is a ring with a pin that pulses where it is: the teams and the
technician on call at the base, the strategy on the platform tracks, the renewals at their building
site, the asset responsible's proposal out on the line, the operator's emergency timetable at its
trains. **A click on it brings that decision up** at the bottom; the choices are there as before
(the dots beside them and the number keys work as before). So a year is planned by going round
the district, not down a list. With two slow roles in one turn (*Three years of Neustadt*) the
table shows the other's things too, but only the seat shown tints the rails and has its questions
there. A year without faults has no lamps. *The Night Session* is at night. A game says what its scene is
(`view().scene`: a list of things, `{thing: "teams", n: 2, on_call: true}`, `{thing: "ask", id:
"teams", at: "base"}`), and the board knows no game: `web/game/turn.js` (`TurnBoard`, `THINGS`,
`PLACES`; Node tests in `tests/js/game-turn.test.js`).

The code: `web/game/district.js` (`DISTRICT_TABLE`: the spots; `DistrictBoard`: drawing, the way of
a van by the world's road network, what is clicked; Node tests in
`tests/js/game-district.test.js`). A board per game is named in `BOARDS` (`web/game/live.js`); a
new game gets on the table with a board of its own (`show`, `draw`, `hit`, `placeOf`, `partOf`,
`bounds`) and an entry there.

**The world is the game's.** On the table the modules of the layout whose trains run into the
station are off, the board (`TableBoard`, one of the world's simulations) is the planner of the
platform tracks, and the world runs at the game's speed. A train of the game that stands at a
platform is told to the world's services as a control system's train is (`feedArrived`, with a
vehicle of its own, `TABLE_TRAIN`, that says where its doors are): the people get on there. A
train of the world's own timetable still standing there from before the table was taken gives the
platform to the game's train (`ServiceManager.free`). The
level crossing of Brückenstraße, on the line to Talsee, closes for the game's trains (from 250 m
before a train reaches it until its end has passed; a freight train held at signal F stands across
it) and no longer by the clock: the town's cars wait at its barriers (`TableBoard.trainsNear`,
which a level crossing asks of the world's simulations; a crossing that none of the station's
tracks passes closes by the clock as before). When the table is left (another seat, **T**), the
board leaves the world, and the backdrop gets its modules and its own timetable back.

The code: `web/game/table.js` (the station on the layout, the board: drawing, what is clicked, the
world's services; Node tests in `tests/js/game-table.test.js`), `web/game/live.js` (the table's
camera, the table's photo, the lab's photo and the device's camera with the markers found in a
worker, which goes when the table is seen from above again or left), the play page (`tablePick`, `setSource`; browser tests in `tests/e2e/table.spec.js`).

## German mode

`game/german/` is the game without a mission: **the load on the infrastructure rises until you are
stuck.** There is nothing to win and nobody to answer to, only a score to beat, as in the game a
browser shows when the network is gone. It is the second entry of the menu's Games, beside the
missions.

Why it is called so: a network that carries more trains every year on the same tracks runs well for
a long time, and then, quite suddenly, not at all. What the game teaches is that capacity is not
used up evenly. The first trains cost nothing; the last ones cost everything, and it is always a
queue that ends the game, never a single train.

It is played in two places (`?game=signaller`, `?game=terminal`):

| | The signal box | The container terminal |
| --- | --- | --- |
| The place | Bf Neustadt, the signaller's interlocking as it is: routes, points, signals, trains that brake | A loading track, six stacks of three, a truck lane, one crane |
| What comes | Trains from both sides by a **timetable** that is known ten minutes ahead: each with its planned track and its time. Regional trains stop (G2 from Bergheim), intercity and freight trains pass (G1 from Bergheim); every train from Talsee is planned into G3 | Trains with containers; for each container a truck, 1 to 6 minutes after its train |
| What you do | A route in (entry signal, then a track) and a route out (the exit signal) for every train | Unload the train onto the stacks; give every truck its container. Only the top of a stack can be lifted |
| The score | 10 points a train; 5 fewer on another track than planned, 1 fewer for every minute late (at most 5) | A point for every container gone by truck |
| How the load rises | Every 2 minutes the trains of a direction come 5 % closer together: 3 minutes apart at first, never less than 115 s | Every 2 minutes the trains come 4 % closer together (260 s at first, never less than 165 s); from the ninth stage with three containers, not two |
| Stuck | More than 3 trains wait on one line before the station | More than 2 trains before the terminal, more than 5 trucks at the gate, or no move left in the yard |

The decision the signal box asks again and again: the planned track is occupied, and a train
stands before the entry signal. Another track costs half its points; waiting costs minutes, and a
line that fills up costs the game.

Both run at six seconds a second. A game with nobody at the desk is over in about ten minutes of
its clock. **Played well it lasts long**: the load stops rising where careful play still keeps up,
so what ends a game then is a bad run of trains (two freight trains in a row, a truck for the
container at the bottom) met with too little room. The computer's players (`GermanSignallerPlayer`,
`GermanTerminalPlayer`) last from half an hour to an hour and a half of the clock, depending on
the seed; the tests play both on many seeds (`tests/js/game-german.test.js`).

Keys: Space or Enter starts a game and the next one, P pauses. In the signal box a second click on a signal takes back a
route that no train has taken. A or F chooses the
entry signal and 1 to 3 its track; 1 to 3 alone lets the train of that track out. At the terminal Q,
W, E, R name a wagon and 1 to 6 a stack: first where from, then where to; a container a truck waits
for goes to its truck at once. The best score of each place is kept in the browser
(`arail.german.best`); `?seed=` gives the same game again.

The code: `web/arail/game/german.js` (`GermanSignallerGame`, which is the `SignallerGame` with a
timetable that never ends and with nothing that fails; `GermanTerminalGame`, a small terminal of its
own, not the terminal simulation of the layout), the page `web/game/german/` (browser tests in
`tests/e2e/german.spec.js`). German mode is not a role game of a mission: it is not in `GAMES`, has
no flows and no score out of 100.

## How a game looks

A mission is played as a game, not filled in as a form. What holds on the play page (`game/play/`),
and for the heads of the other pages of the games:

- **The picture fills the screen.** One picture stands behind everything: the place where the
  mission plays, where the seat you play works, or what a question is about. While a mission is
  played the screen does not scroll: the page's bar stays at the top, and below it there are only
  three things on the picture.
  - **One line at the upper middle, without boxes**, for what must always be seen: in a shift the
    clock and its speed (Pause, 1×, 5×, 20×), in a turn End the turn, then the figures of the seat
    shown ("Trains through 3 of 9 · Late now 1"), and a few words when the computer plays the
    seat. Only when it does not fit (many figures, a narrow window) it takes a second line. The
    mission's name and where it stands (the round, the phase) are in the page's bar, beside its
    name; on a phone they are behind the flag at the side. The board's blue fades out below it across the whole width, which
    keeps it readable on any picture. The time of a shift is a thin line at the lower edge of the
    page's bar.
  - **A rail of icons at the right**: the mission (its name, its phases), the seats as faces, the
    seat's tools (its moves, its desk, handing it to the computer), where you work, the messages
    (a bell that counts the new ones), what the roles gave each other, the sound, the live
    picture, only the picture, and the way back to the line. A click does what an icon says, or
    opens what is behind it beside the rail (Escape, a click elsewhere, or the focus leaving the
    rail closes it again); the icon's name is its tooltip.
  - **The band at the bottom**, as a visual novel has it, there while somebody speaks or asks. It
    lets the picture through (the board's colour at 76 %, its text a little lighter, so it stays
    readable whatever the picture shows). A text longer than the band scrolls in the band.

  **No information stands in a box on the picture.** It is in the line at the top or at the side,
  in the rail; the band at the bottom is only for who speaks. A new message comes into the line
  at the top, below the figures, one at a time (a newer one takes its place, and it goes by
  itself or when another seat is shown; one longer than the line is cut off, and its tooltip has
  all of it); all of them are under the bell, each on its own card with its time, the new ones
  marked (a session taken up again starts with none new). Something in the game's picture that a figure is about, or that needs attention, is not
  written out: it **pulses** in its colour (red for a problem, orange for a worry: the failed
  signal, a fault where a danger is not guarded), and a click on it says what is known of it. The
  pictures themselves carry no labels either: the live picture draws none (`View` with `labels:
  false`), and the still ones are taken without them and without the marker plates (signs that
  are part of the world, such as a station's name board, stay). `tests/e2e/play.spec.js` and
  `tests/js/game-shots.test.js` check this (of the game's own picture, only what it draws itself
  may hold text: its heading, the names on its shapes, what is chosen in it; `tests/e2e/picture.js`).
  **H** leaves only the picture.
- **A place for every game, a picture for every topic.** Every game has a **place** on the lab's
  layout (`web/game/places.js`: the signal box of Bf Neustadt, the line, the district, the trains,
  the station from the dispatcher's desk, the lab, the terminal, the station forecourt, the town,
  the town at night), and every mission
  names one. More pictures (`BACKDROPS`) come in by rule: `backdropFor` reads what a question or a
  message speaks of (a level crossing, a technician on call, passengers and their connection, the
  night session) and the stage fades to the picture that fits. The pictures are in
  `web/game/places/`: close-ups cut from the lab's photos, and close-ups taken in the flyover with
  everything in view virtual, by day and at night (drawn without the table's photo, which blurs
  when the camera comes close; their names end in `-fly`).
- **It can be live.** While a mission is played, the picture can be the layout itself, running
  (`web/game/live.js`; the bar's **Live**, or **L**): the world of Bf Neustadt as the app's flyover
  draws it, trains, trams, buses and people on their way, by day or at night, from a camera that
  stands where the still picture was taken (`web/game/shots.js`), sways a little, and flies on
  when a question is about something else. It is an ornament and changes nothing in a game; on a
  phone, where less motion is asked for, or where it is too slow, the still pictures stay.
- **A shift's picture is the table.** For a signaller's, a maintenance dispatcher's, an
  operations control's and a train dispatcher's seat the live picture is the game's own (the rail's **Table**, or **T**):
  the trains run on the lab's layout and the signals stand there, the vans drive its streets to the
  faults, the undertaking's trains are marked, and what is clicked
  on the table is chosen; on the table's photo from above, on a photo of the lab, or through the
  camera in the lab itself ([the shift on the table](#the-shift-on-the-table)). The games of one
  shift share the table; a seat whose game has no board yet watches it. The turns of the slow roles
  are on the table as well: it shows what their decisions are about, and a click there brings the
  decision up.
- **A line or two first.** A mission says what it is in its `hook` ("Nine trains, forty minutes,
  and one signal that will fail."), with its facts as chips; a long text shows its first sentence
  (`lead` in `web/game/short.js`) and the rest behind More. The briefing, the seed and the wiring
  open when someone asks for them.
- **Missions are stops on a line.** The first screen is the line of missions, in the order to play
  them, from *Your first shift* (nine trains, nothing fails) to *Three years of Neustadt* (six
  roles). The stop chosen shows its mission on the same screen: its seats as faces to take (a seat
  taken is yours, the others are the computer's) and Play. The arrow keys go along the line; the
  stop to play next is marked.
- **Playing is a stage.** The game's picture, if it has one, is the control desk in the middle
  (the signaller's panel, the dispatcher's district: what can be chosen in it is a button). A
  phase begins with its name over the whole screen; the seats are the cast, a face each.
- **Somebody asks, and a story is told.** At the bottom somebody speaks, as in a visual novel: a
  portrait that stands taller than the band, a name, the question, and the choices as filled
  buttons (keys **1** to **9**), one decision at a time (others that wait are dots to press); a
  decision with a deadline counts down. A decision can be a number instead of a choice, or
  beside one: how many minutes a train waits. It is a slider between its ends, with where it
  stands beside it and a button that takes it (**Enter** in the slider does the same; the arrow
  keys move it by its step). The band holds only this: who speaks, the story, the
  question with what is needed to decide, the choices. A decision is asked by the person its
  text names ("E. Kiebitz, the asset responsible (ALV), proposes …"), else by the game's own
  counterpart (`GAME_CAST` in `web/game/cast.js`). In a turn, what happened is read line by line
  (**Space** reads on): the year's faults, the delay minutes, the coalition partner's "Not a second
  time." A mission can also tell a **story** as data (`story` in its JSON): lines somebody says at
  a moment of a phase, or `on` something that does not go to plan. In *Your first shift* the train
  dispatcher talks a beginner through the first trains and then leaves the timetable to them;
  otherwise the dispatcher calls, from the first train on, only when a train stands at a signal,
  leaves late, goes to another track or misses its connection.
  While somebody speaks in a shift, its clock waits for the answer (**OK** or **Space**), so no
  line is passed over, at any speed.
  The portraits are **placeholders**, silhouettes in `web/game/cast/` (office, suit,
  high-visibility vest, uniform, headset): put a picture there and name it in `PORTRAITS` to
  replace one.
- **Windows a person places.** The game's picture (the signaller's panel) and a table it keeps in
  view at work (the signaller's **timetable**: each train with its track, arrival, departure or
  passing, note, where it is now and how late) stand on the stage as windows. The handle at the
  middle of a window's upper edge moves it, the grip in its lower right corner sizes it (with the
  pointer, or the arrow keys on them; Shift goes farther); a double-click or **Home** puts it back.
  Where a window was left is kept in the browser (`web/game/windows.js`). On a phone the panel stays
  where the page has it and the timetable is in the desk.
- **A railway term can be tapped.** The terms of `web/game/glossary.js` (Zs 1, LuFV, the asset
  responsible, a qualified block, …) are marked where a question or a message names them; a tap
  shows what the term is, in a line or two, with its German word. A term shown counts as met.
- **Stars, ranks and badges.** A mission passed gives one star, two from 70 points, three from 85
  (`web/game/progress.js`); the stars add up to a rank, from Passenger to Minister of transport,
  and what was done earns badges ("By the book", "Many hats", and one nobody is proud of). All of it
  is kept in the browser only, and only for a seat that was a person's: held by a person for at
  least half of its work, whoever holds it at the end. With several seats, the stars are for the
  score of your own seats (the computer's play at the others neither earns nor costs them), given
  when the mission as a whole is passed: it is passed together. The sheet lists the decisions
  taken at your seats.
- **The numbers are a pop-up.** The tables, the score, the messages and the moves as forms are a
  seat's desk, a dialog (**D**); what the roles give each other is another; after the session, the
  full report. The result itself is a verdict on the picture: the stars, the score, what was
  gained, the cast with their scores, a question to take along.
- **Quiet sounds.** A choice clicks, a chapter chimes, a deadline running out beeps
  (`web/game/sound.js`: made by the browser, no files); **M** or the bar's button switches them off.

The **logbook** (`game/logbook/`) is what the stars are for: the rank and what the next one needs,
the line with the best scores, the badges, the railway terms met as cards to turn, with a quiz
("Which term is it?"), the places worked at, and a **sheet** for every mission played: what you
decided, the terms you met with their lines, the questions of the debrief, to print and take along.

A new game adds its place to `GAME_PLACES` and who asks in it to `GAME_CAST`; a new mission its
`hook` and `place` and its line in `missions.json` (the order of the line). The tests
`tests/js/game-places.test.js`, `game-cast.test.js`, `game-glossary.test.js` and
`game-progress.test.js` check that none is missing and that every picture exists.

## What a mission needs

A mission is worth playing when two people decide differently in it and both have reasons.
[How to develop the game](mission-design.md) says what every new or reworked mission must have
(a clear educational aim, unclear decisions, results that are not certain, roles that react and
ask for compromise, decisions that are one of a few choices and decisions that are a number, a
part that is played and not answered, and the layout's world in it), shows how *Whose minutes?*,
*The last wagon*, *Fit to run* and *Short notice* meet each point, and lists the steps from the
idea to the pull request.

## Where the games are

| Page | What |
| --- | --- |
| `game/` | The game page. It opens like a game: the lab's photos full screen, drifting from one to the next, and the main menu, at most five choices: Continue, Games (Missions, German mode, Free play), Career (Logbook, Career planner, Roles), Options, Leave. Free play holds the games and exercises that were in the app: on the lab's layout the Sandbox, infrastructure asset management, rail operations and journeys, and the full terminal on the virtual container terminal; a link with a layout or a case (`game/?layout=…#infra`) goes straight to them, and the bar's Menu leads back |
| `game/play/` | The play page of the big game: the line of missions; choose one and your seats (the others are the computer's), play its turns and shifts on the stage (a role that works on a picture has it: the signaller's panel, the dispatcher's district map; what is chosen in the picture offers its moves), read what happened, and the verdict with its stars; the numbers, what the roles give each other and the full report open as dialogs. Missions, in the order of the line: Your first shift (the signaller, nothing fails), a morning at Bf Neustadt (signaller and maintenance dispatcher), Fault Night alone, Transportleitung (the undertaking's operations control, with the computer's signaller), Whose minutes? (the train dispatcher between three undertakings, with the computer's signaller), The last wagon (the yard master at the hump yard), Fit to run (the workshop manager in the hall), Short notice (the maintenance district manager's week of works), Malus Month, Budget Years and The Night Session alone, Rush hour (the signaller on a bad morning), three years of Neustadt (six roles: with the undertaking's operations control, the asset manager, the contract manager and the budget rapporteur), a morning in the lab (on the EBL's simulation API). The shifts at Bf Neustadt (the signaller's, the maintenance dispatcher's, the operations control's, the train dispatcher's) are played on the table: the game on the lab's layout, on the table's photo, a photo of the lab or through the camera ([the shift on the table](#the-shift-on-the-table)) |
| `game/german/` | German mode: the signal box (by a timetable that gets denser) or the container terminal under a rising load, with a score to beat |
| `game/signaller/` | The signaller of Bf Neustadt, as a page of its own (from the role catalogue; the game's menu has it as the mission *Your first shift* and in German mode) |
| `game/logbook/` | The logbook: the rank, the stars and the badges reached, the railway terms met as cards with a quiz, a sheet per mission played |
| `game/roles/` | The role catalogue: every role with its decisions, means, limits, risks, ways in and mini game |
| `game/career/` | The career planner: a career from a school certificate through educations and jobs, chosen step by step |

## What comes next

- More of every mission on the table: the faults of the dispatcher's district holding the
  signaller's trains for real (a failed point, a level crossing that stays open), the operations
  control's depot with its spare unit and its stand-by driver, the year of the slow roles played
  out on the table between their turns (the faults as they come, the building sites as they move),
  and the lab's own morning (`lab-morning`) on the lab's own trains.

- The role games of the catalogue, one by one, each on the game core and with its ports, so that it
  joins a mission with the others; next those whose flows the first games already speak: the
  undertaking's managers who take the contract's penalties, then the passenger with the journeys.
  The train dispatcher has its first form (*Whose minutes?*); what it lacks of the catalogue's
  game: the time-distance diagram of the whole line, diversions, the delay codes of the
  performance regime, and the undertakings' control rooms as seats for people.
  The yard master, the first role of the freight family, has its first form too (*The last
  wagon*); what it lacks of the catalogue's game: twenty tracks and their allocation, the staff of
  the shift, a broken retarder, and its neighbours as seats (the hump operator, the production
  dispatcher, the wagon inspector, the train dispatcher who gives the paths).
  The workshop manager, the first role of the rolling stock family, has its first form (*Fit to
  run*); what it lacks of the catalogue's game: the month at the workshop company (shift model,
  headcount, an investment, the works council), the catenary of the hall and its earthing, parts
  that are missing, and the other three ECM functions as seats for people.
  The maintenance district manager has a first form (*Short notice*); what it lacks of the
  catalogue's game: the year in monthly turns with forty technicians, their qualifications by
  installation type and their training, posts and apprentices, the real notice periods, and its
  neighbours as seats (the possession planner, the works council, the maintenance dispatcher,
  whose teams the staff plan is).
- Missions that open one another: a mission or a role is open once another is passed or a share
  of its points is reached, and the career becomes what the badges show (#273).
- The career mode on the planner's model: each step a round of the role's game, applications and
  elections that can fail, pay, reputation and stress (#146); qualifications earned by exams, quizzes
  and practical rounds in the role's game (#158); starting points as people, such as a wheelchair user
  for whom some ways are closed and others, through advocacy into politics, open faster (#157).
- The wheelchair user's trip as a mini game: step-free stations and trains, booking assistance,
  a broken lift (#156); the role games of every family (#148–#155).
- The parked games of the game page on the game core (#144).
- Several devices for one session (#106): the record of moves is ready for it, a relay is missing;
  a facilitator's view (#96) and the debrief with a timeline (#101).
- A mission editor and content packs (#105).
