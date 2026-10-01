# Lab poster

`arail-poster.pdf`: DIN A1 poster for the EBL, German and English (English in italics). The same
lab photo is shown split: real on the left, with ARail on the right. QR codes to the project page
and the app sit on the image. Three icon rows explain what ARail shows, how the markers replace
calibration, and how to try it. Print at 100 %.

The poster is built with the chair's `tud-poster` skill. Its source (spec, images) is in the
corporate-design repo `tud_cro_chaircd`, under `Posters/arail-ebl/`:

```bash
python3 skills/tud-poster/scripts/poster.py build Posters/arail-ebl/arail-ebl-lab-poster.json --pdf
```
