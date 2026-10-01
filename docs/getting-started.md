# Getting started

The app runs in any current browser (Chrome, Edge, Firefox, Safari) on phones, tablets and PCs. Open it at <https://joernmht.github.io/ARail-EBL/app/>, or locally with `npm start` (then <http://localhost:8000/app/>).

The live camera needs a secure page: https (GitHub Pages) or `localhost`. Photos and videos work everywhere.

![The app with the lab photo, trains at both platforms and the Simulate panel](assets/app-screenshot.jpg)

The app wears the corporate design of the Chair of Railway Operations (TU Dresden): a Türkis app bar with the chair's logo, Noto Sans, Orange for what you are working on (pressed buttons, placing), Rot for disruptions and Dunkelblau boards. It follows the light or dark mode of your device.

## Image sources

The top bar chooses what the app looks at:

| Button | What it does |
| --- | --- |
| **Live camera** | Uses the rear camera (phones) or the default webcam. Keeps the screen awake. |
| **Take photo** | Opens the camera app of a phone; the photo is analysed once at high resolution. |
| **Record video** | Records a video with the phone's camera app and plays it in a loop. |
| **Open file** | A photo or video from the device. |
| **Layouts…** | Loads an example layout (the EBL lab or the synthetic layout) together with its example image. |

Photos are the easiest way to start: detection runs once at full resolution, and objects can be placed precisely. The buttons at the bottom right of the stage:

| Button | What it does |
| --- | --- |
| **Flyover** | A virtual camera instead of the camera image (key F), see below. |
| **Freeze** | Keeps the current video frame for editing (videos and the live camera only). |
| **Full screen** | The stage alone, e.g. for a projector. |

## The flyover

**Flyover** (button, View panel or key F) replaces the camera image by a virtual camera that flies around the layout. You see the lab floor, the table, its photo from above (the orthophoto in `view.ortho`, if the layout has one), a grid, the marker stickers with their IDs and everything virtual, by day and by night. Video processing pauses meanwhile; press F again to return to the camera image (or video) you had before. The camera position is kept per layout in the browser.

| Input | Mouse and keyboard | Touch |
| --- | --- | --- |
| Turn the view | drag (outside Build) | one finger (outside Build) |
| Pan | Shift-drag, right-drag or middle-drag; in Build also a drag on empty space | two fingers |
| Zoom | scroll wheel (at the pointer), double-click (outside Build) | pinch |
| Rotate | Q, E | twist two fingers |
| Tilt | Page Up, Page Down | |
| Show the whole layout | Home | |

The keys work while the stage has the focus (click on it, or switch the flyover on with F); arrows pan, + and − zoom, and Shift makes arrows, Q/E and Page Up/Down take bigger steps. The buttons at the right of the stage zoom, rotate, switch to the **plan view** (straight down; press it again to tilt back) and show the whole layout.

In Build, everything works as on the camera image, and placed points, the corners of table modules and dragged objects **snap to the grid** (hold Alt/Option to place freely). **Build → Table → Table module** extends the tabletop with virtual table modules: drag from one corner to the opposite one, or tap both corners. A table module of the kind *real table* draws the outline of the lab's real table; once there is one, the flyover no longer draws its own light-grey default table around the markers and objects.

The View panel's **Flyover** section has the same switch and camera buttons, the grid spacing (10, 25, 50, 100 or 250 mm), **Snap to the grid**, **Grid in camera view** (shows the grid over the camera image too, and snapping to it there) and **Show markers**.

## What you see

The chips at the top left of the stage show the state:

| Chip | Meaning |
| --- | --- |
| *Tracking · 5 markers* | the layout is registered using five markers; *· locked* when the marker map is locked |
| *Markers hidden · holding position* | all markers are hidden for a moment; the last pose is kept for 1.5 s |
| *Markers 7, 9 seen, none known yet* | markers are in view, but none is in the marker map yet (*none in the locked marker map* when it is locked) |
| *Flyover · plan view*, *Grid 50 mm · snap* | in the flyover: the camera and the grid |
| *07:32*, *22:30 · night* | the time of day of the fast clock, *· night* between sunset and sunrise (see [Day and night](day-and-night.md)) |
| *Paused*, *5× time*, *1 disruption*, *Control system · 3 trains*, *Frozen frame*, *Recording* | simulation and recording state |

