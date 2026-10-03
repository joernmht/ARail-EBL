"""Lab survey in 3D (arail-survey --3d): marker poses with height and tilt, cameras and levels.

Pure geometry (markers on the board, on a raised level, on a ramp and on a wall, seen by a moving
pinhole camera) checks the adjustment; the synthetic scene with levels (``synthetic.render_levels``)
checks the chain from images to the layout file, the report and the orthophoto."""

import copy
import json
import math

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
from arail_tools import survey as sv  # noqa: E402
from arail_tools import survey3d as s3  # noqa: E402
from arail_tools import synthetic as syn  # noqa: E402

SIZE = (1280, 720)
BASE = list(range(12))  # markers on the board in level_scene
RAISED = [12, 13, 14, 15]  # on the raised level (z = 60)
RAMP = [16, 17, 18]  # on the ramp (6 degrees)
WALL = 19  # on the raised level's front wall


def size_of(_m):
    return 30.0


def source(n=0):
    return [sv.Source("scene.mp4", "video", SIZE, 30.0, n)]


def level_scene(seed=3, count=120, noise=0.2, f=1100.0, k1=0.0, origin_tilt_deg=0.0):
    """Markers on the board (z = 0, marker 0 at the origin), on a raised level (z = 60), on a ramp
    rising 6 degrees along x and upright on the raised level's front wall, seen from random
    directions 35-60 degrees from above (1280 x 720, corners with Gaussian noise in px). Returns
    (true poses id -> (R, t), frames)."""
    rng = np.random.default_rng(seed)
    poses = {0: (s3.tilt_rotation(math.radians(origin_tilt_deg), 0.0), np.zeros(3))}
    m = 1
    for x in range(0, 1000, 250):
        for y in range(0, 600, 250):
            if (x, y) != (0, 0):
                xy = [x + rng.uniform(-30, 30), y + rng.uniform(-30, 30), 0.0]
                poses[m] = (s3.rot_z(rng.uniform(-math.pi, math.pi)), np.array(xy))
                m += 1
    for x, y in [(650, 420), (800, 470), (950, 400), (700, 560)]:
        poses[m] = (s3.rot_z(rng.uniform(-3, 3)), np.array([x, y, 60.0]))
        m += 1
    slope = math.radians(6)
    for x in (350, 450, 550):
        R = s3.tilt_rotation(slope, math.pi) @ s3.rot_z(rng.uniform(-3, 3))
        poses[m] = (R, np.array([x, 560.0, (x - 300) * math.tan(slope)]))
        m += 1
    poses[m] = (s3.tilt_rotation(math.pi / 2, -math.pi / 2), np.array([800.0, 330.0, 30.0]))
    camera = s3.Camera(SIZE, f, k1)
    frames = []
    for k in range(count):
        target = np.array([rng.uniform(-100, 1050), rng.uniform(-100, 650), rng.uniform(0, 40)])
        a, tilt = rng.uniform(-math.pi, math.pi), math.radians(rng.uniform(35, 60))
        cam = target + rng.uniform(450, 800) * np.array(
            [math.sin(tilt) * math.cos(a), math.sin(tilt) * math.sin(a), math.cos(tilt)]
        )
        fwd = (target - cam) / np.linalg.norm(target - cam)
        x = np.cross(fwd, [0, 0, 1.0])
        x /= np.linalg.norm(x)
        R = np.array([x, np.cross(fwd, x), fwd])
        t = -R @ cam
        found = {}
        for mid, (Rm, tm) in poses.items():
            Xc = s3.corners_world((Rm, tm), 30.0) @ R.T + t
            if np.any(Xc[:, 2] < 50) or Rm[:, 2] @ (cam - tm) <= 0.2 * np.linalg.norm(cam - tm):
                continue  # behind the camera, or seen from behind or edge-on
            uv = camera.project(Xc)
            if uv.min() > 2 and uv[:, 0].max() < SIZE[0] - 2 and uv[:, 1].max() < SIZE[1] - 2:
                found[mid] = uv + rng.normal(0, noise, uv.shape)
        frames.append(sv.Frame(0, k, k / 30, SIZE, found))
    return poses, frames


def errors(poses3d, truth):
    """Position (mm) and rotation (deg) errors per marker."""
    return {
        m: (float(np.linalg.norm(t - truth[m][1])), math.degrees(float(s3.rotation_angle(R, truth[m][0]))))
        for m, (R, t) in poses3d.items()
    }


@pytest.fixture(scope="module")
def scene():
    return level_scene()


