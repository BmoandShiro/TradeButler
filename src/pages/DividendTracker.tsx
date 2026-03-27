import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { format, startOfDay, subMonths, addMonths } from "date-fns";
import { RefreshCw, AlertCircle, Coins, Info, Settings, ChevronLeft, ChevronRight } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getFinnhubApiKey, hasFinnhubApiKey } from "../utils/finnhubManager";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import {
  type DividendTrackerRow,
  categorizeDividendRow,
  formatDividendMoney,
  ROW_TINT,
  ROW_BORDER,
  loadDividendTrackerRows,
  filterAndSortDividendRows,
  type DividendTimeFilter,
  DIVIDEND_TRACKER_PAGE_SIZE_KEY,
  DIVIDEND_TRACKER_PAGE_SIZE_OPTIONS,
  readDividendTrackerPageSize,
} from "../utils/dividendTrackerData";
import {
  readDividendChartRange,
  DIVIDEND_CHART_RANGE_KEY,
  buildDividendChartData,
  parseRangeDate,
  inferRowDateBounds,
  readDividendChartDisplayMode,
  DIVIDEND_CHART_DISPLAY_MODE_KEY,
  buildDividendCumulativeSeries,
  buildDividendPeriodSeries,
  type DividendChartDisplayMode,
} from "../utils/dividendTrackerCharts";

