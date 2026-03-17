import {
  GridCycle,
  GridExposureSummary,
  GridFill,
  GridLevel,
  GridLevelAggregate,
  GridPnLSummary,
} from "./gridTypes";

function normalizeLevelsFromFills(fills: GridFill[]): GridLevel[] {
  const priceSet = new Map<number, GridLevel>();
  fills.forEach((fill) => {
    if (!priceSet.has(fill.price)) {
      priceSet.set(fill.price, {
        id: fill.price.toString(),
        index: 0,
        price: fill.price,
      });
    }
  });
  const levels = Array.from(priceSet.values()).sort((a, b) => b.price - a.price);
  return levels.map((level, index) => ({ ...level, index }));
}

export function deriveGridLevels(explicitLevels: GridLevel[] | undefined, fills: GridFill[]): GridLevel[] {
  if (explicitLevels && explicitLevels.length > 0) {
    const sorted = [...explicitLevels].sort((a, b) => b.price - a.price);
    return sorted.map((l, index) => ({ ...l, index }));
  }
  return normalizeLevelsFromFills(fills);
}

export function aggregateFillsByLevel(levels: GridLevel[], fills: GridFill[]): GridLevelAggregate[] {
  const byId = new Map<string, GridLevelAggregate>();

  levels.forEach((level) => {
    byId.set(level.id, {
      level,
      buyCount: 0,
      sellCount: 0,
      totalBuyQty: 0,
      totalSellQty: 0,
      netOpenQty: 0,
      realizedPnlAtLevel: 0,
      rowStatus: "no-activity",
      exposureScore: 0,
      hasOpenOrders: false,
    });
  });

  const levelByPrice = new Map<number, GridLevel>();
  levels.forEach((l) => levelByPrice.set(l.price, l));

  fills.forEach((fill) => {
    const level = levelByPrice.get(fill.price);
    if (!level) return;
    const agg = byId.get(level.id);
    if (!agg) return;

    if (fill.kind === "ORDER" && fill.status === "OPEN") {
      agg.hasOpenOrders = true;
    }

    if (fill.kind === "ORDER") {
      return;
    }

    if (fill.side === "BUY") {
      agg.buyCount += 1;
      agg.totalBuyQty += fill.quantity;
      agg.netOpenQty += fill.quantity;
    } else {
      agg.sellCount += 1;
      agg.totalSellQty += fill.quantity;
      agg.netOpenQty -= fill.quantity;
    }
  });

  byId.forEach((agg) => {
    if (agg.netOpenQty > 0 && agg.totalSellQty === 0) {
      agg.rowStatus = "open-long";
    } else if (agg.netOpenQty > 0 && agg.totalSellQty > 0) {
      agg.rowStatus = "partially-closed";
    } else if (agg.totalBuyQty > 0 && agg.netOpenQty === 0) {
      agg.rowStatus = "completed";
    } else {
      agg.rowStatus = "no-activity";
    }
  });

  const aggregates = Array.from(byId.values());
  const maxAbs = Math.max(...aggregates.map((a) => Math.abs(a.netOpenQty)), 0);
  if (maxAbs > 0) {
    aggregates.forEach((agg) => {
      agg.exposureScore = Math.abs(agg.netOpenQty) / maxAbs;
    });
  }

  return aggregates;
}

export function pairGridCycles(symbol: string, fills: GridFill[]): GridCycle[] {
  const fillsSorted = [...fills]
    .filter((f) => f.kind !== "ORDER")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const openBuys: { fill: GridFill; remainingQty: number }[] = [];
  const cycles: GridCycle[] = [];

  fillsSorted.forEach((fill) => {
    if (fill.side === "BUY") {
      openBuys.push({ fill, remainingQty: fill.quantity });
      return;
    }

    let remainingToClose = fill.quantity;
    while (remainingToClose > 0 && openBuys.length > 0) {
      const earliest = openBuys[0];
      const matchedQty = Math.min(earliest.remainingQty, remainingToClose);
      const grossPnl = (fill.price - earliest.fill.price) * matchedQty;
      const id = `${earliest.fill.id}-${fill.id}-${matchedQty}-${cycles.length}`;
      const openTime = earliest.fill.timestamp;
      const closeTime = fill.timestamp;
      const durationMs =
        new Date(closeTime).getTime() - new Date(openTime).getTime();

      cycles.push({
        id,
        symbol,
        entrySide: "BUY",
        entryPrice: earliest.fill.price,
        exitPrice: fill.price,
        quantity: matchedQty,
        grossPnl,
        openTime,
        closeTime,
        durationMs,
      });

      earliest.remainingQty -= matchedQty;
      remainingToClose -= matchedQty;

      if (earliest.remainingQty <= 0.0000001) {
        openBuys.shift();
      }
    }
  });

  return cycles;
}

export function computeExposure(
  symbol: string,
  aggregates: GridLevelAggregate[],
  currentPrice: number | null,
): GridExposureSummary {
  const openLevels = aggregates.filter((a) => a.netOpenQty > 0);
  const totalOpenQty = openLevels.reduce((sum, a) => sum + a.netOpenQty, 0);

  let weightedAvgOpenEntry: number | undefined;
  if (totalOpenQty > 0) {
    const totalCost = openLevels.reduce(
      (sum, a) => sum + a.level.price * a.netOpenQty,
      0,
    );
    weightedAvgOpenEntry = totalCost / totalOpenQty;
  }

  let unrealizedPnl = 0;
  if (currentPrice != null) {
    unrealizedPnl = openLevels.reduce(
      (sum, a) => sum + (currentPrice - a.level.price) * a.netOpenQty,
      0,
    );
  }

  const deepestOpenLevel = openLevels
    .slice()
    .sort((a, b) => a.level.price - b.level.price)[0]?.level;
  const highestOpenLevel = openLevels
    .slice()
    .sort((a, b) => b.level.price - a.level.price)[0]?.level;

  return {
    symbol,
    totalOpenQty,
    weightedAvgOpenEntry,
    unrealizedPnl,
    deepestOpenLevel,
    highestOpenLevel,
  };
}

export function computePnLSummary(
  symbol: string,
  cycles: GridCycle[],
  exposure: GridExposureSummary,
): GridPnLSummary {
  const realizedPnl = cycles.reduce((sum, c) => sum + c.grossPnl, 0);
  const completedCyclesCount = cycles.length;

  const winningCycles = cycles.filter((c) => c.grossPnl > 0);
  const totalFees = 0;
  const avgPnlPerCompletedCycle =
    completedCyclesCount > 0 ? realizedPnl / completedCyclesCount : undefined;

  const totalDuration = cycles.reduce((sum, c) => sum + c.durationMs, 0);
  const avgHoldTimeMs =
    completedCyclesCount > 0 ? totalDuration / completedCyclesCount : undefined;

  const winRate =
    completedCyclesCount > 0
      ? (winningCycles.length / completedCyclesCount) * 100
      : undefined;

  const capitalInOpenInventory =
    exposure.totalOpenQty > 0 && exposure.weightedAvgOpenEntry
      ? exposure.totalOpenQty * exposure.weightedAvgOpenEntry
      : 0;

  const unrealizedPnl = exposure.unrealizedPnl;
  const totalPnl = realizedPnl + unrealizedPnl;

  return {
    symbol,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    totalFees,
    completedCyclesCount,
    openCyclesCount: 0,
    avgPnlPerCompletedCycle,
    avgHoldTimeMs,
    winRate,
    capitalInOpenInventory,
  };
}

