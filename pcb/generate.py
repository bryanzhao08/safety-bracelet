#!/usr/bin/env python3
"""
Homebound Hardware: NFC Tag PCB Generator (KiCad 8/9 S-Expressions)

Generates:
  - pcb/homebound_tag.kicad_pro (KiCad Project file, JSON)
  - pcb/homebound_tag.kicad_sch (KiCad Schematic, S-expression)
  - pcb/homebound_tag.kicad_pcb (KiCad Board layout, S-expression)
  - pcb/out/tag_pcb_top.png (Top layer preview)
  - pcb/out/tag_pcb_layers.png (Composite layer preview)

Antenna Design:
  Tuned planar spiral coil for 13.56 MHz ISO/IEC 14443A NFC.
  Internal tuning capacitance C_tune = 50 pF (NXP NTAG213 / NTAG216).
  Target inductance L ≈ 2.76 µH.
  Calculated using Mohan Modified Wheeler and Mohan Current Sheet formulas.
"""

import math
import os
import uuid
import matplotlib.pyplot as plt
import numpy as np


def compute_antenna_inductance(dout_mm=21.0, w_mm=0.25, s_mm=0.20, n=9):
    """
    Computes planar spiral coil inductance using Wheeler and Mohan formulas.
    """
    mu0 = 4.0 * math.pi * 1e-7  # H/m
    pitch_mm = w_mm + s_mm
    din_mm = dout_mm - 2.0 * n * pitch_mm + 2.0 * s_mm

    dout = dout_mm * 1e-3
    din = din_mm * 1e-3
    davg = 0.5 * (dout + din)
    rho = (dout - din) / (dout + din)

    # 1. Mohan Modified Wheeler (Circular coil: K1=2.21, K2=1.78)
    L_mw_cir = 2.21 * mu0 * (n**2) * davg / (1.0 + 1.78 * rho) * 1e6

    # 2. Mohan Modified Wheeler (Square coil: K1=2.34, K2=2.75)
    L_mw_sq = 2.34 * mu0 * (n**2) * davg / (1.0 + 2.75 * rho) * 1e6

    # 3. Mohan Current Sheet (Circular: c1=1.00, c2=2.46, c3=0.00, c4=0.20)
    L_cs_cir = (
        (mu0 * (n**2) * davg * 1.00 / 2.0)
        * (math.log(2.46 / rho) + 0.20 * (rho**2))
        * 1e6
    )

    # 4. Traditional Wheeler Formula (Planar spiral converted to metric)
    a = davg / 2.0
    c = (dout - din) / 2.0
    L_wh = 31.33 * mu0 * (n**2) * (a**2) / (8.0 * a + 11.0 * c) * 1e6

    # Resonant frequency with C = 50 pF
    C_tune = 50e-12
    f_res_cir = 1.0 / (2.0 * math.pi * math.sqrt(L_mw_cir * 1e-6 * C_tune))

    return {
        "dout_mm": dout_mm,
        "din_mm": din_mm,
        "davg_mm": davg * 1e3,
        "rho": rho,
        "n_turns": n,
        "w_mm": w_mm,
        "s_mm": s_mm,
        "L_mw_cir": L_mw_cir,
        "L_mw_sq": L_mw_sq,
        "L_cs_cir": L_cs_cir,
        "L_wh": L_wh,
        "f_res_cir_mhz": f_res_cir * 1e-6,
    }


