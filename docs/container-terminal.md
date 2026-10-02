# Container terminal

ARail can run a small **intermodal terminal** (a KV terminal) on the layout: container trains,
trucks and barges come and go, and a rail-mounted **gantry crane** and a **reach stacker** move
containers between them and the yard. You choose which container goes where, in the **Terminal**
panel or by tapping on the stage; scenarios can do the same. **Model wagons** on the real layout
take part too: each carries a printed **deck card** with small tags, so ARail knows which wagon it
is and where it stands, and draws its containers on it.

The terminal is a simulation (`{"type": "terminal"}` in the layout's `simulations`). Its
infrastructure (yard blocks, cranes, the truck lane, the quay, reach stackers) consists of ordinary
objects that you place in Build; the loading tracks are ordinary `track` objects.

## The example

**Layouts… → Example: container terminal** (or
`app/?layout=../layouts/container-terminal.json#terminal`) opens
[`web/layouts/container-terminal.json`](../web/layouts/container-terminal.json) in the flyover:

- a gantry crane (100 m runway) over two loading tracks, the truck lane and yard **Block A** (12 bays × 4 rows × 3 tiers);
- **Block B** (4 × 4 × 2) beyond the crane, served by the reach stacker;
- a barge berth with the inland barge **MS Elbe 7** (5 bays × 3 rows × 2 tiers);
- train **KT 41 Hamburg** at loading track 1, train **KT 52 Duisburg** away (it comes on loading track 2 when called);
- four model wagons W1 to W4 for deck cards (two Sgns, one Sggrss, one Lgns);
- the scenario **Morning shift**: KT 52 arrives, trucks collect and deliver, the crane works train, barge and yard.

Everything stands on two table modules: the terminal table and a small module where the fairway
leaves it. The example has no camera image; its four markers lie at the corners of a
1500 × 820 mm area, so you can print them and look at the terminal over a real table too.

## What the terminal knows

### Containers, places and stacks

Containers are 20 ft, 40 ft or 45 ft long, optionally *high cube* (2.90 m instead of 2.59 m
high). Their ids are owner codes with a serial number and a check digit, e.g. `ARLU 100001 9`
(ISO 6346; the validation reports a wrong check digit).

Every *carrier* has places in a grid: **bays** along it (one 20 ft position each, the container
spots of a wagon), **rows** across it and **tiers** on top of each other. A 40 ft or 45 ft
container takes two bays; its place is given by its first bay. The panel counts from 1 (*bay 1*);
the layout file counts from 0. Bay 1 of a wagon is at its A end.

| Carrier | Bays × rows × tiers | Takes |
| --- | --- | --- |
| Sgns (60 ft), `sgns60` | 3 × 1 × 1 | 20 ft in every bay; 40 ft on bays 1–2 or 2–3 |
| Lgns (40 ft), `lgns40` | 2 × 1 × 1 | two 20 ft or one 40 ft |
| Sggrss (80 ft), `sggrss80` | 4 × 1 × 1 | 20 ft in every bay; 40 ft on bays 1–2 or 3–4 (not across the joint) |
| Truck (40 ft chassis) | 2 × 1 × 1 | 20, 40 or 45 ft |
| Yard block | bays of 6.9 m × rows of 2.9 m, as many as fit; 1–5 tiers | 20, 40 or 45 ft |
| Inland barge | (length − 16 m) / 6.9 m bays (rounded down) × 3 rows × 1–3 tiers | 20, 40 or 45 ft |

Wagons carry no 45 ft containers. Stacks follow the span below: a 20 ft container stands on a
20 ft container, a 40 ft or 45 ft one on a 40 ft or 45 ft one. A container with another one on
top cannot be lifted: the terminal says *Blocked by … on top: move that first*.

### Cranes and reach stackers

A **gantry crane** runs on two rails. It reaches every place between its rails and its *outreach*
beyond each rail, except the last 8 m at each end of its runway (half its portal). It lifts to its
*lifting height* and travels at a height that clears the highest stack or vehicle it passes over.
A move runs through the phases *raising*, *moving to the container*, *lowering*, *locking*,
*lifting*, *carrying*, *setting down* and *releasing*.

A **reach stacker** drives to the container, lifts it with its boom and drives it to the target. It
serves wagons, trucks and yard blocks (not barges), stacks up to its *Stacks up to* tier, and
goes back to its parking place after 20 s without work.

Each move is given to one machine when it is requested: a crane that reaches both places (the one
with the fewest moves waiting), otherwise the reach stacker nearest to the container. A machine
does one move at a time. When it is free, it takes the oldest of its moves whose carriers are both
there and stand still; the Crane jobs table says what the others wait for (*waiting for KT 52
Duisburg · wagon 1*).

### Visits

| Visit | Comes and goes |
| --- | --- |
| **Train** | A locomotive (19 m) with its wagons drives along its loading track (at most 25 km/h) to its stop, and leaves at the far end. A train called again brings back what is still on its wagons. |
| **Truck** | Comes to the gate, drives in on the passing lane, turns into the loading lane and stops at a free truck position. A *pickup* truck comes empty and leaves 3 s after it got a container; a *delivery* truck brings one (random size, or the size you choose) and leaves 3 s after it was emptied. When all positions are taken, trucks wait at the gate. A truck that leaves takes its container out of the terminal. |
| **Barge** | Sails along the fairway and berths with its bow at the end of the quay; it leaves astern. |

A train or barge with a crane working on it cannot leave. One with queued moves leaves only when
you force it (**Depart anyway**), which cancels those moves.

## Markers on rolling stock

The layout's markers lie flat on the table and give the camera pose. Model wagons need markers
too, but of a different kind: they move, they stand about 15 mm above the table, and they must
never be mistaken for a layout marker (or the other way round). So rolling stock gets a **marker
family of its own**, set in `markers.rolling` of the layout:

```json
"markers": {
  "dictionary": "ARUCO", "size_mm": 30, "codes": 50,
  "rolling": { "dictionary": "APRILTAG_36h11", "codes": 64, "size_mm": 20, "height_mm": 15, "stride": 4, "max_bit_errors": 3 }
}
```

### Why a family of its own

| | Layout markers | Rolling-stock tags |
| --- | --- | --- |
| Family | as set in `markers.dictionary` (ArUco Original in the EBL), 30 mm | **AprilTag 36h11**, 20 mm |
| Where | flat on the layout | on a deck card on each model wagon |
| Used for | the marker map and the camera pose | which wagon it is and where it stands, at deck height |
| IDs | `0 … codes − 1` of the layout's family | `0 … codes − 1` of AprilTag 36h11 (64 codes by default), a separate range |
| Bit errors corrected | as many as safe for the number of codes | at most `max_bit_errors` (3) |

- **Two ID ranges.** Tag 0 of a wagon and marker 0 at the table corner are different things. The
  layout's `codes` and `moving` are not involved.
- **AprilTag 36h11** is the only supported family that is never read as ArUco Original, and the
  other way round: measured for ARail, there was not a single cross-reading in either direction.
  `arail-survey` with a fixed marker type does not read the tags at all.
- **Each square is read once.** The detector reads both families in the same pass. A square that
  decodes in both keeps the reading with fewer bit errors (relative to the code length); on a tie
  it is a layout marker.
- **Size check.** Lifted to its height, a tag must measure its `size_mm` within ±15 %; otherwise
  it is ignored.
- **No vote.** While the layout's marker type is detected automatically, the tags never take part
  in the choice. Still, set the layout's marker type explicitly when you use rolling-stock tags:
  the validation asks for it.

For rolling stock on an ArUco Original layout, the validation reports the ArUco 4x4 and MIP 36h12
families (they are misread as ArUco Original), and it reports the layout's own family. The layout
still loads, but use AprilTag 36h11.

### One tag per container spot

Each wagon has a **number** (W1, W2, …) and one tag on every container spot. The spots are
numbered from 0 at the **A end** of the wagon: spot 0 is the 20 ft position at the A end (bay 1
in the panel). With `stride` IDs per wagon (4 by default, enough for every wagon type):

```
tag ID = (wagon − 1) × stride + spot          wagon = floor(ID / stride) + 1, spot = ID mod stride
```

A train therefore needs one tag per container spot: 3 per Sgns, 2 per Lgns, 4 per Sggrss. The
example's four model wagons:

| Wagon | Type | Spots | Tag IDs | Unused IDs |
| --- | --- | --- | --- | --- |
| W1 | Sgns (60 ft) | 3 | 0, 1, 2 | 3 |
| W2 | Sgns (60 ft) | 3 | 4, 5, 6 | 7 |
| W3 | Sggrss (80 ft) | 4 | 8, 9, 10, 11 | |
| W4 | Lgns (40 ft) | 2 | 12, 13 | 14, 15 |

Tag 9 is wagon floor(9 / 4) + 1 = 3, spot 9 mod 4 = 1: the second spot of W3 from its A end. With
64 codes there are wagons W1 to W16; AprilTag 36h11 has 587 IDs, enough for W146. The wagon's
type comes from the terminal's `rolling_stock` list (`default_wagon` for numbers that are not
listed), so a wagon keeps its IDs when you change its type.

