# Setting up a lab

This guide covers the physical side: markers, cameras, and the marker map that ties the camera image to your layout. To survey a whole layout in one visit (stickers everywhere, one video, a fixed layout and an orthophoto of the table for the flyover), follow the [lab-session checklist](lab-session.md).

## Markers

ARail recognises square black-and-white markers of the ArUco and AprilTag families. Each has an ID; the app uses IDs 0–49 by default (`markers.codes` in the layout file sets how many).

| Marker type (app) | OpenCV name | Notes |
| --- | --- | --- |
| ArUco Original | `DICT_ARUCO_ORIGINAL` | used in the EBL; 5×5 bits, 1024 IDs |
| ArUco 4x4 … 7x7 | `DICT_4X4_*` … `DICT_7X7_*` | 4x4 is most robust when small, 7x7 has more IDs |
| ArUco MIP 36h12 | `DICT_ARUCO_MIP_36h12` | good error correction |
| AprilTag 36h11 | `DICT_APRILTAG_36h11` | common in robotics |

The type is set per layout (Build → Layout → Marker type, or `markers.dictionary`). With "detect automatically" the app finds it within a few frames.

### Choosing a dictionary and the IDs

- **One marker type for the layout, another for rolling stock.** All stickers on the layout (the ones you survey and the ones you track live with) are of one type: a layout reads one type for its marker map, so markers of another type are not used. Tags on model wagons for the [container terminal](container-terminal.md) are of another type, AprilTag 36h11, with IDs of their own (`markers.rolling`, see [below](#markers-on-model-wagons)). Set the layout's type explicitly then, not "detect automatically". Build → Layout does not accept the rolling-stock type for the layout. The marker sheet page prints deck cards only in AprilTag 36h11, so if your layout stickers are AprilTag 36h11, print them in another type (ArUco Original, as in the EBL) before you use model wagons: another rolling-stock type in `markers.rolling.dictionary` is accepted, but its deck cards cannot be printed.
- Use the IDs **0 … N−1**, with N just covering the stickers you printed, and set `markers.codes` = N in the layout file (e.g. 55 for IDs 0–54; `arail-survey` reads it from the layout, or takes `--codes`). Fewer codes lie further apart, so more misread bits can be corrected safely, and a misread marker cannot turn into an ID beyond N.
- **4×4** markers have the largest cells for a given size: the most robust choice when markers are small in the image. ArUco Original (used in the EBL) has 5×5 bits but codes that lie close together; 6×6 and 7×7 only pay off when you need many IDs.
- After the survey, **lock the marker map** (Keep positions, or the `markers.locked` that `arail-survey` writes). This makes live tracking robust: it then uses only the measured stickers, reads only the codes up to the highest of their IDs (more bit errors corrected), ignores unknown and misread IDs, and drops markers whose position does not fit (moved stickers, misreads) as outliers. Stickers with IDs above the highest one in the map should then not lie on the layout.
- Markers on vehicles can also be *moving markers* (Build → Marker map → Moving markers, `markers.moving`): markers of the layout's own type that are never part of the map. Give them IDs below `markers.codes`, and do not place objects relative to them. This is the older way: the tracker reports where such a marker is seen (View panel, `tracker.state.moving`), but no built-in simulation uses it. For model wagons use rolling-stock tags.

### Size

The marker size is the edge of the black square, without the white border. Markers should be at least about 20 pixels large in the image (in the direction where they appear shortest). As a rule of thumb for 1280×720 video from a phone or webcam:

| Marker size | Works up to a distance of about |
| --- | --- |
| 30 mm | 1.4 m |
| 40 mm | 1.8 m |
| 60 mm | 2.8 m |
| 20 mm AprilTag 36h11 (tags on model wagons) | 0.8 m |

Photos are analysed at up to 2000 pixels, so they reach further. Markers of different sizes can be mixed: set the common size in `markers.size_mm` and exceptions in `markers.sizes_mm`, e.g. `{"7": 60}`.

### Printing

Use the [marker sheet page](https://joernmht.github.io/ARail-EBL/markers/) (or `web/markers/` locally). Choose the type, IDs, size and white border, then print at 100 % ("actual size"). Measure the 100 mm bar on the sheet; if it is off, correct the marker size in the app instead of reprinting. Matte paper avoids glare. Keep a white border of at least one marker cell around the black square (5–6 mm for 30 mm ArUco Original).

## Placing markers

- Lay them **flat** on the layout. Any rotation is fine.
- For a new layout, put the **origin marker** (usually ID 0) at a table corner, with its sides parallel to the table edges: the layout's x and y axes then follow the table, so the grid of the flyover is aligned with it.
- Put **one marker at each end of every platform**, next to the platform's centre line: a platform object is defined "between" two markers. If the platform is offset from the line between its markers, set its sideways offset.
- Add **more markers across the layout**, about every 30–40 cm in both directions, at least wherever the camera will look. Tracking needs at least one known marker in view; two or three make it steady. In the lab's test video, frames without any marker in view could not be registered, so coverage matters more than anything else.
- Keep them where trains do not cover them, and **not all on one line**: markers spread in both directions let ARail estimate the camera's focal length.
- Use each ID once per layout.

## Markers on model wagons

Model wagons for the [container terminal](container-terminal.md#markers-on-rolling-stock) carry a **deck card**: a strip of paper as wide as a container, with one AprilTag 36h11 tag (20 mm) on each container spot, laid or glued on the spigots. Any one visible tag tells ARail which wagon it is and where it stands; its containers are virtual and drawn on it.

- **IDs**: tag ID = (wagon − 1) × stride + spot (`markers.rolling.stride`, 4 by default), with spot 0 at the wagon's A end. W1 (an Sgns with 3 spots) has the IDs 0, 1, 2; W2 has 4, 5, 6; an Sggrss as W3 has 8 to 11. They do not clash with the layout's marker IDs.
- **How many**: one tag per container spot, 3 per Sgns, 2 per Lgns, 4 per Sggrss. A tag on spot 0 alone works too, with a less precise heading.
- **Printing**: the marker sheet page in the mode *Deck cards for model wagons* (`markers/?kind=rolling`): wagon numbers, wagon type, tag size and scale; print at 100 % and check the 100 mm bar.
- **Height**: measure the height of the cards above the surface the layout markers lie on and enter it as `markers.rolling.height_mm` (about 15–18 mm in H0); an error of 1 mm moves the wagon by about 1 mm.
- **Distance**: 20 mm tags are read up to about 0.8 m from a 1280×720 camera. Keep the camera closer over the loading tracks than elsewhere.
- **Surveying**: the tags never enter the marker map, but set the layout's marker type explicitly (not "detect automatically") before you survey, or take the tagged wagons off the layout.

The [container terminal guide](container-terminal.md#markers-on-rolling-stock) explains the IDs, the cards, the height and what happens when a hand or the crane hides the tags.

## The marker map

Each layout has a *layout frame*: millimetres on the layout, with its origin at the **origin marker** (`markers.origin`, usually 0; without it, the lowest ID among the first markers seen), the x axis pointing along the origin marker's printed "right" and y along its "up". The *marker map* stores where every marker lies in this frame (`markers.poses`: x, y in mm and rotation in degrees).

You do not need to measure it. When the app sees an unknown marker together with known ones, it computes the unknown marker's position from the images (after three frames of video, or at once in a photo) and refines it while you keep filming. In practice:

1. Take a photo (or a slow video) that shows the origin marker and several others, looking from above at an angle.
2. Continue with photos that overlap with already known markers until all markers appear in the marker map (Build → Marker map).
3. Press **Keep positions**, then **Export layout**. The positions are now stored in the layout file and used from the start next time, and the map is locked: no other markers are surveyed (**Unlock** opens it again).

After moving markers, press **Measure again** (this unlocks the map). You can also type in measured positions in the layout file; they are used as they are.

To survey a whole layout at once (stickers everywhere, one video, a fixed layout and an orthophoto of the table for the flyover), follow the [lab-session checklist](lab-session.md): `arail-survey` measures all markers together, or **Build → Marker map → Survey a video** does it in the app.

On the lab photo, the surveyed distances between the platform markers were 700.7 mm and 718.4 mm, matching the earlier measurements of the platforms (about 700 and 720 mm).

## Scale and sizes

The layout file sets the model scale (`scale`: 87 for H0, 120 for TT, 160 for N, ...). Everything you measure on the layout is in model millimetres (`_mm` fields: positions, platform widths). Sizes of virtual things are in prototype metres (`_m` fields: building widths, tree heights) and are converted with the scale, so they fit the model. The passenger simulation also works in prototype metres and seconds.

Measure the platform widths with a ruler and enter them (`width_mm`); the example layout uses 70 mm and 37 mm for the two EBL platforms.

## Cameras

- **Phones and tablets**: open the app over https (GitHub Pages) and use **Live camera**; the rear camera is chosen. For editing, take photos.
- **Webcams** on a lab PC: 1080p webcams work well. Open the app in the browser on that PC (https, or `npm start` and <http://localhost:8000/app/>).
- **Fixed installations** (a webcam on a stand, output on a monitor or projector): use **Full screen**. A fixed camera gives the steadiest picture; consider [calibrating](calibration.md) wide-angle webcams.
- **Light**: even, bright light without reflections on the markers. Motion blur is the most common reason for lost tracking with handheld cameras.

## Connecting the control system

Once the layout works, connect your control system so that real trains drive the simulation: see [Control-system interface](control-system-interface.md). Name the tracks at the platforms (`track_left`, `track_right`) as the control system calls them.
