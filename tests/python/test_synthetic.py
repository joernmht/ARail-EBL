"""The synthetic test scene renders detectable markers at the documented positions."""

import numpy as np
import pytest

pytest.importorskip("cv2")
from arail_tools import synthetic as syn  # noqa: E402
from arail_tools.aruco import MarkerDetector  # noqa: E402


@pytest.fixture(scope="module")
def texture():
    return syn.texture()


def test_all_markers_detected_at_their_true_positions(texture):
    img, Hw = syn.render(texture, 12)
    found = MarkerDetector("DICT_ARUCO_ORIGINAL").detect(img)
    assert {0, 1, 2, 3} <= set(found), "all platform markers"
    assert len(found) >= 6, "the small far corner markers may be missed occasionally"
    H = syn.layout_homography(Hw)
    for mid, (x, y, _) in syn.marker_poses_layout().items():
        if mid not in found:
            continue
        p = H @ [x, y, 1]
        centre = found[mid].mean(0)
        assert np.hypot(*(centre - p[:2] / p[2])) < 1.0, f"marker {mid}"


def test_hidden_markers_are_not_detected(texture):
    img, _ = syn.render(texture, 70, syn.hidden_markers(70))
    found = MarkerDetector("DICT_ARUCO_ORIGINAL").detect(img)
    assert 1 not in found
    assert 0 in found


def test_automatic_dictionary_detection():
    tex = syn.texture("DICT_4X4_50")
    det = MarkerDetector(None)
    for k in range(3):
        det.detect(syn.render(tex, k)[0])
    assert det.name == "DICT_4X4_50"


def test_scene_with_levels_renders_markers_at_their_true_poses():
    """The raised level, the ramp and the wall are drawn where level_marker_poses says (the 3D
    survey tests rely on it)."""
    tex = syn.level_textures()
    poses = syn.level_marker_poses()
    det = MarkerDetector("DICT_ARUCO_ORIGINAL")
    seen = set()
    for k in (0, 20, 45, 70):
        img = syn.render_levels(tex, k)
        R, t = syn.level_camera(k)
        for mid, c in det.detect(img).items():
            _, tm = poses[mid]
            p = syn.LEVEL_K @ (R @ tm + t)
            assert np.hypot(*(c.mean(0) - p[:2] / p[2])) < 1.0, f"marker {mid} in frame {k}"
            seen.add(mid)
    assert {8, 9, 10, 11, 12, 13} <= seen, "markers on every level"
