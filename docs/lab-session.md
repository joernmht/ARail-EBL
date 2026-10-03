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

Use the app for a quick check in the lab; use `arail-survey` for the layout that goes into the repository. Both assume that all markers lie on one plane; for a layout with levels (embankments, bridges, a raised station, hills) or for a control desk, `arail-survey --3d` measures the height and tilt of every marker as well: see [Levels, ramps and control desks](#levels-ramps-and-control-desks-the-3d-survey).

## Before the visit

- [ ] **Marker type and size.** One dictionary for the survey and for live use (see [choosing a dictionary and the IDs](lab-setup.md#choosing-a-dictionary-and-the-ids)): ArUco Original as on the EBL layout, or ArUco 4x4 for the most robust detection of small markers; 30 mm black square. Filming from more than about 1.4 m away needs 40 mm or more (see [Setting up a lab](lab-setup.md#size)).
- [ ] **How many.** One marker every 30–40 cm in both directions over the whole table, plus one at each end of every platform and at the table corners. For a table of *L* × *W* metres that is about (*L*/0.35 + 1) × (*W*/0.35 + 1) markers, e.g. 3.5 × 1.4 m: 11 × 5 = 55. Use the IDs 0 … N−1 and set `markers.codes` = N in the layout file (e.g. 55 for IDs 0–54; the default is 50). `arail-survey` takes it from `--layout`, or from `--codes`.
- [ ] **Print the sticker sheets** on the [marker page](https://joernmht.github.io/ARail-EBL/markers/) (`web/markers/` locally): marker type, the IDs (e.g. `0-54`, nothing beyond N−1), size, white border at least 6 mm, cut lines on. Use **matte sticker paper** (full-sheet A4 labels; glossy paper reflects the lights). Print at 100 % ("actual size", not "fit to page").
- [ ] **Check the 100 mm bar** on every sheet with a ruler. If it is off, note the real size of the black square and use it (`--size`, Build → Layout → Marker size) instead of reprinting.
- [ ] **Every ID once.** Two stickers with the same ID break the survey (the report names IDs seen twice in one frame).
- [ ] **Levels?** Raised parts or ramps on the table, or a control desk to survey: plan the [3D survey](#levels-ramps-and-control-desks-the-3d-survey) (markers on every level, films from many directions, a few heights measured with a ruler).
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

## Levels, ramps and control desks: the 3D survey

The survey above assumes that all markers lie on one plane. A layout with **levels** (a line on an embankment or a bridge, a raised station, a hill) and ramps between them breaks that assumption, and so does anything that is not flat at all, such as a **control desk** with a sloping panel: markers off the plane end up in the wrong place, or are rejected. `arail-survey --3d` measures the full pose of every marker (position with height, rotation and tilt) and gives every frame a camera of its own.

### Sticking the markers

- [ ] **Origin marker 0 on the base level** (the table), as above, and **at least three markers spread out on its level**: z = 0 is the plane the origin marker shares with them. One sticker alone would define the plane poorly (a tilt of 1° is 6 cm in height 3.5 m away).
- [ ] **Markers on every level** as on the table (every 30–40 cm), **also on ramps** (they may lie tilted; slopes are measured) and on walls or desk fronts if you want them (upright is fine).
- [ ] **Where levels meet** (bottom and top of a ramp, both sides of a step or a bridge abutment): every level must be seen in many frames together with markers of its neighbours, or it cannot be connected.
- [ ] **Near the edges of levels**: the orthophoto takes the height of every point from the level the frames agree on; where the surface shows no texture, the level of the nearest marker decides.

### Filming

- [ ] **One camera setting for the whole film**: the 3D survey estimates the focal length and the lens distortion of every video (and of all photos of one size), so: the main camera (1×), no zoom, focus and exposure locked, and **video stabilisation off** if the phone lets you (it shifts the image from frame to frame). Photos and videos are different cameras (the video uses a crop of the sensor); both are fine, each gets its own.
- [ ] **From many directions**: heights come from seeing markers from different sides. Besides the lawn-mower passes, **walk around raised parts** and film each level obliquely (40–60°) from at least two opposite sides; film the ground behind raised parts from the far side too.
- [ ] Optional: a [calibration](calibration.md) of the camera in the same setting (`--calibration`) fixes the camera instead of estimating it; useful when the film shows the markers mostly from one direction.

### Measuring by hand

- [ ] **Heights**: with a ruler, the height of 2–3 markers on every raised level above the table (above z = 0, the plane of the origin marker): `--height ID MM` for each. They are compared with the survey, not used by it.
- [ ] **A long distance** between two marker centres, as above (`--distance A B MM`, measured in space).

### Processing

```bash
arail-survey lab.mp4 photos/*.jpg --3d --layout web/layouts/ebl-lab.json \
    -o web/layouts/ebl-lab.json --report survey-report.json \
    --ortho web/media/ebl-lab-ortho.jpg --check check.jpg \
    --height 23 62 --height 31 62 --distance 0 37 2850
```

- `--3d` is implied when the layout already has 3D poses. All other options work as above; `--refine-fixed`, `--moving`, `--resurvey` too.
- The layout gets six numbers per marker, `[x_mm, y_mm, rotation_deg, z_mm, tilt_deg, tilt_dir_deg]` (see [poses in 3D](layout-format.md#poses-in-3d)); 2D poses of an older survey count as flat at z = 0.
- The summary names the camera of every input (focal length, how well it is determined, field of view, k1), lists z and tilt of every marker and its **level**, and the levels: horizontal ones with their height, inclined ones with their slope and direction (e.g. "inclined 2.9 degrees towards 180 degrees"). The report has them too (`cameras`, `levels`, `layout_plane`, `heights`).
- Time: the adjustment takes about 30 s for a 3-minute video of a 3.5 m table, the orthophoto 10–30 s.

| Warning | What to do |
| --- | --- |
| The focal length of the camera of … is poorly determined | film the markers from more directions and tilts, or give a `--calibration` |
| The camera of … distorts strongly | the main camera (1×), not the wide-angle one, or a `--calibration` |
| Fewer than three markers lie on one plane with the origin marker | put more markers on the origin marker's level, spread out |
| Measured and surveyed heights differ | measured from the plane of the origin marker? a sticker not flat? |
| Marker N could not be placed: its pose cannot be told from the K frames that show it | film it closer and from more directions: seen small or from one side only, a marker's two possible tilts look alike |

The other warnings mean what they mean above. In the **check image**, markers off the layout plane have their height in the label (e.g. "23 +62"), and the outlines on every level must lie on the stickers; raised levels appear where they are seen from straight above.

### In the app

The app reads layouts surveyed in 3D, keeps the heights and tilts and writes them back when it exports the layout. **Build → Marker map** shows the height (column *Z*) and marks markers off the layout plane; the flyover draws the stickers at their height. **Live tracking uses only markers on the layout plane for now** (within 2 mm and 2°): keep markers of the base level in view. Objects are still placed on the plane, and the flyover draws the orthophoto on it.

### Control desks

Survey each control desk as a layout of its own: its own stickers with IDs of their own (e.g. 200–219 for desk A, 220–239 for desk B), one of them as the origin, and a film of the desk alone (other stickers out of view):

```bash
arail-survey desk-a.mp4 --3d --origin 200 --codes 220 -o desk-a.json --report desk-a-report.json
```

The desk's frame is then its own (z = 0 is the plane most of its markers share with the origin marker, e.g. its sloping panel), independent of the table's.

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
