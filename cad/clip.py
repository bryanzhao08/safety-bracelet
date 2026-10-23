#!/usr/bin/env python3
"""
Homebound Hardware: Wristband NFC Clip & Adhesive Tag Carrier Generator

Builds 3D-printable clips that hold a 25 mm round NTAG213/NTAG216 NFC sticker
and slide onto disposable Tyvek event wristbands (19 mm and 25 mm widths).
Also builds Variant B: a flat adhesive tag carrier with two slits.

Generates STEP (for Onshape) and STL (for 3D printing), plus PNG previews.
"""

import os
import sys
import numpy as np
import cadquery as cq
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection


def make_clip(
    band_width: float = 25.0,
    slot_clearance: float = 1.0,
    slot_height: float = 0.8,
    sticker_diam: float = 25.5,
    sticker_depth: float = 1.0,
    total_thickness: float = 4.0,
    body_length: float = 44.0,
    min_wall: float = 1.2,
) -> cq.Workplane:
    """
    Constructs a snap-on / slide-on wristband clip.

    Features:
      - 2 belt-loop slots (slot_height x (band_width + slot_clearance))
      - Recessed round pocket for 25 mm NFC sticker (sticker_diam x sticker_depth)
      - Printed short-code flat recess (13.0 x 8.0 x 0.4 mm)
      - Lead-in chamfers at the slot openings for snag-free band insertion
      - Bottom window between belt loops for fingertip guidance and easy printing
      - Rounded outer vertical and horizontal edges for wrist comfort
      - Support-free FDM 3D printing with min wall thickness >= 1.2 mm
    """
    slot_width = band_width + slot_clearance
    body_width = max(28.5, slot_width + 2.0 * min_wall)

    # 1. Base solid block
    base = cq.Workplane("XY").rect(body_length, body_width).extrude(total_thickness)

    # 2. Fillet outer corners and perimeter edges
    base = base.edges("|Z").fillet(3.0)
    base = base.faces(">Z").edges().fillet(0.6)
    base = base.faces("<Z").edges().fillet(0.6)

    # 3. Recessed sticker pocket on top face (Z = total_thickness down by sticker_depth)
    # Centered at X = -6.0 mm so short code fits at X = +12.5 mm
    pocket_x = -6.0
    pocket = (
        base.faces(">Z")
        .workplane()
        .center(pocket_x, 0)
        .circle(sticker_diam / 2.0)
        .cutBlind(-sticker_depth)
    )

    # 4. Short-code recess area (0.4 mm deep) for sticker or handwritten code
    code_pad_x = 12.5
    code_pad = (
        pocket.faces(">Z")
        .workplane()
        .center(code_pad_x, 0)
        .rect(13.0, 8.0)
        .cutBlind(-0.4)
    )

    # 5. Belt-loop slot tunnel through the body
    # Slot floor at Z = 1.1 mm (giving 1.1 mm base wall)
    # Slot ceiling at Z = 1.1 + 0.8 = 1.9 mm
    # Divider floor under sticker pocket = 3.0 - 1.9 = 1.1 mm (or 1.2 mm with 4.1 mm)
    slot_center_z = -(total_thickness / 2.0 - 1.1 - slot_height / 2.0)
    slot = (
        code_pad.faces("<X")
        .workplane()
        .center(0, slot_center_z)
        .rect(slot_width, slot_height)
        .cutThruAll()
    )

    # 6. Lead-in funnels at slot entrance and exit (makes inserting flexible Tyvek easy)
    entry = (
        slot.faces("<X")
        .workplane()
        .center(0, slot_center_z)
        .rect(slot_width + 1.2, slot_height + 0.6)
        .cutBlind(-1.0)
    )
    exit_mouth = (
        entry.faces(">X")
        .workplane()
        .center(0, slot_center_z)
        .rect(slot_width + 1.2, slot_height + 0.6)
        .cutBlind(-1.0)
    )

    # 7. Bottom finger window between belt loops
    # Forms two defined 13 mm belt loops while keeping side rails on the print bed
    window_width = max(14.0, slot_width - 4.0)
    window_length = 16.0
    final_clip = (
        exit_mouth.faces("<Z")
        .workplane()
        .center(0, 0)
        .rect(window_length, window_width)
        .cutBlind(-1.1)
    )

    return final_clip


