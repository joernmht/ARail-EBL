"""Steadier poses for a video of the app's augmented picture (arail-stabilize).

The app takes the pose of each frame from the markers seen in it. Few, small or far markers make
that pose jitter, and where they are wrong for a while the virtual objects slide against the
picture. The picture itself says how the table moved from one frame to the next; this tool joins
the two (see docs/videos.md):

1. the raw poses: one homography layout (mm) -> image (px) per frame, from the markers of that
   frame only, recorded by ``node tools/video/render.mjs`` with ``record`` (pass 1);
2. the picture's motion: corners on the table plane followed with Lucas-Kanade from each frame to
   the next, forward and back, one homography per step with RANSAC;
3. joining them: the image paths of the corners of a rectangle of the layout follow the picture's
   motion closely and the markers loosely, the markers counting only where they agree with the
   motion; one least-squares problem over the clip (``ls``), or a filter that only looks back
   and could run live (``causal``);
4. the poses written for pass 2 (``poses`` in the plan), with a report of how far the overlay
   slips against the picture.

    arail-stabilize build/video/town-raw.json -o build/video/town-poses.json \\
        --ref -2000,-300,-500,600 --plane -2400,-60,6000,640 --plane -2400,-560,-450,-60
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

# ---------------------------------------------------------------------------------------- maths


def apply_h(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Points (n x 2) through a homography."""
    p = np.c_[pts, np.ones(len(pts))] @ H.T
    return p[:, :2] / p[:, 2:3]


def h_from_corners(ref: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """The homography that maps the four corners `ref` to `pts`."""
    import cv2

    H = cv2.getPerspectiveTransform(ref.astype(np.float32), pts.astype(np.float32)).astype(float)
    return H / H[2, 2]


def jacobian(H: np.ndarray, x: np.ndarray) -> np.ndarray:
    """2 x 2 Jacobian of a homography at the point x."""
    p = H @ np.array([x[0], x[1], 1.0])
    w = p[2]
    return np.array(
        [
            [H[0, 0] / w - p[0] * H[2, 0] / w**2, H[0, 1] / w - p[0] * H[2, 1] / w**2],
            [H[1, 0] / w - p[1] * H[2, 0] / w**2, H[1, 1] / w - p[1] * H[2, 1] / w**2],
        ]
    )


def rect(r) -> np.ndarray:
    """Corners of a rectangle (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = r
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], float)


# ----------------------------------------------------------------------------------- raw poses


def raw_poses(record: dict, key: str = "H") -> list[np.ndarray]:
    """The homography of each frame from a recording; frames without one take their neighbour's."""
    out: list[np.ndarray | None] = []
    last = None
    for r in record["raw"]:
        h = r.get(key)
        if h is None and key == "H":
            h = r.get("Hs")  # no marker of the map in this frame: the tracker's held pose
        H = np.array(h, float).reshape(3, 3) if h is not None else last
        out.append(H)
        last = H
    for i in range(len(out) - 2, -1, -1):
        if out[i] is None:
            out[i] = out[i + 1]
    if not out or out[0] is None:
        raise ValueError("no frame of the recording has a pose")
    return out  # type: ignore[return-value]


# ----------------------------------------------------------------------------- picture motion


def read_frames(clip: str, start: int, n: int, size: tuple[int, int]):
    """Grey frames of a clip, from `start`, scaled to `size` (the app's picture size)."""
    import cv2

    cap = cv2.VideoCapture(clip)
    if not cap.isOpened():
        raise OSError(f"cannot open {clip}")
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    for _ in range(n):
        ok, img = cap.read()
        if not ok:
            break
        grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        yield cv2.resize(grey, tuple(size), interpolation=cv2.INTER_AREA)
    cap.release()


def plane_mask(H: np.ndarray, shape, rects, inside_point, step: int = 8) -> np.ndarray:
    """Pixels that see the layout plane inside one of `rects` (x0, y0, x1, y1 in mm), in front of the camera."""
    import cv2

    h, w = shape
    us, vs = np.meshgrid(np.arange(0, w, step) + step / 2, np.arange(0, h, step) + step / 2)
    pix = np.c_[us.ravel(), vs.ravel(), np.ones(us.size)]
    Hi = np.linalg.inv(H)
    q = pix @ Hi.T
    # in front: the same sign of w as a point of the layout that is surely seen
    c = np.array([*inside_point, 1.0]) @ H.T
    front = np.sign(q[:, 2]) == np.sign((np.array([c[0] / c[2], c[1] / c[2], 1.0]) @ Hi.T)[2])
    x, y = q[:, 0] / q[:, 2], q[:, 1] / q[:, 2]
    inside = np.zeros(len(x), bool)
    for x0, y0, x1, y1 in rects:
        inside |= (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)
    m = (front & inside).reshape(us.shape).astype(np.uint8) * 255
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)


