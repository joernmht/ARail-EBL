"""Joins rendered shots into a video (arail-compose): crops with a slow push, crossfades between
the shots, the bare picture before the augmented one fades in, a loop without a seam, and the
encoding (H.264 with ffmpeg) with a poster frame.

A plan (JSON) lists the shots, each a directory of frames from ``node tools/video/render.mjs``::

    {
      "size": [720, 720], "fps": 30,
      "parts": [
        {"frames": "build/video/town", "count": 300, "crop": [0, 140, 720, 860],
         "bare": {"clip": "examples/media/ebl-curve-trains.mp4", "fade": [18, 45]}},
        {"frames": "build/video/bus", "count": 240, "crop": [[180, 19, 1080, 919], [230, 60, 1030, 860]],
         "fade": 24}
      ],
      "loop": 24,
      "out": "web/media/video.mp4", "crf": 27,
      "poster": {"frame": 150, "out": "web/media/video.jpg"}
    }

- ``crop``: the box (x0, y0, x1, y1, px of the frames) scaled to ``size``, or [from, to]: the box
  moves from one to the other over the shot (eased);
- ``fade``: frames over which the shot fades in from the one before (the two overlap);
- ``bare``: the picture without the augmentation (``image``, or ``clip`` from ``start``) pasted over
  the frame's top left (around it the frame, or the colour ``fill``); the shot fades in over it in
  the frames ``fade`` [from, to] of the shot, after ``hold`` frames of the first frame held;
- ``loop``: the last frames fade into the first, so the video loops without a seam.

Paths are relative to the repository.

    arail-compose tools/video/plans/landing.json
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def ease(u: float) -> float:
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def crop(img: np.ndarray, box, size) -> np.ndarray:
    """A box (x0, y0, x1, y1; sub-pixel) of an image, scaled to `size` (w, h)."""
    import cv2

    x0, y0, x1, y1 = box
    w, h = size
    M = np.array([[(x1 - x0) / w, 0, x0], [0, (y1 - y0) / h, y0]], float)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)


def blend(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    """a, then b: t = 0 is a, 1 is b."""
    import cv2

    return cv2.addWeighted(a, 1 - t, b, t, 0)


class Part:
    """One shot of a plan: its frames, crop, the fade from the shot before and the bare picture."""

    def __init__(self, spec: dict, size):
        import cv2

        self.dir = os.path.join(ROOT, spec["frames"])
        self.count = int(spec["count"])
        self.fade = int(spec.get("fade", 0))
        self.size = size
        c = spec["crop"]
        self.box = (c, c) if not isinstance(c[0], (list, tuple)) else (c[0], c[1])
        self.bare = spec.get("bare")
        self.hold = int(self.bare.get("hold", 0)) if self.bare else 0
        self.length = self.hold + self.count
        self._clip = None
        self._image = None
        if self.bare and self.bare.get("image"):
            self._image = cv2.imread(os.path.join(ROOT, self.bare["image"]))
            if self._image is None:
                raise OSError(f"cannot read {self.bare['image']}")
        missing = [i for i in (0, self.count - 1) if not os.path.exists(self._path(i))]
        if missing:
            raise OSError(f"{spec['frames']}: frame {missing[0]} is missing (render the shot first)")

    def _path(self, k: int) -> str:
        return os.path.join(self.dir, f"f{k:04d}.jpg")

    def _bare(self, k: int, frame: np.ndarray) -> np.ndarray:
        """The bare picture over the frame's top left (scaled to its width for a clip); around it the
        frame, or the colour `fill` ("#rrggbb")."""
        import cv2

        if self._image is not None:
            pic = self._image
        else:
            if self._clip is None:
                self._clip = cv2.VideoCapture(os.path.join(ROOT, self.bare["clip"]))
                self._clip.set(cv2.CAP_PROP_POS_FRAMES, int(self.bare.get("start", 0)))
                self._last = None
                self._at = -1
            while self._at < k:
                ok, img = self._clip.read()
                if ok:
                    self._last = img
                self._at += 1
            pic = self._last
            if pic is None:
                return frame
            h = round(pic.shape[0] * frame.shape[1] / pic.shape[1])
            pic = cv2.resize(pic, (frame.shape[1], h), interpolation=cv2.INTER_AREA)
        out = frame.copy()
        fill = self.bare.get("fill")
        if fill:
            out[:] = [int(fill[i : i + 2], 16) for i in (5, 3, 1)]  # BGR
        h, w = min(pic.shape[0], out.shape[0]), min(pic.shape[1], out.shape[1])
        out[:h, :w] = pic[:h, :w]
        return out

    def frame(self, i: int) -> np.ndarray:
        """Frame i of the shot (0 .. length - 1), cropped to the video's size."""
        import cv2

        k = max(0, i - self.hold)
        img = cv2.imread(self._path(k))
        if img is None:
            raise OSError(f"cannot read {self._path(k)}")
        if self.bare:
            a, b = self.bare.get("fade", [0, 1])
            t = ease((i - a) / max(1, b - a))
            if t < 1:
                img = blend(self._bare(k, img), img, t)
        u = ease(k / max(1, self.count - 1))
        box = [p + (q - p) * u for p, q in zip(self.box[0], self.box[1], strict=True)]
        return crop(img, box, self.size)


