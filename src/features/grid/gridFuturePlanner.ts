import {
  GridBuyLot,
  GridCycle,
  GridFill,
  GridFutureFreeShareTarget,
  GridFutureLotFragment,
  GridFutureMatchEvent,
  GridFutureSettings,
  GridFutureSlot,
  GridFutureState,
  GridSide,
} from "./gridTypes";

const EPS = 1e-12;

export const DEFAULT_GRID_FUTURE_SETTINGS: GridFutureSettings = {
  anchorPrice: 0,
  capitalAllocated: 1000,
  gridLevels: 20,
  buyStepPercent: 1,
  sellTargetPercent: 1,
  shareSaleMode: "sell_original_notional",
  reserveCapitalForUnfilledOrders: false,
  freeShareExitMode: "scale_out_by_grid",
  freeShareReferenceCostMode: "active_grid_average_cost",
  freeShareTargetPercentAboveAverageCost: 2,
  freeShareScaleOutPercent: 1,
  freeShareScaleOutLevels: 5,
  freeShareStartPercentAboveAvgCost: 1,
  manualReferencePrice: null,
  priceTickSize: 0.01,
  quantityPrecision: 8,
  feePerTrade: 0,
  feePercent: 0,
  allowFractionalShares: true,
  roundShareQuantityDown: false,
  autoCreateNewBottomBuys: true,
  marketPrice: null,
};

export function withGridFutureSettingsDefaults(
  partial: Partial<GridFutureSettings>,
  context?: { selectedCycle?: GridCycle; marketPrice?: number | null },
): GridFutureSettings {
  const anchor =
    partial.anchorPrice ??
    context?.selectedCycle?.entryPrice ??
    context?.marketPrice ??
    DEFAULT_GRID_FUTURE_SETTINGS.anchorPrice;
  return {
    ...DEFAULT_GRID_FUTURE_SETTINGS,
    ...partial,
    freeShareExitMode: "scale_out_by_grid",
    anchorPrice: anchor,
    marketPrice:
      context?.marketPrice ?? partial.marketPrice ?? DEFAULT_GRID_FUTURE_SETTINGS.marketPrice,
  };
}

function roundPrice(price: number, tick: number): number {
  if (tick <= 0) return price;
  return Math.round(price / tick) * tick;
}

function roundQty(qty: number, precision: number, roundDown: boolean): number {
  if (!Number.isFinite(qty)) return 0;
  const factor = Math.pow(10, Math.max(0, precision));
  if (roundDown) return Math.floor(qty * factor) / factor;
  return Math.round(qty * factor) / factor;
}

function feeForNotional(notional: number, settings: GridFutureSettings): number {
  return settings.feePerTrade + (notional * settings.feePercent) / 100;
}

function safeDiv(n: number, d: number): number {
  return Math.abs(d) > EPS ? n / d : 0;
}

export function generateCompoundBuyLevels(settings: GridFutureSettings): Array<{
  level: number;
  buyPrice: number;
  buyQuantity: number;
  buyNotional: number;
  projectedSellPrice: number;
}> {
  const buyStep = settings.buyStepPercent / 100;
  const sellStep = settings.sellTargetPercent / 100;
  const capitalPerLevel = safeDiv(settings.capitalAllocated, settings.gridLevels);
  const levels: Array<{
    level: number;
    buyPrice: number;
    buyQuantity: number;
    buyNotional: number;
    projectedSellPrice: number;
  }> = [];

  for (let i = 1; i <= Math.max(0, settings.gridLevels); i += 1) {
    const rawBuy = settings.anchorPrice * Math.pow(1 - buyStep, i);
    const buyPrice = roundPrice(rawBuy, settings.priceTickSize);
    const qtyRaw = safeDiv(capitalPerLevel, buyPrice);
    const buyQuantity = roundQty(qtyRaw, settings.quantityPrecision, settings.roundShareQuantityDown);
    const buyNotional = buyPrice * buyQuantity;
    const projectedSellPrice = roundPrice(buyPrice * (1 + sellStep), settings.priceTickSize);
    levels.push({
      level: i,
      buyPrice,
      buyQuantity,
      buyNotional,
      projectedSellPrice,
    });
  }

  return levels;
}

