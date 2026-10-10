# Railway systems and trains

Every track of a layout is a **section** with its railway systems: the traction power, the train protection, ETCS, the lineside signals, the train radio, the gauge, the line category, the loading gauge, the line speed, its country and its infrastructure manager. They matter wherever trains cross from one system to another: at a border, at a system separation section, where ETCS starts. ARail shows them on the real table and in the flyover. This is the groundwork for cross-border operations in the lab ([#131](https://github.com/joernmht/ARail-EBL/issues/131)).

## The systems of a section

| System | Values | RINF parameter |
| --- | --- | --- |
| Traction power (`power`) | not electrified, 15 kV 16.7 Hz AC, 25 kV 50 Hz AC, 3 kV DC, 1.5 kV DC, 750 V DC third rail | Energy supply system (voltage and frequency) |
| Pantograph head (`pantograph_mm`) | 1450, 1600 (TSI), 1950 mm | Accepted pantograph heads |
| Train protection (`train_control`) | none, PZB 90, PZB 90 and LZB, LS (Czechia, Slovakia), SHP (Poland), KVB (France), ATB (Netherlands), ZUB 121 / Integra (Switzerland) | Other train protection, control and warning systems installed |
| ETCS (`etcs`) | none, Level 1 Limited Supervision, Level 1, Level 2 | ETCS level |
| Signals (`signalling`) | H/V, Ks, Hl (Germany), Czech, Polish, Austrian, Swiss, French, Dutch signals, no lineside signals (ETCS marker boards) | Lineside signalling |
| Train radio (`radio`) | none, analogue, GSM-R, FRMCS | GSM-R version |
| Track gauge (`gauge_mm`) | 1435, 1520, 1668, 1000 mm | Nominal track gauge |
| Line category (`route_class`) | A, B1, B2, C2, C3, C4, D2, D3, D4, E4, E5 (EN 15528: the letter is the highest axle load, 16 to 25 t; the number the highest load per metre, 5 to 8.8 t) | Load capability |
| Loading gauge (`loading_gauge`) | G1, G2, GA, GB, GC | Gauging |
| Country (`country`) | DE, CZ, PL, AT, CH, FR, NL | Member State |
| Infrastructure manager (`im`) | free text | Infrastructure manager |
| Line speed (`max_speed_kmh`) | km/h | Maximum permitted speed |

The names follow the parameters of the EU Register of Infrastructure (RINF), so that real corridors can be filled in from it later.

**Usual in the country.** A system left empty is the one usual in the section's country (default Germany). The countries' values are typical and simplified for teaching; a real line can differ, RINF has the real ones.

| Country | Power | Pantograph | Train protection | Signals | Infrastructure manager |
| --- | --- | --- | --- | --- | --- |
| Germany (DE) | 15 kV 16.7 Hz | 1950 mm | PZB 90 | Ks | DB InfraGO |
| Czechia (CZ) | 3 kV DC | 1950 mm | LS | Czech | Správa železnic |
| Poland (PL) | 3 kV DC | 1950 mm | SHP | Polish | PKP PLK |
| Austria (AT) | 15 kV 16.7 Hz | 1950 mm | PZB 90 | Austrian | ÖBB-Infrastruktur |
| Switzerland (CH) | 15 kV 16.7 Hz | 1450 mm | ZUB 121 / Integra, ETCS L1 LS | Swiss | SBB Infrastruktur |
| France (FR) | 25 kV 50 Hz | 1600 mm | KVB | French | SNCF Réseau |
| Netherlands (NL) | 1.5 kV DC | 1950 mm | ATB | Dutch | ProRail |

All of them have GSM-R, standard gauge and line category D4; no ETCS unless a track says so (Switzerland: Level 1 LS).

## In the app

- **Build → Track**: the systems are parameters of every track (*as usual in the country* unless chosen).
- **View → Show → Colour the tracks by**: traction power, train protection, ETCS, signals, train radio, track gauge, line category, loading gauge, country or infrastructure manager. Every track gets a band in the colour of its value, with the value at its middle, over the camera image (on the real tracks) and in the flyover; the View panel lists the colours and how many tracks have each. Where two tracks meet end to end with a different value, an orange mark shows the change (*15 kV 16.7 Hz | 3 kV DC*).
- **Tap a track** (outside Build): its info card lists all its systems, those usual in the country marked so.
- **System change** (Build → Infrastructure): a board beside the track where a system changes: a *system separation section* (traction power), a *train control transition*, a *state border* or the boundary between *infrastructure managers*. Its card says what drivers and dispatchers do there and lists the systems of the two tracks beside it.

**Example**: the lab example's module **Border station** (View → Modules) makes the station a border station between Germany and Czechia: track G3 is Czech (3 kV DC, LS, Czech signals, Správa železnic), G1 and G2 stay German, and a board at the end of G3 marks the border.

## In the layout file

```json
{ "id": "track-g3", "type": "track", "track_id": "G3", "points": [[-150, -58], [1450, -14.9]],
  "country": "CZ", "etcs": "l2", "max_speed_kmh": 100 },
{ "id": "border-g3", "type": "system-change", "name": "Border DE | CZ", "kind": "border",
  "position": [1400, -45], "rotation_deg": 1.5 }
```

A module can turn a section into another country with a patch (`{"id": "track-g3", "country": "CZ"}`), as the lab example's *Border station* does. Values of `system-change`: `kind` = `power`, `train_control`, `border` or `im`.

## Vehicles and trains

ARail knows trains as technical objects too: what they are made of, how heavy they are and how well they brake ([#82](https://github.com/joernmht/ARail-EBL/issues/82)).

**The catalogue** (`VEHICLE_TYPES`, typical values, rounded, for teaching; a real vehicle's are on its data plate):

| Type | Kind | Length | Mass | Axles | Top speed | Brake weights |
| --- | --- | --- | --- | --- | --- | --- |
| `br146` BR 146.2 (TRAXX P160 AC2) | locomotive | 18.9 m | 85 t | 4 | 160 km/h | G 64, P 105, R 105 t |
| `br185` BR 185.2 (TRAXX F140 AC2) | locomotive | 18.9 m | 85 t | 4 | 140 km/h | G 64, P 100, R 100 t |
| `br193` BR 193 (Vectron MS) | locomotive | 19 m | 90 t | 4 | 200 km/h | G 70, P 115, R 135 t |
| `cd380` ČD 380 (Škoda 109E) | locomotive | 20.8 m | 87 t | 4 | 200 km/h | G 65, P 110, R 130 t |
| `eu07` EU07 (PKP) | locomotive | 15.9 m | 80 t | 4 | 125 km/h | G 52, P 80 t |
| `br218` BR 218 (diesel) | locomotive | 16.4 m | 79 t | 4 | 140 km/h | G 55, P 85, R 85 t |
| `et442` ET 442 Talent 2 (4 cars) | multiple unit | 66 m | 135 t | 10 | 160 km/h | R 190, R+Mg 230 t |
| `br642` BR 642 Desiro Classic | railcar (diesel) | 41.7 m | 69 t | 6 | 120 km/h | R 95, R+Mg 115 t |
| `dbpza` DBpza (double-deck coach) | coach | 26.8 m | 49 t | 4 | 160 km/h | P 55, R 75 t |
| `bpmz` Bpmz (open coach) | coach | 26.4 m | 47 t | 4 | 200 km/h | P 52, R 74, R+Mg 96 t |
| `sgns`, `eanos`, `habbins`, `zacns` | freight wagons | 15.5–23.3 m | 20–28 t empty, 90 t loaded | 4 | 100–120 km/h | empty = tare, loaded 58 t (load-dependent brake) |

Each type also says what it is equipped with: the traction power systems it runs on, its pantograph heads, its train protection systems, ETCS, radio and the countries it is authorised for.

**Consists.** A layout's `consists` give the vehicles of its trains, by line (`"lines": ["RE 1"]`, which also matches the trains of the rail operations, *RE 1 → Altstadt 07:15*) or by train number of the control system (`"trains": ["ICE 70"]`):

```json
"consists": [
  { "id": "re1", "lines": ["RE 1"], "vehicles": [{ "type": "br146" }, { "type": "dbpza", "count": 4 }] },
  { "id": "freight", "trains": ["GC 61"], "brake_position": "G",
    "vehicles": [{ "type": "br185" }, { "type": "sgns", "count": 20, "loaded": 0.8, "isolated": 1 }] }
]
```

`count` repeats a vehicle; `loaded` is the share of a wagon's load (`true` = full); `isolated` cuts out the brakes (`true`, or how many of the `count`). Without a consist, a train of the rail operations is made of its units when their fleet type is in the catalogue (`et442`). `vehicle_types` adds types of the layout's own.

**The figures of a train**, on its info card (tap the train): its vehicles as a strip, length, mass, axles, the top speed (the lowest of its vehicles, and which one limits it), the brake position and the **brake percentage** (Bremshundertstel), the highest axle load and metre load.

- Brake percentage = the sum of the brake weights in the train's brake position / the train's mass × 100. A vehicle without a weight for that position brakes with the nearest slower one it has (a coach in a train braked in G with its P weight), else the nearest faster one; isolated brakes count 0. A wagon's mass and brake weight go from empty to loaded with its load (a load-dependent brake), so an empty freight train brakes better per tonne than a full one.
- Brake position: as the consist says, else G for a freight train (only locomotives and wagons), else R when a vehicle has an R weight, else P.
- Axle load = mass / axles, metre load = mass / length over buffers, as EN 15528 defines them for the line categories.
- A track's `min_brake_percentage` (Build → Track: *Required brake percentage*, the Mindestbremshundertstel of the line's braking table) is compared with the train standing on it: *76 % · met*, or a warning that the permitted speed is lower. The speed that follows from the braking table, braking distances and train control curves are the next steps ([#85](https://github.com/joernmht/ARail-EBL/issues/85)).

The lab example's RE 1 (BR 146 and four double-deck coaches: 144 % in R), RB 33 (two BR 642) and S-Bahn (ET 442) have consists.

## May this train run here?

A train may run on a section only when its vehicles fit the section's systems ([#133](https://github.com/joernmht/ARail-EBL/issues/133)). Each vehicle type of the catalogue has a **capability profile**: the traction power it draws (`power`), its pantograph heads (`pantograph_mm`), its train protection (`train_control`) and ETCS level (`etcs`), its train radio (`radio`), its track gauge (`gauge_mm`, 1435 if not given) and the countries it is authorised in (`countries`). The check compares a train with a section, one system after another:

| What | The train may run when |
| --- | --- |
| Traction power | a diesel vehicle hauls it, or an electric vehicle draws the section's power with pantograph heads of the section's width; an electric locomotive that cannot is hauled without power (a note) |
| Train protection | the leading traction vehicle has the section's class B system (PZB is enough for PZB with LZB), or ETCS at the section's level or higher; a section with neither asks for nothing |
| Train radio | a traction vehicle has the section's radio |
| Track gauge | every vehicle runs on the section's gauge |
| Line category | the heaviest axle load and metre load are within the category (EN 15528: C2 is 20 t per axle, D4 22.5 t) |
| Authorisation | every vehicle is authorised in the section's country |

**On the info card of a train**: *May it run here?* lists every track of the layout with *yes* or *no* and the reasons, e.g. *Track G3: no · 3 kV DC: no vehicle can draw this power (BR 146.2: 15 kV) · PZB needed; … · Not authorised in CZ: BR 146.2, DBpza*. When the train may not run on the track it stands on, the card says so in red.

**On the table**: *Show where it may run* on the card colours the tracks by it (View → Colour the tracks by: *where RE 1 may run*): turquoise where the train may run, red where not, with the first reason on each track; the legend counts them. This choice is not kept for the next session, since it belongs to the train.

In the lab example's module *Border station*, RE 1 may run on G1 and G2 and not on the Czech track G3; a train hauled by a BR 193 (Vectron MS, multi-system with ETCS) may run on all three.

What the check leaves out for now: the loading gauge of the vehicles and their loads, the length of the train against the platforms and passing loops, gradients and the hauling capacity of the locomotives, and the speed that follows from the braking table ([#85](https://github.com/joernmht/ARail-EBL/issues/85)).

## For plugins

`sectionSystems(spec)` gives the systems of a section (`{values, usual}`), `systemRows(spec)` the rows of its card, `systemValue(key, value)` the label, short text and colour of a value, `routeClassLimits("D4")` the axle and metre load of a line category, `systemChanges(tracks, key)` where neighbouring sections differ; the catalogues are `POWER`, `TRAIN_CONTROL`, `ETCS`, `SIGNALLING`, `RADIO`, `GAUGE`, `ROUTE_CLASS`, `LOADING_GAUGE`, `COUNTRIES` and `SYSTEMS` (`web/arail/rail/systems.js`).

`new Consist({vehicles: [...]})` computes a train's figures (`length_m`, `mass_t`, `axles`, `brakePercentage`, `vmax`, `maxAxleLoad`, `maxMetreLoad`; `rail/vehicles.js`), `consistFor(world, {train, line, units})` finds the consist of a train the world shows, and `VEHICLE_TYPES` is the catalogue.

`checkSection(consist, spec)` checks a train against a section (`{ok, problems: [{key, text}], notes}`, `key` naming the system), `checkTracks(consist, world)` against every track of a world, `compatibilitySection(consist, world)` makes the section of a card, `consistOfHit(world, hit)` finds the consist of a train pointed at (`rail/compat.js`, `rail/trains.js`). With `world.compatibilityTrain = {name, consist}` and `world.settings.trackSystems = "compatibility"` the tracks show where that train may run.
