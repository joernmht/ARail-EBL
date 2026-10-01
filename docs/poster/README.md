# Lab poster

`arail-poster.pdf`: DIN A1 poster for the EBL, German left, English right, with a camera
calibration board (12 ArUco 4×4 markers, `DICT_4X4_50`, IDs 0–11, 40 mm) and QR codes to the app
and the project page. Print at **100 %** and check the 100 mm bar with a ruler.

The board uses a different dictionary than the layout's ArUco Original markers, so the poster
does not interfere with tracking when it hangs in view of the camera. Calibrate with

```bash
arail-calibrate --images photos/*.jpg --dictionary DICT_4X4_50 --marker-size 40
```

(see [Camera calibration](../calibration.md)).

Rebuild with `python docs/poster/make_poster.py` (needs `opencv-python-headless`, `segno` and a
checkout of the chair's corporate-design repo `tud_cro_chaircd` next to this one, for its
`tud-poster` skill and the `bilingual` layout; `--cd PATH` points elsewhere).
