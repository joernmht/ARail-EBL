"""Camera calibration with the layout's own markers: no calibration board needed.

Every single marker serves as a small calibration target; the markers need not be
measured or arranged in a grid. The result is a JSON file the web app can load
(View -> Camera -> Load calibration).

Is it needed? Usually not: ARail estimates the focal length from the markers. Calibrate
wide-angle webcams with visible distortion (straight edges bend near the image border),
or when people and buildings lean near the border.

Live, with a preview window (needs a desktop OpenCV build, `pip install -e 'tools[opencv]'`):

    arail-calibrate --camera 0 --width 1280 --height 720

  Move a marker (flat on cardboard) in front of the camera, or move the camera over the layout:
  tilt it 30-60 degrees in different directions, also near the image borders and corners,
  markers at least ~40 px large. Space = capture, A = automatic capture, C = compute and save
  (needs 40 views), Q = quit.

From photos (e.g. of a phone camera; use the same resolution as later in the app):

    arail-calibrate --images photos/*.jpg

The calibration only fits the camera and image shape (aspect ratio) it was made with.
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import sys
import time

import numpy as np

from .aruco import MarkerDetector, cv2, marker_corners_mm

FORMAT = "arail-camera/1"
MIN_VIEWS = 40
MIN_EDGE_PX = 35


def object_points(size: float = 30.0) -> np.ndarray:
    p = np.zeros((4, 3), np.float32)
    p[:, :2] = marker_corners_mm(size)
    return p


def compute(views: list[np.ndarray], image_size: tuple[int, int], marker_size: float = 30.0):
    """Calibrate from marker views (each a 4x2 array of image corners).
    Returns (rms_px, camera_matrix 3x3, distortion [k1, k2, p1, p2, k3])."""
    w, h = image_size
    K0 = np.array([[0.8 * w, 0, w / 2.0], [0, 0.8 * w, h / 2.0], [0, 0, 1.0]])
    flags = (
        cv2.CALIB_USE_INTRINSIC_GUESS
        | cv2.CALIB_FIX_PRINCIPAL_POINT
        | cv2.CALIB_FIX_ASPECT_RATIO
        | cv2.CALIB_ZERO_TANGENT_DIST
        | cv2.CALIB_FIX_K3
    )
    obj = [object_points(marker_size) for _ in views]
    img = [np.asarray(v, np.float32).reshape(-1, 1, 2) for v in views]
    criteria = (cv2.TERM_CRITERIA_COUNT + cv2.TERM_CRITERIA_EPS, 200, 1e-9)
    rms, K, dist, _, _ = cv2.calibrateCamera(obj, img, (w, h), K0, np.zeros(5), flags=flags, criteria=criteria)
    return float(rms), K, dist.ravel()


def to_json(rms: float, K: np.ndarray, dist: np.ndarray, image_size, views: int, camera: str = "") -> dict:
    return {
        "format": FORMAT,
        "image_size": [int(image_size[0]), int(image_size[1])],
        "camera_matrix": [[round(float(v), 4) for v in row] for row in K],
        "distortion": [round(float(v), 6) for v in dist[:5]],
        "rms_px": round(rms, 4),
        "views": views,
        "camera": camera,
        "created": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }


def feature(corners: np.ndarray, w: int, h: int) -> np.ndarray:
    """Rough description of a view (position + perspective), to skip near-duplicates."""
    m = corners.mean(0)
    edges = np.linalg.norm(np.roll(corners, -1, 0) - corners, axis=1)
    return np.array([m[0] / w, m[1] / h, (edges[0] - edges[2]) / edges.mean(), (edges[1] - edges[3]) / edges.mean()])


def usable(corners: np.ndarray) -> bool:
    return float(np.linalg.norm(np.roll(corners, -1, 0) - corners, axis=1).min()) >= MIN_EDGE_PX


def save(path: str, data: dict) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def calibrate_images(paths: list[str], detector: MarkerDetector, marker_size: float, output: str) -> dict:
    views, size = [], None
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            print(f"skipped (not an image): {p}")
            continue
        s = (img.shape[1], img.shape[0])
        if size and s != size:
            print(f"skipped (different size {s}, expected {size}): {p}")
            continue
        size = s
        found = [c for c in detector.detect(img).values() if usable(c)]
        views += found
        print(f"{p}: {len(found)} usable markers")
    if len(views) < 12:
        raise SystemExit(f"Only {len(views)} usable marker views; take more photos (tilted, near the borders).")
    rms, K, dist = compute(views, size, marker_size)
    data = to_json(rms, K, dist, size, len(views), camera="photos")
    save(output, data)
    print(f"f = {K[0, 0]:.0f} px, k1 = {dist[0]:.3f}, reprojection error {rms:.2f} px -> {output}")
    return data


def _text(img, lines, x=10, y=10):
    """Semi-transparent box with text lines."""
    font, scale = cv2.FONT_HERSHEY_SIMPLEX, 0.55
    sizes = [cv2.getTextSize(t, font, scale, 1)[0] for t in lines]
    lh = int(max(s[1] for s in sizes) * 1.8) + 2
    w, h = max(s[0] for s in sizes) + 16, lh * len(lines) + 10
    roi = img[y : y + h, x : x + w]
    roi[:] = (roi * 0.35 + 25 * 0.65).astype(np.uint8)
    for i, t in enumerate(lines):
        cv2.putText(img, t, (x + 8, y + 8 + sizes[i][1] + i * lh), font, scale, (240, 240, 240), 1, cv2.LINE_AA)


def calibrate_live(args, detector: MarkerDetector) -> None:
    src = int(args.camera) if str(args.camera).isdigit() else args.camera
    cap = cv2.VideoCapture(src)
    if isinstance(src, int):
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
    ok, frame = cap.read()
    if not ok:
        raise SystemExit(f"No images from camera {args.camera!r}. Try another number (--camera 1).")
    h, w = frame.shape[:2]
    views, features = [], []
    auto, t_auto, message = False, 0.0, ""
    try:
        cv2.namedWindow("ARail calibration", cv2.WINDOW_NORMAL)
    except cv2.error as exc:
        raise SystemExit(
            "This OpenCV has no GUI support. Install 'opencv-python' (not headless) or use --images."
        ) from exc
    while ok:
        found = detector.detect(frame)
        out = frame.copy()
        good = {}
        for mid, c in found.items():
            ok_view = usable(c)
            cv2.polylines(out, [c.astype(np.int32)], True, (0, 255, 0) if ok_view else (0, 0, 255), 2)
            if ok_view:
                good[mid] = c
        for f in features:
            cv2.circle(out, (int(f[0] * w), int(f[1] * h)), 4, (255, 200, 0), -1)

        def capture(only_new: bool, good: dict) -> int:
            n = 0
            for c in good.values():
                fe = feature(c, w, h)
                if only_new and features and np.min(np.linalg.norm(np.array(features) - fe, axis=1)) < 0.08:
                    continue
                views.append(c.copy())
                features.append(fe)
                n += 1
            return n

        if auto and time.time() - t_auto > 0.4 and good and capture(True, good):
            t_auto = time.time()
        lines = [
            f"Dictionary: {detector.name or 'detecting...'}",
            f"Views: {len(views)} (at least {MIN_VIEWS})",
            "Space capture   A auto " + ("ON" if auto else "off") + "   C compute   Q quit",
            "Tilt the markers, and use the image borders too!",
        ]
        if message:
            lines.append(message)
        _text(out, lines)
        cv2.imshow("ARail calibration", out)
        k = cv2.waitKey(1) & 0xFF
        if k in (ord("q"), 27):
            break
        if k == ord(" "):
            message = f"{capture(False, good)} view(s) captured"
        elif k == ord("a"):
            auto = not auto
        elif k == ord("c"):
            if len(views) < MIN_VIEWS:
                message = f"Not enough views yet ({len(views)}/{MIN_VIEWS})"
            else:
                rms, K, dist = compute(views, (w, h), args.marker_size)
                save(args.output, to_json(rms, K, dist, (w, h), len(views), camera=str(args.camera)))
                message = f"Saved: f = {K[0, 0]:.0f} px, k1 = {dist[0]:.3f}, error {rms:.2f} px"
                if rms > 1.0:
                    message += "  (high: capture more tilted views)"
                print(message, "->", args.output)
        ok, frame = cap.read()
    cap.release()
    cv2.destroyAllWindows()


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Camera calibration with ArUco markers (no calibration board)")
    ap.add_argument("--camera", default="0", help="camera number or video file (live mode)")
    ap.add_argument("--images", nargs="*", help="calibrate from photos instead (glob patterns allowed)")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--dictionary", default="DICT_ARUCO_ORIGINAL", help="OpenCV dictionary name or 'auto'")
    ap.add_argument("--marker-size", type=float, default=30.0, help="edge of the black square in mm")
    ap.add_argument("--output", default="camera-calibration.json")
    args = ap.parse_args(argv)
    detector = MarkerDetector(None if args.dictionary == "auto" else args.dictionary)
    if args.images is not None:
        paths = sorted(p for pattern in args.images for p in (glob.glob(pattern) or [pattern]))
        if not paths:
            sys.exit("No images given.")
        calibrate_images(paths, detector, args.marker_size, args.output)
    else:
        calibrate_live(args, detector)


if __name__ == "__main__":
    main()
