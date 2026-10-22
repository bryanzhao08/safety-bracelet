# Homebound Hardware: NFC Tag PCB (`pcb/`)

This directory contains KiCad 8/9 design files, an antenna generator script, and fabrication documentation for the **Homebound passive NFC tag PCB**.

The PCB is an ultra-thin (0.2 mm) 2-layer circular board (Ø 22.4 mm) engineered to fit into the recessed Ø 25.5 mm pocket of the Homebound wristband clip (`cad/clip.py`) or flat carrier.

---

## Deliverables

| File | Type | Description |
|---|---|---|
| `homebound_tag.kicad_pro` | KiCad Project | Project configuration and DRC design rules |
| `homebound_tag.kicad_sch` | KiCad Schematic | S-expression schematic (NTAG216 + tuned 2.76 µH coil) |
| `homebound_tag.kicad_pcb` | KiCad Board | Complete layout: spiral coil on F.Cu, return bridge on B.Cu, vias |
| `generate.py` | Python Script | Generates reproducible KiCad files & computes antenna physics |
| `check.py` | Python Script | Geometry Design Rule Check (DRC): edge clearance, width, gap, vias, net continuity |
| `build.sh` | Shell Script | Runs generator, DRC checks, and exports Gerbers + drill via `kicad-cli` |
| `out/tag_pcb_top.png` | PNG Preview | Top layer copper (F.Cu), IC pads, silkscreen, and board edge |
| `out/tag_pcb_layers.png` | PNG Preview | Composite view showing front spiral, bottom return bridge, and vias |

---

## Bill of Materials (BOM)

Because the NXP NTAG series integrates the RF rectifier, digital logic, EEPROM, and tuning capacitor on-chip, **the board requires only a single active component**:

| RefDes | Component | Manufacturer Part # | Package | Description | Est. Cost (100 qty) |
|---|---|---|---|---|---|
| **U1** | NFC Forum Type 2 Tag IC | **NXP NTAG216F0HN** (or **NTAG213F0HN**) | XQFN8 (SOT902-3), 1.6 × 1.6 mm, 0.4 mm pitch | 888 bytes user memory (NTAG216) or 144 bytes (NTAG213), internal 50 pF tuning capacitance | ~$0.38 – $0.55 |
| **L1** | Printed Spiral Antenna | Integrated PCB trace | 2-layer planar spiral | 9 turns, $w=0.25\text{ mm}$, $s=0.16\text{ mm}$, $L \approx 2.755\ \mu\text{H}$ | Part of PCB substrate |
| **PCB** | 2-Layer Board | Custom | Ø 22.4 mm round, 0.2 mm FR4 or flex | ENIG finish, 1 oz Cu | ~$0.15 – $0.40 |

> [!NOTE]
> **NTAG213 vs NTAG216:**
> - **NTAG213** provides 144 bytes of user memory (36 pages × 4 bytes), which is more than sufficient for storing Homebound's band URL (`https://HOST/t/<bandToken>`) plus the 4-character short code.
> - **NTAG216** provides 888 bytes of user memory, allowing on-tag cryptographic signatures or extended offline metadata.
> - Both chips share identical pinouts and 50 pF internal tuning capacitance.

---

## Antenna Design & Inductance Calculations

### 1. Resonance Condition at 13.56 MHz

NFC Type A devices communicate via magnetic near-field inductive coupling at $f_0 = 13.56\text{ MHz}$.

The resonant frequency of an LC tank is:
$$f_0 = \frac{1}{2\pi \sqrt{L \cdot C_{\text{tune}}}}$$

Solving for target antenna coil inductance $L$ with the chip's internal $C_{\text{tune}} = 50.0\text{ pF}$:
$$L = \frac{1}{(2\pi f_0)^2 C_{\text{tune}}} = \frac{1}{(2\pi \times 13.56 \times 10^6)^2 \times 50 \times 10^{-12}} = \mathbf{2.7558\ \mu\text{H}} \approx \mathbf{2.76\ \mu\text{H}}$$

### 2. Planar Spiral Inductance Formulas

To determine the number of turns ($N$), trace width ($w$), and spacing ($s$), we evaluate planar spiral inductance expressions from Mohan et al. (IEEE JSSC, 1999) and Harold Wheeler:

#### A. Mohan Modified Wheeler Formula (Circular Coil)
$$L_{\text{mw}} = K_1 \mu_0 \frac{n^2 d_{\text{avg}}}{1 + K_2 \rho}$$

