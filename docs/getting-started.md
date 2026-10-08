# Getting started

The app runs in any current browser (Chrome, Edge, Firefox, Safari) on phones, tablets and PCs. Open it at <https://joernmht.github.io/ARail-EBL/app/>, or locally with `npm start` (then <http://localhost:8000/app/>).

The live camera needs a secure page: https (GitHub Pages) or `localhost`. Photos and videos work everywhere.

![The app in the flyover: the example town on its table modules in front of the lab table at 17:01, with Settings → Simulation (time of day and town)](assets/app-screenshot.jpg)

The app wears the corporate design of the Chair of Railway Operations (TU Dresden): a Türkis app bar with the chair's logo, Noto Sans, Orange for what you are working on (pressed buttons, placing), Rot for disruptions and Dunkelblau boards. It follows the light or dark mode of your device.

## Image sources

The top bar chooses what the app looks at:

| Button | What it does |
| --- | --- |
| **Live camera** | Uses the rear camera (phones) or the default webcam. Keeps the screen awake. |
| **Take photo** | Opens the camera app of a phone; the photo is analysed once at high resolution. |
| **Record video** | Records a video with the phone's camera app and plays it in a loop. |
| **Open file** | A photo or video from the device. |
| **Layouts…** | Loads an example layout (the EBL lab, the synthetic layout or the container terminal) together with its example image. The container terminal has no image: it opens in the flyover. |

Photos are the easiest way to start: detection runs once at full resolution, and objects can be placed precisely. The buttons at the bottom right of the stage:

| Button | What it does |
| --- | --- |
| **Flyover** | A virtual camera instead of the camera image (key F), see below. |
| **Map**, **2.5D** | The simple view of the whole layout in the flyover: from straight above (Shift+S) or tilted (S), see below. Press the button again for the full flyover. |
| **Freeze** | Keeps the current video frame for editing (videos and the live camera only). |
| **Full screen** | The stage alone, e.g. for a projector. |

## The flyover

**Flyover** (button, View panel or key F) replaces the camera image by a virtual camera that flies around the layout. You see the lab floor, the table, its photo from above (the orthophoto in `view.ortho`, if the layout has one), a grid, the marker stickers with their IDs and everything virtual, by day and by night. Video processing pauses meanwhile; press F again to return to the camera image (or video) you had before. The camera position is kept per layout in the browser.

| Input | Mouse and keyboard | Touch |
| --- | --- | --- |
| Turn the view | drag (outside Build and Terminal) | one finger (outside Build and Terminal) |
| Pan | Shift-drag, right-drag or middle-drag; in Build also a drag on empty space; in Terminal any drag | two fingers |
| Zoom | scroll wheel (at the pointer), double-click (outside Build and Terminal) | pinch |
| Rotate | Q, E | twist two fingers |
| Tilt | Page Up, Page Down | |
| Show the whole layout | Home | |

The keys work while the stage has the focus (click on it, or switch the flyover on with F); arrows pan, + and − zoom, and Shift makes arrows, Q/E and Page Up/Down take bigger steps. The buttons at the right of the stage zoom, rotate, switch to the **plan view** (straight down; press it again to tilt back) and show the whole layout.

In Build, everything works as on the camera image, and placed points, the corners of table modules and dragged objects **snap to the grid** (hold Alt/Option to place freely). Placing also works with the keyboard: pick the type in the palette, go back to the stage (Shift+Tab), move the view with the arrow keys and press **Enter** to put a point at the cross in the middle of the view (for a bus line: to pick the stop under the cross). **Build → Table → Table module** extends the tabletop with virtual table modules: drag from one corner to the opposite one, or tap both corners. A table module of the kind *real table* draws the outline of the lab's real table; once there is one, the flyover no longer draws its own light-grey default table around the markers and objects.

The View panel's **Flyover** section has the same switch and camera buttons, the grid spacing (10, 25, 50, 100 or 250 mm), **Snap to the grid**, **Grid in camera view** (shows the grid over the camera image too, and snapping to it there) and **Show markers**.

### The simple view: Map and 2.5D

