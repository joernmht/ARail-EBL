# Hump yard (Ablaufberg)

Trains are broken up and formed again over a hump. A locomotive pushes the arriving train slowly
over the crest; the train is uncoupled into **cuts** (Abläufe: one wagon, or a few for the same
track), and each cut runs free as soon as gravity pulls it faster than the train. It rolls down
the steep ramp, through the **main retarder** (Talbremse), the **switch zone** and its **group
retarder** (Richtungsgleisbremse) into its **classification track** (Richtungsgleis), where it
should meet the wagons already standing there gently. Once a track holds a train, the train is
pulled out.

ARail simulates this in the module `web/arail/hump/` ([#236](https://github.com/joernmht/ARail-EBL/issues/236)),
on its own in Node and in the browser, deterministically; on the table it is the object `hump-yard`,
Bf Neustadt's module **Hump yard** ([On the table](#on-the-table), [#237](https://github.com/joernmht/ARail-EBL/issues/237)).
Joining it to real trains, as the hybrid container terminal is joined, is the rest of #237; both are
part of hybrid single wagonload ([#230](https://github.com/joernmht/ARail-EBL/issues/230)).

## Trying it

```bash
node tools/hump.mjs                                    # one train of 30 wagons, 8 tracks, summer
node tools/hump.mjs --trains 3 --season winter --push 1.6
node tools/hump.mjs --design target --estimate-sd 0.2 --json run.json
node tools/hump.mjs --svg run.svg                      # the diagrams of the run (below)
node tools/hump.mjs --trains 6 --tracks 4 --pull-below 120   # full tracks leave as trains
```

It prints every cut (its wagons, mass, true and measured rolling resistance, the track it ended in,
its speeds into and out of the main and group retarders, the impact with which it met the wagons in
its track, and what went wrong), the tracks (wagons, gaps to push up, room left) and the figures of
the run. Options: `--tracks N` (8), `--wagons N` per train (30), `--trains N` (1), `--seed N` (1),
`--push M/S` (1.2), `--season summer|winter`, `--design speed|target` (below), `--estimate-sd N/KN`
(the error of the measured rolling resistance, 0.4), `--pull-below M` (pull a track out as a train
when its wagons leave less than M metres of it), `--quiet`, `--json FILE`, `--svg FILE`.

In code:

```js
import { HumpSimulation, randomTrain, standardYard } from "./web/arail/hump/index.js";
import { createRng } from "./web/arail/core/math.js";

const yard = standardYard({ tracks: 8 });
const sim = new HumpSimulation(yard, { seed: 1, season: "winter" });
sim.hump({ id: "53201", push_mps: 1.2, wagons: [
  { type: "eanos", loaded: 1, track: "3" },               // a loaded open wagon: a good runner
  { type: "hbbillns", loaded: 0, track: "6" },            // an empty 2-axle wagon: a bad runner
  { type: "zacns", loaded: 1, track: "6", careful: true }, // RID label 13: shunt with care
] });
sim.hump({ id: "53202", wagons: randomTrain(createRng(2), { wagons: 30, tracks: yard.tracks.map((t) => t.name) }) });
const results = sim.run();          // every cut, every track, the figures
const train = sim.pullOut("6");     // the wagons of track 6, from its end: a new train
```

With `pull_below_m` (say 120) the simulation keeps the tracks open by itself. A track with less
room than that at its entrance is first **pushed up** (`pushUp`, Beidrücken): its wagons are pushed
buffer to buffer up to its end, closing the gaps and the space a bad runner left before the end
(never past a cut still rolling in it). If that leaves too little room, the track is **pulled out**
as a train once no cut rolls in it: the standing wagons leave from its far end while cuts on their
way roll on into it. So train after train can be humped (`sim.departures` lists the trains,
`results().pushed_up_m` the room gained by pushing up). A train pulled out, by hand or by
itself, takes the cuts standing in the track (`trackContents`), also one that stopped across its
entrance, coupled to the last wagons with its rear still outside: it fills the track, which is then
pulled out with it. A cut stopped wholly in front of the track stays there, and an empty track is
never pulled out. `run()` stops at `max_s` (4 h) at the
latest: `results()` then says `limit_reached`, with the trains humped (`trains`) and those not
(`waiting`). Wagons without an id are numbered by their train (`T2.14`).

A wagon is `{type, loaded, track | destination, w_nkn?, careful?, noHump?}`: its type from the
vehicle catalogue's freight wagons (`sgns`, `eanos`, `habbins`, `zacns`, see
[Railway systems and trains](rail-systems.md)) or the hump's own 2-axle `hbbillns`; `destination`
goes through the train's `sorting` plan (destination → track). Consecutive wagons for the same
track form one cut. A wagon with `noHump` (RID label 15, *Ablaufverbot*) is left out of the humping.

## The yard

A yard is a tree of **segments**: the root holds the push track, the crest, the steep ramp and the
main retarder; every segment that has children ends in a switch; a segment without children is a
classification track. A position is metres along a route from the start of the push track, the same
on every route up to where they part, so two cuts on one way compare by one number. Each segment has
its grades (‰, linear between the points given, so a change of grade over some metres is a vertical
curve), curves, the turnout at its start, and its retarders. `new HumpYard({segments})` takes any
such tree; `standardYard(options)` builds the usual shape:

| Zone | Standard yard | From the literature |
| --- | --- | --- |
| Push track before the crest | +20 ‰ over 120 m | at least 20 ‰ (Pachl) |
| Crest | rounded at 300 m | Maschen 300 m; wagons pass 250 m (TSI WAG) |
| Steep ramp (Steilrampe) | −50 ‰ over 40 m | 40–70 ‰ (Deine Bahn 5/2012); Maschen 61 ‰ over 53 m |
| Main retarder (Talbremse) | 24 m on −15 ‰ | 10–25 ‰ (PRR: 18 ‰) |
| Switch zone (Verteilzone) | −10 ‰; hump switches EW 49-190-1:7.5 every 32 m, the branch to the outside curved, the tracks brought parallel by curves of 250 m | 10–15 ‰ (Pachl; Deine Bahn) |
| Group retarder (Richtungsgleisbremse) | 18 m on −8 ‰, all lined up | PRR: 8 ‰ |
| Classification tracks | 8 tracks of 700 m; one main retarder serves them | Halle (Saale): 36 tracks of 700 m; a main retarder serves 6–12 tracks, mostly 8 |
| Hump height | 4.4 m to the start of the middle tracks (the outer ones lie lower) | about 2 m small, 3.5–4.5 m large yards (estimate) |

The tracks come in two designs (`design`):

- **`speed`** (the default): speed-holding units (Kolbengleisbremsen, Dowty) along the whole track,
  which falls 3 ‰, more than most wagons' rolling resistance. The units brake by themselves whatever
  is faster than 1 m/s (Nürnberg holds the wagons at 1 m/s); the group retarder lets a cut go at
  that speed, or faster where its free run to its place needs it (a bad runner in the cold).
- **`target`**: target braking alone (Laufzielbremsung). The group retarder lets a cut go at the
  speed that brings it to the wagons in its track at the coupling speed; the track falls 2 ‰, then
  1 ‰ (older yards 1.5–3 ‰, sometimes stepped).

## On the table

Bf Neustadt has the module **Hump yard** (off by default): a virtual table module at the west end of
the EBL table, 6.1 m long, 45 mm below the table, with the object `hump-yard` on it. Its push track
starts at the table's edge, at the table's level, in line with the main line west; from there the
yard falls away to the west. Switch the module on (or open
`app/?layout=../layouts/ebl-neustadt.json&layers=sbahn,waldhof,hump`) and look at it in the
flyover (F): the module lies beyond the photos.

The object humps one random train of 24 wagons after the other into six tracks of 120 m (in H0:
the yard is 6 m long and 0.36 m wide) and draws:

- the **formation**: one graded plateau under all tracks, its banks down to the table, its heights
  those of the yard above its lowest track end (the push track starts 4 mm below the table's top,
  the crest is 18 mm above it, the classification tracks 32–45 mm below it);
- **ballast and rails** along the plan of the yard, a fan whose tracks lie 4.5 m apart (`planAt`);
- the **retarders**: dark beams beside the rails, **orange while they brake** (and glowing at night);
- every **wagon** in dark red with a band in the colour of its rolling class (Türkis good, Brillantblau
  medium, Orange bad runners, as in the diagrams), **red** for a few seconds after an impact too hard,
  and the **locomotive** pushing the train;
- the track numbers behind the group retarders.

Its card says how many trains it humped, its cuts per hour, misroutes, impacts too hard and trains
pulled out. Its settings (Build) are the yard's (tracks, their length, the push track, the design),
the season, the pushing speed, the wagons per train and when a track is pulled out
([layout format](layout-format.md#hump-yard)); moving it keeps its run, other figures start it anew.
Its random numbers come from the world's seed and its id: the same layout humps the same trains.

## A cut and its forces

Every step (0.05 s) each free cut gets its forces (`cutForces`), in kN over its mass in t:

- **Gravity over its whole length**: each wagon by the height of its front and rear, so a cut on the
  crest is partly uphill.
- **Rolling resistance** w (N/kN) of each wagon, drawn for it from its class; **curve resistance**
  after Röckl, 650/(r − 55) for r ≥ 300 m, 500/(r − 30) below (3.1 N/kN in a hump switch's 190 m);
  **switch resistance**, 8 mm of energy height per turnout.
- **Air resistance** ρ/2 · cwA · (v + v_wind)², the wagon at the head with its whole drag area, the
  ones behind it with a fifth; the wind against the cut.
- **Retarders** on the axles inside them, w_max N per kN of their weight while closed: a long cut has
  only some of its axles in a retarder and is braked less.
- **Rotating masses**: each wheelset adds 0.43 t to the mass that is accelerated (not to the
  weight), so the energy line of hump design, the height plus v²/2g', comes out by itself
  (`energyHeight`).

Cuts that touch move together while the one behind would be faster; a cut that meets another one
does so plastically, its momentum kept; a cut does not roll back. A standing cut needs 2 N/kN more
than its rolling resistance to start.

`coast` runs a cut alone over distance (where does it stop, how fast does it arrive), and
`requiredSpeeds` backwards (how fast must it be at each metre to arrive there at that speed); `timeRun`
runs it over time. The control uses them with the resistance it measured.

## Pushing, switches and retarders

**Pushing.** The train moves at its pushing speed (1.2 m/s; 0.8–1.4 m/s with automatic routing).
Its first cut runs free when gravity pulls it faster than the train: in the standard yard, when its
centre of mass has just passed the crest. A cut that does not run free is pushed on until its rear
is 25 m beyond the crest. The next train starts 120 s after the last cut of the one before ran free.

**Switches.** A switch is thrown for the next cut that needs it once no cut is in its detection
section (8 m before its tip, 4 m behind it), and only if the throw (0.6 s, and 0.3 s of margin) is
done before that cut reaches the section. A cut that finds a switch lying the other way takes that
branch: it is **misrouted** (Fehlläufer) and goes on to the first track behind the branch. This
happens when a cut follows the one ahead too closely, typically a good runner behind a bad one, or
when it **catches up** with it (Einholen). The yard never throws a switch under a cut; a derailment
is counted to show that.

**Retarders.** The control measures each cut's rolling resistance on the ramp, with an error (0.4
N/kN), and when the cut enters a retarder computes the speed it needs at every metre (`HumpControl.need`):

- the **main retarder** brings it to its group retarder at 4.5 m/s, but lets no cut go slower than
  3 m/s, so that the next one does not catch it up (US master retarders release at 6–8 mph);
- the **group retarder** brings it to where it should meet the wagons in its track: the rear of the
  last one standing there, less the length of the cuts on their way there before it
  (`targetPoint`), at the coupling speed of 1.0 m/s (DB allows impacts up to 1.25 m/s), never slower
  than that. If a cut is still rolling ahead of it in the track, both runs are predicted over time
  and the exit speed is lowered until it would meet that one gently (`safeExit`): a gap to push up
  is better than a damaged wagon. Into a track with speed-holding units it lets a cut go at their
  speed, or faster where a bad runner needs it to get far enough, but never faster than meets a cut
  rolling ahead gently (the units counted in both runs).

A retarder closes while a cut in it is faster than it needs (plus 0.05 m/s) and opens again as fast
as it responds (0.5 s), so it lets cuts go a little slower than needed.

Wagons to shunt with care (`careful`, RID label 13) are aimed at `careful_mps` (1.0 m/s; the
simulation's setting, which the control takes over). On tracks with speed-holding units they still
arrive at the units' speed, which is the same for every wagon: a careful limit below it counts them as
too hard.

## What a run shows

`results()` gives every cut's run (released, retarders in and out with the energy height they took,
impact, where it stopped, misrouted, caught up) and the figures. Four trains of 30 random wagons
(71 cuts, 122 wagons) on the standard yard, `node tools/hump.mjs --trains 4 --quiet` and the options
in the first column:

| Options | Cuts per hour | Too hard (> 1.25 m/s) | Gaps | Stopped short | Misrouted | Caught up |
| --- | --- | --- | --- | --- | --- | --- |
| (none: speed-holding units, summer, pushed at 1.2 m/s) | 143 | 0 | 0 | 0 | 0 | 0 |
| `--push 2` | 238 | 6 | 0 | 0 | 18 | 20 |
| `--season winter` (−10 °C, 5 m/s head wind) | 142 | 1 | 9 | 7 | 1 | 25 |
| `--design target` (target braking alone, resistance measured ± 0.4 N/kN) | 143 | 17 | 22 | 0 | 0 | 0 |
| `--design target --season winter` | 142 | 4 | 17 | 9 | 1 | 9 |

In winter, bad runners stop at the entrance of their track ("stopped short": not wholly in the
track), and the next cuts for that track run into them there ("caught up"): between trains nobody
pushes the tracks up.

### The diagrams

`humpDiagrams(sim)` (or `--svg FILE`) draws a run made with `trace: true` as the diagrams of hump
design, one line per cut in the colour of its rolling class:

- **Height and energy line**: the height of every route and each cut's energy height (the height
  of its centre of mass plus its speed height). The energy line falls with the resistance, steps
  down in the retarders, and must stay above the track to the place the cut should reach.
- **Speed over the distance from the crest**: accelerating down the ramp, braked in the main
  retarder, faster again through the switch zone, braked in the group retarder to the speed of the
  track; the impact limit as a line.
- **Distance over time**: the cuts one after the other; where two lines come together, a cut
  catches up the one ahead.

What went wrong is marked in Rot: an impact too hard, a misroute (at its switch), a cut stopped short
of its track; labelled where the label fits, and every line tells its cut on hover. The picture
follows the viewer's light or dark mode. One train of 30 wagons on the standard yard
(`node tools/hump.mjs --svg docs/assets/hump-diagrams.svg`):

![The diagrams of hump design for one train: height and energy lines, speed over distance, distance over time](assets/hump-diagrams.svg)

What it teaches: the hump's capacity (cuts per hour) rises with the pushing speed until good runners
catch up bad ones and are misrouted; the cold makes bad runners stop short; and target braking over
a long track needs the rolling resistance far more precisely than it can be measured (0.4 N/kN over
600 m is 0.24 m of energy height, the difference between meeting the wagons at 1 m/s and at 2.4 m/s),
which is why yards brake in the tracks themselves (speed-holding units, conveyors, once skates laid
by hand).

## The figures and their sources

All values are in `web/arail/hump/params.js`, each with its source in the comment. They were
collected from the excerpts of the documents below (the documents themselves could not all be opened
from the session that collected them); check a value in the original before relying on it.
*Estimate* marks a value no source was found for.

| Figure | Value | Source |
| --- | --- | --- |
| Rolling resistance, good / bad runner | 1.8 / 4.2 N/kN at normal temperature, 3.7 / 6.5 at −10 °C | [Pachl][pachl], ch. 9 |
| Rolling resistance by load (Davis) | about 1.2 N/kN loaded 90 t, 2.9 empty 23 t | [FRA 1977][davis] |
| Rolling classes (Siemens) | good 0.5–4, bad 4–8 N/kN | [WO 2004/074067][siemens-patent] |
| Classes here | good 1.4 ± 0.35 (loaded 4-axle), medium 2.4 ± 0.5 (empty 4-axle, loaded 2-axle), bad 3.4 ± 0.7 (empty 2-axle) N/kN; winter +2 | from the above |
| Drag area of a leading wagon | about 7.5 m² (Davis' coefficient over 8 m²); empty open wagons 10 (estimate) | [FRA 1977][davis] |
| Wagon behind another in a cut | 0.2 of the drag area (0.0005 against 0.0024) | [FRA 1977][davis] |
| Design head wind | 5 m/s in winter | estimate (4–6 m/s) |
| Curve resistance | Röckl: 650/(r − 55), r ≥ 300 m; 500/(r − 30) below | [Röckl][rockl] |
| Switch loss | 7.6 mm of velocity head per switch (100 t car) | [SRI for the US DOT][sri]; no German figure found |
| Rotating mass | 0.43 t per wheelset (J ≈ 90 kg·m², 920 mm wheels) | estimate |
| Hump switch throw | 0.6–0.8 s for the fast drives of the first levels; 0.6 s in the US | [Wikipedia: Weiche][weiche], [EJ&E 1953][eje] |
| Detection section | US track circuits 27–65 ft, 38 ft typical: 8 m before and 4 m behind the tip here | [PRR 1965][prr]; the split is an estimate |
| Beam retarder | 20–50 kJ per metre and 22.5 t axle (0.09–0.23 m/m); US full capability 0.11 m/m: main 0.15, group 0.11 m/m here | [FFG StilvA][ffg], [SRI][sri] |
| Retarder entry speeds | main 6–8 m/s, group about 4.5 m/s, group exit about 1.5 m/s | [EP 0313771][ep0313771] |
| Retarder response | 0.5 s (Siemens: 100 ms between braking stages) | estimate; [Siemens][siemens-retarder] |
| Speed-holding units | brake above 1 m/s (Nürnberg); 6 N/kN | de-academic on [Kornwestheim][kw] and [Nürnberg][nbg]; the force an estimate (about 1.4 kJ per unit and wheel, [SRI][sri]) |
| Main retarder exit, at least | 3 m/s (US master retarders: 6–8 mph) | [PRR 1965][prr] |
| Pushing speed | 0.8–1.4 m/s with automatic routing | [Wikipedia: Rangierbahnhof][rbf] |
| Impact in the classification track | at most 1.25 m/s (formerly 1.5) | [Pachl][pachl-springer], § 9.4.3.2 |
| Wagons to shunt with care (RID label 13) | 1.0 m/s | estimate; set it from the local rules ([RID shunting labels][rid]) |
| Wagons per cut | 1: 55 %, 2: 25 %, 3: 12 %, 4: 8 % (mean 1.7) | estimate (1.5–2, 55–65 % single wagons) |
| Hbbillns | 15.5 m, 16 t empty, 45 t at most | [Rail Cargo data sheet][hbbillns] |

The geometry's sources are in the table of [the yard](#the-yard): [Pachl][pachl], [Deine Bahn
5/2012][deinebahn], [Maschen][maschen], [TSI WAG][tsi], [PRR 1965][prr], [Halle (Saale)][halle].

[pachl]: https://epdf.pub/systemtechnik-des-schienenverkehrs-bahnbetrieb-planen-steuern-und-sichern-5-aufl.html
[pachl-springer]: https://link.springer.com/chapter/10.1007/978-3-658-12986-6_9
[davis]: https://railroads.fra.dot.gov/sites/fra.dot.gov/files/fra_net/15925/1977_RESISTANCE%20OF%20A%20FREIGHT%20TRAIN%20TO%20FORWARD%20MOTION.PDF
[siemens-patent]: https://patents.google.com/patent/WO2004074067A1/de
[rockl]: https://eisenbahnwesens.de-academic.com/1876/Neigungsverh%C3%A4ltnisse
[sri]: https://rosap.ntl.bts.gov/view/dot/77853/dot_77853_DS1.pdf
[weiche]: https://de.wikipedia.org/wiki/Weiche_(Bahn)
[eje]: https://jonroma.net/media/signaling/railway-signaling/1953/Electronics%20at%20Work%20in%20EJ%26E%20Yard.pdf
[prr]: https://jonroma.net/media/signaling/railway-signaling/1965/PRR%20converts%20two%20hump%20yards.pdf
[ffg]: https://projekte.ffg.at/anhang/5bec12a51db21_VIF2015_Ergebnisbericht_StilvA.pdf
[ep0313771]: https://data.epo.org/publication-server/rest/v1.2/patents/EP0313771NWA1/document.pdf
[siemens-retarder]: https://assets.new.siemens.com/siemens/assets/api/uuid:e44ec1ba-86ce-45ef-87be-7cdcd6c8dd08/rz-sie-trackguardretarder-broschuere-dt.pdf
[kw]: https://de-academic.com/dic.nsf/dewiki/870608
[nbg]: https://de-academic.com/dic.nsf/dewiki/1035502
[rbf]: https://de.wikipedia.org/wiki/Rangierbahnhof
[rid]: https://otif.org/fileadmin/new/2-Activities/2D-Dangerous-Goods/2Dc3_workingdoc_StandingWG/2023/RID_CE_GTP_2023-04_d_shunting_marks.pdf
[hbbillns]: https://railcargo.com/hr/dam/jcr:628d6f0e-fd0e-4f41-ad09-6a6d554c0a30/BA_Hbbillns_2459_RCH.pdf
[deinebahn]: https://www.system-bahn.net/file/pdf-reader/10093/
[maschen]: http://bahn-alltag.de/2/Specials/Maschen/AMA.html
[tsi]: https://umwelt-online.de/recht/eu/05_09/06_0861anc25.htm
[halle]: https://de.wikipedia.org/wiki/Zugbildungsanlage_Halle-Nord

## What it leaves out (so far)

- **Conveyors** (Förderanlagen, Beidrückanlagen) that push the cuts together in the tracks, and the
  braking to the track's entrance that goes with them (Räumzielbremsung); skates laid by hand.
- **A variable pushing speed**: the hump signal box slows the locomotive for a bad runner followed
  by a good one. Here a train is pushed at one speed.
- **The rolling resistance changing along the way** (bearings warming up, gusts): it is one number
  per wagon; only the control's measurement of it has an error.
- **Retarder physics in detail**: the force is the same share of the weight on every axle inside
  (a weight-proportional retarder), closing and opening take a fixed time.
- **The shunting locomotive** that pushes tracks up and pulls trains out: both take no time and
  no locomotive here; a yard planner who keeps cuts away from a track while it is being pushed up.
- **The plan**: the yard is a profile along its routes, not drawn on the table (#237).
- **Rolling back**, couplers (buffers touching count as coupled), and the train being pulled out
  taking time.

## Tests

`tests/js/hump.test.js`: the standard yard (a tree of switches, the crest, the height, every track
falling, the outer tracks turning more), a yard from segments (heights, vertical curves, checks),
wagons and cuts (the catalogue's figures, rolling classes, winter, cuts by track, random trains), the
physics against the energy balance (a free run on a grade, the stopping distance uphill, the needed
speeds run forwards again, air with the wind and the following wagon, a wagon on the crest, the
energy height), separating at the crest, a train humped on the standard yard (every cut in its
track, the retarders within their limits, no switch under a cut, the tracks holding every wagon),
impacts keeping the momentum, misroutes when pushed too fast, target braking with and without the
error, winter, wagons not to be humped and to shunt with care, several trains, determinism, pulling a
train out by hand and when a track is full, and the diagrams (a line per cut in each panel, the
problems marked, the same picture for the same run).