def make_carrier(
    band_width: float = 25.0,
    slot_clearance: float = 1.0,
    sticker_diam: float = 25.5,
    sticker_depth: float = 1.0,
    total_thickness: float = 2.2,
    body_length: float = 44.0,
) -> cq.Workplane:
    """
    Constructs Variant B: Flat adhesive tag carrier.

    A flat plate with:
      - 25.5 mm x 1.0 mm sticker pocket
      - Two slits (through-holes) for threading the Tyvek band
      - Flat back suitable for double-sided adhesive tape
      - 2.2 mm low-profile thickness
    """
    slit_width = band_width + slot_clearance
    body_width = max(28.5, slit_width + 4.0)

    carrier = cq.Workplane("XY").rect(body_length, body_width).extrude(total_thickness)
    carrier = carrier.edges("|Z").fillet(3.0)
    carrier = carrier.faces(">Z").edges().fillet(0.4)
    carrier = carrier.faces("<Z").edges().fillet(0.4)

    # Center sticker pocket
    carrier = (
        carrier.faces(">Z")
        .workplane()
        .circle(sticker_diam / 2.0)
        .cutBlind(-sticker_depth)
    )

    # Two through-slits
    slit_thickness = 1.4
    carrier = (
        carrier.faces(">Z")
        .workplane()
        .center(-16.0, 0)
        .rect(slit_thickness, slit_width)
        .cutThruAll()
    )
    carrier = (
        carrier.faces(">Z")
        .workplane()
        .center(16.0, 0)
        .rect(slit_thickness, slit_width)
        .cutThruAll()
    )

    return carrier


# Disposable concert / festival bands the slider fits. The band is threaded through the slider before
# the band is closed (Tyvek: before peeling the adhesive liner; woven: before crimping the lock bead).
SLIDER_BANDS = {
    # name: (channel width, channel height, grip ridge height)
    "tyvek_19": (20.0, 0.9, 0.30),   # 19 mm Tyvek, ~0.15 mm thick (also fits 0.4 mm vinyl snap bands)
    "tyvek_25": (26.0, 0.9, 0.30),   # 25 mm (1") Tyvek
    "woven_15": (16.0, 1.6, 0.40),   # 15 mm woven fabric festival band, ~1.0-1.2 mm thick
}


def make_slider(
    channel_w: float,
    channel_h: float,
    ridge_h: float,
    sticker_diam: float = 25.5,
    sticker_depth: float = 1.0,
    floor: float = 1.0,
    roof: float = 1.2,
    length: float = 32.0,
    wall: float = 1.4,
) -> cq.Workplane:
    """
    Slide-on NFC tag holder for disposable wristbands.

    The band runs along X through a closed channel, so the slider can't fall off once the band is
    closed. Two low ridges on the channel floor pinch the band so the slider stays where it's put
    instead of spinning around the wrist. Prints flat, pocket up, no supports (the channel roof is a
    short bridge).
    """
    width = max(sticker_diam + 2 * 1.2, channel_w + 2 * wall)
    height = floor + channel_h + roof + sticker_depth

    body = cq.Workplane("XY").box(length, width, height, centered=(True, True, False))
    body = body.edges("|Z").fillet(3.0)
    body = body.faces(">Z").edges().fillet(0.6)
    body = body.faces("<Z").edges().fillet(0.6)

    def block(dx, dy, dz, z0, x=0.0):
        return cq.Workplane("XY").box(dx, dy, dz, centered=(True, True, False)).translate((x, 0, z0))

    # Band channel, open at both ends, with flared mouths so the band end finds its way in
    body = body.cut(block(length + 2, channel_w, channel_h, floor))
    for x in (-(length / 2), length / 2):
        body = body.cut(block(3.0, channel_w + 1.0, channel_h + 0.5, floor - 0.25, x))

    # Grip ridges across the band
    for x in (-8.0, 8.0):
        body = body.union(block(1.0, channel_w, ridge_h, floor, x))

    # Tag pocket on top
    body = body.cut(
        cq.Workplane("XY").circle(sticker_diam / 2).extrude(sticker_depth).translate((0, 0, height - sticker_depth))
    )
    return body


