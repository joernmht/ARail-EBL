#!/usr/bin/env python3
"""A camera bridge for the EBL: 3D-printable parts that hold a phone over and beside the tracks.

The bridge is inspired by the camera bridges (Kamerabrücken) of DB Cargo's marshalling yards: a steel
portal over the tracks with cameras and lights that films every passing wagon. Here a phone films the
lab's H0 trains, to collect images for a model that checks train compositions.

Parts (H0, 1:87, millimetres):

- the bridge: two columns (H beams on concrete feet, a cable duct up one side), a lattice girder with a
  slot along its deck and a cable tray, a mast that clamps anywhere along the slot, and a slot nut;
- the phone holder: a cradle that tilts about an axis along the track in steps of 15 degrees, two
  jaws for phones 62 to 88 mm wide, four thumb knobs;
- a side stand: the same cradle low beside the track, the phone upright at the height of the
  locomotives' numbers, as the side cameras of the real portals;
- cable troughs (Kabelkanal) with lids for the charging cable: straight, short, curved, a 90 degree
  bend, and a connector that keeps two troughs in line.

Everything is a parameter (``--tracks 3``, ``--track-spacing 52``, ...). Run with ``--help``.

    python camera_bridge.py --out stl            # write the STL files
    python camera_bridge.py --render previews    # PNG previews of the parts and the assembly
    python camera_bridge.py --report             # clearances, ranges and camera distances

Needs ``manifold3d`` and ``numpy`` (``pip install -r requirements.txt``). The guide is
``docs/camera-bridge.md``.
"""

from __future__ import annotations

import argparse
import dataclasses
import math
import struct
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from manifold3d import CrossSection, FillRule, JoinType, Manifold, set_min_circular_angle, set_min_circular_edge_length

set_min_circular_angle(5.0)
set_min_circular_edge_length(0.35)

H0_SCALE = 87.0

# Hardware: DIN 933 hex bolts M4 (head 7 mm across flats, 2.8 mm high), DIN 934 nuts M4 (7 mm, 3.2 mm).
HARDWARE = [
    (2, "M4x12 hex bolt (DIN 933)", "jaws: head in the jaw's foot, a knob under the cradle"),
    (2, "M4x20 hex bolt (DIN 933)", "mast: head in the slot nut, a knob on top; pivot: a knob on the far finger"),
    (4, "M4 hex nut (DIN 934)", "one pressed into each knob"),
    (1, "M3x16 screw and M3 nut", "lock pin through fork and tongue"),
    (2, "M3x16 screw (optional)", "girder to columns, from the deck into the tenons"),
]
HEX_HEAD_AF = 7.3  # pocket for an M4 hex head or nut, across flats, with clearance
HEX_HEAD_DEPTH = 3.0
NUT_DEPTH = 3.4
M4_CLEAR = 4.4
M4_PIVOT = 4.3
M3_CLEAR = 3.3
M3_PILOT = 2.6

# For the stability estimate: PLA, printed at about 60 % of the solid mass (walls and infill), a 200 g phone
# 156 mm long, so a finger on its end presses 78 mm from its middle.
PLA_DENSITY = 1.24
PRINT_FILL = 0.6
PHONE_MASS = 200.0
PHONE_HALF = 78.0
SLAB_H = 4.0
SIDE_FOOT_Y = (-40.0, 50.0)  # the side stand's foot across the track, from its axis; +y towards the track


@dataclass
class Params:
    """Dimensions in millimetres. The defaults fit the EBL: H0, parallel tracks 52 mm apart."""

    tracks: int = 2  # tracks under the bridge
    track_spacing: float = 52.0  # centre to centre (G14-G16 in the EBL: 52 mm = 4.5 m)
    side_clear: float = 30.0  # outer track centre to the inner face of a column
    clear_height: float = 85.0  # table to the underside of the girder
    rail_top: float = 6.0  # table to the top of the rails, for the report only
    cable_d: float = 4.0  # diameter of the charging cable
    phone_t_max: float = 12.5  # thickest phone, with its case
    mast_height: float = 38.0  # deck to the tilt axis of the phone
    side_pivot_height: float = 54.0  # table to the tilt axis on the side stand
    foot_length: float = 120.0  # base slab under each column, along the track: keeps the bridge from tipping
    side_foot_length: float = 120.0  # foot of the side stand, along the track
    trough_length: float = 100.0
    trough_short: float = 50.0
    trough_curve_radius: float = 120.0  # centre line
    trough_curve_angle: float = 30.0
    trough_bend_radius: float = 12.0  # centre line of the tight 90 degree bend
    fit: float = 0.2  # clearance of parts that slide into each other

    # fixed design sizes
    col: float = 14.0  # column section (H beam), square
    girder_h: float = 16.0  # height of the trusses
    girder_w: float = 14.0  # width of the girder across the track
    deck_t: float = 1.6
    foot_h: float = 12.0  # concrete foundation of a column
    plate_e: float = 7.5  # tilt axis to the underside of the cradle plate
    plate_t: float = 3.5
    jaw_foot_t: float = 4.2
    phone_w_min: float = 62.0
    phone_w_max: float = 88.0
    finger_r: float = 18.0  # radius of the cradle's fork
    lock_r1: float = 9.0  # lock holes for 0, +-30 degrees
    lock_r2: float = 14.6  # lock holes for +-15, +-45 degrees

    # derived sizes
    @property
    def inner_span(self) -> float:
        return (self.tracks - 1) * self.track_spacing + 2 * self.side_clear

    @property
    def col_axis(self) -> float:
        """Distance of a column's axis from the bridge's centre line."""
        return self.inner_span / 2 + self.col / 2

    @property
    def girder_len(self) -> float:
        return 2 * (self.col_axis + self.col / 2 + 3.0)

    @property
    def truss_half(self) -> float:
        """Half the length of the open truss between the solid end blocks."""
        return self.col_axis - self.col / 2 - 1.0

    @property
    def slot_half(self) -> float:
        return self.truss_half - 4.0

    @property
    def deck_top(self) -> float:
        """Height of the girder's deck above the table."""
        return self.clear_height + self.girder_h + self.deck_t

    @property
    def track_centres(self) -> list[float]:
        return [(i - (self.tracks - 1) / 2) * self.track_spacing for i in range(self.tracks)]

    @property
    def w_in(self) -> float:
        """Inner width of a cable trough."""
        return self.cable_d + 1.6

    @property
    def trough_w(self) -> float:
        return self.w_in + 2 * 1.8

    @property
    def trough_h(self) -> float:
        return 1.8 + (self.cable_d + 1.5) + 1.4

    @property
    def tray_w(self) -> float:
        """Inner width of the cable tray along the girder."""
        return self.cable_d + 1.2

    @property
    def jaw_bolt_range(self) -> tuple[float, float]:
        return self.phone_w_min / 2 - 5.0, self.phone_w_max / 2 - 5.0

    @property
    def lock_angles(self) -> list[tuple[float, float]]:
        """The cradle's lock holes: (radius, angle from straight down towards +y)."""
        return [(self.lock_r1, a) for a in (-30.0, 0.0, 30.0)] + [(self.lock_r2, a) for a in (-45.0, -15.0, 15.0, 45.0)]

    @property
    def tilts(self) -> list[float]:
        """Tilts the lock pin allows: the cradle hole at angle a meets the mast's hole when tilted by -a."""
        return sorted(0.0 - a for _, a in self.lock_angles)

    @property
    def side_tilts(self) -> list[float]:
        """Tilts usable on the side stand: level, or looking down at the track (the others hit the stand)."""
        return [t for t in self.tilts if t <= 0]

    @property
    def mast_range(self) -> tuple[float, float]:
        """Where the mast's centre can stand along the slot (its bolt 14.5 mm towards +y; turn it for -y)."""
        lo = max(-self.slot_half + 2.0 - 14.5, -self.girder_len / 2 + 21.0)
        hi = min(self.slot_half - 2.0 - 14.5, self.girder_len / 2 - 21.0)
        return lo, hi


# --------------------------------------------------------------------------------------------- helpers


