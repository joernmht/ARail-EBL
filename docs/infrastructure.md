# Infrastructure: assets, maintenance and renewals

ARail can make the layout's station part of an **infrastructure district**: the railway's assets
(track, switches, signals, balises, interlockings, level crossings, cable routes, GSM-R sites,
overhead lines, substations, platforms, lifts and passenger displays) with their **condition**, their
**faults** and **how well their condition is known**; the **maintenance staff** in shifts, with
emergency vans and drones; and **renewals and upgrades** through the service phases of the HOAI, with
federal funding, planning approval, procurement and a plant that builds level crossing systems.
Students play the roles: asset manager, ALV (Anlagenverantwortliche), maintenance dispatcher, planner,
construction supervision and the funding authority, with limited money and people.

Everything is invented: the lines, the place, the assets and their data. The structure and the terms
follow the German rules (EBO, AEG, HOAI, EKrG, the funding of the federal railways, procurement for
sector contracting entities); the numbers are simplified orders of magnitude for teaching, see
[Sources and simplifications](#sources-and-simplifications).

What is simulated:

- **Assets** that wear every day (faster with more traffic and when their servicing is overdue), fail
  more often the worse they are, and are renewed, repaired or upgraded. Each has its IFC 4.3 class,
  its place on its line (line number and km) and its data in the asset information model.
- **What is known** of each asset: the last inspection, aged by the expected wear and getting less
  certain with time; the share of its condition that it (or its interlocking) reports live; only its
  age when nobody looked. A digital interlocking reports the condition of its signals' electronics, a
  relay interlocking only shows their faults on its panel, a mechanical one nothing: a train driver
  has to report a fault.
- **Faults** that delay or stop trains (the performance regime charges the delay minutes), close
  station equipment, or put a permanent speed restriction on worn track; they become known by their
  report path and are repaired by the emergency team, a day technician, the technician on call or a
  contractor, who drive there.
- **Inspections** by the plan of each asset type (on site, diagnostic tests, drones, measurement
  trains), with the minimum the rules ask for, and a yearly audit by the EBA.
- **Projects** through the HOAI phases 1–9 with their gates: federal funding (benefit-cost ratio),
  the crossing agreement for level crossings (EKrG), planning approval (AEG § 18) for upgrades, the
  tender with computer-played contractors, the possession, acceptance and commissioning.
- **A level crossing plant** that builds the systems for level crossing renewals to order.
- **Budget years**: maintenance money, replacement money (lost if not spent) and own investment
  money; at the end of each year the results and a score.

The simulation runs in two speeds: a **live day** on the layout with the fast clock (vans driving
through the town, technicians at work, drones flying, faults holding the station's trains), and
**fast runs** in the Infrastructure tab to the next decision or to the end of the year (a year takes
a fraction of a second).

## The example

The layer **Infrastructure** of the lab example (View → Layers, or
`app/?layout=../layouts/ebl-lab.json&layers=infrastructure#infra`) turns
[`web/layouts/ebl-lab.json`](../web/layouts/ebl-lab.json), the photo of
the EBL lab, into the station **Bahnhof** at km 21.2 of the invented line **6250 Altstadt – Bahnhof –
Bergheim** (30.4 km, double track, electrified, 150 trains a day), with the branch line **6251
Bahnhof – Waldau** (14.8 km, single track, diesel, 40 trains a day). Five stations, about 190 assets.

On the real table, mapped from the photo (`real`: only their state is drawn over the photo):

- the exit signals N1, N2 and N3 of the relay interlocking, the switch W1 and two balises;
- tracks G1, G2, G3 and platforms 1 and 2 (the layout's `track` and `platform` objects);
- the two passenger displays at the ends of the platforms, and a virtual lift on platform 1.

On table modules beside the table:

- **Line module W**: the line west towards Talsee with its entry signals, a **level crossing** where
  the street *Am Bahnübergang* crosses the tracks, the **relay interlocking** of the station (1979), a
  **GSM-R mast**, an overhead line, a cable route, and the **maintenance base** with its vans and the
  drone pad;
- **Industry module E1**: the **level crossing plant** *BÜ-Werk Mittelsachsen* (on the street
  *Werkstraße*).

Beyond the layout the network is a **line map** in the Infrastructure tab. The scenario *Faults at
the station* (Disruptions panel) makes signal N2 and the level crossing fail.

## The Infrastructure tab

With an infrastructure simulation on the layout, the app has an **Infrastructure** tab (`#infra`).
At the top: the date, **Your role**, and the run controls:

- **Run to the next decision** runs fast until a decision of a role played by students comes up, or
  until a minute before an open decision's time is up (it never decides for you by running);
- **Run to the year's end** runs to 1 January (open decisions take their defaults when their time is
  up).

The world's clock then shows the engine's time of day, and the live day goes on from there.

Its views:

- **Overview**: the network grade (known), open faults, delay minutes, the money left, staff out,
  inspections on time, how much is known well; the colours on the layout; what happened; buttons
  for faults (*An asset at the station fails*, *Cable theft*, *A storm*).
- **Line map**: one diagram per line (Streckenband): kilometres along, four rows (track, signalling and
  telecoms, electrical, stations), every asset in the colour of its known grade (linear assets as
  bars), the station on the table outlined; choose an asset for its record. **Download GeoJSON (for
  QGIS)** and **Download the asset register** (the records as JSON).
- **Assets**: the asset register, worst first, with filters (discipline, type, grade 4 or worse, on the
  layout). An asset's record: its IFC class and GlobalId, its linear placement and coordinates, its
  property sets, what is known and how, what its interlocking reports, and the role's actions:
  propose a measure (ALV), order an inspection now (ALV, dispatcher), make it fail (instructor). Below
  it the **inspection plan** per asset type.
- **Decisions**: the decisions waiting for the role, with their default and when it is taken; the
  inspection findings of the ALVs; what was decided.
- **Projects**: every project with its HOAI phase bar, its money and funding; a project's record
  (estimate, calculation, contract, payments, planning depth and BIM, procedure, possession,
  supervision, bids, history); proposals waiting; the upgrades that can be proposed with their
  benefit-cost ratio.
- **Staff**: per discipline the ALV, the day shift, the emergency team and who is on call now (the
  asset manager hires and lets go); drone pilots; what everybody is doing; the level crossing plant
  with its orders.
- **Results**: key figures per year (and the current year so far), the score, the money; **Download
  results (CSV)**, **Save the game**, **Load a game**; for the instructor: **Start a new game** with a
  scenario, and who plays which role.

On large screens the tab opens with the **Wide panel**. The game is kept in the browser per layout
and restored when the layout is opened again. The Simulate tab of a layout without infrastructure
offers **Add to this layout** and **Open the example**.

### Roles

| Role | Decides | Can do |
| --- | --- | --- |
| **Asset manager** (Anlagenmanagement) | ALV proposals (approve, decline); the award of contracts | staff per discipline (hire, let go); on-call duty; drone pilots |
| **ALV** (Anlagenverantwortliche, one per discipline) | inspection findings: keep watching, propose a repair, condition monitoring or a renewal | propose repairs, renewals (also with new technology), condition monitoring, upgrades; change the inspection plan; order inspections |
| **Maintenance dispatcher** (Instandhaltungs- und Störungsdisposition) | – (emergency call-outs are dispatched automatically) | order inspections (on site, test, drone); on-call duty; drone pilots |
| **Planner** (HOAI LPH 1–7) | planning depth, BIM (AIA), booking the possession, the procurement procedure | |
| **Construction supervision** (LPH 8) | supervision intensity; acceptance of the works | |
| **Funding authority** (Bund and EBA) | federal funding (benefit-cost ratio); planning approval; commissioning approval | |
| **Instructor** | everything | sees the true condition (*Colour by: True condition*), makes assets fail, starts new games, sets who plays which role |

A team shares one device (or the projector) and switches roles; each role may only make its own
decisions. Roles nobody plays are played by the computer (`roles`, or *Who plays which role* in
Results), which takes every decision at once by its default rule. A decision that waits for students
takes its default after `decision_days` (14) days; inspection findings wait longer and do not stop a
fast run. Teams that play the same scenario with the same seed meet the same random events, so
their results can be compared (**Download results**).

## Condition and what is known

### Grades

The condition of an asset is graded like the condition report of DB InfraGO: a grade value from
**1.0 (as new)** to **5.99 (deficient)**, the grade the whole number: 1 as new, 2 good, 3 fair, 4 poor,
5 deficient; **6 (restricting)** is an asset with an open fault. The network grade is the mean grade
value weighted by replacement value. On the layout and in the map the grade's colour runs from Türkis
(1) over Gelb (3) to Rot (5); a fault is Dunkelblau with a red ring.

Behind the grade is the asset's **health** h (1 new … 0 worn out; grade value = 1 + 4.99 (1 − h)).
It falls every day by the wear law du/dt = r (1 + u) (u = 1 − h), with the rate r chosen so that an
asset serviced as usual reaches grade 4 at the end of its **service life**, times a random factor,
times √(trains a day / 100) for track, switches and overhead lines, times 1.35 while its servicing is
overdue. Repairs give back health up to a cap that falls with age; a renewal sets it to 1.

### Faults

The expected faults a year of an asset are its type's rate (per piece, or per km) times a factor of
its health: 0.25 for a new asset, about 1 at grade 3–4, 4.25 when worn out (three times as many for
a year after a construction with a hidden defect). Cable routes are also cut by **thieves**. Worn
track and switches (h < 0.2) get a permanent **speed restriction** (Langsamfahrstelle): their trains
lose a minute each until the asset is repaired.

A fault becomes known by its **report path**:

| Path | For | Known after |
| --- | --- | --- |
| diagnosis | field elements of an electronic or digital interlocking | 1–2 min |
| the interlocking's panel | field elements of a relay interlocking; cable cuts (signals dark) | 3–6 min |
| remote monitoring | GSM-R sites (network management), substations, lifts, displays; assets with condition monitoring added | 2–4 min |
| a train driver | track, balises, field elements of a mechanical interlocking | the next train, plus 5 min; at night, the first train in the morning |
| passengers | platforms | about an hour |

The dispatcher sends, in this order: the **emergency team** on shift, a **day technician** (who leaves
the planned work), the **technician on call** from home (30 min to set off), else the **framework
contractor** (2:30 h). The drive is over the layout's streets for assets on the layout, else 1.35 times
the straight distance at 50 km/h; the repair takes the type's time (log-normal). Until then:

- trains are **delayed** (the type's minutes per train for the share of the line's trains affected),
  or **stopped** (an interlocking or an overhead line: the trains count as cancelled, 30 delay
  minutes each); the **performance regime** (Anreizsystem) charges €1 per delay minute caused by the
  network;
- station equipment is **out of order** (a lift €40 an hour, a display €15, part of a platform €60).

At the station on the layout a fault starts a disruption on its platforms: trains **pass at caution**
(a message on the boards) or, for the interlocking, are **held** until the repair, also the trains of
[rail operations](operations.md) on the same layout.

### What is known

What the players see is the **known condition**, never the true one (except the instructor):

- the **last observation** (an inspection, a repair, an acceptance) with its error, aged by the wear
  law, its uncertainty growing by 0.07 a year;
- mixed with the **live share**: the part of the condition the asset reports itself, with a small
  error. Field elements report as much as their **interlocking**: mechanical 0, relay 0 (only
  faults), electronic (ESTW) 30 %, digital (DSTW) 60 % of a signal's condition (80 % of that for
  switches and level crossings: blades, frogs and barrier booms are not measured). GSM-R sites and
  substations report 70 %, lifts 60 %, displays 80 %. **Condition monitoring** can be added to
  switches (switch diagnosis, 50 %) and level crossings (remote monitoring and diagnosis, 40 %);
- without any observation, the **age**: the expected health at that age, very uncertain; when even
  the year of construction is not recorded (old assets), a guess.

On the layout the ring of an asset is **solid** when its condition is known to about ±0.35 grade (or
reported live), **dashed** when the last check is long ago, **dotted grey** when only its age is known.
*Colour by: Last check* colours by the age of the knowledge instead (live or this month Türkis … two
years or never Rot). An asset counts as **known well** when its uncertainty is at most ±0.5 grade.

### Inspections

| Method | Error (health) | Who | Counts for the rules |
| --- | --- | --- | --- |
| On-site inspection (Inspektion vor Ort) | 0.04 | day technicians of the discipline; includes servicing | yes |
| Diagnostic test (Messung / Prüfung) | 0.05 | day technicians; signals, balises, level crossings, interlockings, switches, GSM-R | yes |
| Drone flight (Drohnenbefliegung) | 0.07, only the visible share of the condition (overhead line 90 %, level crossing 45 %, track 40 %, signal 35 %, …) | drone pilots, on flyable days (70 %) | for overhead lines, GSM-R masts and cable routes |
| Measurement train (Messzug) | 0.03 | runs on every line (track geometry, overhead line, radio coverage; switches half) | yes |

Each asset type has a plan (method, times a year) and a minimum the rules ask for (EBO § 17: the
installations are to be inspected as their condition, load and speed require; e.g. track twice a year,
switches four times). The day technicians do the due inspections in their shift, the most urgent
first, as many as fit with the drives. Once a year the **EBA audits** the inspection records: below
95 % on time it orders the backlog cleared and charges (0.95 − share) × €400,000. An inspection that
finds grade 4 or worse (and worse than at the last finding) is an **inspection finding** for the ALV.

## Staff

Per discipline (track; signalling and telecoms; electrical; stations):

- one **ALV**, who is responsible for its assets (in the game: the student who plays the role);
- **day technicians**, Monday to Friday 07:00–15:30: planned work and faults in their shift;
- an **emergency team** (Entstörer) in three shifts (early 06–14, late 14–22, night 22–06) in a ten-day
  cycle of 2 early, 2 late, 2 nights and 4 days off: five people keep one van ready around the clock;
- outside the shifts one day technician is **on call** from home, by the week (€280 a week).

Drone pilots fly the drone inspections. Hiring takes `hire_days` (120); people leave after three
months. Salaries are paid monthly from the maintenance money, call-outs beyond a shift as overtime
(130 %), contractors by the hour.

On the layout the vans leave the maintenance base's yard (the emergency team's van has an orange
roof and a beacon), drive over the streets to the street node nearest the asset, and the technician
(orange vest) works at the asset; vans for assets beyond the layout drive to the edge of the layout.
Drones take off from the base's pad and circle over the asset with their camera.

