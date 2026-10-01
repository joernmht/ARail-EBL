"""Lab survey (arail-survey): marker map, layout poses, orthophoto and command line.

The synthetic scene (arail_tools.synthetic) has known marker poses and a known texture; its camera
path covers markers with a "hand" now and then. The real lab photo checks the layout file."""

import copy
import json
import math
import os

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
from arail_tools import survey as sv  # noqa: E402
from arail_tools import synthetic as syn  # noqa: E402
from arail_tools.aruco import MarkerDetector, marker_corners_mm  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TRUE = {m: np.array([x, y, math.radians(r)]) for m, (x, y, r) in syn.marker_poses_layout().items()}
# the synthetic board in the layout frame (x right, y up, origin at marker 0)
BOARD = [-130.0, -320.0, 670.0, 180.0]
KS = list(range(0, 160, 2))  # every 2nd frame of the camera path, as `--every 2` on a 30 fps video


def size_of(_m):
    return syn.MARKER_SIZE_MM


def true_corners(H, m):
    return sv.apply_h(H, sv.pose_apply(TRUE[m], marker_corners_mm(syn.MARKER_SIZE_MM)))


def errors(poses, truth=TRUE):
    """Position (mm) and rotation (deg) errors per marker."""
    out = {}
    for m, p in poses.items():
        t = truth[m]
        out[m] = (float(np.hypot(*(p[:2] - t[:2]))), abs(math.degrees(float(sv.wrap_angle(p[2] - t[2])))))
    return out


@pytest.fixture(scope="module")
def texture():
    return syn.texture()


@pytest.fixture(scope="module")
def video(tmp_path_factory, texture):
    """The camera path as an MJPEG video (with occlusions) and its detections."""
    path = str(tmp_path_factory.mktemp("survey") / "path.avi")
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 15, syn.IMAGE_SIZE)
    assert writer.isOpened()
    for k in KS:
        writer.write(syn.render(texture, k, syn.hidden_markers(k))[0])
    writer.release()
    sources = sv.open_sources([path])
    frames = sv.detect_frames(sources, sv.SurveyDetector(syn.DICTIONARY), every=1)
    return sources, frames


@pytest.fixture(scope="module")
def surveyed(video):
    sources, frames = video
    return sources, sv.survey(copy.deepcopy(frames), syn.MARKER_SIZE_MM, origin=0)


def test_refined_corners_are_unbiased(texture):
    """OpenCV's sub-pixel corners lie about half a pixel inside the square (with OpenCV 4.x/5.0; the
    whole map would come out a few per cent too large); the edge-based refinement does not."""
    plain, refined = MarkerDetector(syn.DICTIONARY), sv.SurveyDetector(syn.DICTIONARY)
    inward, error, count = [], [], 0
    for k in (0, 30, 100, 150):
        img, Hw = syn.render(texture, k)
        H = syn.layout_homography(Hw)
        grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        count += len(plain.detect(grey))
        for m, c in refined.detect(grey).items():
            t = true_corners(H, m)
            towards_centre = (t.mean(0) - t) / np.linalg.norm(t.mean(0) - t, axis=1, keepdims=True)
            inward += list(np.sum((c - t) * towards_centre, 1))
            error += list(np.hypot(*(c - t).T))
    assert abs(np.mean(inward)) < 0.08
    assert np.mean(error) < 0.45
    assert len(error) == 4 * count, "the refinement loses no marker"


