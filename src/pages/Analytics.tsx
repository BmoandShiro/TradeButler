import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, Brush } from "recharts";
import { TrendingUp, TrendingDown, Settings } from "lucide-react";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { formatWithCommas } from "../utils/formatCompactNumber";
import { sampleTimeSeries, CHART_MAX_POINTS, xAxisInterval, BRUSH_MIN_POINTS } from "../utils/chartDataSampling";
import { loadSandboxState } from "../utils/sandboxStore";
import {
  EXAMPLE_SYMBOL_PNL,
  EXAMPLE_EQUITY_CURVE,
} from "../exampleData";

interface Trade {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
  order_type: string;
  status: string;
  fees: number | null;
  notes: string | null;
}

interface SymbolPnL {
  symbol: string;
  closed_positions: number;
  open_position_qty: number;
  total_gross_pnl: number;
  total_net_pnl: number;
  total_fees: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
}

interface EquityPoint {
  date: string;
  cumulative_pnl: number;
  daily_pnl: number;
  peak_equity: number;
  drawdown: number;
  drawdown_pct: number;
  is_winning_streak: boolean;
  is_losing_streak: boolean;
  is_max_drawdown: boolean;
  is_best_surge: boolean;
}

interface DrawdownMetrics {
  max_drawdown: number;
  max_drawdown_pct: number;
  max_drawdown_start: string | null;
  max_drawdown_end: string | null;
  avg_drawdown: number;
  longest_drawdown_days: number;
  longest_drawdown_start: string | null;
  longest_drawdown_end: string | null;
}

interface EquityCurveData {
  equity_points: EquityPoint[];
  drawdown_metrics: DrawdownMetrics;
  best_surge_start: string | null;
  best_surge_end: string | null;
  best_surge_value: number;
}

interface JournalEntry {
  id: number;
  date: string;
  title: string;
  strategy_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  linked_trade_ids?: string | null;
}

interface JournalTrade {
  id: number;
  journal_entry_id: number;
  symbol: string | null;
  position: string | null;
  timeframe: string | null;
  entry_type: string | null;
  exit_type: string | null;
  trade: string | null;
  what_went_well: string | null;
  what_could_be_improved: string | null;
  emotional_state: string | null;
  notes: string | null;
  outcome: string | null;
  trade_order: number;
  created_at: string | null;
  updated_at: string | null;
}

