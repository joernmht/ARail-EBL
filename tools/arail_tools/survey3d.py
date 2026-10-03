"""3D mode of the lab survey (``arail-survey --3d``): marker poses with height and tilt.

The 2D survey (:mod:`arail_tools.survey`) assumes that all markers lie on one plane and describes
every frame by a homography. Layouts with levels (a raised line, a hill, a bridge, ramps between
them) and things that are not flat at all (control desks with sloping panels) break that
assumption. The 3D mode measures the full pose of every marker instead, position (x, y, z) and
orientation (rotation and tilt), with a camera model for every frame:

1. Cameras. The frames of one video share their intrinsics: a pinhole camera with the principal
   point at the image centre, a focal length and one radial distortion coefficient k1. Photos of
   the same size share theirs. With ``--calibration`` they are fixed; otherwise they are estimated,
   starting from the focal length at which pairs of markers seen together keep their relative
   positions best (:func:`initial_focal`).
2. Initial poses, incrementally from the origin marker (or the known poses of ``--layout``). The
   camera of every frame that sees known markers follows from them (:func:`resect`); a single
   square marker has two possible poses (IPPE), and both are kept while they cannot be told
   apart. Every unknown marker seen in such frames gets candidate poses from each of them, and the
   candidate that most frames agree on wins (:func:`intersect`); one view is never enough. Each
   round adds the best-supported markers and ends with a bundle adjustment; frames and markers
   that end up far off are placed again from the adjusted map (:func:`_repair`).
3. Bundle adjustment (:class:`Adjustment3D`) of all marker poses (6 parameters each), all camera
   poses (6 each) and the intrinsics, minimising the reprojection error of all marker corners
   with a robust (Huber) loss. Sparse Levenberg-Marquardt: the frames are eliminated with the
   Schur complement. Wrong detections are rejected and the adjustment is repeated.
4. The layout frame (:func:`layout_plane`). Without known poses, z = 0 is the plane through the
   origin marker that most markers lie on, with z pointing up (towards the camera) and x along the
   origin marker's x axis. A single sticker would define the plane poorly: a tilt of 1 degree is
   6 cm in height at 3.5 m. The uncertainties are then those of the map as a whole
   (:meth:`Adjustment3D.free_network_covariance`).
5. Levels (:func:`find_levels`): markers at the same height on horizontal planes, and markers on
   the same inclined plane (ramps), are grouped and reported, so that heights can be checked
   with a ruler (``--height``).
6. The orthophoto (:func:`orthophoto3d`): every frame is mapped through its camera onto a height
   model with one plane per level; every point takes the level the frames agree on
   (:func:`_consistent_levels`), and frames that cannot see it past the surface give it no weight.

Poses are written to layout files as ``[x_mm, y_mm, rotation_deg, z_mm, tilt_deg, tilt_dir_deg]``
(:func:`pose6`): the marker is rotated about its normal by ``rotation``, as in the 2D map, then
tilted by ``tilt`` so that its normal leans towards the direction ``tilt_dir`` (measured like
rotations, from the x axis towards y). A flat marker has tilt 0, and its first three numbers mean
what they mean in the 2D map. A sticker upright on a wall facing -y has tilt 90 and tilt_dir -90.
"""

from __future__ import annotations

import math
import os
import warnings
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from .aruco import cv2, marker_corners_mm
from .survey import (
    EXTRAPOLATE,
    ORTHO_BACKGROUND,
    ORTHO_POWER,
    Frame,
    Orthophoto,
    Source,
    SurveyError,
    SurveyResult,
    _components,
    _gains,
    _ids,
    _read_views,
    _shrink,
    _source_masks,
    _warnings,
    calibration_for,
    check_image,
    singular_values_2x2,
)

AMBIGUOUS = 3.0  # a single marker's second pose (IPPE) is kept while its error is below this times the first's
VOTE_DEG = 10.0  # candidate poses of a marker agree within this rotation ...
VOTE_MM = 8.0  # ... and this distance (or 4 % of the distance from the camera)
MAX_VOTE_FRAMES = 80  # frames used to vote on an unknown marker's pose
FLAT_DEG = 3.0  # markers tilted less than this are on horizontal planes (levels)
LEVEL_GAP_MM = 4.0  # horizontal markers further apart than this in height are on different levels
PLANE_MM = 2.0  # a marker lies on the layout plane if its centre is this close to it ...
PLANE_DEG = 3.0  # ... and its normal agrees within this angle
K1_SIGMA = 0.25  # prior on the radial distortion coefficient of estimated cameras
F_SIGMA = 0.3  # prior on the focal length of estimated cameras (share of the initial value)


# ---------------------------------------------------------------------------------- rotations


def hat(v) -> np.ndarray:
    """Skew-symmetric matrices [v]x (works on stacks of vectors)."""
    v = np.asarray(v, float)
    out = np.zeros(v.shape[:-1] + (3, 3))
    out[..., 0, 1], out[..., 0, 2] = -v[..., 2], v[..., 1]
    out[..., 1, 0], out[..., 1, 2] = v[..., 2], -v[..., 0]
    out[..., 2, 0], out[..., 2, 1] = -v[..., 1], v[..., 0]
    return out


def exp_so3(w) -> np.ndarray:
    """Rotation matrices from rotation vectors (axis times angle in rad; stacks too)."""
    w = np.asarray(w, float)
    th = np.linalg.norm(w, axis=-1)[..., None, None]
    K = hat(w)
    small = th < 1e-8
    ths = np.where(small, 1.0, th)
    a = np.where(small, 1.0 - th**2 / 6, np.sin(ths) / ths)
    b = np.where(small, 0.5 - th**2 / 24, (1 - np.cos(ths)) / ths**2)
    return np.eye(3) + a * K + b * (K @ K)


def log_so3(R) -> np.ndarray:
    """Rotation vector of a rotation matrix (one matrix; exact up to 180 degrees)."""
    v, _ = cv2.Rodrigues(np.asarray(R, np.float64))
    return v.ravel()


def rot_z(theta: float) -> np.ndarray:
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def rotation_angle(Ra, Rb) -> np.ndarray:
    """Angle (rad) of the rotation between Ra and Rb (stacks broadcast)."""
    tr = np.einsum("...ij,...ij->...", np.asarray(Ra, float), np.asarray(Rb, float))
    return np.arccos(np.clip((tr - 1) / 2, -1.0, 1.0))


def tilt_rotation(tilt: float, direction: float) -> np.ndarray:
    """The rotation that tilts the z axis by ``tilt`` towards ``direction`` (both rad)."""
    axis = np.array([-math.sin(direction), math.cos(direction), 0.0])
    return exp_so3(axis * tilt)


def pose6(R, t) -> np.ndarray:
    """[x, y, rotation, z, tilt, tilt_dir] (mm, rad) of a marker pose: R = T(tilt, dir) Rz(rotation).
    See the module docstring; tilt_dir is 0 for markers without tilt."""
    R = np.asarray(R, float)
    n = R[:, 2]
    tilt = math.acos(float(np.clip(n[2], -1, 1)))
    direction = math.atan2(float(n[1]), float(n[0])) if math.hypot(n[0], n[1]) > 1e-9 else 0.0
    if tilt < 1e-9:
        direction = 0.0
    M = tilt_rotation(tilt, direction).T @ R
    rotation = math.atan2(float(M[1, 0]), float(M[0, 0]))
    return np.array([float(t[0]), float(t[1]), rotation, float(t[2]), tilt, direction])


def from_pose6(p) -> tuple[np.ndarray, np.ndarray]:
    """(R, t) of [x, y, rotation, z, tilt, tilt_dir] (mm, rad); a 2D pose [x, y, rotation] lies flat at z = 0."""
    p = [float(v) for v in p]
    if len(p) < 6:
        p = (p + [0.0] * 3)[:3] + [0.0, 0.0, 0.0]
    x, y, rotation, z, tilt, direction = p[:6]
    return tilt_rotation(tilt, direction) @ rot_z(rotation), np.array([x, y, z])


def chordal_mean(Rs, w=None) -> np.ndarray:
    """Weighted mean of rotation matrices (the rotation closest to their weighted sum)."""
    Rs = np.asarray(Rs, float)
    w = np.ones(len(Rs)) if w is None else np.asarray(w, float)
    M = np.einsum("n,nij->ij", w, Rs)
    U, _, Vt = np.linalg.svd(M)
    D = np.diag([1.0, 1.0, float(np.sign(np.linalg.det(U @ Vt))) or 1.0])
    return U @ D @ Vt


def scatter_add(n: int, idx, vals) -> np.ndarray:
    """``out[i] = sum of vals[k] with idx[k] == i`` for i < n (vals: N x ...); faster than np.add.at."""
    vals = np.asarray(vals, float)
    k = int(np.prod(vals.shape[1:])) if vals.ndim > 1 else 1
    flat = (np.asarray(idx, int)[:, None] * k + np.arange(k)[None, :]).ravel()
    out = np.bincount(flat, weights=vals.reshape(len(vals), k).ravel(), minlength=n * k)
    return out.reshape((n,) + vals.shape[1:])


def marker_points(size: float) -> np.ndarray:
    """Marker corners in the marker frame (mm, z = 0): TL, TR, BR, BL (the order IPPE_SQUARE expects)."""
    return np.column_stack([marker_corners_mm(size).astype(np.float64), np.zeros(4)])


def corners_world(pose, size: float) -> np.ndarray:
    """The four corners of a marker with pose (R, t) in the layout frame (4 x 3)."""
    R, t = pose
    return marker_points(size) @ np.asarray(R).T + np.asarray(t)


