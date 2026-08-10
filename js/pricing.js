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
 * @param {Array<{name:string, qty:number, unitCost:number}>} p.packaging      - box, tape, insert, postage, etc. — cost for ONE unit's worth. A row named "Postage" (case-insensitive) is treated specially by shippingOverrideAmount.
 * @param {number|null} p.shippingOverrideAmount - if set, replaces the "Postage" row's cost entirely (e.g. a paid shipping upgrade)
 * @param {Array<{name:string, amount:number}>} p.addOns - flat opt-in fees (priority order, finer detail, etc), NOT scaled by quantity or repeat-unit discount
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
  // than shipping each separately). A shipping-upgrade add-on (2-day,
  // next-day) replaces whatever is in the "Postage" row rather than
  // stacking with it.
  const packagingItems = p.packaging || [];
  const postageItemsCost = packagingItems
    .filter((pkg) => pkg.name.trim().toLowerCase() === 'postage')
    .reduce((sum, pkg) => sum + pkg.qty * pkg.unitCost, 0);
  const otherPackagingCost = packagingItems
    .filter((pkg) => pkg.name.trim().toLowerCase() !== 'postage')
    .reduce((sum, pkg) => sum + pkg.qty * pkg.unitCost, 0);
  const effectivePostageCost = p.shippingOverrideAmount ?? postageItemsCost;
  const packagingCostPerUnit = otherPackagingCost + effectivePostageCost;
  const totalPackagingCost = packagingCostPerUnit * discountedUnits;

  // Machine cost (mirrors G43) — full linear scale, printer is tied up the
  // whole time regardless of batching
  const machineCost = p.printHours * p.machineCostPerHour * quantity;

  // Add-ons (mirrors nothing in the spreadsheet — new opt-in fees). Flat,
  // one-time per order, not scaled by quantity, the repeat-unit discount,
  // OR the profit margin below — the customer pays exactly the add-on
  // price, full stop.
  const addOnsCost = (p.addOns || []).reduce((sum, a) => sum + a.amount, 0);

  // Landed cost (mirrors G45): the actual production cost, with the
  // "err high" safety margin applied. This is the cost basis the profit
  // margin gets applied to — add-ons are NOT part of it.
  const landedCostRaw = totalMaterialsCost + totalLaborCost + totalPackagingCost + machineCost;
  const landedCost = landedCostRaw * p.safetyMargin;

  // Margin-tier pricing (mirrors G49/G51/G53: price = cost / (1 - margin),
  // then add-ons added flat on top). Rounded to the nearest dollar for a
  // cleaner customer-facing number — everything downstream (Fiverr fee,
  // your profit) is computed off that rounded, actually-charged price.
  const fiverrFeePercent = p.fiverrFeePercent ?? 0;
  const prices = p.marginTiers.map((m) => {
    const rawPrice = landedCost / (1 - m) + addOnsCost;
    const price = Math.round(rawPrice);
    const fiverrFee = price * fiverrFeePercent;
    // Add-ons are treated as ~zero extra cost to you (pure upsell), so
    // they aren't subtracted here alongside the real production cost.
    const profit = price - fiverrFee - landedCost;
    return { marginPercent: m * 100, price, fiverrFee, profit };
  });

  return {
    printedPartUnitCost,
    printedPartTotalCost,
    extraMaterialsCost,
    totalMaterialsCost,
    totalLaborCost,
    totalPackagingCost,
    machineCost,
    addOnsCost,
    landedCostRaw,
    landedCost,
    prices,
  };
}

/**
 * Customer-facing breakdown for one margin tier. Packaging/shipping and
 * add-ons are shown 1:1 (no profit margin applied) — the entire margin is
 * instead folded proportionally into materials, labor, and printing so the
 * lines still sum exactly to that tier's (rounded) price. No margin
 * percent or landed cost is exposed.
 */
function customerBreakdownForTier(quote, tierIndex) {
  const tier = quote.prices[tierIndex];
  const packaging = quote.totalPackagingCost;
  const addOns = quote.addOnsCost;
  const remaining = tier.price - packaging - addOns;
  const rawSum = quote.totalMaterialsCost + quote.totalLaborCost + quote.machineCost;
  const factor = rawSum > 0 ? remaining / rawSum : 0;
  return {
    materials: quote.totalMaterialsCost * factor,
    labor: quote.totalLaborCost * factor,
    machine: quote.machineCost * factor,
    packaging,
    addOns,
    total: tier.price,
  };
}

export { efficiencyFactorForColors, calculateQuote, customerBreakdownForTier };