def exact_scene(seed=3, count=60, noise=0.2, markers=9):
    """Pure geometry: marker 0 at the origin and random others, seen by a moving pinhole camera
    (1280 x 720), corners with Gaussian noise (px). Returns (true poses, frames)."""
    rng = np.random.default_rng(seed)
    poses = {0: np.zeros(3)}
    for m in range(1, markers):
        poses[m] = np.array([rng.uniform(-300, 900), rng.uniform(-300, 600), rng.uniform(-math.pi, math.pi)])
    frames = []
    for k in range(count):
        target = np.array([rng.uniform(-200, 800), rng.uniform(-200, 500), 0.0])
        cam = target + np.array([rng.uniform(-300, 300), rng.uniform(-700, -400), rng.uniform(500, 800)])
        f = target - cam
        f /= np.linalg.norm(f)
        x = np.cross(f, [0, 0, 1.0])
        x /= np.linalg.norm(x)
        R = np.array([x, np.cross(f, x), f])
        K = np.array([[1100.0, 0, 640], [0, 1100, 360], [0, 0, 1]])
        H = K @ np.column_stack([R[:, 0], R[:, 1], -R @ cam])
        found = {}
        for m, p in poses.items():
            c = sv.apply_h(H, sv.pose_apply(p, marker_corners_mm(30)))
            if c.min() > 0 and c[:, 0].max() < 1280 and c[:, 1].max() < 720:
                found[m] = c + rng.normal(0, noise, c.shape)
        frames.append(sv.Frame(0, k, k / 30, (1280, 720), found))
    return poses, frames


def test_adjustment_with_exact_geometry_and_a_wrong_detection():
    """Homographies of a moving camera, corners with 0.2 px noise and one wrong detection, which is
    rejected."""
    poses, frames = exact_scene()
    wrong = next(f for f in frames if len(f.markers) >= 4)
    m = sorted(wrong.markers)[1]
    wrong.markers[m] = wrong.markers[m] + [25.0, -10.0]
    res = sv.survey(frames, 30.0, origin=0)
    assert set(res.poses) == set(poses)
    for m, (d, a) in errors(res.poses, poses).items():
        assert d < 1.0 and a < 0.3, f"marker {m}: {d:.2f} mm, {a:.2f} deg"
    assert res.rejected >= 1
    assert res.rms_px < 0.4


@pytest.mark.parametrize("count, noise", [(20, 0.5), (60, 0.2)])
def test_layout_poses_as_priors_weigh_like_independent_measurements(count, noise):
    """--refine-fixed: a layout pose is a measurement of its own (2 mm, 0.5 deg). Combined with the
    images it must give the precision-weighted mean of the image-only estimate and the prior, with
    the combined covariance, whatever the pixel noise (the corner residuals are in px, the prior in
    sigmas: unscaled, a 2 mm prior acted like 0.4 mm at 0.2 px noise)."""
    _, frames = exact_scene(seed=5, count=count, noise=noise)
    free, free_poses, _ = sv._adjust(copy.deepcopy(frames), {0: np.zeros(3)}, size_of)
    C_free = free.covariance()[1]
    sigma = np.array([2.0, 2.0, math.radians(0.5)])
    prior = free_poses[1] + [1.5, -1.0, math.radians(0.3)]
    adj, poses, _ = sv._adjust(copy.deepcopy(frames), {0: np.zeros(3), 1: prior}, size_of, priors={1: (prior, sigma)})
    P = np.diag(1 / sigma**2)
    expected = np.linalg.inv(np.linalg.inv(C_free) + P)
    sd, sd_expected = np.sqrt(np.diag(adj.covariance()[1])), np.sqrt(np.diag(expected))
    assert np.allclose(sd, sd_expected, rtol=0.05), (sd, sd_expected)
    shift, shift_expected = poses[1] - free_poses[1], expected @ P @ (prior - free_poses[1])
    assert np.hypot(*(shift - shift_expected)[:2]) < 0.05 * np.hypot(*shift_expected[:2]) + 0.01, (
        shift,
        shift_expected,
    )


