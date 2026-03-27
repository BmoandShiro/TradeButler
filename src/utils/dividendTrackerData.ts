import { invoke } from "@tauri-apps/api/tauri";
import { format, parseISO, startOfDay, isBefore, isAfter, addDays } from "date-fns";
import type { DataMode } from "./dataMode";

export interface DividendInfo {
  symbol: string;
  ex_date: string | null;
  payment_date: string | null;
  record_date: string | null;
  declaration_date: string | null;
  amount: number | null;
  frequency: string | null;
  dividend_type: string | null;
}

export interface OpenPositionGroupLite {
  entry_trade: { symbol: string };
  final_quantity: number;
}

/** Minimal trade shape from `get_trades` for historical long quantity at ex-date. */
export interface DividendTradeLite {
  symbol: string;
  side: string;
  quantity: number;
  timestamp: string;
  status?: string | null;
}

function isFilledTrade(t: DividendTradeLite): boolean {
  const s = (t.status ?? "").toUpperCase();
  return s === "FILLED";
}

/** Long shares held for a symbol immediately before the calendar ex-date (entitlement). */
export function longSharesAtExDate(sortedAscTradesForSymbol: DividendTradeLite[], exDate: Date): number {
  const boundary = startOfDay(exDate).getTime();
  let net = 0;
  for (const t of sortedAscTradesForSymbol) {
    const ts = new Date(t.timestamp).getTime();
    if (ts >= boundary) break;
    const side = t.side.toUpperCase();
    if (side === "BUY") net += t.quantity;
    else if (side === "SELL") net -= t.quantity;
  }
  return Math.max(0, net);
}

