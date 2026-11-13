"""The camera bridge's printed parts (hardware/camera-bridge): solid, printable, clear of the trains, stable."""

import importlib.util
import itertools
import math
import sys
from pathlib import Path

import pytest

pytest.importorskip("manifold3d")

HERE = Path(__file__).resolve().parents[2] / "hardware" / "camera-bridge"
_spec = importlib.util.spec_from_file_location("camera_bridge", HERE / "camera_bridge.py")
cb = importlib.util.module_from_spec(_spec)
sys.modules["camera_bridge"] = cb
_spec.loader.exec_module(cb)

P = cb.Params()
BED = 180.0  # the smallest common print bed (180 x 180 x 180 mm)


def overlap(a, b) -> float:
    return (a ^ b).volume()


@pytest.fixture(scope="module")
def parts():
    return {part.name: part.build() for part in cb.parts_catalogue(P)}


def test_every_part_is_one_solid_on_the_bed_and_fits_a_small_printer(parts):
    for name, m in parts.items():
        assert m.status().name == "NoError", name
        assert not m.is_empty(), name
        assert len(m.decompose()) == 1, f"{name} falls apart into pieces"
        x0, y0, z0, x1, y1, z1 = m.bounding_box()
        assert z0 == pytest.approx(0.0, abs=1e-6), name
        assert max(x1 - x0, y1 - y0, z1 - z0) <= BED, name


def test_the_stl_files_are_the_generators_parts(parts):
    for part in cb.parts_catalogue(P):
        tris, _ = cb.read_stl(HERE / "stl" / f"{part.name}.stl")
        m = parts[part.name]
        assert cb.stl_volume(tris) == pytest.approx(m.volume(), rel=0.01), f"{part.name}: run --out stl"
        lo, hi = tris.reshape(-1, 3).min(axis=0), tris.reshape(-1, 3).max(axis=0)
        x0, y0, z0, x1, y1, z1 = m.bounding_box()
        assert lo == pytest.approx([x0, y0, z0], abs=0.05) and hi == pytest.approx([x1, y1, z1], abs=0.05), part.name


def test_trains_pass_under_and_between():
    # the girder: above the prototype's road bridges over the tracks (6.7 m) and the lab's double-deck coaches
    above_rail = P.clear_height - P.rail_top
    assert above_rail * cb.H0_SCALE / 1000 >= 6.7
    assert above_rail >= 4.63 / cb.H0_SCALE * 1000 + 20
    asm = cb.bridge_assembly(P)
    assert asm["girder"].bounding_box()[2] == pytest.approx(P.clear_height)
    # the columns with their camera housings, above the slab: at least 25 mm from the outer tracks' centres
    # (an H0 vehicle is at most 3.15 m wide: 18 mm on either side)
    above_foot = cb.box(-200, 200, -200, 200, P.foot_h + 1, 300)
    inner_a = (asm["column-a"] ^ above_foot).bounding_box()[4]
    inner_b = (asm["column-b"] ^ above_foot).bounding_box()[1]
    assert min(P.track_centres) - inner_a >= 25.0
    assert inner_b - max(P.track_centres) >= 25.0
    # the slabs at the table stay clear of the sleepers (15 mm from the centre) and the vehicles' steps
    low = cb.box(-200, 200, -200, 200, -1, P.foot_h)
    assert min(P.track_centres) - (asm["column-a"] ^ low).bounding_box()[4] >= 22.0


def test_the_lock_pin_gives_a_tilt_every_15_degrees():
    assert P.tilts == [-45.0, -30.0, -15.0, 0.0, 15.0, 30.0, 45.0]
    # a hole of the cradle, turned by its tilt, lies on the mast's hole of the same radius straight below the axis
    for r, a in P.lock_angles:
        t = math.radians(0.0 - a)
        y, z = r * math.sin(math.radians(a)), -r * math.cos(math.radians(a))
        y2, z2 = y * math.cos(t) - z * math.sin(t), y * math.sin(t) + z * math.cos(t)
        assert (y2, z2) == pytest.approx((0.0, -r), abs=1e-9)
        assert r in (P.lock_r1, P.lock_r2)
    # neighbouring holes leave a wall between them
    holes = [(r * math.sin(math.radians(a)), -r * math.cos(math.radians(a)), cb.M3_CLEAR) for r, a in P.lock_angles]
    for (ya, za, da), (yb, zb, db) in itertools.combinations(holes + [(0.0, 0.0, cb.M4_PIVOT)], 2):
        assert math.dist((ya, za), (yb, zb)) >= (da + db) / 2 + 0.8