@pytest.fixture(scope="module")
def surveyed(scene):
    _, frames = scene
    return s3.survey3d(copy.deepcopy(frames), source(), 30.0, origin=0)


def test_pose6_round_trip():
    """[x, y, rotation, z, tilt, tilt_dir]: flat markers keep the meaning of the 2D pose; a sticker
    upright on a wall facing -y has tilt 90 and tilt_dir -90; any rotation survives the round trip."""
    rng = np.random.default_rng(0)
    for _ in range(50):
        R = s3.exp_so3(rng.normal(0, 1.5, 3))
        t = rng.uniform(-500, 500, 3)
        R2, t2 = s3.from_pose6(s3.pose6(R, t))
        assert np.allclose(R2, R, atol=1e-9) and np.allclose(t2, t)
    p = s3.pose6(s3.rot_z(math.radians(30)), [10, 20, 0])
    assert np.allclose(p, [10, 20, math.radians(30), 0, 0, 0])
    p = s3.pose6(s3.tilt_rotation(math.pi / 2, -math.pi / 2), [0, 0, 25])
    assert np.allclose(np.degrees(p[[2, 4, 5]]), [0, 90, -90]) and p[3] == 25
    R, t = s3.from_pose6([1, 2, 0.5])  # a 2D pose lies flat at z = 0
    assert np.allclose(R, s3.rot_z(0.5)) and np.allclose(t, [1, 2, 0])


def test_initial_focal_from_rigid_marker_pairs(scene):
    """The focal length at which pairs of markers keep their relative positions over the frames:
    within a few per cent with 0.2 px corner noise (the perspective of single markers was 30 % off)."""
    _, frames = scene
    f = s3.initial_focal(frames, range(len(frames)), size_of, SIZE)
    assert abs(f / 1100 - 1) < 0.04


def test_exact_geometry_with_levels(scene, surveyed):
    truth, _ = scene
    res = surveyed
    assert set(res.poses3d) == set(truth) and not res.unplaced
    for m, (d, a) in errors(res.poses3d, truth).items():
        assert d < 1.5 and a < 0.3, f"marker {m}: {d:.2f} mm, {a:.2f} deg"
    cam = res.cameras[0]
    assert abs(cam.f / 1100 - 1) < 0.003 and abs(cam.k1) < 0.003 and not cam.fixed
    assert res.rms_px < 0.4 and res.rejected == 0
    assert res.status[0] == "origin" and all(res.status[m] == "surveyed" for m in truth if m)
    assert res.plane == {"markers": BASE, "fallback": False}
    # the levels: the board, the raised level, the ramp and the wall
    by_markers = {tuple(lv["markers"]): lv for lv in res.levels}
    assert abs(by_markers[tuple(BASE)]["z_mm"]) < 0.3
    assert abs(by_markers[tuple(RAISED)]["z_mm"] - 60) < 0.3
    ramp, wall = by_markers[tuple(RAMP)], by_markers[(WALL,)]
    assert abs(ramp["tilt_deg"] - 6) < 0.3 and abs(abs(ramp["tilt_dir_deg"]) - 180) < 3
    assert abs(wall["tilt_deg"] - 90) < 0.5 and abs(wall["tilt_dir_deg"] + 90) < 1
    # uncertainties of the map as a whole: far from the origin, too, they match the errors
    assert all(0 < res.stats[m]["sigma_mm"] < 1.0 for m in truth if m)
    assert not any("Poorly determined" in w for w in res.warnings)
    # every frame has its camera: the layout's points project onto the detections
    f = next(f for f in res.frames if f.R is not None and len(f.markers) >= 4)
    for m, c in f.markers.items():
        uv = cam.project(s3.corners_world(res.poses3d[m], 30.0) @ f.R.T + f.t)
        assert np.max(np.hypot(*(uv - c).T)) < 1.5


def test_lens_distortion_and_a_wrong_detection():
    truth, frames = level_scene(seed=5, count=100, k1=-0.06)
    wrong = next(f for f in frames if len(f.markers) >= 4)
    m = sorted(wrong.markers)[1]
    wrong.markers[m] = wrong.markers[m] + [20.0, -12.0]
    res = s3.survey3d(frames, source(), 30.0, origin=0)
    assert abs(res.cameras[0].k1 + 0.06) < 0.005 and abs(res.cameras[0].f / 1100 - 1) < 0.003
    assert res.rejected >= 1
    for m, (d, a) in errors(res.poses3d, truth).items():
        assert d < 1.5 and a < 0.4, f"marker {m}: {d:.2f} mm, {a:.2f} deg"