# Fold-and-snap clip: the cheapest option. One flat print (~3 g, a few cents of PLA), clips onto a band that's already on someone's
# wrist. Lay the band across the base, fold the lid over, press: two pegs punch through the band and snap into
# the base. The 20 mm NFC sticker ends up sealed inside, between lid and band. Cut the band off to remove.
SNAP_BANDS = {
    # name: (band width, gap for band thickness)
    "tyvek_19": (19.0, 0.4),
    "tyvek_25": (25.0, 0.4),
    "woven_15": (15.0, 1.3),
}


def make_snap_clip(
    band_w: float,
    band_gap: float,
    length: float = 32.0,
    base_t: float = 1.8,
    lid_t: float = 1.6,
    hinge_t: float = 0.45,
    hinge_len: float = 4.5,
    sticker_diam: float = 20.5,
    sticker_depth: float = 0.6,
    peg_x: float = 13.0,
    peg_r: float = 0.95,
    hole_r: float = 1.1,
    barb_r: float = 1.35,
    barb_h: float = 0.8,
    rail_w: float = 1.2,
) -> cq.Workplane:
    """
    One-piece fold-over clip with a living hinge, laid out flat for printing (no supports).

    Base at y = 0, lid at y = width + hinge_len, joined by a thin hinge strip along X. Pegs on the lid's inner
    face go through the band and the base holes; the barbed tips catch in a counterbore on the base underside,
    so they sit flush and nothing sharp touches the wrist.
    """
    width = max(sticker_diam + 2.4, band_w + 1.0 + 2 * rail_w)
    lid_y = width + hinge_len

    def plate(t, y):
        p = cq.Workplane("XY").box(length, width, t, centered=(True, True, False)).translate((0, y, 0))
        return p.edges("|Z").fillet(2.5)

    # Base: rails either side of the band, peg holes with a counterbore underneath for the barbs
    base = plate(base_t, 0)
    for side in (-1, 1):
        y = side * (band_w / 2 + 0.5 + rail_w / 2)
        if abs(y) + rail_w / 2 <= width / 2:
            base = base.union(
                cq.Workplane("XY").box(length - 5, rail_w, band_gap, centered=(True, True, False)).translate((0, y, base_t))
            )
    for x in (-peg_x, peg_x):
        base = base.cut(cq.Workplane("XY").circle(hole_r).extrude(base_t + band_gap).translate((x, 0, 0)))
        base = base.cut(cq.Workplane("XY").circle(barb_r + 0.25).extrude(barb_h).translate((x, 0, 0)))
        base = base.cut(  # lead-in so the peg finds the hole
            cq.Workplane("XY").circle(hole_r).workplane(offset=0.5).circle(hole_r + 0.5).loft()
            .translate((x, 0, base_t - 0.5))
        )

    # Lid: sticker pocket and barbed pegs on the inner (printed-up) face
    lid = plate(lid_t, lid_y)
    lid = lid.cut(cq.Workplane("XY").circle(sticker_diam / 2).extrude(sticker_depth).translate((0, lid_y, lid_t - sticker_depth)))
    shaft = band_gap + base_t - barb_h
    for x in (-peg_x, peg_x):
        peg = cq.Workplane("XY").circle(peg_r).extrude(shaft).translate((x, lid_y, lid_t))
        barb = (
            cq.Workplane("XY").circle(barb_r).workplane(offset=barb_h).circle(0.6).loft()
            .translate((x, lid_y, lid_t + shaft))
        )
        lid = lid.union(peg).union(barb)

    hinge = cq.Workplane("XY").box(length - 8, hinge_len + 2, hinge_t, centered=(True, True, False)).translate(
        (0, width / 2 + hinge_len / 2, 0)
    )
    return base.union(hinge).union(lid)


