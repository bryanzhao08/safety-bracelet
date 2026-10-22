#!/usr/bin/env bash
# Homebound: NFC Tag PCB Build & Export Script
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$SCRIPT_DIR/out"
GERBERS_DIR="$OUT_DIR/gerbers"

mkdir -p "$OUT_DIR" "$GERBERS_DIR"

echo "=== 1. Generating KiCad Files and Preview Renders ==="
if [ -f "$ROOT_DIR/cad/.venv/bin/python" ]; then
    "$ROOT_DIR/cad/.venv/bin/python" "$SCRIPT_DIR/generate.py"
elif command -v python3 >/dev/null 2>&1; then
    python3 "$SCRIPT_DIR/generate.py"
else
    echo "Error: Python 3 not found." >&2
    exit 1
fi

echo ""
echo "=== 2. Checking for kicad-cli ==="

KICAD_CLI=""
CANDIDATES=(
    "kicad-cli"
    "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
    "/Applications/KiCad.app/Contents/MacOS/kicad-cli"
    "/Applications/KiCad/kicad-cli"
    "/usr/local/bin/kicad-cli"
    "/opt/homebrew/bin/kicad-cli"
)

for cmd in "${CANDIDATES[@]}"; do
    if command -v "$cmd" >/dev/null 2>&1 || [ -x "$cmd" ]; then
        KICAD_CLI="$cmd"
        break
    fi
done

if [ -n "$KICAD_CLI" ]; then
    echo "Found kicad-cli: $KICAD_CLI"
    echo "Running KiCad PCB DRC..."
    "$KICAD_CLI" pcb drc -o "$OUT_DIR/drc_report.rpt" "$SCRIPT_DIR/homebound_tag.kicad_pcb" || true

    echo "Exporting Gerbers to $GERBERS_DIR..."
    "$KICAD_CLI" pcb export gerbers -o "$GERBERS_DIR/" "$SCRIPT_DIR/homebound_tag.kicad_pcb"

    echo "Exporting Drill files to $GERBERS_DIR..."
    "$KICAD_CLI" pcb export drill -o "$GERBERS_DIR/" "$SCRIPT_DIR/homebound_tag.kicad_pcb"

    echo "Rendering PCB with kicad-cli..."
    "$KICAD_CLI" pcb render --side top -o "$OUT_DIR/kicad_render_top.png" "$SCRIPT_DIR/homebound_tag.kicad_pcb" || true
    "$KICAD_CLI" pcb render --side bottom -o "$OUT_DIR/kicad_render_bottom.png" "$SCRIPT_DIR/homebound_tag.kicad_pcb" || true
    echo "KiCad export complete! Files in $OUT_DIR"
else
    echo "Note: kicad-cli is not installed or not in PATH."
    echo "Generated files ready in $SCRIPT_DIR/:"
    echo "  - homebound_tag.kicad_pro"
    echo "  - homebound_tag.kicad_sch"
    echo "  - homebound_tag.kicad_pcb"
    echo "Visual renders created in $OUT_DIR/:"
    echo "  - tag_pcb_top.png"
    echo "  - tag_pcb_layers.png"
    echo "Once KiCad is installed, run ./pcb/build.sh to export Gerbers and run DRC."
fi
