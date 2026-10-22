#!/usr/bin/env python3
"""
Homebound Hardware: Geometry & Design Rule Check (DRC) for KiCad PCB.

Verifies:
  1. Copper-to-edge clearance >= 0.5 mm for every track, via, and pad.
  2. Track width >= 0.15 mm for all copper tracks.
  3. Track-to-track gap >= 0.15 mm (excluding connected segments).
  4. Via drill >= 0.3 mm and annular ring >= 0.13 mm.
  5. Coil is one continuous net from pad to pad (IC U1 Pad 1 to Pad 8).

Prints PASS/FAIL per rule and exits 0 on success, nonzero on failure.
"""

import math
import os
import sys
from collections import defaultdict, deque


def tokenize(text):
    tokens = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c.isspace():
            i += 1
        elif c == ";":
            while i < n and text[i] != "\n":
                i += 1
        elif c in "()":
            tokens.append(c)
            i += 1
        elif c == '"':
            i += 1
            s = []
            while i < n and text[i] != '"':
                if text[i] == "\\" and i + 1 < n:
                    i += 1
                    s.append(text[i])
                else:
                    s.append(text[i])
                i += 1
            tokens.append("".join(s))
            i += 1  # skip trailing quote
        else:
            start = i
            while i < n and not text[i].isspace() and text[i] not in '();"':
                i += 1
            tokens.append(text[start:i])
    return tokens


def parse_sexpr(tokens):
    def parse_list(idx):
        res = []
        while idx < len(tokens):
            tok = tokens[idx]
            if tok == "(":
                sub, idx = parse_list(idx + 1)
                res.append(sub)
            elif tok == ")":
                return res, idx + 1
            else:
                res.append(tok)
                idx += 1
        return res, idx

    parsed, _ = parse_list(0)
    return parsed[0] if parsed else []


def dist_point_to_segment(p, a, b):
    ab_x = b[0] - a[0]
    ab_y = b[1] - a[1]
    ap_x = p[0] - a[0]
    ap_y = p[1] - a[1]
    l2 = ab_x * ab_x + ab_y * ab_y
    if l2 < 1e-12:
        return math.hypot(ap_x, ap_y)
    t = max(0.0, min(1.0, (ap_x * ab_x + ap_y * ab_y) / l2))
    proj_x = a[0] + t * ab_x
    proj_y = a[1] + t * ab_y
    return math.hypot(p[0] - proj_x, p[1] - proj_y)


def dist_segment_to_segment(a1, a2, b1, b2):
    def ccw(A, B, C):
        return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])

    def segments_intersect(A, B, C, D):
        return (ccw(A, C, D) != ccw(B, C, D)) and (ccw(A, B, C) != ccw(A, B, D))

    if segments_intersect(a1, a2, b1, b2):
        return 0.0

    return min(
        dist_point_to_segment(a1, b1, b2),
        dist_point_to_segment(a2, b1, b2),
        dist_point_to_segment(b1, a1, a2),
        dist_point_to_segment(b2, a1, a2),
    )