def test_survey_of_the_synthetic_video(surveyed):
    _, res = surveyed
    assert set(res.poses) == set(TRUE)
    assert res.status[0] == "origin" and all(res.status[m] == "surveyed" for m in range(1, 8))
    for m, (d, a) in errors(res.poses).items():
        assert d < 2.0 and a < 0.5, f"marker {m}: {d:.2f} mm, {a:.2f} deg"
    # the shape and scale of the map, independent of the origin marker's own orientation
    ids = sorted(res.poses)
    s, _, _ = sv.similarity_fit([res.poses[m][:2] for m in ids], [TRUE[m][:2] for m in ids])
    assert abs(s - 1) < 0.003
    assert res.rms_px < 1.0
    # occlusions: marker 1 is hidden for a while, markers 2 and 3 later
    assert res.stats[1]["frames"] < res.stats[0]["frames"] and res.stats[2]["frames"] < res.stats[6]["frames"]
    assert all(0 < res.stats[m]["sigma_mm"] < 2 for m in range(1, 8))
    used = [f for f in res.frames if f.H is not None]
    assert len(used) == len(KS)
    # the frames' homographies map the true corners onto the detections
    f = used[10]
    for m, c in f.markers.items():
        assert np.max(np.hypot(*(sv.apply_h(f.H, sv.pose_apply(res.poses[m], marker_corners_mm(30))) - c).T)) < 2.5


def test_layout_poses_are_kept_and_moved_markers_measured_again(video):
    _, frames = video
    layout = {m: TRUE[m].copy() for m in (0, 1, 2, 3)}
    layout[3][:2] += [25.0, 0.0]  # marker 3 was moved since the layout was made
    res = sv.survey(copy.deepcopy(frames), syn.MARKER_SIZE_MM, fixed=layout, origin=0)
    assert res.status[3] == "moved"
    assert [res.status[m] for m in (0, 1, 2)] == ["origin", "fixed", "fixed"]
    for m in (0, 1, 2):
        assert np.allclose(res.poses[m], layout[m])
    assert any("moved" in w for w in res.warnings)
    err = errors(res.poses)
    assert err[3][0] < 2.0
    assert all(err[m][0] < 2.5 for m in (4, 5, 6, 7))
    assert res.layout_check["deviation_mm"][3] > 20


def test_measured_distance_sets_the_scale(video):
    _, frames = video
    wrong = sv.survey(copy.deepcopy(frames), 31.0, origin=0)  # the size setting is 1 mm off
    assert float(np.hypot(*wrong.poses[1][:2])) > 450
    res = sv.survey(copy.deepcopy(frames), 31.0, origin=0, distances=[(0, 1, 440.0), (6, 7, 720.0)])
    assert res.distances["applied"] and abs(res.distances["scale"] - 30 / 31) < 0.003
    assert any("scaled the marker map" in w for w in res.warnings)
    assert all(d < 2.5 for d, _ in errors(res.poses).values())
    f = next(f for f in res.frames if f.H is not None)
    m = next(iter(f.markers))
    c = sv.apply_h(f.H, sv.pose_apply(res.poses[m], marker_corners_mm(31.0 * res.distances["scale"])))
    assert np.max(np.hypot(*(c - f.markers[m]).T)) < 2.5, "homographies follow the scale"


def test_disconnected_rare_and_unseen_markers_are_reported(video):
    _, frames = video
    frames = copy.deepcopy(frames)
    square = np.array([[100, 100], [140, 100], [140, 140], [100, 140]], float)
    frames.append(sv.Frame(0, 900, 60.0, (1280, 720), {9: square}))  # alone
    frames.append(sv.Frame(0, 901, 60.1, (1280, 720), {10: square, 11: square + [300, 0]}))  # a pair of its own
    misread = copy.deepcopy(next(f for f in frames if 4 in f.markers))
    misread.markers[20] = misread.markers.pop(4)  # marker 4 decoded as 20 once
    frames.append(misread)
    res = sv.survey(frames, 30.0, fixed={0: np.zeros(3), 12: np.array([50.0, 50.0, 0.0])}, origin=0)
    assert res.unplaced[9] == "never seen together with another marker"
    assert "11" in res.unplaced[10]
    assert res.unplaced[20].startswith("lies on marker 4: a misread ID") and 20 not in res.poses
    assert res.status[12] == "fixed" and res.stats[12]["frames"] == 0  # known, not seen: kept
    text = " ".join(res.warnings)
    assert "kept as in the layout (not checked): 12." in text
    assert "Marker 9 could not be placed" in text and "Marker 10 could not be placed" in text
    assert sv._misreads({4: np.zeros(3), 20: np.array([3.0, 2, 0])}, {4: 40, 20: 1}, size_of) == {20: 4}