def similarity_fit_3d(src, dst) -> tuple[float, np.ndarray, np.ndarray]:
    """Least-squares similarity ``dst ~ s R src + t`` (Umeyama): (s, R, t). Needs three points not on a line."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    U, D, Vt = np.linalg.svd(b.T @ a / len(src))
    S = np.diag([1.0, 1.0, float(np.sign(np.linalg.det(U @ Vt))) or 1.0])
    R = U @ S @ Vt
    var = float(np.sum(a * a)) / len(src)
    s = float(np.trace(np.diag(D) @ S)) / var if var > 0 else 1.0
    return s, R, md - s * R @ ms


# ---------------------------------------------------------------------------------- cameras


@dataclass
class Camera:
    """Intrinsics shared by the frames of one input (a video), or by photos of the same size: a
    pinhole camera with the principal point at the image centre and one radial distortion
    coefficient (OpenCV's model with k1 only). With a calibration the corners are undistorted
    when they are detected, and the camera is a fixed pinhole camera."""

    size: tuple[int, int]
    f: float
    k1: float = 0.0
    fixed: bool = False
    cx: float | None = None
    cy: float | None = None
    sources: list[int] = field(default_factory=list)
    f0: float = 0.0  # initial focal length (for the prior)
    sigma_f: float | None = None
    sigma_k1: float | None = None

    def __post_init__(self):
        if self.cx is None:
            self.cx = self.size[0] / 2
        if self.cy is None:
            self.cy = self.size[1] / 2
        self.f0 = self.f0 or self.f

    def K(self) -> np.ndarray:
        return np.array([[self.f, 0, self.cx], [0, self.f, self.cy], [0, 0, 1.0]])

    def dist(self) -> np.ndarray:
        return np.array([self.k1, 0.0, 0.0, 0.0])

    def project(self, Xc) -> np.ndarray:
        """Image points (px) of points in camera coordinates (N x 3)."""
        Xc = np.asarray(Xc, float)
        z = np.where(np.abs(Xc[..., 2]) < 1e-9, 1e-9, Xc[..., 2])
        x, y = Xc[..., 0] / z, Xc[..., 1] / z
        d = 1 + self.k1 * (x * x + y * y)
        return np.stack([self.f * d * x + self.cx, self.f * d * y + self.cy], -1)

    def fov_deg(self) -> float:
        return math.degrees(2 * math.atan(self.size[0] / 2 / self.f))

    def json(self, sources: list[Source]) -> dict:
        return {
            "inputs": [sources[s].path for s in self.sources],
            "size": list(self.size),
            "focal_px": round(self.f, 1),
            "fov_deg": round(self.fov_deg(), 2),
            "k1": round(self.k1, 5),
            "calibrated": self.fixed,
            "sigma_focal_px": None if self.sigma_f is None else round(self.sigma_f, 2),
            "sigma_k1": None if self.sigma_k1 is None else round(self.sigma_k1, 5),
        }


def rigidity(frames: list[Frame], fids, size_of, cam: Camera) -> tuple[float, int]:
    """How badly pairs of markers seen together keep their relative position from frame to frame
    when every marker's pose in the camera comes from its own corners (IPPE) with the camera
    ``cam``: the median over the pairs (seen together in three or more frames) of the median
    deviation from the pair's median relative position, as a share of their distance. With the
    right focal length the markers keep their places; with a wrong one, depths and tilts come out
    wrong by an amount that depends on the view. Returns (value, pairs)."""
    rel = defaultdict(list)
    for fi in fids:
        sols = {}
        for m, c in frames[fi].markers.items():
            s = ippe(c, size_of(m), cam)
            if s:
                sols[m] = s[0]
        ids = sorted(sols)
        for i, a in enumerate(ids):
            Ra, ta, _ = sols[a]
            for b in ids[i + 1 :]:
                rel[(a, b)].append(Ra.T @ (sols[b][1] - ta))
    spreads = []
    for v in rel.values():
        if len(v) >= 3:
            v = np.array(v)
            med = np.median(v, 0)
            spreads.append(float(np.median(np.linalg.norm(v - med, axis=1))) / max(float(np.linalg.norm(med)), 1.0))
    return (float(np.median(spreads)), len(spreads)) if spreads else (math.inf, 0)


def initial_focal(frames: list[Frame], fids, size_of, size: tuple[int, int], max_frames: int = 250) -> float:
    """Focal length (px) of a camera from its frames: the one at which markers seen together keep
    their relative positions best (:func:`rigidity`), searched from 0.35 to 3 times the image
    width on a log scale and refined by golden-section search. Good to a few per cent, which is
    enough to start the adjustment (it estimates the focal length itself). The perspective of a
    single small marker is no use here: its corners' noise biases it by tens of per cent.
    Without frames that show the same pairs of markers three times, a typical phone camera
    (about 67 degrees wide) is assumed."""
    width = max(size)
    default = 0.75 * width
    fids = [fi for fi in fids if len(frames[fi].markers) >= 2]
    if len(fids) > max_frames:
        fids = [fids[i] for i in np.linspace(0, len(fids) - 1, max_frames).round().astype(int)]
    if not fids:
        return default

    def value(log_f):
        return rigidity(frames, fids, size_of, Camera(size, float(math.exp(log_f))))[0]

    grid = np.linspace(math.log(0.35 * width), math.log(3.0 * width), 13)
    vals = [value(g) for g in grid]
    i = int(np.argmin(vals))
    if not math.isfinite(vals[i]):
        return default
    lo, hi = grid[max(i - 1, 0)], grid[min(i + 1, len(grid) - 1)]
    g = (math.sqrt(5) - 1) / 2
    a, b = hi - g * (hi - lo), lo + g * (hi - lo)
    fa, fb = value(a), value(b)
    for _ in range(7):
        if fa < fb:
            hi, b, fb = b, a, fa
            a = hi - g * (hi - lo)
            fa = value(a)
        else:
            lo, a, fa = a, b, fb
            b = lo + g * (hi - lo)
            fb = value(b)
    return float(math.exp((lo + hi) / 2))


def camera_groups(
    sources: list[Source], frames: list[Frame], calibration: dict | None, size_of
) -> tuple[list[Camera], np.ndarray]:
    """One camera per video, one per size of photos; and the camera of every frame."""
    keys: dict = {}
    group_of = np.zeros(len(frames), int)
    members = defaultdict(list)
    for fi, fr in enumerate(frames):
        key = ("video", fr.source) if sources[fr.source].kind == "video" else ("photo", tuple(fr.size))
        if key not in keys:
            keys[key] = len(keys)
        group_of[fi] = keys[key]
        members[keys[key]].append(fi)
    cameras = []
    for g in sorted(keys.values()):
        size = tuple(int(v) for v in frames[members[g][0]].size)
        srcs = sorted({frames[fi].source for fi in members[g]})
        if calibration:
            K, _ = calibration_for(calibration, size)
            cameras.append(Camera(size, float(K[0, 0]), 0.0, True, float(K[0, 2]), float(K[1, 2]), srcs))
        else:
            cameras.append(Camera(size, initial_focal(frames, members[g], size_of, size), 0.0, False, sources=srcs))
    return cameras, group_of


# ---------------------------------------------------------------------------------- initial poses


def ippe(corners, size: float, cam: Camera) -> list[tuple[np.ndarray, np.ndarray, float]]:
    """The (up to) two poses of a square marker in camera coordinates, best first: (R, t, rms px)."""
    try:
        _, rvecs, tvecs, errs = cv2.solvePnPGeneric(
            marker_points(size),
            np.asarray(corners, np.float64).reshape(4, 1, 2),
            cam.K(),
            cam.dist(),
            flags=cv2.SOLVEPNP_IPPE_SQUARE,
        )
    except cv2.error:
        return []
    out = []
    errs = np.asarray(errs, float).ravel() if errs is not None else np.zeros(len(rvecs))
    for rv, tv, e in zip(rvecs, tvecs, errs, strict=False):
        t = np.asarray(tv, float).ravel()
        if t[2] > 0 and np.all(np.isfinite(t)):
            out.append((cv2.Rodrigues(np.asarray(rv, float))[0], t, float(e)))
    return sorted(out, key=lambda s: s[2])


def _ippe_cache(frames, cameras, group_of, size_of, wanted=None) -> dict:
    """IPPE poses of every detection (of the ``wanted`` markers): (frame, marker) -> list."""
    cache = {}
    for fi, fr in enumerate(frames):
        cam = cameras[group_of[fi]]
        for m, c in fr.markers.items():
            if wanted is None or m in wanted:
                cache[(fi, m)] = ippe(c, size_of(m), cam)
    return cache


def resect(fi: int, frame: Frame, known: dict, cam: Camera, cache: dict, size_of, rejected=frozenset()) -> list:
    """Camera pose hypotheses (R, t) of a frame from the known markers it shows.

    Every known marker's IPPE poses give candidate camera poses; the candidate that fits most of
    the known markers (then the smallest error) is refined on them. With a single known marker
    both of its poses are returned while they fit about equally well."""
    ids = [m for m in frame.markers if m in known and (fi, m) not in rejected and cache.get((fi, m))]
    if not ids:
        return []
    world = np.stack([corners_world(known[m], size_of(m)) for m in ids])  # (n, 4, 3)
    image = np.stack([np.asarray(frame.markers[m], float) for m in ids])
    tau = np.maximum(3.0, 0.2 * np.mean(np.hypot(*(np.roll(image, -1, axis=1) - image).transpose(2, 0, 1)), axis=1))
    cands = []
    for m in ids:
        Rw, tw = known[m]
        for Rc, tc, _ in cache[(fi, m)]:
            R = Rc @ Rw.T
            cands.append((R, tc - R @ tw))
    if len(ids) == 1:
        sols = cache[(fi, ids[0])]
        if len(sols) == 2 and sols[1][2] < AMBIGUOUS * max(sols[0][2], 0.05):
            return cands
        return cands[:1]

    def errors(Rs, ts):  # (C, n): mean corner error of every marker for every candidate
        Xc = np.einsum("cij,nkj->cnki", Rs, world) + ts[:, None, None, :]
        e = np.mean(np.hypot(*(cam.project(Xc) - image[None]).transpose(3, 0, 1, 2)), axis=2)
        e[np.any(Xc[..., 2] <= 1e-6, axis=2)] = np.inf
        return e

    e = errors(np.stack([R for R, _ in cands]), np.stack([t for _, t in cands]))
    inl = e < tau
    score = inl.sum(1) * 1e9 - np.sum(np.minimum(e, tau) ** 2, 1)  # most inliers, then the smallest error
    k = int(np.argmax(score))
    (R, t), inl = cands[k], inl[k]
    if inl.sum() < 2:  # the known markers disagree (one of them misplaced): no reliable pose
        return []
    obj, img = world[inl].reshape(-1, 3), image[inl].reshape(-1, 2)
    rv, tv = cv2.Rodrigues(R)[0], t.reshape(3, 1).copy()
    try:
        rv, tv = cv2.solvePnPRefineLM(obj, img, cam.K(), cam.dist(), rv, tv)
        R2, t2 = cv2.Rodrigues(rv)[0], np.asarray(tv, float).ravel()
        if np.all(np.isfinite(t2)) and np.all(errors(R2[None], t2[None])[0][inl] < tau[inl]):
            R, t = R2, t2
    except cv2.error:
        pass
    return [(R, t)]


def intersect(m: int, fis: list[int], hyps: dict, cache: dict) -> tuple | None:
    """Pose (R, t) of an unknown marker from the frames ``fis`` (with camera hypotheses): every frame
    gives candidates (camera hypotheses x the marker's IPPE poses); the candidate that the most
    frames agree with wins, and the agreeing candidates are averaged. Returns (R, t, support,
    frames) or None."""
    fis = [fi for fi in fis if fi in hyps and cache.get((fi, m))]
    if not fis:
        return None
    if len(fis) > MAX_VOTE_FRAMES:
        fis = [fis[i] for i in np.linspace(0, len(fis) - 1, MAX_VOTE_FRAMES).round().astype(int)]
    Rs, ts, owner, err, tol = [], [], [], [], []
    for k, fi in enumerate(fis):
        for Rcw, tcw in hyps[fi]:
            for Rc, tc, e in cache[(fi, m)]:
                Rs.append(Rcw.T @ Rc)
                ts.append(Rcw.T @ (tc - tcw))
                owner.append(k)
                err.append(e)
                tol.append(max(VOTE_MM, 0.04 * float(np.linalg.norm(tc))))
    Rs, ts, owner, err, tol = map(np.asarray, (Rs, ts, owner, err, tol))
    ang = rotation_angle(Rs[:, None], Rs[None])
    dist = np.linalg.norm(ts[:, None] - ts[None], axis=2)
    agree = (
        (ang < math.radians(VOTE_DEG)) & (dist < np.maximum(tol[:, None], tol[None])) & (owner[:, None] != owner[None])
    )
    frames_agreeing = np.zeros((len(Rs), len(fis)), bool)
    for k in range(len(fis)):
        frames_agreeing[:, k] = np.any(agree[:, owner == k], 1)
    support = frames_agreeing.sum(1) + 1
    best = int(np.lexsort((err, -support))[0])
    members = [best]
    for k in range(len(fis)):
        if k == owner[best]:
            continue
        sel = np.flatnonzero((owner == k) & agree[best])
        if len(sel):
            members.append(int(sel[np.argmin(ang[best, sel] + dist[best, sel] / tol[sel])]))
    n = int(support[best])
    if n < 2 or n < 0.4 * len(fis):  # one view cannot tell a small marker's two possible tilts apart
        return None
    R = chordal_mean(Rs[members])
    t = np.median(ts[members], axis=0)
    return R, t, n, len(fis)


# ---------------------------------------------------------------------------------- bundle adjustment


class Adjustment3D:
    """Bundle adjustment of marker poses, camera poses and intrinsics (see the module docstring).

    ``observations`` are (frame index, marker id) pairs; every frame needs at least two. Markers in
    ``free`` are estimated, the others keep their pose. ``priors`` maps free markers to
    (R, t, sigma_mm, sigma_rad): soft constraints towards a pose, weighted like the 2D adjustment
    (multiplied by the pixel noise variance, see :class:`arail_tools.survey.Adjustment`).
    Cameras that are not ``fixed`` get their focal length and k1 estimated when
    ``free_intrinsics`` is set (with weak priors, which only matter where the images say little).

    Parameters: markers R <- R exp(w), t <- t + dt (rotation in the marker frame); cameras
    (world -> camera) R <- exp(p) R, t <- exp(p) t + dt."""

    def __init__(
        self,
        frames: list[Frame],
        observations: list[tuple[int, int]],
        poses: dict,
        free: set,
        cams: dict,
        cameras: list[Camera],
        group_of,
        size_of,
        priors: dict | None = None,
        free_intrinsics: bool = True,
    ):
        self.frame_ids = sorted({fi for fi, _ in observations})
        fpos = {fi: k for k, fi in enumerate(self.frame_ids)}
        self.ids = sorted({m for _, m in observations})
        self.mpos = {m: k for k, m in enumerate(self.ids)}
        self.free = [m for m in self.ids if m in free]
        self.free_local = np.array([self.mpos[m] for m in self.free], int)
        free_pos = {m: k for k, m in enumerate(self.free)}
        obs = sorted(observations, key=lambda o: (fpos[o[0]], o[1]))
        self.observations = obs
        self.of = np.array([fpos[fi] for fi, _ in obs])
        self.om = np.array([self.mpos[m] for _, m in obs])
        self.ofree = np.array([free_pos.get(m, -1) for _, m in obs])
        self.fstart = np.flatnonzero(np.r_[True, self.of[1:] != self.of[:-1]])
        self.local = np.vstack([marker_points(size_of(m)) for _, m in obs])
        self.meas = np.vstack([np.asarray(frames[fi].markers[m], float) for fi, m in obs])
        self.cf = np.repeat(self.of, 4)
        self.cm = np.repeat(self.om, 4)
        self.Rm = np.array([poses[m][0] for m in self.ids], float)
        self.tm = np.array([poses[m][1] for m in self.ids], float)
        self.Rf = np.array([cams[fi][0] for fi in self.frame_ids], float)
        self.tf = np.array([cams[fi][1] for fi in self.frame_ids], float)
        # cameras (intrinsics): the groups of the frames, and which of them are estimated
        self.cameras = cameras
        self.groups = sorted({int(group_of[fi]) for fi in self.frame_ids})
        gpos = {g: k for k, g in enumerate(self.groups)}
        self.fg = np.array([gpos[int(group_of[fi])] for fi in self.frame_ids], int)
        self.cg = self.fg[self.cf]
        self.focal = np.array([cameras[g].f for g in self.groups], float)
        self.k1 = np.array([cameras[g].k1 for g in self.groups], float)
        self.centre = np.array([[cameras[g].cx, cameras[g].cy] for g in self.groups], float)
        self.gfree = [k for k, g in enumerate(self.groups) if free_intrinsics and not cameras[g].fixed]
        self.gfree_pos = np.full(len(self.groups), -1, int)
        self.gfree_pos[self.gfree] = np.arange(len(self.gfree))
        # pairs (p <= q) of free-marker observations within a frame (for the Schur complement)
        pa, pb = [], []
        bounds = list(self.fstart) + [len(obs)]
        for k in range(len(self.frame_ids)):
            ids = [p for p in range(bounds[k], bounds[k + 1]) if self.ofree[p] >= 0]
            for i, p in enumerate(ids):
                for q in ids[i:]:
                    pa.append(p)
                    pb.append(q)
        self.pa, self.pb = np.array(pa, int), np.array(pb, int)
        self.off_diagonal = self.pa != self.pb
        self.priors = {}
        for m, (R0, t0, smm, srad) in (priors or {}).items():
            if m in free_pos:
                self.priors[free_pos[m]] = (np.asarray(R0, float), np.asarray(t0, float), float(smm), float(srad))
        self.iterations = 0
        self.delta = 1.5
        self.prior_scale = 1.0

    # -- model

    def _project(self, Rm, tm, Rf, tf, focal, k1):
        X = np.einsum("nij,nj->ni", Rm[self.cm], self.local) + tm[self.cm]
        Xc = np.einsum("nij,nj->ni", Rf[self.cf], X) + tf[self.cf]
        z = Xc[:, 2]
        front = bool(np.all(z > 1e-6))
        zs = np.where(z > 1e-6, z, 1e-6)
        x, y = Xc[:, 0] / zs, Xc[:, 1] / zs
        r2 = x * x + y * y
        f, k = focal[self.cg], k1[self.cg]
        d = 1 + k * r2
        uv = np.column_stack([f * d * x, f * d * y]) + self.centre[self.cg]
        return uv - self.meas, (X, Xc, zs, x, y, r2, d, f, k), front

    def _prior_terms(self, Rm, tm, focal, k1):
        """Whitened prior residuals with their (diagonal) information and gradients, weighted with
        ``prior_scale``: markers (free marker, 6 values) and intrinsics (free group, 2 values)."""
        ps = self.prior_scale
        markers = []
        for k, (R0, t0, smm, srad) in self.priors.items():
            m = self.free_local[k]
            d = np.r_[log_so3(R0.T @ Rm[m]), tm[m] - t0]
            sig = np.r_[[srad] * 3, [smm] * 3]
            markers.append((k, ps * d / sig**2, ps / sig**2, math.sqrt(ps) * d / sig))
        intr = []
        for j, k in enumerate(self.gfree):
            g = self.groups[k]
            sig = np.array([F_SIGMA * self.cameras[g].f0, K1_SIGMA])
            d = np.array([focal[k] - self.cameras[g].f0, k1[k]])
            intr.append((j, ps * d / sig**2, ps / sig**2, math.sqrt(ps) * d / sig))
        return markers, intr

    def cost(self, Rm, tm, Rf, tf, focal, k1) -> float:
        r, _, front = self._project(Rm, tm, Rf, tf, focal, k1)
        if not front:
            return math.inf
        e = np.hypot(r[:, 0], r[:, 1])
        dl = self.delta
        rho = np.where(e <= dl, e * e, 2 * dl * e - dl * dl)
        pm, pi = self._prior_terms(Rm, tm, focal, k1)
        prior = sum(float(np.sum(z * z)) for *_, z in pm) + sum(float(np.sum(z * z)) for *_, z in pi)
        return 0.5 * (float(rho.sum()) + prior)

    def _normal_equations(self):
        r, (X, Xc, z, x, y, r2, d, f, k), _ = self._project(self.Rm, self.tm, self.Rf, self.tf, self.focal, self.k1)
        n = len(r)
        P = n // 4
        # d(u, v) / d(camera point)
        a = f * (d + 2 * k * x * x)
        b = f * 2 * k * x * y
        c = f * (d + 2 * k * y * y)
        J = np.empty((n, 2, 3))
        J[:, 0, 0], J[:, 0, 1], J[:, 0, 2] = a / z, b / z, -(a * x + b * y) / z
        J[:, 1, 0], J[:, 1, 1], J[:, 1, 2] = b / z, c / z, -(b * x + c * y) / z
        JR = J @ self.Rf[self.cf]  # d(u, v) / d(layout point)
        # per observation: 8 rows (4 corners x u, v)
        Jf = np.concatenate([-J @ hat(Xc), J], axis=2).reshape(P, 8, 6)  # camera: rotation, translation
        Jm = np.concatenate([-JR @ self.Rm[self.cm] @ hat(self.local), JR], axis=2).reshape(P, 8, 6)  # marker
        Jg = np.stack([np.column_stack([d * x, d * y]), np.column_stack([f * r2 * x, f * r2 * y])], axis=2)
        Jg = Jg.reshape(P, 8, 2)  # intrinsics: focal length, k1
        e = np.hypot(r[:, 0], r[:, 1])
        wgt = np.repeat(np.where(e <= self.delta, 1.0, self.delta / np.maximum(e, 1e-12)), 2).reshape(P, 8)
        rr = r.reshape(P, 8)
        JfT = Jf.transpose(0, 2, 1) * wgt[:, None, :]
        JmT = Jm.transpose(0, 2, 1) * wgt[:, None, :]
        U = np.add.reduceat(JfT @ Jf, self.fstart, axis=0)
        gf = np.add.reduceat(np.einsum("pir,pr->pi", JfT, rr), self.fstart, axis=0)
        W = JfT @ Jm
        Mf, Gf = len(self.free), len(self.gfree)
        sel = self.ofree >= 0
        V = scatter_add(Mf, self.ofree[sel], (JmT @ Jm)[sel])
        gm = scatter_add(Mf, self.ofree[sel], np.einsum("pir,pr->pi", JmT, rr)[sel])
        F = len(self.frame_ids)
        E = np.zeros((F, 6, 2))
        Q = np.zeros((Mf, max(Gf, 1), 6, 2))
        Z, gg = np.zeros((max(Gf, 1), 2, 2)), np.zeros((max(Gf, 1), 2))
        if Gf:
            og = self.gfree_pos[self.fg[self.of]]  # free camera of every observation, or -1
            so = og >= 0
            Eo = np.zeros((P, 6, 2))
            Eo[so] = JfT[so] @ Jg[so]
            E = np.add.reduceat(Eo, self.fstart, axis=0)
            JgT = Jg.transpose(0, 2, 1) * wgt[:, None, :]
            s2 = sel & so
            Q = scatter_add(Mf * Gf, self.ofree[s2] * Gf + og[s2], (JmT[s2] @ Jg[s2])).reshape(Mf, Gf, 6, 2)
            Z = scatter_add(Gf, og[so], JgT[so] @ Jg[so])
            gg = scatter_add(Gf, og[so], np.einsum("pir,pr->pi", JgT[so], rr[so]))
        pm, pi = self._prior_terms(self.Rm, self.tm, self.focal, self.k1)
        for kk, g, info, _ in pm:
            V[kk] += np.diag(info)
            gm[kk] += g
        for j, g, info, _ in pi:
            Z[j] += np.diag(info)
            gg[j] += g
        return U, gf, W, V, gm, E, Q, Z, gg

    def _reduced(self, system, lam):
        """Reduced (Schur) system over the free markers and intrinsics: S, b and the frames' U^-1."""
        U, gf, W, V, gm, E, Q, Z, gg = system
        Mf, Gf = len(self.free), len(self.gfree)
        Ud = U + lam * np.einsum("fii->fi", U)[:, :, None] * np.eye(6) + 1e-9 * np.eye(6)
        Uinv = np.linalg.inv(Ud)
        nr = 6 * Mf + 2 * Gf
        S = np.zeros((nr, nr))
        b = np.zeros(nr)
        sel = self.ofree >= 0
        Y = None
        if Mf:
            Y = W.transpose(0, 2, 1) @ Uinv[self.of]  # W^T U^-1 per observation (P, 6, 6)
            B = Y[self.pa] @ W[self.pb]  # pairs p <= q; the block of (q, p) is the transpose
            od = self.off_diagonal
            ia, ib = self.ofree[self.pa], self.ofree[self.pb]
            idx = np.concatenate([ia * Mf + ib, ib[od] * Mf + ia[od]])
            S4 = -scatter_add(Mf * Mf, idx, np.concatenate([B, B[od].transpose(0, 2, 1)])).reshape(Mf, Mf, 6, 6)
            Vd = V + lam * np.einsum("mii->mi", V)[:, :, None] * np.eye(6)
            S4[np.arange(Mf), np.arange(Mf)] += Vd
            S[: 6 * Mf, : 6 * Mf] = S4.transpose(0, 2, 1, 3).reshape(6 * Mf, 6 * Mf)
            bm = -gm + scatter_add(Mf, self.ofree[sel], np.einsum("pij,pj->pi", Y[sel], gf[self.of[sel]]))
            b[: 6 * Mf] = bm.ravel()
        if Gf:
            fgf = self.gfree_pos[self.fg]  # free camera of every frame, or -1
            sf = fgf >= 0
            EU = E.transpose(0, 2, 1) @ Uinv  # E^T U^-1 per frame (F, 2, 6)
            Zs = Z[:Gf] + lam * np.einsum("gii->gi", Z[:Gf])[:, :, None] * np.eye(2)
            Zs -= scatter_add(Gf, fgf[sf], EU[sf] @ E[sf])
            bg = -gg[:Gf] + scatter_add(Gf, fgf[sf], np.einsum("fij,fj->fi", EU[sf], gf[sf]))
            off = 6 * Mf
            for j in range(Gf):
                S[off + 2 * j : off + 2 * j + 2, off + 2 * j : off + 2 * j + 2] = Zs[j]
            b[off:] = bg.ravel()
            if Mf:
                og = fgf[self.of]
                s2 = sel & (og >= 0)
                MG = Q - scatter_add(Mf * Gf, self.ofree[s2] * Gf + og[s2], Y[s2] @ E[self.of[s2]]).reshape(
                    Mf, Gf, 6, 2
                )
                blk = MG.transpose(0, 2, 1, 3).reshape(6 * Mf, 2 * Gf)
                S[: 6 * Mf, off:] = blk
                S[off:, : 6 * Mf] = blk.T
        return S, b, Uinv

    def _step(self, system, lam):
        U, gf, W, V, gm, E, Q, Z, gg = system
        Mf, Gf = len(self.free), len(self.gfree)
        S, b, Uinv = self._reduced(system, lam)
        if len(b):
            try:
                y = np.linalg.solve(S, b)
            except np.linalg.LinAlgError:
                y = np.linalg.lstsq(S, b, rcond=None)[0]
        else:
            y = np.zeros(0)
        dm = y[: 6 * Mf].reshape(Mf, 6)
        dg = y[6 * Mf :].reshape(Gf, 2)
        rhs = -gf.copy()
        if Mf:
            dm_pad = np.vstack([dm, np.zeros((1, 6))])
            rhs -= np.add.reduceat(np.einsum("pij,pj->pi", W, dm_pad[self.ofree]), self.fstart, axis=0)
        if Gf:
            fgf = self.gfree_pos[self.fg]
            dg_pad = np.vstack([dg, np.zeros((1, 2))])
            rhs -= np.einsum("fij,fj->fi", E, dg_pad[fgf])
        df = np.einsum("fij,fj->fi", Uinv, rhs)
        return dm, df, dg

    def _apply(self, dm, df, dg):
        Rm, tm = self.Rm.copy(), self.tm.copy()
        if len(dm):
            Rm[self.free_local] = Rm[self.free_local] @ exp_so3(dm[:, :3])
            tm[self.free_local] += dm[:, 3:]
        Ex = exp_so3(df[:, :3])
        Rf = Ex @ self.Rf
        tf = np.einsum("fij,fj->fi", Ex, self.tf) + df[:, 3:]
        focal, k1 = self.focal.copy(), self.k1.copy()
        for j, k in enumerate(self.gfree):
            focal[k] += dg[j, 0]
            k1[k] += dg[j, 1]
        return Rm, tm, Rf, tf, focal, k1

    def solve(self, delta: float = 1.5, max_iter: int = 100) -> Adjustment3D:
        """Levenberg-Marquardt with IRLS weights for the Huber loss (``delta`` in px). With priors, the
        pixel noise is estimated from the residuals and the adjustment repeated with it."""
        self.delta = delta
        self._levenberg_marquardt(max_iter)
        if self.priors or self.gfree:
            for _ in range(2):
                self.prior_scale = float(np.clip(self.residual_variance(), 1e-4, 100.0))
                self._levenberg_marquardt(max_iter)
        return self

    def residual_variance(self) -> float:
        r, _, _ = self._project(self.Rm, self.tm, self.Rf, self.tf, self.focal, self.k1)
        e = np.hypot(r[:, 0], r[:, 1])
        wgt = np.where(e <= self.delta, 1.0, self.delta / np.maximum(e, 1e-12))
        dof = max(1, 2 * len(r) - 6 * len(self.frame_ids) - 6 * len(self.free) - 2 * len(self.gfree))
        return float(np.sum(wgt * e * e)) / dof

    def _levenberg_marquardt(self, max_iter: int) -> None:
        state = (self.Rm, self.tm, self.Rf, self.tf, self.focal, self.k1)
        cost = self.cost(*state)
        lam = 1e-4
        for _ in range(max_iter):
            system = self._normal_equations()
            accepted = False
            for _ in range(14):
                dm, df, dg = self._step(system, lam)
                new = self._apply(dm, df, dg)
                c = self.cost(*new)
                if c < cost:
                    accepted = True
                    break
                lam *= 6
            self.iterations += 1
            if not accepted:
                break
            small = (
                np.abs(dm[:, 3:]).max(initial=0) < 1e-4
                and np.abs(dm[:, :3]).max(initial=0) < 1e-7
                and np.abs(df[:, 3:]).max(initial=0) < 1e-4
            )
            gain = cost - c
            self.Rm, self.tm, self.Rf, self.tf, self.focal, self.k1 = new
            cost = c
            lam = max(lam / 4, 1e-10)
            if gain <= 1e-10 * cost or (small and gain <= 1e-6 * cost):
                break
        self.final_cost = cost

    # -- results

    def pose(self, m) -> tuple[np.ndarray, np.ndarray]:
        k = self.mpos[m]
        return self.Rm[k].copy(), self.tm[k].copy()

    def camera_pose(self, k) -> tuple[np.ndarray, np.ndarray]:
        """Camera pose (world -> camera) of local frame k."""
        return self.Rf[k].copy(), self.tf[k].copy()

    def update_cameras(self) -> None:
        """Write the estimated intrinsics back to the cameras."""
        for k, g in enumerate(self.groups):
            if k in self.gfree:
                self.cameras[g].f = float(self.focal[k])
                self.cameras[g].k1 = float(self.k1[k])

    def observation_rms(self) -> np.ndarray:
        """Reprojection RMS (px) of every observation (4 corners)."""
        r, _, _ = self._project(self.Rm, self.tm, self.Rf, self.tf, self.focal, self.k1)
        return np.sqrt(np.mean(np.sum(r * r, 1).reshape(-1, 4), 1))

    def covariance(self) -> tuple[dict, dict]:
        """6x6 covariances (rotation in the marker frame (rad), position (mm)) of the free markers and
        2x2 covariances (focal length px, k1) of the estimated cameras, scaled by the residual variance."""
        system = self._normal_equations()
        S, _, _ = self._reduced(system, 0.0)
        if not len(S):
            return {}, {}
        s2 = self.residual_variance()
        try:
            C = np.linalg.inv(S) * s2
        except np.linalg.LinAlgError:
            C = np.linalg.pinv(S) * s2
        Mf = len(self.free)
        markers = {m: C[6 * k : 6 * k + 6, 6 * k : 6 * k + 6] for k, m in enumerate(self.free)}
        cams = {}
        for j, k in enumerate(self.gfree):
            o = 6 * Mf + 2 * j
            cams[self.groups[k]] = C[o : o + 2, o : o + 2]
        return markers, cams

    def free_network_covariance(self) -> tuple[dict, dict]:
        """Like :meth:`covariance`, for an adjustment in which all markers are free: the covariances of
        the map as a whole (inner constraints: no net shift or rotation of the markers), rather than
        relative to one marker. Relative to the origin marker, a marker 3 m away inherits the
        uncertainty of the origin sticker's own orientation (0.05 degrees are 3 mm there), which says
        nothing about how well the video measured it."""
        system = self._normal_equations()
        S, _, _ = self._reduced(system, 0.0)
        Mf = len(self.free)
        if not Mf:
            return {}, {}
        # the six rigid motions of the whole map span the null space of S
        G = np.zeros((len(S), 6))
        for k in range(Mf):
            R, t = self.Rm[self.free_local[k]], self.tm[self.free_local[k]]
            o = 6 * k
            G[o + 3 : o + 6, :3] = np.eye(3)  # shift: positions move, rotations stay
            G[o : o + 3, 3:] = R.T  # rotation by w about the origin: local rotation R^T w, position w x t
            G[o + 3 : o + 6, 3:] = -hat(t)
        Q, _ = np.linalg.qr(G)
        s2 = self.residual_variance()
        try:
            C = (np.linalg.inv(S + Q @ Q.T) - Q @ Q.T) * s2
        except np.linalg.LinAlgError:
            C = np.linalg.pinv(S) * s2
        markers = {m: C[6 * k : 6 * k + 6, 6 * k : 6 * k + 6] for k, m in enumerate(self.free)}
        cams = {}
        for j, k in enumerate(self.gfree):
            o = 6 * Mf + 2 * j
            cams[self.groups[k]] = C[o : o + 2, o : o + 2]
        return markers, cams


# ---------------------------------------------------------------------------------- incremental survey


def _observations(frames, poses, rejected) -> list[tuple[int, int]]:
    """(frame, marker) pairs of placed markers, in frames that show two or more of them."""
    obs = []
    for fi, fr in enumerate(frames):
        ids = sorted(m for m in fr.markers if m in poses and (fi, m) not in rejected)
        if len(ids) >= 2:
            obs += [(fi, m) for m in ids]
    return obs


def _ensure_cams(frames, obs, poses, cams, cameras, group_of, cache, size_of, rejected) -> list[tuple[int, int]]:
    """Camera poses for the frames of ``obs`` that have none yet (resection from all their known
    markers). Observations of frames that cannot be resected are left out, and so are observations
    that are far off with the current poses (behind the camera, or more than 25 px and one and a
    half marker edges away), and then frames with fewer than two observations: a misplaced marker
    or camera must not spoil the adjustment (it is placed again or rejected later)."""
    for fi in sorted({fi for fi, _ in obs}):
        if fi not in cams:
            h = resect(fi, frames[fi], poses, cameras[group_of[fi]], cache, size_of, rejected)
            if h:
                cams[fi] = h[0]
    obs = [(fi, m) for fi, m in obs if fi in cams]
    if not obs:
        return []
    e, edge = _observation_errors(frames, obs, poses, cams, cameras, group_of, size_of)
    keep = [o for o, ok in zip(obs, e <= np.maximum(25.0, 1.5 * edge), strict=True) if ok]
    count = defaultdict(int)
    for fi, _ in keep:
        count[fi] += 1
    return [(fi, m) for fi, m in keep if count[fi] >= 2]


def _observation_errors(frames, obs, poses, cams, cameras, group_of, size_of) -> tuple[np.ndarray, np.ndarray]:
    """Mean corner error (px; inf behind the camera) and marker edge (px) of every observation."""
    X = np.stack([corners_world(poses[m], size_of(m)) for _, m in obs])  # (P, 4, 3)
    R = np.stack([cams[fi][0] for fi, _ in obs])
    t = np.stack([cams[fi][1] for fi, _ in obs])
    Xc = np.einsum("pij,pkj->pki", R, X) + t[:, None, :]
    meas = np.stack([np.asarray(frames[fi].markers[m], float) for fi, m in obs])
    g = np.array([group_of[fi] for fi, _ in obs])
    uv = np.empty_like(meas)
    for k in set(g.tolist()):
        sel = g == k
        uv[sel] = cameras[k].project(Xc[sel])
    e = np.mean(np.hypot(*(uv - meas).transpose(2, 0, 1)), axis=1)
    e[np.any(Xc[..., 2] <= 1e-6, axis=1)] = np.inf
    edge = np.mean(np.hypot(*(np.roll(meas, -1, axis=1) - meas).transpose(2, 0, 1)), axis=1)
    return e, edge


def _repair(adj, frames, poses, cams, cameras, group_of, cache, size_of, rejected, keep, limit) -> bool:
    """Frames and markers stuck in a wrong pose (a camera resected while few markers were known, a
    marker placed from views that could not tell its two possible poses apart): all their
    observations fit badly. They are placed again from the current map (frames by resection, markers
    by intersection with the adjusted cameras), where that fits clearly better. Returns whether
    anything changed."""
    e = adj.observation_rms()
    by_frame, by_marker = defaultdict(list), defaultdict(list)
    for p, (fi, m) in enumerate(adj.observations):
        by_frame[fi].append(p)
        by_marker[m].append(p)
    changed = False
    for fi, ps in by_frame.items():
        now = float(np.median(e[ps]))
        if now <= limit:
            continue
        obs = [adj.observations[p] for p in ps]
        best = None
        for R, t in resect(fi, frames[fi], poses, cameras[group_of[fi]], cache, size_of, rejected):
            err = float(np.median(_observation_errors(frames, obs, poses, {fi: (R, t)}, cameras, group_of, size_of)[0]))
            if err < 0.5 * now and (best is None or err < best[0]):
                best = (err, R, t)
        if best:
            cams[fi] = best[1:]
            changed = True
    for m, ps in by_marker.items():
        now = float(np.median(e[ps]))
        if m in keep or now <= limit:
            continue
        obs = [adj.observations[p] for p in ps]
        fis = [fi for fi, _ in obs]
        est = intersect(m, fis, {fi: [cams[fi]] for fi in fis}, cache)
        if est is None:
            continue
        trial = {m: est[:2]}
        err = float(np.median(_observation_errors(frames, obs, trial, cams, cameras, group_of, size_of)[0]))
        if err < 0.5 * now:
            poses[m] = est[:2]
            changed = True
    return changed


def _adjust3d(
    frames,
    gauge: dict,
    size_of,
    cameras: list[Camera],
    group_of,
    *,
    priors=None,
    huber_px=1.5,
    reject_px=4.0,
    log=None,
):
    """Incremental survey from the gauge markers (see the module docstring); finally wrong detections
    are rejected and the adjustment is repeated. Gauge markers keep their poses (except those with
    priors). Returns (adjustment or None, poses, camera poses per frame, rejected observations)."""
    rejected: set[tuple[int, int]] = set()
    priors = priors or {}
    gauge = {m: (np.asarray(R, float), np.asarray(t, float)) for m, (R, t) in gauge.items()}
    poses: dict = {}
    cams: dict = {}
    adj = None
    for _ in range(5):
        groups, _ = _components(frames, rejected)
        anchored = set().union(*[g for g in groups if g & set(gauge)]) if groups else set()
        poses = {m: p for m, p in poses.items() if m in anchored}
        poses.update(gauge)
        focal = [c.f for c in cameras]
        cache = _ippe_cache(frames, cameras, group_of, size_of, anchored)
        seen_in = defaultdict(list)
        for fi, fr in enumerate(frames):
            for m in fr.markers:
                if m in anchored and (fi, m) not in rejected:
                    seen_in[m].append(fi)
        resected: dict = {}  # frame -> (known markers in it, hypotheses): resected again when they change
        while True:
            hyps = {fi: [c] for fi, c in cams.items()}
            for fi, fr in enumerate(frames):
                if fi in hyps:
                    continue
                ids = frozenset(m for m in fr.markers if m in poses and (fi, m) not in rejected)
                if not ids:
                    continue
                if resected.get(fi, (None,))[0] != ids:
                    resected[fi] = (ids, resect(fi, fr, poses, cameras[group_of[fi]], cache, size_of, rejected))
                if resected[fi][1]:
                    hyps[fi] = resected[fi][1]
            est = {}
            for m in sorted(anchored - set(poses)):
                e = intersect(m, seen_in[m], hyps, cache)
                if e is not None:
                    est[m] = e
            if not est:
                break
            # grow from the best-supported markers: the others follow from better cameras next round
            best = max(e[2] for e in est.values())
            new = {m: e[:2] for m, e in est.items() if e[2] >= 0.3 * best}
            poses.update(new)
            obs = _ensure_cams(
                frames, _observations(frames, poses, rejected), poses, cams, cameras, group_of, cache, size_of, rejected
            )
            if obs and any(m in new for _, m in obs):
                free = {m for _, m in obs if m not in gauge or m in priors}
                free_intrinsics = len({fi for fi, _ in obs}) >= 10 and len({m for _, m in obs}) >= 3
                for attempt in range(2):
                    step = Adjustment3D(
                        frames, obs, poses, free, cams, cameras, group_of, size_of, priors, free_intrinsics
                    ).solve(huber_px, max_iter=15)
                    poses.update({m: step.pose(m) for m in step.free})
                    cams.update({fi: step.camera_pose(k) for k, fi in enumerate(step.frame_ids)})
                    step.update_cameras()
                    limit = max(reject_px, 6 * float(np.median(step.observation_rms())))
                    keep = set(gauge) - set(priors)
                    if attempt or not _repair(
                        step, frames, poses, cams, cameras, group_of, cache, size_of, rejected, keep, limit
                    ):
                        break
                if any(abs(c.f / f0 - 1) > 0.02 for c, f0 in zip(cameras, focal, strict=True)):
                    focal = [c.f for c in cameras]
                    cache = _ippe_cache(frames, cameras, group_of, size_of, anchored)
        obs = _ensure_cams(
            frames, _observations(frames, poses, rejected), poses, cams, cameras, group_of, cache, size_of, rejected
        )
        if not obs:
            return None, dict(gauge), {}, rejected
        free = {m for _, m in obs if m not in gauge or m in priors}
        for attempt in range(3):
            adj = Adjustment3D(frames, obs, poses, free, cams, cameras, group_of, size_of, priors).solve(huber_px)
            poses.update({m: adj.pose(m) for m in adj.ids})
            cams.update({fi: adj.camera_pose(k) for k, fi in enumerate(adj.frame_ids)})
            adj.update_cameras()
            limit = max(reject_px, 6 * float(np.median(adj.observation_rms())))
            keep = set(gauge) - set(priors)
            if attempt == 2 or not _repair(
                adj, frames, poses, cams, cameras, group_of, cache, size_of, rejected, keep, limit
            ):
                break
            if log:
                log("  frames or markers placed again, adjusting again")
        e = adj.observation_rms()
        bad = e > max(reject_px, 6 * float(np.median(e)))
        if not bad.any():
            break
        rejected |= {adj.observations[p] for p in np.flatnonzero(bad)}
        if log:
            log(f"  {int(bad.sum())} detections rejected, adjusting again")
    for m, p in gauge.items():
        if m not in priors or m not in poses:
            poses[m] = p
    used = set(adj.frame_ids) if adj else set()
    return adj, poses, {fi: c for fi, c in cams.items() if fi in used}, rejected


# ---------------------------------------------------------------------------------- layout frame and levels


def layout_plane(poses: dict, origin: int) -> tuple[np.ndarray, list[int], bool]:
    """The layout frame: the plane through the origin marker's centre that most markers lie on (each
    within ``PLANE_MM`` of it, its normal within ``PLANE_DEG``), refitted to them; z points to the
    side the origin marker faces, x along the origin marker's x axis projected onto the plane.

    Returns (rotation old -> new frame, markers on the plane, fallback): with fewer than three markers
    on one plane (or all of them on a line), the origin marker's own plane is used (fallback)."""
    Ro, p0 = poses[origin]
    n0 = Ro[:, 2]
    others = [m for m in poses if m != origin]
    P = {m: poses[m][1] - p0 for m in poses}
    N = {m: poses[m][0][:, 2] for m in poses}

    def inliers(n):
        return [
            m
            for m in poses
            if abs(float(n @ P[m])) <= PLANE_MM and float(n @ N[m]) >= math.cos(math.radians(PLANE_DEG))
        ]

    best, best_key = None, None
    for i, a in enumerate(others):
        for b in others[i + 1 :]:
            n = np.cross(P[a], P[b])
            la, lb = np.linalg.norm(P[a]), np.linalg.norm(P[b])
            if np.linalg.norm(n) < 0.2 * la * lb:  # nearly on a line with the origin
                continue
            n /= np.linalg.norm(n)
            if n @ n0 < 0:
                n = -n
            inl = inliers(n)
            key = (len(inl), -sum(float(n @ P[m]) ** 2 for m in inl))
            if best_key is None or key > best_key:
                best, best_key = (n, inl), key
    fallback = True
    n = n0
    members = [origin]
    if best is not None and len(best[1]) >= 3:
        n, members = best
        for _ in range(3):  # refit through the origin's centre: smallest eigenvector of the scatter
            A = np.array([P[m] for m in members])
            w, v = np.linalg.eigh(A.T @ A)
            nn = v[:, 0] if v[:, 0] @ n0 >= 0 else -v[:, 0]
            if w[1] < 1e-6 * max(w[2], 1e-12):  # on a line
                break
            n, members = nn, inliers(nn)
        A = np.array([P[m] for m in members])
        spread = np.linalg.svd(A - A.mean(0), compute_uv=False) if len(A) >= 3 else np.zeros(3)
        fallback = len(members) < 3 or spread[1] < 20.0
        if fallback:
            n, members = n0, [origin]
    x = Ro[:, 0] - (Ro[:, 0] @ n) * n
    x /= np.linalg.norm(x)
    Rt = np.array([x, np.cross(n, x), n])
    return Rt, sorted(members), fallback


def reframe(poses: dict, cams: dict, Rt: np.ndarray, p0: np.ndarray) -> tuple[dict, dict]:
    """Marker and camera poses in the frame p' = Rt (p - p0)."""
    new = {m: (Rt @ R, Rt @ (t - p0)) for m, (R, t) in poses.items()}
    newc = {fi: (R @ Rt.T, t + R @ p0) for fi, (R, t) in cams.items()}
    return new, newc


def find_levels(poses: dict) -> tuple[list[dict], dict[int, int]]:
    """Group markers into levels: horizontal planes at one height (markers tilted less than
    ``FLAT_DEG``, split where their heights differ by more than ``LEVEL_GAP_MM``) and inclined planes
    (markers whose normals agree within 3 degrees and that lie on each other's plane within 3 mm).
    Returns the levels (sorted: horizontal ones by height, then inclined ones) and the level of
    every marker."""
    flat, tilted = [], []
    for m, (R, _) in poses.items():
        (tilted if math.degrees(math.acos(float(np.clip(R[2, 2], -1, 1)))) >= FLAT_DEG else flat).append(m)
    levels = []
    flat.sort(key=lambda m: poses[m][1][2])
    group: list[int] = []
    for m in flat:
        if group and poses[m][1][2] - poses[group[-1]][1][2] > LEVEL_GAP_MM:
            levels.append(group)
            group = []
        group.append(m)
    if group:
        levels.append(group)
    rest = sorted(tilted)
    while rest:
        seed = rest.pop(0)
        Rs, ts = poses[seed]
        members = [seed]
        for m in list(rest):
            R, t = poses[m]
            same = float(R[:, 2] @ Rs[:, 2]) >= math.cos(math.radians(3.0))
            near = abs(float(Rs[:, 2] @ (t - ts))) <= 3.0 and abs(float(R[:, 2] @ (ts - t))) <= 3.0
            if same and near:
                members.append(m)
                rest.remove(m)
        levels.append(members)
    out, level_of = [], {}
    for i, members in enumerate(levels):
        ts = np.array([poses[m][1] for m in members])
        n = chordal_mean([poses[m][0] for m in members])[:, 2]
        tilt = math.degrees(math.acos(float(np.clip(n[2], -1, 1))))
        entry = {
            "z_mm": round(float(ts[:, 2].mean()), 1),
            "tilt_deg": round(tilt, 2),
            "markers": sorted(members),
        }
        if tilt >= FLAT_DEG:
            entry["tilt_dir_deg"] = round(math.degrees(math.atan2(n[1], n[0])), 1)
        else:
            entry["spread_mm"] = round(float(np.ptp(ts[:, 2])), 1)
        out.append(entry)
        for m in members:
            level_of[m] = i
    return out, level_of


def _misreads(poses, seen, size_of, keep=frozenset()) -> dict[int, int]:
    """Markers that lie on another marker (3D centres closer than 0.75 of the size): the one seen less
    often is a misread (marker -> the marker it lies on)."""
    out: dict[int, int] = {}
    ids = sorted(poses, key=lambda m: (-seen.get(m, 0), m))
    for i, a in enumerate(ids):
        if a in out:
            continue
        for b in ids[i + 1 :]:
            if b in out or b in keep:
                continue
            if float(np.linalg.norm(poses[a][1] - poses[b][1])) < 0.75 * max(size_of(a), size_of(b)):
                out[b] = a
    return out


def _compare_with_layout(common, free_poses, fixed, cov, moved_mm, warnings):
    """Markers of the layout whose freely surveyed pose does not fit the layout (robust 3D similarity)."""
    inliers = list(common)
    ctr_free = {m: free_poses[m][1] for m in common}
    ctr_fix = {m: fixed[m][1] for m in common}

    def fit(ids):
        s, R, t = similarity_fit_3d([ctr_free[m] for m in ids], [ctr_fix[m] for m in ids])
        dev = {}
        for m in common:
            p = s * R @ ctr_free[m] + t
            C = cov.get(m)
            sig = math.sqrt(max(float(np.trace(C[3:, 3:])), 0)) if C is not None else 0.0
            sig_deg = math.degrees(math.sqrt(max(float(np.trace(C[:3, :3])), 0))) if C is not None else 0.0
            d = float(np.linalg.norm(p - ctr_fix[m]))
            a = math.degrees(float(rotation_angle(R @ free_poses[m][0], fixed[m][0])))
            tol, tol_deg = max(moved_mm, 4 * sig), max(1.5, 4 * sig_deg)
            dev[m] = (d, a, max(d / tol, a / tol_deg))
        return s, R, dev

    if len(common) == 2:  # only the distance can be compared
        a, b = common
        d_free = float(np.linalg.norm(ctr_free[a] - ctr_free[b]))
        d_fix = float(np.linalg.norm(ctr_fix[a] - ctr_fix[b]))
        s = d_fix / d_free if d_free > 0 else 1.0
        dev = {m: (0.0, 0.0, 0.0) for m in common}
        R = np.eye(3)
    else:
        s, R, dev = fit(inliers)
        while len(inliers) > 3:
            worst = max(inliers, key=lambda m: dev[m][2])
            if dev[worst][2] <= 1:
                break
            inliers.remove(worst)
            s, R, dev = fit(inliers)
    check = {
        "markers": list(common),
        "scale": round(s, 5),
        "rotation_deg": round(math.degrees(float(rotation_angle(R, np.eye(3)))), 3),
        "deviation_mm": {m: round(dev[m][0], 1) for m in common},
    }
    moved = {}
    if len(common) >= 3:
        for m in common:
            if dev[m][2] > 1:
                moved[m] = f"{dev[m][0]:.1f} mm, {dev[m][1]:.1f} deg from the layout pose"
        if moved:
            warnings.append(
                f"Markers moved since the layout was made: {_ids(moved)}. They are measured again; objects attached "
                "to them follow."
            )
    if abs(s - 1) > 0.004:
        why = "the marker size is wrong (--size), or the camera's focal length is poorly determined"
        if len(common) == 2:
            a, b = common
            d = abs(s - 1) * float(np.linalg.norm(ctr_fix[a] - ctr_fix[b]))
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


def _apply_distances(distances, poses, cams, stats, *, scale: bool, warnings) -> dict | None:
    """Compare the survey with measured distances between marker centres (in space); with ``scale``,
    scale the marker map and the camera positions to fit them (exactly what markers of s times the
    size would have given)."""
    pairs = [(int(a), int(b), float(mm)) for a, b, mm in distances or () if int(a) in poses and int(b) in poses]
    for a, b, _ in distances or ():
        if int(a) not in poses or int(b) not in poses:
            warnings.append(
                f"Distance {int(a)}-{int(b)}: marker {int(a) if int(a) not in poses else int(b)} was not placed."
            )
    if not pairs:
        return None

    def surveyed(a, b):
        return float(np.linalg.norm(poses[a][1] - poses[b][1]))

    s = 1.0
    if scale:
        s = sum(mm for _, _, mm in pairs) / sum(surveyed(a, b) for a, b, _ in pairs)
        for m, (R, t) in list(poses.items()):
            poses[m] = (R, t * s)
            for key in ("sigma_mm", "sigma_z_mm"):
                if stats.get(m) and stats[m].get(key):
                    stats[m][key] = round(stats[m][key] * s, 2)
        for fi, (R, t) in list(cams.items()):
            cams[fi] = (R, t * s)
        if abs(s - 1) > 0.01:
            warnings.append(
                f"The measured distances scaled the marker map by {100 * (s - 1):+.1f} %: is the marker size right "
                "(--size)?"
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


def _check_heights(heights, poses, stats, warnings) -> dict | None:
    """Compare the surveyed heights of marker centres with heights measured with a ruler."""
    rows = []
    for m, mm in heights or ():
        m = int(m)
        if m not in poses:
            warnings.append(f"Height of marker {m}: the marker was not placed.")
            continue
        z = float(poses[m][1][2])
        sig = (stats.get(m) or {}).get("sigma_z_mm") or 0.0
        rows.append({"marker": m, "measured_mm": float(mm), "surveyed_mm": round(z, 1), "sigma_mm": sig})
    off = [r for r in rows if abs(r["surveyed_mm"] - r["measured_mm"]) > max(1.5, 3 * r["sigma_mm"])]
    if off:
        warnings.append(
            "Measured and surveyed heights differ: "
            + ", ".join(f"marker {r['marker']} {r['surveyed_mm'] - r['measured_mm']:+.1f} mm" for r in off)
            + ". Measured from the plane of the origin marker (z = 0)?"
        )
    return {"markers": rows} if rows else None


# ---------------------------------------------------------------------------------- survey


def survey3d(
    frames: list[Frame],
    sources: list[Source],
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
    heights=(),
    calibration: dict | None = None,
    log=None,
) -> SurveyResult:
    """Marker poses in 3D from the detections of all frames (see the module docstring).

    ``fixed``: known poses (id -> (R, t)), e.g. from a layout file (2D poses lie flat at z = 0); they
    are kept (or, with ``refine_fixed``, used as priors), unless the video shows that a marker
    moved. Without fixed poses the ``origin`` marker and the plane most markers share with it define
    the layout frame. ``distances``: (id_a, id_b, mm) between marker centres; without fixed poses
    they set the scale, otherwise they are only checked. ``heights``: (id, mm) heights of marker
    centres above the layout plane, measured for checking."""
    sizes_mm = {int(k): float(v) for k, v in (sizes_mm or {}).items()}

    def size_of(m):
        return sizes_mm.get(m, float(size_mm))

    fixed = {int(m): (np.asarray(R, float), np.asarray(t, float)) for m, (R, t) in (fixed or {}).items()}
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
    cameras, group_of = camera_groups(sources, frames, calibration, size_of)

    # 1. did markers of the layout move? Free survey from one of them, compared with the layout
    moved: dict[int, str] = {}
    check = None
    if len(fixed_seen) >= 2:
        anchor = origin if origin in fixed_seen else max(fixed_seen, key=lambda m: (seen[m], -m))
        adj0, free_poses, _, _ = _adjust3d(
            frames, {anchor: fixed[anchor]}, size_of, cameras, group_of, huber_px=huber_px, reject_px=reject_px
        )
        cov0 = adj0.covariance()[0] if adj0 else {}
        common = sorted(m for m in fixed_seen if m in free_poses)
        if len(common) >= 2:
            moved, check = _compare_with_layout(common, free_poses, fixed, cov0, moved_mm, warnings)

    # 2. the survey: fixed markers kept (or as priors), moved ones measured again
    gauge = {m: p for m, p in fixed.items() if m not in moved} if fixed else {origin: (np.eye(3), np.zeros(3))}
    priors = {}
    if refine_fixed and len(gauge) > 1:
        keep = origin if origin in gauge else max(gauge, key=lambda m: (seen.get(m, 0), -m))
        priors = {m: (R, t, prior_mm, math.radians(prior_deg)) for m, (R, t) in gauge.items() if m != keep}
    if log:
        log("  cameras: " + ", ".join(f"{c.f:.0f} px{' (calibrated)' if c.fixed else ''}" for c in cameras))
    adj, poses, cams, rejected = _adjust3d(
        frames, gauge, size_of, cameras, group_of, priors=priors, huber_px=huber_px, reject_px=reject_px, log=log
    )
    cov, cov_cams = {}, {}
    if adj and not fixed:  # the origin marker only fixes the frame: uncertainties of the map as a whole
        everything = Adjustment3D(
            frames, adj.observations, poses, set(adj.ids), {fi: c for fi, c in cams.items()}, cameras, group_of, size_of
        )
        everything.delta = adj.delta
        cov, cov_cams = everything.free_network_covariance()
    elif adj:
        cov, cov_cams = adj.covariance()
    for g, C in cov_cams.items():
        cameras[g].sigma_f = math.sqrt(max(float(C[0, 0]), 0))
        cameras[g].sigma_k1 = math.sqrt(max(float(C[1, 1]), 0))
    misread = _misreads(poses, seen, size_of, keep=set(gauge))
    for m in misread:
        del poses[m]

    # 3. the layout frame: the plane most markers share with the origin marker
    plane = None
    Rt = np.eye(3)
    if not fixed and origin in poses:
        Rt, on_plane, fallback = layout_plane(poses, origin)
        p0 = poses[origin][1].copy()
        poses, cams = reframe(poses, cams, Rt, p0)
        plane = {"markers": [int(m) for m in on_plane], "fallback": bool(fallback)}
        if fallback:
            warnings.append(
                "Fewer than three markers lie on one plane with the origin marker (or they lie on a line): the layout "
                "plane is the origin marker's own, so a tilted sticker tilts the whole map. Put more markers on the "
                "level of the origin marker, spread out."
            )

    # 4. results per marker and frame
    status, stats = {}, {}
    obs_rms = adj.observation_rms() if adj else np.zeros(0)
    per_marker = defaultdict(list)
    per_frame = defaultdict(list)
    if adj:
        for p, (fi, m) in enumerate(adj.observations):
            per_marker[m].append(obs_rms[p])
            per_frame[fi].append((m, obs_rms[p]))
    for fi, (R, t) in cams.items():
        fr = frames[fi]
        fr.R, fr.t, fr.group = R, t, int(group_of[fi])
        rs = [e for _, e in per_frame[fi]]
        fr.rms = float(np.sqrt(np.mean(np.square(rs)))) if rs else None
        fr.used = sorted(m for m, _ in per_frame[fi])
        fr.H = plane_homography(cameras[fr.group], R, t)
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
        Cp = Rt @ C[3:, 3:] @ Rt.T if C is not None else None
        stats[m] = {
            "detections": seen.get(m, 0),
            "frames": len(e),
            "rms_px": round(float(np.sqrt(np.mean(np.square(e)))), 2) if e else None,
            "sigma_mm": round(float(math.sqrt(max(np.trace(Cp), 0))), 2) if Cp is not None else 0.0,
            "sigma_z_mm": round(float(math.sqrt(max(Cp[2, 2], 0))), 2) if Cp is not None else 0.0,
            "sigma_deg": round(float(math.degrees(math.sqrt(max(np.trace(C[:3, :3]), 0)))), 3)
            if C is not None
            else 0.0,
        }
        if m in moved:
            stats[m]["moved"] = moved[m]
    for m, p in fixed.items():  # markers of the layout that were not seen keep their pose
        if m not in poses:
            poses[m] = p
            status[m] = "origin" if m == origin else "fixed"
            stats[m] = {
                "detections": seen.get(m, 0),
                "frames": 0,
                "rms_px": None,
                "sigma_mm": 0.0,
                "sigma_z_mm": 0.0,
                "sigma_deg": 0.0,
            }
    kept = [m for m in fixed if stats[m]["frames"] == 0]
    if kept:
        warnings.append(f"Not seen together with other markers, kept as in the layout (not checked): {_ids(kept)}.")
    distance_check = _apply_distances(distances, poses, cams, stats, scale=not fixed, warnings=warnings)
    if distance_check and distance_check["applied"]:
        for fi, (R, t) in cams.items():
            frames[fi].t = t
            frames[fi].H = plane_homography(cameras[frames[fi].group], R, t)
    height_check = _check_heights(heights, poses, stats, warnings)
    levels, level_of = find_levels(poses)
    for m in stats:
        stats[m]["level"] = level_of.get(m)

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
            n = sum(
                1
                for fi, fr in enumerate(frames)
                if m in fr.markers and (fi, m) not in rejected and any(k in poses for k in fr.markers if k != m)
            )
            unplaced[m] = (
                f"its pose cannot be told from the {n} frame{'s' if n != 1 else ''} that show it with placed markers: "
                "film it closer and from more directions (seen small or from one direction only, its two possible "
                "tilts look alike)"
                if n
                else "all its detections were rejected (wrong detections?)"
            )
    flat = {m: np.array([*pose6(*p)[:3]]) for m, p in poses.items()}
    _warnings(frames, seen, flat, status, stats, unplaced, rejected, adj, warnings)
    for cam in cameras:
        if not cam.fixed and cam.sigma_f is not None and cam.sigma_f > 0.01 * cam.f:
            warnings.append(
                f"The focal length of the camera of {_names(sources, cam)} is poorly determined ({cam.f:.0f} +- "
                f"{cam.sigma_f:.0f} px): film the markers from more directions, tilted 40-60 degrees, or give a "
                "--calibration."
            )
        if abs(cam.k1) > 0.15:
            warnings.append(
                f"The camera of {_names(sources, cam)} distorts strongly (k1 = {cam.k1:+.2f}): use the main camera "
                "(1x), not the wide-angle one, or a --calibration."
            )
    rms = float(np.sqrt(np.mean(np.square(obs_rms)))) if len(obs_rms) else 0.0
    return SurveyResult(
        poses=dict(sorted(flat.items())),
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
        mode="3d",
        poses3d=dict(sorted(poses.items())),
        cameras=cameras,
        levels=levels,
        plane=plane,
        heights=height_check,
    )


def _names(sources: list[Source], cam: Camera) -> str:
    """File names of a camera's inputs."""
    return ", ".join(sorted({os.path.basename(sources[s].path) for s in cam.sources}))


def plane_homography(cam: Camera, R, t) -> np.ndarray:
    """Homography of the layout plane z = 0 (mm) -> image (px) of a camera pose, without distortion."""
    H = cam.K() @ np.column_stack([R[:, 0], R[:, 1], t])
    return H / H[2, 2] if abs(H[2, 2]) > 1e-12 else H


# ---------------------------------------------------------------------------------- orthophoto

STEEP_DEG = 60.0  # markers tilted more than this (on walls, desk fronts) say nothing about the surface's height


class HeightModel:
    """Height of the layout's surface under every point (x, y), for the orthophoto: the plane of the
    level of the nearest marker. Levels are the groups of :func:`find_levels`; markers tilted more
    than ``STEEP_DEG`` are left out. Halfway between markers of two levels the model switches from
    one level to the other, wherever the real edge is: markers close to the edges of levels keep
    that error small."""

    def __init__(self, poses: dict, levels: list[dict]):
        self.planes = []  # per level: z = a + b x + c y
        xy, owner = [], []
        for lv in levels:
            ms = [m for m in lv["markers"] if m in poses]
            if not ms or lv["tilt_deg"] > STEEP_DEG:
                continue
            P = np.array([poses[m][1] for m in ms])
            n = chordal_mean([poses[m][0] for m in ms])[:, 2]
            c = P.mean(0)
            plane = (c[2] + (n[0] * c[0] + n[1] * c[1]) / n[2], -n[0] / n[2], -n[1] / n[2])
            if len(ms) >= 3:
                A = np.column_stack([np.ones(len(ms)), P[:, 0], P[:, 1]])
                if np.linalg.svd(A[:, 1:] - A[:, 1:].mean(0), compute_uv=False)[-1] > 50.0:  # spread out
                    plane = tuple(np.linalg.lstsq(A, P[:, 2], rcond=None)[0])
            for m in ms:
                xy.append(poses[m][1][:2])
                owner.append(len(self.planes))
            self.planes.append(plane)
        self.xy = np.array(xy, float).reshape(-1, 2)
        self.owner = np.array(owner, int)
        self.coef = np.array(self.planes, float).reshape(-1, 3)

    def labels(self, X, Y) -> np.ndarray:
        """Level (index into the planes) of the nearest marker of every point; -1 without levels."""
        X, Y = np.asarray(X, float), np.asarray(Y, float)
        if not len(self.xy):
            return np.full(X.shape, -1, int)
        out = np.empty(X.size, int)
        xf, yf = X.ravel(), Y.ravel()
        step = max(1, 4_000_000 // len(self.xy))
        for i in range(0, X.size, step):
            d = (xf[i : i + step, None] - self.xy[:, 0]) ** 2 + (yf[i : i + step, None] - self.xy[:, 1]) ** 2
            out[i : i + step] = self.owner[np.argmin(d, axis=1)]
        return out.reshape(X.shape)

    def distances(self, X, Y) -> np.ndarray:
        """Distance (mm) from every point to the nearest marker of every level: (levels, ...)."""
        X, Y = np.asarray(X, float), np.asarray(Y, float)
        out = np.full((len(self.coef),) + X.shape, np.inf)
        for k in range(len(self.coef)):
            for x0, y0 in self.xy[self.owner == k]:
                np.minimum(out[k], np.hypot(X - x0, Y - y0), out=out[k])
        return out

    def surface(self, X, Y, labels=None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Height z and slopes dz/dx, dz/dy at the points (0 without levels)."""
        X, Y = np.asarray(X, float), np.asarray(Y, float)
        lab = self.labels(X, Y) if labels is None else labels
        if not len(self.coef):
            return np.zeros(X.shape), np.zeros(X.shape), np.zeros(X.shape)
        a, b, c = (self.coef[np.maximum(lab, 0), k] for k in range(3))
        return a + b * X + c * Y, b, c


@dataclass
class _View3D:
    """A frame that may contribute to the 3D orthophoto, with its penalties (see ``survey._View``)."""

    frame: Frame
    camera: Camera
    sharp: float
    mask: np.ndarray | None
    markers_xy: np.ndarray
    support_mm: float
    covered: list = field(default_factory=list)


def _project_surface(view: _View3D, X, Y, Z, GX, GY, jacobian: bool = True):
    """Image positions (u, v) of surface points, the Jacobian d(u, v)/d(x, y) along the surface (None
    without ``jacobian``), and whether the camera sees them (in front, within the range of the lens
    model, facing it)."""
    cam, R, t = view.camera, view.frame.R, view.frame.t
    xc = R[0, 0] * X + R[0, 1] * Y + R[0, 2] * Z + t[0]
    yc = R[1, 0] * X + R[1, 1] * Y + R[1, 2] * Z + t[1]
    z = R[2, 0] * X + R[2, 1] * Y + R[2, 2] * Z + t[2]
    zs = np.where(z > 1e-6, z, 1e-6)
    x, y = xc / zs, yc / zs
    r2 = x * x + y * y
    k, f = cam.k1, cam.f
    d = 1 + k * r2
    u, v = f * d * x + cam.cx, f * d * y + cam.cy
    W, H = view.frame.size
    r2max = 4 * ((W / 2) ** 2 + (H / 2) ** 2) / f**2  # beyond, the k1 polynomial folds back
    centre = -R.T @ t
    facing = (centre[0] - X) * -GX + (centre[1] - Y) * -GY + (centre[2] - Z) > 0
    ok = (z > 1e-6) & (r2 < r2max) & (1 + 3 * k * r2 > 0.2) & facing
    if not jacobian:
        return u, v, None, ok
    a, b, c = f * (d + 2 * k * x * x), f * 2 * k * x * y, f * (d + 2 * k * y * y)
    # camera-frame directions of the surface's tangents R (1, 0, dz/dx) and R (0, 1, dz/dy)
    t1 = [R[i, 0] + GX * R[i, 2] for i in range(3)]
    t2 = [R[i, 1] + GY * R[i, 2] for i in range(3)]
    du = (a / zs, b / zs, -(a * x + b * y) / zs)
    dv = (b / zs, c / zs, -(b * x + c * y) / zs)
    J = tuple(sum(dd[i] * tt[i] for i in range(3)) for dd in (du, dv) for tt in (t1, t2))
    return u, v, J, ok


def _quality3d(view: _View3D, X, Y, Z, GX, GY, qmin: float, border: float = 0.04):
    """How well a frame shows surface points (see ``survey._quality``): the blending weight before
    the power, the mean scale (px per mm) and the image positions."""
    u, v, (a, b, c, d), ok = _project_surface(view, X, Y, Z, GX, GY)
    smin, smax = singular_values_2x2(a, b, c, d)
    W, H = view.frame.size
    edge = np.minimum(np.minimum(u, W - 1 - u), np.minimum(v, H - 1 - v))
    dist = np.full(np.shape(X), np.inf)
    for x0, y0 in view.markers_xy:
        dist = np.minimum(dist, np.hypot(X - x0, Y - y0))
    detail = smin * view.sharp
    q = detail * np.clip(edge / (border * min(W, H)), 1e-3, 1) / (1 + (dist / view.support_mm) ** 2)
    q[~ok | (edge < 0) | ~(detail >= qmin) | (dist > EXTRAPOLATE * view.support_mm)] = 0
    if view.mask is not None:
        mh, mw = view.mask.shape
        inside = q > 0
        mu = np.clip((u[inside] * mw / W).astype(int), 0, mw - 1)
        mv = np.clip((v[inside] * mh / H).astype(int), 0, mh - 1)
        q[inside] *= view.mask[mv, mu] == 0
    for x0, y0, r in view.covered:
        q[np.hypot(X - x0, Y - y0) < r] = 0
    return q, np.sqrt(smin * smax), u, v


def _covered3d(f: Frame, cam: Camera, result: SurveyResult, size_of) -> list[tuple[float, float, float]]:
    """Placed markers that face the camera, well inside the frame and large enough, but were not
    detected: something covers them (a hand, a train, a raised level in front)."""
    out = []
    W, H = f.size
    centre = -f.R.T @ f.t
    for m, (R, t) in result.poses3d.items():
        if m in f.markers:
            continue
        to_cam = centre - t
        if R[:, 2] @ to_cam < 0.3 * np.linalg.norm(to_cam):
            continue
        Xc = corners_world((R, t), size_of(m)) @ f.R.T + f.t
        if np.any(Xc[:, 2] <= 1e-6):
            continue
        p = cam.project(Xc)
        side = float(np.min(np.hypot(*(np.roll(p, -1, 0) - p).T)))
        margin = 0.05 * min(W, H)
        if (
            side >= 12
            and p[:, 0].min() > margin
            and p[:, 1].min() > margin
            and p[:, 0].max() < W - margin
            and (p[:, 1].max() < H - margin)
        ):
            out.append((float(t[0]), float(t[1]), 2.5 * size_of(m)))
    return out


def _ortho_views3d(result: SurveyResult, sources: list[Source], user_masks=(), size_of=None) -> list[_View3D]:
    """Frames that may contribute to the orthophoto: a camera pose from two or more markers that fits."""
    size_of = size_of or (lambda m: 30.0)
    frames = [f for f in result.frames if f.R is not None and len(f.used) >= 2 and f.rms is not None]
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
        if sources[f.source].kind == "video":  # blur relative to the neighbouring frames
            seq, k = seqs[f.source], position[id(f)]
            ref = float(np.median([g.sharpness for g in seq[max(0, k - 7) : k + 8]]))
            sharp = float(np.clip(f.sharpness / ref, 0.2, 1.0)) ** 0.5 if ref > 0 else 1.0
        xy = np.array([result.poses3d[m][1][:2] for m in f.used if m in result.poses3d])
        spread = float(np.max(np.hypot(*(xy[:, None] - xy[None]).transpose(2, 0, 1)))) if len(xy) > 1 else 0.0
        cam = result.cameras[f.group]
        views.append(
            _View3D(f, cam, sharp, masks[f.source], xy, max(200.0, 0.6 * spread), _covered3d(f, cam, result, size_of))
        )
    return views


def _bounds3d(result: SurveyResult, views: list[_View3D], model: HeightModel, coarsest_mm: float):
    """Bounds (mm, multiples of 10) of the part of the layout seen with enough detail, and the best
    quality found (see ``survey.ortho_bounds``)."""
    xy = np.array([t[:2] for _, t in result.poses3d.values()])
    lo, hi = xy.min(0), xy.max(0)
    margin = max(400.0, 0.6 * float(np.max(hi - lo)))
    lo, hi = lo - margin, hi + margin
    cell = max(5.0, float(np.max(hi - lo)) / 500)
    xs = np.arange(lo[0], hi[0], cell) + cell / 2
    ys = np.arange(lo[1], hi[1], cell) + cell / 2
    X, Y = np.meshgrid(xs, ys)
    Z, GX, GY = model.surface(X, Y)
    best = np.zeros(X.shape)
    for view in views:
        np.maximum(best, _quality3d(view, X, Y, Z, GX, GY, 1 / coarsest_mm)[0], out=best)
    seen = cv2.morphologyEx((best > 0).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
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


def _visible(
    view: _View3D, X, Y, Z, height: np.ndarray, x0: float, y0: float, cell: float, skip: int = 1
) -> np.ndarray:
    """Whether the camera of a view sees the surface points (X, Y, Z) past the surface itself: the ray
    from every point towards the camera is followed in steps of one cell (horizontally) until it
    rises above the highest level; it is blocked where the height grid (``height``, cells of
    ``cell`` mm, centre of cell (0, 0) at (x0, y0), rows going down in y) lies more than 1 mm above it.
    The first ``skip - 1`` steps are not checked (a point's own, possibly wrong, neighbourhood)."""
    centre = -view.frame.R.T @ view.frame.t
    dx, dy, dz = centre[0] - X, centre[1] - Y, centre[2] - Z
    h = np.hypot(dx, dy)
    top = float(np.max(height))
    rise = dz / np.maximum(h, 1e-9)  # mm up per mm along the ground
    ok = np.ones(X.shape, bool)
    up = (rise > 0) & (h > 1e-6)
    ux, uy = np.where(up, dx / np.maximum(h, 1e-9), 0), np.where(up, dy / np.maximum(h, 1e-9), 0)
    reach = np.where(up, np.minimum(h, (top - Z + 1) / np.maximum(rise, 1e-9)), 0)
    steps = int(min(200, math.ceil(float(np.max(reach, initial=0)) / cell)))
    rows, cols = height.shape
    for k in range(skip, steps + 1):
        d = k * cell
        act = up & ok & (d < reach)
        if not act.any():
            break
        c = np.rint((X + ux * d - x0) / cell).astype(int)
        r = np.rint((y0 - (Y + uy * d)) / cell).astype(int)
        inside = act & (c >= 0) & (c < cols) & (r >= 0) & (r < rows)
        g = np.full(X.shape, -np.inf)
        g[inside] = height[r[inside], c[inside]]
        ok &= ~(inside & (g > Z + rise * d + 1.0))
    return ok


def _consistent_levels(views, model: HeightModel, X, Y, sources, calibration, qmin, max_views: int = 40, log=None):
    """Level of every grid point, chosen by photo-consistency: on the right level, the frames that
    see a point show the same thing there; on a wrong one, each frame shows something else (the
    point is shifted by the parallax of the height error). Every level is tried; the cost is the
    truncated mean deviation of the frames' grey values from their median (robust against a few
    frames in which the point is hidden), smoothed over 3 x 3 points, plus a small penalty that
    grows with the distance to the level's markers, which decides where the frames show no
    texture. A second round leaves out the frames in which a point is hidden behind the surface
    found in the first (next to a raised level, half of the frames may not see the ground)."""
    L = len(model.coef)
    nearest = model.labels(X, Y)
    if L < 2:
        return nearest
    sel = list(range(len(views)))
    if len(sel) > max_views:
        sel = [sel[i] for i in np.linspace(0, len(sel) - 1, max_views).round().astype(int)]
    chosen = [views[i] for i in sel]
    cell = float(abs(X[0, 1] - X[0, 0])) if X.shape[1] > 1 else 4.0
    x0, y0 = float(X[0, 0]), float(Y[0, 0])
    planes = []
    for k in range(L):
        a, b, c = model.coef[k]
        planes.append((a + b * X + c * Y, np.full(X.shape, b), np.full(X.shape, c)))
    images = [None] * len(chosen)  # grey images, shrunk to about 2 pixels per grid cell
    for j, img in _read_views(chosen, sources, calibration):
        grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        q, scale, _, _ = _quality3d(chosen[j], X, Y, *planes[0], qmin)
        zoom = float(np.median(scale[q > 0])) * cell if (q > 0).any() else 1.0
        images[j] = _shrink(grey, 2.0 / zoom) if zoom > 2 else (grey, np.eye(3))

    def decide(surface=None):
        samples = np.full((L, len(chosen)) + X.shape, np.nan, np.float32)
        for j, view in enumerate(chosen):
            small, S = images[j]
            for k, (Z, GX, GY) in enumerate(planes):
                q, _, u, v = _quality3d(view, X, Y, Z, GX, GY, qmin)
                ok = q > 0
                if surface is not None and ok.any():  # levels may be off by two cells at their edges
                    ok &= _visible(view, X, Y, Z, surface, x0, y0, cell, skip=3)
                if not ok.any():
                    continue
                mu = (S[0, 0] * u + S[0, 2]).astype(np.float32)
                mv = (S[1, 1] * v + S[1, 2]).astype(np.float32)
                val = cv2.remap(small, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                samples[k, j][ok] = val[ok]
        tau = 30.0
        count = np.sum(np.isfinite(samples), axis=1)
        with warnings.catch_warnings():  # points no frame shows: all-NaN slices
            warnings.simplefilter("ignore", RuntimeWarning)
            med = np.nanmedian(samples, axis=1)
            cost = np.nanmean(np.minimum(np.abs(samples - med[:, None]), tau), axis=1)
        cost[count < 2] = tau
        cost = np.stack([cv2.blur(c.astype(np.float32), (3, 3)) for c in cost])
        cost += 0.5 * tau * np.minimum(1.0, (model.distances(X, Y) / 300.0) ** 2)
        labels = np.argmin(cost, axis=0)
        none = np.all(count < 2, axis=0)
        labels[none] = nearest[none]
        return cv2.medianBlur(labels.astype(np.uint8), 3).astype(int) if L < 256 else labels

    labels = decide()
    labels = decide(model.surface(X, Y, labels)[0])
    if log:
        changed = float(np.mean(labels != nearest))
        log(
            f"  orthophoto: levels chosen by {len(chosen)} frames "
            f"({100 * changed:.0f} % differ from the nearest marker's level)"
        )
    return labels


def orthophoto3d(
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
    """The orthophoto of a 3D survey: a top view in which every point of the surface (the height
    model of :class:`HeightModel`) is taken from the frame that shows it best, through that frame's
    camera. Raised levels appear at their place, not shifted away from the camera. Otherwise as
    :func:`arail_tools.survey.orthophoto` (bounds, resolution, exposure, masks, covered markers)."""
    views = _ortho_views3d(result, sources, masks, size_of)
    if not views:
        raise SurveyError("No frame shows two or more placed markers: an orthophoto needs them.")
    model = HeightModel(result.poses3d, result.levels or [])
    auto, qmax = _bounds3d(result, views, model, coarsest_mm)
    b = [auto[i] if bounds is None or bounds[i] is None else float(bounds[i]) for i in range(4)]
    if b[2] <= b[0] or b[3] <= b[1]:
        raise SurveyError(f"Empty orthophoto area {b} (check --ortho-bounds)")
    res = max(float(mm_per_px), math.ceil(100 * max(b[2] - b[0], b[3] - b[1]) / max_side) / 100)
    W, H = int(math.ceil((b[2] - b[0]) / res - 1e-6)), int(math.ceil((b[3] - b[1]) / res - 1e-6))
    given = [bounds is not None and bounds[i] is not None for i in range(4)]
    if given[2] and not given[0]:
        b[0] = b[2] - W * res
    else:
        b[2] = b[0] + W * res
    if given[1] and not given[3]:
        b[3] = b[1] + H * res
    else:
        b[1] = b[3] - H * res
    qmin = 1 / coarsest_mm

    def grid(step):  # layout coordinates of the centres of step x step blocks of output pixels
        cx = np.arange(0, W, step) + (step - 1) / 2
        cy = np.arange(0, H, step) + (step - 1) / 2
        return np.meshgrid(b[0] + (cx + 0.5) * res, b[3] - (cy + 0.5) * res)

    # the surface at full resolution (the labels on a grid of 4 x 4 pixels, then nearest)
    step = 4
    CX, CY = grid(step)
    lab = _consistent_levels(views, model, CX, CY, sources, calibration, qmin, log=log)
    full = cv2.resize(
        lab.astype(np.float32), (lab.shape[1] * step, lab.shape[0] * step), interpolation=cv2.INTER_NEAREST
    )
    full = full[:H, :W].astype(int)
    XF, YF = np.meshgrid(b[0] + (np.arange(W) + 0.5) * res, b[3] - (np.arange(H) + 0.5) * res)
    ZF, GXF, GYF = model.surface(XF, YF, full)
    CZ, CGX, CGY = model.surface(CX, CY, lab)
    cell = step * res

    def seen(view, X, Y, Z):  # hidden behind raised parts of the surface: no weight
        return _visible(view, X, Y, Z, CZ, float(CX[0, 0]), float(CY[0, 0]), cell)

    # 1. exposure: every frame mapped onto a coarse grid (1/16 of the output)
    G = 16
    XL, YL = grid(G)
    ZL, GXL, GYL = model.surface(XL, YL)
    low: list = [None] * len(views)
    for i, img in _read_views(views, sources, calibration):
        q, _, u, v = _quality3d(views[i], XL, YL, ZL, GXL, GYL, qmin)
        q *= seen(views[i], XL, YL, ZL)
        if q.any():
            small, S = _shrink(img, 1 / 8)
            mu = (S[0, 0] * u + S[0, 2]).astype(np.float32)
            mv = (S[1, 1] * v + S[1, 2]).astype(np.float32)
            L = cv2.remap(small, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            low[i] = (q.astype(np.float32), L.astype(np.float32))
    gains = _gains(low)

    # 2. full resolution; weights on the grid of 4 x 4 output pixels, interpolated
    acc = np.zeros((H, W, 3), np.float32)
    wsum = np.zeros((H, W), np.float32)
    used = 0
    for i, img in _read_views(views, sources, calibration):
        q, scale, _, _ = _quality3d(views[i], CX, CY, CZ, CGX, CGY, qmin)
        q *= seen(views[i], CX, CY, CZ)
        if not q.any():
            continue
        rows, cols = np.flatnonzero(q.any(1)), np.flatnonzero(q.any(0))
        r0, r1 = max(0, rows[0] - 1), min(q.shape[0], rows[-1] + 2)
        c0, c1 = max(0, cols[0] - 1), min(q.shape[1], cols[-1] + 2)
        y0, y1, x0, x1 = r0 * step, min(H, r1 * step), c0 * step, min(W, c1 * step)
        qb = q[r0:r1, c0:c1]
        w = np.where(qb > 0, np.maximum((qb / qmax) ** ORTHO_POWER, 1e-30), 0).astype(np.float32)
        w = cv2.resize(w, ((c1 - c0) * step, (r1 - r0) * step), interpolation=cv2.INTER_LINEAR)[: y1 - y0, : x1 - x0]
        zoom = float(np.median(scale[r0:r1, c0:c1][q[r0:r1, c0:c1] > 0])) * res
        S = np.eye(3)
        if zoom > 1.5:  # anti-aliasing: shrink frames that have much more detail than the output
            img, S = _shrink(img, 1.25 / zoom)
        sl = (slice(y0, y1), slice(x0, x1))
        u, v, _, ok = _project_surface(views[i], XF[sl], YF[sl], ZF[sl], GXF[sl], GYF[sl], jacobian=False)
        mu = (S[0, 0] * u + S[0, 2]).astype(np.float32)
        mv = (S[1, 1] * v + S[1, 2]).astype(np.float32)
        warped = cv2.remap(img, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        w = w * ok
        acc[sl] += warped.astype(np.float32) * (w[..., None] * gains[i].astype(np.float32))
        wsum[sl] += w
        used += 1
    if log:
        log(f"  orthophoto: {used} frames, exposure gains {gains.min():.2f} .. {gains.max():.2f}")
    covered = wsum > 0
    out = np.empty((H, W, 3), np.uint8)
    out[:] = ORTHO_BACKGROUND
    out[covered] = np.clip(acc[covered] / wsum[covered][:, None] + 0.5, 0, 255).astype(np.uint8)
    return Orthophoto(out, [round(v, 3) for v in b], res, used, float(covered.mean()))


def check_image3d(ortho: Orthophoto, layout: dict | None, result: SurveyResult, size_of) -> np.ndarray:
    """The check image of a 3D survey: as :func:`arail_tools.survey.check_image`, with every marker's
    outline as seen from above and, off the layout plane, its height in the label (e.g. "12 +80")."""

    def marker(m):
        R, t = result.poses3d[m]
        z = float(t[2])
        return corners_world((R, t), size_of(m))[:, :2], f"{m} {z:+.0f}" if abs(z) >= 1.5 else str(m)

    return check_image(ortho, layout, result, size_of, markers=marker)