def generate_kicad_pro():
    """Returns KiCad 8/9 project file JSON string."""
    return """{
  "board": {
    "design_settings": {
      "rules": {
        "min_clearance": 0.15,
        "min_track_width": 0.15,
        "min_via_annular_ring": 0.15,
        "min_via_diameter": 0.50
      }
    }
  },
  "boards": [],
  "cvpcb": {
    "equivalence_files": []
  },
  "erc": {
    "erc_exclusions": [],
    "meta": {
      "version": 0
    },
    "rule_severities": {}
  },
  "meta": {
    "filename": "homebound_tag.kicad_pro",
    "version": 2
  },
  "net_settings": {
    "classes": [
      {
        "bus_width": 12,
        "clearance": 0.2,
        "diff_pair_gap": 0.25,
        "diff_pair_via_gap": 0.25,
        "diff_pair_width": 0.2,
        "line_style": 0,
        "microvia_diameter": 0.3,
        "microvia_drill": 0.1,
        "name": "Default",
        "pcb_color": "rgba(0, 0, 0, 0.000)",
        "schematic_color": "rgba(0, 0, 0, 0.000)",
        "track_width": 0.25,
        "via_diameter": 0.6,
        "via_drill": 0.3,
        "wire_width": 6
      }
    ]
  },
  "pcbnew": {
    "last_paths": {
      "gencad": "",
      "idf": "",
      "netlist": "",
      "plot": "out/gerbers/",
      "pos": "",
      "specctra_dsn": "",
      "step": "",
      "svg": "",
      "vrml": ""
    },
    "page_layout_descr_file": ""
  },
  "schematic": {
    "annotate_start_num": 1,
    "drawing": {
      "dashed_lines_dash_length_ratio": 12.0,
      "dashed_lines_gap_length_ratio": 3.0,
      "default_line_thickness": 6.0,
      "default_text_size": 50.0,
      "field_names": [],
      "intersheets_ref_own_page": false,
      "intersheets_ref_prefix": "",
      "intersheets_ref_short": false,
      "intersheets_ref_show": false,
      "intersheets_ref_suffix": "",
      "junction_size_choice": 3,
      "junction_size_mult": 1.0,
      "pin_symbol_size": 25.0,
      "text_offset_ratio": 0.15
    },
    "legacy_lib_dir": "",
    "legacy_lib_list": [],
    "meta": {
      "version": 2
    },
    "net_format_name": "",
    "ngspice": {
      "fix_include_paths": true,
      "fix_passive_vals": false,
      "meta": {
        "version": 0
      },
      "model_mode": 0,
      "workbook_filename": ""
    },
    "page_layout_descr_file": "",
    "plot_directory": "",
    "subpart_first_id": 65,
    "subpart_id_separator": 0
  },
  "sheets": [
    [
      "00000000-0000-0000-0000-000000000000",
      ""
    ]
  ],
  "text_variables": {}
}
"""


