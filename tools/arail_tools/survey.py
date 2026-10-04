"""Survey a layout from a video or photos: a fixed marker map and an orthophoto of the table.

The lab session (see docs/lab-session.md): stick markers on the layout, film it completely, then

    arail-survey lab.mp4 --layout web/layouts/ebl-lab.json -o ebl-lab.json --report report.json \\
        --ortho web/media/ebl-lab-ortho.jpg --check check.jpg

How it works:

1. Markers are detected in every n-th frame (OpenCV ArUco, sub-pixel corners, ``aruco.py``).
2. Initial marker poses by chaining homographies: from the origin marker (or the fixed poses of
   ``--layout``) to every marker that is seen together with known ones.
3. Bundle adjustment: all marker poses (x, y, rotation) and one homography per frame are refined
   together, minimising the reprojection error of all marker corners with a robust (Huber) loss.
   Sparse Levenberg-Marquardt; the frame blocks are eliminated with the Schur complement, so long
   videos stay fast. Wrong detections are rejected and the adjustment is repeated. A homography
   per frame (rather than one camera model) also covers zooming, cropping and the electronic image
   stabilisation of phones.
4. Checks: markers seen rarely, high residuals, groups of markers never seen together with the
   rest, markers that moved since the layout file was made, a marker size that does not fit.
5. Orthophoto (``--ortho``): a top view of the table in the layout frame. For every output pixel
   the frame with the most detail wins (image pixels per mm from the homography's Jacobian; image
   borders, blurred frames and points far from the frame's markers count less; static overlays such
   as watermarks and markers covered by a hand are left out), with a narrow blend at the seams.
   The frames' exposure is balanced first.

Outputs: the layout with all marker poses (the app keeps poses from the file fixed; the map is
written locked, ``markers.locked``, so live tracking uses only these markers; markers on vehicles,
``markers.moving``, are never part of it), a JSON report, the orthophoto with its ``bounds_mm``
(``view.ortho`` in the layout), and a check image with the layout's markers, platforms and tracks
drawn on the orthophoto.
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import numpy as np

from .aruco import MarkerDetector, cv2, marker_corners_mm

FORMAT = "arail-survey/1"
LAYOUT_FORMAT = "arail-layout/1"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}

# Marker type names of the app (layout files) -> OpenCV dictionaries. The 4x4 ... 7x7 dictionaries
# share their first codes, so the smallest one with enough codes is used.
APP_DICTIONARIES = {
    "ARUCO": "DICT_ARUCO_ORIGINAL",
    "ARUCO_4X4_1000": "DICT_4X4",
    "ARUCO_5X5_1000": "DICT_5X5",
    "ARUCO_6X6_1000": "DICT_6X6",
    "ARUCO_7X7_1000": "DICT_7X7",
    "ARUCO_MIP_36h12": "DICT_ARUCO_MIP_36h12",
    "APRILTAG_36h11": "DICT_APRILTAG_36h11",
}

MIN_SEEN = 5  # markers seen in fewer frames are reported
ORTHO_POWER = 12  # weight = quality ** power: the best frame dominates, seams blend narrowly
EXTRAPOLATE = 2.0  # a frame is used up to this many support distances from its markers (see _ortho_views)
ORTHO_BACKGROUND = (214, 214, 214)  # unseen parts of the orthophoto (light grey, BGR)

# check image colours (BGR): chair CD Orange 1, Rot 1, Gelb 1, Tuerkis 1
CHECK_MARKER = (0, 80, 200)
CHECK_PLATFORM = (65, 15, 210)
CHECK_TRACK = (0, 199, 255)
CHECK_OTHER = (127, 119, 10)


class SurveyError(Exception):
    """The inputs cannot be surveyed (the message says why and what to do)."""


def opencv_dictionary(name: str | None, codes: int = 50) -> str | None:
    """OpenCV dictionary for an app or OpenCV marker type name; None = detect automatically."""
    if not name or name == "auto":
        return None
    if name.startswith("DICT_"):
        if not hasattr(cv2.aruco, name):
            raise SurveyError(f"Unknown OpenCV dictionary {name!r} (e.g. DICT_ARUCO_ORIGINAL, DICT_4X4_50)")
        return name
    base = APP_DICTIONARIES.get(name)
    if base is None:
        raise SurveyError(f"Unknown marker type {name!r}: use one of {', '.join(APP_DICTIONARIES)} or an OpenCV name")
    if base[-2] == "X":  # DICT_4X4 ... DICT_7X7 come in sizes
        n = next((n for n in (50, 100, 250, 1000) if codes <= n), 1000)
        return f"{base}_{n}"
    return base


def app_dictionary(cv_name: str) -> str:
    """Marker type name used in layout files for an OpenCV dictionary."""
    for app, base in APP_DICTIONARIES.items():
        if cv_name == base or (base[-2] == "X" and cv_name.startswith(base + "_")):
            return app
    return cv_name


# ---------------------------------------------------------------------------------- geometry


def pose_apply(pose, pts) -> np.ndarray:
    """Points given in the frame of ``pose`` (x, y, theta in rad) -> parent frame."""
    pts = np.asarray(pts, float).reshape(-1, 2)
    c, s = math.cos(pose[2]), math.sin(pose[2])
    return np.column_stack([pose[0] + c * pts[:, 0] - s * pts[:, 1], pose[1] + s * pts[:, 0] + c * pts[:, 1]])


def wrap_angle(a):
    """Angle(s) in [-pi, pi)."""
    return (np.asarray(a) + math.pi) % (2 * math.pi) - math.pi


def rigid_fit(src, dst) -> tuple[np.ndarray, float]:
    """Least-squares rigid transform with ``dst ~ R(theta) src + t``: ((tx, ty, theta), rms)."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    th = math.atan2(float(np.sum(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0])), float(np.sum(a * b)))
    c, s = math.cos(th), math.sin(th)
    pose = np.array([md[0] - (c * ms[0] - s * ms[1]), md[1] - (s * ms[0] + c * ms[1]), th])
    return pose, float(np.sqrt(np.mean(np.sum((pose_apply(pose, src) - dst) ** 2, 1))))


def similarity_fit(src, dst) -> tuple[float, float, np.ndarray]:
    """Least-squares similarity ``dst ~ s R(theta) src + t`` (Umeyama): (s, theta, t)."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    sc = float(np.sum(a * b))
    ss = float(np.sum(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]))
    th = math.atan2(ss, sc)
    var = float(np.sum(a * a))
    s = math.hypot(sc, ss) / var if var > 0 else 1.0
    c, n = math.cos(th), math.sin(th)
    t = md - s * np.array([c * ms[0] - n * ms[1], n * ms[0] + c * ms[1]])
    return s, th, t


def apply_h(H, pts) -> np.ndarray:
    """Apply a homography to Nx2 points."""
    pts = np.asarray(pts, float).reshape(-1, 2)
    p = pts @ H[:, :2].T + H[:, 2]
    return p[:, :2] / p[:, 2:3]


def fit_homography(src, dst) -> np.ndarray | None:
    """Least-squares homography src -> dst (normalised DLT, at least 4 points); None if degenerate."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    if len(src) < 4:
        return None

    def normaliser(p):
        m = p.mean(0)
        d = np.sqrt(np.mean(np.sum((p - m) ** 2, 1)))
        if d < 1e-9:
            return None
        k = math.sqrt(2) / d
        return np.array([[k, 0, -k * m[0]], [0, k, -k * m[1]], [0, 0, 1.0]])

    Ts, Td = normaliser(src), normaliser(dst)
    if Ts is None or Td is None:
        return None
    s, d = apply_h(Ts, src), apply_h(Td, dst)
    n = len(s)
    A = np.zeros((2 * n, 9))
    A[0::2, 0:2], A[0::2, 2] = s, 1
    A[0::2, 6:8], A[0::2, 8] = -d[:, :1] * s, -d[:, 0]
    A[1::2, 3:5], A[1::2, 5] = s, 1
    A[1::2, 6:8], A[1::2, 8] = -d[:, 1:] * s, -d[:, 1]
    _, sv, vt = np.linalg.svd(A)
    if sv[-2] < 1e-9 * sv[0]:
        return None
    H = np.linalg.inv(Td) @ vt[-1].reshape(3, 3) @ Ts
    return H / H[2, 2] if abs(H[2, 2]) > 1e-12 else H


def homography_jacobian(H, x, y):
    """Image position (u, v), homogeneous w and the Jacobian d(u, v)/d(x, y) of H at layout points."""
    a = H[0, 0] * x + H[0, 1] * y + H[0, 2]
    b = H[1, 0] * x + H[1, 1] * y + H[1, 2]
    w = H[2, 0] * x + H[2, 1] * y + H[2, 2]
    w = np.where(np.abs(w) < 1e-12, 1e-12, w)
    u, v = a / w, b / w
    J = (
        (H[0, 0] - u * H[2, 0]) / w,
        (H[0, 1] - u * H[2, 1]) / w,
        (H[1, 0] - v * H[2, 0]) / w,
        (H[1, 1] - v * H[2, 1]) / w,
    )
    return u, v, w, J


def singular_values_2x2(a, b, c, d):
    """Smaller and larger singular value of [[a, b], [c, d]] (element-wise arrays)."""
    f = a * a + b * b + c * c + d * d
    det = a * d - b * c
    root = np.sqrt(np.maximum(f * f - 4 * det * det, 0))
    return np.sqrt(np.maximum((f - root) / 2, 0)), np.sqrt((f + root) / 2)


# ---------------------------------------------------------------------------------- input


@dataclass
class Source:
    """One input file: a video or a photo."""

    path: str
    kind: str  # "video" | "photo"
    size: tuple[int, int] = (0, 0)
    fps: float = 0.0
    count: int = 1  # frames in the file
    overlay: np.ndarray | None = None  # static overlay mask (uint8, 1/4 resolution), see detect_overlay


@dataclass
class Frame:
    """Markers seen in one frame; after the survey also the homography layout (mm) -> image (px)."""

    source: int
    index: int
    time: float
    size: tuple[int, int]
    markers: dict[int, np.ndarray]
    sharpness: float = 0.0
    H: np.ndarray | None = None
    rms: float | None = None
    used: list[int] = field(default_factory=list)