Where:
- $\mu_0 = 4\pi \times 10^{-7}\text{ H/m}$
- $d_{\text{avg}} = \frac{d_{\text{out}} + d_{\text{in}}}{2}$ (average diameter)
- $\rho = \frac{d_{\text{out}} - d_{\text{in}}}{d_{\text{out}} + d_{\text{in}}}$ (fill factor)
- For circular geometry: $K_1 = 2.21$, $K_2 = 1.78$

#### B. Mohan Current Sheet Expression
$$L_{\text{cs}} = \frac{\mu_0 n^2 d_{\text{avg}} c_1}{2} \left[ \ln\left(\frac{c_2}{\rho}\right) + c_3 \rho + c_4 \rho^2 \right]$$
For circular coils: $c_1 = 1.00$, $c_2 = 2.46$, $c_3 = 0.00$, $c_4 = 0.20$.

#### C. Traditional Wheeler Formula (Planar Spiral)
$$L_{\text{wh}} = 31.33 \mu_0 \frac{n^2 a^2}{8 a + 11 c}$$
Where $a = d_{\text{avg}} / 2$ (mean radius) and $c = (d_{\text{out}} - d_{\text{in}}) / 2$ (winding depth).

### 3. Coil Parameters & Numerical Results

The generated coil has the following physical parameters:

| Parameter | Value | Description |
|---|---|---|
| **Outer Diameter ($d_{\text{out}}$)** | 20.35 mm | Leaves ≥ 0.60 mm copper-to-edge clearance on Ø 22.4 mm board |
| **Inner Diameter ($d_{\text{in}}$)** | 13.29 mm | Leaves open central region for IC U1 and vias |
| **Number of Turns ($N$)** | 9 | Archimedean spiral (36 steps/turn) |
| **Trace Width ($w$)** | 0.25 mm (10 mil) | Low series resistance ($R_s < 2.5\ \Omega$) for high Q factor |
| **Trace Spacing ($s$)** | 0.16 mm (6.3 mil) | Standard low-cost PCB fab capability (well above 0.1 mm JLCPCB min) |
| **Fill Factor ($\rho$)** | 0.210 | Optimum coupling efficiency |
| **Mohan Wheeler $L$** | **2.7546 µH** | **Within 0.05% of theoretical 2.7558 µH target** |
| **Uncoupled Resonance** | **13.561 MHz** | Matches 13.56 MHz carrier frequency |

### 4. Human Body & Dielectric Detuning

When the wristband is worn, the human wrist tissue ($\epsilon_r \approx 40\text{--}50$ at 13.56 MHz) and the 3D-printed clip plastic ($\epsilon_r \approx 2.8$) introduce a small parasitic parallel capacitance ($\Delta C \approx 1\text{--}2\text{ pF}$). The coil trace width of 0.25 mm provides a loaded Quality factor $Q \approx 25\text{--}35$, which provides sufficient RF bandwidth ($\sim 500\text{ kHz}$) so that reading is robust regardless of whether the band is worn tightly against the skin or held loosely.

---

## Design Rule Check (DRC) Verification

Homebound includes an automated geometry design-rule validator (`pcb/check.py`) that parses the output `.kicad_pcb` S-expression and verifies all manufacturing constraints:

```text
=== Homebound Hardware: Design Rule Geometry Check ===
[PASS] 1. Copper-to-Edge (>= 0.50 mm)
       min clearance = 0.6000 mm (worst: Via at (110.30, 100.00))
[PASS] 2. Track Width (>= 0.15 mm)
       min track width = 0.2000 mm
[PASS] 3. Track-to-Track Gap (>= 0.15 mm)
       min track-to-track gap = 0.1571 mm
[PASS] 4. Via Drill & Annular Ring (drill >= 0.3mm, ring >= 0.13mm)
       min drill = 0.300 mm (>= 0.3), min annular ring = 0.150 mm (>= 0.13)
[PASS] 5. Coil Net Continuity (pad-to-pad continuous)
       Continuous net 'ANT' (ID 1) connects U1 pin 1 to pin 8 across 330 segments and 2 vias

=======================================================
OVERALL RESULT: ALL CHECKS PASSED
```

---

## Layer Stackup & Routing Architecture

```
Layer 1: F.Cu (Top)      ── [Spiral Coil: 9 turns, 0.25mm trace] ── IC U1 ── [Via 2]
                                                                                │
Dielectric Substrate     ── 0.2 mm FR4 or 0.1 mm Polyimide Flex ───────────────┼────
                                                                                │
Layer 2: B.Cu (Bottom)   ── [Via 1] ──────── [Return Bridge Trace (0.25mm)] ───┘
```

