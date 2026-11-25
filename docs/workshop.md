# The workshop hall: a night of maintenance, and who decides what

A depot's workshop hall seen inside, on a module of the lab's layout, and the mission played in
it: *Fit to run*, a night shift as the workshop manager. The mission teaches the four functions of
the **entity in charge of maintenance** (ECM, Regulation (EU) 2019/779) by what a workshop may not
decide itself.

- [The four functions](#the-four-functions): who decides what
- [The hall on the layout](#the-hall-on-the-layout): the object `workshop-hall` and its module
- [The night](#the-night): the mission *Fit to run*
- [What is asked, and whose decision it is](#what-is-asked-and-whose-decision-it-is)
- [The numbers](#the-numbers)
- [In the code](#in-the-code)

## The four functions

Every vehicle has an entity in charge of maintenance. Its work is split into four functions; one
company can hold all four (an operator with its own depot), or each can be another company
([Rail operations](operations.md#maintenance-the-four-ecm-functions) compares such setups over
weeks). In the mission each is a person:

| Function | Who, tonight | Decides | Does not decide |
| --- | --- | --- | --- |
| **1 Management** | K. Eisvogel, the ECM manager | answers for the safe state of every vehicle and for the system that ties the other three together; keeps the certificate | cannot hand this function to anybody else |
| **2 Maintenance development** | I. Zeisig, the engineer on call | writes and keeps the **maintenance file**: what is done, how often, to which limits; gives a **concession** (leave to run outside the file, for a time and under conditions) | which unit goes to the workshop when |
| **3 Fleet maintenance management** | O. Stieglitz, the fleet manager on call | takes a unit out of operation, **orders** the work, decides what may wait, and **returns the unit to operation** | how the work is done; the limits |
| **4 Maintenance delivery** | you, the workshop manager | does the work that is ordered, as the maintenance file says, with authorised staff, and **releases to service** what was done | what is beyond the order; a limit; whether the unit may run |

Two words carry most of it. A **release to service** is the workshop's word that the ordered work
is done as the file says, signed by somebody authorised. A **return to operation** is fleet
management's word to the operator that the unit may run again, with or without restrictions; it
rests on the release, and it is another decision by another function. Released is not returned.

## The hall on the layout

The object `workshop-hall` (class `WorkshopHall`, palette group Transport) is a hall of 68 m by
27 m without its roof. Its walls are drawn from within: each is drawn only while the camera looks
at its inner side, so from any side one looks in over the near wall. Inside:

- **Track 1**: the inspection pit, with roof platforms on both sides.
- **Track 2**: the lifting jacks, a pair at each end of each car. A unit raised on them leaves
  its bogies on the rails.
- **Track 3**: the underfloor wheel lathe in its pit, the machine beside it, wheelsets on a stand.
- A crane across the hall, shelves and benches along the far wall, the foreman's cabin.
- A lamp at each hall track by the door, in the colour of its unit's state: Türkis at work, orange
  while its work waits for a word or an answer, yellow released, green fit to run, red kept in.
- Outside: three stabling tracks beside the hall, and the **throat**. Every track runs into the
  one lead track through it, so every move from track to track goes out to the lead and back in.

The hall is lit: nothing in it is darkened at night, and the yard has its lamps.

In `ebl-neustadt.json` the hall is the module **Workshop hall** (layer `workshop`, off by
default), on a virtual table module beyond the west end of the table, beside the hump yard's.
By itself it shows a quiet night: a unit over the pit, one on the lathe, one outside. A game
gives it another picture with `show(picture)`: a function that returns every unit with its track,
how far it is along the way there, how high it is raised, its state and its fitters
([layout format](layout-format.md#workshop-hall-a-workshop-hall-seen-inside)).

## The night

*Fit to run* (`web/game/missions/fit-to-run.json`): 22:00 to 05:24 in the hall of Betriebswerk
Neustadt, as the workshop manager. A second of the shift is twelve of the night, so the night
takes 37 minutes. Four units come in with their orders from fleet management, and four trains
want a unit in the morning:

| Unit | In at | Order | Where |
| --- | --- | --- | --- |
| 442 105 | stands outside | brake pads of both bogies, brake test | the pit, or raised on the jacks; the test anywhere |
| 442 101 | stands outside | door 3 does not close and is locked: its drive, if the night allows | any hall track |
| 442 107 | 22:45 | wheel flat on axle 3: reprofile the wheelset | the wheel lathe |
| 442 103 | 23:40 | inspection, due tomorrow by its days | the pit only |

Trains: 04:24, 04:42, 05:00, 05:12. Any unit that is returned to operation can take any of them,
one without a restriction first; a train without a unit waits twelve minutes and is cancelled.

The hall is the player's. Tap a unit on the table (or in the picture of the depot beside it) and
say where it goes; tap it when its work is done and release it to service; tap a released unit to
phone fleet management for its return to operation. One move goes through the throat at a time,
and a unit on a track keeps it until its work there is done or it is moved out: who stands over
the pit when the inspection comes in at 23:40 is the night's first judgment.

## What is asked, and whose decision it is

| What happens | The choice | Whose decision it really is |
| --- | --- | --- |
| A hall track is free | which waiting unit goes in, or none yet | the workshop's |
| A fitter finds something beyond the order | phone fleet management and wait for the order (the track stands meanwhile); repair it now under the **standing order** (it covers half an hour of work, and the foreman's estimate is a range); or go on, and write it into the release (nobody is woken; fleet management decides at the return to operation, and a finding it wants repaired then sends the unit back into the hall) | fleet management's, beyond the standing order |
| A part measures at its limit | measure again (ten minutes, and it is settled); change the part (45 minutes); phone maintenance development for a concession; or take the reading as it is | the limit is maintenance development's |
| A wheelset is on the lathe | how deep the cut is (1 to 6 mm), or measure the damage first | the workshop's, within the file: 0.5 mm below the damage, and above 3 mm the other wheelset of the bogie too |
| The brake test is due, and the one person authorised for it is at the lathe | the lathe waits, the unit waits, or somebody whose authorisation has run out signs | the workshop's; the third is no release at all |
| The operator's dispatcher asks for a time | a number of minutes: too early and a train stands without its unit, too late and one is cancelled that could have run | the workshop's word |
| A train is due, a unit is released and not yet returned, its driver stands at the door | phone fleet management, let the driver wait, or let the unit go on the release alone | fleet management's |

What a decision leads to is not certain. The seed decides whether fleet management wants a
finding repaired before the unit runs, how long a repair really takes, on which side of its limit
a part truly is, how deep the flat's damage goes, and how long somebody on call takes to answer.

Three people count differently, each with a patience of 0 to 100. The fleet manager counts calls
at night, work done without an order, findings left in a release (most one that sends a unit back)
and units released after four.
The maintenance development engineer counts millimetres cut beyond need, good parts scrapped and
parts that come back. The dispatcher counts trains. Below 70 each phones once and asks for a
promise that another of them pays ("nothing on my units without my order" costs the pit ten
minutes a finding, and with them the dispatcher's trains). Below 35 they act: the fleet manager
reads every release line by line, the engineer gives no concessions any more, the dispatcher
orders buses. The lowest patience counts 60 % of that objective.

Two things end the round whatever the score: a release signed by somebody not authorised, and a
unit that runs with what fleet management would have kept it in for (a finding that must be
repaired, or such a signature); its train is then worth what a cancelled one is.

## The numbers

| | |
| --- | --- |
| Moves | 6 min from track to track through the throat, 4 in from the line and out to the station; 3 to raise or lower a unit on the jacks |
| Work | the inspection 170 min, the brake pads 110, the brake test 20, the door's drive 75, a part changed 45, a second measurement 10 |
| The lathe | 30 min to set up, 12 a millimetre; setting up again after a cut too shallow 15; above 3 mm the other wheelset as long again; a millimetre of diameter is about 30 000 km |
| On call | fleet management answers in 4 to 12 min, maintenance development in 6 to 14; a return to operation comes 6 to 16 min after the release, 2 after a phone call |
| A release sent back | the unit goes into the hall again when a track is free (or is repaired where it stands on the pit or the jacks); 20 min to set up for it again, then the repair, and after a brake hose the brake test again; a time said to the dispatcher for it counts by the new release |
| Score | trains with their unit 35, the night's orders 20, nothing comes back 15, the people 30 |

Played by the computer on 24 seeds of the level *normal*: nobody at the desk 19 points (nothing
comes into the hall: no train has a unit); by the book 84 (a train cancelled on three nights in ten, late on a few more);
with the pit kept free for the inspection and the brake pads done on the jacks 93; hasty all
round 71. Taking the reading at a limit and repairing a finding unasked each beat the book on
some nights and lose on others.

A finding written into the release is a judgment, not a mistake. On 100 seeds:

| Findings written into the release | Mean | Beats the book | Loses to it |
| --- | --- | --- | --- |
| none: always phoned in (the book) | 82.8 | | |
| where the foreman says "with that it can run" | 83.0 | on 28 nights | on 7 |
| also where it "can go either way" | 82.5 | on 49 nights | on 34 |
| every one, the chafed brake hose too | 80.3 | on 33 nights | on 59 |

Of the units sent back for a finding written into every release, seven in eight are repaired and
returned to operation before the night is over. A send-back costs more where a time was said to the
dispatcher for that unit: the time counts by the new release, and is often missed.

Levels: *training* (one finding beyond the order, nobody slow on the phone), *normal*, *hard* (a
fitter short, the phones slower, the foreman's guesses wider).

Simplified for teaching: a track's crew is with the track; every move takes the same time; any
unit can take any train; a unit kept in by fleet management (a release signed without authorisation)
is lost for the night; the ECM
manager speaks only at the hand-over and when a rule is left.

## In the code

- `web/arail/game/workshop.js`: `WorkshopGame` (id `workshop`, role `workshop-manager`), its
  computer player and its constants. No geometry: `hall()` gives the night for the table.
- `web/arail/ops/workshop.js`: `WorkshopHall`, the layout object; `HALL_PLAN`, its plan.
- `web/game/workshop.js`: `WorkshopBoard`, the game's board on the table: it hands `hall()` to the
  layout's hall and marks what can be chosen.
- `web/game/missions/fit-to-run.json`: the mission, with a line for everything that does not go
  to plan.
- Tests: `tests/js/game-workshop.test.js`, `tests/js/game-control.test.js` (the board and the
  hall), `tests/e2e/workshop.spec.js`.

The mission's shift has a **pace**: `"pace": 12` in its phase says a second of the shift is twelve
of the day, and the page shows the time of day by it ([missions as data](game-core.md#missions-as-data)).