## Measures and projects

An ALV proposes; the asset manager decides:

| Measure | Money | How |
| --- | --- | --- |
| **Repair** (Instandsetzung) | maintenance | a day technician; +0.3 health up to the age cap |
| **Condition monitoring** | maintenance | a day technician fits it; the asset reports more live |
| **Renewal, like for like** (Ersatzinvestition) | replacement | a project; no planning approval |
| **Renewal with new technology** | replacement | a project: an interlocking becomes digital (with its signals and balises renewed; its switches and level crossings then report their condition), a switch gets its diagnosis, a level crossing remote monitoring |
| **Upgrade** (Ausbau) | federal (benefit-cost ratio ≥ 1) and own money | a project of the layout's `upgrades`: it needs planning approval |

The example's upgrades: **electrifying the branch line to Waldau** (€28 M, benefits €1.35 M a year:
benefit-cost ratio 0.99, just too little for federal money) and **replacing the level crossing
Talstraße by an underpass** (€9 M, €0.5 M a year: 1.14).

### The project's phases

| Stage | What happens | Who decides |
| --- | --- | --- |
| LPH 1 Basic evaluation (Grundlagenermittlung) | | planner: planning depth, BIM |
| LPH 2 Preliminary design (Vorplanung) | the **cost estimate** (Kostenschätzung) | |
| Federal funding | upgrades: benefit-cost ratio (NKV) = benefits a year × annuity factor (30 years, 1.7 %) / (cost × (1 + fees)) | funding authority |
| Crossing agreement (EKrG) | level crossings: the road authority signs (2–4 months) | computer |
| LPH 3 Design (Entwurfsplanung) | the **cost calculation** (Kostenberechnung), closer to the real costs | |
| LPH 4 Approval planning (Genehmigungsplanung) | | |
| Planning approval (Planfeststellung) | upgrades (AEG § 18); a like-for-like renewal needs none | funding authority (EBA): approve (6 months), with conditions (+5 %, 8 months), refuse |
| Plan check | signalling: an assessor checks the plans (45 days) | computer |
| LPH 5 Execution planning (Ausführungsplanung) | the **possession** is booked | planner: planned (construction not before 9 months) or short notice |
| LPH 6 Tender documents (Vorbereitung der Vergabe) | | planner: procedure |
| LPH 7 Procurement (Mitwirkung bei der Vergabe) | the contractors bid | asset manager: award |
| The plant | level crossings: the system is built to order | computer |
| LPH 8 Construction (Bauoberleitung) | in the possession: 30 % paid at the start, 70 % and the claims at the end; trains are delayed (construction-caused: €16 per delay minute) | supervision: intensity |
| Acceptance (Abnahme) | defects found (by supervision intensity and the contractor's quality) | supervision: accept, or refuse until put right (a month) |
| Commissioning approval | signalling and level crossings (EBA) | funding authority: approve, or more documents (3 weeks) |
| LPH 9 Follow-up (Objektbetreuung) | the asset is in service; a year of warranty | |

**Fees**: the HOAI's shares of § 47 (Verkehrsanlagen): 2, 20, 25, 8, 15, 10, 4, 15 and 1 % for phases
1–9, of a fee of 14 % of the construction costs; times 0.8 (lean), 1 (normal) or 1.2 (thorough
planning); BIM adds 3 % of the construction costs; LPH 8 times 0.7, 1 or 1.4 by supervision intensity.

**Planning depth**: the real costs differ from the estimate by +10 % ± 16 % (lean), +4 % ± 9 %
(normal), 0 ± 5 % (thorough), more where the assets' data are incomplete; claims (Nachträge) at the end
of construction are 8, 4 or 1.5 % plus up to 6 % for a contractor of lower quality.

**Procurement**: a **direct award** up to €150,000; a **call-off from a framework contract** (8 % dearer,
3 weeks) where a framework contractor covers the discipline and the value is below the EU threshold
for works (€5,404,000 from 2026); an **open procedure** (about 75 days, 20 more EU-wide) or a
**negotiated procedure with competition** (about 110 days, the three best firms, 3 % cheaper). The
contractors (computer) bid the real costs times their price level, the market's load and a little
chance; the **most economic bid** weighs price (70 %) and quality (30 %) (GWB § 127). Nobody bids:
the tender is repeated.

**Money**: renewals are paid from the **replacement money** (federal; what is not spent by the end of
the year goes back); level crossing measures share the costs under the **EKrG**: a third each for the
railway, the road authority and the Bund, on a municipal road half for the Bund, a third for the
railway and a sixth for the Land (§ 13). Upgrades: the infrastructure manager pays the planning from
its **own investment money**; once funded, the Bund pays the construction and a planning lump sum of
18 % of it. A project that cannot pay the start of its construction waits for next year's money; the
final bill is paid anyway (overspending comes off next year's money).

**Completion**: the assets are renewed (with a hidden defect, health 0.86 and three times the faults
for a year), observed at the acceptance, and get their **as-built data** (complete to 45–95 % by
supervision intensity and BIM).

### The level crossing plant

Orders go through engineering (6 weeks), production (8), the factory test (2; 15 % fail and need 3
weeks of rework) and delivery (1), on two production lines; other customers order about six systems
a year. A renewal of a level crossing waits for its system; the plant's queue decides how long. The
plant on the layout shows its lines and orders.

## The asset information model, BIM and GIS

Every asset is an object of the **asset information model** (AIM, ISO 19650): its IFC 4.3 class and
predefined type (IfcSignal VISUAL, IfcRailwayPart PLAINTRACK / TURNOUTTRACK, IfcFacilityPart
LEVELCROSSING, IfcCommunicationsAppliance TRANSPONDER for a balise, IfcMobileTelecommunicationsAppliance
BASETRANSCEIVERSTATION, IfcCableSegment CONTACTWIRESEGMENT, IfcTransformer, IfcTransportElement
ELEVATOR, IfcAudioVisualAppliance DISPLAY, …; IFC has no class of its own for an interlocking, here
its logic IfcController PROGRAMMABLE, nor for a platform, here IfcSlab user-defined), a stable
GlobalId, its **linear placement** (line and km, as IfcLinearPlacement on the line's IfcAlignment
would have it) and property sets (Pset_ManufacturerOccurrence, Pset_ServiceLife, Pset_Condition and
the simulation's own). Old assets have **gaps in their data**: the manufacturer's data or even the year
of construction are missing; a project with **BIM** (employer's information requirements, AIA, and an
as-built model) hands over complete data, a project without it and with little supervision leaves
gaps.

**GIS.** The layout is a plane in model millimetres; the simulation places it in the network: the
layout's origin is km `placement.km_at_origin` of the station's line, its x axis runs with the km. The
network's lines are polylines in metres east and north of a **georeference**, an invented place in
**ETRS89 / UTM zone 33N** (EPSG:25833). So every asset has a position in a real coordinate reference
system, and **Download GeoJSON** writes the lines, stations and assets in WGS 84 with their line, km,
IFC class and known condition: QGIS opens it on a basemap. Railways locate their assets by line and
km (linear referencing) rather than by coordinates, which is why the map in the tab is a line diagram.

## Years and the score

At the end of each year the results are kept: the true and the known network grade, faults, delay
minutes, speed restrictions, the performance regime, station outages, response and repair times,
call-outs, overtime, inspections and their compliance, how much is known well, projects completed and
the money. When the network grade is worse than the quality target of the replacement agreement
(`funding.target_grade`, 3.2), the Bund withholds `target_penalty_eur` (€400,000) of next year's
replacement money.

The **score** (0–100) weighs five parts: **condition** 30 (grade 2.0 → 100, 4.0 → 0), **reliability** 25
(delay minutes against what the network had at the start), **money** 15 (the maintenance budget kept,
the replacement money used), **rules** 15 (inspections on time, 70 % → 0, 100 % → 100) and
**information** 15 (share known to ±0.5 grade).

## Layout file

The infrastructure is an entry of the layout's `simulations`; every key except `type` is optional.
The example's entry:

```json
{
  "type": "infrastructure",
  "name": "Infrastructure district Bahnhof",
  "placement": { "station": "bahnhof", "line": "6250", "km_at_origin": 21.1, "direction": 1 },
  "factory": { "object": "crossing-plant-1" }
}
```

Without `lines` and `stations` the example network is used (the station on the layout is Bahnhof).
Assets on the layout are its objects of the infrastructure types (below), its `track` objects and its
`platform` objects; the generated assets of the station on the layout are then left out (except
along the line beyond the layout's tracks).

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | `"Infrastructure district"` | shown in the tab |
| `start_year`, `years` | `2027`, `5` | the first budget year and the length of a game |
| `seed` | the world's seed | random seed |
| `georef` | `{epsg: 25833, easting: 409700, northing: 5651200, rotation_deg: 0}` | the network's origin in UTM |
| `placement` | `{station: "bahnhof", line: "6250", km_at_origin: 21.1, direction: 1}` | the layout in the network: its station, the line and km of its origin, `direction` −1 when the km fall along x |
| `lines` | the example's | `id`, `name`, `km` ([from, to]), `tracks`, `speed_kmh`, `electrified`, `trains_per_day`, `path` (`[[km, east_m, north_m], …]`) |
| `stations` | the example's | `id`, `name`, `line`, `km`, `tracks`, `platforms`, `lifts`, `interlocking` (`{generation, built}`; `generation`: `mechanical`, `relay`, `electronic`, `digital`) |
| `crossings` | the example's | level crossings beyond the layout: `line`, `km`, `road`, `road_owner` (`municipal`, `district`, `state`) |
| `substations` | the example's | `line`, `km`, `name` |
| `generate` | `{enabled: true, block_km: 3, section_km: 3, gsmr_km: 5, catenary_km: 5, cable_km: 3}` | assets generated along the lines and at the stations |
| `assets` | `[]` | more assets: `{id, type, line, km, name, built, length_km, generation, interlocking}` |
| `types` | | changes to the asset types, e.g. `{"lift": {"fail_per_y": 3}}`: `life_y`, `renew_eur`, `renew_days`, `repair_eur`, `repair_h`, `fix_gain`, `fail_per_y`, `theft_per_y`, `effect`, `live`, `drone`, `inspect` (`{method, per_year}`), `min_per_year`, `inspect_min`, `retrofit` |
| `budgets` | `{maintenance_eur: 4400000, replacement_eur: 9000000, own_eur: 3000000}` | money per year |
| `funding` | | `federal_share` (1), `planning_share` (0.18), `discount_rate` (0.017), `horizon_y` (30), `min_ratio` (1), `ekrg` (the shares), `target_grade` (3.2), `target_penalty_eur` (400000) |
| `staff` | track 6 day; signal 6 day, 5 emergency; electric 3; station 2; 2 pilots | per discipline `{day, emergency}`; `drone_pilots`, `hours_week` (39), `day_shift` (`{from: "07:00", to: "15:30"}`), `oncall` (true), `oncall_alert_min` (30), `hire_days` (120) |
| `costs` | | `person_year_eur` (72000), `oncall_week_eur` (280), `overtime_factor` (1.3), `hour_eur` (44), `contractor_hour_eur` (115), `contractor_callout_min` (150), `materials_factor` (1), `drone_flight_eur` (120), `train_eur_km` (70), `delay_eur_min` (1), `construction_delay_eur_min` (16), `cancel_min` (30) |
| `trains` | `{from: "05:00", to: "24:00"}` | when trains run |
| `drones` | `{flyable: 0.7, km_per_h: 30, setup_min: 20}` | |
| `measurement_runs` | `2` | runs a year of the measurement train (as the plans of the types it measures say) |
| `hoai` | `{shares: [2, 20, 25, 8, 15, 10, 4, 15, 1], fee_share: 0.14, bim_extra: 0.03}` | fee shares of the phases (§ 47), fee and BIM extra as shares of the construction costs |
| `procurement` | `{eu_works_eur: 5404000, eu_services_eur: 432000, direct_max_eur: 150000, framework_extra: 0.08, open_min_days: 35}` | |
| `contractors` | five firms | `id`, `name`, `disciplines`, `price`, `quality`, `capacity`, `framework` |
| `factory` | | `name`, `object` (a `crossing-plant` on the layout), `lines` (2), `weeks` (`{engineering: 6, production: 8, test: 2, delivery: 1}`), `test_fail_p` (0.15), `rework_weeks` (3), `external_per_year` (6) |
| `upgrades` | the two of the example | `id`, `name`, `description`, `line`, `km`, `cost_eur`, `benefit_eur_y`, `adds` (`[{type, line, from_km, to_km}]`), `removes` (`[{type, line, km}]`), `ekrg` |
| `roles` | all `"student"` but the dispatcher | `"student"` or `"computer"` per role |
| `decision_days` | `14` | days a decision waits for its role |
| `score` | `{condition: 30, reliability: 25, money: 15, rules: 15, information: 15}` | weights of the score |
| `scenarios` | the presets | `{id, name, description, patch, events}`: `events` `[{day, at, type}]` with the types `storm` (`line`, `count`), `theft`, `staff_loss` (`discipline`, `count`), `failure` (`asset`) |

**Scenarios** (presets): *Normal years*, *Budget cut* (15 % less maintenance money, 25 % less
replacement money), *Autumn storm* (October of the first year), *Staff shortage* (three technicians
leave, hiring takes eight months), *Cable theft* (three cable cuts).

The validation reports unknown lines, stations, asset types, objects and roles in plain words.

## Objects

In Build → Infrastructure. Point objects take `position`, `rotation_deg` (the direction of the
track), `name`, `built` (year; 0: unknown, the simulation assumes one) and `real` (on the real
layout: over the camera image only its state is drawn).

| Type | Asset | Parameters |
| --- | --- | --- |
| `signal` | signal | `interlocking` (an `interlocking` object; empty: the station's), `side` |
| `switch` | switch | `interlocking`, `hand` (`left`, `right`), `length_m` (33) |
| `balise` | balise | |
| `level-crossing` | level crossing | `interlocking`, `road_m` (7), `span_m` (0: one track; the distance between the outer tracks' centres), `road_owner` (`municipal` …) |
| `gsmr-mast` | GSM-R site | `height_m` (30) |
| `lift` | lift | |
| `passenger-display` | passenger display | |
| `catenary` | overhead line section | `points` (along the track), `spacing_m` (55), `side` |
| `cable-route` | cable route | `points` |
| `interlocking` | interlocking | `generation` (`mechanical`, `relay`, `electronic`, `digital`): what its field elements report; a building |
| `maintenance-base` | – | the base: its yard (entrance 0) is where the vans start, with the drone pad |
| `crossing-plant` | – | the level crossing plant; shows its orders |

The layout's `track` objects (with `virtual: true` a track on a table module that is drawn over the
camera image too) and `platform` objects are assets as well.

## Disruptions and events

Offered in the Disruptions panel for layouts with the infrastructure:

| Type | Parameters | Does |
| --- | --- | --- |
| `asset-fault` (Asset fault) | `asset` (name or id; empty: one at the station by chance) | the asset fails now |
| `cable-theft` (Cable theft) | | a signalling cable is cut |
| `storm` (Storm damage) | `count` (4) | trees on the line: overhead lines, signals, GSM-R masts, cable routes and track damaged |

The simulation starts the disruption `infra-fault` itself on the platforms of a fault at the station
(not offered in the panel). It reports on `world.events` (every payload also has `simulation`):
`infra.fault` and `infra.dispatch` (`{fault, asset, person}`), `infra.fixed`, `infra.inspected`
(`{asset, method, known}`), `infra.decision` (`{item}`), `infra.asset.renewed` (`{asset, project}`),
`infra.asset.restricted`, `infra.year` (`{result}`) and `infra.log`.

For plugins: `infraOf(world)` returns the simulation, with `engine` (the `InfraEngine`: `assets`,
`people`, `known(asset)`, `inbox`, `open(role)`, `act(name, …)`, `desk.projects`, `factory`, `years`,
`current()`), `runTo(t, {pause})`, `runYear()`, `save()`, `load(saved)`, `newGame({scenario})`,
`failAsset(nameOrId)`, `inject(event)` and `display` (`mode`, `labels`). Without the app:

```js
import { InfraEngine } from "./web/arail/index.js";
const e = new InfraEngine({ roles: { planner: "computer", authority: "computer" } }, { seed: 1 });
e.act("propose", "renew", ["W-Tal-1"]);
e.runTo(5 * 365 * 1440);
console.log(e.years.map((y) => [y.year, y.grade.toFixed(2), Math.round(y.score.total)]));
```

## Sources and simplifications

The structure follows these rules and sources (checked in October 2026; the numbers in the game are
simplified):

- **Condition grades**: DB InfraGO's condition report (InfraGO-Zustandsbericht): grades 1 neuwertig to
  5 mangelhaft on a continuous scale 1.0–5.99, 6 for restricting conditions; the network graded about
  3.0 in 2023–2025.
- **EBO** § 2 (installations safe and in order), § 11 (level crossings: technical protection by light
  signals with or without (half) barriers, a guard when it fails), § 17 (inspecting the installations);
  **AEG** § 18 (planning approval; a renewal without a substantial change of plan or elevation needs
  none); the **EBA**'s approvals and commissioning.
- **HOAI 2021** § 47 (Verkehrsanlagen): the fee shares of LPH 1–9; since 2021 the fee tables are
  guidance values, the fee is agreed.
- **Funding**: replacement money from the Bund under the LuFV III (2020–2029; a successor agreement is
  planned from 2027), with quality indicators (theoretical travel time lost, the number of
  infrastructure defects, bridge condition); new and upgrade projects need a benefit-cost ratio above 1
  (Bedarfsplan, BVWP; regional projects the Standardisierte Bewertung); **EKrG** §§ 3, 13 (thirds; a
  municipal road: Bund 1/2, railway 1/3, Land 1/6), § 14 (who maintains what).
- **Procurement** for sector contracting entities: GWB § 127 (the most economic tender), § 141 (free
  choice of the procedures with competition), SektVO (time limits, framework agreements up to eight
  years), the EU thresholds from 1 January 2026 (works €5,404,000; supplies and services €432,000).
- **Performance regime** (ERegG § 39, DB InfraGO's Anreizsystem): delay minutes caused by construction
  €16 for regional trains, other network-caused delays €1.
- **Service lives** from the ABBV (EKrG's redemption ordinance) where it has them (track 30, switches
  20, level crossing signals with barriers 30, overhead line 30, lifts 15 years); electronic
  interlockings about 20 years for their indoor equipment.
- **IFC 4.3** (IFC4X3_ADD2) classes and predefined types as listed above.
- **Drones**: EU regulation 2019/947 (beyond visual line of sight needs the specific category).

Simplifications: one infrastructure manager, its own budgets per year and no borrowing; assets fail
independently (except storms and cable theft); the trains beyond the layout are counts per line, not a
timetable; possessions do not change the operations' timetable; the contractors' and the plant's
capacities are coarse; the money is for comparing decisions, not a budget of a real district.

## Limits

- One infrastructure simulation per layout; one station on the layout.
- The vans drive over the layout's streets only; the drive beyond the layout is estimated.
- Possessions and construction do not hold the trains at the platforms on the layout (only faults do).
- Players on one device: there is no game server for several devices yet.