def picture_motion(frames, Hraw, rects, inside_point, log=None) -> list[np.ndarray]:
    """The motion of the table plane from each frame to the next: one homography per step.

    Up to 1500 corners in the plane (Shi-Tomasi) are followed with pyramidal Lucas-Kanade into the
    next frame and back; those that come back within 0.7 px give a homography with RANSAC (1.5 px),
    so a train passing through is left out. Where too few corners are found, the markers' step."""
    import cv2

    G: list[np.ndarray] = []
    prev = None
    for i, frame in enumerate(frames):
        if prev is not None:
            k = i - 1
            mask = plane_mask(Hraw[k], prev.shape, rects, inside_point)
            pts = cv2.goodFeaturesToTrack(
                prev, maxCorners=1500, qualityLevel=0.01, minDistance=7, mask=mask, blockSize=7
            )
            step = None
            if pts is not None and len(pts) >= 12:
                lk = {"winSize": (21, 21), "maxLevel": 3}
                nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, frame, pts, None, **lk)
                back, st2, _ = cv2.calcOpticalFlowPyrLK(frame, prev, nxt, None, **lk)
                back_err = np.linalg.norm((back - pts).reshape(-1, 2), axis=1)
                good = (st.ravel() == 1) & (st2.ravel() == 1) & (back_err < 0.7)
                if good.sum() >= 12:
                    Hm, inl = cv2.findHomography(pts[good], nxt[good], cv2.RANSAC, 1.5)
                    if Hm is not None and inl.sum() >= 10:
                        step = Hm / Hm[2, 2]
                        if log and k % 30 == 0:
                            log(f"frame {k}: {int(inl.sum())} corners of {int(good.sum())} followed")
            if step is None:
                step = Hraw[k + 1] @ np.linalg.inv(Hraw[k])
                if log:
                    log(f"frame {k}: too few corners, the markers' step")
            G.append(step)
        prev = frame
    return G


# ------------------------------------------------------------------------------------- joining


def agreement(R: np.ndarray, G: list[np.ndarray], sigma: float, window: int = 9) -> np.ndarray:
    """Weight of the markers' pose in each frame: 1 where it agrees with the picture's motion, less
    where it does not (how far it is from where the motion carries its neighbours, in px)."""
    n = len(R)
    e = np.zeros(n)
    for i in range(n):
        d = []
        if i > 0:
            d.append(np.linalg.norm(R[i] - apply_h(G[i - 1], R[i - 1]), axis=1).mean())
        if i < n - 1:
            d.append(np.linalg.norm(apply_h(np.linalg.inv(G[i]), R[i + 1]) - R[i], axis=1).mean())
        e[i] = min(d) if d else 0.0
    if window > 1 and n >= window:
        e = np.convolve(e, np.ones(window) / window, mode="same")
    return 1.0 / (1.0 + (e / sigma) ** 2)


