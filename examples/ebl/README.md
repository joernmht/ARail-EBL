# The EBL layout: operational topology

`topology.json` describes the layout of the Railway Operations Laboratory (EBL, TU Dresden) as an
operational network: the operating points, the lines between them in kilometre order, the light rail,
the two swing bridges, and where each part sits on the table, using the marker groups S01–S15 of
the survey of 9 October 2026. It is meant as the base of a digital twin. The facts come from the
lab's own data (lines, operating points, light-rail stops) and from the signs and kilometre tags in
the survey photos. They are written in this file's own format, and none of the lab software's files are
copied. Format: `ebl-topology/0.1`.

## The network

Kilometres are the **virtual line kilometres** of the lab's control software, not table metres. The
lines run several times around the room, so one lap of the ring is about 11 km.

| Line | Route (km) |
| --- | --- |
| NBS, double track | Shadow yard → swing bridge 1 (18.4) → **Neustadt** (20.5–22.4) → crossover Neustadt Ost (24.8–25.1) → swing bridge 1 (29.6) → **Waldhof** (33.3–36.6) → shadow yard. Line ends: Klotzsche (continues in the BEST simulation) and Straßburg |
| ABS, double track | Shadow yard (Eisenberg) → swing bridge 2 (5.5) → **Zellwald** (9.1–10.9) → halt and block post Papiermühle (13.9) → swing bridge 1 (17.9) → block post Klausenburg (19.6) → **Adorf** (26.2–28.0) → swing bridge 1 (29.4) → **Waldhof** (33.9–36.3) → shadow yard (Talheim) |
| Branch line, single track | **Adorf** (28.8) → swing bridge 1 (29.4) → halt and block post Feldberg (31.2) → halt Grüntal (37.1) → swing bridge 2 (43.7) → **Dornbach** (44.2–45.8, sawmill siding 42.6–43.2) → halt Zellwald Ort (49.3) → swing bridge 2 (51.7) → **Zellwald** (53.6) |
| Schwarzburg branch | Shadow yard → **Schwarzburg** (28.8–29.3) → halt and block post Crottendorf (33.2–33.8) → Grüntal (37.1); spur Crottendorf → halt Moorhof (35.7) → workshop |
| Test track | Two tracks, 0–2.6 km, not connected to the other lines (ETCS tests) |

**Not on the table:** the **shadow yard** (Schattenbahnhof) is real, but it is hidden from view. It
stands in for the line ends Straßburg, Klotzsche, Eisenberg and Talheim. The stations Klotzsche West
and Ost, Flughafen, Grenzstraße, Ottendorf-Okrilla, Radeberg, Arnsdorf, Großröhrsdorf, Dürrröhrsdorf,
Bischofswerda, Seitschen and Neukirch (Lausitz) exist only in the BEST interlocking simulation, which
continues the NBS beyond Neustadt.

**Light rail (Stadtbahn)** on the upper narrow deck, with its own track: Pirna (0.5) – Heidenau (1.5) –
Hauptbahnhof (2.5, depot) – Freiberger Straße (3.3) – Mitte (4.2), then on one branch Radebeul – Coswig – Sörnewitz –
Meißen – Triebischtal (10.4), and on the other Freital – Tharandt (6.0). The yellow-framed table signs belong to
these stops, not to the stations on the lower table.

## Where it is on the table

Ring order of the lower table, with its marker groups: the door with swing bridge 1 (**S15**) →
straight tables along the inner wall → hairpin by the pillar with the block posts Klausenburg and
Feldberg (**S14**) → curve (**S13**) → **Neustadt** (S01–S04) → **Waldhof** south throat, passenger
station, north throat and goods yard (S10–S12) → corner by Hp Papiermühle (**S09**), where the lines
leave for room 06 and the shadow yard → **Adorf** with the test track (S06, S08, S07, S05) → S15.
On the upper deck above them run Pirna (S01–S02), Heidenau (S03–S04), Hauptbahnhof (S10),
Freiberger Straße (S11), Mitte and Radebeul (S12).

`km_tags_by_group` lists the kilometre tags read on the table, with their position in the frame of
their marker group (mm; light-rail kilometres start with `SB`). These tags tie line kilometres to table positions.

**Room 06** is behind swing bridge 2. It holds Zellwald, Dornbach, Zellwald Ort, probably Grüntal,
the Schwarzburg branch and the shadow yard. It has not been surveyed yet; a survey is planned for later.

## Survey joints

`joints` lists, for each pair of neighbouring marker groups, whether the survey could link them. For
each open joint it gives the markers to keep in view when filming it again and about how long to
film. Seven joints are still open: S10–S11, S12–S09, S07–S05, S05–S15, S15–S14, S14–S13 and S13–S01.
S01–S02 is linked, but only to about ±49 mm.
