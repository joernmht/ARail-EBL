# Rail operations: fleet, maintenance and crews

ARail can run a **railway undertaking** on the layout's station: its trains run to a timetable
out to stations beyond the layout and back, with real **units** that wear, fail and go to the
**workshop**, and real **people** who drive them. You can watch a day on the layout, change things
at short notice (a driver calls in sick, a unit breaks down), and **compare setups** under stress
tests: who does the maintenance and how the roles are split, how many drivers are on stand-by,
how much time the duties leave to change trains.

What is simulated:

- **Rolling stock** with maintenance cycles (inspections by kilometres and days) and random
  **failures** whose rate grows with the unit's age and with the kilometres run since its last
  maintenance: **hard failures** (the unit breaks down) and **soft failures** (defects it can run
  with).
- **Maintenance** by the four functions of the **entity in charge of maintenance** (ECM, EU
  regulation 2019/779): management (1), maintenance development (2), fleet maintenance management,
  that is the planning of which unit goes to the workshop when (3), and maintenance delivery, the
  workshop (4). Each function belongs to a party with its own working hours and response times.
- **Contracts and penalties** (Pönalen) between the parties: the transport authority fines the
  railway undertaking for what passengers notice, which claims from the party responsible, down
  the chain of contracts.
- **Crews**: duties that keep the working-time rules, contracts with weekly hours, a roster, sick
  calls, vacations and vacant positions, the way to work (on foot through the town, by car, by
  train), stand-by drivers, and a dispatcher who finds replacements.

