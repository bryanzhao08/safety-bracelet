# Hardware fix (pcb/ only); do steps 1-3 now, without waiting for KiCad
Review found: the outer coil via at (110.7, 100.0) is only ~0.2 mm from the Ø22.4 mm board edge. Fabs want ≥ 0.5 mm.
1. In pcb/generate.py keep ≥ 0.5 mm copper-to-edge clearance for every track, via and pad (shrink the coil or move the
   via inward), and keep L ≈ 2.7 µH (add a turn or use 0.15 mm spacing, still above JLCPCB's 0.1 mm min). Regenerate.
2. Write `pcb/check.py`: a geometry design-rule check that parses the generated .kicad_pcb and verifies copper-to-edge ≥ 0.5 mm,
   track width ≥ 0.15 mm, track-to-track gap ≥ 0.15 mm (excluding connected segments), via drill ≥ 0.3 mm with annular
   ring ≥ 0.13 mm, and that the coil is one continuous net from pad to pad. It prints PASS/FAIL per rule and exits nonzero
   on failure. Make it pass.
3. Update pcb/README.md with the final numbers and the check results.
4. Only if /Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli exists: also run `kicad-cli pcb drc` and export Gerbers +
   drill to pcb/out/gerbers (zip as pcb/out/homebound_tag_gerbers.zip). Otherwise make `pcb/build.sh` do it later.
Append one line to STATUS.md.