def box(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> Manifold:
    return Manifold.cube((x1 - x0, y1 - y0, z1 - z0)).translate((x0, y0, z0))


def cyl_z(d: float, z0: float, z1: float, x: float = 0.0, y: float = 0.0, segments: int = 0) -> Manifold:
    return Manifold.cylinder(z1 - z0, d / 2, circular_segments=segments).translate((x, y, z0))


def poly(points: list[tuple[float, float]]) -> CrossSection:
    return CrossSection([points], FillRule.NonZero)


def rect(a0: float, a1: float, b0: float, b1: float) -> CrossSection:
    return CrossSection.square((a1 - a0, b1 - b0)).translate((a0, b0))


def rounded_rect(w: float, h: float, r: float) -> CrossSection:
    return CrossSection.square((w - 2 * r, h - 2 * r), center=True).offset(r, JoinType.Round)


def circle(d: float, a: float = 0.0, b: float = 0.0, segments: int = 0) -> CrossSection:
    return CrossSection.circle(d / 2, segments).translate((a, b))


def teardrop(d: float, a: float, b: float, up: tuple[float, float] = (0.0, 1.0)) -> CrossSection:
    """A round hole with a 45 degree roof, so that it prints without support; ``up`` points away from the bed."""
    r = d / 2
    tip = CrossSection.square((0.01, 0.01), center=True).translate((0.0, r * math.sqrt(2)))
    shape = CrossSection.batch_hull([CrossSection.circle(r, 32), tip])
    angle = math.degrees(math.atan2(up[1], up[0])) - 90.0
    return shape.rotate(angle).translate((a, b))


def hexagon(af: float, a: float = 0.0, b: float = 0.0, corners_on_a: bool = True) -> CrossSection:
    """A hexagon ``af`` across flats; ``corners_on_a`` puts two corners on the first axis."""
    r = af / math.sqrt(3)
    start = 0.0 if corners_on_a else 30.0
    pts = [(r * math.cos(math.radians(start + 60 * i)), r * math.sin(math.radians(start + 60 * i))) for i in range(6)]
    return poly(pts).translate((a, b))


def segment(a: tuple[float, float], b: tuple[float, float], width: float) -> CrossSection:
    """A bar of the given width from a to b with square ends."""
    (ax, ay), (bx, by) = a, b
    length = math.hypot(bx - ax, by - ay)
    nx, ny = -(by - ay) / length * width / 2, (bx - ax) / length * width / 2
    return poly([(ax + nx, ay + ny), (bx + nx, by + ny), (bx - nx, by - ny), (ax - nx, ay - ny)])


def ext_x(cs: CrossSection, x0: float, x1: float) -> Manifold:
    """Extrude a section drawn in (y, z) along x."""
    return Manifold.extrude(cs, x1 - x0).transform(np.array([[0, 0, 1, x0], [1, 0, 0, 0], [0, 1, 0, 0]], float))


def ext_y(cs: CrossSection, y0: float, y1: float) -> Manifold:
    """Extrude a section drawn in (x, z) along y."""
    return Manifold.extrude(cs, y1 - y0).transform(np.array([[1, 0, 0, 0], [0, 0, 1, y0], [0, 1, 0, 0]], float))


def ext_z(cs: CrossSection, z0: float, z1: float) -> Manifold:
    return Manifold.extrude(cs, z1 - z0).translate((0.0, 0.0, z0))


def union(parts: list[Manifold]) -> Manifold:
    parts = [p for p in parts if not p.is_empty()]
    return Manifold.batch_boolean(parts, _op("Add")) if parts else Manifold()


def _op(name: str):
    from manifold3d import OpType

    return getattr(OpType, name)


def chamfered_box(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float, c: float) -> Manifold:
    """A box with its top edges chamfered by c."""
    return Manifold.batch_hull([box(x0, x1, y0, y1, z0, z1 - c), box(x0 + c, x1 - c, y0 + c, y1 - c, z1 - c, z1)])


def mirror_y(m: Manifold) -> Manifold:
    return m.mirror((0.0, 1.0, 0.0))


# ---------------------------------------------------------------------------------------------- bridge


def column(p: Params) -> Manifold:
    """A column on its foundation. Axis at x = y = 0, the tracks on the +y side, the cable duct on +x.

    The foundation stands on a slab ``foot_length`` long along the track, so that a phone off the middle,
    or a finger on its end, does not tip the bridge over. The H beam has its flanges across the track
    (y = +-7) and the web along it, so the portal is stiff in
    its own plane. Of the two channels, the one towards +x is the cable duct (a comb of teeth holds the
    cable), the one towards -x holds a ladder. The flange facing the tracks carries two camera housings
    and two light bars: the look of a camera bridge, which films the wagons' sides in bright light.
    """
    c = p.col / 2  # 7
    ch = p.clear_height
    fh = p.foot_h
    base_top = fh + 1.2
    fl = max(p.foot_length / 2, 22.0)
    parts = [
        chamfered_box(-fl, fl, -11, 11, 0, SLAB_H, 0.8),  # base slab: the foundation's footing
        chamfered_box(-22, 22, -10, 10, 0, fh, 1.0),  # concrete foundation
        box(-9, 9, -9, 9, fh - 0.01, base_top),  # steel base plate
    ]
    parts += [cyl_z(1.6, base_top - 0.01, base_top + 1.0, x, y, 12) for x in (-7.2, 7.2) for y in (-7.2, 7.2)]
    # H beam: flanges at y = +-(5..7), web at x = -1..1
    z0, z1 = base_top - 0.01, ch - 2.0
    parts += [box(-c, c, -c, -c + 2, z0, z1), box(-c, c, c - 2, c, z0, z1), box(-1, 1, -c + 1.99, c - 1.99, z0, z1)]
    parts.append(box(-8, 8, -8, 8, ch - 2.0, ch))  # head plate
    tenon = chamfered_box(-4, 4, -3, 3, ch - 0.01, ch + 6.0, 0.6)
    parts.append(tenon)
    # comb teeth across the opening of the duct: alternating from either flange, with a 45 degree underside
    opening = p.cable_d + 0.5
    reach = 2 * (c - 2) - opening  # tooth length so that the opening stays wide enough for the cable
    z = base_top + 12.0
    side = -1
    while z + 8 < ch - 10:
        y0 = side * (c - 2)
        y1 = y0 - side * reach
        prof = poly([(y0, z), (y1, z + reach), (y1, z + reach + 1.6), (y0, z + reach + 1.6)])
        parts.append(ext_x(prof, c - 1.0, c))
        z += 16.0
        side = -side
    # ladder rungs in the -x channel
    zr = base_top + 6.0
    while zr < ch - 6:
        parts.append(box(-5.6, -4.8, -c + 1.99, c - 1.99, zr, zr + 0.8))
        zr += 3.5
    # camera housings (sloped undersides) and light bars on the flange facing the tracks
    for h in (34.0, 60.0):
        if h + 6 < ch - 4:
            wedge = poly([(c - 0.01, h - 4.0), (c + 4.0, h), (c + 4.0, h + 5.0), (c - 0.01, h + 5.0)])
            parts.append(ext_x(wedge, -3.0, 3.0))
    for x in (-6.0, 4.0):
        parts.append(box(x, x + 2.0, c - 0.01, c + 0.8, base_top + 10, ch - 8))
    m = union(parts)
    cuts = []
    # lenses of the camera housings
    for h in (34.0, 60.0):
        if h + 6 < ch - 4:
            lens = Manifold.cylinder(1.0, 1.3, circular_segments=24).rotate((-90.0, 0.0, 0.0))
            cuts.append(lens.translate((0.0, c + 3.4, h + 2.5)))
    # LED segments of the light bars
    zl = base_top + 11.0
    while zl < ch - 9:
        cuts += [box(x - 0.1, x + 2.1, c + 0.4, c + 1.0, zl, zl + 0.6) for x in (-6.0, 4.0)]
        zl += 2.5
    # the cable's way from the trough through the foot into the duct
    half = p.w_in / 2
    cuts.append(box(1.0, fl + 0.5, -half, half, 1.8, base_top + 0.5))
    # recess for the connector plate under the trough's end
    cuts.append(connector_recess(p).translate((fl, 0.0, 0.0)))
    # countersunk holes in the slab's ends, for screws into the table if it may take them
    if fl >= 30.0:
        cuts += [countersunk(fl - 8.0, 7.0, SLAB_H), countersunk(-fl + 8.0, -7.0, SLAB_H)]
    # pilot hole for an optional M3 screw from the girder
    cuts.append(cyl_z(M3_PILOT, ch + 6.0 - 8.0, ch + 6.5))
    return m - union(cuts)


def countersunk(x: float, y: float, top: float) -> Manifold:
    """A hole for a 3 to 3.5 mm wood screw with a countersunk head, from the top at height ``top``."""
    cone = Manifold.cylinder(1.6, M3_CLEAR / 2, 3.3, circular_segments=32).translate((x, y, top - 1.6))
    return cyl_z(M3_CLEAR, -1, top + 1, x, y, 32) + cone + cyl_z(6.6, top - 0.01, top + 1, x, y, 32)


def connector_recess(p: Params) -> Manifold:
    """A recess for the connector plate, centred on an end face at x = 0 (half of it lies outside)."""
    w = 5.0 + 2 * p.fit
    return box(-6.0, 6.0, -w / 2, w / 2, -0.5, 1.0)


def girder(p: Params) -> Manifold:
    """The lattice girder. Centre of the span at the origin, underside at z = 0, deck on top.

    Two Pratt trusses (x = +-5..7) joined by the deck and by ties along the bottom, solid end blocks that
    sit on the columns' tenons, a slot along the deck for the mast with a scale beside it (a tick every
    5 mm, a triangle at every track's centre), and a cable tray on the +x side, on brackets.
    """
    h, w2, L = p.girder_h, p.girder_w / 2, p.girder_len
    a, s = p.col_axis, p.truss_half
    n = max(2, round(2 * s / 12.0))
    bay = 2 * s / n
    ys = [-s + k * bay for k in range(n + 1)]
    chord = 2.5
    bar = 1.6
    lines = [rect(-s, s, 0, chord), rect(-s, s, h - chord, h)]
    lines += [rect(y - bar / 2, y + bar / 2, 0, h) for y in ys[1:-1]]
    for k in range(n):
        y0, y1 = ys[k], ys[k + 1]
        # Pratt: the diagonals fall towards the middle of the span
        if (y0 + y1) / 2 < 0:
            lines.append(segment((y0, h - chord / 2), (y1, chord / 2), bar))
        else:
            lines.append(segment((y0, chord / 2), (y1, h - chord / 2), bar))
    panel = CrossSection.batch_boolean(lines, _op("Add")) ^ rect(-s, s, 0, h)
    parts = [ext_x(panel, w2 - 2.0, w2), ext_x(panel, -w2, -w2 + 2.0)]
    for sign in (-1, 1):  # end blocks
        y_in, y_out = sign * s, sign * L / 2
        parts.append(box(-w2, w2, min(y_in, y_out), max(y_in, y_out), 0, h))
    parts.append(box(-w2, w2, -L / 2, L / 2, h - 0.01, h + p.deck_t))  # deck
    corbel = poly([(w2 - 2.0 + 0.01, h - 2.8), (w2 - 2.0 + 0.01, h + 0.01), (2.2, h + 0.01)])
    for cs in (corbel, corbel.mirror((1.0, 0.0))):
        parts.append(ext_y(cs, -s, s))
    parts += [box(-w2 + 1.99, w2 - 1.99, y - bar / 2, y + bar / 2, 0, chord) for y in ys[2:-1:2]]  # ties
    # cable tray on brackets
    tw = p.tray_w
    x_out = w2 + tw
    floor_z0, floor_z1 = h - p.cable_d - 2.2, h - p.cable_d - 1.0
    parts.append(box(w2 - 0.01, x_out + 1.2, -L / 2, L / 2, floor_z0, floor_z1))
    parts.append(box(x_out, x_out + 1.2, -L / 2, L / 2, floor_z0, h))
    drop = x_out + 1.2 - w2
    gusset = poly([(w2 - 0.01, floor_z0 + 0.01), (x_out + 1.2, floor_z0 + 0.01), (w2 - 0.01, floor_z0 - drop)])
    for y in ys[1:-1]:
        parts.append(ext_y(gusset, y - bar / 2, y + bar / 2))
    for sign in (-1, 1):
        y0, y1 = sorted((sign * (s - 0.01), sign * L / 2))
        parts.append(ext_y(gusset, y0, y1))
    m = union(parts)
    cuts = [box(-2.2, 2.2, -p.slot_half, p.slot_half, h - 3.0, h + p.deck_t + 1)]  # slot
    for sign in (-1, 1):
        y = sign * a
        f = p.fit
        cuts.append(box(-4 - f, 4 + f, y - 3 - f, y + 3 + f, -1, 6.0 + 0.3))  # mortise for the tenon
        cuts.append(cyl_z(M3_CLEAR, 6.0, h + p.deck_t + 1, 0.0, y))
        # notch in the tray where the cable comes up from the column's duct
        cuts.append(box(w2 + 0.01, x_out + 1.3, y - 3.5, y + 3.5, floor_z0 - drop - 1, h + 0.1))
    # scale on the deck: ticks every 5 mm, longer every 10 mm, triangles at the tracks' centres
    top = h + p.deck_t
    k = 0
    while k * 5.0 <= p.slot_half:
        for y in {k * 5.0, -k * 5.0}:
            x1 = -3.0 if k % 2 == 0 else -4.6
            cuts.append(box(-6.4, x1, y - 0.25, y + 0.25, top - 0.4, top + 1))
        k += 1
    for y in p.track_centres:
        tri = poly([(6.4, y - 1.6), (6.4, y + 1.6), (3.2, y)])
        cuts.append(ext_z(tri, top - 0.4, top + 1))
    return m - union(cuts)


def slot_nut(p: Params) -> Manifold:
    """The nut under the deck: wedged between the corbels, holds the head of the mast's M4 bolt.

    In the girder's frame, under y = 0. Its 45 degree shoulders bear on the corbels under the deck.
    """
    h = p.girder_h
    zt = h - 0.15
    zb = h - 6.4
    xs = 4.75
    prof = poly([(-xs, zb), (xs, zb), (xs, h - 2.8), (2.1, zt), (-2.1, zt), (-xs, h - 2.8)])
    m = ext_y(prof, -5.0, 5.0)
    pocket = ext_z(hexagon(HEX_HEAD_AF, corners_on_a=False), zb - 1, zb + HEX_HEAD_DEPTH)
    return m - pocket - cyl_z(M4_CLEAR, zb, h + 1)


def mast(p: Params) -> Manifold:
    """The mast that clamps on the deck. Deck top at z = 0, tilt axis at (y, z) = (0, mast_height).

    Two skirts hug the deck's edges, so the mast stays square to the girder; the M4 bolt at y = +14.5
    goes down through the slot into the slot nut. The tongue carries the pivot and two lock holes; the
    ear on the +x side guides the cable up from the tray.
    """
    zp = p.mast_height
    w2 = p.girder_w / 2
    parts = [
        chamfered_box(-w2 - 1.3, w2 + 1.3, -21, 21, 0, 6, 0.8),  # wide enough to carry the skirts
        box(w2 + 0.1, w2 + 1.3, -21, 21, -p.deck_t, 0.01),
        box(-w2 - 1.3, -w2 - 0.1, -21, 21, -p.deck_t, 0.01),
    ]
    ri = (p.cable_d + 0.6) / 2
    ro = ri + 1.6
    ear_x = w2 + p.tray_w / 2
    parts.append(ext_z(circle(2 * ro, ear_x, -14.0) + rect(w2 - 1, ear_x, -14 - ro, -14 + ro), 0, 6))
    tongue = rect(-7, 7, 5.0, zp) + circle(13.0, 0, zp, 48)
    holes = teardrop(M4_PIVOT, 0, zp) + teardrop(M3_CLEAR, 0, zp - p.lock_r1) + teardrop(M3_CLEAR, 0, zp - p.lock_r2)
    parts.append(ext_x(tongue - holes, -2.5, 2.5))
    gusset = poly([(2.49, 5.99), (6.5, 5.99), (2.49, 10.0)])
    for cs in (gusset, gusset.mirror((1.0, 0.0))):
        parts.append(ext_y(cs, -3.0, 3.0))
    m = union(parts)
    cuts = [
        cyl_z(M4_CLEAR, -2, 7, 0.0, 14.5),
        cyl_z(2 * ri, -1, 7, ear_x, -14.0),
        box(ear_x, ear_x + ro + 1, -14 - 0.375 * p.cable_d, -14 + 0.375 * p.cable_d, -1, 7),
    ]
    return m - union(cuts)


def cradle(p: Params) -> Manifold:
    """The phone's cradle. Tilt axis along x through the origin; the plate above, the fork below.

    The fork's two fingers straddle the mast's tongue. Lock holes on two arcs give a tilt every 15 degrees
    from -45 to +45: the inner arc 0 and +-30, the outer arc +-15 and +-45. Ticks beside the jaws' slots
    mark the phone's width every 4 mm (long ticks at 64, 72, 80 and 88 mm), so both jaws can be set
    alike and the phone sits over the axis.
    """
    e, t = p.plate_e, p.plate_t
    plate = ext_z(rounded_rect(40, 82, 4), e, e + t)
    b0, b1 = p.jaw_bolt_range
    cuts = [ext_z(rect(-2.2, 2.2, b0, b1) + rect(-2.2, 2.2, -b1, -b0), e - 1, e + t + 1)]
    w = p.phone_w_min
    while w <= p.phone_w_max + 1e-6:
        y = w / 2 - 5.0
        x1 = 7.2 if round(w) % 8 == 0 else 5.0
        cuts += [box(3.0, x1, sy * y - 0.25, sy * y + 0.25, e + t - 0.4, e + t + 1) for sy in (-1, 1)]
        w += 4.0
    finger = circle(2 * p.finger_r, 0, 0, 96) ^ rect(-p.finger_r, p.finger_r, -p.finger_r, e + 0.5)
    down = (0.0, -1.0)  # the cradle prints upside down: the teardrops point away from the plate
    holes = teardrop(M4_PIVOT, 0, 0, down)
    for r, a in p.lock_angles:
        holes += teardrop(M3_CLEAR, r * math.sin(math.radians(a)), -r * math.cos(math.radians(a)), down)
    g = 2.5 + 0.3
    fingers = [ext_x(finger - holes, g, g + 3.0), ext_x(finger - holes, -g - 3.0, -g)]
    return union([plate] + fingers) - union(cuts)


def jaw(p: Params) -> Manifold:
    """A jaw for the +y side; its face on the phone at y = 0, its foot on the plate at z = 0.

    The foot reaches under the phone; the hex head of an M4x12 bolt sits in a pocket in its underside
    (shaft down through the plate's slot, a thumb knob below). The lip keeps the phone in when tilted.
    """
    ft = p.jaw_foot_t
    lip_z = ft + p.phone_t_max
    prof = rect(-10, 3, 0, ft) + rect(0, 3, 0, lip_z + 1.4) + rect(-2.5, 3, lip_z, lip_z + 1.4)
    m = ext_x(prof, -8.0, 8.0)
    pocket = ext_z(hexagon(HEX_HEAD_AF, 0.0, -5.0, corners_on_a=True), -1, HEX_HEAD_DEPTH)
    return m - pocket


def knob(p: Params) -> Manifold:
    """A thumb knob with a captive M4 nut; its flat face presses, the nut sits at the far end."""
    body = CrossSection.circle(5.6, 48)
    for i in range(8):
        a = math.radians(45 * i)
        body += CrossSection.circle(1.5, 24).translate((5.6 * math.cos(a), 5.6 * math.sin(a)))
    m = ext_z(body, 0, 8.0)
    return m - cyl_z(M4_CLEAR, -1, 9) - ext_z(hexagon(HEX_HEAD_AF), 8.0 - NUT_DEPTH, 9)


def side_stand(p: Params) -> Manifold:
    """A low stand beside the track for the same cradle: the phone upright, looking across at the side.

    The track lies towards +y. Tilt axis along x at (y, z) = (0, side_pivot_height); the lock holes lie
    towards the track. The stand's plate runs under the axis at 45 degrees down to its post, clear of
    the cradle's knobs, so it prints without support. The foot reaches 50 mm towards the track and 40 mm
    away from it, and ``side_foot_length`` along the track, with four countersunk holes.
    """
    zp = p.side_pivot_height
    ft = SLAB_H
    fl = max(p.side_foot_length / 2, 25.0)
    y0, y1 = SIDE_FOOT_Y
    parts = [chamfered_box(-fl, fl, y0, y1, 0, ft, 0.8)]
    prof = circle(13.0, 0, zp, 48) + poly(
        [(0, zp + 7), (22, zp + 7), (22, ft - 0.01), (14, ft - 0.01), (14, zp - 21), (0, zp - 7)]
    )
    holes = teardrop(M4_PIVOT, 0, zp) + teardrop(M3_CLEAR, p.lock_r1, zp) + teardrop(M3_CLEAR, p.lock_r2, zp)
    parts.append(ext_x(prof - holes, -2.5, 2.5))
    gusset = poly([(2.49, ft - 0.01), (12.0, ft - 0.01), (2.49, ft + 9.5)])
    for cs in (gusset, gusset.mirror((1.0, 0.0))):
        parts.append(ext_y(cs, 14.0, 22.0))
    holes = [countersunk(sx * (fl - 7.0), y, ft) for sx in (-1, 1) for y in (y0 + 7.0, y1 - 7.0)]
    return union(parts) - union(holes)


# ---------------------------------------------------------------------------------------- cable troughs


def trough_profile(p: Params) -> CrossSection:
    """Cross-section (u across, z up): a concrete trough with a rebate for its lid."""
    W, H = p.trough_w, p.trough_h
    outer = poly([(-W / 2, 0), (W / 2, 0), (W / 2, H - 0.4), (W / 2 - 0.4, H), (-W / 2 + 0.4, H), (-W / 2, H - 0.4)])
    channel = rect(-p.w_in / 2, p.w_in / 2, 1.8, H + 1)
    rebate = rect(-p.w_in / 2 - 0.8, p.w_in / 2 + 0.8, H - 1.4, H + 1)
    return outer - channel - rebate


def lid_profile(p: Params) -> CrossSection:
    w = p.w_in + 1.6 - 0.2
    return rect(-w / 2, w / 2, 0, 1.35)


def _groove(p: Params, z0: float, z1: float) -> Manifold:
    """A vertical V groove: the joint between two 1 m trough elements."""
    return ext_z(CrossSection.square((0.5, 0.5), center=True).rotate(45.0), z0, z1)


def trough_straight(p: Params, length: float) -> Manifold:
    """A straight trough along +x from x = 0."""
    m = ext_x(trough_profile(p), 0.0, length)
    cuts = [connector_recess(p), connector_recess(p).translate((length, 0, 0))]
    step = 1000.0 / H0_SCALE
    x = step
    while x < length - 1:
        cuts += [_groove(p, 0.6, p.trough_h - 0.4).translate((x, sy * p.trough_w / 2, 0)) for sy in (-1, 1)]
        x += step
    return m - union(cuts)


def _arc_segments(radius: float) -> int:
    """Segments of a full circle for curved troughs and their lids alike, so that their facets line up."""
    return max(96, 4 * round(radius))


def _arc_trough(p: Params, prof: CrossSection, radius: float, angle: float) -> Manifold:
    """Revolve a profile about the z axis: the centre line at ``radius``, from +x towards +y."""
    return Manifold.revolve(prof.translate((radius, 0.0)), _arc_segments(radius), angle)


def trough_curve(p: Params, radius: float, angle: float, stub: float = 0.0) -> Manifold:
    """A curved trough: centre line at ``radius``, from (radius, 0) turning towards +y; optional straight stubs."""
    parts = [_arc_trough(p, trough_profile(p), radius, angle)]
    if stub > 0:
        parts.append(_straight_piece(p, stub).rotate((0, 0, 90)).translate((radius, -stub, 0)))
        parts.append(_straight_piece(p, stub).rotate((0, 0, 90)).translate((radius, 0, 0)).rotate((0, 0, angle)))
    m = union(parts)
    recess = connector_recess(p).rotate((0, 0, 90))
    cuts = [recess.translate((radius, -stub, 0)), recess.translate((radius, stub, 0)).rotate((0, 0, angle))]
    da = math.degrees(1000.0 / H0_SCALE / radius)
    a = da
    while a < angle - 0.3 * da:
        for r in (radius - p.trough_w / 2, radius + p.trough_w / 2):
            cuts.append(_groove(p, 0.6, p.trough_h - 0.4).translate((r, 0, 0)).rotate((0, 0, a)))
        a += da
    return m - union(cuts)


def _straight_piece(p: Params, length: float) -> Manifold:
    """A plain straight trough along +x from x = 0 (no grooves, no recesses)."""
    return ext_x(trough_profile(p), 0.0, length)


def lid_straight(p: Params, length: float) -> Manifold:
    """A lid along +x; grooves across it every 0.5 m (one concrete slab each), two dimples per slab."""
    m = ext_x(lid_profile(p), 0.0, length - 0.3)
    return m - union(_lid_marks(p, length - 0.3))


def _lid_marks(p: Params, length: float) -> list[Manifold]:
    step = 500.0 / H0_SCALE
    w = p.w_in + 1.6
    cuts = []
    x = step
    while x < length - 0.5:
        cuts.append(box(x - 0.2, x + 0.2, -w, w, 1.05, 2))
        x += step
    x = step / 2
    while x < length:
        cuts += [cyl_z(0.9, 0.95, 2, x, sy * 2.0, 12) for sy in (-1, 1)]
        x += step
    return cuts


def lid_curve(p: Params, radius: float, angle: float, stub: float = 0.0) -> Manifold:
    """A lid for a curved trough; 0.15 mm short at either end (at the stubs' ends if it has stubs)."""
    gap = 0.0 if stub > 0 else math.degrees(0.15 / radius)
    arc = Manifold.revolve(lid_profile(p).translate((radius, 0.0)), _arc_segments(radius), angle - 2 * gap)
    m = arc.rotate((0, 0, gap))
    parts = [m]
    if stub > 0:
        parts.append(ext_x(lid_profile(p), 0.0, stub - 0.15).rotate((0, 0, 90)).translate((radius, -stub + 0.15, 0)))
        end = ext_x(lid_profile(p), 0.0, stub - 0.15).rotate((0, 0, 90)).translate((radius, 0, 0))
        parts.append(end.rotate((0, 0, angle)))
    m = union(parts)
    step = 500.0 / H0_SCALE
    da = math.degrees(step / radius)
    w = p.w_in + 1.6
    cuts = []
    a = da
    while a < angle - 0.3 * da:
        cuts.append(box(radius - w, radius + w, -0.2, 0.2, 1.05, 2).rotate((0, 0, a)))
        a += da
    return m - union(cuts)


def connector(p: Params) -> Manifold:
    """The plate under the joint of two troughs (or of a trough and a column's foot)."""
    return box(-5.8, 5.8, -2.5, 2.5, 0, 0.95)


# ---------------------------------------------------------------------------------------------- catalogue


@dataclass
class Part:
    name: str
    count: int
    note: str
    build: object  # callable() -> Manifold, the part in its print orientation


def _bed(m: Manifold, rot: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> Manifold:
    """Rotate a part into its print orientation and put it on the bed, centred."""
    m = m.rotate(rot)
    x0, y0, z0, x1, y1, z1 = m.bounding_box()
    return m.translate((-(x0 + x1) / 2, -(y0 + y1) / 2, -z0))


def parts_catalogue(p: Params) -> list[Part]:
    L, Ls = p.trough_length, p.trough_short
    R, A = p.trough_curve_radius, p.trough_curve_angle
    Rb = p.trough_bend_radius
    return [
        Part("column-a", 1, "column with its foot, upright; the tracks lie towards +y", lambda: _bed(column(p))),
        Part("column-b", 1, "the mirror image of column-a, for the other side", lambda: _bed(mirror_y(column(p)))),
        Part("girder", 1, "lattice girder, upright as it stands", lambda: _bed(girder(p))),
        Part("slot-nut", 1, "nut under the deck for the mast's bolt, hex pocket down", lambda: _bed(slot_nut(p))),
        Part("mast", 1, "mast with the tilt axis, skirts down", lambda: _bed(mast(p))),
        Part("cradle", 1, "phone cradle, upside down (fingers up)", lambda: _bed(cradle(p), (180.0, 0.0, 0.0))),
        Part("jaw", 2, "jaw, lying on its side", lambda: _bed(jaw(p), (0.0, 90.0, 0.0))),
        Part("knob", 4, "thumb knob with a captive M4 nut, nut pocket up", lambda: _bed(knob(p))),
        Part("side-stand", 1, "side stand (optional), upright", lambda: _bed(side_stand(p))),
        Part("trough-straight", 4, f"cable trough, {L:g} mm", lambda: _bed(trough_straight(p, L))),
        Part("trough-short", 2, f"cable trough, {Ls:g} mm", lambda: _bed(trough_straight(p, Ls))),
        Part("trough-curve", 2, f"curved trough, R {R:g} mm, {A:g} degrees", lambda: _bed(trough_curve(p, R, A))),
        Part("trough-bend", 2, f"90 degree bend, R {Rb:g} mm", lambda: _bed(trough_curve(p, Rb, 90.0, 8.0))),
        Part("lid-straight", 4, f"lid for the {L:g} mm trough", lambda: _bed(lid_straight(p, L))),
        Part("lid-short", 2, f"lid for the {Ls:g} mm trough", lambda: _bed(lid_straight(p, Ls))),
        Part("lid-curve", 2, "lid for the curved trough", lambda: _bed(lid_curve(p, R, A))),
        Part("lid-bend", 2, "lid for the bend", lambda: _bed(lid_curve(p, Rb, 90.0, 8.0))),
        Part("connector", 8, "plate under a joint of two troughs", lambda: _bed(connector(p))),
    ]


# ---------------------------------------------------------------------------------------------- assembly


def rot_x(deg: float) -> np.ndarray:
    a = math.radians(deg)
    return np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])