def render_preview(
    shape: cq.Workplane,
    out_png: str,
    title: str,
    dimensions_text: str,
    base_color=(0.20, 0.45, 0.70),
) -> None:
    """
    Renders a clean multi-view (3D perspective + top orthographic) PNG preview
    using Matplotlib and Lambertian directional lighting.
    """
    verts, tris = shape.val().tessellate(0.2)
    v_np = np.array([[v.x, v.y, v.z] for v in verts])

    tri_pts = v_np[list(tris)]
    vec1 = tri_pts[:, 1] - tri_pts[:, 0]
    vec2 = tri_pts[:, 2] - tri_pts[:, 0]
    normals = np.cross(vec1, vec2)
    norm_lens = np.linalg.norm(normals, axis=1, keepdims=True)
    norm_lens[norm_lens == 0] = 1.0
    normals = normals / norm_lens

    light_dir = np.array([0.4, 0.3, 0.8])
    light_dir = light_dir / np.linalg.norm(light_dir)
    dots = np.clip(np.sum(normals * light_dir, axis=1), 0.0, 1.0)
    intensities = 0.35 + 0.65 * dots

    color_arr = np.array(base_color)
    face_colors = intensities[:, None] * color_arr

    fig = plt.figure(figsize=(12, 6), dpi=150)

    # 1. 3D Perspective Subplot
    ax1 = fig.add_subplot(121, projection="3d")
    mesh = Poly3DCollection(
        tri_pts, facecolors=face_colors, edgecolors="#1a365d", linewidths=0.15
    )
    ax1.add_collection3d(mesh)

    min_xyz = np.min(v_np, axis=0)
    max_xyz = np.max(v_np, axis=0)
    mid_xyz = (min_xyz + max_xyz) / 2.0
    max_range = np.max(max_xyz - min_xyz) / 2.0 * 1.15

    ax1.set_xlim(mid_xyz[0] - max_range, mid_xyz[0] + max_range)
    ax1.set_ylim(mid_xyz[1] - max_range, mid_xyz[1] + max_range)
    ax1.set_zlim(mid_xyz[2] - max_range, mid_xyz[2] + max_range)
    ax1.view_init(elev=28, azim=-55)
    ax1.set_title("3D Isometric View", fontsize=11, fontweight="bold")
    ax1.set_xlabel("X (mm) [Length]")
    ax1.set_ylabel("Y (mm) [Width]")
    ax1.set_zlabel("Z (mm) [Height]")

    # 2. Top View Subplot
    ax2 = fig.add_subplot(122)
    ax2.set_aspect("equal")
    ax2.set_title("Top View (X-Y Projection)", fontsize=11, fontweight="bold")
    ax2.set_xlabel("X (mm) [Length]")
    ax2.set_ylabel("Y (mm) [Width]")

    top_mask = normals[:, 2] > 0.4
    for poly in tri_pts[top_mask]:
        ax2.fill(
            poly[:, 0],
            poly[:, 1],
            color="#3498db",
            alpha=0.35,
            edgecolor="#1d4ed8",
            linewidth=0.5,
        )

    ax2.set_xlim(mid_xyz[0] - max_range, mid_xyz[0] + max_range)
    ax2.set_ylim(mid_xyz[1] - max_range, mid_xyz[1] + max_range)
    ax2.grid(True, linestyle="--", alpha=0.5)

    fig.suptitle(title, fontsize=13, fontweight="bold", y=0.98)
    fig.text(
        0.5,
        0.02,
        dimensions_text,
        ha="center",
        fontsize=9,
        style="italic",
        bbox=dict(
            boxstyle="round,pad=0.5", facecolor="#f8fafc", edgecolor="#cbd5e1"
        ),
    )

    plt.tight_layout(rect=[0, 0.05, 1, 0.95])
    plt.savefig(out_png, dpi=150)
    plt.close()
    print(f"Rendered: {out_png}")


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "out")
    os.makedirs(out_dir, exist_ok=True)

    print("Building Homebound CAD models...")

    # 1. 19 mm wristband clip
    print("Generating 19 mm clip...")
    clip_19 = make_clip(band_width=19.0)
    step_19 = os.path.join(out_dir, "clip_19mm.step")
    stl_19 = os.path.join(out_dir, "clip_19mm.stl")
    png_19 = os.path.join(out_dir, "clip_19mm.png")
    cq.exporters.export(clip_19, step_19)
    cq.exporters.export(clip_19, stl_19)
    render_preview(
        clip_19,
        png_19,
        "Homebound NFC Wristband Clip (19 mm Band)",
        "Outer: 44.0 x 28.5 x 4.0 mm | Pocket: Ø25.5 x 1.0 mm | Slot: 20.0 x 0.8 mm | Min Wall: 1.2 mm",
        base_color=(0.18, 0.50, 0.65),
    )

    # 2. 25 mm wristband clip
    print("Generating 25 mm clip...")
    clip_25 = make_clip(band_width=25.0)
    step_25 = os.path.join(out_dir, "clip_25mm.step")
    stl_25 = os.path.join(out_dir, "clip_25mm.stl")
    png_25 = os.path.join(out_dir, "clip_25mm.png")
    cq.exporters.export(clip_25, step_25)
    cq.exporters.export(clip_25, stl_25)
    render_preview(
        clip_25,
        png_25,
        "Homebound NFC Wristband Clip (25 mm Band)",
        "Outer: 44.0 x 30.0 x 4.0 mm | Pocket: Ø25.5 x 1.0 mm | Slot: 26.0 x 0.8 mm | Min Wall: 1.2 mm",
        base_color=(0.20, 0.45, 0.70),
    )

    # 3. Flat adhesive carrier (Variant B)
    print("Generating adhesive tag carrier (Variant B)...")
    carrier = make_carrier(band_width=25.0)
    step_carrier = os.path.join(out_dir, "carrier.step")
    stl_carrier = os.path.join(out_dir, "carrier.stl")
    png_carrier = os.path.join(out_dir, "carrier.png")
    cq.exporters.export(carrier, step_carrier)
    cq.exporters.export(carrier, stl_carrier)
    render_preview(
        carrier,
        png_carrier,
        "Homebound NFC Adhesive Tag Carrier (Variant B)",
        "Outer: 44.0 x 30.0 x 2.2 mm | Pocket: Ø25.5 x 1.0 mm | Slits: 26.0 x 1.4 mm | Flat back",
        base_color=(0.25, 0.55, 0.40),
    )

    # 4. Slide-on holders for disposable concert bands
    for name, (cw, ch, rh) in SLIDER_BANDS.items():
        print(f"Generating slider_{name}...")
        slider = make_slider(cw, ch, rh)
        bb = slider.val().BoundingBox()
        base = os.path.join(out_dir, f"slider_{name}")
        cq.exporters.export(slider, base + ".step")
        cq.exporters.export(slider, base + ".stl")
        render_preview(
            slider,
            base + ".png",
            f"Homebound slide-on NFC holder ({name.replace('_', ' ')} band)",
            f"Outer: {bb.xlen:.1f} x {bb.ylen:.1f} x {bb.zlen:.1f} mm | Channel: {cw:.1f} x {ch:.1f} mm "
            f"| Grip ridges: {rh:.2f} mm | Pocket: Ø25.5 x 1.0 mm",
            base_color=(0.85, 0.35, 0.25),
        )

    # 5. Fold-and-snap clips (cheapest, clip onto a band already on the wrist)
    for name, (bw, gap) in SNAP_BANDS.items():
        print(f"Generating snap_{name}...")
        snap = make_snap_clip(bw, gap)
        base = os.path.join(out_dir, f"snap_{name}")
        cq.exporters.export(snap, base + ".step")
        cq.exporters.export(snap, base + ".stl")
        render_preview(
            snap,
            base + ".png",
            f"Homebound fold-and-snap NFC clip ({name.replace('_', ' ')} band), print layout",
            f"Folded: 32 x {max(22.9, bw + 3.4):.1f} x {1.8 + gap + 1.6:.1f} mm | Ø20 NFC sticker sealed inside "
            f"| 2 barbed pegs punch through band | ~3 g PLA",
            base_color=(0.95, 0.65, 0.15),
        )

    print("\nAll CAD models successfully generated in cad/out/:")
    for f in sorted(os.listdir(out_dir)):
        p = os.path.join(out_dir, f)
        print(f"  - {f} ({os.path.getsize(p):,} bytes)")


if __name__ == "__main__":
    main()
