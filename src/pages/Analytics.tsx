import { useEffect, useState, useRef, useMemo, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, Brush, Cell } from "recharts";
import { Settings, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { formatWithCommas } from "../utils/formatCompactNumber";
import { sampleTimeSeries, CHART_MAX_POINTS, xAxisInterval, BRUSH_SHOW_MIN } from "../utils/chartDataSampling";
import { loadSandboxState, getSandboxStrategyChecklistItemMetrics, getSandboxStrategyChecklistItemMetricsByOutcome, getSandboxEmotionalStates } from "../utils/sandboxStore";
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
  strategy_id?: number | null;
}

interface Strategy {
  id: number;
  name: string;
  description?: string | null;
  notes?: string | null;
  created_at?: string | null;
  color?: string | null;
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
  r_multiple?: number | null;
}

interface StrategyPerformanceRow {
  strategy_id: number | null;
  strategy_name: string;
  trade_count: number;
  winning_trades?: number;
  total_volume: number;
  estimated_pnl: number;
}

interface EmotionalStateRow {
  id?: number;
  timestamp: string;
  emotion: string;
  intensity: number;
  notes?: string | null;
  trade_id?: number | null;
  journal_entry_id?: number | null;
  journal_trade_id?: number | null;
}

interface ChecklistItemMetricRow {
  checklist_item_id: number;
  item_text: string;
  checklist_type: string;
  times_checked: number;
  avg_performance: number | null;
  performance_kind: string;
  description?: string | null;
}

interface ChecklistItemMetricByOutcomeRow {
  checklist_item_id: number;
  item_text: string;
  checklist_type: string;
  times_checked_good: number;
  times_checked_bad: number;
  times_not_checked_bad: number;
  description?: string | null;
}

const STRATEGY_CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 48 };
const BAR_FILL_OPACITY = 0.5;
const STRATEGY_CHART_HEIGHT = 460;
const STRATEGY_XAXIS_HEIGHT = 48;
const TOP_CATEGORIES = 10;
const EXPANDED_CHART_HEIGHT = 560;