def test_orthophoto_matches_the_texture(surveyed, texture):
    sources, res = surveyed
    ortho = sv.orthophoto(res, sources, bounds=BOARD, mm_per_px=1.0, size_of=size_of)
    assert ortho.bounds == BOARD
    assert ortho.image.shape[:2] == (500, 800)
    assert ortho.coverage > 0.98
    # the texture (4 px per mm) in the same frame: pixel (u, v) <-> x = xmin + u + 0.5, y = ymax - v - 0.5
    A = np.array([[1.0, 0, BOARD[0] + 0.5], [0, -1.0, BOARD[3] - 0.5], [0, 0, 1]])
    M = np.diag([syn.PX_PER_MM, syn.PX_PER_MM, 1.0]) @ syn.BOARD_FROM_LAYOUT @ A
    ref = cv2.warpPerspective(
        cv2.GaussianBlur(texture, (0, 0), 2.0), M, (800, 500), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP
    )
    diff = np.abs(ortho.image.astype(int) - ref.astype(int)).mean(2)
    assert diff.mean() < 10
    # markers in the orthophoto lie where the survey put them
    found = sv.SurveyDetector(syn.DICTIONARY).detect(ortho.image)
    assert len(found) >= 7
    for m, c in found.items():
        x, y = BOARD[0] + c.mean(0)[0] + 0.5, BOARD[3] - c.mean(0)[1] - 0.5
        assert math.hypot(x - res.poses[m][0], y - res.poses[m][1]) < 1.5, f"marker {m}"
    # the "hand" that covers markers 1, 2 and 3 in some frames is left out
    covered = {
        v.frame.index: sorted(m for m in TRUE if any(np.hypot(*(TRUE[m][:2] - c[:2])) < 5 for c in v.covered))
        for v in sv._ortho_views(res, sources, (), size_of)
    }
    for i, k in enumerate(KS):
        assert set(syn.hidden_markers(k)) <= set(covered[i]), f"frame {k}"
    for m in (1, 2, 3):
        u, v = ortho.to_px([TRUE[m][:2]])[0].astype(int)
        assert diff[v - 45 : v + 45, u - 45 : u + 45].mean() < 15, f"around marker {m}"


def test_orthophoto_bounds_resolution_and_masks(surveyed):
    sources, res = surveyed
    auto = sv.orthophoto(res, sources, mm_per_px=2.0, size_of=size_of)
    b = auto.bounds
    assert b[0] < -100 and b[1] < -250 and b[2] > 640 and b[3] > 150, "the board is seen"
    assert max(auto.image.shape[:2]) <= 2000
    assert auto.mm_per_px == 2.0 and auto.image.shape[1] == round((b[2] - b[0]) / 2)
    small = sv.orthophoto(res, sources, bounds=[None, -320, None, None], max_side=300, size_of=size_of)
    assert max(small.image.shape[:2]) <= 300 and small.bounds[1] == -320
    assert small.mm_per_px > 1
    # the whole image masked: nothing left to compose
    with pytest.raises(sv.SurveyError):
        sv.orthophoto(res, sources, masks=[[0, 0, 1, 1]], size_of=size_of)


def test_static_overlay_detection():
    rng = np.random.default_rng(0)
    frames = 100
    edges = rng.binomial(frames, 0.15, (270, 480)).astype(np.float32)  # a moving scene: now and then an edge
    edges[230:250, 340:460] = frames  # a watermark: always
    mask = sv.detect_overlay(edges, frames)
    assert mask is not None and mask[240, 400] == 1 and mask[100, 100] == 0
    assert mask.mean() < 0.05
    still = edges.copy()
    still[50:60, :] = 0.7 * frames  # long edges that stay: a camera that hardly moved
    assert sv.detect_overlay(still, frames) is None
    assert sv.detect_overlay(edges, 10) is None