def phone_dummy(width: float = 75.0, thickness: float = 8.5, length: float = 156.0) -> Manifold:
    body = ext_z(rounded_rect(length, width, 9.0), 0, thickness)
    bump = ext_z(rounded_rect(24, 24, 5.0).translate((length / 2 - 18, width / 2 - 18)), -1.8, 0.01)
    return body + bump


def cradle_set(
    p: Params, phone_w: float, tilt: float, with_phone: bool = True, lens_low: bool = False
) -> dict[str, Manifold]:
    """The cradle with its jaws, knobs and a phone, in the frame of the tilt axis, tilted.

    The phone's camera sits at its +y long edge, or at its -y edge with ``lens_low``.
    """
    top = p.plate_e + p.plate_t
    out = {"cradle": cradle(p)}
    j = jaw(p)
    out["jaw+"] = j.translate((0, phone_w / 2, top))
    out["jaw-"] = j.rotate((0, 0, 180)).translate((0, -phone_w / 2, top))
    k = knob(p).rotate((180, 0, 0))
    out["knob+"] = k.translate((0, phone_w / 2 - 5, p.plate_e))
    out["knob-"] = k.translate((0, -phone_w / 2 + 5, p.plate_e))
    if with_phone:
        phone = phone_dummy(phone_w - 0.4)
        if lens_low:
            phone = phone.mirror((0.0, 1.0, 0.0))
        out["phone"] = phone.translate((0, 0, top + p.jaw_foot_t))
    out = {k2: v.rotate((tilt, 0, 0)) for k2, v in out.items()}
    out["knob-pivot"] = knob(p).rotate((0, 90, 0)).translate((2.8 + 3.0, 0, 0))
    return out