def generate_kicad_sch():
    """Generates KiCad 8 schematic file string."""
    u_sch = str(uuid.uuid4())
    u_sym1 = str(uuid.uuid4())
    u_sym2 = str(uuid.uuid4())
    u_wire1 = str(uuid.uuid4())
    u_wire2 = str(uuid.uuid4())

    return f"""(kicad_sch
	(version 20231120)
	(generator "pcb/generate.py")
	(generator_version "8.0")
	(uuid "{u_sch}")
	(paper "A4")
	(lib_symbols
		(symbol "homebound:NTAG216"
			(pin_numbers hide)
			(pin_names (offset 1.016))
			(exclude_from_sim no)
			(in_bom yes)
			(on_board yes)
			(property "Reference" "U" (at 0 7.62 0) (effects (font (size 1.27 1.27))))
			(property "Value" "NTAG216" (at 0 -7.62 0) (effects (font (size 1.27 1.27))))
			(property "Footprint" "homebound:XQFN-8_1.6x1.6mm_P0.4mm" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
			(property "Datasheet" "https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
			(property "Description" "NXP NTAG216 NFC Forum Type 2 Tag IC (888 bytes, 50pF)" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
			(symbol "NTAG216_0_1"
				(rectangle (start -6.35 6.35) (end 6.35 -6.35) (stroke (width 0.254) (type solid)) (fill (type background)))
			)
			(symbol "NTAG216_1_1"
				(pin passive line (at -10.16 2.54 0) (length 3.81)
					(name "LA" (effects (font (size 1.27 1.27))))
					(number "1" (effects (font (size 1.27 1.27))))
				)
				(pin passive line (at -10.16 -2.54 0) (length 3.81)
					(name "LB" (effects (font (size 1.27 1.27))))
					(number "8" (effects (font (size 1.27 1.27))))
				)
				(pin passive line (at 10.16 -2.54 180) (length 3.81)
					(name "GND" (effects (font (size 1.27 1.27))))
					(number "4" (effects (font (size 1.27 1.27))))
				)
			)
		)
		(symbol "homebound:ANTENNA_COIL"
			(pin_numbers hide)
			(pin_names (offset 0) hide)
			(exclude_from_sim no)
			(in_bom no)
			(on_board yes)
			(property "Reference" "L" (at 0 5.08 0) (effects (font (size 1.27 1.27))))
			(property "Value" "2.76uH" (at 0 -5.08 0) (effects (font (size 1.27 1.27))))
			(symbol "ANTENNA_COIL_0_1"
				(arc (start -2.54 0) (mid -1.27 1.27) (end 0 0) (stroke (width 0.254) (type solid)) (fill (type none)))
				(arc (start 0 0) (mid 1.27 1.27) (end 2.54 0) (stroke (width 0.254) (type solid)) (fill (type none)))
				(arc (start 2.54 0) (mid 3.81 1.27) (end 5.08 0) (stroke (width 0.254) (type solid)) (fill (type none)))
			)
			(symbol "ANTENNA_COIL_1_1"
				(pin passive line (at -5.08 0 0) (length 2.54)
					(name "1" (effects (font (size 1.27 1.27))))
					(number "1" (effects (font (size 1.27 1.27))))
				)
				(pin passive line (at 7.62 0 180) (length 2.54)
					(name "2" (effects (font (size 1.27 1.27))))
					(number "2" (effects (font (size 1.27 1.27))))
				)
			)
		)
	)
	(symbol
		(lib_id "homebound:NTAG216")
		(at 140 100 0)
		(unit 1)
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(dnp no)
		(uuid "{u_sym1}")
		(property "Reference" "U1" (at 140 91.44 0) (effects (font (size 1.27 1.27))))
		(property "Value" "NTAG216" (at 140 108.56 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "homebound:XQFN-8_1.6x1.6mm_P0.4mm" (at 140 100 0) (effects (font (size 1.27 1.27)) hide))
		(property "Datasheet" "https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf" (at 140 100 0) (effects (font (size 1.27 1.27)) hide))
		(property "Description" "NXP NTAG216 NFC Forum Type 2 Tag IC (888 bytes, 50pF)" (at 140 100 0) (effects (font (size 1.27 1.27)) hide))
		(pin "1" (uuid "{str(uuid.uuid4())}"))
		(pin "8" (uuid "{str(uuid.uuid4())}"))
		(pin "4" (uuid "{str(uuid.uuid4())}"))
	)
	(symbol
		(lib_id "homebound:ANTENNA_COIL")
		(at 100 97.46 0)
		(unit 1)
		(exclude_from_sim no)
		(in_bom no)
		(on_board yes)
		(dnp no)
		(uuid "{u_sym2}")
		(property "Reference" "L1" (at 100 91.44 0) (effects (font (size 1.27 1.27))))
		(property "Value" "2.76uH" (at 100 103.48 0) (effects (font (size 1.27 1.27))))
		(pin "1" (uuid "{str(uuid.uuid4())}"))
		(pin "2" (uuid "{str(uuid.uuid4())}"))
	)
	(wire (pts (xy 94.92 97.46) (xy 94.92 102.54)) (stroke (width 0) (type default)) (uuid "{u_wire1}"))
	(wire (pts (xy 94.92 102.54) (xy 129.84 102.54)) (stroke (width 0) (type default)) (uuid "{u_wire2}"))
	(wire (pts (xy 107.62 97.46) (xy 129.84 97.46)) (stroke (width 0) (type default)) (uuid "{str(uuid.uuid4())}"))
	(sheet_instances
		(path "/" (page "1"))
	)
)
"""


