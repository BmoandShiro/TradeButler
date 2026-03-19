import {
  GridCycle,
  GridExposureSummary,
  GridFill,
  GridLevel,
  GridLevelAggregate,
  GridPnLSummary,
  GridSide,
} from "./gridTypes";
import { format } from "date-fns";

const PRICE_PRECISION = 2;

function roundPrice(p: number): number {
  const factor = Math.pow(10, PRICE_PRECISION);
  return Math.round(p * factor) / factor;
}

function normalizeLevelsFromFills(fills: GridFill[]): GridLevel[] {
  const priceSet = new Map<number, GridLevel>();
  fills.forEach((fill) => {
    if (fill.status === "CANCELLED") return;
    const priceKey = roundPrice(fill.price);
    if (!priceSet.has(priceKey)) {
      priceSet.set(priceKey, {
        id: priceKey.toString(),
        index: 0,
        price: priceKey,
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
      // Signed: + long open inventory, - short open inventory.
      netOpenQty: 0,
      realizedPnlAtLevel: 0,
      avgOpenEntry: undefined,
      rowStatus: "no-activity",
      exposureScore: 0,
      hasOpenOrders: false,
    });
  });

  const levelByPrice = new Map<number, GridLevel>();
  levels.forEach((l) => levelByPrice.set(l.price, l));

  const EPS = 1e-9;

  // Mark open orders (doesn't affect fill pairing).
  fills.forEach((fill) => {
    if (fill.kind === "ORDER" && fill.status === "OPEN") {
      const level = levelByPrice.get(roundPrice(fill.price));
      if (!level) return;
      const agg = byId.get(level.id);
      if (!agg) return;
      agg.hasOpenOrders = true;
    }
  });

  type Lot = { fill: GridFill; remainingQty: number };
  const longBuys: Lot[] = [];
  const shortSells: Lot[] = [];
  let netPositionQty = 0; // signed: + long, - short

  // Cost basis of remaining open lots per level (always positive; we use abs(netOpenQty) for averages).
  const openCostByLevelId = new Map<string, number>();

  const activeFillsSorted = [...fills]
    .filter((f) => f.kind !== "ORDER" && f.status !== "CANCELLED")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  activeFillsSorted.forEach((fill) => {
    const level = levelByPrice.get(roundPrice(fill.price));
    const agg = level ? byId.get(level.id) : undefined;

    if (fill.side === "BUY") {
      if (agg) {
        agg.buyCount += 1;
        agg.totalBuyQty += fill.quantity;
      }

      if (netPositionQty >= -EPS) {
        // Flat or long => opening long inventory.
        longBuys.push({ fill, remainingQty: fill.quantity });
        netPositionQty += fill.quantity;
      } else {
        // Currently short => buy closes short. Dynamic: eligible = sellPrice >= buyPrice, sort ascending.
        const eligible = shortSells
          .filter((l) => l.remainingQty > EPS && l.fill.price >= fill.price)
          .sort((a, b) => a.fill.price - b.fill.price);

        let remainingToClose = fill.quantity;
        for (const lot of eligible) {
          if (remainingToClose <= EPS) break;
          const matchedQty = Math.min(lot.remainingQty, remainingToClose);

          const entryLevel = levelByPrice.get(roundPrice(lot.fill.price));
          const entryAgg = entryLevel ? byId.get(entryLevel.id) : undefined;
          if (entryAgg) {
            entryAgg.realizedPnlAtLevel +=
              (lot.fill.price - fill.price) * matchedQty;
          }

          lot.remainingQty -= matchedQty;
          remainingToClose -= matchedQty;
          netPositionQty += matchedQty;
        }
        for (let i = shortSells.length - 1; i >= 0; i--) {
          if (shortSells[i].remainingQty <= EPS) shortSells.splice(i, 1);
        }

        if (remainingToClose > EPS) {
          longBuys.push({ fill, remainingQty: remainingToClose });
          netPositionQty += remainingToClose;
        }
      }
      return;
    }

    // SELL
    if (agg) {
      agg.sellCount += 1;
      agg.totalSellQty += fill.quantity;
    }

    if (netPositionQty <= EPS) {
      // Flat or short => opening short inventory.
      shortSells.push({ fill, remainingQty: fill.quantity });
      netPositionQty -= fill.quantity;
    } else {
      // Currently long => sell closes long. Dynamic: eligible = buyPrice <= sellPrice, sort descending.
      const eligible = longBuys
        .filter((l) => l.remainingQty > EPS && l.fill.price <= fill.price)
        .sort((a, b) => b.fill.price - a.fill.price);

      let remainingToClose = fill.quantity;
      for (const lot of eligible) {
        if (remainingToClose <= EPS) break;
        const matchedQty = Math.min(lot.remainingQty, remainingToClose);

        const entryLevel = levelByPrice.get(roundPrice(lot.fill.price));
        const entryAgg = entryLevel ? byId.get(entryLevel.id) : undefined;
        if (entryAgg) {
          entryAgg.realizedPnlAtLevel +=
            (fill.price - lot.fill.price) * matchedQty;
        }

        lot.remainingQty -= matchedQty;
        remainingToClose -= matchedQty;
        netPositionQty -= matchedQty;
      }
      for (let i = longBuys.length - 1; i >= 0; i--) {
        if (longBuys[i].remainingQty <= EPS) longBuys.splice(i, 1);
      }

      if (remainingToClose > EPS) {
        shortSells.push({ fill, remainingQty: remainingToClose });
        netPositionQty -= remainingToClose;
      }
    }
  });

  // Remaining open inventory after pairing.
  longBuys.forEach((openBuy) => {
    const entryLevel = levelByPrice.get(roundPrice(openBuy.fill.price));
    if (!entryLevel) return;
    const agg = byId.get(entryLevel.id);
    if (!agg) return;

    agg.netOpenQty += openBuy.remainingQty;

    const prevCost = openCostByLevelId.get(entryLevel.id) ?? 0;
    openCostByLevelId.set(
      entryLevel.id,
      prevCost + entryLevel.price * openBuy.remainingQty,
    );
  });

  shortSells.forEach((openSell) => {
    const entryLevel = levelByPrice.get(roundPrice(openSell.fill.price));
    if (!entryLevel) return;
    const agg = byId.get(entryLevel.id);
    if (!agg) return;

    agg.netOpenQty -= openSell.remainingQty;

    const prevCost = openCostByLevelId.get(entryLevel.id) ?? 0;
    openCostByLevelId.set(
      entryLevel.id,
      prevCost + entryLevel.price * openSell.remainingQty,
    );
  });

  // Average open cost per level (weighted by remaining open quantity).
  byId.forEach((agg) => {
    const absOpenQty = Math.abs(agg.netOpenQty);
    if (absOpenQty > EPS) {
      const cost =
        openCostByLevelId.get(agg.level.id) ??
        agg.level.price * absOpenQty;
      agg.avgOpenEntry = cost / absOpenQty;
    } else {
      agg.avgOpenEntry = undefined;
    }
  });

  // Row status:
  // - If open qty is 0 => Closed position
  // - If open qty is non-zero => Open position vs Partially closed
  byId.forEach((agg) => {
    const hasActivity = agg.totalBuyQty > EPS || agg.totalSellQty > EPS;
    if (!hasActivity) {
      agg.rowStatus = "no-activity";
      return;
    }

    const absOpenQty = Math.abs(agg.netOpenQty);
    if (absOpenQty <= EPS) {
      agg.rowStatus = "completed";
      return;
    }

    // For long open inventory, remaining open is based on BUY lots; for short open inventory, based on SELL lots.
    const openingQtyAtLevel =
      agg.netOpenQty > 0 ? agg.totalBuyQty : agg.totalSellQty;
    agg.rowStatus =
      absOpenQty < openingQtyAtLevel - EPS ? "partially-closed" : "open-long";
  });

  const aggregates = Array.from(byId.values());
  const maxAbs = Math.max(...aggregates.map((a) => Math.abs(a.netOpenQty)), 0);
  aggregates.forEach((agg) => {
    agg.exposureScore = maxAbs > 0 ? Math.abs(agg.netOpenQty) / maxAbs : 0;
  });

  return aggregates;
}

function computeRealizedPnlFromCycleFills(fills: GridFill[]): number {
  if (!fills.length) return 0;

  // Decide direction by the first non-order fill.
  const first = fills.find((f) => f.kind !== "ORDER");
  if (!first) return 0;

  const isLong = first.side === "BUY";
  // Larger tolerance helps with fractional quantities drifting off of zero.
  const EPS = 1e-6;

  if (isLong) {
    // Dynamic matching: eligible lots = remainingQty > 0, buyPrice <= sellPrice
    // Sort by buyPrice descending (closest buy below sell price first)
    const buyLots: { price: number; remainingQty: number }[] = [];
    let pnl = 0;

    for (const fill of fills) {
      if (fill.side === "BUY") {
        buyLots.push({ price: fill.price, remainingQty: fill.quantity });
      } else {
        const eligible = buyLots
          .filter((l) => l.remainingQty > EPS && l.price <= fill.price)
          .sort((a, b) => b.price - a.price);

        let remainingToClose = fill.quantity;
        for (const lot of eligible) {
          if (remainingToClose <= EPS) break;
          const matchedQty = Math.min(lot.remainingQty, remainingToClose);
          pnl += (fill.price - lot.price) * matchedQty;
          lot.remainingQty -= matchedQty;
          remainingToClose -= matchedQty;
        }
      }
    }

    return pnl;
  }

  // Short: Dynamic matching - eligible SELL lots = remainingQty > 0, sellPrice >= buyPrice
  // Sort by sellPrice ascending (closest sell above buy price first)
  const sellLots: { price: number; remainingQty: number }[] = [];
  let pnl = 0;

  for (const fill of fills) {
    if (fill.side === "SELL") {
      sellLots.push({ price: fill.price, remainingQty: fill.quantity });
    } else {
      const eligible = sellLots
        .filter((l) => l.remainingQty > EPS && l.price >= fill.price)
        .sort((a, b) => a.price - b.price);

      let remainingToClose = fill.quantity;
      for (const lot of eligible) {
        if (remainingToClose <= EPS) break;
        const matchedQty = Math.min(lot.remainingQty, remainingToClose);
        pnl += (lot.price - fill.price) * matchedQty;
        lot.remainingQty -= matchedQty;
        remainingToClose -= matchedQty;
      }
    }
  }

  return pnl;
}

export function computeGridPositionCycles(symbol: string, fills: GridFill[]): GridCycle[] {
  const activeFillsSorted = [...fills]
    .filter((f) => f.kind !== "ORDER" && f.status !== "CANCELLED")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (!activeFillsSorted.length) return [];

  type WorkingCycle = {
    entrySide: GridSide;
    entryPrice: number;
    entryTime: string;
    fills: GridFill[];
    maxAbsQty: number;
    status: "completed" | "open";
  };

  const cycles: GridCycle[] = [];
  let signedNetQty = 0; // +long, -short
  let current: WorkingCycle | null = null;
  let cycleIndex = 0;

  const applySignedQtyDelta = (side: GridSide, qty: number) => {
    return side === "BUY" ? qty : -qty;
  };

  const startWorkingCycle = (fill: GridFill) => {
    const entrySide = fill.side;
    current = {
      entrySide,
      entryPrice: fill.price,
      entryTime: fill.timestamp,
      fills: [],
      maxAbsQty: 0,
      status: "open",
    };
    // signedNetQty is assumed to be 0 at the moment we start.
    signedNetQty = 0;
  };

  const closeWorkingCycle = (closeFillPart: GridFill) => {
    if (!current) return;
    const closeTime = closeFillPart.timestamp;
    const exitPrice = closeFillPart.price;
    const status: "completed" = "completed";

    const durationMs =
      new Date(closeTime).getTime() - new Date(current.entryTime).getTime();

    const cycleName = `${format(new Date(current.entryTime), "MMM d, yyyy")} - ${format(
      new Date(closeTime),
      "MMM d, yyyy",
    )}`;

    const grossPnl = computeRealizedPnlFromCycleFills(current.fills);

    const id = `${symbol}-${cycleIndex}-${current.entryTime}-${closeTime}`;
    cycles.push({
      id,
      symbol,
      entrySide: current.entrySide,
      entryPrice: current.entryPrice,
      exitPrice,
      quantity: current.maxAbsQty,
      grossPnl,
      openTime: current.entryTime,
      closeTime,
      durationMs,
      status,
      cycleName,
      fills: current.fills,
    });

    cycleIndex += 1;
    current = null;
    signedNetQty = 0;
  };

  const finishOpenWorkingCycle = () => {
    if (!current) return;
    const grossPnl = computeRealizedPnlFromCycleFills(current.fills);
    const lastFill = current.fills[current.fills.length - 1];

    const cycleName = `${format(new Date(current.entryTime), "MMM d, yyyy")} - open`;

    const id = `${symbol}-${cycleIndex}-${current.entryTime}-open`;
    cycles.push({
      id,
      symbol,
      entrySide: current.entrySide,
      entryPrice: current.entryPrice,
      exitPrice: null,
      quantity: current.maxAbsQty,
      grossPnl,
      openTime: current.entryTime,
      closeTime: null,
      durationMs: lastFill ? null : null,
      status: "open",
      cycleName,
      fills: current.fills,
    });
  };

  for (const fill of activeFillsSorted) {
    let remaining = fill.quantity;
    let partNo = 0;

    while (remaining > 0) {
      if (!current) {
        startWorkingCycle(fill);
      }

      // If this fill moves the position toward flat, it may close the cycle.
      const isClosing =
        (signedNetQty > 0 && fill.side === "SELL") ||
        (signedNetQty < 0 && fill.side === "BUY");

      if (!isClosing) {
        const qtyPart = remaining;
        const fillPart: GridFill = {
          ...fill,
          id: `${fill.id}#${partNo}`,
          quantity: qtyPart,
        };
        current!.fills.push(fillPart);
        signedNetQty += applySignedQtyDelta(fill.side, qtyPart);
        current!.maxAbsQty = Math.max(current!.maxAbsQty, Math.abs(signedNetQty));
        remaining = 0;
        partNo += 1;
        continue;
      }

      const absNet = Math.abs(signedNetQty);
      const qtyPart = Math.min(remaining, absNet);
      const fillPart: GridFill = {
        ...fill,
        id: `${fill.id}#${partNo}`,
        quantity: qtyPart,
      };

      current!.fills.push(fillPart);
      signedNetQty += applySignedQtyDelta(fill.side, qtyPart);
      current!.maxAbsQty = Math.max(current!.maxAbsQty, Math.abs(signedNetQty));
      remaining -= qtyPart;
      partNo += 1;

      if (signedNetQty === 0) {
        closeWorkingCycle(fillPart);
      }
    }
  }

  // If there's still an open cycle at the end, add it.
  if (current) {
    finishOpenWorkingCycle();
  }

  return cycles;
}

export function computeExposure(
  symbol: string,
  aggregates: GridLevelAggregate[],
  currentPrice: number | null,
): GridExposureSummary {
  const EPS = 1e-9;
  const openLevels = aggregates.filter((a) => Math.abs(a.netOpenQty) > EPS);
  const totalOpenQty = openLevels.reduce((sum, a) => sum + Math.abs(a.netOpenQty), 0);

  let weightedAvgOpenEntry: number | undefined;
  if (totalOpenQty > 0) {
    const totalCost = openLevels.reduce(
      (sum, a) => sum + a.level.price * Math.abs(a.netOpenQty),
      0,
    );
    weightedAvgOpenEntry = totalCost / totalOpenQty;
  }

  let unrealizedPnl = 0;
  if (currentPrice != null) {
    unrealizedPnl = openLevels.reduce(
      // netOpenQty is signed (+long, -short). This gives the correct pnl direction.
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
  const completedCyclesCount = cycles.filter((c) => c.status === "completed").length;
  const openCyclesCount = cycles.filter((c) => c.status === "open").length;

  const winningCycles = cycles.filter(
    (c) => c.status === "completed" && c.grossPnl > 0,
  );
  const totalFees = 0;
  const avgPnlPerCompletedCycle =
    completedCyclesCount > 0
      ? // realizedPnl includes realized pnl from open cycles too, but that's typically small;
        // for now, keep it simple and spread over completed cycles count.
        realizedPnl / completedCyclesCount
      : undefined;

  const completedCycles = cycles.filter((c) => c.status === "completed" && c.durationMs != null);
  const totalDuration = completedCycles.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
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
    openCyclesCount,
    avgPnlPerCompletedCycle,
    avgHoldTimeMs,
    winRate,
    capitalInOpenInventory,
  };
}