def test_marker_type_names():
    assert sv.opencv_dictionary("ARUCO") == "DICT_ARUCO_ORIGINAL"
    assert sv.opencv_dictionary("ARUCO_4X4_1000", 50) == "DICT_4X4_50"
    assert sv.opencv_dictionary("ARUCO_5X5_1000", 200) == "DICT_5X5_250"
    assert sv.opencv_dictionary("APRILTAG_36h11") == "DICT_APRILTAG_36h11"
    assert sv.opencv_dictionary("auto") is None and sv.opencv_dictionary("DICT_6X6_50") == "DICT_6X6_50"
    assert sv.app_dictionary("DICT_4X4_250") == "ARUCO_4X4_1000"
    assert sv.app_dictionary("DICT_ARUCO_ORIGINAL") == "ARUCO"
    with pytest.raises(sv.SurveyError):
        sv.opencv_dictionary("QR")


def test_platform_outline_like_the_app():
    poses = {0: np.zeros(3), 1: np.array([400.0, 0, 0])}
    c = sv.platform_outline({"between": [0, 1], "width_mm": 40, "offset_mm": 10, "extend_mm": 5}, poses)
    assert np.allclose(c, [[-5, -10], [405, -10], [405, 30], [-5, 30]])
    c = sv.platform_outline({"from": {"marker": 1, "offset": [0, 100]}, "to": [0, 100]}, poses)
    assert np.allclose(c[0], [400, 125]) and np.allclose(c[2], [0, 75])
    assert sv.platform_outline({"between": [0, 7]}, poses) is None


def test_lab_photo_agrees_with_the_layout_file():
    """The marker map of the EBL layout file, measured freely again from the lab photo."""
    photo = os.path.join(ROOT, "examples", "media", "ebl-lab-photo.jpg")
    if not os.path.exists(photo):
        pytest.skip("lab photo not present")
    with open(os.path.join(ROOT, "web", "layouts", "ebl-lab.json")) as f:
        layout = json.load(f)
    fixed = {int(k): np.array([v[0], v[1], math.radians(v[2])]) for k, v in layout["markers"]["poses"].items()}
    frames = sv.detect_frames(sv.open_sources([photo]), sv.SurveyDetector("DICT_ARUCO_ORIGINAL"), 1)
    assert set(frames[0].markers) == {0, 1, 2, 3, 4}
    res = sv.survey(frames, 30.0, fixed=fixed, origin=0)
    check = res.layout_check
    assert check["markers"] == [0, 1, 2, 3, 4]
    assert abs(check["scale"] - 1) < 0.01
    assert max(check["deviation_mm"].values()) < 8
    assert not any(s == "moved" for s in res.status.values())


@pytest.fixture(scope="module")
def stills(tmp_path_factory, texture):
    """Six photos of the synthetic layout (a glob pattern for the command line)."""
    folder = tmp_path_factory.mktemp("stills")
    for k in (0, 20, 40, 64, 100, 140):
        cv2.imwrite(str(folder / f"frame_{k:03d}.jpg"), syn.render(texture, k)[0], [cv2.IMWRITE_JPEG_QUALITY, 92])
    return str(folder / "frame_*.jpg")