def generate_kicad_pcb(
    board_diam_mm=22.4,
    dout_mm=21.0,
    n_turns=9,
    w_mm=0.25,
    s_mm=0.20,
    steps_per_turn=24,
):
    """
    Generates complete KiCad 8/9 PCB S-expression file with:
      - Board outline on Edge.Cuts (Ø 22.4 mm circle)
      - NXP NTAG216 XQFN-8 footprint with pads
      - 9-turn planar spiral coil tracks on F.Cu
      - 2 Vias (0.6 mm size / 0.3 mm drill)
      - Return bridge trace on B.Cu
      - Silkscreen labels & pin 1 indicator
    """
    x0, y0 = 100.0, 100.0  # KiCad sheet center coordinates
    pitch_mm = w_mm + s_mm
    r_start = (
        dout_mm / 2.0 - n_turns * pitch_mm + s_mm
    )  # Inner start radius (~6.45 mm)
    r_final = dout_mm / 2.0  # Outer end radius (~10.50 mm)

    # 1. Header & Setup
    pcb_lines = [
        "(kicad_pcb",
        "\t(version 20240108)",
        '\t(generator "pcb/generate.py")',
        '\t(generator_version "8.0")',
        "\t(general",
        "\t\t(thickness 0.2)",
        "\t\t(legacy_teardrops no)",
        "\t)",
        '\t(paper "A4")',
        "\t(layers",
        '\t\t(0 "F.Cu" signal)',
        '\t\t(31 "B.Cu" signal)',
        '\t\t(36 "B.SilkS" user "B.Silkscreen")',
        '\t\t(37 "F.SilkS" user "F.Silkscreen")',
        '\t\t(38 "B.Mask" user)',
        '\t\t(39 "F.Mask" user)',
        '\t\t(44 "Edge.Cuts" user)',
        "\t)",
        "\t(setup",
        "\t\t(pad_to_mask_clearance 0.05)",
        "\t\t(pcbplotparams",
        "\t\t\t(layerselection 0x00010fc_ffffffff)",
        "\t\t\t(usegerberextensions yes)",
        "\t\t\t(usegerberattributes yes)",
        "\t\t\t(usegerberadvancedattributes yes)",
        "\t\t\t(creategerberjobfile yes)",
        '\t\t\t(outputdirectory "out/gerbers/")',
        "\t\t)",
        "\t)",
        '\t(net 0 "")',
        '\t(net 1 "ANT_A")',
        '\t(net 2 "ANT_B")',
        '\t(net 3 "GND")',
        "",
        "\t;; --- Board Outline (Ø 22.4 mm circle) ---",
        f'\t(gr_circle (center {x0:.2f} {y0:.2f}) (end {x0 + board_diam_mm/2.0:.2f} {y0:.2f}) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts") (uuid "{uuid.uuid4()}"))',
        "",
        "\t;; --- Silkscreen Text ---",
        f'\t(gr_text "HOMEBOUND NFC" (at {x0:.2f} {y0 - 4.5:.2f} 0) (layer "F.SilkS") (uuid "{uuid.uuid4()}") (effects (font (size 0.9 0.9) (thickness 0.14))))',
        f'\t(gr_text "13.56 MHz" (at {x0:.2f} {y0 + 4.5:.2f} 0) (layer "F.SilkS") (uuid "{uuid.uuid4()}") (effects (font (size 0.8 0.8) (thickness 0.12))))',
        f'\t(gr_text "L=2.76uH C=50pF" (at {x0:.2f} {y0 - 4.0:.2f} 0) (layer "B.SilkS") (uuid "{uuid.uuid4()}") (effects (font (size 0.75 0.75) (thickness 0.12))))',
        f'\t(gr_text "PASSIVE TAG v2" (at {x0:.2f} {y0 + 4.0:.2f} 0) (layer "B.SilkS") (uuid "{uuid.uuid4()}") (effects (font (size 0.75 0.75) (thickness 0.12))))',
        "",
        "\t;; --- Footprint: U1 NXP NTAG216 (XQFN8 1.6x1.6mm P0.4mm) ---",
        '\t(footprint "homebound:XQFN-8_1.6x1.6mm_P0.4mm"',
        '\t\t(layer "F.Cu")',
        f'\t\t(uuid "{uuid.uuid4()}")',
        f"\t\t(at {x0:.2f} {y0:.2f})",
        '\t\t(descr "NXP XQFN8 (SOT902-3) 1.6x1.6mm 0.4mm pitch")',
        '\t\t(tags "NTAG216 NFC XQFN8")',
        f'\t\t(property "Reference" "U1" (at 0 -1.5 0) (layer "F.SilkS") (uuid "{uuid.uuid4()}") (effects (font (size 0.6 0.6) (thickness 0.10))))',
        f'\t\t(property "Value" "NTAG216" (at 0 1.5 0) (layer "F.SilkS") (uuid "{uuid.uuid4()}") (effects (font (size 0.6 0.6) (thickness 0.10))))',
        f'\t\t(fp_line (start -0.8 -0.8) (end 0.8 -0.8) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "{uuid.uuid4()}"))',
        f'\t\t(fp_line (start 0.8 -0.8) (end 0.8 0.8) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "{uuid.uuid4()}"))',
        f'\t\t(fp_line (start 0.8 0.8) (end -0.8 0.8) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "{uuid.uuid4()}"))',
        f'\t\t(fp_line (start -0.8 0.8) (end -0.8 -0.8) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "{uuid.uuid4()}"))',
        f'\t\t(fp_circle (center -1.1 -0.6) (end -1.0 -0.6) (stroke (width 0.1) (type solid)) (fill solid) (layer "F.SilkS") (uuid "{uuid.uuid4()}"))',
        "",
        "\t\t;; Pads",
        f'\t\t(pad "1" smd rect (at -0.75 -0.60) (size 0.45 0.22) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "ANT_A") (pinfunction "LA") (uuid "{uuid.uuid4()}"))',
        f'\t\t(pad "2" smd rect (at -0.75 -0.20) (size 0.45 0.22) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 "") (pinfunction "NC") (uuid "{uuid.uuid4()}"))',
        f'\t\t(pad "3" smd rect (at -0.75 0.20) (size 0.45 0.22) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 "") (pinfunction "NC") (uuid "{uuid.uuid4()}"))',
        f'\t\t(pad "4" smd rect (at -0.75 0.60) (size 0.45 0.22) (layers "F.Cu" "F.Paste" "F.Mask") (net 3 "GND") (pinfunction "GND") (uuid "{uuid.uuid4()}"))',
        f'\t\t(pad "5" smd rect (at 0.75 0.60) (size 0.45 0.22) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 "") (pinfunction "NC") (uuid "{uuid.uuid4()}"))',
        f'\t\t(pad "6" smd rect (at 0.75 0.20) (size 0.45 0.22) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 "") (pinfunction "NC") (uuid "{uuid.uuid4()}"))',
        f'\t\t(pad "7" smd rect (at 0.75 -0.20) (size 0.45 0.22) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 "") (pinfunction "NC") (uuid "{uuid.uuid4()}"))',
        f'\t\t(pad "8" smd rect (at 0.75 -0.60) (size 0.45 0.22) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "ANT_B") (pinfunction "LB") (uuid "{uuid.uuid4()}"))',
        "\t)",
        "",
        "\t;; --- Ground Test Pad ---",
        f'\t(segment (start {x0 - 0.75:.2f} {y0 + 0.60:.2f}) (end {x0 - 1.5:.2f} {y0 + 1.2:.2f}) (width 0.20) (layer "F.Cu") (net 3) (uuid "{uuid.uuid4()}"))',
        '\t(footprint "homebound:TestPad_1.0mm"',
        '\t\t(layer "F.Cu")',
        f'\t\t(uuid "{uuid.uuid4()}")',
        f"\t\t(at {x0 - 1.5:.2f} {y0 + 1.2:.2f})",
        f'\t\t(pad "1" smd circle (at 0 0) (size 1.0 1.0) (layers "F.Cu" "F.Mask") (net 3 "GND") (uuid "{uuid.uuid4()}"))',
        "\t)",
        "",
        "\t;; --- Planar Coil Antenna Segments on F.Cu ---",
    ]

    # Generate Archimedean spiral coordinates
    total_steps = n_turns * steps_per_turn
    coil_pts = []
    for i in range(total_steps + 1):
        theta = i * (2.0 * math.pi / steps_per_turn)
        r = r_start + (pitch_mm / (2.0 * math.pi)) * theta
        x = x0 + r * math.cos(theta)
        y = y0 + r * math.sin(theta)
        coil_pts.append((x, y))

    # Add spiral track segments (Net 2: "ANT_B" for inner coil turns, or transition)
    # The whole coil is on Net 1 ("ANT_A") transitioning at the inner pad to Net 2 ("ANT_B")
    for i in range(len(coil_pts) - 1):
        x1, y1 = coil_pts[i]
        x2, y2 = coil_pts[i + 1]
        pcb_lines.append(
            f'\t(segment (start {x1:.3f} {y1:.3f}) (end {x2:.3f} {y2:.3f}) (width {w_mm:.2f}) (layer "F.Cu") (net 1) (uuid "{uuid.uuid4()}"))'
        )

    # Lead-in track from IC Pad 8 (LB, Net 2) to inner spiral start
    # Pad 8 is at (x0 + 0.75, y0 - 0.60). Coil starts at coil_pts[0] = (x0 + r_start, y0)
    sx, sy = coil_pts[0]
    lead_pts = [
        (x0 + 0.75, y0 - 0.60),
        (x0 + 2.00, y0 - 0.60),
        (x0 + 4.00, y0 - 0.20),
        (sx, sy),
    ]
    for i in range(len(lead_pts) - 1):
        x1, y1 = lead_pts[i]
        x2, y2 = lead_pts[i + 1]
        pcb_lines.append(
            f'\t(segment (start {x1:.3f} {y1:.3f}) (end {x2:.3f} {y2:.3f}) (width {w_mm:.2f}) (layer "F.Cu") (net 2) (uuid "{uuid.uuid4()}"))'
        )

    # Outer via at the outer end of coil: coil_pts[-1]
    ex, ey = coil_pts[-1]
    pcb_lines.extend(
        [
            "",
            "\t;; --- Outer Coil Via (F.Cu to B.Cu) ---",
            f'\t(via (at {ex:.3f} {ey:.3f}) (size 0.60) (drill 0.30) (layers "F.Cu" "B.Cu") (net 1) (uuid "{uuid.uuid4()}"))',
            "",
            "\t;; --- Bottom Layer Return Bridge Trace (B.Cu) ---",
        ]
    )

    # Return bridge trace on B.Cu from (ex, ey) to center Via 2 at (x0 - 2.0, y0 - 0.60)
    via2_x, via2_y = x0 - 2.00, y0 - 0.60
    # Route on bottom cleanly under the coil
    pcb_lines.append(
        f'\t(segment (start {ex:.3f} {ey:.3f}) (end {via2_x:.3f} {via2_y:.3f}) (width 0.30) (layer "B.Cu") (net 1) (uuid "{uuid.uuid4()}"))'
    )

    pcb_lines.extend(
        [
            "",
            "\t;; --- Center Via 2 (B.Cu back to F.Cu) ---",
            f'\t(via (at {via2_x:.3f} {via2_y:.3f}) (size 0.60) (drill 0.30) (layers "F.Cu" "B.Cu") (net 1) (uuid "{uuid.uuid4()}"))',
            "",
            "\t;; --- Connection from Via 2 to Pad 1 (LA, Net 1) on F.Cu ---",
            f'\t(segment (start {via2_x:.3f} {via2_y:.3f}) (end {x0 - 0.75:.3f} {y0 - 0.60:.3f}) (width {w_mm:.2f}) (layer "F.Cu") (net 1) (uuid "{uuid.uuid4()}"))',
            ")",
        ]
    )

    return "\n".join(pcb_lines), coil_pts, (ex, ey), (via2_x, via2_y), lead_pts


