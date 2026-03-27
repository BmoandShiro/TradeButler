import { useState, useEffect, useMemo } from "react";
import { format, startOfDay, subMonths, addMonths } from "date-fns";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DividendTrackerRow } from "../utils/dividendTrackerData";
import { formatDividendMoney } from "../utils/dividendTrackerData";
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

export type DividendTrackerChartsPanelProps = {
  rows: DividendTrackerRow[];
  /** Tighter layout and shorter chart heights for the dashboard widget. */
  compact?: boolean;
};

export function DividendTrackerChartsPanel({ rows, compact = false }: DividendTrackerChartsPanelProps) {
  const [chartRange, setChartRange] = useState(() => readDividendChartRange());
  const [chartDisplayMode, setChartDisplayMode] = useState<DividendChartDisplayMode>(() => readDividendChartDisplayMode());

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

  const chartH = compact ? 220 : 320;
  const titleFs = compact ? "14px" : "18px";
  const subFs = compact ? "11px" : "12px";

  const chartRangeInvalid = useMemo(() => {
    const start = parseRangeDate(chartRange.start);
    const end = parseRangeDate(chartRange.end);
    return !start || !end || start > end;
  }, [chartRange.start, chartRange.end]);

  const chartData = useMemo(() => {
    const start = parseRangeDate(chartRange.start);
    const end = parseRangeDate(chartRange.end);
    if (!start || !end) return { monthly: [] as { month: string; label: string; received: number; expected: number }[], bySymbol: [] as { symbol: string; received: number; expected: number }[] };
    const day = startOfDay(new Date());
    return buildDividendChartData(rows, start, end, day);
  }, [rows, chartRange.start, chartRange.end]);

  const chartSymbolBars = useMemo(() => chartData.bySymbol.slice(0, compact ? 16 : 24), [chartData.bySymbol, compact]);

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

  if (rows.length === 0) return null;

  return (
    <section style={{ marginBottom: compact ? "12px" : "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
        <div>
          <h2 style={{ margin: "0 0 4px 0", fontSize: titleFs, fontWeight: "600", color: "var(--text-primary)" }}>Dividend charts</h2>
          <p style={{ margin: 0, fontSize: subFs, color: "var(--text-secondary)", maxWidth: compact ? "100%" : "560px" }}>
            Green = received; blue = expected. Same date range and view as Tools → Dividend Tracker.
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
                padding: compact ? "6px 8px" : "8px 10px",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                backgroundColor: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: compact ? "12px" : "13px",
                fontWeight: "500",
                minWidth: compact ? "min(100%, 200px)" : "220px",
                cursor: "pointer",
                maxWidth: "100%",
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
          <div style={{ marginBottom: compact ? "12px" : "28px", width: "100%", minHeight: chartH }}>
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
            <ResponsiveContainer width="100%" height={chartH}>
              <LineChart data={mainTimelineChart.data} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
                  interval={compact ? "preserveStartEnd" : 0}
                  angle={compact ? -28 : -32}
                  textAnchor="end"
                  height={compact ? 56 : 72}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
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
          </div>
        )}
      {chartDisplayMode !== "hidden" && !chartRangeInvalid && mainTimelineChart?.kind === "monthly" && chartData.monthly.some((m) => m.received > 0 || m.expected > 0) && (
        <div style={{ marginBottom: compact ? "12px" : "28px", width: "100%", minHeight: chartH }}>
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
          <ResponsiveContainer width="100%" height={chartH}>
            <LineChart data={chartData.monthly} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
                interval={compact ? "preserveStartEnd" : 0}
                angle={compact ? -28 : -32}
                textAnchor="end"
                height={compact ? 56 : 72}
              />
              <YAxis tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
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
        </div>
      )}
      {chartDisplayMode !== "hidden" && !chartRangeInvalid && mainTimelineChart?.kind === "periodBars" && mainTimelineChart.data.some((p) => p.received > 0 || p.expected > 0) && (
        <div style={{ marginBottom: compact ? "12px" : "28px", width: "100%", minHeight: chartH }}>
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
          <ResponsiveContainer width="100%" height={chartH}>
            <BarChart data={mainTimelineChart.data} margin={{ top: 8, right: 12, left: 4, bottom: chartDisplayMode === "annual" ? 8 : 48 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "var(--text-secondary)" }}
                interval={0}
                angle={chartDisplayMode === "annual" ? 0 : -28}
                textAnchor="end"
                height={chartDisplayMode === "annual" ? 28 : 56}
              />
              <YAxis tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
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
      {chartDisplayMode !== "hidden" && chartSymbolBars.length > 0 && (
        <div style={{ width: "100%", minHeight: Math.min(compact ? 320 : 520, 28 + chartSymbolBars.length * 28), marginTop: "8px" }}>
          <h3 style={{ margin: "0 0 10px 0", fontSize: compact ? "13px" : "15px", fontWeight: "600", color: "var(--text-primary)" }}>By symbol (top {chartSymbolBars.length})</h3>
          <ResponsiveContainer width="100%" height={Math.min(compact ? 320 : 520, 40 + chartSymbolBars.length * 28)}>
            <BarChart data={chartSymbolBars} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
              <YAxis type="category" dataKey="symbol" width={56} tick={{ fontSize: 10, fill: "var(--text-primary)" }} />
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
            fontSize: compact ? "12px" : "14px",
          }}
        >
          No dividend amounts fall in this date range. Widen the range or check your positions.
        </div>
      )}
    </section>
  );
}
