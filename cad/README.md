# Homebound Hardware: Wristband NFC Clips (`cad/`)

This directory contains CadQuery parametric models and production export files for 3D-printable wristband NFC clips and adhesive carriers designed for the Homebound event safety system.

The clips hold a standard **25 mm round NTAG213 / NTAG216 NFC sticker** (or custom tag PCB) and slide onto disposable **Tyvek event wristbands** (standard 19 mm / ¾-inch and 25 mm / 1-inch widths, approx. 0.2 mm thick).

---

## Deliverables in `cad/out/`

| File | Format | Description |
|---|---|---|
| `clip_19mm.step` | STEP AP214 | 19 mm band clip model (for Onshape CAD import) |
| `clip_19mm.stl` | STL (binary) | 19 mm band clip mesh (for slicer / 3D printing) |
| `clip_19mm.png` | PNG (150 DPI) | 3D perspective & top-view rendering |
| `clip_25mm.step` | STEP AP214 | 25 mm band clip model (for Onshape CAD import) |
| `clip_25mm.stl` | STL (binary) | 25 mm band clip mesh (for slicer / 3D printing) |
| `clip_25mm.png` | PNG (150 DPI) | 3D perspective & top-view rendering |
| `carrier.step` | STEP AP214 | Variant B flat adhesive tag carrier |
| `carrier.stl` | STL (binary) | Variant B flat adhesive tag carrier mesh |
| `carrier.png` | PNG (150 DPI) | Variant B 3D perspective & top-view rendering |

---

## Slide-on holder for disposable concert bands (recommended)

`out/slider_tyvek_19.*`, `out/slider_tyvek_25.*`, `out/slider_woven_15.*`

A 32 mm long block with a Ø25.5 × 1.0 mm pocket on top for a 25 mm NTAG213/216 sticker and a closed channel
underneath that the band slides through. Two 0.3–0.4 mm ridges on the channel floor grip the band, so the slider
stays put and doesn't spin around the wrist.