def bridge_assembly(p: Params, mast_y: float = 0.0, tilt: float = 0.0, phone_w: float = 75.0) -> dict[str, Manifold]:
    """All parts of the bridge in the frame of the table: the track along x, the bridge's centre at 0."""
    a = p.col_axis
    out = {
        "column-a": column(p).translate((0, -a, 0)),
        "column-b": mirror_y(column(p)).translate((0, a, 0)),
        "girder": girder(p).translate((0, 0, p.clear_height)),
        "slot-nut": slot_nut(p).translate((0, mast_y + 14.5, p.clear_height)),
        "mast": mast(p).translate((0, mast_y, p.deck_top)),
        "knob-mast": knob(p).translate((0, mast_y + 14.5, p.deck_top + 6)),
    }
    pivot = (0.0, mast_y, p.deck_top + p.mast_height)
    for k, v in cradle_set(p, phone_w, tilt).items():
        out[k] = v.translate(pivot)
    return out


def side_assembly(p: Params, tilt: float = 0.0, phone_w: float = 75.0) -> dict[str, Manifold]:
    out = {"side-stand": side_stand(p)}
    for k, v in cradle_set(p, phone_w, 90.0 + tilt, lens_low=True).items():
        out[k] = v.translate((0, 0, p.side_pivot_height))
    return out