def render_pcb_previews(
    out_dir,
    board_diam_mm,
    coil_pts,
    outer_via,
    inner_via,
    lead_pts,
    w_mm,
    calc_info,
):
    """
    Renders high-resolution PCB visualization graphics:
      - pcb/out/tag_pcb_top.png
      - pcb/out/tag_pcb_layers.png
    """
    os.makedirs(out_dir, exist_ok=True)
    x0, y0 = 100.0, 100.0
    r_brd = board_diam_mm / 2.0

    # -------------------------------------------------------------
    # 1. Top Layer View (F.Cu + Silk + Edge)
    # -------------------------------------------------------------
    fig, ax = plt.subplots(figsize=(8, 8), dpi=150)
    ax.set_facecolor("#0a0f1d")
    ax.set_aspect("equal")

    # Board circular substrate
    board_circle = plt.Circle(
        (x0, y0),
        r_brd,
        color="#15202b",
        ec="#f59e0b",
        lw=2.0,
        ls="--",
        label="Edge.Cuts (Ø 22.4 mm)",
    )
    ax.add_patch(board_circle)

    # Front copper coil tracks
    c_xs = [pt[0] for pt in coil_pts]
    c_ys = [pt[1] for pt in coil_pts]
    ax.plot(
        c_xs,
        c_ys,
        color="#f43f5e",
        lw=1.3,
        solid_capstyle="round",
        label=f"F.Cu Coil (N={calc_info['n_turns']}, W={w_mm}mm)",
    )

    # Lead track
    l_xs = [pt[0] for pt in lead_pts]
    l_ys = [pt[1] for pt in lead_pts]
    ax.plot(l_xs, l_ys, color="#f43f5e", lw=1.3)

    # IC pad connection
    ax.plot(
        [inner_via[0], x0 - 0.75],
        [inner_via[1], y0 - 0.60],
        color="#f43f5e",
        lw=1.3,
    )

    # Vias
    ax.scatter(
        [outer_via[0], inner_via[0]],
        [outer_via[1], inner_via[1]],
        color="#fbbf24",
        s=60,
        edgecolors="#ffffff",
        lw=1.0,
        zorder=5,
        label="Vias (Ø 0.6mm)",
    )

    # IC package outline and pads
    ic_box = plt.Rectangle(
        (x0 - 0.8, y0 - 0.8),
        1.6,
        1.6,
        color="#334155",
        ec="#94a3b8",
        lw=1.0,
        zorder=6,
    )
    ax.add_patch(ic_box)
    ax.text(
        x0,
        y0,
        "NTAG\n216",
        color="white",
        fontsize=6.5,
        fontweight="bold",
        ha="center",
        va="center",
        zorder=7,
    )

    # Silkscreen text
    ax.text(
        x0,
        y0 - 4.5,
        "HOMEBOUND NFC",
        color="#e2e8f0",
        fontsize=8,
        fontweight="bold",
        ha="center",
        va="center",
    )
    ax.text(
        x0,
        y0 + 4.5,
        "13.56 MHz",
        color="#94a3b8",
        fontsize=7.5,
        ha="center",
        va="center",
    )
    ax.text(
        x0,
        y0 - 8.5,
        f"L ≈ {calc_info['L_mw_cir']:.2f} µH  (50 pF)",
        color="#38bdf8",
        fontsize=7,
        ha="center",
        va="center",
    )

    margin = r_brd + 1.5
    ax.set_xlim(x0 - margin, x0 + margin)
    ax.set_ylim(y0 - margin, y0 + margin)
    ax.set_title(
        "Homebound NFC Tag PCB - Top Layer View (13.56 MHz)",
        color="#f8fafc",
        fontsize=11,
        fontweight="bold",
        pad=10,
    )
    ax.legend(
        loc="lower left",
        facecolor="#1e293b",
        edgecolor="#475569",
        labelcolor="#f8fafc",
        fontsize=8,
    )
    ax.axis("off")

    top_png = os.path.join(out_dir, "tag_pcb_top.png")
    plt.tight_layout()
    plt.savefig(top_png, dpi=150)
    plt.close()
    print(f"Rendered: {top_png}")

    # -------------------------------------------------------------
    # 2. Composite Layer View (F.Cu + B.Cu + Vias + Outline)
    # -------------------------------------------------------------
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 7), dpi=150)
    for ax in (ax1, ax2):
        ax.set_facecolor("#0a0f1d")
        ax.set_aspect("equal")

    # Panel 1: Composite View
    ax1.add_patch(
        plt.Circle((x0, y0), r_brd, color="#15202b", ec="#f59e0b", lw=2.0)
    )
    ax1.plot(
        c_xs,
        c_ys,
        color="#f43f5e",
        lw=1.2,
        label=f"Top Layer: F.Cu ({calc_info['n_turns']} turns)",
    )
    ax1.plot(l_xs, l_ys, color="#f43f5e", lw=1.2)
    # Return bridge on bottom
    ax1.plot(
        [outer_via[0], inner_via[0]],
        [outer_via[1], inner_via[1]],
        color="#38bdf8",
        lw=1.5,
        ls="--",
        label="Bottom Layer: B.Cu (Return Bridge)",
    )
    ax1.scatter(
        [outer_via[0], inner_via[0]],
        [outer_via[1], inner_via[1]],
        color="#fbbf24",
        s=60,
        zorder=5,
        label="Through-Vias",
    )
    ax1.add_patch(
        plt.Rectangle(
            (x0 - 0.8, y0 - 0.8),
            1.6,
            1.6,
            color="#334155",
            ec="#94a3b8",
            lw=1.0,
            zorder=6,
        )
    )
    ax1.set_xlim(x0 - margin, x0 + margin)
    ax1.set_ylim(y0 - margin, y0 + margin)
    ax1.set_title(
        "Composite Routing (2-Layer Flex/FR4)",
        color="white",
        fontsize=10,
        fontweight="bold",
    )
    ax1.legend(
        loc="lower left",
        facecolor="#1e293b",
        edgecolor="#475569",
        labelcolor="white",
        fontsize=8,
    )
    ax1.axis("off")

    # Panel 2: Bottom Layer View (B.Cu)
    ax2.add_patch(
        plt.Circle((x0, y0), r_brd, color="#15202b", ec="#f59e0b", lw=2.0)
    )
    ax2.plot(
        [outer_via[0], inner_via[0]],
        [outer_via[1], inner_via[1]],
        color="#38bdf8",
        lw=2.0,
        label="B.Cu Return Bridge Trace (0.30mm)",
    )
    ax2.scatter(
        [outer_via[0], inner_via[0]],
        [outer_via[1], inner_via[1]],
        color="#fbbf24",
        s=60,
        zorder=5,
        label="Vias (Drill 0.3mm)",
    )
    ax2.text(
        x0,
        y0 - 3.5,
        "L = 2.76 µH",
        color="#94a3b8",
        fontsize=8,
        ha="center",
        va="center",
    )
    ax2.text(
        x0,
        y0 + 3.5,
        "C_tune = 50 pF",
        color="#94a3b8",
        fontsize=8,
        ha="center",
        va="center",
    )
    ax2.text(
        x0,
        y0 + 7.0,
        "Bottom Return Layer",
        color="#38bdf8",
        fontsize=9,
        fontweight="bold",
        ha="center",
        va="center",
    )
    ax2.set_xlim(x0 - margin, x0 + margin)
    ax2.set_ylim(y0 - margin, y0 + margin)
    ax2.set_title(
        "Bottom Layer (B.Cu Return Bridge)",
        color="white",
        fontsize=10,
        fontweight="bold",
    )
    ax2.legend(
        loc="lower left",
        facecolor="#1e293b",
        edgecolor="#475569",
        labelcolor="white",
        fontsize=8,
    )
    ax2.axis("off")

    fig.suptitle(
        f"Homebound NFC Tag PCB Layout (Target L=2.76µH @ 13.56MHz)",
        color="white",
        fontsize=13,
        fontweight="bold",
        y=0.98,
    )
    layers_png = os.path.join(out_dir, "tag_pcb_layers.png")
    plt.tight_layout(rect=[0, 0, 1, 0.95])
    plt.savefig(layers_png, dpi=150)
    plt.close()
    print(f"Rendered: {layers_png}")