def compose(plan: dict, frames_dir: str, log=print) -> int:
    """Writes the video's frames (f0000.jpg …) to `frames_dir`; returns their number."""
    import cv2

    size = tuple(plan["size"])
    parts = [Part(p, size) for p in plan["parts"]]
    timeline, t = [], 0
    for k, p in enumerate(parts):
        begin = t if k == 0 else t - p.fade
        timeline.append((p, begin))
        t = begin + p.length
    total, loop = t, int(plan.get("loop", 0))
    os.makedirs(frames_dir, exist_ok=True)
    first = None
    for f in range(total):
        on = [(p, f - b) for p, b in timeline if 0 <= f - b < p.length]
        img = on[0][0].frame(on[0][1])
        if len(on) > 1:
            p, i = on[1]
            img = blend(img, p.frame(i), ease((i + 1) / max(1, p.fade)))
        if f == 0:
            first = img.copy()
        if loop and f >= total - loop:
            img = blend(img, first, ease((f - (total - loop) + 1) / loop))
        cv2.imwrite(os.path.join(frames_dir, f"f{f:04d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 94])
        if f % 100 == 0:
            log(f"frame {f} of {total}")
    return total


def encode(frames_dir: str, out: str, fps: int, crf: int) -> None:
    """H.264 for the web: yuv420p, fast start."""
    if not shutil.which("ffmpeg"):
        raise OSError("ffmpeg is needed for the encoding")
    cmd = ["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", os.path.join(frames_dir, "f%04d.jpg"), "-an"]
    cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-profile:v", "high", "-pix_fmt", "yuv420p"]
    cmd += ["-movflags", "+faststart", "-r", str(fps), out]
    subprocess.run(cmd, check=True)


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="arail-compose",
        description="Joins rendered shots into a video: crops, slow pushes, crossfades, a seamless loop; "
        "H.264 and a poster.",
        epilog="See docs/videos.md.",
    )
    ap.add_argument("plan", help="the plan (JSON)")
    ap.add_argument("--frames", help="directory for the video's frames (default: build/video/<plan name>)")
    ap.add_argument("--no-encode", action="store_true", help="only the frames")
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    with open(args.plan, encoding="utf-8") as f:
        plan = json.load(f)
    name = os.path.splitext(os.path.basename(args.plan))[0]
    frames_dir = args.frames or os.path.join(ROOT, "build", "video", f"{name}-frames")
    if os.path.isdir(frames_dir):
        for old in os.listdir(frames_dir):
            if old.startswith("f") and old.endswith(".jpg"):
                os.remove(os.path.join(frames_dir, old))
    try:
        total = compose(plan, frames_dir, log=lambda m: print(m, file=sys.stderr))
    except OSError as e:
        print(f"arail-compose: {e}", file=sys.stderr)
        return 1
    fps = int(plan.get("fps", 30))
    print(f"{total} frames, {total / fps:.1f} s: {frames_dir}")
    if args.no_encode or not plan.get("out"):
        return 0
    out = os.path.join(ROOT, plan["out"])
    encode(frames_dir, out, fps, int(plan.get("crf", 26)))
    print(f"written {plan['out']} ({os.path.getsize(out) / 1e6:.2f} MB)")
    poster = plan.get("poster")
    if poster:
        import cv2

        img = cv2.imread(os.path.join(frames_dir, f"f{int(poster['frame']):04d}.jpg"))
        cv2.imwrite(os.path.join(ROOT, poster["out"]), img, [cv2.IMWRITE_JPEG_QUALITY, int(poster.get("quality", 82))])
        print(f"written {poster['out']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
