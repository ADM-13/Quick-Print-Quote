# Print Quote

A phone-friendly, free, static quoting tool for your Fiverr 3D printing
business. Drop in one or more STL/OBJ/3MF files, pick your printer and
material, and it spits out a landed cost and 50/60/70% margin pricing —
same math as your `print_pricing_calculator.xlsx`, just fed by a geometry
estimate instead of manual entry.

**This is a ballpark tool, not a slicer.** Nothing here is uploaded
anywhere — all analysis happens in your phone's browser.

## What it does

- Reads STL/OBJ/3MF (multiple files at once, quoted together as one job —
  handy for multi-component parts)
- Turnable 3D preview of what you loaded
- Estimates material, support material, print time, and checks it against
  each printer's actual bed size (flags parts that will need splitting)
- Auto-suggests a size tier (small/medium/large) — by resin volume for the
  Photon, by bounding-box dimension for the P1S — which drives default
  labor and postage, all overridable
- Custom material option if you're quoting something outside your usual
  filament/resin — just a cost, no density prompt (assumes a standard ~1kg
  spool at typical filament density internally)
- "Quote by size instead" — for when someone gives you dimensions with no
  file. Enter L x W x H (mm or inches) and it's treated as a solid block of
  that size, run through the same estimate pipeline. Deliberately
  conservative (a solid block is the max possible material for that
  envelope), which fits an "err high with no real file" situation.
- mm/inches toggle for all displayed dimensions
- Toggleable add-ons (Priority order, Finer detail print) and shipping
  upgrades (2-day/next-day, which replace the postage line rather than
  stacking with it)
- Tap any margin price to get a customer-shareable view: a part photo,
  size, material used, and print time, plus a cost breakdown — labor and
  packaging/shipping shown at exact cost, with the margin folded into the
  materials and printing lines instead (so the total still matches what
  you're actually charging, it's just displayed differently). No landed
  cost, no orientation info, no margin percentage shown — plus a "copy as
  text" button for pasting into Fiverr chat
- Reset button to clear everything and start the next job fresh

## Deploy it (free, GitHub Pages)

**Important: this app must be opened through a real URL (like the GitHub
Pages one below), never by double-clicking `index.html` or dragging it into
a browser tab.** Browsers block this app's scripts entirely when opened as
a local file — not one broken feature, everything at once (buttons do
nothing, dropdowns don't populate, nothing calculates). The app now shows
an on-screen warning if this happens, but it's worth knowing up front.

1. Create a new GitHub repo (public — GitHub Pages on a free account requires public repos).
2. Upload everything in this folder (`index.html`, `css/`, `js/`) to the repo root.
3. In the repo: **Settings → Pages → Source → Deploy from branch → main → / (root)**.
4. Wait ~1 minute, then visit `https://<your-username>.github.io/<repo-name>/`.
5. Add it to your phone's home screen (Safari/Chrome → Share → Add to Home Screen) so it opens like an app.

No build step, no npm install — it's plain HTML/CSS/JS. Three.js loads from
a CDN (unpkg) at runtime, so you need an internet connection to use it (fine
for a phone tool, but worth knowing).

### Updating the app after the first deploy

`index.html` loads `css/style.css` and `js/app.js` with a `?v=8` on the end.
That's a cache-buster — without it, browsers (and GitHub Pages' own CDN)
can keep serving an old cached copy of those files even after you've pushed
new ones, which looks exactly like "I made the change but nothing's
different." **Bump that number (`?v=8`, `?v=9`, ...) every time you push an
update** to force a fresh fetch. If something still looks unchanged after a
version bump, try a hard refresh (Ctrl/Cmd+Shift+R) or an incognito/private
window to rule out the browser cache specifically.

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
- **Material estimate (resin)**: hollowed volume (shell wall + a small
  interior fill for medium/large parts, solid for small ones, matching how
  resin is actually sliced in practice) + a flat support-volume allowance.
  Small parts are left solid since hollowing them isn't usually worth the
  hassle; medium/large parts assume near-zero interior fill once hollowed.
- **Print time**: a volumetric-flow heuristic for FDM, layer-count ×
  exposure time for resin. **This is the least reliable number** — time
  depends heavily on speed/quality settings that geometry alone can't tell
  you.
- **Plate fit**: checks each part's bounding box against the selected
  printer's bed size (in both footprint orientations) and flags "needs
  splitting" if it doesn't fit anywhere — it does NOT attempt to actually
  split the mesh.
- **Multi-file jobs**: material and time are summed across all loaded files;
  the size tier (and its labor/postage defaults) is based on the combined
  total, not any single part.
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
- P1S size tiers by longest dimension: small ≤3in, medium ≤8in, large >8in
  (reference "large" box is 12x12x12in) — used for postage defaults only,
  not shown in the UI
- Resin size tiers by volume needed: small <0.25L, medium 0.25–0.625L, large >0.625L
- Default postage by size tier: $6 / $8 / $12
- Add-ons: Priority order $35, Finer detail print $20, 2-day shipping $30
  (overrides postage), Next day shipping $90 (overrides postage)

These all live in `js/config.js` if they ever change.

## Editable at any time in the app itself

- Printer, material (including a custom one-off), quantity, labor minutes
- Number of AMS colors (FDM) or size tier (resin) — either can be overridden
  per job
- Hardware/extra-materials line items
- Packaging & shipping line items (postage auto-fills from size tier but is
  editable — editing it manually stops it from auto-updating)
- mm/inches display
- Add-on toggles and shipping upgrade selection