# ------------------------------------------------------------------------------------------------ report


def lens_position(p: Params, tilt: float, side: bool = False, lens_inset: float = 18.0) -> tuple[float, float]:
    """(y, z) of the phone's lens relative to the tilt axis; the lens assumed 18 mm in from a long edge.

    On the bridge the lens is taken on the axis (y = 0 in the cradle); on the side stand at the lower long
    edge, ``lens_inset`` from it, with the phone 75 mm wide.
    """
    zc = p.plate_e + p.plate_t + p.jaw_foot_t
    yc = 0.0 if not side else -(75.0 / 2 - lens_inset)
    rot = 90.0 + tilt if side else tilt
    r = rot_x(rot)
    v = r @ np.array([0.0, yc, zc])
    return float(v[1]), float(v[2])


def report(p: Params) -> str:
    """Clearances, ranges and what the phone's camera sees: the text of ``--report``."""
    lines = []
    above_rail = p.clear_height - p.rail_top
    centres = ", ".join(f"{y:+.0f}" for y in p.track_centres)
    lines.append(f"Tracks under the bridge: {p.tracks}, {p.track_spacing:g} mm apart, centres at {centres} mm")
    lines.append(f"Inner span between the columns: {p.inner_span:.0f} mm ({p.inner_span * H0_SCALE / 1000:.1f} m)")
    lines.append(
        f"Girder: {p.girder_len:.0f} mm long; underside {p.clear_height:g} mm above the table, "
        f"{above_rail:g} mm above the rails ({above_rail * H0_SCALE / 1000:.2f} m)"
    )
    lines.append(f"Height to the deck: {p.deck_top:.1f} mm; to the tilt axis: {p.deck_top + p.mast_height:.1f} mm")
    lo, hi = p.mast_range
    turned = f"turned round {-hi:+.0f} to {-lo:+.0f}"
    lines.append(f"Mast along the slot: {lo:+.0f} to {hi:+.0f} mm from the centre; {turned}")
    lines.append(f"Phones {p.phone_w_min:g} to {p.phone_w_max:g} mm wide, up to {p.phone_t_max:g} mm thick")
    lines.append("Tilts on the bridge: " + ", ".join(f"{t:+.0f}" for t in p.tilts) + " degrees")
    lines.append("Tilts on the side stand: " + ", ".join(f"{t:+.0f}" for t in p.side_tilts) + " degrees")
    lines.append("")
    lens = p.deck_top + p.mast_height + lens_position(p, 0.0)[1] - p.rail_top
    lines.append(f"Bridge: lens {lens:.0f} mm above the rails (tilt 0)")
    side = p.side_pivot_height + lens_position(p, 0.0, side=True)[1] - p.rail_top
    lines.append(f"Side stand: lens {side:.0f} mm above the rails (tilt 0, lens 18 mm in from the phone's edge)")
    lines.append("")
    st = stability(p)
    lines.append(f"Feet along the track: columns {p.foot_length:g} mm, side stand {p.side_foot_length:g} mm")
    for name, label in (("bridge", "Bridge"), ("side", "Side stand")):
        press = "cannot tip it" if math.isinf(st[f"{name}_press"]) else f"{st[f'{name}_press']:.1f} N tips it"
        lines.append(
            f"{label}: about {st[f'{name}_mass']:.0f} g printed; the phone's middle may sit "
            f"{st[f'{name}_offset']:.0f} mm off centre; a finger on the phone's end: {press}"
        )
    lines.append(f"Side stand: a push on the screen towards the track of {st['side_push']:.1f} N tips it")
    lines.append(f"(PLA at {PRINT_FILL:.0%} of solid, a {PHONE_MASS:g} g phone {2 * PHONE_HALF:g} mm long)")
    lines.append("")
    lines.append("A locomotive's number, 2 mm high and 20 mm above the rails, on a body 17 mm from the track's centre;")
    lines.append("main camera (26 mm equivalent), height of a character in pixels in 4K / 1080p video:")
    for label, dist, cos in number_views(p):
        px4, px1 = (number_pixels(dist, 69.4, w, cos_view=cos) for w in (3840, 1920))
        lines.append(f"  {label:44s} {dist:5.0f} mm  {px4:4.0f} / {px1:3.0f} px")
    return "\n".join(lines)


