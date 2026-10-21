# Live AR on XR glasses (ARail Live)

**ARail Live** (`web/live/`, on the site at [`live/`](https://joernmht.github.io/ARail-EBL/live/)) is a page of its own for live AR with XR glasses or a phone: the layout's town with its moving cars over the camera image, nothing else. It is a proof of concept for live use and a performance test at the same time: the numbers in its upper left corner show how fast each part is, and one key switches between its way of drawing and the app's.

It reuses the framework's modules (marker detection and tracking, the world and its objects, the `View`, the road traffic) and loads none of the rest: no platforms with passengers, no stops and lines, no terminal, no modules or stories, no panels.

## Trying it

| Link | What it shows |
| --- | --- |
| [`live/?source=demo`](https://joernmht.github.io/ARail-EBL/live/?source=demo) | No camera needed: a visitor's head in front of the town of Bf Neustadt looks around and steps aside now and then |
| [`live/?source=demo&cache=0`](https://joernmht.github.io/ARail-EBL/live/?source=demo&cache=0) | The same, drawn as the app draws: everything in every frame (compare the numbers) |
| [`live/?source=clip`](https://joernmht.github.io/ARail-EBL/live/?source=clip) | The clip of Bf Neustadt from the lab, tracked from its markers (the clip is H.264: Chrome, Edge, Safari) |
| [`live/`](https://joernmht.github.io/ARail-EBL/live/) | The camera (needs https; on a phone the back camera) |
| [`live/?bg=black`](https://joernmht.github.io/ARail-EBL/live/?bg=black) | The camera, but only the virtual layer is shown: for see-through glasses |

The settings (button **Settings** or key **S**) write themselves into the address, so a link keeps a test as it was set up.

## With XR glasses (VITURE Luma Ultra and others)

Glasses like the VITURE Luma Ultra are a display for a phone, tablet or computer, connected over USB-C (DisplayPort alternate mode). The page runs in the browser of that device and is shown in the glasses:

1. Connect the glasses, open the page on the device (https: the GitHub Pages link) and allow the camera. **Full screen** (or **F**) and, on a phone, landscape.
2. Choose the camera in **Settings → Camera**: the phone's back camera, a webcam, or the glasses' own camera if the device offers it as a camera. The camera should look where you look: mounted on the glasses or held in front of them.
3. Two ways to see the layout:
   - **Camera image** (video see-through): the glasses show the camera image with the town on it. This needs no adjustment.
   - **Black** (optical see-through, **B**): the glasses show only the town and its cars; black is transparent in them, so the real table is seen through the glasses. The camera does not sit at your eye, so the picture must be fitted once: **Settings → Fit to the glasses** (or the arrow keys, **+**/**−**, **[**/**]**) shifts, scales and turns the whole view until the virtual streets lie on the real table. The fit is kept on the device; **0** resets it. It is exact for one working distance.
4. **H** hides the numbers.

## Why it is fast

The app draws the whole world in every frame: on a phone that is the town with its houses, windows and trees, 30–60 times a second. ARail Live draws as little as it can:

1. **Only the town and its traffic.** `live/scene.js` reduces the layout to its town (buildings, streets, trees, parking, traffic signs and lights, table modules) and its road traffic, in a world with a registry of only these simulations. The page loads a fraction of the framework.
2. **Markers in a worker.** A camera frame is scaled down and searched for markers in a worker (`live/detect-worker.js`) while the main thread simulates and draws. One frame is searched at a time, so the newest frame is always next. The camera image shown is the frame that was searched, so the town and the image move together (**Camera image → As it comes** shows the video as it arrives, with the town a frame behind).
3. **The town is drawn once and fitted.** `live/cache.js` draws the town into a picture of its own, larger than the image by a margin, and fits that picture to every new pose instead of drawing it again. The fit is the homography of a plane parallel to the table, from the pose the picture was drawn with to the new one, at the height that moves sample points of the town (the corners of the footprints, on the ground and on the roofs) closest to where the new pose sees them. The browser applies it as a CSS `matrix3d` on the picture's canvas: the compositor warps it on the GPU, and a frame without a new picture costs nearly nothing.
   - A camera that only **turns** (a head looking around) moves every point of the picture by one homography: the fit is exact, and the town is never drawn again.
   - A camera that **moves** sees the roofs shift against the ground (parallax), which no warp of a flat picture can follow. The town is drawn again when the error of the fit exceeds 2 px (**Settings → Town**), when the image leaves the picture, when the picture would be magnified or shrunk by more than 1.3, when the town or the marker map changes, and every 10 s (traffic lights).
   - Nothing of the town is above the horizon (a camera above the roofs sees all of it below the horizon): only the image below the horizon has to lie in the picture, so looking up does not ask for a new one.
4. **What moves is drawn in every frame**, on a canvas over the picture: cars, bikes, people on foot. A car behind a building would then be drawn over it; the outlines of the buildings that may hide a car (whose outline overlaps the car's and which are nearer to the camera) are cut out of that canvas in depth order with the cars, so the building of the picture shows through. One polygon per building instead of drawing it again.

## The numbers

| Row | What it says |
| --- | --- |
| Display | frames of the screen per second, and the time (ms) the main thread works per frame |
| Markers | camera frames searched per second, the time a search takes, the size of the frames searched (it adapts as in the app), where (worker or main thread); markers found and used for the pose, and how long after the frame was taken its pose is shown |
| Town | pictures drawn per second, the time a picture takes (median), the error of the fit now; how often each reason asked for a new picture: `first`, `error` (parallax), `edge` (the image left the picture), `zoom`, `behind` (the picture would pass behind the camera), `changed`, `refresh` |
| Cars | cars driving and parked, the time to draw what moves, buildings cut out of it |
| Simulation | the time of a simulation step |

Measured in this repository's test browser (Chromium without a GPU, 1280 × 720, the demo, 15 s; a CPU slowed down 4 times stands in for a phone):

| | Town drawn once | Everything in every frame |
| --- | --- | --- |
| Bf Neustadt, desktop CPU | 58 fps, 2.5 ms per frame (picture: 2.5 per s, 19 ms each) | 32 fps, 20 ms per frame |
| Bf Neustadt, CPU slowed 4× | 28 fps, 12 ms per frame (picture: 2.0 per s, 82 ms each) | 7 fps, 83 ms per frame |
| Beta 0.1 (a smaller town), CPU slowed 4× | 22 fps, 12 ms per frame (picture: 3.0 per s, 38 ms each) | 12 fps, 34 ms per frame |

On the lab's clip (a camera carried along the table, moving all the time) the picture is drawn again for most frames searched: then it costs what the app costs, but no more. With marker detection on the main thread instead of the worker, the clip ran at 15 instead of 45 frames per second.

## Settings in the address

| Parameter | Default | Meaning |
| --- | --- | --- |
| `source` | `camera` | `camera`, `clip` (the lab's clip of Bf Neustadt, or `video=`), `demo` (no camera) |
| `layout`, `video` | Bf Neustadt, its clip | the layout (its town and road traffic), a clip of your own |
| `bg` | `camera` | `black`: only the virtual layer (see-through glasses) |
| `sync` | `synced` | `direct`: the video as it comes, the town a frame behind |
| `cache` | `1` | `0`: everything drawn in every frame, as in the app |
| `error`, `margin`, `res` | `2`, `20`, `100` | the error (px) that asks for a new picture, its margin (% of the image on each side), its resolution (%) |
| `occlusion` | `1` | buildings hide the cars behind them |
| `cars`, `bikes` | the layout's, `0` | cars per km of street; bikes and e-scooters |
| `speed`, `time` | `1`, the layout's | the simulation's speed; the time of day (`08:15`) |
| `worker` | `1` | `0`: markers found on the main thread |
| `hud` | `1` | `0`: no numbers |
| `#settings` | | the settings open |

Keys: **S** settings, **H** numbers, **F** full screen, **C** the town's picture on or off, **B** camera image or black; the arrow keys (with Shift: 10 px), **+** **−**, **[** **]** fit the view to the glasses, **0** resets the fit.

## Limits

- The town is drawn by day: a picture drawn once cannot follow the light of the clock.
- A camera that moves fast and close to tall buildings makes the picture be drawn often (see the numbers); the error allowed trades sharpness of the fit against drawing.
- Trees do not hide cars, and a building hides what is behind the convex outline of its footprint and roof (a car just past a gable can disappear a little early).
- Fitting to see-through glasses is a shift, scale and turn of the whole view, right for one working distance; a calibration of the glasses against the camera is not part of the proof of concept.
- The page is in English only.

## Code

| File | What it does |
| --- | --- |
| `web/live/live.js` | the page: sources, the worker, the frame loop, the three canvases of the stage, the numbers, settings and keys |
| `web/live/scene.js` | the reduced layout and registry, the buildings that may hide a car and their cut-outs, the demo's visitor (testable in Node) |
| `web/live/cache.js` | the town's picture: its size, the fit, the horizon, the CSS matrix (testable in Node) |
| `web/live/detect-worker.js` | marker detection in a module worker |

`World.draw(view, {objects, moving})` draws a part of the world: the live page draws the town with `moving: false` and what moves with `objects: []`. Tests: `tests/js/live.test.js` (the reduction, the fit of a turning and a moving camera, the horizon, the CSS matrix, the cut-outs, the visitor, the parts of `World.draw`) and `tests/e2e/live.spec.js` (the demo, drawing in every frame, settings and keys, markers found in the worker). The architecture page has the page as the model *ARail Live*.
