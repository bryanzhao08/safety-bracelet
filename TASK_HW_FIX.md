# Hardware fix (pcb/ only)
Review found: the outer coil via at (110.7, 100.0) is only ~0.2 mm from the Ø22.4 mm board edge. Fabs want ≥ 0.5 mm.
1. In pcb/generate.py keep ≥ 0.5 mm copper-to-edge clearance for every track and via (shrink the coil outer diameter or
   move the via inward, and recompute L, keeping ≈ 2.7 µH, e.g. by adding a turn or tightening spacing to 0.15 mm,
   which is still within JLCPCB's 0.1 mm minimum).
2. Regenerate. When /Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli exists (being installed now), run
   `kicad-cli pcb drc --severity-error --exit-code-violations` and fix every error, then export Gerbers + drill to
   pcb/out/gerbers and zip them as pcb/out/homebound_tag_gerbers.zip.
3. Update pcb/README.md with the final numbers and the DRC result. Append to STATUS.md.
