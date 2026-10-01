# Setting up a lab

This guide covers the physical side: markers, cameras, and the marker map that ties the camera image to your layout.

## Markers

ARail recognises square black-and-white markers of the ArUco and AprilTag families. Each has an ID; the app uses IDs 0–49 by default (setting `markers.codes` in the layout file).

| Marker type (app) | OpenCV name | Notes |
| --- | --- | --- |
| ArUco Original | `DICT_ARUCO_ORIGINAL` | used in the EBL; 5×5 bits, robust at small sizes |
| ArUco 4x4 … 7x7 | `DICT_4X4_*` … `DICT_7X7_*` | 4x4 is most robust when small, 7x7 has more IDs |
| ArUco MIP 36h12 | `DICT_ARUCO_MIP_36h12` | good error correction |
| AprilTag 36h11 | `DICT_APRILTAG_36h11` | common in robotics |

The type is set per layout (Build → Layout → Marker type, or `markers.dictionary`). With "detect automatically" the app finds it within a few frames.

Choosing a dictionary and the IDs:

- Use **one dictionary** for everything: the stickers you survey and the markers you track live with.
- Use the IDs **0 … N−1**, with N just covering the printed stickers, and set `markers.codes` = N in the layout file. Fewer codes are further apart, so more misread bits can be corrected safely, and a misread marker cannot turn into an ID beyond N.
- **4×4** markers have the largest cells for a given size: the most robust choice when markers are small in the image. ArUco Original (used in the EBL) has 5×5 bits but codes that lie close together.
- After the survey, **lock the marker map** (Keep positions, or the `markers.locked` that `arail-survey` writes): live tracking then uses only the measured stickers, reads only the codes up to the highest of their IDs, ignores unknown and misread IDs, and drops markers whose position does not fit (moved stickers, misreads) as outliers. Stickers with IDs above the highest one in the map must then not lie on the layout.
- Markers on vehicles (e.g. container wagons) are *moving markers* (Build → Marker map → Moving markers, `markers.moving`): never part of the map.

### Size

The marker size is the edge of the black square, without the white border. Markers should be at least about 20 pixels large in the image (in the direction where they appear shortest). As a rule of thumb for 1280×720 video from a phone or webcam:

| Marker size | Works up to a distance of about |
| --- | --- |
| 30 mm | 1.4 m |
| 40 mm | 1.8 m |
| 60 mm | 2.8 m |

Photos are analysed at up to 2000 pixels, so they reach further. Markers of different sizes can be mixed: set the common size in `markers.size_mm` and exceptions in `markers.sizes_mm`, e.g. `{"7": 60}`.

### Printing

Use the [marker sheet page](https://joernmht.github.io/ARail-EBL/markers/) (or `web/markers/` locally). Choose the type, IDs, size and white border, then print at 100 % ("actual size"). Measure the 100 mm bar on the sheet; if it is off, correct the marker size in the app instead of reprinting. Matte paper avoids glare. Keep a white border of at least one marker cell around the black square (5–6 mm for 30 mm ArUco Original).

## Placing markers

- Lay them **flat** on the layout. Any rotation is fine.
- Put **one marker at each end of every platform**, next to the platform's centre line: a platform object is defined "between" two markers. If the platform is offset from the line between its markers, set its sideways offset.
- Add **more markers across the layout**, about every 40–60 cm, where the camera will look. Tracking needs at least one known marker in view; two or three make it steady. In the lab's test video, frames without any marker in view could not be registered, so coverage matters more than anything else.
- Keep them where trains do not cover them, and **not all on one line**: markers spread in both directions let ARail estimate the camera's focal length.
- Use each ID once per layout.

## The marker map

Each layout has a *layout frame*: millimetres on the layout, with its origin at the **origin marker** (`markers.origin`, default 0), the x axis pointing along the origin marker's printed "right" and y along its "up". The *marker map* stores where every marker lies in this frame (`markers.poses`: x, y in mm and rotation in degrees).

You do not need to measure it. When the app sees an unknown marker together with known ones, it computes the unknown marker's position from the images (after three frames of video, or at once in a photo) and refines it while you keep filming. In practice:

1. Take a photo (or a slow video) that shows the origin marker and several others, looking from above at an angle.
2. Continue with photos that overlap with already known markers until all markers appear in the marker map (Build → Marker map).
3. Press **Keep positions**, then **Export layout**. The positions are now stored in the layout file and used from the start next time, and the map is locked: no other markers are surveyed (**Unlock** opens it again).

After moving markers, press **Measure again** (this unlocks the map). You can also type in measured positions in the layout file; they are used as they are.

To survey a whole layout at once (stickers everywhere, one video, a fixed layout and an orthophoto of the table for the flyover), follow the [lab-session checklist](lab-session.md).

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
