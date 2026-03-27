/**
 * In-memory snapshot so returning to the Dashboard route in the same session
 * can show the last loaded data immediately without a full loading state.
 */
export type DashboardSessionSnapshot = {
  cacheKey: string;
  metrics: unknown;
  topSymbols: unknown[];
  strategyPerformance: unknown[];
  recentTrades: unknown[];
  trades: unknown[];
  openPositionGroups: unknown[];
  strategies: unknown[];
  forwardDividendAnnualUsd: number;
  /** Last known live quotes for open position symbols (same session). */
  openPositionQuotes: Record<string, number | null>;
  lastQuoteRefreshIso: string | null;
};

let snapshot: DashboardSessionSnapshot | null = null;

export function buildDashboardSessionCacheKey(parts: {
  dataMode: string;
  timeframe: string;
  customStartDate: string;
  customEndDate: string;
  dashboardStrategyId: number | null;
}): string {
  return JSON.stringify(parts);
}

export function getDashboardSessionSnapshot(): DashboardSessionSnapshot | null {
  return snapshot;
}

export function setDashboardSessionSnapshot(next: DashboardSessionSnapshot | null): void {
  snapshot = next;
}

/** Merge into existing snapshot (e.g. after async quote fetch). No-op if no snapshot yet. */
export function patchDashboardSessionSnapshot(patch: Partial<DashboardSessionSnapshot>): void {
  if (!snapshot) return;
  snapshot = { ...snapshot, ...patch };
}
