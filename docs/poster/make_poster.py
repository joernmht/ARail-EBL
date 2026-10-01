"""Lab poster for ARail-EBL (DIN A1, German | English, with a camera calibration board).

Builds the spec for the chair's poster generator (`tud-poster` skill in the corporate-design
repo tud_cro_chaircd), then the poster itself:

    python docs/poster/make_poster.py [--cd ../tud_cro_chaircd]

Writes calibration-board.svg, qr-*.svg, arail-poster.json, arail-poster.html and
arail-poster.pdf next to this file. Needs opencv-python(-headless) and segno; the PDF needs
Chromium (see the tud-poster skill).

The board uses ArUco 4x4 (DICT_4X4_50), not the ArUco Original markers of the layout, so a
poster hanging in view of the AR camera never mixes with the layout's marker map.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import segno

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent

DICT = "DICT_4X4_50"
MARKER_MM = 40.0
GAP_MM = 10.0
COLS, ROWS = 6, 2
APP_URL = "https://joernmht.github.io/ARail-EBL/app/"
PAGE_URL = "https://joernmht.github.io/ARail-EBL/"


def marker_bits(dictionary, marker_id: int, n: int) -> list[list[int]]:
    img = cv2.aruco.generateImageMarker(dictionary, marker_id, n + 2, borderBits=1)
    return [[int(img[i + 1, j + 1] > 127) for j in range(n)] for i in range(n)]


def board_svg() -> tuple[str, float, float]:
    """The board as an SVG in millimetres (markers, IDs and a 100 mm scale bar)."""
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, DICT))
    n = d.markerSize
    cell = MARKER_MM / (n + 2)
    bar_y = ROWS * MARKER_MM + (ROWS - 1) * GAP_MM + 7
    w = COLS * MARKER_MM + (COLS - 1) * GAP_MM
    h = bar_y + 9
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" '
           f'viewBox="0 0 {w} {h}" shape-rendering="crispEdges">']
    for k in range(COLS * ROWS):
        r, c = divmod(k, COLS)
        x, y = c * (MARKER_MM + GAP_MM), r * (MARKER_MM + GAP_MM)
        out.append(f'<rect x="{x}" y="{y}" width="{MARKER_MM}" height="{MARKER_MM}" fill="#000"/>')
        for i, row in enumerate(marker_bits(d, k, n)):
            for j, b in enumerate(row):
                if b:
                    out.append(f'<rect x="{x + (j + 1) * cell:.4f}" y="{y + (i + 1) * cell:.4f}" '
                               f'width="{cell + 0.01:.4f}" height="{cell + 0.01:.4f}" fill="#fff"/>')
        out.append(f'<text x="{x + MARKER_MM / 2}" y="{y + MARKER_MM + 3.6}" font-size="3" '
                   f'text-anchor="middle" fill="#566371" font-family="Noto Sans">{k}</text>')
    # 100 mm scale bar: check it with a ruler after printing
    out.append(f'<rect x="0" y="{bar_y}" width="100" height="2.2" fill="#0A777F"/>')
    for t in range(0, 101, 10):
        out.append(f'<rect x="{min(t, 99.7)}" y="{bar_y - 1.2}" width="0.3" height="4.6" fill="#0A777F"/>')
    out.append(f'<text x="104" y="{bar_y + 2.4}" font-size="3.6" fill="#0A777F" font-family="Noto Sans">'
               f'100 mm · Marker / marker {MARKER_MM:.0f} mm · ArUco 4×4 ({DICT}), ID 0–{COLS * ROWS - 1}'
               f'</text>')
    out.append("</svg>")
    return "".join(out), w, h


def qr_svg(url: str, label: str) -> str:
    """QR code with a label underneath, as one SVG (for a footer sub-logo slot)."""
    q = segno.make(url, error="m")
    m = q.matrix
    size, quiet = len(m), 1
    s = size + 2 * quiet
    rects = "".join(f'<rect x="{j + quiet}" y="{i + quiet}" width="1.02" height="1.02"/>'
                    for i, row in enumerate(m) for j, v in enumerate(row) if v)
    lh = s * 0.2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s + lh}">'
            f'<rect width="{s}" height="{s + lh}" fill="#fff"/><g fill="#00008C">{rects}</g>'
            f'<text x="{s / 2}" y="{s + lh * 0.7}" font-size="{lh * 0.75:.2f}" text-anchor="middle" '
            f'fill="#00008C" font-family="Noto Sans" font-weight="500">{label}</text></svg>')


DE = """ARail legt eine virtuelle Welt über die H0-Anlage des Labors: Bahnsteige mit Fahrgästen, eine Stadt mit Straßen und Buslinien, Tag und Nacht, Störungen und Szenarien für Übungen. Alles läuft im Browser, ohne Installation.

