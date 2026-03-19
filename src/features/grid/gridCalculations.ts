import {
  GridCycle,
  GridExposureSummary,
  GridFill,
  GridLevel,
  GridLevelAggregate,
  GridPnLSummary,
} from "./gridTypes";
import { format } from "date-fns";

function normalizeLevelsFromFills(fills: GridFill[]): GridLevel[] {
  const priceSet = new Map<number, GridLevel>();
  fills.forEach((fill) => {
    if (fill.status === "CANCELLED") return;
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
      const level = levelByPrice.get(fill.price);
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
    const level = levelByPrice.get(fill.price);
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
        // Currently short => buy closes short FIFO.
        let remainingToClose = fill.quantity;
        while (remainingToClose > EPS && shortSells.length > 0) {
          const earliest = shortSells[0];
          const matchedQty = Math.min(earliest.remainingQty, remainingToClose);

          const entryLevel = levelByPrice.get(earliest.fill.price);
          const entryAgg = entryLevel ? byId.get(entryLevel.id) : undefined;
          if (entryAgg) {
            // Short entry is a SELL at earliest.fill.price; BUY exits at fill.price.
            entryAgg.realizedPnlAtLevel +=
              (earliest.fill.price - fill.price) * matchedQty;
          }

          earliest.remainingQty -= matchedQty;
          remainingToClose -= matchedQty;
          netPositionQty += matchedQty; // reducing short magnitude

          if (earliest.remainingQty <= EPS) shortSells.shift();
        }

        // If we bought more than the open short, we flip to a new long cycle.
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
      // Currently long => sell closes long FIFO.
      let remainingToClose = fill.quantity;
      while (remainingToClose > EPS && longBuys.length > 0) {
        const earliest = longBuys[0];
        const matchedQty = Math.min(earliest.remainingQty, remainingToClose);

        const entryLevel = levelByPrice.get(earliest.fill.price);
        const entryAgg = entryLevel ? byId.get(entryLevel.id) : undefined;
        if (entryAgg) {
          entryAgg.realizedPnlAtLevel +=
            (fill.price - earliest.fill.price) * matchedQty;
        }

        earliest.remainingQty -= matchedQty;
        remainingToClose -= matchedQty;
        netPositionQty -= matchedQty; // reducing long magnitude

        if (earliest.remainingQty <= EPS) longBuys.shift();
      }

      // If we sold more than the open long, we flip to a new short cycle.
      if (remainingToClose > EPS) {
        shortSells.push({ fill, remainingQty: remainingToClose });
        netPositionQty -= remainingToClose;
      }
    }
  });

  // Remaining open inventory after pairing.
  longBuys.forEach((openBuy) => {
    const entryLevel = levelByPrice.get(openBuy.fill.price);
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
    const entryLevel = levelByPrice.get(openSell.fill.price);
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

export function pairGridCycles(symbol: string, fills: GridFill[]): GridCycle[] {
  const fillsSorted = [...fills]
    .filter((f) => f.kind !== "ORDER" && f.status !== "CANCELLED")
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
        // For this legacy pairing mode, treat each matched lot as its own cycle.
        quantity: matchedQty,
        grossPnl,
        openTime,
        closeTime,
        durationMs,
        status: "completed",
        cycleName: `${format(new Date(openTime), "MMM d, yyyy")} - ${format(
          new Date(closeTime),
          "MMM d, yyyy",
        )}`,
        fills: [
          {
            ...earliest.fill,
            id: `${earliest.fill.id}#buy-${cycles.length}`,
            quantity: matchedQty,
          },
          {
            ...fill,
            id: `${fill.id}#sell-${cycles.length}`,
            quantity: matchedQty,
          },
        ],
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

function computeRealizedPnlFromCycleFills(fills: GridFill[]): number {
  if (!fills.length) return 0;

  // Decide direction by the first non-order fill.
  const first = fills.find((f) => f.kind !== "ORDER");
  if (!first) return 0;

  const isLong = first.side === "BUY";
  const EPS = 1e-9;

  if (isLong) {
    // FIFO match BUY lots against SELL fills.
    const buyLots: { price: number; remainingQty: number }[] = [];
    let pnl = 0;

    for (const fill of fills) {
      if (fill.side === "BUY") {
        buyLots.push({ price: fill.price, remainingQty: fill.quantity });
      } else {
        // SELL closes long inventory
        let remainingToClose = fill.quantity;
        while (remainingToClose > EPS && buyLots.length > 0) {
          const earliest = buyLots[0];
          const matchedQty = Math.min(earliest.remainingQty, remainingToClose);
          pnl += (fill.price - earliest.price) * matchedQty;
          earliest.remainingQty -= matchedQty;
          remainingToClose -= matchedQty;
          if (earliest.remainingQty <= EPS) buyLots.shift();
        }
      }
    }

    return pnl;
  }

  // Short: FIFO match SELL lots against BUY fills.
  const sellLots: { price: number; remainingQty: number }[] = [];
  let pnl = 0;

  for (const fill of fills) {
    if (fill.side === "SELL") {
      sellLots.push({ price: fill.price, remainingQty: fill.quantity });
    } else {
      // BUY closes short inventory
      let remainingToClose = fill.quantity;
      while (remainingToClose > EPS && sellLots.length > 0) {
        const earliest = sellLots[0];
        const matchedQty = Math.min(earliest.remainingQty, remainingToClose);
        pnl += (earliest.price - fill.price) * matchedQty;
        earliest.remainingQty -= matchedQty;
        remainingToClose -= matchedQty;
        if (earliest.remainingQty <= EPS) sellLots.shift();
      }
    }
  }

  return pnl;
}

export function computeGridPositionCycles(symbol: string, fills: GridFill[]): GridCycle[] {
  const EPS = 1e-9;

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

    while (remaining > EPS) {
      if (!current) {
        startWorkingCycle(fill);
      }

      // If this fill moves the position toward flat, it may close the cycle.
      const isClosing =
        (signedNetQty > EPS && fill.side === "SELL") ||
        (signedNetQty < -EPS && fill.side === "BUY");

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

      if (Math.abs(signedNetQty) <= EPS) {
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

