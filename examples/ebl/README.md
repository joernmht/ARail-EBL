# The EBL layout: operational topology

`topology.json` describes the layout of the Railway Operations Laboratory (EBL, TU Dresden) as an
operational network: the operating points, the lines between them in kilometre order, the light rail,
the two swing bridges, and where each part sits on the table, using the marker groups S01–S15 of
the survey of 9 October 2026. It is meant as the base of a digital twin. The facts come from the
lab's own data (lines, operating points, light-rail stops, signal boxes), from the signs, track labels
and kilometre tags in the survey photos, and from information from the lab. They are written in this
file's own format, and none of the lab software's files are copied. Format: `ebl-topology/0.2`.

The digital twin of the lab software ([ebl](https://github.com/joernmht/ebl), `5 Digitaler Zwilling`)
reads the survey part of this file for its hall plan: the tracks of the lab files placed where they
stand in the lab. It also writes the lab's infrastructure (its track plan and its hall plan) in
[rail-infra/1](../../docs/rail-infra-format.md), which the [plan documents](../../docs/plan-documents.md) draw as plan sheets.

## The network

Kilometres are the **virtual line kilometres** of the lab's control software, not table metres. The
main lines run round the hall about twice; one lap of the ring is about 11.3 km (see *Laps* below).

| Line | Route (km) |
| --- | --- |
| NBS, double track | Shadow yard → swing bridge 1 (18.4) → **Neustadt** (20.5–22.4) → crossover Neustadt Ost (24.8–25.1) → swing bridge 1 (29.6) → **Waldhof** (33.3–36.6) → shadow yard. Line ends: Klotzsche (continues in the BEST simulation) and Straßburg |
| ABS, double track | Shadow yard (Eisenberg) → swing bridge 2 (5.5) → **Zellwald** (9.1–10.9) → halt and block post Papiermühle (13.9) → swing bridge 1 (17.9) → block post Klausenburg (19.6) → **Adorf** (26.2–28.0) → swing bridge 1 (29.4) → **Waldhof** (33.9–36.3) → shadow yard (Talheim) |
| Branch line, single track | **Adorf** (28.8) → swing bridge 1 (29.4) → halt and block post Feldberg (31.2) → halt Grüntal (37.1) → sawmill siding (42.6–43.2) → swing bridge 2 (43.7) → **Dornbach** (44.2–45.8) → halt Zellwald Ort (49.3) → swing bridge 2 (51.7) → **Zellwald** (53.6) |
| Schwarzburg branch | Shadow yard → **Schwarzburg** (28.8–29.3) → halt and block post Crottendorf (33.2–33.8) → Grüntal (37.1); spur Crottendorf → halt Moorhof (35.7) → workshop |
| Test track | Two tracks, 0–2.6 km, not connected to the other lines (ETCS tests) |

**Not on the table:** the **shadow yard** (Schattenbahnhof) is real, but it is hidden from view. It
stands in for the line ends Straßburg, Klotzsche, Eisenberg and Talheim. The stations Klotzsche West
and Ost, Flughafen, Grenzstraße, Ottendorf-Okrilla, Radeberg, Arnsdorf, Großröhrsdorf, Dürrröhrsdorf,
Bischofswerda, Seitschen and Neukirch (Lausitz) exist only in the BEST interlocking simulation, which
continues the NBS beyond Neustadt.

**Light rail (Stadtbahn)** on the upper narrow deck, with its own track (the deck is "upper" towards the NBS
in front of it: along Bf Neustadt it lies at the station table's level with the NBS lower in front of it,
and it rises towards Pirna; see [Lab session](../../docs/lab-session.md#the-s-bahns-strip-how-high-it-lies)): Pirna (0.5) – Heidenau (1.5) –
Hauptbahnhof (2.5, depot) – Freiberger Straße (3.3) – Mitte (4.2), then on one branch Radebeul – Coswig – Sörnewitz –
Meißen – Triebischtal (10.4), and on the other Freital – Tharandt (6.0). The yellow-framed table signs belong to
these stops, not to the stations on the lower table.

## Where it is on the table

The tables form a ring round the hall (room 07). Seen from above with the windows at the top, in the
order of the marker groups: the door with swing bridge 1 (**S15**) on the corridor side → straight
tables along the inner wall → the **left end** of the ring with the block posts Klausenburg and
Feldberg (**S14**) → curve (**S13**) → **Neustadt** (S01–S04) → **Waldhof** south throat, passenger
station, north throat and goods yard (S10–S12) along the windows → the **right end** by Hp Papiermühle
(**S09**); at the upper right the lines leave for room 06 and the shadow yard → **Adorf** with the test
track (S06, S08, S07, S05) along the corridor partition → S15. On the upper deck along the windows run
Pirna (S01–S02), Heidenau (S03–S04), Hauptbahnhof (S10), Freiberger Straße (S11), Mitte and Radebeul
(S12). The places of S05–S09 and S11–S15 are estimated; Klausenburg and Feldberg at the left end and
the way out to room 06 at the upper right are information from the lab.

`km_tags_by_group` lists the kilometre tags read on the table, with their position in the frame of
their marker group (mm; light-rail kilometres start with `SB`). These tags tie line kilometres to table positions.

**Room 06** lies to the right of the hall, behind swing bridge 2. It holds Zellwald, Dornbach,
Zellwald Ort, probably Grüntal, the Schwarzburg branch and the shadow yard. It has not been surveyed yet;
a survey is planned for later.

### Laps

The line kilometres grow clockwise round the ring. On the table, 0.1 km is about 507 mm
(`laps.table_mm_per_km`). Swing bridge 1 at the door is crossed twice, one lap apart: by the NBS at
km 18.35 and 29.6, by the ABS at 17.88 and 29.35. So two laps share each side of the hall, and each
station lies in front of the other lap:

| Lap | km | Route |
| --- | --- | --- |
| 0 | 13.4–17.9 | in from room 06 at the upper right, down the right end (Papiermühle 13.9), along the corridor side to the door |
| 1 | 17.9–29.4 | door → left end (Klausenburg 19.6) → **Neustadt** → behind Waldhof (Neustadt Ost) → right end → **Adorf** → door |
| 2 | 29.4–37.2 | door → left end (Feldberg 31.2) → behind Neustadt → **Waldhof** → upper right: out to room 06 and the shadow yard |

`side_by_side` lists what lies next to each other, from the front of the table to the back, at Bf
Neustadt, Waldhof Pbf, Adorf and the curve at the Neustadt end. `alignments` gives two rules read from
the tags: the **test track** runs along Adorf, with ABS km = test-track km + 25.9 (±0.05 km); the
**light rail** runs along the window side at hall x ≈ −6300 mm + 5100 mm × light-rail km.

### Track labels: the key to the lab software

The tables carry the keys of the lab software. Tracks are labelled with their track string number
("Strecke 24") and their track number in the station ("G5"), signals and switches with their names ("N1",
"60"), and km tags stand every 0.1 km. A train position in the lab software is a track string and a
kilometre, so (Strecke, km) ties a place on the table to the digital twin and to the live positions of
the control system. At Waldhof Pbf, tracks G1–G5 are Strecken 10, 11, 12, 13 and 24, with exit signals
N1–N5 and switches 60 and 61 at the kilometres the lab data gives them. `track_labels.strings` says
which track strings belong to which line or station.

### Signal boxes, findings, open questions

Each operating point has its signal box (`interlocking`: the box's name, its type `mechanical`,
`electromechanical`, `relay` (GS II), `relay_spurplan` (GS II Sp), `estw` or `station_computer`), as the
lab software assigns them. `tag_findings` lists km tags that disagree with their neighbours or belong to
another line than their place suggests, and `open_questions` what the next lab session should check.

## Survey joints

`joints` lists, for each pair of neighbouring marker groups, whether the survey could link them. For
each open joint it gives the markers to keep in view when filming it again and about how long to
film. Seven joints are still open: S10–S11, S12–S09, S07–S05, S05–S15, S15–S14, S14–S13 and S13–S01.
S01–S02 is linked, but only to about ±49 mm.