def test_layout_plane_from_many_markers_not_from_the_origin_sticker():
    """A bent origin sticker (tilted 1 degree) must not tilt the map: z = 0 is the plane that the
    board's markers share with it (1 degree would be 17 mm in height 1 m away)."""
    truth, frames = level_scene(seed=7, count=100, origin_tilt_deg=1.0)
    res = s3.survey3d(frames, source(), 30.0, origin=0)
    assert res.plane["markers"] == BASE and not res.plane["fallback"]
    for m in BASE[1:]:
        assert abs(res.poses3d[m][1][2]) < 0.5, f"marker {m}"
    for m in RAISED:
        assert abs(res.poses3d[m][1][2] - 60) < 0.5, f"marker {m}"
    assert abs(math.degrees(s3.pose6(*res.poses3d[0])[4]) - 1.0) < 0.3, "the origin sticker itself is tilted"


def test_too_few_markers_on_the_origin_plane_are_reported():
    truth, frames = level_scene(seed=8, count=100)
    keep = {0, 1} | set(RAISED) | set(RAMP)
    for f in frames:
        f.markers = {m: c for m, c in f.markers.items() if m in keep}
    res = s3.survey3d(frames, source(), 30.0, origin=0)
    assert res.plane["fallback"] and any("Fewer than three markers lie on one plane" in w for w in res.warnings)


def test_layout_poses_are_kept_and_moved_markers_measured_again(scene):
    truth, frames = scene
    fixed = {m: (truth[m][0].copy(), truth[m][1].copy()) for m in range(6)}
    fixed[3] = (fixed[3][0], fixed[3][1] + [20.0, 0, 0])  # moved since the layout was made
    res = s3.survey3d(copy.deepcopy(frames), source(), 30.0, fixed=fixed, origin=0)
    assert res.status[3] == "moved" and res.layout_check["deviation_mm"][3] > 15
    assert [res.status[m] for m in (0, 1, 2, 4, 5)] == ["origin", "fixed", "fixed", "fixed", "fixed"]
    for m in (0, 1, 2, 4, 5):
        assert np.allclose(res.poses3d[m][1], truth[m][1]) and np.allclose(res.poses3d[m][0], truth[m][0])
    assert any("moved" in w for w in res.warnings)
    assert all(d < 1.5 for d, _ in errors(res.poses3d, truth).values())
    # --refine-fixed: the layout's poses become measurements of their own
    res = s3.survey3d(copy.deepcopy(frames), source(), 30.0, fixed=fixed, origin=0, refine_fixed=True)
    assert res.status[1] == "refined" and res.status[0] == "origin"


def test_distances_scale_the_map_and_heights_are_checked(scene):
    truth, frames = scene
    d07 = float(np.linalg.norm(truth[7][1]))
    res = s3.survey3d(copy.deepcopy(frames), source(), 31.0, origin=0, distances=[(0, 7, d07)])
    assert res.distances["applied"] and abs(res.distances["scale"] - 30 / 31) < 0.003
    assert all(d < 2.0 for d, _ in errors(res.poses3d, truth).values())
    f = next(f for f in res.frames if f.R is not None)
    m = next(iter(f.used))
    uv = res.cameras[f.group].project(s3.corners_world(res.poses3d[m], 31.0 * res.distances["scale"]) @ f.R.T + f.t)
    assert np.max(np.hypot(*(uv - f.markers[m]).T)) < 1.5, "the cameras follow the scale"
    heights = [(12, 60.0), (16, 50 * math.tan(math.radians(6)))]
    res = s3.survey3d(copy.deepcopy(frames), source(), 30.0, origin=0, heights=heights + [(13, 65.0)])
    rows = {r["marker"]: r for r in res.heights["markers"]}
    assert abs(rows[12]["surveyed_mm"] - 60) < 0.5 and abs(rows[16]["surveyed_mm"] - 5.3) < 0.5
    text = " ".join(res.warnings)
    assert "heights differ: marker 13 -5." in text and "marker 12" not in text


def test_a_marker_seen_in_one_frame_is_not_guessed(scene):
    """One view cannot tell a small marker's two possible tilts apart: the marker is left out, with
    a reason that says what to film."""
    _, frames = scene
    frames = copy.deepcopy(frames)
    f = max(frames, key=lambda f: len(f.markers))
    c = f.markers[sorted(f.markers)[0]]
    f.markers[30] = c + [60.0, 0.0]
    res = s3.survey3d(frames, source(), 30.0, origin=0)
    assert 30 not in res.poses3d
    assert "two possible tilts" in res.unplaced[30] and "from more directions" in res.unplaced[30]


