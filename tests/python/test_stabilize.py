"""Videos: steadier poses (arail-stabilize) and joining shots (arail-compose).

A synthetic clip: a textured table seen by a camera that moves smoothly, with "marker poses" that
are the true ones plus noise. The picture's motion must come out of the frames, and the joined
poses must be close to the truth and slip far less than the markers' poses."""

import argparse
import json
import os
import shutil

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
from arail_tools import compose as cp  # noqa: E402
from arail_tools import stabilize as st  # noqa: E402

N = 40
SIZE = (640, 480)
REF = st.rect([100, 100, 700, 500])
PTS = REF.mean(axis=0) + (REF - REF.mean(axis=0)) * 0.5


def texture(seed=3):
    """A table 800 x 600 mm with blotches, 1 px per mm."""
    rng = np.random.default_rng(seed)
    t = rng.integers(0, 255, (600, 800)).astype(np.uint8)
    t = cv2.GaussianBlur(t, (0, 0), 3)
    return cv2.normalize(t, None, 0, 255, cv2.NORM_MINMAX)


def true_pose(i):
    """Layout (mm) -> image (px): the camera turns slowly and drifts along the table."""
    th = 0.004 * i
    c, s = np.cos(th), np.sin(th)
    T1 = np.array([[1, 0, -400 - 3.0 * i], [0, 1, -300 - 1.5 * i], [0, 0, 1]])
    R = np.array([[0.8 * c, -0.8 * s, 0], [0.8 * s, 0.8 * c, 0], [0, 0, 1]])
    P = np.array([[1, 0, 0], [0, 1, 0], [0.00012 * np.sin(0.1 * i), 0.0001, 1]])  # a little perspective
    T2 = np.array([[1, 0, SIZE[0] / 2], [0, 1, SIZE[1] / 2], [0, 0, 1]])
    H = T2 @ P @ R @ T1
    return H / H[2, 2]


@pytest.fixture(scope="module")
def clip():
    tex = texture()
    truth = [true_pose(i) for i in range(N)]
    frames = [cv2.warpPerspective(tex, H, SIZE, flags=cv2.INTER_LINEAR) for H in truth]
    rng = np.random.default_rng(7)
    raw = [st.h_from_corners(REF, st.apply_h(H, REF) + rng.normal(0, 2.0, (4, 2))) for H in truth]
    return truth, frames, raw


def corner_error(Hs, truth):
    return float(
        np.mean(
            [
                np.linalg.norm(st.apply_h(a, PTS) - st.apply_h(b, PTS), axis=1).mean()
                for a, b in zip(Hs, truth, strict=True)
            ]
        )
    )


def test_the_picture_motion_comes_from_the_frames(clip):
    truth, frames, raw = clip
    G = st.picture_motion(iter(frames), raw, [[0, 0, 800, 600]], REF.mean(axis=0))
    assert len(G) == N - 1
    errs = [
        np.linalg.norm(st.apply_h(G[i], st.apply_h(truth[i], PTS)) - st.apply_h(truth[i + 1], PTS), axis=1).max()
        for i in range(N - 1)
    ]
    assert max(errs) < 0.3, f"step error up to {max(errs):.2f} px"


def test_joined_poses_are_closer_to_the_truth_and_slip_far_less(clip):
    truth, frames, raw = clip
    G = [truth[i + 1] @ np.linalg.inv(truth[i]) for i in range(N - 1)]  # the exact motion
    ls = st.solve(raw, G, REF)
    lb = st.causal(raw, G, REF)
    e_raw, e_ls, e_causal = corner_error(raw, truth), corner_error(ls, truth), corner_error(lb, truth)
    assert e_ls < 0.5 * e_raw, f"least squares {e_ls:.2f} px vs markers {e_raw:.2f} px"
    assert e_causal < e_raw
    s_raw, s_ls, s_causal = (st.slip(H, G, PTS, raw)["within_1s"] for H in (raw, ls, lb))
    assert s_ls < 0.1 * s_raw and s_ls < 0.5, f"slip {s_ls:.2f} px vs {s_raw:.2f} px"
    assert s_causal < 0.2 * s_raw
    # the markers decide where the overlay sits on average
    assert st.slip(ls, G, PTS, raw)["from_markers"] < 3.0


def test_markers_that_disagree_with_the_picture_count_less(clip):
    truth, _, raw = clip
    G = [truth[i + 1] @ np.linalg.inv(truth[i]) for i in range(N - 1)]
    bad = list(raw)
    for i in range(18, 28):  # a stretch where the markers jump 20 px to and fro (two markers, far away)
        bad[i] = np.array([[1, 0, 20 if i % 2 else -20], [0, 1, 0], [0, 0, 1]]) @ raw[i]
    w = st.agreement(np.array([st.apply_h(H, REF) for H in bad]), G, 1.5)
    assert w[22] < 0.2 < w[5]
    assert corner_error(st.solve(bad, G, REF), truth) < 2.0


