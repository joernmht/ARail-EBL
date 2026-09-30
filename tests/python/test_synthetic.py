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