# ---------------------------------------------------------------------------------- rendered scene

LEVEL_KS = list(range(0, 180, 3))
BOARD = [-120.0, -170.0, 720.0, 370.0]


@pytest.fixture(scope="module")
def level_textures():
    return syn.level_textures()


@pytest.fixture(scope="module")
def level_video(tmp_path_factory, level_textures):
    """Two orbits around the scene with levels as an MJPEG video, and its detections."""
    path = str(tmp_path_factory.mktemp("levels") / "orbit.avi")
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 15, syn.LEVEL_IMAGE_SIZE)
    assert writer.isOpened()
    for k in LEVEL_KS:
        writer.write(syn.render_levels(level_textures, k))
    writer.release()
    sources = sv.open_sources([path])
    return sources, sv.detect_frames(sources, sv.SurveyDetector(syn.DICTIONARY), every=1)


@pytest.fixture(scope="module")
def level_surveyed(level_video):
    sources, frames = level_video
    return sources, s3.survey3d(copy.deepcopy(frames), sources, syn.MARKER_SIZE_MM, origin=0)


def test_survey_of_the_rendered_scene_with_levels(level_surveyed):
    _, res = level_surveyed
    truth = syn.level_marker_poses()
    assert set(res.poses3d) == set(truth)
    for m, (d, a) in errors(res.poses3d, truth).items():
        assert d < 2.5 and a < 0.8, f"marker {m}: {d:.2f} mm, {a:.2f} deg"
    ids = sorted(truth)
    s, R, t = s3.similarity_fit_3d([res.poses3d[m][1] for m in ids], [truth[m][1] for m in ids])
    assert abs(s - 1) < 0.004, "the scale: as the 2D survey, from the markers' size"
    assert max(np.linalg.norm(s * R @ res.poses3d[m][1] + t - truth[m][1]) for m in ids) < 0.6, "the shape"
    assert abs(res.cameras[0].f / syn.LEVEL_F - 1) < 0.005
    pose = {m: s3.pose6(*res.poses3d[m]) for m in ids}
    for m in (8, 9, 10):
        assert abs(pose[m][3] - syn.LEVEL_HEIGHT_MM) < 0.6, f"marker {m} on the raised level"
    for m in (11, 12):
        assert abs(math.degrees(pose[m][4] - syn.RAMP_SLOPE)) < 0.4, f"marker {m} on the ramp"
    assert abs(math.degrees(pose[13][4]) - 90) < 1 and abs(math.degrees(pose[13][5]) + 90) < 1, "on the wall"
    assert len(res.levels) == 4


def test_orthophoto_with_levels_shows_every_level_at_its_place(level_video, level_surveyed, level_textures):
    """Raised parts appear where they are seen from straight above: their markers are found in the
    orthophoto at their surveyed (x, y) (a plane at z = 0 would shift them by tens of millimetres)."""
    sources, res = level_surveyed
    ortho = s3.orthophoto3d(res, sources, bounds=BOARD, mm_per_px=2.0, size_of=size_of)
    assert ortho.image.shape[:2] == (270, 420) and ortho.coverage > 0.98
    ref = syn.level_top_view(level_textures, BOARD, 2.0)
    diff = np.abs(ortho.image.astype(int) - ref.astype(int)).mean(2)
    assert diff.mean() < 10
    big = cv2.resize(ortho.image, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)  # 1 mm per pixel
    found = sv.SurveyDetector(syn.DICTIONARY).detect(big)  # markers are 15 px small: most are found
    assert len({8, 9, 10, 11, 12} & set(found)) >= 4 and len(found) >= 9
    for m in found:
        c = found[m].mean(0)
        x, y = BOARD[0] + c[0] + 0.5, BOARD[3] - c[1] - 0.5
        assert math.hypot(x - res.poses3d[m][1][0], y - res.poses3d[m][1][1]) < 2.5, f"marker {m}"
    # the check image labels markers off the layout plane with their height
    img = s3.check_image3d(ortho, None, res, size_of)
    assert img.shape == ortho.image.shape