def solve(Hraw, G, ref: np.ndarray, lam: float = 2000.0, sigma: float = 1.5, iterations: int = 6) -> list[np.ndarray]:
    """One least-squares problem over the clip, for the image path x_i of each corner of `ref`:

        sum_i w_i |x_i - r_i|^2 + lam * sum_i |x_{i+1} - g_i(x_i)|^2

    r_i: where the markers' pose of frame i puts the corner; w_i: their agreement with the motion.
    Gauss-Newton with g_i linearised at the last solution; per corner a block-tridiagonal system."""
    n = len(Hraw)
    R = np.array([apply_h(H, ref) for H in Hraw])
    w = agreement(R, G, sigma)
    X = R.copy()
    for _ in range(iterations):
        new = np.empty_like(X)
        for k in range(len(ref)):
            A = np.zeros((2 * n, 2 * n))
            b = np.zeros(2 * n)
            for i in range(n):
                A[2 * i : 2 * i + 2, 2 * i : 2 * i + 2] += w[i] * np.eye(2)
                b[2 * i : 2 * i + 2] += w[i] * R[i, k]
            for i in range(n - 1):
                xb = X[i, k]
                J = jacobian(G[i], xb)
                c = apply_h(G[i], xb[None])[0] - J @ xb
                M = np.hstack([-J, np.eye(2)])  # residual: M [x_i; x_{i+1}] - c
                idx = np.r_[2 * i : 2 * i + 2, 2 * i + 2 : 2 * i + 4]
                A[np.ix_(idx, idx)] += lam * M.T @ M
                b[idx] += lam * M.T @ c
            new[:, k] = np.linalg.solve(A, b).reshape(n, 2)
        done = np.abs(new - X).max() < 1e-3
        X = new
        if done:
            break
    return [h_from_corners(ref, x) for x in X]


def causal(Hraw, G, ref: np.ndarray, alpha: float = 0.06, sigma: float = 1.5) -> list[np.ndarray]:
    """A filter that only looks back (it could run live): each frame, the corners are carried with
    the picture's motion and moved a share `alpha` towards the markers' pose, less where the
    markers disagree with the motion (a running mean of the disagreement)."""
    R = [apply_h(H, ref) for H in Hraw]
    x = [R[0]]
    e = 0.0
    for i in range(len(R) - 1):
        d = np.linalg.norm(R[i + 1] - apply_h(G[i], R[i]), axis=1).mean()
        e = 0.8 * e + 0.2 * d
        a = alpha / (1.0 + (e / sigma) ** 2)
        x.append((1 - a) * apply_h(G[i], x[-1]) + a * R[i + 1])
    return [h_from_corners(ref, p) for p in x]


# -------------------------------------------------------------------------------------- report


def slip(H, G, pts: np.ndarray, Hmarkers=None, fps: int = 30) -> dict:
    """How far the overlay slips against the picture: points of the layout through the poses,
    against where the picture's motion carries them; per frame (mean), summed over one second
    (the most), and the mean distance from the markers' pose (px)."""
    n = len(H)
    steps = [apply_h(H[i + 1], pts) - apply_h(G[i], apply_h(H[i], pts)) for i in range(n - 1)]
    per = float(np.mean([np.linalg.norm(s, axis=1).mean() for s in steps])) if steps else 0.0
    sec = 0.0
    for j in range(0, max(1, n - fps), 5):
        acc = sum(steps[j : j + fps])
        if isinstance(acc, np.ndarray):
            sec = max(sec, float(np.linalg.norm(acc, axis=1).mean()))
    away = 0.0
    if Hmarkers is not None:
        d = [np.linalg.norm(apply_h(H[i], pts) - apply_h(Hmarkers[i], pts), axis=1).mean() for i in range(n)]
        away = float(np.mean(d))
    return {"per_frame": per, "within_1s": sec, "from_markers": away}


# ----------------------------------------------------------------------------------- the tool


