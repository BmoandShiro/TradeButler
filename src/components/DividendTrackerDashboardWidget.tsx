import { useState, useEffect, useCallback, useMemo, useContext } from "react";
import { CurrentPriceSyncContext } from "../contexts/CurrentPriceSyncContext";
import { format, startOfDay } from "date-fns";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { getFinnhubApiKey, hasFinnhubApiKey } from "../utils/finnhubManager";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import {
  categorizeDividendRow,
  parseExDate,
  formatDividendMoney,
  loadDividendTrackerRows,
  ROW_BORDER,
  ROW_TINT,
  filterAndSortDividendRows,
  type DividendTrackerRow,
  type DividendTimeFilter,
  type ForwardDividendEstimate,
  readDividendTrackerPageSize,
  DASHBOARD_DIVIDEND_WIDGET_TIME_FILTER_KEY,
  DASHBOARD_DIVIDEND_WIDGET_SYMBOL_FILTER_KEY,
  DASHBOARD_DIVIDEND_WIDGET_PAGE_KEY,
  readDashboardDividendWidgetTimeFilter,
  readDashboardDividendWidgetSymbolFilter,
  readDashboardDividendWidgetPage,
  type ForwardIncomeDisplayMode,
} from "../utils/dividendTrackerData";
import { DividendTrackerChartsPanel } from "./DividendTrackerChartsPanel";
import DividendForwardIncomeSummary, { ForwardIncomeModeSelect } from "./DividendForwardIncomeSummary";
import type { DividendDashboardView } from "../utils/dividendTrackerCharts";
import { getDividendTrackerSession, setDividendTrackerSession } from "../utils/dividendDashboardSessionCache";

export type DividendTrackerDashboardWidgetProps = {
  /** When set with `onPageSizeChange`, pagination is controlled (e.g. Dashboard header menu). */
  pageSize?: number;
  onPageSizeChange?: (n: number) => void;
  /** Table only, table + charts, or charts only (Dashboard header dropdown). */
  viewMode?: DividendDashboardView;
  /** Show forward income row with mode dropdown (Dashboard gear). */
  showForwardIncomePanel?: boolean;
  forwardIncomeMode?: ForwardIncomeDisplayMode;
  onForwardIncomeModeChange?: (mode: ForwardIncomeDisplayMode) => void;
  /** Register `load` so parent can trigger refresh (e.g. Dashboard gear menu). */
  onRegisterRefresh?: (refresh: () => void) => void;
};

