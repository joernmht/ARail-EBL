# Games: a game for every role

ARail has two faces. The **app** (`app/`) presents the lab: its modules' tabs are stories to click
through on Bf Neustadt (see [Getting started](getting-started.md)). The **games** let students take
decisions themselves and live with their consequences. This guide describes how the games are meant
to fit together, and the first role game, the signaller of Bf Neustadt.

- [The idea](#the-idea): every role, from the politician to the cleaning staff
- [The roles](#the-roles): the role catalogue
- [A mini game](#a-mini-game): what each role's game has
- [The game core](#the-game-core): what the games share in the code
- [Two ways to play them together](#two-ways-to-play-them-together): the career mode and the
  railway undertaking's simulator, and the big game
- [The signaller of Bf Neustadt](#the-signaller-of-bf-neustadt): the first role game
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
comes from and can go, pay; what the role is **measured by**; the **rhythm** of its decisions (seconds
to a legislature); the roles it **works with or against**; and a **mini game** for it.

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

`web/arail/game/core.js` is a first, small form of the common game core (#103). A **game**
(`class Game`) is one role at work:

- a **clock** in simulated seconds (`t`), stepped by the page (`step(dt)`), with the game's own `tick`;
- **resources** (`resource`, `add`, `value`): money, time, staff, counters;
- **decisions** (`ask`, `decide`, `open`): a title, options, a deadline and a fallback taken at the
  deadline; what an option does is the game's handler;
- **rules** (`violate`): a rule broken, with its severity: 1 a slip, 2 a breach, 3 a danger to people;
- **objectives** (`objectives`) with weights, and the **score** (`score`, 0–100);
- a **log** and **events** for the page (`log`, `decision`, `decided`, `violation`, `over`);
- the **result** of a round (`result`): score, rules broken, passed or not, the decisions taken. A
  round is passed with a score of at least 50 and no danger to people. The result is what the career
  mode and the big game take from a round.

Games run without the world and without the DOM, in Node and in the browser, and are deterministic:
the same seed and the same moves at the same times give the same game (random numbers come from
streams keyed by the seed and their purpose). They can be tested and replayed, and later played by
computer players for roles nobody plays.

## Two ways to play them together

**The career mode** follows one person through roles. The catalogue's career paths (where one comes
from, where one can go, what it takes: a training, a licence, years of experience) make a graph; each
round of a role's game is a step on it. A passed round counts towards the next role; a failed one
means another round, with an instructor; a danger to people ends with an investigation (in the game:
an interview, a lost licence for a while). Pay, reputation and qualifications are the career's
resources; stress and shift work are its costs.

**The railway undertaking's simulator** is the economic and logistic whole: the fleet and its
maintenance, crews and rosters, contracts with the transport authority and their penalties, track
access, energy; the operations module (on the game page) is its first part. Here the roles are the
undertaking's departments; the player runs the company over months and years.

**The big game** connects both through what the roles give each other: the budget of the federal
government and the Länder flows to the infrastructure manager and the transport authorities; their
tenders and timetables to the railway undertakings; the undertakings' trains to the signallers and
dispatchers; their delays and faults back to maintenance, customer service and, in the end, to
politics. The roles run on different time scales (seconds for a signaller, years for a minister); the
big game couples them by the events between them (#104). Roles nobody plays are played by the
computer, with the defaults of their decisions.

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
minutes late, the signal fails at 08:11:40, one more freight train.

**In the big game.** The signaller takes the timetable (from the capacity planning and the railway
undertakings) and the trains' delays; gives delays to the undertakings' dispatchers and to
passenger information, fault reports to the maintenance dispatcher (the maintenance story's repair
team), and closures and reopenings for works. In the career mode the role comes after the
signaller's training (in a lab like the EBL) and leads to the dispatcher of an operations centre, to
instructor, or to the emergency manager.

The code: `web/arail/game/signaller.js` (the interlocking, the trains, the failure, the score; Node
tests in `tests/js/signaller.test.js`), the page `web/game/signaller/` (browser tests in
`tests/e2e/signaller.spec.js`).

## Where the games are

| Page | What |
| --- | --- |
| `game/` | The game page: the games and exercises that were in the app, on the lab's layout (infrastructure asset management, rail operations, journeys, the full terminal) |
| `game/signaller/` | The signaller of Bf Neustadt |
| `game/roles/` | The role catalogue: every role with its decisions, means, limits, risks, career and mini game |

## What comes next

- The role games of the catalogue, one by one, each on the game core; first those that build on what
  ARail has (the maintenance dispatcher and the repair team with the maintenance story, the railway
  undertaking's dispatcher with the operations, the passenger with the journeys).
- The career mode over the catalogue's career graph, keeping the results of rounds.
- The parked games of the game page on the game core (#144).
- Computer players for the roles nobody plays; the roles connected by their events (#104, #106).