1. **Top Layer (`F.Cu`):**
   - IC U1 centered at $(100.0, 100.0)$.
   - Pad 8 (LB) connects directly on `F.Cu` to the inner start of the 9-turn Archimedean spiral ($r = 6.36\text{ mm}$).
   - The spiral expands outward continuously to $r = 10.05\text{ mm}$ without crossing any other copper.
   - Outer end connects to Outer Via 1 at $(110.30, 100.00)$.
   - All segments and pads on the coil belong to a single continuous net `ANT`.
   - Ground test pad connected to Pad 4 (GND).
2. **Through-Vias:**
   - **Outer Via 1:** at $(110.30, 100.00)$ (0.60 mm pad / 0.30 mm drill), drops the outer coil turn to `B.Cu`. Has **0.60 mm clearance** to the Ø 22.4 mm board edge, safely exceeding the fab $\ge 0.50\text{ mm}$ minimum.
   - **Inner Via 2:** at $(98.00, 99.40)$ (0.60 mm pad / 0.30 mm drill), brings the return signal back up to `F.Cu` to connect to Pad 1 (LA).
3. **Bottom Layer (`B.Cu`):**
   - A single direct 0.25 mm bridge trace connecting Via 1 to Via 2.
   - Completely isolated by the substrate dielectric from the top coil turns.

---

## How to Order (JLCPCB / PCBWay Settings)

### Option A: Ultra-Thin Rigid Board (Recommended for Prototype)
- **Dimensions:** 22.4 mm × 22.4 mm (Circular)
- **Layers:** 2 Layers
- **PCB Thickness:** **0.2 mm** (or 0.6 mm) FR4
- **Copper Weight:** 1 oz (35 µm)
- **Surface Finish:** **ENIG (Electroless Nickel Immersion Gold)** — *Critical for reliable solderability of leadless 0.4 mm pitch XQFN-8 pads*
- **Solder Mask:** Matte Black or Green
- **Silkscreen:** White
- **Min Track / Spacing:** 0.25 mm / 0.20 mm (well within 5 mil / 5 mil)
- **Min Hole Size:** 0.30 mm drill

### Option B: Flexible PCB (FPC)
- **Layers:** 2 Layers
- **Material:** Polyimide Flex (PI base)
- **Thickness:** 0.11 mm or 0.15 mm
- **Surface Finish:** ENIG
- **Coverlay:** Polyimide Yellow or Black
- **Stiffener:** None (or 0.1 mm PI under the IC zone for SMT pick-and-place)

---

## Pilot Recommendation: Off-the-Shelf Stickers vs Custom PCBs

> [!IMPORTANT]
> **Pilot Reality Check:**
> For the initial Homebound pilot and upcoming party tests, **off-the-shelf NTAG213 / NTAG215 round adhesive stickers (~$0.10–$0.30 each) are substantially more economical and practical than fabricating custom boards.**

### Comparison Table

| Factor | Off-the-Shelf NTAG213 Stickers | Custom Homebound PCB (`pcb/`) |
|---|---|---|
| **Unit Cost (Qty 100)** | **~$0.15 – $0.25 each** | ~$1.20 – $2.50 (bare board + IC + assembly) |
| **Initial Setup / NRE** | **$0** | ~$40 – $75 (tooling + SMT stencil + setup) |
| **Lead Time** | **1–2 days** (Amazon Prime / fast shipping) | 7–12 days (fabrication + assembly + shipping) |
| **Adhesive Backing** | Pre-applied 3M / acrylic peel-and-stick backing | Requires manual double-sided adhesive tape |
| **Fit in Clip** | Drops directly into clip's 25.5 mm recessed pocket | Drops directly into clip's 25.5 mm recessed pocket |
| **When to Use** | **Pilot events, testing, and production runs < 5,000 units** | Custom silicone wristband molding, custom cryptographic hardware, or integrated sensor add-ons |

The custom PCB files provided here ensure Homebound has a fully owned, open-hardware tag design ready to manufacture whenever custom form factors, embedded silicone bands, or high-volume custom production are desired.

---

## Build & Export Commands

To run the design generator and automated geometry DRC check:

```bash
./pcb/build.sh
```

To run only the geometry DRC checker:

```bash
./pcb/check.py
```

Or run directly with the CadQuery virtual environment:

```bash
cad/.venv/bin/python pcb/generate.py
cad/.venv/bin/python pcb/check.py
```

When `kicad-cli` is installed, `./pcb/build.sh` automatically executes KiCad DRC (`kicad-cli pcb drc`), exports production Gerbers and drill files to `pcb/out/gerbers/`, and packages them into `pcb/out/homebound_tag_gerbers.zip`.
