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
- **Keep positions** locks the marker map (in the app: Build → Marker map; `arail-survey` writes `markers.locked`). Live mode then accepts only the measured sticker IDs: nothing is surveyed, unknown and misread IDs are ignored, a sticker whose position does not fit is dropped as an outlier, and the detector reads only the codes up to the highest ID (fewer codes: more bit errors corrected safely). The HUD says "Tracking · 5 markers · locked". **Unlock** opens the map again.
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

`web/media/synthetic-ortho.jpg` comes from the synthetic test video (`npm run fixtures`). The synthetic layout has no marker poses; the map the app measures from its single photo is up to 3 cm off, so the orthophoto lines up with the markers only after a video survey (**Survey a video…** with `tests/fixtures/synthetic-survey.webm`, then **Keep positions**):

```bash
arail-survey tests/fixtures/synthetic-survey.webm --every 1 --layout web/layouts/synthetic-demo.json \
    -o synthetic.json --ortho web/media/synthetic-ortho.jpg --ortho-bounds -130 -320 670 180
```

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
