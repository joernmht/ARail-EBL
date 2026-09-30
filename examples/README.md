# Examples

| File | Content | Used by |
| --- | --- | --- |
| `media/ebl-lab-photo.jpg` | Photo of the EBL layout with markers 0–4 (Pixel 9 Pro, 4080×3072, 30 September 2026) | test fixtures (`python -m arail_tools.fixtures`); a 1600 px copy without metadata is `web/media/ebl-lab.jpg` |
| `media/ebl-lab-video.mp4` | Handheld video of the same layout (16 s, 1920×1080) | trying video tracking: **Open file** in the app |
| `feeds/sample-trains.jsonl` | Two minutes of train positions recorded from the bridge's simulator on the EBL layout | `arail-bridge --adapter replay --file examples/feeds/sample-trains.jsonl --loop` |

In the video, the camera often points at parts of the layout without markers; tracking then pauses. More markers across the layout avoid this (see [Setting up a lab](../docs/lab-setup.md#placing-markers)).
