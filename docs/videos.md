# Videos of the lab: rendering and stabilizing

The videos on the project page are drawn by the app itself, frame by frame, over clips of the lab
filmed with a phone. This guide describes how they are made, how the town video was stabilized in
several steps, and which of those steps could run live in the app.

The scripts that made the videos were written for these videos and are not in the repository; the
steps below are what they do, with the settings used.

## Rendering a clip frame by frame

- The app runs in headless Chromium (Playwright) with the layout of the clip
  (`app/?layout=…` or `app/?example=…`).
- `requestAnimationFrame` is replaced by a stepper. For output frame *i* the video is set to
  (*i* + 0.5) / 30 s, then the app runs one frame of 1/30 s: marker detection, tracking, the
  simulation and the drawing. The canvas is saved as a JPEG. So the result does not depend on how
  fast the machine is, and every frame sees the simulation at the same time as the picture.
- The clip is converted to WebM (VP9) with a key frame on every frame (`-g 1`): seeking is then exact
  (and headless Chromium cannot play H.264).
- The name tags are switched off and the markers covered (View → Show → Cover the markers).
- The sky and the horizon of the town video are drawn by a script added to the page for the video;
  they are not part of the app.

## Why the overlay slides

Each frame's pose comes from the markers seen in that frame (see
[Tracking without calibration](architecture.md#tracking-without-calibration)). In the town clip they
are few, small and far away: their pose jitters by a few pixels from frame to frame. Near the end of
the clip, only two markers are seen, and their pose wanders. The tracker's smoothing damps small
changes and follows large ones at once. That removes the jitter. But it can only follow the markers,
so where their pose is wrong, the town slides against the picture, and it snaps back when they agree
again.

The measure used is the **slip**: how far a point of the layout, as the overlay draws it, moves
against the picture. The picture's own motion of the table plane is step 3 below. The slip is taken
per frame, and as the sum over one second, because a slow slide is what the eye sees.

## The stabilization, step by step

1. **Raw poses.** A first pass through the clip records, for every frame, the homography from the
   markers of that frame only (no smoothing), the tracker's smoothed pose and the focal length the
   camera has learned.
2. **One focal length.** The second pass uses the focal length learned by the end of the clip for
   all frames. The focal length decides how heights are drawn, so if it changes, buildings seem to
   breathe.
3. **The picture's motion.** For each pair of frames, the motion of the table plane in the image:
   - a mask of the pixels that see the table plane inside the tables and modules of the layout
     (through the raw pose);
   - up to 1500 corners in the mask (Shi–Tomasi), followed into the next frame with pyramidal
     Lucas–Kanade, and back again; a corner counts only if it comes back within 0.7 px;
   - one homography from the corners that are left, with RANSAC (1.5 px); a train passing through is
     left out as outliers.

   This gives *g<sub>i</sub>*, the motion of the table from frame *i* to *i* + 1. It is precise from
   one frame to the next, but adding up many steps makes it drift. The markers are the other way
   round: they are right on average, but noisy in each frame.
4. **Joining the two.** Take the four corners of a rectangle of the layout, the part the clip shows
   (−2000 to −500 × −300 to 600 mm). Their image paths *x<sub>i</sub>* are found as one
   least-squares problem over all frames:

   > Σ *w<sub>i</sub>* ‖*x<sub>i</sub>* − *r<sub>i</sub>*‖² + λ Σ ‖*x*<sub>*i*+1</sub> − *g<sub>i</sub>*(*x<sub>i</sub>*)‖²

   Here *r<sub>i</sub>* is where the markers' pose of frame *i* puts the corner, and λ = 2000. The
   weight is *w<sub>i</sub>* = 1 / (1 + (*e<sub>i</sub>* / 1.5 px)²), where *e<sub>i</sub>* is how
   far the markers' pose is from where the picture's motion carries the neighbouring frames
   (averaged over 9 frames). So the markers count only where they agree with the picture.
   The problem is solved with Gauss–Newton (the *g<sub>i</sub>* linearised at the last solution).
   For each corner this is one block-tridiagonal system of 2*n* unknowns. The homography of each
   frame then follows from its four corners. The result: the overlay moves with the picture, and the
   markers decide where it sits on average.
5. **Rendering again.** The second pass draws every frame with its solved pose (the tracker is
   skipped) and the fixed focal length.
6. **Composing.** The frames are cropped to a square and joined with crossfades. The last frames
   fade into the first, so the loop has no seam. Then they are encoded as H.264 (CRF 27,
   `-movflags +faststart`).

Before step 4, two simpler ways were tried; the table shows them too. Smoothing the corner paths
over time (a median of 5, then a Gaussian) removes the jitter, but without the picture's motion it
cannot tell a camera move from a marker error: the town still slides. A complementary filter follows
the picture's motion and pulls towards the markers by a fixed share; it slides less, but where the
markers are wrong for a while, it still pulls the town off the picture. The weight of step 4 is
what fixes that.

Measured on the town clip (300 frames, processed at 720 × 1280; four points along the curve):

| Poses | Slip per frame | Slip within 1 s (most) | Away from the markers' pose |
| --- | --- | --- | --- |
| markers of each frame | 2.9 px | 31.6 px | 0 |
| the app's tracker (live) | 1.7 px | 25.3 px | 1.4 px |
| median of 5, then Gaussian | 0.5 px | 19.4 px | 2.5 px |
| causal filter, fixed share 0.06 | 0.2 px | 15.7 px | 2.7 px |
| causal filter, share weighted by agreement | 0.01 px | 0.5 px | 4.5 px |
| **least squares (used)** | 0.01 px | 1.0 px | 4.6 px |

The two causal filters are explained under [What could run live](#what-could-run-live). The last
three rows follow the same image motion that the slip is measured against, so check them by eye too:
the town's rails on the curve's rails, frame by frame. The last column shows how far the overlay
moves away from the markers to stay steady (a few pixels).

## The terminal scene: one fixed frame

The terminal scene's second camera is a low view beside the model truck. There the camera moves a
lot, and only one layout marker (131) is seen. The model wagons' tags give the wagons' poses through
the camera's pose, so every error of the camera's pose moves the wagons, their plates and their
containers too. The method above would have to cope with the wagons and the truck close to the
camera, which stand out from the table plane. Instead, the scene uses one frame of the clip, held
with the app's **Freeze**: the pose of that frame is kept, the simulation runs on, and the crane
lifts the container off the wagon and sets it down on the truck while the picture stands still. A
slow push towards the truck in the composition keeps the picture alive.

## What could run live

| Step | Live? | How |
| --- | --- | --- |
| Marker detection, pose of each frame | yes | that is the app today |
| One focal length | yes | calibrate the camera ([Camera calibration](calibration.md)), or, once it is learned, keep it with − and + in View → Camera (set by hand, it no longer changes) |
| The picture's motion (step 3) | yes, at a reduced size | it needs only the last frame and this one. Natively (OpenCV, 4 threads) it takes 5–6 ms at 360 × 640 with 200 to 300 corners, and 35 ms at 720 × 1280 with 900 corners. In the browser (WebAssembly or JavaScript), expect two to four times as long, so 10–25 ms at the reduced size. That fits next to the detection on a laptop (the app keeps the detection at 20–45 ms by its resolution) but is tight on a phone; run it in a Web Worker. On a phone, the gyroscope can give the camera's turning. |
| Joining (step 4) as one solve | no | it uses the frames after each frame |
| Joining as a causal filter | yes | each frame: carry the last corner positions with the picture's motion, then move them a small share (0.06) towards the markers' pose, less when the markers disagree with the motion (the weight of step 4, from past frames only). One step per frame, no cost worth mentioning. On the town clip it is as steady as the solve (table above). It can only correct with what it has seen: after a stretch with bad markers, it catches up slowly instead of spreading the correction over both sides. A fixed-lag smoother lies between the two: it solves over the last ten frames and shows the picture one to three frames late. |
| Rendering with the solved pose | yes | the app draws live already; the video render is slow only because every frame is saved |
| The video's sky | yes | it only draws; a display option would need the horizon from the camera's pose |
| One fixed frame (Freeze) | yes | a button of the app already |

To bring it into the app, in this order:

1. A fixed focal length from calibration.
2. The picture's motion at a reduced size, in a worker.
3. The weighted causal filter in place of the tracker's present smoothing (`PlaneTracker._smooth`).

The tracker's accuracy thresholds (`tests/js/tracker.test.js`) and the slip on the lab's clips show
whether it is better.