def test_nothing_collides_at_any_tilt_with_the_narrowest_and_the_widest_phone():
    static = {
        "mast": cb.mast(P),
        "girder": cb.girder(P).translate((0, 0, -P.girder_h - P.deck_t)),
        "knob-mast": cb.knob(P).translate((0, 14.5, 6)),
    }
    table = cb.box(-300, 300, -300, 300, -20, 0)
    for w in (P.phone_w_min, P.phone_w_max):
        for t in P.tilts:
            moving = {k: v.translate((0, 0, P.mast_height)) for k, v in cb.cradle_set(P, w, t).items()}
            against_static = itertools.product(moving.items(), static.items())
            pairs = itertools.chain(against_static, itertools.combinations(moving.items(), 2))
            for (ka, a), (kb, b) in pairs:
                assert overlap(a, b) < 1e-3, f"bridge, phone {w} mm, tilt {t}: {ka} hits {kb}"
        for t in P.side_tilts:
            asm = cb.side_assembly(P, t, w)
            stand = asm.pop("side-stand")
            for k, v in asm.items():
                assert overlap(v, stand) < 1e-3, f"side stand, phone {w} mm, tilt {t}: {k} hits the stand"
                assert overlap(v, table) < 1e-3, f"side stand, phone {w} mm, tilt {t}: {k} hits the table"


def test_the_parts_fit_together():
    asm = cb.bridge_assembly(P)
    girder = asm["girder"]
    for name in ("column-a", "column-b", "mast", "slot-nut", "knob-mast"):
        assert overlap(asm[name], girder) < 1e-3, f"{name} and the girder"
    # the mast along the whole slot, and the slot nut under it
    lo, hi = P.mast_range
    for y in (lo, 0.0, hi):
        a = cb.bridge_assembly(P, mast_y=y)
        assert overlap(a["mast"], a["girder"]) < 1e-3
        assert overlap(a["slot-nut"], a["girder"]) < 1e-3
    # the mast's skirts hug the deck: 0.1 mm of play on either side
    w2 = P.girder_w / 2
    assert (cb.mast(P) ^ cb.box(-w2 - 0.09, w2 + 0.09, -50, 50, -P.deck_t, -0.01)).is_empty()
    assert not (cb.mast(P) ^ cb.box(-w2 - 0.11, -w2, -50, 50, -P.deck_t, -0.01)).is_empty()
    assert not (cb.mast(P) ^ cb.box(w2, w2 + 0.11, -50, 50, -P.deck_t, -0.01)).is_empty()
    # a lid in its trough, and a connector under the joint of two troughs and under a column's slab
    t1 = cb.trough_straight(P, 50)
    t2 = cb.trough_straight(P, 50).translate((50, 0, 0))
    lid = cb.lid_straight(P, 50).translate((0.15, 0, P.trough_h - 1.4))
    plate = cb.connector(P).translate((50, 0, 0))
    assert overlap(lid, t1) < 1e-3
    for radius, angle, stub in ((P.trough_curve_radius, P.trough_curve_angle, 0.0), (P.trough_bend_radius, 90.0, 8.0)):
        curve = cb.trough_curve(P, radius, angle, stub)
        curve_lid = cb.lid_curve(P, radius, angle, stub).translate((0, 0, P.trough_h - 1.4))
        assert overlap(curve_lid, curve) < 1e-3, f"lid of the curve R {radius}"
    assert overlap(plate, t1) < 1e-3 and overlap(plate, t2) < 1e-3
    column = cb.column(P)
    plate = cb.connector(P).translate((P.foot_length / 2, 0, 0))
    assert overlap(plate, column) < 1e-3
    # the cable fits the troughs, the column's duct and the tray
    assert P.w_in >= P.cable_d + 1.0 and P.tray_w >= P.cable_d + 1.0


def test_it_stands_firm_with_the_phone_off_the_middle():
    st = cb.stability(P)
    # the phone's middle may sit as far off the middle as the phone is long on either side of the jaws
    assert st["bridge_offset"] >= cb.PHONE_HALF
    assert st["side_offset"] >= cb.PHONE_HALF - 10
    # a finger pressing on the end of the phone (a tap is 1 to 2 N)
    assert st["bridge_press"] >= 5.0
    assert st["side_press"] >= 5.0
    assert st["side_push"] >= 2.5
    # the short feet of the first design tipped at a tap
    short = cb.stability(cb.Params(foot_length=44.0))
    assert short["bridge_press"] < 2.0


def test_the_report_names_what_was_built():
    text = cb.report(P)
    assert "6.87 m" in text
    assert "Tilts on the bridge: -45, -30, -15, +0, +15, +30, +45 degrees" in text
    assert "side stand, 150 mm from the locomotive's side" in text