def centroid(m: Manifold) -> np.ndarray:
    """The centre of mass of a solid of even density."""
    v, t = mesh_arrays(m)
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    vol = np.einsum("ij,ij->i", a, np.cross(b, c)) / 6.0
    return (vol[:, None] * (a + b + c) / 4.0).sum(axis=0) / vol.sum()


def printed_mass(m: Manifold) -> float:
    """Grams of PLA, printed at ``PRINT_FILL`` of the solid."""
    return m.volume() / 1000.0 * PLA_DENSITY * PRINT_FILL


def _mass_centre(parts: dict[str, Manifold]) -> tuple[float, np.ndarray]:
    masses = {k: PHONE_MASS if k == "phone" else printed_mass(m) for k, m in parts.items()}
    total = sum(masses.values())
    return total, sum(masses[k] * centroid(m) for k, m in parts.items()) / total


def stability(p: Params) -> dict[str, float]:
    """How hard it is to tip the bridge and the side stand over (the assumptions are the constants above).

    ``*_offset``: how far the phone's middle may sit off the middle along the track before it tips (mm);
    ``*_press``: the force of a finger pressing down on the end of a centred phone that tips it (N);
    ``side_push``: a push on the side stand's phone towards the track, at the axis' height, that tips it (N).
    Mass in grams.
    """
    g = 9.81e-3
    out = {}
    for name, parts, half in (
        ("bridge", bridge_assembly(p), max(p.foot_length / 2, 22.0)),
        ("side", side_assembly(p), max(p.side_foot_length / 2, 25.0)),
    ):
        total, centre = _mass_centre(parts)
        out[f"{name}_mass"] = total - PHONE_MASS
        out[f"{name}_offset"] = (half - abs(centre[0])) * total / PHONE_MASS
        out[f"{name}_press"] = total * g * half / (PHONE_HALF - half) if PHONE_HALF > half else math.inf
        if name == "side":
            out["side_push"] = total * g * (SIDE_FOOT_Y[1] - centre[1]) / p.side_pivot_height
    return out


def number_views(p: Params) -> list[tuple[str, float, float]]:
    """Views of a number on a locomotive's side: (label, distance, cosine of the view to the side's normal)."""
    lens = p.deck_top + p.mast_height + lens_position(p, 0.0)[1] - p.rail_top
    views = []
    for offset in (p.track_spacing, 1.5 * p.track_spacing):
        dy, dz = offset - 17.0, lens - 20.0
        dist = math.hypot(dy, dz)
        views.append((f"bridge, mast {offset:.0f} mm beside the track", dist, dy / dist))
    for d in (100.0, 150.0, 200.0):
        views.append((f"side stand, {d:.0f} mm from the locomotive's side", d, 1.0))
    return views


def number_pixels(distance_mm: float, hfov_deg: float, width_px: int, char_mm: float = 2.0, cos_view: float = 1.0):
    """Height in pixels of a character of ``char_mm`` seen from ``distance_mm`` by a camera of that field."""
    px_per_mm = width_px / (2 * distance_mm * math.tan(math.radians(hfov_deg / 2)))
    return char_mm * cos_view * px_per_mm


# -------------------------------------------------------------------------------------------- STL output


def mesh_arrays(m: Manifold) -> tuple[np.ndarray, np.ndarray]:
    mesh = m.to_mesh()
    return np.asarray(mesh.vert_properties)[:, :3].astype(np.float64), np.asarray(mesh.tri_verts).astype(np.int64)


