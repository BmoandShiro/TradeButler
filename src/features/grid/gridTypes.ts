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
  status?: "FILLED" | "PARTIAL" | "CANCELLED";
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
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  openTime: string;
  closeTime: string;
  durationMs: number;
  entryLevelId?: string;
  exitLevelId?: string;
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