type OpenSlotLot = {
  fragmentId: string;
  slotId: string;
  side: GridSide;
  sourceFillId: string | number;
  totalQuantity: number;
  openQty: number;
  openPrice: number;
  openTime: string;
  accountingBasis: number;
};

function getReferencePriceForFreeShareTargets(
  settings: GridFutureSettings,
  activeGridAverageCost: number,
  blendedAccountingAverageCost: number,
  blendedStrategyAverageCost: number,
): number {
  if (
    settings.freeShareReferenceCostMode === "manual_reference_price" &&
    settings.manualReferencePrice != null &&
    settings.manualReferencePrice > 0
  ) {
    return settings.manualReferencePrice;
  }
  if (settings.freeShareReferenceCostMode === "blended_accounting_average_cost") {
    return blendedAccountingAverageCost;
  }
  if (settings.freeShareReferenceCostMode === "blended_strategy_average_cost") {
    return blendedStrategyAverageCost;
  }
  return activeGridAverageCost;
}

function buildFreeShareTargets(
  settings: GridFutureSettings,
  freeSharesTotalQuantity: number,
  referenceCost: number,
): GridFutureFreeShareTarget[] {
  if (settings.freeShareExitMode !== "scale_out_by_grid") return [];
  const n = Math.max(0, Math.floor(settings.freeShareScaleOutLevels));
  if (n <= 0 || freeSharesTotalQuantity <= EPS || referenceCost <= EPS) return [];

  const start =
    referenceCost * (1 + settings.freeShareStartPercentAboveAvgCost / 100);
  const step = settings.freeShareScaleOutPercent / 100;
  const perLevelQty = freeSharesTotalQuantity / n;
  const targets: GridFutureFreeShareTarget[] = [];
  for (let k = 1; k <= n; k += 1) {
    const price = roundPrice(start * Math.pow(1 + step, k - 1), settings.priceTickSize);
    targets.push({
      level: k,
      price,
      quantity: roundQty(perLevelQty, settings.quantityPrecision, settings.roundShareQuantityDown),
    });
  }
  return targets;
}