def test_command_line_end_to_end(tmp_path, stills, capsys):
    out, report, ortho, check = (tmp_path / n for n in ("layout.json", "report.json", "media/ortho.jpg", "check.jpg"))
    layout_in = os.path.join(ROOT, "web", "layouts", "synthetic-demo.json")
    args = [stills, "--layout", layout_in, "-o", str(out), "--report", str(report)]
    args += ["--ortho", str(ortho), "--ortho-bounds", *map(str, BOARD), "--ortho-max", "400", "--check", str(check)]
    assert sv.main([*args, "-q"]) == 0
    printed = capsys.readouterr().out
    assert '"ortho": {"image": "media/ortho.jpg"' in printed
    layout = json.loads(out.read_text())
    with open(layout_in) as f:
        original = json.load(f)
    assert layout["format"] == "arail-layout/1"
    assert layout["objects"] == original["objects"] and layout["scenarios"] == original["scenarios"]
    assert layout["view"]["image"] == original["view"]["image"]
    assert layout["view"]["ortho"]["image"] == "media/ortho.jpg"
    assert layout["view"]["ortho"]["bounds_mm"] == BOARD
    assert layout["markers"]["dictionary"] == "ARUCO" and layout["markers"]["origin"] == 0
    assert layout["markers"]["locked"] is True, "the app uses only the surveyed markers"
    assert json.dumps(layout["markers"]["size_mm"]) == "30", "written as in the input layout"
    assert "moving" not in layout["markers"]
    poses = layout["markers"]["poses"]
    assert sorted(poses, key=int) == [str(m) for m in range(8)]
    for m, (x, y, r) in poses.items():
        t = TRUE[int(m)]
        assert math.hypot(x - t[0], y - t[1]) < 4 and abs(r - math.degrees(t[2])) < 1
    rep = json.loads(report.read_text())
    assert rep["format"] == "arail-survey/1"
    assert rep["frames"]["analysed"] == 6 and rep["frames"]["used"] == 6
    assert set(rep["markers"]) == set(poses) and rep["markers"]["0"]["status"] == "origin"
    assert rep["ortho"]["bounds_mm"] == BOARD and max(rep["ortho"]["size"]) <= 400
    assert isinstance(rep["warnings"], list) and rep["rms_px"] < 1.5
    img = cv2.imread(str(ortho))
    assert img is not None and max(img.shape[:2]) <= 400
    assert cv2.imread(str(check)) is not None


def test_command_line_moving_markers_codes_and_resurvey(tmp_path, stills):
    """Moving markers (on vehicles) stay out of the map; IDs above the codes are reported, not
    silently dropped; markers lost in a --resurvey are named with the objects that use them;
    --unlocked leaves the map unlocked."""
    layout_in = tmp_path / "in.json"
    markers = {
        "codes": 5,
        "moving": [5],
        "origin": 0,
        "poses": {"0": [0, 0, 0], "5": [630, 140, 0], "9": [100, 500, 0]},
    }
    objects = [{"id": "p", "name": "Platform 9", "type": "platform", "between": [0, 9]}]
    layout_in.write_text(json.dumps({"format": "arail-layout/1", "markers": markers, "objects": objects}))
    out, report = tmp_path / "out.json", tmp_path / "report.json"
    assert (
        sv.main([stills, "--layout", str(layout_in), "--resurvey", "-o", str(out), "--report", str(report), "-q"]) == 0
    )
    m = json.loads(out.read_text())["markers"]
    assert sorted(m["poses"], key=int) == ["0", "1", "2", "3", "4"], "5 moves, 6 and 7 are above the codes, 9 unseen"
    assert m["moving"] == [5] and m["locked"] is True
    assert m["codes"] == 6, "the moving marker 5 is detected, too"
    rep = json.loads(report.read_text())
    assert set(rep["ignored_ids"]) == {"6", "7"} and rep["moving"]["5"] >= 5
    text = " ".join(rep["warnings"])
    assert "IDs above 5 were seen and ignored: 6" in text and "markers.codes" in text
    assert "left out: 9 (objects placed relative to them: Platform 9)" in text
    # unlocked; a pose for a marker that is a moving one now is dropped
    layout_in.write_text(json.dumps({"format": "arail-layout/1", "markers": markers | {"codes": 50}, "objects": []}))
    assert sv.main([stills, "--layout", str(layout_in), "--unlocked", "--moving", "5,7", "-o", str(out), "-q"]) == 0
    m = json.loads(out.read_text())["markers"]
    assert "locked" not in m and m["moving"] == [5, 7]
    assert "5" not in m["poses"] and "7" not in m["poses"] and "9" in m["poses"], "kept: not seen, still known"
    with pytest.raises(SystemExit, match="origin marker 0 is a moving marker"):
        sv.main([stills, "--moving", "0", "-o", str(out), "-q"])
    # objects placed relative to a moving marker could not be placed: refused (not silently dropped)
    unmoved = {"format": "arail-layout/1", "markers": markers | {"moving": []}, "objects": objects}
    layout_in.write_text(json.dumps(unmoved))
    with pytest.raises(SystemExit, match="Marker 9 is a moving marker .* placed relative to it: Platform 9"):
        sv.main([stills, "--layout", str(layout_in), "--moving", "9", "-o", str(out), "-q"])
    with pytest.raises(SystemExit) as exc:
        sv.main([stills, "--moving", "-1", "-o", str(out), "-q"])
    assert exc.value.code == 2, "a negative marker ID is refused by the argument parser"