def main():
    pcb_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(pcb_dir, "out")
    os.makedirs(out_dir, exist_ok=True)

    print("Computing NFC antenna parameters...")
    calc = compute_antenna_inductance(
        dout_mm=21.0, w_mm=0.25, s_mm=0.20, n=9
    )

    print(
        f"  - Outer Diameter:       {calc['dout_mm']:.2f} mm (Board: Ø 22.4 mm)"
    )
    print(f"  - Inner Diameter:       {calc['din_mm']:.2f} mm")
    print(f"  - Turns (N):            {calc['n_turns']}")
    print(f"  - Trace Width / Space:  {calc['w_mm']:.2f} mm / {calc['s_mm']:.2f} mm")
    print(f"  - Mohan Wheeler L:      {calc['L_mw_cir']:.4f} µH (Target: 2.76 µH)")
    print(f"  - Mohan CurrentSheet L: {calc['L_cs_cir']:.4f} µH")
    print(f"  - Traditional Wheeler L:{calc['L_wh']:.4f} µH")
    print(
        f"  - Resonant Freq (50pF): {calc['f_res_cir_mhz']:.3f} MHz (Target: 13.56 MHz)"
    )

    # 1. Project file
    pro_path = os.path.join(pcb_dir, "homebound_tag.kicad_pro")
    with open(pro_path, "w") as f:
        f.write(generate_kicad_pro())
    print(f"Wrote {pro_path}")

    # 2. Schematic file
    sch_path = os.path.join(pcb_dir, "homebound_tag.kicad_sch")
    with open(sch_path, "w") as f:
        f.write(generate_kicad_sch())
    print(f"Wrote {sch_path}")

    # 3. PCB Board file
    pcb_path = os.path.join(pcb_dir, "homebound_tag.kicad_pcb")
    pcb_str, coil_pts, outer_via, inner_via, lead_pts = generate_kicad_pcb(
        board_diam_mm=22.4, dout_mm=21.0, n_turns=9, w_mm=0.25, s_mm=0.20
    )
    with open(pcb_path, "w") as f:
        f.write(pcb_str)
    print(f"Wrote {pcb_path}")

    # 4. Matplotlib Visual Renders
    print("Generating visual PCB render PNGs...")
    render_pcb_previews(
        out_dir,
        board_diam_mm=22.4,
        coil_pts=coil_pts,
        outer_via=outer_via,
        inner_via=inner_via,
        lead_pts=lead_pts,
        w_mm=0.25,
        calc_info=calc,
    )

    print("\nPCB generation complete!")


if __name__ == "__main__":
    main()