export function buildGridFutureState(
  settingsInput: GridFutureSettings,
  selectedCycle: GridCycle | undefined,
): GridFutureState {
  const settings: GridFutureSettings = {
    ...settingsInput,
    freeShareExitMode: "scale_out_by_grid",
  };
  const fills = (selectedCycle?.fills ?? [])
    .filter((f) => f.kind !== "ORDER" && f.status !== "CANCELLED")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const buyStep = settings.buyStepPercent / 100;
  const sellStep = settings.sellTargetPercent / 100;
  const capitalPerLevel = safeDiv(settings.capitalAllocated, settings.gridLevels);

  const slots: GridFutureSlot[] = [];
  const freeShareLots = [] as GridFutureState["freeShareLots"];
  const openLots: OpenSlotLot[] = [];
  const matchEvents: GridFutureMatchEvent[] = [];

  let realizedPL = 0;
  let capitalRecovered = 0;
  let ladderSequence = 1;

  const createSlotFromOpenFill = (fill: GridFill): GridFutureSlot => {
    const slotId = `slot-${fill.id}-${ladderSequence}`;
    const targetSellPrice = roundPrice(fill.price * (1 + sellStep), settings.priceTickSize);
    const existing = slots.find(
      (s) =>
        s.status === "waiting_sell" &&
        s.plannedSellPrice != null &&
        Math.abs(s.plannedSellPrice - targetSellPrice) <= settings.priceTickSize / 2,
    );
    if (existing) {
      existing.plannedBuyQuantity += fill.quantity;
      existing.plannedBuyNotional += fill.price * fill.quantity;
      existing.filledBuyQuantity = (existing.filledBuyQuantity ?? 0) + fill.quantity;
      existing.filledBuyNotional = (existing.filledBuyNotional ?? 0) + fill.price * fill.quantity;
      existing.buyFees += feeForNotional(fill.price * fill.quantity, settings);
      existing.remainingLotQuantity += fill.quantity;
      existing.remainingLotAccountingBasis += fill.price * fill.quantity;
      existing.sourceBuyFillCount = (existing.sourceBuyFillCount ?? 1) + 1;
      existing.sourceBuyAveragePrice = safeDiv(
        existing.remainingLotAccountingBasis,
        existing.remainingLotQuantity,
      );
      existing.plannedSellQuantity =
        settings.shareSaleMode === "sell_full_quantity"
          ? existing.remainingLotQuantity
          : Math.min(
              existing.remainingLotQuantity,
              safeDiv(
                Math.max(0, capitalPerLevel - existing.principalRecovered),
                existing.plannedSellPrice ?? targetSellPrice,
              ),
            );

      const fragmentId = `frag-${fill.id}-${existing.slotId}-${existing.sourceBuyFillCount}`;
      openLots.push({
        fragmentId,
        slotId: existing.slotId,
        side: fill.side,
        sourceFillId: fill.id,
        totalQuantity: fill.quantity,
        openQty: fill.quantity,
        openPrice: fill.price,
        openTime: fill.timestamp,
        accountingBasis: fill.price * fill.quantity,
      });
      return existing;
    }

    const plannedSellQuantity =
      settings.shareSaleMode === "sell_full_quantity"
        ? fill.quantity
        : Math.min(fill.quantity, safeDiv(capitalPerLevel, targetSellPrice));

    const slot: GridFutureSlot = {
      slotId,
      ladderSequence,
      plannedBuyPrice: fill.price,
      plannedBuyQuantity: fill.quantity,
      plannedBuyNotional: fill.price * fill.quantity,
      buyOrderId: null,
      buyPlacedTime: fill.timestamp,
      buyFilledTime: fill.timestamp,
      filledBuyPrice: fill.price,
      filledBuyQuantity: fill.quantity,
      filledBuyNotional: fill.price * fill.quantity,
      buyFees: feeForNotional(fill.price * fill.quantity, settings),
      sellMode: settings.shareSaleMode,
      plannedSellPrice: targetSellPrice,
      plannedSellQuantity,
      sellOrderId: null,
      sellPlacedTime: null,
      sellFilledTime: null,
      filledSellPrice: null,
      filledSellQuantity: null,
      filledSellNotional: null,
      sellFees: 0,
      principalRecovered: 0,
      freeShareQuantityCreated: 0,
      remainingLotQuantity: fill.quantity,
      remainingLotAccountingBasis: fill.price * fill.quantity,
      linkedFreeShareLotIds: [],
      status: "waiting_sell",
      targetBuyPrice: roundPrice(targetSellPrice * (1 - buyStep), settings.priceTickSize),
      targetSellPrice,
      sourceCycleFillId: fill.id,
      sourceBuyAveragePrice: fill.price,
      sourceBuyFillCount: 1,
    };
    ladderSequence += 1;
    slots.push(slot);

    const fragmentId = `frag-${fill.id}-${slotId}-1`;
    openLots.push({
      fragmentId,
      slotId,
      side: fill.side,
      sourceFillId: fill.id,
      totalQuantity: fill.quantity,
      openQty: fill.quantity,
      openPrice: fill.price,
      openTime: fill.timestamp,
      accountingBasis: fill.price * fill.quantity,
    });
    return slot;
  };

  for (const fill of fills) {
    const isOpening = fill.side === (selectedCycle?.entrySide ?? "BUY");
    if (isOpening) {
      createSlotFromOpenFill(fill);
      continue;
    }

    // Dynamic matching: eligible lots = remainingQty > 0, buyPrice <= sellPrice
    // Sort by buyPrice descending (closest buy below sell price first)
    let remainingCloseQty = fill.quantity;
    const eligible = openLots
      .filter((l) => l.openQty > EPS && l.openPrice <= fill.price)
      .sort((a, b) => b.openPrice - a.openPrice);

    for (const lot of eligible) {
      if (remainingCloseQty <= EPS) break;

      const matched = Math.min(lot.openQty, remainingCloseQty);
      const slot = slots.find((s) => s.slotId === lot.slotId);
      if (!slot) continue;

      const matchedOpenBasis = safeDiv(lot.accountingBasis * matched, lot.openQty);
      const closeNotional = fill.price * matched;
      const closeFee = feeForNotional(closeNotional, settings);
      const pnlSigned =
        lot.side === "BUY"
          ? (fill.price - lot.openPrice) * matched
          : (lot.openPrice - fill.price) * matched;
      realizedPL += pnlSigned - closeFee;
      matchEvents.push({
        matchId: `match-${fill.id}-${lot.fragmentId}-${matchEvents.length + 1}`,
        slotId: lot.slotId,
        openFragmentId: lot.fragmentId,
        closeFillId: fill.id,
        matchedQty: matched,
        openPrice: lot.openPrice,
        closePrice: fill.price,
        openTime: lot.openTime,
        closeTime: fill.timestamp,
      });

      slot.filledSellPrice = fill.price;
      slot.filledSellQuantity = (slot.filledSellQuantity ?? 0) + matched;
      slot.filledSellNotional = (slot.filledSellNotional ?? 0) + closeNotional;
      slot.sellFilledTime = fill.timestamp;
      slot.sellFees += closeFee;
      slot.remainingLotQuantity = Math.max(0, slot.remainingLotQuantity - matched);
      slot.remainingLotAccountingBasis = Math.max(
        0,
        slot.remainingLotAccountingBasis - matchedOpenBasis,
      );

      if (settings.shareSaleMode === "sell_original_notional") {
        const recovered = Math.min(
          capitalPerLevel - slot.principalRecovered,
          closeNotional,
        );
        slot.principalRecovered += Math.max(0, recovered);
        capitalRecovered += Math.max(0, recovered);

        // Free-share creation when principal has been recovered and shares remain.
        if (
          slot.principalRecovered >= capitalPerLevel - EPS &&
          slot.remainingLotQuantity > EPS
        ) {
          const lotId = `free-${slot.slotId}-${freeShareLots.length + 1}`;
          if (!slot.linkedFreeShareLotIds.includes(lotId)) {
            freeShareLots.push({
              freeShareLotId: lotId,
              sourceSlotId: slot.slotId,
              sourceBuyPrice: slot.filledBuyPrice ?? slot.plannedBuyPrice,
              sourceBuyTime: slot.buyFilledTime ?? slot.buyPlacedTime ?? fill.timestamp,
              sourceSellTime: fill.timestamp,
              quantity: slot.remainingLotQuantity,
              accountingBasis: slot.remainingLotAccountingBasis,
              strategyBasis: 0,
              createdAt: fill.timestamp,
              targetExitMode: settings.freeShareExitMode,
              targetExitPrice: null,
              status: "held",
            });
            slot.linkedFreeShareLotIds.push(lotId);
          }
          slot.freeShareQuantityCreated = slot.remainingLotQuantity;
          slot.status = "principal_recovered_holding_free_shares";
        } else if (slot.remainingLotQuantity <= EPS) {
          slot.status = "completed";
        } else {
          slot.status = "partially_filled_sell";
        }
      } else {
        slot.principalRecovered += closeNotional;
        capitalRecovered += closeNotional;
        slot.status = slot.remainingLotQuantity <= EPS ? "completed" : "partially_filled_sell";
      }

      lot.openQty -= matched;
      lot.accountingBasis = Math.max(0, lot.accountingBasis - matchedOpenBasis);
      remainingCloseQty -= matched;
    }
  }

  // Build buy lots for UI (progress tracking, Free Share Targets)
  const buyLots: GridBuyLot[] = openLots
    .filter((l) => l.side === "BUY")
    .map((lot) => {
      const consumed = lot.totalQuantity - lot.openQty;
      const status: GridBuyLot["status"] =
        lot.openQty <= EPS ? "completed" : consumed <= EPS ? "open" : "partial";
      return {
        lotId: lot.fragmentId,
        buyPrice: lot.openPrice,
        totalQuantity: lot.totalQuantity,
        remainingQuantity: lot.openQty,
        consumedQuantity: consumed,
        status,
        progressPercent: safeDiv(consumed, lot.totalQuantity) * 100,
        sourceFillId: lot.sourceFillId,
        sourceTime: lot.openTime,
        slotId: lot.slotId,
      };
    });

  // Recompute per-slot source averages from remaining lot fragments.
  slots.forEach((slot) => {
    const fragments = openLots.filter((f) => f.slotId === slot.slotId && f.openQty > EPS);
    if (fragments.length > 0) {
      const remQty = fragments.reduce((sum, f) => sum + f.openQty, 0);
      const remBasis = fragments.reduce((sum, f) => sum + f.accountingBasis, 0);
      slot.sourceBuyAveragePrice = safeDiv(remBasis, remQty);
      slot.sourceBuyFillCount = fragments.length;
      slot.remainingLotQuantity = remQty;
      slot.remainingLotAccountingBasis = remBasis;

      const sellPx = slot.plannedSellPrice ?? slot.targetSellPrice ?? 0;
      if (sellPx > 0) {
        slot.plannedSellQuantity =
          settings.shareSaleMode === "sell_full_quantity"
            ? remQty
            : Math.min(remQty, safeDiv(Math.max(0, capitalPerLevel - slot.principalRecovered), sellPx));
      }
    } else {
      slot.sourceBuyAveragePrice = slot.sourceBuyAveragePrice ?? slot.filledBuyPrice ?? null;
      slot.sourceBuyFillCount = slot.sourceBuyFillCount ?? 0;
    }
  });

  const capitalCommittedToOpenBuys = slots.reduce(
    (sum, s) => sum + s.remainingLotAccountingBasis,
    0,
  );
  const capitalReservedForOpenBuyOrders = 0;
  const availableCapitalForNewSlots = Math.max(
    0,
    settings.capitalAllocated -
      capitalCommittedToOpenBuys -
      capitalReservedForOpenBuyOrders,
  );
  const affordableOpenSlotCount = Math.max(
    0,
    Math.floor(safeDiv(availableCapitalForNewSlots, capitalPerLevel)),
  );

  // Auto-create affordable waiting-buy slots at bottom of ladder.
  let blockedByCapitalSlotCount = 0;
  const waitingBuyPrices = slots
    .filter((s) => s.status === "waiting_buy")
    .map((s) => s.plannedBuyPrice);
  const cycleBuyPrices = fills
    .filter((f) => f.side === "BUY")
    .map((f) => f.price);
  const cycleAllPrices = fills.map((f) => f.price);
  const cycleContextFloor =
    cycleBuyPrices.length > 0
      ? Math.min(...cycleBuyPrices)
      : cycleAllPrices.length > 0
      ? Math.min(...cycleAllPrices)
      : settings.marketPrice && settings.marketPrice > 0
      ? settings.marketPrice
      : settings.anchorPrice;
  let lowestPrice =
    waitingBuyPrices.length > 0
      ? Math.min(...waitingBuyPrices)
      : cycleContextFloor;

  if (settings.autoCreateNewBottomBuys && affordableOpenSlotCount > 0) {
    for (let i = 0; i < affordableOpenSlotCount; i += 1) {
      const newBuyPrice = roundPrice(lowestPrice * (1 - buyStep), settings.priceTickSize);
      const qty = roundQty(
        safeDiv(capitalPerLevel, newBuyPrice),
        settings.quantityPrecision,
        settings.roundShareQuantityDown,
      );
      const notional = newBuyPrice * qty;
      const slot: GridFutureSlot = {
        slotId: `future-buy-${i + 1}`,
        ladderSequence: ladderSequence + i,
        plannedBuyPrice: newBuyPrice,
        plannedBuyQuantity: qty,
        plannedBuyNotional: notional,
        buyOrderId: null,
        buyPlacedTime: null,
        buyFilledTime: null,
        filledBuyPrice: null,
        filledBuyQuantity: null,
        filledBuyNotional: null,
        buyFees: 0,
        sellMode: settings.shareSaleMode,
        plannedSellPrice: roundPrice(newBuyPrice * (1 + sellStep), settings.priceTickSize),
        plannedSellQuantity: null,
        sellOrderId: null,
        sellPlacedTime: null,
        sellFilledTime: null,
        filledSellPrice: null,
        filledSellQuantity: null,
        filledSellNotional: null,
        sellFees: 0,
        principalRecovered: 0,
        freeShareQuantityCreated: 0,
        remainingLotQuantity: 0,
        remainingLotAccountingBasis: 0,
        linkedFreeShareLotIds: [],
        status: "waiting_buy",
        targetBuyPrice: null,
        targetSellPrice: roundPrice(newBuyPrice * (1 + sellStep), settings.priceTickSize),
      };
      slots.push(slot);
      lowestPrice = newBuyPrice;
    }
  } else {
    blockedByCapitalSlotCount = Math.max(0, settings.gridLevels - slots.length);
  }

  const activeGridQuantity = slots.reduce((sum, s) => sum + s.remainingLotQuantity, 0);
  const activeGridCostBasis = slots.reduce((sum, s) => sum + s.remainingLotAccountingBasis, 0);
  const freeSharesTotalQuantity = freeShareLots.reduce((sum, l) => sum + l.quantity, 0);
  const freeSharesAccountingBasis = freeShareLots.reduce((sum, l) => sum + l.accountingBasis, 0);
  const freeSharesStrategyBasis = freeShareLots.reduce((sum, l) => sum + l.strategyBasis, 0);
  const totalQuantityHeld = activeGridQuantity + freeSharesTotalQuantity;
  const totalAccountingCostBasis = activeGridCostBasis + freeSharesAccountingBasis;
  const activeGridAverageCost = safeDiv(activeGridCostBasis, activeGridQuantity);
  const blendedAccountingAverageCost = safeDiv(
    totalAccountingCostBasis,
    totalQuantityHeld,
  );
  const blendedStrategyAverageCost = safeDiv(
    activeGridCostBasis + freeSharesStrategyBasis,
    totalQuantityHeld,
  );
  const marketPrice =
    settings.marketPrice ??
    fills[fills.length - 1]?.price ??
    settings.anchorPrice;
  const unrealizedPLAccounting =
    marketPrice * totalQuantityHeld - totalAccountingCostBasis;
  const unrealizedPLStrategy =
    marketPrice * totalQuantityHeld - (activeGridCostBasis + freeSharesStrategyBasis);

  const referenceCost = getReferencePriceForFreeShareTargets(
    settings,
    activeGridAverageCost,
    blendedAccountingAverageCost,
    blendedStrategyAverageCost,
  );
  const freeShareTargets = buildFreeShareTargets(
    settings,
    freeSharesTotalQuantity,
    referenceCost,
  );

  const bottomGridPrice =
    settings.anchorPrice * Math.pow(1 - buyStep, Math.max(1, settings.gridLevels));

  return {
    slots,
    buyLots,
    openFragments: openLots.map<GridFutureLotFragment>((lot) => ({
      fragmentId: lot.fragmentId,
      slotId: lot.slotId,
      side: lot.side,
      sourceFillId: lot.sourceFillId,
      sourcePrice: lot.openPrice,
      sourceTime: lot.openTime,
      quantityRemaining: lot.openQty,
      accountingBasisRemaining: lot.accountingBasis,
    })),
    matchEvents,
    freeShareLots,
    summary: {
      capital: {
        capitalAllocated: settings.capitalAllocated,
        capitalPerLevel,
        capitalCommittedToOpenBuys,
        capitalReservedForOpenBuyOrders,
        capitalRecovered,
        availableCapitalForNewSlots,
        affordableOpenSlotCount,
      },
      grid: {
        bottomGridPrice,
        waitingBuyCount: slots.filter((s) => s.status === "waiting_buy").length,
        waitingSellCount: slots.filter((s) => s.status === "waiting_sell" || s.status === "partially_filled_sell").length,
        blockedByCapitalSlotCount,
      },
      position: {
        activeGridQuantity,
        freeSharesTotalQuantity,
        totalQuantityHeld,
        activeGridCostBasis,
        freeSharesAccountingBasis,
        freeSharesStrategyBasis,
        totalAccountingCostBasis,
        activeGridAverageCost,
        blendedAccountingAverageCost,
        unrealizedPLAccounting,
        unrealizedPLStrategy,
        realizedPL,
      },
      freeShareTargets,
    },
  };
}

