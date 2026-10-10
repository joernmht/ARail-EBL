# Railway systems

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

## For plugins

`sectionSystems(spec)` gives the systems of a section (`{values, usual}`), `systemRows(spec)` the rows of its card, `systemValue(key, value)` the label, short text and colour of a value, `routeClassLimits("D4")` the axle and metre load of a line category, `systemChanges(tracks, key)` where neighbouring sections differ; the catalogues are `POWER`, `TRAIN_CONTROL`, `ETCS`, `SIGNALLING`, `RADIO`, `GAUGE`, `ROUTE_CLASS`, `LOADING_GAUGE`, `COUNTRIES` and `SYSTEMS` (`web/arail/rail/systems.js`).
