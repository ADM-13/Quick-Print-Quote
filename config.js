// ============================================================================
// CONFIG — every number you might want to tune lives in this file.
// Nothing here is hardcoded elsewhere in the app; change a value here and
// every quote recalculates against it.
// ============================================================================

export const CONFIG = {

  // --------------------------------------------------------------------
  // PRINTER PROFILES
  // Machine cost/hr is derived the same way your spreadsheet's "Adv. Inputs"
  // tab derives it: (capital cost/hr + electrical cost/hr) x buffer factor.
  // EDIT the raw inputs below (price, power, life) — machineCostPerHour is
  // calculated automatically in geometry.js, you don't need to hand-compute it.
  // --------------------------------------------------------------------
  printers: {
    p1s: {
      id: 'p1s',
      name: 'Bambu Lab P1S (AMS)',
      type: 'fdm',
      // Build plate usable area, mm. P1S bed is 256x256, 256mm Z.
      buildPlate: { x: 256, y: 256, z: 256 },

      // --- Machine depreciation inputs (mirrors your Adv. Inputs tab) ---
      purchasePrice: 800,        // paid ~$800 for the P1S + AMS
      additionalUpfrontCost: 0,  // upgrades since purchase
      annualMaintenance: 75,
      estimatedLifeYears: 3,
      estimatedUptimePercent: 0.5,   // 50% = busy printer
      avgPowerWatts: 150,
      electricityCostPerKwh: 0.14,
      costBufferFactor: 1.3,

      // --- Labor ---
      baseLaborMinutes: 10,      // your flat default, adjustable per job in the UI

      // --- Material efficiency (waste/failed-print buffer) ---
      baseEfficiencyFactor: 1.10,   // 1 color
      amsColorStep: 0.15,           // + per additional color: 2c=1.25, 3c=1.40, 4c=1.55

      materials: {
        PLA:  { costPerKg: 20, densityGcm3: 1.24 },
        PETG: { costPerKg: 20, densityGcm3: 1.27 },
        ABS:  { costPerKg: 20, densityGcm3: 1.04 },
      },
      defaultMaterial: 'PLA',

      // --- Print-time heuristic (calibrate against real prints — see README) ---
      // Volumetric flow rate the P1S typically sustains, mm3/s.
      flowRateMm3PerSec: 15,
      // Fixed per-layer overhead (travel, retraction, etc), seconds.
      perLayerOverheadSec: 4,
      layerHeightMm: 0.2,
    },

    photon: {
      id: 'photon',
      name: 'Anycubic Photon Mono X 6K',
      type: 'resin',
      // Usable build volume, mm (197.5 x 122 x 245 nominal — trimmed slightly for margin).
      buildPlate: { x: 190, y: 116, z: 240 },

      // --- Machine depreciation inputs ---
      purchasePrice: 300,        // paid ~$300 for the Photon Mono X 6K
      additionalUpfrontCost: 0,
      annualMaintenance: 50,
      estimatedLifeYears: 3,
      estimatedUptimePercent: 0.3,
      avgPowerWatts: 60,          // resin LCD/LED arrays draw much less than FDM hotend+bed
      electricityCostPerKwh: 0.14,
      costBufferFactor: 1.3,

      // --- Labor ---
      // No powered wash/cure station (IPA containers + sun cure), so no extra
      // machine-cost line for it — just the size-tiered labor addon below.
      laborBySizeTier: { small: 45, medium: 60, large: 90 }, // minutes

      // --- Material efficiency ---
      baseEfficiencyFactor: 1.05,

      materials: {
        StandardResin: { costPerLiter: 20, densityGcm3: 1.10 }, // $20/L, same as filament
      },
      defaultMaterial: 'StandardResin',

      // --- Print-time heuristic ---
      // Resin printers cure a whole layer at once — time is roughly
      // (num layers x exposure time) + a fixed lift/settle overhead per layer.
      layerHeightMm: 0.05,
      exposureSecPerLayer: 2.5,
      liftOverheadSecPerLayer: 3,
    },
  },

  // --------------------------------------------------------------------
  // PART SIZE TIERS — used to auto-pick the resin labor addon.
  // Based on estimated total resin volume (net part + supports) in cm3
  // (1 cm3 = 1 mL, so 1 liter = 1000 cm3).
  //   small:  < 0.25 L  (< 250 cm3)
  //   medium: 0.25 - 0.625 L (250 - 625 cm3)
  //   large:  > 0.625 L (> 625 cm3)
  // --------------------------------------------------------------------
  sizeTiers: {
    small:  { maxVolumeCm3: 250 },
    medium: { maxVolumeCm3: 625 },
    // anything above medium's max = large
  },

  // --------------------------------------------------------------------
  // FDM (P1S) SIZE TIERS — by longest bounding-box dimension, for postage
  // defaults only (not a build-volume constraint — that's checked
  // separately). ASSUMPTION: your 3x3x3 / 8x8x8 / 12x12x12 were inches
  // (matches typical shipping box sizes) — edit maxDimMm below if you
  // meant cm or something else.
  //   small:  longest side < 3 in  (< 76.2 mm)
  //   medium: longest side 3-8 in (76.2 - 203.2 mm)
  //   large:  longest side > 8 in (> 203.2 mm) — 12x12x12 is the
  //           reference "large" box, not a hard ceiling
  // --------------------------------------------------------------------
  sizeTiersFdm: {
    small:  { maxDimMm: 76.2 },
    medium: { maxDimMm: 203.2 },
  },

  // Default postage ($) by size tier — same small/medium/large labels as
  // above, whichever tier system is active for the selected printer.
  // Auto-fills the "Postage" packaging line; you can still edit it per job.
  postageBySizeTier: { small: 6, medium: 8, large: 12 },

  // --------------------------------------------------------------------
  // GEOMETRY / SLICING-HEURISTIC ASSUMPTIONS (FDM)
  // These stand in for a real slicer. All configurable — see README for
  // how to calibrate them against actual sliced jobs.
  // --------------------------------------------------------------------
  fdmEstimate: {
    wallLoops: 2,
    nozzleWidthMm: 0.42,
    infillPercent: 0.15,
    topBottomShellLayers: 4,
    // Overhang angle (from vertical) beyond which a face is considered
    // to need support. 45deg is the common slicer default.
    overhangThresholdDeg: 45,
    // Rough average support material as a fraction of overhang-area x height.
    // i.e. supportVolume = overhangArea x (bboxHeight x thisFactor)
    supportVolumeFactor: 0.08,
  },

  resinEstimate: {
    // Resin prints are mostly hollowed + supported in practice. Assuming a
    // fully solid part (the old behavior here) badly overestimates material
    // on anything but small parts — real resin workflows hollow to a thin
    // shell to save resin, often a 70-90% material cut on bigger prints.
    supportVolumeFraction: 0.12, // supports as a fraction of the (now-hollowed) part volume
    hollowWallMm: 2.5,           // shell thickness once hollowed
    // Fraction of the INTERIOR (volume beyond the shell) that's actually
    // filled. Small parts are commonly left solid (not worth the drain-hole
    // hassle to save a few grams); medium/large get hollowed with little to
    // no interior infill — resin parts get their strength from the shell
    // itself, unlike FDM, so there's no structural need to fill the inside.
    interiorFillBySizeTier: { small: 1.0, medium: 0.05, large: 0.02 },
  },

  // --------------------------------------------------------------------
  // CUSTOM MATERIAL — starting values shown when someone picks "Custom"
  // in the material dropdown. Purely a UI default, not a real material.
  // --------------------------------------------------------------------
  customMaterialDefaults: {
    costPerUnit: 20,     // $/kg (FDM) or $/L (resin)
    densityGcm3: 1.2,
  },

  // --------------------------------------------------------------------
  // TOGGLEABLE EXTRAS — flat add-on fees the customer can opt into.
  // type: 'addon' = flat fee added on top of landed cost.
  // type: 'shipping-override' = replaces the Postage line entirely
  // (only one shipping-override can be active at a time — the UI enforces
  // that as radio-like behavior between the shipping options).
  // --------------------------------------------------------------------
  extras: [
    { id: 'priority',     label: 'Priority order',      amount: 35, type: 'addon' },
    { id: 'fineDetail',   label: 'Finer detail print',   amount: 20, type: 'addon' },
    { id: 'ship2day',     label: '2-day shipping',       amount: 30, type: 'shipping-override' },
    { id: 'shipNextDay',  label: 'Next day shipping',    amount: 90, type: 'shipping-override' },
  ],

  // --------------------------------------------------------------------
  // BUSINESS / PRICING (ported directly from your spreadsheet)
  // --------------------------------------------------------------------
  pricing: {
    laborRatePerHour: 35,
    marginTiers: [0.50, 0.60, 0.70],
    // Material and machine (printer) time scale fully linearly with
    // quantity — printing 3 costs 3x the plastic/resin and 3x the machine
    // hours. Labor and packaging don't scale 1:1 in real life (batching
    // support removal, packing several into one box), so each additional
    // unit beyond the first costs this fraction of a full unit instead of
    // a full unit. 0.5 = each extra unit costs half as much labor/packaging
    // as the first. 1.0 = no discount (fully linear). Tune to taste.
    repeatUnitEfficiency: 0.5,
    // Fiverr's cut of whatever you actually charge, used only to show
    // your own take-home profit per tier — never shown to the customer.
    fiverrFeePercent: 0.20,
  },

  // Bias factor applied to the FINAL material + time estimate before
  // costing, per your "err on the higher side" preference. 1.0 = no bias.
  estimateSafetyMargin: 1.10,
};