class PCBDesignChecker:
    def __init__(self, kicad_pcb_path):
        self.path = kicad_pcb_path
        with open(kicad_pcb_path, "r", encoding="utf-8") as f:
            tokens = tokenize(f.read())
        self.sexpr = parse_sexpr(tokens)
        self.segments = []
        self.vias = []
        self.footprints = []
        self.edge_cuts = []
        self.nets = {}
        self._extract_elements()

    def _extract_elements(self):
        for item in self.sexpr:
            if not isinstance(item, list) or len(item) == 0:
                continue
            head = item[0]

            if head == "net":
                # (net 1 "ANT_A")
                net_id = int(item[1])
                net_name = item[2] if len(item) > 2 else ""
                self.nets[net_id] = net_name

            elif head == "segment":
                # (segment (start x y) (end x y) (width w) (layer l) (net n))
                seg = {"width": 0.0, "layer": "", "net": 0}
                for prop in item[1:]:
                    if not isinstance(prop, list) or len(prop) == 0:
                        continue
                    if prop[0] == "start":
                        seg["start"] = (float(prop[1]), float(prop[2]))
                    elif prop[0] == "end":
                        seg["end"] = (float(prop[1]), float(prop[2]))
                    elif prop[0] == "width":
                        seg["width"] = float(prop[1])
                    elif prop[0] == "layer":
                        seg["layer"] = prop[1]
                    elif prop[0] == "net":
                        seg["net"] = int(prop[1])
                self.segments.append(seg)

            elif head == "via":
                # (via (at x y) (size s) (drill d) (layers "F.Cu" "B.Cu") (net n))
                via = {"size": 0.0, "drill": 0.0, "layers": [], "net": 0}
                for prop in item[1:]:
                    if not isinstance(prop, list) or len(prop) == 0:
                        continue
                    if prop[0] == "at":
                        via["at"] = (float(prop[1]), float(prop[2]))
                    elif prop[0] == "size":
                        via["size"] = float(prop[1])
                    elif prop[0] == "drill":
                        via["drill"] = float(prop[1])
                    elif prop[0] == "layers":
                        via["layers"] = prop[1:]
                    elif prop[0] == "net":
                        via["net"] = int(prop[1])
                self.vias.append(via)

            elif head == "gr_circle":
                # (gr_circle (center x y) (end x y) (stroke ...) (layer "Edge.Cuts"))
                circle = {}
                for prop in item[1:]:
                    if not isinstance(prop, list) or len(prop) == 0:
                        continue
                    if prop[0] == "center":
                        circle["center"] = (float(prop[1]), float(prop[2]))
                    elif prop[0] == "end":
                        circle["end"] = (float(prop[1]), float(prop[2]))
                    elif prop[0] == "layer":
                        circle["layer"] = prop[1]
                if circle.get("layer") == "Edge.Cuts":
                    c = circle["center"]
                    e = circle["end"]
                    r = math.hypot(e[0] - c[0], e[1] - c[1])
                    circle["radius"] = r
                    self.edge_cuts.append(circle)

            elif head == "footprint":
                fp = {"name": item[1], "at": (0.0, 0.0), "pads": [], "ref": ""}
                for prop in item[2:]:
                    if not isinstance(prop, list) or len(prop) == 0:
                        continue
                    if prop[0] == "at":
                        fp["at"] = (float(prop[1]), float(prop[2]))
                    elif prop[0] == "property" and len(prop) > 2:
                        if prop[1] == "Reference":
                            fp["ref"] = prop[2]
                    elif prop[0] == "pad":
                        # (pad "1" smd rect (at x y) (size sx sy) (layers ...) (net n ...))
                        pad = {
                            "number": prop[1],
                            "type": prop[2],
                            "shape": prop[3],
                            "at": (0.0, 0.0),
                            "size": (0.0, 0.0),
                            "layers": [],
                            "net": 0,
                        }
                        for pad_prop in prop[4:]:
                            if not isinstance(pad_prop, list) or len(pad_prop) == 0:
                                continue
                            if pad_prop[0] == "at":
                                pad["at"] = (float(pad_prop[1]), float(pad_prop[2]))
                            elif pad_prop[0] == "size":
                                pad["size"] = (float(pad_prop[1]), float(pad_prop[2]))
                            elif pad_prop[0] == "layers":
                                pad["layers"] = pad_prop[1:]
                            elif pad_prop[0] == "net":
                                pad["net"] = int(pad_prop[1])
                        fp["pads"].append(pad)
                self.footprints.append(fp)

    def check_copper_to_edge(self, min_allowed=0.5):
        """Rule 1: copper-to-edge >= 0.5 mm."""
        if not self.edge_cuts:
            return False, "No Edge.Cuts outline found", 0.0

        circle_edge = self.edge_cuts[0]
        cx, cy = circle_edge["center"]
        r_board = circle_edge["radius"]

        min_clearance = float("inf")
        worst_element = None

        # 1. Check segments
        for seg in self.segments:
            if seg["layer"] not in ("F.Cu", "B.Cu"):
                continue
            p1 = seg["start"]
            p2 = seg["end"]
            w = seg["width"]
            d1 = math.hypot(p1[0] - cx, p1[1] - cy)
            d2 = math.hypot(p2[0] - cx, p2[1] - cy)
            max_r = max(d1, d2) + w / 2.0
            clearance = r_board - max_r
            if clearance < min_clearance:
                min_clearance = clearance
                worst_element = f"Track on {seg['layer']} near ({p1[0]:.2f}, {p1[1]:.2f})"

        # 2. Check vias
        for via in self.vias:
            vx, vy = via["at"]
            v_radius = via["size"] / 2.0
            d = math.hypot(vx - cx, vy - cy)
            clearance = r_board - (d + v_radius)
            if clearance < min_clearance:
                min_clearance = clearance
                worst_element = f"Via at ({vx:.2f}, {vy:.2f})"

        # 3. Check pads
        for fp in self.footprints:
            fx, fy = fp["at"]
            for pad in fp["pads"]:
                if not any(l in ("F.Cu", "B.Cu") for l in pad["layers"]):
                    continue
                px = fx + pad["at"][0]
                py = fy + pad["at"][1]
                sx, sy = pad["size"]
                pad_r = math.hypot(sx / 2.0, sy / 2.0)
                d = math.hypot(px - cx, py - cy)
                clearance = r_board - (d + pad_r)
                if clearance < min_clearance:
                    min_clearance = clearance
                    worst_element = f"Pad {pad['number']} of {fp.get('ref', fp['name'])} at ({px:.2f}, {py:.2f})"

        passed = min_clearance >= (min_allowed - 1e-6)
        msg = f"min clearance = {min_clearance:.4f} mm (worst: {worst_element})"
        return passed, msg, min_clearance

    def check_track_width(self, min_allowed=0.15):
        """Rule 2: track width >= 0.15 mm."""
        cu_segs = [s for s in self.segments if s["layer"] in ("F.Cu", "B.Cu")]
        if not cu_segs:
            return False, "No copper tracks found", 0.0

        min_width = min(s["width"] for s in cu_segs)
        passed = min_width >= (min_allowed - 1e-6)
        msg = f"min track width = {min_width:.4f} mm"
        return passed, msg, min_width

    def check_track_gap(self, min_allowed=0.15):
        """Rule 3: track-to-track gap >= 0.15 mm (excluding connected segments)."""
        cu_segs = [s for s in self.segments if s["layer"] in ("F.Cu", "B.Cu")]
        min_gap = float("inf")
        worst_pair = None

        # Group by layer
        by_layer = defaultdict(list)
        for s in cu_segs:
            by_layer[s["layer"]].append(s)

        for layer, segs in by_layer.items():
            n = len(segs)
            for i in range(n):
                s1 = segs[i]
                p1, p2 = s1["start"], s1["end"]
                w1 = s1["width"]

                # Segment bounding box
                min_x1 = min(p1[0], p2[0]) - w1 / 2.0
                max_x1 = max(p1[0], p2[0]) + w1 / 2.0
                min_y1 = min(p1[1], p2[1]) - w1 / 2.0
                max_y1 = max(p1[1], p2[1]) + w1 / 2.0

                for j in range(i + 1, n):
                    s2 = segs[j]
                    q1, q2 = s2["start"], s2["end"]
                    w2 = s2["width"]

                    # Quick bbox reject
                    min_x2 = min(q1[0], q2[0]) - w2 / 2.0
                    max_x2 = max(q1[0], q2[0]) + w2 / 2.0
                    if min_x1 - max_x2 > min_allowed or min_x2 - max_x1 > min_allowed:
                        continue

                    min_y2 = min(q1[1], q2[1]) - w2 / 2.0
                    max_y2 = max(q1[1], q2[1]) + w2 / 2.0
                    if min_y1 - max_y2 > min_allowed or min_y2 - max_y1 > min_allowed:
                        continue

                    # Check if connected (sharing an endpoint)
                    d_p1_q1 = math.hypot(p1[0] - q1[0], p1[1] - q1[1])
                    d_p1_q2 = math.hypot(p1[0] - q2[0], p1[1] - q2[1])
                    d_p2_q1 = math.hypot(p2[0] - q1[0], p2[1] - q1[1])
                    d_p2_q2 = math.hypot(p2[0] - q2[0], p2[1] - q2[1])
                    if min(d_p1_q1, d_p1_q2, d_p2_q1, d_p2_q2) < 1e-4:
                        continue

                    d_center = dist_segment_to_segment(p1, p2, q1, q2)
                    gap = d_center - (w1 + w2) / 2.0
                    if gap < min_gap:
                        min_gap = gap
                        worst_pair = (p1, p2, q1, q2, layer)

        passed = min_gap >= (min_allowed - 1e-6)
        msg = f"min track-to-track gap = {min_gap:.4f} mm"
        return passed, msg, min_gap

    def check_vias(self, min_drill=0.30, min_annular_ring=0.13):
        """Rule 4: via drill >= 0.3 mm and annular ring >= 0.13 mm."""
        if not self.vias:
            return False, "No vias found", 0.0, 0.0

        min_d = float("inf")
        min_ring = float("inf")

        for via in self.vias:
            d = via["drill"]
            size = via["size"]
            ring = (size - d) / 2.0
            if d < min_d:
                min_d = d
            if ring < min_ring:
                min_ring = ring

        passed_drill = min_d >= (min_drill - 1e-6)
        passed_ring = min_ring >= (min_annular_ring - 1e-6)
        passed = passed_drill and passed_ring
        msg = f"min drill = {min_d:.3f} mm (>= {min_drill}), min annular ring = {min_ring:.3f} mm (>= {min_annular_ring})"
        return passed, msg, min_d, min_ring

    def check_coil_continuity(self):
        """
        Rule 5: coil is one continuous net from pad to pad (U1 Pad 1 to Pad 8).
        Verifies:
          - Both Pad 1 and Pad 8 belong to the same non-zero net.
          - Graph of copper segments & vias connects Pad 1 to Pad 8.
          - Every conductor on this path belongs to this net.
        """
        # Find U1
        u1 = None
        for fp in self.footprints:
            if fp.get("ref") == "U1" or "NTAG" in fp.get("name", ""):
                u1 = fp
                break

        if not u1:
            return False, "IC U1 footprint not found"

        pad1 = None
        pad8 = None
        for p in u1["pads"]:
            if p["number"] == "1":
                pad1 = p
            elif p["number"] == "8":
                pad8 = p

        if not pad1 or not pad8:
            return False, "Pads 1 and/or 8 not found on U1"

        net1 = pad1["net"]
        net8 = pad8["net"]

        if net1 == 0 or net8 == 0:
            return False, f"Pads have unassigned net: Pad 1 net={net1}, Pad 8 net={net8}"

        if net1 != net8:
            return (
                False,
                f"Net mismatch: Pad 1 is Net {net1} ('{self.nets.get(net1, '')}'), "
                f"Pad 8 is Net {net8} ('{self.nets.get(net8, '')}'). Must be one net.",
            )

        coil_net = net1
        coil_net_name = self.nets.get(coil_net, f"Net {coil_net}")

        # Build connectivity graph of conductors on coil_net
        # Node key: (round(x, 4), round(y, 4), layer)
        adj = defaultdict(list)

        def pt_key(x, y, layer):
            return (round(x, 4), round(y, 4), layer)

        # Segments on coil_net
        coil_segments = [s for s in self.segments if s["net"] == coil_net]
        if not coil_segments:
            return False, f"No tracks found on coil net {coil_net}"

        for s in coil_segments:
            k1 = pt_key(s["start"][0], s["start"][1], s["layer"])
            k2 = pt_key(s["end"][0], s["end"][1], s["layer"])
            adj[k1].append(k2)
            adj[k2].append(k1)

        # Vias on coil_net connect F.Cu and B.Cu
        coil_vias = [v for v in self.vias if v["net"] == coil_net]
        for v in coil_vias:
            vx, vy = v["at"]
            k_fcu = pt_key(vx, vy, "F.Cu")
            k_bcu = pt_key(vx, vy, "B.Cu")
            adj[k_fcu].append(k_bcu)
            adj[k_bcu].append(k_fcu)

        # Connect Pad 1 and Pad 8 centers to graph
        fx, fy = u1["at"]
        p1_coord = pt_key(fx + pad1["at"][0], fy + pad1["at"][1], "F.Cu")
        p8_coord = pt_key(fx + pad8["at"][0], fy + pad8["at"][1], "F.Cu")

        # BFS from p1_coord to p8_coord
        queue = deque([p1_coord])
        visited = {p1_coord}
        found_target = False

        while queue:
            curr = queue.popleft()
            if curr == p8_coord:
                found_target = True
                break
            for neighbor in adj[curr]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

        if not found_target:
            return (
                False,
                f"Discontinuous path: could not find continuous copper path from U1 pad 1 {p1_coord[:2]} "
                f"to pad 8 {p8_coord[:2]} on net {coil_net}",
            )

        return (
            True,
            f"Continuous net '{coil_net_name}' (ID {coil_net}) connects U1 pin 1 to pin 8 across {len(coil_segments)} segments and {len(coil_vias)} vias",
        )

    def run_all_checks(self):
        results = []

        # 1. Copper to edge
        p1, m1, c1 = self.check_copper_to_edge(0.50)
        results.append(("1. Copper-to-Edge (>= 0.50 mm)", p1, m1))

        # 2. Track width
        p2, m2, w2 = self.check_track_width(0.15)
        results.append(("2. Track Width (>= 0.15 mm)", p2, m2))

        # 3. Track-to-track gap
        p3, m3, g3 = self.check_track_gap(0.15)
        results.append(("3. Track-to-Track Gap (>= 0.15 mm)", p3, m3))

        # 4. Via drill & annular ring
        p4, m4, vd4, vr4 = self.check_vias(0.30, 0.13)
        results.append(("4. Via Drill & Annular Ring (drill >= 0.3mm, ring >= 0.13mm)", p4, m4))

        # 5. Coil net continuity
        p5, m5 = self.check_coil_continuity()
        results.append(("5. Coil Net Continuity (pad-to-pad continuous)", p5, m5))

        return results


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    pcb_path = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.path.join(script_dir, "homebound_tag.kicad_pcb")
    )

    if not os.path.isfile(pcb_path):
        print(f"Error: PCB file not found at {pcb_path}", file=sys.stderr)
        sys.exit(2)

    print(f"=== Homebound Hardware: Design Rule Geometry Check ===")
    print(f"Target: {pcb_path}\n")

    checker = PCBDesignChecker(pcb_path)
    results = checker.run_all_checks()

    all_passed = True
    for name, passed, detail in results:
        status_tag = "PASS" if passed else "FAIL"
        print(f"[{status_tag}] {name}")
        print(f"       {detail}")
        if not passed:
            all_passed = False

    print("\n" + ("=" * 55))
    if all_passed:
        print("OVERALL RESULT: ALL CHECKS PASSED")
        sys.exit(0)
    else:
        print("OVERALL RESULT: DESIGN RULE FAILURES DETECTED")
        sys.exit(1)


if __name__ == "__main__":
    main()
