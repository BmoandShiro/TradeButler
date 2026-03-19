export type GridSide = "BUY" | "SELL";

export interface GridLevel {
  id: string;
  index: number;
  price: number;
  label?: string;
  isVirtual?: boolean;
}

export interface GridFill {
  id: string | number;
  symbol: string;
  side: GridSide;
  price: number;
  quantity: number;
  timestamp: string;
  status?: "FILLED" | "PARTIAL" | "CANCELLED" | "OPEN";
  kind?: "FILL" | "ORDER";
}

export type GridRowStatus =
  | "no-activity"
  | "open-long"
  | "partially-closed"
  | "completed"
  | "imbalanced";

export interface GridLevelAggregate {
  level: GridLevel;
  buyCount: number;
  sellCount: number;
  totalBuyQty: number;
  totalSellQty: number;
  netOpenQty: number;
  avgOpenEntry?: number;
  realizedPnlAtLevel: number;
  rowStatus: GridRowStatus;
  exposureScore: number;
  hasOpenOrders: boolean;
}

export interface GridCycle {
  id: string;
  symbol: string;
  entrySide: GridSide;
  entryPrice: number;
  exitPrice: number | null;
  // Qty represents the max absolute open inventory reached in the cycle.
  quantity: number;
  // Realized pnl earned via FIFO pairing of closes that occurred inside the cycle.
  grossPnl: number;
  openTime: string;
  closeTime: string | null;
  durationMs: number | null;
  entryLevelId?: string;
  exitLevelId?: string;

  status: "completed" | "open";
  cycleName: string;

  // All fills that belong to this cycle, including the fills that bring net qty to 0
  // (or the remaining open position if status === "open").
  fills: GridFill[];
}

export interface GridExposureSummary {
  symbol: string;
  totalOpenQty: number;
  weightedAvgOpenEntry?: number;
  unrealizedPnl: number;
  deepestOpenLevel?: GridLevel;
  highestOpenLevel?: GridLevel;
}

export interface GridPnLSummary {
  symbol: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalFees: number;
  completedCyclesCount: number;
  openCyclesCount: number;
  avgPnlPerCompletedCycle?: number;
  avgHoldTimeMs?: number;
  winRate?: number;
  capitalInOpenInventory: number;
}

export type GridFutureSellMode =
  | "sell_full_quantity"
  | "sell_original_notional";

export type GridFreeShareExitMode =
  | "disabled"
  | "sell_at_percent_above_avg_cost"
  | "scale_out_by_grid"
  | "manual_only";

export type GridFreeShareReferenceCostMode =
  | "active_grid_average_cost"
  | "blended_accounting_average_cost"
  | "blended_strategy_average_cost"
  | "manual_reference_price";

export interface GridFutureSettings {
  anchorPrice: number;
  capitalAllocated: number;
  gridLevels: number;
  buyStepPercent: number;
  sellTargetPercent: number;
  shareSaleMode: GridFutureSellMode;
  reserveCapitalForUnfilledOrders: boolean;
  freeShareExitMode: GridFreeShareExitMode;
  freeShareReferenceCostMode: GridFreeShareReferenceCostMode;
  freeShareTargetPercentAboveAverageCost: number;
  freeShareScaleOutPercent: number;
  freeShareScaleOutLevels: number;
  freeShareStartPercentAboveAvgCost: number;
  manualReferencePrice: number | null;
  priceTickSize: number;
  quantityPrecision: number;
  feePerTrade: number;
  feePercent: number;
  allowFractionalShares: boolean;
  roundShareQuantityDown: boolean;
  autoCreateNewBottomBuys: boolean;
  marketPrice: number | null;
}

export type GridFutureSlotStatus =
  | "waiting_buy"
  | "partially_filled_buy"
  | "waiting_sell"
  | "partially_filled_sell"
  | "completed"
  | "principal_recovered_holding_free_shares"
  | "cancelled";

export interface GridFutureSlot {
  slotId: string;
  ladderSequence: number;
  plannedBuyPrice: number;
  plannedBuyQuantity: number;
  plannedBuyNotional: number;
  buyOrderId: string | null;
  buyPlacedTime: string | null;
  buyFilledTime: string | null;
  filledBuyPrice: number | null;
  filledBuyQuantity: number | null;
  filledBuyNotional: number | null;
  buyFees: number;
  sellMode: GridFutureSellMode;
  plannedSellPrice: number | null;
  plannedSellQuantity: number | null;
  sellOrderId: string | null;
  sellPlacedTime: string | null;
  sellFilledTime: string | null;
  filledSellPrice: number | null;
  filledSellQuantity: number | null;
  filledSellNotional: number | null;
  sellFees: number;
  principalRecovered: number;
  freeShareQuantityCreated: number;
  remainingLotQuantity: number;
  remainingLotAccountingBasis: number;
  linkedFreeShareLotIds: string[];
  status: GridFutureSlotStatus;
  targetBuyPrice: number | null;
  targetSellPrice: number | null;
  sourceCycleFillId?: string | number;
}

export type GridFutureFreeShareLotStatus =
  | "held"
  | "partially_sold"
  | "sold";

export interface GridFutureFreeShareLot {
  freeShareLotId: string;
  sourceSlotId: string;
  sourceBuyPrice: number;
  sourceBuyTime: string;
  sourceSellTime: string | null;
  quantity: number;
  accountingBasis: number;
  strategyBasis: number;
  createdAt: string;
  targetExitMode: GridFreeShareExitMode;
  targetExitPrice: number | null;
  status: GridFutureFreeShareLotStatus;
}

export interface GridFutureFreeShareTarget {
  level: number;
  price: number;
  quantity: number;
}

export interface GridFutureCapitalSummary {
  capitalAllocated: number;
  capitalPerLevel: number;
  capitalCommittedToOpenBuys: number;
  capitalReservedForOpenBuyOrders: number;
  capitalRecovered: number;
  availableCapitalForNewSlots: number;
  affordableOpenSlotCount: number;
}

export interface GridFutureGridSummary {
  bottomGridPrice: number;
  waitingBuyCount: number;
  waitingSellCount: number;
  blockedByCapitalSlotCount: number;
}

export interface GridFuturePositionSummary {
  activeGridQuantity: number;
  freeSharesTotalQuantity: number;
  totalQuantityHeld: number;
  activeGridCostBasis: number;
  freeSharesAccountingBasis: number;
  freeSharesStrategyBasis: number;
  totalAccountingCostBasis: number;
  activeGridAverageCost: number;
  blendedAccountingAverageCost: number;
  unrealizedPLAccounting: number;
  unrealizedPLStrategy: number;
  realizedPL: number;
}

export interface GridFutureSummary {
  capital: GridFutureCapitalSummary;
  grid: GridFutureGridSummary;
  position: GridFuturePositionSummary;
  freeShareTargets: GridFutureFreeShareTarget[];
}

export interface GridFutureState {
  slots: GridFutureSlot[];
  freeShareLots: GridFutureFreeShareLot[];
  summary: GridFutureSummary;
}