Every tag lies with its printed x axis (from its left edge to its right edge) pointing to the A
end. **Any one visible tag gives the pose of the whole wagon**: its spot is known, so the wagon's
centre is that far behind it. Two or more visible tags are combined, and the line through their
centres gives a more precise heading.

### Printing deck cards

Open the [marker sheet page](https://joernmht.github.io/ARail-EBL/markers/?kind=rolling) with
`?kind=rolling`, or choose **Print → Deck cards for model wagons**:

| Field | Example | Meaning |
| --- | --- | --- |
| Wagon numbers | `1-2` | the numbers, e.g. `1-6` or `1, 3, 8-10` |
| Wagon type | Sgns (60 ft) | one type per print: print each type separately |
| IDs per wagon | 4 | `markers.rolling.stride` |
| Tag size | 20 mm | `markers.rolling.size_mm`, the black square |
| Scale | H0 (1:87) | the scale of the wagons |

For the example: W1–W2 as Sgns, W3 as Sggrss and W4 as Lgns, three prints. Then

1. print at 100 % ("actual size") and check the 100 mm bar with a ruler;
2. cut each card out along its grey outline. The arrow **A ▶** beside the card points to the A
   end (spot 0); the label below it, e.g. *W3 · Sggrss (80 ft) · IDs 8–11*, says which wagon it is for;
3. lay or glue the card on the container spigots, centred on the wagon, with the arrow's end at
   the wagon's A end. Mark the A end on the wagon, so the card goes back the same way round.

A card is as wide as a container (28.0 mm in H0), and its tags sit exactly at the spot centres
(70.1 mm apart on an Sgns). Its length: 165 mm for an Sgns, 95 mm for an Lgns, 247 mm for an
Sggrss (printed in landscape). Labels and the arrow stay outside the card, so the white margin
around each tag stays empty. The deck is free for the card: real model containers would hide the
tags, so the containers on model wagons are virtual.

| Scale | Card width | Largest tag that fits |
| --- | --- | --- |
| H0 (1:87) | 28.0 mm | 23 mm |
| TT (1:120) | 20.3 mm | 15 mm |
| N (1:160) | 15.2 mm | 10 mm |

### Measuring the height

The tags are found on the plane at their height above the layout, not on the table: projected onto
the table, a tag 15 mm high would appear more than 10 mm farther from the camera. Measure the
height once per wagon type:

1. Put the wagon with its card on a straight piece of track.
2. Measure from the surface the layout markers lie on to the top of the card, e.g. with a steel
   ruler standing on the table or the depth gauge of a caliper. In H0 it is typically 15 to 18 mm:
   the deck of an Sgns is 13.3 mm above the rail top.
3. Enter it as `markers.rolling.height_mm` (default 15). A wagon whose deck is higher or lower
   gets its own `height_mm` in the terminal's `rolling_stock` list.

An error of 1 mm in the height moves the wagon by about 1 mm on the layout. To check: take a photo
from a low angle (about 30°), switch to the flyover (F) and look at the wagon. It should stand on
its track. If it appears shifted away from where the camera stood, the height is too low; towards
it, too high. The View panel shows the height the tags are lifted to.

Do this check on a piece of track that has no `track` object yet, e.g. before you draw the loading
tracks: a wagon within 8 mm of a `track` object is snapped onto it, and that hides an error of a
few millimetres. Or look at the wagon from two opposite sides, again with no `track` object
nearby: with the right height, it stands in the same place in both photos.

### Camera distance

A 20 mm tag has cells of 2.5 mm, against 4.3 mm for a 30 mm ArUco Original marker. With 1280×720
video, 20 mm tags are read up to about **0.8 m** from the camera (23 mm tags somewhat farther),
while the layout markers reach 1.4 m. Photos are analysed at up to 2000 pixels and reach further.
While the layout has rolling-stock markers, the app analyses video at 1280 pixels or more. If
wagons are not found, get closer or print the largest tags that fit (23 mm in H0, and set
`size_mm` to match).

### When tags are hidden

- **Some tags hidden** (a hand, the crane's spreader, the edge of the picture): one visible tag is
  enough. A tag that disagrees with the others by more than 6 mm is dropped.
- **All tags hidden** for a moment: the wagon is *held* where it was, for 4 s when it stood still
  (0.5 s when it was moving). A held wagon is still available: a crane goes on working on it.
- **Hidden for longer**: the wagon is *lost*. Over the camera image it is drawn as a dashed outline
  with faint containers and the label *W3 not visible*; moves to or from it wait. Its containers
  stay on it (they belong to W3, not to a position) and come back when it is seen again
  (events `terminal.wagon.lost` and `terminal.wagon.seen`).
- **Standing and moving**: a wagon counts as *standing* when it moved less than 3 mm/s over 1 s
  (at once in a photo). Cranes and reach stackers only lift from or set down on a standing or held
  wagon. A wagon within 8 mm and 15° of a `track` object is put on its centre line, so draw the
  real loading tracks as tracks.
- **Picked up and put down elsewhere** (more than 30 mm away): the wagon starts afresh at its new
  place instead of gliding there.
- **Another image source** (a new photo, the live camera): all model wagons are lost until their
  tags are seen again.

The flyover analyses no video: model wagons stay where they were last seen and are drawn as solid
wagons, with their deck card and tags.

### One tag per wagon

You can also put a tag only on spot 0 of each wagon: cut the deck card behind its first tag (or
cover the others). No setting changes: the IDs stay the same (W1 = 0, W2 = 4, …), and the panel
shows *1/3* tags for an Sgns. One tag gives the heading less precisely (the far container spot
of an Sgns moves by about 2.5 mm per degree, the far end of the wagon by about 3 mm), and a hand over that single tag hides the wagon.
One tag per spot is the better choice where wagons are handled often.

### Surveying with tagged wagons on the layout

The tags never enter the marker map. Still, set `markers.dictionary` to the layout's marker type
(not `"auto"`) before you survey; the validation reports *choose the layout's marker type (not
"auto") when rolling-stock markers are used*. Or take the tagged wagons off the layout while you
film the survey video.

## The Terminal tab, step by step

The **Terminal** tab (after Simulate; `#terminal` in the app URL) runs the terminal. On a layout
without one it offers **Open the example terminal** and **Add a container terminal to this layout**.

1. **Look at the state.** The heading is the terminal's name, with a status line (moves waiting,
   what the crane is doing), the speed (1×, 2×, 5×, 10×, 30×), **Reset terminal** (back to the start
   state) and **Save as start state**.