/** Split label into lines of roughly maxChars, breaking at spaces. */
function wrapLabel(label: string, maxChars: number = 10): string[] {
  if (!label || label.length <= maxChars) return [label];
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (current.length + (current ? 1 : 0) + w.length <= maxChars) {
      current = current ? current + " " + w : w;
    } else {
      if (current) lines.push(current);
      current = w.length > maxChars ? w.slice(0, maxChars) : w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Custom XAxis tick that renders strategy name in multiple lines (horizontal), offset down so labels don't overlap bars. */
function StrategyChartTick({ x, y, payload }: { x: number; y: number; payload?: { value?: string } }) {
  const label = payload?.value ?? "";
  const lines = wrapLabel(label, 10);
  const fontSize = 11;
  const lineHeight = fontSize + 2;
  const topOffset = 14;
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill="var(--text-secondary)" fontSize={fontSize}>
        {lines.map((line, i) => (
          <tspan key={i} x={0} dy={i === 0 ? topOffset : lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
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
  const [equityBrushDrag, setEquityBrushDrag] = useState<{ which: "left" | "right"; position: number } | { which: "slide"; startPct: number; endPct: number } | null>(null);
  const equitySliderTrackRef = useRef<HTMLDivElement>(null);
  type EquityDragCtx =
    | { which: "left" | "right"; bound: number; n: number; wasFullRange: boolean; position: number; trackRect: DOMRect | null }
    | { which: "slide"; initialStartPct: number; initialEndPct: number; initialClientX: number; trackRect: DOMRect | null; n: number; startPct: number; endPct: number };
  const equitySliderDragRef = useRef<EquityDragCtx | null>(null);

  const handleEquitySliderMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (e.type === "touchmove") e.preventDefault();
    const ctx = equitySliderDragRef.current;
    if (!ctx?.trackRect || ctx.trackRect.width <= 0) return;
    const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : "clientX" in e ? (e as MouseEvent).clientX : 0;
    if (ctx.which === "slide") {
      const deltaPct = (clientX - ctx.initialClientX) / ctx.trackRect.width;
      const deltaMin = -ctx.initialStartPct;
      const deltaMax = 1 - ctx.initialEndPct;
      const delta = Math.max(deltaMin, Math.min(deltaMax, deltaPct));
      const newStart = ctx.initialStartPct + delta;
      const newEnd = ctx.initialEndPct + delta;
      ctx.startPct = newStart;
      ctx.endPct = newEnd;
      setEquityBrushDrag({ which: "slide", startPct: newStart, endPct: newEnd });
    } else {
      const pos = Math.max(0, Math.min(1, (clientX - ctx.trackRect.left) / ctx.trackRect.width));
      const newPos = ctx.which === "left" ? Math.min(pos, ctx.bound) : Math.max(pos, ctx.bound);
      ctx.position = newPos;
      setEquityBrushDrag((prev) => (prev && "position" in prev ? { ...prev, position: newPos } : null));
    }
  }, []);

  const handleEquitySliderUp = useCallback(() => {
    const ctx = equitySliderDragRef.current;
    if (!ctx) return;
    const n = ctx.n;
    if (ctx.which === "slide") {
      const startIdx = Math.max(0, Math.min(n - 1, Math.round(ctx.startPct * (n - 1))));
      const endIdx = Math.max(0, Math.min(n - 1, Math.round(ctx.endPct * (n - 1))));
      const endIdxClamped = Math.max(startIdx, endIdx);
      setEquityBrushStart(startIdx);
      setEquityBrushEnd(endIdxClamped);
    } else {
      const idx = Math.round(ctx.position * (n - 1));
      const clampedIdx = Math.max(0, Math.min(n - 1, idx));
      if (ctx.which === "left") {
        setEquityBrushStart(clampedIdx);
        if (ctx.wasFullRange) setEquityBrushEnd(n - 1);
      } else {
        setEquityBrushEnd(clampedIdx);
        if (ctx.wasFullRange) setEquityBrushStart(0);
      }
    }
    setEquityBrushDrag(null);
    equitySliderDragRef.current = null;
    document.removeEventListener("mousemove", handleEquitySliderMove as EventListener, true);
    document.removeEventListener("mouseup", handleEquitySliderUp, true);
    document.removeEventListener("touchmove", handleEquitySliderMove as EventListener, true);
    document.removeEventListener("touchend", handleEquitySliderUp, true);
  }, [handleEquitySliderMove]);

  const [symbolChartBrushStart, setSymbolChartBrushStart] = useState(0);
  const [symbolChartBrushEnd, setSymbolChartBrushEnd] = useState(0);
  const [entriesChartBrushStart, setEntriesChartBrushStart] = useState(0);
  const [entriesChartBrushEnd, setEntriesChartBrushEnd] = useState(0);
  const [positionsChartBrushStart, setPositionsChartBrushStart] = useState(0);
  const [positionsChartBrushEnd, setPositionsChartBrushEnd] = useState(0);
  const [outcomeChartBrushStart, setOutcomeChartBrushStart] = useState(0);
  const [outcomeChartBrushEnd, setOutcomeChartBrushEnd] = useState(0);
  const [strategyTradesBrushStart, setStrategyTradesBrushStart] = useState(0);
  const [strategyTradesBrushEnd, setStrategyTradesBrushEnd] = useState(0);
  const [strategyProfitableBrushStart, setStrategyProfitableBrushStart] = useState(0);
  const [strategyProfitableBrushEnd, setStrategyProfitableBrushEnd] = useState(0);
  const [strategyProfitBrushStart, setStrategyProfitBrushStart] = useState(0);
  const [strategyProfitBrushEnd, setStrategyProfitBrushEnd] = useState(0);
  const [emotionTypeBrushStart, setEmotionTypeBrushStart] = useState(0);
  const [emotionTypeBrushEnd, setEmotionTypeBrushEnd] = useState(0);
  const [emotionTimeBrushStart, setEmotionTimeBrushStart] = useState(0);
  const [emotionTimeBrushEnd, setEmotionTimeBrushEnd] = useState(0);
  const [emotionIntensityBrushStart, setEmotionIntensityBrushStart] = useState(0);
  const [emotionIntensityBrushEnd, setEmotionIntensityBrushEnd] = useState(0);
  const equitySettingsRef = useRef<HTMLDivElement>(null);
  const equitySettingsButtonRef = useRef<HTMLButtonElement>(null);
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const prevDataModeRef = useRef<DataMode | null>(null);
  const filtersBarRef = useRef<HTMLDivElement>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformanceRow[]>([]);
  const [checklistItemMetrics, setChecklistItemMetrics] = useState<ChecklistItemMetricRow[]>([]);
  const [, setChecklistItemMetricsByOutcome] = useState<ChecklistItemMetricByOutcomeRow[]>([]);
  /** Per-strategy checklist by outcome for branched "top winning" display */
  const [, setChecklistByOutcomePerStrategy] = useState<Array<{ strategyId: number; strategyName: string; items: ChecklistItemMetricByOutcomeRow[] }>>([]);
  const [emotionalStates, setEmotionalStates] = useState<EmotionalStateRow[]>([]);
  // Analytics filters: multi-select (Strategy, Symbol, Side, Type), Position size $ (min/max), Position/Timeframe/R (journal)
  const parseStoredArray = (key: string): string[] => {
    try {
      const s = localStorage.getItem(key);
      if (!s) return [];
      const a = JSON.parse(s) as unknown;
      return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const [filterStrategyIds, setFilterStrategyIds] = useState<string[]>(() => parseStoredArray("tradebutler_analytics_filter_strategy_ids"));
  const [filterSymbols, setFilterSymbols] = useState<string[]>(() => parseStoredArray("tradebutler_analytics_filter_symbols"));
  const [filterSides, setFilterSides] = useState<string[]>(() => parseStoredArray("tradebutler_analytics_filter_sides"));
  const [filterTypes, setFilterTypes] = useState<string[]>(() => parseStoredArray("tradebutler_analytics_filter_types"));
  const [filterPositionSizeMin, setFilterPositionSizeMin] = useState<string>(() => localStorage.getItem("tradebutler_analytics_filter_position_size_min") || "");
  const [filterPositionSizeMax, setFilterPositionSizeMax] = useState<string>(() => localStorage.getItem("tradebutler_analytics_filter_position_size_max") || "");
  const [filterPositions, setFilterPositions] = useState<string[]>(() => parseStoredArray("tradebutler_analytics_filter_positions"));
  const [filterTimeframes, setFilterTimeframes] = useState<string[]>(() => parseStoredArray("tradebutler_analytics_filter_timeframes"));
  const [filterRMin, setFilterRMin] = useState<string>(() => localStorage.getItem("tradebutler_analytics_filter_r_min") || "");
  const [filterRMax, setFilterRMax] = useState<string>(() => localStorage.getItem("tradebutler_analytics_filter_r_max") || "");
  const [openFilterDropdown, setOpenFilterDropdown] = useState<string | null>(null);
  const [expandedChartId, setExpandedChartId] = useState<string | null>(null);
  const [expandedBrushStart, setExpandedBrushStart] = useState(0);
  const [expandedBrushEnd, setExpandedBrushEnd] = useState(0);
  const [expandedSliderDrag, setExpandedSliderDrag] = useState<{ which: "left" | "right"; position: number } | { which: "slide"; startPct: number; endPct: number } | null>(null);
  const expandedSliderTrackRef = useRef<HTMLDivElement>(null);
  type ExpandedDragCtx =
    | { which: "left" | "right"; bound: number; n: number; position: number; trackRect: DOMRect | null; setStart: (n: number) => void; setEnd: (n: number) => void; wasFullRange?: boolean; startIdx: number; endIdx: number }
    | { which: "slide"; initialStartPct: number; initialEndPct: number; initialClientX: number; trackRect: DOMRect | null; n: number; startPct: number; endPct: number; setStart: (n: number) => void; setEnd: (n: number) => void };
  const expandedSliderDragRef = useRef<ExpandedDragCtx | null>(null);

  const handleExpandedSliderMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (e.type === "touchmove") e.preventDefault();
    const ctx = expandedSliderDragRef.current;
    if (!ctx?.trackRect || ctx.trackRect.width <= 0) return;
    const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : "clientX" in e ? (e as MouseEvent).clientX : 0;
    if (ctx.which === "slide") {
      const deltaPct = (clientX - ctx.initialClientX) / ctx.trackRect.width;
      const delta = Math.max(-ctx.initialStartPct, Math.min(1 - ctx.initialEndPct, deltaPct));
      const newStart = ctx.initialStartPct + delta;
      const newEnd = ctx.initialEndPct + delta;
      ctx.startPct = newStart;
      ctx.endPct = newEnd;
      setExpandedSliderDrag({ which: "slide", startPct: newStart, endPct: newEnd });
    } else {
      const pos = Math.max(0, Math.min(1, (clientX - ctx.trackRect.left) / ctx.trackRect.width));
      const newPos = ctx.which === "left" ? Math.min(pos, ctx.bound) : Math.max(pos, ctx.bound);
      ctx.position = newPos;
      setExpandedSliderDrag((prev) => (prev && "position" in prev ? { ...prev, position: newPos } : null));
    }
  }, []);

  const handleExpandedSliderUp = useCallback(() => {
    const ctx = expandedSliderDragRef.current;
    if (!ctx) return;
    const n = ctx.n;
    const setStart = ctx.setStart;
    const setEnd = ctx.setEnd;
    if (ctx.which === "slide") {
      const startIdx = Math.max(0, Math.min(n - 1, Math.round(ctx.startPct * (n - 1))));
      const endIdx = Math.max(startIdx, Math.min(n - 1, Math.round(ctx.endPct * (n - 1))));
      setStart(startIdx);
      setEnd(endIdx);
    } else {
      const idx = Math.round(ctx.position * (n - 1));
      const clampedIdx = Math.max(0, Math.min(n - 1, idx));
      if (ctx.which === "left") {
        setStart(clampedIdx);
        setEnd(ctx.wasFullRange ? n - 1 : ctx.endIdx);
      } else {
        setEnd(clampedIdx);
        setStart(ctx.wasFullRange ? 0 : ctx.startIdx);
      }
    }
    setExpandedSliderDrag(null);
    expandedSliderDragRef.current = null;
    document.removeEventListener("mousemove", handleExpandedSliderMove as EventListener, true);
    document.removeEventListener("mouseup", handleExpandedSliderUp, true);
    document.removeEventListener("touchmove", handleExpandedSliderMove as EventListener, true);
    document.removeEventListener("touchend", handleExpandedSliderUp, true);
  }, [handleExpandedSliderMove]);

  const [coverageChartBrushStart, setCoverageChartBrushStart] = useState(0);
  const [coverageChartBrushEnd, setCoverageChartBrushEnd] = useState(0);
  const [dailyPnlBrushStart, setDailyPnlBrushStart] = useState(0);
  const [dailyPnlBrushEnd, setDailyPnlBrushEnd] = useState(0);
  const [tradeSymbolBrushStart, setTradeSymbolBrushStart] = useState(0);
  const [tradeSymbolBrushEnd, setTradeSymbolBrushEnd] = useState(0);
  const [tradePnlBrushStart, setTradePnlBrushStart] = useState(0);
  const [tradePnlBrushEnd, setTradePnlBrushEnd] = useState(0);

  useEffect(() => {
    if (expandedChartId) {
      setExpandedBrushStart(0);
      setExpandedBrushEnd(0);
      setExpandedSliderDrag(null);
    }
  }, [expandedChartId]);

  useEffect(() => {
    loadData();
  }, [timeframe, customStartDate, customEndDate, dataMode, filterStrategyIds, filterSymbols, filterSides, filterTypes, filterPositionSizeMin, filterPositionSizeMax, filterPositions, filterTimeframes, filterRMin, filterRMax]);

  useEffect(() => {
    setEquityBrushEnd(0);
    setEquityBrushDrag(null);
    setSymbolChartBrushEnd(0);
    setEntriesChartBrushEnd(0);
    setPositionsChartBrushEnd(0);
    setOutcomeChartBrushEnd(0);
    setStrategyTradesBrushEnd(0);
    setStrategyProfitableBrushEnd(0);
    setStrategyProfitBrushEnd(0);
    setEmotionTypeBrushEnd(0);
    setEmotionTimeBrushEnd(0);
    setEmotionIntensityBrushEnd(0);
    setCoverageChartBrushEnd(0);
    setDailyPnlBrushEnd(0);
    setTradeSymbolBrushEnd(0);
    setTradePnlBrushEnd(0);
  }, [timeframe, customStartDate, customEndDate, filterStrategyIds, filterSymbols, filterSides, filterTypes, filterPositionSizeMin, filterPositionSizeMax, filterPositions, filterTimeframes, filterRMin, filterRMax]);

  useEffect(() => {
    const unsubscribe = subscribeToDataMode((mode) => {
      setDataMode(mode);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // When user switches data mode, clear analytics filters so the new mode is not affected by the previous mode's filters
  useEffect(() => {
    const prevMode = prevDataModeRef.current;
    prevDataModeRef.current = dataMode;
    if (prevMode != null && prevMode !== dataMode) {
      setFilterStrategyIds([]);
      setFilterSymbols([]);
      setFilterSides([]);
      setFilterTypes([]);
      setFilterPositionSizeMin("");
      setFilterPositionSizeMax("");
      setFilterPositions([]);
      setFilterTimeframes([]);
      setFilterRMin("");
      setFilterRMax("");
      [
        "tradebutler_analytics_filter_strategy_ids",
        "tradebutler_analytics_filter_symbols",
        "tradebutler_analytics_filter_sides",
        "tradebutler_analytics_filter_types",
        "tradebutler_analytics_filter_position_size_min",
        "tradebutler_analytics_filter_position_size_max",
        "tradebutler_analytics_filter_positions",
        "tradebutler_analytics_filter_timeframes",
        "tradebutler_analytics_filter_r_min",
        "tradebutler_analytics_filter_r_max",
      ].forEach((k) => localStorage.removeItem(k));
    }
  }, [dataMode]);

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

  useEffect(() => {
    if (filterStrategyIds.length) localStorage.setItem("tradebutler_analytics_filter_strategy_ids", JSON.stringify(filterStrategyIds));
    else localStorage.removeItem("tradebutler_analytics_filter_strategy_ids");
  }, [filterStrategyIds]);
  useEffect(() => {
    if (filterSymbols.length) localStorage.setItem("tradebutler_analytics_filter_symbols", JSON.stringify(filterSymbols));
    else localStorage.removeItem("tradebutler_analytics_filter_symbols");
  }, [filterSymbols]);
  useEffect(() => {
    if (filterSides.length) localStorage.setItem("tradebutler_analytics_filter_sides", JSON.stringify(filterSides));
    else localStorage.removeItem("tradebutler_analytics_filter_sides");
  }, [filterSides]);
  useEffect(() => {
    if (filterTypes.length) localStorage.setItem("tradebutler_analytics_filter_types", JSON.stringify(filterTypes));
    else localStorage.removeItem("tradebutler_analytics_filter_types");
  }, [filterTypes]);
  useEffect(() => {
    if (filterPositionSizeMin) localStorage.setItem("tradebutler_analytics_filter_position_size_min", filterPositionSizeMin);
    else localStorage.removeItem("tradebutler_analytics_filter_position_size_min");
  }, [filterPositionSizeMin]);
  useEffect(() => {
    if (filterPositionSizeMax) localStorage.setItem("tradebutler_analytics_filter_position_size_max", filterPositionSizeMax);
    else localStorage.removeItem("tradebutler_analytics_filter_position_size_max");
  }, [filterPositionSizeMax]);
  useEffect(() => {
    if (filterPositions.length) localStorage.setItem("tradebutler_analytics_filter_positions", JSON.stringify(filterPositions));
    else localStorage.removeItem("tradebutler_analytics_filter_positions");
  }, [filterPositions]);
  useEffect(() => {
    if (filterTimeframes.length) localStorage.setItem("tradebutler_analytics_filter_timeframes", JSON.stringify(filterTimeframes));
    else localStorage.removeItem("tradebutler_analytics_filter_timeframes");
  }, [filterTimeframes]);
  useEffect(() => {
    if (filterRMin) localStorage.setItem("tradebutler_analytics_filter_r_min", filterRMin);
    else localStorage.removeItem("tradebutler_analytics_filter_r_min");
  }, [filterRMin]);
  useEffect(() => {
    if (filterRMax) localStorage.setItem("tradebutler_analytics_filter_r_max", filterRMax);
    else localStorage.removeItem("tradebutler_analytics_filter_r_max");
  }, [filterRMax]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (openFilterDropdown && filtersBarRef.current && !filtersBarRef.current.contains(target)) {
        setOpenFilterDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openFilterDropdown]);

  // Extract underlying symbol from options contract (defined early so useMemos below can use it)
  const getUnderlyingSymbol = (symbol: string | null | undefined): string => {
    if (symbol == null || symbol === "") return "";
    const firstDigitIndex = symbol.search(/\d/);
    if (firstDigitIndex > 0) return symbol.substring(0, firstDigitIndex);
    return symbol;
  };

  // Helper: trades matching all trade filters except one dimension (so dropdowns only show values that exist for the current selection)
  const getTradesForOptionDimension = useMemo(() => {
    const strategyIdNums = filterStrategyIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n));
    const posMinUsd = filterPositionSizeMin !== "" ? parseFloat(filterPositionSizeMin) : null;
    const posMaxUsd = filterPositionSizeMax !== "" ? parseFloat(filterPositionSizeMax) : null;
    type Skip = "strategy" | "symbol" | "side" | "type" | "positionSize";
    return (skip: Skip): Trade[] => {
      return trades.filter((t) => {
        if (skip !== "strategy" && filterStrategyIds.length > 0 && (t.strategy_id == null || !strategyIdNums.includes(t.strategy_id))) return false;
        if (skip !== "symbol" && filterSymbols.length > 0) {
          const tSym = t.symbol ?? "";
          if (!filterSymbols.some((s) => tSym === s || getUnderlyingSymbol(tSym) === getUnderlyingSymbol(s))) return false;
        }
        if (skip !== "side" && filterSides.length > 0 && filterSides.indexOf(t.side ?? "") === -1) return false;
        if (skip !== "type" && filterTypes.length > 0 && filterTypes.indexOf(t.order_type ?? "") === -1) return false;
        if (skip !== "positionSize") {
          const posUsd = t.quantity * t.price;
          if (posMinUsd != null && !Number.isNaN(posMinUsd) && posUsd < posMinUsd) return false;
          if (posMaxUsd != null && !Number.isNaN(posMaxUsd) && posUsd > posMaxUsd) return false;
        }
        return true;
      });
    };
  }, [trades, filterStrategyIds, filterSymbols, filterSides, filterTypes, filterPositionSizeMin, filterPositionSizeMax]);

  // Journal trades in scope: entries pass strategy filter, trades pass symbol filter; used to build Position/Timeframe options
  const journalTradesInScopeForOptions = useMemo(() => {
    const entryById = new Map(journalEntries.map((e) => [e.id, e]));
    const strategyIdNums = filterStrategyIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n));
    return journalTrades.filter((t) => {
      const entry = entryById.get(t.journal_entry_id);
      if (!entry) return false;
      if (filterStrategyIds.length > 0 && (entry.strategy_id == null || !strategyIdNums.includes(entry.strategy_id))) return false;
      if (filterSymbols.length > 0 && (t.symbol == null || !filterSymbols.some((s) => t.symbol === s || getUnderlyingSymbol(t.symbol ?? "") === getUnderlyingSymbol(s)))) return false;
      return true;
    });
  }, [journalTrades, journalEntries, filterStrategyIds, filterSymbols]);

  // Filter options: each dropdown shows only values that exist when other filters are applied (cascading filters)
  const filterOptions = useMemo(() => {
    const forStrategy = getTradesForOptionDimension("strategy");
    const forSymbol = getTradesForOptionDimension("symbol");
    const forSide = getTradesForOptionDimension("side");
    const forType = getTradesForOptionDimension("type");

    const strategyIds = Array.from(new Set(forStrategy.map((t) => t.strategy_id).filter((id): id is number => id != null)));
    const strategiesFiltered = strategies.filter((s) => s.id != null && strategyIds.includes(s.id));
    const symbols = Array.from(new Set(forSymbol.map((t) => t.symbol).filter((s): s is string => Boolean(s)))).sort();
    const sides = Array.from(new Set(forSide.map((t) => t.side).filter(Boolean))).sort();
    const types = Array.from(new Set(forType.map((t) => t.order_type).filter(Boolean))).sort();

    const rMin = filterRMin !== "" ? parseFloat(filterRMin) : null;
    const rMax = filterRMax !== "" ? parseFloat(filterRMax) : null;
    const hasR = (rMin != null && !Number.isNaN(rMin)) || (rMax != null && !Number.isNaN(rMax));
    const matchR = (t: JournalTrade) => {
      if (!hasR || t.r_multiple == null) return true;
      if (rMin != null && !Number.isNaN(rMin) && t.r_multiple < rMin) return false;
      if (rMax != null && !Number.isNaN(rMax) && t.r_multiple > rMax) return false;
      return true;
    };
    const matchPosition = (t: JournalTrade) => filterPositions.length === 0 || (t.position != null && t.position.trim() !== "" && filterPositions.includes(t.position.trim()));
    const matchTimeframe = (t: JournalTrade) => filterTimeframes.length === 0 || (t.timeframe != null && t.timeframe.trim() !== "" && filterTimeframes.includes(t.timeframe.trim()));

    const forPosition = journalTradesInScopeForOptions.filter((t) => matchTimeframe(t) && matchR(t));
    const forTimeframe = journalTradesInScopeForOptions.filter((t) => matchPosition(t) && matchR(t));
    const positions = Array.from(new Set(forPosition.map((t) => t.position).filter((p): p is string => p != null && p.trim() !== ""))).sort();
    const timeframes = Array.from(new Set(forTimeframe.map((t) => t.timeframe).filter((tf): tf is string => tf != null && tf.trim() !== ""))).sort();

    return { strategies: strategiesFiltered, symbols, sides, types, positions, timeframes };
  }, [getTradesForOptionDimension, strategies, journalTradesInScopeForOptions, filterPositions, filterTimeframes, filterRMin, filterRMax]);

  // When options shrink from cascading, remove any selected value that is no longer in the list
  useEffect(() => {
    const stratIds = new Set((filterOptions.strategies ?? []).filter((s) => s.id != null).map((s) => String(s.id)));
    const symSet = new Set(filterOptions.symbols ?? []);
    const sideSet = new Set(filterOptions.sides ?? []);
    const typeSet = new Set(filterOptions.types ?? []);
    const posSet = new Set(filterOptions.positions ?? []);
    const tfSet = new Set(filterOptions.timeframes ?? []);
    setFilterStrategyIds((prev) => (prev.some((id) => !stratIds.has(id)) ? prev.filter((id) => stratIds.has(id)) : prev));
    setFilterSymbols((prev) => (prev.some((s) => !symSet.has(s)) ? prev.filter((s) => symSet.has(s)) : prev));
    setFilterSides((prev) => (prev.some((s) => !sideSet.has(s)) ? prev.filter((s) => sideSet.has(s)) : prev));
    setFilterTypes((prev) => (prev.some((t) => !typeSet.has(t)) ? prev.filter((t) => typeSet.has(t)) : prev));
    setFilterPositions((prev) => (prev.some((p) => !posSet.has(p)) ? prev.filter((p) => posSet.has(p)) : prev));
    setFilterTimeframes((prev) => (prev.some((t) => !tfSet.has(t)) ? prev.filter((t) => tfSet.has(t)) : prev));
  }, [filterOptions]);

  // Apply current filters to trades (used for all trade-based charts; works in Demo and Real/Paper)
  const filteredTrades = useMemo(() => {
    const hasStrategy = filterStrategyIds.length > 0;
    const hasSymbol = filterSymbols.length > 0;
    const hasSide = filterSides.length > 0;
    const hasType = filterTypes.length > 0;
    const posMinUsd = filterPositionSizeMin !== "" ? parseFloat(filterPositionSizeMin) : null;
    const posMaxUsd = filterPositionSizeMax !== "" ? parseFloat(filterPositionSizeMax) : null;
    const hasPos = posMinUsd != null && !Number.isNaN(posMinUsd) || posMaxUsd != null && !Number.isNaN(posMaxUsd);
    if (!hasStrategy && !hasSymbol && !hasSide && !hasType && !hasPos) {
      return trades;
    }
    const strategyIdNums = filterStrategyIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n));
    return trades.filter((t) => {
      if (hasStrategy && (t.strategy_id == null || !strategyIdNums.includes(t.strategy_id))) return false;
      if (hasSymbol) {
        const tSym = t.symbol ?? "";
        const match = filterSymbols.some(
          (s) => tSym === s || getUnderlyingSymbol(tSym) === getUnderlyingSymbol(s)
        );
        if (!match) return false;
      }
      if (hasSide && filterSides.indexOf(t.side ?? "") === -1) return false;
      if (hasType && filterTypes.indexOf(t.order_type ?? "") === -1) return false;
      const posUsd = t.quantity * t.price;
      if (posMinUsd != null && !Number.isNaN(posMinUsd) && posUsd < posMinUsd) return false;
      if (posMaxUsd != null && !Number.isNaN(posMaxUsd) && posUsd > posMaxUsd) return false;
      return true;
    });
  }, [trades, filterStrategyIds, filterSymbols, filterSides, filterTypes, filterPositionSizeMin, filterPositionSizeMax]);

  const resetFilters = () => {
    setFilterStrategyIds([]);
    setFilterSymbols([]);
    setFilterSides([]);
    setFilterTypes([]);
    setFilterPositionSizeMin("");
    setFilterPositionSizeMax("");
    setFilterPositions([]);
    setFilterTimeframes([]);
    setFilterRMin("");
    setFilterRMax("");
    setOpenFilterDropdown(null);
    [
      "tradebutler_analytics_filter_strategy_ids",
      "tradebutler_analytics_filter_symbols",
      "tradebutler_analytics_filter_sides",
      "tradebutler_analytics_filter_types",
      "tradebutler_analytics_filter_position_size_min",
      "tradebutler_analytics_filter_position_size_max",
      "tradebutler_analytics_filter_positions",
      "tradebutler_analytics_filter_timeframes",
      "tradebutler_analytics_filter_r_min",
      "tradebutler_analytics_filter_r_max",
    ].forEach((k) => localStorage.removeItem(k));
  };

  const hasAnyFilter =
    filterStrategyIds.length > 0 ||
    filterSymbols.length > 0 ||
    filterSides.length > 0 ||
    filterTypes.length > 0 ||
    filterPositionSizeMin !== "" ||
    filterPositionSizeMax !== "" ||
    filterPositions.length > 0 ||
    filterTimeframes.length > 0 ||
    filterRMin !== "" ||
    filterRMax !== "";

  const loadData = async () => {
    try {
      if (dataMode === "sandbox") {
        const state = loadSandboxState();
        const demoTrades = state.trades as unknown as Trade[];
        setTrades(demoTrades);
        setSymbolPnL(EXAMPLE_SYMBOL_PNL as unknown as SymbolPnL[]);
        setJournalEntries(state.journalEntries as unknown as JournalEntry[]);
        setJournalTrades(state.journalTrades as unknown as JournalTrade[]);
        const demoStrategies = state.strategies as unknown as Strategy[];
        setStrategies(demoStrategies);
        const filteredDemo = (() => {
          const hasStrategy = filterStrategyIds.length > 0;
          const hasSymbol = filterSymbols.length > 0;
          const hasSide = filterSides.length > 0;
          const hasType = filterTypes.length > 0;
          const posMinUsd = filterPositionSizeMin !== "" ? parseFloat(filterPositionSizeMin) : null;
          const posMaxUsd = filterPositionSizeMax !== "" ? parseFloat(filterPositionSizeMax) : null;
          if (!hasStrategy && !hasSymbol && !hasSide && !hasType && (posMinUsd == null || Number.isNaN(posMinUsd)) && (posMaxUsd == null || Number.isNaN(posMaxUsd))) return demoTrades;
          const strategyIdNums = filterStrategyIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n));
          return demoTrades.filter((t) => {
            if (hasStrategy && (t.strategy_id == null || !strategyIdNums.includes(t.strategy_id))) return false;
            if (hasSymbol && !filterSymbols.some((s) => (t.symbol ?? "") === s || getUnderlyingSymbol(t.symbol ?? "") === getUnderlyingSymbol(s))) return false;
            if (hasSide && filterSides.indexOf(t.side ?? "") === -1) return false;
            if (hasType && filterTypes.indexOf(t.order_type ?? "") === -1) return false;
            const posUsd = t.quantity * t.price;
            if (posMinUsd != null && !Number.isNaN(posMinUsd) && posUsd < posMinUsd) return false;
            if (posMaxUsd != null && !Number.isNaN(posMaxUsd) && posUsd > posMaxUsd) return false;
            return true;
          });
        })();
        const byStrategy = new Map<number | null, { count: number; winning: number; volume: number; pnl: number }>();
        filteredDemo.forEach((t) => {
          const sid = t.strategy_id ?? null;
          const cur = byStrategy.get(sid) ?? { count: 0, winning: 0, volume: 0, pnl: 0 };
          // Vary P&L by strategy: 1,3,4 positive; 2,5 negative; 6 mixed. Scale for visible disparity.
          const sign = sid == null ? -0.5 : sid === 2 || sid === 5 ? -1 : sid === 6 ? (t.id ?? 0) % 2 === 0 ? 1 : -1 : 1;
          const pnl = (t.quantity ?? 0) * (t.price ?? 0) * 0.018 * sign * (1 + (sid ?? 0) * 0.3);
          byStrategy.set(sid, {
            count: cur.count + 1,
            winning: cur.winning + (pnl > 0 ? 1 : 0),
            volume: cur.volume + (t.quantity ?? 0) * (t.price ?? 0),
            pnl: cur.pnl + pnl,
          });
        });
        const perf: StrategyPerformanceRow[] = [];
        byStrategy.forEach((val, sid) => {
          const name = sid == null ? "Unassigned" : (demoStrategies.find((s) => s.id === sid)?.name ?? `Strategy ${sid}`);
          perf.push({
            strategy_id: sid,
            strategy_name: name,
            trade_count: val.count,
            winning_trades: val.winning,
            total_volume: val.volume,
            estimated_pnl: val.pnl,
          });
        });
        perf.sort((a, b) => b.trade_count - a.trade_count);
        setStrategyPerformance(perf);
        const demoStrategyIds = demoStrategies.filter((s) => s.id != null).map((s) => s.id);
        const demoChecklistMetrics = demoStrategyIds.flatMap((id) => getSandboxStrategyChecklistItemMetrics(id));
        const demoByStrategy = demoStrategyIds.map((id) => ({
          strategyId: id,
          strategyName: demoStrategies.find((s) => s.id === id)?.name ?? `Strategy ${id}`,
          items: getSandboxStrategyChecklistItemMetricsByOutcome(id) as ChecklistItemMetricByOutcomeRow[],
        }));
        setChecklistItemMetrics(demoChecklistMetrics as ChecklistItemMetricRow[]);
        setChecklistByOutcomePerStrategy(demoByStrategy);
        setChecklistItemMetricsByOutcome(demoByStrategy.flatMap((s) => s.items));
        const demoEmotionalStates = getSandboxEmotionalStates() as EmotionalStateRow[];
        setEmotionalStates(demoEmotionalStates);
        // In Demo, when any trade filter is set, build equity curve from filtered demo trades
        const hasStrategy = filterStrategyIds.length > 0;
        const hasSymbol = filterSymbols.length > 0;
        const hasSide = filterSides.length > 0;
        const hasType = filterTypes.length > 0;
        const posMinUsd = filterPositionSizeMin !== "" ? parseFloat(filterPositionSizeMin) : null;
        const posMaxUsd = filterPositionSizeMax !== "" ? parseFloat(filterPositionSizeMax) : null;
        const hasPos = (posMinUsd != null && !Number.isNaN(posMinUsd)) || (posMaxUsd != null && !Number.isNaN(posMaxUsd));
        const hasFilter = hasStrategy || hasSymbol || hasSide || hasType || hasPos;
        if (hasFilter) {
          const strategyIdNums = filterStrategyIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n));
          const filtered = demoTrades.filter((t) => {
            if (hasStrategy && (t.strategy_id == null || !strategyIdNums.includes(t.strategy_id))) return false;
            if (hasSymbol) {
              const tSym = t.symbol ?? "";
              if (!filterSymbols.some((s) => tSym === s || getUnderlyingSymbol(tSym) === getUnderlyingSymbol(s))) return false;
            }
            if (hasSide && filterSides.indexOf(t.side ?? "") === -1) return false;
            if (hasType && filterTypes.indexOf(t.order_type ?? "") === -1) return false;
            const posUsd = t.quantity * t.price;
            if (posMinUsd != null && !Number.isNaN(posMinUsd) && posUsd < posMinUsd) return false;
            if (posMaxUsd != null && !Number.isNaN(posMaxUsd) && posUsd > posMaxUsd) return false;
            return true;
          });
          const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
          const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
          const startDate = dateRange.start ? dateRange.start.toISOString() : null;
          const endDate = dateRange.end ? dateRange.end.toISOString() : null;
          try {
            const curveData = await invoke<EquityCurveData>("get_equity_curve_from_trades", {
              trades: filtered,
              pairingMethod,
              startDate,
              endDate,
            });
            setEquityCurve(curveData);
          } catch (e) {
            console.error("Demo equity curve from trades failed:", e);
            setEquityCurve(EXAMPLE_EQUITY_CURVE as unknown as EquityCurveData);
          }
        } else {
          setEquityCurve(EXAMPLE_EQUITY_CURVE as unknown as EquityCurveData);
        }
        return;
      }

      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
      const startDate = dateRange.start ? dateRange.start.toISOString() : null;
      const endDate = dateRange.end ? dateRange.end.toISOString() : null;
      
      const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
      const hasStrategy = filterStrategyIds.length > 0;
      const hasSymbol = filterSymbols.length > 0;
      const hasSide = filterSides.length > 0;
      const hasType = filterTypes.length > 0;
      const posMinUsdVal = filterPositionSizeMin !== "" ? parseFloat(filterPositionSizeMin) : null;
      const posMaxUsdVal = filterPositionSizeMax !== "" ? parseFloat(filterPositionSizeMax) : null;
      const hasPosUsd = (posMinUsdVal != null && !Number.isNaN(posMinUsdVal)) || (posMaxUsdVal != null && !Number.isNaN(posMaxUsdVal));
      const filters = (hasStrategy || hasSymbol || hasSide || hasType || hasPosUsd) ? {
        strategy_ids: hasStrategy ? filterStrategyIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)) : undefined,
        symbols: hasSymbol ? filterSymbols : undefined,
        sides: hasSide ? filterSides : undefined,
        order_types: hasType ? filterTypes : undefined,
        position_size_min_usd: posMinUsdVal != null && !Number.isNaN(posMinUsdVal) ? posMinUsdVal : undefined,
        position_size_max_usd: posMaxUsdVal != null && !Number.isNaN(posMaxUsdVal) ? posMaxUsdVal : undefined,
      } : undefined;
      const [tradesData, pnlData, equityData, journalEntriesData, journalTradesData, strategiesData] = await Promise.all([
        invoke<Trade[]>("get_trades", paperArgs),
        invoke<SymbolPnL[]>("get_symbol_pnl", { pairingMethod, startDate, endDate, ...paperArgs, filters }),
        invoke<EquityCurveData>("get_equity_curve", { pairingMethod, startDate, endDate, ...paperArgs, filters }),
        invoke<JournalEntry[]>("get_journal_entries", paperArgs),
        invoke<JournalTrade[]>("get_all_journal_trades"),
        invoke<Strategy[]>("get_strategies"),
      ]);
      setTrades(tradesData);
      setSymbolPnL(pnlData);
      setEquityCurve(equityData);
      setJournalEntries(journalEntriesData);
      setJournalTrades(journalTradesData);
      setStrategies(strategiesData);

      const perf = await invoke<StrategyPerformanceRow[]>("get_strategy_performance", {
        pairingMethod,
        startDate,
        endDate,
        ...paperArgs,
      }).catch(() => [] as StrategyPerformanceRow[]);
      setStrategyPerformance(Array.isArray(perf) ? perf : []);

      const strategyIds = (strategiesData as Strategy[]).filter((s) => s.id != null).map((s) => s.id);
      const strategiesDataTyped = strategiesData as Strategy[];
      const [checklistResults, checklistByOutcomeResults] = await Promise.all([
        Promise.all(
          strategyIds.map((id) =>
            invoke<ChecklistItemMetricRow[]>("get_strategy_checklist_item_metrics", { strategyId: id }).catch(() => [])
          )
        ),
        Promise.all(
          strategyIds.map((id) =>
            invoke<ChecklistItemMetricByOutcomeRow[]>("get_strategy_checklist_item_metrics_by_outcome", { strategyId: id }).catch(() => [])
          )
        ),
      ]);
      setChecklistItemMetrics(checklistResults.flat());
      const byStrategy = strategyIds.map((id, i) => ({
        strategyId: id,
        strategyName: strategiesDataTyped.find((s) => s.id === id)?.name ?? `Strategy ${id}`,
        items: (checklistByOutcomeResults[i] ?? []) as ChecklistItemMetricByOutcomeRow[],
      }));
      setChecklistByOutcomePerStrategy(byStrategy);
      setChecklistItemMetricsByOutcome(byStrategy.flatMap((s) => s.items));
      const emotionalStatesData = await invoke<EmotionalStateRow[]>("get_emotional_states", paperArgs).catch(() => [] as EmotionalStateRow[]);
      setEmotionalStates(Array.isArray(emotionalStatesData) ? emotionalStatesData : []);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
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

  // Daily P&L distribution (histogram): bucket daily_pnl in selected timeframe for risk/return insight
  const dailyPnlDistributionData = useMemo(() => {
    if (!equityCurve || !Array.isArray(equityCurve.equity_points) || equityCurve.equity_points.length === 0) return [];
    const filled = fillMissingDates(equityCurve.equity_points);
    const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
    const start = dateRange.start ? new Date(dateRange.start).getTime() : null;
    const end = dateRange.end ? new Date(dateRange.end).getTime() : null;
    const inRange = (d: string) => {
      const t = new Date(d).getTime();
      if (start != null && t < start) return false;
      if (end != null && t > end) return false;
      return true;
    };
    const dailyPnls = filled.filter((p) => inRange(p.date)).map((p) => p.daily_pnl ?? 0);
    if (dailyPnls.length === 0) return [];
    const minPnl = Math.min(...dailyPnls);
    const maxPnl = Math.max(...dailyPnls);
    const numBins = minPnl === maxPnl ? 1 : 12;
    const binWidth = minPnl === maxPnl ? 1 : (maxPnl - minPnl) / numBins;
    const bins: { range: string; count: number; mid: number; isPositive: boolean }[] = [];
    for (let i = 0; i < numBins; i++) {
      const lo = minPnl + i * binWidth;
      const hi = i === numBins - 1 ? maxPnl + 0.01 : minPnl + (i + 1) * binWidth;
      const mid = (lo + hi) / 2;
      const count = dailyPnls.filter((v) => v >= lo && v < hi).length;
      const rangeLabel =
        numBins === 1
          ? `$${formatWithCommas(minPnl, { decimals: 0 })}`
          : `$${formatWithCommas(lo, { decimals: 0 })} to $${formatWithCommas(hi, { decimals: 0 })}`;
      bins.push({ range: rangeLabel, count, mid, isPositive: mid >= 0 });
    }
    return bins;
  }, [equityCurve, timeframe, customStartDate, customEndDate]);

  // Process trades for charts (use filteredTrades so Trades by Symbol respects filters)
  const processChartData = () => {
    const symbolCounts: Record<string, number> = {};

    filteredTrades.forEach((trade) => {
      const underlyingSymbol = getUnderlyingSymbol(trade.symbol);
      if (underlyingSymbol !== "") {
        symbolCounts[underlyingSymbol] = (symbolCounts[underlyingSymbol] || 0) + 1;
      }
    });

    const symbolData = Object.entries(symbolCounts)
      .filter(([symbol]) => symbol != null && symbol !== "")
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { symbolData };
  };

  // Profit & Loss by Symbol: when symbol filter is set, show only selected symbols (backend filters in Real/Paper; client-side for consistency and Demo)
  const displaySymbolPnL = useMemo(() => {
    if (filterSymbols.length === 0) return symbolPnL ?? [];
    return (symbolPnL ?? []).filter((p) =>
      filterSymbols.some(
        (s) => p.symbol === s || getUnderlyingSymbol(p.symbol) === getUnderlyingSymbol(s)
      )
    );
  }, [symbolPnL, filterSymbols]);

  const chartData = useMemo(() => processChartData(), [filteredTrades]);
  const symbolData: { symbol: string; count: number }[] = useMemo(
    () => (Array.isArray(chartData?.symbolData) ? chartData.symbolData : []),
    [chartData]
  );
  // Full symbol list (unsliced) for expanded Trades by Symbol chart and Brush
  const fullSymbolData = useMemo(() => {
    const symbolCounts: Record<string, number> = {};
    filteredTrades.forEach((trade) => {
      const underlyingSymbol = getUnderlyingSymbol(trade.symbol);
      if (underlyingSymbol !== "") symbolCounts[underlyingSymbol] = (symbolCounts[underlyingSymbol] || 0) + 1;
    });
    return Object.entries(symbolCounts)
      .filter(([symbol]) => symbol != null && symbol !== "")
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredTrades]);

  // Top symbols for Trade Findings charts (side-by-side, limited to top N)
  const tradeFindingsTradesBySymbol = useMemo(() => (symbolData ?? []).slice(0, TOP_CATEGORIES), [symbolData]);
  const tradeFindingsPnLBySymbol = useMemo(() => {
    const list = Array.isArray(displaySymbolPnL) ? [...displaySymbolPnL] : [];
    return list
      .sort((a, b) => Math.abs(b.total_net_pnl) - Math.abs(a.total_net_pnl))
      .slice(0, TOP_CATEGORIES)
      .map((p) => ({ name: p.symbol, value: p.total_net_pnl }));
  }, [displaySymbolPnL]);

  // Full P&L by symbol for expanded chart (all symbols, for Brush when many)
  const expandedPnLBySymbol = useMemo(() => {
    const list = Array.isArray(displaySymbolPnL) ? [...displaySymbolPnL] : [];
    return list
      .sort((a, b) => Math.abs(b.total_net_pnl) - Math.abs(a.total_net_pnl))
      .map((p) => ({ name: p.symbol, value: p.total_net_pnl }));
  }, [displaySymbolPnL]);

  // Journal: first filter trades by strategy/symbol/position/timeframe/R, then entries = those that have at least one such trade
  const filteredJournalTrades = useMemo(() => {
    const rMin = filterRMin !== "" ? parseFloat(filterRMin) : null;
    const rMax = filterRMax !== "" ? parseFloat(filterRMax) : null;
    const hasR = (rMin != null && !Number.isNaN(rMin)) || (rMax != null && !Number.isNaN(rMax));
    const entryById = new Map(journalEntries.map((e) => [e.id, e]));
    return journalTrades.filter((t) => {
      const entry = entryById.get(t.journal_entry_id);
      if (!entry) return false;
      if (filterStrategyIds.length > 0) {
        const sids = filterStrategyIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n));
        if (sids.length > 0 && (entry.strategy_id == null || !sids.includes(entry.strategy_id))) return false;
      }
      if (filterSymbols.length > 0) {
        const match = t.symbol != null && filterSymbols.some(
          (s) => t.symbol === s || getUnderlyingSymbol(t.symbol) === getUnderlyingSymbol(s)
        );
        if (!match) return false;
      }
      if (filterPositions.length > 0) {
        const pos = (t.position ?? "").trim();
        if (!pos || !filterPositions.includes(pos)) return false;
      }
      if (filterTimeframes.length > 0) {
        const tf = (t.timeframe ?? "").trim();
        if (!tf || !filterTimeframes.includes(tf)) return false;
      }
      if (hasR && t.r_multiple != null) {
        if (rMin != null && !Number.isNaN(rMin) && t.r_multiple < rMin) return false;
        if (rMax != null && !Number.isNaN(rMax) && t.r_multiple > rMax) return false;
      }
      return true;
    });
  }, [journalTrades, journalEntries, filterStrategyIds, filterSymbols, filterPositions, filterTimeframes, filterRMin, filterRMax]);
  const filteredJournalEntries = useMemo(() => {
    const entryIds = new Set(filteredJournalTrades.map((t) => t.journal_entry_id));
    return journalEntries.filter((e) => entryIds.has(e.id));
  }, [journalEntries, filteredJournalTrades]);

  const processJournalData = () => {
    if (filteredJournalEntries.length === 0 && filteredJournalTrades.length === 0) {
      return {
        entriesByMonth: [] as { month: string; count: number }[],
        positionsData: [] as { position: string; count: number }[],
        outcomeData: [] as { outcome: string; count: number }[],
      };
    }

    const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
    const start = dateRange.start;
    const end = dateRange.end;

    const entriesInRange = filteredJournalEntries.filter((entry) => {
      if (!entry.date) return false;
      const d = new Date(entry.date + "T00:00:00");
      if (isNaN(d.getTime())) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });

    const entryIdsInRange = new Set(entriesInRange.map((e) => e.id));

    const tradesInRange = filteredJournalTrades.filter((t) => entryIdsInRange.has(t.journal_entry_id));

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

  const strategyFindingsData = useMemo(() => {
    const tradesByStrategy = (strategyPerformance ?? [])
      .filter((p) => p.trade_count > 0)
      .map((p) => ({ name: p.strategy_name || "Unassigned", count: p.trade_count }))
      .sort((a, b) => b.count - a.count);
    const profitableTradesByStrategy = (strategyPerformance ?? [])
      .filter((p) => p.trade_count > 0)
      .map((p) => ({
        name: p.strategy_name || "Unassigned",
        winning: p.winning_trades ?? 0,
        losing: (p.trade_count ?? 0) - (p.winning_trades ?? 0),
      }))
      .sort((a, b) => b.winning + b.losing - (a.winning + a.losing));
    const profitByStrategy = (strategyPerformance ?? [])
      .filter((p) => p.trade_count > 0)
      .map((p) => ({ name: p.strategy_name || "Unassigned", profit: p.estimated_pnl ?? 0 }))
      .sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit));
    return { tradesByStrategy, profitableTradesByStrategy, profitByStrategy };
  }, [strategyPerformance, checklistItemMetrics]);

  const emotionalFindingsData = useMemo(() => {
    const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
    const start = dateRange.start;
    const end = dateRange.end;
    const inRange = emotionalStates.filter((s) => {
      const d = new Date(s.timestamp);
      if (isNaN(d.getTime())) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
    const byEmotion = new Map<string, { count: number; totalIntensity: number }>();
    inRange.forEach((s) => {
      const name = (s.emotion || "Unspecified").trim();
      const cur = byEmotion.get(name) ?? { count: 0, totalIntensity: 0 };
      byEmotion.set(name, { count: cur.count + 1, totalIntensity: cur.totalIntensity + (s.intensity ?? 0) });
    });
    const emotionsByType = Array.from(byEmotion.entries())
      .map(([name, v]) => ({ name, count: v.count }))
      .sort((a, b) => b.count - a.count);
    const byMonth = new Map<string, number>();
    inRange.forEach((s) => {
      const d = new Date(s.timestamp);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) || 0) + 1);
    });
    const emotionsOverTime = Array.from(byMonth.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const avgIntensityByEmotion = Array.from(byEmotion.entries())
      .map(([name, v]) => ({ name, avgIntensity: v.count > 0 ? v.totalIntensity / v.count : 0 }))
      .filter((e) => e.avgIntensity > 0)
      .sort((a, b) => b.avgIntensity - a.avgIntensity);
    return { emotionsByType, emotionsOverTime, avgIntensityByEmotion };
  }, [emotionalStates, timeframe, customStartDate, customEndDate]);

  // Trade Findings: link trades, strategies, journal entries, and emotional states in the selected period
  const tradeFindingsData = useMemo(() => {
    const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
    const start = dateRange.start;
    const end = dateRange.end;
    const inRange = (d: Date) => {
      if (isNaN(d.getTime())) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    };
    const tradesInPeriod = filteredTrades.filter((t) => inRange(new Date(t.timestamp)));
    const totalTrades = tradesInPeriod.length;
    const withStrategy = tradesInPeriod.filter((t) => t.strategy_id != null).length;
    const journalEntriesInPeriod = filteredJournalEntries.filter((e) => e.date && inRange(new Date(e.date + "T00:00:00"))).length;
    const emotionalInPeriod = emotionalStates.filter((s) => inRange(new Date(s.timestamp))).length;
    const coverageChartData = [
      { name: "Total trades", value: totalTrades, fill: "var(--accent)" },
      { name: "With strategy", value: withStrategy, fill: "var(--accent)" },
      { name: "Journal entries", value: journalEntriesInPeriod, fill: "var(--accent)" },
      { name: "Emotional states", value: emotionalInPeriod, fill: "var(--accent)" },
    ];
    return { totalTrades, withStrategy, journalEntriesInPeriod, emotionalInPeriod, coverageChartData };
  }, [filteredTrades, filteredJournalEntries, emotionalStates, timeframe, customStartDate, customEndDate]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading analytics...</p>
      </div>
    );
  }

  const journalData = processJournalData();
  const entriesByMonth = journalData?.entriesByMonth ?? [];
  const positionsData = journalData?.positionsData ?? [];
  const outcomeData = journalData?.outcomeData ?? [];

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

      {/* Filters section: card-style container, Trade and Journal side-by-side to use horizontal space */}
      <div
        ref={filtersBarRef}
        style={{
          marginBottom: "30px",
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "12px 14px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "600", margin: 0, color: "var(--text-primary)" }}>Filters</h2>
          {hasAnyFilter && (
            <button
              type="button"
              onClick={resetFilters}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                color: "var(--text-secondary)",
                background: "transparent",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          )}
        </div>
        {(() => {
          const dropdownStyle: React.CSSProperties = {
            padding: "5px 8px",
            fontSize: "12px",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            color: "var(--text-primary)",
            minWidth: "90px",
            cursor: "pointer",
            textAlign: "left",
          };
          const popoverStyle: React.CSSProperties = {
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: "2px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            padding: "6px",
            maxHeight: "200px",
            overflowY: "auto",
            zIndex: 20,
          };
          const inputGroupStyle: React.CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: "4px",
          };
          const numInputStyle: React.CSSProperties = {
            width: "56px",
            padding: "5px 6px",
            backgroundColor: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            color: "var(--text-primary)",
            fontSize: "12px",
            outline: "none",
          };
          const renderMultiSelect = (
            key: string,
            label: string,
            options: { value: string; label: string }[],
            selected: string[],
            toggle: (value: string) => void
          ) => (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setOpenFilterDropdown((k) => (k === key ? null : key))}
                style={dropdownStyle}
              >
                {label}{selected.length > 0 ? ` (${selected.length})` : ""}
              </button>
              {openFilterDropdown === key && (
                <div style={popoverStyle}>
                  {options.map((opt) => (
                    <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", padding: "2px 0" }}>
                      <input
                        type="checkbox"
                        checked={selected.includes(opt.value)}
                        onChange={() => toggle(opt.value)}
                      />
                      <span style={{ fontSize: "12px" }}>{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
          const renderMulti = (
            key: string,
            label: string,
            options: string[],
            selected: string[],
            toggle: (value: string) => void
          ) => (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setOpenFilterDropdown((k) => (k === key ? null : key))}
                style={dropdownStyle}
              >
                {label}{selected.length > 0 ? ` (${selected.length})` : ""}
              </button>
              {openFilterDropdown === key && (
                <div style={popoverStyle}>
                  {options.map((opt) => (
                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", padding: "2px 0" }}>
                      <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
                      <span style={{ fontSize: "12px" }}>{opt}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
          const sectionLabelStyle: React.CSSProperties = {
            fontSize: "11px",
            fontWeight: "600",
            color: "var(--text-secondary)",
            marginBottom: "6px",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          };
          const rowStyle: React.CSSProperties = {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "8px 12px",
          };
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 24px", alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                <div style={sectionLabelStyle}>Trade</div>
                <div style={rowStyle}>
                  {renderMultiSelect(
                    "strategy",
                    "Strategy",
                    (filterOptions.strategies ?? []).filter((s) => s.id != null).map((s) => ({ value: String(s.id), label: s.name ?? "" })),
                    filterStrategyIds,
                    (val) => setFilterStrategyIds((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]))
                  )}
                  {renderMultiSelect(
                    "symbol",
                    "Symbol",
                    (filterOptions.symbols ?? []).map((s) => ({ value: s, label: s })),
                    filterSymbols,
                    (val) => setFilterSymbols((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]))
                  )}
                  {renderMultiSelect(
                    "side",
                    "Side",
                    filterOptions.sides.map((s) => ({ value: s, label: s })),
                    filterSides,
                    (val) => setFilterSides((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]))
                  )}
                  {renderMultiSelect(
                    "type",
                    "Type",
                    filterOptions.types.map((t) => ({ value: t, label: t })),
                    filterTypes,
                    (val) => setFilterTypes((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]))
                  )}
                  <div style={inputGroupStyle}>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Size $</span>
                    <input
                      type="number"
                      placeholder="Min"
                      value={filterPositionSizeMin}
                      onChange={(e) => setFilterPositionSizeMin(e.target.value)}
                      style={numInputStyle}
                      step="any"
                    />
                    <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>–</span>
                    <input
                      type="number"
                      placeholder="Max"
                      value={filterPositionSizeMax}
                      onChange={(e) => setFilterPositionSizeMax(e.target.value)}
                      style={numInputStyle}
                      step="any"
                    />
                  </div>
                </div>
              </div>
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <div style={sectionLabelStyle}>Journal</div>
                <div style={rowStyle}>
                  {renderMulti("position", "Position", filterOptions.positions ?? [], filterPositions, (val) => setFilterPositions((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val])))}
                  {renderMulti("timeframe", "Timeframe", filterOptions.timeframes ?? [], filterTimeframes, (val) => setFilterTimeframes((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val])))}
                  <div style={inputGroupStyle}>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>R</span>
                    <input
                      type="number"
                      placeholder="Min"
                      value={filterRMin}
                      onChange={(e) => setFilterRMin(e.target.value)}
                      style={{ ...numInputStyle, width: "48px" }}
                      step="any"
                    />
                    <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>–</span>
                    <input
                      type="number"
                      placeholder="Max"
                      value={filterRMax}
                      onChange={(e) => setFilterRMax(e.target.value)}
                      style={{ ...numInputStyle, width: "48px" }}
                      step="any"
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
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
          {equityCurve && Array.isArray(equityCurve.equity_points) && equityCurve.equity_points.length > 0 && (
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
                <div style={{ display: "flex", alignItems: "center", gap: "8px", position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setExpandedChartId("equity")}
                    style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "6px", color: "var(--text-primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    title="Expand chart"
                  >
                    <Maximize2 size={16} />
                  </button>
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
                const equityUseBrush = equityChartData.length >= BRUSH_SHOW_MIN;
                const equityBrushStartClamped =
                  equityUseBrush && equityBrushEnd > 0
                    ? Math.min(equityBrushStart, equityChartData.length - 1)
                    : 0;
                const equityBrushEndClamped =
                  equityUseBrush && equityBrushEnd > 0
                    ? Math.min(equityChartData.length - 1, Math.max(equityBrushStartClamped, equityBrushEnd))
                    : Math.max(0, equityChartData.length - 1);
                const n = equityChartData.length;
                const displayData = equityBrushEnd > 0 ? equityChartData.slice(equityBrushStartClamped, equityBrushEndClamped + 1) : equityChartData;
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
                const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const formatBrushDate = (dateStr: string) => {
                  const [y, m, d] = (dateStr || "").split("-").map(Number);
                  if (!m || !d) return dateStr;
                  return `${MONTHS[(m || 1) - 1]} ${d}, ${y}`;
                };
                const leftPct = n <= 1 ? 0 : equityBrushDrag?.which === "slide" ? equityBrushDrag.startPct : (equityBrushDrag?.which === "left" ? equityBrushDrag.position : (equityBrushEnd > 0 ? equityBrushStartClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : equityBrushDrag?.which === "slide" ? equityBrushDrag.endPct : (equityBrushDrag?.which === "right" ? equityBrushDrag.position : (equityBrushEnd > 0 ? equityBrushEndClamped / (n - 1) : 1));
                const startDragLeft = () => {
                  const rect = equitySliderTrackRef.current?.getBoundingClientRect() ?? null;
                  equitySliderDragRef.current = { which: "left", bound: rightPct, n, wasFullRange: equityBrushEnd === 0, position: leftPct, trackRect: rect };
                  setEquityBrushDrag({ which: "left", position: leftPct });
                  document.addEventListener("mousemove", handleEquitySliderMove as EventListener, true);
                  document.addEventListener("mouseup", handleEquitySliderUp, true);
                  document.addEventListener("touchmove", handleEquitySliderMove as EventListener, { capture: true, passive: false });
                  document.addEventListener("touchend", handleEquitySliderUp, true);
                };
                const startDragRight = () => {
                  const rect = equitySliderTrackRef.current?.getBoundingClientRect() ?? null;
                  equitySliderDragRef.current = { which: "right", bound: leftPct, n, wasFullRange: equityBrushEnd === 0, position: rightPct, trackRect: rect };
                  setEquityBrushDrag({ which: "right", position: rightPct });
                  document.addEventListener("mousemove", handleEquitySliderMove as EventListener, true);
                  document.addEventListener("mouseup", handleEquitySliderUp, true);
                  document.addEventListener("touchmove", handleEquitySliderMove as EventListener, { capture: true, passive: false });
                  document.addEventListener("touchend", handleEquitySliderUp, true);
                };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => {
                  e.preventDefault();
                  const rect = equitySliderTrackRef.current?.getBoundingClientRect() ?? null;
                  const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
                  if (!rect || rect.width <= 0) return;
                  const initialStartPct = leftPct;
                  const initialEndPct = rightPct;
                  equitySliderDragRef.current = { which: "slide", initialStartPct, initialEndPct, initialClientX: clientX, trackRect: rect, n, startPct: initialStartPct, endPct: initialEndPct };
                  setEquityBrushDrag({ which: "slide", startPct: initialStartPct, endPct: initialEndPct });
                  document.addEventListener("mousemove", handleEquitySliderMove as EventListener, true);
                  document.addEventListener("mouseup", handleEquitySliderUp, true);
                  document.addEventListener("touchmove", handleEquitySliderMove as EventListener, { capture: true, passive: false });
                  document.addEventListener("touchend", handleEquitySliderUp, true);
                };
                const displayStartIdx = Math.min(n - 1, Math.max(0, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.min(n - 1, Math.max(0, Math.round(rightPct * (n - 1))));
                const displayStartDate = equityChartData[displayStartIdx]?.date ? formatBrushDate(equityChartData[displayStartIdx].date) : "";
                const displayEndDate = equityChartData[displayEndIdx]?.date ? formatBrushDate(equityChartData[displayEndIdx].date) : "";
                return (
              <div style={{ width: "100%" }}>
                <ResponsiveContainer width="100%" height={equityUseBrush ? 404 : 400}>
                  <LineChart data={displayData}>
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
                  </LineChart>
                </ResponsiveContainer>
                {equityUseBrush && (
                  <div
                    ref={equitySliderTrackRef}
                    role="slider"
                    aria-label="Equity curve range"
                    style={{ height: 36, marginTop: 4, position: "relative", width: "100%", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 4 }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onMouseDown={startDragSlide}
                      onTouchStart={startDragSlide}
                      style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }}
                      title="Drag to pan range"
                    />
                    <span style={{ position: "absolute", left: `calc(${leftPct * 100}% + 12px)`, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-secondary)", pointerEvents: "none", zIndex: 2 }}>{displayStartDate}</span>
                    <span style={{ position: "absolute", right: `calc(${(1 - rightPct) * 100}% + 12px)`, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-secondary)", pointerEvents: "none", zIndex: 2 }}>{displayEndDate}</span>
                    <div role="button" tabIndex={0} onMouseDown={(e) => { e.preventDefault(); startDragLeft(); }} onTouchStart={(e) => { e.preventDefault(); startDragLeft(); }} style={{ position: "absolute", left: `calc(${leftPct * 100}% - 6px)`, top: 0, width: 12, height: 36, backgroundColor: "var(--border-color)", cursor: "ew-resize", borderRadius: 2, zIndex: 3, touchAction: "none" }} />
                    <div role="button" tabIndex={0} onMouseDown={(e) => { e.preventDefault(); startDragRight(); }} onTouchStart={(e) => { e.preventDefault(); startDragRight(); }} style={{ position: "absolute", left: `calc(${rightPct * 100}% - 6px)`, top: 0, width: 12, height: 36, backgroundColor: "var(--border-color)", cursor: "ew-resize", borderRadius: 2, zIndex: 3, touchAction: "none" }} />
                  </div>
                )}
              </div>
                );
              })()}
            </div>
          )}

          {/* Daily P&L Distribution — histogram of daily returns in selected timeframe */}
          {equityCurve && Array.isArray(equityCurve.equity_points) && equityCurve.equity_points.length > 0 && (
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "20px 20px 12px 20px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "4px" }}>
                    Daily P&L Distribution
                  </h2>
                  <p style={{ color: "var(--text-secondary)", fontSize: "12px", margin: 0 }}>
                    How often you make or lose money in a day — useful for understanding consistency and risk.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedChartId("daily-pnl-dist")}
                  style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "6px", color: "var(--text-primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  title="Expand chart"
                >
                  <Maximize2 size={16} />
                </button>
              </div>
              {dailyPnlDistributionData.length === 0 ? (
                <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                  No daily P&L data in the selected timeframe.
                </p>
              ) : (() => {
                const d = dailyPnlDistributionData;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const start = useBrush && dailyPnlBrushEnd > 0 ? Math.min(dailyPnlBrushStart, d.length - 1) : 0;
                const end = useBrush && dailyPnlBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, dailyPnlBrushEnd)) : Math.max(0, d.length - 1);
                const visibleSlice = useBrush ? d.slice(start, end + 1) : d;
                return (
                <ResponsiveContainer width="100%" height={useBrush ? 356 : 320}>
                  <BarChart data={d} margin={{ top: 8, right: 8, left: 0, bottom: 72 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="range" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={56} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} label={{ value: "Number of days", angle: -90, position: "insideLeft", style: { fill: "var(--text-secondary)", fontSize: 12 } }} />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.02)" }}
                      contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                      formatter={(value: unknown) => [value as ReactNode, "Days"]}
                      labelFormatter={(label) => `P&L range: ${label}`}
                    />
                    <Bar dataKey="count" fillOpacity={BAR_FILL_OPACITY} strokeWidth={1}>
                      {visibleSlice.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.isPositive ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} stroke={entry.isPositive ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} />
                      ))}
                    </Bar>
                    {useBrush && (
                      <Brush dataKey="range" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={d} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setDailyPnlBrushStart(r.startIndex); setDailyPnlBrushEnd(r.endIndex); } }} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
                );
              })()}
            </div>
          )}

          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px 20px 12px 20px",
            }}
          >
            <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "4px" }}>
              Trade findings
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "12px", margin: 0, marginBottom: "16px" }}>
              How your trades connect to strategies, journal entries, and emotional states in the selected period.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
              <div style={{ padding: "12px 14px", backgroundColor: "var(--bg-tertiary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Total trades</div>
                <div style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-primary)" }}>{tradeFindingsData.totalTrades}</div>
              </div>
              <div style={{ padding: "12px 14px", backgroundColor: "var(--bg-tertiary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>With strategy</div>
                <div style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-primary)" }}>{tradeFindingsData.withStrategy}</div>
              </div>
              <div style={{ padding: "12px 14px", backgroundColor: "var(--bg-tertiary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Journal entries</div>
                <div style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-primary)" }}>{tradeFindingsData.journalEntriesInPeriod}</div>
              </div>
              <div style={{ padding: "12px 14px", backgroundColor: "var(--bg-tertiary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Emotional states</div>
                <div style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-primary)" }}>{tradeFindingsData.emotionalInPeriod}</div>
              </div>
            </div>
            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Data coverage</h3>
                <button type="button" onClick={() => setExpandedChartId("trade-coverage")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
              </div>
              {(() => {
                const cov = tradeFindingsData.coverageChartData;
                const useBrush = cov.length >= BRUSH_SHOW_MIN;
                const start = useBrush && coverageChartBrushEnd > 0 ? Math.min(coverageChartBrushStart, cov.length - 1) : 0;
                const end = useBrush && coverageChartBrushEnd > 0 ? Math.min(cov.length - 1, Math.max(start, coverageChartBrushEnd)) : Math.max(0, cov.length - 1);
                return (
              <ResponsiveContainer width="100%" height={useBrush ? 316 : 280}>
                <BarChart data={cov} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                  <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.02)" }}
                    contentStyle={{
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-primary)",
                    }}
                    formatter={(value: unknown) => [value as ReactNode, "Count"]}
                  />
                  <Bar dataKey="value" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                  {useBrush && (
                    <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={cov} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setCoverageChartBrushStart(r.startIndex); setCoverageChartBrushEnd(r.endIndex); } }} />
                  )}
                </BarChart>
              </ResponsiveContainer>
                );
              })()}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "24px", marginBottom: "24px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Trades by Symbol (top {TOP_CATEGORIES})</h3>
                  <button type="button" onClick={() => setExpandedChartId("trade-symbol")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                </div>
                {tradeFindingsTradesBySymbol.length === 0 ? (
                  <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>No trade data in the selected timeframe.</p>
                ) : (() => {
                  const d = tradeFindingsTradesBySymbol;
                  const useBrush = d.length >= BRUSH_SHOW_MIN;
                  const start = useBrush && tradeSymbolBrushEnd > 0 ? Math.min(tradeSymbolBrushStart, d.length - 1) : 0;
                  const end = useBrush && tradeSymbolBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, tradeSymbolBrushEnd)) : Math.max(0, d.length - 1);
                  return (
                  <ResponsiveContainer width="100%" height={useBrush ? STRATEGY_CHART_HEIGHT + 40 : STRATEGY_CHART_HEIGHT}>
                    <BarChart data={d} margin={STRATEGY_CHART_MARGIN}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis dataKey="symbol" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                      <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                      <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Trades"]} />
                      <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                      {useBrush && (
                        <Brush dataKey="symbol" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={d} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setTradeSymbolBrushStart(r.startIndex); setTradeSymbolBrushEnd(r.endIndex); } }} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                  );
                })()}
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Profit & Loss by Symbol (top {TOP_CATEGORIES})</h3>
                  <button type="button" onClick={() => setExpandedChartId("trade-pnl")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                </div>
                {tradeFindingsPnLBySymbol.length === 0 ? (
                  <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>No P&L data in the selected timeframe.</p>
                ) : (() => {
                  const d = tradeFindingsPnLBySymbol;
                  const useBrush = d.length >= BRUSH_SHOW_MIN;
                  const start = useBrush && tradePnlBrushEnd > 0 ? Math.min(tradePnlBrushStart, d.length - 1) : 0;
                  const end = useBrush && tradePnlBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, tradePnlBrushEnd)) : Math.max(0, d.length - 1);
                  const visibleSlice = useBrush ? d.slice(start, end + 1) : d;
                  return (
                  <ResponsiveContainer width="100%" height={useBrush ? STRATEGY_CHART_HEIGHT + 40 : STRATEGY_CHART_HEIGHT}>
                    <BarChart data={d} margin={STRATEGY_CHART_MARGIN}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                      <YAxis stroke="var(--text-secondary)" tickFormatter={(v) => typeof v === "number" ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v)) : String(v)} />
                      <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [(typeof value === "number" ? formatWithCommas(value) : value) as ReactNode, "Net P&L"]} />
                      <Bar dataKey="value" fillOpacity={BAR_FILL_OPACITY} strokeWidth={1}>
                        {visibleSlice.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.value >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} stroke={entry.value >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} />
                        ))}
                      </Bar>
                      {useBrush && (
                        <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={d} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setTradePnlBrushStart(r.startIndex); setTradePnlBrushEnd(r.endIndex); } }} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                  );
                })()}
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px 20px 12px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "600", margin: 0, marginBottom: "4px" }}>
                  Strategy findings
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "12px", margin: 0 }}>
                  Patterns from strategy parameters and checklist usage compared to your trades. For more details, see the{" "}
                  <Link
                    to="/strategies"
                    style={{ color: "var(--accent)", fontWeight: "500", textDecoration: "none" }}
                    onMouseOver={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                    onMouseOut={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                  >
                    strategy overview
                  </Link>
                  {" "}page.
                </p>
              </div>
              <Link
                to="/strategies"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
                  color: "var(--accent)",
                  fontSize: "12px",
                  fontWeight: "500",
                  textDecoration: "none",
                  border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
                  transition: "background-color 0.15s ease, border-color 0.15s ease",
                  flexShrink: 0,
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--accent) 28%, transparent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 55%, transparent)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--accent) 18%, transparent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 40%, transparent)";
                }}
              >
                Strategy overview
                <ChevronRight size={14} style={{ flexShrink: 0 }} />
              </Link>
            </div>
            {strategyPerformance.length === 0 && checklistItemMetrics.length === 0 ? (
              <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                Assign strategies to trades and use checklists in journal entries to see findings here.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Trades by strategy</h3>
                    <button type="button" onClick={() => setExpandedChartId("strategy-trades")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                  </div>
                  {strategyFindingsData.tradesByStrategy.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No trades with strategies in the selected timeframe.
                    </p>
                  ) : (() => {
                    const d = strategyFindingsData.tradesByStrategy;
                    const useBrush = d.length >= BRUSH_SHOW_MIN;
                    const start = useBrush && strategyTradesBrushEnd > 0 ? Math.min(strategyTradesBrushStart, d.length - 1) : 0;
                    const end = useBrush && strategyTradesBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, strategyTradesBrushEnd)) : Math.max(0, d.length - 1);
                    return (
                    <ResponsiveContainer width="100%" height={useBrush ? STRATEGY_CHART_HEIGHT + 40 : STRATEGY_CHART_HEIGHT}>
                      <BarChart data={d} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Trades"]} />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                        {useBrush && (
                          <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={d} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setStrategyTradesBrushStart(r.startIndex); setStrategyTradesBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                    );
                  })()}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Profitable trades by strategy</h3>
                    <button type="button" onClick={() => setExpandedChartId("strategy-profitable")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                  </div>
                  {strategyFindingsData.profitableTradesByStrategy.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No profitable trades in the selected timeframe.
                    </p>
                  ) : (() => {
                    const d = strategyFindingsData.profitableTradesByStrategy;
                    const useBrush = d.length >= BRUSH_SHOW_MIN;
                    const start = useBrush && strategyProfitableBrushEnd > 0 ? Math.min(strategyProfitableBrushStart, d.length - 1) : 0;
                    const end = useBrush && strategyProfitableBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, strategyProfitableBrushEnd)) : Math.max(0, d.length - 1);
                    return (
                    <ResponsiveContainer width="100%" height={useBrush ? STRATEGY_CHART_HEIGHT + 40 : STRATEGY_CHART_HEIGHT}>
                      <BarChart data={d} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, ""]} labelFormatter={(label) => `${label} (Winning / Losing)`} />
                        <Bar dataKey="winning" fill="var(--success, #22c55e)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--success, #22c55e)" strokeWidth={1} />
                        <Bar dataKey="losing" fill="var(--danger, #ef4444)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--danger, #ef4444)" strokeWidth={1} />
                        {useBrush && (
                          <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={d} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setStrategyProfitableBrushStart(r.startIndex); setStrategyProfitableBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                    );
                  })()}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Profit by strategy</h3>
                    <button type="button" onClick={() => setExpandedChartId("strategy-profit")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                  </div>
                  {strategyFindingsData.profitByStrategy.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No profit data in the selected timeframe.
                    </p>
                  ) : (() => {
                    const d = strategyFindingsData.profitByStrategy;
                    const useBrush = d.length >= BRUSH_SHOW_MIN;
                    const start = useBrush && strategyProfitBrushEnd > 0 ? Math.min(strategyProfitBrushStart, d.length - 1) : 0;
                    const end = useBrush && strategyProfitBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, strategyProfitBrushEnd)) : Math.max(0, d.length - 1);
                    const visibleSlice = useBrush ? d.slice(start, end + 1) : d;
                    return (
                    <ResponsiveContainer width="100%" height={useBrush ? STRATEGY_CHART_HEIGHT + 40 : STRATEGY_CHART_HEIGHT}>
                      <BarChart data={d} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                        <YAxis stroke="var(--text-secondary)" tickFormatter={(v) => typeof v === "number" ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v)) : String(v)} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [(typeof value === "number" ? formatWithCommas(value) : value) as ReactNode, "Profit"]} />
                        <Bar dataKey="profit" fillOpacity={BAR_FILL_OPACITY} strokeWidth={1}>
                          {visibleSlice.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} stroke={entry.profit >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} />
                          ))}
                        </Bar>
                        {useBrush && (
                          <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={d} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setStrategyProfitBrushStart(r.startIndex); setStrategyProfitBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "600", margin: 0, marginBottom: "4px" }}>
                  Journal findings
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "12px", margin: 0 }}>
                  For more specific details, visit the{" "}
                  <Link
                    to="/journal?overview=1"
                    style={{ color: "var(--accent)", fontWeight: "500", textDecoration: "none" }}
                    onMouseOver={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                    onMouseOut={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                  >
                    Journal Overview
                  </Link>
                  {" "}page.
                </p>
              </div>
              <Link
                to="/journal?overview=1"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
                  color: "var(--accent)",
                  fontSize: "12px",
                  fontWeight: "500",
                  textDecoration: "none",
                  border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
                  transition: "background-color 0.15s ease, border-color 0.15s ease",
                  flexShrink: 0,
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--accent) 28%, transparent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 55%, transparent)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--accent) 18%, transparent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 40%, transparent)";
                }}
              >
                Journal overview
                <ChevronRight size={14} style={{ flexShrink: 0 }} />
              </Link>
            </div>
            {journalEntries.length === 0 ? (
              <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                No journal entries found. Create journal entries to see journaling trends alongside your trading analytics.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "24px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Entries over time</h3>
                    <button type="button" onClick={() => setExpandedChartId("journal-entries")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                  </div>
                  {entriesByMonth.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No entries in the selected timeframe.
                    </p>
                  ) : (
                    (() => {
                      const useBrush = entriesByMonth.length >= BRUSH_SHOW_MIN;
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
                          <Brush dataKey="month" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={entriesByMonth} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setEntriesChartBrushStart(r.startIndex); setEntriesChartBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                      );
                    })()
                  )}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Trade types in journals</h3>
                    <button type="button" onClick={() => setExpandedChartId("journal-positions")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                  </div>
                  {positionsData.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No implementation trades recorded in your journals for this timeframe.
                    </p>
                  ) : (
                    (() => {
                      const useBrush = positionsData.length >= BRUSH_SHOW_MIN;
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
                          <Brush dataKey="position" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={positionsData} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setPositionsChartBrushStart(r.startIndex); setPositionsChartBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                      );
                    })()
                  )}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Outcomes in journals</h3>
                    <button type="button" onClick={() => setExpandedChartId("journal-outcomes")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                  </div>
                  {outcomeData.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No outcomes recorded in your journals for this timeframe.
                    </p>
                  ) : (
                    (() => {
                      const useBrush = outcomeData.length >= BRUSH_SHOW_MIN;
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
                          <Brush dataKey="outcome" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={outcomeData} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setOutcomeChartBrushStart(r.startIndex); setOutcomeChartBrushEnd(r.endIndex); } }} />
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

          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px 20px 12px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "600", margin: 0, marginBottom: "4px" }}>
                  Emotional findings
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "12px", margin: 0 }}>
                  Patterns from logged emotional states. For more details, visit the{" "}
                  <Link
                    to="/emotions"
                    style={{ color: "var(--accent)", fontWeight: "500", textDecoration: "none" }}
                    onMouseOver={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                    onMouseOut={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                  >
                    Emotions
                  </Link>
                  {" "}page.
                </p>
              </div>
              <Link
                to="/emotions"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
                  color: "var(--accent)",
                  fontSize: "12px",
                  fontWeight: "500",
                  textDecoration: "none",
                  border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
                  transition: "background-color 0.15s ease, border-color 0.15s ease",
                  flexShrink: 0,
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--accent) 28%, transparent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 55%, transparent)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--accent) 18%, transparent)";
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 40%, transparent)";
                }}
              >
                Emotions
                <ChevronRight size={14} style={{ flexShrink: 0 }} />
              </Link>
            </div>
            {emotionalStates.length === 0 ? (
              <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                No emotional states logged. Log emotions on the Emotions page or in journal entries to see findings here.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Emotions by type</h3>
                    <button type="button" onClick={() => setExpandedChartId("emotion-type")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                  </div>
                  {emotionalFindingsData.emotionsByType.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No emotional data in the selected timeframe.
                    </p>
                  ) : (() => {
                    const d = emotionalFindingsData.emotionsByType;
                    const useBrush = d.length >= BRUSH_SHOW_MIN;
                    const start = useBrush && emotionTypeBrushEnd > 0 ? Math.min(emotionTypeBrushStart, d.length - 1) : 0;
                    const end = useBrush && emotionTypeBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, emotionTypeBrushEnd)) : Math.max(0, d.length - 1);
                    return (
                    <ResponsiveContainer width="100%" height={useBrush ? STRATEGY_CHART_HEIGHT + 40 : STRATEGY_CHART_HEIGHT}>
                      <BarChart data={d} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Count"]} />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                        {useBrush && (
                          <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={d} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setEmotionTypeBrushStart(r.startIndex); setEmotionTypeBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                    );
                  })()}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Emotional states over time</h3>
                    <button type="button" onClick={() => setExpandedChartId("emotion-time")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                  </div>
                  {emotionalFindingsData.emotionsOverTime.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No emotional data in the selected timeframe.
                    </p>
                  ) : (() => {
                    const d = emotionalFindingsData.emotionsOverTime;
                    const useBrush = d.length >= BRUSH_SHOW_MIN;
                    const start = useBrush && emotionTimeBrushEnd > 0 ? Math.min(emotionTimeBrushStart, d.length - 1) : 0;
                    const end = useBrush && emotionTimeBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, emotionTimeBrushEnd)) : Math.max(0, d.length - 1);
                    return (
                    <ResponsiveContainer width="100%" height={useBrush ? STRATEGY_CHART_HEIGHT + 40 : STRATEGY_CHART_HEIGHT}>
                      <BarChart data={d} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="month" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "States"]} />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                        {useBrush && (
                          <Brush dataKey="month" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={d} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setEmotionTimeBrushStart(r.startIndex); setEmotionTimeBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                    );
                  })()}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Average intensity by emotion</h3>
                    <button type="button" onClick={() => setExpandedChartId("emotion-intensity")} style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px", color: "var(--text-primary)", cursor: "pointer", display: "flex" }} title="Expand chart"><Maximize2 size={14} /></button>
                  </div>
                  {emotionalFindingsData.avgIntensityByEmotion.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No intensity data in the selected timeframe.
                    </p>
                  ) : (() => {
                    const d = emotionalFindingsData.avgIntensityByEmotion;
                    const useBrush = d.length >= BRUSH_SHOW_MIN;
                    const start = useBrush && emotionIntensityBrushEnd > 0 ? Math.min(emotionIntensityBrushStart, d.length - 1) : 0;
                    const end = useBrush && emotionIntensityBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, emotionIntensityBrushEnd)) : Math.max(0, d.length - 1);
                    return (
                    <ResponsiveContainer width="100%" height={useBrush ? STRATEGY_CHART_HEIGHT + 40 : STRATEGY_CHART_HEIGHT}>
                      <BarChart data={d} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                        <YAxis stroke="var(--text-secondary)" domain={[0, 10]} allowDecimals={true} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [(typeof value === "number" ? value.toFixed(1) : value) as ReactNode, "Avg intensity"]} />
                        <Bar dataKey="avgIntensity" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                        {useBrush && (
                          <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" data={d} gap={1} startIndex={start} endIndex={end} onChange={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setEmotionIntensityBrushStart(r.startIndex); setEmotionIntensityBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {expandedChartId && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Expanded chart"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.65)",
            padding: "24px",
          }}
          onClick={() => setExpandedChartId(null)}
        >
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "92vw",
              maxWidth: "92vw",
              minWidth: "85vw",
              maxHeight: "92vh",
              overflow: "auto",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>
                {expandedChartId === "equity" && "Equity Curve & Drawdown"}
                {expandedChartId === "daily-pnl-dist" && "Daily P&L Distribution"}
                {expandedChartId === "trade-coverage" && "Data coverage"}
                {expandedChartId === "trade-symbol" && "Trades by Symbol"}
                {expandedChartId === "trade-pnl" && "Profit & Loss by Symbol"}
                {expandedChartId === "strategy-trades" && "Trades by strategy"}
                {expandedChartId === "strategy-profitable" && "Profitable trades by strategy"}
                {expandedChartId === "strategy-profit" && "Profit by strategy"}
                {expandedChartId === "journal-entries" && "Entries over time"}
                {expandedChartId === "journal-positions" && "Trade types in journals"}
                {expandedChartId === "journal-outcomes" && "Outcomes in journals"}
                {expandedChartId === "emotion-type" && "Emotions by type"}
                {expandedChartId === "emotion-time" && "Emotional states over time"}
                {expandedChartId === "emotion-intensity" && "Average intensity by emotion"}
              </h2>
              <button
                type="button"
                onClick={() => setExpandedChartId(null)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                <Minimize2 size={16} /> Close
              </button>
            </div>
            <div style={{ width: "100%", minWidth: "400px", minHeight: EXPANDED_CHART_HEIGHT, height: EXPANDED_CHART_HEIGHT + 88 }}>
              {expandedChartId === "daily-pnl-dist" && dailyPnlDistributionData.length > 0 && (
                <ResponsiveContainer width="100%" height={EXPANDED_CHART_HEIGHT}>
                  <BarChart data={dailyPnlDistributionData} margin={{ top: 8, right: 8, left: 0, bottom: 72 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="range" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={56} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} label={{ value: "Number of days", angle: -90, position: "insideLeft", style: { fill: "var(--text-secondary)", fontSize: 12 } }} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Days"]} labelFormatter={(label) => `P&L range: ${label}`} />
                    <Bar dataKey="count" fillOpacity={BAR_FILL_OPACITY} strokeWidth={1}>
                      {dailyPnlDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.isPositive ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} stroke={entry.isPositive ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              {expandedChartId === "trade-coverage" && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tradeFindingsData.coverageChartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Count"]} />
                    <Bar dataKey="value" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {expandedChartId === "trade-symbol" && (() => {
                const d = fullSymbolData;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && symbolChartBrushEnd > 0 ? Math.min(symbolChartBrushStart, d.length - 1) : 0;
                const end = useBrush && symbolChartBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, symbolChartBrushEnd)) : Math.max(0, d.length - 1);
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (symbolChartBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (symbolChartBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const displayData = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).symbol ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).symbol ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setSymbolChartBrushStart, setEnd: setSymbolChartBrushEnd, wasFullRange: symbolChartBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setSymbolChartBrushStart, setEnd: setSymbolChartBrushEnd, wasFullRange: symbolChartBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setSymbolChartBrushStart, setEnd: setSymbolChartBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={displayData} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="symbol" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Trades"]} />
                    <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "trade-pnl" && expandedPnLBySymbol.length > 0 && (() => {
                const d = expandedPnLBySymbol;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && expandedBrushEnd > 0 ? Math.min(expandedBrushStart, d.length - 1) : 0;
                const end = useBrush && expandedBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, expandedBrushEnd)) : Math.max(0, d.length - 1);
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (expandedBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (expandedBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const visibleSlice = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).name ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).name ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setExpandedBrushStart, setEnd: setExpandedBrushEnd, wasFullRange: expandedBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setExpandedBrushStart, setEnd: setExpandedBrushEnd, wasFullRange: expandedBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setExpandedBrushStart, setEnd: setExpandedBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={visibleSlice} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" tickFormatter={(v) => typeof v === "number" ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v)) : String(v)} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [(typeof value === "number" ? formatWithCommas(value) : value) as ReactNode, "Net P&L"]} />
                    <Bar dataKey="value" fillOpacity={BAR_FILL_OPACITY} strokeWidth={1}>
                      {visibleSlice.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.value >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} stroke={entry.value >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "strategy-trades" && strategyFindingsData.tradesByStrategy.length > 0 && (() => {
                const d = strategyFindingsData.tradesByStrategy;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && strategyTradesBrushEnd > 0 ? Math.min(strategyTradesBrushStart, d.length - 1) : 0;
                const end = useBrush && strategyTradesBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, strategyTradesBrushEnd)) : d.length - 1;
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (strategyTradesBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (strategyTradesBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const displayData = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).name ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).name ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setStrategyTradesBrushStart, setEnd: setStrategyTradesBrushEnd, wasFullRange: strategyTradesBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setStrategyTradesBrushStart, setEnd: setStrategyTradesBrushEnd, wasFullRange: strategyTradesBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setStrategyTradesBrushStart, setEnd: setStrategyTradesBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={displayData} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Trades"]} />
                    <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "strategy-profitable" && strategyFindingsData.profitableTradesByStrategy.length > 0 && (() => {
                const d = strategyFindingsData.profitableTradesByStrategy;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && strategyProfitableBrushEnd > 0 ? Math.min(strategyProfitableBrushStart, d.length - 1) : 0;
                const end = useBrush && strategyProfitableBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, strategyProfitableBrushEnd)) : d.length - 1;
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (strategyProfitableBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (strategyProfitableBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const displayData = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).name ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).name ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setStrategyProfitableBrushStart, setEnd: setStrategyProfitableBrushEnd, wasFullRange: strategyProfitableBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setStrategyProfitableBrushStart, setEnd: setStrategyProfitableBrushEnd, wasFullRange: strategyProfitableBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setStrategyProfitableBrushStart, setEnd: setStrategyProfitableBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={displayData} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, ""]} labelFormatter={(label) => `${label} (Winning / Losing)`} />
                    <Bar dataKey="winning" fill="var(--success, #22c55e)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--success, #22c55e)" strokeWidth={1} />
                    <Bar dataKey="losing" fill="var(--danger, #ef4444)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--danger, #ef4444)" strokeWidth={1} />
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "strategy-profit" && strategyFindingsData.profitByStrategy.length > 0 && (() => {
                const d = strategyFindingsData.profitByStrategy;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && strategyProfitBrushEnd > 0 ? Math.min(strategyProfitBrushStart, d.length - 1) : 0;
                const end = useBrush && strategyProfitBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, strategyProfitBrushEnd)) : d.length - 1;
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (strategyProfitBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (strategyProfitBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const visibleSlice = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).name ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).name ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setStrategyProfitBrushStart, setEnd: setStrategyProfitBrushEnd, wasFullRange: strategyProfitBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setStrategyProfitBrushStart, setEnd: setStrategyProfitBrushEnd, wasFullRange: strategyProfitBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setStrategyProfitBrushStart, setEnd: setStrategyProfitBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={visibleSlice} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" tickFormatter={(v) => typeof v === "number" ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v)) : String(v)} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [(typeof value === "number" ? formatWithCommas(value) : value) as ReactNode, "Profit"]} />
                    <Bar dataKey="profit" fillOpacity={BAR_FILL_OPACITY} strokeWidth={1}>
                      {visibleSlice.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} stroke={entry.profit >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "journal-entries" && entriesByMonth.length > 0 && (() => {
                const d = entriesByMonth;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && entriesChartBrushEnd > 0 ? Math.min(entriesChartBrushStart, d.length - 1) : 0;
                const end = useBrush && entriesChartBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, entriesChartBrushEnd)) : d.length - 1;
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (entriesChartBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (entriesChartBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const displayData = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).month ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).month ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setEntriesChartBrushStart, setEnd: setEntriesChartBrushEnd, wasFullRange: entriesChartBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setEntriesChartBrushStart, setEnd: setEntriesChartBrushEnd, wasFullRange: entriesChartBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setEntriesChartBrushStart, setEnd: setEntriesChartBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={displayData} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="month" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Entries"]} />
                    <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "journal-positions" && positionsData.length > 0 && (() => {
                const d = positionsData;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && positionsChartBrushEnd > 0 ? Math.min(positionsChartBrushStart, d.length - 1) : 0;
                const end = useBrush && positionsChartBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, positionsChartBrushEnd)) : d.length - 1;
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (positionsChartBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (positionsChartBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const displayData = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).position ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).position ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setPositionsChartBrushStart, setEnd: setPositionsChartBrushEnd, wasFullRange: positionsChartBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setPositionsChartBrushStart, setEnd: setPositionsChartBrushEnd, wasFullRange: positionsChartBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setPositionsChartBrushStart, setEnd: setPositionsChartBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={displayData} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="position" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Trades"]} />
                    <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "journal-outcomes" && outcomeData.length > 0 && (() => {
                const d = outcomeData;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && outcomeChartBrushEnd > 0 ? Math.min(outcomeChartBrushStart, d.length - 1) : 0;
                const end = useBrush && outcomeChartBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, outcomeChartBrushEnd)) : d.length - 1;
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (outcomeChartBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (outcomeChartBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const displayData = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).outcome ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).outcome ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setOutcomeChartBrushStart, setEnd: setOutcomeChartBrushEnd, wasFullRange: outcomeChartBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setOutcomeChartBrushStart, setEnd: setOutcomeChartBrushEnd, wasFullRange: outcomeChartBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setOutcomeChartBrushStart, setEnd: setOutcomeChartBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={displayData} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="outcome" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Trades"]} />
                    <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "emotion-type" && emotionalFindingsData.emotionsByType.length > 0 && (() => {
                const d = emotionalFindingsData.emotionsByType;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && emotionTypeBrushEnd > 0 ? Math.min(emotionTypeBrushStart, d.length - 1) : 0;
                const end = useBrush && emotionTypeBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, emotionTypeBrushEnd)) : d.length - 1;
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (emotionTypeBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (emotionTypeBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const displayData = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).name ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).name ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setEmotionTypeBrushStart, setEnd: setEmotionTypeBrushEnd, wasFullRange: emotionTypeBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setEmotionTypeBrushStart, setEnd: setEmotionTypeBrushEnd, wasFullRange: emotionTypeBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setEmotionTypeBrushStart, setEnd: setEmotionTypeBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={displayData} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "Count"]} />
                    <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "emotion-time" && emotionalFindingsData.emotionsOverTime.length > 0 && (() => {
                const d = emotionalFindingsData.emotionsOverTime;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && emotionTimeBrushEnd > 0 ? Math.min(emotionTimeBrushStart, d.length - 1) : 0;
                const end = useBrush && emotionTimeBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, emotionTimeBrushEnd)) : d.length - 1;
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (emotionTimeBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (emotionTimeBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const displayData = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).month ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).month ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setEmotionTimeBrushStart, setEnd: setEmotionTimeBrushEnd, wasFullRange: emotionTimeBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setEmotionTimeBrushStart, setEnd: setEmotionTimeBrushEnd, wasFullRange: emotionTimeBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setEmotionTimeBrushStart, setEnd: setEmotionTimeBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={displayData} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="month" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [value as ReactNode, "States"]} />
                    <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "emotion-intensity" && emotionalFindingsData.avgIntensityByEmotion.length > 0 && (() => {
                const d = emotionalFindingsData.avgIntensityByEmotion;
                const useBrush = d.length >= BRUSH_SHOW_MIN;
                const n = d.length;
                const start = useBrush && emotionIntensityBrushEnd > 0 ? Math.min(emotionIntensityBrushStart, d.length - 1) : 0;
                const end = useBrush && emotionIntensityBrushEnd > 0 ? Math.min(d.length - 1, Math.max(start, emotionIntensityBrushEnd)) : d.length - 1;
                const startClamped = Math.max(0, Math.min(n - 1, start));
                const endClamped = Math.max(startClamped, Math.min(n - 1, end));
                const leftPct = n <= 1 ? 0 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.startPct : (expandedSliderDrag?.which === "left" ? expandedSliderDrag.position : (emotionIntensityBrushEnd > 0 ? startClamped / (n - 1) : 0));
                const rightPct = n <= 1 ? 1 : expandedSliderDrag?.which === "slide" ? expandedSliderDrag.endPct : (expandedSliderDrag?.which === "right" ? expandedSliderDrag.position : (emotionIntensityBrushEnd > 0 ? endClamped / (n - 1) : 1));
                const displayStartIdx = Math.max(0, Math.min(n - 1, Math.round(leftPct * (n - 1))));
                const displayEndIdx = Math.max(displayStartIdx, Math.min(n - 1, Math.round(rightPct * (n - 1))));
                const displayData = useBrush ? d.slice(displayStartIdx, displayEndIdx + 1) : d;
                const displayStartLabel = d[displayStartIdx] ? String((d[displayStartIdx] as Record<string, unknown>).name ?? "") : "";
                const displayEndLabel = d[displayEndIdx] ? String((d[displayEndIdx] as Record<string, unknown>).name ?? "") : "";
                const startDragLeft = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "left", bound: rightPct, n, position: leftPct, trackRect: rect, setStart: setEmotionIntensityBrushStart, setEnd: setEmotionIntensityBrushEnd, wasFullRange: emotionIntensityBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "left", position: leftPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragRight = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "right", bound: leftPct, n, position: rightPct, trackRect: rect, setStart: setEmotionIntensityBrushStart, setEnd: setEmotionIntensityBrushEnd, wasFullRange: emotionIntensityBrushEnd === 0, startIdx: start, endIdx: end }; setExpandedSliderDrag({ which: "right", position: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                const startDragSlide = (e: React.MouseEvent | React.TouchEvent) => { e.preventDefault(); const rect = expandedSliderTrackRef.current?.getBoundingClientRect() ?? null; const clientX = "touches" in e && e.touches?.length ? e.touches[0].clientX : (e as React.MouseEvent).clientX; if (!rect || rect.width <= 0) return; expandedSliderDragRef.current = { which: "slide", initialStartPct: leftPct, initialEndPct: rightPct, initialClientX: clientX, trackRect: rect, n, startPct: leftPct, endPct: rightPct, setStart: setEmotionIntensityBrushStart, setEnd: setEmotionIntensityBrushEnd }; setExpandedSliderDrag({ which: "slide", startPct: leftPct, endPct: rightPct }); document.addEventListener("mousemove", handleExpandedSliderMove as EventListener, true); document.addEventListener("mouseup", handleExpandedSliderUp, true); document.addEventListener("touchmove", handleExpandedSliderMove as EventListener, { capture: true, passive: false }); document.addEventListener("touchend", handleExpandedSliderUp, true); };
                return (
                <>
                <ResponsiveContainer width="100%" height={useBrush ? EXPANDED_CHART_HEIGHT + 44 : EXPANDED_CHART_HEIGHT}>
                  <BarChart data={displayData} margin={STRATEGY_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" stroke="var(--text-secondary)" tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => <StrategyChartTick x={props.x ?? 0} y={props.y ?? 0} payload={props.payload} />} height={STRATEGY_XAXIS_HEIGHT} interval={0} />
                    <YAxis stroke="var(--text-secondary)" domain={[0, 10]} allowDecimals={true} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: unknown) => [(typeof value === "number" ? value.toFixed(1) : value) as ReactNode, "Avg intensity"]} />
                    <Bar dataKey="avgIntensity" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} />
                  </BarChart>
                </ResponsiveContainer>
                {useBrush && (
                  <div style={{ height: 36, marginTop: 4, position: "relative", width: "100%" }} ref={expandedSliderTrackRef}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 6, marginTop: -3, backgroundColor: "var(--bg-tertiary)", borderRadius: 3 }} />
                    <div role="button" tabIndex={0} onMouseDown={startDragSlide} onTouchStart={startDragSlide} style={{ position: "absolute", left: `${leftPct * 100}%`, right: `${(1 - rightPct) * 100}%`, top: 0, bottom: 0, backgroundColor: "var(--border-color)", opacity: 0.25, cursor: "grab", zIndex: 1, touchAction: "none" }} title="Drag to pan range" />
                    <div role="button" tabIndex={0} onMouseDown={startDragLeft} onTouchStart={startDragLeft} style={{ position: "absolute", left: `${leftPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust start" />
                    <div role="button" tabIndex={0} onMouseDown={startDragRight} onTouchStart={startDragRight} style={{ position: "absolute", left: `${rightPct * 100}%`, width: 12, top: 0, bottom: 0, marginLeft: -6, cursor: "ew-resize", zIndex: 2, touchAction: "none", backgroundColor: "var(--border-color)", borderRadius: 2 }} title="Drag to adjust end" />
                    <div style={{ position: "absolute", left: 0, right: 0, top: 18, fontSize: 10, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}><span>{displayStartLabel}</span><span>{displayEndLabel}</span></div>
                  </div>
                )}
                </>
                );
              })()}
              {expandedChartId === "equity" && equityCurve && Array.isArray(equityCurve.equity_points) && equityCurve.equity_points.length > 0 && (() => {
                const rawEquityData = fillMissingDates(equityCurve.equity_points);
                const equityChartData = rawEquityData.length <= 400 ? rawEquityData : sampleTimeSeries(rawEquityData, CHART_MAX_POINTS);
                const equityUseBrush = equityChartData.length >= BRUSH_SHOW_MIN;
                const equityBrushStartClamped = equityUseBrush && equityBrushEnd > 0 ? Math.min(equityBrushStart, equityChartData.length - 1) : 0;
                const equityBrushEndClamped = equityUseBrush && equityBrushEnd > 0 ? Math.min(equityChartData.length - 1, Math.max(equityBrushStartClamped, equityBrushEnd)) : Math.max(0, equityChartData.length - 1);
                const equityXInterval = xAxisInterval(Math.max(1, equityBrushEndClamped - equityBrushStartClamped + 1));
                const visibleSlice = equityChartData.slice(equityBrushStartClamped, equityBrushEndClamped + 1);
                const visiblePnls = visibleSlice.map((d: { cumulative_pnl?: number }) => d.cumulative_pnl ?? 0).filter((v: number) => typeof v === "number" && !Number.isNaN(v));
                const minPnl = visiblePnls.length ? Math.min(...visiblePnls) : 0;
                const maxPnl = visiblePnls.length ? Math.max(...visiblePnls) : 0;
                const range = Math.max(maxPnl - minPnl, Math.abs(minPnl) * 0.1, 100);
                const padding = range * 0.08;
                const domainMin = minPnl - padding;
                const domainMax = maxPnl + padding;
                const MONTHS_EXP = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const formatBrushDateExp = (dateStr: string) => {
                  const [y, m, d] = (dateStr || "").split("-").map(Number);
                  if (!m || !d) return dateStr;
                  return `${MONTHS_EXP[(m || 1) - 1]} ${d}, ${y}`;
                };
                return (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equityChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis dataKey="date" interval={equityXInterval} stroke="var(--text-secondary)" tick={{ fill: "var(--text-secondary)", fontSize: 12 }} angle={-45} textAnchor="end" height={80} />
                      <YAxis domain={[domainMin, domainMax]} stroke="var(--text-secondary)" tickFormatter={(value) => `$${formatWithCommas(value, { decimals: 0 })}`} />
                      <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: any) => [`$${formatWithCommas(Number(value), { decimals: 2 })}`, "Cumulative P&L"]} labelFormatter={(label) => `Date: ${label}`} />
                      <Line type="monotone" dataKey="cumulative_pnl" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 6, fill: "var(--accent)", stroke: "var(--bg-secondary)", strokeWidth: 2 }} name="Cumulative P&L" />
                      {equityUseBrush && (
                        <Brush
                          data={equityChartData}
                          dataKey="date"
                          height={36}
                          stroke="var(--border-color)"
                          fill="var(--bg-tertiary)"
                          gap={1}
                          startIndex={equityBrushStartClamped}
                          endIndex={equityBrushEndClamped}
                          alwaysShowText
                          tickFormatter={formatBrushDateExp}
                          onChange={(range: { startIndex?: number; endIndex?: number }) => {
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
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

