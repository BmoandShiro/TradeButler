import type { DividendTrackerRow, ForwardDividendEstimate } from "./dividendTrackerData";

export type DividendTrackerSessionPayload = {
  rows: DividendTrackerRow[];
  forwardEstimates: ForwardDividendEstimate[];
  projectedFutureRows: DividendTrackerRow[];
  symbolsLoaded: string[];
  lastAtIso: string | null;
};

export type DividendIncomeSessionPayload = {
  forwardEstimates: ForwardDividendEstimate[];
  lastAtIso: string | null;
};

let trackerSession: { key: string; payload: DividendTrackerSessionPayload } | null = null;
let incomeSession: { key: string; payload: DividendIncomeSessionPayload } | null = null;

export function buildDividendDataKey(dataMode: string): string {
  if (typeof localStorage === "undefined") return `${dataMode}|FIFO`;
  const pairing = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
  return `${dataMode}|${pairing}`;
}

export function getDividendTrackerSession(dataMode: string): DividendTrackerSessionPayload | null {
  const key = buildDividendDataKey(dataMode);
  if (trackerSession?.key === key) return trackerSession.payload;
  return null;
}

export function setDividendTrackerSession(dataMode: string, payload: DividendTrackerSessionPayload): void {
  trackerSession = { key: buildDividendDataKey(dataMode), payload };
}

export function getDividendIncomeSession(dataMode: string): DividendIncomeSessionPayload | null {
  const key = buildDividendDataKey(dataMode);
  if (incomeSession?.key === key) return incomeSession.payload;
  return null;
}

export function setDividendIncomeSession(dataMode: string, payload: DividendIncomeSessionPayload): void {
  incomeSession = { key: buildDividendDataKey(dataMode), payload };
}