def _rect_arg(s: str):
    try:
        v = [float(x) for x in s.split(",")]
    except ValueError as e:
        raise argparse.ArgumentTypeError("expected X0,Y0,X1,Y1 in layout mm, e.g. -2000,-300,-500,600") from e
    if len(v) != 4 or v[0] >= v[2] or v[1] >= v[3]:
        raise argparse.ArgumentTypeError("expected X0,Y0,X1,Y1 in layout mm with X0 < X1 and Y0 < Y1")
    return v


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="arail-stabilize",
        description="Steadier poses for a video of the app: the markers' poses joined with the picture's own motion.",
        epilog="See docs/videos.md for the whole way from a clip to a video.",
    )
    ap.add_argument("record", help="raw poses of each frame, from tools/video/render.mjs with 'record' (pass 1)")
    ap.add_argument("-o", "--out", required=True, help="poses for pass 2 ('poses' in the plan)")
    ap.add_argument("--clip", help="the clip (default: the one named in the recording, relative to the repository)")
    ap.add_argument(
        "--ref", type=_rect_arg, required=True, help="rectangle of the layout the clip shows: X0,Y0,X1,Y1 (mm)"
    )
    ap.add_argument(
        "--plane",
        type=_rect_arg,
        action="append",
        help="where the table plane is (mm), for following the picture; repeat for several (default: --ref)",
    )
    ap.add_argument(
        "--method",
        choices=["ls", "causal"],
        default="ls",
        help="one solve over the clip, or a filter that only looks back",
    )
    ap.add_argument(
        "--lam", type=float, default=2000.0, help="weight of the picture's motion against the markers (2000)"
    )
    ap.add_argument("--sigma", type=float, default=1.5, help="disagreement (px) at which the markers count half (1.5)")
    ap.add_argument("--alpha", type=float, default=0.06, help="share towards the markers per frame (causal; 0.06)")
    ap.add_argument("--motion", help="file for the picture's motion (written, or read if it exists)")
    ap.add_argument("--quiet", action="store_true")
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    log = (lambda *_: None) if args.quiet else (lambda m: print(m, file=sys.stderr))
    with open(args.record, encoding="utf-8") as f:
        record = json.load(f)
    n = len(record["raw"])
    Hraw = raw_poses(record)
    Htracker = raw_poses(record, "Hs") if any(r.get("Hs") for r in record["raw"]) else None
    ref = rect(args.ref)
    rects = args.plane or [args.ref]
    if args.motion and os.path.exists(args.motion):
        with open(args.motion, encoding="utf-8") as f:
            G = [np.array(g, float).reshape(3, 3) for g in json.load(f)]
    else:
        root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        clip = args.clip or os.path.join(root, record["clip"])
        frames = read_frames(clip, int(record.get("start", 0)), n, tuple(record["size"]))
        G = picture_motion(frames, Hraw, rects, ref.mean(axis=0), log)
        if args.motion:
            with open(args.motion, "w", encoding="utf-8") as f:
                json.dump([g.ravel().tolist() for g in G], f)
    if len(G) != n - 1:
        print(f"arail-stabilize: the clip has fewer frames than the recording ({len(G) + 1} < {n})", file=sys.stderr)
        return 1
    if args.method == "ls":
        H = solve(Hraw, G, ref, args.lam, args.sigma)
    else:
        H = causal(Hraw, G, ref, args.alpha, args.sigma)
    out = {"focal": record.get("focal"), "size": record.get("size"), "method": args.method}
    out["poses"] = [{"H": h.ravel().tolist(), "Hinv": np.linalg.inv(h).ravel().tolist()} for h in H]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f)
    # the report: four points spread over the reference rectangle
    pts = ref.mean(axis=0) + (ref - ref.mean(axis=0)) * 0.5
    fps = int(record.get("fps", 30))
    rows = [("markers of each frame", Hraw)]
    if Htracker:
        rows.append(("the app's tracker", Htracker))
    rows.append(("least squares" if args.method == "ls" else "causal filter", H))
    print(f"{'poses':24s} {'slip per frame':>15s} {'within 1 s':>11s} {'from markers':>13s}")
    for name, poses in rows:
        r = slip(poses, G, pts, Hraw, fps)
        print(f"{name:24s} {r['per_frame']:12.2f} px {r['within_1s']:8.1f} px {r['from_markers']:10.1f} px")
    log(f"written {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