The operations are a simulation (`{"type": "operations"}` in the layout's `simulations`). Their
engine knows nothing of the layout's geometry: it also runs without the app, as fast as it can,
for comparisons over weeks (in the app's Compare view or with [`tools/ops-compare.mjs`](#on-the-command-line)).

## The example

The module **Rail operations** of the lab example (View → Modules, or Settings → Simulation → Rail operations →
Switch on the module, or `app/?layout=../layouts/ebl-lab.json&layers=operations#ops`) adds to
[`web/layouts/ebl-lab.json`](../web/layouts/ebl-lab.json), the EBL lab with its town:

- the station **Bahnhof** with platforms 1 and 2, and four lines out to stations beyond the
  layout: **RE 1** to Altstadt (47 min, 59 km, hourly), **RB 33** to Bergheim (35 min, hourly),
  **S 2** to Talsee and **S 8** to Waldau (25 min, every 30 minutes); the RE and the S-Bahn lines
  run with two units in the weekday peaks;
- 19 electric multiple units (class 442), sized to the timetable with a reserve;
- a **depot** on a table module beside the town: a workshop hall with two tracks, two stabling
  tracks and the crew room, where the drivers sign on;
- 51 drivers on full-time (38 h) and part-time (25 h) contracts; most live in the town's houses and
  walk to the depot, the others come in by train from the stations beyond the layout;
- six setups to compare (integrated or distributed ECM, manufacturer full service, a 35-hour week,
  generous crew buffers, lean crew planning), the stress test *Winter morning*, and the scenario
  *Drivers missing in the morning*.

The tracks of platforms 1 and 2 belong to the operations: their trains stand there with a label
(*RE 1 → Altstadt 07:15*, the units, the driver and the delay), the boards show their next
departures, and the built-in timetable and the 1–9 keys leave these tracks alone. Drivers in
yellow vests walk between their houses and the depot's door. The bus bay of the bus station keeps
the built-in timetable.

## What is simulated

### Timetable and rotations

Each line runs from its first station to its last and back, every `takt_min` minutes from `first`
to `last`, with `turn_min` minutes to turn at the ends. Lines run every day; in the peaks of the
weekdays (06:00–08:30 and 15:30–18:30 unless set) they run with `peak_units` units coupled.

The trips are chained into **rotations** (Umläufe), one per unit: each rotation starts and ends at
the depot's station, takes the next trip that its unit can reach, and goes to the depot during
long layovers (`stable_after_min`). The fleet is sized to the most rotations of a week plus
`reserve_share`. Every morning the units **pull out** of the depot (`pull_out_min` before their
first trip) and pull in after their last.

At each departure the **dispatcher** decides: the train leaves when its units and its driver are
there; it waits up to `wait_unit_min` for a late unit and up to `wait_crew_min` for a late driver;
a train that is missing one of several units runs **short**; otherwise it is **cancelled**, and
with it the trip back (the unit and its driver stay where the cancelled train would have left). A
spare unit from the depot takes the place of a missing one when it can be there in time. A small share of trips gets
an operational delay (`dispatch.delays`); delays carry over to the next trips of the unit and the
driver, minus `recovery_min` at each turn.

### Units, wear and failures

Every unit has an odometer, a counter for each maintenance level (kilometres and days since it was
last done), a **wear** value (the kilometres run since maintenance last took the wear away) and its
defects. Its year of build is spread over `built`.

On each trip a unit can fail. The expected number of failures on a trip of *km* kilometres is

> rate × km × A(age) × W(wear) × factor

- **rate**: `hard_per_100k_km` hard failures per 100 000 km, `soft_per_10k_km` soft ones per
  10 000 km;
- **A(age)** = 1 + `infant` · e^(−age / `infant_years`) + `ageing` · max(0, age − `ageing_from`): a
  bathtub curve over the years (new units have teething troubles, old ones fail more);
- **W(wear)** = (1 − *w*) + *w* · `shape` · (*x* / *I*)^(`shape` − 1), with *x* the wear, *I* the
  shortest kilometre interval of the maintenance programme and *w* = `wear_share`: a unit
  maintained on time fails at about its rate, one overdue more and more often;
- **factor**: `fleet.failure_factor` and `fleet.soft_factor` (stress tests use them: a heat wave).

**Hard failures** happen at departure (`start_share`: the train cannot leave; a spare may take
over) or on the way: the train limps on to its destination, late (`limp_share`, about
`breakdown_min`), or it is stranded and the unit is towed to the depot (`tow_min`). The unit then
needs a repair (`repair_h`, spread by `repair_sigma`), sometimes waiting for parts. **Soft
failures** are defects the unit runs with: a broken air conditioning or toilet and a door out of
order (comfort defects, which the transport authority fines per day), and restricted traction,
which makes the train late and must be repaired within 48 hours.

A unit whose maintenance is overdue (past its limit plus `tolerance`) **may not run**: it stays in
the depot until the workshop has done the job.

### Maintenance: the four ECM functions

| Function | In the simulation | Settings |
| --- | --- | --- |
| **1 ECM management** | is responsible for the fleet's condition: failures and defects are its incidents | `ecm.management` |
| **2 Maintenance development** | sets the maintenance programme (levels, intervals, tolerances) and decides on requests to extend an interval once | `maintenance.program`, `maintenance.development` |
| **3 Fleet maintenance management** | the **planning**: once a day on its working days it books workshop jobs for the units that are due and assigns units to tomorrow's rotations; it learns of failures and books repairs | `ecm.planning`, `maintenance.planning` |
| **4 Maintenance delivery** | the **workshop**: its tracks, working hours, speed and quality; findings, parts and late releases | `ecm.delivery`, `maintenance.workshop` |

Each function belongs to a **party** (`ecm`): the railway undertaking itself (`ru`, the
**integrated** setup) or companies of their own with their own working hours (an ECM company in the
office Monday to Friday, a workshop company Monday to Saturday 06–22). This is what makes the
setups differ:

- The **planning** runs at `planning.at` on its party's working days only; on Friday it plans the
  weekend too. With `strategy: "windows"` it books a job for every unit within `early_share` of a
  limit into the night before (the units are in the depot then) and gives the unit with the most
  kilometres left to the longest rotation; with `"late"` it waits until a limit is reached. A job
  that does not fit into a night goes into the day, and that unit is missing for its rotation
  (*units short at the first pull-out*). When even that is too late, it asks the maintenance
  development for an extension (`development.extension`, granted with `grant`, after
  `approval_h` working hours).
- A planning party other than the railway undertaking sees the mileage only as **daily reports**
  (`ecm.data_latency_h`): it extrapolates from the week before and may plan too late.
- Every **message** between two parties (a failure report, the release of a unit after its job)
  reaches the receiver in its working hours, after its `latency_min`. A unit repaired on Saturday
  night by a workshop company may stay in the depot until the ECM company passes on the release on
  Monday morning.
- A workshop elsewhere (`transfer_min` > 0) costs a transfer run each way.
- The workshop's actual work is spread around the plan (`spread`); a unit with more wear than its
  interval brings **findings** (`findings`); a repair may wait for **parts** (`parts_p`,
  `parts_h`). A job that ends more than 30 minutes (or 10 %) after its planned work is a **late
  release**. Maintenance takes away `wear_reset` of the wear, times the workshop's `quality`; a
  hard failure within `repeat_days` after a workshop visit is a **repeat failure**.

### Contracts and penalties

Every incident has a **cause**, every cause belongs to a function, and every function to a party:

| Causes | Function | Party |
| --- | --- | --- |
| no crew, crew late to work, crew off sick, crew rest time, operational delay, platform occupied, too few units | operations | the railway undertaking |
| unit failure, unit defect | ECM management (1) | `ecm.management` |
| maintenance planning, maintenance overdue, release not passed on | fleet maintenance management (3) | `ecm.planning` |
| workshop late, repeat failure after workshop | maintenance delivery (4) | `ecm.delivery` |
| no interval extension | maintenance development (2) | `ecm.development` |
| infrastructure, external | nobody | – |

The **transport contract** prices what passengers notice; the railway undertaking pays it to the
transport authority, whatever the cause (causes in `exempt`, by default *infrastructure*, are not
fined):

| Item | Default | For |
| --- | --- | --- |
| `cancelled_km` | 12 € | each train-km not run |
| `late_trip` | 40 € | each train more than `late_threshold_min` (5) minutes late |
| `short_km` | 4 € | each km run with fewer units than planned |
| `comfort_day` | 250 € | each unit and day with a comfort defect in service |
| `no_conductor_trip` | 60 € | each train without its conductor (lines with `"conductor": true`) |

The railway undertaking then **claims from the party responsible**, along the contracts between
them (railway undertaking ← ECM company ← workshop company): each contract passes on
`pass_through` (50 %) of what its payee paid for the incident and adds its own items:
`missing_unit` (2 500 € for each rotation without a unit at the first pull-out), `hard_failure`
(1 200 €), `late_release_h` (150 € per hour; 120 € in the workshop contract) and
`repeat_failure` (900 €). A party that has several roles pays nothing to itself: in the integrated
setup all of it stays with the railway undertaking.

### Crews

**Duties** (Dienste) are built from the work of the rotations: each driver drives a stretch of a
rotation and may change to another unit at the depot's station (`transfer_min` to walk there, with
a buffer). A duty starts with signing on (`sign_on_min`) and the walk to the train (`walk_min`),
and keeps the German working-time rules (Arbeitszeitgesetz): at most 6 hours without a break,
30 minutes of breaks for more than 6 hours of work and 45 for more than 9, and at most the
contract's `max_duty_h`. **Stand-by duties** (`reserve`) are drivers at the depot, ready to take
over.

The **staff** is sized to the hours of the duties of a week, the contracts' weekly hours, the
expected absences (`sick_rate`, `vacation_rate`) and `staffing` (1.05: 5 % more). Every person has
a contract (`hours_week`, `max_duty_h`, `min_rest_h`, `max_days_row`, how readily they accept
overtime), knows the lines (`route_knowledge`) and lives somewhere: in one of the town's houses,
from which they walk (or drive, beyond `walk_max_m`), or at a station beyond the layout, from where
they come in by train (`off_layout_homes`).

The **roster** for a day is made at noon the day before: every duty goes to a qualified person who
has had the minimum rest, has not worked `max_days_row` days in a row and still needs hours this
week. Absences:

- **vacation**, planned long before (blocks of `vacation_days`, `vacation_rate` of the time);
- **sickness**: spells of about `sick_days` days, `sick_rate` of all working days, reported
  `sick_notice_min` before signing on;
- **vacant positions** (`vacancies`): fewer people for the same work.

**Getting to work**: people set off so that they are there `margin_min` before signing on; now and
then somebody is late (`late_p`, about `late_min` minutes). Those who come by train take the last
train that gets them there in time; when it is cancelled they take the next one, or a taxi. On the
layout the people who walk really walk: they sign on when they reach the depot's door.

The **dispatcher** covers a sick call with a driver on stand-by, else calls somebody on a free day
(who accepts with `overtime_accept` and never against their rest time); a duty nobody takes leaves
its trains without a driver. At each departure a driver who would be more than `short_wait_min`
late is replaced when somebody else (on stand-by, or waiting for their next piece) can be at the
train clearly earlier. Late trains make people work longer (overtime, at most 30 minutes beyond
`max_duty_h`); when that leaves less than `min_rest_h` before their next duty, the dispatcher gives
that duty to somebody on stand-by or on a free day, and only when nobody can take it is the rest
cut short (*rest time cut short*).

### Costs

The key figures also count costs: drivers' paid hours (`driver_hour`, overtime × `overtime_factor`,
stand-by × `standby_factor`), the workshop's hours (`workshop_hour`) and empty runs and transfers
(`empty_km`). They are for comparing setups, not a budget.

