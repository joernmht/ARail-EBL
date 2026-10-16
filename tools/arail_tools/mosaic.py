"""Join the orthophotos of the linked marker groups into one solid orthophoto (arail-mosaic).

The photo map of the lab (``web/lab-map/data.json``) has an orthophoto for every marker group of the
survey, each in the frame of its group, and the pose of every group in the hall frame. The groups
whose places the survey linked (``approx: false``) are one connected piece of the table. This tool
puts their orthophotos into the frame of a layout and joins them, together with the layout's own
orthophoto (the reference: finer, and in the layout frame already), into one orthophoto for the
flyover::

    arail-mosaic web/lab-map/data.json --reference web/media/ebl-neustadt-ortho.jpg \\
        --bounds -2400 -70 3750 650 --out web/media/ebl-neustadt-linked-ortho.jpg

1. Frame: where the hall frame lies in the layout frame, from features (SIFT) of the groups'
   orthophotos found again in the reference, a similarity (rotation, shift and scale) fitted with
   RANSAC. ``--frame x y deg scale`` gives it instead.
2. Pieces: every orthophoto in the layout frame; the parts the survey did not see (its flat grey)
   are left out.
3. Exposure: each piece's brightness matched to the pieces before it where they overlap (the
   reference first).
4. Seams: for every pixel the piece with the most detail wins (finer pieces, and points farther from
   a piece's edge), with a narrow blend at the seams.
5. Solid: holes and gaps between the pieces up to ``--close`` mm wide are filled smoothly from
   their surroundings. Around the table the flat grey stays, which the flyover leaves
   transparent.

Prints the frame and the ``view.ortho`` entry of the layout (JSON).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass

import numpy as np

from .aruco import cv2

FORMAT = "arail-lab-map/1"
GREY = (214, 214, 214)  # what the survey did not see (survey.ORTHO_BACKGROUND, BGR)
GREY_TOLERANCE = 8  # JPEG noise around the flat grey
RAMP_MM = 200.0  # a piece's weight grows from its edge to this far inside
SEAM = 0.04  # width of the blend at a seam, in units of the weight
MATCH_PX_PER_MM = 0.27  # scale the features are compared at (that of the photo map's orthophotos)


class MosaicError(Exception):
    pass


@dataclass
class Piece:
    """An orthophoto: its image (BGR) and the map from its pixels to a frame (mm)."""

    name: str
    image: np.ndarray
    to_frame: np.ndarray  # 3x3: pixel (u, v) -> frame (x, y), mm

    @property
    def mm_per_px(self) -> float:
        return float(np.sqrt(abs(np.linalg.det(self.to_frame[:2, :2]))))

    def moved(self, M: np.ndarray) -> Piece:
        """The same piece in another frame (M: 3x3, old frame -> new frame)."""
        return Piece(self.name, self.image, M @ self.to_frame)


def pixels_to_mm(bounds, width: int, height: int) -> np.ndarray:
    """Pixel -> mm of an orthophoto with ``bounds_mm`` (row 0 at ymax, column 0 at xmin)."""
    x0, y0, x1, y1 = (float(v) for v in bounds)
    return np.array([[(x1 - x0) / width, 0, x0], [0, -(y1 - y0) / height, y1], [0, 0, 1]], float)


def similarity(x: float, y: float, deg: float, scale: float = 1.0) -> np.ndarray:
    """3x3: a point of a frame -> the frame it is placed in (rotation, then shift)."""
    c, s = scale * np.cos(np.radians(deg)), scale * np.sin(np.radians(deg))
    return np.array([[c, -s, x], [s, c, y], [0, 0, 1]], float)


def covered(image: np.ndarray) -> np.ndarray:
    """uint8 mask (255) of what the survey saw: not its flat grey, two pixels in from its edge (the
    JPEG fringe of the grey is left out, too)."""
    seen = (np.abs(image.astype(np.int16) - np.array(GREY, np.int16)).max(axis=2) > GREY_TOLERANCE).astype(np.uint8)
    return cv2.erode(seen, np.ones((5, 5), np.uint8)) * 255


def load_groups(data: dict, base: str, ids=None) -> list[Piece]:
    """The orthophotos of the groups of the photo map, in the hall frame (default: the linked groups)."""
    if data.get("format") != FORMAT:
        raise MosaicError(f'not a photo map (expected "format": "{FORMAT}")')
    groups = data.get("groups") or {}
    ids = list(ids) if ids else [g for g, v in groups.items() if v.get("approx") is False and v.get("ortho")]
    out = []
    for gid in ids:
        g = groups.get(gid)
        if not g or not g.get("ortho"):
            raise MosaicError(f"group {gid} has no orthophoto")
        path = os.path.join(base, g["ortho"]["image"])
        img = cv2.imread(path)
        if img is None:
            raise MosaicError(f"cannot read {path}")
        h, w = img.shape[:2]
        out.append(Piece(gid, img, similarity(*g["pose"]) @ pixels_to_mm(g["ortho"]["bounds_mm"], w, h)))
    if not out:
        raise MosaicError("no linked group with an orthophoto")
    return out


def _features(piece: Piece, sift):
    """SIFT keypoints (in the piece's frame, mm) and descriptors, at MATCH_PX_PER_MM."""
    k = min(1.0, MATCH_PX_PER_MM * piece.mm_per_px)
    small = cv2.resize(piece.image, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else piece.image
    grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    mask = cv2.resize(covered(piece.image), (grey.shape[1], grey.shape[0]), interpolation=cv2.INTER_NEAREST)
    kp, desc = sift.detectAndCompute(grey, mask)
    if desc is None:
        return np.zeros((0, 2)), None
    uv = np.array([p.pt for p in kp], float) / k
    xy = (piece.to_frame @ np.column_stack([uv, np.ones(len(uv))]).T).T[:, :2]
    return xy, desc


def register(reference: Piece, pieces: list[Piece], threshold_mm: float = 15.0) -> dict:
    """Where the pieces' frame (the hall) lies in the reference's frame (the layout): a similarity
    from features found in both, fitted with RANSAC. Returns {matrix, x, y, deg, scale, matches,
    inliers, rms_mm}."""
    sift = cv2.SIFT_create(8000)
    ref_xy, ref_desc = _features(reference, sift)
    if ref_desc is None:
        raise MosaicError("no features in the reference orthophoto")
    matcher = cv2.BFMatcher()
    src, dst = [], []
    for p in pieces:
        xy, desc = _features(p, sift)
        if desc is None or len(desc) < 2:
            continue
        for m in matcher.knnMatch(desc, ref_desc, k=2):
            if len(m) == 2 and m[0].distance < 0.75 * m[1].distance:
                src.append(xy[m[0].queryIdx])
                dst.append(ref_xy[m[0].trainIdx])
    if len(src) < 10:
        raise MosaicError(f"only {len(src)} features match the reference: give the frame with --frame")
    src, dst = np.array(src, np.float32), np.array(dst, np.float32)
    A, inl = cv2.estimateAffinePartial2D(
        src, dst, method=cv2.RANSAC, ransacReprojThreshold=threshold_mm, maxIters=20000, confidence=0.999
    )
    ok = inl is not None and A is not None and int(inl.sum()) >= 10
    if not ok:
        raise MosaicError("the pieces do not fit the reference: give the frame with --frame")
    inl = inl[:, 0] > 0
    res = src[inl] @ A[:, :2].T + A[:, 2] - dst[inl]
    M = np.vstack([A, [0, 0, 1]])
    return {
        "matrix": M,
        "x": float(A[0, 2]),
        "y": float(A[1, 2]),
        "deg": float(np.degrees(np.arctan2(A[1, 0], A[0, 0]))),
        "scale": float(np.hypot(A[0, 0], A[1, 0])),
        "matches": len(src),
        "inliers": int(inl.sum()),
        "rms_mm": float(np.sqrt((res**2).sum(axis=1).mean())),
    }


def fill_in(image: np.ndarray, known: np.ndarray) -> np.ndarray:
    """A smooth fill of an image's unknown pixels from the known ones (push-pull over an image
    pyramid: each level is filled from the coarser one where it knows little). Returns float32."""
    w = known.astype(np.float32)
    levels = [(image.astype(np.float32) * w[..., None], w)]
    while min(levels[-1][1].shape) > 4:
        a, b = levels[-1]
        levels.append((cv2.pyrDown(a), cv2.pyrDown(b)))
    a, b = levels[-1]
    fill = a.reshape(-1, 3).sum(axis=0) / max(float(b.sum()), 1e-6) * np.ones_like(a)
    for a, b in reversed(levels):
        if fill.shape[:2] != b.shape:
            fill = cv2.pyrUp(fill, dstsize=(b.shape[1], b.shape[0]))
        t = np.clip(b, 0, 1)[..., None]
        fill = a / np.maximum(b, 1e-6)[..., None] * t + fill * (1 - t)
    return fill


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    """The mask with every hole filled (what cannot be reached from the border)."""
    h, w = mask.shape
    pad = np.zeros((h + 2, w + 2), np.uint8)
    pad[1:-1, 1:-1] = mask > 0
    outside = np.zeros((h + 4, w + 4), np.uint8)
    cv2.floodFill(pad, outside, (0, 0), 2)
    return ((pad[1:-1, 1:-1] != 2) * 255).astype(np.uint8)


def compose(pieces: list[Piece], mm_per_px: float = 2.0, close_mm: float = 150.0, margin_mm: float = 30.0):
    """Join pieces (all in one frame; the first has its exposure kept) into one solid orthophoto.
    Returns (image BGR, bounds_mm [xmin, ymin, xmax, ymax])."""
    # the region they cover
    corners = []
    for p in pieces:
        ys, xs = np.nonzero(covered(p.image))
        if not len(xs):
            continue
        uv = np.array(
            [[xs.min(), ys.min()], [xs.max() + 1, ys.min()], [xs.max() + 1, ys.max() + 1], [xs.min(), ys.max() + 1]]
        )
        corners.append((p.to_frame @ np.column_stack([uv, np.ones(4)]).T).T[:, :2])
    if not corners:
        raise MosaicError("the pieces show nothing")
    c = np.vstack(corners)
    x0, y0 = c.min(axis=0) - margin_mm
    x1, y1 = c.max(axis=0) + margin_mm
    W, H = int(np.ceil((x1 - x0) / mm_per_px)), int(np.ceil((y1 - y0) / mm_per_px))
    to_out = np.linalg.inv(pixels_to_mm([x0, y0, x0 + W * mm_per_px, y1], W, H))
    finest = min(p.mm_per_px for p in pieces)
    warped = []
    for p in pieces:
        img, M = p.image, to_out @ p.to_frame
        shrink = p.mm_per_px / mm_per_px
        if shrink < 0.9:  # anti-aliasing: a finer piece is first scaled down
            img = cv2.resize(img, None, fx=shrink, fy=shrink, interpolation=cv2.INTER_AREA)
            M = M @ np.diag([1 / shrink, 1 / shrink, 1])
        out = cv2.warpAffine(img, M[:2], (W, H), flags=cv2.INTER_LINEAR, borderValue=GREY)
        seen = cv2.warpAffine(covered(img), M[:2], (W, H), flags=cv2.INTER_NEAREST, borderValue=0)
        dist = cv2.distanceTransform(seen, cv2.DIST_L2, 5) * mm_per_px
        score = np.minimum(dist, RAMP_MM) / RAMP_MM * (finest / p.mm_per_px)
        warped.append((p, out.astype(np.float32), seen > 0, score.astype(np.float32)))
    # exposure: each piece matched to those before it where they overlap
    acc = np.zeros((H, W, 3), np.float32)
    have = np.zeros((H, W), bool)
    for i, (p, img, seen, score) in enumerate(warped):
        both = seen & have
        if i and both.sum() > 500:
            gain = np.median(acc[both], axis=0) / np.maximum(np.median(img[both], axis=0), 1)
            img *= np.clip(gain, 0.8, 1.25)
            warped[i] = (p, img, seen, score)
        new = seen & ~have
        acc[new] = img[new]
        have |= seen
    # seams: the most detail wins, with a narrow blend
    best = np.max([w[3] for w in warped], axis=0)
    total = np.zeros((H, W), np.float32)
    acc[:] = 0
    for _, img, seen, score in warped:
        w = np.where(seen, np.exp((score - best) / SEAM), 0).astype(np.float32)
        acc += img * w[..., None]
        total += w
    union = have
    image = np.empty((H, W, 3), np.uint8)
    image[:] = GREY
    image[union] = np.clip(acc[union] / total[union, None], 0, 255).astype(np.uint8)
    # solid: holes and narrow gaps filled from their surroundings
    k = max(3, int(round(close_mm / mm_per_px)) | 1)
    solid = _fill_holes(
        cv2.morphologyEx(
            union.astype(np.uint8) * 255, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        )
    )
    # (a pixel in from the pieces' edges: what their borders blended with the grey is filled, too)
    known = cv2.erode(union.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    gaps = (solid > 0) & ~known
    if gaps.any():
        image[gaps] = np.clip(fill_in(image, known)[gaps], 0, 255).astype(np.uint8)
    image[solid == 0] = GREY
    # cropped to the solid table, with a margin of grey
    ys, xs = np.nonzero(solid)
    m = int(round(margin_mm / mm_per_px))
    u0, v0 = max(0, xs.min() - m), max(0, ys.min() - m)
    u1, v1 = min(W, xs.max() + 1 + m), min(H, ys.max() + 1 + m)
    bounds = [x0 + u0 * mm_per_px, y1 - v1 * mm_per_px, x0 + u1 * mm_per_px, y1 - v0 * mm_per_px]
    return image[v0:v1, u0:u1], bounds


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="arail-mosaic", description=__doc__.split("\n\n")[0])
    ap.add_argument("data", help="the photo map (web/lab-map/data.json)")
    ap.add_argument("--reference", required=True, help="the layout's own orthophoto (in the layout frame)")
    ap.add_argument(
        "--bounds", required=True, nargs=4, type=float, metavar=("XMIN", "YMIN", "XMAX", "YMAX"), help="its bounds_mm"
    )
    ap.add_argument("--out", required=True, help="the joined orthophoto (JPEG)")
    ap.add_argument("--groups", help="groups to join, e.g. S01,S02 (default: the linked ones, approx: false)")
    ap.add_argument(
        "--frame",
        nargs=4,
        type=float,
        metavar=("X", "Y", "DEG", "SCALE"),
        help="the hall frame in the layout frame (instead of matching features)",
    )
    ap.add_argument("--res", type=float, default=2.0, help="mm per pixel of the result (default 2)")
    ap.add_argument("--close", type=float, default=150.0, help="gaps up to this wide are filled (mm, default 150)")
    ap.add_argument("--image", help="the image's URL in the layout (default: the file name)")
    ap.add_argument("--quality", type=int, default=85, help="JPEG quality (default 85)")
    return ap


def run(args, log) -> dict:
    with open(args.data, encoding="utf-8") as f:
        data = json.load(f)
    groups = load_groups(
        data, os.path.dirname(os.path.abspath(args.data)), args.groups.split(",") if args.groups else None
    )
    ref_img = cv2.imread(args.reference)
    if ref_img is None:
        raise MosaicError(f"cannot read {args.reference}")
    reference = Piece("reference", ref_img, pixels_to_mm(args.bounds, ref_img.shape[1], ref_img.shape[0]))
    if args.frame:
        frame = {
            "matrix": similarity(*args.frame),
            "x": args.frame[0],
            "y": args.frame[1],
            "deg": args.frame[2],
            "scale": args.frame[3],
        }
    else:
        frame = register(reference, groups)
        log(f"frame: {frame['inliers']} of {frame['matches']} features fit, rms {frame['rms_mm']:.1f} mm")
    image, bounds = compose([reference] + [g.moved(frame["matrix"]) for g in groups], args.res, args.close)
    if not cv2.imwrite(args.out, image, [cv2.IMWRITE_JPEG_QUALITY, args.quality]):
        raise MosaicError(f"cannot write {args.out}")
    log(f"{args.out}: {image.shape[1]} x {image.shape[0]} px, {', '.join(g.name for g in groups)} and the reference")
    out = {
        "frame": {k: round(float(frame[k]), 5 if k == "scale" else 2) for k in ("x", "y", "deg", "scale")},
        "groups": [g.name for g in groups],
        "ortho": {"image": args.image or os.path.basename(args.out), "bounds_mm": [round(float(v), 1) for v in bounds]},
    }
    for k in ("inliers", "rms_mm"):
        if k in frame:
            out["frame"][k] = round(float(frame[k]), 1)
    return out


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    log = lambda *a: print(*a, file=sys.stderr, flush=True)  # noqa: E731
    try:
        print(json.dumps(run(args, log), indent=1))
    except MosaicError as exc:
        raise SystemExit(f"arail-mosaic: {exc}") from exc
    return 0


if __name__ == "__main__":
    sys.exit(main())