export default function DividendTrackerDashboardWidget({
  pageSize: pageSizeProp,
  onPageSizeChange,
  viewMode = "table",
  showForwardIncomePanel = true,
  forwardIncomeMode = "all",
  onForwardIncomeModeChange,
  onRegisterRefresh,
}: DividendTrackerDashboardWidgetProps = {}) {
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [rows, setRows] = useState<DividendTrackerRow[]>(() => getDividendTrackerSession(getCurrentDataMode())?.rows ?? []);
  const [forwardEstimates, setForwardEstimates] = useState<ForwardDividendEstimate[]>(
    () => getDividendTrackerSession(getCurrentDataMode())?.forwardEstimates ?? []
  );
  const [projectedFutureRows, setProjectedFutureRows] = useState<DividendTrackerRow[]>(
    () => getDividendTrackerSession(getCurrentDataMode())?.projectedFutureRows ?? []
  );
  const [symbolsLoaded, setSymbolsLoaded] = useState<string[]>(
    () => getDividendTrackerSession(getCurrentDataMode())?.symbolsLoaded ?? []
  );
  const [loading, setLoading] = useState(() => {
    if (!hasFinnhubApiKey()) return false;
    const s = getDividendTrackerSession(getCurrentDataMode());
    return !(s && (s.rows.length > 0 || s.forwardEstimates.length > 0));
  });
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<Date | null>(() => {
    const iso = getDividendTrackerSession(getCurrentDataMode())?.lastAtIso;
    return iso ? new Date(iso) : null;
  });
  const [timeFilter, setTimeFilter] = useState<DividendTimeFilter>(() => readDashboardDividendWidgetTimeFilter());
  const [symbolFilter, setSymbolFilter] = useState<string | null>(() => readDashboardDividendWidgetSymbolFilter());
  const [page, setPage] = useState(() => readDashboardDividendWidgetPage());
  const [internalPageSize, setInternalPageSize] = useState(() => readDividendTrackerPageSize());

  const isPageSizeControlled =
    typeof pageSizeProp === "number" && typeof onPageSizeChange === "function";
  const pageSize = isPageSizeControlled ? pageSizeProp! : internalPageSize;

  const hasKey = hasFinnhubApiKey();
  const priceSync = useContext(CurrentPriceSyncContext);

  useEffect(() => subscribeToDataMode(setDataMode), []);

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_DIVIDEND_WIDGET_TIME_FILTER_KEY, timeFilter);
    } catch {
      /* ignore */
    }
  }, [timeFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(
        DASHBOARD_DIVIDEND_WIDGET_SYMBOL_FILTER_KEY,
        symbolFilter === null ? "__all__" : symbolFilter
      );
    } catch {
      /* ignore */
    }
  }, [symbolFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_DIVIDEND_WIDGET_PAGE_KEY, String(page));
    } catch {
      /* ignore */
    }
  }, [page]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const apiKey = getFinnhubApiKey();
    if (!apiKey) {
      setError("Add a Finnhub API key in Settings.");
      setRows([]);
      setForwardEstimates([]);
      setProjectedFutureRows([]);
      setSymbolsLoaded([]);
      return;
    }
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const { rows: next, symbols, forwardEstimates: fwd, projectedFutureRows: pfr } = await loadDividendTrackerRows({
        apiKey,
        dataMode,
        pairingMethod,
      });
      setRows(next);
      setForwardEstimates(fwd);
      setProjectedFutureRows(pfr);
      setSymbolsLoaded(symbols);
      const now = new Date();
      setLastAt(now);
      setDividendTrackerSession(dataMode, {
        rows: next,
        forwardEstimates: fwd,
        projectedFutureRows: pfr,
        symbolsLoaded: symbols,
        lastAtIso: now.toISOString(),
      });
    } catch (e) {
      console.error(e);
      setError(typeof e === "string" ? e : "Could not load dividends");
      setRows([]);
      setForwardEstimates([]);
      setProjectedFutureRows([]);
      setSymbolsLoaded([]);
    } finally {
      setLoading(false);
    }
  }, [dataMode]);

  useEffect(() => {
    if (!hasKey) return;
    const s = getDividendTrackerSession(dataMode);
    const silent = !!(s && (s.rows.length > 0 || s.forwardEstimates.length > 0));
    void load({ silent });
  }, [hasKey, load, dataMode]);

  useEffect(() => {
    onRegisterRefresh?.(() => load());
    return () => onRegisterRefresh?.(() => {});
  }, [load, onRegisterRefresh]);

  useEffect(() => {
    if (!priceSync?.enabled) return;
    if (priceSync.tick === 0) return;
    if (!hasKey) return;
    void load({ silent: true });
  }, [priceSync?.enabled, priceSync?.tick, hasKey, load]);

  useEffect(() => {
    setPage(0);
  }, [timeFilter, symbolFilter, pageSize]);

  const today = startOfDay(new Date());

  const orderedFilteredRows = useMemo(() => {
    const day = startOfDay(new Date());
    if (timeFilter === "future") {
      const base = symbolFilter
        ? projectedFutureRows.filter((r) => r.symbol === symbolFilter)
        : projectedFutureRows;
      return [...base].sort((a, b) => {
        const ta = parseExDate(a.exDate)!.getTime();
        const tb = parseExDate(b.exDate)!.getTime();
        if (ta !== tb) return ta - tb;
        return a.symbol.localeCompare(b.symbol);
      });
    }
    return filterAndSortDividendRows(rows, day, timeFilter, symbolFilter);
  }, [rows, projectedFutureRows, symbolFilter, timeFilter]);

  const filteredFutureTotal = useMemo(() => {
    if (timeFilter === "future") {
      return orderedFilteredRows.reduce((s, r) => s + (r.estimatedTotal ?? 0), 0);
    }
    const day = startOfDay(new Date());
    return orderedFilteredRows
      .filter((r) => categorizeDividendRow(r, day) === "future")
      .reduce((s, r) => s + (r.estimatedTotal ?? 0), 0);
  }, [orderedFilteredRows, timeFilter]);

  const forwardAnnualFiltered = useMemo(() => {
    const list = symbolFilter
      ? forwardEstimates.filter((e) => e.symbol === symbolFilter)
      : forwardEstimates;
    return list.reduce((s, e) => s + e.forwardAnnualUsd, 0);
  }, [forwardEstimates, symbolFilter]);

  const effectivePageSize = pageSize === 0 ? Infinity : pageSize;
  const totalItems = orderedFilteredRows.length;
  const totalPages =
    effectivePageSize === Infinity || totalItems === 0 ? 1 : Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = effectivePageSize === Infinity ? 0 : safePage * effectivePageSize;
  const pageEnd =
    effectivePageSize === Infinity ? totalItems : Math.min(pageStart + effectivePageSize, totalItems);
  const paginatedRows =
    effectivePageSize === Infinity ? orderedFilteredRows : orderedFilteredRows.slice(pageStart, pageEnd);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const summary = useMemo(() => {
    const day = startOfDay(new Date());
    let fut = 0;
    let futN = 0;
    let curN = 0;
    let pastN = 0;
    for (const r of rows) {
      const c = categorizeDividendRow(r, day);
      if (c === "future") {
        futN += 1;
        if (r.estimatedTotal != null) fut += r.estimatedTotal;
      } else if (c === "current") curN += 1;
      else pastN += 1;
    }
    return { futureEst: fut, futureN: futN, currentN: curN, pastN: pastN };
  }, [rows]);

  if (!hasKey) {
    return (
      <div style={{ padding: "12px 0", fontSize: "13px", color: "var(--text-secondary)", textAlign: "center" }}>
        <AlertCircle size={16} style={{ verticalAlign: "text-bottom", marginRight: "6px" }} />
        Configure a Finnhub API key in Settings to load dividend data.
      </div>
    );
  }

  if (dataMode === "sandbox") {
    return (
      <div style={{ padding: "12px 0", fontSize: "13px", color: "var(--text-secondary)" }}>
        Switch to Real or Paper data mode to see dividends for your holdings.
      </div>
    );
  }

  const chartOnly = viewMode === "charts";
  const showChartPanel = viewMode !== "table" && rows.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", flexShrink: 0, width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "11px", color: "var(--text-secondary)" }}>
        <span>
          <strong style={{ color: "var(--text-primary)" }}>Future</strong> {summary.futureN}
          {summary.futureEst > 0 ? ` · est. ${formatDividendMoney(summary.futureEst, 2)}` : ""}
        </span>
        <span style={{ opacity: 0.5 }}>|</span>
        <span>
          <strong style={{ color: "var(--text-primary)" }}>Current</strong> {summary.currentN}
        </span>
        <span style={{ opacity: 0.5 }}>|</span>
        <span>
          <strong style={{ color: "var(--text-primary)" }}>Past</strong> {summary.pastN}
        </span>
        {loading && <span style={{ opacity: 0.8 }}>(loading…)</span>}
      </div>

      {showForwardIncomePanel && symbolsLoaded.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)" }}>FORWARD INCOME</span>
            <ForwardIncomeModeSelect
              id="dashboard-dividend-tracker-income-mode"
              value={forwardIncomeMode}
              onChange={(m) => onForwardIncomeModeChange?.(m)}
              compact
            />
          </div>
          <DividendForwardIncomeSummary forwardAnnualUsd={forwardAnnualFiltered} compact mode={forwardIncomeMode} />
        </div>
      )}

      {showChartPanel && <DividendTrackerChartsPanel rows={rows} compact={!chartOnly} />}

      {!chartOnly && symbolsLoaded.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", marginRight: "2px" }}>PERIOD</span>
            {(
              [
                { id: "all" as const, label: "All" },
                { id: "current" as const, label: "Current" },
                { id: "future" as const, label: "Future" },
                { id: "past" as const, label: "Past" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTimeFilter(id)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "6px",
                  border: timeFilter === id ? "1px solid var(--accent)" : "1px solid var(--border-color)",
                  backgroundColor:
                    timeFilter === id ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-tertiary)",
                  color: timeFilter === id ? "var(--accent)" : "var(--text-secondary)",
                  fontSize: "11px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", marginRight: "2px" }}>SYMBOL</span>
            <button
              type="button"
              onClick={() => setSymbolFilter(null)}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: symbolFilter === null ? "1px solid var(--accent)" : "1px solid var(--border-color)",
                backgroundColor:
                  symbolFilter === null ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-tertiary)",
                color: symbolFilter === null ? "var(--accent)" : "var(--text-secondary)",
                fontSize: "11px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              All symbols
            </button>
            {[...symbolsLoaded].sort().map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => setSymbolFilter((prev) => (prev === sym ? null : sym))}
                style={{
                  padding: "4px 10px",
                  borderRadius: "6px",
                  border: symbolFilter === sym ? "1px solid var(--accent)" : "1px solid var(--border-color)",
                  backgroundColor:
                    symbolFilter === sym ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-tertiary)",
                  color: symbolFilter === sym ? "var(--accent)" : "var(--text-primary)",
                  fontSize: "11px",
                  fontWeight: "600",
                  cursor: "pointer",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      )}

      {!chartOnly && (timeFilter === "all" || timeFilter === "future") && filteredFutureTotal > 0 && (
        <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--profit)" }}>
          {timeFilter === "future"
            ? `Sum projected (next 12 mo): ${formatDividendMoney(filteredFutureTotal, 2)}`
            : `Est. future (visible future rows): ${formatDividendMoney(filteredFutureTotal, 2)}`}
        </div>
      )}

      {error && (
        <div style={{ fontSize: "12px", color: "var(--loss)", padding: "8px", borderRadius: "6px", backgroundColor: "rgba(239, 68, 68, 0.08)" }}>
          {error}
        </div>
      )}

      {rows.length === 0 && !loading && !error && (
        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)" }}>
          No dividend rows yet — add long positions or open the full tracker after earnings season updates.
        </p>
      )}

      {!chartOnly && orderedFilteredRows.length > 0 && (
        <>
          <div style={{ overflowX: "auto", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", minWidth: "520px" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--bg-tertiary)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", fontWeight: "600" }}>Symbol</th>
                  <th style={{ padding: "6px 8px", fontWeight: "600" }}>Shares</th>
                  <th style={{ padding: "6px 8px", fontWeight: "600" }}>Ex-div</th>
                  <th style={{ padding: "6px 8px", fontWeight: "600" }}>Pay</th>
                  <th style={{ padding: "6px 8px", fontWeight: "600" }}>Div/sh</th>
                  <th style={{ padding: "6px 8px", fontWeight: "600" }}>Est.</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((r, i) => {
                  const cat = categorizeDividendRow(r, today);
                  return (
                    <tr key={`${r.symbol}-${r.exDate}-${pageStart + i}`} style={{ backgroundColor: ROW_TINT[cat] }}>
                      <td
                        style={{
                          padding: "6px 8px",
                          fontWeight: "600",
                          borderLeft: ROW_BORDER[cat],
                        }}
                      >
                        {r.symbol}
                      </td>
                      <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>
                        {r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </td>
                      <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>
                        {r.exDate}
                        {r.isProjected && (
                          <span style={{ marginLeft: "4px", fontSize: "9px", fontWeight: "600", color: "var(--text-secondary)" }}>
                            (p)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "6px 8px", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                        {r.paymentDate ?? "—"}
                      </td>
                      <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>{formatDividendMoney(r.amountPerShare)}</td>
                      <td style={{ padding: "6px 8px", fontWeight: "600", color: "var(--profit)", fontVariantNumeric: "tabular-nums" }}>
                        {formatDividendMoney(r.estimatedTotal, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {effectivePageSize !== Infinity && totalPages > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "8px",
                fontSize: "11px",
                color: "var(--text-secondary)",
              }}
            >
              <span>
                {totalItems === 0 ? (
                  "Showing 0 of 0"
                ) : (
                  <>
                    Showing {pageStart + 1}–{pageEnd} of {totalItems}
                  </>
                )}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage <= 0}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                    cursor: safePage <= 0 ? "not-allowed" : "pointer",
                    opacity: safePage <= 0 ? 0.5 : 1,
                    fontSize: "11px",
                    fontWeight: "600",
                  }}
                >
                  <ChevronLeft size={14} />
                  Prev
                </button>
                <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-primary)", fontWeight: "600" }}>
                  Page {safePage + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                    cursor: safePage >= totalPages - 1 ? "not-allowed" : "pointer",
                    opacity: safePage >= totalPages - 1 ? 0.5 : 1,
                    fontSize: "11px",
                    fontWeight: "600",
                  }}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

          {effectivePageSize === Infinity && totalItems > 0 && (
            <p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)", textAlign: "center" }}>
              Showing all {totalItems} row{totalItems === 1 ? "" : "s"}
            </p>
          )}
        </>
      )}

      {!chartOnly && orderedFilteredRows.length === 0 && rows.length > 0 && (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>No rows match the selected filters.</p>
      )}

      {lastAt && (
        <p style={{ margin: 0, fontSize: "10px", color: "var(--text-secondary)", textAlign: "center" }}>
          Updated {format(lastAt, "HH:mm:ss")}
        </p>
      )}
    </div>
  );
}