## The Operations tab

With rail operations on the layout, the app has an **Operations** tab (`#ops`). Its views:

- **Today**: trains run and cancelled, punctuality, units available, crews on duty, penalties of
  the day; what happened (newest first); buttons for short-term changes (*A driver calls in sick*,
  *A unit breaks down*, *A unit gets a defect*).
- **Fleet**: every unit, where it is, its next maintenance (the level closest to its limit, with
  the kilometres and days left) and its defects; a unit chosen in the list breaks down or gets a
  defect.
- **Workshop**: who does which ECM function, with their working hours and handling time; the
  workshop's tracks and the planned jobs.
- **Crews**: today's duties with their driver, times and state (*walking to work*, *on the train
  to work*, *on duty*, *off sick*, *nobody*); a chosen driver calls in sick.
- **Penalties**: what each contract has cost since day 1, the net per party (received minus paid)
  and the largest causes.
- **Compare**: [comparisons of setups](#comparing-setups).

On large screens **Wide panel** makes the panel wider for the tables. Settings → Simulation of a layout
without rail operations offers **Add to this layout** (the platforms' line names, *Lines* in Build,
become the lines; a depot comes from Build → Transport) and **Open the example**.

## Comparing setups

A **setup** is a set of changes to the layout's settings (a `patch`): who does the maintenance,
the crew buffers, the contracts. A **stress test** is what hits the operations: long-term changes
(a patch: a flu wave raises the sick rate, a staff shortage leaves positions vacant) and short-term
events at given times (`events`: sick calls before the morning peak, breakdowns in it). Every
setup runs with the same random events (the same failures and sick spells for the same seed), so
the differences come from the setups. The staff is sized for normal times: a flu wave meets the
drivers planned without it.

### In the app

**Operations → Compare**: tick the setups, choose a stress test, the days (7–56) and the runs per
setup (each run another seed), and press **Compare**. The page runs the setups one after the
other, without the clock (a 28-day run takes well under a second). The result:

- a table of **key figures** per setup (means over the runs; the range on hover; the best value
  of each row in bold where lower or higher is better);
- **cancelled trains per day** for each setup, on the same scale;
- **who pays whom**: the net penalties per party and setup (pays to the left, receives to the
  right);
- **Download CSV** with all key figures, net penalties and causes.

The setups come from the layout's `setups` (after *As configured*) or, without them, from the
presets; the stress tests are the presets and the layout's own `stress`.

### On the command line

```sh
node tools/ops-compare.mjs web/layouts/ebl-lab.json --days 28 --seeds 3 --stress flu
node tools/ops-compare.mjs my-layout.json --setups integrated,distributed --csv results.csv
node tools/ops-compare.mjs web/layouts/ebl-lab.json --list
```

Options: `--days N` (measured days per run, 28), `--seeds N` (runs per setup, 3), `--stress ID`,
`--setups ID,ID`, `--csv FILE`, `--json FILE`, `--list` (the setups and stress tests). Without the
app there are no houses to live in: the crews come to work by car or by train.

### Presets

| Setup | Changes |
| --- | --- |
| `as-configured` | nothing: the layout's settings |
| `integrated` | the railway undertaking does all four ECM functions in its own depot, around the clock, with live mileage data |
| `distributed` | an ECM company (Mon–Fri 07–16) plans from daily mileage reports; a workshop company (Mon–Sat 06–22, 35 min away, parts in 20 h) does the work |
| `full-service` | the manufacturer is ECM and runs the depot's workshop (Mon–Sat 06–22) |
| `crew-buffers` | 15 min to change trains, two drivers on stand-by in the early and the late shift and one in the evening, 10 % more staff |
| `lean-crew` | 5 min to change trains, nobody on stand-by, staff sized exactly to the need |

| Stress test | What happens |
| --- | --- |
| `none` | normal operation |
| `flu` | 14 % of working days off sick (instead of 6 %), called in an hour before |
| `shortage` | 12 % of the driver positions vacant |
| `heat` | 30 % more hard failures, 2.5 times as many defects |
| `bus-strike` | staff late to work more often (18 %, about 25 min) |
| `workshop-slow` | every job takes 50 % longer, parts twice as long |
| `bad-monday` | five sick calls at 04:30 on the first day, two breakdowns in the morning peak |
| `unit-damage` | two units out of service for two weeks from day 2 |

### Reading a result

The example under the flu wave, 28 days, 3 runs per setup (`node tools/ops-compare.mjs
web/layouts/ebl-lab.json --stress flu`), a selection:

| Key figure | Integrated ECM | Distributed ECM | Full service | Crew buffers | Lean crew |
| --- | ---: | ---: | ---: | ---: | ---: |
| Trains cancelled (%) | 0.37 | 1.20 | 0.38 | 0.26 | 0.79 |
| Units available (%) | 96.7 | 84.0 | 94.8 | 97.0 | 97.1 |
| Units short at the first pull-out | 0 | 20 | 0 | 0 | 0 |
| Duties nobody could take | 5 | 5 | 5 | 3 | 6 |
| Taken over by stand-by | 3 | 3 | 3 | 11 | 0 |
| Hours above contracts (h) | 13 | 12 | 13 | 2 | 128 |
| Drivers employed | 51 | 51 | 51 | 63 | 44 |
| Penalties to the authority (€) | 32 358 | 72 775 | 53 206 | 28 803 | 40 800 |
| Crew cost (€) | 241 423 | 241 056 | 241 619 | 273 372 | 219 362 |
| Net penalties: railway undertaking (€) | −32 358 | +18 015 | −15 011 | −28 803 | −40 800 |
| Net penalties: ECM company (€) | 0 | −63 186 | −38 195 | 0 | 0 |
| Net penalties: workshop company (€) | 0 | −27 604 | 0 | 0 | 0 |

- **Distributed roles** cost availability: the ECM company plans from day-old mileage and only in
  office hours, the external workshop is closed on Sundays, and every release waits for the next
  working hours of two parties. Units are missing at the morning pull-out, and the authority's
  penalties more than double.
- With these contracts the **railway undertaking earns** from the distributed setup: what it claims
  from the ECM company (2 500 € per missing unit) is more than the authority fines it. That is a
  finding about the contracts, not about the maintenance: try other `penalties`.
- **Crew buffers** trade 13 % higher crew costs for fewer cancellations and almost no work above
  the contracts; **lean planning** saves 9 % of the crew cost, but in a flu wave the remaining
  drivers work 128 hours above their contracts, and more trains are cancelled.

Run more seeds (5–10) before drawing conclusions from small differences: the range of each key
figure is shown when you point at it.

## Layout file

The operations are an entry of the layout's `simulations`; every key except `type` is optional.
Without `stations` and `lines`, all platforms of the layout form one station, and each line named
on a platform (`"lines": "RE 1, S 2"`) runs to a station of its own beyond the layout and back,
with a headway, running time and service hours by its kind (S, RE, IC, other). A shortened
entry of the example:

```json
{
  "type": "operations",
  "name": "EBL regional network",
  "start_weekday": "mon",
  "stations": [
    { "id": "hbf", "name": "Bahnhof", "platforms": ["platform-1", "platform-2"] },
    { "id": "altstadt", "name": "Altstadt" }
  ],
  "lines": [
    { "id": "RE 1", "route": ["hbf", "altstadt"], "run_min": 47, "km": 59, "takt_min": 60,
      "first": "05:15", "last": "22:15", "turn_min": 10, "peak_units": 2,
      "docks": { "hbf": ["platform-1:left", "platform-1:right"] } }
  ],
  "fleet": { "types": [{ "id": "et442", "name": "ET 442", "prefix": "442 ", "first_number": 101, "built": [2009, 2018] }] },
  "maintenance": { "workshop": { "station": "hbf", "object": "depot-1", "bays": 2, "hours": "24/7" } },
  "ecm": { "management": "ru", "development": "ru", "planning": "ru", "delivery": "ru" },
  "crew": { "base": "hbf", "reserve": [{ "from": "04:15", "to": "12:15", "count": 1 }] },
  "setups": [
    { "id": "distributed", "name": "Distributed ECM",
      "patch": { "ecm": { "management": "ecm", "development": "ecm", "planning": "ecm", "delivery": "works", "data_latency_h": 24 } } }
  ],
  "stress": [
    { "id": "winter-morning", "name": "Winter morning", "patch": { "fleet": { "failure_factor": 1.3 } },
      "events": [{ "day": 0, "at": "06:40", "type": "delay", "station": "hbf", "minutes": 40 }] }
  ]
}
```

Times are `"HH:MM"` (up to `"47:59"` for the night after) or minutes; day sets are like
`"mon-fri"`, `"sat,sun"`, `"weekend"` or `"daily"`; working hours are `"24/7"` or
`{"days": "mon-sat", "from": "06:00", "to": "22:00"}`.

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | `"Rail operations"` | shown in the Operations tab |
| `start_weekday` | `"mon"` | weekday of day 1 |
| `year` | `2026` | the year of day 1 (for the units' age) |
| `burn_in_days` | `7` | days run before day 1, so that plans, counters and rosters are in a steady state |
| `seed` | the world's seed | random seed |
| `stations` | the platforms | `id`, `name`, `platforms` (platform object ids: the station is on the layout) |
| `lines` | the platforms' line names | see below |
| `fleet` | | `types` (vehicle types, below), `units` (`[{id, type, built, km}]`; default: sized to the rotations), `count` (the number of units, with one vehicle type), `reserve_share` (0.15), `failure_factor`, `soft_factor` (1) |
| `maintenance.program` | IS1 7 500 km / 21 d / 4 h; IS2 30 000 km / 90 d / 10 h; IS3 120 000 km / 365 d / 30 h | levels: `id`, `name`, `every_km`, `every_days`, `hours`, `tolerance` (0.1), `wear_reset`, `includes` (lower levels done with it) |
| `maintenance.soft` | comfort, door, traction | defects: `id`, `label`, `share`, `repair_h`, `delay_min`, `deadline_h`, `comfort` |
| `maintenance.workshop` | | `name`, `station` (where it is; the depot's station), `object` (a `depot` on the layout that shows it), `bays` (2), `hours` (`"24/7"`), `quality` (0.9), `speed` (1: planned hours), `spread` (0.25), `parts_p` (0.2), `parts_h` (10), `transfer_min` (0: in the depot), `findings` (0.3) |
| `maintenance.planning` | | `at` (`"13:00"`), `strategy` (`"windows"` or `"late"`), `early_share` (0.8), `reaction_min` (20: to a failure report) |
| `maintenance.development` | | `extension` (0.1: 10 % longer, once), `grant` (0.8), `approval_h` (4 working hours) |
| `parties` | authority, ru, ecm, works | `id`, `name`, `role` (`"authority"`, `"operator"`), `hours`, `latency_min` (handling time of messages) |
| `ecm` | all `"ru"` | the party of each function: `management`, `development`, `planning`, `delivery`; `data_latency_h` (0: live mileage) |
| `contracts` | transport, availability, workshop | `id`, `name`, `payer`, `payee`, `exempt` (causes), `penalties` (items above) |
| `crew` | | `base` (station of the crew room), `drivers`, `conductors` (default: sized), `staffing` (1.05), `vacancies` (0), `contracts`, `sign_on_min` (15), `sign_off_min` (10), `transfer_min` (8), `walk_min` (4), `max_gap_min` (150), `reserve`, `sick_rate` (0.06), `sick_days` (4), `sick_notice_min` (120), `vacation_rate` (0.08), `vacation_days` (10), `route_knowledge` (1), `off_layout_homes` (0.3), `commute`, `call_in` (true) |
| `crew.contracts` | full time 38 h (70 %), part time 25 h (30 %) | `id`, `name`, `share`, `hours_week`, `max_duty_h`, `min_rest_h` (11), `max_days_row`, `overtime_accept`, `max_overtime_h_week` |
| `crew.commute` | | `margin_min` (10), `late_p` (0.03), `late_min` (12), `car_min` (25), `walk_max_m` (500) |
| `dispatch` | | `wait_unit_min` (20), `wait_crew_min` (15), `short_wait_min` (5), `pull_out_min` (15), `pull_in_min` (10), `stable_after_min` (40), `delays` (`p` 0.1, `median_min` 2.5, `sigma`, `max_min`), `recovery_min` (1) |
| `costs` | | `driver_hour` (48 €), `overtime_factor` (1.3), `standby_factor` (0.6), `workshop_hour` (95 €), `empty_km` (6 €) |
| `setups` | the presets | `id`, `name`, `description`, `patch` (changes to this entry; lists are replaced, not merged) |
| `stress` | the presets | `id`, `name`, `description`, `patch`, `events` |

**Lines**: `id`, `name`, `route` (station ids, at least two), `run_min` and `km` (one number, or
one per section), `dwell_min` (1), `turn_min` (8), `takt_min` (60), `first`, `last` (the first and
last departure from the first station), `back_first` (the first one back; default: the first
arrival plus `turn_min`), `vehicle` (a type id), `units` (1), `peak_units`, `peak` (`[["06:00",
"08:30"], ["15:30", "18:30"]]`), `days` (daily), `peak_days` (`"mon-fri"`), `docks` (station id →
dock ids of its platforms, e.g. `"platform-1:left"`; default: all of the station's) and `conductor`
(true: trains need a conductor too).

**Vehicle types**: `id`, `name`, `seats`, `prefix` and `first_number` (unit numbers, `442 101`),
`built` (`[from, to]`), `program` (its own maintenance programme) and `failure`:
`hard_per_100k_km` (1.6), `soft_per_10k_km` (2), `wear_share` (0.6), `shape` (2), `infant` (0.8),
`infant_years` (1), `ageing` (0.04 per year), `ageing_from` (12 years), `start_share` (0.15),
`limp_share` (0.5), `breakdown_min` (30), `tow_min` (120), `repair_h` (8), `repair_sigma` (0.7).

**Stress events**: `{"day": 0, "at": "07:05", "type": …}` (day 0 is day 1, the first measured
day), with the types `sick` (`count`, `notice_min`), `failure` (`kind`: `"hard"` or `"soft"`,
`unit`), `unit_out` (`count`, `days`), `staff_loss` (`count` or `share`), `workshop_closed`
(`hours`), `delay` and `station_closed` (`station`, `minutes`).

The **depot** object (`{"type": "depot", "position": [x, y], "rotation_deg": -90, "length_m": 56,
"bays": 2, "stabling": 2}`, Build → Transport) is described in the
[layout file format](layout-format.md#depot-depot-and-workshop). The validation reports unknown
stations, platforms, parties, vehicle types and depots in plain words.

## Disruptions and scenarios

Five disruption types act on the operations; they are offered in the Disruptions tab (module Disruptions) only for
layouts with rail operations, and they have no place on the layout:

| Type | Parameters | Does |
| --- | --- | --- |
| `crew-sick` (Drivers call in sick) | `count` (3), `notice_min` (30) | drivers whose duty has not begun call in sick |
| `unit-failure` (Unit failure) | `kind`: `hard` or `soft` | a unit of a train on its way breaks down or gets a defect |
| `drivers-leave` (Drivers leave) | `count` (4) | drivers leave the company from tomorrow |
| `workshop-closed` (Workshop closed) | `hours` (8) | the workshop stops working (a strike, a power cut) |
| `units-damaged` (Units damaged) | `count` (1), `days` (5) | units are out of service for days |

The world's own disruptions at the station's platforms act on its trains too: a *delay* holds
them, *cancellations* and a *closure* cancel them (cause *infrastructure*, which the transport
contract does not fine). In a scenario:

```json
{ "at": 0,  "start": { "type": "crew-sick", "params": { "count": 3, "notice_min": 20 } } },
{ "at": 40, "start": { "type": "unit-failure", "params": { "kind": "hard" } } },
{ "at": 90, "start": { "type": "workshop-closed", "params": { "hours": 3 } } }
```

## Events

The operations report on `world.events` (every payload also has `simulation`):

| Event | Payload |
| --- | --- |
| `ops.trip.departed`, `ops.trip.arrived` | `{trip}` |
| `ops.trip.cancelled` | `{trip, cause}` |
| `ops.trip.terminated` | `{trip, unit}` (stranded on the way) |
| `ops.unit.failed`, `ops.unit.defect` | `{unit, trip, kind?}` |
| `ops.unit.released` | `{unit, job}` |
| `ops.job.planned`, `ops.job.started`, `ops.job.finished` | `{job, unit}` |
| `ops.crew.signon`, `ops.crew.signoff`, `ops.crew.sick` | `{person, duty}` |
| `ops.crew.alighted` | `{person, duty, trip}` (came in by train) |
| `ops.penalty` | `{entry}` (`contract`, `payer`, `payee`, `amount`, `type`, `cause`) |
| `ops.log` | `{t, text, kind}` (the lines of *What happened*) |
| `ops.day.end` | `{day}` |

For plugins: `opsOf(world)` returns the simulation, with `engine` (the `OpsEngine`: `units`,
`desk.people`, `jobs`, `ledger`, `totals()`, `penalties()`, `inject(event)`), `inject`,
`sickCall(personId)`, `failUnit(unitId, kind)` and `depotState(depot)`. Without the app:

```js
import { runExperiment, PRESET_STRESS } from "./web/arail/index.js";
for await (const step of runExperiment({ config, layout, stress: PRESET_STRESS[1], days: 28, seeds: [1, 2, 3] })) {
  if (step.done) console.log(step.result.rows.map((r) => [r.name, r.values.cancelledPct.mean]));
}
```

## Limits

- **One depot station.** All rotations start and end at the workshop's station; lines run from a
  station out and back (a route can have several stations).
- **No infrastructure capacity** beyond the layout's platform tracks: trains beyond the layout
  never meet each other, and the operations do not use the control-system feed.
- **Drivers only** by default; conductors (`"conductor": true` on a line) are rostered like drivers.
- **Passengers do not ride** the operations' trains: the platforms' passengers board them like any
  train, but demand does not depend on them, and the penalties count trains, not passengers.
- **Failures are independent** of each other and of the weather, except for the factors of a
  stress test.
- The money is for **comparing setups**: the penalties and costs are plausible orders of magnitude,
  not figures of a real contract.
- One operations simulation per layout.
