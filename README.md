# Print Quote

A phone-friendly, free, static quoting tool for your Fiverr 3D printing
business. Drop in an STL/OBJ/3MF, pick your printer and material, and it
spits out a landed cost and 50/60/70% margin pricing — same math as your
`print_pricing_calculator.xlsx`, just fed by a geometry estimate instead of
manual entry.

**This is a ballpark tool, not a slicer.** Nothing here is uploaded
anywhere — all analysis happens in your phone's browser.

## Deploy it (free, GitHub Pages)

1. Create a new GitHub repo (public — GitHub Pages on a free account requires public repos).
2. Upload everything in this folder (`index.html`, `css/`, `js/`) to the repo root.
3. In the repo: **Settings → Pages → Source → Deploy from branch → main → / (root)**.
4. Wait ~1 minute, then visit `https://<your-username>.github.io/<repo-name>/`.
5. Add it to your phone's home screen (Safari/Chrome → Share → Add to Home Screen) so it opens like an app.

No build step, no npm install — it's plain HTML/CSS/JS. Three.js loads from
a CDN (unpkg) at runtime, so you need an internet connection to use it (fine
for a phone tool, but worth knowing).

## How the estimate works (and where it's weakest)

There's no real slicer here — running one client-side for free isn't
practical. Instead:

- **Volume & surface area**: computed exactly from the mesh triangles (this
  part is exact, not a heuristic).
- **Best orientation**: tests 6 axis-aligned candidate rotations (each
  bounding-box face "down") and picks the one with the least downward-facing
  ("overhang") surface area. Real slicers use more sophisticated search —
  this is a reasonable proxy, not a replacement.
- **Material estimate (FDM)**: shell volume (surface area × wall loops ×
  nozzle width) + infill volume (remaining volume × infill %) + a support
  estimate from overhang area. All the multipliers are in `js/config.js`.
- **Material estimate (resin)**: net volume + a flat support-volume
  percentage.
- **Print time**: a volumetric-flow heuristic for FDM, layer-count ×
  exposure time for resin. **This is the least reliable number** — time
  depends heavily on speed/quality settings that geometry alone can't tell
  you.
- **Plate fit**: checks the bounding box against each printer's bed size (in
  both footprint orientations) and flags "needs splitting" if it doesn't
  fit anywhere — it does NOT attempt to actually split the mesh.
- **STEP files are not supported.** They're a CAD (B-rep) format, not a
  mesh — reading them needs a real CAD kernel, which isn't practical for a
  free, static, client-side tool. Quote those manually as you do today.

Every FDM/resin job also gets the `estimateSafetyMargin` (1.10 by default)
applied on top, per your "err on the high side" preference.

## Calibrating it against real prints

The formulas above are reasonable starting points, not measured constants.
To tighten them:

1. Slice a real part in Bambu Studio / your resin slicer, note the actual
   grams and time.
2. Run the same file through this app, compare.
3. Adjust the relevant constants in `js/config.js`:
   - Estimate running high on material? Lower `infillPercent` or
     `supportVolumeFactor` (FDM) / `supportVolumeFraction` (resin).
   - Estimate running high/low on time? Adjust `flowRateMm3PerSec` /
     `perLayerOverheadSec` (FDM) or `exposureSecPerLayer` (resin).
   - Repeat with a few parts of different shapes (tall/thin vs. flat/wide)
     to avoid over-fitting to one geometry.

## Your numbers, already filled in

- Printer purchase prices: P1S ~$800, Photon Mono X 6K ~$300
- Material cost: $20/kg for all filament types, $20/L for resin

These live in `js/config.js` if they ever change (new printer, price increase, etc).

## Still open

- `sizeTiers` thresholds — placeholder volume cutoffs for small/medium/large
  resin parts; adjust once you see where your real jobs land.

## Editable at any time in the app itself

- Printer, material, quantity, labor minutes (per job override)
- Number of AMS colors (FDM) or size tier (resin)
- Hardware/extra-materials line items
- Packaging & shipping line items