Every stop (platform, bus terminal, bus stop) has a **board** above it: the stop sign (platform number or "H"), the name, the number of people waiting and their average mood, e.g. *Altmarkt · 7 people · 70 %*, and the next events: *Next train in 12 s*, *RE 1 boarding (Track 2)*, *Bus 62 Ring ↺ in 3 min*, or a disruption message such as *Signal failure (4 min left)*. A bus stop on both sides of the street has one board for both sides. Seen from far away (the stop shorter than 60 px on the screen, e.g. in the flyover's overview or on a phone) the board shrinks to a badge with the stop sign and the number of people waiting; zoom in for the full board.

People at stops are coloured by their mood: Türkis = happy, Gelb = so-so, Rot = annoyed. People of the [town simulation](day-and-night.md#colours) are coloured by the purpose of their trip. Buildings look like a white architectural model in greys; at night their windows light up when people are inside.

## Panels

### View

- *Tracking*: markers seen, markers used for the pose, the size of the marker map (and whether it is locked), moving markers in view, the marker type, the reprojection error and the frame rate.
- *Flyover*: see above.
- *Show*: signs and boards, walking trails, marker outlines (key M; markers used for the pose light Türkis, the others Orange), tracks (the `track` objects over the camera image), and the opacity of virtual objects.
- *Camera*: the focal length (estimated automatically; adjust it with − and + if people or buildings lean), loading a [camera calibration](calibration.md).
- *Record*: records the stage as a WebM video.

### Build

The layout editor.

- *Add to the layout*: the palette, in five groups. Pick a type, then tap on the image (or on the table in the flyover). The small text under each type says how it is placed.

  | Group | Types | Placing |
  | --- | --- | --- |
  | Transport | Rail platform, Bus terminal, Street, Bus stop, Bus line | platform: two taps (tap a marker to anchor the end to it); street: points along it, then **Finish**; bus line: tap its stops in order, then **Finish**; the others: one tap |
  | Buildings | Building, Plattenbau, Altbau block, Single-family house, Single-family estate, Office building, School, Supermarket, Workshop / factory | one tap; the estate: its outline, then **Finish** |
  | Scenery | Tree, Forest, Landscape area (and plugin types such as the Windmill) | tree: one tap; forest and area: the outline, then **Finish** |
  | Infrastructure | Track, Label / sign | track: points along the real track, then **Finish**; label: one tap |
  | Table | Table module | drag from one corner to the opposite one, or tap both corners |

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

### Simulate

- *Time of day*: the clock (time, day/dawn/dusk/night and the day number), a slider to set the time, the presets **Morning 06:30**, **Noon 12:00**, **Evening 17:00** and **Night 22:30**, the **Fast clock** ratio (1:1 real time … 1:60; 1:12 = one clock hour in five simulated minutes), **Day and night lighting** and **Stop the clock**. See [Day and night](day-and-night.md).
- *Town* (only with the town simulation): how many people there are and where (at home, at work, at school, shopping, on the bus, at stops, away by train), the colours of their trip purposes, and **Colour of people** (town people by purpose and passengers by mood, or everybody by purpose or by mood).
- *Speed*: **Pause**, the speed (simulated time per real time: 1×, 2×, 5×, 10×, 30×) and **Clear passengers** (removes everybody waiting; the town and the cars start afresh).
- *Passenger demand*: more or fewer random passengers (× 0.25 … × 4).
- *Stops*: a departure board for all stops: people waiting, mood, people in and out per minute, the next event, and buttons that send a train or bus of the timetable to a track or bay right away. Stops of bus lines have no such buttons (the lines serve them); a bus stop on both sides of the street is listed as *Stop A* and *Stop B*.

### Disruptions

Start a disruption (kind, where, duration and options), see the active ones and stop them, and play scenarios stored in the layout. See [Disruptions and scenarios](disruptions-and-scenarios.md).

### Control

Connect to a control-system bridge (WebSocket address), or start the simulated control system, choose how its trains are drawn, and see the trains it reports. See [Control-system interface](control-system-interface.md).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | pause / resume the simulation |
| 1 … 9 | send a vehicle to the stop with that position on the Stops board (stops served by bus lines say so) |
| M | marker outlines on/off |
| F | flyover on/off |
| ← ↑ → ↓, + −, Q E, Page Up/Down, Home | flyover: pan, zoom, rotate, tilt, show the whole layout (while the stage has the focus; Shift: bigger steps) |
| R, Shift+R | turn the selected object by 15° or 90° counter-clockwise (Build panel) |
| Delete, Backspace | delete the selected object (Build panel) |
| Alt (Option) | hold while placing or dragging: no snapping to the grid or to streets |
| Esc | cancel placing, or deselect |
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
| `scenario=<id>` | play a scenario of the layout |
| `#view`, `#build`, `#simulate`, `#disrupt`, `#control` | open a panel |

## Tips for good tracking

- Look at the layout from above at an angle (30–70° from horizontal). Straight from above works too, but the focal length cannot be estimated then.
- Several markers in view make the pose steadier; three or more spread over the image also let ARail estimate the focal length.
- Markers must be at least about 20 pixels large in the image. Get closer, use a higher resolution, or print larger markers (see [Setting up a lab](lab-setup.md)).
- Avoid glare on the markers and motion blur (hold still for a moment, or use a stand).
- Once all markers are measured, lock the marker map (**Keep positions**): misread and moved markers can then no longer disturb the pose.