| File | Band | Channel (w × h) | Outer size |
|---|---|---|---|
| `slider_tyvek_19` | 19 mm Tyvek (also 0.4 mm vinyl snap bands) | 20.0 × 0.9 mm | 32.0 × 27.9 × 4.1 mm |
| `slider_tyvek_25` | 25 mm (1") Tyvek | 26.0 × 0.9 mm | 32.0 × 28.8 × 4.1 mm |
| `slider_woven_15` | 15 mm woven fabric festival band | 16.0 × 1.6 mm | 32.0 × 27.9 × 4.8 mm |

**At the door:** stick the NFC tag in the pocket, then slide the open band end through the slider **before closing
the band** (Tyvek: before peeling the adhesive liner; woven: before crimping the lock bead). Once the band is closed,
the slider can't come off, and cutting the band off frees it to be reused.

**Printing:** flat, pocket up, no supports, 0.2 mm layers. The channel roof is a short bridge. PETG or PLA.

## Dimensions & Specifications

### 1. Snap-On Wristband Clip (19 mm & 25 mm)

The clip slides onto the Tyvek wristband prior to fastening or threads through after application.

| Dimension | 19 mm Version | 25 mm Version | Design Intent |
|---|---|---|---|
| **Outer Length (X)** | 44.0 mm | 44.0 mm | Accommodates Ø 25.5 mm pocket + short code zone |
| **Outer Width (Y)** | 28.5 mm | 30.0 mm | Minimum 1.5–2.0 mm side walls around slot & pocket |
| **Total Height (Z)** | 4.0 mm | 4.0 mm | $\le 4.0\text{ mm}$ constraint, sleek and low-profile |
| **Band Slot Width** | 20.0 mm | 26.0 mm | $W_{\text{band}} + 1.0\text{ mm}$ clearance |
| **Band Slot Height** | 0.8 mm | 0.8 mm | Accommodates 0.2 mm Tyvek with 0.6 mm glide tolerance |
| **Lead-In Funnel** | 1.0 mm depth | 1.0 mm depth | Chamfered entry/exit mouth (1.4 mm tall) for snag-free threading |
| **Sticker Pocket** | Ø 25.5 × 1.0 mm | Ø 25.5 × 1.0 mm | Holds standard 25.0 mm round NTAG213 sticker flush |
| **Short-Code Recess** | 13.0 × 8.0 × 0.4 mm | 13.0 × 8.0 × 0.4 mm | Frame for printed 4-char code sticker or marker |
| **Bottom Window** | 16.0 × 16.0 mm | 16.0 × 22.0 mm | Fingertip grip to slide band; forms two distinct belt loops |
| **Minimum Wall** | 1.2 mm | 1.2 mm | FDM-safe (3 perimeters with 0.4 mm nozzle) |
| **Corner Fillets** | R 3.0 mm | R 3.0 mm | Vertical corners filleted against snagging clothes |
| **Edge Fillets** | R 0.6 mm | R 0.6 mm | Smooth perimeter contact with wrist skin |

### 2. Variant B: Flat Adhesive Tag Carrier

An ultra-simple alternative carrier that can be threaded onto the band or adhered directly using double-sided mounting tape.

- **Outer Dimensions:** 44.0 mm × 30.0 mm × 2.2 mm total thickness.
- **Sticker Pocket:** Ø 25.5 mm × 1.0 mm depth in center.
- **Two Slits:** 26.0 mm wide × 1.4 mm long through-slots positioned at $X = \pm 16.0\text{ mm}$.
- **Back Face:** Flat planar surface suitable for 3M VHB tape or acrylic transfer adhesive.
- **Weight:** ~2.5 grams in PLA/PETG.

---

## 3D Printing Instructions (FDM)

The parts are specifically engineered to print **completely without support material**.

| Parameter | Recommended Setting | Notes |
|---|---|---|
| **Print Orientation** | Flat on print bed (bottom face down) | Sticker pocket and short-code pad face straight UP |
| **Nozzle Diameter** | 0.40 mm | Standard |
| **Layer Height** | 0.20 mm | 0.16 mm for extra fine surface finish |
| **Wall Perimeters** | 3 (minimum) | Gives 1.2 mm solid wall thickness |
| **Top Solid Layers** | 5 layers (1.0 mm) | Completely seals top above slot |
| **Bottom Solid Layers** | 5 layers (1.0 mm) | Flat, rigid contact with bed |
| **Infill** | 20% – 30% Gyroid or Grid | High strength, low print time (~12–15 min per clip) |
| **Supports** | **NONE (Disabled)** | Slot and bottom bridge spans are self-supporting |
| **Recommended Material** | **PETG** or **PLA+** | PETG is skin-safe, flexible, and sweat-resistant |

---

## How to Import into Onshape

1. Log into your [Onshape account](https://cad.onshape.com/).
2. Open an existing document or click **Create** $\rightarrow$ **Document** (e.g. `Homebound Hardware`).
3. Click the **+** (Insert new element) tab in the bottom-left corner of the workspace.
4. Select **Import...**.
5. Choose one of the STEP files:
   - `cad/out/clip_19mm.step`
   - `cad/out/clip_25mm.step`
   - `cad/out/carrier.step`
6. In the import dialog, select:
   - *Import to this Document*
   - *Create a Part Studio*
7. Onshape will process the parasolid/STEP geometry and create a new Part Studio containing the exact solid body with all dimensions, pocket recesses, and fillets intact.
8. To assemble with a wristband or NFC sticker model, switch to the **Assembly** tab, click **Insert**, and select the imported Part.

---

## How to Re-generate Models

From the project root:

```bash
cad/.venv/bin/python cad/clip.py
```

This runs CadQuery 2.8 in the local virtual environment and regenerates all STEP files, STL meshes, and PNG preview images in `cad/out/`.
