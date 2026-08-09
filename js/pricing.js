// ============================================================================
// PRICING — direct port of print_pricing_calculator.xlsx's "Calculation
// Sheet" formulas. Given the same inputs, this produces the same landed
// cost and margin prices as the spreadsheet.
// ============================================================================

/** 1.10 base + 0.15 per color beyond the first (2c=1.25, 3c=1.40, 4c=1.55). */
function efficiencyFactorForColors(baseFactor, colorStep, numColors) {
  return baseFactor + colorStep * Math.max(0, numColors - 1);
}

/**
 * @param {Object} p
 * @param {number} p.gramsOrMl            - net material estimate, pre-efficiency, PER UNIT
 * @param {number} p.costPerKgOrLiter     - material cost, $/kg (FDM) or $/L (resin)
 * @param {number} p.efficiencyFactor     - from efficiencyFactorForColors() (FDM) or printer.baseEfficiencyFactor (resin)
 * @param {number} p.quantity             - how many of this part
 * @param {number} p.printHours           - PER UNIT print time
 * @param {number} p.machineCostPerHour
 * @param {number} p.laborMinutes         - PER UNIT labor (base + any resin size-tier addon)
 * @param {number} p.laborRatePerHour
 * @param {Array<{name:string, qty:number, unitCost:number}>} p.materialsExtra  - hardware/components, like the spreadsheet's Hardware 1-7 rows
 * @param {Array<{name:string, qty:number, unitCost:number}>} p.packaging      - box, tape, insert, postage, etc. — cost for ONE unit's worth
 * @param {number} p.repeatUnitEfficiency - fraction of a full unit each unit beyond the first costs, for labor & packaging (1.0 = no discount)
 * @param {number} p.safetyMargin         - final bias multiplier, "err high" (1.0 = none)
 * @param {number[]} p.marginTiers        - e.g. [0.5, 0.6, 0.7]
 */
function calculateQuote(p) {
  const quantity = Math.max(1, p.quantity);
  // Material and machine time scale fully linearly with quantity. Labor and
  // packaging get a per-unit discount past the first unit (batching effect).
  const repeatEfficiency = p.repeatUnitEfficiency ?? 1.0;
  const discountedUnits = 1 + (quantity - 1) * repeatEfficiency;

  // Materials section (mirrors G17:G26 in the spreadsheet) — full linear scale
  const printedPartUnitCost = (p.gramsOrMl / 1000) * p.costPerKgOrLiter * p.efficiencyFactor;
  const printedPartTotalCost = printedPartUnitCost * quantity;
  const extraMaterialsCost = (p.materialsExtra || []).reduce((sum, m) => sum + m.qty * m.unitCost, 0);
  const totalMaterialsCost = printedPartTotalCost + extraMaterialsCost;

  // Labor section (mirrors G28) — discounted per repeated unit
  const laborCostPerUnit = (p.laborMinutes / 60) * p.laborRatePerHour;
  const totalLaborCost = laborCostPerUnit * discountedUnits;

  // Packaging section (mirrors G32:G41) — cost for one unit's packaging,
  // discounted per repeated unit (shipping several together costs less
  // than shipping each separately)
  const packagingCostPerUnit = (p.packaging || []).reduce((sum, pkg) => sum + pkg.qty * pkg.unitCost, 0);
  const totalPackagingCost = packagingCostPerUnit * discountedUnits;

  // Machine cost (mirrors G43) — full linear scale, printer is tied up the
  // whole time regardless of batching
  const machineCost = p.printHours * p.machineCostPerHour * quantity;

  // Landed cost (mirrors G45), with the "err high" safety margin applied
  const landedCostRaw = totalMaterialsCost + totalLaborCost + totalPackagingCost + machineCost;
  const landedCost = landedCostRaw * p.safetyMargin;

  // Margin-tier pricing (mirrors G49/G51/G53: price = cost / (1 - margin))
  const prices = p.marginTiers.map((m) => ({
    marginPercent: m * 100,
    price: landedCost / (1 - m),
  }));

  return {
    printedPartUnitCost,
    printedPartTotalCost,
    extraMaterialsCost,
    totalMaterialsCost,
    totalLaborCost,
    totalPackagingCost,
    machineCost,
    landedCostRaw,
    landedCost,
    prices,
  };
}

export { efficiencyFactorForColors, calculateQuote };