export function prepareSortedTradesBySymbol(trades: DividendTradeLite[]): Map<string, DividendTradeLite[]> {
  const map = new Map<string, DividendTradeLite[]>();
  for (const t of trades) {
    if (!isFilledTrade(t)) continue;
    const sym = t.symbol.toUpperCase();
    if (!map.has(sym)) map.set(sym, []);
    map.get(sym)!.push(t);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
  return map;
}

/** Same rule as charts: received = paid, or no pay date and ex is before today. */
export function dividendRowUsesSharesAtExDate(
  paymentDate: string | null,
  exDate: string,
  today: Date
): boolean {
  const pay = paymentDate ? parseExDate(paymentDate) : null;
  const ex = parseExDate(exDate);
  if (!ex) return false;
  if (pay) return pay < today;
  return ex < today;
}

export interface DividendTrackerRow {
  symbol: string;
  shares: number;
  exDate: string;
  paymentDate: string | null;
  amountPerShare: number | null;
  estimatedTotal: number | null;
}

export type RowCategory = "future" | "current" | "past";

export function parseExDate(s: string | null): Date | null {
  if (!s || !s.trim()) return null;
  try {
    return startOfDay(parseISO(s.trim()));
  } catch {
    return null;
  }
}

export function formatDividendMoney(n: number | null, decimals = 4): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals })}`;
}

/** Future: ex not yet. Past: ex passed and pay date in past (or very old ex with no pay). Current: ex today, or ex passed but pay not yet / unknown. */
export function categorizeDividendRow(r: DividendTrackerRow, today: Date): RowCategory {
  const ex = parseExDate(r.exDate);
  if (!ex) return "past";
  if (isAfter(ex, today)) return "future";
  if (ex.getTime() === today.getTime()) return "current";
  const pay = r.paymentDate ? parseExDate(r.paymentDate) : null;
  if (pay && isBefore(pay, today)) return "past";
  if (!pay && isBefore(ex, addDays(today, -90))) return "past";
  return "current";
}

export const ROW_TINT: Record<RowCategory, string> = {
  future: "color-mix(in srgb, #ca8a04 22%, var(--bg-secondary))",
  current: "color-mix(in srgb, #2563eb 20%, var(--bg-secondary))",
  past: "color-mix(in srgb, #16a34a 18%, var(--bg-secondary))",
};

export const ROW_BORDER: Record<RowCategory, string> = {
  future: "3px solid color-mix(in srgb, #eab308 55%, transparent)",
  current: "3px solid color-mix(in srgb, #3b82f6 55%, transparent)",
  past: "3px solid color-mix(in srgb, #22c55e 50%, transparent)",
};

export const CATEGORY_SORT_ORDER: Record<RowCategory, number> = {
  future: 0,
  current: 1,
  past: 2,
};

/** Same ordering as the Tools "All" tab: future → current → past, then ex-date ascending. */
export function sortDividendRowsAllFilter(rows: DividendTrackerRow[], today: Date): DividendTrackerRow[] {
  return [...rows].sort((a, b) => {
    const ca = categorizeDividendRow(a, today);
    const cb = categorizeDividendRow(b, today);
    const oa = CATEGORY_SORT_ORDER[ca];
    const ob = CATEGORY_SORT_ORDER[cb];
    if (oa !== ob) return oa - ob;
    return parseExDate(a.exDate)!.getTime() - parseExDate(b.exDate)!.getTime();
  });
}

export type DividendTimeFilter = "all" | "current" | "future" | "past";

/** Filter by period + symbol, then sort (same rules as Tools Dividend Tracker). */
export function filterAndSortDividendRows(
  rows: DividendTrackerRow[],
  day: Date,
  timeFilter: DividendTimeFilter,
  symbolFilter: string | null
): DividendTrackerRow[] {
  const base = [...rows].filter((r) => {
    if (symbolFilter && r.symbol !== symbolFilter) return false;
    const cat = categorizeDividendRow(r, day);
    if (timeFilter === "all") return true;
    return cat === timeFilter;
  });

  base.sort((a, b) => {
    if (timeFilter === "all") {
      const ca = categorizeDividendRow(a, day);
      const cb = categorizeDividendRow(b, day);
      const oa = CATEGORY_SORT_ORDER[ca];
      const ob = CATEGORY_SORT_ORDER[cb];
      if (oa !== ob) return oa - ob;
    }
    return parseExDate(a.exDate)!.getTime() - parseExDate(b.exDate)!.getTime();
  });

  return base;
}

export const DIVIDEND_TRACKER_PAGE_SIZE_KEY = "tradebutler_dividend_tracker_page_size";
export const DIVIDEND_TRACKER_PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 0] as const;

export function readDividendTrackerPageSize(): number {
  try {
    const raw = localStorage.getItem(DIVIDEND_TRACKER_PAGE_SIZE_KEY);
    const n = raw == null ? NaN : Number(raw);
    if ((DIVIDEND_TRACKER_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) return n;
  } catch {
    /* ignore */
  }
  return 25;
}

export async function loadDividendTrackerRows(options: {
  apiKey: string;
  dataMode: DataMode;
  pairingMethod: string;
}): Promise<{ rows: DividendTrackerRow[]; symbols: string[] }> {
  const { apiKey, dataMode, pairingMethod } = options;
  if (dataMode === "sandbox") {
    return { rows: [], symbols: [] };
  }

  const paperArgs = dataMode === "paper" ? { paperOnly: true as const } : {};
  const groups = await invoke<OpenPositionGroupLite[]>("get_position_groups", {
    pairingMethod,
    startDate: null,
    endDate: null,
    ...paperArgs,
  });

  const longs = (groups || []).filter(
    (g) => g.final_quantity > 0 && Math.abs(g.final_quantity) >= 0.0001
  );
  const bySymbol = new Map<string, number>();
  for (const g of longs) {
    const sym = g.entry_trade.symbol.toUpperCase();
    bySymbol.set(sym, (bySymbol.get(sym) ?? 0) + g.final_quantity);
  }

  const symbols = [...bySymbol.keys()];
  if (symbols.length === 0) {
    return { rows: [], symbols: [] };
  }

  const paperArgsForTrades = dataMode === "paper" ? { paperOnly: true as const } : {};
  const allTrades = await invoke<DividendTradeLite[]>("get_trades", paperArgsForTrades);
  const tradesBySymbol = prepareSortedTradesBySymbol(allTrades ?? []);
  const today = startOfDay(new Date());

  const out: DividendTrackerRow[] = [];

  await Promise.all(
    symbols.map(async (symbol) => {
      const currentShares = bySymbol.get(symbol) ?? 0;
      const symTrades = tradesBySymbol.get(symbol) ?? [];
      try {
        const divs = await invoke<DividendInfo[]>("fetch_finnhub_dividends", { apiKey, symbol });
        for (const d of divs) {
          const ex = parseExDate(d.ex_date);
          if (!ex) continue;
          const exStr = format(ex, "yyyy-MM-dd");
          const amt = d.amount != null && Number.isFinite(d.amount) ? d.amount : null;
          const sharesAtEx = longSharesAtExDate(symTrades, ex);
          const useAtEx = dividendRowUsesSharesAtExDate(d.payment_date, exStr, today);
          const qty = useAtEx ? sharesAtEx : currentShares;
          const est = amt != null ? amt * qty : null;
          out.push({
            symbol,
            shares: qty,
            exDate: exStr,
            paymentDate: d.payment_date,
            amountPerShare: amt,
            estimatedTotal: est,
          });
        }
      } catch (e) {
        console.warn(`Dividends fetch failed for ${symbol}`, e);
      }
    })
  );

  const seen = new Set<string>();
  const deduped: DividendTrackerRow[] = [];
  for (const r of out.sort((a, b) => {
    const da = parseExDate(a.exDate)!.getTime();
    const db = parseExDate(b.exDate)!.getTime();
    return da - db;
  })) {
    const k = `${r.symbol}|${r.exDate}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }

  return { rows: deduped, symbols };
}