export default function Analytics() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [symbolPnL, setSymbolPnL] = useState<SymbolPnL[]>([]);
  const [equityCurve, setEquityCurve] = useState<EquityCurveData | null>(null);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalTrades, setJournalTrades] = useState<JournalTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const saved = localStorage.getItem("tradebutler_analytics_timeframe");
    return (saved as Timeframe) || "all";
  });
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_analytics_custom_start") || "";
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_analytics_custom_end") || "";
  });
  const [scaleEvenly, setScaleEvenly] = useState<boolean>(() => {
    const saved = localStorage.getItem("tradebutler_equity_curve_scale_evenly");
    return saved === "true";
  });
  const [showMaxDrawdown, setShowMaxDrawdown] = useState<boolean>(() => {
    const saved = localStorage.getItem("tradebutler_equity_curve_show_max_drawdown");
    return saved !== "false"; // Default to true
  });
  const [showEquitySettings, setShowEquitySettings] = useState(false);
  const [equityBrushStart, setEquityBrushStart] = useState(0);
  const [equityBrushEnd, setEquityBrushEnd] = useState(0);
  const [symbolChartBrushStart, setSymbolChartBrushStart] = useState(0);
  const [symbolChartBrushEnd, setSymbolChartBrushEnd] = useState(0);
  const [sideChartBrushStart, setSideChartBrushStart] = useState(0);
  const [sideChartBrushEnd, setSideChartBrushEnd] = useState(0);
  const [entriesChartBrushStart, setEntriesChartBrushStart] = useState(0);
  const [entriesChartBrushEnd, setEntriesChartBrushEnd] = useState(0);
  const [positionsChartBrushStart, setPositionsChartBrushStart] = useState(0);
  const [positionsChartBrushEnd, setPositionsChartBrushEnd] = useState(0);
  const [outcomeChartBrushStart, setOutcomeChartBrushStart] = useState(0);
  const [outcomeChartBrushEnd, setOutcomeChartBrushEnd] = useState(0);
  const equitySettingsRef = useRef<HTMLDivElement>(null);
  const equitySettingsButtonRef = useRef<HTMLButtonElement>(null);
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());


  useEffect(() => {
    loadData();
  }, [timeframe, customStartDate, customEndDate, dataMode]);

  useEffect(() => {
    setEquityBrushEnd(0);
    setSymbolChartBrushEnd(0);
    setSideChartBrushEnd(0);
    setEntriesChartBrushEnd(0);
    setPositionsChartBrushEnd(0);
    setOutcomeChartBrushEnd(0);
  }, [timeframe, customStartDate, customEndDate]);

  useEffect(() => {
    const unsubscribe = subscribeToDataMode((mode) => {
      setDataMode(mode);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Close settings menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        equitySettingsRef.current &&
        !equitySettingsRef.current.contains(target) &&
        equitySettingsButtonRef.current &&
        !equitySettingsButtonRef.current.contains(target)
      ) {
        setShowEquitySettings(false);
      }
    };

    if (showEquitySettings) {
      setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showEquitySettings]);

  useEffect(() => {
    localStorage.setItem("tradebutler_equity_curve_scale_evenly", scaleEvenly.toString());
  }, [scaleEvenly]);

  useEffect(() => {
    localStorage.setItem("tradebutler_equity_curve_show_max_drawdown", showMaxDrawdown.toString());
  }, [showMaxDrawdown]);

  useEffect(() => {
    localStorage.setItem("tradebutler_analytics_timeframe", timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (customStartDate) {
      localStorage.setItem("tradebutler_analytics_custom_start", customStartDate);
    } else {
      localStorage.removeItem("tradebutler_analytics_custom_start");
    }
    if (customEndDate) {
      localStorage.setItem("tradebutler_analytics_custom_end", customEndDate);
    } else {
      localStorage.removeItem("tradebutler_analytics_custom_end");
    }
  }, [customStartDate, customEndDate]);

  const loadData = async () => {
    try {
      if (dataMode === "sandbox") {
        const state = loadSandboxState();
        setTrades(state.trades as unknown as Trade[]);
        setSymbolPnL(EXAMPLE_SYMBOL_PNL as unknown as SymbolPnL[]);
        setEquityCurve(EXAMPLE_EQUITY_CURVE as unknown as EquityCurveData);
        setJournalEntries(state.journalEntries as unknown as JournalEntry[]);
        setJournalTrades(state.journalTrades as unknown as JournalTrade[]);
        return;
      }

      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
      const startDate = dateRange.start ? dateRange.start.toISOString() : null;
      const endDate = dateRange.end ? dateRange.end.toISOString() : null;
      
      const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
      const [tradesData, pnlData, equityData, journalEntriesData, journalTradesData] = await Promise.all([
        invoke<Trade[]>("get_trades", paperArgs),
        invoke<SymbolPnL[]>("get_symbol_pnl", { pairingMethod, startDate, endDate, ...paperArgs }),
        invoke<EquityCurveData>("get_equity_curve", { pairingMethod, startDate, endDate, ...paperArgs }),
        invoke<JournalEntry[]>("get_journal_entries", paperArgs),
        invoke<JournalTrade[]>("get_all_journal_trades"),
      ]);
      setTrades(tradesData);
      setSymbolPnL(pnlData);
      setEquityCurve(equityData);
      setJournalEntries(journalEntriesData);
      setJournalTrades(journalTradesData);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Extract underlying symbol from options contract
  // Examples: SPY251218C00679000 -> SPY, ABR251121P00011000 -> ABR
  // For regular stocks, returns the symbol as-is
  const getUnderlyingSymbol = (symbol: string): string => {
    if (!symbol) {
      return symbol;
    }
    
    // Find the first digit in the symbol - everything before it is the base symbol
    const firstDigitIndex = symbol.search(/\d/);
    
    if (firstDigitIndex > 0) {
      // Found a digit, extract everything before it as the base symbol
      return symbol.substring(0, firstDigitIndex);
    }
    
    // No digits found - it's already a base symbol (e.g., "SPY", "ABR")
    return symbol;
  };

  // Fill in missing dates for even scaling
  const fillMissingDates = (points: EquityPoint[]): EquityPoint[] => {
    if (points.length === 0) return points;

    const result: EquityPoint[] = [];
    const dateMap = new Map<string, EquityPoint>();
    
    // Create a map of existing points
    points.forEach(point => {
      dateMap.set(point.date, point);
    });

    // Get date range from timeframe, not just from data points
    const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
    let startDate: Date;
    let endDate: Date;
    
    if (dateRange.start && dateRange.end) {
      // Use the timeframe's date range
      startDate = new Date(dateRange.start);
      endDate = new Date(dateRange.end);
      // Ensure we're working with dates, not times
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Fallback to data range if no timeframe specified (e.g., "All Time")
      const dates = points.map(p => p.date).sort();
      if (dates.length > 0) {
        startDate = new Date(dates[0]);
        endDate = new Date(dates[dates.length - 1]);
      } else {
        return points; // No dates to work with
      }
    }

    // Find the first data point to initialize values
    const sortedPoints = [...points].sort((a, b) => a.date.localeCompare(b.date));
    const firstPoint = sortedPoints[0];
    const firstTradeDate = firstPoint?.date || "";
    
    // Initialize with zeros (for dates before first trade) or first point's values
    let lastCumulativePnl = 0;
    let lastPeakEquity = 0;
    let lastDrawdown = 0;
    let lastDrawdownPct = 0;
    let lastIsWinningStreak = false;
    let lastIsLosingStreak = false;
    let lastIsMaxDrawdown = false;
    let lastIsBestSurge = false;

    // Fill in all dates in the range
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      
      if (dateMap.has(dateStr)) {
        // Use existing point
        const point = dateMap.get(dateStr)!;
        result.push(point);
        lastCumulativePnl = point.cumulative_pnl;
        lastPeakEquity = point.peak_equity;
        lastDrawdown = point.drawdown;
        lastDrawdownPct = point.drawdown_pct;
        lastIsWinningStreak = point.is_winning_streak;
        lastIsLosingStreak = point.is_losing_streak;
        lastIsMaxDrawdown = point.is_max_drawdown;
        lastIsBestSurge = point.is_best_surge;
      } else {
        // Fill in missing date
        // For dates before the first trade, use zeros
        // For dates after the first trade, use previous day's values
        if (dateStr < firstTradeDate) {
          // Before any trades - use zeros
          result.push({
            date: dateStr,
            cumulative_pnl: 0,
            daily_pnl: 0,
            peak_equity: 0,
            drawdown: 0,
            drawdown_pct: 0,
            is_winning_streak: false,
            is_losing_streak: false,
            is_max_drawdown: false,
            is_best_surge: false,
          });
        } else if (result.length > 0 || firstTradeDate) {
          // After first trade - use previous day's values (flat line)
          result.push({
            date: dateStr,
            cumulative_pnl: lastCumulativePnl,
            daily_pnl: 0,
            peak_equity: lastPeakEquity,
            drawdown: lastDrawdown,
            drawdown_pct: lastDrawdownPct,
            is_winning_streak: lastIsWinningStreak,
            is_losing_streak: lastIsLosingStreak,
            is_max_drawdown: lastIsMaxDrawdown,
            is_best_surge: lastIsBestSurge,
          });
        }
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  };

  // Compute drawdown metrics and best surge from a slice of equity points (for visible/filtered range)
  const computeDrawdownFromPoints = (points: { date: string; cumulative_pnl: number }[]): { metrics: DrawdownMetrics; best_surge_start: string | null; best_surge_end: string | null; best_surge_value: number } => {
    if (points.length === 0) {
      return {
        metrics: { max_drawdown: 0, max_drawdown_pct: 0, max_drawdown_start: null, max_drawdown_end: null, avg_drawdown: 0, longest_drawdown_days: 0, longest_drawdown_start: null, longest_drawdown_end: null },
        best_surge_start: null,
        best_surge_end: null,
        best_surge_value: 0,
      };
    }
    let peak = points[0].cumulative_pnl;
    let peakDate = points[0].date; // date of the high-water mark (peak before drawdown)
    let maxDd = 0;
    let maxDdStart: string | null = null;
    let maxDdEnd: string | null = null;
    let drawdownSum = 0;
    let drawdownCount = 0;
    let currentDrawdownDays = 0;
    let longestDays = 0;
    let longestStart: string | null = null;
    let longestEnd: string | null = null;
    let surgeStartDate: string | null = points[0].date;
    let surgeStartEquity = points[0].cumulative_pnl;
    let bestSurgeValue = 0;
    let bestSurgeStart: string | null = null;
    let bestSurgeEnd: string | null = null;
    let inDrawdown = false;
    let drawdownStartDate: string | null = null;

    for (let i = 0; i < points.length; i++) {
      const { date, cumulative_pnl } = points[i];
      if (cumulative_pnl > peak) {
        peak = cumulative_pnl;
        peakDate = date;
        surgeStartDate = date;
        surgeStartEquity = cumulative_pnl;
      }
      const drawdown = peak - cumulative_pnl;

      if (drawdown > maxDd) {
        maxDd = drawdown;
        maxDdStart = peakDate; // start at the high-water mark (peak)
        maxDdEnd = date;       // end at the trough
      }
      if (drawdown > 0) {
        drawdownSum += drawdown;
        drawdownCount++;
        if (!inDrawdown) {
          inDrawdown = true;
          drawdownStartDate = date;
          currentDrawdownDays = 1;
        } else {
          currentDrawdownDays++;
        }
      } else {
        if (inDrawdown && currentDrawdownDays > longestDays) {
          longestDays = currentDrawdownDays;
          longestStart = drawdownStartDate;
          longestEnd = date;
        }
        inDrawdown = false;
        currentDrawdownDays = 0;
        drawdownStartDate = null;
      }
      if (surgeStartDate && cumulative_pnl > surgeStartEquity) {
        const surgeValue = cumulative_pnl - surgeStartEquity;
        if (surgeValue > bestSurgeValue) {
          bestSurgeValue = surgeValue;
          bestSurgeStart = surgeStartDate;
          bestSurgeEnd = date;
        }
      }
    }
    if (inDrawdown && currentDrawdownDays > longestDays) {
      longestDays = currentDrawdownDays;
      longestStart = drawdownStartDate;
      longestEnd = points[points.length - 1]?.date ?? null;
    }
    const avgDrawdown = drawdownCount > 0 ? drawdownSum / drawdownCount : 0;
    const maxDdPct = peak > 0 ? (maxDd / peak) * 100 : 0;
    return {
      metrics: {
        max_drawdown: maxDd,
        max_drawdown_pct: maxDdPct,
        max_drawdown_start: maxDdStart,
        max_drawdown_end: maxDdEnd,
        avg_drawdown: avgDrawdown,
        longest_drawdown_days: longestDays,
        longest_drawdown_start: longestStart,
        longest_drawdown_end: longestEnd,
      },
      best_surge_start: bestSurgeStart,
      best_surge_end: bestSurgeEnd,
      best_surge_value: bestSurgeValue,
    };
  };

  // Visible drawdown/surge: from brushed or full chart range (updates with timeframe + brush)
  const visibleDrawdown = useMemo(() => {
    if (!equityCurve || !Array.isArray(equityCurve.equity_points) || equityCurve.equity_points.length === 0) return null;
    const raw = fillMissingDates(equityCurve.equity_points);
    const chartData = raw.length <= 400 ? raw : sampleTimeSeries(raw, CHART_MAX_POINTS);
    const useBrush = chartData.length > 24 && equityBrushEnd > 0;
    const start = useBrush ? Math.min(equityBrushStart, chartData.length - 1) : 0;
    const end = useBrush ? Math.min(chartData.length - 1, Math.max(start, equityBrushEnd)) : chartData.length - 1;
    const slice = chartData.slice(start, end + 1).map((p) => ({ date: p.date, cumulative_pnl: p.cumulative_pnl }));
    return computeDrawdownFromPoints(slice);
  }, [equityCurve, equityBrushStart, equityBrushEnd, timeframe, customStartDate, customEndDate]);

  // Process trades for charts
  const processChartData = () => {
    const symbolCounts: Record<string, number> = {};
    const sideCounts: Record<string, number> = { BUY: 0, SELL: 0 };

    trades.forEach((trade) => {
      // Extract underlying symbol for aggregation
      const underlyingSymbol = getUnderlyingSymbol(trade.symbol);
      symbolCounts[underlyingSymbol] = (symbolCounts[underlyingSymbol] || 0) + 1;
      if (trade.side === "BUY" || trade.side === "SELL") {
        sideCounts[trade.side]++;
      }
    });

    const symbolData = Object.entries(symbolCounts)
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { symbolData, sideData: [{ name: "BUY", value: sideCounts.BUY }, { name: "SELL", value: sideCounts.SELL }] };
  };

  const processJournalData = () => {
    if (journalEntries.length === 0 && journalTrades.length === 0) {
      return {
        entriesByMonth: [] as { month: string; count: number }[],
        positionsData: [] as { position: string; count: number }[],
        outcomeData: [] as { outcome: string; count: number }[],
      };
    }

    const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
    const start = dateRange.start;
    const end = dateRange.end;

    const entriesInRange = journalEntries.filter((entry) => {
      if (!entry.date) return false;
      const d = new Date(entry.date + "T00:00:00");
      if (isNaN(d.getTime())) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });

    const entryIdsInRange = new Set(entriesInRange.map((e) => e.id));

    const tradesInRange = journalTrades.filter((t) => entryIdsInRange.has(t.journal_entry_id));

    const entriesByMonthMap = new Map<string, number>();
    entriesInRange.forEach((entry) => {
      const d = new Date(entry.date + "T00:00:00");
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      entriesByMonthMap.set(key, (entriesByMonthMap.get(key) || 0) + 1);
    });

    const entriesByMonth = Array.from(entriesByMonthMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const positionsMap = new Map<string, number>();
    tradesInRange.forEach((t) => {
      const pos = (t.position || "Unspecified").trim();
      positionsMap.set(pos, (positionsMap.get(pos) || 0) + 1);
    });
    const positionsData = Array.from(positionsMap.entries())
      .map(([position, count]) => ({ position, count }))
      .sort((a, b) => b.count - a.count);

    const outcomeMap = new Map<string, number>();
    tradesInRange.forEach((t) => {
      const outcome = (t.outcome || "Unspecified").trim();
      outcomeMap.set(outcome, (outcomeMap.get(outcome) || 0) + 1);
    });
    const outcomeData = Array.from(outcomeMap.entries())
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count);

    return { entriesByMonth, positionsData, outcomeData };
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading analytics...</p>
      </div>
    );
  }

  const { symbolData, sideData } = processChartData();
  const { entriesByMonth, positionsData, outcomeData } = processJournalData();

  return (
    <div style={{ padding: "30px" }}>
      <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "20px" }}>
        Analytics
      </h1>
      {dataMode === "sandbox" && (
        <p style={{ margin: "0 0 16px 0", padding: "12px 16px", fontSize: "14px", fontWeight: "600", color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "2px solid var(--accent)", borderRadius: "8px" }}>
          Demo mode — you are viewing demo data only.
        </p>
      )}
      {dataMode === "paper" && (
        <p style={{ margin: "0 0 16px 0", padding: "12px 16px", fontSize: "14px", fontWeight: "600", color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "2px solid var(--accent)", borderRadius: "8px" }}>
          Paper mode — you are viewing paper trades only.
        </p>
      )}
      <div style={{ marginBottom: "30px" }}>
        <TimeframeSelector
          value={timeframe}
          onChange={(value) => {
            setTimeframe(value);
            localStorage.setItem("tradebutler_analytics_timeframe", value);
          }}
          customStartDate={customStartDate}
          customEndDate={customEndDate}
          onCustomDatesChange={(start, end) => {
            setCustomStartDate(start || "");
            setCustomEndDate(end || "");
            if (start) {
              localStorage.setItem("tradebutler_analytics_custom_start", start);
            } else {
              localStorage.removeItem("tradebutler_analytics_custom_start");
            }
            if (end) {
              localStorage.setItem("tradebutler_analytics_custom_end", end);
            } else {
              localStorage.removeItem("tradebutler_analytics_custom_end");
            }
          }}
        />
      </div>

      {trades.length === 0 ? (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "40px",
            textAlign: "center",
          }}
        >
          <p style={{ color: "var(--text-secondary)" }}>
            No data available. Import trades to see analytics.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
          {/* Equity Curve + Drawdown Analysis */}
          {equityCurve && equityCurve.equity_points.length > 0 && (
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "20px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                <h2 style={{ fontSize: "20px", fontWeight: "600" }}>
                  Equity Curve & Drawdown Analysis
                </h2>
                <div style={{ position: "relative" }}>
                  <button
                    ref={equitySettingsButtonRef}
                    onClick={() => setShowEquitySettings(!showEquitySettings)}
                    style={{
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      padding: "6px",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title="Settings"
                  >
                    <Settings size={16} />
                  </button>
                  {showEquitySettings && equitySettingsButtonRef.current && (() => {
                    const rect = equitySettingsButtonRef.current.getBoundingClientRect();
                    return createPortal(
                      <div
                        ref={equitySettingsRef}
                        data-settings-menu
                        style={{
                          position: "fixed",
                          top: rect.bottom + 8,
                          right: window.innerWidth - rect.right,
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "12px",
                          minWidth: "200px",
                          zIndex: 1000,
                          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                        }}
                      >
                      <div style={{ marginBottom: "12px", fontSize: "14px", fontWeight: "600" }}>
                        Chart Settings
                      </div>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          cursor: "pointer",
                          fontSize: "14px",
                          marginBottom: "12px",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={scaleEvenly}
                          onChange={(e) => setScaleEvenly(e.target.checked)}
                          style={{ cursor: "pointer" }}
                        />
                        <span>Scale evenly (no gaps)</span>
                      </label>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          cursor: "pointer",
                          fontSize: "14px",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={showMaxDrawdown}
                          onChange={(e) => setShowMaxDrawdown(e.target.checked)}
                          style={{ cursor: "pointer" }}
                        />
                        <span>Show max drawdown highlight</span>
                      </label>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "8px" }}>
                        Fill in missing dates to show continuous time scale
                      </div>
                      </div>,
                      document.body
                    );
                  })()}
                </div>
              </div>
              
              {/* Drawdown Metrics (reflect timeframe + brush/scroll) */}
              {(() => {
                const dd = visibleDrawdown ?? { metrics: equityCurve.drawdown_metrics, best_surge_start: equityCurve.best_surge_start, best_surge_end: equityCurve.best_surge_end, best_surge_value: equityCurve.best_surge_value };
                const m = dd.metrics;
                return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Max Drawdown</div>
                  <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--loss)" }}>
                    ${formatWithCommas(m.max_drawdown, { decimals: 2 })}
                  </div>
                  <div style={{ fontSize: "14px", color: "var(--loss)" }}>
                    {formatWithCommas(m.max_drawdown_pct, { decimals: 2 })}%
                  </div>
                </div>
                <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Avg Drawdown</div>
                  <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>
                    ${formatWithCommas(m.avg_drawdown, { decimals: 2 })}
                  </div>
                </div>
                <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Longest Drawdown</div>
                  <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {m.longest_drawdown_days} days
                  </div>
                  {m.longest_drawdown_start && (
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
                      {m.longest_drawdown_start} - {m.longest_drawdown_end || "Ongoing"}
                    </div>
                  )}
                </div>
                {dd.best_surge_start && dd.best_surge_value > 0 && (
                  <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Best Surge</div>
                    <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--profit)" }}>
                      ${formatWithCommas(dd.best_surge_value, { decimals: 2 })}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
                      {dd.best_surge_start} - {dd.best_surge_end || "Ongoing"}
                    </div>
                  </div>
                )}
              </div>
                );
              })()}
              
              {/* Equity Curve Chart */}
              {(() => {
                // Always fill to one point per calendar day so the curve changes daily (flat on no-trade days, move on trade days)
                const rawEquityData = fillMissingDates(equityCurve.equity_points);
                // Keep daily granularity when feasible (e.g. up to ~1 year); otherwise sample for performance
                const equityChartData = rawEquityData.length <= 400
                  ? rawEquityData
                  : sampleTimeSeries(rawEquityData, CHART_MAX_POINTS);
                const equityUseBrush = equityChartData.length > 24;
                const equityBrushStartClamped =
                  equityUseBrush && equityBrushEnd > 0
                    ? Math.min(equityBrushStart, equityChartData.length - 1)
                    : 0;
                const equityBrushEndClamped =
                  equityUseBrush && equityBrushEnd > 0
                    ? Math.min(equityChartData.length - 1, Math.max(equityBrushStartClamped, equityBrushEnd))
                    : Math.max(0, equityChartData.length - 1);
                const equityXInterval = xAxisInterval(Math.max(1, equityBrushEndClamped - equityBrushStartClamped + 1));
                // Use visible (brushed) segment for Y domain so the line isn't flat when viewing a narrow range
                const visibleSlice = equityChartData.slice(equityBrushStartClamped, equityBrushEndClamped + 1);
                const visiblePnls = visibleSlice.map((d: { cumulative_pnl?: number }) => d.cumulative_pnl ?? 0).filter((v: number) => typeof v === "number" && !Number.isNaN(v));
                const minPnl = visiblePnls.length ? Math.min(...visiblePnls) : 0;
                const maxPnl = visiblePnls.length ? Math.max(...visiblePnls) : 0;
                const range = Math.max(maxPnl - minPnl, Math.abs(minPnl) * 0.1, 100);
                const padding = range * 0.08;
                const domainMin = minPnl - padding;
                const domainMax = maxPnl + padding;
                // Snap a date range to chart data so ReferenceArea boundaries align with data points (fixes jagged edges)
                const snapToChartData = (startDate: string, endDate: string): { x1: string; x2: string } | null => {
                  const dates = equityChartData.map((d: { date: string }) => d.date);
                  const firstIdx = dates.findIndex((d) => d >= startDate);
                  const lastIdx = dates.reduce((acc, d, i) => (d <= endDate ? i : acc), -1);
                  if (firstIdx < 0 || lastIdx < 0 || firstIdx > lastIdx) return null;
                  return { x1: dates[firstIdx], x2: dates[lastIdx] };
                };
                const m = visibleDrawdown ? visibleDrawdown.metrics : equityCurve.drawdown_metrics;
                const surge = visibleDrawdown ? { start: visibleDrawdown.best_surge_start, end: visibleDrawdown.best_surge_end } : { start: equityCurve.best_surge_start, end: equityCurve.best_surge_end };
                const maxDdRange = m.max_drawdown_start && m.max_drawdown_end ? snapToChartData(m.max_drawdown_start, m.max_drawdown_end) : null;
                const surgeRange = surge.start && surge.end ? snapToChartData(surge.start, surge.end) : null;
                const longestDdRange = m.longest_drawdown_start && m.longest_drawdown_end ? snapToChartData(m.longest_drawdown_start, m.longest_drawdown_end) : null;
                return (
              <ResponsiveContainer width="100%" height={equityUseBrush ? 440 : 400}>
                <LineChart data={equityChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis
                    dataKey="date"
                    interval={equityXInterval}
                    stroke="var(--text-secondary)"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis
                    domain={[domainMin, domainMax]}
                    stroke="var(--text-secondary)"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    tickFormatter={(value) => `$${formatWithCommas(value, { decimals: 0 })}`}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.02)" }}
                    contentStyle={{
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-primary)",
                    }}
                    formatter={(value: any) => [`$${formatWithCommas(Number(value), { decimals: 2 })}`, "Cumulative P&L"]}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  
                  {/* Longest drawdown zone (aligns to chart data for clean edges) */}
                  {longestDdRange && (
                    <ReferenceArea
                      x1={longestDdRange.x1}
                      x2={longestDdRange.x2}
                      stroke="rgba(245, 158, 11, 0.5)"
                      strokeWidth={1}
                      fill="rgba(245, 158, 11, 0.12)"
                      label="Longest Drawdown"
                      isAnimationActive={false}
                    />
                  )}
                  
                  {/* Highlight max drawdown zone (snapped to chart data for clean left/right edges) */}
                  {showMaxDrawdown && maxDdRange && (
                    <ReferenceArea
                      x1={maxDdRange.x1}
                      x2={maxDdRange.x2}
                      stroke="rgba(239, 68, 68, 0.5)"
                      strokeWidth={1}
                      fill="rgba(239, 68, 68, 0.1)"
                      label="Max Drawdown"
                      isAnimationActive={false}
                    />
                  )}
                  
                  {/* Highlight best surge zone (snapped to chart data) */}
                  {surgeRange && (
                    <ReferenceArea
                      x1={surgeRange.x1}
                      x2={surgeRange.x2}
                      stroke="rgba(34, 197, 94, 0.5)"
                      strokeWidth={1}
                      fill="rgba(34, 197, 94, 0.1)"
                      label="Best Surge"
                      isAnimationActive={false}
                    />
                  )}
                  
                  {/* Single Cumulative P&L Line */}
                  <Line
                    type="monotone"
                    dataKey="cumulative_pnl"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    strokeOpacity={0.9}
                    dot={false}
                    activeDot={{ r: 6, fill: "var(--accent)", stroke: "var(--bg-secondary)", strokeWidth: 2 }}
                    name="Cumulative P&L"
                  />
                  {equityUseBrush && (
                    <Brush
                      data={equityChartData}
                      dataKey="date"
                      height={36}
                      stroke="var(--border-color)"
                      fill="var(--bg-tertiary)"
                      startIndex={equityBrushStartClamped}
                      endIndex={equityBrushEndClamped}
                      onDragEnd={(range: { startIndex?: number; endIndex?: number }) => {
                        if (range.startIndex != null && range.endIndex != null) {
                          setEquityBrushStart(range.startIndex);
                          setEquityBrushEnd(range.endIndex);
                        }
                      }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
                );
              })()}
            </div>
          )}

          {/* Symbol P&L Table */}
          {symbolPnL.length > 0 && (
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "20px",
              }}
            >
              <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "20px" }}>
                Profit & Loss by Symbol
              </h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                        Symbol
                      </th>
                      <th style={{ padding: "12px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                        Closed Positions
                      </th>
                      <th style={{ padding: "12px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                        Open Qty
                      </th>
                      <th style={{ padding: "12px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                        Win Rate
                      </th>
                      <th style={{ padding: "12px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                        Gross P&L
                      </th>
                      <th style={{ padding: "12px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                        Fees
                      </th>
                      <th style={{ padding: "12px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                        Net P&L
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {symbolPnL.map((pnl) => (
                      <tr
                        key={pnl.symbol}
                        style={{
                          borderBottom: "1px solid var(--border-color)",
                        }}
                      >
                        <td style={{ padding: "12px", fontWeight: "600" }}>{pnl.symbol}</td>
                        <td style={{ padding: "12px", textAlign: "right" }}>{pnl.closed_positions}</td>
                        <td style={{ padding: "12px", textAlign: "right", color: pnl.open_position_qty > 0 ? "var(--accent)" : "var(--text-secondary)" }}>
                          {pnl.open_position_qty > 0 ? formatWithCommas(pnl.open_position_qty, { minDecimals: 4, maxDecimals: 4 }) : "—"}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          {pnl.closed_positions > 0 ? (
                            <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
                              {formatWithCommas(pnl.win_rate * 100, { decimals: 1 })}%
                              {pnl.win_rate >= 0.5 ? (
                                <TrendingUp size={14} color="var(--profit)" />
                              ) : (
                                <TrendingDown size={14} color="var(--loss)" />
                              )}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          style={{
                            padding: "12px",
                            textAlign: "right",
                            fontWeight: "600",
                            color: pnl.total_gross_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                          }}
                        >
                          ${formatWithCommas(pnl.total_gross_pnl, { decimals: 2 })}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "var(--text-secondary)" }}>
                          ${formatWithCommas(pnl.total_fees, { decimals: 2 })}
                        </td>
                        <td
                          style={{
                            padding: "12px",
                            textAlign: "right",
                            fontWeight: "600",
                            fontSize: "16px",
                            color: pnl.total_net_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                          }}
                        >
                          ${formatWithCommas(pnl.total_net_pnl, { decimals: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px",
            }}
          >
            <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "20px" }}>
              Trades by Symbol
            </h2>
            {(() => {
              const useBrush = symbolData.length > BRUSH_MIN_POINTS;
              const start = useBrush && symbolChartBrushEnd > 0 ? Math.min(symbolChartBrushStart, symbolData.length - 1) : 0;
              const end = useBrush && symbolChartBrushEnd > 0 ? Math.min(symbolData.length - 1, Math.max(start, symbolChartBrushEnd)) : Math.max(0, symbolData.length - 1);
              return (
            <ResponsiveContainer width="100%" height={useBrush ? 340 : 300}>
              <BarChart data={symbolData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="symbol" stroke="var(--text-secondary)" interval={symbolData.length > 20 ? Math.floor(symbolData.length / 10) : 0} />
                <YAxis stroke="var(--text-secondary)" />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.02)" }}
                  contentStyle={{
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                />
                <Bar dataKey="count" fill="var(--accent)" fillOpacity={0.5} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                {useBrush && (
                  <Brush dataKey="symbol" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" startIndex={start} endIndex={end} onDragEnd={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setSymbolChartBrushStart(r.startIndex); setSymbolChartBrushEnd(r.endIndex); } }} />
                )}
              </BarChart>
            </ResponsiveContainer>
              );
            })()}
          </div>

          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px",
            }}
          >
            <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "20px" }}>
              Buy vs Sell
            </h2>
            {(() => {
              const useBrush = sideData.length > BRUSH_MIN_POINTS;
              const start = useBrush && sideChartBrushEnd > 0 ? Math.min(sideChartBrushStart, sideData.length - 1) : 0;
              const end = useBrush && sideChartBrushEnd > 0 ? Math.min(sideData.length - 1, Math.max(start, sideChartBrushEnd)) : Math.max(0, sideData.length - 1);
              return (
            <ResponsiveContainer width="100%" height={useBrush ? 340 : 300}>
              <BarChart data={sideData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" />
                <YAxis stroke="var(--text-secondary)" />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.02)" }}
                  contentStyle={{
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                />
                <Bar dataKey="value" fill="var(--accent)" fillOpacity={0.5} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                {useBrush && (
                  <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" startIndex={start} endIndex={end} onDragEnd={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setSideChartBrushStart(r.startIndex); setSideChartBrushEnd(r.endIndex); } }} />
                )}
              </BarChart>
            </ResponsiveContainer>
              );
            })()}
          </div>

          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px",
            }}
          >
            <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "16px" }}>
              Journal findings
            </h2>
            {journalEntries.length === 0 ? (
              <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                No journal entries found. Create journal entries to see journaling trends alongside your trading analytics.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "24px" }}>
                <div>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
                    Entries over time
                  </h3>
                  {entriesByMonth.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No entries in the selected timeframe.
                    </p>
                  ) : (
                    (() => {
                      const useBrush = entriesByMonth.length > BRUSH_MIN_POINTS;
                      const start = useBrush && entriesChartBrushEnd > 0 ? Math.min(entriesChartBrushStart, entriesByMonth.length - 1) : 0;
                      const end = useBrush && entriesChartBrushEnd > 0 ? Math.min(entriesByMonth.length - 1, Math.max(start, entriesChartBrushEnd)) : Math.max(0, entriesByMonth.length - 1);
                      return (
                    <ResponsiveContainer width="100%" height={useBrush ? 300 : 260}>
                      <BarChart data={entriesByMonth}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="month" stroke="var(--text-secondary)" />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.02)" }}
                          contentStyle={{
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            color: "var(--text-primary)",
                          }}
                          formatter={(value: any) => [value, "Entries"]}
                        />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={0.5} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                        {useBrush && (
                          <Brush dataKey="month" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" startIndex={start} endIndex={end} onDragEnd={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setEntriesChartBrushStart(r.startIndex); setEntriesChartBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                      );
                    })()
                  )}
                </div>

                <div>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
                    Trade types in journals
                  </h3>
                  {positionsData.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No implementation trades recorded in your journals for this timeframe.
                    </p>
                  ) : (
                    (() => {
                      const useBrush = positionsData.length > BRUSH_MIN_POINTS;
                      const start = useBrush && positionsChartBrushEnd > 0 ? Math.min(positionsChartBrushStart, positionsData.length - 1) : 0;
                      const end = useBrush && positionsChartBrushEnd > 0 ? Math.min(positionsData.length - 1, Math.max(start, positionsChartBrushEnd)) : Math.max(0, positionsData.length - 1);
                      return (
                    <ResponsiveContainer width="100%" height={useBrush ? 300 : 260}>
                      <BarChart data={positionsData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="position" stroke="var(--text-secondary)" />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.02)" }}
                          contentStyle={{
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            color: "var(--text-primary)",
                          }}
                          formatter={(value: any) => [value, "Trades"]}
                        />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={0.5} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                        {useBrush && (
                          <Brush dataKey="position" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" startIndex={start} endIndex={end} onDragEnd={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setPositionsChartBrushStart(r.startIndex); setPositionsChartBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                      );
                    })()
                  )}
                </div>

                <div>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
                    Outcomes in journals
                  </h3>
                  {outcomeData.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No outcomes recorded in your journals for this timeframe.
                    </p>
                  ) : (
                    (() => {
                      const useBrush = outcomeData.length > BRUSH_MIN_POINTS;
                      const start = useBrush && outcomeChartBrushEnd > 0 ? Math.min(outcomeChartBrushStart, outcomeData.length - 1) : 0;
                      const end = useBrush && outcomeChartBrushEnd > 0 ? Math.min(outcomeData.length - 1, Math.max(start, outcomeChartBrushEnd)) : Math.max(0, outcomeData.length - 1);
                      return (
                    <ResponsiveContainer width="100%" height={useBrush ? 300 : 260}>
                      <BarChart data={outcomeData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="outcome" stroke="var(--text-secondary)" />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.02)" }}
                          contentStyle={{
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            color: "var(--text-primary)",
                          }}
                          formatter={(value: any) => [value, "Trades"]}
                        />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={0.5} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                        {useBrush && (
                          <Brush dataKey="outcome" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" startIndex={start} endIndex={end} onDragEnd={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setOutcomeChartBrushStart(r.startIndex); setOutcomeChartBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                      );
                    })()
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