def write_stl(m: Manifold, path: Path, name: str) -> None:
    v, t = mesh_arrays(m)
    tri = v[t]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    rec = np.zeros(len(t), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"] = n
    rec["v"] = tri
    header = f"ARail-EBL camera bridge: {name}".encode("ascii")[:80].ljust(80, b" ")
    with open(path, "wb") as f:
        f.write(header)
        f.write(struct.pack("<I", len(t)))
        f.write(rec.tobytes())


def read_stl(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Read a binary STL: (triangles n x 3 x 3, normals)."""
    data = path.read_bytes()
    count = struct.unpack("<I", data[80:84])[0]
    rec = np.frombuffer(data[84 : 84 + 50 * count], dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    return rec["v"].astype(np.float64), rec["n"].astype(np.float64)


def stl_volume(tris: np.ndarray) -> float:
    return float(np.einsum("ij,ij->i", tris[:, 0], np.cross(tris[:, 1], tris[:, 2])).sum() / 6.0)


# ------------------------------------------------------------------------------------------- rendering


def look_at(eye, target, up=(0.0, 0.0, 1.0)):
    eye, target, up = (np.asarray(x, float) for x in (eye, target, up))
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return eye, r, u, f


def render(items, eye, target, size=(1600, 1000), fov=30.0, ss=2, background=(255, 255, 255)) -> np.ndarray:
    """A small z-buffer renderer with flat shading and outlines. ``items``: [(Manifold, (r, g, b))]."""
    W, H = size[0] * ss, size[1] * ss
    eye, r, u, f = look_at(eye, target)
    focal = (H / 2) / math.tan(math.radians(fov / 2))
    depth = np.full((H, W), np.inf)
    color = np.zeros((H, W, 3))
    color[:] = np.asarray(background, float) / 255
    normal = np.zeros((H, W, 3))
    light = np.array([-0.45, -0.55, 0.70])
    light /= np.linalg.norm(light)
    fill = np.array([0.6, 0.3, 0.4])
    fill /= np.linalg.norm(fill)
    for m, rgb in items:
        v, t = mesh_arrays(m)
        if len(t) == 0:
            continue
        rel = v - eye
        cx, cy, cz = rel @ r, rel @ u, rel @ f
        sx = W / 2 + focal * cx / cz
        sy = H / 2 - focal * cy / cz
        tri_n = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
        tri_n /= np.maximum(np.linalg.norm(tri_n, axis=1, keepdims=True), 1e-12)
        shade = 0.42 + 0.48 * np.clip(tri_n @ light, 0, 1) + 0.18 * np.clip(tri_n @ fill, 0, 1)
        base = np.asarray(rgb, float) / 255
        for i in range(len(t)):
            a, b, c = t[i]
            if cz[a] <= 1 or cz[b] <= 1 or cz[c] <= 1:
                continue
            x0, y0, x1, y1, x2, y2 = sx[a], sy[a], sx[b], sy[b], sx[c], sy[c]
            area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
            if area >= 0:  # back face (screen y points down)
                continue
            ix0, ix1 = max(int(min(x0, x1, x2)), 0), min(int(max(x0, x1, x2)) + 1, W)
            iy0, iy1 = max(int(min(y0, y1, y2)), 0), min(int(max(y0, y1, y2)) + 1, H)
            if ix0 >= ix1 or iy0 >= iy1:
                continue
            px, py = np.meshgrid(np.arange(ix0, ix1) + 0.5, np.arange(iy0, iy1) + 0.5)
            w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area
            w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area
            w2 = 1 - w0 - w1
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not inside.any():
                continue
            iz = w0 / cz[a] + w1 / cz[b] + w2 / cz[c]
            z = 1 / np.where(inside, iz, 1e-9)
            region = depth[iy0:iy1, ix0:ix1]
            closer = inside & (z < region)
            if not closer.any():
                continue
            region[closer] = z[closer]
            color[iy0:iy1, ix0:ix1][closer] = base * shade[i]
            normal[iy0:iy1, ix0:ix1][closer] = tri_n[i]
    # outlines where the surface turns or jumps
    edge = np.zeros((H, W), bool)
    finite = np.isfinite(depth)
    d = np.where(finite, depth, 1e9)
    for dy, dx in ((0, 1), (1, 0)):
        n1 = normal[: H - dy, : W - dx]
        n2 = normal[dy:, dx:]
        turn = (n1 * n2).sum(axis=2) < 0.85
        d1, d2 = d[: H - dy, : W - dx], d[dy:, dx:]
        jump = np.abs(d1 - d2) > 0.02 * np.minimum(d1, d2)
        e = (turn | jump) & (finite[: H - dy, : W - dx] | finite[dy:, dx:])
        edge[: H - dy, : W - dx] |= e
    color[edge] *= 0.35
    img = color.reshape(size[1], ss, size[0], ss, 3).mean(axis=(1, 3))
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)


def crop(img: np.ndarray, margin: int = 24, background: int = 255) -> np.ndarray:
    """Cut an image down to what is drawn on it, with a margin."""
    drawn = np.argwhere((img < background - 2).any(axis=2))
    if len(drawn) == 0:
        return img
    (y0, x0), (y1, x1) = drawn.min(axis=0), drawn.max(axis=0)
    h, w, _ = img.shape
    return img[max(y0 - margin, 0) : min(y1 + margin + 1, h), max(x0 - margin, 0) : min(x1 + margin + 1, w)]


def write_png(img: np.ndarray, path: Path) -> None:
    img = crop(img)
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


# Colours: steel of the bridge, concrete, the phone, the knobs in the chair's blue, a red locomotive.
STEEL = (150, 160, 172)
CONCRETE = (196, 192, 184)
DARK = (52, 56, 62)
BLUE = (0, 105, 180)
RED = (200, 30, 30)
TABLE = (190, 222, 205)
CABLE = (30, 30, 30)


def _track(y: float, x0: float, x1: float) -> list[tuple[Manifold, tuple[int, int, int]]]:
    sleepers = []
    x = x0
    while x < x1:
        sleepers.append(box(x, x + 2.6, y - 15, y + 15, 0, 2.2))
        x += 7.0
    rails = [box(x0, x1, y + s * 8.25 - 0.9, y + s * 8.25 + 0.9, 2.2, 6.0) for s in (-1, 1)]
    return [(union(sleepers), (120, 92, 70)), (union(rails), (110, 110, 110))]


def _train(p: Params, y: float, x0: float) -> list[tuple[Manifold, tuple[int, int, int]]]:
    rail = p.rail_top
    loco = Manifold.batch_hull(
        [
            box(x0, x0 + 180, y - 17, y + 17, rail + 8, rail + 40),
            box(x0 + 6, x0 + 174, y - 12, y + 12, rail + 40, rail + 46),
        ]
    )
    bogies = union([box(x0 + bx, x0 + bx + 32, y - 13, y + 13, rail + 1, rail + 9) for bx in (20, 128)])
    number = union(
        [
            box(x0 + bx, x0 + bx + 22, y + s * 17.05 - 0.15, y + s * 17.05 + 0.15, rail + 22, rail + 26)
            for bx in (12, 146)
            for s in (-1, 1)
        ]
    )
    wagon_x = x0 + 186
    wagon = box(wagon_x, wagon_x + 160, y - 15, y + 15, rail + 9, rail + 34)
    return [(loco, RED), (bogies, DARK), (number, (250, 250, 250)), (wagon, (120, 70, 50))]


def _cable(points: list[tuple[float, float, float]], d: float) -> Manifold:
    balls = [Manifold.sphere(d / 2, 16).translate(pt) for pt in points]
    return union([Manifold.batch_hull([balls[i], balls[i + 1]]) for i in range(len(balls) - 1)])


def scene(p: Params, mast_y: float = 0.0, tilt: float = 15.0):
    """The bridge with a phone over two tracks, a train, the troughs and the cable: for the guide."""
    items: list[tuple[Manifold, tuple[int, int, int]]] = []
    items.append((box(-260, 300, -175, 120, -3, 0), TABLE))
    for y in p.track_centres:
        items += _track(y, -250, 290)
    items += _train(p, p.track_centres[0], -150)
    asm = bridge_assembly(p, mast_y=mast_y, tilt=tilt)
    colours = {"phone": DARK, "knob": BLUE}
    for name, m in asm.items():
        rgb = next((c for k, c in colours.items() if name.startswith(k)), STEEL)
        items.append((m, rgb))
    # troughs from column A's foot along +x, a bend away from the tracks, a short piece to the table's edge
    a = p.col_axis
    R = p.trough_bend_radius
    x0 = max(22.0, p.foot_length / 2)
    x_e = x0 + p.trough_length
    bend = trough_curve(p, R, 90.0, 8.0).rotate((0, 0, -90)).mirror((0, 1, 0)).translate((x_e + 8, -a - R, 0))
    xb, yb = x_e + 8 + R, -a - R - 8
    short = trough_straight(p, p.trough_short).rotate((0, 0, -90)).translate((xb, yb, 0))
    for m in (trough_straight(p, p.trough_length).translate((x0, -a, 0)), bend, short):
        items.append((m, CONCRETE))
    lid_z = p.trough_h - 1.4
    items.append((lid_straight(p, p.trough_length).translate((x0 + 0.15, -a, lid_z)), CONCRETE))
    items.append((lid_straight(p, p.trough_short).rotate((0, 0, -90)).translate((xb, yb - 0.15, lid_z)), CONCRETE))
    zc = 1.8 + 0.4 * p.cable_d
    deck = p.deck_top
    tray_x = p.girder_w / 2 + p.tray_w / 2
    tray_z = p.clear_height + p.girder_h - 1.0 - 0.6 * p.cable_d
    c45 = math.cos(math.radians(45)) * R
    pts = [
        (xb, yb - p.trough_short + 3, zc),
        (xb, yb, zc),
        (x_e + 8 + c45, -a - R + c45, zc),
        (x_e + 8, -a, zc),
        (x0 + 2, -a, zc),
        (24, -a, zc),
        (4.0, -a, zc + 6),
        (4.0, -a, 40),
        (4.0, -a, p.clear_height - 8),
        (tray_x, -a, tray_z),
        (tray_x, mast_y - 14 - 8, tray_z),
        (tray_x, mast_y - 14, deck + 4),
        (tray_x, mast_y - 14, deck + 22),
        (-40, mast_y - 8, deck + p.mast_height + 22),
        (-79, mast_y, deck + p.mast_height + 19),
    ]
    items.append((_cable(pts, p.cable_d * 0.8), CABLE))
    return items


def fit_view(m: Manifold, direction: tuple[float, float, float], fov: float = 30.0):
    """A camera looking at the part from ``direction`` and far enough to see all of it."""
    x0, y0, z0, x1, y1, z1 = m.bounding_box()
    centre = np.array([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
    radius = 0.5 * math.dist((x0, y0, z0), (x1, y1, z1))
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    return tuple(centre + d * radius / math.sin(math.radians(fov / 2)) * 1.05), tuple(centre)


def parts_overview(p: Params) -> list[tuple[Manifold, tuple[int, int, int]]]:
    """One of every part as it is printed, laid out in rows: the flat parts in front, the tall ones behind."""
    rows = [
        ["trough-straight", "trough-short", "trough-curve", "trough-bend", "connector"],
        ["lid-straight", "lid-short", "lid-curve", "lid-bend"],
        ["cradle", "jaw", "jaw", "knob", "knob", "knob", "knob"],
        ["girder"],
        ["column-a", "column-b", "mast", "slot-nut", "side-stand"],
    ]
    catalogue = {part.name: part for part in parts_catalogue(p)}
    items = []
    y = 0.0
    for row in rows:
        built = []
        for name in row:
            m = catalogue[name].build()
            if name == "girder":
                m = m.rotate((0, 0, 90))
            built.append((name, m))
        depth = max(m.bounding_box()[4] - m.bounding_box()[1] for _, m in built)
        x = 0.0
        for name, m in built:
            x0, y0, _, x1, y1, _ = m.bounding_box()
            rgb = CONCRETE if name.startswith(("trough", "lid", "connector")) else BLUE if name == "knob" else STEEL
            items.append((m.translate((x - x0, y - y0, 0)), rgb))
            x += x1 - x0 + 10
        y += depth + 18
    return items


def render_previews(p: Params, out: Path) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    written = []
    img = render(scene(p, tilt=-15.0), eye=(470, -420, 300), target=(25, -30, 75), size=(1600, 1050), fov=30)
    written.append(out / "camera-bridge.png")
    write_png(img, written[-1])
    side = [(box(-150, 150, -80, 170, -3, 0), TABLE)]
    side += _track(140.0, -140, 140)
    side += _train(p, 140.0, -100)
    for name, m in side_assembly(p).items():
        side.append((m, DARK if name == "phone" else BLUE if name.startswith("knob") else STEEL))
    img = render(side, eye=(260, -60, 300), target=(0, 50, 30), size=(1200, 900), fov=30)
    written.append(out / "side-camera.png")
    write_png(img, written[-1])
    overview = parts_overview(p)
    eye, centre = fit_view(union([m for m, _ in overview]), (0.25, -0.9, 1.1))
    img = render(overview, eye, centre, size=(1600, 1050), fov=30)
    written.append(out / "parts.png")
    write_png(img, written[-1])
    for part in parts_catalogue(p):
        m = part.build()
        rgb = CONCRETE if "trough" in part.name or "lid" in part.name else STEEL
        eye, centre = fit_view(m, (1.0, -1.25, 0.9))
        img = render([(m, rgb)], eye, centre, size=(800, 600), fov=30)
        written.append(out / f"{part.name}.png")
        write_png(img, written[-1])
    return written


# ------------------------------------------------------------------------------------------------- main


def params_from_args(args: argparse.Namespace) -> Params:
    p = Params()
    for field in dataclasses.fields(Params):
        value = getattr(args, field.name, None)
        if value is not None:
            setattr(p, field.name, value)
    return p


PARAM_HELP = {
    "tracks": "tracks under the bridge",
    "track_spacing": "centre to centre of the tracks, mm",
    "side_clear": "outer track's centre to a column's inner face, mm",
    "clear_height": "table to the girder's underside, mm",
    "rail_top": "table to the top of the rails, mm (for the report)",
    "cable_d": "diameter of the charging cable, mm",
    "phone_t_max": "thickest phone with its case, mm",
    "mast_height": "deck to the tilt axis, mm",
    "side_pivot_height": "table to the tilt axis of the side stand, mm",
    "foot_length": "the columns' slabs along the track, mm",
    "side_foot_length": "the side stand's foot along the track, mm",
    "trough_length": "long cable trough, mm",
    "trough_short": "short cable trough, mm",
    "trough_curve_radius": "centre line of the curved trough, mm",
    "trough_curve_angle": "angle of the curved trough, degrees",
    "trough_bend_radius": "centre line of the 90 degree bend, mm",
    "fit": "clearance of parts that fit into each other, mm",
}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for field in dataclasses.fields(Params):
        if field.name not in PARAM_HELP:
            continue
        kind = int if field.type == "int" else float
        flag = "--" + field.name.replace("_", "-")
        ap.add_argument(flag, type=kind, default=None, help=f"{PARAM_HELP[field.name]} (default {field.default:g})")
    ap.add_argument("--out", type=Path, help="write the STL files into this folder")
    ap.add_argument("--only", nargs="*", help="only these parts (names as in the file names)")
    ap.add_argument("--render", type=Path, help="write PNG previews into this folder")
    ap.add_argument("--report", action="store_true", help="print clearances, ranges and lens heights")
    args = ap.parse_args(argv)
    p = params_from_args(args)
    if not (args.out or args.render or args.report):
        ap.print_help()
        return 1
    if args.report:
        print(report(p))
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        for part in parts_catalogue(p):
            if args.only and part.name not in args.only:
                continue
            m = part.build()
            if m.status().name != "NoError" or m.is_empty():
                print(f"{part.name}: invalid ({m.status()})", file=sys.stderr)
                return 2
            write_stl(m, args.out / f"{part.name}.stl", part.name)
            x0, y0, z0, x1, y1, z1 = m.bounding_box()
            print(
                f"{part.name:16s} x{part.count}  {x1 - x0:6.1f} x {y1 - y0:6.1f} x {z1 - z0:6.1f} mm  "
                f"{m.volume() / 1000:6.2f} cm3  {part.note}"
            )
    if args.render:
        for path in render_previews(p, args.render):
            print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