def open_sources(paths: list[str]) -> list[Source]:
    """Expand glob patterns and classify the inputs as videos or photos."""
    out = []
    for pattern in paths:
        matches = sorted(glob.glob(pattern)) or [pattern]
        for p in matches:
            if os.path.isdir(p):
                raise SurveyError(f"{p} is a folder: give the videos or photos in it (e.g. {os.path.join(p, '*.jpg')})")
            if not os.path.isfile(p):
                raise SurveyError(f"Not found: {p}")
            if os.path.splitext(p)[1].lower() in IMAGE_EXTENSIONS:
                out.append(Source(p, "photo"))
                continue
            cap = cv2.VideoCapture(p)
            if not cap.isOpened():
                raise SurveyError(f"Cannot read {p} (not a video or image OpenCV can open)")
            w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            out.append(
                Source(p, "video", (w, h), fps if 0 < fps < 1000 else 30.0, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
            )
            cap.release()
    if not out:
        raise SurveyError("No input files.")
    return out


def read_frames(source: Source, every: int = 1, wanted: set[int] | None = None):
    """Yield (index, time_s, BGR image) of every n-th frame (or of the ``wanted`` frame indices)."""
    if source.kind == "photo":
        img = cv2.imread(source.path, cv2.IMREAD_COLOR)
        if img is None:
            raise SurveyError(f"Cannot read the image {source.path}")
        source.size = (img.shape[1], img.shape[0])
        if wanted is None or 0 in wanted:
            yield 0, 0.0, img
        return
    cap = cv2.VideoCapture(source.path)
    last = max(wanted) if wanted else None
    i = 0
    try:
        while True:
            take = (i in wanted) if wanted is not None else (i % every == 0)
            if take:
                ok, img = cap.read()
                if not ok:
                    break
                yield i, i / source.fps, img
            elif not cap.grab():
                break
            i += 1
            if last is not None and i > last:
                break
    finally:
        cap.release()
    source.count = max(source.count, i)


def read_json(path: str, what: str) -> dict:
    """A JSON object from a file (SurveyError if it cannot be read or is not an object)."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except OSError as exc:
        raise SurveyError(f"Cannot read the {what} {path}: {exc.strerror or exc}") from exc
    except ValueError as exc:
        raise SurveyError(f"The {what} {path} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise SurveyError(f"The {what} {path} is not a JSON object")
    return data


def load_calibration(path: str) -> dict:
    """Camera calibration of ``arail-calibrate`` (format arail-camera/1)."""
    data = read_json(path, "calibration")
    if data.get("format") != "arail-camera/1":
        raise SurveyError(f"{path} is not a camera calibration of arail-calibrate")
    return data


def load_layout(path: str) -> dict:
    """A layout file (format arail-layout/1; like the app, a file without a format is accepted if it
    has objects or markers). Its marker poses must be valid: they are written back."""
    data = read_json(path, "layout")
    if data.get("format", LAYOUT_FORMAT) != LAYOUT_FORMAT or not (
        "format" in data or isinstance(data.get("objects"), list) or isinstance(data.get("markers"), dict)
    ):
        raise SurveyError(f'{path} is not an ARail layout file (expected "format": "{LAYOUT_FORMAT}")')
    markers = data.get("markers") or {}
    if not isinstance(markers, dict) or not isinstance(markers.get("poses") or {}, dict):
        raise SurveyError(f'{path}: markers.poses must be an object like {{"0": [0, 0, 0]}}')
    if not isinstance(markers.get("sizes_mm") or {}, dict):
        raise SurveyError(f'{path}: markers.sizes_mm must be an object like {{"7": 60}}')
    if not isinstance(markers.get("moving") or [], list):
        raise SurveyError(f"{path}: markers.moving must be a list of marker IDs like [40, 41]")
    for k, p in (markers.get("poses") or {}).items():
        ok = str(k).isdigit() and isinstance(p, list) and 2 <= len(p)
        try:
            ok = ok and all(math.isfinite(float(v)) for v in p[:3])
        except (TypeError, ValueError):
            ok = False
        if not ok:
            raise SurveyError(f"{path}: markers.poses.{k} must be a marker ID with [x_mm, y_mm, rotation_deg]")
    return data


def moving_ids(markers: dict) -> set[int]:
    """Marker IDs on vehicles (``markers.moving`` of a layout): never part of the marker map."""
    return {int(v) for v in markers.get("moving") or [] if str(v).isdigit()}


def calibration_for(cal: dict | None, size: tuple[int, int]):
    """(K, dist) of a calibration, scaled to the image size; None without calibration."""
    if not cal:
        return None
    cw, ch = cal["image_size"]
    w, h = size
    if abs(cw / ch - w / h) > 0.01:
        raise SurveyError(f"The calibration was made for {cw}x{ch}, the images are {w}x{h} (another aspect ratio)")
    K = np.array(cal["camera_matrix"], float)
    K[:2] *= w / cw
    return K, np.array(cal["distortion"], float)


def refine_corners(grey: np.ndarray, corners: np.ndarray, iterations: int = 2) -> np.ndarray:
    """Sub-pixel marker corners from the four edges of the black square.

    Along the middle 70 % of every edge, intensity profiles across the edge give the points where
    the brightness is halfway between the black border and the white margin; a line is fitted
    through them and the corners are the intersections of neighbouring lines. Unlike corner
    detectors this is unbiased under blur: OpenCV's sub-pixel corners lie about half a pixel inside
    the square, which makes a whole survey a few per cent too large. Returns the input corners if
    the marker is too small or the edges cannot be measured."""
    c = np.asarray(corners, np.float64).reshape(4, 2)
    img = grey if grey.dtype == np.float32 else grey.astype(np.float32)
    for _ in range(iterations):
        lines = []
        centre = c.mean(0)
        for k in range(4):
            a, b = c[k], c[(k + 1) % 4]
            length = float(np.hypot(*(b - a)))
            if length < 12:
                return np.asarray(corners, np.float64).reshape(4, 2)
            d = (b - a) / length
            n = np.array([d[1], -d[0]])
            if np.dot(n, (a + b) / 2 - centre) < 0:
                n = -n  # outward
            reach = float(np.clip(0.12 * length, 2.0, 6.0))  # stays inside the black border (1/7 of the side)
            along = a + np.outer(np.linspace(0.15, 0.85, 24), b - a)
            offsets = np.arange(-reach, reach + 1e-9, 0.25)
            pts = along[:, None, :] + offsets[None, :, None] * n
            prof = cv2.remap(img, pts[..., 0].astype(np.float32), pts[..., 1].astype(np.float32), cv2.INTER_LINEAR)
            q = max(2, len(offsets) // 4)
            lo, hi = np.median(prof[:, :q], 1), np.median(prof[:, -q:], 1)
            ok = hi - lo > 12
            p = (prof - lo[:, None]) / np.where(ok, hi - lo, 1)[:, None]
            above = p >= 0.5
            first = np.argmax(above, 1)  # first sample at or above the halfway level
            ok &= above.any(1) & (first > 0)
            i = np.clip(first, 1, len(offsets) - 1)
            r = np.arange(len(p))
            p0, p1 = p[r, i - 1], p[r, i]
            s = offsets[i - 1] + (0.5 - p0) / np.where(p1 > p0, p1 - p0, 1) * (offsets[i] - offsets[i - 1])
            edge = along + s[:, None] * n
            edge = edge[ok]
            if len(edge) < 6:
                return np.asarray(corners, np.float64).reshape(4, 2)
            # line fit (total least squares), once more without outliers
            for _ in range(2):
                m = edge.mean(0)
                _, _, vt = np.linalg.svd(edge - m)
                normal = vt[1]
                dist = (edge - m) @ normal
                keep = np.abs(dist) <= max(0.3, 3 * 1.4826 * float(np.median(np.abs(dist))))
                if keep.all() or keep.sum() < 6:
                    break
                edge = edge[keep]
            lines.append((normal, float(normal @ m)))
        new = np.empty((4, 2))
        for k in range(4):
            (n0, d0), (n1, d1) = lines[k - 1], lines[k]
            A = np.array([n0, n1])
            if abs(np.linalg.det(A)) < 1e-6:
                return np.asarray(corners, np.float64).reshape(4, 2)
            new[k] = np.linalg.solve(A, [d0, d1])
        side = float(np.mean(np.hypot(*(np.roll(c, -1, 0) - c).T)))
        if np.max(np.hypot(*(new - c).T)) > max(1.5, 0.08 * side):
            return np.asarray(corners, np.float64).reshape(4, 2)  # implausible: keep the detector's corners
        c = new
    return c


class SurveyDetector(MarkerDetector):
    """MarkerDetector with unbiased sub-pixel corners (:func:`refine_corners`); IDs seen twice in one
    frame (two stickers with the same ID) are left out and counted, and so are IDs above ``max_id``
    (stickers beyond the layout's number of codes, or misreads)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.duplicates: Counter = Counter()
        self.above_max: Counter = Counter()  # ID -> frames

    def detect(self, grey: np.ndarray) -> dict[int, np.ndarray]:
        if grey.ndim == 3:
            grey = cv2.cvtColor(grey, cv2.COLOR_BGR2GRAY)
        found = super().detect(grey)
        if not found:
            return found
        img = grey.astype(np.float32)
        return {i: refine_corners(img, c) for i, c in found.items()}

    def _find(self, name, grey) -> dict[int, np.ndarray]:
        corners, ids, _ = self._detector(name).detectMarkers(grey)
        found, twice, above = {}, set(), set()
        if ids is not None:
            for c, i in zip(corners, ids.flatten(), strict=True):
                i = int(i)
                if i > self.max_id:
                    above.add(i)
                    continue
                if i in found:
                    twice.add(i)
                found[i] = c.reshape(4, 2).astype(np.float64)
        for i in twice:
            del found[i]
            if name == self.name:
                self.duplicates[i] += 1
        if name == self.name:
            self.above_max.update(above)
        return found


def sharpness(grey: np.ndarray) -> float:
    """Variance of the Laplacian at about 960 px width (higher = sharper)."""
    s = min(1.0, 960 / max(grey.shape))
    small = cv2.resize(grey, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else grey
    return float(cv2.Laplacian(small, cv2.CV_32F).var())


def detect_overlay(edge_frequency: np.ndarray, frames: int) -> np.ndarray | None:
    """Static overlay (watermark, timestamp) from how often each pixel was an edge in a video.

    While the camera moves, edges of the scene move through the image and every pixel is an edge
    only now and then; edges of an overlay stay. Returns a uint8 mask (1 = overlay) at the analysis
    resolution, or None: nothing found, or parts of the scene stay put as well (a camera that
    hardly moved, or tracks filmed lengthwise), so overlays cannot be told apart."""
    if frames < 20:
        return None
    freq = edge_frequency / frames
    core = (freq > max(0.75, 3 * float(np.median(freq)))).astype(np.uint8)
    if not core.any():
        return None
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.dilate(cv2.morphologyEx(core, cv2.MORPH_CLOSE, k), k)
    rest = freq[mask == 0]
    if mask.mean() > 0.1 or (rest.size and float(np.percentile(rest, 99)) > 0.35):
        return None
    return mask


def detect_frames(
    sources: list[Source],
    detector: MarkerDetector,
    every: int = 2,
    calibration: dict | None = None,
    overlay: bool = True,
    log=None,
) -> list[Frame]:
    """Pass 1: detect the markers in every n-th frame of all sources (corners undistorted with a
    calibration). In videos, also looks for static overlays (see :func:`detect_overlay`)."""
    frames: list[Frame] = []
    for si, src in enumerate(sources):
        t0, shown = time.time(), 0.0
        und = None
        edges, edge_frames = None, 0
        for idx, t, img in read_frames(src, every):
            if src.kind == "video" and not src.size[0]:
                src.size = (img.shape[1], img.shape[0])
            size = (img.shape[1], img.shape[0])
            if calibration and und is None:
                und = calibration_for(calibration, size)
            grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            found = detector.detect(grey)
            if und is not None:
                K, dist = und
                found = {
                    i: cv2.undistortPoints(c.reshape(-1, 1, 2), K, dist, P=K).reshape(4, 2).astype(np.float64)
                    for i, c in found.items()
                }
            frames.append(Frame(si, idx, t, size, found, sharpness(grey)))
            if src.kind == "video" and overlay:
                small = cv2.resize(grey, (max(1, size[0] // 4), max(1, size[1] // 4)), interpolation=cv2.INTER_AREA)
                e = (cv2.Canny(small, 40, 120) > 0).astype(np.float32)
                edges = e if edges is None or edges.shape != e.shape else edges + e
                edge_frames += 1
            if log and time.time() - shown > 2:
                shown = time.time()
                total = f"/{src.count}" if src.kind == "video" and src.count > 0 else ""
                log(f"  {os.path.basename(src.path)}: frame {idx}{total}, {len(found)} markers in view")
        src.overlay = detect_overlay(edges, edge_frames) if edges is not None else None
        if log:
            name = os.path.basename(src.path)
            n = sum(1 for f in frames if f.source == si)
            log(f"  {name}: {n} frames analysed in {time.time() - t0:.1f} s")
            if src.overlay is not None:
                share = 100 * src.overlay.mean()
                log(f"  {name}: static overlay (watermark?) on {share:.1f} % of the image, left out of the orthophoto")
    return frames


# ---------------------------------------------------------------------------------- bundle adjustment


class Adjustment:
    """Bundle adjustment of marker poses and one homography per frame (see the module docstring).

    ``observations`` is a list of (frame index, marker id), grouped by frame; every frame needs at
    least two. Markers in ``free`` are estimated; the others keep their pose. ``priors`` maps
    free markers to (pose, sigma) with sigma = (mm, mm, rad): soft constraints towards a pose.

    The corner residuals are in image pixels, the priors in units of their sigma. For a proper
    weighting, the prior terms are multiplied by the pixel noise variance (``prior_scale``, px^2),
    which :meth:`solve` estimates from the residuals: otherwise a 2 mm prior would act like a
    0.8 mm one at 0.4 px noise, and the covariance would be too optimistic."""

    def __init__(
        self,
        frames: list[Frame],
        observations: list[tuple[int, int]],
        poses: dict[int, np.ndarray],
        free: set[int],
        size_of,
        priors: dict | None = None,
    ):
        self.frame_ids = sorted({fi for fi, _ in observations})
        fpos = {fi: k for k, fi in enumerate(self.frame_ids)}
        self.ids = sorted({m for _, m in observations})
        self.mpos = mpos = {m: k for k, m in enumerate(self.ids)}
        self.free = [m for m in self.ids if m in free]
        self.free_local = [mpos[m] for m in self.free]
        free_pos = {m: k for k, m in enumerate(self.free)}
        obs = sorted(observations, key=lambda o: (fpos[o[0]], o[1]))
        self.observations = obs
        self.of = np.array([fpos[fi] for fi, _ in obs])  # frame (local) per observation
        self.om = np.array([mpos[m] for _, m in obs])  # marker (local) per observation
        self.ofree = np.array([free_pos.get(m, -1) for _, m in obs])  # free marker or -1
        self.fstart = np.flatnonzero(np.r_[True, self.of[1:] != self.of[:-1]])
        local = np.vstack([marker_corners_mm(size_of(m)).astype(np.float64) for _, m in obs])
        meas = np.vstack([frames[fi].markers[m] for fi, m in obs])
        self.local, self.meas = local, meas
        self.cf = np.repeat(self.of, 4)  # per corner
        self.cm = np.repeat(self.om, 4)
        # per-frame normalisation: layout around the frame's markers, image around its centre
        F = len(self.frame_ids)
        P0 = np.array([poses[m] for m in self.ids], float)
        self.poses = P0.copy()
        self.mlay, self.slay = np.zeros((F, 2)), np.ones(F)
        self.cimg, self.kimg = np.zeros((F, 2)), np.ones(F)
        self.Hn = np.zeros((F, 3, 3))
        corners_layout = self._corners(P0)
        ends = list(self.fstart) + [len(obs)]
        for k, fi in enumerate(self.frame_ids):
            sel = slice(4 * ends[k], 4 * ends[k + 1])  # corners of frame k are contiguous
            pts = corners_layout[sel]
            self.mlay[k] = pts.mean(0)
            self.slay[k] = max(10.0, float(np.sqrt(np.mean(np.sum((pts - self.mlay[k]) ** 2, 1)))))
            w, h = frames[fi].size
            self.cimg[k] = (w / 2, h / 2)
            self.kimg[k] = max(w, h) / 2
            src, dst = (pts - self.mlay[k]) / self.slay[k], (meas[sel] - self.cimg[k]) / self.kimg[k]
            Hn = fit_homography(src, dst)
            if Hn is None or not np.all(np.isfinite(Hn)) or abs(Hn[2, 2]) < 1e-6:
                Hn = fit_homography(src[:4], dst[:4])  # inconsistent start poses: one marker's homography
            if Hn is None or not np.all(np.isfinite(Hn)) or abs(Hn[2, 2]) < 1e-6:
                Hn = np.eye(3)  # degenerate: the robust loss and the rejection take care of it
            self.Hn[k] = Hn / Hn[2, 2]
        # pairs of free-marker observations within a frame (for the Schur complement)
        pa, pb = [], []
        bounds = list(self.fstart) + [len(obs)]
        for k in range(F):
            ids = [p for p in range(bounds[k], bounds[k + 1]) if self.ofree[p] >= 0]
            for p in ids:
                for q in ids:
                    pa.append(p)
                    pb.append(q)
        self.pa, self.pb = np.array(pa, int), np.array(pb, int)
        self.priors = {}
        for m, (pose, sigma) in (priors or {}).items():
            if m in free_pos:
                self.priors[free_pos[m]] = (np.asarray(pose, float), np.asarray(sigma, float))
        self.iterations = 0
        self.delta = 1.5
        self.prior_scale = 1.0  # px^2 per (prior deviation / sigma)^2, see the class docstring

    # -- model

    def _corners(self, poses):
        P = poses[self.cm]
        c, s = np.cos(P[:, 2]), np.sin(P[:, 2])
        lx, ly = self.local[:, 0], self.local[:, 1]
        return np.column_stack([P[:, 0] + c * lx - s * ly, P[:, 1] + s * lx + c * ly])

    def _project(self, poses, Hn):
        X = self._corners(poses)
        f = self.cf
        Xn = (X[:, 0] - self.mlay[f, 0]) / self.slay[f]
        Yn = (X[:, 1] - self.mlay[f, 1]) / self.slay[f]
        H = Hn[f]
        a = H[:, 0, 0] * Xn + H[:, 0, 1] * Yn + H[:, 0, 2]
        b = H[:, 1, 0] * Xn + H[:, 1, 1] * Yn + H[:, 1, 2]
        w = H[:, 2, 0] * Xn + H[:, 2, 1] * Yn + H[:, 2, 2]
        ws = np.where(w > 1e-9, w, 1e-9)
        un, vn = a / ws, b / ws
        k = self.kimg[f]
        r = np.column_stack([un * k + self.cimg[f, 0] - self.meas[:, 0], vn * k + self.cimg[f, 1] - self.meas[:, 1]])
        return r, (X, Xn, Yn, un, vn, ws, H, bool(np.all(w > 1e-9)))

    def _prior_terms(self, poses):
        """Per prior: (free marker, gradient, information diagonal, whitened residual), all
        weighted with ``prior_scale``."""
        out = []
        ps = self.prior_scale
        for k, (p0, sigma) in self.priors.items():
            d = poses[self.free_local[k]] - p0
            d[2] = wrap_angle(d[2])
            out.append((k, ps * d / sigma**2, ps / sigma**2, math.sqrt(ps) * d / sigma))
        return out

    def cost(self, poses, Hn) -> float:
        r, (*_, front) = self._project(poses, Hn)
        if not front:
            return math.inf
        e = np.hypot(r[:, 0], r[:, 1])
        d = self.delta
        rho = np.where(e <= d, e * e, 2 * d * e - d * d)
        prior = sum(float(np.sum(z * z)) for *_, z in self._prior_terms(poses))
        return 0.5 * (float(rho.sum()) + prior)

    def _normal_equations(self):
        r, (X, Xn, Yn, un, vn, w, H, _) = self._project(self.poses, self.Hn)
        f = self.cf
        n = len(r)
        iw = self.kimg[f] / w
        Jh = np.zeros((n, 2, 8))
        Jh[:, 0, 0], Jh[:, 0, 1], Jh[:, 0, 2] = Xn * iw, Yn * iw, iw
        Jh[:, 1, 3], Jh[:, 1, 4], Jh[:, 1, 5] = Xn * iw, Yn * iw, iw
        Jh[:, 0, 6], Jh[:, 0, 7] = -un * Xn * iw, -un * Yn * iw
        Jh[:, 1, 6], Jh[:, 1, 7] = -vn * Xn * iw, -vn * Yn * iw
        du_dx, du_dy = (H[:, 0, 0] - un * H[:, 2, 0]) * iw, (H[:, 0, 1] - un * H[:, 2, 1]) * iw
        dv_dx, dv_dy = (H[:, 1, 0] - vn * H[:, 2, 0]) * iw, (H[:, 1, 1] - vn * H[:, 2, 1]) * iw
        P = self.poses[self.cm]
        dx_th, dy_th = -(X[:, 1] - P[:, 1]), X[:, 0] - P[:, 0]
        sl = self.slay[f]
        Jm = np.empty((n, 2, 3))
        Jm[:, 0, 0], Jm[:, 0, 1], Jm[:, 0, 2] = du_dx / sl, du_dy / sl, (du_dx * dx_th + du_dy * dy_th) / sl
        Jm[:, 1, 0], Jm[:, 1, 1], Jm[:, 1, 2] = dv_dx / sl, dv_dy / sl, (dv_dx * dx_th + dv_dy * dy_th) / sl
        e = np.hypot(r[:, 0], r[:, 1])
        wgt = np.where(e <= self.delta, 1.0, self.delta / np.maximum(e, 1e-12))
        JhW = Jh * wgt[:, None, None]
        JmW = Jm * wgt[:, None, None]
        P_ = n // 4

        def per_obs(a):
            return a.reshape((P_, 4) + a.shape[1:]).sum(1)

        U = np.add.reduceat(per_obs(np.einsum("nri,nrj->nij", JhW, Jh)), self.fstart, axis=0)
        gf = np.add.reduceat(per_obs(np.einsum("nri,nr->ni", JhW, r)), self.fstart, axis=0)
        W = per_obs(np.einsum("nri,nrj->nij", JhW, Jm))
        Vo = per_obs(np.einsum("nri,nrj->nij", JmW, Jm))
        go = per_obs(np.einsum("nri,nr->ni", JmW, r))
        Mf = len(self.free)
        V, gm = np.zeros((Mf, 3, 3)), np.zeros((Mf, 3))
        sel = self.ofree >= 0
        np.add.at(V, self.ofree[sel], Vo[sel])
        np.add.at(gm, self.ofree[sel], go[sel])
        for k, g, info, _ in self._prior_terms(self.poses):
            V[k] += np.diag(info)
            gm[k] += g
        return U, gf, W, V, gm, r, wgt

    def _step(self, system, lam):
        U, gf, W, V, gm, _, _ = system
        Mf = len(self.free)
        Ud = U + lam * np.einsum("fii->fi", U)[:, :, None] * np.eye(8) + 1e-12 * np.eye(8)
        Uinv = np.linalg.inv(Ud)
        if Mf == 0:
            return np.zeros((0, 3)), -np.einsum("fij,fj->fi", Uinv, gf)
        Y = np.einsum("pji,pjk->pik", W, Uinv[self.of])  # W^T U^-1 per observation, (P, 3, 8)
        S4 = np.zeros((Mf, Mf, 3, 3))
        np.add.at(S4, (self.ofree[self.pa], self.ofree[self.pb]), -np.einsum("qij,qjk->qik", Y[self.pa], W[self.pb]))
        Vd = V + lam * np.einsum("mii->mi", V)[:, :, None] * np.eye(3)
        S4[np.arange(Mf), np.arange(Mf)] += Vd
        S = S4.transpose(0, 2, 1, 3).reshape(3 * Mf, 3 * Mf)
        sel = self.ofree >= 0
        b = -gm.copy()
        np.add.at(b, self.ofree[sel], np.einsum("pij,pj->pi", Y[sel], gf[self.of[sel]]))
        try:
            dm = np.linalg.solve(S, b.ravel()).reshape(Mf, 3)
        except np.linalg.LinAlgError:
            dm = np.linalg.lstsq(S, b.ravel(), rcond=None)[0].reshape(Mf, 3)
        dm_pad = np.vstack([dm, np.zeros((1, 3))])
        contrib = np.einsum("pij,pj->pi", W, dm_pad[self.ofree])
        df = np.einsum("fij,fj->fi", Uinv, -gf - np.add.reduceat(contrib, self.fstart, axis=0))
        return dm, df

    def _apply(self, dm, df):
        poses = self.poses.copy()
        poses[self.free_local] += dm
        Hn = self.Hn.copy()
        Hn.reshape(-1, 9)[:, :8] += df
        return poses, Hn

    def solve(self, delta: float = 1.5, max_iter: int = 100) -> Adjustment:
        """Levenberg-Marquardt with IRLS weights for the Huber loss (``delta`` in px). With priors,
        the pixel noise is estimated from the residuals and the adjustment repeated with it."""
        self.delta = delta
        self._levenberg_marquardt(max_iter)
        if self.priors:
            for _ in range(2):
                self.prior_scale = float(np.clip(self.residual_variance(), 1e-4, 100.0))
                self._levenberg_marquardt(max_iter)
        return self

    def residual_variance(self) -> float:
        """Variance of the corner residuals (px^2 per coordinate, Huber-weighted) with the degrees of
        freedom of the adjustment."""
        r, _ = self._project(self.poses, self.Hn)
        e = np.hypot(r[:, 0], r[:, 1])
        wgt = np.where(e <= self.delta, 1.0, self.delta / np.maximum(e, 1e-12))
        dof = max(1, 2 * len(r) - 8 * len(self.frame_ids) - 3 * len(self.free))
        return float(np.sum(wgt * e * e)) / dof

    def _levenberg_marquardt(self, max_iter: int) -> None:
        cost = self.cost(self.poses, self.Hn)
        lam = 1e-4
        for _ in range(max_iter):
            system = self._normal_equations()
            accepted = False
            for _ in range(14):
                dm, df = self._step(system, lam)
                poses, Hn = self._apply(dm, df)
                c = self.cost(poses, Hn)
                if c < cost:
                    accepted = True
                    break
                lam *= 6
            self.iterations += 1
            if not accepted:
                break
            small = (np.abs(dm[:, :2]).max(initial=0) < 1e-4) and (np.abs(dm[:, 2]).max(initial=0) < 1e-7)
            gain = cost - c
            self.poses, self.Hn, cost = poses, Hn, c
            lam = max(lam / 4, 1e-10)
            if gain <= 1e-10 * cost or (small and gain <= 1e-6 * cost):
                break
        self.final_cost = cost

    # -- results

    def pose(self, m) -> np.ndarray:
        p = self.poses[self.mpos[m]].copy()
        p[2] = float(wrap_angle(p[2]))
        return p

    def homography(self, k) -> np.ndarray:
        """Homography layout (mm) -> image (px) of local frame k."""
        Ninv = np.array([[self.kimg[k], 0, self.cimg[k, 0]], [0, self.kimg[k], self.cimg[k, 1]], [0, 0, 1.0]])
        s = self.slay[k]
        T = np.array([[1 / s, 0, -self.mlay[k, 0] / s], [0, 1 / s, -self.mlay[k, 1] / s], [0, 0, 1.0]])
        H = Ninv @ self.Hn[k] @ T
        return H / H[2, 2]

    def observation_rms(self) -> np.ndarray:
        """Reprojection RMS (px) of every observation (4 corners)."""
        r, _ = self._project(self.poses, self.Hn)
        return np.sqrt(np.mean(np.sum(r * r, 1).reshape(-1, 4), 1))

    def covariance(self) -> dict[int, np.ndarray]:
        """3x3 covariance (mm, mm, rad) of every free marker pose, scaled by the residual variance."""
        if not self.free:
            return {}
        U, _, W, V, *_ = self._normal_equations()
        Uinv = np.linalg.inv(U + 1e-12 * np.eye(8))
        Mf = len(self.free)
        Y = np.einsum("pji,pjk->pik", W, Uinv[self.of])
        S4 = np.zeros((Mf, Mf, 3, 3))
        np.add.at(S4, (self.ofree[self.pa], self.ofree[self.pb]), -np.einsum("qij,qjk->qik", Y[self.pa], W[self.pb]))
        S4[np.arange(Mf), np.arange(Mf)] += V
        S = S4.transpose(0, 2, 1, 3).reshape(3 * Mf, 3 * Mf)
        s2 = self.residual_variance()
        try:
            C = np.linalg.inv(S) * s2
        except np.linalg.LinAlgError:
            C = np.linalg.pinv(S) * s2
        return {m: C[3 * k : 3 * k + 3, 3 * k : 3 * k + 3] for k, m in enumerate(self.free)}


# ---------------------------------------------------------------------------------- survey


@dataclass
class SurveyResult:
    """Outcome of :func:`survey`. Poses are (x_mm, y_mm, theta_rad) in the layout frame."""

    poses: dict[int, np.ndarray]
    status: dict[int, str]  # origin | fixed | surveyed | moved | refined
    stats: dict[int, dict]
    frames: list[Frame]
    unplaced: dict[int, str]
    warnings: list[str]
    origin: int | None
    rms_px: float
    observations: int
    rejected: int
    iterations: int
    duplicates: dict[int, int] = field(default_factory=dict)
    ignored: dict[int, int] = field(default_factory=dict)  # IDs above the codes: frames
    moving: dict[int, int] = field(default_factory=dict)  # moving markers (on vehicles): frames
    layout_check: dict | None = None
    distances: dict | None = None  # check against measured distances (and the scale applied)

    def pose_json(self, m) -> list[float]:
        """[x_mm, y_mm, rotation_deg], rounded like the app (0.1 mm, 0.01 deg)."""
        x, y, th = self.poses[m]
        return [round(float(x), 1), round(float(y), 1), round(float(math.degrees(wrap_angle(th))), 2)]


def _components(frames: list[Frame], rejected: set, allowed=None) -> tuple[list[set[int]], dict]:
    """Groups of markers connected by frames that show two or more of them; and frames per marker."""
    parent: dict[int, int] = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    count: Counter = Counter()
    for fi, fr in enumerate(frames):
        ids = [m for m in fr.markers if (fi, m) not in rejected and (allowed is None or m in allowed)]
        for m in ids:
            find(m)
            count[m] += 1
        if len(ids) >= 2:
            for m in ids[1:]:
                parent[find(m)] = find(ids[0])
    groups = defaultdict(set)
    for m in parent:
        groups[find(m)].add(m)
    return list(groups.values()), count


def chain_round(
    frames: list[Frame], known: dict[int, np.ndarray], size_of, rejected=frozenset()
) -> dict[int, np.ndarray]:
    """One round of chaining homographies: unknown markers seen together with known ones get a pose
    through the frames' homographies (fitted to the known markers). Returns the estimates of the
    markers with the most support (many known markers in view, close to them, mapped to a proper
    square). Estimates far from the known markers are rough (a homography from a single marker
    extrapolates poorly): they only start the bundle adjustment."""
    est = defaultdict(list)
    for fi, fr in enumerate(frames):
        ids = [m for m in fr.markers if (fi, m) not in rejected]
        K = [m for m in ids if m in known]
        U = [m for m in ids if m not in known]
        if not K or not U:
            continue
        src = np.vstack([pose_apply(known[m], marker_corners_mm(size_of(m))) for m in K])
        dst = np.vstack([fr.markers[m] for m in K])
        H = fit_homography(src, dst)
        if H is None:
            continue
        try:
            Hinv = np.linalg.inv(H)
        except np.linalg.LinAlgError:
            continue
        centres = np.array([known[m][:2] for m in K])
        for u in U:
            pts = apply_h(Hinv, fr.markers[u])
            if not np.all(np.isfinite(pts)):
                continue
            size = size_of(u)
            pose, rms = rigid_fit(marker_corners_mm(size), pts)
            if rms > 0.5 * size:  # far from a square of the right size: useless
                continue
            d = float(np.min(np.hypot(*(centres - pose[:2]).T)))
            est[u].append((pose, len(K) / (1 + (d / (12 * size)) ** 2) / (1 + (rms / (0.05 * size)) ** 2)))
    if not est:
        return {}
    totals = {u: sum(w for _, w in v) for u, v in est.items()}
    best = max(totals.values())
    return {u: _mean_pose(v) for u, v in est.items() if totals[u] >= 0.3 * best}


def _weighted_median(values, weights) -> float:
    order = np.argsort(values)
    v, w = np.asarray(values)[order], np.asarray(weights)[order]
    c = np.cumsum(w)
    return float(v[np.searchsorted(c, 0.5 * c[-1])])


def _mean_pose(estimates) -> np.ndarray:
    poses = np.array([p for p, _ in estimates])
    w = np.array([w for _, w in estimates])
    th = math.atan2(float(np.sum(w * np.sin(poses[:, 2]))), float(np.sum(w * np.cos(poses[:, 2]))))
    return np.array([_weighted_median(poses[:, 0], w), _weighted_median(poses[:, 1], w), th])


def _observations(frames, poses, rejected) -> list[tuple[int, int]]:
    """(frame, marker) pairs of placed markers, in frames that show two or more of them."""
    obs = []
    for fi, fr in enumerate(frames):
        ids = sorted(m for m in fr.markers if m in poses and (fi, m) not in rejected)
        if len(ids) >= 2:
            obs += [(fi, m) for m in ids]
    return obs


def _adjust(frames, gauge: dict[int, np.ndarray], size_of, *, priors=None, huber_px=1.5, reject_px=4.0):
    """Incremental survey from the gauge markers: chain one round, bundle-adjust all placed markers,
    chain the next round from the refined poses, ...; finally reject wrong detections and adjust
    again. Gauge markers keep their poses (except those with priors).
    Returns (adjustment or None, poses, rejected observations)."""
    rejected: set[tuple[int, int]] = set()
    priors = priors or {}
    gauge = {m: np.asarray(p, float) for m, p in gauge.items()}
    adj = None
    poses: dict[int, np.ndarray] = {}
    for _ in range(5):
        groups, _ = _components(frames, rejected)
        anchored = set().union(*[g for g in groups if g & set(gauge)]) if groups else set()
        poses = {m: p for m, p in poses.items() if m in anchored}
        poses.update(gauge)
        while True:
            new = chain_round(frames, poses, size_of, rejected)
            if not new:
                break
            poses.update(new)
            obs = _observations(frames, poses, rejected)
            if obs and any(m in new for _, m in obs):
                free = {m for _, m in obs if m not in gauge or m in priors}
                step = Adjustment(frames, obs, poses, free, size_of, priors).solve(huber_px, max_iter=15)
                poses.update({m: step.pose(m) for m in step.free})
        obs = _observations(frames, poses, rejected)
        if not obs:
            return None, dict(gauge), rejected
        free = {m for _, m in obs if m not in gauge or m in priors}
        adj = Adjustment(frames, obs, poses, free, size_of, priors).solve(huber_px)
        poses = {m: adj.pose(m) for m in adj.ids}
        e = adj.observation_rms()
        bad = e > max(reject_px, 6 * float(np.median(e)))
        if not bad.any():
            break
        rejected |= {adj.observations[p] for p in np.flatnonzero(bad)}
    for m, p in gauge.items():
        if m not in priors or m not in poses:
            poses[m] = p
    return adj, poses, rejected


def survey(
    frames: list[Frame],
    size_mm: float = 30.0,
    sizes_mm: dict | None = None,
    *,
    fixed: dict | None = None,
    origin: int | None = 0,
    refine_fixed: bool = False,
    moved_mm: float = 5.0,
    huber_px: float = 1.5,
    reject_px: float = 4.0,
    prior_mm: float = 2.0,
    prior_deg: float = 0.5,
    distances=(),
) -> SurveyResult:
    """Marker poses from the detections of all frames.

    ``fixed``: known poses (id -> (x_mm, y_mm, theta_rad)), e.g. from a layout file; they are kept
    (or, with ``refine_fixed``, used as priors), unless the video shows that a marker moved. Without
    fixed poses the ``origin`` marker defines the layout frame. ``distances``: (id_a, id_b, mm)
    measured between marker centres, e.g. with a tape measure; without fixed poses they set the
    scale (otherwise the marker size does), with fixed poses they are only checked."""
    sizes_mm = {int(k): float(v) for k, v in (sizes_mm or {}).items()}

    def size_of(m):
        return sizes_mm.get(m, float(size_mm))

    fixed = {int(m): np.asarray(p, float) for m, p in (fixed or {}).items()}
    warnings: list[str] = []
    groups, seen = _components(frames, set())
    if not seen:
        raise SurveyError(
            "No markers were found. Check the marker type (--dictionary) and that the markers are in focus."
        )
    fixed_seen = [m for m in fixed if m in seen]
    if fixed and not fixed_seen:
        raise SurveyError(
            f"None of the known markers of the layout ({_ids(fixed)}) was seen. Film them too, or use --resurvey "
            "to measure all markers afresh."
        )
    if not fixed:
        if origin is None:
            origin = min(seen, key=lambda m: (-seen[m], m))
        if origin not in seen:
            raise SurveyError(
                f"The origin marker {origin} was not seen. Film it together with its neighbours, or choose another "
                "origin with --origin."
            )
    elif origin not in fixed:
        origin = None

    # 1. did markers of the layout move? Free survey from one of them, compared with the layout
    moved: dict[int, str] = {}
    check = None
    if len(fixed_seen) >= 2:
        anchor = origin if origin in fixed_seen else max(fixed_seen, key=lambda m: (seen[m], -m))
        adj0, free_poses, _ = _adjust(frames, {anchor: fixed[anchor]}, size_of, huber_px=huber_px, reject_px=reject_px)
        cov0 = adj0.covariance() if adj0 else {}
        common = sorted(m for m in fixed_seen if m in free_poses)
        if len(common) >= 2:
            moved, check = _compare_with_layout(common, free_poses, fixed, cov0, moved_mm, warnings)

    # 2. the survey: fixed markers kept (or as priors), moved ones measured again
    gauge = {m: p for m, p in fixed.items() if m not in moved} if fixed else {origin: np.zeros(3)}
    priors = {}
    if refine_fixed and len(gauge) > 1:
        keep = origin if origin in gauge else max(gauge, key=lambda m: (seen.get(m, 0), -m))
        sigma = np.array([prior_mm, prior_mm, math.radians(prior_deg)])
        priors = {m: (p, sigma) for m, p in gauge.items() if m != keep}
    adj, poses, rejected = _adjust(frames, gauge, size_of, priors=priors, huber_px=huber_px, reject_px=reject_px)
    cov = adj.covariance() if adj else {}
    misread = _misreads(poses, seen, size_of, keep=set(gauge))
    for m in misread:
        del poses[m]

    # 3. results per marker and frame
    status, stats = {}, {}
    obs_rms = adj.observation_rms() if adj else np.zeros(0)
    per_marker = defaultdict(list)
    per_frame = defaultdict(list)
    if adj:
        for p, (fi, m) in enumerate(adj.observations):
            per_marker[m].append(obs_rms[p])
            per_frame[fi].append((m, obs_rms[p]))
        for k, fi in enumerate(adj.frame_ids):
            fr = frames[fi]
            fr.H = adj.homography(k)
            rs = [e for _, e in per_frame[fi]]
            fr.rms = float(np.sqrt(np.mean(np.square(rs))))
            fr.used = sorted(m for m, _ in per_frame[fi])
    for m in sorted(poses):
        if m in moved:
            status[m] = "moved"
        elif m in priors:
            status[m] = "refined"
        elif m in gauge:
            status[m] = "origin" if m == origin else "fixed"
        else:
            status[m] = "surveyed"
        e = per_marker.get(m, [])
        C = cov.get(m)
        stats[m] = {
            "detections": seen.get(m, 0),
            "frames": len(e),
            "rms_px": round(float(np.sqrt(np.mean(np.square(e)))), 2) if e else None,
            "sigma_mm": round(float(math.sqrt(max(C[0, 0] + C[1, 1], 0))), 2) if C is not None else 0.0,
            "sigma_deg": round(float(math.degrees(math.sqrt(max(C[2, 2], 0)))), 3) if C is not None else 0.0,
        }
        if m in moved:
            stats[m]["moved"] = moved[m]
    # markers of the layout that were not seen keep their pose
    for m, p in fixed.items():
        if m not in poses:
            poses[m] = p
            status[m] = "origin" if m == origin else "fixed"
            stats[m] = {"detections": seen.get(m, 0), "frames": 0, "rms_px": None, "sigma_mm": 0.0, "sigma_deg": 0.0}
    kept = [m for m in fixed if stats[m]["frames"] == 0]
    if kept:
        warnings.append(f"Not seen together with other markers, kept as in the layout (not checked): {_ids(kept)}.")
    distance_check = _apply_distances(distances, poses, stats, frames, scale=not fixed, warnings=warnings)

    unplaced = {m: f"lies on marker {a}: a misread ID ({seen[m]} of {seen[a]} detections)" for m, a in misread.items()}
    placed = set(poses) | set(misread)
    for g in groups:
        if g & placed:
            continue
        for m in g:
            unplaced[m] = (
                "never seen together with another marker"
                if len(g) == 1
                else f"seen only together with markers {_ids(g - {m})}, never with the rest"
            )
    for m in seen:
        if m not in placed and m not in unplaced:
            unplaced[m] = "all its detections were rejected (wrong detections?)"
    _warnings(frames, seen, poses, status, stats, unplaced, rejected, adj, warnings)
    rms = float(np.sqrt(np.mean(np.square(obs_rms)))) if len(obs_rms) else 0.0
    return SurveyResult(
        poses=dict(sorted(poses.items())),
        status=status,
        stats=stats,
        frames=frames,
        unplaced=dict(sorted(unplaced.items())),
        warnings=warnings,
        origin=origin,
        rms_px=rms,
        observations=len(obs_rms),
        rejected=len(rejected),
        iterations=adj.iterations if adj else 0,
        layout_check=check,
        distances=distance_check,
    )


def _ids(ms) -> str:
    return ", ".join(str(m) for m in sorted(ms))


def _misreads(poses, seen, size_of, keep=frozenset()) -> dict[int, int]:
    """Markers that lie on another marker: small or blurred markers are sometimes decoded with a
    wrong ID. The one seen less often is a misread (marker -> the marker it lies on)."""
    out: dict[int, int] = {}
    ids = sorted(poses, key=lambda m: (-seen.get(m, 0), m))
    for i, a in enumerate(ids):
        if a in out:
            continue
        for b in ids[i + 1 :]:
            if b in out or b in keep:
                continue
            if float(np.hypot(*(poses[a][:2] - poses[b][:2]))) < 0.75 * max(size_of(a), size_of(b)):
                out[b] = a
    return out


def _apply_distances(distances, poses, stats, frames, *, scale: bool, warnings) -> dict | None:
    """Compare the survey with measured distances between marker centres; with ``scale``, scale the
    marker map (and the frames' homographies) to fit them. This is exact: a map scaled by s is what
    markers of s times the size would have given."""
    pairs = [(int(a), int(b), float(mm)) for a, b, mm in distances or () if int(a) in poses and int(b) in poses]
    for a, b, _ in distances or ():
        if int(a) not in poses or int(b) not in poses:
            warnings.append(
                f"Distance {int(a)}-{int(b)}: marker {int(a) if int(a) not in poses else int(b)} was not placed."
            )
    if not pairs:
        return None

    def surveyed(a, b):
        return float(np.hypot(*(poses[a][:2] - poses[b][:2])))

    s = 1.0
    if scale:
        s = sum(mm for _, _, mm in pairs) / sum(surveyed(a, b) for a, b, _ in pairs)
        for m, p in poses.items():
            poses[m] = np.array([p[0] * s, p[1] * s, p[2]])
            if stats.get(m) and stats[m]["sigma_mm"]:
                stats[m]["sigma_mm"] = round(stats[m]["sigma_mm"] * s, 2)
        D = np.diag([1 / s, 1 / s, 1.0])
        for f in frames:
            if f.H is not None:
                f.H = f.H @ D
        if abs(s - 1) > 0.01:
            warnings.append(
                f"The measured distances scaled the marker map by {100 * (s - 1):+.1f} %: is the marker size right "
                "(--size), or does the camera's lens distort (--calibration)?"
            )
    rows = [{"markers": [a, b], "measured_mm": mm, "surveyed_mm": round(surveyed(a, b), 1)} for a, b, mm in pairs]
    off = [r for r in rows if abs(r["surveyed_mm"] - r["measured_mm"]) > max(2.0, 0.003 * r["measured_mm"])]
    if off:
        warnings.append(
            "Measured and surveyed distances differ: "
            + ", ".join(
                f"{r['markers'][0]}-{r['markers'][1]} {r['surveyed_mm'] - r['measured_mm']:+.1f} mm" for r in off
            )
            + (" (after scaling: inconsistent measurements?)" if scale else "")
        )
    return {"scale": round(s, 5), "applied": scale, "pairs": rows}


def _compare_with_layout(common, free_poses, fixed, cov, moved_mm, warnings):
    """Markers of the layout whose surveyed pose does not fit the layout (robust similarity fit)."""
    inliers = list(common)

    def fit(ids):
        s, th, t = similarity_fit([free_poses[m][:2] for m in ids], [fixed[m][:2] for m in ids])
        c, n = math.cos(th), math.sin(th)
        R = np.array([[c, -n], [n, c]])
        dev = {}
        for m in common:
            p = s * R @ free_poses[m][:2] + t
            sig = math.sqrt(max(cov[m][0, 0] + cov[m][1, 1], 0)) if m in cov else 0.0
            sig_deg = math.degrees(math.sqrt(max(cov[m][2, 2], 0))) if m in cov else 0.0
            d = float(np.hypot(*(p - fixed[m][:2])))
            a = abs(math.degrees(float(wrap_angle(free_poses[m][2] + th - fixed[m][2]))))
            tol, tol_deg = max(moved_mm, 4 * sig), max(1.5, 4 * sig_deg)
            dev[m] = (d, a, max(d / tol, a / tol_deg))
        return s, th, dev

    s, th, dev = fit(inliers)
    while len(inliers) > 2:
        worst = max(inliers, key=lambda m: dev[m][2])
        if dev[worst][2] <= 1:
            break
        inliers.remove(worst)
        s, th, dev = fit(inliers)
    check = {
        "markers": common,
        "scale": round(s, 5),
        "rotation_deg": round(math.degrees(th), 3),
        "deviation_mm": {m: round(dev[m][0], 1) for m in common},
    }
    moved = {}
    if len(common) >= 3:  # with two markers a move cannot be told from a scale error
        for m in common:
            if dev[m][2] > 1:
                moved[m] = f"{dev[m][0]:.1f} mm, {dev[m][1]:.1f} deg from the layout pose"
        if moved:
            warnings.append(
                f"Markers moved since the layout was made: {_ids(moved)}. They are measured again; objects attached "
                "to them follow."
            )
    if abs(s - 1) > 0.004:
        why = "the marker size is wrong (--size), or the camera's lens distorts (--calibration)"
        if len(common) == 2:
            a, b = common
            d = abs(s - 1) * float(np.hypot(*(fixed[a][:2] - fixed[b][:2])))
            warnings.append(
                f"Markers {a} and {b} are {d:.1f} mm {'further apart' if s < 1 else 'closer'} in the images than in "
                f"the layout: one of them moved, {why}."
            )
        else:
            warnings.append(
                f"Measured freely, the marker map is {abs(s - 1) * 100:.1f} % {'smaller' if s > 1 else 'larger'} than "
                f"the layout's (the layout's poses are kept): {why}."
            )
    return moved, check


def _warnings(frames, seen, poses, status, stats, unplaced, rejected, adj, warnings):
    def listing(ids, key, fmt):
        return ", ".join(f"{m} ({fmt.format(stats[m][key])})" for m in ids)

    rare = [m for m in poses if 0 < stats[m]["frames"] < MIN_SEEN]
    if rare:
        warnings.append(
            f"Seen in fewer than {MIN_SEEN} frames: {listing(rare, 'frames', '{}x')}. Film them again together with "
            "their neighbours."
        )
    for m, why in unplaced.items():
        warnings.append(f"Marker {m} could not be placed: {why}.")
    rms = [stats[m]["rms_px"] for m in poses if stats[m]["rms_px"] is not None]
    if rms:
        limit = max(2.0, 3 * float(np.median(rms)))
        high = [m for m in poses if (stats[m]["rms_px"] or 0) > limit]
        if high:
            warnings.append(
                f"High residuals: {listing(high, 'rms_px', '{:.1f} px')}. Not flat, bent, a duplicate ID, or moved "
                "while filming?"
            )
    loose = [m for m in poses if status[m] in ("surveyed", "moved") and stats[m]["sigma_mm"] > 2]
    if loose:
        warnings.append(
            f"Poorly determined: {listing(loose, 'sigma_mm', '+-{:.1f} mm')}. Film them from closer, together with "
            "more neighbours."
        )
    if adj is not None and rejected:
        n = len(adj.observations) + len(rejected)
        if len(rejected) > 0.05 * n:
            warnings.append(
                f"{len(rejected)} of {n} detections were rejected (blur, reflections, wrong detections, or a lens that "
                "distorts: use the main camera or --calibration)."
            )
    with_two = sum(1 for f in frames if len(f.markers) >= 2)
    if frames and with_two < 0.5 * len(frames):
        warnings.append(
            f"Only {100 * with_two / len(frames):.0f} % of the frames show two or more markers: add markers where the "
            "camera looks, or film from higher up."
        )


# ---------------------------------------------------------------------------------- orthophoto


@dataclass
class _View:
    """A frame that may contribute to the orthophoto, with its penalties."""

    frame: Frame
    sharp: float  # 0.45 .. 1: blur relative to the neighbouring frames
    mask: np.ndarray | None  # image regions left out (uint8, downscaled)
    markers_xy: np.ndarray  # centres of the markers used in this frame (mm)
    support_mm: float  # distance from the markers at which the weight halves
    covered: list = field(default_factory=list)  # (x, y, radius) mm: markers in view but not detected (a hand?)


def _quality(view: _View, X, Y, qmin: float, border: float = 0.04):
    """How well a frame shows layout points.

    Returns ``q`` (the blending weight before the power: image px per mm in the worst direction,
    times penalties for the image border, blur and the distance from the frame's markers, where
    the homography is extrapolated; 0 where the frame cannot be used: outside the image, masked,
    covered, or less detail than ``qmin`` px per mm) and the mean scale (px per mm, for
    anti-aliasing). The border penalty only lowers the weight: where no other frame shows a
    point, a frame's border is still used."""
    fr = view.frame
    u, v, w, (a, b, c, d) = homography_jacobian(fr.H, X, Y)
    smin, smax = singular_values_2x2(a, b, c, d)
    W, H = fr.size
    edge = np.minimum(np.minimum(u, W - 1 - u), np.minimum(v, H - 1 - v))
    dist = np.full(np.shape(X), np.inf)
    for x0, y0 in view.markers_xy:
        dist = np.minimum(dist, np.hypot(X - x0, Y - y0))
    detail = smin * view.sharp
    q = detail * np.clip(edge / (border * min(W, H)), 1e-3, 1) / (1 + (dist / view.support_mm) ** 2)
    q[(w <= 0) | (edge < 0) | ~(detail >= qmin) | (dist > EXTRAPOLATE * view.support_mm)] = 0
    if view.mask is not None:
        mh, mw = view.mask.shape
        inside = q > 0
        mu = np.clip((u[inside] * mw / W).astype(int), 0, mw - 1)
        mv = np.clip((v[inside] * mh / H).astype(int), 0, mh - 1)
        q[inside] *= view.mask[mv, mu] == 0
    for x0, y0, r in view.covered:
        q[np.hypot(X - x0, Y - y0) < r] = 0
    return q, np.sqrt(smin * smax)


def _source_masks(sources: list[Source], user_masks) -> list[np.ndarray | None]:
    """Per source: the detected static overlay plus the user's mask rectangles (fractions of the image)."""
    out = []
    for src in sources:
        mask = None if src.overlay is None else src.overlay.copy()
        if user_masks:
            if mask is None:
                w, h = src.size if src.size[0] else (1600, 900)
                mask = np.zeros((max(1, h // 4), max(1, w // 4)), np.uint8)
            mh, mw = mask.shape
            for x0, y0, x1, y1 in user_masks:
                mask[int(y0 * mh) : int(math.ceil(y1 * mh)), int(x0 * mw) : int(math.ceil(x1 * mw))] = 1
        out.append(mask)
    return out


def _covered_markers(f: Frame, result: SurveyResult, size_of) -> list[tuple[float, float, float]]:
    """Placed markers that are well inside the frame and large enough, but were not detected: something
    (a hand, a train) covers them, so that part of the frame is left out of the orthophoto."""
    out = []
    W, H = f.size
    for m, pose in result.poses.items():
        if m in f.markers:
            continue
        size = size_of(m)
        p = apply_h(f.H, pose_apply(pose, marker_corners_mm(size)))
        if not np.all(np.isfinite(p)):
            continue
        side = float(np.min(np.hypot(*(np.roll(p, -1, 0) - p).T)))
        margin = 0.05 * min(W, H)
        if (
            side >= 12  # the detector finds markers from about 8 px
            and p[:, 0].min() > margin
            and p[:, 1].min() > margin
            and p[:, 0].max() < W - margin
            and p[:, 1].max() < H - margin
        ):
            out.append((float(pose[0]), float(pose[1]), 2.5 * size))
    return out


def _ortho_views(result: SurveyResult, sources: list[Source], user_masks=(), size_of=None) -> list[_View]:
    """Frames that may contribute to the orthophoto: two or more markers, a homography that fits."""
    size_of = size_of or (lambda m: 30.0)
    frames = [f for f in result.frames if f.H is not None and len(f.used) >= 2]
    if not frames:
        return []
    med = float(np.median([f.rms for f in frames]))
    frames = [f for f in frames if f.rms <= max(2.5, 3 * med)]
    masks = _source_masks(sources, user_masks)
    seqs = defaultdict(list)
    for f in result.frames:
        seqs[f.source].append(f)
    position = {id(f): k for seq in seqs.values() for k, f in enumerate(seq)}
    views = []
    for f in frames:
        sharp = 1.0
        if sources[f.source].kind == "video":  # blur relative to the neighbouring frames (content changes slowly)
            seq, k = seqs[f.source], position[id(f)]
            ref = float(np.median([g.sharpness for g in seq[max(0, k - 7) : k + 8]]))
            sharp = float(np.clip(f.sharpness / ref, 0.2, 1.0)) ** 0.5 if ref > 0 else 1.0
        xy = np.array([result.poses[m][:2] for m in f.used if m in result.poses])
        spread = float(np.max(np.hypot(*(xy[:, None] - xy[None]).transpose(2, 0, 1)))) if len(xy) > 1 else 0.0
        views.append(
            _View(f, sharp, masks[f.source], xy, max(200.0, 0.6 * spread), _covered_markers(f, result, size_of))
        )
    return views


def ortho_bounds(result: SurveyResult, views: list[_View], coarsest_mm: float = 3.0) -> tuple[list[float], float]:
    """Bounds (mm, multiples of 10) of the part of the layout seen with enough detail (at most
    ``coarsest_mm`` per image pixel), and the best quality found (for the blending weights)."""
    xy = np.array([p[:2] for p in result.poses.values()])
    lo, hi = xy.min(0), xy.max(0)
    margin = max(400.0, 0.6 * float(np.max(hi - lo)))
    lo, hi = lo - margin, hi + margin
    cell = max(5.0, float(np.max(hi - lo)) / 500)
    xs = np.arange(lo[0], hi[0], cell) + cell / 2
    ys = np.arange(lo[1], hi[1], cell) + cell / 2
    X, Y = np.meshgrid(xs, ys)
    best = np.zeros(X.shape)
    for view in views:
        np.maximum(best, _quality(view, X, Y, 1 / coarsest_mm)[0], out=best)
    seen = (best > 0).astype(np.uint8)
    seen = cv2.morphologyEx(seen, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    if not seen.any():
        raise SurveyError("No part of the layout is seen with enough detail for an orthophoto.")
    rows, cols = np.flatnonzero(seen.any(1)), np.flatnonzero(seen.any(0))
    b = [xs[cols[0]] - cell / 2, ys[rows[0]] - cell / 2, xs[cols[-1]] + cell / 2, ys[rows[-1]] + cell / 2]
    bounds = [
        math.floor(b[0] / 10) * 10,
        math.floor(b[1] / 10) * 10,
        math.ceil(b[2] / 10) * 10,
        math.ceil(b[3] / 10) * 10,
    ]
    return [float(v) for v in bounds], float(best.max())


@dataclass
class Orthophoto:
    """Top view of the layout: row 0 at ``bounds[3]`` (ymax), column 0 at ``bounds[0]`` (xmin)."""

    image: np.ndarray
    bounds: list[float]  # xmin, ymin, xmax, ymax (mm)
    mm_per_px: float
    frames: int
    coverage: float

    def to_px(self, pts) -> np.ndarray:
        """Layout mm -> continuous image coordinates (pixel (u, v) spans u .. u+1)."""
        pts = np.asarray(pts, float).reshape(-1, 2)
        return np.column_stack(
            [(pts[:, 0] - self.bounds[0]) / self.mm_per_px, (self.bounds[3] - pts[:, 1]) / self.mm_per_px]
        )

    def json(self, image: str) -> dict:
        """The ``view.ortho`` entry of a layout file."""
        return {"image": image, "bounds_mm": [round(float(v), 1) for v in self.bounds]}


def _read_views(views: list[_View], sources: list[Source], calibration: dict | None):
    """Yield (view index, image) for the views' frames, reading every source once in order."""
    wanted = defaultdict(dict)
    for i, view in enumerate(views):
        wanted[view.frame.source][view.frame.index] = i
    for si, todo in wanted.items():
        und = None
        for idx, _, img in read_frames(sources[si], wanted=set(todo)):
            if idx not in todo:
                continue
            if calibration:
                und = und or calibration_for(calibration, (img.shape[1], img.shape[0]))
                img = cv2.undistort(img, *und)
            yield todo[idx], img


def _shrink(img: np.ndarray, k: float):
    """Downscale an image by ``k`` < 1 (area average) and the matching pixel transform."""
    small = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    sx, sy = small.shape[1] / img.shape[1], small.shape[0] / img.shape[0]
    return small, np.array([[sx, 0, 0.5 * sx - 0.5], [0, sy, 0.5 * sy - 0.5], [0, 0, 1.0]])


def _gains(low: list, iterations: int = 8, rho: float = 0.02) -> np.ndarray:
    """Exposure and white-balance gains (n x 3) that make overlapping frames agree.

    ``low``: per view None or (weights, warped image) on a coarse grid. Each frame's gain is fitted
    to the mosaic of all *other* frames where they overlap (least squares, pulled slightly towards
    1); the gains are normalised to a geometric mean of 1."""
    g = np.ones((len(low), 3))
    items = [(i, item[0], item[1].astype(np.float64)) for i, item in enumerate(low) if item is not None]
    if len(items) < 2:
        return g
    for _ in range(iterations):
        num = sum(q[..., None] * g[i] * L for i, q, L in items)
        den = sum(q for _, q, _ in items)
        fits = []
        for i, q, L in items:
            others = den - q
            sel = (q > 0) & (others > 1e-9 * den.max())
            if sel.sum() < 10:
                fits.append((i, np.zeros(3), np.zeros(3)))
                continue
            mo = (num[sel] - q[sel, None] * g[i] * L[sel]) / others[sel, None]
            fits.append((i, np.sum(q[sel, None] * L[sel] * mo, 0), np.sum(q[sel, None] * L[sel] ** 2, 0)))
        bbar = np.mean([b for _, _, b in fits], 0) + 1e-9
        for i, a, b in fits:
            g[i] = (a + rho * bbar) / (b + rho * bbar)
        wts = np.array([q.sum() for _, q, _ in items])
        ids = [i for i, _, _ in items]
        g[ids] /= np.exp(np.sum(wts[:, None] * np.log(g[ids]), 0) / wts.sum())
        np.clip(g, 0.67, 1.5, out=g)
    return g


def orthophoto(
    result: SurveyResult,
    sources: list[Source],
    *,
    bounds=None,
    mm_per_px: float = 1.0,
    max_side: int = 2000,
    coarsest_mm: float = 3.0,
    masks=(),
    calibration: dict | None = None,
    size_of=None,
    log=None,
) -> Orthophoto:
    """Pass 2: compose the orthophoto from the frames used in the survey.

    ``bounds``: [xmin, ymin, xmax, ymax] in mm; entries that are None are found automatically (the
    part of the layout seen with at most ``coarsest_mm`` per image pixel). The resolution is
    coarsened if the longest side would exceed ``max_side`` pixels. The frames are read twice:
    first coarsely to balance their exposure (:func:`_gains`), then at full resolution."""
    views = _ortho_views(result, sources, masks, size_of)
    if not views:
        raise SurveyError("No frame shows two or more placed markers: an orthophoto needs them.")
    auto, qmax = ortho_bounds(result, views, coarsest_mm)
    b = [auto[i] if bounds is None or bounds[i] is None else float(bounds[i]) for i in range(4)]
    if b[2] <= b[0] or b[3] <= b[1]:
        raise SurveyError(f"Empty orthophoto area {b} (check --ortho-bounds)")
    res = max(float(mm_per_px), math.ceil(100 * max(b[2] - b[0], b[3] - b[1]) / max_side) / 100)
    W, H = int(math.ceil((b[2] - b[0]) / res - 1e-6)), int(math.ceil((b[3] - b[1]) / res - 1e-6))
    # whole pixels: the area grows by less than a pixel, on the side that was not given explicitly
    given = [bounds is not None and bounds[i] is not None for i in range(4)]
    if given[2] and not given[0]:
        b[0] = b[2] - W * res
    else:
        b[2] = b[0] + W * res
    if given[1] and not given[3]:
        b[3] = b[1] + H * res
    else:
        b[1] = b[3] - H * res
    A = np.array([[res, 0, b[0] + 0.5 * res], [0, -res, b[3] - 0.5 * res], [0, 0, 1.0]])  # output px -> mm
    qmin = 1 / coarsest_mm

    def grid(step):  # layout coordinates of the centres of step x step blocks of output pixels
        cx = np.arange(0, W, step) + (step - 1) / 2
        cy = np.arange(0, H, step) + (step - 1) / 2
        return np.meshgrid(b[0] + (cx + 0.5) * res, b[3] - (cy + 0.5) * res)

    # 1. exposure: every frame warped onto a coarse grid (1/16 of the output)
    G = 16
    XL, YL = grid(G)
    AL = A @ np.array([[G, 0, (G - 1) / 2], [0, G, (G - 1) / 2], [0, 0, 1.0]])
    low: list = [None] * len(views)
    for i, img in _read_views(views, sources, calibration):
        q, _ = _quality(views[i], XL, YL, qmin)
        if q.any():
            small, S = _shrink(img, 1 / 8)
            L = cv2.warpPerspective(
                small,
                S @ views[i].frame.H @ AL,
                (XL.shape[1], XL.shape[0]),
                flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
            )
            low[i] = (q.astype(np.float32), L.astype(np.float32))
    gains = _gains(low)

    # 2. full resolution; weights on a grid of 4 x 4 output pixels, interpolated
    step = 4
    CX, CY = grid(step)
    acc = np.zeros((H, W, 3), np.float32)
    wsum = np.zeros((H, W), np.float32)
    used = 0
    for i, img in _read_views(views, sources, calibration):
        q, scale = _quality(views[i], CX, CY, qmin)
        if not q.any():
            continue
        rows, cols = np.flatnonzero(q.any(1)), np.flatnonzero(q.any(0))
        r0, r1 = max(0, rows[0] - 1), min(q.shape[0], rows[-1] + 2)
        c0, c1 = max(0, cols[0] - 1), min(q.shape[1], cols[-1] + 2)
        y0, y1, x0, x1 = r0 * step, min(H, r1 * step), c0 * step, min(W, c1 * step)
        qb = q[r0:r1, c0:c1]
        # tiny but positive where usable: a frame's border still fills what no other frame shows
        w = np.where(qb > 0, np.maximum((qb / qmax) ** ORTHO_POWER, 1e-30), 0).astype(np.float32)
        w = cv2.resize(w, ((c1 - c0) * step, (r1 - r0) * step), interpolation=cv2.INTER_LINEAR)[: y1 - y0, : x1 - x0]
        # anti-aliasing: shrink frames that have much more detail than the output
        zoom = float(np.median(scale[r0:r1, c0:c1][q[r0:r1, c0:c1] > 0])) * res
        S = np.eye(3)
        if zoom > 1.5:
            img, S = _shrink(img, 1.25 / zoom)
        M = S @ views[i].frame.H @ A @ np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1.0]])
        warped = cv2.warpPerspective(
            img, M, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE
        )
        acc[y0:y1, x0:x1] += warped.astype(np.float32) * (w[..., None] * gains[i].astype(np.float32))
        wsum[y0:y1, x0:x1] += w
        used += 1
    if log:
        log(f"  orthophoto: {used} frames, exposure gains {gains.min():.2f} .. {gains.max():.2f}")
    covered = wsum > 0
    out = np.empty((H, W, 3), np.uint8)
    out[:] = ORTHO_BACKGROUND
    out[covered] = np.clip(acc[covered] / wsum[covered][:, None] + 0.5, 0, 255).astype(np.uint8)
    return Orthophoto(out, [round(v, 3) for v in b], res, used, float(covered.mean()))


# ---------------------------------------------------------------------------------- layout and report


def resolve_point(p, poses):
    """A layout point: [x, y] or {"marker": id, "offset": [dx, dy]} (None if it cannot be resolved)."""
    if isinstance(p, list | tuple) and len(p) >= 2:
        return np.array([float(p[0]), float(p[1])])
    if isinstance(p, dict) and p.get("marker") is not None:
        pose = poses.get(int(p["marker"]))
        if pose is None:
            return None
        return pose_apply(pose, [p.get("offset") or [0, 0]])[0]
    return None


def platform_outline(o: dict, poses) -> np.ndarray | None:
    """Corners of a platform object (as web/arail/objects/platform.js computes them)."""
    if isinstance(o.get("between"), list) and len(o["between"]) == 2:
        a, b = (poses.get(int(m)) for m in o["between"])
        if a is None or b is None:
            return None
        a, b = a[:2], b[:2]
    else:
        a, b = resolve_point(o.get("from"), poses), resolve_point(o.get("to"), poses)
        if a is None or b is None:
            return None
    d = b - a
    n_ = float(np.hypot(*d))
    if n_ < 1:
        return None
    u = d / n_
    n = np.array([-u[1], u[0]])
    off, ext = float(o.get("offset_mm") or 0), float(o.get("extend_mm") or 0)
    a = a + n * off - u * ext
    b = b + n * off + u * ext
    h = max(1.0, float(o.get("width_mm") or 50)) / 2
    return np.array([a - n * h, b - n * h, b + n * h, a + n * h])


def check_image(ortho: Orthophoto, layout: dict | None, result: SurveyResult, size_of) -> np.ndarray:
    """The orthophoto with a 100 mm grid, the markers (orange), platforms (red), tracks (yellow) and
    the other objects of the layout: they must lie on their real counterparts."""
    img = ortho.image.copy()
    H, W = img.shape[:2]
    lw = max(1, round(min(W, H) / 700))
    fs = max(0.4, min(W, H) / 1600)
    grid = img.copy()
    b = ortho.bounds
    for x in np.arange(math.ceil(b[0] / 100) * 100, b[2], 100):
        px = int(round(ortho.to_px([[x, 0]])[0, 0]))
        cv2.line(grid, (px, 0), (px, H - 1), (255, 255, 255) if x else (0, 0, 0), lw)
    for y in np.arange(math.ceil(b[1] / 100) * 100, b[3], 100):
        py = int(round(ortho.to_px([[0, y]])[0, 1]))
        cv2.line(grid, (0, py), (W - 1, py), (255, 255, 255) if y else (0, 0, 0), lw)
    img = cv2.addWeighted(grid, 0.35, img, 0.65, 0)

    def poly(pts, colour, closed=True, width=None):
        p = np.round(ortho.to_px(pts) * 16).astype(np.int32)
        cv2.polylines(img, [p], closed, colour, width or 2 * lw, cv2.LINE_AA, shift=4)

    def label(text, at, colour):
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, fs, max(1, lw))
        x, y = int(at[0]), int(at[1])
        cv2.rectangle(img, (x - 2, y - th - 4), (x + tw + 2, y + 4), (80, 20, 0), -1)
        cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, fs, colour, max(1, lw), cv2.LINE_AA)

    poses = result.poses
    for o in (layout or {}).get("objects", []):
        if not isinstance(o, dict):
            continue
        t = o.get("type")
        if t == "platform":
            c = platform_outline(o, poses)
            if c is not None:
                poly(c, CHECK_PLATFORM)
                label(str(o.get("name") or o.get("id")), ortho.to_px([c.mean(0)])[0], (255, 255, 255))
        elif isinstance(o.get("points"), list):
            pts = [resolve_point(p, poses) for p in o["points"]]
            if pts and all(p is not None for p in pts):
                closed = t not in ("track", "road")
                poly(np.array(pts), CHECK_TRACK if t == "track" else CHECK_OTHER, closed, lw if closed else None)
        elif o.get("position") is not None:
            p = resolve_point(o["position"], poses)
            if p is not None:
                q = ortho.to_px([p])[0]
                cv2.drawMarker(img, (int(q[0]), int(q[1])), CHECK_OTHER, cv2.MARKER_CROSS, 6 * lw + 6, 2 * lw)
    for m, pose in poses.items():
        corners = pose_apply(pose, marker_corners_mm(size_of(m)))
        poly(corners, CHECK_MARKER)
        q = ortho.to_px(corners)
        label(str(m), (q[:, 0].max() + 4 * lw, q[:, 1].min() + 4 * lw), (255, 255, 255))
    legend = (
        "markers (orange)  platforms (red)  tracks (yellow)  other objects (turquoise)  grid 100 mm, axes black  "
        f"{ortho.mm_per_px:.2f} mm/px"
    )
    label(legend, (8, H - 10), (255, 255, 255))
    return img


def layout_json(
    result: SurveyResult,
    base: dict | None,
    dictionary: str | None,
    size_mm: float,
    sizes_mm: dict,
    codes: int,
    ortho: dict | None = None,
    *,
    locked: bool = True,
    moving=(),
) -> dict:
    """The layout with all surveyed poses (merged into ``base``). ``locked``: the app then uses only
    these markers (no survey in live mode); ``moving``: marker IDs on vehicles (``markers.moving``)."""
    out = (
        json.loads(json.dumps(base))
        if base
        else {
            "format": LAYOUT_FORMAT,
            "name": "Surveyed layout",
            "description": "Marker map surveyed with arail-survey.",
            "scale": 87,
            "objects": [],
        }
    )
    markers = dict(out.get("markers") or {})
    if dictionary:
        markers["dictionary"] = app_dictionary(dictionary)
    markers["size_mm"] = _tidy(size_mm)
    if sizes_mm:
        markers["sizes_mm"] = {str(k): _tidy(v) for k, v in sorted(sizes_mm.items())}
    moving = sorted({int(m) for m in moving})
    highest = max([*result.poses, *moving], default=-1)
    markers["codes"] = max(int(markers.get("codes") or 0), codes, highest + 1)
    if result.origin is not None:
        markers["origin"] = result.origin
    for key in ("locked", "moving", "poses"):  # written in this order, after the other keys
        markers.pop(key, None)
    if locked:
        markers["locked"] = True
    if moving:
        markers["moving"] = moving
    markers["poses"] = {str(m): result.pose_json(m) for m in sorted(result.poses)}
    out["markers"] = markers
    if ortho:
        view = dict(out.get("view") or {})
        view["ortho"] = ortho
        out["view"] = view
    return out


def _tidy(v: float):
    """A whole number as int (30, not 30.0: layout files stay as people write them)."""
    return int(v) if float(v).is_integer() else float(v)


def report_json(result: SurveyResult, sources: list[Source], settings: dict, ortho: dict | None = None) -> dict:
    frames = result.frames
    return {
        "format": FORMAT,
        "created": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "inputs": [
            {
                "path": s.path,
                "kind": s.kind,
                "size": list(s.size),
                "frames": s.count,
                "fps": round(s.fps, 3) if s.fps else None,
                "overlay_masked": bool(s.overlay is not None),
            }
            for s in sources
        ],
        "settings": settings,
        "frames": {
            "analysed": len(frames),
            "with_markers": sum(1 for f in frames if f.markers),
            "with_two_or_more": sum(1 for f in frames if len(f.markers) >= 2),
            "used": sum(1 for f in frames if f.H is not None),
        },
        "observations": result.observations,
        "rejected_observations": result.rejected,
        "rms_px": round(result.rms_px, 3),
        "iterations": result.iterations,
        "origin": result.origin,
        "markers": {
            str(m): {"pose": result.pose_json(m), "status": result.status[m], **result.stats[m]} for m in result.poses
        },
        "not_placed": {str(m): why for m, why in result.unplaced.items()},
        "duplicates": {str(m): n for m, n in sorted(result.duplicates.items())},
        "ignored_ids": {str(m): n for m, n in sorted(result.ignored.items())},
        "moving": {str(m): n for m, n in sorted(result.moving.items())},
        "layout_check": result.layout_check,
        "distances": result.distances,
        "warnings": result.warnings,
        "ortho": ortho,
    }


def summary(result: SurveyResult) -> str:
    """Human-readable table of the result."""
    lines = [
        f"{len(result.frames)} frames analysed, {sum(1 for f in result.frames if f.H is not None)} used; "
        f"{result.observations} marker observations, RMS {result.rms_px:.2f} px"
        + (f", {result.rejected} rejected" if result.rejected else ""),
        "",
        "   ID     x mm     y mm   rot deg  frames   rms px   +-mm  status",
    ]
    for m in result.poses:
        x, y, r = result.pose_json(m)
        s = result.stats[m]
        rms = f"{s['rms_px']:.2f}" if s["rms_px"] is not None else "-"
        lines.append(
            f"{m:5d} {x:8.1f} {y:8.1f} {r:9.2f} {s['frames']:7d} {rms:>8} {s['sigma_mm']:6.2f}  {result.status[m]}"
        )
    for m, why in result.unplaced.items():
        lines.append(f"{m:5d}  not placed: {why}")
    if result.warnings:
        lines += ["", "Warnings:"] + [f"  - {w}" for w in result.warnings]
    return "\n".join(lines)


def _write_json(path: str, data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
    except OSError as exc:
        raise SurveyError(f"Cannot write {path}: {exc.strerror or exc}") from exc


def _write_jpeg(path: str, img: np.ndarray, quality: int = 82) -> None:
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        ok = cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, quality, cv2.IMWRITE_JPEG_OPTIMIZE, 1])
    except (OSError, cv2.error) as exc:
        raise SurveyError(f"Cannot write {path}: {exc}") from exc
    if not ok:
        raise SurveyError(f"Cannot write {path}")


# ---------------------------------------------------------------------------------- command line


def _bound(v: str):
    return None if v.lower() in ("auto", "*", "-") else float(v)


def _mask(v: str):
    parts = [float(x) for x in v.split(",")]
    if len(parts) != 4 or not all(0 <= x <= 1 for x in parts) or parts[2] <= parts[0] or parts[3] <= parts[1]:
        raise argparse.ArgumentTypeError("expected X0,Y0,X1,Y1 as fractions of the image, e.g. 0.7,0.85,1,1")
    return parts


def _sizes(v: str):
    out = {}
    for item in v.split(","):
        k, _, s = item.partition("=")
        out[int(k)] = _positive(float)(s)
    return out


def _ids_arg(v: str) -> list[int]:
    ids = [x for x in v.replace(" ", "").split(",") if x]
    if not all(x.isdigit() for x in ids):
        raise argparse.ArgumentTypeError("expected marker IDs (0, 1, ...) separated by commas, e.g. 40,41")
    return [int(x) for x in ids]


def _positive(kind):
    def parse(v: str):
        x = kind(v)
        if not x > 0 or not math.isfinite(x):
            raise argparse.ArgumentTypeError(f"must be a positive number, not {v}")
        return x

    parse.__name__ = f"positive {kind.__name__}"
    return parse


def _layout_number(values: dict, key: str, default, kind, where: str = "markers"):
    """``<where>.<key>`` of the layout as a positive number (default if missing)."""
    v = values.get(key)
    if v is None:
        return default
    try:
        x = kind(v)
    except (TypeError, ValueError):
        x = None
    if x is None or not x > 0 or not math.isfinite(x):
        raise SurveyError(f"{where}.{key} of the layout must be a positive number, not {v!r}")
    return x


def _objects_using(layout: dict | None, ids) -> list[str]:
    """IDs (names) of the objects (also of the layers) that are placed relative to one of the markers ``ids``."""
    ids = set(ids)

    def refs(v):
        if isinstance(v, dict):
            m = v.get("marker")
            if isinstance(m, int | float | str) and str(m).lstrip("-").isdigit() and int(m) in ids:
                return True
            return any(refs(x) for x in v.values())
        if isinstance(v, list):
            return any(refs(x) for x in v)
        return False

    # the objects of the base and of every layer (layers: see docs/layout-format.md)
    objects = list((layout or {}).get("objects") or [])
    for layer in (layout or {}).get("layers") or []:
        if isinstance(layer, dict):
            objects += layer.get("objects") or []
    out = []
    for o in objects:
        if not isinstance(o, dict):
            continue
        between = o.get("between")
        uses = isinstance(between, list) and any(str(m).isdigit() and int(m) in ids for m in between)
        if uses or refs({k: v for k, v in o.items() if k != "between"}):
            out.append(str(o.get("name") or o.get("id")))
    return out


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="arail-survey",
        description="Survey a layout from a video or photos: marker map (fixed layout), report and orthophoto.",
        epilog="See docs/lab-session.md. Example: arail-survey lab.mp4 --layout web/layouts/ebl-lab.json "
        "-o ebl-lab.json --report report.json --ortho web/media/ebl-lab-ortho.jpg --check check.jpg",
    )
    ap.add_argument("inputs", nargs="+", help="videos and/or photos (glob patterns allowed)")
    ap.add_argument("--layout", help="layout file: its known marker poses are kept, the result is merged into it")
    ap.add_argument("--resurvey", action="store_true", help="ignore the marker poses of --layout (markers were moved)")
    ap.add_argument(
        "--refine-fixed", action="store_true", help="refine the known poses too (as priors, 2 mm / 0.5 deg)"
    )
    ap.add_argument(
        "--dictionary", help="marker type: app name (ARUCO, ...), OpenCV name or auto (default: layout's or ARUCO)"
    )
    ap.add_argument("--codes", type=_positive(int), help="marker IDs 0 ... codes-1 are used (default: layout's or 50)")
    ap.add_argument(
        "--size", type=_positive(float), help="edge of the black marker square in mm (default: layout's or 30)"
    )
    ap.add_argument("--sizes", type=_sizes, help="sizes of single markers, e.g. 7=60,8=60")
    ap.add_argument("--origin", type=int, help="marker that defines the layout frame (default: layout's or 0)")
    ap.add_argument("--every", type=_positive(int), default=2, help="analyse every n-th video frame (default 2)")
    ap.add_argument("--calibration", help="camera calibration of arail-calibrate (wide-angle cameras)")
    ap.add_argument(
        "--distance",
        nargs=3,
        type=float,
        action="append",
        default=[],
        metavar=("A", "B", "MM"),
        help="measured distance between the centres of markers A and B (tape measure): sets the scale "
        "(only checked when the layout has known poses)",
    )
    ap.add_argument(
        "--moving",
        type=_ids_arg,
        help="IDs of markers on vehicles, e.g. 40,41 (added to the layout's markers.moving): never part of the map",
    )
    ap.add_argument(
        "--unlocked",
        action="store_true",
        help="do not lock the marker map (by default the app then uses only the surveyed markers)",
    )
    ap.add_argument(
        "--moved-mm", type=_positive(float), default=5.0, help="report known markers further off than this (mm)"
    )
    ap.add_argument(
        "-o", "--output", default="survey-layout.json", help="layout file to write (default survey-layout.json)"
    )
    ap.add_argument("--report", help="write a JSON report")
    ap.add_argument("--ortho", help="write an orthophoto of the layout (JPEG)")
    ap.add_argument(
        "--ortho-res", type=_positive(float), default=1.0, help="orthophoto resolution in mm per pixel (default 1.0)"
    )
    ap.add_argument(
        "--ortho-max", type=_positive(int), default=2000, help="longest side of the orthophoto in px (default 2000)"
    )
    ap.add_argument(
        "--ortho-bounds",
        nargs=4,
        type=_bound,
        metavar=("XMIN", "YMIN", "XMAX", "YMAX"),
        help="orthophoto area in mm, 'auto' for single sides (e.g. the table edges: auto -320 auto auto)",
    )
    ap.add_argument(
        "--ortho-coarsest",
        type=_positive(float),
        default=3.0,
        help="use image parts with at most this many mm per pixel",
    )
    ap.add_argument(
        "--mask",
        type=_mask,
        action="append",
        default=[],
        help="leave an image region out of the orthophoto: X0,Y0,X1,Y1 (fractions)",
    )
    ap.add_argument(
        "--no-overlay-detection", action="store_true", help="do not look for watermarks or timestamps in videos"
    )
    ap.add_argument("--check", help="write a check image: the layout's markers, platforms and tracks on the orthophoto")
    ap.add_argument("-q", "--quiet", action="store_true", help="no progress output")
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    log = (lambda *a: None) if args.quiet else (lambda *a: print(*a, file=sys.stderr, flush=True))
    try:
        return run(args, log)
    except SurveyError as exc:
        raise SystemExit(f"arail-survey: {exc}") from exc


def run(args, log) -> int:
    base = load_layout(args.layout) if args.layout else None
    lm = (base or {}).get("markers") or {}
    moving = moving_ids(lm) | set(args.moving or [])
    codes = args.codes or _layout_number(lm, "codes", 50, int)
    codes = max(codes, max(moving, default=-1) + 1)  # moving markers must be detected, too
    dictionary = opencv_dictionary(args.dictionary or lm.get("dictionary") or "ARUCO", codes)
    size_mm = float(args.size or _layout_number(lm, "size_mm", 30.0, float))
    sizes_mm = {}
    for k in lm.get("sizes_mm") or {}:
        if not str(k).isdigit():
            raise SurveyError(f"markers.sizes_mm: {k!r} is not a marker ID")
        sizes_mm[int(k)] = _layout_number(lm["sizes_mm"], k, size_mm, float, "markers.sizes_mm")
    sizes_mm.update(args.sizes or {})
    origin = args.origin if args.origin is not None else lm.get("origin")
    if origin is not None and not str(origin).isdigit():
        raise SurveyError(f"markers.origin of the layout must be a marker ID, not {origin!r}")
    origin = 0 if origin is None else int(origin)
    if origin in moving:
        raise SurveyError(f"The origin marker {origin} is a moving marker (markers.moving, --moving).")
    for m in sorted(moving):
        if users := _objects_using(base, [m]):
            raise SurveyError(
                f"Marker {m} is a moving marker (markers.moving, --moving), but objects of the layout are placed "
                f"relative to it: {', '.join(users)}."
            )
    fixed = {}
    if not args.resurvey:
        for k, p in (lm.get("poses") or {}).items():
            if int(k) not in moving:  # a marker that became a moving one: no longer part of the map
                fixed[int(k)] = np.array([float(p[0]), float(p[1]), math.radians(float(p[2]) if len(p) > 2 else 0.0)])
    calibration = load_calibration(args.calibration) if args.calibration else None

    sources = open_sources(args.inputs)
    detector = SurveyDetector(dictionary, max_id=codes - 1)
    log(f"Detecting markers ({dictionary or 'automatic marker type'}, {size_mm:g} mm) in {len(sources)} input(s)")
    frames = detect_frames(sources, detector, args.every, calibration, not args.no_overlay_detection, log)
    dictionary = detector.name or dictionary
    # moving markers (on vehicles) are never part of the map: left out of the adjustment, and thus
    # also of the orthophoto's masks for covered markers
    moving_seen: Counter = Counter()
    for f in frames:
        for m in moving & set(f.markers):
            del f.markers[m]
            moving_seen[m] += 1
    log("Adjusting the marker map")
    result = survey(
        frames,
        size_mm,
        sizes_mm,
        fixed=fixed,
        origin=origin,
        refine_fixed=args.refine_fixed,
        moved_mm=args.moved_mm,
        distances=[(int(a), int(b), mm) for a, b, mm in args.distance],
    )
    result.duplicates = dict(detector.duplicates)
    result.ignored = {m: n for m, n in sorted(detector.above_max.items()) if n >= MIN_SEEN}
    result.moving = dict(sorted(moving_seen.items()))
    if detector.duplicates:
        result.warnings.append(
            "IDs seen twice in one frame (two stickers with the same ID, or misread markers?): "
            + ", ".join(f"{m} ({n} frames)" for m, n in sorted(detector.duplicates.items()))
        )
    if result.ignored:
        result.warnings.append(
            f"Markers with IDs above {codes - 1} were seen and ignored: "
            + ", ".join(f"{m} ({n} frames)" for m, n in result.ignored.items())
            + ". If they are stickers of the layout, set markers.codes in the layout (or --codes) high enough."
        )
    if args.resurvey and base:
        dropped = sorted(int(k) for k in lm.get("poses") or {} if int(k) not in result.poses and int(k) not in moving)
        if dropped:
            users = _objects_using(base, dropped)
            result.warnings.append(
                f"Markers of the layout not placed by the new survey, left out: {_ids(dropped)}"
                + (f" (objects placed relative to them: {', '.join(users)})." if users else ".")
            )

    ortho = ortho_info = None
    if args.ortho or args.check:
        log("Composing the orthophoto")
        try:
            ortho = orthophoto(
                result,
                sources,
                bounds=args.ortho_bounds,
                mm_per_px=args.ortho_res,
                max_side=args.ortho_max,
                coarsest_mm=args.ortho_coarsest,
                masks=args.mask,
                calibration=calibration,
                size_of=lambda m: sizes_mm.get(m, size_mm),
                log=log,
            )
        except SurveyError as exc:  # the marker map is still worth keeping
            result.warnings.append(f"No orthophoto: {exc}")
    if ortho is not None:
        if args.ortho:
            _write_jpeg(args.ortho, ortho.image)
            rel = os.path.relpath(os.path.abspath(args.ortho), os.path.dirname(os.path.abspath(args.output)))
            ortho_info = ortho.json(rel.replace(os.sep, "/"))
        if args.check:
            _write_jpeg(args.check, check_image(ortho, base, result, lambda m: sizes_mm.get(m, size_mm)), 85)

    layout = layout_json(
        result, base, dictionary, size_mm, sizes_mm, codes, ortho_info, locked=not args.unlocked, moving=moving
    )
    _write_json(args.output, layout)
    settings = {
        "dictionary": dictionary,
        "size_mm": size_mm,
        "sizes_mm": {str(k): v for k, v in sizes_mm.items()},
        "codes": codes,
        "every": args.every,
        "layout": args.layout,
        "resurvey": args.resurvey,
        "refine_fixed": args.refine_fixed,
        "calibration": args.calibration,
        "moving": sorted(moving),
        "locked": not args.unlocked,
    }
    rep_ortho = None
    if ortho is not None:
        rep_ortho = {
            **(ortho_info or {}),
            "bounds_mm": [round(float(v), 1) for v in ortho.bounds],
            "size": [ortho.image.shape[1], ortho.image.shape[0]],
            "mm_per_px": round(ortho.mm_per_px, 4),
            "frames": ortho.frames,
            "coverage": round(ortho.coverage, 3),
        }
    if args.report:
        _write_json(args.report, report_json(result, sources, settings, rep_ortho))

    print(summary(result))
    print(f"\nLayout: {args.output}" + (f"   report: {args.report}" if args.report else ""))
    if ortho is not None:
        W, H = ortho.image.shape[1], ortho.image.shape[0]
        print(
            f"Orthophoto: {args.ortho or '(not saved)'}  {W} x {H} px, {ortho.mm_per_px:.2f} mm/px, "
            f"{ortho.frames} frames, {100 * ortho.coverage:.0f} % covered"
        )
        if ortho_info:
            print('  "view": { "ortho": ' + json.dumps(ortho_info) + " }")
    if args.check:
        print(f"Check image: {args.check}")
    return 0


if __name__ == "__main__":
    main()