export default function DividendTracker() {
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [rows, setRows] = useState<DividendTrackerRow[]>([]);
  const [symbolsLoaded, setSymbolsLoaded] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [timeFilter, setTimeFilter] = useState<DividendTimeFilter>("all");
  const [symbolFilter, setSymbolFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(() => readDividendTrackerPageSize());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [chartRange, setChartRange] = useState(() => readDividendChartRange());
  const [chartDisplayMode, setChartDisplayMode] = useState<DividendChartDisplayMode>(() => readDividendChartDisplayMode());

  const hasApiKey = hasFinnhubApiKey();

  useEffect(() => {
    try {
      localStorage.setItem(DIVIDEND_CHART_RANGE_KEY, JSON.stringify(chartRange));
    } catch {
      /* ignore */
    }
  }, [chartRange]);

  useEffect(() => {
    try {
      localStorage.setItem(DIVIDEND_CHART_DISPLAY_MODE_KEY, chartDisplayMode);
    } catch {
      /* ignore */
    }
  }, [chartDisplayMode]);

  useEffect(() => subscribeToDataMode(setDataMode), []);

  const load = useCallback(async () => {
    const apiKey = getFinnhubApiKey();
    if (!apiKey) {
      setError("Please configure your Finnhub API key in Settings");
      return;
    }
    if (dataMode === "sandbox") {
      setRows([]);
      setSymbolsLoaded([]);
      setError(null);
      setLastRefresh(new Date());
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const { rows: deduped, symbols } = await loadDividendTrackerRows({
        apiKey,
        dataMode,
        pairingMethod,
      });
      setSymbolsLoaded(symbols);
      setRows(deduped);
      setLastRefresh(new Date());
    } catch (e) {
      console.error(e);
      setError(typeof e === "string" ? e : "Failed to load dividend data");
    } finally {
      setIsLoading(false);
    }
  }, [dataMode]);

  useEffect(() => {
    if (hasApiKey) load();
  }, [load, hasApiKey]);

  useEffect(() => {
    setPage(0);
  }, [timeFilter, symbolFilter, pageSize]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [settingsOpen]);

  const today = startOfDay(new Date());

  const orderedFilteredRows = useMemo(() => {
    const day = startOfDay(new Date());
    return filterAndSortDividendRows(rows, day, timeFilter, symbolFilter);
  }, [rows, symbolFilter, timeFilter]);

  const filteredFutureTotal = useMemo(() => {
    const day = startOfDay(new Date());
    return orderedFilteredRows
      .filter((r) => categorizeDividendRow(r, day) === "future")
      .reduce((s, r) => s + (r.estimatedTotal ?? 0), 0);
  }, [orderedFilteredRows]);

  const effectivePageSize = pageSize === 0 ? Infinity : pageSize;
  const totalItems = orderedFilteredRows.length;
  const totalPages =
    effectivePageSize === Infinity || totalItems === 0 ? 1 : Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = effectivePageSize === Infinity ? 0 : safePage * effectivePageSize;
  const pageEnd =
    effectivePageSize === Infinity ? totalItems : Math.min(pageStart + effectivePageSize, totalItems);
  const paginatedRows =
    effectivePageSize === Infinity
      ? orderedFilteredRows
      : orderedFilteredRows.slice(pageStart, pageEnd);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const chartData = useMemo(() => {
    const start = parseRangeDate(chartRange.start);
    const end = parseRangeDate(chartRange.end);
    if (!start || !end) return { monthly: [] as { month: string; label: string; received: number; expected: number }[], bySymbol: [] as { symbol: string; received: number; expected: number }[] };
    const day = startOfDay(new Date());
    return buildDividendChartData(rows, start, end, day);
  }, [rows, chartRange.start, chartRange.end]);

  const chartSymbolBars = useMemo(() => chartData.bySymbol.slice(0, 24), [chartData.bySymbol]);

  const chartRangeInvalid = useMemo(() => {
    const start = parseRangeDate(chartRange.start);
    const end = parseRangeDate(chartRange.end);
    return !start || !end || start > end;
  }, [chartRange.start, chartRange.end]);

  const mainTimelineChart = useMemo(() => {
    const start = parseRangeDate(chartRange.start);
    const end = parseRangeDate(chartRange.end);
    if (!start || !end || chartDisplayMode === "hidden") return null;
    const day = startOfDay(new Date());
    if (chartDisplayMode === "cumulative") {
      return { kind: "cumulative" as const, data: buildDividendCumulativeSeries(rows, start, end, day) };
    }
    if (chartDisplayMode === "monthly") {
      return { kind: "monthly" as const, data: chartData.monthly };
    }
    const gran = chartDisplayMode === "quarterly" ? "quarterly" : "annual";
    return { kind: "periodBars" as const, data: buildDividendPeriodSeries(rows, start, end, day, gran) };
  }, [rows, chartRange.start, chartRange.end, chartDisplayMode, chartData]);

  const noDividendDataInChartRange = useMemo(() => {
    if (chartDisplayMode === "hidden" || chartRangeInvalid) return false;
    if (!mainTimelineChart) return true;
    if (mainTimelineChart.kind === "cumulative") {
      return !mainTimelineChart.data.some((d) => d.cumulativeReceived > 0 || d.cumulativeExpected > 0);
    }
    if (mainTimelineChart.kind === "monthly") {
      return !chartData.monthly.some((m) => m.received > 0 || m.expected > 0);
    }
    return !mainTimelineChart.data.some((p) => p.received > 0 || p.expected > 0);
  }, [chartDisplayMode, chartRangeInvalid, mainTimelineChart, chartData.monthly]);

  const rowChartBounds = useMemo(() => inferRowDateBounds(rows), [rows]);

  if (!hasApiKey) {
    return (
      <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "12px",
            padding: "32px",
            textAlign: "center",
            border: "1px solid var(--border-color)",
          }}
        >
          <AlertCircle size={48} color="var(--text-secondary)" style={{ marginBottom: "16px" }} />
          <h2 style={{ fontSize: "20px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "8px" }}>
            Finnhub API Key Required
          </h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "24px" }}>
            Dividend schedules use Finnhub (with Yahoo fallback in the app). Add your free API key under Settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: "1100px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-primary)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: "10px" }}>
            <Coins size={28} color="var(--accent)" />
            Dividend Tracker
          </h1>
          <p style={{ margin: 0, fontSize: "14px", color: "var(--text-secondary)", maxWidth: "720px", lineHeight: 1.5 }}>
            Open <strong>long</strong> positions are matched to dividend schedules from Finnhub/Yahoo (not from your trade CSV). <strong>Pay date</strong> is whatever the API publishes for that dividend—if it is blank, the provider did not supply a date yet. Your imported trades only drive <em>which symbols</em> and <em>share quantities</em> for estimates.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }} ref={settingsRef}>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              title="Table and pagination options"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 14px",
                borderRadius: "8px",
                border: settingsOpen ? "1px solid var(--accent)" : "1px solid var(--border-color)",
                backgroundColor: settingsOpen ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--bg-secondary)",
                color: "var(--text-primary)",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "600",
              }}
            >
              <Settings size={16} />
              Settings
            </button>
            {settingsOpen && (
              <div
                role="dialog"
                aria-label="Table view options"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 8px)",
                  minWidth: "220px",
                  padding: "14px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--bg-secondary)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                  zIndex: 20,
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "var(--text-secondary)", marginBottom: "10px" }}>
                  ROWS PER PAGE
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {DIVIDEND_TRACKER_PAGE_SIZE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        setPageSize(opt);
                        try {
                          localStorage.setItem(DIVIDEND_TRACKER_PAGE_SIZE_KEY, String(opt));
                        } catch {
                          /* ignore */
                        }
                        setSettingsOpen(false);
                      }}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: pageSize === opt ? "1px solid var(--accent)" : "1px solid transparent",
                        backgroundColor: pageSize === opt ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                        fontWeight: pageSize === opt ? "600" : "500",
                        cursor: "pointer",
                      }}
                    >
                      {opt === 0 ? "All (no pagination)" : `${opt} per page`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              load();
            }}
            disabled={isLoading || dataMode === "sandbox"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--bg-secondary)",
              color: "var(--text-primary)",
              cursor: isLoading || dataMode === "sandbox" ? "not-allowed" : "pointer",
              fontSize: "14px",
              fontWeight: "600",
            }}
          >
            <RefreshCw size={16} className={isLoading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {dataMode === "sandbox" && (
        <div
          style={{
            padding: "16px",
            borderRadius: "8px",
            backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)",
            border: "1px solid var(--accent)",
            color: "var(--text-primary)",
            marginBottom: "20px",
            fontSize: "14px",
          }}
        >
          Demo mode has no live positions — switch to Real or Paper in the app data mode to track dividends against your holdings.
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "8px", backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#EF4444", marginBottom: "16px", fontSize: "14px" }}>
          {error}
        </div>
      )}

      {symbolsLoaded.length === 0 && !isLoading && dataMode !== "sandbox" && (
        <div
          style={{
            padding: "24px",
            borderRadius: "12px",
            border: "1px dashed var(--border-color)",
            backgroundColor: "var(--bg-secondary)",
            color: "var(--text-secondary)",
            fontSize: "14px",
          }}
        >
          No open long positions found. Add trades or import history — only symbols you currently hold long will appear here.
        </div>
      )}

      {symbolsLoaded.length > 0 && dataMode !== "sandbox" && (
        <div
          style={{
            marginBottom: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginRight: "4px" }}>Period</span>
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
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: timeFilter === id ? "1px solid var(--accent)" : "1px solid var(--border-color)",
                  backgroundColor:
                    timeFilter === id ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-secondary)",
                  color: timeFilter === id ? "var(--accent)" : "var(--text-secondary)",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginRight: "4px" }}>Symbol</span>
            <button
              type="button"
              onClick={() => setSymbolFilter(null)}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: symbolFilter === null ? "1px solid var(--accent)" : "1px solid var(--border-color)",
                backgroundColor:
                  symbolFilter === null ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-secondary)",
                color: symbolFilter === null ? "var(--accent)" : "var(--text-secondary)",
                fontSize: "13px",
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
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: symbolFilter === sym ? "1px solid var(--accent)" : "1px solid var(--border-color)",
                  backgroundColor:
                    symbolFilter === sym ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-secondary)",
                  color: symbolFilter === sym ? "var(--accent)" : "var(--text-primary)",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {sym}
              </button>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "16px",
              fontSize: "11px",
              color: "var(--text-secondary)",
              alignItems: "center",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: ROW_TINT.future, borderLeft: ROW_BORDER.future }} />
              Future (ex-dividend not yet)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: ROW_TINT.current, borderLeft: ROW_BORDER.current }} />
              Current (ex today, or pay date still ahead / unknown)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: ROW_TINT.past, borderLeft: ROW_BORDER.past }} />
              Past (paid out or historical)
            </span>
          </div>
        </div>
      )}

      {symbolsLoaded.length > 0 && rows.length > 0 && dataMode !== "sandbox" && (
        <section style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
            <div>
              <h2 style={{ margin: "0 0 4px 0", fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>Dividend charts</h2>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", maxWidth: "560px" }}>
                Estimates use current share counts and API data. Green = received (paid or ex in the past); blue = expected (pay or ex still ahead).
              </p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-secondary)", fontWeight: "600" }}>
                Chart view
                <select
                  value={chartDisplayMode}
                  onChange={(e) => setChartDisplayMode(e.target.value as DividendChartDisplayMode)}
                  aria-label="Dividend chart view"
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    fontWeight: "500",
                    minWidth: "220px",
                    cursor: "pointer",
                  }}
                >
                  <option value="hidden">Hidden</option>
                  <option value="cumulative">Cumulative — running totals</option>
                  <option value="monthly">Monthly — period totals</option>
                  <option value="quarterly">Quarterly — period totals</option>
                  <option value="annual">Annual — period totals</option>
                </select>
              </label>
              {chartDisplayMode !== "hidden" && (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    From
                    <input
                      type="date"
                      value={chartRange.start}
                      onChange={(e) => setChartRange((r) => ({ ...r, start: e.target.value }))}
                      style={{
                        padding: "6px 8px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-secondary)",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                      }}
                    />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    To
                    <input
                      type="date"
                      value={chartRange.end}
                      onChange={(e) => setChartRange((r) => ({ ...r, end: e.target.value }))}
                      style={{
                        padding: "6px 8px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-secondary)",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const t = startOfDay(new Date());
                      setChartRange({
                        start: format(subMonths(t, 12), "yyyy-MM-dd"),
                        end: format(addMonths(t, 12), "yyyy-MM-dd"),
                      });
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-secondary)",
                      color: "var(--text-secondary)",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    Default (±1 year)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (rowChartBounds) setChartRange(rowChartBounds);
                    }}
                    disabled={!rowChartBounds}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-secondary)",
                      color: "var(--text-secondary)",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: rowChartBounds ? "pointer" : "not-allowed",
                      opacity: rowChartBounds ? 1 : 0.5,
                    }}
                  >
                    Span all data
                  </button>
                </>
              )}
            </div>
          </div>
          {chartDisplayMode === "hidden" && (
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)" }}>
              Charts are hidden. Pick another chart view to show the timeline and by-symbol breakdown.
            </p>
          )}
          {chartDisplayMode !== "hidden" && chartRangeInvalid && (
            <div style={{ padding: "10px 14px", borderRadius: "8px", backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#EF4444", fontSize: "13px", marginBottom: "12px" }}>
              Choose a valid date range (start on or before end).
            </div>
          )}
          {chartDisplayMode !== "hidden" &&
            !chartRangeInvalid &&
            mainTimelineChart?.kind === "cumulative" &&
            mainTimelineChart.data.some((d) => d.cumulativeReceived > 0 || d.cumulativeExpected > 0) && (
            <div style={{ marginBottom: "28px", width: "100%", minHeight: "320px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "8px", fontSize: "11px", color: "var(--text-secondary)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "12px", height: "3px", borderRadius: "1px", background: "#22c55e" }} />
                  Cumulative received
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "12px", height: "3px", borderRadius: "1px", background: "#3b82f6" }} />
                  Cumulative expected
                </span>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={mainTimelineChart.data} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                    interval={0}
                    angle={-32}
                    textAnchor="end"
                    height={72}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
                  <Tooltip
                    formatter={(value: number) => formatDividendMoney(value, 2)}
                    labelStyle={{ color: "var(--text-primary)" }}
                    contentStyle={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                    }}
                  />
                  <Line type="monotone" dataKey="cumulativeReceived" name="Cumulative received" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="cumulativeExpected" name="Cumulative expected" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
              <p style={{ margin: "8px 0 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>
                Running sums by calendar month (payment date, or ex-date if pay unknown).
              </p>
            </div>
          )}
          {chartDisplayMode !== "hidden" && !chartRangeInvalid && mainTimelineChart?.kind === "monthly" && chartData.monthly.some((m) => m.received > 0 || m.expected > 0) && (
            <div style={{ marginBottom: "28px", width: "100%", minHeight: "320px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "8px", fontSize: "11px", color: "var(--text-secondary)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "12px", height: "3px", borderRadius: "1px", background: "#22c55e" }} />
                  Received
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "12px", height: "3px", borderRadius: "1px", background: "#3b82f6" }} />
                  Expected
                </span>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData.monthly} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                    interval={0}
                    angle={-32}
                    textAnchor="end"
                    height={72}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
                  <Tooltip
                    formatter={(value: number) => formatDividendMoney(value, 2)}
                    labelStyle={{ color: "var(--text-primary)" }}
                    contentStyle={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                    }}
                  />
                  <Line type="monotone" dataKey="received" name="Received" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="expected" name="Expected" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
              <p style={{ margin: "8px 0 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>Totals per calendar month (payment date, or ex-date if pay unknown).</p>
            </div>
          )}
          {chartDisplayMode !== "hidden" && !chartRangeInvalid && mainTimelineChart?.kind === "periodBars" && mainTimelineChart.data.some((p) => p.received > 0 || p.expected > 0) && (
            <div style={{ marginBottom: "28px", width: "100%", minHeight: "320px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "8px", fontSize: "11px", color: "var(--text-secondary)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "12px", height: "12px", borderRadius: "2px", background: "#22c55e" }} />
                  Received
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "12px", height: "12px", borderRadius: "2px", background: "#3b82f6" }} />
                  Expected
                </span>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={mainTimelineChart.data} margin={{ top: 8, right: 12, left: 4, bottom: chartDisplayMode === "annual" ? 8 : 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
                    interval={0}
                    angle={chartDisplayMode === "annual" ? 0 : -28}
                    textAnchor="end"
                    height={chartDisplayMode === "annual" ? 28 : 56}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
                  <Tooltip
                    formatter={(value: number) => formatDividendMoney(value, 2)}
                    contentStyle={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="received" name="Received" stackId="div" fill="#22c55e" />
                  <Bar dataKey="expected" name="Expected" stackId="div" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
              <p style={{ margin: "8px 0 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>
                {chartDisplayMode === "quarterly" ? "Totals per calendar quarter" : "Totals per calendar year"} (payment date, or ex-date if pay unknown).
              </p>
            </div>
          )}
          {chartDisplayMode !== "hidden" && chartSymbolBars.length > 0 && (
            <div style={{ width: "100%", minHeight: Math.min(520, 28 + chartSymbolBars.length * 28), marginTop: "8px" }}>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "15px", fontWeight: "600", color: "var(--text-primary)" }}>By symbol (top {chartSymbolBars.length})</h3>
              <ResponsiveContainer width="100%" height={Math.min(520, 40 + chartSymbolBars.length * 28)}>
                <BarChart data={chartSymbolBars} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
                  <YAxis type="category" dataKey="symbol" width={56} tick={{ fontSize: 11, fill: "var(--text-primary)" }} />
                  <Tooltip
                    formatter={(value: number) => formatDividendMoney(value, 2)}
                    contentStyle={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="received" name="Received" stackId="div" fill="#22c55e" />
                  <Bar dataKey="expected" name="Expected" stackId="div" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {chartDisplayMode !== "hidden" && !chartRangeInvalid && noDividendDataInChartRange && chartSymbolBars.length === 0 && (
            <div
              style={{
                padding: "20px",
                borderRadius: "10px",
                border: "1px dashed var(--border-color)",
                backgroundColor: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                fontSize: "14px",
              }}
            >
              No dividend amounts fall in this date range. Widen the range or check your positions.
            </div>
          )}
        </section>
      )}

      {symbolsLoaded.length > 0 && rows.length > 0 && (
        <section style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>Dividends</h2>
            {(timeFilter === "all" || timeFilter === "future") && filteredFutureTotal > 0 && (
              <span style={{ fontSize: "14px", fontWeight: "600", color: "var(--profit)" }}>
                Est. future (visible future rows): {formatDividendMoney(filteredFutureTotal, 2)}
              </span>
            )}
          </div>
          <div style={{ overflowX: "auto", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--bg-tertiary)", textAlign: "left" }}>
                  <th style={{ padding: "12px 14px", fontWeight: "600" }}>Symbol</th>
                  <th style={{ padding: "12px 14px", fontWeight: "600" }}>Shares</th>
                  <th style={{ padding: "12px 14px", fontWeight: "600" }}>Ex-dividend</th>
                  <th style={{ padding: "12px 14px", fontWeight: "600" }}>Pay date</th>
                  <th style={{ padding: "12px 14px", fontWeight: "600" }}>Div / share</th>
                  <th style={{ padding: "12px 14px", fontWeight: "600" }}>Est. total</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((r, i) => {
                  const cat = categorizeDividendRow(r, today);
                  return (
                    <tr
                      key={`${r.symbol}-${r.exDate}-${pageStart + i}`}
                      style={{
                        borderTop: "1px solid var(--border-color)",
                        backgroundColor: ROW_TINT[cat],
                      }}
                    >
                      <td
                        style={{
                          padding: "12px 14px",
                          fontWeight: "600",
                          color: "var(--text-primary)",
                          borderLeft: ROW_BORDER[cat],
                        }}
                      >
                        {r.symbol}
                      </td>
                      <td style={{ padding: "12px 14px", fontVariantNumeric: "tabular-nums" }}>{r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td style={{ padding: "12px 14px" }}>{r.exDate}</td>
                      <td style={{ padding: "12px 14px", color: "var(--text-secondary)" }}>{r.paymentDate ?? "—"}</td>
                      <td style={{ padding: "12px 14px", fontVariantNumeric: "tabular-nums" }}>{formatDividendMoney(r.amountPerShare)}</td>
                      <td style={{ padding: "12px 14px", fontWeight: "600", color: "var(--profit)", fontVariantNumeric: "tabular-nums" }}>{formatDividendMoney(r.estimatedTotal, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {orderedFilteredRows.length > 0 && effectivePageSize !== Infinity && totalPages > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px",
                marginTop: "12px",
                fontSize: "13px",
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
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage <= 0}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    cursor: safePage <= 0 ? "not-allowed" : "pointer",
                    opacity: safePage <= 0 ? 0.5 : 1,
                    fontSize: "13px",
                    fontWeight: "600",
                  }}
                >
                  <ChevronLeft size={16} />
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
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    cursor: safePage >= totalPages - 1 ? "not-allowed" : "pointer",
                    opacity: safePage >= totalPages - 1 ? 0.5 : 1,
                    fontSize: "13px",
                    fontWeight: "600",
                  }}
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
          {orderedFilteredRows.length > 0 && effectivePageSize === Infinity && (
            <p style={{ marginTop: "12px", fontSize: "13px", color: "var(--text-secondary)" }}>
              Showing all {totalItems} row{totalItems === 1 ? "" : "s"}
            </p>
          )}
          {orderedFilteredRows.length === 0 && (
            <p style={{ marginTop: "12px", fontSize: "14px", color: "var(--text-secondary)" }}>
              No rows match the selected filters. Try &quot;All&quot; or pick another symbol.
            </p>
          )}
        </section>
      )}

      {symbolsLoaded.length > 0 && rows.length === 0 && !isLoading && dataMode !== "sandbox" && (
        <div style={{ padding: "16px", borderRadius: "8px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", fontSize: "14px", color: "var(--text-secondary)" }}>
          No dividend rows returned for your symbols (or amounts not yet published). Try Refresh later.
        </div>
      )}

      <div
        style={{
          marginTop: "24px",
          padding: "12px 14px",
          borderRadius: "8px",
          backgroundColor: "var(--bg-tertiary)",
          fontSize: "12px",
          color: "var(--text-secondary)",
          display: "flex",
          gap: "10px",
          alignItems: "flex-start",
        }}
      >
        <Info size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
        <span>
          Estimates use your <strong>current</strong> share counts. Short positions are excluded. <strong>Current</strong> (blue) means ex-dividend is today, or ex already passed but payment is still upcoming or unknown; <strong>Past</strong> (green) means the API reports a payment date before today, or the ex-date was over 90 days ago with no pay date. Verify cash and dates with your broker.
        </span>
      </div>

      {lastRefresh && (
        <p style={{ marginTop: "12px", fontSize: "12px", color: "var(--text-secondary)" }}>
          Last updated: {format(lastRefresh, "PPpp")}
        </p>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