def test_command_line_errors(tmp_path, texture):
    img = np.full((720, 1280, 3), 128, np.uint8)
    cv2.imwrite(str(tmp_path / "empty.jpg"), img)
    with pytest.raises(SystemExit, match="No markers were found"):
        sv.main([str(tmp_path / "empty.jpg"), "-o", str(tmp_path / "out.json"), "-q"])
    board = str(tmp_path / "board.jpg")
    cv2.imwrite(board, syn.render(texture, 12)[0])
    with pytest.raises(SystemExit, match="origin marker 9 was not seen"):
        sv.main([board, "--origin", "9", "-o", str(tmp_path / "out.json"), "-q"])
    with pytest.raises(SystemExit, match="Not found"):
        sv.main([str(tmp_path / "missing.mp4"), "-q"])
    # no orthophoto possible (all masked): the marker map is still written
    out, report = tmp_path / "masked.json", tmp_path / "report.json"
    args = [board, "--ortho", str(tmp_path / "o.jpg"), "--mask", "0,0,1,1", "-o", str(out), "--report", str(report)]
    assert sv.main([*args, "-q"]) == 0
    assert len(json.loads(out.read_text())["markers"]["poses"]) >= 6
    assert "view" not in json.loads(out.read_text())
    assert any(w.startswith("No orthophoto") for w in json.loads(report.read_text())["warnings"])
    with pytest.raises(SystemExit):
        sv.main([board, "--mask", "0.5,0,0.2,1"])  # x1 < x0
    # unreadable or invalid files and settings: a message, no traceback
    bad = tmp_path / "bad.json"
    bad.write_text("{ not json")
    poses = tmp_path / "poses.json"
    poses.write_text(json.dumps({"format": "arail-layout/1", "markers": {"poses": {"0": [0, 0, 0], "x": [1, 2, 3]}}}))
    cases = [
        (["--layout", str(tmp_path / "missing.json")], "Cannot read the layout"),
        (["--layout", str(bad)], "is not valid JSON"),
        (["--layout", str(poses)], "markers.poses.x must be"),
        (["--calibration", str(tmp_path / "missing.json")], "Cannot read the calibration"),
        (["--dictionary", "DICT_NOPE"], "Unknown OpenCV dictionary"),
        (["-o", os.path.join(board, "out.json")], "Cannot write"),
    ]
    for extra, message in cases:
        with pytest.raises(SystemExit, match=message):
            sv.main([board, "-o", str(tmp_path / "out.json"), *extra, "-q"])
    with pytest.raises(SystemExit, match="is a folder"):
        sv.main([str(tmp_path), "-q"])
    for option in ("--ortho-max", "--ortho-res", "--every", "--codes", "--size"):
        with pytest.raises(SystemExit) as exc:
            sv.main([board, option, "0", "-q"])
        assert exc.value.code == 2, f"{option} 0 is refused by the argument parser"
