"""Joining orthophotos (arail-mosaic): the frame found from features, seams, holes filled, the command."""

import json
import os

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
from arail_tools import mosaic as mo  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GREY = np.array(mo.GREY, np.uint8)
# the "table": 4000 x 1200 mm at 2 mm/px in the hall frame, origin at its lower left
TABLE = (0.0, 0.0, 4000.0, 1200.0)
MM = 2.0


def texture(seed=1):
    """A table with detail everywhere (features to match): smooth colour blobs and small squares."""
    rng = np.random.default_rng(seed)
    w, h = int(TABLE[2] / MM), int(TABLE[3] / MM)
    base = cv2.resize(rng.integers(40, 220, (12, 40, 3), dtype=np.uint8), (w, h), interpolation=cv2.INTER_CUBIC)
    for _ in range(900):
        x, y, s = int(rng.integers(0, w - 12)), int(rng.integers(0, h - 12)), int(rng.integers(3, 12))
        base[y : y + s, x : x + s] = rng.integers(0, 255, 3)
    return base


def cut(img, box_mm, hole=None):
    """A piece of the table (bounds in hall mm), the rest grey; a grey disc (hole: centre, radius mm)."""
    x0, y0, x1, y1 = box_mm
    piece = img[int((TABLE[3] - y1) / MM) : int((TABLE[3] - y0) / MM), int(x0 / MM) : int(x1 / MM)].copy()
    if hole:
        (cx, cy), r = hole
        cv2.circle(piece, (int((cx - x0) / MM), int((y1 - cy) / MM)), int(r / MM), mo.GREY, -1)
    return piece


def test_pieces_join_into_a_solid_orthophoto_in_the_layout_frame():
    img = texture()
    # two groups of the hall frame overlapping by 400 mm, one with a hole; a reference in another frame
    a = mo.Piece(
        "A", cut(img, (0, 0, 2400, 1200), hole=((1000, 600), 60)), mo.pixels_to_mm((0, 0, 2400, 1200), 1200, 600)
    )
    b = mo.Piece("B", cut(img, (2000, 0, 4000, 1200)), mo.pixels_to_mm((2000, 0, 4000, 1200), 1000, 600))
    hall_in_layout = mo.similarity(-1500.0, 40.0, 0.6)
    ref_img = cut(img, (500, 100, 3000, 1100))
    ref_hall = mo.pixels_to_mm((500, 100, 3000, 1100), ref_img.shape[1], ref_img.shape[0])
    reference = mo.Piece("ref", ref_img, hall_in_layout @ ref_hall)
    frame = mo.register(reference, [a, b])
    assert frame["inliers"] >= 30
    assert abs(frame["x"] + 1500) < 6 and abs(frame["y"] - 40) < 6 and abs(frame["deg"] - 0.6) < 0.2
    assert abs(frame["scale"] - 1) < 0.005
    image, bounds = mo.compose(
        [reference, a.moved(frame["matrix"]), b.moved(frame["matrix"])], mm_per_px=MM, close_mm=100
    )
    # the joined table: no grey inside, and the hole filled; grey only in the margin around it
    to_px = np.linalg.inv(mo.pixels_to_mm(bounds, image.shape[1], image.shape[0]))
    inner = np.array([[100, 100], [3900, 100], [3900, 1100], [100, 1100]], float)
    uv = (to_px @ hall_in_layout @ np.column_stack([inner, np.ones(4)]).T).T[:, :2].astype(np.int32)
    mask = np.zeros(image.shape[:2], np.uint8)
    cv2.fillPoly(mask, [uv], 1)
    grey = (np.abs(image.astype(int) - GREY.astype(int)).max(axis=2) <= 3) & (mask > 0)
    assert grey.sum() == 0
    # the picture is the table's: compared with the texture moved into the layout frame
    truth = cv2.warpAffine(
        img,
        (to_px @ hall_in_layout @ mo.pixels_to_mm(TABLE, img.shape[1], img.shape[0]))[:2],
        (image.shape[1], image.shape[0]),
    )
    diff = np.abs(image.astype(int) - truth.astype(int)).mean(axis=2)[mask > 0]
    assert np.median(diff) < 12
    # bounds: the table in the layout frame, with the margin
    corners = (hall_in_layout @ np.array([[0, 0, 1], [4000, 1200, 1], [0, 1200, 1], [4000, 0, 1]], float).T).T
    assert bounds[0] < corners[:, 0].min() and bounds[2] > corners[:, 0].max()
    assert bounds[1] < corners[:, 1].min() and bounds[3] > corners[:, 1].max()


def test_fill_in_is_smooth_and_keeps_what_is_known():
    img = np.zeros((64, 64, 3), np.uint8)
    img[:, :32] = (200, 0, 0)
    img[:, 32:] = (0, 0, 200)
    known = np.ones((64, 64), bool)
    known[20:44, 20:44] = False
    out = mo.fill_in(img, known)
    assert np.allclose(out[known], img[known], atol=1)
    row = out[32, 20:44, 0]
    assert row[0] > row[-1] and np.all(np.diff(row) <= 1)  # from the red side to the blue one, without steps back


def test_the_command_joins_the_linked_groups_of_the_photo_map(tmp_path):
    out = tmp_path / "linked.jpg"
    data = os.path.join(ROOT, "web/lab-map/data.json")
    ref = os.path.join(ROOT, "web/media/ebl-neustadt-ortho.jpg")
    args = mo.build_parser().parse_args(
        [
            data,
            "--reference",
            ref,
            "--bounds",
            "-2400",
            "-70",
            "3750",
            "650",
            "--out",
            str(out),
            "--res",
            "6",
            "--image",
            "x.jpg",
        ]
    )
    result = mo.run(args, lambda *a: None)
    assert result["groups"] == ["S01", "S02", "S03", "S04", "S10"]  # the linked ones (approx: false)
    assert (
        result["frame"]["rms_mm"] < 15 and abs(result["frame"]["deg"]) < 2 and abs(result["frame"]["scale"] - 1) < 0.03
    )
    # the layout's Bf Neustadt and Waldhof south beside it
    x0, _, x1, _ = result["ortho"]["bounds_mm"]
    assert x0 < -2400 and x1 > 10000
    assert result["ortho"]["image"] == "x.jpg" and cv2.imread(str(out)) is not None


def test_the_layout_uses_the_joined_orthophoto():
    with open(os.path.join(ROOT, "web/layouts/ebl-neustadt.json"), encoding="utf-8") as f:
        layout = json.load(f)
    o = layout["view"]["ortho"]
    assert o["image"] == "../media/ebl-neustadt-linked-ortho.jpg"
    img = cv2.imread(os.path.join(ROOT, "web/layouts", o["image"]))
    x0, y0, x1, y1 = o["bounds_mm"]
    assert abs((x1 - x0) / img.shape[1] - (y1 - y0) / img.shape[0]) < 0.01  # square pixels


def test_errors_are_explained(tmp_path):
    with pytest.raises(mo.MosaicError, match="not a photo map"):
        mo.load_groups({"format": "x"}, str(tmp_path))
    with pytest.raises(mo.MosaicError, match="no linked group"):
        mo.load_groups({"format": mo.FORMAT, "groups": {"S1": {"approx": True, "ortho": {}}}}, str(tmp_path))
    blank = mo.Piece("blank", np.full((100, 100, 3), 214, np.uint8), mo.pixels_to_mm((0, 0, 100, 100), 100, 100))
    with pytest.raises(mo.MosaicError):
        mo.register(blank, [blank])
