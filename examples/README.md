# Examples

| File | Content | Used by |
| --- | --- | --- |
| `media/ebl-lab-photo.jpg` | Photo of the EBL layout with markers 0–4 (Pixel 9 Pro, 4080×3072, 30 September 2026) | test fixtures (`python -m arail_tools.fixtures`); a 1600 px copy without metadata is `web/media/ebl-lab.jpg` |
| `media/ebl-lab-video.mp4` | Handheld video of the same layout (16 s, 1920×1080) | trying video tracking: **Open file** in the app |
| `media/ebl-terminal-crane.jpg` | The container terminal with its gantry crane and a container train, 10 markers (Pixel 9 Pro, 4080×3072, 9 October 2026, without metadata) | survey of `web/layouts/ebl-neustadt.json`; a 1600 px copy is `web/media/ebl-terminal.jpg` (**Example: terminal at the crane**) |
| `media/ebl-terminal-tracks.jpg` | Terminal tracks with container trains, 11 markers (same camera and day) | survey of `web/layouts/ebl-neustadt.json` |
| `media/ebl-station-neustadt.jpg` | Bf Neustadt with its platforms and a freight train, 12 markers (same camera and day) | survey of `web/layouts/ebl-neustadt.json`; a 1600 px copy is `web/media/ebl-neustadt.jpg` (**Example: Bf Neustadt**) |
| `media/ebl-station-yard.jpg` | A station throat with signals and locomotives, 8 markers (same camera and day) | trying photo tracking: **Open file** in the app (not in a layout yet) |
| `media/ebl-curve-trains.mp4` | Freight trains running through the curved part of the ring (10 s, 1080×1920, 30 fps, no audio) | survey of `web/layouts/ebl-neustadt.json`; the first scene of the project page's video (`web/media/ebl-city-train.mp4`): this clip with the town and a sky, cut square |
| `media/ebl-station-trains.mp4` | A station with trains and the terminal crane, panning along the table (10 s, 1920×1080, 30 fps, no audio) | survey of `web/layouts/ebl-neustadt.json`; compressed in `web/media/` (**Example: Bf Neustadt, video**) |
| `media/ebl-terminal-wagons.mp4` | Container wagons with labels (AprilTag 36h11, two per wagon) and a truck at the terminal (10 s, 1920×1080, 30 fps, no audio) | survey of `web/layouts/ebl-container-train.json`; a frame is `web/media/ebl-container-train.jpg` (**Example: hybrid container train**), and with `ebl-terminal-truck.mp4` the terminal scene of the project page's videos (the crane puts a container from a wagon onto the truck) |
| `media/ebl-terminal-truck.mp4` | Close-up of wagons and a truck with labels next to layout marker 131 (10 s, 1920×1080, 30 fps, no audio) | survey of `web/layouts/ebl-container-train.json`; **Open file** over that example; one frame of it, frozen, is the second camera of the project page's terminal scene |
| `feeds/sample-trains.jsonl` | Two minutes of train positions recorded from the bridge's simulator on the EBL layout | `arail-bridge --adapter replay --file examples/feeds/sample-trains.jsonl --loop` |

In the video, the camera often points at parts of the layout without markers; tracking then pauses. More markers across the layout avoid this (see [Setting up a lab](../docs/lab-setup.md#placing-markers)).

The surveys of these layouts are described in [Lab session](../docs/lab-session.md#the-examples-of-9-october-2026).
