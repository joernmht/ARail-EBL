# Lab session: stickers, film, fixed layout

One visit to the lab is enough to get a **fixed layout**: markers stuck all over the table, one video of the whole layout, and afterwards

- a layout file with the position of every marker (the app keeps these positions and no longer has to survey anything),
- an **orthophoto** of the table (a top view in the layout frame) that the flyover draws on the table,
- a report that says whether everything was captured, before you leave the lab.

Two tools do the survey:

| | `arail-survey` (Python, offline) | In the app: **Build → Marker map → Survey a video** |
| --- | --- | --- |
| Method | global adjustment of all markers and frames, robust against wrong detections | frame by frame, each marker averaged over the frames |
| Output | layout file (locked), JSON report, orthophoto, check image | marker map (then **Keep positions**, which locks it, and **Export layout**) |
| Needs | Python with OpenCV (`pip install -e "tools[headless]"`) | a browser that can play the video (MP4/H.264 or WebM) |

Use the app for a quick check in the lab; use `arail-survey` for the layout that goes into the repository.

## Before the visit

- [ ] **Marker type and size.** One dictionary for the survey and for live use (see [choosing a dictionary and the IDs](lab-setup.md#choosing-a-dictionary-and-the-ids)): ArUco Original as on the EBL layout, or ArUco 4x4 for the most robust detection of small markers; 30 mm black square. Filming from more than about 1.4 m away needs 40 mm or more (see [Setting up a lab](lab-setup.md#size)).
- [ ] **How many.** One marker every 30–40 cm in both directions over the whole table, plus one at each end of every platform and at the table corners. For a table of *L* × *W* metres that is about (*L*/0.35 + 1) × (*W*/0.35 + 1) markers, e.g. 3.5 × 1.4 m: 11 × 5 = 55. Use the IDs 0 … N−1 and set `markers.codes` = N in the layout file (e.g. 55 for IDs 0–54; the default is 50). `arail-survey` takes it from `--layout`, or from `--codes`.
- [ ] **Print the sticker sheets** on the [marker page](https://joernmht.github.io/ARail-EBL/markers/) (`web/markers/` locally): marker type, the IDs (e.g. `0-54`, nothing beyond N−1), size, white border at least 6 mm, cut lines on. Use **matte sticker paper** (full-sheet A4 labels; glossy paper reflects the lights). Print at 100 % ("actual size", not "fit to page").
- [ ] **Check the 100 mm bar** on every sheet with a ruler. If it is off, note the real size of the black square and use it (`--size`, Build → Layout → Marker size) instead of reprinting.
- [ ] **Every ID once.** Two stickers with the same ID break the survey (the report names IDs seen twice in one frame).
- [ ] Bring: scissors or a cutter, a tape measure or folding rule, a sketch of where which ID goes, a phone with free storage and a charged battery, a stepladder for a few photos from above, a laptop with `arail-survey` installed (to check the result before leaving).

## Sticking the markers

- [ ] **Origin marker 0 at a table corner**, for example front left, with its sides parallel to the table edges and its ID label towards the front edge. The layout's x axis then runs along the front edge and y into the table, so the grid in the flyover is aligned with the table and editing on the grid is natural.
- [ ] Then **every 30–40 cm in both directions**, a loose grid over the whole table. The others may be rotated freely, but aligned stickers are easier to check.
- [ ] **Platform ends**: one marker at each end of every platform, next to the platform's centre line (platforms are placed "between" two markers).
- [ ] **Table corners and edges**: they bound the orthophoto and show where the table ends.
- [ ] Not on the rails, not under bridges or catenary masts; between the tracks is fine. Trains must not cover them.
- [ ] **Press them flat**: curled corners or bubbles show up as high residuals.
- [ ] Optional, recommended: **measure one long distance** between two marker centres with the tape measure, e.g. from marker 0 to a marker at the far end (write down the IDs and the distance in mm). It checks the scale of the survey (`--distance`).
- [ ] Leave the stickers on the layout. The marker map stays valid as long as nobody moves them.

## Filming

- [ ] Phone **main camera** (1×), not the wide-angle camera (0.5×): its lens distortion bends the marker map. Webcams and action cameras with a fish-eye look need a [calibration](calibration.md) (`--calibration`).
- [ ] **4K at 30 fps** (best), or 1080p at 30–60 fps, landscape. Video stabilisation may stay on.
- [ ] **Lock focus and exposure** (on most phones: long press on the table in the camera app) so the brightness does not jump between frames.
- [ ] Even, bright light; no glare on the markers; mind your own shadow.
- [ ] **Lawn-mower passes**: slowly along the table at **40–60° tilt** (camera about 50–70 cm above the table, markers at least about 25 px large in the picture), each pass overlapping the previous one by half a picture; then the same across the table.
- [ ] Then **oblique passes** along the edges and from the corners, and a few overviews.
- [ ] **Overlap and neighbours**: two or three markers should be in view at any time; every marker must be seen many times together with its neighbours. Parts of the table without markers in view cannot be placed.
- [ ] **Slowly** (about 10 cm per second): motion blur is the main reason for missed markers.
- [ ] Optional: a few **photos from above** (stepladder); photos and videos can be surveyed together.
- [ ] Length: 2–5 minutes for a table of 3–4 m. Too much is better than too little.
- [ ] **Before leaving**: run the survey (or the app's *Survey a video*) and read the warnings. Film missing areas again and survey both videos together.

## Processing with `arail-survey`

```bash
pip install -e "tools[headless]"            # once
arail-survey lab.mp4 photos/*.jpg --layout web/layouts/ebl-lab.json \
    -o web/layouts/ebl-lab.json --report survey-report.json \
    --ortho web/media/ebl-lab-ortho.jpg --check check.jpg \
    --ortho-bounds auto -320 auto auto --distance 0 37 2850
```

- Inputs: videos and photos, any number, glob patterns allowed. Every 2nd video frame is analysed (`--every`; use 3 or 4 for 60 fps).
- `--layout`: the marker type, size, number of codes and origin come from the layout, its known marker poses are kept, and the result is merged into it (objects, scenarios and everything else stay). Without `--layout` a new layout is written; the origin marker (`--origin`, default 0) defines the layout frame.
- `--resurvey`: ignore the poses in `--layout` (after markers were re-stuck; the report names layout markers that were not seen again and the objects that use them); `--refine-fixed`: refine them too (as measurements of 2 mm / 0.5° next to the images).
- The layout is written **locked** (`markers.locked`): the app then uses only the surveyed markers (see [Keeping positions](#keeping-positions)); `--unlocked` leaves it open.
- `--moving 40,41` (or `markers.moving` in the layout): markers on vehicles, e.g. container wagons. They are left out of the adjustment and of the marker map, and `markers.codes` is raised to cover them. Objects of the layout must not be placed relative to them, and the origin cannot be one.
- `--distance A B MM`: a measured distance between two marker centres. Without known poses it sets the scale; with known poses it is only checked.
- `--ortho-bounds XMIN YMIN XMAX YMAX` (mm, `auto` for single sides) clips the orthophoto to the table: the floor beyond the table edge is not on the table plane. Read the edges off the grid of the check image. `--ortho-res` sets the resolution (1 mm per pixel; at most 2000 px, `--ortho-max`).
- `--mask X0,Y0,X1,Y1` leaves an image region out of the orthophoto (fractions of the image, e.g. a timestamp). Static watermarks are found automatically.
- Time: about 40 ms per 1080p frame for the detection, a second for the adjustment, 10–30 s for the orthophoto.

What it does: markers are detected with sub-pixel corners (refined along the square's edges, unbiased under blur), their poses are chained from the origin (or from the known poses) and refined in a bundle adjustment of all marker poses and one homography per frame, with a robust loss; wrong detections are rejected. The orthophoto takes, for every pixel, the frame that shows it with the most detail (frames are balanced for exposure; image borders, blurred frames, watermarks, covered markers and parts far from the frame's markers count less). Details are in the module documentation of [`tools/arail_tools/survey.py`](../tools/arail_tools/survey.py).

## Checking the result

The summary lists every marker: position, rotation, the number of frames it was used in, its reprojection error (`rms px`, typically below 1), its uncertainty (`+-mm`) and its status: `origin`, `fixed` (from the layout), `surveyed`, `moved` (measured again), `refined`. The same is in the report (`--report`, JSON), with the frames used, the observations rejected and the orthophoto's bounds.

| Warning | What to do |
| --- | --- |
| Seen in fewer than 5 frames | film these markers again, together with their neighbours |
| could not be placed: never seen together with another marker / seen only together with … | film them together with markers that are already placed |
| lies on marker N: a misread ID | harmless: a small or blurred marker was decoded wrongly; film closer |
| IDs seen twice in one frame | two stickers with the same ID? replace one |
| High residuals | the sticker is not flat, bent, or moved while filming |
| Poorly determined (+-mm above 2) | film from closer, with more neighbours in view |
| Markers moved since the layout was made | they are measured again; objects attached to them follow |
| Not seen together with other markers, kept as in the layout | known markers the video did not check; film them if they might have moved |
| Markers with IDs above … were seen and ignored | stickers beyond `markers.codes`: raise it (or `--codes`) if they belong to the layout |
| Markers of the layout not placed by the new survey, left out (`--resurvey`) | film them, or the objects placed relative to them cannot be placed |
| Measured freely, the marker map is … % larger/smaller than the layout's | the marker size is wrong, or the lens distorts (use the main camera or a calibration) |
| Only … % of the frames show two or more markers | add markers where the camera looks |

Accuracy: on the synthetic test video (tests/python/test_survey.py) all markers are within 2 mm and 0.5° over 0.7 m. The **check image** (`--check`) shows the orthophoto with a 100 mm grid, the markers (orange), the platforms (red), the tracks (yellow) and other objects (turquoise) of the layout: the platform outlines must lie on the real platforms.

## Importing the layout

- With `-o web/layouts/<name>.json` the layout file is updated in place; otherwise copy the output there, or load it in the app with **Build → Layout → Import layout**.
- All marker poses are in `markers.poses`. The app treats poses from the file as fixed: **Build → Marker map** shows them as *fixed*. The map is locked (`markers.locked`), so nothing is surveyed again and other markers are ignored.
- `view.ortho` (`{"image": "../media/<name>-ortho.jpg", "bounds_mm": [xmin, ymin, xmax, ymax]}`, image row 0 at `ymax`, column 0 at `xmin`) puts the orthophoto on the table in the flyover. The image path is relative to the layout file.
- Commit the layout and the orthophoto.

## In the flyover

- Open the layout and switch to the **Flyover** (key `F`): the orthophoto lies on the table, with the grid aligned to the table if the origin marker was.
- **Draw the physical table**: Build → *Table* → **Table module**, then drag from one corner of the table to the opposite one, or tap both (read them off the orthophoto; snapping to the grid helps), and set *Kind* to *real table (only drawn in the flyover)*. From then on the flyover draws this table instead of its default one. Virtual extensions of the table are table modules of the kind *virtual extension*: they are drawn over the camera image too.
- Place platforms between their markers, streets, buildings, … as usual.

## Keeping positions

- The stickers stay where they are. As long as nobody moves them, the layout file is valid; the app starts tracking at once.
- **Keep positions** locks the marker map (in the app: Build → Marker map; `arail-survey` writes `markers.locked`). Live mode then accepts only the measured sticker IDs: nothing is surveyed, unknown and misread IDs are ignored, a sticker whose position does not fit is dropped as an outlier, and the detector reads only the codes up to the highest ID (fewer codes: more bit errors corrected safely). Settings → View → Camera → Tracking details say "5 markers (locked)". **Unlock** opens the map again.
- If a sticker was moved or replaced: film that area again and run `arail-survey … --layout <the layout>`: moved markers are found and measured again (the report says so). In the app: **Build → Marker map → Measure again** (this unlocks the map), film, then **Keep positions**. **Survey a video…** unlocks the map for its run and offers **Keep positions** at the end (if it measured nothing, the map is locked again).
- After re-sticking many markers: `--resurvey`.
- **Moving markers**: markers on vehicles (e.g. container wagons) are never part of the map. Enter their IDs in Build → Marker map → *Moving markers* (`markers.moving`, `arail-survey --moving`). Give them IDs within `markers.codes` (the app refuses others; `arail-survey` raises `markers.codes`) and do not stick them on the table. Objects cannot be placed relative to them.

## The EBL example

`web/media/ebl-lab-ortho.jpg` was made from the example video and photo with the markers 0–4 of the layout file (kept as they are):

```bash
arail-survey examples/media/ebl-lab-video.mp4 examples/media/ebl-lab-photo.jpg \
    --layout web/layouts/ebl-lab.json -o ebl-lab.json --report report.json \
    --ortho web/media/ebl-lab-ortho.jpg --check check.jpg --ortho-bounds -300 -320 auto 700
```

The near table edge is at y ≈ −320 mm; beyond y ≈ 700 mm the video shows the wall. Only 36 % of the frames show two or more of the five markers, so parts of the table could not be registered: exactly what the next lab session fixes. The video's watermark is found and left out. Measured freely, the video's marker map is about 1 % larger than the layout's poses (the lens of the video camera, most likely); the lab photo alone agrees with them within 5 mm. The output of this command is locked; the example layout in the repository is not, so the app still measures new stickers on it.

## The examples of 9 October 2026

The layouts `web/layouts/ebl-neustadt.json` (the station Bf Neustadt, the terminal at the crane and the curve next to it) and `web/layouts/ebl-container-train.json` (the hybrid container train) were surveyed from the photos and clips of that day in `examples/media` (40 mm ArUco Original stickers, IDs up to 214). The full lab was not filmed for this; these are maps of the parts the photos and clips show.

```bash
# the station, the terminal and the curve: three photos and two clips, origin marker 5 (at the crane)
arail-survey examples/media/ebl-terminal-crane.jpg examples/media/ebl-terminal-tracks.jpg \
    examples/media/ebl-station-neustadt.jpg examples/media/ebl-station-trains.mp4 \
    --dictionary ARUCO --size 40 --codes 250 --origin 5 --every 1 \
    --moving 84,85,86,147,148,149,150,203,214 -o neustadt.json --report report.json
# the curve clip on its own (it meets the rest only at marker 5), and the orthophoto with all poses fixed
arail-survey examples/media/ebl-curve-trains.mp4 --dictionary ARUCO --size 40 --codes 250 --origin 2 --every 1 --moving 214 -o curve.json
arail-survey <the photos and both clips> --layout combined.json --every 1 \
    --ortho web/media/ebl-neustadt-ortho.jpg --ortho-bounds -2400 -100 3750 700
# the hybrid container train: the two clips of the tagged train, origin marker 130
arail-survey examples/media/ebl-terminal-wagons.mp4 examples/media/ebl-terminal-truck.mp4 \
    --dictionary ARUCO --size 40 --codes 250 --origin 130 --every 1 -o train.json \
    --ortho web/media/ebl-container-train-ortho.jpg
```

- **One plane.** `arail-survey` measures markers on one plane. The back strip of the EBL table (markers 84–86 and 147–150) lies higher than the front, and markers 203 and 214 hang on the wall: they were left out with `--moving` and are not in the layouts (whose maps are locked, so the app ignores them). Taken in, they bend the map: with them, every detection of the combined survey was rejected.
- **Photos and clips disagree a little.** Surveyed together with the curve clip, the far end of the station moved by up to 40 mm; the map of the photos and the station clip fits the photos better (0.55 px against 1.49 px), so it was kept, and the curve's markers 0, 2, 3 and 37 were added through marker 5, which both surveys place alike. Marker 38 was read once, rotated by 32°: a misread, left out.
- **The uncertainty grows with the distance from marker 5** (about ±10 mm at Bf Neustadt), because the photos and clips see only a few markers at a time; the survey of the whole lab, with many markers in every picture, replaces these maps.
- **The tagged train** shows only one layout marker (130 or 131) in most frames, and none at times. A single far marker gives a shaky pose, and its focal length cannot be estimated, so virtual objects lean in those frames. Film it with three or four markers in view around the train, and a little closer: the tags need about 20 px.

### One orthophoto of the linked parts

The flyover of Bf Neustadt shows one solid orthophoto of all the parts of the lab the survey linked (the marker groups S01–S04 and S10 of the [photo map](#the-photo-map): from the curve at the east end of Bf Neustadt to Waldhof south, about 15 m), not only the 6 m of the layout's own survey. `arail-mosaic` makes it from the photo map's orthophotos and the layout's own (`web/media/ebl-neustadt-ortho.jpg`, finer, and in the layout frame already):

```bash
arail-mosaic web/lab-map/data.json --reference web/media/ebl-neustadt-ortho.jpg \
    --bounds -2400 -70 3750 650 --out web/media/ebl-neustadt-linked-ortho.jpg \
    --image ../media/ebl-neustadt-linked-ortho.jpg
```

- **The frame.** The photo map uses the hall frame (origin at group S03), the layout its marker 5. SIFT features of the groups' orthophotos found again in the layout's orthophoto give the hall frame in the layout frame: 355 features fit within 15 mm, with 6 mm rms; the hall's origin lies at x = 3650 mm, y = −20 mm, turned by −0.43° and scaled by 1.004 (the two surveys measure the table about 0.4 % apart).
- **Seams.** For every pixel the piece with the most detail wins: the layout's own orthophoto (1.5 mm per pixel) before the groups' (about 3.7), and a piece counts less towards its edge; the seams are blended over a few centimetres, and the pieces' exposure is matched where they overlap. The tables lie on several heights, so the raised decks do not line up exactly at the seams.
- **Only the table, in straight lines.** The photos also show what is around the table: the floor, the walls, the windows, chairs. Only what has the table's colour is kept (the lab's mint green, hue 138°: the main colour of the layout's own orthophoto; `--table` gives another one, `--table none` keeps everything), with what lies on it and the holes the survey left in it. The table is long and straight, so its outline is drawn in straight lines along it: its back and front edge, bites into them narrower than 500 mm (a window's glare, a shadow) bridged, bumps narrower than 150 mm cut off, within 15 mm. Outside it the flat grey, which the flyover leaves transparent: blank space where there is no table. The curve at the east end, seen at a slant across several levels, keeps a little of the window blinds; at Waldhof south a lower deck seen at a slant stays in.
- **Solid.** What no piece shows inside the table (the discs the survey left grey) is filled smoothly from around it. The result: 7570 × 903 px at 2 mm per pixel, `view.ortho.bounds_mm` = [−2603.4, −415.7, 12536.6, 1390.3].

### Waldhof: the layout extended along the window side

The layout of Bf Neustadt also covers **Waldhof south and Waldhof** (the marker groups S10 and S11 of the [photo map](#the-photo-map)): their photos open with it in the photo tour and are tracked, and its module *Waldhof* has the station's tracks and platforms and the RB 30 to Neustadt ([Rail lines](rail-systems.md#rail-lines)). Their markers were placed from the photos of 9 October 2026:

- **Read and placed.** The app's own detector read the markers in the photos of S03, S04, S10 and S11. Each photo, drawn from above through one of its markers, was matched (SIFT features) with the orthophoto of its group; that gave every marker a first place in the hall frame. A bundle adjustment then fitted all photos at once (one homography per photo, the layout's markers up to x = 3400 mm fixed, the groups' places as priors, each group with an offset and a turn of its own): 44 markers within 2.5 px. Markers that do not lie in one plane with the others (other decks; 105, 114, 117–119, 122, 149, 203, 206) were left out, as were the photos 132406, 132413 and 132418 (a lower deck seen at a slant) in the fit; the markers of the light-rail deck (86, 87, 147–150) are not in the map, as before.
- **The end of the old survey had drifted.** Beyond its own orthophoto (x > 3.7 m) the layout's first survey had grown by about 3 %: marker 19 lay 130 mm too far east. The photos of S03 and S04 that see these markers fit the new places better (0.4–0.7 px against 1.0–2.5 px; they took part in the fit), and the new places agree with the survey groups and their kilometre tags (0.1 km = 507 mm) within about 2 cm. Markers 14–25 moved; the tracks G1–G3, G14–G16 and the platforms moved with them, so they stay where the photos show them (platform 1 is now 222 m long). The town and the table modules were left as they were.
- **What is tracked.** Twelve photos of S10 and S11 have the digital layer (`layer: "neustadt"` in `web/lab-map/data.json`); those with fewer than two markers that fit, or that the check by eye did not pass (132332, 132434, 132859), stay photos only. S11 is placed only roughly on the photo map; through the markers it shares with S10 (111, 112, 163) the layout places it within a few centimetres.
- **Waldhof's tracks** (1, 2, 4, 5 and the two platforms) and the NBS on both laps were drawn after the orthophotos of S10 and S11 and the kilometre tags (22.0 and 23.0 of the first lap lie on its track). In the south throat of Waldhof, where several decks overlap and the orthophoto shows glare, they are approximate (a few centimetres). The joined orthophoto of the flyover ends at Waldhof south (x ≈ 12.5 m); Waldhof itself is not in it yet.
- **The town** of Bf Neustadt reached over the front of the Waldhof table: its table module now ends at x = 8.3 m, a second one (Gartenring) carries the east of the garden town, whose northern streets moved back from the table (two houses of Amselweg had no room left).

### The S-Bahn's strip: how high it lies

The lab's light rail (Stadtbahn, the S-Bahn of the lab software) runs on a narrow deck along the windows, with its stops Pirna and Heidenau: their platforms are the white boards with the markers 84 and 85 (Pirna) and 86 and 87 (Heidenau), their signs stand behind them. The lab data call it the *upper* deck: in the photos it stands above the NBS directly in front of it, which runs partly under its front edge. How high the decks lie was an open question of the [topology](../examples/ebl/README.md); it was estimated from the photos of 9 October 2026:

- **The camera.** The photos of Bf Neustadt (1600 px) were taken with one camera: calibrated together on the layout's markers (one plane), its focal length is 1149 px (rms 1.9 px). The Waldhof photos (1200 px) are the same camera, scaled.
- **Markers triangulated.** Seen from the front and from the back of the table, the markers 86, 87, 147 and 148 on the deck lie at the station table's level, −7 to +2 mm: their rays meet at 29–96° within 4–11 mm at that level, and would miss each other by 30–150 mm 40 mm higher. The method finds the layout's own markers within 3 mm and 0.3°. These four markers are now in the layout's marker map.
- **Plane sweep.** A photo from the front and one from the back, drawn onto a plane at a height h, agree best at the true height of what lies there (in bands of 200 mm along the deck): about 60 mm at the Pirna end (x ≈ 200), 50 mm at x 400–600, 40–30 mm at x 800–1200, 20 mm at x 1600–1800, 10 mm at x 2000, and the table's level from x ≈ 2200 on to Heidenau. Features matched between the photos and triangulated give the same picture, and put the NBS in front of the deck about 40 mm below the table towards Heidenau.
- **The tracks and platforms** were read from the photos drawn onto the deck at these heights, from the front and from the back: two tracks about 60 mm apart, which come nearer the front towards Heidenau; at Pirna the platform lies between them (an island), at Heidenau in front of both. Drawn into the photos they lie on the rails and the boards.

The module *S-Bahn* of Bf Neustadt has the deck as table modules at these levels: flat ones, so the ramp is a staircase (8, 22, 38 and 56 mm towards Pirna, with Pirna's platform on the top one). It has its two tracks, the platforms on the white boards, with their edge on track 2, and the S 10, which runs on track 2 (short ET 442 units, as the 54 m platforms take) and turns at Heidenau. The NBS in front of it is still drawn at the table's level, and the deck at Hauptbahnhof (Waldhof south, not seen from both sides) is not measured yet. The town behind the curve now begins behind the strip (y = 990 mm).

## The photo map

The [photo map](../web/lab-map/) (on the site at `lab-map/`) shows the photos of 9 October 2026 on a map of the lab: each dot is a photo, at the place on the table it looks at, with an arrow for the direction of view. A click opens the photo; where a layout of ARail covers that part of the table (Bf Neustadt, the hybrid container train), **Open with the digital layer** opens it in the app's [photo tour](getting-started.md#the-photo-tour) (`app/?photo=<id>`) with that layout, which tracks it like any photo; from there the arrows go on round the lab. `lab-map/?photo=<id>` opens a photo directly (the id is the time it was taken, `hhmmss`).

- **How the map is made.** The whole lab cannot be one survey: its tables lie on several heights, and `arail-survey` models one plane. So the markers were grouped into stations (marker groups that are seen together), each surveyed on its own with its own orthophoto, and the groups were joined through the markers they share. Each photo is placed with the homography of the group it shows the most markers of: the centre of the picture is the dot.
- **What is measured and what is estimated.** Along the window side, the groups from Neustadt to Waldhof are joined through shared markers, and Waldhof through the kilometre tags on the tracks: 0.1 km of the lab's line kilometres is 507 mm of table. The inner side (Adorf), the door, the left end of the ring (Klausenburg and Feldberg) and the curve at the Neustadt end are not joined to the rest yet, and their places are estimated; that Klausenburg and Feldberg lie at the left end is information from the lab. Their outlines on the map are dashed. Room 06, to the right of the hall, is not on the map yet. What the photos and the lab data tell about the laps of the lines round the hall, the tracks side by side and the track labels is in [`examples/ebl`](../examples/ebl/README.md).
- **Which photos are on it.** Photos with people in them are left out (checked by eye and with a person detector), as are the long videos. The photos are scaled down (1600 px for those of Bf Neustadt and the container train, 1200 px for the others, Waldhof's among them) and carry no metadata. The orthophotos were made from the photos only, without the left-out ones.
- `web/lab-map/data.json` lists the groups (their pose in the hall frame, mm: x along the window wall towards Waldhof, y towards the windows, and their orthophoto) and the photos (place, dot, direction, the kilometre tags read in the picture, the layer, and `covered`: a covered version of the photo, made by hand and pushed with the [builder](world-builder.md#covered-photos), which the photo tour shows instead). It is made from the survey with a script that reads the raw footage, which stays outside the repository.
