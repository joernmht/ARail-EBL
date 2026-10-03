"""Synthetic model-railway scene for tests and examples.

A flat H0 board with two platforms (70 mm and 37 mm wide, as on the EBL layout) and
ArUco markers 0-7, rendered by a pinhole camera with a known focal length along a
slightly shaking camera path. Some markers are temporarily covered by a "hand".

Board coordinates are texture coordinates: x to the right, y *down*, in mm. The layout
frame used by ARail (x right, y up, origin at marker 0) is related by ``BOARD_FROM_LAYOUT``.

A second scene has levels, for the 3D survey (:func:`render_levels`): the board with a raised
level (a block 50 mm high), a ramp up to it and a marker on the block's front wall, rendered with
a z-buffer, so that the raised parts hide what lies behind them.

Command line:  arail-synthetic out.jpg [--frame K] [--levels]
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


# ---------------------------------------------------------------------------------- scene with levels

LEVEL_HEIGHT_MM = 50.0
RAMP_SLOPE = math.atan2(LEVEL_HEIGHT_MM, 300.0)  # 50 mm over 300 mm, about 9.5 degrees


def _frame3(origin, eu, ev) -> dict:
    eu, ev = np.asarray(eu, float), np.asarray(ev, float)
    return {"o": np.asarray(origin, float), "u": eu, "v": ev, "n": np.cross(eu, ev)}


# Flat pieces of the scene in the layout frame (mm, z up; marker 0 at the origin): a frame (origin
# and axes u, v along the piece, normal n = u x v towards the viewer), its size along u and v, and
# the base colour of its texture. Seen from above, the block covers x 420..700, y 180..350; the
# ramp rises along x from x = 120 to the block, between y 230 and 330.
_C, _S = math.cos(RAMP_SLOPE), math.sin(RAMP_SLOPE)
LEVEL_PIECES = {
    "board": (_frame3([-120, -170, 0], [1, 0, 0], [0, 1, 0]), (840, 540), (70, 110, 80)),
    "top": (_frame3([420, 180, LEVEL_HEIGHT_MM], [1, 0, 0], [0, 1, 0]), (280, 170), (95, 120, 150)),
    "front": (_frame3([420, 180, 0], [1, 0, 0], [0, 0, 1]), (280, LEVEL_HEIGHT_MM), (70, 80, 100)),
    "side": (_frame3([420, 350, 0], [0, -1, 0], [0, 0, 1]), (170, LEVEL_HEIGHT_MM), (60, 70, 90)),
    "back": (_frame3([700, 350, 0], [-1, 0, 0], [0, 0, 1]), (280, LEVEL_HEIGHT_MM), (65, 75, 95)),
    "end": (_frame3([700, 180, 0], [0, 1, 0], [0, 0, 1]), (170, LEVEL_HEIGHT_MM), (60, 70, 90)),
    "ramp": (_frame3([120, 230, 0], [_C, 0, _S], [0, 1, 0]), (300 / _C, 100), (110, 120, 125)),
}
# marker id -> (piece, u_mm, v_mm, rotation_deg in the piece)
LEVEL_MARKERS = {
    0: ("board", 120, 170, 0),
    1: ("board", 420, 170, 20),
    2: ("board", 720, 175, -35),
    3: ("board", 120, 440, 90),
    4: ("board", 290, 300, 0),
    5: ("board", 560, 280, 45),
    6: ("board", 30, 30, 0),
    7: ("board", 790, 40, 0),
    8: ("top", 80, 80, 0),
    9: ("top", 220, 120, 60),
    10: ("top", 200, 30, -20),
    11: ("ramp", 80, 50, 0),
    12: ("ramp", 230, 50, 180),
    13: ("front", 140, 25, 0),
}
LEVEL_IMAGE_SIZE = (1280, 720)
LEVEL_F = 1000.0
LEVEL_K = np.array([[LEVEL_F, 0, LEVEL_IMAGE_SIZE[0] / 2], [0, LEVEL_F, LEVEL_IMAGE_SIZE[1] / 2], [0, 0, 1.0]])


def level_marker_poses() -> dict[int, tuple[np.ndarray, np.ndarray]]:
    """True marker poses of the scene with levels: id -> (R, t), marker frame -> layout frame."""
    out = {}
    for mid, (piece, u, v, rot) in LEVEL_MARKERS.items():
        fr = LEVEL_PIECES[piece][0]
        c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        B = np.column_stack([fr["u"], fr["v"], fr["n"]])
        out[mid] = (B @ np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]]), fr["o"] + u * fr["u"] + v * fr["v"])
    return out


def level_textures(dictionary: str = DICTIONARY) -> dict[str, np.ndarray]:
    """Textures of the pieces (BGR, PX_PER_MM pixels per mm; row 0 at the far end of v)."""
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dictionary))
    rng = np.random.default_rng(2)
    out = {}
    for name, (_, (lu, lv), colour) in LEVEL_PIECES.items():
        w, h = int(round(lu * PX_PER_MM)), int(round(lv * PX_PER_MM))
        t = np.full((h, w, 3), colour, np.uint8)
        noise = rng.integers(-14, 14, (h, w))
        t = np.clip(t.astype(int) + noise[..., None], 0, 255).astype(np.uint8)
        # some structure: stripes along u (tracks on the board, the ramp and the top), dots on walls
        if name in ("board", "ramp", "top"):
            for k, vc in enumerate(np.arange(40, lv - 20, 95)):
                y0, y1 = int((lv - vc - 18) * PX_PER_MM), int((lv - vc + 18) * PX_PER_MM)
                cv2.rectangle(t, (0, y0), (w - 1, y1), (95 + 10 * k, 105, 115), -1)
                for dv in (-8, 8):
                    ya = int((lv - vc + dv) * PX_PER_MM)
                    cv2.rectangle(t, (0, ya - 4), (w - 1, ya + 4), (170, 170, 175), -1)
        for _ in range(int(lu * lv / 4000)):
            x, y = int(rng.uniform(0, w)), int(rng.uniform(0, h))
            cv2.circle(t, (x, y), int(rng.uniform(4, 14)), tuple(int(c) for c in rng.integers(40, 220, 3)), -1)
        out[name] = t
    size = int(MARKER_SIZE_MM * PX_PER_MM)
    pad = 8 * PX_PER_MM
    for mid, (piece, u, v, rot) in LEVEL_MARKERS.items():
        t = out[piece]
        lv = LEVEL_PIECES[piece][1][1]
        m = cv2.aruco.generateImageMarker(d, mid, size)
        big = np.full((size + 2 * pad, size + 2 * pad), 255, np.uint8)
        big[pad : pad + size, pad : pad + size] = m
        if rot:
            M = cv2.getRotationMatrix2D((big.shape[1] / 2, big.shape[0] / 2), rot, 1.0)
            big = cv2.warpAffine(big, M, big.shape[::-1], flags=cv2.INTER_LINEAR, borderValue=255)
        cx, cy, hh = int(round(u * PX_PER_MM)), int(round((lv - v) * PX_PER_MM)), big.shape[0] // 2
        y0, x0 = max(0, cy - hh), max(0, cx - hh)
        y1, x1 = min(t.shape[0], cy - hh + big.shape[0]), min(t.shape[1], cx - hh + big.shape[1])
        t[y0:y1, x0:x1] = big[y0 - (cy - hh) : y1 - (cy - hh), x0 - (cx - hh) : x1 - (cx - hh), None]
    return {k: cv2.GaussianBlur(v, (0, 0), 0.7) for k, v in out.items()}


def level_camera(k: int) -> tuple[np.ndarray, np.ndarray]:
    """Frame k of the camera path around the scene with levels: an orbit 45-60 degrees from
    above, 650-850 mm away, looking at points that wander over the board (world -> camera)."""
    a = 2 * math.pi * k / 90 - math.pi / 2
    target = np.array([300 + 180 * math.sin(0.11 * k), 120 + 90 * math.cos(0.07 * k), 15.0])
    tilt = math.radians(52 + 8 * math.sin(0.13 * k))
    dist = 750 + 100 * math.sin(0.05 * k)
    cam = target + dist * np.array([math.sin(tilt) * math.cos(a), math.sin(tilt) * math.sin(a), math.cos(tilt)])
    f = target - cam
    f /= np.linalg.norm(f)
    x = np.cross(f, [0, 0, 1.0])
    x /= np.linalg.norm(x)
    R = np.array([x, np.cross(f, x), f])
    return R, -R @ cam


def render_levels(textures: dict, k: int) -> np.ndarray:
    """Frame k of the scene with levels (BGR, ``LEVEL_IMAGE_SIZE``), a pinhole camera ``LEVEL_K``:
    every piece warped into the image, the nearest piece winning at every pixel."""
    R, t = level_camera(k)
    W, H = LEVEL_IMAGE_SIZE
    img = np.full((H, W, 3), 40, np.uint8)
    zbuf = np.full((H, W), np.inf, np.float32)
    rx = ((np.arange(W, dtype=np.float32) - LEVEL_K[0, 2]) / LEVEL_F)[None, :]  # rays (rx, ry, 1)
    ry = ((np.arange(H, dtype=np.float32) - LEVEL_K[1, 2]) / LEVEL_F)[:, None]
    for name, (fr, (_, lv), _) in LEVEL_PIECES.items():
        tex = textures[name]
        o, eu, ev, n = (R @ fr["o"] + t), R @ fr["u"], R @ fr["v"], R @ fr["n"]
        if n @ o >= 0:  # seen from behind
            continue
        A = np.array([[1 / PX_PER_MM, 0, 0.5 / PX_PER_MM], [0, -1 / PX_PER_MM, lv - 0.5 / PX_PER_MM], [0, 0, 1.0]])
        Hm = LEVEL_K @ np.column_stack([eu, ev, o]) @ A
        warped = cv2.warpPerspective(tex, Hm, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        mask = cv2.warpPerspective(np.full(tex.shape[:2], 255, np.uint8), Hm, (W, H), flags=cv2.INTER_LINEAR) > 127
        with np.errstate(divide="ignore"):
            depth = np.float32(n @ o) / (rx * np.float32(n[0]) + ry * np.float32(n[1]) + np.float32(n[2]))
        win = mask & (depth > 1) & (depth < zbuf)  # depth: z of the plane along every pixel's ray
        np.copyto(img, warped, where=win[..., None])
        np.copyto(zbuf, depth, where=win)
    img = cv2.GaussianBlur(img, (3, 3), 0.8)
    noise = np.random.default_rng(1000 + k).standard_normal(img.shape, dtype=np.float32) * 3
    return np.clip(img + noise, 0, 255).astype(np.uint8)


def level_top_view(textures: dict, bounds, mm_per_px: float = 1.0) -> np.ndarray:
    """What an orthophoto of the scene with levels should show: the uppermost piece at every point
    (the block's top, the ramp, else the board), row 0 at bounds[3]."""
    x0, y0, x1, y1 = bounds
    W, H = int(round((x1 - x0) / mm_per_px)), int(round((y1 - y0) / mm_per_px))
    X, Y = np.meshgrid(x0 + (np.arange(W) + 0.5) * mm_per_px, y1 - (np.arange(H) + 0.5) * mm_per_px)
    out = np.zeros((H, W, 3), np.uint8)
    for name in ("board", "ramp", "top"):  # later ones lie above
        fr, (lu, lv), _ = LEVEL_PIECES[name]
        u = (X - fr["o"][0]) / fr["u"][0] if fr["u"][0] else None
        v = (Y - fr["o"][1]) / fr["v"][1]
        inside = (u >= 0) & (u <= lu) & (v >= 0) & (v <= lv)
        mu = (u * PX_PER_MM - 0.5).astype(np.float32)
        mv = ((lv - v) * PX_PER_MM - 0.5).astype(np.float32)
        tex = cv2.GaussianBlur(textures[name], (0, 0), 0.5 * PX_PER_MM * mm_per_px)
        sample = cv2.remap(tex, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        out[inside] = sample[inside]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render the synthetic test layout")
    ap.add_argument("output", help="image file, e.g. synthetic.jpg")
    ap.add_argument("--frame", type=int, default=12, help="frame of the camera path")
    ap.add_argument("--dictionary", default=DICTIONARY)
    ap.add_argument("--levels", action="store_true", help="the scene with levels (for the 3D survey)")
    args = ap.parse_args(argv)
    if args.levels:
        img = render_levels(level_textures(args.dictionary), args.frame)
    else:
        img, _ = render(texture(args.dictionary), args.frame)
    cv2.imwrite(args.output, img, [cv2.IMWRITE_JPEG_QUALITY, 85, cv2.IMWRITE_JPEG_OPTIMIZE, 1])
    print("written:", args.output)


if __name__ == "__main__":
    main()
