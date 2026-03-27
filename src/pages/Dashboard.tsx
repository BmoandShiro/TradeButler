import { useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDroppable,
  useDndContext,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Settings,
  TrendingUp as TrendingUpIcon,
  BarChart3,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Copy,
  Trash2,
  RotateCcw,
  LayoutDashboard,
  ListOrdered,
  Save,
  RefreshCw,
  CircleDollarSign,
  Plus,
  Layers,
  Coins,
  ExternalLink,
} from "lucide-react";
import {
  MetricsConfigPanel,
  useMetricsConfig,
  DASHBOARD_MAX_METRIC_ROWS_KEY,
  DASHBOARD_MAX_COLUMNS_KEY,
  DASHBOARD_LOCKED_ROW_HEIGHT_KEY,
  DASHBOARD_METRICS_TO_SECTIONS_GAP_KEY,
  DASHBOARD_METRICS_GRID_GAP_KEY,
  DASHBOARD_SECTIONS_GRID_GAP_KEY,
  DASHBOARD_SECTIONS_GRID_MIN_WIDTH_KEY,
  DASHBOARD_SECTIONS_GRID_MARGIN_BOTTOM_KEY,
  DASHBOARD_PADDING_KEY,
  DASHBOARD_SPLIT_GRID_KEY,
  DASHBOARD_SECTIONS_ON_TOP_KEY,
  DEFAULT_LAYOUT,
  DEFAULT_COLOR_RANGE,
  COLOR_RANGE_KEY,
  CURRENT_PRICE_SYNC_ENABLED_KEY,
  CURRENT_PRICE_SYNC_SECONDS_KEY,
  CURRENT_PRICE_SYNC_INTERVALS,
} from "../components/MetricsConfig";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
} from "recharts";
import { BRUSH_MIN_POINTS } from "../utils/chartDataSampling";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { formatCompactNumber, formatWithCommas } from "../utils/formatCompactNumber";
import { loadSandboxState } from "../utils/sandboxStore";
import {
  EXAMPLE_METRICS,
  EXAMPLE_STRATEGY_PERFORMANCE,
  EXAMPLE_RECENT_TRADES,
  EXAMPLE_SYMBOL_PNL,
} from "../exampleData";
import NewsWidget from "../components/NewsWidget";
import DividendTrackerDashboardWidget from "../components/DividendTrackerDashboardWidget";
import {
  readDividendTrackerPageSize,
  DIVIDEND_TRACKER_PAGE_SIZE_KEY,
  DIVIDEND_TRACKER_PAGE_SIZE_OPTIONS,
} from "../utils/dividendTrackerData";
import {
  readDividendDashboardView,
  DASHBOARD_DIVIDEND_VIEW_KEY,
  type DividendDashboardView,
} from "../utils/dividendTrackerCharts";
import ViewFinancialsButton from "../components/ViewFinancialsButton";

interface Metrics {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_profit_loss: number;
  win_rate: number;
  average_profit: number;
  average_loss: number;
  largest_win: number;
  largest_loss: number;
  total_volume: number;
  trades_by_symbol: Array<{ symbol: string; count: number; profit_loss: number }>;
  consecutive_wins: number;
  consecutive_losses: number;
  current_win_streak: number;
  current_loss_streak: number;
  strategy_win_rate: number;
  strategy_winning_trades: number;
  strategy_losing_trades: number;
  strategy_profit_loss: number;
  strategy_consecutive_wins: number;
  strategy_consecutive_losses: number;
  expectancy: number;
  profit_factor: number;
  average_trade: number;
  total_fees: number;
  net_profit: number;
  max_drawdown: number;
  sharpe_ratio: number;
  risk_reward_ratio: number;
  trades_per_day: number;
  best_day: number;
  worst_day: number;
  best_day_date?: string | null;
  worst_day_date?: string | null;
  largest_win_group_id?: number | null;
  largest_loss_group_id?: number | null;
  average_holding_time_seconds: number;
  average_gain_pct: number;
  average_loss_pct: number;
  largest_win_pct: number;
  largest_loss_pct: number;
}

interface TopSymbol {
  symbol: string;
  trade_count: number;
  total_volume: number;
  estimated_pnl: number;
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

interface Strategy {
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  created_at: string | null;
  color: string | null;
}

interface StrategyPerformance {
  strategy_id: number | null;
  strategy_name: string;
  trade_count: number;
  total_volume: number;
  estimated_pnl: number;
}

interface PairedTrade {
  symbol: string;
  entry_trade_id: number;
  exit_trade_id: number;
  quantity: number;
  entry_price: number;
  exit_price: number;
  entry_timestamp: string;
  exit_timestamp: string;
  gross_profit_loss: number;
  entry_fees: number;
  exit_fees: number;
  net_profit_loss: number;
  strategy_id: number | null;
}

/** Position group from get_position_groups; open when final_quantity !== 0 */
interface OpenPositionGroup {
  entry_trade: { id: number; symbol: string; side: string; quantity: number; price: number; timestamp: string };
  position_trades: Array<{ id: number; symbol: string; side: string; quantity: number; price: number; timestamp: string }>;
  total_pnl: number;
  final_quantity: number;
}

interface RecentTrade {
  symbol: string;
  entry_timestamp: string;
  exit_timestamp: string;
  quantity: number;
  entry_price: number;
  exit_price: number;
  net_profit_loss: number;
  strategy_name: string | null;
}

const metricIcons: Record<string, any> = {
  total_trades: Activity,
  total_volume: DollarSign,
  total_profit_loss: DollarSign,
  win_rate: TrendingUp,
  winning_trades: TrendingUp,
  losing_trades: TrendingDown,
  average_profit: TrendingUp,
  average_loss: TrendingDown,
  largest_win: TrendingUp,
  largest_loss: TrendingDown,
  average_gain_pct: TrendingUp,
  average_loss_pct: TrendingDown,
  largest_win_pct: TrendingUp,
  largest_loss_pct: TrendingDown,
  consecutive_wins: TrendingUp,
  consecutive_losses: TrendingDown,
  current_win_streak: TrendingUp,
  current_loss_streak: TrendingDown,
  strategy_win_rate: TrendingUp,
  strategy_winning_trades: TrendingUp,
  strategy_losing_trades: TrendingDown,
  strategy_profit_loss: DollarSign,
  strategy_consecutive_wins: TrendingUp,
  strategy_consecutive_losses: TrendingDown,
  average_holding_time_seconds: Clock,
  position_size_chart: BarChart3,
  current_price: CircleDollarSign,
};

const formatMetricValue = (id: string, value: number, metrics: Metrics | null): string => {
  if (metrics === null) return "0";

  switch (id) {
    case "total_trades":
      return formatWithCommas(Math.round(value));
    case "total_volume":
      return formatCompactNumber(value || 0, { prefix: "$", suffix: "" });
    case "total_profit_loss":
    case "average_profit":
    case "average_loss":
    case "largest_win":
    case "largest_loss":
    case "average_trade":
    case "total_fees":
    case "net_profit":
    case "max_drawdown":
    case "best_day":
    case "worst_day":
      return `$${formatWithCommas(value || 0, { decimals: 2 })}`;
    case "win_rate":
      return `${formatWithCommas((value || 0) * 100, { minDecimals: 1, maxDecimals: 1 })}%`;
    case "expectancy":
    case "profit_factor":
    case "sharpe_ratio":
    case "risk_reward_ratio":
    case "trades_per_day":
      return formatWithCommas(value || 0, { minDecimals: 2, maxDecimals: 2 });
    case "winning_trades":
    case "losing_trades":
    case "consecutive_wins":
    case "consecutive_losses":
    case "current_win_streak":
    case "current_loss_streak":
    case "strategy_winning_trades":
    case "strategy_losing_trades":
    case "strategy_consecutive_wins":
    case "strategy_consecutive_losses":
      return formatWithCommas(Math.round(value));
    case "strategy_win_rate":
      return `${formatWithCommas((value || 0) * 100, { minDecimals: 1, maxDecimals: 1 })}%`;
    case "strategy_profit_loss":
      return `$${formatWithCommas(value || 0, { decimals: 2 })}`;
    case "average_holding_time_seconds":
      return formatHoldingTime(value || 0);
    case "average_gain_pct":
    case "average_loss_pct":
    case "largest_win_pct":
    case "largest_loss_pct":
      return `${(value || 0) >= 0 ? "+" : ""}${formatWithCommas(value || 0, { decimals: 2 })}%`;
    default:
      return formatWithCommas(value, { minDecimals: 2, maxDecimals: 2 });
  }
};

const formatHoldingTime = (seconds: number): string => {
  if (seconds === 0 || !Number.isFinite(seconds)) return "0s";
  const s = Math.max(0, Math.floor(seconds));

  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);

  const parts: string[] = [];
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const remainderDays = days % 365;
    parts.push(`${years}y`);
    if (remainderDays > 0) parts.push(`${remainderDays}d`);
  } else if (days > 0) {
    parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    // Omit seconds when we have days to keep string shorter
  } else if (hours > 0) {
    parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0) parts.push(`${secs}s`);
  } else if (minutes > 0) {
    parts.push(`${minutes}m`);
    if (secs > 0) parts.push(`${secs}s`);
  } else {
    parts.push(`${secs}s`);
  }
  return parts.join(" ") || "0s";
};

const getMetricColor = (id: string, value: number, colorRange?: { min: number; max: number }): string => {
  if (id === "current_price") {
    return "var(--accent)";
  }
  // Get color range from localStorage if not provided
  if (!colorRange) {
    const saved = localStorage.getItem("tradebutler_color_range");
    if (saved) {
      try {
        colorRange = JSON.parse(saved);
      } catch {
        colorRange = undefined;
      }
    }
  }
  
  // Max drawdown should always be red (it represents a loss)
  if (id === "max_drawdown") {
    return "var(--loss)";
  }
  
  // Dollar-based metrics that should use color range
  const dollarMetrics = [
    "total_profit_loss", "strategy_profit_loss", "average_profit", "average_loss",
    "largest_win", "largest_loss", "average_trade", "total_fees", "net_profit",
    "best_day", "worst_day", "expectancy"
  ];
  
  // Apply color range for dollar metrics
  if (dollarMetrics.includes(id) && colorRange) {
    if (value < colorRange.min) {
      return "var(--loss)"; // Below range = red
    } else if (value > colorRange.max) {
      return "var(--profit)"; // Above range = green
    } else {
      return "var(--accent)"; // Within range = blue
    }
  }
  
  // Default behavior: positive = green, negative = red, zero = blue
  if (value > 0) {
    // Positive values
    if (id.includes("loss") || id.includes("losing")) {
      // Loss-related metrics should be red even if positive
      return "var(--loss)";
    }
    return "var(--profit)";
  } else if (value < 0) {
    // Negative values
    return "var(--loss)";
  } else {
    // Zero values
    return "var(--accent)";
  }
};

const DASHBOARD_SECTIONS_KEY = "tradebutler_dashboard_sections";
const DASHBOARD_SECTION_ORDER_KEY = "tradebutler_dashboard_section_order";
const DASHBOARD_DISPLAY_ORDER_KEY = "tradebutler_dashboard_display_order";
const DASHBOARD_LAYOUT_PRESETS_KEY = "tradebutler_dashboard_layout_presets";
const DASHBOARD_SECTION_SIZES_KEY = "tradebutler_dashboard_section_sizes";
const OPEN_POSITIONS_DISPLAY_MODE_KEY = "tradebutler_open_positions_display_mode";
const OPEN_POSITIONS_REFRESH_INTERVAL_KEY = "tradebutler_open_positions_refresh_interval";
const METRIC_CARDS_ORDER_KEY = "tradebutler_metric_cards_order";
const METRIC_INSTANCES_KEY = "tradebutler_metric_instances";
const DASHBOARD_LOCKED_COLUMN_WIDTHS_KEY = "tradebutler_dashboard_locked_column_widths";
const DASHBOARD_LOCKED_SLOT_ASSIGNMENTS_KEY = "tradebutler_dashboard_locked_slot_assignments";
const DASHBOARD_LOCKED_PLACEMENTS_KEY = "tradebutler_dashboard_locked_placements";

const DASHBOARD_PROFILES_META_KEY = "tradebutler_dashboard_profiles_meta_v1";

/** localStorage keys snapshotted per named dashboard (active profile is mirrored into these keys while editing). */
const DASHBOARD_PROFILE_STORAGE_KEYS: readonly string[] = [
  DASHBOARD_SECTIONS_KEY,
  DASHBOARD_SECTION_ORDER_KEY,
  DASHBOARD_DISPLAY_ORDER_KEY,
  DASHBOARD_LAYOUT_PRESETS_KEY,
  DASHBOARD_SECTION_SIZES_KEY,
  OPEN_POSITIONS_DISPLAY_MODE_KEY,
  OPEN_POSITIONS_REFRESH_INTERVAL_KEY,
  METRIC_CARDS_ORDER_KEY,
  METRIC_INSTANCES_KEY,
  DASHBOARD_LOCKED_COLUMN_WIDTHS_KEY,
  DASHBOARD_LOCKED_SLOT_ASSIGNMENTS_KEY,
  DASHBOARD_LOCKED_PLACEMENTS_KEY,
  DASHBOARD_MAX_COLUMNS_KEY,
  DASHBOARD_MAX_METRIC_ROWS_KEY,
  DASHBOARD_LOCKED_ROW_HEIGHT_KEY,
  DASHBOARD_METRICS_TO_SECTIONS_GAP_KEY,
  DASHBOARD_METRICS_GRID_GAP_KEY,
  DASHBOARD_SECTIONS_GRID_GAP_KEY,
  DASHBOARD_SECTIONS_GRID_MIN_WIDTH_KEY,
  DASHBOARD_SECTIONS_GRID_MARGIN_BOTTOM_KEY,
  DASHBOARD_PADDING_KEY,
  DASHBOARD_SPLIT_GRID_KEY,
  DASHBOARD_SECTIONS_ON_TOP_KEY,
  COLOR_RANGE_KEY,
  CURRENT_PRICE_SYNC_ENABLED_KEY,
  CURRENT_PRICE_SYNC_SECONDS_KEY,
  "tradebutler_strategy_filter_for_metrics",
  "tradebutler_dashboard_timeframe",
  "tradebutler_dashboard_custom_start",
  "tradebutler_dashboard_custom_end",
  "tradebutler_dashboard_strategy_id",
  "tradebutler_news_include_positions",
  "tradebutler_news_show_sentiment",
];

const DASHBOARD_STRATEGY_ID_KEY = "tradebutler_dashboard_strategy_id";

type DashboardProfileInfo = { id: string; name: string };
type DashboardProfilesMetaV1 = { version: 1; profiles: DashboardProfileInfo[]; activeProfileId: string };

function dashboardProfileSnapKey(profileId: string): string {
  return `tradebutler_dashboard_profile_snap_v1_${profileId}`;
}

function readDashboardProfilesMeta(): DashboardProfilesMetaV1 | null {
  try {
    const raw = localStorage.getItem(DASHBOARD_PROFILES_META_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as DashboardProfilesMetaV1;
    if (!m || m.version !== 1 || !Array.isArray(m.profiles) || typeof m.activeProfileId !== "string") return null;
    return m;
  } catch {
    return null;
  }
}

function writeDashboardProfilesMeta(meta: DashboardProfilesMetaV1): void {
  localStorage.setItem(DASHBOARD_PROFILES_META_KEY, JSON.stringify(meta));
}

function collectDashboardProfileSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of DASHBOARD_PROFILE_STORAGE_KEYS) {
    out[key] = localStorage.getItem(key) ?? "";
  }
  return out;
}

function applyDashboardProfileSnapshot(data: Record<string, string | undefined>): void {
  for (const key of DASHBOARD_PROFILE_STORAGE_KEYS) {
    const v = data[key];
    if (v !== undefined && v !== null && v !== "") {
      localStorage.setItem(key, v);
    } else {
      localStorage.removeItem(key);
    }
  }
}

function saveDashboardProfileSnapshot(profileId: string): void {
  localStorage.setItem(dashboardProfileSnapKey(profileId), JSON.stringify(collectDashboardProfileSnapshot()));
}

function loadDashboardProfileSnapshot(profileId: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(dashboardProfileSnapKey(profileId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** Only apply profile blob once per page load — re-applying on every render overwrote fresh layout keys with stale snapshots. */
let dashboardProfilesSnapshotAppliedOnce = false;

/** Apply active profile into root keys before Dashboard reads localStorage (first paint only). */
function ensureDashboardProfilesBootstrapped(): void {
  let meta = readDashboardProfilesMeta();
  if (!meta) {
    const snap = collectDashboardProfileSnapshot();
    const initial: DashboardProfilesMetaV1 = {
      version: 1,
      profiles: [{ id: "default", name: "Main" }],
      activeProfileId: "default",
    };
    writeDashboardProfilesMeta(initial);
    localStorage.setItem(dashboardProfileSnapKey("default"), JSON.stringify(snap));
    return;
  }
  if (dashboardProfilesSnapshotAppliedOnce) return;
  dashboardProfilesSnapshotAppliedOnce = true;
  const blob = loadDashboardProfileSnapshot(meta.activeProfileId);
  if (blob && Object.keys(blob).length > 0) {
    applyDashboardProfileSnapshot(blob);
  }
}

const MAX_POSITION_CHART_COLUMN_SPAN = 24;
const MAX_ROW_SPAN = 32;
const MIN_COLUMN_FR = 0.2;
const MIN_ROW_HEIGHT_PX = 40;
const MAX_ROW_HEIGHT_PX = 400;

function parseGridColumnCount(template: string): number {
  const trimmed = template.trim();
  const repeatMatch = trimmed.match(/repeat\s*\(\s*(\d+)\s*,/);
  if (repeatMatch) return Math.max(1, parseInt(repeatMatch[1], 10));
  const parts = trimmed.split(" ").filter(Boolean);
  return parts.length > 0 ? parts.length : 1;
}

interface MetricInstance {
  instanceId: string; // e.g., "strategy_win_rate_1", "strategy_win_rate_2"
  baseMetricId: string; // e.g., "strategy_win_rate"
  strategyFilterId: number | null; // Strategy filter for this instance
  positionEntryId?: number | null; // For position_size_chart: which open position to show
  chartHeight?: number; // For position_size_chart: resizable chart height (default 200)
  chartWidth?: number;  // For position_size_chart: resizable width in px (flex layout only)
  chartColumnSpan?: number; // For position_size_chart in grid: span 1–MAX_POSITION_CHART_COLUMN_SPAN so it resizes with grid
  positionChartBrushStart?: number; // For position_size_chart: Brush range start index
  positionChartBrushEnd?: number;   // For position_size_chart: Brush range end index
  slotIndex?: number;               // When layout locked: fixed grid slot (0-based), allows gaps
  // Resizable metric card (non–position_size_chart)
  cardWidth?: number;               // Pixel width in flex layout (default 280)
  cardHeight?: number;              // Card height in px (default 100)
  cardColumnSpan?: number;          // Grid column span when in grid layout (1–MAX_POSITION_CHART_COLUMN_SPAN)
  cardRowSpan?: number;             // Grid row span when locked (1–MAX_ROW_SPAN)
  /** Live quote metric: symbol to poll (e.g. SPY). */
  quoteSymbol?: string;
  /** Live quote metric: refresh interval in seconds; 0 = manual refresh only. */
  quoteRefreshSeconds?: number;
}

type CurrentPriceSyncContextValue = { enabled: boolean; seconds: number; tick: number };
const CurrentPriceSyncContext = createContext<CurrentPriceSyncContextValue | null>(null);

function readDashboardCurrentPriceSync(): { enabled: boolean; seconds: number } {
  const enabled = localStorage.getItem(CURRENT_PRICE_SYNC_ENABLED_KEY) === "true";
  const raw = parseInt(localStorage.getItem(CURRENT_PRICE_SYNC_SECONDS_KEY) || "30", 10);
  const seconds = (CURRENT_PRICE_SYNC_INTERVALS as readonly number[]).includes(raw) ? raw : 30;
  return { enabled, seconds };
}

type CurrentPriceVsOpenKind = "up" | "down" | "flat" | "unknown";

function currentPriceVsOpenKind(price: number, dayOpen: number | null): CurrentPriceVsOpenKind {
  if (!Number.isFinite(price) || price <= 0) return "unknown";
  if (dayOpen == null || !Number.isFinite(dayOpen) || dayOpen <= 0) return "unknown";
  const pC = Math.round(price * 100);
  const oC = Math.round(dayOpen * 100);
  if (pC === oC) return "flat";
  return pC > oC ? "up" : "down";
}

/** Green above open, red below, accent when flat (cent-rounded) or open unknown. */
function currentPriceVsOpenColor(price: number, dayOpen: number | null): string {
  switch (currentPriceVsOpenKind(price, dayOpen)) {
    case "up":
      return "var(--profit)";
    case "down":
      return "var(--loss)";
    default:
      return "var(--accent)";
  }
}

function useCurrentPriceQuote(
  metric: { id: string; quoteSymbol?: string; quoteRefreshSeconds?: number },
  setMetricInstances: React.Dispatch<React.SetStateAction<MetricInstance[]>>,
  dataMode: DataMode,
) {
  const syncCtx = useContext(CurrentPriceSyncContext);
  const syncEnabled = syncCtx?.enabled ?? false;

  const persistedSymbol = (metric.quoteSymbol ?? "SPY").trim().toUpperCase() || "SPY";
  const refreshSec =
    typeof metric.quoteRefreshSeconds === "number" && !Number.isNaN(metric.quoteRefreshSeconds)
      ? metric.quoteRefreshSeconds
      : 30;

  const [symbolDraft, setSymbolDraft] = useState(persistedSymbol);
  useEffect(() => {
    setSymbolDraft(persistedSymbol);
  }, [persistedSymbol, metric.id]);

  const [price, setPrice] = useState<number | null>(null);
  const [dayOpen, setDayOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<Date | null>(null);

  const patchSymbol = useCallback(
    (symbol: string) => {
      setMetricInstances((prev) => {
        const updated = prev.map((inst) =>
          inst.instanceId === metric.id ? { ...inst, quoteSymbol: symbol } : inst
        );
        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    [metric.id, setMetricInstances]
  );

  const fetchOnce = useCallback(async () => {
    const sym = persistedSymbol;
    if (!sym) {
      setError("Enter a symbol");
      return;
    }
    if (dataMode === "sandbox") {
      setError("Quotes are unavailable in demo mode");
      setPrice(null);
      setDayOpen(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const quote = await invoke<{
        current_price: number | null;
        regular_market_open?: number | null;
      }>("fetch_stock_quote", { symbol: sym });
      const p = quote.current_price;
      const o = quote.regular_market_open;
      const openNum =
        o != null && Number.isFinite(o) && o > 0 ? o : null;
      if (p != null && Number.isFinite(p) && p > 0) {
        setPrice(p);
        setDayOpen(openNum);
        setLastAt(new Date());
      } else {
        setPrice(null);
        setDayOpen(null);
        setError("No price returned");
      }
    } catch (e) {
      setPrice(null);
      setDayOpen(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [persistedSymbol, dataMode]);

  useEffect(() => {
    void fetchOnce();
  }, [metric.id, persistedSymbol, fetchOnce]);

  useEffect(() => {
    if (syncEnabled) return;
    if (refreshSec <= 0) return;
    const timerId = window.setInterval(() => void fetchOnce(), refreshSec * 1000);
    return () => window.clearInterval(timerId);
  }, [refreshSec, fetchOnce, syncEnabled]);

  useEffect(() => {
    if (!syncEnabled || !syncCtx) return;
    if (syncCtx.seconds < 1) return;
    if (syncCtx.tick === 0) return;
    void fetchOnce();
  }, [syncEnabled, syncCtx?.tick, syncCtx?.seconds, fetchOnce]);

  return {
    symbolDraft,
    setSymbolDraft,
    patchSymbol,
    fetchOnce,
    price,
    dayOpen,
    loading,
    error,
    lastAt,
  };
}

function CurrentPriceMetricRow({
  metric,
  setMetricInstances,
  dataMode,
  fillLockedGridCell,
  refreshActionRef,
  onVsOpenVisual,
  children,
}: {
  metric: { id: string; quoteSymbol?: string; quoteRefreshSeconds?: number };
  setMetricInstances: React.Dispatch<React.SetStateAction<MetricInstance[]>>;
  dataMode: DataMode;
  fillLockedGridCell: boolean;
  /** Wired to the refresh icon beside the gear */
  refreshActionRef: React.MutableRefObject<(() => void) | null>;
  /** Drives metric card icon (trend arrows) to match price vs day open */
  onVsOpenVisual?: (v: { kind: CurrentPriceVsOpenKind; tint: string }) => void;
  children: React.ReactNode;
}) {
  const { symbolDraft, setSymbolDraft, patchSymbol, fetchOnce, price, dayOpen, loading, error, lastAt } =
    useCurrentPriceQuote(metric, setMetricInstances, dataMode);

  const [symbolFocused, setSymbolFocused] = useState(false);

  useEffect(() => {
    refreshActionRef.current = () => {
      void fetchOnce();
    };
    return () => {
      refreshActionRef.current = null;
    };
  }, [fetchOnce, refreshActionRef]);

  useEffect(() => {
    if (!onVsOpenVisual) return;
    if (price != null && !error) {
      onVsOpenVisual({
        kind: currentPriceVsOpenKind(price, dayOpen),
        tint: currentPriceVsOpenColor(price, dayOpen),
      });
    } else {
      onVsOpenVisual({ kind: "unknown", tint: "var(--accent)" });
    }
  }, [price, dayOpen, error, onVsOpenVisual]);

  /** Fixed px row so input + text share one metrics box (avoids ~0.5px drift from UA input padding vs span). */
  const quoteFontSize = 22;
  const quoteRowPx = 30;
  const quoteFontSizeCss = `${quoteFontSize}px`;
  const quoteRowPxCss = `${quoteRowPx}px`;
  const quoteTint =
    price != null && !error ? currentPriceVsOpenColor(price, dayOpen) : "var(--accent)";
  const quoteUnderlineShadow = `inset 0 -2px 0 0 ${symbolFocused ? quoteTint : "transparent"}`;
  const quotePlaceholderUnderline = "inset 0 -2px 0 0 transparent";

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: fillLockedGridCell ? 0 : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        gap: "6px",
        overflow: "hidden",
        pointerEvents: "auto",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: "100%" }}>{children}</div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          minWidth: 0,
        }}
      >
        <input
          type="text"
          aria-label="Symbol"
          title="Click to edit symbol"
          value={symbolDraft}
          size={Math.max(3, symbolDraft.length || 1)}
          onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
          onFocus={() => setSymbolFocused(true)}
          onBlur={() => {
            setSymbolFocused(false);
            const v = symbolDraft.trim().toUpperCase() || "SPY";
            setSymbolDraft(v);
            patchSymbol(v);
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          spellCheck={false}
          style={{
            margin: 0,
            minWidth: "2.5ch",
            width: "auto",
            height: quoteRowPxCss,
            backgroundColor: "transparent",
            border: "none",
            borderRadius: 0,
            color: quoteTint,
            fontWeight: "bold",
            fontSize: quoteFontSizeCss,
            lineHeight: quoteRowPxCss,
            fontVariantNumeric: "tabular-nums",
            fontFamily: "inherit",
            textAlign: "left",
            caretColor: quoteTint,
            outline: "none",
            boxShadow: quoteUnderlineShadow,
            WebkitAppearance: "none" as React.CSSProperties["WebkitAppearance"],
            appearance: "none",
            cursor: "text",
            boxSizing: "border-box",
            flexShrink: 0,
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: 2,
            paddingRight: 2,
          }}
        />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: quoteRowPxCss,
            minWidth: 0,
            flex: "1 1 0%",
            fontSize: quoteFontSizeCss,
            fontWeight: "bold",
            lineHeight: quoteRowPxCss,
            color: quoteTint,
            margin: 0,
            textAlign: "center",
            maxWidth: "100%",
            fontVariantNumeric: "tabular-nums",
            fontFamily: "inherit",
            boxShadow: quotePlaceholderUnderline,
            boxSizing: "border-box",
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: 2,
            paddingRight: 2,
          }}
        >
          {loading && price == null ? "…" : price != null ? `$${formatWithCommas(price, { decimals: 2 })}` : "—"}
        </span>
      </div>
      {error && (
        <p style={{ fontSize: "10px", color: "var(--loss)", margin: 0, lineHeight: 1.3, textAlign: "center", maxWidth: "100%" }}>{error}</p>
      )}
      {lastAt && !error && (
        <p style={{ fontSize: "10px", color: "var(--text-secondary)", margin: 0, textAlign: "center", maxWidth: "100%" }}>
          Updated {format(lastAt, "HH:mm:ss")}
        </p>
      )}
    </div>
  );
}

interface DashboardSections {
  showTopSymbols: boolean;
  showStrategyPerformance: boolean;
  showRecentTrades: boolean;
  showTrades: boolean;
  showOpenPositions: boolean;
  showNews: boolean;
  showDividendTracker: boolean;
}

const defaultDashboardSections: DashboardSections = {
  showTopSymbols: true,
  showStrategyPerformance: true,
  showRecentTrades: true,
  showTrades: true,
  showOpenPositions: true,
  showNews: true,
  showDividendTracker: true,
};

type SectionId =
  | "topSymbols"
  | "strategyPerformance"
  | "recentTrades"
  | "trades"
  | "openPositions"
  | "news"
  | "dividendTracker";

const SECTION_IDS: SectionId[] = [
  "topSymbols",
  "strategyPerformance",
  "recentTrades",
  "trades",
  "openPositions",
  "news",
  "dividendTracker",
];
function isSectionId(id: string): id is SectionId {
  return SECTION_IDS.includes(id as SectionId);
}

const SECTION_DASHBOARD_SECTION_KEY: Record<SectionId, keyof DashboardSections> = {
  topSymbols: "showTopSymbols",
  strategyPerformance: "showStrategyPerformance",
  recentTrades: "showRecentTrades",
  trades: "showTrades",
  openPositions: "showOpenPositions",
  news: "showNews",
  dividendTracker: "showDividendTracker",
};

const defaultSectionOrder: SectionId[] = [
  "topSymbols",
  "strategyPerformance",
  "recentTrades",
  "news",
  "dividendTracker",
  "openPositions",
  "trades",
];

export type SectionSizes = Record<SectionId, { columnSpan?: number; height?: number; rowSpan?: number }>;

type MoveInLockedGridDir = "up" | "down" | "left" | "right";
const MoveInLockedGridContext = createContext<React.MutableRefObject<((id: string, dir: MoveInLockedGridDir) => void) | null> | null>(null);

export interface DashboardLayoutPreset {
  id: string;
  name: string;
  displayOrder: string[];
  metricCardOrder: string[];
  sectionOrder: SectionId[];
  dashboardSections: DashboardSections;
  sectionSizes?: SectionSizes;
  /** Locked layout: number of columns (2–10). */
  lockedGridColumns?: number;
  /** Locked layout: slot assignments (metric/section ids or null for empty slots). */
  lockedSlotAssignments?: (string | null)[];
  /** Locked layout: packed (row,col) per slot index — required so presets restore grid positions. */
  lockedPlacements?: { row: number; col: number }[] | null;
  /** Locked layout: column width ratios (fr values). */
  lockedColumnWidths?: number[];
}

// Sortable Metric Card Component
// SortableSection component for dashboard sections
function SortableSection({
  id,
  children,
  wrapperStyle,
}: {
  id: SectionId;
  children: (props: { dragHandleProps: any; isDragging: boolean }) => React.ReactNode;
  wrapperStyle?: React.CSSProperties;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    ...wrapperStyle,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
    position: "relative" as const,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ dragHandleProps: { ...attributes, ...listeners }, isDragging })}
    </div>
  );
}

/** Default News section height when none saved — avoids layout jump when articles load (user height still saved via resize). */
const DEFAULT_NEWS_SECTION_HEIGHT_PX = 320;

const DEFAULT_DIVIDEND_TRACKER_SECTION_HEIGHT_PX = 300;

/** Locked grid rows must cover section pixel height or the card overflows and covers other tiles. */
function effectiveSectionRowSpanForLockedGrid(
  id: SectionId,
  sectionSizes: SectionSizes,
  lockedRowHeightPx: number
): number {
  const sec = sectionSizes[id];
  const stored = Math.min(MAX_ROW_SPAN, Math.max(1, sec?.rowSpan ?? 1));
  const rh = lockedRowHeightPx > 0 ? lockedRowHeightPx : 100;
  const rawH =
    sec?.height ??
    (id === "news"
      ? DEFAULT_NEWS_SECTION_HEIGHT_PX
      : id === "dividendTracker"
        ? DEFAULT_DIVIDEND_TRACKER_SECTION_HEIGHT_PX
        : undefined);
  if (rawH != null) {
    const hClamped = Math.min(800, Math.max(200, rawH));
    const implied = Math.ceil(hClamped / rh);
    return Math.min(MAX_ROW_SPAN, Math.max(1, stored, implied));
  }
  return stored;
}

/** Same for metric cards: cardHeight / chartHeight vs row span. */
function effectiveMetricRowSpanForLockedGrid(
  metric: MetricInstance,
  baseMetricId: string,
  lockedRowHeightPx: number
): number {
  const m = metric as MetricInstance;
  const stored = Math.min(MAX_ROW_SPAN, Math.max(1, m.cardRowSpan ?? 1));
  const rh = lockedRowHeightPx > 0 ? lockedRowHeightPx : 100;
  if (baseMetricId === "position_size_chart") {
    const ch = Math.min(600, Math.max(160, m.chartHeight ?? 200));
    const implied = Math.ceil(ch / rh);
    return Math.min(MAX_ROW_SPAN, Math.max(1, stored, implied));
  }
  const defaultH = baseMetricId === "current_price" ? rh : 100;
  const ch = Math.min(400, Math.max(80, m.cardHeight ?? defaultH));
  const implied = Math.ceil(ch / rh);
  return Math.min(MAX_ROW_SPAN, Math.max(1, stored, implied));
}

// Wrapper that adds resize handles (right + bottom) to a dashboard section card
function SectionCardResizeWrapper({
  sectionId,
  sectionSizes,
  setSectionSizes,
  children,
  layoutLocked,
  lockedRowHeight,
}: {
  sectionId: SectionId;
  sectionSizes: SectionSizes;
  setSectionSizes: React.Dispatch<React.SetStateAction<SectionSizes>>;
  children: React.ReactNode;
  layoutLocked?: boolean;
  lockedRowHeight?: number;
}) {
  const size = sectionSizes[sectionId] ?? {};
  const rawHeight =
    size.height != null
      ? size.height
      : sectionId === "news"
        ? DEFAULT_NEWS_SECTION_HEIGHT_PX
        : sectionId === "dividendTracker"
          ? DEFAULT_DIVIDEND_TRACKER_SECTION_HEIGHT_PX
          : undefined;
  const height = rawHeight != null ? Math.min(800, Math.max(200, rawHeight)) : undefined;
  const rowHeight = typeof lockedRowHeight === "number" && lockedRowHeight > 0 ? lockedRowHeight : 100;

  const handleResizeHorizontal = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const card = (e.currentTarget as HTMLElement).closest("[data-section-card]") as HTMLElement | null;
    if (!card) return;
    let grid: HTMLElement | null = card.parentElement;
    while (grid) {
      const ds = getComputedStyle(grid);
      if (ds.display === "grid" && ds.gridTemplateColumns && ds.gridTemplateColumns !== "none") break;
      grid = grid.parentElement;
    }
    if (!grid) return;
    const gs = getComputedStyle(grid);
    const template = gs.gridTemplateColumns;
    const columnCount = parseGridColumnCount(template);
    const gapPx = parseFloat(gs.gap) || 20;
    const gridWidth = grid.clientWidth;
    const columnWidth = columnCount > 1 ? (gridWidth - (columnCount - 1) * gapPx) / columnCount : gridWidth;
    const slotWidth = columnWidth + gapPx;
    const startX = e.clientX;
    const startWidth = card.getBoundingClientRect().width;
    const onMove = (e2: MouseEvent) => {
      const delta = e2.clientX - startX;
      const rawWidth = Math.max(columnWidth, startWidth + delta);
      const span = (rawWidth + gapPx) / slotWidth;
      const newSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, Math.round(span)));
      setSectionSizes((prev) => {
        const next = { ...prev, [sectionId]: { ...prev[sectionId], columnSpan: newSpan } };
        localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
        return next;
      });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleResizeVertical = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startH = height ?? 300;
    if (layoutLocked) {
      const startSpan = Math.min(MAX_ROW_SPAN, Math.max(1, Math.round(startH / rowHeight)));
      const onMove = (e2: MouseEvent) => {
        const delta = e2.clientY - startY;
        const deltaRows = delta / rowHeight;
        const newSpan = Math.min(MAX_ROW_SPAN, Math.max(1, Math.round(startSpan + deltaRows)));
        const newH = newSpan * rowHeight;
        setSectionSizes((prev) => {
          const next = { ...prev, [sectionId]: { ...prev[sectionId], height: newH, rowSpan: newSpan } };
          localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
          return next;
        });
      };
      const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return;
    }
    const SNAP_STEPS = [200, 240, 280, 320, 360, 400, 480, 560, 640, 720, 800];
    const snap = (v: number) => {
      const clamped = Math.min(800, Math.max(200, v));
      let best = SNAP_STEPS[0];
      for (const s of SNAP_STEPS) {
        if (Math.abs(s - clamped) < Math.abs(best - clamped)) best = s;
      }
      return best;
    };
    const onMove = (e2: MouseEvent) => {
      const delta = e2.clientY - startY;
      const rawH = startH + delta;
      const newH = snap(rawH);
      setSectionSizes((prev) => {
        const next = { ...prev, [sectionId]: { ...prev[sectionId], height: newH } };
        localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
        return next;
      });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      data-section-card
      style={{
        position: "relative",
        minHeight: height != null ? `${height}px` : undefined,
        height: height != null ? `${height}px` : undefined,
        minWidth: 0,
      }}
    >
      {children}
      <div
        role="separator"
        aria-label="Resize section width"
        onMouseDown={handleResizeHorizontal}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: "10px",
          cursor: "ew-resize",
          background: "transparent",
          pointerEvents: "auto",
          zIndex: 10,
        }}
      />
      <div
        role="separator"
        aria-label="Resize section height"
        onMouseDown={handleResizeVertical}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "20px",
          cursor: "ns-resize",
          background: "transparent",
          borderTop: "1px solid var(--border-color)",
          pointerEvents: "auto",
          zIndex: 10,
        }}
      />
    </div>
  );
}

