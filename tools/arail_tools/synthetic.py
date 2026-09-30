"""Synthetic model-railway scene for tests and examples.

A flat H0 board with two platforms (70 mm and 37 mm wide, as on the EBL layout) and
ArUco markers 0-7, rendered by a pinhole camera with a known focal length along a
slightly shaking camera path. Some markers are temporarily covered by a "hand".

Board coordinates are texture coordinates: x to the right, y *down*, in mm. The layout
frame used by ARail (x right, y up, origin at marker 0) is related by ``BOARD_FROM_LAYOUT``.

Command line:  arail-synthetic out.jpg [--frame K]
"""

from __future__ import annotations

import argparse
import math

import numpy as np

try:
    import cv2
except ImportError as exc:  # pragma: no cover - depends on the installation
    raise SystemExit("OpenCV is required: pip install -e 'tools[opencv]' (or [headless])") from exc

PX_PER_MM = 4  # texture pixels per mm
BOARD_MM = (800, 500)
F_TRUE = 950.0
IMAGE_SIZE = (1280, 720)
K_TRUE = np.array([[F_TRUE, 0, IMAGE_SIZE[0] / 2], [0, F_TRUE, IMAGE_SIZE[1] / 2], [0, 0, 1.0]])
DICTIONARY = "DICT_ARUCO_ORIGINAL"
MARKER_SIZE_MM = 30.0

# Platforms as on the real layout: 70 mm and 37 mm wide, markers centred at the ends.
PLATFORMS = [
    dict(y=180.0, width=70.0, start=130.0, end=570.0),
    dict(y=355.0, width=37.0, start=130.0, end=570.0),
]
PLATFORM_LENGTH_MM = 440.0
# marker id -> (x_mm, y_mm, rotation_deg) in board coordinates; rotated on purpose
MARKERS = {
    0: (130, 180, 0),
    1: (570, 180, 0),
    2: (130, 355, 30),
    3: (570, 355, 90),
    4: (40, 40, 0),
    5: (760, 40, 0),
    6: (40, 460, 0),
    7: (760, 460, 0),
}
# Layout frame of marker 0 -> board coordinates
BOARD_FROM_LAYOUT = np.array([[1.0, 0, 130], [0, -1.0, 180], [0, 0, 1]])


def marker_poses_layout() -> dict[int, list[float]]:
    """True marker poses in the layout frame (marker 0 at the origin): id -> [x, y, rot_deg]."""
    out = {}
    for mid, (x, y, rot) in MARKERS.items():
        out[mid] = [float(x - 130), float(180 - y), float(rot)]
    return out


def texture(dictionary: str = DICTIONARY) -> np.ndarray:
    """Top view of the board (BGR), PX_PER_MM pixels per mm."""
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dictionary))
    w, h = BOARD_MM
    t = np.full((h * PX_PER_MM, w * PX_PER_MM, 3), (70, 110, 80), np.uint8)
    noise = np.random.default_rng(1).integers(-12, 12, t.shape[:2])
    t = np.clip(t.astype(int) + noise[..., None], 0, 255).astype(np.uint8)

    def rect(x0, y0, x1, y1, colour):
        cv2.rectangle(
            t, (int(x0 * PX_PER_MM), int(y0 * PX_PER_MM)), (int(x1 * PX_PER_MM), int(y1 * PX_PER_MM)), colour, -1
        )

    for yc in (120, 265, 420):  # tracks
        rect(20, yc - 18, 780, yc + 18, (95, 105, 115))
        for dy in (-8, 8):
            rect(20, yc + dy - 1, 780, yc + dy + 1, (170, 170, 175))
    for p in PLATFORMS:
        rect(p["start"] - 20, p["y"] - p["width"] / 2, p["end"] + 20, p["y"] + p["width"] / 2, (175, 180, 185))
    s = int(MARKER_SIZE_MM * PX_PER_MM)
    for mid, (x, y, rot) in MARKERS.items():
        m = cv2.aruco.generateImageMarker(d, mid, s)
        pad = 8 * PX_PER_MM
        big = np.full((s + 2 * pad, s + 2 * pad), 255, np.uint8)
        big[pad : pad + s, pad : pad + s] = m
        if rot:
            M = cv2.getRotationMatrix2D((big.shape[1] / 2, big.shape[0] / 2), rot, 1.0)
            big = cv2.warpAffine(big, M, big.shape[::-1], flags=cv2.INTER_LINEAR, borderValue=255)
        cx, cy, hh = int(x * PX_PER_MM), int(y * PX_PER_MM), big.shape[0] // 2
        t[cy - hh : cy - hh + big.shape[0], cx - hh : cx - hh + big.shape[1]] = big[..., None]
    return t


def camera_pose(k: int) -> tuple[np.ndarray, np.ndarray]:
    """Frame k of the camera path: about 45 degrees from above, slightly shaking."""
    target = np.array([400.0, 265.0, 0.0])
    cam = np.array([400.0 + 60 * math.sin(k * 0.05), 265 + 650 + 20 * math.cos(k * 0.07), -650.0])
    f = target - cam
    f /= np.linalg.norm(f)
    x = np.cross([0, 1, 0], f)
    x /= np.linalg.norm(x)
    R = np.array([x, np.cross(f, x), f])
    return R, -R @ cam


def render(tex: np.ndarray, k: int, hidden=()) -> tuple[np.ndarray, np.ndarray]:
    """Render frame k; ``hidden`` marker IDs are covered by a "hand".
    Returns the BGR image and the homography board (mm) -> image (px)."""
    R, t = camera_pose(k)
    Hw = K_TRUE @ np.column_stack([R[:, 0], R[:, 1], t])
    S = np.diag([PX_PER_MM, PX_PER_MM, 1.0])
    img = cv2.warpPerspective(tex, Hw @ np.linalg.inv(S), IMAGE_SIZE, flags=cv2.INTER_AREA, borderValue=(40, 40, 40))
    for mid in hidden:
        x, y, _ = MARKERS[mid]
        p = Hw @ [x, y, 1]
        cv2.circle(img, (int(p[0] / p[2]), int(p[1] / p[2])), 45, (60, 80, 120), -1)
    img = cv2.GaussianBlur(img, (3, 3), 0.8)
    noise = np.random.default_rng(k).normal(0, 3, img.shape)
    return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8), Hw


def layout_homography(Hw: np.ndarray) -> np.ndarray:
    """Homography layout frame (mm) -> image (px), normalised to H[2,2] = 1."""
    H = Hw @ BOARD_FROM_LAYOUT
    return H / H[2, 2]


def hidden_markers(k: int) -> list[int]:
    """Occlusions along the camera path: marker 1 for a while, later both markers of platform 2."""
    if 60 <= k < 90:
        return [1]
    if 110 <= k < 130:
        return [2, 3]
    return []


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render the synthetic test layout")
    ap.add_argument("output", help="image file, e.g. synthetic.jpg")
    ap.add_argument("--frame", type=int, default=12, help="frame of the camera path")
    ap.add_argument("--dictionary", default=DICTIONARY)
    args = ap.parse_args(argv)
    img, _ = render(texture(args.dictionary), args.frame)
    cv2.imwrite(args.output, img, [cv2.IMWRITE_JPEG_QUALITY, 85, cv2.IMWRITE_JPEG_OPTIMIZE, 1])
    print("written:", args.output)


if __name__ == "__main__":
    main()