For running operations quickly, **Map** and **2.5D** (buttons next to Flyover, the View panel, or the keys Shift+S and S) draw the flyover with little detail. Everything on the layout is flat: each object is its footprint in one colour per kind (tables, streets, platforms, tracks, buildings, trees, areas, yard blocks, …), bus lines show their route. Everything that moves is a plain block: trains, buses, cars, people, cranes, containers, wagons, trucks, barges and vans are the outline of each part, extruded from its lowest to its highest point, without windows, doors or wheels. There are no lights and no night, and the orthophoto is left out. Boards and signs stay.

**Map** looks straight down: a map of the layout. **2.5D** tilts the view, so the moving things stand up from the flat layout. All camera controls work as in the flyover (the plan-view button switches between the two), and so do Build (placing, selecting, dragging, snapping) and picking in the Terminal panel. The choice is kept in the browser.

## What you see

The chips at the top left of the stage show the state:

| Chip | Meaning |
| --- | --- |
| *Tracking · 5 markers* | the layout is registered using five markers; *· locked* when the marker map is locked |
| *Markers hidden · holding position* | all markers are hidden for a moment; the last pose is kept for 1.5 s |
| *Markers 7, 9 seen, none known yet* | markers are in view, but none is in the marker map yet (*none in the locked marker map* when it is locked) |
| *Flyover · plan view*, *Grid 50 mm · snap* | in the flyover: the camera and the grid; *Map* or *Simple 2.5D* in the simple view |
| *07:32*, *22:30 · night* | the time of day of the fast clock, *· night* between sunset and sunrise (see [Day and night](day-and-night.md)) |
| *Paused*, *5× time*, *1 disruption*, *Control system · 3 trains*, *Frozen frame*, *Recording* | simulation and recording state |
| *Operations · 5 trains*, *· 1 unit failed* | [rail operations](operations.md): their trains on the way, failed units |
| *Infrastructure · Fri 1 Jan 2027 · 1 fault · 2 out* | [infrastructure](infrastructure.md): the game's date, open faults, staff out at work |