// Metric descriptions mapping
const metricDescriptions: Record<string, { description: string; calculation: string }> = {
  total_trades: {
    description: "The total number of closed positions during the selected timeframe.",
    calculation: "Count of all positions (entry + exit) that have been closed."
  },
  total_volume: {
    description: "The total dollar volume of all trades executed during the selected timeframe.",
    calculation: "Sum of (quantity × price) for all trades."
  },
  total_profit_loss: {
    description: "The total net profit or loss from all closed positions, including fees.",
    calculation: "Sum of net_profit_loss for all positions (gross P&L minus entry and exit fees)."
  },
  win_rate: {
    description: "The percentage of closed trades that resulted in a profit.",
    calculation: "Winning trades ÷ Total trades × 100%"
  },
  winning_trades: {
    description: "The number of closed trades that resulted in a profit.",
    calculation: "Count of positions where net_profit_loss > 0"
  },
  losing_trades: {
    description: "The number of closed trades that resulted in a loss.",
    calculation: "Count of positions where net_profit_loss < 0"
  },
  average_profit: {
    description: "The average profit per winning trade.",
    calculation: "Total profit from winning trades ÷ Number of winning trades"
  },
  average_loss: {
    description: "The average loss per losing trade.",
    calculation: "Total loss from losing trades ÷ Number of losing trades"
  },
  largest_win: {
    description: "The single largest profit from a closed position (complete position, including all adds and closes).",
    calculation: "Maximum total_pnl from all position groups"
  },
  largest_loss: {
    description: "The single largest loss from a closed position (complete position, including all adds and closes).",
    calculation: "Minimum (most negative) total_pnl from all position groups"
  },
  average_trade: {
    description: "The average profit or loss per trade across all closed positions.",
    calculation: "Total P&L ÷ Total number of trades"
  },
  profit_factor: {
    description: "A ratio comparing total gross profit to total gross loss. Values above 1.0 indicate profitability.",
    calculation: "Total gross profit ÷ Total gross loss"
  },
  expectancy: {
    description: "The expected value per trade, indicating average profit per trade over time.",
    calculation: "(Win Rate × Average Win) - (Loss Rate × Average Loss)"
  },
  max_drawdown: {
    description: "The largest peak-to-trough decline in equity during the selected timeframe.",
    calculation: "Maximum difference between peak equity and subsequent equity low"
  },
  sharpe_ratio: {
    description: "A measure of risk-adjusted return (currently not implemented).",
    calculation: "Not yet implemented"
  },
  risk_reward_ratio: {
    description: "The ratio of average win to average loss, indicating the risk/reward profile.",
    calculation: "Average Win ÷ Average Loss"
  },
  consecutive_wins: {
    description: "The longest streak of consecutive winning trades in your history.",
    calculation: "Maximum consecutive count of trades with net_profit_loss > 0"
  },
  consecutive_losses: {
    description: "The longest streak of consecutive losing trades in your history.",
    calculation: "Maximum consecutive count of trades with net_profit_loss < 0"
  },
  current_win_streak: {
    description: "The current number of consecutive winning trades (from most recent trades).",
    calculation: "Count of consecutive winning trades starting from the most recent trade"
  },
  current_loss_streak: {
    description: "The current number of consecutive losing trades (from most recent trades).",
    calculation: "Count of consecutive losing trades starting from the most recent trade"
  },
  total_fees: {
    description: "The total amount paid in trading fees (entry fees + exit fees) for all closed positions.",
    calculation: "Sum of (entry_fees + exit_fees) for all positions"
  },
  net_profit: {
    description: "Total profit or loss after accounting for all fees (same as Total P&L).",
    calculation: "Total P&L (already includes fees in net_profit_loss calculation)"
  },
  trades_per_day: {
    description: "The average number of trades executed per trading day during the selected timeframe.",
    calculation: "Total trades ÷ Number of trading days with trades"
  },
  best_day: {
    description: "The single best trading day by net profit during the selected timeframe.",
    calculation: "Maximum daily P&L from all trading days"
  },
  worst_day: {
    description: "The single worst trading day by net loss during the selected timeframe.",
    calculation: "Minimum (most negative) daily P&L from all trading days"
  },
  average_holding_time_seconds: {
    description: "The average amount of time positions are held open before being closed.",
    calculation: "Sum of (exit_timestamp - entry_timestamp) for all positions ÷ Number of trades"
  },
  position_size_chart: {
    description: "Step chart of position size over time for a selected open position.",
    calculation: "Running sum of quantity (BUY +, SELL -) by trade timestamp for the chosen position."
  },
  current_price: {
    description: "Live last price for a symbol you choose, refreshed on an interval or manually.",
    calculation: "Fetched from your quote provider via fetch_stock_quote (same source as other quote features)."
  },
  strategy_win_rate: {
    description: "The win rate for trades assigned to strategies (excluding unassigned trades).",
    calculation: "Strategy winning trades ÷ (Strategy winning trades + Strategy losing trades) × 100%"
  },
  strategy_winning_trades: {
    description: "The number of winning trades that are assigned to strategies.",
    calculation: "Count of strategy-assigned trades where net_profit_loss > 0"
  },
  strategy_losing_trades: {
    description: "The number of losing trades that are assigned to strategies.",
    calculation: "Count of strategy-assigned trades where net_profit_loss < 0"
  },
  strategy_profit_loss: {
    description: "The total profit or loss from all trades assigned to strategies.",
    calculation: "Sum of net_profit_loss for all strategy-assigned trades"
  },
  strategy_consecutive_wins: {
    description: "The longest streak of consecutive winning trades for strategy-assigned trades.",
    calculation: "Maximum consecutive count of strategy trades with net_profit_loss > 0"
  },
  strategy_consecutive_losses: {
    description: "The longest streak of consecutive losing trades for strategy-assigned trades.",
    calculation: "Maximum consecutive count of strategy trades with net_profit_loss < 0"
  },
};

function DroppableSlot({ id, children, style: slotStyle, fillCell }: { id: string; children: React.ReactNode; style?: React.CSSProperties; fillCell?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const { active } = useDndContext();
  const isEmpty = children == null;
  const showOutline = active != null;
  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 0,
        maxWidth: "100%",
        overflow: "visible",
        boxSizing: "border-box",
        ...(fillCell ? { minHeight: 0, height: "100%" } : { minHeight: isEmpty ? "100px" : "120px" }),
        borderRadius: "8px",
        border: showOutline && isOver ? "2px dashed var(--accent)" : showOutline && isEmpty ? "1px dashed var(--border-color)" : "1px solid transparent",
        backgroundColor: showOutline && isOver ? "color-mix(in srgb, var(--accent) 8%, transparent)" : showOutline && isEmpty ? "color-mix(in srgb, var(--bg-secondary) 0.5, transparent)" : "transparent",
        transition: "border-color 0.15s, background-color 0.15s",
        ...slotStyle,
      }}
    >
      {children}
    </div>
  );
}

function SortableMetricCard({
  id,
  metric,
  value,
  Icon,
  color,
  metrics,
  formatMetricValue,
  setTimeframe,
  setCustomStartDate,
  setCustomEndDate,
  setSelectedPositionGroupId,
  setShowPositionGroupModal,
  setSelectedPositionGroup,
  openMetricSettings,
  setOpenMetricSettings,
  metricMenuPosition,
  setMetricMenuPosition,
  sortedMetrics,
  enabledMetrics,
  setMetricCardOrder,
  strategies,
  strategyFilterForMetrics,
  setStrategyFilterForMetrics,
  duplicateMetricInstance,
  removeMetricInstance,
  setMetricInstances,
  dataMode,
  openPositionGroups = [],
  isGridLayout = false,
  isFluidGrid = false,
  layoutLocked = false,
  lockedRowHeight,
}: {
  id: string;
  metric: any;
  value: number;
  Icon: any;
  color: string;
  metrics: Metrics | null;
  formatMetricValue: (id: string, value: number, metrics: Metrics | null) => string;
  setTimeframe: (timeframe: Timeframe) => void;
  setCustomStartDate: (date: string) => void;
  setCustomEndDate: (date: string) => void;
  setSelectedPositionGroupId: (id: number | null) => void;
  setShowPositionGroupModal: (show: boolean) => void;
  setSelectedPositionGroup: (group: any) => void;
  openMetricSettings: string | null;
  setOpenMetricSettings: (id: string | null) => void;
  metricMenuPosition: { top: number; right: number };
  setMetricMenuPosition: (pos: { top: number; right: number }) => void;
  sortedMetrics: any[];
  enabledMetrics: any[];
  setMetricCardOrder: React.Dispatch<React.SetStateAction<string[]>>;
  strategies: Strategy[];
  strategyFilterForMetrics: Record<string, number | null>;
  setStrategyFilterForMetrics: React.Dispatch<React.SetStateAction<Record<string, number | null>>>;
  duplicateMetricInstance: (instanceId: string) => void;
  removeMetricInstance: (instanceId: string) => void;
  setMetricInstances: React.Dispatch<React.SetStateAction<MetricInstance[]>>;
  dataMode: DataMode;
  openPositionGroups?: OpenPositionGroup[];
  isGridLayout?: boolean;
  isFluidGrid?: boolean;
  layoutLocked?: boolean;
  lockedRowHeight?: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const moveInLockedGridRef = useContext(MoveInLockedGridContext);
  const currentPriceSyncCtx = useContext(CurrentPriceSyncContext);
  const currentPriceRefreshRef = useRef<(() => void) | null>(null);
  const [currentPriceVsOpenVisual, setCurrentPriceVsOpenVisual] = useState<{
    kind: CurrentPriceVsOpenKind;
    tint: string;
  } | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  const baseMetricId = (metric as any).baseMetricId || metric.id;
  const isPositionSizeChart = baseMetricId === "position_size_chart";
  const positionEntryId = (metric as MetricInstance).positionEntryId ?? null;
  const selectedGroup = openPositionGroups.find((g) => g.entry_trade.id === positionEntryId);
  const chartHeight = Math.min(600, Math.max(160, (metric as MetricInstance).chartHeight ?? 200));
  const chartWidth = (metric as MetricInstance).chartWidth;
  const chartColumnSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, (metric as MetricInstance).chartColumnSpan ?? 1));
  const brushStart = (metric as MetricInstance).positionChartBrushStart ?? 0;
  const brushEnd = (metric as MetricInstance).positionChartBrushEnd ?? 0;

  // Position size chart card: different layout with selector and chart
  if (isPositionSizeChart) {
    let chartData: { time: string; positionSize: number; label: string }[] = [];
    if (selectedGroup && selectedGroup.position_trades.length >= 1) {
      chartData = [
        {
          time: selectedGroup.position_trades[0].timestamp,
          positionSize: 0,
          label: format(new Date(selectedGroup.position_trades[0].timestamp), "MMM d, HH:mm"),
        },
      ];
      let running = 0;
      selectedGroup.position_trades.forEach((t) => {
        const side = t.side.toUpperCase();
        if (side === "BUY") running += t.quantity;
        else if (side === "SELL") running -= t.quantity;
        chartData.push({
          time: t.timestamp,
          positionSize: running,
          label: format(new Date(t.timestamp), "MMM d, HH:mm"),
        });
      });
    }

    const useBrush = chartData.length > BRUSH_MIN_POINTS;
    const brushStartClamped = useBrush && brushEnd > 0 ? Math.min(brushStart, chartData.length - 1) : 0;
    const brushEndClamped = useBrush && brushEnd > 0 ? Math.min(chartData.length - 1, Math.max(brushStartClamped, brushEnd)) : Math.max(0, chartData.length - 1);

    const rowHeightForChart = typeof lockedRowHeight === "number" && lockedRowHeight > 0 ? lockedRowHeight : 100;
    const handleResizeStart = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = chartHeight;
      if (layoutLocked) {
        const startSpan = Math.min(MAX_ROW_SPAN, Math.max(1, (metric as MetricInstance).cardRowSpan ?? (Math.round(startHeight / rowHeightForChart) || 1)));
        const onMove = (e2: MouseEvent) => {
          const delta = e2.clientY - startY;
          const deltaRows = delta / rowHeightForChart;
          const newSpan = Math.min(MAX_ROW_SPAN, Math.max(1, Math.round(startSpan + deltaRows)));
          const newHeight = newSpan * rowHeightForChart;
          setMetricInstances((prev: MetricInstance[]) => {
            const updated = prev.map((inst: MetricInstance) =>
              inst.instanceId === metric.id ? { ...inst, chartHeight: newHeight, cardRowSpan: newSpan } : inst
            );
            localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
            return updated;
          });
        };
        const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return;
      }
      const SNAP_STEPS = [160, 200, 240, 280, 320, 400, 480, 600];
      const snap = (v: number) => {
        const clamped = Math.min(600, Math.max(160, v));
        let best = SNAP_STEPS[0];
        for (const s of SNAP_STEPS) {
          if (Math.abs(s - clamped) < Math.abs(best - clamped)) best = s;
        }
        return best;
      };
      const onMove = (e2: MouseEvent) => {
        const delta = e2.clientY - startY;
        const newHeight = snap(startHeight + delta);
        setMetricInstances((prev: MetricInstance[]) => {
          const updated = prev.map((inst: MetricInstance) =>
            inst.instanceId === metric.id ? { ...inst, chartHeight: newHeight } : inst
          );
          localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
          return updated;
        });
      };
      const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    const handleResizeHorizontalStart = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const card = (e.currentTarget as HTMLElement).closest("[data-position-chart-card]") as HTMLElement | null;
      if (!card) return;
      const startX = e.clientX;
      const startWidth = card.getBoundingClientRect().width;

      if (isGridLayout) {
        // Snap to grid column edges so chart stays in ratio with other metrics on window resize
        let grid: HTMLElement | null = card.parentElement;
        while (grid) {
          const ds = getComputedStyle(grid);
          if (ds.display === "grid" && ds.gridTemplateColumns && ds.gridTemplateColumns !== "none") {
            break;
          }
          grid = grid.parentElement;
        }
        if (!grid) return;
        const gs = getComputedStyle(grid);
        const template = gs.gridTemplateColumns;
        const columnCount = parseGridColumnCount(template);
        const gapPx = parseFloat(gs.gap) || 20;
        const gridWidth = grid.clientWidth;
        const columnWidth = columnCount > 1
          ? (gridWidth - (columnCount - 1) * gapPx) / columnCount
          : gridWidth;
        const slotWidth = columnWidth + gapPx;

        const onMove = (e2: MouseEvent) => {
          const delta = e2.clientX - startX;
          const rawWidth = Math.max(columnWidth, startWidth + delta);
          const span = (rawWidth + gapPx) / slotWidth;
          const newSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, Math.round(span)));
          setMetricInstances((prev: MetricInstance[]) => {
            const updated = prev.map((inst: MetricInstance) =>
              inst.instanceId === metric.id ? { ...inst, chartColumnSpan: newSpan, chartWidth: undefined } : inst
            );
            localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
            return updated;
          });
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return;
      }

      // Flex layout: snap to fixed pixel multiples
      const SNAP_UNIT = 280;
      const MIN_CHART_WIDTH = 280;
      const MAX_CHART_WIDTH = 1200;
      const onMove = (e2: MouseEvent) => {
        const delta = e2.clientX - startX;
        const rawWidth = Math.min(MAX_CHART_WIDTH, Math.max(MIN_CHART_WIDTH, startWidth + delta));
        const snappedWidth = Math.round(rawWidth / SNAP_UNIT) * SNAP_UNIT;
        const newWidth = Math.min(MAX_CHART_WIDTH, Math.max(MIN_CHART_WIDTH, snappedWidth));
        setMetricInstances((prev: MetricInstance[]) => {
          const updated = prev.map((inst: MetricInstance) =>
            inst.instanceId === metric.id ? { ...inst, chartWidth: newWidth } : inst
          );
          localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
          return updated;
        });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    return (
      <div
        ref={setNodeRef}
        data-position-chart-card
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
          WebkitUserSelect: "none",
          ...(isGridLayout
            ? {
                width: "100%",
                minWidth: 0,
                maxWidth: "100%",
                overflow: "hidden",
                boxSizing: "border-box",
                ...(chartColumnSpan > 1 ? { gridColumn: `span ${chartColumnSpan}` as const } : {}),
              }
            : {
                flex: `0 0 ${chartWidth ? `${chartWidth}px` : "280px"}`,
                width: chartWidth ? `${chartWidth}px` : "280px",
                minWidth: 280,
                maxWidth: chartWidth ? 1200 : undefined,
              }),
          ...(layoutLocked ? { height: "100%", minHeight: 0 } : { minHeight: "320px" }),
          position: "relative",
          ...style,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexShrink: 0, minWidth: 0 }}>
          <div {...attributes} {...listeners} style={{ cursor: "grab", flexShrink: 0 }}>
            <GripVertical size={16} color="var(--text-secondary)" />
          </div>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "8px",
              backgroundColor: `${color}20`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: color,
              flexShrink: 0,
            }}
          >
            <Icon size={24} />
          </div>
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}>{metric.label}</p>
            <select
              value={positionEntryId ?? ""}
              onChange={(e) => {
                const val = e.target.value === "" ? null : parseInt(e.target.value, 10);
                setMetricInstances((prev: MetricInstance[]) => {
                  const updated = prev.map((inst: MetricInstance) =>
                    inst.instanceId === metric.id ? { ...inst, positionEntryId: val } : inst
                  );
                  localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
                  return updated;
                });
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                padding: "6px 8px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                color: "var(--text-primary)",
                fontSize: "13px",
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                cursor: "pointer",
                boxSizing: "border-box",
              }}
            >
              <option value="">Select position…</option>
              {openPositionGroups.map((g) => (
                <option key={g.entry_trade.id} value={g.entry_trade.id}>
                  {g.entry_trade.symbol} {g.entry_trade.side} {g.entry_trade.quantity >= 0 ? "+" : ""}{formatWithCommas(g.entry_trade.quantity, { maxDecimals: 2 })}
                </option>
              ))}
            </select>
          </div>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMetricMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                setOpenMetricSettings(openMetricSettings === metric.id ? null : metric.id);
              }}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              style={{
                background: "transparent",
                border: "none",
                padding: "4px",
                cursor: "pointer",
                color: "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Settings size={16} />
            </button>
            {openMetricSettings === metric.id && createPortal(
              <div
                data-settings-menu
                style={{
                  position: "fixed",
                  top: `${metricMenuPosition.top}px`,
                  right: `${metricMenuPosition.right}px`,
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "0",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                  zIndex: 99999,
                  minWidth: "280px",
                  maxWidth: "400px",
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {metricDescriptions[baseMetricId] && (
                    <div style={{ padding: "12px", borderBottom: "1px solid var(--border-color)", marginBottom: "4px" }}>
                      <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "8px" }}>{metric.label}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: "1.5", marginBottom: "8px" }}>{metricDescriptions[baseMetricId].description}</div>
                      <div style={{ fontSize: "10px", color: "var(--text-secondary)", fontStyle: "italic", paddingTop: "8px", borderTop: "1px solid var(--border-color)" }}>
                        <strong>Calculation:</strong> {metricDescriptions[baseMetricId].calculation}
                      </div>
                    </div>
                  )}
                  {layoutLocked && moveInLockedGridRef?.current ? (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.(metric.id, "up"); setOpenMetricSettings(null); }}
                        style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                      >
                        <ChevronUp size={14} />
                        <span>Move up</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.(metric.id, "down"); setOpenMetricSettings(null); }}
                        style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                      >
                        <ChevronDown size={14} />
                        <span>Move down</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.(metric.id, "left"); setOpenMetricSettings(null); }}
                        style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                      >
                        <ChevronLeft size={14} />
                        <span>Move left</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.(metric.id, "right"); setOpenMetricSettings(null); }}
                        style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                      >
                        <ChevronRight size={14} />
                        <span>Move right</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const currentIndex = sortedMetrics.findIndex(m => m.id === metric.id);
                          if (currentIndex > 0) {
                            setMetricCardOrder((prevOrder) => {
                              const currentIds = enabledMetrics.map(m => m.id);
                              let newOrder = [...prevOrder];
                              currentIds.forEach(id => { if (!newOrder.includes(id)) newOrder.push(id); });
                              newOrder = newOrder.filter(id => currentIds.includes(id));
                              const metricIndex = newOrder.indexOf(metric.id);
                              if (metricIndex > 0) {
                                [newOrder[metricIndex - 1], newOrder[metricIndex]] = [newOrder[metricIndex], newOrder[metricIndex - 1]];
                                localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
                                return newOrder;
                              }
                              return prevOrder;
                            });
                          }
                        }}
                        disabled={sortedMetrics.findIndex(m => m.id === metric.id) === 0}
                        style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sortedMetrics.findIndex(m => m.id === metric.id) === 0 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sortedMetrics.findIndex(m => m.id === metric.id) === 0 ? 0.3 : 1 }}
                      >
                        <ChevronUp size={14} />
                        <span>Move Up</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const currentIndex = sortedMetrics.findIndex(m => m.id === metric.id);
                          if (currentIndex < sortedMetrics.length - 1) {
                            setMetricCardOrder((prevOrder) => {
                              const currentIds = enabledMetrics.map(m => m.id);
                              let newOrder = [...prevOrder];
                              currentIds.forEach(id => { if (!newOrder.includes(id)) newOrder.push(id); });
                              newOrder = newOrder.filter(id => currentIds.includes(id));
                              const metricIndex = newOrder.indexOf(metric.id);
                              if (metricIndex < newOrder.length - 1) {
                                [newOrder[metricIndex], newOrder[metricIndex + 1]] = [newOrder[metricIndex + 1], newOrder[metricIndex]];
                                localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
                                return newOrder;
                              }
                              return prevOrder;
                            });
                          }
                        }}
                        disabled={sortedMetrics.findIndex(m => m.id === metric.id) === sortedMetrics.length - 1}
                        style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sortedMetrics.findIndex(m => m.id === metric.id) === sortedMetrics.length - 1 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sortedMetrics.findIndex(m => m.id === metric.id) === sortedMetrics.length - 1 ? 0.3 : 1 }}
                      >
                        <ChevronDown size={14} />
                        <span>Move Down</span>
                      </button>
                    </>
                  )}
                  <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setMetricInstances((prev: MetricInstance[]) => {
                        const updated = prev.map((inst: MetricInstance) =>
                          inst.instanceId === metric.id
                            ? { ...inst, cardWidth: undefined, cardHeight: undefined, cardColumnSpan: undefined }
                            : inst
                        );
                        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
                        return updated;
                      });
                      setOpenMetricSettings(null);
                    }}
                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                  >
                    <RotateCcw size={14} />
                    <span>Reset size</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      duplicateMetricInstance(metric.id);
                      setOpenMetricSettings(null);
                    }}
                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                  >
                    <Copy size={14} />
                    <span>Duplicate</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      removeMetricInstance(metric.id);
                      setOpenMetricSettings(null);
                    }}
                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--loss)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                  >
                    <Trash2 size={14} />
                    <span>Remove</span>
                  </button>
                </div>
              </div>,
              document.body
            )}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: layoutLocked ? 0 : 160, display: "flex", flexDirection: "column", pointerEvents: "auto", overflow: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
          {selectedGroup && chartData.length > 0 ? (
            <>
              {layoutLocked ? (
                <div style={{ flex: 1, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} stroke="var(--border-color)" />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                    stroke="var(--border-color)"
                    tickFormatter={(v) => (v >= 0 ? `+${formatWithCommas(v, { maxDecimals: 2 })}` : formatWithCommas(v, { maxDecimals: 2 }))}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px" }}
                    labelStyle={{ color: "var(--text-primary)" }}
                    formatter={(value: number) => [value >= 0 ? `+${formatWithCommas(value, { minDecimals: 4, maxDecimals: 4 })}` : formatWithCommas(value, { minDecimals: 4, maxDecimals: 4 }), "Position size"]}
                    labelFormatter={(label) => `Time: ${label}`}
                  />
                  <ReferenceLine y={0} stroke="var(--text-secondary)" strokeDasharray="2 2" />
                  <Line type="stepAfter" dataKey="positionSize" stroke="var(--accent)" strokeWidth={2} dot={{ fill: "var(--accent)", r: 3 }} activeDot={{ r: 5 }} isAnimationActive={true} />
                  {useBrush && (
                    <Brush
                      dataKey="label"
                      height={36}
                      stroke="var(--border-color)"
                      fill="var(--bg-tertiary)"
                      startIndex={brushStartClamped}
                      endIndex={brushEndClamped}
                      onDragEnd={(r: { startIndex?: number; endIndex?: number }) => {
                        if (r.startIndex != null && r.endIndex != null) {
                          setMetricInstances((prev: MetricInstance[]) => {
                            const updated = prev.map((inst: MetricInstance) =>
                              inst.instanceId === metric.id
                                ? { ...inst, positionChartBrushStart: r.startIndex!, positionChartBrushEnd: r.endIndex! }
                                : inst
                            );
                            localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
                            return updated;
                          });
                        }
                      }}
                    />
                  )}
                </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={useBrush ? chartHeight - 36 : chartHeight}>
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} stroke="var(--border-color)" />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                      stroke="var(--border-color)"
                      tickFormatter={(v) => (v >= 0 ? `+${formatWithCommas(v, { maxDecimals: 2 })}` : formatWithCommas(v, { maxDecimals: 2 }))}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px" }}
                      labelStyle={{ color: "var(--text-primary)" }}
                      formatter={(value: number) => [value >= 0 ? `+${formatWithCommas(value, { minDecimals: 4, maxDecimals: 4 })}` : formatWithCommas(value, { minDecimals: 4, maxDecimals: 4 }), "Position size"]}
                      labelFormatter={(label) => `Time: ${label}`}
                    />
                    <ReferenceLine y={0} stroke="var(--text-secondary)" strokeDasharray="2 2" />
                    <Line type="stepAfter" dataKey="positionSize" stroke="var(--accent)" strokeWidth={2} dot={{ fill: "var(--accent)", r: 3 }} activeDot={{ r: 5 }} isAnimationActive={true} />
                    {useBrush && (
                      <Brush
                        dataKey="label"
                        height={36}
                        stroke="var(--border-color)"
                        fill="var(--bg-tertiary)"
                        startIndex={brushStartClamped}
                        endIndex={brushEndClamped}
                        onDragEnd={(r: { startIndex?: number; endIndex?: number }) => {
                          if (r.startIndex != null && r.endIndex != null) {
                            setMetricInstances((prev: MetricInstance[]) => {
                              const updated = prev.map((inst: MetricInstance) =>
                                inst.instanceId === metric.id
                                  ? { ...inst, positionChartBrushStart: r.startIndex!, positionChartBrushEnd: r.endIndex! }
                                  : inst
                              );
                              localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
                              return updated;
                            });
                          }
                        }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, minHeight: layoutLocked ? 0 : chartHeight, color: "var(--text-secondary)", fontSize: "14px" }}>
              {openPositionGroups.length === 0 ? "No open positions" : "Select a position above"}
            </div>
          )}
        </div>
        <div
          role="separator"
          aria-label="Resize chart width"
          onMouseDown={handleResizeHorizontalStart}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "8px",
            cursor: "ew-resize",
            flexShrink: 0,
            background: "transparent",
            pointerEvents: "auto",
          }}
        />
        <div
          role="separator"
          aria-label="Resize chart height"
          onMouseDown={handleResizeStart}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "10px",
            cursor: "ns-resize",
            background: "transparent",
            pointerEvents: "auto",
          }}
        />
      </div>
    );
  }

  const rowHeightForCard = typeof lockedRowHeight === "number" && lockedRowHeight > 0 ? lockedRowHeight : 100;
  const defaultCardH = baseMetricId === "current_price" ? rowHeightForCard : 100;
  const cardHeight = Math.min(400, Math.max(80, (metric as MetricInstance).cardHeight ?? defaultCardH));
  const cardWidth = (metric as MetricInstance).cardWidth;
  const cardColumnSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, (metric as MetricInstance).cardColumnSpan ?? 1));
  const fillLockedGridCell = layoutLocked && baseMetricId === "current_price";

  const handleCardResizeVertical = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startH = cardHeight;
    const rowHeight = typeof lockedRowHeight === "number" && lockedRowHeight > 0 ? lockedRowHeight : 100;
    if (layoutLocked) {
      const startSpan = Math.min(MAX_ROW_SPAN, Math.max(1, (metric as MetricInstance).cardRowSpan ?? (Math.round(startH / rowHeight) || 1)));
      const onMove = (e2: MouseEvent) => {
        const delta = e2.clientY - startY;
        const deltaRows = delta / rowHeight;
        const newSpan = Math.min(MAX_ROW_SPAN, Math.max(1, Math.round(startSpan + deltaRows)));
        const newH = newSpan * rowHeight;
        setMetricInstances((prev: MetricInstance[]) => {
          const updated = prev.map((inst: MetricInstance) =>
            inst.instanceId === metric.id ? { ...inst, cardRowSpan: newSpan, cardHeight: newH } : inst
          );
          localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
          return updated;
        });
      };
      const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return;
    }
    const SNAP_STEPS = [80, 100, 120, 140, 160, 200, 240, 280, 320, 400];
    const snap = (v: number) => {
      const clamped = Math.min(400, Math.max(80, v));
      let best = SNAP_STEPS[0];
      for (const s of SNAP_STEPS) {
        if (Math.abs(s - clamped) < Math.abs(best - clamped)) best = s;
      }
      return best;
    };
    const onMove = (e2: MouseEvent) => {
      const delta = e2.clientY - startY;
      const newH = snap(startH + delta);
      setMetricInstances((prev: MetricInstance[]) => {
        const updated = prev.map((inst: MetricInstance) =>
          inst.instanceId === metric.id ? { ...inst, cardHeight: newH } : inst
        );
        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
        return updated;
      });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleCardResizeHorizontal = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const card = (e.currentTarget as HTMLElement).closest("[data-metric-card]") as HTMLElement | null;
    if (!card) return;
    const startX = e.clientX;
    const startWidth = card.getBoundingClientRect().width;
    if (isGridLayout) {
      let grid: HTMLElement | null = card.parentElement;
      while (grid) {
        const ds = getComputedStyle(grid);
        if (ds.display === "grid" && ds.gridTemplateColumns && ds.gridTemplateColumns !== "none") break;
        grid = grid.parentElement;
      }
      if (grid) {
        const gs = getComputedStyle(grid);
        const template = gs.gridTemplateColumns;
        const isFluidGrid = template.includes("auto-fit") || template.includes("auto-fill");
        if (!isFluidGrid) {
          const columnCount = parseGridColumnCount(template);
          const gapPx = parseFloat(gs.gap) || 20;
          const gridWidth = grid.clientWidth;
          const columnWidth = columnCount > 1 ? (gridWidth - (columnCount - 1) * gapPx) / columnCount : gridWidth;
          const slotWidth = columnWidth + gapPx;
          const minWidth = columnWidth;
          const onMove = (e2: MouseEvent) => {
            const delta = e2.clientX - startX;
            const rawWidth = Math.max(minWidth, startWidth + delta);
            const span = (rawWidth + gapPx) / slotWidth;
            const newSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, Math.round(span)));
            setMetricInstances((prev: MetricInstance[]) => {
              const updated = prev.map((inst: MetricInstance) =>
                inst.instanceId === metric.id ? { ...inst, cardColumnSpan: newSpan, cardWidth: undefined } : inst
              );
              localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
              return updated;
            });
          };
          const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
          return;
        }
      }
    }
    const SNAP = 280;
    const MIN_W = 200;
    const MAX_W = 1200;
    const onMove = (e2: MouseEvent) => {
      const delta = e2.clientX - startX;
      const raw = Math.min(MAX_W, Math.max(MIN_W, startWidth + delta));
      const snapped = Math.round(raw / SNAP) * SNAP;
      const newW = Math.min(MAX_W, Math.max(MIN_W, snapped));
      setMetricInstances((prev: MetricInstance[]) => {
        const updated = prev.map((inst: MetricInstance) =>
          inst.instanceId === metric.id ? { ...inst, cardWidth: newW } : inst
        );
        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
        return updated;
      });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={setNodeRef}
      data-metric-card
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        borderRadius: "8px",
        padding: fillLockedGridCell ? "8px 12px" : "20px",
        display: "flex",
        alignItems: fillLockedGridCell ? "stretch" : "center",
        gap: "16px",
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        WebkitUserSelect: "none",
        position: "relative",
        ...(isGridLayout
          ? {
              ...(isFluidGrid && cardWidth
                ? { width: `${cardWidth}px`, minWidth: 200, maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" as const }
                : { width: "100%", minWidth: 0, maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" as const }),
              ...(cardColumnSpan > 1 ? { gridColumn: `span ${cardColumnSpan}` as const } : {}),
            }
          : {
              flex: `0 0 ${cardWidth ? `${cardWidth}px` : "280px"}`,
              width: cardWidth ? `${cardWidth}px` : "280px",
              minWidth: cardWidth ?? 280,
              maxWidth: cardWidth ? 1200 : undefined,
            }),
        ...(fillLockedGridCell
          ? { height: "100%", minHeight: 0, boxSizing: "border-box" as const }
          : { height: `${cardHeight}px` }),
        ...style,
      }}
    >
      <div {...attributes} {...listeners} style={{ cursor: "grab", flexShrink: 0, ...(fillLockedGridCell ? { alignSelf: "center" } : {}) }}>
        <GripVertical size={16} color="var(--text-secondary)" />
      </div>
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "8px",
          backgroundColor: `${baseMetricId === "current_price" && currentPriceVsOpenVisual ? currentPriceVsOpenVisual.tint : color}20`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: baseMetricId === "current_price" && currentPriceVsOpenVisual ? currentPriceVsOpenVisual.tint : color,
          flexShrink: 0,
          pointerEvents: "none",
          ...(fillLockedGridCell ? { alignSelf: "center" } : {}),
        }}
      >
        {baseMetricId === "current_price" ? (
          currentPriceVsOpenVisual?.kind === "up" ? (
            <TrendingUp size={24} />
          ) : currentPriceVsOpenVisual?.kind === "down" ? (
            <TrendingDown size={24} />
          ) : (
            <CircleDollarSign size={24} />
          )
        ) : (
          <Icon size={24} />
        )}
      </div>
      {(metric as any).baseMetricId === "current_price" ? (
        <CurrentPriceMetricRow
          metric={metric}
          setMetricInstances={setMetricInstances}
          dataMode={dataMode}
          fillLockedGridCell={fillLockedGridCell}
          refreshActionRef={currentPriceRefreshRef}
          onVsOpenVisual={setCurrentPriceVsOpenVisual}
        >
          <p
            style={{
              fontSize: "14px",
              color: "var(--text-secondary)",
              marginBottom: "4px",
            }}
          >
            {(() => {
              const selectedStrategyId = strategyFilterForMetrics[metric.id];
              if (selectedStrategyId !== null && selectedStrategyId !== undefined) {
                const strategy = strategies.find((s) => s.id === selectedStrategyId);
                if (strategy) {
                  return `${metric.label} (${strategy.name})`;
                }
              }
              return metric.label;
            })()}
          </p>
        </CurrentPriceMetricRow>
      ) : (
      <div 
        style={{ 
          flex: 1, 
          minWidth: 0,
          minHeight: fillLockedGridCell ? 0 : undefined,
          overflow: "hidden",
          pointerEvents: ((metric as any).baseMetricId === "best_day" || (metric as any).baseMetricId === "worst_day" || (metric as any).baseMetricId === "largest_win" || (metric as any).baseMetricId === "largest_loss") ? "auto" : "none",
          cursor: ((metric as any).baseMetricId === "best_day" || (metric as any).baseMetricId === "worst_day" || (metric as any).baseMetricId === "largest_win" || (metric as any).baseMetricId === "largest_loss") ? "pointer" : "default",
        }}
        onClick={async (e) => {
          const baseMetricId = (metric as any).baseMetricId || metric.id;
          if (baseMetricId === "best_day" && metrics?.best_day_date) {
            e.stopPropagation();
            setTimeframe("custom");
            setCustomStartDate(metrics.best_day_date);
            setCustomEndDate(metrics.best_day_date);
            localStorage.setItem("tradebutler_dashboard_timeframe", "custom");
            localStorage.setItem("tradebutler_dashboard_custom_start", metrics.best_day_date);
            localStorage.setItem("tradebutler_dashboard_custom_end", metrics.best_day_date);
          } else if (baseMetricId === "worst_day" && metrics?.worst_day_date) {
            e.stopPropagation();
            setTimeframe("custom");
            setCustomStartDate(metrics.worst_day_date);
            setCustomEndDate(metrics.worst_day_date);
            localStorage.setItem("tradebutler_dashboard_timeframe", "custom");
            localStorage.setItem("tradebutler_dashboard_custom_start", metrics.worst_day_date);
            localStorage.setItem("tradebutler_dashboard_custom_end", metrics.worst_day_date);
          } else if (baseMetricId === "largest_win" && metrics?.largest_win_group_id) {
            e.stopPropagation();
            setSelectedPositionGroupId(metrics.largest_win_group_id);
            setShowPositionGroupModal(true);
            try {
              const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
              const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
              const groups = await invoke<any[]>("get_position_groups", { pairingMethod, startDate: null, endDate: null, ...paperArgs });
              const group = groups.find(g => g.entry_trade.id === metrics.largest_win_group_id);
              if (group) {
                setSelectedPositionGroup(group);
              }
            } catch (error) {
              console.error("Error loading position group:", error);
            }
          } else if (baseMetricId === "largest_loss" && metrics?.largest_loss_group_id) {
            e.stopPropagation();
            setSelectedPositionGroupId(metrics.largest_loss_group_id);
            setShowPositionGroupModal(true);
            try {
              const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
              const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
              const groups = await invoke<any[]>("get_position_groups", { pairingMethod, startDate: null, endDate: null, ...paperArgs });
              const group = groups.find(g => g.entry_trade.id === metrics.largest_loss_group_id);
              if (group) {
                setSelectedPositionGroup(group);
              }
            } catch (error) {
              console.error("Error loading position group:", error);
            }
          }
        }}
      >
        <p
          style={{
            fontSize: "14px",
            color: "var(--text-secondary)",
            marginBottom: "4px",
          }}
        >
          {(() => {
            // Only use instanceId for the filter - never fall back to baseMetricId
            const selectedStrategyId = strategyFilterForMetrics[metric.id];
            if (selectedStrategyId !== null && selectedStrategyId !== undefined) {
              const strategy = strategies.find(s => s.id === selectedStrategyId);
              if (strategy) {
                return `${metric.label} (${strategy.name})`;
              }
            }
            return metric.label;
          })()}
        </p>
          <p
            title={formatMetricValue((metric as any).baseMetricId || metric.id, value, metrics)}
            style={{
              fontSize: "24px",
              fontWeight: "bold",
              color: color,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {formatMetricValue((metric as any).baseMetricId || metric.id, value, metrics)}
          </p>
      </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          flexShrink: 0,
          gap: "2px",
          ...(fillLockedGridCell ? { alignSelf: "center" } : {}),
        }}
      >
        {(metric as any).baseMetricId === "current_price" && (
          <button
            type="button"
            title="Refresh quote"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              currentPriceRefreshRef.current?.();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            style={{
              background: "transparent",
              border: "none",
              padding: "4px",
              cursor: "pointer",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "4px",
              pointerEvents: "auto",
            }}
          >
            <RefreshCw size={16} />
          </button>
        )}
        <div style={{ position: "relative" }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMetricMenuPosition({
              top: rect.bottom + 4,
              right: window.innerWidth - rect.right,
            });
            setOpenMetricSettings(openMetricSettings === metric.id ? null : metric.id);
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          style={{
            background: "transparent",
            border: "none",
            padding: "4px",
            cursor: "pointer",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "4px",
            pointerEvents: "auto",
          }}
          title="Settings"
        >
          <Settings size={16} />
        </button>
        {openMetricSettings === metric.id && createPortal(
          <div
            data-settings-menu
            style={{
              position: "fixed",
              top: `${metricMenuPosition.top}px`,
              right: `${metricMenuPosition.right}px`,
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "0",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
              zIndex: 99999,
              minWidth: "280px",
              maxWidth: "400px",
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {/* Metric Description */}
              {metricDescriptions[(metric as any).baseMetricId || metric.id] && (
                <div
                  style={{
                    padding: "12px",
                    borderBottom: "1px solid var(--border-color)",
                    marginBottom: "4px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "var(--text-primary)",
                      marginBottom: "8px",
                    }}
                  >
                    {metric.label}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      lineHeight: "1.5",
                      marginBottom: "8px",
                    }}
                  >
                    {metricDescriptions[(metric as any).baseMetricId || metric.id].description}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "var(--text-secondary)",
                      fontStyle: "italic",
                      paddingTop: "8px",
                      borderTop: "1px solid var(--border-color)",
                    }}
                  >
                    <strong>Calculation:</strong> {metricDescriptions[(metric as any).baseMetricId || metric.id].calculation}
                  </div>
                </div>
              )}
              {(metric as any).baseMetricId === "current_price" && (
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-color)" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "6px", fontWeight: "600" }}>Refresh interval</div>
                  {currentPriceSyncCtx?.enabled ? (
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                      Sync is on in Dashboard configure — Current Price cards and Open Positions quotes refresh together every{" "}
                      {currentPriceSyncCtx.seconds}s.
                    </div>
                  ) : (
                  <select
                    value={
                      typeof (metric as MetricInstance).quoteRefreshSeconds === "number" &&
                      !Number.isNaN((metric as MetricInstance).quoteRefreshSeconds!)
                        ? (metric as MetricInstance).quoteRefreshSeconds!
                        : 30
                    }
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setMetricInstances((prev) => {
                        const updated = prev.map((inst) =>
                          inst.instanceId === metric.id ? { ...inst, quoteRefreshSeconds: v } : inst
                        );
                        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
                        return updated;
                      });
                    }}
                    onClick={(ev) => ev.stopPropagation()}
                    onMouseDown={(ev) => ev.stopPropagation()}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value={0}>Manual only</option>
                    <option value={1}>Every 1s</option>
                    <option value={5}>Every 5s</option>
                    <option value={10}>Every 10s</option>
                    <option value={15}>Every 15s</option>
                    <option value={30}>Every 30s</option>
                    <option value={60}>Every 1m</option>
                    <option value={120}>Every 2m</option>
                  </select>
                  )}
                </div>
              )}
              {layoutLocked && moveInLockedGridRef?.current ? (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.(metric.id, "up"); setOpenMetricSettings(null); }}
                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                  >
                    <ChevronUp size={14} />
                    <span>Move up</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.(metric.id, "down"); setOpenMetricSettings(null); }}
                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                  >
                    <ChevronDown size={14} />
                    <span>Move down</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.(metric.id, "left"); setOpenMetricSettings(null); }}
                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                  >
                    <ChevronLeft size={14} />
                    <span>Move left</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.(metric.id, "right"); setOpenMetricSettings(null); }}
                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                  >
                    <ChevronRight size={14} />
                    <span>Move right</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const currentIndex = sortedMetrics.findIndex(m => m.id === metric.id);
                      if (currentIndex > 0) {
                        setMetricCardOrder(prevOrder => {
                          const currentIds = enabledMetrics.map(m => m.id);
                          let newOrder = [...prevOrder];
                          currentIds.forEach(id => { if (!newOrder.includes(id)) newOrder.push(id); });
                          newOrder = newOrder.filter(id => currentIds.includes(id));
                          const metricIndex = newOrder.indexOf(metric.id);
                          if (metricIndex > 0) {
                            [newOrder[metricIndex - 1], newOrder[metricIndex]] = [newOrder[metricIndex], newOrder[metricIndex - 1]];
                            localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
                            return newOrder;
                          }
                          return prevOrder;
                        });
                      }
                    }}
                    disabled={sortedMetrics.findIndex(m => m.id === metric.id) === 0}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      padding: "6px 8px",
                      cursor: sortedMetrics.findIndex(m => m.id === metric.id) === 0 ? "not-allowed" : "pointer",
                      color: "var(--text-primary)",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      opacity: sortedMetrics.findIndex(m => m.id === metric.id) === 0 ? 0.3 : 1,
                    }}
                  >
                    <ChevronUp size={14} />
                    <span>Move Up</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const currentIndex = sortedMetrics.findIndex(m => m.id === metric.id);
                      if (currentIndex < sortedMetrics.length - 1) {
                        setMetricCardOrder(prevOrder => {
                          const currentIds = enabledMetrics.map(m => m.id);
                          let newOrder = [...prevOrder];
                          currentIds.forEach(id => { if (!newOrder.includes(id)) newOrder.push(id); });
                          newOrder = newOrder.filter(id => currentIds.includes(id));
                          const metricIndex = newOrder.indexOf(metric.id);
                          if (metricIndex < newOrder.length - 1) {
                            [newOrder[metricIndex], newOrder[metricIndex + 1]] = [newOrder[metricIndex + 1], newOrder[metricIndex]];
                            localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
                            return newOrder;
                          }
                          return prevOrder;
                        });
                      }
                    }}
                    disabled={sortedMetrics.findIndex(m => m.id === metric.id) === sortedMetrics.length - 1}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      padding: "6px 8px",
                      cursor: sortedMetrics.findIndex(m => m.id === metric.id) === sortedMetrics.length - 1 ? "not-allowed" : "pointer",
                      color: "var(--text-primary)",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      opacity: sortedMetrics.findIndex(m => m.id === metric.id) === sortedMetrics.length - 1 ? 0.3 : 1,
                    }}
                  >
                    <ChevronDown size={14} />
                    <span>Move Down</span>
                  </button>
                </>
              )}
              <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setMetricInstances((prev: MetricInstance[]) => {
                    const updated = prev.map((inst: MetricInstance) =>
                      inst.instanceId === metric.id
                        ? { ...inst, cardWidth: undefined, cardHeight: undefined, cardColumnSpan: undefined }
                        : inst
                    );
                    localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
                    return updated;
                  });
                  setOpenMetricSettings(null);
                }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                }}
              >
                <RotateCcw size={14} />
                <span>Reset size</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  duplicateMetricInstance(metric.id);
                  setOpenMetricSettings(null);
                }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                }}
              >
                <Copy size={14} />
                <span>Duplicate</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  removeMetricInstance(metric.id);
                  setOpenMetricSettings(null);
                }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  cursor: "pointer",
                  color: "var(--loss)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                }}
              >
                <Trash2 size={14} />
                <span>Remove</span>
              </button>
              {/* Strategy Selector for Strategy Metrics */}
              {[
                "strategy_win_rate",
                "strategy_winning_trades",
                "strategy_losing_trades",
                "strategy_profit_loss",
                "strategy_consecutive_wins",
                "strategy_consecutive_losses",
              ].includes((metric as any).baseMetricId || metric.id) && (
                <>
                  <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                  <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                      Filter by Strategy:
                    </label>
                    <select
                      value={strategyFilterForMetrics[metric.id] ?? ""}
                      onChange={(e) => {
                        const value = e.target.value === "" ? null : parseInt(e.target.value, 10);
                        // Only update the specific instance, never the baseMetricId
                        setStrategyFilterForMetrics((prev: Record<string, number | null>) => {
                          const updated: Record<string, number | null> = { ...prev, [metric.id]: value };
                          localStorage.setItem("tradebutler_strategy_filter_for_metrics", JSON.stringify(updated));
                          return updated;
                        });
                        
                        // Update instance strategy filter
                        setMetricInstances((prev: MetricInstance[]) => {
                          const updated = prev.map((inst: MetricInstance) => 
                            inst.instanceId === metric.id 
                              ? { ...inst, strategyFilterId: value }
                              : inst
                          );
                          localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updated));
                          return updated;
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        padding: "6px 8px",
                        backgroundColor: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                        width: "100%",
                        cursor: "pointer",
                      }}
                    >
                      <option value="">All Strategies</option>
                      {strategies.map((strategy: Strategy) => (
                        <option key={strategy.id} value={strategy.id}>
                          {strategy.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
        </div>
      </div>
      {/* Resize: right edge (width / column span) - invisible hit area */}
      <div
        role="separator"
        aria-label="Resize card width"
        onMouseDown={handleCardResizeHorizontal}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: "8px",
          cursor: "ew-resize",
          flexShrink: 0,
          background: "transparent",
          pointerEvents: "auto",
        }}
      />
      {/* Resize: bottom edge (height) - invisible hit area */}
      <div
        role="separator"
        aria-label="Resize card height"
        onMouseDown={handleCardResizeVertical}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "8px",
          cursor: "ns-resize",
          flexShrink: 0,
          background: "transparent",
          pointerEvents: "auto",
        }}
      />
    </div>
  );
}