- **Ausprobieren:** QR-Code scannen, *Live camera* wählen und die Kamera auf die Anlage richten.
- Die schwarz-weißen **Marker** auf der Anlage verankern das Bild. Bitte nicht verschieben.
- **F** öffnet den Überflug: die Anlage mit einer virtuellen Kamera ansehen und bauen."""

EN = """ARail lays a virtual world over the lab's H0 layout: platforms with passengers, a town with streets and bus lines, day and night, disruptions and scenarios for exercises. Everything runs in the browser, nothing to install.

- **Try it:** scan the QR code, choose *Live camera* and point the camera at the layout.
- The black-and-white **markers** on the layout anchor the image. Please do not move them.
- **F** opens the flyover: look at and build the layout with a virtual camera."""


def summary_html(board: str, w: float) -> str:
    cmd = f"arail-calibrate --images fotos/*.jpg<br>--dictionary {DICT} --marker-size {MARKER_MM:.0f}"
    p = 'style="margin:0 0 3mm;font-size:18pt;line-height:1.4;text-align:left"'
    b = 'style="color:#0A777F;font-weight:600"'
    code = ('<p style="margin:0 0 3mm;font:500 15pt/1.35 monospace;color:#00008C;'
            f'background:#EEF4F5;padding:1.5mm 2.5mm">{cmd}</p>')
    text = (
        f'<div style="flex:1;min-width:0"><p {p}><span {b}>DE</span> Nur für Weitwinkel-Webcams nötig, '
        'sonst schätzt ARail die Brennweite selbst. Mit 100 % drucken (Balken = 100 mm), 15–30 Fotos '
        'um 30–60° geneigt, auch in den Bildecken; dann:</p>' + code +
        f'<p {p}><span {b}>EN</span> Only needed for wide-angle webcams. Print at 100 %, take 15–30 '
        'photos tilted 30–60°, also into the corners, run the command, then load the file: '
        '<i>View → Camera → Load calibration</i>.</p></div>')
    return ('<div style="display:flex;gap:9mm;align-items:flex-start">'
            f'<div style="flex:0 0 {w}mm;width:{w}mm;line-height:0">{board}</div>{text}</div>')


def spec(board: str, w: float) -> dict:
    return {
        "lang": "de",
        "theme": "bars",
        "layout": "bilingual",
        "kind": "Eisenbahnbetriebslabor (EBL) · Railway operations laboratory",
        "title": "ARail-EBL",
        "intro": "Augmented Reality für die Modellbahn im Labor\\\n"
                 "*Augmented reality for the model railway lab*",
        "figure": {
            "src": "../../web/assets/ebl-lab-ar.jpg",
            "fit": "cover", "position": "50% 52%",
            "caption": "Die Laboranlage mit ARail: Bahnsteige mit wartenden Fahrgästen und Abfahrtstafeln, "
                       "nur aus den gedruckten Markern registriert. · The lab layout in ARail: platforms "
                       "with waiting passengers and departure boards, registered from the printed markers alone.",
        },
        "columns": [
            {"heading": "Was zeigt ARail?", "body": DE},
            {"heading": "What does ARail show?", "body": EN},
        ],
        "summary": {"heading": "Kalibriertafel · Calibration board",
                    "body": summary_html(board, w)},
        "contact": [
            ["Labor / Lab", "Eisenbahnbetriebslabor (EBL)"],
            ["App", APP_URL.removeprefix("https://")],
            ["Projekt / Project", "github.com/joernmht/ARail-EBL"],
        ],
        "sublogos": ["qr-app.svg", "qr-project.svg"],
        "footer_logo": "chair",
        "style": {"--para-gap": "6pt"},
    }


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cd", default=str(REPO.parent / "tud_cro_chaircd"),
                    help="checkout of the corporate-design repo (with skills/tud-poster)")
    ap.add_argument("--no-pdf", action="store_true")
    a = ap.parse_args(argv)
    board, w, h = board_svg()
    (HERE / "calibration-board.svg").write_text(board)
    (HERE / "qr-app.svg").write_text(qr_svg(APP_URL, "App"))
    (HERE / "qr-project.svg").write_text(qr_svg(PAGE_URL, "Projekt · Project"))
    sp = spec(board, w)
    path = HERE / "arail-poster.json"
    path.write_text(json.dumps(sp, ensure_ascii=False, indent=2) + "\n")
    tool = Path(a.cd) / "skills/tud-poster/scripts/poster.py"
    cmd = [sys.executable, str(tool), "build", str(path)] + ([] if a.no_pdf else ["--pdf"])
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