2. **Arrivals.** A card per train, barge and truck: its state (*away*, *approaching Loading track
   2*, *at Loading track 1*, *at the gate*, *at position 2*, *at the quay*, *departing*), how full it
   is (TEU used of its capacity) and **Call** or **Depart**. A train or barge at the terminal also
   has **Unload to yard** and **Load from yard**: they queue a move for every container that can go.
   When a departure is refused because moves are waiting, **Depart anyway** cancels them.
3. **New arrival.** Call a new train (loading track, wagon type, 1–6 wagons, empty or with random
   containers), a barge (quay), or send a truck (*pickup* or *delivery*, any size or 20, 40, 45 ft).
4. **Choose a container.** The Containers list is grouped by carrier (filter: trains, model wagons,
   barges, trucks, yards), e.g. *ARLU 100001 9 · 40 ft HC · bay 1-2*. Choose one; choosing it again
   deselects it.
5. **Choose where it goes.** **Move to** lists every free place a machine can serve, by carrier;
   carriers that cannot take it are listed with the reason (*Lgns (40 ft) takes no 45 ft
   containers*). The quick buttons **To the yard**, **To a truck**, **To a train** and **To the
   barge** take the first free place of that kind. Press **Move**.
6. **Watch it.** Crane jobs lists the last moves: the container, from → to, the machine and the
   state (*queued*, *waiting for …*, the crane's phase, *done*, *failed: …*). A move that has not
   locked its container yet can be cancelled.
7. **Model wagons** (with `markers.rolling` only): each wagon with its type, the tags seen (*2/3*),
   its state and its containers, and a link to print deck cards.

**On the stage.** In the Terminal tab a tap on a container chooses it, and its possible places are
outlined; a tap on an outlined place (or on another container, or on a carrier) queues the move:
*Move M4 queued: Portal crane 1, from KT 41 Hamburg · wagon 1 to Block A · bay 3 · row 1 ·
tier 1*. Esc or **Cancel** stops the pick. This works over the camera image and in the flyover. In the flyover
a drag pans the view in this tab; with the keyboard, move the view so that the cross in the middle
lies on a container and press **Enter**, then the same for the place. Over the camera image the
empty spots of model wagons are outlined while the tab is open.

**Save as start state** makes the current containers, trains and barges the layout's start state
(saved in the browser like every change; **Export layout** to keep it). Moves in progress, trucks
and the yard fill are not saved: the fill is replaced by the containers it put there.

## Building a terminal in Build

The palette group **Terminal** has five types:

| Type | Placing | Settings |
| --- | --- | --- |
| Container yard block | drag from corner to corner: the length runs along the bays (6.9 m each), the depth across the rows (2.9 m each) | Length (bays), Depth (rows), Rotation, Stack height (1–5) |
| Gantry crane | drag over the area between its rails: the rails run along the rectangle's length | Runway length, Span, Rotation, Outreach (beyond each rail), Lifting height, Speed factor |
| Truck lane | points in the driving direction, the first point is the entry, then **Finish** | Truck positions (1–6, evenly spaced around the middle), Passing lane (left or right, seen in the driving direction) |
| Quay and fairway | points along the middle of the fairway, from where barges come to where the bow berths, then **Finish** | Berth length, Fairway width, Quay wall side (left or right, seen in the sailing direction) |
| Reach stacker | one tap at its parking place | Rotation, Stacks up to (1–4), Speed factor |

Loading tracks are **Infrastructure → Track**, drawn along the real track (or a virtual one in the
flyover). Cranes and quays are picked at their edges unless selected, so the yard and the tracks
under them stay selectable. Then:

1. Open the Terminal tab and press **Add a container terminal to this layout**.
2. Call trains (choose the loading track), barges and trucks with **New arrival**, and move
   containers into the yard.
3. **Save as start state**, then **Export layout**. Fine-tune the result in the layout file (below):
   train names, stop positions, the wagon types of your model wagons, the yard fill.

Every place a move uses must lie within a crane's reach or be served by a reach stacker; otherwise
the move is refused with *No crane or reach stacker can move it from … to …*. The infrastructure
can be changed at any time: a moved or resized crane keeps what it is doing, a deleted crane or
reach stacker takes its moves with it (they are cancelled), and the containers of a yard cell
that disappears leave the terminal.

## Layout file

The terminal is an entry of the layout's `simulations` (every key except `type` is optional):

```json
{
  "type": "terminal",
  "name": "KV terminal",
  "default_wagon": "sgns60",
  "rolling_stock": [ { "number": 1, "type": "sgns60", "name": "Sgns 1", "height_mm": 15 } ],
  "trains": [ { "id": "KT41", "name": "KT 41 Hamburg", "track": "track-1", "direction": 1, "stop_mm": 1597,
                "start": "positioned", "wagons": ["sgns60", "sgns60", "sggrss80"] } ],
  "barges": [ { "id": "BG1", "name": "MS Elbe 7", "quay": "quay-1", "length_m": 55, "tiers": 2, "start": "away" } ],
  "trucks": { "lane": "lane-1" },
  "containers": [ { "id": "ARLU 100001 9", "size": "40", "high": true, "at": { "carrier": "KT41/1", "bay": 0 } } ],
  "fill": { "yard-a": 0.3 }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | `"Container terminal"` | shown in the Terminal tab |
| `default_wagon` | `"sgns60"` | type of trains' wagons and of model wagons that are not listed: `sgns60`, `lgns40` or `sggrss80` |
| `rolling_stock` | `[]` | model wagons: `number` (from 1), `type`, `name` (default `W<number>`), `height_mm` (default `markers.rolling.height_mm`) |
| `trains` | `[]` | `id`, `name`, `track` (id of a `track` object), `direction` (1: from the track's first point to its last, −1: the other way), `stop_mm` (the head's distance from the entry end; default: the wagons' middle at the track's middle), `start` (`"away"`, the default, or `"positioned"`: at its stop when the layout is loaded), `wagons` (types from the head; default three of `default_wagon`) |
| `barges` | `[]` | `id`, `name`, `quay` (id of a `quay` object), `length_m` (25–110, default 55), `tiers` (1–3, default 2), `start` |
| `trucks.lane` | the first truck lane | id of the `truck-lane` object |
| `containers` | `[]` | the start state: `id`, `size` (`"20"`, `"40"`, `"45"`), `high`, `colour`, `label`, `at` (`carrier`, `bay`, `row` and `tier` from 0; for 40 and 45 ft the first bay) |
| `fill` | `{}` | yard id → share (0–1) of empty stacks filled with random containers, the same for the same layout every time |

Carrier ids in `at.carrier`: `<train id>/<k>` for a train's wagon k (from 1, counted from the
head), the barge id, the yard object's id, and `W<number>` for model wagons. Visit ids must be
unique, contain no `/` and must not look like `W1` or `T1` (reserved for model wagons and trucks).
Only one terminal per layout.

The infrastructure objects (`container-yard`, `gantry-crane`, `truck-lane`, `quay`,
`reach-stacker`) are described in the [layout file format](layout-format.md#container-yard-container-yard-block),
together with [`markers.rolling`](layout-format.md#markersrolling) and `view.start`
(`"view": {"start": "flyover"}` opens the layout in the flyover, as the example does).

## Scenario requests

Scenarios drive the terminal with `emit` steps (see [Disruptions and scenarios](disruptions-and-scenarios.md#scenarios)):

```json
{ "at": 0, "emit": { "name": "terminal.request.call", "payload": { "visit": "KT52" } } },
{ "at": 5, "emit": { "name": "terminal.request.truck", "payload": { "purpose": "pickup" } } },
{ "at": 6, "emit": { "name": "terminal.request.move", "payload": { "container": "ARLU 100002 4", "to": { "kind": "truck" } } } },
{ "at": 8, "emit": { "name": "terminal.request.move", "payload": { "container": "ARLU 100001 9", "to": { "carrier": "yard-a" } } } },
{ "at": 9, "emit": { "name": "terminal.request.unload", "payload": { "visit": "BG1", "to": "yard" } } }
```

| Request | Payload | Does |
| --- | --- | --- |
| `terminal.request.call` | `{visit}` | calls a train or barge |
| `terminal.request.depart` | `{visit, force?}` | sends a visit away; `force` cancels its queued moves |
| `terminal.request.move` | `{container, to}` | queues a move; `to` is a place `{carrier, bay, row?, tier?}` (no tier: on top of the stack), any free place of a carrier `{carrier}`, or of a kind `{kind}`: `wagon` (or `train`), `truck`, `barge`, `yard` |
| `terminal.request.truck` | `{purpose?, size?}` | sends a truck: `pickup` (default) or `delivery`, size `"20"`, `"40"`, `"45"` |
| `terminal.request.train` | `{track, wagons?, load?, name?}` | a new train on that track; `load` `"empty"` or `"random"` |
| `terminal.request.barge` | `{quay, length_m?, load?, name?}` | a new barge at that quay |
| `terminal.request.unload` | `{visit, to?}` | moves for every container of the visit that can be lifted, to carriers of kind `to` (default `yard`) |
| `terminal.request.load` | `{visit, from?}` | fills the visit's free places from carriers of kind `from` (default `yard`) |
| `terminal.request.reset` | `{}` | back to the start state |

Moves requested by scenarios have `source: "scenario"`. A request that is refused shows its
reason as a scenario message, e.g. *Terminal: KT 52 Duisburg is already here*.

## Events

The terminal reports on `world.events` (every payload also has `terminal`):

| Event | Payload |
| --- | --- |
| `terminal.visit.arriving`, `arrived`, `departing`, `departed` | `{visit}` |
| `terminal.move.queued`, `started`, `finished`, `failed`, `cancelled` | `{move}` |
| `terminal.container.moved` | `{container, from, to, move}` |
| `terminal.container.added` | `{container, carrier}` (delivery trucks, random loads) |
| `terminal.container.left` | `{container, visit, reason}` (`"truck"`: left on a truck; `"place removed"`: its yard cell or carrier was removed) |
| `terminal.wagon.seen`, `terminal.wagon.lost` | `{carrier}` (model wagons) |
| `terminal.reset` | `{}` |

For plugins: `terminalOf(world)` returns the terminal, with `request(containerId, to)`,
`targets(containerId)`, `call`, `depart`, `sendTruck`, `addTrain`, `addBarge`, `unload`, `load`,
`cancel` and the state (`inventory`, `visits`, `handlers`, `moves`); see
[Extending ARail](extending.md#the-container-terminal).

## Limits

- **One crane per runway.** Cranes do not know about each other: two cranes on the same rails
  would pass through each other.
- **No rehandles.** A container under another one is refused until the one on top is moved;
  the terminal never moves a container out of the way by itself.
- **Same span in stacks.** 20 ft on 20 ft, 40 or 45 ft on 40 or 45 ft; no 40 ft on two 20 ft.
- **Trucks have their own lane.** They do not use the town's streets and road network.
- **Barges only.** No sea-going ships or ship-to-shore cranes.
- **Trains are the terminal's.** They are not timetable trains or control-system trains, and
  they do not stop at platforms. The control system cannot report wagons yet.
- **Model wagons need a camera.** In the flyover they stay where they were last seen.
- One terminal per layout.
