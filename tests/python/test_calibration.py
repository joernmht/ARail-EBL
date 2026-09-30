"""Calibration with single 30 mm markers: simulated views through a distorting lens
(f = 950 px, k1 = -0.25) must be recovered."""

import json
import math

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
from arail_tools import calibrate as cal  # noqa: E402

W, H = 1280, 720
K = np.array([[950.0, 0, 640], [0, 950.0, 360], [0, 0, 1]])
D = np.array([-0.25, 0.08, 0, 0, 0])


def views(n, noise, rng):
    out = []
    while len(out) < n:
        axis = rng.normal(size=3)
        axis /= np.linalg.norm(axis)
        rvec = axis * math.radians(rng.uniform(15, 60))
        z = rng.uniform(250, 600)
        u, v = rng.uniform(40, W - 40), rng.uniform(40, H - 40)
        t = np.array([(u - 640) / 950 * z, (v - 360) / 950 * z, z])
        p, _ = cv2.projectPoints(cal.object_points(), rvec, t, K, D)
        p = p.reshape(4, 2) + rng.normal(0, noise, (4, 2))
        if p.min() > 0 and p[:, 0].max() < W and p[:, 1].max() < H and cal.usable(p):
            out.append(p)
    return out


def test_calibration_recovers_focal_length_and_distortion(tmp_path):
    rng = np.random.default_rng(1)
    rms, Kx, dx = cal.compute(views(80, 0.2, rng), (W, H))
    assert rms < 0.5
    assert abs(Kx[0, 0] - 950) / 950 < 0.05
    assert abs(dx[0] - D[0]) < 0.03
    data = cal.to_json(rms, Kx, dx, (W, H), 80)
    path = tmp_path / "cal.json"
    cal.save(str(path), data)
    loaded = json.loads(path.read_text())
    assert loaded["format"] == "arail-camera/1"
    assert loaded["image_size"] == [W, H]
    assert len(loaded["distortion"]) == 5
    assert abs(loaded["camera_matrix"][0][0] - Kx[0, 0]) < 0.01