@pytest.fixture(scope="module")
def level_stills(tmp_path_factory, level_textures):
    """Ten photos of the scene with levels (a glob pattern for the command line)."""
    folder = tmp_path_factory.mktemp("level-stills")
    for k in (0, 9, 18, 27, 36, 45, 54, 63, 72, 81):
        img = syn.render_levels(level_textures, k)
        cv2.imwrite(str(folder / f"photo_{k:03d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return str(folder / "photo_*.jpg")


def test_command_line_3d_end_to_end(tmp_path, level_stills, capsys):
    out, report, ortho, check = (tmp_path / n for n in ("layout.json", "report.json", "ortho.jpg", "check.jpg"))
    args = [level_stills, "--3d", "-o", str(out), "--report", str(report), "--height", "8", "50"]
    args += ["--ortho", str(ortho), "--ortho-bounds", *map(str, BOARD), "--ortho-max", "300", "--check", str(check)]
    assert sv.main([*args, "-q"]) == 0
    printed = capsys.readouterr().out
    assert "Levels:" in printed and "Camera of photo_000.jpg" in printed and "z mm" in printed
    layout = json.loads(out.read_text())
    poses = layout["markers"]["poses"]
    assert sorted(poses, key=int) == [str(m) for m in range(14)] and all(len(p) == 6 for p in poses.values())
    truth = syn.level_marker_poses()
    for m, p in poses.items():
        R, t = s3.from_pose6([p[0], p[1], math.radians(p[2]), p[3], math.radians(p[4]), math.radians(p[5])])
        assert np.linalg.norm(t - truth[int(m)][1]) < 4, f"marker {m}"
    assert poses["8"][3] == pytest.approx(50, abs=1) and poses["13"][4] == pytest.approx(90, abs=2)
    assert poses["0"][:4] == [0.0, 0.0, 0.0, 0.0]
    rep = json.loads(report.read_text())
    assert rep["settings"]["mode"] == "3d" and len(rep["cameras"]) == 1 and len(rep["cameras"][0]["inputs"]) == 10
    assert rep["heights"]["markers"][0]["marker"] == 8 and len(rep["levels"]) == 4
    assert rep["layout_plane"]["markers"] == list(range(8))
    assert rep["markers"]["8"]["level"] is not None and "sigma_z_mm" in rep["markers"]["8"]
    assert cv2.imread(str(ortho)) is not None and cv2.imread(str(check)) is not None
    # the 3D layout as input: 3D without --3d, its poses kept
    again = tmp_path / "again.json"
    assert sv.main([level_stills, "--layout", str(out), "-o", str(again), "-q"]) == 0
    rep2 = json.loads(again.read_text())["markers"]
    assert rep2["poses"] == poses


def test_command_line_3d_errors(tmp_path, level_stills):
    layout = tmp_path / "in.json"
    for pose in ([1, 2, 3, 4], [1, 2, 3, 4, 5, "x"], [1, 2, 3, 4, 5, float("nan")]):
        layout.write_text(json.dumps({"format": "arail-layout/1", "markers": {"poses": {"0": pose}}}))
        with pytest.raises(SystemExit, match=r"markers.poses.0 must be .* \[x_mm, y_mm, rotation_deg, z_mm"):
            sv.main([level_stills, "--layout", str(layout), "-o", str(tmp_path / "o.json"), "-q"])
    with pytest.raises(SystemExit, match="--height checks heights: it needs the 3D survey"):
        sv.main([level_stills, "--height", "8", "50", "-o", str(tmp_path / "o.json"), "-q"])


def test_command_line_3d_with_a_calibration(tmp_path, level_stills):
    """With --calibration the camera is fixed (and named so); the poses agree with the estimated one."""
    cal = tmp_path / "camera.json"
    K = syn.LEVEL_K.tolist()
    cal.write_text(
        json.dumps(
            {
                "format": "arail-camera/1",
                "image_size": list(syn.LEVEL_IMAGE_SIZE),
                "camera_matrix": K,
                "distortion": [0, 0, 0, 0, 0],
            }
        )
    )
    out, report = tmp_path / "layout.json", tmp_path / "report.json"
    assert (
        sv.main([level_stills, "--3d", "--calibration", str(cal), "-o", str(out), "--report", str(report), "-q"]) == 0
    )
    cams = json.loads(report.read_text())["cameras"]
    assert cams[0]["calibrated"] is True and cams[0]["focal_px"] == syn.LEVEL_F and cams[0]["sigma_focal_px"] is None
    truth = syn.level_marker_poses()
    for m, p in json.loads(out.read_text())["markers"]["poses"].items():
        assert math.dist(p[:2] + p[3:4], truth[int(m)][1]) < 4, f"marker {m}"
