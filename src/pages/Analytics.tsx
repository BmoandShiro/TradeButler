import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, Brush, Cell } from "recharts";
import { TrendingUp, TrendingDown, Settings } from "lucide-react";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { formatWithCommas } from "../utils/formatCompactNumber";
import { sampleTimeSeries, CHART_MAX_POINTS, xAxisInterval, BRUSH_MIN_POINTS } from "../utils/chartDataSampling";
import { loadSandboxState, getSandboxStrategyChecklistItemMetrics, getSandboxStrategyChecklistItemMetricsByOutcome } from "../utils/sandboxStore";
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

interface ChecklistItemMetricRow {
  checklist_item_id: number;
  item_text: string;
  checklist_type: string;
  times_checked: number;
  avg_performance: number | null;
  performance_kind: string;
}

interface ChecklistItemMetricByOutcomeRow {
  checklist_item_id: number;
  item_text: string;
  checklist_type: string;
  times_checked_good: number;
  times_checked_bad: number;
}

const STRATEGY_CHART_AXIS_PROPS = {
  tick: { fontSize: 13, fill: "var(--text-secondary)" },
  angle: -40,
  textAnchor: "end" as const,
  height: 72,
};
const STRATEGY_CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 72 };
const BAR_FILL_OPACITY = 0.5;

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
  const prevDataModeRef = useRef<DataMode | null>(null);
  const filtersBarRef = useRef<HTMLDivElement>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformanceRow[]>([]);
  const [checklistItemMetrics, setChecklistItemMetrics] = useState<ChecklistItemMetricRow[]>([]);
  const [checklistItemMetricsByOutcome, setChecklistItemMetricsByOutcome] = useState<ChecklistItemMetricByOutcomeRow[]>([]);
  /** Per-strategy checklist by outcome for branched "top winning" display */
  const [checklistByOutcomePerStrategy, setChecklistByOutcomePerStrategy] = useState<Array<{ strategyId: number; strategyName: string; items: ChecklistItemMetricByOutcomeRow[] }>>([]);
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


  useEffect(() => {
    loadData();
  }, [timeframe, customStartDate, customEndDate, dataMode, filterStrategyIds, filterSymbols, filterSides, filterTypes, filterPositionSizeMin, filterPositionSizeMax, filterPositions, filterTimeframes, filterRMin, filterRMax]);

  useEffect(() => {
    setEquityBrushEnd(0);
    setSymbolChartBrushEnd(0);
    setSideChartBrushEnd(0);
    setEntriesChartBrushEnd(0);
    setPositionsChartBrushEnd(0);
    setOutcomeChartBrushEnd(0);
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

  // Process trades for charts (use filteredTrades so Trades by Symbol and Buy vs Sell respect filters)
  const processChartData = () => {
    const symbolCounts: Record<string, number> = {};
    const sideCounts: Record<string, number> = { BUY: 0, SELL: 0 };

    filteredTrades.forEach((trade) => {
      const underlyingSymbol = getUnderlyingSymbol(trade.symbol);
      if (underlyingSymbol !== "") {
        symbolCounts[underlyingSymbol] = (symbolCounts[underlyingSymbol] || 0) + 1;
      }
      const side = trade.side ?? "";
      if (side === "BUY" || side === "SELL") {
        sideCounts[side]++;
      }
    });

    const symbolData = Object.entries(symbolCounts)
      .filter(([symbol]) => symbol != null && symbol !== "")
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { symbolData, sideData: [{ name: "BUY", value: sideCounts.BUY }, { name: "SELL", value: sideCounts.SELL }] };
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
    const byChecklistType = new Map<string, number>();
    (checklistItemMetrics ?? []).forEach((row) => {
      const type = row.checklist_type || "other";
      byChecklistType.set(type, (byChecklistType.get(type) ?? 0) + (row.times_checked ?? 0));
    });
    const checklistTypeData = Array.from(byChecklistType.entries())
      .map(([checklist_type, count]) => ({
        name: checklist_type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
        count,
      }))
      .sort((a, b) => b.count - a.count);
    const topWinningSubItemsByStrategy: Array<{ strategyName: string; checklists: Array<{ checklistTypeDisplay: string; topItemText: string; good: number }> }> = [];
    (checklistByOutcomePerStrategy ?? []).forEach(({ strategyName, items }) => {
      const byType = new Map<string, ChecklistItemMetricByOutcomeRow[]>();
      items.forEach((row) => {
        const type = row.checklist_type || "other";
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push(row);
      });
      const checklists: Array<{ checklistTypeDisplay: string; topItemText: string; good: number }> = [];
      byType.forEach((rows, type) => {
        const top = rows.reduce((best, r) => ((r.times_checked_good ?? 0) > (best.times_checked_good ?? 0) ? r : best), rows[0]);
        if (top && (top.times_checked_good ?? 0) > 0) {
          checklists.push({
            checklistTypeDisplay: type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
            topItemText: (top.item_text || `Item ${top.checklist_item_id}`).trim(),
            good: top.times_checked_good ?? 0,
          });
        }
      });
      if (checklists.length > 0) topWinningSubItemsByStrategy.push({ strategyName, checklists });
    });
    return { tradesByStrategy, profitableTradesByStrategy, profitByStrategy, checklistTypeData, topWinningSubItemsByStrategy };
  }, [strategyPerformance, checklistItemMetrics, checklistByOutcomePerStrategy]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading analytics...</p>
      </div>
    );
  }

  const chartData = processChartData();
  const symbolData: { symbol: string; count: number }[] = Array.isArray(chartData?.symbolData) ? chartData.symbolData : [];
  const sideData: { name: string; value: number }[] = Array.isArray(chartData?.sideData) ? chartData.sideData : [{ name: "BUY", value: 0 }, { name: "SELL", value: 0 }];
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
          {Array.isArray(displaySymbolPnL) && displaySymbolPnL.length > 0 && (
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
                    {displaySymbolPnL.map((pnl) => (
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
              const safeSymbolData = symbolData ?? [];
              const useBrush = safeSymbolData.length > BRUSH_MIN_POINTS;
              const start = useBrush && symbolChartBrushEnd > 0 ? Math.min(symbolChartBrushStart, Math.max(0, safeSymbolData.length - 1)) : 0;
              const end = useBrush && symbolChartBrushEnd > 0 ? Math.min(Math.max(0, safeSymbolData.length - 1), Math.max(start, symbolChartBrushEnd)) : Math.max(0, safeSymbolData.length - 1);
              return (
            <ResponsiveContainer width="100%" height={useBrush ? 340 : 300}>
              <BarChart data={safeSymbolData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="symbol" stroke="var(--text-secondary)" interval={safeSymbolData.length > 20 ? Math.floor(safeSymbolData.length / 10) : 0} />
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
              const safeSideData = sideData ?? [];
              const useBrush = safeSideData.length > BRUSH_MIN_POINTS;
              const start = useBrush && sideChartBrushEnd > 0 ? Math.min(sideChartBrushStart, Math.max(0, safeSideData.length - 1)) : 0;
              const end = useBrush && sideChartBrushEnd > 0 ? Math.min(Math.max(0, safeSideData.length - 1), Math.max(start, sideChartBrushEnd)) : Math.max(0, safeSideData.length - 1);
              return (
            <ResponsiveContainer width="100%" height={useBrush ? 340 : 300}>
              <BarChart data={safeSideData}>
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
              Strategy findings
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "16px" }}>
              Patterns from strategy parameters and checklist usage compared to your trades.
            </p>
            {strategyPerformance.length === 0 && checklistItemMetrics.length === 0 ? (
              <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                Assign strategies to trades and use checklists in journal entries to see findings here.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "24px" }}>
                <div>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
                    Trades by strategy
                  </h3>
                  {strategyFindingsData.tradesByStrategy.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No trades with strategies in the selected timeframe.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={strategyFindingsData.tradesByStrategy} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={STRATEGY_CHART_AXIS_PROPS.tick} angle={STRATEGY_CHART_AXIS_PROPS.angle} textAnchor={STRATEGY_CHART_AXIS_PROPS.textAnchor} height={STRATEGY_CHART_AXIS_PROPS.height} interval={0} />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.02)" }}
                          contentStyle={{
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            color: "var(--text-primary)",
                          }}
                          formatter={(value: unknown) => [value, "Trades"]}
                        />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
                    Checklist usage in journals
                  </h3>
                  {strategyFindingsData.checklistTypeData.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No checklist usage recorded in journal entries for this timeframe.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={strategyFindingsData.checklistTypeData} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={STRATEGY_CHART_AXIS_PROPS.tick} angle={STRATEGY_CHART_AXIS_PROPS.angle} textAnchor={STRATEGY_CHART_AXIS_PROPS.textAnchor} height={STRATEGY_CHART_AXIS_PROPS.height} interval={0} />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.02)" }}
                          contentStyle={{
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            color: "var(--text-primary)",
                          }}
                          formatter={(value: unknown) => [value, "Times used"]}
                        />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
                    Profitable trades by strategy
                  </h3>
                  {strategyFindingsData.profitableTradesByStrategy.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No profitable trades in the selected timeframe.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={strategyFindingsData.profitableTradesByStrategy} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={STRATEGY_CHART_AXIS_PROPS.tick} angle={STRATEGY_CHART_AXIS_PROPS.angle} textAnchor={STRATEGY_CHART_AXIS_PROPS.textAnchor} height={STRATEGY_CHART_AXIS_PROPS.height} interval={0} />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.02)" }}
                          contentStyle={{
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            color: "var(--text-primary)",
                          }}
                          formatter={(value: unknown) => [value, ""]}
                          labelFormatter={(label) => `${label} (Winning / Losing)`}
                        />
                        <Bar dataKey="winning" fill="var(--success, #22c55e)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--success, #22c55e)" strokeWidth={1} />
                        <Bar dataKey="losing" fill="var(--danger, #ef4444)" fillOpacity={BAR_FILL_OPACITY} stroke="var(--danger, #ef4444)" strokeWidth={1} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
                    Profit by strategy
                  </h3>
                  {strategyFindingsData.profitByStrategy.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                      No profit data in the selected timeframe.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={strategyFindingsData.profitByStrategy} margin={STRATEGY_CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" tick={STRATEGY_CHART_AXIS_PROPS.tick} angle={STRATEGY_CHART_AXIS_PROPS.angle} textAnchor={STRATEGY_CHART_AXIS_PROPS.textAnchor} height={STRATEGY_CHART_AXIS_PROPS.height} interval={0} />
                        <YAxis stroke="var(--text-secondary)" tickFormatter={(v) => typeof v === "number" ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v)) : String(v)} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.02)" }}
                          contentStyle={{
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            color: "var(--text-primary)",
                          }}
                          formatter={(value: unknown) => [typeof value === "number" ? formatWithCommas(value) : value, "Profit"]}
                        />
                        <Bar dataKey="profit" fillOpacity={BAR_FILL_OPACITY} strokeWidth={1}>
                          {strategyFindingsData.profitByStrategy.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} stroke={entry.profit >= 0 ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            )}
            {strategyFindingsData.topWinningSubItemsByStrategy.length > 0 && (
              <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border-color)" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
                  Top winning sub checklist item from this checklist from this strategy
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {strategyFindingsData.topWinningSubItemsByStrategy.map(({ strategyName, checklists }) => (
                    <div key={strategyName} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ fontWeight: "600", fontSize: "13px", color: "var(--accent)" }}>{strategyName}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 20px", paddingLeft: "12px", borderLeft: "2px solid var(--border-color)" }}>
                        {checklists.map(({ checklistTypeDisplay, topItemText, good }) => (
                          <div key={`${strategyName}-${checklistTypeDisplay}`} style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                            <span style={{ color: "var(--text-primary)", marginRight: "6px" }}>{checklistTypeDisplay}:</span>
                            <span style={{ color: "var(--success, #22c55e)" }}>{topItemText}</span>
                            <span style={{ marginLeft: "6px", opacity: 0.9 }}>({good} with winning trades)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
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