Every stop (platform, bus terminal, bus stop) has a **board** above it: the stop sign (platform number or "H"), the name, the number of people waiting and their average mood, e.g. *Altmarkt · 7 people · 70 %*, and the next events: *Next train in 12 s*, *RE 1 boarding (Track 2)*, *Bus 62 Ring ↺ in 3 min*, or a disruption message such as *Signal failure (4 min left)*. A bus stop on both sides of the street has one board for both sides. Seen from far away (the stop shorter than 60 px on the screen, e.g. in the flyover's overview or on a phone) the board shrinks to a badge with the stop sign and the number of people waiting; zoom in for the full board.

People at stops are coloured by their mood: Türkis = happy, Gelb = so-so, Rot = annoyed. People of the [town simulation](day-and-night.md#colours) are coloured by the purpose of their trip. Buildings look like a white architectural model in greys; at night their windows light up when people are inside.

## Panels

The tabs: **View**, **Build**, a tab for each module that is on (**Terminal**, **Operations**, **Infrastructure**, **Journeys**, **Disruptions**) and **Settings**.

### View

- *Modules*: boxes to click, one per module; each module that is on has its tab. The layout's own modules (the lab example's) add to the base (the table, the town, the streets, which are always there): **Rail operations**, **Infrastructure** and **Journeys** can be combined; **Container terminal** is a layout of its own, marked *alone*: choosing it opens the terminal (in the flyover) and switches the others off, and there the boxes show the lab's modules again, so that clicking the terminal once more, or another module, goes back to the lab. Switching these starts the simulations again; your changes are kept. See [Layers](layout-format.md#layers). **Disruptions** is a module of the app, offered for every layout: it shows the Disruptions tab (switching it off stops the disruptions started there and the scenario). The choice is kept per layout in the browser.
- *Tracking*: markers seen, markers used for the pose, the size of the marker map (and whether it is locked), moving markers in view, the marker type, the reprojection error and the frame rate. With rolling-stock markers also the tags in view and the height they are lifted to (*W1·0, W1·2 in view (lifted to 15 mm)*) and the model wagons (*W1 standing, W3 moving*).
- *Flyover*: see above.
- *Show*: signs and boards, walking trails, marker outlines (key M; markers used for the pose light Türkis, the others Orange), tracks (the `track` objects over the camera image), and the opacity of virtual objects.
- *Camera*: the focal length (estimated automatically; adjust it with − and + if people or buildings lean), loading a [camera calibration](calibration.md).
- *Record*: records the stage as a WebM video.

### Build

The layout editor.

- *Add to the layout*: the palette, in six groups. Pick a type, then tap on the image (or on the table in the flyover). The small text under each type says how it is placed.

  | Group | Types | Placing |
  | --- | --- | --- |
  | Transport | Rail platform, Bus terminal, Street, Bus stop, Bus line | platform: two taps (tap a marker to anchor the end to it); street: points along it, then **Finish**; bus line: tap its stops in order, then **Finish**; the others: one tap |
  | Buildings | Building, Plattenbau, Altbau block, Single-family house, Single-family estate, Office building, School, Supermarket, Workshop / factory | one tap; the estate: its outline, then **Finish** |
  | Scenery | Tree, Forest, Landscape area (and plugin types such as the Windmill) | tree: one tap; forest and area: the outline, then **Finish** |
  | Infrastructure | Track, Label / sign | track: points along the real track, then **Finish**; label: one tap |
  | Table | Table module | drag from one corner to the opposite one, or tap both corners |
  | Terminal | Container yard block, Gantry crane, Truck lane, Quay and fairway, Reach stacker | yard and crane: drag from corner to corner; truck lane and quay: points along it, then **Finish**; reach stacker: one tap (see [Container terminal](container-terminal.md#building-a-terminal-in-build)) |

  While placing, the bar over the stage has **Finish**, **Undo point** and **Cancel**. A point of a street snaps onto the end or corner of another street or onto its centre line, so streets connect (see [Streets, bus lines and road traffic](streets-and-buses.md)). A new object that can be turned gets the direction of the nearest platform (if there is one).
- *Objects*: tap a name or tap the object on the image to select it. Drag a selected object to move it. A platform anchored to markers moves sideways (its offset changes). Table modules are picked at their edges, so that a drag over a table pans the flyover.
- *Selected*: all settings of the object, generated from the object type's parameters, and its problems (e.g. a bus stop away from the streets). **↺ 90°** and **↻ 90°** turn it (keys R and Shift+R: 15° and 90°). **Redraw position** places it again (**Pick the stops again** for a bus line), **Duplicate** puts a copy beside it (a table module right next to it), **Delete** and **Done** do what they say.
- *Layout*: name, model scale, marker size and marker type, **Export layout** (downloads the JSON file), **Import layout**, **Reset to original**.
- *Marker map*: the marker positions (ID, x, y, rotation; status *origin*, *fixed* or *surveyed*).
  - **Keep positions** fixes all positions and **locks** the map: from then on only these markers are used, new markers are ignored, and the HUD says *Tracking · 5 markers · locked*.
  - **Unlock** opens a locked map again: unknown markers are measured when they are seen together with known ones.
  - **Measure again** forgets the positions (and unlocks the map), for after markers were moved.
  - **Moving markers**: the IDs of markers on vehicles, e.g. `40, 41` for container wagons. They are never part of the map nor used for the pose. The app refuses the origin marker, IDs beyond `markers.codes` (they would never be detected) and markers that objects are placed relative to. A marker taken out by mistake gets its position back when you remove it from the list.
  - **Survey a video…**: measures every marker from a video of the whole layout, frame by frame, with a progress bar and a plot of the markers. Afterwards press **Keep positions** and **Export layout**. A locked map is unlocked for the run and locked again if nothing was measured. See the [lab session](lab-session.md).

Changes are kept in the browser (per layout file). Export the layout to share it or to keep it in your repository.

### Settings

Two views: **Simulation** and **Control system**. The tab opens the view chosen last; `#simulate` and `#control` in the app URL open a view (and the URL names the view shown).

**Simulation**

- *Time of day*: the clock (time, day/dawn/dusk/night and the day number), a slider to set the time, the presets **Morning 06:30**, **Noon 12:00**, **Evening 17:00** and **Night 22:30**, the **Fast clock** ratio (1:1 real time … 1:60; 1:12 = one clock hour in five simulated minutes), **Day and night lighting** and **Stop the clock**. See [Day and night](day-and-night.md).
- *Town* (only with the town simulation): how many people there are and where (at home, at work, at school, shopping, on the bus, at stops, away by train), the colours of their trip purposes, and **Colour of people** (town people by purpose and passengers by mood, or everybody by purpose or by mood).
- *Speed*: **Pause**, the speed (simulated time per real time: 1×, 2×, 5×, 10×, 30×) and **Clear passengers** (removes everybody waiting; the town and the cars start afresh).
- *Passenger demand*: more or fewer random passengers (× 0.25 … × 4).
- *Stops*: a departure board for all stops: people waiting, mood, people in and out per minute, the next event, and buttons that send a train or bus of the timetable to a track or bay right away. Stops of bus lines have no such buttons (the lines serve them), nor have the tracks of the rail operations; a bus stop on both sides of the street is listed as *Stop A* and *Stop B*.
- *Rail operations* (on layouts without them): **Switch on the module** (on the lab example) or **Open the example**, and **Add to this layout** (its tab opens, the focus on its heading), see [Rail operations](operations.md).
- *Infrastructure* (on layouts without it): the same, see [Infrastructure](infrastructure.md).
- *Journeys* (on layouts without them): the same, see [Journeys](journeys.md).
- *Container terminal* (on layouts without one): **Switch on the module** (on the lab example) or **Open the example terminal**, and **Add to this layout**, see [Container terminal](container-terminal.md).

**Control system**

Connect to a control-system bridge (WebSocket address), or start the simulated control system, choose how its trains are drawn, and see the trains it reports. See [Control-system interface](control-system-interface.md).

### Terminal

Shown when the layout has a container terminal (the lab example's module **Container terminal**, or **Layouts… → Example: container terminal**; see [Container terminal](container-terminal.md)): trains, trucks and barges, the containers on them and in the yard, and the moves of the cranes and reach stackers.

- The terminal's state, the speed, **Reset terminal** and **Save as start state**.
- *Arrivals*: every train, barge and truck with its state and load, **Call** and **Depart**; for a train or barge at the terminal also **Unload to yard** and **Load from yard**.
- *New arrival*: call a train or a barge, or send a truck (pickup or delivery).
- *Containers*: choose a container, then its place in **Move to** (or a quick button such as **To the yard**) and press **Move**.
- *Crane jobs*: the moves with their state; queued moves can be cancelled.
- *Model wagons* (with rolling-stock markers): the wagons seen by their deck cards, and links to print their cards, one per wagon type.

On the stage, tap a container, then one of its outlined places. In the flyover a drag pans the view in this panel; with the keyboard, move the view so that the cross in the middle lies on the container, press **Enter**, then do the same for the place. Esc cancels the pick.

### Infrastructure

Shown when the layout has an [infrastructure simulation](infrastructure.md) (the lab example's module **Infrastructure**, View → Modules): the station on the layout as part of an infrastructure district, a game for teams of students in roles.

- **Your role** (asset manager, ALV, maintenance dispatcher, planner, construction supervision, funding authority, instructor) decides what may be done; **Run to the next decision** and **Run to the year's end** run fast.
- **Overview**, **Line map** (the network by km; GeoJSON for QGIS), **Assets** (the register with each asset's record and the inspection plan), **Decisions**, **Projects** (through the HOAI phases), **Staff** (shifts, on call, drone pilots, the level crossing plant), **Results** (per year, the score; saving and loading a game).
- On the layout the assets are coloured by their known condition (or the last check), faults pulse, vans drive out from the maintenance base and drones fly.

### Operations

Shown when the layout has [rail operations](operations.md) (the lab example's module **Rail operations**, View → Modules): units with maintenance and failures, the workshop and the parties in charge of maintenance, crews with duties, and the penalties between the parties.

- **Today**: key figures of the day, what happened, and short-term changes (a driver calls in sick, a unit breaks down or gets a defect).
- **Fleet**: every unit, where it is, its next maintenance and its defects.
- **Workshop**: who does which function of the entity in charge of maintenance (ECM), the workshop's tracks and jobs.
- **Crews**: today's duties, their drivers and states; a driver calls in sick.
- **Penalties**: per contract, the net per party and the largest causes.
- **Compare**: setups under a stress test over days or weeks, with the key figures, cancelled trains per day, the penalties per party and a CSV file.

**Wide panel** (large screens) makes the panel wider for the tables.

### Journeys

Shown when the layout has [journeys](journeys.md) (the lab example's module **Journeys**, View → Modules): travellers made one by one, for an exercise.

- **New traveller**: a name, where it starts and where it goes (a building or a station beyond the layout), when it leaves and its transfer time; **Find travel plans** lists plans with walks, buses and trains and the time for each change; **Choose** makes the traveller.
- **Travellers**: what each one is doing, its planned and expected arrival, **Show** (the flyover's camera follows it), **Start again**, **Remove**, and its plan and log.
- **Results**: planned and real arrivals, delays and missed trains; **Download results (CSV)**, **Start all again**, **Remove all**.
- *Generated people too*: the town's residents and other passengers back on (the module switches them off).

**Wide panel** (large screens) makes the panel wider for the results.

### Disruptions

Shown with the module **Disruptions** (View → Modules; a link with `#disrupt` or `?scenario=` switches it on): start a disruption (kind, where, duration and options), see the active ones and stop them, and play scenarios stored in the layout. See [Disruptions and scenarios](disruptions-and-scenarios.md).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | pause / resume the simulation |
| 1 … 9 | send a vehicle to the stop with that position on the Stops board of Settings → Simulation (stops served by bus lines or by the rail operations say so) |
| M | marker outlines on/off |
| F | flyover on/off |
| S, Shift+S | the simple view tilted (2.5D) or from above (map); again: the full flyover |
| ← ↑ → ↓, + −, Q E, Page Up/Down, Home | flyover: pan, zoom, rotate, tilt, show the whole layout (while the stage has the focus; Shift: bigger steps) |
| Enter | flyover, while placing (Build panel, the stage has the focus): put a point at the cross in the middle of the view; in the Terminal panel: pick the container or place at the cross |
| R, Shift+R | turn the selected object by 15° or 90° counter-clockwise (Build panel) |
| Delete, Backspace | delete the selected object (Build panel) |
| Alt (Option) | hold while placing or dragging: no snapping to the grid or to streets |
| Esc | cancel placing or a pick in the Terminal panel, or deselect |
| ← → | switch panels (when a panel tab has focus) |

## URL options

Parameters can be combined, e.g. `app/?layout=../layouts/synthetic-demo.json&scenario=delay#disrupt`.

| Parameter | Effect |
| --- | --- |
| `layout=<url>` | load a layout file (relative to the app); without it the app opens the last layout, or the EBL example |
| `image=<url>` | load this image instead of the layout's example image |
| `camera=1` | start the live camera |
| `feed=<ws url>` | connect to a bridge, e.g. `ws://localhost:8765/feed` |
| `mock=1` | start the simulated control system |
| `scenario=<id>` | play a scenario of the layout (switches the module Disruptions on) |
| `layers=<id>,<id>` | switch on these modules of the layout, e.g. `app/?layout=../layouts/ebl-lab.json&layers=operations,journeys#journeys` (a module that is a layout of its own, such as `terminal`, opens that layout) |
| `#view`, `#build`, `#terminal`, `#ops`, `#infra`, `#journeys`, `#disrupt`, `#settings` | open a tab, e.g. `app/?layout=../layouts/container-terminal.json#terminal` (`#terminal`, `#ops`, `#infra` and `#journeys` where the layout has them; `#disrupt` switches the module Disruptions on) |
| `#simulate`, `#control` | open Settings with its view Simulation or Control system |

## Tips for good tracking

- Look at the layout from above at an angle (30–70° from horizontal). Straight from above works too, but the focal length cannot be estimated then.
- Several markers in view make the pose steadier; three or more spread over the image also let ARail estimate the focal length.
- Markers must be at least about 20 pixels large in the image. Get closer, use a higher resolution, or print larger markers (see [Setting up a lab](lab-setup.md)).
- Avoid glare on the markers and motion blur (hold still for a moment, or use a stand).
- Once all markers are measured, lock the marker map (**Keep positions**): misread and moved markers can then no longer disturb the pose.
