import {
  GridCycle,
  GridFill,
  GridFutureFreeShareTarget,
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
      partial.marketPrice ?? context?.marketPrice ?? DEFAULT_GRID_FUTURE_SETTINGS.marketPrice,
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
  slotId: string;
  side: GridSide;
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

  let realizedPL = 0;
  let capitalRecovered = 0;
  let ladderSequence = 1;

  const createSlotFromOpenFill = (fill: GridFill): GridFutureSlot => {
    const slotId = `slot-${fill.id}-${ladderSequence}`;
    const targetSellPrice = roundPrice(fill.price * (1 + sellStep), settings.priceTickSize);
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
    };
    ladderSequence += 1;
    slots.push(slot);

    openLots.push({
      slotId,
      side: fill.side,
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

    let remainingCloseQty = fill.quantity;
    while (remainingCloseQty > EPS && openLots.length > 0) {
      const earliest = openLots[0];
      const matched = Math.min(remainingCloseQty, earliest.openQty);
      const slot = slots.find((s) => s.slotId === earliest.slotId);
      if (!slot) break;

      const matchedOpenBasis = safeDiv(earliest.accountingBasis * matched, earliest.openQty);
      const closeNotional = fill.price * matched;
      const closeFee = feeForNotional(closeNotional, settings);
      const pnlSigned =
        earliest.side === "BUY"
          ? (fill.price - earliest.openPrice) * matched
          : (earliest.openPrice - fill.price) * matched;
      realizedPL += pnlSigned - closeFee;

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

      earliest.openQty -= matched;
      earliest.accountingBasis = Math.max(0, earliest.accountingBasis - matchedOpenBasis);
      remainingCloseQty -= matched;
      if (earliest.openQty <= EPS) {
        openLots.shift();
      }
    }
  }

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