def test_the_command_line_writes_poses_for_pass_2(clip, tmp_path, capsys):
    truth, frames, raw = clip
    video = str(tmp_path / "clip.avi")
    out = cv2.VideoWriter(video, cv2.VideoWriter_fourcc(*"MJPG"), 30, SIZE)
    if not out.isOpened():
        pytest.skip("no MJPG writer in this OpenCV")
    for f in frames:
        out.write(cv2.cvtColor(f, cv2.COLOR_GRAY2BGR))
    out.release()
    record = {"clip": "clip.avi", "start": 0, "fps": 30, "size": list(SIZE), "focal": 900.0}
    record["raw"] = [{"H": H.ravel().tolist(), "Hs": None, "f": 900.0} for H in raw]
    record["raw"][3]["H"] = None  # a frame without markers takes its neighbour's pose
    rec = tmp_path / "raw.json"
    rec.write_text(json.dumps(record))
    poses, motion = tmp_path / "poses.json", tmp_path / "motion.json"
    args = [
        str(rec),
        "-o",
        str(poses),
        "--clip",
        video,
        "--ref=100,100,700,500",
        "--plane=0,0,800,600",
        "--motion",
        str(motion),
        "--quiet",
    ]
    assert st.main(args) == 0
    report = capsys.readouterr().out
    assert "least squares" in report and "markers of each frame" in report
    data = json.loads(poses.read_text())
    assert data["focal"] == 900.0 and data["size"] == list(SIZE) and len(data["poses"]) == N
    H = [np.array(p["H"]).reshape(3, 3) for p in data["poses"]]
    assert corner_error(H, truth) < corner_error(raw, truth)
    assert np.allclose(np.array(data["poses"][0]["Hinv"]).reshape(3, 3) @ H[0], np.eye(3), atol=1e-6)
    # the motion is kept and read again; the causal filter on the same clip
    assert len(json.loads(motion.read_text())) == N - 1
    assert st.main([*args[:-1], "--method", "causal", "--quiet"]) == 0
    assert "causal filter" in capsys.readouterr().out


def test_rectangles_are_checked():
    with pytest.raises(argparse.ArgumentTypeError):
        st._rect_arg("1,2,3")
    with pytest.raises(argparse.ArgumentTypeError):
        st._rect_arg("5,0,1,1")
    assert st._rect_arg("-2000,-300,-500,600") == [-2000, -300, -500, 600]


# ------------------------------------------------------------------------------------ compose


def frames_dir(path, n, colour, size=(200, 100)):
    os.makedirs(path, exist_ok=True)
    for i in range(n):
        img = np.zeros((size[1], size[0], 3), np.uint8)
        img[:] = colour
        img[:, : 10 + i] = (255, 255, 255)  # a bar that grows: which frame it is
        cv2.imwrite(os.path.join(path, f"f{i:04d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 100])


def test_compose_joins_shots_with_crossfades_and_a_seamless_loop(tmp_path, monkeypatch):
    monkeypatch.setattr(cp, "ROOT", str(tmp_path))
    frames_dir(tmp_path / "a", 20, (0, 0, 200))
    frames_dir(tmp_path / "b", 30, (0, 200, 0))
    plan = {
        "size": [100, 50],
        "parts": [
            {"frames": "a", "count": 20, "crop": [0, 0, 200, 100]},
            {"frames": "b", "count": 30, "crop": [[0, 0, 200, 100], [50, 25, 150, 75]], "fade": 6},
        ],
        "loop": 5,
    }
    out = tmp_path / "out"
    assert cp.compose(plan, str(out), log=lambda *_: None) == 20 + 30 - 6
    f = lambda i: cv2.imread(str(out / f"f{i:04d}.jpg")).astype(float)  # noqa: E731
    assert f(0)[25, 80, 2] > 180 and f(0)[25, 80, 1] < 30, "shot a: red"
    mid = f(17)  # in the crossfade
    assert 40 < mid[25, 80, 2] < 180 and 40 < mid[25, 80, 1] < 180
    assert f(30)[25, 80, 1] > 180, "shot b: green"
    assert np.abs(f(43) - f(0)).mean() < 8, "the last frame fades into the first"
    # the push into the middle of b: the bar at its left edge leaves the picture
    assert f(25)[25, :3, 0].mean() > 150
    assert f(38)[25, :, 0].max() < 40


def test_compose_puts_the_bare_picture_first(tmp_path, monkeypatch):
    monkeypatch.setattr(cp, "ROOT", str(tmp_path))
    frames_dir(tmp_path / "a", 10, (0, 0, 200))
    photo = np.full((100, 200, 3), (200, 0, 0), np.uint8)
    cv2.imwrite(str(tmp_path / "photo.jpg"), photo)
    plan = {
        "size": [100, 50],
        "parts": [
            {
                "frames": "a",
                "count": 10,
                "crop": [0, 0, 200, 100],
                "bare": {"image": "photo.jpg", "hold": 4, "fade": [2, 6]},
            }
        ],
    }
    out = tmp_path / "out"
    assert cp.compose(plan, str(out), log=lambda *_: None) == 14
    f = lambda i: cv2.imread(str(out / f"f{i:04d}.jpg")).astype(float)  # noqa: E731
    assert f(0)[25, 80, 0] > 180, "the bare photo"
    assert f(8)[25, 80, 2] > 180, "then the shot"
    with pytest.raises(OSError, match="missing"):
        cp.Part({"frames": "nowhere", "count": 3, "crop": [0, 0, 1, 1]}, (10, 10))


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg is not installed")
def test_compose_encodes_with_a_poster(tmp_path, monkeypatch):
    monkeypatch.setattr(cp, "ROOT", str(tmp_path))
    frames_dir(tmp_path / "a", 12, (0, 0, 200), size=(160, 96))
    plan = {
        "size": [64, 48],
        "parts": [{"frames": "a", "count": 12, "crop": [0, 0, 160, 96]}],
        "out": "v.mp4",
        "poster": {"frame": 3, "out": "v.jpg"},
    }
    (tmp_path / "plan.json").write_text(json.dumps(plan))
    assert cp.main([str(tmp_path / "plan.json"), "--frames", str(tmp_path / "frames")]) == 0
    assert (tmp_path / "v.mp4").stat().st_size > 0 and (tmp_path / "v.jpg").exists()