// Global function to reset metric instances (can be called from browser console)
if (typeof window !== 'undefined') {
  (window as any).resetMetricInstances = () => {
    localStorage.removeItem(METRIC_INSTANCES_KEY);
    localStorage.removeItem(METRIC_CARDS_ORDER_KEY);
    localStorage.removeItem("tradebutler_strategy_filter_for_metrics");
    console.log("Metric instances reset. Please refresh the page.");
    return true;
  };
}

export default function Dashboard() {
  if (typeof window !== "undefined") {
    ensureDashboardProfilesBootstrapped();
  }
  const metricsConfigHook = useMetricsConfig();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [topSymbols, setTopSymbols] = useState<TopSymbol[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformance[]>([]);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [trades, setTrades] = useState<RecentTrade[]>([]);
  const [openPositionGroups, setOpenPositionGroups] = useState<OpenPositionGroup[]>([]);
  const [openPositionQuotes, setOpenPositionQuotes] = useState<Record<string, number | null>>({});
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const navigate = useNavigate();

  const dividendTrackerDashboardRefreshRef = useRef<(() => void) | null>(null);
  const [dividendTrackerDashboardPageSize, setDividendTrackerDashboardPageSize] = useState(() =>
    readDividendTrackerPageSize()
  );
  const [dividendTrackerView, setDividendTrackerView] = useState<DividendDashboardView>(() =>
    readDividendDashboardView()
  );
  const registerDividendTrackerRefresh = useCallback((fn: () => void) => {
    dividendTrackerDashboardRefreshRef.current = fn;
  }, []);

  useEffect(() => {
    const unsub = subscribeToDataMode(setDataMode);
    return () => unsub();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_DIVIDEND_VIEW_KEY, dividendTrackerView);
    } catch {
      /* ignore */
    }
  }, [dividendTrackerView]);

  // Fetch current prices for open position symbols (Real/Paper only)
  const fetchOpenPositionQuotes = useCallback(async (showLoading = true) => {
    if (dataMode === "sandbox" || openPositionGroups.length === 0) {
      setOpenPositionQuotes({});
      return;
    }
    const symbols = [...new Set(openPositionGroups.map((g) => g.entry_trade.symbol))];
    if (showLoading) setIsRefreshingQuotes(true);
    const next: Record<string, number | null> = {};
    for (const symbol of symbols) {
      try {
        const quote = await invoke<{ current_price: number | null }>("fetch_stock_quote", { symbol });
        next[symbol] = quote.current_price;
      } catch {
        next[symbol] = null;
      }
    }
    setOpenPositionQuotes((prev) => ({ ...prev, ...next }));
    setLastQuoteRefresh(new Date());
    if (showLoading) setIsRefreshingQuotes(false);
  }, [dataMode, openPositionGroups]);

  // Initial fetch and when positions change
  useEffect(() => {
    if (dataMode === "sandbox" || openPositionGroups.length === 0) {
      setOpenPositionQuotes({});
      return;
    }
    void fetchOpenPositionQuotes(true);
  }, [dataMode, openPositionGroups, fetchOpenPositionQuotes]);

  const [strategyFilterForMetrics, setStrategyFilterForMetrics] = useState<Record<string, number | null>>(() => {
    const saved = localStorage.getItem("tradebutler_strategy_filter_for_metrics");
    return saved ? JSON.parse(saved) : {};
  });
  
  // Metric instances system - track multiple instances of the same metric type
  const [metricInstances, setMetricInstances] = useState<MetricInstance[]>(() => {
    const saved = localStorage.getItem(METRIC_INSTANCES_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Safety check: limit instances per metric to prevent performance issues
        const MAX_INSTANCES_PER_METRIC = 10;
        const instanceCounts: Record<string, number> = {};
        const cleaned: MetricInstance[] = [];
        
        for (const inst of parsed) {
          if (!inst || !inst.baseMetricId || !inst.instanceId) continue; // Skip invalid entries
          const count = (instanceCounts[inst.baseMetricId] || 0) + 1;
          if (count <= MAX_INSTANCES_PER_METRIC) {
            instanceCounts[inst.baseMetricId] = count;
            cleaned.push(inst);
          }
        }
        
        // If we had to clean up, save the cleaned version
        if (cleaned.length !== parsed.length) {
          console.warn(`Cleaned up metric instances: ${parsed.length} -> ${cleaned.length}`);
          localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(cleaned));
        }
        
        return cleaned;
      } catch {
        // If corrupted, clear it
        localStorage.removeItem(METRIC_INSTANCES_KEY);
        return [];
      }
    }
    // Initialize: create one instance for each enabled metric
    const enabled = metricsConfigHook.getEnabledMetrics();
    return enabled.map(m => ({
      instanceId: m.id,
      baseMetricId: m.id,
      strategyFilterId: null,
    }));
  });
  
  // Helper to get next instance ID for a base metric
  const getNextInstanceId = (baseMetricId: string): string => {
    const existingInstances = metricInstances.filter(m => m.baseMetricId === baseMetricId);
    if (existingInstances.length === 0) {
      return baseMetricId; // First instance uses base ID
    }
    // Find the highest number suffix
    let maxNum = 0;
    existingInstances.forEach(inst => {
      if (inst.instanceId === baseMetricId) {
        maxNum = Math.max(maxNum, 1);
      } else {
        const match = inst.instanceId.match(new RegExp(`^${baseMetricId}_(\\d+)$`));
        if (match) {
          maxNum = Math.max(maxNum, parseInt(match[1], 10));
        }
      }
    });
    return `${baseMetricId}_${maxNum + 1}`;
  };
  
  // Helper to duplicate a metric instance
  const duplicateMetricInstance = (instanceId: string) => {
    const instance = metricInstances.find(m => m.instanceId === instanceId);
    if (!instance) return;
    
    // Limit instances per metric to prevent performance issues
    const MAX_INSTANCES_PER_METRIC = 10;
    const instancesOfBase = metricInstances.filter(m => m.baseMetricId === instance.baseMetricId);
    if (instancesOfBase.length >= MAX_INSTANCES_PER_METRIC) {
      alert(`Maximum of ${MAX_INSTANCES_PER_METRIC} instances per metric allowed. Please remove some instances first.`);
      return;
    }
    
    const newInstanceId = getNextInstanceId(instance.baseMetricId);
    const newInstance: MetricInstance = {
      instanceId: newInstanceId,
      baseMetricId: instance.baseMetricId,
      strategyFilterId: instance.strategyFilterId,
      ...(instance.baseMetricId === "position_size_chart" ? { positionEntryId: (instance as MetricInstance).positionEntryId ?? null } : {}),
      ...(instance.baseMetricId === "current_price"
        ? {
            quoteSymbol: instance.quoteSymbol,
            quoteRefreshSeconds: instance.quoteRefreshSeconds,
            cardColumnSpan: (instance as MetricInstance).cardColumnSpan ?? 1,
            cardRowSpan: (instance as MetricInstance).cardRowSpan ?? 1,
          }
        : {}),
    };
    
    const updatedInstances = [...metricInstances, newInstance];
    setMetricInstances(updatedInstances);
    localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updatedInstances));
    
    // Add to metric card order
    setMetricCardOrder(prev => {
      const newOrder = [...prev, newInstanceId];
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
      return newOrder;
    });
    
    // Copy strategy filter if exists
    if (instance.strategyFilterId !== null) {
      setStrategyFilterForMetrics(prev => {
        const updated = { ...prev, [newInstanceId]: instance.strategyFilterId };
        localStorage.setItem("tradebutler_strategy_filter_for_metrics", JSON.stringify(updated));
        return updated;
      });
    }
    
    setConfigKey(prev => prev + 1);
  };
  
  // Helper to remove a metric instance
  const removeMetricInstance = (instanceId: string) => {
    const instance = metricInstances.find(m => m.instanceId === instanceId);
    if (!instance) return;
    
    // Don't allow removing the last instance of a base metric
    const instancesOfBase = metricInstances.filter(m => m.baseMetricId === instance.baseMetricId);
    if (instancesOfBase.length <= 1) {
      // If it's the last instance, disable the base metric instead
      metricsConfigHook.toggleMetric(instance.baseMetricId);
      setConfigKey(prev => prev + 1);
      return;
    }
    
    const updatedInstances = metricInstances.filter(m => m.instanceId !== instanceId);
    setMetricInstances(updatedInstances);
    localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updatedInstances));
    
    // Remove from metric card order
    setMetricCardOrder(prev => {
      const newOrder = prev.filter(id => id !== instanceId);
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
      return newOrder;
    });
    
    // Remove strategy filter if exists
    setStrategyFilterForMetrics(prev => {
      const updated = { ...prev };
      delete updated[instanceId];
      localStorage.setItem("tradebutler_strategy_filter_for_metrics", JSON.stringify(updated));
      return updated;
    });
    
    setConfigKey(prev => prev + 1);
  };
  
  // Helper to add a new instance of a base metric
  const addMetricInstance = (baseMetricId: string) => {
    // Ensure base metric is enabled first
    const allMetrics = metricsConfigHook.metrics;
    const baseMetric = allMetrics.find(m => m.id === baseMetricId);
    if (!baseMetric) return;
    
    // Limit instances per metric to prevent performance issues
    const MAX_INSTANCES_PER_METRIC = 10;
    const instancesOfBase = metricInstances.filter(m => m.baseMetricId === baseMetricId);
    if (instancesOfBase.length >= MAX_INSTANCES_PER_METRIC) {
      alert(`Maximum of ${MAX_INSTANCES_PER_METRIC} instances per metric allowed. Please remove some instances first.`);
      return;
    }
    
    if (!baseMetric.enabled) {
      metricsConfigHook.toggleMetric(baseMetricId);
    }
    
    const newInstanceId = getNextInstanceId(baseMetricId);
    const newInstance: MetricInstance = {
      instanceId: newInstanceId,
      baseMetricId: baseMetricId,
      strategyFilterId: null,
      ...(baseMetricId === "position_size_chart" ? { positionEntryId: null } : {}),
      ...(baseMetricId === "current_price"
        ? { quoteSymbol: "SPY", quoteRefreshSeconds: 30, cardColumnSpan: 1, cardRowSpan: 1 }
        : {}),
    };
    
    const updatedInstances = [...metricInstances, newInstance];
    setMetricInstances(updatedInstances);
    localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updatedInstances));
    
    // Add to metric card order
    setMetricCardOrder(prev => {
      const newOrder = [...prev, newInstanceId];
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
      return newOrder;
    });
    
    setConfigKey(prev => prev + 1);
  };
  
  // Helper to remove all instances of a metric type
  const removeAllInstancesOfMetric = (baseMetricId: string) => {
    const instancesToRemove = metricInstances.filter(m => m.baseMetricId === baseMetricId);
    if (instancesToRemove.length === 0) return;
    
    const instanceIdsToRemove = instancesToRemove.map(m => m.instanceId);
    
    // Remove from instances
    const updatedInstances = metricInstances.filter(m => m.baseMetricId !== baseMetricId);
    setMetricInstances(updatedInstances);
    localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(updatedInstances));
    
    // Remove from card order
    setMetricCardOrder(prev => {
      const newOrder = prev.filter(id => !instanceIdsToRemove.includes(id));
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(newOrder));
      return newOrder;
    });
    
    // Disable the base metric
    if (metricsConfigHook.metrics.find(m => m.id === baseMetricId)?.enabled) {
      metricsConfigHook.toggleMetric(baseMetricId);
    }
    
    setConfigKey(prev => prev + 1);
  };
  
  // Helper to get instance count for a metric
  const getMetricInstanceCount = (baseMetricId: string): number => {
    return metricInstances.filter(m => m.baseMetricId === baseMetricId).length;
  };
  
  const [expandedTrades, setExpandedTrades] = useState<Set<number>>(new Set());
  const [tradesPerPage, setTradesPerPage] = useState<number>(() => {
    const saved = localStorage.getItem("tradebutler_trades_per_page");
    return saved ? parseInt(saved, 10) : 20;
  });
  const [currentTradesPage, setCurrentTradesPage] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [showMetricsConfig, setShowMetricsConfig] = useState(false);
  const [configKey, setConfigKey] = useState(0); // Force re-render when config changes
  const [dashboardProfiles, setDashboardProfiles] = useState<DashboardProfileInfo[]>(() => {
    if (typeof window === "undefined") return [{ id: "default", name: "Main" }];
    return readDashboardProfilesMeta()?.profiles ?? [{ id: "default", name: "Main" }];
  });
  const [activeDashboardProfileId, setActiveDashboardProfileId] = useState(() => {
    if (typeof window === "undefined") return "default";
    return readDashboardProfilesMeta()?.activeProfileId ?? "default";
  });
  const [currentPriceSync, setCurrentPriceSync] = useState(readDashboardCurrentPriceSync);
  const [currentPriceSyncTick, setCurrentPriceSyncTick] = useState(0);
  const layoutLocked = true;
  const [expandedRecentTrades, setExpandedRecentTrades] = useState<Set<number>>(new Set());
  const [expandedStrategies, setExpandedStrategies] = useState<Set<number | string>>(new Set());
  const [strategyPairs, setStrategyPairs] = useState<Map<number | string, PairedTrade[]>>(new Map());
  const [loadingStrategyPairs, setLoadingStrategyPairs] = useState<Set<number | string>>(new Set());
  const [strategyPairsPerPage, setStrategyPairsPerPage] = useState<number>(() => {
    const saved = localStorage.getItem("tradebutler_strategy_pairs_per_page");
    return saved ? parseInt(saved, 10) : 20;
  });
  const [strategyCurrentPages, setStrategyCurrentPages] = useState<Map<number | string, number>>(new Map());
  const [dashboardSections, setDashboardSections] = useState<DashboardSections>(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_KEY);
    if (saved) {
      try {
        return { ...defaultDashboardSections, ...JSON.parse(saved) };
      } catch {
        return defaultDashboardSections;
      }
    }
    return defaultDashboardSections;
  });
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTION_ORDER_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Validate that all sections are present - include all possible sections
        const allSections: SectionId[] = [
          "topSymbols",
          "strategyPerformance",
          "recentTrades",
          "trades",
          "openPositions",
          "news",
          "dividendTracker",
        ];
        const validOrder = allSections.filter(id => parsed.includes(id));
        const missing = allSections.filter(id => !parsed.includes(id));
        return [...validOrder, ...missing];
      } catch {
        return defaultSectionOrder;
      }
    }
    return defaultSectionOrder;
  });
  const [sectionSizes, setSectionSizes] = useState<SectionSizes>(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTION_SIZES_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as SectionSizes;
        const allIds: SectionId[] = [
          "topSymbols",
          "strategyPerformance",
          "recentTrades",
          "trades",
          "openPositions",
          "news",
          "dividendTracker",
        ];
        const out: SectionSizes = {} as SectionSizes;
        allIds.forEach((id) => {
          const s = parsed[id];
          if (s && typeof s === "object") {
            const col = s.columnSpan != null ? Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, s.columnSpan)) : undefined;
            const h = s.height != null ? Math.min(800, Math.max(200, s.height)) : undefined;
            const rs = s.rowSpan != null ? Math.min(MAX_ROW_SPAN, Math.max(1, s.rowSpan)) : undefined;
            out[id] = { columnSpan: col, height: h, rowSpan: rs };
          }
        });
        return out;
      } catch {
        return {} as SectionSizes;
      }
    }
    return {} as SectionSizes;
  });
  const [openPositionsDisplayMode, setOpenPositionsDisplayMode] = useState<"card" | "compact">(() => {
    const saved = localStorage.getItem(OPEN_POSITIONS_DISPLAY_MODE_KEY);
    if (saved === "compact" || saved === "card") return saved;
    return "card";
  });
  const [openPositionsRefreshInterval, setOpenPositionsRefreshInterval] = useState<number>(() => {
    const saved = localStorage.getItem(OPEN_POSITIONS_REFRESH_INTERVAL_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && [0, 1, 2, 3, 5, 10, 15, 30, 60].includes(parsed)) return parsed;
    }
    return 0; // 0 = manual
  });
  const [isRefreshingQuotes, setIsRefreshingQuotes] = useState(false);
  const [lastQuoteRefresh, setLastQuoteRefresh] = useState<Date | null>(null);

  // Auto-refresh interval for open position quotes (minutes; skipped when dashboard quote sync is on)
  useEffect(() => {
    if (dataMode === "sandbox" || openPositionGroups.length === 0 || openPositionsRefreshInterval === 0) {
      return;
    }
    if (currentPriceSync.enabled) {
      return;
    }
    const intervalMs = openPositionsRefreshInterval * 60 * 1000;
    const intervalId = setInterval(() => {
      void fetchOpenPositionQuotes(false);
    }, intervalMs);
    return () => clearInterval(intervalId);
  }, [dataMode, openPositionGroups, openPositionsRefreshInterval, currentPriceSync.enabled, fetchOpenPositionQuotes]);

  // Open Positions: same tick as Current Price sync (shared seconds interval)
  useEffect(() => {
    if (!currentPriceSync.enabled) return;
    if (dataMode === "sandbox" || openPositionGroups.length === 0) return;
    if (currentPriceSyncTick === 0) return;
    void fetchOpenPositionQuotes(false);
  }, [
    currentPriceSync.enabled,
    currentPriceSyncTick,
    dataMode,
    openPositionGroups.length,
    fetchOpenPositionQuotes,
  ]);

  const [metricCardOrder, setMetricCardOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(METRIC_CARDS_ORDER_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });
  // Merged order of metric + section ids so users can mix them (e.g. Open Positions among metrics). Null = use default metrics then sections.
  const [mergedDisplayOrder, setMergedDisplayOrder] = useState<string[] | null>(() => {
    const saved = localStorage.getItem(DASHBOARD_DISPLAY_ORDER_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  });
  const [layoutPresets, setLayoutPresets] = useState<DashboardLayoutPreset[]>(() => {
    const saved = localStorage.getItem(DASHBOARD_LAYOUT_PRESETS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const [layoutsMenuOpen, setLayoutsMenuOpen] = useState(false);
  const [layoutsMenuAnchor, setLayoutsMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [organizeMenuOpen, setOrganizeMenuOpen] = useState(false);
  const [organizeMenuAnchor, setOrganizeMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [lockedGridColumns, setLockedGridColumns] = useState(() =>
    Math.max(2, Math.min(10, parseInt(localStorage.getItem(DASHBOARD_MAX_COLUMNS_KEY) || String(DEFAULT_LAYOUT.maxColumns), 10)))
  );
  const [lockedColumnWidths, setLockedColumnWidths] = useState<number[]>(() => {
    const saved = localStorage.getItem(DASHBOARD_LOCKED_COLUMN_WIDTHS_KEY);
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.every((n) => typeof n === "number" && n >= MIN_COLUMN_FR)) return arr;
      } catch {}
    }
    return [];
  });
  const [lockedRowHeight, setLockedRowHeight] = useState(() => {
    const n = parseInt(localStorage.getItem(DASHBOARD_LOCKED_ROW_HEIGHT_KEY) || "100", 10);
    return Math.min(MAX_ROW_HEIGHT_PX, Math.max(MIN_ROW_HEIGHT_PX, Number.isNaN(n) ? 100 : n));
  });
  useEffect(() => {
    if (!layoutLocked) return;
    const n = parseInt(localStorage.getItem(DASHBOARD_MAX_COLUMNS_KEY) || String(DEFAULT_LAYOUT.maxColumns), 10);
    setLockedGridColumns((prev) => (n >= 2 && n <= 10 ? n : prev));
  }, [layoutLocked]);
  const lockedGridRef = useRef<HTMLDivElement | null>(null);
  const moveInLockedGridRef = useRef<((id: string, dir: MoveInLockedGridDir) => void) | null>(null);

  /** When layout is locked, slot assignments preserve gaps (empty slots). Null = use dense order. */
  const [lockedSlotAssignments, setLockedSlotAssignments] = useState<(string | null)[] | null>(() => {
    const saved = localStorage.getItem(DASHBOARD_LOCKED_SLOT_ASSIGNMENTS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  });

  /** When layout is locked, fixed (row,col) per slot so shrinking a card leaves gap instead of repacking. */
  const [lockedPlacements, setLockedPlacements] = useState<{ row: number; col: number }[] | null>(() => {
    const saved = localStorage.getItem(DASHBOARD_LOCKED_PLACEMENTS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  });

  const needSavePlacementsRef = useRef<{ row: number; col: number }[] | null>(null);
  /** Previous slot spans to detect expand (repack) vs shrink (leave gap). */
  const previousSlotSpansRef = useRef<{ colSpan: number; rowSpan: number }[] | null>(null);

  useEffect(() => {
    if (!layoutLocked) return;
    setLockedColumnWidths((prev) => {
      if (prev.length === lockedGridColumns) return prev;
      if (prev.length < lockedGridColumns) {
        const next = [...prev];
        while (next.length < lockedGridColumns) next.push(1);
        return next;
      }
      return prev.slice(0, lockedGridColumns);
    });
  }, [layoutLocked, lockedGridColumns]);

  useEffect(() => {
    if (lockedColumnWidths.length > 0) {
      localStorage.setItem(DASHBOARD_LOCKED_COLUMN_WIDTHS_KEY, JSON.stringify(lockedColumnWidths));
    }
  }, [lockedColumnWidths]);

  useEffect(() => {
    if (layoutLocked && lockedSlotAssignments != null && lockedSlotAssignments.length > 0) {
      localStorage.setItem(DASHBOARD_LOCKED_SLOT_ASSIGNMENTS_KEY, JSON.stringify(lockedSlotAssignments));
    }
  }, [layoutLocked, lockedSlotAssignments]);

  useLayoutEffect(() => {
    if (needSavePlacementsRef.current) {
      const placements = needSavePlacementsRef.current;
      needSavePlacementsRef.current = null;
      setLockedPlacements(placements);
    }
  });

  useEffect(() => {
    if (layoutLocked && lockedPlacements != null && lockedPlacements.length > 0) {
      localStorage.setItem(DASHBOARD_LOCKED_PLACEMENTS_KEY, JSON.stringify(lockedPlacements));
    }
  }, [layoutLocked, lockedPlacements]);

  useEffect(() => {
    localStorage.setItem(DASHBOARD_LOCKED_ROW_HEIGHT_KEY, String(lockedRowHeight));
  }, [lockedRowHeight]);

  // @dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  /** Remount DnD trees after tab restore so @dnd-kit cannot keep stale transforms (metrics overlapping sections). */
  const [dndResetKey, setDndResetKey] = useState(0);
  useEffect(() => {
    let raf = 0;
    const bumpOnce = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        setDndResetKey((k) => k + 1);
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") bumpOnce();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) bumpOnce();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow as EventListener);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow as EventListener);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  
  // When layout is locked, ensure every instance has a slotIndex (init from current order)
  useEffect(() => {
    if (!layoutLocked) return;
    setMetricInstances((prev) => {
      const order = metricCardOrder.filter(id => prev.some(inst => inst.instanceId === id));
      const needsInit = prev.some(inst => inst.slotIndex === undefined);
      if (!needsInit) return prev;
      const maxSlot = Math.max(-1, ...prev.map((i, idx) => i.slotIndex ?? idx));
      const next = prev.map((inst) => {
        if (inst.slotIndex !== undefined) return inst;
        const idx = order.indexOf(inst.instanceId);
        return { ...inst, slotIndex: idx >= 0 ? idx : maxSlot + 1 };
      });
      localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(next));
      return next;
    });
  }, [layoutLocked, metricCardOrder]);

  // Handle drag end for metrics
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (layoutLocked && over && typeof over.id === "string") {
      const overId = String(over.id);
      let targetSlot: number | null = null;
      let gapDrop: { row: number; col: number } | null = null;
      if (overId.startsWith("metric-slot-gap-")) {
        const match = overId.match(/^metric-slot-gap-(\d+)-(\d+)$/);
        if (match) {
          const r = parseInt(match[1], 10);
          const c = parseInt(match[2], 10);
          if (!Number.isNaN(r) && !Number.isNaN(c) && r >= 0 && c >= 0) gapDrop = { row: r, col: c };
        }
      } else if (overId.startsWith("metric-slot-")) {
        const parsed = parseInt(overId.replace("metric-slot-", ""), 10);
        if (!Number.isNaN(parsed) && parsed >= 0) targetSlot = parsed;
      } else {
        const idx = displayOrder.indexOf(overId);
        if (idx >= 0) targetSlot = idx;
      }
      const draggedId = active.id as string;
      const numEmptySlots = Math.max(4, 3 * lockedGridColumns);
      const minTotalSlots = displayOrder.length + numEmptySlots;
      const effectiveSlots = lockedSlotAssignments && lockedSlotAssignments.length >= minTotalSlots
        ? lockedSlotAssignments
        : [...displayOrder, ...Array(numEmptySlots).fill(null)];
      const totalSlots = effectiveSlots.length;
      const oldSlot = effectiveSlots.indexOf(draggedId);

      if (gapDrop !== null && oldSlot !== -1) {
        const nullSlot = effectiveSlots.findIndex((id) => id == null);
        if (nullSlot === -1) return;
        const newSlots = [...effectiveSlots];
        newSlots[oldSlot] = null;
        newSlots[nullSlot] = draggedId;
        const maxFilledIndex = newSlots.reduce((max, id, i) => (id != null ? i : max), -1);
        const paddedMinSlots = maxFilledIndex + 1 + 3 * lockedGridColumns;
        const finalSlots = newSlots.length < paddedMinSlots
          ? [...newSlots, ...Array(paddedMinSlots - newSlots.length).fill(null)]
          : newSlots;
        setLockedSlotAssignments(finalSlots);
        setLockedPlacements((prev) => {
          const next = prev && prev.length >= totalSlots ? [...prev] : [];
          while (next.length < totalSlots) next.push({ row: 0, col: 0 });
          next[nullSlot] = { row: gapDrop!.row, col: gapDrop!.col };
          return next;
        });
        const newOrder = finalSlots.filter((id): id is string => id != null);
        setMergedDisplayOrder(newOrder);
        localStorage.setItem(DASHBOARD_DISPLAY_ORDER_KEY, JSON.stringify(newOrder));
        setMetricCardOrder((prev) => {
          const metricIds = newOrder.filter((id) => !isSectionId(id));
          const kept = prev.filter((id) => !newOrder.includes(id) && !isSectionId(id));
          const finalOrder = [...metricIds, ...kept];
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        });
        setSectionOrder((prev) => {
          const sectionIds = newOrder.filter((id) => isSectionId(id));
          const kept = prev.filter((id) => !newOrder.includes(id));
          const finalOrder = [...sectionIds, ...kept];
          localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        });
        setMetricInstances((prev) =>
          prev.map((inst) => ({
            ...inst,
            slotIndex: finalSlots.indexOf(inst.instanceId) >= 0 ? finalSlots.indexOf(inst.instanceId) : inst.slotIndex,
          }))
        );
        return;
      }

      if (targetSlot !== null && oldSlot !== -1) {
        const clampedTarget = Math.min(targetSlot, totalSlots - 1);
        const newSlots = [...effectiveSlots];
        newSlots[oldSlot] = null;
        newSlots[clampedTarget] = draggedId;
        const maxFilledIndex = newSlots.reduce((max, id, i) => (id != null ? i : max), -1);
        const paddedMinSlots = maxFilledIndex + 1 + 3 * lockedGridColumns;
        const finalSlots = newSlots.length < paddedMinSlots
          ? [...newSlots, ...Array(paddedMinSlots - newSlots.length).fill(null)]
          : newSlots;
        setLockedSlotAssignments(finalSlots);
        const newOrder = finalSlots.filter((id): id is string => id != null);
        setMergedDisplayOrder(newOrder);
        localStorage.setItem(DASHBOARD_DISPLAY_ORDER_KEY, JSON.stringify(newOrder));
        setMetricCardOrder((prev) => {
          const metricIds = newOrder.filter((id) => !isSectionId(id));
          const kept = prev.filter((id) => !newOrder.includes(id) && !isSectionId(id));
          const finalOrder = [...metricIds, ...kept];
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        });
        setSectionOrder((prev) => {
          const sectionIds = newOrder.filter((id) => isSectionId(id));
          const kept = prev.filter((id) => !newOrder.includes(id));
          const finalOrder = [...sectionIds, ...kept];
          localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        });
        setMetricInstances((prev) =>
          prev.map((inst) => ({
            ...inst,
            slotIndex: finalSlots.indexOf(inst.instanceId) >= 0 ? finalSlots.indexOf(inst.instanceId) : inst.slotIndex,
          }))
        );
        return;
      }
    }

    if (!layoutLocked && over && active.id !== over.id) {
      const activeId = active.id as string;
      const overId = over.id as string;
      const oldIndex = displayOrder.indexOf(activeId);
      const newIndex = displayOrder.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove([...displayOrder], oldIndex, newIndex);
        setMergedDisplayOrder(newOrder);
        localStorage.setItem(DASHBOARD_DISPLAY_ORDER_KEY, JSON.stringify(newOrder));
        const metricIdsInOrder = newOrder.filter((id) => !isSectionId(id));
        const sectionIdsInOrder = newOrder.filter((id) => isSectionId(id));
        setMetricCardOrder((prev) => {
          const kept = prev.filter((id) => !newOrder.includes(id) && !isSectionId(id));
          const finalOrder = [...metricIdsInOrder, ...kept];
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        });
        setSectionOrder((prev) => {
          const kept = prev.filter((id) => !newOrder.includes(id));
          const finalOrder = [...sectionIdsInOrder, ...kept];
          localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        });
        return;
      }
      setMetricCardOrder((items) => {
        const currentInstanceIds = metricInstances.map(inst => inst.instanceId);
        let newOrder = [...items];
        currentInstanceIds.forEach(id => {
          if (!newOrder.includes(id)) newOrder.push(id);
        });
        newOrder = newOrder.filter(id => currentInstanceIds.includes(id));
        const oi = newOrder.indexOf(activeId);
        const ni = newOrder.indexOf(overId);
        if (oi !== -1 && ni !== -1) {
          const finalOrder = arrayMove(newOrder, oi, ni);
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        }
        return newOrder;
      });
    }
  };

  /** When split grid is on, metrics grid only: update metric order and slot indices, never section/merged order. */
  const handleDragEndMetricsOnly = (event: DragEndEvent, order: string[]) => {
    const { active, over } = event;
    if (layoutLocked && over && typeof over.id === "string") {
      const overId = String(over.id);
      let targetSlot: number | null = null;
      if (overId.startsWith("metric-slot-")) {
        const parsed = parseInt(overId.replace("metric-slot-", ""), 10);
        if (!Number.isNaN(parsed) && parsed >= 0) targetSlot = parsed;
      } else if (order.includes(overId)) {
        targetSlot = order.indexOf(overId);
      }
      if (targetSlot !== null) {
        const draggedId = active.id as string;
        const numEmptySlots = Math.max(4, 3 * lockedGridColumns);
        const minTotalSlots = order.length + numEmptySlots;
        const effectiveSlots = lockedSlotAssignments && lockedSlotAssignments.length >= minTotalSlots
          ? lockedSlotAssignments
          : [...order, ...Array(numEmptySlots).fill(null)];
        const totalSlots = effectiveSlots.length;
        const clampedTarget = Math.min(targetSlot, totalSlots - 1);
        const oldSlot = effectiveSlots.indexOf(draggedId);
        if (oldSlot === -1) return;
        const newSlots = [...effectiveSlots];
        newSlots[oldSlot] = null;
        newSlots[clampedTarget] = draggedId;
        const maxFilledIndex = newSlots.reduce((max, id, i) => (id != null ? i : max), -1);
        const paddedMinSlots = maxFilledIndex + 1 + 3 * lockedGridColumns;
        const finalSlots = newSlots.length < paddedMinSlots
          ? [...newSlots, ...Array(paddedMinSlots - newSlots.length).fill(null)]
          : newSlots;
        setLockedSlotAssignments(finalSlots);
        const newOrder = finalSlots.filter((id): id is string => id != null);
        setMetricCardOrder((prev) => {
          const kept = prev.filter((id) => !newOrder.includes(id) && !isSectionId(id));
          const finalOrder = [...newOrder, ...kept];
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        });
        setMetricInstances((prev) =>
          prev.map((inst) => ({
            ...inst,
            slotIndex: finalSlots.indexOf(inst.instanceId) >= 0 ? finalSlots.indexOf(inst.instanceId) : inst.slotIndex,
          }))
        );
        return;
      }
    }
    if (!layoutLocked && over && active.id !== over.id) {
      const activeId = active.id as string;
      const overId = over.id as string;
      const oldIndex = order.indexOf(activeId);
      const newIndex = order.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove([...order], oldIndex, newIndex);
        setMetricCardOrder((prev) => {
          const kept = prev.filter((id) => !newOrder.includes(id) && !isSectionId(id));
          const finalOrder = [...newOrder, ...kept];
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(finalOrder));
          return finalOrder;
        });
      }
    }
  };

  // Handle drag end for sections
  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setSectionOrder((items) => {
        const oldIndex = items.indexOf(active.id as SectionId);
        const newIndex = items.indexOf(over.id as SectionId);
        
        if (oldIndex !== -1 && newIndex !== -1) {
          const finalOrder = arrayMove(items, oldIndex, newIndex);
          localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(finalOrder));
          setMergedDisplayOrder((prev) => {
            if (!prev) return null;
            return prev.map((id) =>
              isSectionId(id) ? finalOrder[items.indexOf(id)] : id
            );
          });
          return finalOrder;
        }
        
        return items;
      });
    }
  };
  const [openMetricSettings, setOpenMetricSettings] = useState<string | null>(null);
  const [openSectionSettings, setOpenSectionSettings] = useState<SectionId | null>(null);
  const [metricMenuPosition, setMetricMenuPosition] = useState({ top: 0, right: 0 });
  const [sectionMenuPosition, setSectionMenuPosition] = useState<Record<SectionId, { top: number; right: number }>>({
    topSymbols: { top: 0, right: 0 },
    strategyPerformance: { top: 0, right: 0 },
    recentTrades: { top: 0, right: 0 },
    trades: { top: 0, right: 0 },
    openPositions: { top: 0, right: 0 },
    news: { top: 0, right: 0 },
    dividendTracker: { top: 0, right: 0 },
  });

  // News widget settings (controlled from dashboard settings menu)
  const NEWS_INCLUDE_POSITIONS_KEY = "tradebutler_news_include_positions";
  const NEWS_SHOW_SENTIMENT_KEY = "tradebutler_news_show_sentiment";
  const [newsSearchQuery, setNewsSearchQuery] = useState("");
  const [newsIncludePositions, setNewsIncludePositions] = useState(() => {
    const saved = localStorage.getItem(NEWS_INCLUDE_POSITIONS_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const [newsShowSentiment, setNewsShowSentiment] = useState(() => {
    const saved = localStorage.getItem(NEWS_SHOW_SENTIMENT_KEY);
    return saved ? JSON.parse(saved) : true;
  });

  // Save news settings to localStorage
  useEffect(() => {
    localStorage.setItem(NEWS_INCLUDE_POSITIONS_KEY, JSON.stringify(newsIncludePositions));
  }, [newsIncludePositions]);

  useEffect(() => {
    localStorage.setItem(NEWS_SHOW_SENTIMENT_KEY, JSON.stringify(newsShowSentiment));
  }, [newsShowSentiment]);

  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const saved = localStorage.getItem("tradebutler_dashboard_timeframe");
    return (saved as Timeframe) || "all";
  });
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_dashboard_custom_start") || "";
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_dashboard_custom_end") || "";
  });
  const [dashboardStrategyId, setDashboardStrategyId] = useState<number | null>(() => {
    const raw = localStorage.getItem(DASHBOARD_STRATEGY_ID_KEY);
    if (raw == null || raw === "") return null;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
  });
  const [showPositionGroupModal, setShowPositionGroupModal] = useState(false);
  const [_selectedPositionGroupId, setSelectedPositionGroupId] = useState<number | null>(null);
  const [selectedPositionGroup, setSelectedPositionGroup] = useState<any>(null);

  const hydrateDashboardUiFromLocalStorage = useCallback(() => {
    try {
      const disp = localStorage.getItem(DASHBOARD_DISPLAY_ORDER_KEY);
      if (disp) {
        try {
          const parsed = JSON.parse(disp);
          setMergedDisplayOrder(Array.isArray(parsed) ? parsed : null);
        } catch {
          setMergedDisplayOrder(null);
        }
      } else setMergedDisplayOrder(null);

      const presets = localStorage.getItem(DASHBOARD_LAYOUT_PRESETS_KEY);
      if (presets) {
        try {
          const parsed = JSON.parse(presets);
          setLayoutPresets(Array.isArray(parsed) ? parsed : []);
        } catch {
          setLayoutPresets([]);
        }
      } else setLayoutPresets([]);

      setLockedGridColumns(
        Math.max(2, Math.min(10, parseInt(localStorage.getItem(DASHBOARD_MAX_COLUMNS_KEY) || String(DEFAULT_LAYOUT.maxColumns), 10)))
      );

      const cw = localStorage.getItem(DASHBOARD_LOCKED_COLUMN_WIDTHS_KEY);
      if (cw) {
        try {
          const arr = JSON.parse(cw);
          if (Array.isArray(arr) && arr.every((n: unknown) => typeof n === "number" && n >= MIN_COLUMN_FR)) {
            setLockedColumnWidths(arr);
          } else setLockedColumnWidths([]);
        } catch {
          setLockedColumnWidths([]);
        }
      } else setLockedColumnWidths([]);

      const slots = localStorage.getItem(DASHBOARD_LOCKED_SLOT_ASSIGNMENTS_KEY);
      if (slots) {
        try {
          const parsed = JSON.parse(slots);
          setLockedSlotAssignments(Array.isArray(parsed) ? parsed : null);
        } catch {
          setLockedSlotAssignments(null);
        }
      } else setLockedSlotAssignments(null);

      const plc = localStorage.getItem(DASHBOARD_LOCKED_PLACEMENTS_KEY);
      if (plc) {
        try {
          const parsed = JSON.parse(plc);
          setLockedPlacements(Array.isArray(parsed) ? parsed : null);
        } catch {
          setLockedPlacements(null);
        }
      } else setLockedPlacements(null);

      const sizes = localStorage.getItem(DASHBOARD_SECTION_SIZES_KEY);
      if (sizes) {
        try {
          const parsed = JSON.parse(sizes) as SectionSizes;
          const allIds: SectionId[] = [
            "topSymbols",
            "strategyPerformance",
            "recentTrades",
            "trades",
            "openPositions",
            "news",
            "dividendTracker",
          ];
          const out: SectionSizes = {} as SectionSizes;
          allIds.forEach((id) => {
            const s = parsed[id];
            if (s && typeof s === "object") {
              const col = s.columnSpan != null ? Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, s.columnSpan)) : undefined;
              const h = s.height != null ? Math.min(800, Math.max(200, s.height)) : undefined;
              const rs = s.rowSpan != null ? Math.min(MAX_ROW_SPAN, Math.max(1, s.rowSpan)) : undefined;
              out[id] = { columnSpan: col, height: h, rowSpan: rs };
            }
          });
          setSectionSizes(out);
        } catch {
          setSectionSizes({} as SectionSizes);
        }
      } else setSectionSizes({} as SectionSizes);

      const sf = localStorage.getItem("tradebutler_strategy_filter_for_metrics");
      if (sf) {
        try {
          setStrategyFilterForMetrics(JSON.parse(sf));
        } catch {
          setStrategyFilterForMetrics({});
        }
      } else setStrategyFilterForMetrics({});

      const opm = localStorage.getItem(OPEN_POSITIONS_DISPLAY_MODE_KEY);
      setOpenPositionsDisplayMode(opm === "compact" || opm === "card" ? opm : "card");

      const opri = localStorage.getItem(OPEN_POSITIONS_REFRESH_INTERVAL_KEY);
      if (opri) {
        const parsed = parseInt(opri, 10);
        setOpenPositionsRefreshInterval(
          !Number.isNaN(parsed) && [0, 1, 2, 3, 5, 10, 15, 30, 60].includes(parsed) ? parsed : 0
        );
      } else setOpenPositionsRefreshInterval(0);

      const tf = localStorage.getItem("tradebutler_dashboard_timeframe");
      setTimeframe(((tf as Timeframe) || "all") as Timeframe);
      setCustomStartDate(localStorage.getItem("tradebutler_dashboard_custom_start") || "");
      setCustomEndDate(localStorage.getItem("tradebutler_dashboard_custom_end") || "");

      const ds = localStorage.getItem(DASHBOARD_STRATEGY_ID_KEY);
      if (ds != null && ds !== "") {
        const n = parseInt(ds, 10);
        setDashboardStrategyId(Number.isNaN(n) ? null : n);
      } else setDashboardStrategyId(null);

      const nIncl = localStorage.getItem(NEWS_INCLUDE_POSITIONS_KEY);
      setNewsIncludePositions(nIncl ? JSON.parse(nIncl) : true);
      const nSent = localStorage.getItem(NEWS_SHOW_SENTIMENT_KEY);
      setNewsShowSentiment(nSent ? JSON.parse(nSent) : true);
    } catch (e) {
      console.error("hydrateDashboardUiFromLocalStorage", e);
    }
  }, []);

  const switchDashboardProfile = useCallback(
    (newId: string) => {
      if (newId === activeDashboardProfileId) return;
      saveDashboardProfileSnapshot(activeDashboardProfileId);
      const blob = loadDashboardProfileSnapshot(newId);
      if (!blob || Object.keys(blob).length === 0) return;
      applyDashboardProfileSnapshot(blob);
      const meta = readDashboardProfilesMeta();
      if (meta) {
        writeDashboardProfilesMeta({ ...meta, activeProfileId: newId });
      }
      setActiveDashboardProfileId(newId);
      hydrateDashboardUiFromLocalStorage();
      setConfigKey((k) => k + 1);
    },
    [activeDashboardProfileId, hydrateDashboardUiFromLocalStorage]
  );

  const duplicateDashboardProfile = useCallback(() => {
    saveDashboardProfileSnapshot(activeDashboardProfileId);
    const snap = collectDashboardProfileSnapshot();
    const id = `d_${Date.now().toString(36)}`;
    const name = `Dashboard ${dashboardProfiles.length + 1}`;
    localStorage.setItem(dashboardProfileSnapKey(id), JSON.stringify(snap));
    const meta = readDashboardProfilesMeta();
    if (!meta) return;
    const next: DashboardProfilesMetaV1 = {
      ...meta,
      profiles: [...meta.profiles, { id, name }],
      activeProfileId: id,
    };
    writeDashboardProfilesMeta(next);
    setDashboardProfiles(next.profiles);
    setActiveDashboardProfileId(id);
    setConfigKey((k) => k + 1);
  }, [activeDashboardProfileId, dashboardProfiles.length]);

  const renameActiveDashboardProfile = useCallback(() => {
    const cur = dashboardProfiles.find((p) => p.id === activeDashboardProfileId);
    if (!cur) return;
    const name = window.prompt("Dashboard name", cur.name);
    if (name == null || !name.trim()) return;
    const meta = readDashboardProfilesMeta();
    if (!meta) return;
    const next = {
      ...meta,
      profiles: meta.profiles.map((p) => (p.id === activeDashboardProfileId ? { ...p, name: name.trim() } : p)),
    };
    writeDashboardProfilesMeta(next);
    setDashboardProfiles(next.profiles);
  }, [activeDashboardProfileId, dashboardProfiles]);

  const deleteDashboardProfile = useCallback(() => {
    if (dashboardProfiles.length <= 1) return;
    const cur = dashboardProfiles.find((p) => p.id === activeDashboardProfileId);
    if (!cur) return;
    if (!window.confirm(`Delete dashboard "${cur.name}"? This cannot be undone.`)) return;
    localStorage.removeItem(dashboardProfileSnapKey(activeDashboardProfileId));
    const meta = readDashboardProfilesMeta();
    if (!meta) return;
    const remaining = meta.profiles.filter((p) => p.id !== activeDashboardProfileId);
    const nextActive = remaining[0].id;
    const blob = loadDashboardProfileSnapshot(nextActive);
    if (blob) applyDashboardProfileSnapshot(blob);
    writeDashboardProfilesMeta({ ...meta, profiles: remaining, activeProfileId: nextActive });
    setDashboardProfiles(remaining);
    setActiveDashboardProfileId(nextActive);
    hydrateDashboardUiFromLocalStorage();
    setConfigKey((k) => k + 1);
  }, [activeDashboardProfileId, dashboardProfiles, hydrateDashboardUiFromLocalStorage]);

  useEffect(() => {
    const sync = () => saveDashboardProfileSnapshot(activeDashboardProfileId);
    window.addEventListener("beforeunload", sync);
    const tid = window.setInterval(sync, 45000);
    const onTabHidden = () => {
      if (document.visibilityState === "hidden") sync();
    };
    document.addEventListener("visibilitychange", onTabHidden);
    return () => {
      window.removeEventListener("beforeunload", sync);
      window.clearInterval(tid);
      document.removeEventListener("visibilitychange", onTabHidden);
    };
  }, [activeDashboardProfileId]);

  // Close settings menus when clicking outside or scrolling
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking on a settings button or inside a settings menu
      if (target.closest('[data-settings-menu]') || target.closest('button[title="Settings"]')) {
        return;
      }
      if (openMetricSettings || openSectionSettings) {
        setOpenMetricSettings(null);
        setOpenSectionSettings(null);
      }
    };
    
    const handleScroll = () => {
      // Close menus when user scrolls
      if (openMetricSettings || openSectionSettings) {
        setOpenMetricSettings(null);
        setOpenSectionSettings(null);
      }
    };
    
    if (openMetricSettings || openSectionSettings) {
      // Use a small delay to allow the click event on the button to complete first
      setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);
      // Close on scroll - listen to window and any scrollable container
      window.addEventListener("scroll", handleScroll, true);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("scroll", handleScroll, true);
      };
    }
  }, [openMetricSettings, openSectionSettings]);
  
  // Re-read enabled metrics from localStorage when config changes
  const [enabledMetrics, setEnabledMetrics] = useState(() => metricsConfigHook.getEnabledMetrics());
  
  // Sync metric instances with enabled metrics
  useEffect(() => {
    const allMetrics = metricsConfigHook.metrics;
    const enabled = allMetrics.filter(m => m.enabled);
    
    setMetricInstances(prevInstances => {
      const updated: MetricInstance[] = [];
      
      // For each enabled base metric, ensure at least one instance exists
      enabled.forEach(baseMetric => {
        const instances = prevInstances.filter(m => m.baseMetricId === baseMetric.id);
        if (instances.length === 0) {
          // Create first instance
          updated.push({
            instanceId: baseMetric.id,
            baseMetricId: baseMetric.id,
            strategyFilterId: null,
          });
        } else {
          // Keep existing instances
          updated.push(...instances);
        }
      });
      
      // Remove instances for disabled base metrics
      const filtered = updated.filter(inst => 
        enabled.some(m => m.id === inst.baseMetricId)
      );
      
      if (JSON.stringify(filtered) !== JSON.stringify(prevInstances)) {
        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(filtered));
        return filtered;
      }
      
      return prevInstances;
    });
    
    setEnabledMetrics(enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]); // Only depend on configKey - metrics are read fresh from hook inside effect
  
  useEffect(() => {
    // Re-read from localStorage when configKey changes (includes color range changes)
    const saved = localStorage.getItem("tradebutler_metrics_config");
    if (saved) {
      try {
        const allMetrics = JSON.parse(saved);
        const enabled = allMetrics.filter((m: any) => m.enabled);
        setEnabledMetrics(enabled);
        
        // Sync instances
        const currentInstances = JSON.parse(localStorage.getItem(METRIC_INSTANCES_KEY) || "[]");
        const enabledIds = enabled.map((m: any) => m.id);
        
        // Ensure each enabled metric has at least one instance
        const updatedInstances: MetricInstance[] = [];
        enabled.forEach((baseMetric: any) => {
          const existing = currentInstances.filter((inst: MetricInstance) => inst.baseMetricId === baseMetric.id);
          if (existing.length > 0) {
            updatedInstances.push(...existing);
          } else {
            updatedInstances.push({
              instanceId: baseMetric.id,
              baseMetricId: baseMetric.id,
              strategyFilterId: null,
            });
          }
        });
        
        // Remove instances for disabled metrics
        const filteredInstances = updatedInstances.filter(inst => enabledIds.includes(inst.baseMetricId));
        setMetricInstances(filteredInstances);
        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(filteredInstances));
        
        // Initialize or update metric card order based on instances
        const currentOrder = localStorage.getItem(METRIC_CARDS_ORDER_KEY);
        const instanceIds = filteredInstances.map(inst => inst.instanceId);
        
        if (!currentOrder || currentOrder === "[]") {
          // Initialize with current instances
          setMetricCardOrder(instanceIds);
          localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(instanceIds));
        } else {
          // Update order to include any new instances and remove deleted ones
          const savedOrder: string[] = JSON.parse(currentOrder);
          const newOrder = [...savedOrder];
          
          // Add any missing instance IDs to the end
          instanceIds.forEach((id: string) => {
            if (!newOrder.includes(id)) {
              newOrder.push(id);
            }
          });
          
          // Remove any IDs that are no longer valid instances
          const filteredOrder = newOrder.filter((id: string) => instanceIds.includes(id));
          
          if (JSON.stringify(filteredOrder) !== JSON.stringify(metricCardOrder)) {
            setMetricCardOrder(filteredOrder);
            localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(filteredOrder));
          }
        }
      } catch {
        const enabled = metricsConfigHook.getEnabledMetrics();
        setEnabledMetrics(enabled);
        const instances = enabled.map(m => ({
          instanceId: m.id,
          baseMetricId: m.id,
          strategyFilterId: null,
        }));
        setMetricInstances(instances);
        localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(instances));
        const order = instances.map(inst => inst.instanceId);
        setMetricCardOrder(order);
        localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(order));
      }
    } else {
      const enabled = metricsConfigHook.getEnabledMetrics();
      setEnabledMetrics(enabled);
      const instances = enabled.map(m => ({
        instanceId: m.id,
        baseMetricId: m.id,
        strategyFilterId: null,
      }));
      setMetricInstances(instances);
      localStorage.setItem(METRIC_INSTANCES_KEY, JSON.stringify(instances));
      const order = instances.map(inst => inst.instanceId);
      setMetricCardOrder(order);
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(order));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]); // Only depend on configKey - metrics are read fresh from hook inside effect

  useEffect(() => {
    const n = parseInt(localStorage.getItem(DASHBOARD_LOCKED_ROW_HEIGHT_KEY) || "100", 10);
    setLockedRowHeight(Math.min(MAX_ROW_HEIGHT_PX, Math.max(MIN_ROW_HEIGHT_PX, Number.isNaN(n) ? 100 : n)));
  }, [configKey]);

  useEffect(() => {
    setCurrentPriceSync(readDashboardCurrentPriceSync());
  }, [configKey]);

  useEffect(() => {
    if (!currentPriceSync.enabled) return;
    if (currentPriceSync.seconds < 1) return;
    const id = window.setInterval(() => {
      setCurrentPriceSyncTick((t) => t + 1);
    }, currentPriceSync.seconds * 1000);
    return () => window.clearInterval(id);
  }, [currentPriceSync.enabled, currentPriceSync.seconds]);

  // Sync metric card order when instances change
  useEffect(() => {
    const instanceIds = metricInstances.map(inst => inst.instanceId);
    if (instanceIds.length === 0) return;
    
    setMetricCardOrder(prevOrder => {
      const newOrder = [...prevOrder];
      
      // Add any missing instance IDs to the end
      instanceIds.forEach(id => {
        if (!newOrder.includes(id)) {
          newOrder.push(id);
        }
      });
      
      // Remove any IDs that are no longer valid instances
      const filteredOrder = newOrder.filter(id => instanceIds.includes(id));
      
      // Only update if order actually changed
      if (JSON.stringify(filteredOrder) !== JSON.stringify(prevOrder)) {
        localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(filteredOrder));
        return filteredOrder;
      }
      return prevOrder;
    });
  }, [metricInstances]); // Only run when metricInstances changes

  // Create display metrics from instances
  const displayMetrics = useMemo(() => {
    return metricInstances
      .filter(inst => {
        // Only show instances whose base metric is enabled
        return enabledMetrics.some(m => m.id === inst.baseMetricId);
      })
      .map(inst => {
        const baseMetric = enabledMetrics.find(m => m.id === inst.baseMetricId);
        if (!baseMetric) return null;
        return {
          ...baseMetric,
          id: inst.instanceId, // Use instance ID instead of base ID
          baseMetricId: inst.baseMetricId, // Keep reference to base
          strategyFilterId: inst.strategyFilterId ?? null,
          positionEntryId: inst.positionEntryId ?? null,
          chartHeight: inst.chartHeight ?? 200,
          chartWidth: inst.chartWidth ?? undefined,
          chartColumnSpan: inst.chartColumnSpan ?? (inst.chartWidth ? 2 : undefined),
          positionChartBrushStart: inst.positionChartBrushStart ?? 0,
          positionChartBrushEnd: inst.positionChartBrushEnd ?? 0,
          slotIndex: inst.slotIndex ?? undefined,
          cardWidth: inst.cardWidth ?? undefined,
          cardHeight: inst.cardHeight ?? undefined,
          cardColumnSpan: inst.cardColumnSpan ?? undefined,
          cardRowSpan: inst.cardRowSpan ?? undefined,
          quoteSymbol: inst.quoteSymbol,
          quoteRefreshSeconds: inst.quoteRefreshSeconds,
        };
      })
      .filter((m): m is any => m !== null);
  }, [metricInstances, enabledMetrics]);

  // Sort metrics by saved order using useMemo
  const sortedMetrics = useMemo(() => {
    return [...displayMetrics].sort((a, b) => {
      const aIndex = metricCardOrder.indexOf(a.id);
      const bIndex = metricCardOrder.indexOf(b.id);
      
      // If both are in the order, sort by their position
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // If only one is in the order, prioritize it
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      // If neither is in the order, maintain original order
      return 0;
    });
  }, [displayMetrics, metricCardOrder]);

  const sectionVisible = (id: SectionId): boolean => {
    const key = SECTION_DASHBOARD_SECTION_KEY[id];
    return !!dashboardSections[key];
  };
  // Unified order: metrics + sections so users can mix them in one grid when unlocked. Use merged order if saved.
  const displayOrder = useMemo(() => {
    const metricIds = sortedMetrics.map((m) => m.id);
    const sectionIds = sectionOrder.filter((id) => sectionVisible(id));
    if (mergedDisplayOrder && mergedDisplayOrder.length > 0) {
      const validIds = new Set([...metricIds, ...sectionIds]);
      const ordered = mergedDisplayOrder.filter((id) => validIds.has(id));
      const appended = [...metricIds, ...sectionIds].filter((id) => !ordered.includes(id));
      return [...ordered, ...appended];
    }
    return [...metricIds, ...sectionIds];
  }, [sortedMetrics, sectionOrder, dashboardSections, mergedDisplayOrder]);

  useEffect(() => {
    if (mergedDisplayOrder && mergedDisplayOrder.length > 0) {
      localStorage.setItem(DASHBOARD_DISPLAY_ORDER_KEY, JSON.stringify(mergedDisplayOrder));
    }
  }, [mergedDisplayOrder]);

  useEffect(() => {
    if (!layoutLocked) {
      setLockedSlotAssignments(null);
      return;
    }
    const split = localStorage.getItem(DASHBOARD_SPLIT_GRID_KEY) === "true";
    const numEmptySlots = Math.max(4, 3 * lockedGridColumns);
    const currentOrder = split ? sortedMetrics.map((m) => m.id) : displayOrder;
    const minTotalSlots = currentOrder.length + numEmptySlots;
    setLockedSlotAssignments((prev) => {
      if (prev !== null && prev.length >= minTotalSlots) return prev;
      return [...currentOrder, ...Array(numEmptySlots).fill(null)];
    });
  }, [layoutLocked, lockedGridColumns, displayOrder, sortedMetrics]);

  useEffect(() => {
    localStorage.setItem(DASHBOARD_LAYOUT_PRESETS_KEY, JSON.stringify(layoutPresets));
  }, [layoutPresets]);

  const applyLayoutPreset = (preset: DashboardLayoutPreset) => {
    setMergedDisplayOrder(preset.displayOrder.length > 0 ? preset.displayOrder : null);
    setMetricCardOrder(preset.metricCardOrder);
    setSectionOrder(preset.sectionOrder);
    setDashboardSections(preset.dashboardSections);
    if (preset.sectionSizes && Object.keys(preset.sectionSizes).length > 0) {
      setSectionSizes((prev) => ({ ...prev, ...preset.sectionSizes }));
    }
    if (preset.lockedGridColumns != null && preset.lockedGridColumns >= 2 && preset.lockedGridColumns <= 10) {
      setLockedGridColumns(preset.lockedGridColumns);
      localStorage.setItem(DASHBOARD_MAX_COLUMNS_KEY, String(preset.lockedGridColumns));
    }
    if (preset.lockedSlotAssignments != null && preset.lockedSlotAssignments.length > 0) {
      setLockedSlotAssignments(preset.lockedSlotAssignments);
      localStorage.setItem(DASHBOARD_LOCKED_SLOT_ASSIGNMENTS_KEY, JSON.stringify(preset.lockedSlotAssignments));
    }
    if (preset.lockedColumnWidths != null && preset.lockedColumnWidths.length > 0) {
      setLockedColumnWidths(preset.lockedColumnWidths);
      localStorage.setItem(DASHBOARD_LOCKED_COLUMN_WIDTHS_KEY, JSON.stringify(preset.lockedColumnWidths));
    }
    if (preset.lockedPlacements != null && preset.lockedPlacements.length > 0) {
      setLockedPlacements(preset.lockedPlacements);
      localStorage.setItem(DASHBOARD_LOCKED_PLACEMENTS_KEY, JSON.stringify(preset.lockedPlacements));
    }
    localStorage.setItem(DASHBOARD_DISPLAY_ORDER_KEY, JSON.stringify(preset.displayOrder));
    localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(preset.metricCardOrder));
    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(preset.sectionOrder));
    localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify(preset.dashboardSections));
    if (preset.sectionSizes && Object.keys(preset.sectionSizes).length > 0) {
      localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(preset.sectionSizes));
    }
    setLayoutsMenuOpen(false);
  };

  const saveCurrentLayoutAsPreset = (name: string) => {
    const metricIds = sortedMetrics.map((m) => m.id);
    const sectionIds = sectionOrder.filter((id) => sectionVisible(id));
    const order = mergedDisplayOrder && mergedDisplayOrder.length > 0
      ? mergedDisplayOrder.filter((id) => metricIds.includes(id) || sectionIds.includes(id as SectionId))
      : [...metricIds, ...sectionIds];
    const preset: DashboardLayoutPreset = {
      id: `preset-${Date.now()}`,
      name: name.trim() || "Untitled layout",
      displayOrder: order,
      metricCardOrder: [...metricCardOrder],
      sectionOrder: [...sectionOrder],
      dashboardSections: { ...dashboardSections },
      sectionSizes: { ...sectionSizes },
      lockedGridColumns: layoutLocked ? lockedGridColumns : undefined,
      lockedSlotAssignments: layoutLocked && lockedSlotAssignments != null && lockedSlotAssignments.length > 0 ? lockedSlotAssignments : undefined,
      lockedPlacements: layoutLocked && lockedPlacements != null && lockedPlacements.length > 0 ? lockedPlacements : undefined,
      lockedColumnWidths: layoutLocked && lockedColumnWidths.length > 0 ? lockedColumnWidths : undefined,
    };
    setLayoutPresets((prev) => {
      const next = [...prev, preset];
      localStorage.setItem(DASHBOARD_LAYOUT_PRESETS_KEY, JSON.stringify(next));
      return next;
    });
    saveDashboardProfileSnapshot(activeDashboardProfileId);
    setLayoutsMenuOpen(false);
  };

  const deleteLayoutPreset = (id: string) => {
    setLayoutPresets((prev) => {
      const next = prev.filter((p) => p.id !== id);
      localStorage.setItem(DASHBOARD_LAYOUT_PRESETS_KEY, JSON.stringify(next));
      return next;
    });
    saveDashboardProfileSnapshot(activeDashboardProfileId);
  };

  useEffect(() => {
    if (!layoutsMenuOpen && !organizeMenuOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-layouts-menu]") || target.closest("[data-organize-menu]") || target.closest("[data-layouts-button]") || target.closest("[data-organize-button]")) return;
      setLayoutsMenuOpen(false);
      setOrganizeMenuOpen(false);
    };
    const t = setTimeout(() => {
      document.addEventListener("click", close, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", close, true);
    };
  }, [layoutsMenuOpen, organizeMenuOpen]);

  type OrganizeOption = "metrics-first" | "sections-first" | "default" | "reset-layout";
  const applyOrganizeOrder = (option: OrganizeOption) => {
    const metricIds = sortedMetrics.map((m) => m.id);
    const sectionIds = sectionOrder.filter((id) => sectionVisible(id));
    let order: string[];
    if (option === "metrics-first") {
      order = [...metricIds, ...sectionIds];
      setMergedDisplayOrder(order);
      setMetricCardOrder(metricIds);
      setSectionOrder((prev) => {
        const next = [...sectionIds, ...prev.filter((id) => !sectionIds.includes(id))];
        localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(next));
        return next;
      });
      localStorage.setItem(DASHBOARD_DISPLAY_ORDER_KEY, JSON.stringify(order));
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(metricIds));
    } else if (option === "sections-first") {
      order = [...sectionIds, ...metricIds];
      setMergedDisplayOrder(order);
      setMetricCardOrder(metricIds);
      setSectionOrder((prev) => {
        const next = [...sectionIds, ...prev.filter((id) => !sectionIds.includes(id))];
        localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(next));
        return next;
      });
      localStorage.setItem(DASHBOARD_DISPLAY_ORDER_KEY, JSON.stringify(order));
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(metricIds));
    } else if (option === "reset-layout") {
      order = [...metricIds, ...defaultSectionOrder.filter((id) => sectionVisible(id))];
      setMergedDisplayOrder(null);
      setMetricCardOrder((prev) => prev.length > 0 ? prev : metricIds);
      setSectionOrder(defaultSectionOrder);
      localStorage.removeItem(DASHBOARD_DISPLAY_ORDER_KEY);
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(metricIds));
      localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(defaultSectionOrder));
      setLockedSlotAssignments(null);
      localStorage.removeItem(DASHBOARD_LOCKED_SLOT_ASSIGNMENTS_KEY);
      setLockedPlacements(null);
      localStorage.removeItem(DASHBOARD_LOCKED_PLACEMENTS_KEY);
      localStorage.setItem(COLOR_RANGE_KEY, JSON.stringify(DEFAULT_COLOR_RANGE));
      setLockedGridColumns(DEFAULT_LAYOUT.maxColumns);
      localStorage.setItem(DASHBOARD_MAX_METRIC_ROWS_KEY, String(DEFAULT_LAYOUT.maxMetricRows));
      localStorage.setItem(DASHBOARD_MAX_COLUMNS_KEY, String(DEFAULT_LAYOUT.maxColumns));
      localStorage.setItem(DASHBOARD_LOCKED_ROW_HEIGHT_KEY, String(DEFAULT_LAYOUT.lockedRowHeight));
      localStorage.setItem(DASHBOARD_SPLIT_GRID_KEY, DEFAULT_LAYOUT.splitGrid ? "true" : "false");
      localStorage.setItem(DASHBOARD_METRICS_TO_SECTIONS_GAP_KEY, String(DEFAULT_LAYOUT.metricsToSectionsGap));
      localStorage.setItem(DASHBOARD_SECTIONS_GRID_GAP_KEY, String(DEFAULT_LAYOUT.sectionsGridGap));
      localStorage.setItem(DASHBOARD_SECTIONS_GRID_MIN_WIDTH_KEY, String(DEFAULT_LAYOUT.sectionsGridMinWidth));
      localStorage.setItem(DASHBOARD_METRICS_GRID_GAP_KEY, String(DEFAULT_LAYOUT.metricsGridGap));
      localStorage.setItem(DASHBOARD_SECTIONS_GRID_MARGIN_BOTTOM_KEY, String(DEFAULT_LAYOUT.sectionsGridMarginBottom));
      localStorage.setItem(DASHBOARD_PADDING_KEY, String(DEFAULT_LAYOUT.dashboardPadding));
      setOrganizeMenuOpen(false);
      setConfigKey((k) => k + 1);
      return;
    } else {
      const defaultSectionIds = defaultSectionOrder.filter((id) => sectionVisible(id));
      order = [...metricIds, ...defaultSectionIds];
      setMergedDisplayOrder(null);
      setMetricCardOrder((prev) => prev.length > 0 ? prev : metricIds);
      setSectionOrder(defaultSectionOrder);
      localStorage.removeItem(DASHBOARD_DISPLAY_ORDER_KEY);
      localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(metricIds));
      localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(defaultSectionOrder));
    }
    if (layoutLocked) {
      const numEmptySlots = Math.max(4, 3 * lockedGridColumns);
      const newSlots = [...order, ...Array(numEmptySlots).fill(null)];
      setLockedSlotAssignments(newSlots);
      localStorage.setItem(DASHBOARD_LOCKED_SLOT_ASSIGNMENTS_KEY, JSON.stringify(newSlots));
      setLockedPlacements(null);
      localStorage.removeItem(DASHBOARD_LOCKED_PLACEMENTS_KEY);
    }
    setOrganizeMenuOpen(false);
  };

  // Ref set by section grid so unified grid can render full section cards when mixing.
  const renderSectionCardRef = useRef<((sectionId: SectionId) => React.ReactNode) | null>(null);
  const [sectionCardRefReady, setSectionCardRefReady] = useState(0);
  useLayoutEffect(() => {
    if (renderSectionCardRef.current && sectionCardRefReady === 0) setSectionCardRefReady(1);
  });

  // Listen for color range changes - use a ref to track previous value
  const prevColorRangeRef = useRef<string>("");
  useEffect(() => {
    const checkColorRange = () => {
      const currentRange = localStorage.getItem("tradebutler_color_range");
      if (currentRange && currentRange !== prevColorRangeRef.current) {
        prevColorRangeRef.current = currentRange;
        setConfigKey(prev => prev + 1);
      }
    };
    
    // Check immediately
    checkColorRange();
    
    // Check periodically for localStorage changes
    const interval = setInterval(checkColorRange, 300);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadDashboardData();
    // Reset to first page when timeframe changes
    setCurrentTradesPage(1);
  }, [timeframe, customStartDate, customEndDate, dataMode, dashboardStrategyId]);

  useEffect(() => {
    if (dashboardStrategyId != null) {
      localStorage.setItem(DASHBOARD_STRATEGY_ID_KEY, String(dashboardStrategyId));
    } else {
      localStorage.removeItem(DASHBOARD_STRATEGY_ID_KEY);
    }
  }, [dashboardStrategyId]);
  
  useEffect(() => {
    localStorage.setItem("tradebutler_dashboard_timeframe", timeframe);
  }, [timeframe]);
  
  useEffect(() => {
    if (customStartDate) {
      localStorage.setItem("tradebutler_dashboard_custom_start", customStartDate);
    } else {
      localStorage.removeItem("tradebutler_dashboard_custom_start");
    }
    if (customEndDate) {
      localStorage.setItem("tradebutler_dashboard_custom_end", customEndDate);
    } else {
      localStorage.removeItem("tradebutler_dashboard_custom_end");
    }
  }, [customStartDate, customEndDate]);

  // Re-read dashboard sections from localStorage when config changes
  useEffect(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_KEY);
    if (saved) {
      try {
        const newSections = { ...defaultDashboardSections, ...JSON.parse(saved) };
        setDashboardSections(newSections);
        
        // Ensure all enabled sections are in the sectionOrder
        const allSections: SectionId[] = [
          "topSymbols",
          "strategyPerformance",
          "recentTrades",
          "trades",
          "openPositions",
          "news",
          "dividendTracker",
        ];
        setSectionOrder(prevOrder => {
          const enabledSections = allSections.filter((id) => {
            const key = SECTION_DASHBOARD_SECTION_KEY[id];
            return newSections[key] !== false;
          });
          
          // Keep existing order for sections that are still enabled, add new ones at the end
          const existingOrder = prevOrder.filter(id => enabledSections.includes(id));
          const missing = enabledSections.filter(id => !existingOrder.includes(id));
          const newOrder = [...existingOrder, ...missing];
          
          if (JSON.stringify(newOrder) !== JSON.stringify(prevOrder)) {
            localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
            return newOrder;
          }
          return prevOrder;
        });
      } catch {
        // Keep current state
      }
    }
  }, [configKey]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      if (dataMode === "sandbox") {
        const state = loadSandboxState();
        setMetrics(EXAMPLE_METRICS as unknown as Metrics);
        setStrategies(state.strategies.map((s) => ({ id: s.id, name: s.name, description: s.description, notes: s.notes, color: s.color })) as unknown as Strategy[]);
        const topSymbolsData = EXAMPLE_SYMBOL_PNL.slice(0, 5).map((pnl) => ({
          symbol: pnl.symbol,
          trade_count: pnl.closed_positions,
          total_volume: 0,
          estimated_pnl: pnl.total_net_pnl,
        }));
        setTopSymbols(topSymbolsData);
        let perf = EXAMPLE_STRATEGY_PERFORMANCE as unknown as StrategyPerformance[];
        if (dashboardStrategyId != null) {
          perf = perf.filter((p) => p.strategy_id === dashboardStrategyId);
        }
        setStrategyPerformance(perf);
        setRecentTrades(EXAMPLE_RECENT_TRADES.slice(0, 5) as unknown as RecentTrade[]);
        setTrades(EXAMPLE_RECENT_TRADES as unknown as RecentTrade[]);
        setOpenPositionGroups([]);
        setLoading(false);
        return;
      }

      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
      const startDate = dateRange.start ? dateRange.start.toISOString() : null;
      const endDate = dateRange.end ? dateRange.end.toISOString() : null;
      const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
      const strategyArgs = dashboardStrategyId != null ? { strategyId: dashboardStrategyId } : {};
      const [metricsData, pnlData, strategiesData, tradesData, allTradesData, strategiesList, positionGroupsData] = await Promise.all([
        invoke<Metrics>("get_metrics", { pairingMethod, startDate, endDate, ...paperArgs, ...strategyArgs }),
        invoke<SymbolPnL[]>("get_symbol_pnl", { pairingMethod, startDate, endDate, ...paperArgs, filters: null, ...strategyArgs }),
        invoke<StrategyPerformance[]>("get_strategy_performance", { pairingMethod, startDate, endDate, ...paperArgs, ...strategyArgs }),
        invoke<RecentTrade[]>("get_recent_trades", { limit: 5, pairingMethod, startDate, endDate, ...paperArgs, ...strategyArgs }),
        invoke<RecentTrade[]>("get_recent_trades", { limit: 10000, pairingMethod, startDate, endDate, ...paperArgs, ...strategyArgs }),
        invoke<Strategy[]>("get_strategies"),
        invoke<OpenPositionGroup[]>("get_position_groups", { pairingMethod, startDate: null, endDate: null, ...paperArgs }),
      ]);
      setMetrics(metricsData);
      setStrategies(strategiesList);
      setOpenPositionGroups(
        (positionGroupsData || []).filter((g) => Math.abs(g.final_quantity) >= 0.0001)
      );
      
      // Convert SymbolPnL to TopSymbol format for display
      const topSymbolsData = pnlData
        .slice(0, 5)
        .map((pnl) => ({
          symbol: pnl.symbol,
          trade_count: pnl.closed_positions,
          total_volume: 0, // We don't track volume separately
          estimated_pnl: pnl.total_net_pnl,
        }));
      setTopSymbols(topSymbolsData);
      setStrategyPerformance(strategiesData);
      setRecentTrades(tradesData);
      // Sort all trades by exit timestamp (most recent first)
      const sortedTrades = [...allTradesData].sort((a, b) => 
        new Date(b.exit_timestamp).getTime() - new Date(a.exit_timestamp).getTime()
      );
      setTrades(sortedTrades);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate strategy-filtered metrics
  const [filteredStrategyMetrics, setFilteredStrategyMetrics] = useState<Record<string, number>>({});
  
  useEffect(() => {
    if (dashboardStrategyId != null) {
      setFilteredStrategyMetrics({});
      return;
    }

    let cancelled = false;
    
    const calculateFilteredMetrics = async () => {
      const strategyMetrics = [
        "strategy_win_rate",
        "strategy_winning_trades",
        "strategy_losing_trades",
        "strategy_profit_loss",
        "strategy_consecutive_wins",
        "strategy_consecutive_losses",
      ];
      
      const newFilteredMetrics: Record<string, number> = {};
      
      // Group instances by strategy ID to batch API calls
      const instancesByStrategy = new Map<number, Array<{ instance: MetricInstance; baseMetricId: string }>>();
      
      for (const instance of metricInstances) {
        if (!strategyMetrics.includes(instance.baseMetricId)) continue;
        
        // Only use instanceId for the filter - never fall back to baseMetricId
        const selectedStrategyId = strategyFilterForMetrics[instance.instanceId];
        // If null or undefined, explicitly don't add to newFilteredMetrics (will use global metrics instead)
        if (selectedStrategyId === null || selectedStrategyId === undefined) {
          continue;
        }
        
        if (!instancesByStrategy.has(selectedStrategyId)) {
          instancesByStrategy.set(selectedStrategyId, []);
        }
        instancesByStrategy.get(selectedStrategyId)!.push({ instance, baseMetricId: instance.baseMetricId });
      }
      
      // Process in batches to avoid too many simultaneous API calls
      const BATCH_SIZE = 3;
      const strategyIds = Array.from(instancesByStrategy.keys());
      
      for (let i = 0; i < strategyIds.length; i += BATCH_SIZE) {
        if (cancelled) return;
        
        const batch = strategyIds.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (selectedStrategyId) => {
          try {
            const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
            const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
            const startDate = dateRange.start ? dateRange.start.toISOString() : null;
            const endDate = dateRange.end ? dateRange.end.toISOString() : null;
            
            const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
            const filteredPairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
              strategyId: selectedStrategyId,
              pairingMethod,
              startDate,
              endDate,
              ...paperArgs,
            });
            
            // Calculate metrics for all instances using this strategy
            const instances = instancesByStrategy.get(selectedStrategyId)!;
            for (const { instance, baseMetricId } of instances) {
              if (baseMetricId === "strategy_win_rate") {
                const winning = filteredPairs.filter(p => p.net_profit_loss > 0).length;
                const total = filteredPairs.length;
                newFilteredMetrics[instance.instanceId] = total > 0 ? (winning / total) * 100 : 0;
              } else if (baseMetricId === "strategy_winning_trades") {
                newFilteredMetrics[instance.instanceId] = filteredPairs.filter(p => p.net_profit_loss > 0).length;
              } else if (baseMetricId === "strategy_losing_trades") {
                newFilteredMetrics[instance.instanceId] = filteredPairs.filter(p => p.net_profit_loss < 0).length;
              } else if (baseMetricId === "strategy_profit_loss") {
                newFilteredMetrics[instance.instanceId] = filteredPairs.reduce((sum, p) => sum + p.net_profit_loss, 0);
              } else if (baseMetricId === "strategy_consecutive_wins") {
                let maxStreak = 0;
                let currentStreak = 0;
                for (const pair of filteredPairs) {
                  if (pair.net_profit_loss > 0) {
                    currentStreak++;
                    maxStreak = Math.max(maxStreak, currentStreak);
                  } else {
                    currentStreak = 0;
                  }
                }
                newFilteredMetrics[instance.instanceId] = maxStreak;
              } else if (baseMetricId === "strategy_consecutive_losses") {
                let maxStreak = 0;
                let currentStreak = 0;
                for (const pair of filteredPairs) {
                  if (pair.net_profit_loss < 0) {
                    currentStreak++;
                    maxStreak = Math.max(maxStreak, currentStreak);
                  } else {
                    currentStreak = 0;
                  }
                }
                newFilteredMetrics[instance.instanceId] = maxStreak;
              }
            }
          } catch (error) {
            console.error(`Error calculating filtered metrics for strategy ${selectedStrategyId}:`, error);
            // Set fallback values for all instances using this strategy
            const instances = instancesByStrategy.get(selectedStrategyId)!;
            for (const { instance } of instances) {
              newFilteredMetrics[instance.instanceId] = metrics?.[instance.baseMetricId as keyof Metrics] as number || 0;
            }
          }
        });
        
        await Promise.all(batchPromises);
        
        // Small delay between batches to prevent overwhelming the backend
        if (i + BATCH_SIZE < strategyIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      if (!cancelled) {
        setFilteredStrategyMetrics(newFilteredMetrics);
      }
    };
    
    calculateFilteredMetrics();
    
    return () => {
      cancelled = true;
    };
  }, [dashboardStrategyId, strategyFilterForMetrics, timeframe, customStartDate, customEndDate, metrics, metricInstances, dataMode]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading metrics...</p>
      </div>
    );
  }

  const metricValues: Record<string, number> = {
    total_trades: metrics?.total_trades || 0,
    total_volume: metrics?.total_volume || 0,
    total_profit_loss: metrics?.total_profit_loss || 0,
    win_rate: metrics?.win_rate || 0,
    winning_trades: metrics?.winning_trades || 0,
    losing_trades: metrics?.losing_trades || 0,
    average_profit: metrics?.average_profit || 0,
    average_loss: metrics?.average_loss || 0,
    largest_win: metrics?.largest_win || 0,
    largest_loss: metrics?.largest_loss || 0,
    consecutive_wins: metrics?.consecutive_wins || 0,
    consecutive_losses: metrics?.consecutive_losses || 0,
    current_win_streak: metrics?.current_win_streak || 0,
    current_loss_streak: metrics?.current_loss_streak || 0,
    strategy_win_rate: filteredStrategyMetrics.strategy_win_rate !== undefined 
      ? filteredStrategyMetrics.strategy_win_rate 
      : (metrics?.strategy_win_rate || 0),
    strategy_winning_trades: filteredStrategyMetrics.strategy_winning_trades !== undefined 
      ? filteredStrategyMetrics.strategy_winning_trades 
      : (metrics?.strategy_winning_trades || 0),
    strategy_losing_trades: filteredStrategyMetrics.strategy_losing_trades !== undefined 
      ? filteredStrategyMetrics.strategy_losing_trades 
      : (metrics?.strategy_losing_trades || 0),
    strategy_profit_loss: filteredStrategyMetrics.strategy_profit_loss !== undefined 
      ? filteredStrategyMetrics.strategy_profit_loss 
      : (metrics?.strategy_profit_loss || 0),
    strategy_consecutive_wins: filteredStrategyMetrics.strategy_consecutive_wins !== undefined 
      ? filteredStrategyMetrics.strategy_consecutive_wins 
      : (metrics?.strategy_consecutive_wins || 0),
    strategy_consecutive_losses: filteredStrategyMetrics.strategy_consecutive_losses !== undefined 
      ? filteredStrategyMetrics.strategy_consecutive_losses 
      : (metrics?.strategy_consecutive_losses || 0),
    expectancy: metrics?.expectancy || 0,
    profit_factor: metrics?.profit_factor || 0,
    average_trade: metrics?.average_trade || 0,
    total_fees: metrics?.total_fees || 0,
    net_profit: metrics?.net_profit || 0,
    max_drawdown: metrics?.max_drawdown || 0,
    sharpe_ratio: metrics?.sharpe_ratio || 0,
    risk_reward_ratio: metrics?.risk_reward_ratio || 0,
    trades_per_day: metrics?.trades_per_day || 0,
    best_day: metrics?.best_day || 0,
    worst_day: metrics?.worst_day || 0,
    average_holding_time_seconds: metrics?.average_holding_time_seconds || 0,
    average_gain_pct: metrics?.average_gain_pct || 0,
    average_loss_pct: metrics?.average_loss_pct || 0,
    largest_win_pct: metrics?.largest_win_pct || 0,
    largest_loss_pct: metrics?.largest_loss_pct || 0,
    current_price: 0,
  };

  const splitGrid = localStorage.getItem(DASHBOARD_SPLIT_GRID_KEY) === "true";
  const sectionsOnTop = localStorage.getItem(DASHBOARD_SECTIONS_ON_TOP_KEY) !== "false";

  const metricsToSectionsGapPx = (() => {
    const n = parseInt(localStorage.getItem(DASHBOARD_METRICS_TO_SECTIONS_GAP_KEY) ?? String(DEFAULT_LAYOUT.metricsToSectionsGap), 10);
    if (Number.isNaN(n) || n < 0) return DEFAULT_LAYOUT.metricsToSectionsGap;
    return Math.min(80, n);
  })();
  const metricsGridGapPx = (() => {
    const n = parseInt(localStorage.getItem(DASHBOARD_METRICS_GRID_GAP_KEY) ?? String(DEFAULT_LAYOUT.metricsGridGap), 10);
    return [0, 4, 8, 12, 16, 20, 24].includes(n) ? n : DEFAULT_LAYOUT.metricsGridGap;
  })();
  const sectionsGridGapPx = Math.min(48, Math.max(0, parseInt(localStorage.getItem(DASHBOARD_SECTIONS_GRID_GAP_KEY) ?? String(DEFAULT_LAYOUT.sectionsGridGap), 10)) || DEFAULT_LAYOUT.sectionsGridGap);
  const sectionsGridMinWidthPx = (() => {
    const n = parseInt(localStorage.getItem(DASHBOARD_SECTIONS_GRID_MIN_WIDTH_KEY) ?? String(DEFAULT_LAYOUT.sectionsGridMinWidth), 10);
    return [280, 320, 360, 400, 480].includes(n) ? n : DEFAULT_LAYOUT.sectionsGridMinWidth;
  })();
  const sectionsGridMarginBottomPx = Math.min(80, Math.max(0, parseInt(localStorage.getItem(DASHBOARD_SECTIONS_GRID_MARGIN_BOTTOM_KEY) ?? String(DEFAULT_LAYOUT.sectionsGridMarginBottom), 10)) || DEFAULT_LAYOUT.sectionsGridMarginBottom);
  const dashboardPaddingPx = (() => {
    const n = parseInt(localStorage.getItem(DASHBOARD_PADDING_KEY) ?? String(DEFAULT_LAYOUT.dashboardPadding), 10);
    return [16, 20, 24, 30, 40, 48].includes(n) ? n : DEFAULT_LAYOUT.dashboardPadding;
  })();

  return (
    <CurrentPriceSyncContext.Provider
      value={{
        enabled: currentPriceSync.enabled,
        seconds: currentPriceSync.seconds,
        tick: currentPriceSyncTick,
      }}
    >
    <MoveInLockedGridContext.Provider value={moveInLockedGridRef}>
    <div style={{ padding: `${dashboardPaddingPx}px` }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "20px",
            }}
          >
            <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Dashboard</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "0 8px 0 0", borderRight: "1px solid var(--border-color)", marginRight: "2px" }}>
                <Layers size={16} color="var(--text-secondary)" style={{ flexShrink: 0 }} aria-hidden />
                <span style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>View:</span>
                <select
                  value={activeDashboardProfileId}
                  onChange={(e) => switchDashboardProfile(e.target.value)}
                  title="Saved dashboard layouts"
                  style={{
                    padding: "6px 10px",
                    fontSize: "13px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    minWidth: "120px",
                    maxWidth: "200px",
                  }}
                >
                  {dashboardProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={duplicateDashboardProfile}
                  title="Copy current dashboard as a new saved view"
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "6px 8px",
                    cursor: "pointer",
                    color: "var(--text-primary)",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  onClick={renameActiveDashboardProfile}
                  title="Rename this dashboard"
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "6px 8px",
                    cursor: "pointer",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={deleteDashboardProfile}
                  disabled={dashboardProfiles.length <= 1}
                  title={dashboardProfiles.length <= 1 ? "Keep at least one dashboard" : "Delete this dashboard"}
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "6px 8px",
                    cursor: dashboardProfiles.length <= 1 ? "not-allowed" : "pointer",
                    color: dashboardProfiles.length <= 1 ? "var(--text-secondary)" : "var(--loss)",
                    display: "flex",
                    alignItems: "center",
                    opacity: dashboardProfiles.length <= 1 ? 0.45 : 1,
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "0 4px" }}>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Columns:</span>
                {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setLockedGridColumns(n);
                      localStorage.setItem(DASHBOARD_MAX_COLUMNS_KEY, String(n));
                    }}
                    title={`${n} columns`}
                    style={{
                      minWidth: "28px",
                      padding: "6px 8px",
                      fontSize: "12px",
                      fontWeight: lockedGridColumns === n ? "600" : "400",
                      background: lockedGridColumns === n ? "color-mix(in srgb, var(--accent) 18%, var(--bg-secondary))" : "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      color: lockedGridColumns === n ? "var(--accent)" : "var(--text-primary)",
                      cursor: "pointer",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div style={{ position: "relative" }}>
                <button
                  data-layouts-button
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setLayoutsMenuAnchor({ top: rect.bottom + 4, left: rect.left });
                    setLayoutsMenuOpen((prev) => !prev);
                  }}
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "14px",
                  }}
                  title="Layout presets"
                >
                  <LayoutDashboard size={16} />
                  Layouts
                  <ChevronDown size={14} />
                </button>
                {layoutsMenuOpen && layoutsMenuAnchor && createPortal(
                  <div
                    data-layouts-menu
                    style={{
                      position: "fixed",
                      top: layoutsMenuAnchor.top,
                      left: layoutsMenuAnchor.left,
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "6px 0",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                      zIndex: 99999,
                      minWidth: "200px",
                      maxWidth: "280px",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {layoutPresets.length === 0 ? (
                      <div style={{ padding: "8px 12px", fontSize: "13px", color: "var(--text-secondary)" }}>No saved layouts</div>
                    ) : (
                      layoutPresets.map((preset) => (
                        <div key={preset.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                          <button
                            onClick={() => applyLayoutPreset(preset)}
                            style={{
                              flex: 1,
                              textAlign: "left",
                              background: "transparent",
                              border: "none",
                              padding: "8px 12px",
                              cursor: "pointer",
                              color: "var(--text-primary)",
                              fontSize: "13px",
                            }}
                          >
                            {preset.name}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteLayoutPreset(preset.id); }}
                            title="Delete preset"
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "4px 8px",
                              cursor: "pointer",
                              color: "var(--text-secondary)",
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                    <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                    <button
                      onClick={() => {
                        const name = window.prompt("Name this layout", "");
                        if (name != null) saveCurrentLayoutAsPreset(name);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        padding: "8px 12px",
                        cursor: "pointer",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <Save size={14} />
                      Save current layout
                    </button>
                  </div>,
                  document.body
                )}
              </div>
              <div style={{ position: "relative" }}>
                <button
                  data-organize-button
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setOrganizeMenuAnchor({ top: rect.bottom + 4, left: rect.left });
                    setOrganizeMenuOpen((prev) => !prev);
                  }}
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "14px",
                  }}
                  title="Reorder dashboard"
                >
                  <ListOrdered size={16} />
                  Organize
                  <ChevronDown size={14} />
                </button>
                {organizeMenuOpen && organizeMenuAnchor && createPortal(
                  <div
                    data-organize-menu
                    style={{
                      position: "fixed",
                      top: organizeMenuAnchor.top,
                      left: organizeMenuAnchor.left,
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "10px",
                      padding: "8px 0",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                      zIndex: 99999,
                      minWidth: "260px",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ padding: "6px 12px 4px", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Display order
                    </div>
                    <button
                      onClick={() => applyOrganizeOrder("metrics-first")}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        padding: "8px 12px",
                        cursor: "pointer",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      Metrics first, then sections
                    </button>
                    <button
                      onClick={() => applyOrganizeOrder("sections-first")}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        padding: "8px 12px",
                        cursor: "pointer",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      Sections first, then metrics
                    </button>
                    <button
                      onClick={() => applyOrganizeOrder("default")}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        padding: "8px 12px",
                        cursor: "pointer",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      Default order
                    </button>
                    {layoutLocked && (
                      <>
                        <div style={{ borderTop: "1px solid var(--border-color)", margin: "6px 0" }} />
                        <div style={{ padding: "6px 12px 4px", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Grid columns
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "6px 12px 8px" }}>
                          {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                            <button
                              key={n}
                              onClick={() => {
                                setLockedGridColumns(n);
                                localStorage.setItem(DASHBOARD_MAX_COLUMNS_KEY, String(n));
                              }}
                              style={{
                                minWidth: "28px",
                                padding: "4px 6px",
                                fontSize: "12px",
                                fontWeight: lockedGridColumns === n ? 600 : 400,
                                background: lockedGridColumns === n ? "color-mix(in srgb, var(--accent) 18%, var(--bg-secondary))" : "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                color: lockedGridColumns === n ? "var(--accent)" : "var(--text-primary)",
                                cursor: "pointer",
                              }}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <div style={{ borderTop: "1px solid var(--border-color)", margin: "6px 0" }} />
                    <button
                      onClick={() => applyOrganizeOrder("reset-layout")}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        padding: "8px 12px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        fontSize: "13px",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                      title="Clear custom order and grid positions"
                    >
                      Reset layout
                    </button>
                  </div>,
                  document.body
                )}
              </div>
              <button
                onClick={() => setShowMetricsConfig(true)}
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "10px 16px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "14px",
                }}
              >
                <Settings size={16} />
                Configure
              </button>
            </div>
          </div>
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
          <div style={{ marginBottom: "30px", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "20px 24px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "min(100%, 280px)" }}>
              <label
                htmlFor="dashboard-strategy-select"
                style={{
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <Layers size={16} style={{ flexShrink: 0 }} aria-hidden />
                Strategy
              </label>
              <select
                id="dashboard-strategy-select"
                value={dashboardStrategyId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setDashboardStrategyId(v === "" ? null : parseInt(v, 10));
                }}
                style={{
                  width: "100%",
                  maxWidth: "320px",
                  padding: "10px 12px",
                  fontSize: "14px",
                  color: "var(--text-primary)",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                <option value="">All strategies</option>
                {strategies
                  .filter((s) => s.id != null)
                  .map((s) => (
                    <option key={s.id} value={s.id!}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", maxWidth: "360px", lineHeight: 1.4 }}>
                Filters metrics and sections below. Open positions always show all open positions.
              </p>
            </div>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <TimeframeSelector
              value={timeframe}
              onChange={setTimeframe}
              customStartDate={customStartDate}
              customEndDate={customEndDate}
              onCustomDatesChange={(start, end) => {
                // Ensure we save the dates immediately
                setCustomStartDate(start || "");
                setCustomEndDate(end || "");
                // Also save directly to localStorage to ensure persistence
                if (start) {
                  localStorage.setItem("tradebutler_dashboard_custom_start", start);
                } else {
                  localStorage.removeItem("tradebutler_dashboard_custom_start");
                }
                if (end) {
                  localStorage.setItem("tradebutler_dashboard_custom_end", end);
                } else {
                  localStorage.removeItem("tradebutler_dashboard_custom_end");
                }
              }}
            />
            </div>
          </div>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Metrics Cards */}
      <div style={{ ...(splitGrid ? { order: 1 } : {}), minWidth: 0 }}>
      {((order: string[], onDragEnd: (e: DragEndEvent) => void) => {
        moveInLockedGridRef.current = null;
        const maxMetricRows = Math.max(0, parseInt(localStorage.getItem(DASHBOARD_MAX_METRIC_ROWS_KEY) ?? String(DEFAULT_LAYOUT.maxMetricRows), 10));
        const maxColumns = Math.max(0, Math.min(10, parseInt(localStorage.getItem(DASHBOARD_MAX_COLUMNS_KEY) ?? String(DEFAULT_LAYOUT.maxColumns), 10)));
        const useGridLayout = layoutLocked || maxMetricRows > 0 || maxColumns > 0;
        const gridColumns = useGridLayout
          ? (layoutLocked
              ? lockedGridColumns
              : maxMetricRows > 0
                ? Math.max(1, Math.ceil(sortedMetrics.length / maxMetricRows))
                : maxColumns > 0
                  ? maxColumns
                  : 1)
          : 1;
        /** Unlocked with no fixed rows/cols: fluid grid so cards resize with container and rows add/remove on resize */
        const useFluidGrid = !layoutLocked && !useGridLayout;

        const renderCard = (metric: typeof sortedMetrics[0]) => {
          const baseMetricId = (metric as any).baseMetricId || metric.id;
          const value = filteredStrategyMetrics[metric.id] !== undefined
            ? filteredStrategyMetrics[metric.id]
            : (metricValues[baseMetricId] || 0);
          const Icon = metricIcons[baseMetricId] || Activity;
          const color = getMetricColor(baseMetricId, value);
          return (
            <SortableMetricCard
              key={metric.id}
              id={metric.id}
              metric={metric}
              value={value}
              Icon={Icon}
              color={color}
              metrics={metrics}
              formatMetricValue={formatMetricValue}
              setTimeframe={setTimeframe}
              setCustomStartDate={setCustomStartDate}
              setCustomEndDate={setCustomEndDate}
              setSelectedPositionGroupId={setSelectedPositionGroupId}
              setShowPositionGroupModal={setShowPositionGroupModal}
              setSelectedPositionGroup={setSelectedPositionGroup}
              openMetricSettings={openMetricSettings}
              setOpenMetricSettings={setOpenMetricSettings}
              metricMenuPosition={metricMenuPosition}
              setMetricMenuPosition={setMetricMenuPosition}
              sortedMetrics={sortedMetrics}
              enabledMetrics={enabledMetrics}
              setMetricCardOrder={setMetricCardOrder}
              strategies={strategies}
              strategyFilterForMetrics={strategyFilterForMetrics}
              setStrategyFilterForMetrics={setStrategyFilterForMetrics}
              duplicateMetricInstance={duplicateMetricInstance}
              removeMetricInstance={removeMetricInstance}
              setMetricInstances={setMetricInstances}
              dataMode={dataMode}
              openPositionGroups={openPositionGroups}
              isGridLayout={useGridLayout || useFluidGrid}
              isFluidGrid={useFluidGrid}
              layoutLocked={layoutLocked}
              lockedRowHeight={lockedRowHeight}
            />
          );
        };

        if (layoutLocked) {
          const numEmptySlots = Math.max(4, 3 * gridColumns);
          const minTotalSlots = order.length + numEmptySlots;
          const effectiveSlotAssignments = lockedSlotAssignments && lockedSlotAssignments.length >= minTotalSlots
            ? lockedSlotAssignments
            : [...order, ...Array(numEmptySlots).fill(null)];
          const totalSlots = effectiveSlotAssignments.length;
          const columnWidths = lockedColumnWidths.length === gridColumns
            ? lockedColumnWidths
            : Array.from({ length: gridColumns }, () => 1);
          const gridTemplateCols = columnWidths.map((w) => `${w}fr`).join(" ");

          const slotSpans: number[] = [];
          const slotRowSpans: number[] = [];
          for (let i = 0; i < totalSlots; i++) {
            const id = effectiveSlotAssignments[i] ?? null;
            let span = 1;
            let rowSpan = 1;
            if (id) {
              if (isSectionId(id)) {
                const defaultSectionSpan = id === "openPositions" && openPositionsDisplayMode === "compact" ? 3 : 1;
                span = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, sectionSizes[id]?.columnSpan ?? defaultSectionSpan));
                rowSpan = effectiveSectionRowSpanForLockedGrid(id, sectionSizes, lockedRowHeight);
              } else {
                const metric = sortedMetrics.find((m) => m.id === id);
                if (metric) {
                  const bm = (metric as MetricInstance).baseMetricId || metric.id;
                  span =
                    bm === "position_size_chart"
                      ? Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, (metric as MetricInstance).chartColumnSpan ?? ((metric as MetricInstance).chartWidth ? 2 : 1)))
                      : Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, (metric as MetricInstance).cardColumnSpan ?? 1));
                  rowSpan = effectiveMetricRowSpanForLockedGrid(metric as MetricInstance, bm, lockedRowHeight);
                }
              }
            }
            slotSpans.push(Math.min(span, gridColumns));
            slotRowSpans.push(rowSpan);
          }

          const placements: { row: number; col: number }[] = [];
          const used: boolean[][] = [];
          let didPack = false;
          const ensureRows = (r: number) => {
            while (used.length <= r) {
              used.push(Array.from({ length: gridColumns }, () => false));
            }
          };
          let forceRepack = false;
          const prev = previousSlotSpansRef.current;
          if (prev && prev.length === totalSlots) {
            for (let i = 0; i < totalSlots && !forceRepack; i++) {
              if (slotSpans[i] > (prev[i]?.colSpan ?? 0) || slotRowSpans[i] > (prev[i]?.rowSpan ?? 0)) forceRepack = true;
            }
          }
          const stored = !forceRepack && lockedPlacements && lockedPlacements.length >= totalSlots ? lockedPlacements : null;

          const tryFirstFitPlace = (colSpan: number, rowSpan: number): { row: number; col: number } | null => {
            for (let r = 0; r < 400; r++) {
              ensureRows(r + rowSpan - 1);
              for (let c = 0; c <= gridColumns - colSpan; c++) {
                let fits = true;
                for (let dr = 0; dr < rowSpan && fits; dr++) {
                  for (let dc = 0; dc < colSpan && fits; dc++) {
                    if (used[r + dr][c + dc]) fits = false;
                  }
                }
                if (fits) {
                  for (let dr = 0; dr < rowSpan; dr++) {
                    ensureRows(r + dr);
                    for (let dc = 0; dc < colSpan; dc++) used[r + dr][c + dc] = true;
                  }
                  return { row: r, col: c };
                }
              }
            }
            return null;
          };

          for (let i = 0; i < totalSlots; i++) {
            const colSpan = slotSpans[i];
            const rowSpan = slotRowSpans[i];
            let placed = false;

            if (stored && i < stored.length) {
              const row = Math.max(0, stored[i].row);
              const col = Math.max(0, Math.min(stored[i].col, gridColumns - colSpan));
              ensureRows(row + rowSpan - 1);
              let fitsStored = true;
              for (let dr = 0; dr < rowSpan && fitsStored; dr++) {
                for (let dc = 0; dc < colSpan && fitsStored; dc++) {
                  const rr = row + dr;
                  const cc = col + dc;
                  if (cc >= gridColumns || used[rr][cc]) fitsStored = false;
                }
              }
              if (fitsStored) {
                for (let dr = 0; dr < rowSpan; dr++) {
                  for (let dc = 0; dc < colSpan; dc++) {
                    used[row + dr][col + dc] = true;
                  }
                }
                placements.push({ row, col });
                placed = true;
              }
            }

            if (!placed) {
              const pos = tryFirstFitPlace(colSpan, rowSpan);
              if (pos) {
                placements.push(pos);
                didPack = true;
              } else {
                const row = used.length;
                const colStart = 0;
                ensureRows(row + rowSpan - 1);
                for (let dr = 0; dr < rowSpan; dr++) {
                  for (let dc = 0; dc < colSpan; dc++) {
                    used[row + dr][colStart + dc] = true;
                  }
                }
                placements.push({ row, col: colStart });
                didPack = true;
              }
            }
          }
          if (didPack) {
            needSavePlacementsRef.current = placements;
            try {
              localStorage.setItem(DASHBOARD_LOCKED_PLACEMENTS_KEY, JSON.stringify(placements));
            } catch {
              /* ignore quota */
            }
          }
          previousSlotSpansRef.current = slotSpans.map((cs, i) => ({ colSpan: cs, rowSpan: slotRowSpans[i] }));
          let totalRows = 0;
          for (let i = 0; i < totalSlots; i++) {
            totalRows = Math.max(totalRows, placements[i].row + slotRowSpans[i]);
          }
          const headerRow = 1;
          const contentStartRow = 2;
          const rowResizeRow = contentStartRow + totalRows;

          const cellToSlot: (number | undefined)[][] = [];
          for (let r = 0; r < totalRows; r++) {
            cellToSlot[r] = [];
            for (let c = 0; c < gridColumns; c++) cellToSlot[r][c] = undefined;
          }
          for (let i = 0; i < totalSlots; i++) {
            const { row, col } = placements[i];
            const rs = slotRowSpans[i];
            const cs = slotSpans[i];
            for (let dr = 0; dr < rs; dr++) {
              for (let dc = 0; dc < cs; dc++) {
                const rr = row + dr, cc = col + dc;
                if (rr < totalRows && cc < gridColumns) cellToSlot[rr][cc] = i;
              }
            }
          }

          const handleMove = (id: string, dir: MoveInLockedGridDir) => {
            const currentSlot = effectiveSlotAssignments.indexOf(id);
            if (currentSlot === -1) return;
            const { row, col } = placements[currentSlot];
            const myColSpan = slotSpans[currentSlot];
            const myRowSpan = slotRowSpans[currentSlot];
            let r2 = row;
            let c2 = col;
            if (dir === "up") r2 = row - 1;
            else if (dir === "down") r2 = row + myRowSpan;
            else if (dir === "left") c2 = col - 1;
            else c2 = col + myColSpan;
            if (r2 < 0 || r2 >= totalRows || c2 < 0 || c2 >= gridColumns) return;
            const targetSlot = cellToSlot[r2]?.[c2];
            if (targetSlot === undefined || targetSlot === currentSlot) return;
            const newSlots = [...effectiveSlotAssignments];
            newSlots[currentSlot] = effectiveSlotAssignments[targetSlot] ?? null;
            newSlots[targetSlot] = id;
            const maxFilledIndex = newSlots.reduce((max, sid, i) => (sid != null ? i : max), -1);
            const minTotalSlots = maxFilledIndex + 1 + 3 * gridColumns;
            const finalSlots = newSlots.length < minTotalSlots
              ? [...newSlots, ...Array(minTotalSlots - newSlots.length).fill(null)]
              : newSlots;
            setLockedSlotAssignments(finalSlots);
            const newOrder = finalSlots.filter((sid): sid is string => sid != null);
            if (!splitGrid) {
              setMergedDisplayOrder(newOrder);
              localStorage.setItem(DASHBOARD_DISPLAY_ORDER_KEY, JSON.stringify(newOrder));
              setMetricCardOrder((prev) => {
                const metricIds = newOrder.filter((sid) => !isSectionId(sid));
                const kept = prev.filter((sid) => !newOrder.includes(sid) && !isSectionId(sid));
                const finalOrder = [...metricIds, ...kept];
                localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(finalOrder));
                return finalOrder;
              });
              setSectionOrder((prev) => {
                const sectionIds = newOrder.filter((sid) => isSectionId(sid));
                const kept = prev.filter((sid) => !newOrder.includes(sid));
                const finalOrder = [...sectionIds, ...kept];
                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(finalOrder));
                return finalOrder;
              });
            } else {
              setMetricCardOrder((prev) => {
                const kept = prev.filter((sid) => !newOrder.includes(sid) && !isSectionId(sid));
                const finalOrder = [...newOrder, ...kept];
                localStorage.setItem(METRIC_CARDS_ORDER_KEY, JSON.stringify(finalOrder));
                return finalOrder;
              });
            }
            setMetricInstances((prev) =>
              prev.map((inst) => ({
                ...inst,
                slotIndex: finalSlots.indexOf(inst.instanceId) >= 0 ? finalSlots.indexOf(inst.instanceId) : inst.slotIndex,
              }))
            );
          };

          moveInLockedGridRef.current = handleMove;

          const handleColumnResize = (colIndex: number, e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const gridEl = lockedGridRef.current;
            if (!gridEl) return;
            const startWidths = [...columnWidths];
            const onMove = (e2: MouseEvent) => {
              const delta = e2.clientX - startX;
              const gridWidth = gridEl.clientWidth - metricsGridGapPx * (gridColumns - 1);
              if (gridWidth <= 0) return;
              const totalFr = startWidths.reduce((a, b) => a + b, 0);
              const scale = totalFr / gridWidth;
              const deltaFr = delta * scale;
              const leftFr = Math.max(MIN_COLUMN_FR, startWidths[colIndex] + deltaFr);
              const rightFr = Math.max(MIN_COLUMN_FR, startWidths[colIndex + 1] - deltaFr);
              setLockedColumnWidths((prev) => {
                const next = [...prev];
                next[colIndex] = leftFr;
                next[colIndex + 1] = rightFr;
                return next;
              });
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          };

          const handleRowHeightResize = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const startY = e.clientY;
            const startH = lockedRowHeight;
            const onMove = (e2: MouseEvent) => {
              const delta = e2.clientY - startY;
              const newH = Math.min(MAX_ROW_HEIGHT_PX, Math.max(MIN_ROW_HEIGHT_PX, startH + delta));
              setLockedRowHeight(newH);
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          };

          const sortableIds = effectiveSlotAssignments.filter((id): id is string => id != null);
          return (
            <DndContext
              key={dndResetKey}
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={sortableIds}
                strategy={rectSortingStrategy}
              >
                <div style={{ width: "100%", minWidth: 0 }}>
                <div
                  ref={lockedGridRef}
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridTemplateCols,
                    gridTemplateRows: `6px repeat(${totalRows}, ${lockedRowHeight}px) 6px`,
                    gap: `${metricsGridGapPx}px`,
                    marginBottom: `${Math.max(0, metricsToSectionsGapPx - 6)}px`,
                    alignItems: "stretch",
                    backgroundColor: "var(--bg-primary)",
                    boxSizing: "border-box",
                    width: "100%",
                    minWidth: 0,
                  }}
                >
                  {columnWidths.map((_, ci) => (
                    <div
                      key={`col-resize-${ci}`}
                      style={{
                        gridRow: headerRow,
                        gridColumn: ci + 1,
                        position: "relative",
                        minHeight: 0,
                      }}
                    >
                      {ci < gridColumns - 1 && (
                        <div
                          role="separator"
                          aria-label="Resize column"
                          onMouseDown={(e) => handleColumnResize(ci, e)}
                          style={{
                            position: "absolute",
                            right: -metricsGridGapPx / 2 - 4,
                            top: 0,
                            bottom: 0,
                            width: 8,
                            cursor: "col-resize",
                            zIndex: 2,
                            background: "transparent",
                          }}
                        />
                      )}
                    </div>
                  ))}
                  {Array.from({ length: totalSlots }, (_, i) => {
                    const id = effectiveSlotAssignments[i] ?? null;
                    const span = slotSpans[i];
                    const rowSpan = slotRowSpans[i];
                    const { row, col } = placements[i];
                    const slotStyle: React.CSSProperties = {
                      gridRow: `${contentStartRow + row} / span ${rowSpan}`,
                      gridColumn: `${col + 1} / span ${span}`,
                    };
                    return (
                      <DroppableSlot key={i} id={`metric-slot-${i}`} style={slotStyle} fillCell>
                        {id ? (isSectionId(id) ? (renderSectionCardRef.current ? renderSectionCardRef.current(id) : null) : (() => {
                          const metric = sortedMetrics.find((m) => m.id === id);
                          return metric ? renderCard(metric) : null;
                        })()) : null}
                      </DroppableSlot>
                    );
                  })}
                  {Array.from({ length: totalRows }, (_, r) =>
                    Array.from({ length: gridColumns }, (_, c) => {
                      if (cellToSlot[r]?.[c] !== undefined) return null;
                      const gapSlotStyle: React.CSSProperties = {
                        gridRow: `${contentStartRow + r} / span 1`,
                        gridColumn: `${c + 1} / span 1`,
                      };
                      return (
                        <DroppableSlot key={`gap-${r}-${c}`} id={`metric-slot-gap-${r}-${c}`} style={gapSlotStyle} fillCell>
                          {null}
                        </DroppableSlot>
                      );
                    })
                  ).flat()}
                  <div
                    role="separator"
                    aria-label="Resize row height"
                    onMouseDown={handleRowHeightResize}
                    style={{
                      gridRow: rowResizeRow,
                      gridColumn: "1 / -1",
                      cursor: "ns-resize",
                      zIndex: 2,
                      background: "transparent",
                    }}
                  />
                </div>
                </div>
              </SortableContext>
            </DndContext>
          );
        }

        return (
      <DndContext
        key={dndResetKey}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={order}
          strategy={rectSortingStrategy}
        >
      <div style={{ width: "100%", minWidth: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: useFluidGrid ? "repeat(auto-fit, minmax(260px, 1fr))" : `repeat(${gridColumns}, 1fr)`,
          width: "100%",
          minWidth: 0,
          gap: `${metricsGridGapPx}px`,
          marginBottom: `${metricsToSectionsGapPx}px`,
          alignItems: "stretch",
          backgroundColor: "var(--bg-primary)",
          boxSizing: "border-box",
        }}
      >
        {order.map((id) => {
          if (isSectionId(id)) {
            const rendered = renderSectionCardRef.current ? renderSectionCardRef.current(id) : null;
            return rendered;
          }
          const metric = sortedMetrics.find((m) => m.id === id);
          return metric ? renderCard(metric) : null;
        })}
      </div>
      </div>
        </SortableContext>
      </DndContext>
        );
      })(
        splitGrid ? sortedMetrics.map((m) => m.id) : displayOrder,
        splitGrid ? (e: DragEndEvent) => handleDragEndMetricsOnly(e, sortedMetrics.map((m) => m.id)) : handleDragEnd
      )}
      </div>

      <div
        style={{
          ...(splitGrid
            ? {
                order: sectionsOnTop ? 0 : 2,
                ...(sectionsOnTop ? { marginBottom: metricsToSectionsGapPx } : { marginTop: metricsToSectionsGapPx }),
              }
            : {
                position: "absolute",
                left: -9999,
                width: 1,
                height: 1,
                overflow: "hidden",
                visibility: "hidden",
                pointerEvents: "none",
                zIndex: -1,
              }),
        }}
      >
      {/* Section card renderer: when split, visible above/below metrics; when unified, hidden so renderSectionCardRef is set. */}
      <DndContext
        key={dndResetKey}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSectionDragEnd}
      >
        <SortableContext
          items={sectionOrder}
          strategy={rectSortingStrategy}
        >
      <div
        style={{
          display: "grid",
          gridTemplateRows: layoutLocked ? "auto minmax(140px, 1fr)" : "auto",
          gap: `${sectionsGridGapPx}px`,
          marginBottom: `${sectionsGridMarginBottomPx}px`,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: layoutLocked
              ? `repeat(3, 1fr)`
              : `repeat(auto-fit, minmax(${sectionsGridMinWidthPx}px, 1fr))`,
            gap: `${sectionsGridGapPx}px`,
            minHeight: 0,
            minWidth: 0,
          }}
        >
        {(() => {
          const renderOne = (sectionId: SectionId): React.ReactNode => {
          // Top Symbols
          if (sectionId === "topSymbols" && dashboardSections.showTopSymbols && topSymbols.length > 0) {
            const topSymbolsSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, sectionSizes.topSymbols?.columnSpan ?? 1));
            return (
              <SortableSection
                key="topSymbols"
                id="topSymbols"
                wrapperStyle={{
                  minWidth: 0,
                  maxWidth: "100%",
                  width: "100%",
                  overflow: layoutLocked ? "visible" : "hidden",
                  boxSizing: "border-box",
                  ...(topSymbolsSpan > 1 ? { gridColumn: `span ${topSymbolsSpan}` as const } : {}),
                  ...(sectionSizes.topSymbols?.height != null ? { minHeight: `${sectionSizes.topSymbols.height}px` } : {}),
                }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <SectionCardResizeWrapper sectionId="topSymbols" sectionSizes={sectionSizes} setSectionSizes={setSectionSizes} layoutLocked={layoutLocked} lockedRowHeight={lockedRowHeight}>
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      height: "100%",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                  <BarChart3 size={20} color="var(--accent)" />
                  <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Top Symbols</h2>
                  </div>
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                  e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSectionMenuPosition({
                          ...sectionMenuPosition,
                          topSymbols: {
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          },
                        });
                        setOpenSectionSettings(openSectionSettings === "topSymbols" ? null : "topSymbols");
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: "4px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "4px",
                      }}
                      title="Settings"
                    >
                      <Settings size={16} />
                    </button>
                    {openSectionSettings === "topSymbols" && createPortal(
                      <div
                        data-settings-menu
                        style={{
                          position: "fixed",
                          top: `${sectionMenuPosition.topSymbols.top}px`,
                          right: `${sectionMenuPosition.topSymbols.right}px`,
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "8px",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                          zIndex: 99999,
                          minWidth: "120px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          {layoutLocked && moveInLockedGridRef?.current ? (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("topSymbols", "up"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronUp size={14} /><span>Move up</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("topSymbols", "down"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronDown size={14} /><span>Move down</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("topSymbols", "left"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronLeft size={14} /><span>Move left</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("topSymbols", "right"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronRight size={14} /><span>Move right</span></button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const currentIndex = sectionOrder.indexOf("topSymbols");
                                  if (currentIndex > 0) {
                                    const newOrder = [...sectionOrder];
                                    [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                                    setSectionOrder(newOrder);
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                  }
                                  setOpenSectionSettings(null);
                                }}
                                disabled={sectionOrder.indexOf("topSymbols") === 0}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("topSymbols") === 0 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("topSymbols") === 0 ? 0.3 : 1 }}
                              >
                                <ChevronUp size={14} />
                                <span>Move Up</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const currentIndex = sectionOrder.indexOf("topSymbols");
                                  if (currentIndex < sectionOrder.length - 1) {
                                    const newOrder = [...sectionOrder];
                                    [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                    setSectionOrder(newOrder);
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                  }
                                  setOpenSectionSettings(null);
                                }}
                                disabled={sectionOrder.indexOf("topSymbols") === sectionOrder.length - 1}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("topSymbols") === sectionOrder.length - 1 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("topSymbols") === sectionOrder.length - 1 ? 0.3 : 1 }}
                              >
                                <ChevronDown size={14} />
                                <span>Move Down</span>
                              </button>
                            </>
                          )}
                          <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setSectionSizes((prev) => {
                                const next = { ...prev, topSymbols: {} };
                                localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
                                return next;
                              });
                              setOpenSectionSettings(null);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                            }}
                          >
                            <RotateCcw size={14} />
                            <span>Reset size</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setDashboardSections((prev) => {
                                const next = { ...prev, showTopSymbols: false };
                                localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify(next));
                                return next;
                              });
                              setSectionOrder((prev) => {
                                const newOrder = prev.filter((id) => id !== "topSymbols");
                                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                return newOrder;
                              });
                              setOpenSectionSettings(null);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: "pointer",
                              color: "var(--loss)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                            }}
                          >
                            <Trash2 size={14} />
                            <span>Remove</span>
                          </button>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, minHeight: 0, overflow: "auto" }}>
                  {topSymbols.map((symbol) => (
                    <div
                      key={symbol.symbol}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "12px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "6px",
                      }}
                    >
                      <div>
                        <p style={{ fontWeight: "600", marginBottom: "4px" }}>{symbol.symbol}</p>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {symbol.trade_count} trades
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p
                          style={{
                            fontWeight: "600",
                            color: symbol.estimated_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                          }}
                        >
                          ${formatWithCommas(symbol.estimated_pnl, { decimals: 2 })}
                        </p>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {formatWithCommas(symbol.trade_count)} {symbol.trade_count === 1 ? "trade" : "trades"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
                  </SectionCardResizeWrapper>
                )}
              </SortableSection>
            );
          }

          // Strategy Performance
          if (sectionId === "strategyPerformance" && dashboardSections.showStrategyPerformance && strategyPerformance.length > 0) {
            const stratSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, sectionSizes.strategyPerformance?.columnSpan ?? 1));
            return (
              <SortableSection
                key="strategyPerformance"
                id="strategyPerformance"
                wrapperStyle={{
                  minWidth: 0,
                  maxWidth: "100%",
                  width: "100%",
                  overflow: layoutLocked ? "visible" : "hidden",
                  boxSizing: "border-box",
                  ...(stratSpan > 1 ? { gridColumn: `span ${stratSpan}` as const } : {}),
                  ...(sectionSizes.strategyPerformance?.height != null ? { minHeight: `${sectionSizes.strategyPerformance.height}px` } : {}),
                }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <SectionCardResizeWrapper sectionId="strategyPerformance" sectionSizes={sectionSizes} setSectionSizes={setSectionSizes} layoutLocked={layoutLocked} lockedRowHeight={lockedRowHeight}>
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      height: "100%",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                  <TrendingUpIcon size={20} color="var(--accent)" />
                  <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Strategy Performance</h2>
                  </div>
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                  e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSectionMenuPosition({
                          ...sectionMenuPosition,
                          strategyPerformance: {
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          },
                        });
                        setOpenSectionSettings(openSectionSettings === "strategyPerformance" ? null : "strategyPerformance");
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: "4px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "4px",
                      }}
                      title="Settings"
                    >
                      <Settings size={16} />
                    </button>
                    {openSectionSettings === "strategyPerformance" && createPortal(
                      <div
                        data-settings-menu
                        style={{
                          position: "fixed",
                          top: `${sectionMenuPosition.strategyPerformance.top}px`,
                          right: `${sectionMenuPosition.strategyPerformance.right}px`,
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "8px",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                          zIndex: 99999,
                          minWidth: "120px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          {layoutLocked && moveInLockedGridRef?.current ? (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("strategyPerformance", "up"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronUp size={14} /><span>Move up</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("strategyPerformance", "down"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronDown size={14} /><span>Move down</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("strategyPerformance", "left"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronLeft size={14} /><span>Move left</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("strategyPerformance", "right"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronRight size={14} /><span>Move right</span></button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const currentIndex = sectionOrder.indexOf("strategyPerformance");
                                  if (currentIndex > 0) {
                                    const newOrder = [...sectionOrder];
                                    [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                                    setSectionOrder(newOrder);
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                  }
                                  setOpenSectionSettings(null);
                                }}
                                disabled={sectionOrder.indexOf("strategyPerformance") === 0}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("strategyPerformance") === 0 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("strategyPerformance") === 0 ? 0.3 : 1 }}
                              >
                                <ChevronUp size={14} />
                                <span>Move Up</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const currentIndex = sectionOrder.indexOf("strategyPerformance");
                                  if (currentIndex < sectionOrder.length - 1) {
                                    const newOrder = [...sectionOrder];
                                    [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                    setSectionOrder(newOrder);
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                  }
                                  setOpenSectionSettings(null);
                                }}
                                disabled={sectionOrder.indexOf("strategyPerformance") === sectionOrder.length - 1}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("strategyPerformance") === sectionOrder.length - 1 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("strategyPerformance") === sectionOrder.length - 1 ? 0.3 : 1 }}
                              >
                                <ChevronDown size={14} />
                                <span>Move Down</span>
                              </button>
                            </>
                          )}
                          <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setSectionSizes((prev) => {
                                const next = { ...prev, strategyPerformance: {} };
                                localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
                                return next;
                              });
                              setOpenSectionSettings(null);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                            }}
                          >
                            <RotateCcw size={14} />
                            <span>Reset size</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setDashboardSections((prev) => {
                                const next = { ...prev, showStrategyPerformance: false };
                                localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify(next));
                                return next;
                              });
                              setSectionOrder((prev) => {
                                const newOrder = prev.filter((id) => id !== "strategyPerformance");
                                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                return newOrder;
                              });
                              setOpenSectionSettings(null);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: "pointer",
                              color: "var(--loss)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                            }}
                          >
                            <Trash2 size={14} />
                            <span>Remove</span>
                          </button>
                          <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                          <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                            <label style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                              Positions per page:
                            </label>
                            <input
                              type="number"
                              min="5"
                              max="100"
                              step="5"
                              value={strategyPairsPerPage}
                              onChange={(e) => {
                                const value = Math.max(5, Math.min(100, parseInt(e.target.value) || 20));
                                setStrategyPairsPerPage(value);
                                localStorage.setItem("tradebutler_strategy_pairs_per_page", value.toString());
                                // Reset all strategy pages to 1 when changing page size
                                setStrategyCurrentPages(new Map());
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                padding: "6px 8px",
                                backgroundColor: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                fontSize: "13px",
                                width: "100%",
                              }}
                            />
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, minHeight: 0, overflow: "auto" }}>
              {strategyPerformance.map((strategy) => {
                const strategyKey = strategy.strategy_id ?? "unassigned";
                const isExpanded = expandedStrategies.has(strategyKey);
                const pairs = strategyPairs.get(strategyKey) || [];
                const isLoading = loadingStrategyPairs.has(strategyKey);
                
                // Calculate statistics from pairs (use pairs if loaded, otherwise use strategy data)
                const totalTrades = pairs.length > 0 ? pairs.length : strategy.trade_count;
                const totalPnL = pairs.length > 0 
                  ? pairs.reduce((sum, pair) => sum + pair.net_profit_loss, 0)
                  : strategy.estimated_pnl;
                const winningTrades = pairs.filter(pair => pair.net_profit_loss > 0).length;
                const winPercentage = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
                
                return (
                <div
                    key={strategyKey}
                    style={{
                      backgroundColor: "var(--bg-tertiary)",
                      borderRadius: "6px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      onClick={async () => {
                        const newExpanded = new Set(expandedStrategies);
                        if (newExpanded.has(strategyKey)) {
                          newExpanded.delete(strategyKey);
                        } else {
                          newExpanded.add(strategyKey);
                          // Reset to page 1 when expanding
                          const newPages = new Map(strategyCurrentPages);
                          newPages.set(strategyKey, 1);
                          setStrategyCurrentPages(newPages);
                          // Load pairs if not already loaded
                          if (!strategyPairs.has(strategyKey)) {
                            setLoadingStrategyPairs(new Set([...loadingStrategyPairs, strategyKey]));
                            try {
                              const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
                              const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
                              const startDate = dateRange.start ? dateRange.start.toISOString() : null;
                              const endDate = dateRange.end ? dateRange.end.toISOString() : null;
                              const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
                              const loadedPairs = await invoke<PairedTrade[]>("get_paired_trades_by_strategy", {
                                strategyId: strategy.strategy_id,
                                pairingMethod: pairingMethod,
                                startDate: startDate,
                                endDate: endDate,
                                ...paperArgs,
                              });
                              setStrategyPairs(new Map(strategyPairs.set(strategyKey, loadedPairs)));
                            } catch (error) {
                              console.error("Error loading strategy pairs:", error);
                            } finally {
                              const newLoading = new Set(loadingStrategyPairs);
                              newLoading.delete(strategyKey);
                              setLoadingStrategyPairs(newLoading);
                            }
                          }
                        }
                        setExpandedStrategies(newExpanded);
                      }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px",
                        cursor: "pointer",
                  }}
                >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: "600", marginBottom: "4px" }}>{strategy.strategy_name}</p>
                    {!isExpanded && (
                      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {formatWithCommas(totalTrades)} trades
                    </p>
                        <p style={{ 
                          fontSize: "12px", 
                          color: totalPnL >= 0 ? "var(--profit)" : "var(--loss)",
                          fontWeight: "500"
                        }}>
                          ${totalPnL >= 0 ? "+" : ""}{formatWithCommas(totalPnL, { decimals: 2 })} P&L
                        </p>
                        {pairs.length > 0 && (
                          <p style={{ 
                            fontSize: "12px", 
                            color: winPercentage >= 50 ? "var(--profit)" : winPercentage > 0 ? "var(--text-secondary)" : "var(--loss)",
                            fontWeight: "500"
                          }}>
                            {formatWithCommas(winPercentage, { decimals: 1 })}% win
                          </p>
                        )}
                      </div>
                    )}
                        </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p
                      style={{
                        fontWeight: "600",
                        color: totalPnL >= 0 ? "var(--profit)" : "var(--loss)",
                      }}
                    >
                      ${formatWithCommas(totalPnL, { decimals: 2 })}
                    </p>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {formatCompactNumber(strategy.total_volume, { prefix: "$" })} vol
                    </p>
                  </div>
                </div>
                    {isExpanded && (
                      <div
                        style={{
                          borderTop: "1px solid var(--border-color)",
                          padding: "16px",
                          backgroundColor: "var(--bg-secondary)",
                        }}
                      >
                        {isLoading ? (
                          <p style={{ color: "var(--text-secondary)", textAlign: "center" }}>Loading positions...</p>
                        ) : pairs.length === 0 ? (
                          <p style={{ color: "var(--text-secondary)", textAlign: "center" }}>No positions found for this strategy.</p>
                        ) : (() => {
                          // Calculate pagination
                          const currentPage = strategyCurrentPages.get(strategyKey) || 1;
                          const totalPages = Math.ceil(pairs.length / strategyPairsPerPage);
                          const startIndex = (currentPage - 1) * strategyPairsPerPage;
                          const endIndex = startIndex + strategyPairsPerPage;
                          const paginatedPairs = pairs.slice(startIndex, endIndex);
                          
                          return (
                            <>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                        Symbol
                                      </th>
                                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                        Entry Date
                                      </th>
                                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                        Exit Date
                                      </th>
                                      <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                        Quantity
                                      </th>
                                      <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                        Entry Price
                                      </th>
                                      <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                        Exit Price
                                      </th>
                                      <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                        P&L
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {paginatedPairs.map((pair, idx) => (
                                      <tr key={`${pair.entry_trade_id}-${pair.exit_trade_id}-${idx}`} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                        <td style={{ padding: "12px", fontSize: "14px" }}>{pair.symbol}</td>
                                        <td style={{ padding: "12px", fontSize: "14px" }}>
                                          {format(new Date(pair.entry_timestamp), "MMM dd, yyyy HH:mm")}
                                        </td>
                                        <td style={{ padding: "12px", fontSize: "14px" }}>
                                          {format(new Date(pair.exit_timestamp), "MMM dd, yyyy HH:mm")}
                                        </td>
                                        <td style={{ padding: "12px", fontSize: "14px", textAlign: "right" }}>
                                          {formatWithCommas(pair.quantity, { minDecimals: 4, maxDecimals: 4 })}
                                        </td>
                                        <td style={{ padding: "12px", fontSize: "14px", textAlign: "right" }}>
                                          ${formatWithCommas(pair.entry_price, { decimals: 2 })}
                                        </td>
                                        <td style={{ padding: "12px", fontSize: "14px", textAlign: "right" }}>
                                          ${formatWithCommas(pair.exit_price, { decimals: 2 })}
                                        </td>
                                        <td
                                          style={{
                                            padding: "12px",
                                            fontSize: "14px",
                                            textAlign: "right",
                                            fontWeight: "600",
                                            color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                                          }}
                                        >
                                          ${formatWithCommas(pair.net_profit_loss, { decimals: 2 })}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
              </div>
                              {totalPages > 1 && (
                                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newPages = new Map(strategyCurrentPages);
                                      newPages.set(strategyKey, Math.max(1, currentPage - 1));
                                      setStrategyCurrentPages(newPages);
                                    }}
                                    disabled={currentPage === 1}
                                    style={{
                                      padding: "6px 12px",
                                      backgroundColor: currentPage === 1 ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "4px",
                                      color: "var(--text-primary)",
                                      cursor: currentPage === 1 ? "not-allowed" : "pointer",
                                      fontSize: "13px",
                                      opacity: currentPage === 1 ? 0.5 : 1,
                                    }}
                                  >
                                    Previous
                                  </button>
                                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                                    Page {currentPage} of {totalPages}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newPages = new Map(strategyCurrentPages);
                                      newPages.set(strategyKey, Math.min(totalPages, currentPage + 1));
                                      setStrategyCurrentPages(newPages);
                                    }}
                                    disabled={currentPage === totalPages}
                                    style={{
                                      padding: "6px 12px",
                                      backgroundColor: currentPage === totalPages ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "4px",
                                      color: "var(--text-primary)",
                                      cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                                      fontSize: "13px",
                                      opacity: currentPage === totalPages ? 0.5 : 1,
                                    }}
                                  >
                                    Next
                                  </button>
            </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
                  </div>
                  </SectionCardResizeWrapper>
                )}
              </SortableSection>
            );
          }

          // Recent Trades
          if (sectionId === "recentTrades" && dashboardSections.showRecentTrades && recentTrades.length > 0) {
            const recentSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, sectionSizes.recentTrades?.columnSpan ?? 1));
            return (
              <SortableSection
                key="recentTrades"
                id="recentTrades"
                wrapperStyle={{
                  minWidth: 0,
                  maxWidth: "100%",
                  width: "100%",
                  overflow: layoutLocked ? "visible" : "hidden",
                  boxSizing: "border-box",
                  ...(recentSpan > 1 ? { gridColumn: `span ${recentSpan}` as const } : {}),
                  ...(sectionSizes.recentTrades?.height != null ? { minHeight: `${sectionSizes.recentTrades.height}px` } : {}),
                }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <SectionCardResizeWrapper sectionId="recentTrades" sectionSizes={sectionSizes} setSectionSizes={setSectionSizes} layoutLocked={layoutLocked} lockedRowHeight={lockedRowHeight}>
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      minWidth: 0,
                      height: "100%",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                  <Clock size={20} color="var(--accent)" />
                  <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Recent Trades</h2>
                  </div>
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                  e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSectionMenuPosition({
                          ...sectionMenuPosition,
                          recentTrades: {
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          },
                        });
                        setOpenSectionSettings(openSectionSettings === "recentTrades" ? null : "recentTrades");
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: "4px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "4px",
                      }}
                      title="Settings"
                    >
                      <Settings size={16} />
                    </button>
                    {openSectionSettings === "recentTrades" && createPortal(
                      <div
                        data-settings-menu
                        style={{
                          position: "fixed",
                          top: `${sectionMenuPosition.recentTrades.top}px`,
                          right: `${sectionMenuPosition.recentTrades.right}px`,
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "8px",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                          zIndex: 99999,
                          minWidth: "120px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          {layoutLocked && moveInLockedGridRef?.current ? (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("recentTrades", "up"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronUp size={14} /><span>Move up</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("recentTrades", "down"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronDown size={14} /><span>Move down</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("recentTrades", "left"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronLeft size={14} /><span>Move left</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("recentTrades", "right"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronRight size={14} /><span>Move right</span></button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const currentIndex = sectionOrder.indexOf("recentTrades");
                                  if (currentIndex > 0) {
                                    const newOrder = [...sectionOrder];
                                    [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                                    setSectionOrder(newOrder);
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                  }
                                  setOpenSectionSettings(null);
                                }}
                                disabled={sectionOrder.indexOf("recentTrades") === 0}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("recentTrades") === 0 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("recentTrades") === 0 ? 0.3 : 1 }}
                              >
                                <ChevronUp size={14} />
                                <span>Move Up</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const currentIndex = sectionOrder.indexOf("recentTrades");
                                  if (currentIndex < sectionOrder.length - 1) {
                                    const newOrder = [...sectionOrder];
                                    [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                    setSectionOrder(newOrder);
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                  }
                                  setOpenSectionSettings(null);
                                }}
                                disabled={sectionOrder.indexOf("recentTrades") === sectionOrder.length - 1}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("recentTrades") === sectionOrder.length - 1 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("recentTrades") === sectionOrder.length - 1 ? 0.3 : 1 }}
                              >
                                <ChevronDown size={14} />
                                <span>Move Down</span>
                              </button>
                            </>
                          )}
                          <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setSectionSizes((prev) => {
                                const next = { ...prev, recentTrades: {} };
                                localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
                                return next;
                              });
                              setOpenSectionSettings(null);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                            }}
                          >
                            <RotateCcw size={14} />
                            <span>Reset size</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setDashboardSections((prev) => {
                                const next = { ...prev, showRecentTrades: false };
                                localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify(next));
                                return next;
                              });
                              setSectionOrder((prev) => {
                                const newOrder = prev.filter((id) => id !== "recentTrades");
                                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                return newOrder;
                              });
                              setOpenSectionSettings(null);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: "pointer",
                              color: "var(--loss)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                            }}
                          >
                            <Trash2 size={14} />
                            <span>Remove</span>
                          </button>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, minHeight: 0, minWidth: 0, overflowX: "hidden", overflowY: "auto" }}>
              {recentTrades.map((trade, idx) => {
                const isExpanded = expandedRecentTrades.has(idx);
                return (
                  <div key={`${trade.symbol}-${trade.exit_timestamp}-${idx}`}>
                    <div
                      onClick={() => {
                        const newExpanded = new Set(expandedRecentTrades);
                        if (isExpanded) {
                          newExpanded.delete(idx);
                        } else {
                          newExpanded.add(idx);
                        }
                        setExpandedRecentTrades(newExpanded);
                      }}
                      style={{
                        padding: "12px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <p style={{ fontWeight: "600" }}>{trade.symbol}</p>
                        <p
                          style={{
                            fontSize: "14px",
                            fontWeight: "600",
                            color: trade.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                          }}
                        >
                          {trade.net_profit_loss >= 0 ? "+" : ""}${formatWithCommas(trade.net_profit_loss, { decimals: 2 })}
                        </p>
                      </div>
                    </div>
                    {isExpanded && (
                      <div
                        style={{
                          padding: "12px",
                          paddingLeft: "36px",
                          backgroundColor: "var(--bg-primary)",
                          borderBottomLeftRadius: "6px",
                          borderBottomRightRadius: "6px",
                          marginTop: "4px",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Entry:</span>
                            <span style={{ color: "var(--text-primary)" }}>
                              {formatWithCommas(trade.quantity)} @ ${formatWithCommas(trade.entry_price, { decimals: 2 })}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Exit:</span>
                            <span style={{ color: "var(--text-primary)" }}>
                              {formatWithCommas(trade.quantity)} @ ${formatWithCommas(trade.exit_price, { decimals: 2 })}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Closed:</span>
                            <span style={{ color: "var(--text-secondary)" }}>
                              {format(new Date(trade.exit_timestamp), "MMM d, HH:mm")}
                            </span>
                          </div>
                        </div>
                        {trade.strategy_name && (
                          <p style={{ fontSize: "11px", color: "var(--accent)", marginTop: "8px" }}>
                            {trade.strategy_name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
                </div>
              </div>
                  </SectionCardResizeWrapper>
                )}
              </SortableSection>
            );
          }

          // Open Positions
          if (sectionId === "openPositions" && dashboardSections.showOpenPositions) {
            const defaultOpenSpan = openPositionsDisplayMode === "compact" ? 3 : 1;
            const openSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, sectionSizes.openPositions?.columnSpan ?? defaultOpenSpan));
            return (
              <SortableSection
                key="openPositions"
                id="openPositions"
                wrapperStyle={{
                  minWidth: 0,
                  maxWidth: "100%",
                  width: "100%",
                  overflow: layoutLocked ? "visible" : "hidden",
                  boxSizing: "border-box",
                  ...(openSpan > 1 ? { gridColumn: `span ${openSpan}` as const } : {}),
                  ...(sectionSizes.openPositions?.height != null ? { minHeight: `${sectionSizes.openPositions.height}px` } : {}),
                }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <SectionCardResizeWrapper sectionId="openPositions" sectionSizes={sectionSizes} setSectionSizes={setSectionSizes} layoutLocked={layoutLocked} lockedRowHeight={lockedRowHeight}>
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      minWidth: 0,
                      height: "100%",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                        <Activity size={20} color="var(--accent)" />
                        <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Open Positions</h2>
                      </div>
                      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "4px" }}>
                        {dataMode !== "sandbox" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              void fetchOpenPositionQuotes(true);
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            disabled={isRefreshingQuotes}
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "4px",
                              cursor: isRefreshingQuotes ? "not-allowed" : "pointer",
                              color: "var(--text-secondary)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: "4px",
                              opacity: isRefreshingQuotes ? 0.5 : 1,
                            }}
                            title={lastQuoteRefresh ? `Refresh prices (last: ${format(lastQuoteRefresh, "h:mm:ss a")})` : "Refresh prices"}
                          >
                            <RefreshCw size={16} style={{ animation: isRefreshingQuotes ? "spin 1s linear infinite" : "none" }} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setSectionMenuPosition({
                              ...sectionMenuPosition,
                              openPositions: {
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              },
                            });
                            setOpenSectionSettings(openSectionSettings === "openPositions" ? null : "openPositions");
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: "4px",
                            cursor: "pointer",
                            color: "var(--text-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "4px",
                          }}
                          title="Settings"
                        >
                          <Settings size={16} />
                        </button>
                        {openSectionSettings === "openPositions" && createPortal(
                          <div
                            data-settings-menu
                            style={{
                              position: "fixed",
                              top: `${sectionMenuPosition.openPositions.top}px`,
                              right: `${sectionMenuPosition.openPositions.right}px`,
                              backgroundColor: "var(--bg-secondary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "8px",
                              padding: "8px",
                              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                              zIndex: 99999,
                              minWidth: "120px",
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {layoutLocked && moveInLockedGridRef?.current ? (
                                <>
                                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("openPositions", "up"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronUp size={14} /><span>Move up</span></button>
                                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("openPositions", "down"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronDown size={14} /><span>Move down</span></button>
                                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("openPositions", "left"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronLeft size={14} /><span>Move left</span></button>
                                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("openPositions", "right"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronRight size={14} /><span>Move right</span></button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      const currentIndex = sectionOrder.indexOf("openPositions");
                                      if (currentIndex > 0) {
                                        const newOrder = [...sectionOrder];
                                        [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                                        setSectionOrder(newOrder);
                                        localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                      }
                                      setOpenSectionSettings(null);
                                    }}
                                    disabled={sectionOrder.indexOf("openPositions") === 0}
                                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("openPositions") === 0 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("openPositions") === 0 ? 0.3 : 1 }}
                                  >
                                    <ChevronUp size={14} />
                                    <span>Move Up</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      const currentIndex = sectionOrder.indexOf("openPositions");
                                      if (currentIndex < sectionOrder.length - 1) {
                                        const newOrder = [...sectionOrder];
                                        [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                        setSectionOrder(newOrder);
                                        localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                      }
                                      setOpenSectionSettings(null);
                                    }}
                                    disabled={sectionOrder.indexOf("openPositions") === sectionOrder.length - 1}
                                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("openPositions") === sectionOrder.length - 1 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("openPositions") === sectionOrder.length - 1 ? 0.3 : 1 }}
                                  >
                                    <ChevronDown size={14} />
                                    <span>Move Down</span>
                                  </button>
                                </>
                              )}
                              <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setSectionSizes((prev) => {
                                    const next = { ...prev, openPositions: {} };
                                    localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
                                    return next;
                                  });
                                  setOpenSectionSettings(null);
                                }}
                                style={{
                                  background: "transparent",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "4px",
                                  padding: "6px 8px",
                                  cursor: "pointer",
                                  color: "var(--text-primary)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  fontSize: "13px",
                                }}
                              >
                                <RotateCcw size={14} />
                                <span>Reset size</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setDashboardSections((prev) => {
                                    const next = { ...prev, showOpenPositions: false };
                                    localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify(next));
                                    return next;
                                  });
                                  setSectionOrder((prev) => {
                                    const newOrder = prev.filter((id) => id !== "openPositions");
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                    return newOrder;
                                  });
                                  setOpenSectionSettings(null);
                                }}
                                style={{
                                  background: "transparent",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "4px",
                                  padding: "6px 8px",
                                  cursor: "pointer",
                                  color: "var(--loss)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  fontSize: "13px",
                                }}
                              >
                                <Trash2 size={14} />
                                <span>Remove</span>
                              </button>
                              <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                              <div style={{ padding: "4px 0" }}>
                                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "6px", fontWeight: "600" }}>Display</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      setOpenPositionsDisplayMode("card");
                                      localStorage.setItem(OPEN_POSITIONS_DISPLAY_MODE_KEY, "card");
                                      setOpenSectionSettings(null);
                                    }}
                                    style={{
                                      background: openPositionsDisplayMode === "card" ? "var(--accent)" : "transparent",
                                      color: openPositionsDisplayMode === "card" ? "var(--bg-primary)" : "var(--text-primary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "4px",
                                      padding: "6px 8px",
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      fontSize: "13px",
                                    }}
                                  >
                                    <span>Card</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      setOpenPositionsDisplayMode("compact");
                                      localStorage.setItem(OPEN_POSITIONS_DISPLAY_MODE_KEY, "compact");
                                      setOpenSectionSettings(null);
                                    }}
                                    style={{
                                      background: openPositionsDisplayMode === "compact" ? "var(--accent)" : "transparent",
                                      color: openPositionsDisplayMode === "compact" ? "var(--bg-primary)" : "var(--text-primary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "4px",
                                      padding: "6px 8px",
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      fontSize: "13px",
                                    }}
                                  >
                                    <span>Compact (Webull-style)</span>
                                  </button>
                                </div>
                              </div>
                              {dataMode !== "sandbox" && (
                                <>
                                  <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                                  <div style={{ padding: "4px 0" }}>
                                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "6px", fontWeight: "600" }}>Auto-Refresh Prices</div>
                                    {currentPriceSync.enabled ? (
                                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                                        Live quotes sync is on in Dashboard configure — open position prices refresh with Current Price cards every{" "}
                                        {currentPriceSync.seconds}s.
                                      </div>
                                    ) : (
                                    <select
                                      value={openPositionsRefreshInterval}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        const val = parseInt(e.target.value, 10);
                                        setOpenPositionsRefreshInterval(val);
                                        localStorage.setItem(OPEN_POSITIONS_REFRESH_INTERVAL_KEY, String(val));
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      style={{
                                        width: "100%",
                                        padding: "6px 8px",
                                        fontSize: "13px",
                                        background: "var(--bg-tertiary)",
                                        border: "1px solid var(--border-color)",
                                        borderRadius: "4px",
                                        color: "var(--text-primary)",
                                        cursor: "pointer",
                                        outline: "none",
                                      }}
                                    >
                                      <option value={0} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>Manual</option>
                                      <option value={1} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>1 min</option>
                                      <option value={2} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>2 min</option>
                                      <option value={3} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>3 min</option>
                                      <option value={5} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>5 min</option>
                                      <option value={10} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>10 min</option>
                                      <option value={15} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>15 min</option>
                                      <option value={30} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>30 min</option>
                                      <option value={60} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>60 min</option>
                                    </select>
                                    )}
                                    {lastQuoteRefresh && (
                                      <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
                                        Last refresh: {format(lastQuoteRefresh, "h:mm:ss a")}
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>,
                          document.body
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, minHeight: 0, minWidth: 0, overflowX: "hidden", overflowY: "auto" }}>
                      {openPositionGroups.length === 0 ? (
                        <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "20px" }}>
                          No open positions. Positions are derived from imported trades that are not fully closed.
                        </p>
                      ) : openPositionsDisplayMode === "compact" ? (
                        <div style={{ overflowX: "auto", overflowY: "hidden", minWidth: 0, width: "100%", maxWidth: "100%" }}>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(60px, 1fr) minmax(50px, auto) minmax(56px, auto) minmax(70px, auto) minmax(70px, auto) minmax(80px, auto) minmax(56px, auto) minmax(80px, auto) minmax(72px, auto) minmax(48px, auto)",
                              gap: "0 12px",
                              alignItems: "center",
                              fontSize: "12px",
                              borderBottom: "1px solid var(--border-color)",
                              padding: "8px 12px",
                              color: "var(--text-secondary)",
                              fontWeight: "600",
                              minWidth: "min-content",
                            }}
                          >
                            <span>Symbol</span>
                            <span>Side</span>
                            <span>Qty</span>
                            <span>Avg</span>
                            <span>Current</span>
                            <span>Unrealized</span>
                            <span>%</span>
                            <span>Realized</span>
                            <span>Entry</span>
                            <span>#</span>
                          </div>
                          {openPositionGroups.map((group) => {
                            const isLong = group.final_quantity > 0;
                            const qty = Math.abs(group.final_quantity);
                            const qtyDisplay = (isLong ? "+" : "") + formatWithCommas(group.final_quantity, { minDecimals: 4, maxDecimals: 4 });
                            const costFromTrades = group.position_trades.reduce((sum, t) => {
                              const side = t.side?.toUpperCase() || "";
                              if (side === "BUY") return sum + t.quantity * t.price;
                              if (side === "SELL") return sum - t.quantity * t.price;
                              return sum;
                            }, 0);
                            const avgPrice = qty >= 0.0001 ? Math.abs(costFromTrades) / qty : 0;
                            const currentPrice = openPositionQuotes[group.entry_trade.symbol] ?? null;
                            const unrealizedPnl =
                              currentPrice != null && currentPrice > 0
                                ? isLong
                                  ? (currentPrice - avgPrice) * qty
                                  : (avgPrice - currentPrice) * qty
                                : null;
                            const unrealizedPct =
                              currentPrice != null && currentPrice > 0 && avgPrice > 0
                                ? isLong
                                  ? ((currentPrice - avgPrice) / avgPrice) * 100
                                  : ((avgPrice - currentPrice) / avgPrice) * 100
                                : null;
                            return (
                              <div
                                key={group.entry_trade.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  navigate("/trades", { state: { expandPositionEntryId: group.entry_trade.id, viewMode: "Position" } });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    navigate("/trades", { state: { expandPositionEntryId: group.entry_trade.id, viewMode: "Position" } });
                                  }
                                }}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "minmax(60px, 1fr) minmax(50px, auto) minmax(56px, auto) minmax(70px, auto) minmax(70px, auto) minmax(80px, auto) minmax(56px, auto) minmax(80px, auto) minmax(72px, auto) minmax(48px, auto)",
                                  gap: "0 12px",
                                  alignItems: "center",
                                  padding: "8px 12px",
                                  fontSize: "12px",
                                  borderBottom: "1px solid var(--border-color)",
                                  cursor: "pointer",
                                  backgroundColor: "var(--bg-tertiary)",
                                }}
                              >
                                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                  <span style={{ fontWeight: "600", color: "var(--text-primary)" }}>{group.entry_trade.symbol}</span>
                                  <ViewFinancialsButton symbol={group.entry_trade.symbol} size={12} />
                                </span>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    fontWeight: "600",
                                    color: isLong ? "var(--profit)" : "var(--loss)",
                                  }}
                                >
                                  {isLong ? "Long" : "Short"}
                                </span>
                                <span style={{ color: "var(--text-primary)" }}>{qtyDisplay}</span>
                                <span style={{ color: "var(--text-primary)" }}>${formatWithCommas(avgPrice, { decimals: 2 })}</span>
                                <span style={{ color: "var(--text-primary)" }}>
                                  {currentPrice != null && currentPrice > 0 ? `$${formatWithCommas(currentPrice, { decimals: 2 })}` : "—"}
                                </span>
                                <span
                                  style={{
                                    fontWeight: "600",
                                    color: unrealizedPnl != null ? (unrealizedPnl >= 0 ? "var(--profit)" : "var(--loss)") : "var(--text-secondary)",
                                  }}
                                >
                                  {unrealizedPnl != null ? (unrealizedPnl >= 0 ? "+" : "") + `$${formatWithCommas(unrealizedPnl, { decimals: 2 })}` : "—"}
                                </span>
                                <span
                                  style={{
                                    fontWeight: "600",
                                    color: unrealizedPct != null ? (unrealizedPct >= 0 ? "var(--profit)" : "var(--loss)") : "var(--text-secondary)",
                                  }}
                                >
                                  {unrealizedPct != null ? (unrealizedPct >= 0 ? "+" : "") + `${unrealizedPct.toFixed(2)}%` : "—"}
                                </span>
                                <span
                                  style={{
                                    fontWeight: "500",
                                    color: group.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                                  }}
                                >
                                  {group.total_pnl >= 0 ? "+" : ""}${formatWithCommas(group.total_pnl, { decimals: 2 })}
                                </span>
                                <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
                                  {format(new Date(group.entry_trade.timestamp), "MMM d")}
                                </span>
                                <span style={{ color: "var(--text-primary)" }}>{group.position_trades.length}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        openPositionGroups.map((group) => {
                          const isLong = group.final_quantity > 0;
                          const qty = Math.abs(group.final_quantity);
                          const qtyDisplay = (isLong ? "+" : "") + formatWithCommas(group.final_quantity, { minDecimals: 4, maxDecimals: 4 });
                          const costFromTrades = group.position_trades.reduce((sum, t) => {
                            const side = t.side?.toUpperCase() || "";
                            if (side === "BUY") return sum + t.quantity * t.price;
                            if (side === "SELL") return sum - t.quantity * t.price;
                            return sum;
                          }, 0);
                          const avgPrice = qty >= 0.0001 ? Math.abs(costFromTrades) / qty : 0;
                          const currentPrice = openPositionQuotes[group.entry_trade.symbol] ?? null;
                          const unrealizedPnl =
                            currentPrice != null && currentPrice > 0
                              ? isLong
                                ? (currentPrice - avgPrice) * qty
                                : (avgPrice - currentPrice) * qty
                              : null;
                          const unrealizedPct =
                            currentPrice != null && currentPrice > 0 && avgPrice > 0
                              ? isLong
                                ? ((currentPrice - avgPrice) / avgPrice) * 100
                                : ((avgPrice - currentPrice) / avgPrice) * 100
                              : null;
                          return (
                            <div
                              key={group.entry_trade.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                navigate("/trades", { state: { expandPositionEntryId: group.entry_trade.id, viewMode: "Position" } });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigate("/trades", { state: { expandPositionEntryId: group.entry_trade.id, viewMode: "Position" } });
                                }
                              }}
                              style={{
                                padding: "12px",
                                backgroundColor: "var(--bg-tertiary)",
                                borderRadius: "6px",
                                border: "1px solid var(--border-color)",
                                cursor: "pointer",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ fontWeight: "600", fontSize: "15px" }}>{group.entry_trade.symbol}</span>
                                  <ViewFinancialsButton symbol={group.entry_trade.symbol} size={14} />
                                  <span
                                    style={{
                                      fontSize: "12px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      backgroundColor: isLong ? "color-mix(in srgb, var(--profit) 18%, transparent)" : "color-mix(in srgb, var(--loss) 18%, transparent)",
                                      color: isLong ? "var(--profit)" : "var(--loss)",
                                      fontWeight: "600",
                                    }}
                                  >
                                    {isLong ? "Long" : "Short"} {qtyDisplay}
                                  </span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                                  {unrealizedPnl != null && (
                                    <span
                                      style={{
                                        fontSize: "14px",
                                        fontWeight: "600",
                                        color: unrealizedPnl >= 0 ? "var(--profit)" : "var(--loss)",
                                      }}
                                    >
                                      Unrealized: {unrealizedPnl >= 0 ? "+" : ""}${formatWithCommas(unrealizedPnl, { decimals: 2 })}
                                      {unrealizedPct != null && (
                                        <span style={{ marginLeft: "6px", fontSize: "13px" }}>
                                          ({unrealizedPct >= 0 ? "+" : ""}{unrealizedPct.toFixed(2)}%)
                                        </span>
                                      )}
                                    </span>
                                  )}
                                  {group.total_pnl !== 0 && (
                                    <span
                                      style={{
                                        fontSize: "13px",
                                        fontWeight: "500",
                                        color: group.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                                      }}
                                    >
                                      Realized: {group.total_pnl >= 0 ? "+" : ""}${formatWithCommas(group.total_pnl, { decimals: 2 })}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px", fontSize: "13px", color: "var(--text-secondary)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span>Entry start:</span>
                                  <span style={{ color: "var(--text-primary)" }}>
                                    {format(new Date(group.entry_trade.timestamp), "MMM d, yyyy")}
                                  </span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span>Average price:</span>
                                  <span style={{ color: "var(--text-primary)" }}>${formatWithCommas(avgPrice, { decimals: 2 })}</span>
                                </div>
                                {currentPrice != null && currentPrice > 0 && (
                                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                                    <span>Current price:</span>
                                    <span style={{ color: "var(--text-primary)" }}>${formatWithCommas(currentPrice, { decimals: 2 })}</span>
                                  </div>
                                )}
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span>Trades in position:</span>
                                  <span style={{ color: "var(--text-primary)" }}>{group.position_trades.length}</span>
                                </div>
                              </div>
                              <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>
                                Click to open in Trades
                              </p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  </SectionCardResizeWrapper>
                )}
              </SortableSection>
            );
          }

          // News Section
          if (sectionId === "news" && dashboardSections.showNews) {
            const newsSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, sectionSizes.news?.columnSpan ?? 1));
            return (
              <SortableSection
                key="news"
                id="news"
                wrapperStyle={{
                  minWidth: 0,
                  maxWidth: "100%",
                  width: "100%",
                  overflow: "hidden",
                  ...(layoutLocked ? { minHeight: 0 } : {}),
                  boxSizing: "border-box",
                  ...(newsSpan > 1 ? { gridColumn: `span ${newsSpan}` as const } : {}),
                }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <SectionCardResizeWrapper sectionId="news" sectionSizes={sectionSizes} setSectionSizes={setSectionSizes} layoutLocked={layoutLocked} lockedRowHeight={lockedRowHeight}>
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      minWidth: 0,
                      height: "100%",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                      </div>
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setSectionMenuPosition({
                              ...sectionMenuPosition,
                              news: {
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              },
                            });
                            setOpenSectionSettings(openSectionSettings === "news" ? null : "news");
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: "4px",
                            cursor: "pointer",
                            color: "var(--text-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "4px",
                          }}
                          title="Settings"
                        >
                          <Settings size={16} />
                        </button>
                        {openSectionSettings === "news" && createPortal(
                          <div
                            data-settings-menu
                            style={{
                              position: "fixed",
                              top: `${sectionMenuPosition.news.top}px`,
                              right: `${sectionMenuPosition.news.right}px`,
                              backgroundColor: "var(--bg-secondary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "8px",
                              padding: "8px",
                              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                              zIndex: 99999,
                              minWidth: "120px",
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {layoutLocked && moveInLockedGridRef?.current ? (
                                <>
                                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("news", "up"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronUp size={14} /><span>Move up</span></button>
                                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("news", "down"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronDown size={14} /><span>Move down</span></button>
                                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("news", "left"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronLeft size={14} /><span>Move left</span></button>
                                  <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("news", "right"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronRight size={14} /><span>Move right</span></button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      const currentIndex = sectionOrder.indexOf("news");
                                      if (currentIndex > 0) {
                                        const newOrder = [...sectionOrder];
                                        [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                                        setSectionOrder(newOrder);
                                        localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                      }
                                      setOpenSectionSettings(null);
                                    }}
                                    disabled={sectionOrder.indexOf("news") === 0}
                                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("news") === 0 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("news") === 0 ? 0.3 : 1 }}
                                  >
                                    <ChevronUp size={14} />
                                    <span>Move Up</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      const currentIndex = sectionOrder.indexOf("news");
                                      if (currentIndex < sectionOrder.length - 1) {
                                        const newOrder = [...sectionOrder];
                                        [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                        setSectionOrder(newOrder);
                                        localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                      }
                                      setOpenSectionSettings(null);
                                    }}
                                    disabled={sectionOrder.indexOf("news") === sectionOrder.length - 1}
                                    style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("news") === sectionOrder.length - 1 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("news") === sectionOrder.length - 1 ? 0.3 : 1 }}
                                  >
                                    <ChevronDown size={14} />
                                    <span>Move Down</span>
                                  </button>
                                </>
                              )}
                              {/* News Settings */}
                              <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                              <div style={{ padding: "4px 0" }}>
                                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "6px", fontWeight: "600" }}>News Settings</div>
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    fontSize: "12px",
                                    color: "var(--text-primary)",
                                    cursor: "pointer",
                                    padding: "4px 0",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={newsIncludePositions}
                                    onChange={(e) => setNewsIncludePositions(e.target.checked)}
                                    style={{ accentColor: "var(--accent)" }}
                                  />
                                  Include open positions
                                </label>
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    fontSize: "12px",
                                    color: "var(--text-primary)",
                                    cursor: "pointer",
                                    padding: "4px 0",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={newsShowSentiment}
                                    onChange={(e) => setNewsShowSentiment(e.target.checked)}
                                    style={{ accentColor: "var(--accent)" }}
                                  />
                                  Show sentiment
                                </label>
                              </div>
                              <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setSectionSizes((prev) => {
                                    const next = { ...prev, news: {} };
                                    localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
                                    return next;
                                  });
                                  setOpenSectionSettings(null);
                                }}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                              >
                                <RotateCcw size={14} />
                                <span>Reset Size</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setDashboardSections((prev) => {
                                    const next = { ...prev, showNews: false };
                                    localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify(next));
                                    return next;
                                  });
                                  setSectionOrder((prev) => {
                                    const newOrder = prev.filter((id) => id !== "news");
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                    return newOrder;
                                  });
                                  setOpenSectionSettings(null);
                                }}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--loss)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}
                              >
                                <Trash2 size={14} />
                                <span>Hide Section</span>
                              </button>
                            </div>
                          </div>,
                          document.body
                        )}
                      </div>
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                      <NewsWidget 
                        compact 
                        maxItems={5}
                        externalSearchQuery={newsSearchQuery}
                        externalIncludePositions={newsIncludePositions}
                        externalShowSentiment={newsShowSentiment}
                        onSearchQueryChange={setNewsSearchQuery}
                        onIncludePositionsChange={setNewsIncludePositions}
                        onShowSentimentChange={setNewsShowSentiment}
                        hideInternalSettings
                        showSearchInHeader
                      />
                    </div>
                  </div>
                  </SectionCardResizeWrapper>
                )}
              </SortableSection>
            );
          }

          // Dividend Tracker (condensed)
          if (sectionId === "dividendTracker" && dashboardSections.showDividendTracker) {
            const divSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, sectionSizes.dividendTracker?.columnSpan ?? 1));
            return (
              <SortableSection
                key="dividendTracker"
                id="dividendTracker"
                wrapperStyle={{
                  minWidth: 0,
                  maxWidth: "100%",
                  width: "100%",
                  overflow: "hidden",
                  ...(layoutLocked ? { minHeight: 0 } : {}),
                  boxSizing: "border-box",
                  ...(divSpan > 1 ? { gridColumn: `span ${divSpan}` as const } : {}),
                }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <SectionCardResizeWrapper
                    sectionId="dividendTracker"
                    sectionSizes={sectionSizes}
                    setSectionSizes={setSectionSizes}
                    layoutLocked={layoutLocked}
                    lockedRowHeight={lockedRowHeight}
                  >
                    <div
                      style={{
                        backgroundColor: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "8px",
                        padding: "20px",
                        cursor: isDragging ? "grabbing" : "grab",
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                        minWidth: 0,
                        height: "100%",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div {...dragHandleProps} style={{ cursor: "grab" }}>
                            <GripVertical size={16} color="var(--text-secondary)" />
                          </div>
                          <Coins size={20} color="var(--accent)" />
                          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>Dividend tracker</h3>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <select
                            aria-label="Dividend tracker view"
                            value={dividendTrackerView}
                            onChange={(e) => {
                              e.stopPropagation();
                              setDividendTrackerView(e.target.value as DividendDashboardView);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            title="Switch between table and chart"
                            style={{
                              fontSize: "12px",
                              padding: "5px 8px",
                              borderRadius: "6px",
                              border: "1px solid var(--border-color)",
                              backgroundColor: "var(--bg-tertiary)",
                              color: "var(--text-primary)",
                              cursor: "pointer",
                              maxWidth: "min(160px, 36vw)",
                            }}
                          >
                            <option value="table">Table</option>
                            <option value="split">Table + charts</option>
                            <option value="charts">Charts</option>
                          </select>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              dividendTrackerDashboardRefreshRef.current?.();
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "4px",
                              cursor: "pointer",
                              color: "var(--text-secondary)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: "4px",
                            }}
                            title="Refresh dividend data"
                          >
                            <RefreshCw size={16} />
                          </button>
                          <div style={{ position: "relative" }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setSectionMenuPosition({
                                ...sectionMenuPosition,
                                dividendTracker: {
                                  top: rect.bottom + 4,
                                  right: window.innerWidth - rect.right,
                                },
                              });
                              setOpenSectionSettings(openSectionSettings === "dividendTracker" ? null : "dividendTracker");
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "4px",
                              cursor: "pointer",
                              color: "var(--text-secondary)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: "4px",
                            }}
                            title="Rows per page, full tracker, layout"
                          >
                            <Settings size={16} />
                          </button>
                          {openSectionSettings === "dividendTracker" &&
                            createPortal(
                              <div
                                data-settings-menu
                                style={{
                                  position: "fixed",
                                  top: `${sectionMenuPosition.dividendTracker.top}px`,
                                  right: `${sectionMenuPosition.dividendTracker.right}px`,
                                  backgroundColor: "var(--bg-secondary)",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "8px",
                                  padding: "8px",
                                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                                  zIndex: 99999,
                                  minWidth: "200px",
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                  <div
                                    style={{
                                      fontSize: "11px",
                                      fontWeight: "600",
                                      color: "var(--text-secondary)",
                                      marginBottom: "2px",
                                    }}
                                  >
                                    Dividend data
                                  </div>
                                  {DIVIDEND_TRACKER_PAGE_SIZE_OPTIONS.map((opt) => (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setDividendTrackerDashboardPageSize(opt);
                                        try {
                                          localStorage.setItem(DIVIDEND_TRACKER_PAGE_SIZE_KEY, String(opt));
                                        } catch {
                                          /* ignore */
                                        }
                                        setOpenSectionSettings(null);
                                      }}
                                      style={{
                                        textAlign: "left",
                                        background:
                                          dividendTrackerDashboardPageSize === opt
                                            ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                                            : "transparent",
                                        border:
                                          dividendTrackerDashboardPageSize === opt
                                            ? "1px solid var(--accent)"
                                            : "1px solid var(--border-color)",
                                        borderRadius: "4px",
                                        padding: "6px 8px",
                                        cursor: "pointer",
                                        color: "var(--text-primary)",
                                        fontSize: "12px",
                                        fontWeight: dividendTrackerDashboardPageSize === opt ? "600" : "500",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                      }}
                                    >
                                      {opt === 0 ? "All rows (no pagination)" : `${opt} per page`}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      navigate("/tools?calc=dividend-tracker");
                                      setOpenSectionSettings(null);
                                    }}
                                    style={{
                                      background: "transparent",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "4px",
                                      padding: "6px 8px",
                                      cursor: "pointer",
                                      color: "var(--text-primary)",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      fontSize: "13px",
                                    }}
                                  >
                                    <ExternalLink size={14} />
                                    <span>Open full tracker</span>
                                  </button>
                                  <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                                  <div
                                    style={{
                                      fontSize: "11px",
                                      fontWeight: "600",
                                      color: "var(--text-secondary)",
                                      marginBottom: "2px",
                                    }}
                                  >
                                    Section layout
                                  </div>
                                  {layoutLocked && moveInLockedGridRef?.current ? (
                                    <>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          moveInLockedGridRef.current?.("dividendTracker", "up");
                                          setOpenSectionSettings(null);
                                        }}
                                        style={{
                                          background: "transparent",
                                          border: "1px solid var(--border-color)",
                                          borderRadius: "4px",
                                          padding: "6px 8px",
                                          cursor: "pointer",
                                          color: "var(--text-primary)",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "8px",
                                          fontSize: "13px",
                                        }}
                                      >
                                        <ChevronUp size={14} />
                                        <span>Move up</span>
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          moveInLockedGridRef.current?.("dividendTracker", "down");
                                          setOpenSectionSettings(null);
                                        }}
                                        style={{
                                          background: "transparent",
                                          border: "1px solid var(--border-color)",
                                          borderRadius: "4px",
                                          padding: "6px 8px",
                                          cursor: "pointer",
                                          color: "var(--text-primary)",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "8px",
                                          fontSize: "13px",
                                        }}
                                      >
                                        <ChevronDown size={14} />
                                        <span>Move down</span>
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          moveInLockedGridRef.current?.("dividendTracker", "left");
                                          setOpenSectionSettings(null);
                                        }}
                                        style={{
                                          background: "transparent",
                                          border: "1px solid var(--border-color)",
                                          borderRadius: "4px",
                                          padding: "6px 8px",
                                          cursor: "pointer",
                                          color: "var(--text-primary)",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "8px",
                                          fontSize: "13px",
                                        }}
                                      >
                                        <ChevronLeft size={14} />
                                        <span>Move left</span>
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          moveInLockedGridRef.current?.("dividendTracker", "right");
                                          setOpenSectionSettings(null);
                                        }}
                                        style={{
                                          background: "transparent",
                                          border: "1px solid var(--border-color)",
                                          borderRadius: "4px",
                                          padding: "6px 8px",
                                          cursor: "pointer",
                                          color: "var(--text-primary)",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "8px",
                                          fontSize: "13px",
                                        }}
                                      >
                                        <ChevronRight size={14} />
                                        <span>Move right</span>
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          const currentIndex = sectionOrder.indexOf("dividendTracker");
                                          if (currentIndex > 0) {
                                            const newOrder = [...sectionOrder];
                                            [newOrder[currentIndex - 1], newOrder[currentIndex]] = [
                                              newOrder[currentIndex],
                                              newOrder[currentIndex - 1],
                                            ];
                                            setSectionOrder(newOrder);
                                            localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                          }
                                          setOpenSectionSettings(null);
                                        }}
                                        disabled={sectionOrder.indexOf("dividendTracker") === 0}
                                        style={{
                                          background: "transparent",
                                          border: "1px solid var(--border-color)",
                                          borderRadius: "4px",
                                          padding: "6px 8px",
                                          cursor:
                                            sectionOrder.indexOf("dividendTracker") === 0 ? "not-allowed" : "pointer",
                                          color: "var(--text-primary)",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "8px",
                                          fontSize: "13px",
                                          opacity: sectionOrder.indexOf("dividendTracker") === 0 ? 0.3 : 1,
                                        }}
                                      >
                                        <ChevronUp size={14} />
                                        <span>Move Up</span>
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          const currentIndex = sectionOrder.indexOf("dividendTracker");
                                          if (currentIndex < sectionOrder.length - 1) {
                                            const newOrder = [...sectionOrder];
                                            [newOrder[currentIndex], newOrder[currentIndex + 1]] = [
                                              newOrder[currentIndex + 1],
                                              newOrder[currentIndex],
                                            ];
                                            setSectionOrder(newOrder);
                                            localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                          }
                                          setOpenSectionSettings(null);
                                        }}
                                        disabled={sectionOrder.indexOf("dividendTracker") === sectionOrder.length - 1}
                                        style={{
                                          background: "transparent",
                                          border: "1px solid var(--border-color)",
                                          borderRadius: "4px",
                                          padding: "6px 8px",
                                          cursor:
                                            sectionOrder.indexOf("dividendTracker") === sectionOrder.length - 1
                                              ? "not-allowed"
                                              : "pointer",
                                          color: "var(--text-primary)",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "8px",
                                          fontSize: "13px",
                                          opacity:
                                            sectionOrder.indexOf("dividendTracker") === sectionOrder.length - 1
                                              ? 0.3
                                              : 1,
                                        }}
                                      >
                                        <ChevronDown size={14} />
                                        <span>Move Down</span>
                                      </button>
                                    </>
                                  )}
                                  <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      setSectionSizes((prev) => {
                                        const next = { ...prev, dividendTracker: {} };
                                        localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
                                        return next;
                                      });
                                      setOpenSectionSettings(null);
                                    }}
                                    style={{
                                      background: "transparent",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "4px",
                                      padding: "6px 8px",
                                      cursor: "pointer",
                                      color: "var(--text-primary)",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      fontSize: "13px",
                                    }}
                                  >
                                    <RotateCcw size={14} />
                                    <span>Reset Size</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      setDashboardSections((prev) => {
                                        const next = { ...prev, showDividendTracker: false };
                                        localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify(next));
                                        return next;
                                      });
                                      setSectionOrder((prev) => {
                                        const newOrder = prev.filter((id) => id !== "dividendTracker");
                                        localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                        return newOrder;
                                      });
                                      setOpenSectionSettings(null);
                                    }}
                                    style={{
                                      background: "transparent",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "4px",
                                      padding: "6px 8px",
                                      cursor: "pointer",
                                      color: "var(--loss)",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      fontSize: "13px",
                                    }}
                                  >
                                    <Trash2 size={14} />
                                    <span>Hide Section</span>
                                  </button>
                                </div>
                              </div>,
                              document.body
                            )}
                          </div>
                        </div>
                      </div>
                      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                        <DividendTrackerDashboardWidget
                          pageSize={dividendTrackerDashboardPageSize}
                          viewMode={dividendTrackerView}
                          onPageSizeChange={(n) => {
                            setDividendTrackerDashboardPageSize(n);
                            try {
                              localStorage.setItem(DIVIDEND_TRACKER_PAGE_SIZE_KEY, String(n));
                            } catch {
                              /* ignore */
                            }
                          }}
                          onRegisterRefresh={registerDividendTrackerRefresh}
                        />
                      </div>
                    </div>
                  </SectionCardResizeWrapper>
                )}
              </SortableSection>
            );
          }

          // Trades Section
          if (sectionId === "trades" && dashboardSections.showTrades) {
            const tradesSpan = Math.min(MAX_POSITION_CHART_COLUMN_SPAN, Math.max(1, sectionSizes.trades?.columnSpan ?? 1));
            return (
              <SortableSection
                key="trades"
                id="trades"
                wrapperStyle={{
                  minWidth: 0,
                  maxWidth: "100%",
                  width: "100%",
                  overflow: layoutLocked ? "visible" : "hidden",
                  boxSizing: "border-box",
                  ...(tradesSpan > 1 ? { gridColumn: `span ${tradesSpan}` as const } : {}),
                  ...(sectionSizes.trades?.height != null ? { minHeight: `${sectionSizes.trades.height}px` } : {}),
                }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <SectionCardResizeWrapper sectionId="trades" sectionSizes={sectionSizes} setSectionSizes={setSectionSizes} layoutLocked={layoutLocked} lockedRowHeight={lockedRowHeight}>
                  <div
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      padding: "20px",
                      cursor: isDragging ? "grabbing" : "grab",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      minWidth: 0,
                      height: "100%",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div {...dragHandleProps} style={{ cursor: "grab" }}>
                          <GripVertical size={16} color="var(--text-secondary)" />
                        </div>
                    <Activity size={20} color="var(--accent)" />
                    <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Trades</h2>
                  </div>
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setSectionMenuPosition({
                          ...sectionMenuPosition,
                          trades: {
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          },
                        });
                        setOpenSectionSettings(openSectionSettings === "trades" ? null : "trades");
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: "4px",
                        cursor: "pointer",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "4px",
                      }}
                      title="Settings"
                    >
                      <Settings size={16} />
                    </button>
                    {openSectionSettings === "trades" && createPortal(
                      <div
                        data-settings-menu
                        style={{
                          position: "fixed",
                          top: `${sectionMenuPosition.trades.top}px`,
                          right: `${sectionMenuPosition.trades.right}px`,
                          backgroundColor: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "8px",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                          zIndex: 99999,
                          minWidth: "120px",
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          {layoutLocked && moveInLockedGridRef?.current ? (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("trades", "up"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronUp size={14} /><span>Move up</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("trades", "down"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronDown size={14} /><span>Move down</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("trades", "left"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronLeft size={14} /><span>Move left</span></button>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); moveInLockedGridRef.current?.("trades", "right"); setOpenSectionSettings(null); }} style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}><ChevronRight size={14} /><span>Move right</span></button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const currentIndex = sectionOrder.indexOf("trades");
                                  if (currentIndex > 0) {
                                    const newOrder = [...sectionOrder];
                                    [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                                    setSectionOrder(newOrder);
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                  }
                                  setOpenSectionSettings(null);
                                }}
                                disabled={sectionOrder.indexOf("trades") === 0}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("trades") === 0 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("trades") === 0 ? 0.3 : 1 }}
                              >
                                <ChevronUp size={14} />
                                <span>Move Up</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const currentIndex = sectionOrder.indexOf("trades");
                                  if (currentIndex < sectionOrder.length - 1) {
                                    const newOrder = [...sectionOrder];
                                    [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
                                    setSectionOrder(newOrder);
                                    localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                  }
                                  setOpenSectionSettings(null);
                                }}
                                disabled={sectionOrder.indexOf("trades") === sectionOrder.length - 1}
                                style={{ background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", padding: "6px 8px", cursor: sectionOrder.indexOf("trades") === sectionOrder.length - 1 ? "not-allowed" : "pointer", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", opacity: sectionOrder.indexOf("trades") === sectionOrder.length - 1 ? 0.3 : 1 }}
                              >
                                <ChevronDown size={14} />
                                <span>Move Down</span>
                              </button>
                            </>
                          )}
                          <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setSectionSizes((prev) => {
                                const next = { ...prev, trades: {} };
                                localStorage.setItem(DASHBOARD_SECTION_SIZES_KEY, JSON.stringify(next));
                                return next;
                              });
                              setOpenSectionSettings(null);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: "pointer",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                            }}
                          >
                            <RotateCcw size={14} />
                            <span>Reset size</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setDashboardSections((prev) => {
                                const next = { ...prev, showTrades: false };
                                localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify(next));
                                return next;
                              });
                              setSectionOrder((prev) => {
                                const newOrder = prev.filter((id) => id !== "trades");
                                localStorage.setItem(DASHBOARD_SECTION_ORDER_KEY, JSON.stringify(newOrder));
                                return newOrder;
                              });
                              setOpenSectionSettings(null);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              padding: "6px 8px",
                              cursor: "pointer",
                              color: "var(--loss)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                            }}
                          >
                            <Trash2 size={14} />
                            <span>Remove</span>
                          </button>
                          <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
                          <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
                            <label style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                              Trades Per Page:
                            </label>
                            <input
                              type="number"
                              min="5"
                              max="100"
                              step="5"
                              value={tradesPerPage}
                              onChange={(e) => {
                                const value = Math.max(5, Math.min(100, parseInt(e.target.value) || 20));
                                setTradesPerPage(value);
                                localStorage.setItem("tradebutler_trades_per_page", value.toString());
                                setCurrentTradesPage(1); // Reset to first page when changing page size
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                padding: "6px 8px",
                                backgroundColor: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                fontSize: "13px",
                                width: "100%",
                              }}
                            />
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, minHeight: 0, minWidth: 0, overflowX: "hidden", overflowY: "auto" }}>
                  {trades.length === 0 ? (
                    <p style={{ color: "var(--text-secondary)", textAlign: "center", padding: "20px" }}>
                      No trades found for the selected timeframe.
                    </p>
                  ) : (() => {
                    // Calculate pagination
                    const totalPages = Math.ceil(trades.length / tradesPerPage);
                    const startIndex = (currentTradesPage - 1) * tradesPerPage;
                    const endIndex = startIndex + tradesPerPage;
                    const paginatedTrades = trades.slice(startIndex, endIndex);
                    
                return (
                      <>
                        {paginatedTrades.map((trade, idx) => {
                          const actualIndex = startIndex + idx;
                          const isExpanded = expandedTrades.has(actualIndex);
                          return (
                            <div key={`${trade.symbol}-${trade.exit_timestamp}-${actualIndex}`}>
                    <div
                      onClick={() => {
                                  const newExpanded = new Set(expandedTrades);
                        if (isExpanded) {
                                    newExpanded.delete(actualIndex);
                        } else {
                                    newExpanded.add(actualIndex);
                        }
                                  setExpandedTrades(newExpanded);
                      }}
                      style={{
                        padding: "12px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <p style={{ fontWeight: "600" }}>{trade.symbol}</p>
                        <p
                          style={{
                            fontSize: "14px",
                            fontWeight: "600",
                            color: trade.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                          }}
                        >
                          {trade.net_profit_loss >= 0 ? "+" : ""}${formatWithCommas(trade.net_profit_loss, { decimals: 2 })}
                        </p>
                      </div>
                    </div>
                    {isExpanded && (
                      <div
                        style={{
                          padding: "12px",
                          paddingLeft: "36px",
                          backgroundColor: "var(--bg-primary)",
                          borderBottomLeftRadius: "6px",
                          borderBottomRightRadius: "6px",
                          marginTop: "4px",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Entry:</span>
                            <span style={{ color: "var(--text-primary)" }}>
                              {formatWithCommas(trade.quantity)} @ ${formatWithCommas(trade.entry_price, { decimals: 2 })}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Exit:</span>
                            <span style={{ color: "var(--text-primary)" }}>
                              {formatWithCommas(trade.quantity)} @ ${formatWithCommas(trade.exit_price, { decimals: 2 })}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Closed:</span>
                            <span style={{ color: "var(--text-secondary)" }}>
                              {format(new Date(trade.exit_timestamp), "MMM d, HH:mm")}
                            </span>
                          </div>
                        </div>
                        {trade.strategy_name && (
                          <p style={{ fontSize: "11px", color: "var(--accent)", marginTop: "8px" }}>
                            {trade.strategy_name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                          );
                        })}
                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                              marginTop: "16px",
                              paddingTop: "16px",
                              borderTop: "1px solid var(--border-color)",
                            }}
                          >
                            <button
                              onClick={() => setCurrentTradesPage(prev => Math.max(1, prev - 1))}
                              disabled={currentTradesPage === 1}
                              style={{
                                background: currentTradesPage === 1 ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                padding: "6px 12px",
                                color: "var(--text-primary)",
                                cursor: currentTradesPage === 1 ? "not-allowed" : "pointer",
                                fontSize: "13px",
                                opacity: currentTradesPage === 1 ? 0.5 : 1,
                              }}
                            >
                              Previous
                            </button>
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let pageNum: number;
                                if (totalPages <= 5) {
                                  pageNum = i + 1;
                                } else if (currentTradesPage <= 3) {
                                  pageNum = i + 1;
                                } else if (currentTradesPage >= totalPages - 2) {
                                  pageNum = totalPages - 4 + i;
                                } else {
                                  pageNum = currentTradesPage - 2 + i;
                                }
                                
                                return (
                                  <button
                                    key={pageNum}
                                    onClick={() => setCurrentTradesPage(pageNum)}
                                    style={{
                                      background: currentTradesPage === pageNum ? "var(--accent)" : "var(--bg-secondary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "6px",
                                      padding: "6px 12px",
                                      color: currentTradesPage === pageNum ? "white" : "var(--text-primary)",
                                      cursor: "pointer",
                                      fontSize: "13px",
                                      minWidth: "36px",
                                    }}
                                  >
                                    {pageNum}
                                  </button>
                );
              })}
                </div>
                            <button
                              onClick={() => setCurrentTradesPage(prev => Math.min(totalPages, prev + 1))}
                              disabled={currentTradesPage === totalPages}
                              style={{
                                background: currentTradesPage === totalPages ? "var(--bg-tertiary)" : "var(--bg-secondary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                padding: "6px 12px",
                                color: "var(--text-primary)",
                                cursor: currentTradesPage === totalPages ? "not-allowed" : "pointer",
                                fontSize: "13px",
                                opacity: currentTradesPage === totalPages ? 0.5 : 1,
                              }}
                            >
                              Next
                            </button>
                            <span style={{ fontSize: "12px", color: "var(--text-secondary)", marginLeft: "8px" }}>
                              Page {currentTradesPage} of {totalPages}
                            </span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                  </div>
                  </SectionCardResizeWrapper>
                )}
              </SortableSection>
            );
          }
          return null;
          };
          renderSectionCardRef.current = renderOne;
          return sectionOrder.map((sid) => renderOne(sid));
        })()}
        </div>
        {layoutLocked && <div style={{ minHeight: 140, width: "100%" }} aria-hidden />}
      </div>
        </SortableContext>
      </DndContext>
      </div>

      </div>

          <MetricsConfigPanel
            isOpen={showMetricsConfig}
            onClose={() => {
              setShowMetricsConfig(false);
              setConfigKey(prev => prev + 1); // Refresh dashboard sections
            }}
            onConfigChange={() => setConfigKey(prev => prev + 1)}
            onAddMetricInstance={addMetricInstance}
            onRemoveAllInstances={removeAllInstancesOfMetric}
            getInstanceCount={getMetricInstanceCount}
            metrics={metricsConfigHook.metrics}
            onToggleMetric={(id) => {
              metricsConfigHook.toggleMetric(id);
              setConfigKey(prev => prev + 1);
            }}
            onResetToDefaults={() => {
              metricsConfigHook.resetToDefaults();
              setConfigKey(prev => prev + 1);
            }}
          />
        
        {/* Position Group Detail Modal */}
        {showPositionGroupModal && selectedPositionGroup && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10000,
            }}
            onClick={() => {
              setShowPositionGroupModal(false);
              setSelectedPositionGroup(null);
              setSelectedPositionGroupId(null);
            }}
          >
            <div
              style={{
                backgroundColor: "var(--bg-primary)",
                borderRadius: "12px",
                padding: "24px",
                maxWidth: "800px",
                maxHeight: "80vh",
                overflowY: "auto",
                width: "90%",
                border: "1px solid var(--border-color)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h2 style={{ fontSize: "20px", fontWeight: "bold" }}>
                  {selectedPositionGroup.entry_trade.symbol} - Position Details
                </h2>
                <button
                  onClick={() => {
                    setShowPositionGroupModal(false);
                    setSelectedPositionGroup(null);
                    setSelectedPositionGroupId(null);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: "24px",
                    padding: "0",
                    width: "32px",
                    height: "32px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ×
                </button>
              </div>
              
              <div style={{ marginBottom: "20px" }}>
                <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>Total P&L:</p>
                <p
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: selectedPositionGroup.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                  }}
                >
                  ${formatWithCommas(selectedPositionGroup.total_pnl, { decimals: 2 })}
                </p>
              </div>
              
              <div style={{ marginBottom: "20px" }}>
                <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>Entry Trade</h3>
                <div
                  style={{
                    backgroundColor: "var(--bg-secondary)",
                    borderRadius: "8px",
                    padding: "12px",
                    marginBottom: "12px",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "14px" }}>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>Side: </span>
                      <span style={{ color: selectedPositionGroup.entry_trade.side === "BUY" ? "var(--profit)" : "var(--loss)" }}>
                        {selectedPositionGroup.entry_trade.side}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>Quantity: </span>
                      <span>{selectedPositionGroup.entry_trade.quantity}</span>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>Price: </span>
                      <span>${formatWithCommas(selectedPositionGroup.entry_trade.price, { decimals: 2 })}</span>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>Date: </span>
                      <span>{format(new Date(selectedPositionGroup.entry_trade.timestamp), "MMM dd, yyyy HH:mm")}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>
                  Position Trades ({selectedPositionGroup.position_trades.length})
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {selectedPositionGroup.position_trades.map((trade: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: "var(--bg-secondary)",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "14px" }}>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Side: </span>
                          <span style={{ color: trade.side === "BUY" ? "var(--profit)" : "var(--loss)" }}>
                            {trade.side}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Quantity: </span>
                          <span>{trade.quantity}</span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Price: </span>
                          <span>${formatWithCommas(trade.price, { decimals: 2 })}</span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Date: </span>
                          <span>{format(new Date(trade.timestamp), "MMM dd, yyyy HH:mm")}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
    </MoveInLockedGridContext.Provider>
    </CurrentPriceSyncContext.Provider>
  );
}
