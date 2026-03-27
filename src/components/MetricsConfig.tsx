import { useState, useEffect } from "react";
import { Settings, Plus, Trash2 } from "lucide-react";

export interface MetricConfig {
  id: string;
  label: string;
  enabled: boolean;
  category: string;
}

const defaultMetrics: MetricConfig[] = [
  // Core Metrics
  { id: "total_trades", label: "Total Trades", enabled: true, category: "Core" },
  { id: "total_volume", label: "Total Volume", enabled: true, category: "Core" },
  { id: "total_profit_loss", label: "Total P&L", enabled: true, category: "Core" },
  { id: "win_rate", label: "Win Rate", enabled: true, category: "Core" },
  
  // Performance Metrics
  { id: "winning_trades", label: "Winning Trades", enabled: true, category: "Performance" },
  { id: "losing_trades", label: "Losing Trades", enabled: true, category: "Performance" },
  { id: "average_profit", label: "Average Win", enabled: true, category: "Performance" },
  { id: "average_loss", label: "Average Loss", enabled: true, category: "Performance" },
  { id: "largest_win", label: "Largest Win", enabled: true, category: "Performance" },
  { id: "largest_loss", label: "Largest Loss", enabled: true, category: "Performance" },
  { id: "average_gain_pct", label: "Average Gain %", enabled: true, category: "Performance" },
  { id: "average_loss_pct", label: "Average Loss %", enabled: true, category: "Performance" },
  { id: "largest_win_pct", label: "Largest Win %", enabled: true, category: "Performance" },
  { id: "largest_loss_pct", label: "Largest Loss %", enabled: true, category: "Performance" },
  { id: "average_trade", label: "Average Trade", enabled: false, category: "Performance" },
  { id: "profit_factor", label: "Profit Factor", enabled: false, category: "Performance" },
  { id: "expectancy", label: "Expectancy", enabled: false, category: "Performance" },
  
  // Risk Metrics
  { id: "max_drawdown", label: "Max Drawdown", enabled: false, category: "Risk" },
  { id: "sharpe_ratio", label: "Sharpe Ratio", enabled: false, category: "Risk" },
  { id: "risk_reward_ratio", label: "Risk/Reward Ratio", enabled: false, category: "Risk" },
  { id: "consecutive_wins", label: "Consecutive Wins", enabled: false, category: "Risk" },
  { id: "consecutive_losses", label: "Consecutive Losses", enabled: false, category: "Risk" },
  { id: "current_win_streak", label: "Win Streak", enabled: true, category: "Performance" },
  { id: "current_loss_streak", label: "Loss Streak", enabled: true, category: "Performance" },
  
  // Advanced Metrics
  { id: "total_fees", label: "Total Fees", enabled: false, category: "Advanced" },
  { id: "net_profit", label: "Net Profit (After Fees)", enabled: false, category: "Advanced" },
  { id: "trades_per_day", label: "Trades Per Day", enabled: false, category: "Advanced" },
  { id: "best_day", label: "Best Day", enabled: false, category: "Advanced" },
  { id: "worst_day", label: "Worst Day", enabled: false, category: "Advanced" },
  { id: "average_holding_time_seconds", label: "Avg Holding Time", enabled: true, category: "Performance" },
  { id: "position_size_chart", label: "Position Size Chart", enabled: false, category: "Charts" },
  { id: "current_price", label: "Current Price", enabled: false, category: "Market" },
];

const STORAGE_KEY = "tradebutler_metrics_config";
export const COLOR_RANGE_KEY = "tradebutler_color_range";
/** When enabled, Current Price cards and Open Positions live quotes refresh together on this interval (seconds). */
export const CURRENT_PRICE_SYNC_ENABLED_KEY = "tradebutler_current_price_sync_enabled";
export const CURRENT_PRICE_SYNC_SECONDS_KEY = "tradebutler_current_price_sync_seconds";
export const CURRENT_PRICE_SYNC_INTERVALS = [1, 5, 10, 15, 30, 60, 120] as const;
const DASHBOARD_SECTIONS_KEY = "tradebutler_dashboard_sections";
export const DASHBOARD_MAX_METRIC_ROWS_KEY = "tradebutler_dashboard_max_metric_rows";
export const DASHBOARD_MAX_COLUMNS_KEY = "tradebutler_dashboard_max_columns";
export const DASHBOARD_METRICS_TO_SECTIONS_GAP_KEY = "tradebutler_dashboard_metrics_to_sections_gap";
export const DASHBOARD_METRICS_GRID_GAP_KEY = "tradebutler_dashboard_metrics_grid_gap";
export const DASHBOARD_SECTIONS_GRID_GAP_KEY = "tradebutler_dashboard_sections_grid_gap";
export const DASHBOARD_SECTIONS_GRID_MIN_WIDTH_KEY = "tradebutler_dashboard_sections_grid_min_width";
export const DASHBOARD_SECTIONS_GRID_MARGIN_BOTTOM_KEY = "tradebutler_dashboard_sections_grid_margin_bottom";
export const DASHBOARD_PADDING_KEY = "tradebutler_dashboard_padding";
export const DASHBOARD_LOCKED_ROW_HEIGHT_KEY = "tradebutler_dashboard_locked_row_height";
export const DASHBOARD_SPLIT_GRID_KEY = "tradebutler_dashboard_split_grid";
export const DASHBOARD_SECTIONS_ON_TOP_KEY = "tradebutler_dashboard_sections_on_top";

/** Default values applied when "Reset layout" is used (Organize menu). */
export const DEFAULT_LAYOUT = {
  maxMetricRows: 0,
  maxColumns: 5,
  lockedRowHeight: 100,
  splitGrid: false,
  metricsToSectionsGap: 0,
  sectionsGridGap: 12,
  sectionsGridMinWidth: 280,
  metricsGridGap: 0,
  sectionsGridMarginBottom: 16,
  dashboardPadding: 30,
} as const;

/** Default color range for dollar metrics (red threshold, green threshold). Applied on Reset layout / Reset to Defaults. */
export const DEFAULT_COLOR_RANGE = { min: -2.5, max: 2.5 } as const;

export function useMetricsConfig() {
  const [metrics, setMetrics] = useState<MetricConfig[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge with defaultMetrics to ensure new metrics are included
        const defaultMap = new Map(defaultMetrics.map(m => [m.id, m]));
        const savedMap = new Map(parsed.map((m: MetricConfig) => [m.id, m]));
        
        // Start with all default metrics
        const merged: MetricConfig[] = defaultMetrics.map(defaultMetric => {
          const savedMetric = savedMap.get(defaultMetric.id);
          if (savedMetric && typeof savedMetric === 'object' && 'enabled' in savedMetric) {
            // Use saved settings (enabled/disabled) but keep default label/category
            return {
              ...defaultMetric,
              enabled: (savedMetric as MetricConfig).enabled,
            };
          }
          return defaultMetric;
        });
        
        // Add any old metrics that are no longer in defaults (for backwards compatibility)
        parsed.forEach((savedMetric: MetricConfig) => {
          if (!defaultMap.has(savedMetric.id)) {
            merged.push(savedMetric);
          }
        });
        
        return merged;
      } catch {
        return defaultMetrics;
      }
    }
    return defaultMetrics;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
  }, [metrics]);

  // Merge with defaults on mount to ensure new metrics are included
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed: MetricConfig[] = JSON.parse(saved);
        const defaultMap = new Map(defaultMetrics.map(m => [m.id, m]));
        const savedMap = new Map(parsed.map((m: MetricConfig) => [m.id, m]));
        
        // Check if any default metrics are missing from saved config
        const missingDefaults = defaultMetrics.filter(defaultMetric => !savedMap.has(defaultMetric.id));
        
        if (missingDefaults.length > 0) {
          // Merge saved metrics with defaults
          const merged: MetricConfig[] = defaultMetrics.map(defaultMetric => {
            const savedMetric = savedMap.get(defaultMetric.id);
            if (savedMetric) {
              return {
                ...defaultMetric,
                enabled: savedMetric.enabled,
              };
            }
            return defaultMetric;
          });
          
          // Add any old metrics that are no longer in defaults (for backwards compatibility)
          parsed.forEach((savedMetric: MetricConfig) => {
            if (!defaultMap.has(savedMetric.id)) {
              merged.push(savedMetric);
            }
          });
          
          setMetrics(merged);
        }
      } catch {
        // If parsing fails, use defaults
        setMetrics(defaultMetrics);
      }
    }
  }, []); // Only run once on mount

  const toggleMetric = (id: string) => {
    setMetrics((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
    );
  };

  const getEnabledMetrics = () => metrics.filter((m) => m.enabled);

  const resetToDefaults = () => {
    setMetrics(defaultMetrics);
  };

  return {
    metrics,
    toggleMetric,
    getEnabledMetrics,
    resetToDefaults,
  };
}

function readCurrentPriceSyncSeconds(): number {
  const raw = parseInt(localStorage.getItem(CURRENT_PRICE_SYNC_SECONDS_KEY) || "30", 10);
  return (CURRENT_PRICE_SYNC_INTERVALS as readonly number[]).includes(raw) ? raw : 30;
}

function formatSyncIntervalLabel(sec: number): string {
  if (sec === 60) return "Every 1 minute";
  if (sec === 120) return "Every 2 minutes";
  if (sec === 1) return "Every 1 second";
  return `Every ${sec} seconds`;
}

function CurrentPriceSyncControls({ onConfigChange }: { onConfigChange?: () => void }) {
  const [syncEnabled, setSyncEnabled] = useState(() => localStorage.getItem(CURRENT_PRICE_SYNC_ENABLED_KEY) === "true");
  const [syncSeconds, setSyncSeconds] = useState(readCurrentPriceSyncSeconds);

  return (
    <>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          cursor: "pointer",
        }}
      >
        <span style={{ color: "var(--text-primary)", fontSize: "14px" }}>
          Sync live quotes (Current Price + Open Positions)
        </span>
        <input
          type="checkbox"
          checked={syncEnabled}
          onChange={(e) => {
            const v = e.target.checked;
            localStorage.setItem(CURRENT_PRICE_SYNC_ENABLED_KEY, v ? "true" : "false");
            setSyncEnabled(v);
            onConfigChange?.();
          }}
          style={{
            width: "18px",
            height: "18px",
            cursor: "pointer",
            accentColor: "var(--accent)",
            flexShrink: 0,
          }}
        />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label style={{ fontSize: "13px", color: syncEnabled ? "var(--text-secondary)" : "var(--text-secondary)", opacity: syncEnabled ? 1 : 0.5 }}>
          Shared refresh interval
        </label>
        <select
          value={syncSeconds}
          disabled={!syncEnabled}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            localStorage.setItem(CURRENT_PRICE_SYNC_SECONDS_KEY, String(v));
            setSyncSeconds(v);
            onConfigChange?.();
          }}
          style={{
            padding: "8px 12px",
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            color: "var(--text-primary)",
            fontSize: "14px",
            cursor: syncEnabled ? "pointer" : "not-allowed",
            opacity: syncEnabled ? 1 : 0.55,
          }}
        >
          {CURRENT_PRICE_SYNC_INTERVALS.map((s) => (
            <option key={s} value={s}>
              {formatSyncIntervalLabel(s)}
            </option>
          ))}
        </select>
        <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.45 }}>
          When sync is on, every Current Price card refreshes at the same time on this schedule. Per-card intervals in the gear menu are ignored until sync is turned off.
        </div>
      </div>
    </>
  );
}

interface MetricsConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChange?: () => void; // Callback when config changes
  onAddMetricInstance?: (baseMetricId: string) => void; // Callback to add new metric instance
  onRemoveAllInstances?: (baseMetricId: string) => void; // Callback to remove all instances of a metric type
  getInstanceCount?: (baseMetricId: string) => number; // Callback to get count of instances for a metric
  /** When provided, use these instead of internal hook so Panel and parent share the same source of truth */
  metrics?: MetricConfig[];
  onToggleMetric?: (id: string) => void;
  onResetToDefaults?: () => void;
}

export function MetricsConfigPanel({ isOpen, onClose, onConfigChange, onAddMetricInstance, onRemoveAllInstances, getInstanceCount, metrics: propsMetrics, onToggleMetric: propsToggleMetric, onResetToDefaults: propsResetToDefaults }: MetricsConfigPanelProps) {
  const hook = useMetricsConfig();
  const metrics = propsMetrics ?? hook.metrics;
  const _toggleMetric = propsToggleMetric ?? hook.toggleMetric;
  void _toggleMetric; // Reserved for future use
  const resetToDefaults = propsResetToDefaults ?? hook.resetToDefaults;
  
  // Color range state
  const [colorRange, setColorRange] = useState(() => {
    const saved = localStorage.getItem(COLOR_RANGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return { ...DEFAULT_COLOR_RANGE };
      }
    }
    return { ...DEFAULT_COLOR_RANGE };
  });
  
  // Dashboard sections state
  const [dashboardSections, setDashboardSections] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return {
          showTopSymbols: true,
          showStrategyPerformance: true,
          showRecentTrades: true,
          showTrades: true,
          showOpenPositions: true,
          showNews: true,
          showDividendTracker: true,
        };
      }
    }
    return {
      showTopSymbols: true,
      showStrategyPerformance: true,
      showRecentTrades: true,
      showTrades: true,
      showOpenPositions: true,
      showNews: true,
      showDividendTracker: true,
    };
  });

  // Metric cards layout: max rows (0 = no limit) and columns when layout is locked
  const [maxMetricRows, setMaxMetricRows] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_MAX_METRIC_ROWS_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if (n >= 0 && n <= 10) return n;
    }
    return DEFAULT_LAYOUT.maxMetricRows;
  });
  const [maxColumns, setMaxColumns] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_MAX_COLUMNS_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if (n >= 0 && n <= 10) return n;
    }
    return DEFAULT_LAYOUT.maxColumns;
  });

  const handleMaxMetricRowsChange = (value: number) => {
    setMaxMetricRows(value);
    localStorage.setItem(DASHBOARD_MAX_METRIC_ROWS_KEY, String(value));
    if (onConfigChange) onConfigChange();
  };
  const handleMaxColumnsChange = (value: number) => {
    setMaxColumns(value);
    localStorage.setItem(DASHBOARD_MAX_COLUMNS_KEY, String(value));
    if (onConfigChange) onConfigChange();
  };

  const [lockedRowHeight, setLockedRowHeight] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_LOCKED_ROW_HEIGHT_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if (n >= 40 && n <= 400) return n;
    }
    return DEFAULT_LAYOUT.lockedRowHeight;
  });
  const handleLockedRowHeightChange = (value: number) => {
    setLockedRowHeight(value);
    localStorage.setItem(DASHBOARD_LOCKED_ROW_HEIGHT_KEY, String(value));
    if (onConfigChange) onConfigChange();
  };

  const [splitGrid, setSplitGrid] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_SPLIT_GRID_KEY);
    if (saved !== null) return saved === "true";
    return DEFAULT_LAYOUT.splitGrid;
  });
  const [sectionsOnTop, setSectionsOnTop] = useState(() => localStorage.getItem(DASHBOARD_SECTIONS_ON_TOP_KEY) !== "false");
  const handleSplitGridChange = (value: boolean) => {
    setSplitGrid(value);
    localStorage.setItem(DASHBOARD_SPLIT_GRID_KEY, value ? "true" : "false");
    if (onConfigChange) onConfigChange();
  };
  const handleSectionsOnTopChange = (value: boolean) => {
    setSectionsOnTop(value);
    localStorage.setItem(DASHBOARD_SECTIONS_ON_TOP_KEY, value ? "true" : "false");
    if (onConfigChange) onConfigChange();
  };

  // Spacing: gap between top metric cards and sections below; section grid gap and min width
  const [metricsToSectionsGap, setMetricsToSectionsGap] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_METRICS_TO_SECTIONS_GAP_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if (n >= 0 && n <= 80) return n;
    }
    return DEFAULT_LAYOUT.metricsToSectionsGap;
  });
  const [sectionsGridGap, setSectionsGridGap] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_GRID_GAP_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if (n >= 0 && n <= 48) return n;
    }
    return DEFAULT_LAYOUT.sectionsGridGap;
  });
  const [sectionsGridMinWidth, setSectionsGridMinWidth] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_GRID_MIN_WIDTH_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if ([280, 320, 360, 400, 480].includes(n)) return n;
    }
    return DEFAULT_LAYOUT.sectionsGridMinWidth;
  });
  const [metricsGridGap, setMetricsGridGap] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_METRICS_GRID_GAP_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if ([0, 4, 8, 12, 16, 20, 24].includes(n)) return n;
    }
    return DEFAULT_LAYOUT.metricsGridGap;
  });
  const [sectionsGridMarginBottom, setSectionsGridMarginBottom] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_GRID_MARGIN_BOTTOM_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if (n >= 0 && n <= 80) return n;
    }
    return DEFAULT_LAYOUT.sectionsGridMarginBottom;
  });
  const [dashboardPadding, setDashboardPadding] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_PADDING_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if ([16, 20, 24, 30, 40, 48].includes(n)) return n;
    }
    return DEFAULT_LAYOUT.dashboardPadding;
  });

  const handleMetricsToSectionsGap = (value: number) => {
    setMetricsToSectionsGap(value);
    localStorage.setItem(DASHBOARD_METRICS_TO_SECTIONS_GAP_KEY, String(value));
    if (onConfigChange) onConfigChange();
  };
  const handleSectionsGridGap = (value: number) => {
    setSectionsGridGap(value);
    localStorage.setItem(DASHBOARD_SECTIONS_GRID_GAP_KEY, String(value));
    if (onConfigChange) onConfigChange();
  };
  const handleSectionsGridMinWidth = (value: number) => {
    setSectionsGridMinWidth(value);
    localStorage.setItem(DASHBOARD_SECTIONS_GRID_MIN_WIDTH_KEY, String(value));
    if (onConfigChange) onConfigChange();
  };
  const handleMetricsGridGap = (value: number) => {
    setMetricsGridGap(value);
    localStorage.setItem(DASHBOARD_METRICS_GRID_GAP_KEY, String(value));
    if (onConfigChange) onConfigChange();
  };
  const handleSectionsGridMarginBottom = (value: number) => {
    setSectionsGridMarginBottom(value);
    localStorage.setItem(DASHBOARD_SECTIONS_GRID_MARGIN_BOTTOM_KEY, String(value));
    if (onConfigChange) onConfigChange();
  };
  const handleDashboardPadding = (value: number) => {
    setDashboardPadding(value);
    localStorage.setItem(DASHBOARD_PADDING_KEY, String(value));
    if (onConfigChange) onConfigChange();
  };

  const toggleDashboardSection = (section: string) => {
    setDashboardSections((prev: any) => {
      const updated = { ...prev, [section]: !prev[section as keyof typeof prev] };
      localStorage.setItem(DASHBOARD_SECTIONS_KEY, JSON.stringify(updated));
      if (onConfigChange) {
        onConfigChange();
      }
      return updated;
    });
  };
  
  // Save color range to localStorage
  useEffect(() => {
    localStorage.setItem(COLOR_RANGE_KEY, JSON.stringify(colorRange));
    if (onConfigChange) {
      onConfigChange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorRange]); // onConfigChange is intentionally excluded to prevent infinite loops
  
  // Notify parent when config changes
  useEffect(() => {
    if (onConfigChange) {
      onConfigChange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]); // onConfigChange is intentionally excluded to prevent infinite loops

  if (!isOpen) return null;

  const groupedMetrics = metrics.reduce((acc, metric) => {
    if (!acc[metric.category]) {
      acc[metric.category] = [];
    }
    acc[metric.category].push(metric);
    return acc;
  }, {} as Record<string, MetricConfig[]>);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "600px",
          maxHeight: "80vh",
          overflow: "auto",
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: "600", display: "flex", alignItems: "center", gap: "8px" }}>
            <Settings size={20} />
            Configure
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "24px",
              padding: "0",
              width: "32px",
              height: "32px",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: "16px", display: "flex", gap: "10px" }}>
          <button
            onClick={() => {
              resetToDefaults();
              setColorRange({ ...DEFAULT_COLOR_RANGE });
              onConfigChange?.();
            }}
            style={{
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              padding: "8px 16px",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Reset to Defaults
          </button>
        </div>

        {/* Color Range Configuration */}
        <div style={{ marginBottom: "24px", padding: "20px", backgroundColor: "var(--bg-tertiary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
          <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px", color: "var(--text-primary)" }}>
            Color Range for Dollar Metrics
          </h3>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "20px", lineHeight: "1.5" }}>
            Configure how dollar-based metrics are colored. Values below the minimum will be red, within the range will be blue, and above the maximum will be green.
          </p>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Visual Color Scale */}
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: "8px",
              padding: "12px",
              backgroundColor: "var(--bg-secondary)",
              borderRadius: "6px",
              border: "1px solid var(--border-color)"
            }}>
              <div style={{ 
                flex: 1, 
                height: "32px", 
                background: `linear-gradient(to right, var(--loss) 0%, var(--loss) 33%, var(--accent) 33%, var(--accent) 66%, var(--profit) 66%, var(--profit) 100%)`,
                borderRadius: "4px",
                border: "1px solid var(--border-color)"
              }}></div>
            </div>
            
            {/* Range Inputs */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: "500", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <div style={{ width: "16px", height: "16px", backgroundColor: "var(--loss)", borderRadius: "3px" }}></div>
                  Red Threshold (Minimum)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={colorRange.min}
                  onChange={(e) => {
                    const newMin = parseFloat(e.target.value) || 0;
                    if (newMin < colorRange.max) {
                      setColorRange({ ...colorRange, min: newMin });
                    }
                  }}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    width: "100%",
                  }}
                />
                <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  Values &lt; {colorRange.min.toFixed(2)} will be <span style={{ color: "var(--loss)" }}>red</span>
                </div>
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: "500", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <div style={{ width: "16px", height: "16px", backgroundColor: "var(--profit)", borderRadius: "3px" }}></div>
                  Green Threshold (Maximum)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={colorRange.max}
                  onChange={(e) => {
                    const newMax = parseFloat(e.target.value) || 0;
                    if (newMax > colorRange.min) {
                      setColorRange({ ...colorRange, max: newMax });
                    }
                  }}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    width: "100%",
                  }}
                />
                <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  Values &gt; {colorRange.max.toFixed(2)} will be <span style={{ color: "var(--profit)" }}>green</span>
                </div>
              </div>
            </div>
            
            {/* Summary */}
            <div style={{ 
              padding: "12px", 
              backgroundColor: "var(--bg-secondary)", 
              borderRadius: "6px",
              border: "1px solid var(--border-color)"
            }}>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.8" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <div style={{ width: "14px", height: "14px", backgroundColor: "var(--accent)", borderRadius: "2px" }}></div>
                  <span>Values between <strong>{colorRange.min.toFixed(2)}</strong> and <strong>{colorRange.max.toFixed(2)}</strong> will be <span style={{ color: "var(--accent)" }}>blue</span></span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Dashboard Sections */}
        <div style={{ marginBottom: "24px" }}>
          <h3
            style={{
              fontSize: "16px",
              fontWeight: "600",
              marginBottom: "12px",
              color: "var(--text-primary)",
            }}
          >
            Dashboard Sections
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[
              { id: "showTopSymbols", label: "Top Symbols" },
              { id: "showStrategyPerformance", label: "Strategy Performance" },
              { id: "showRecentTrades", label: "Recent Trades" },
              { id: "showOpenPositions", label: "Open Positions" },
              { id: "showTrades", label: "Trades" },
              { id: "showNews", label: "News Feed" },
              { id: "showDividendTracker", label: "Dividend Tracker" },
            ].map((section) => (
              <label
                key={section.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px",
                  backgroundColor: "var(--bg-tertiary)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  border: "1px solid var(--border-color)",
                }}
              >
                <span style={{ color: "var(--text-primary)" }}>{section.label}</span>
                <input
                  type="checkbox"
                  checked={dashboardSections[section.id as keyof typeof dashboardSections] as boolean}
                  onChange={() => toggleDashboardSection(section.id)}
                  style={{
                    width: "18px",
                    height: "18px",
                    cursor: "pointer",
                    accentColor: "var(--accent)",
                  }}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Live quotes — synced refresh */}
        <div style={{ marginBottom: "24px" }}>
          <h3
            style={{
              fontSize: "16px",
              fontWeight: "600",
              marginBottom: "12px",
              color: "var(--text-primary)",
            }}
          >
            Live quotes sync
          </h3>
          <div
            style={{
              padding: "12px",
              backgroundColor: "var(--bg-tertiary)",
              borderRadius: "6px",
              border: "1px solid var(--border-color)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <CurrentPriceSyncControls onConfigChange={onConfigChange} />
          </div>
        </div>

        {/* Metric cards layout */}
        <div style={{ marginBottom: "24px" }}>
          <h3
            style={{
              fontSize: "16px",
              fontWeight: "600",
              marginBottom: "12px",
              color: "var(--text-primary)",
            }}
          >
            Metric cards layout
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Max rows</label>
              <select
                value={maxMetricRows}
                onChange={(e) => handleMaxMetricRowsChange(parseInt(e.target.value, 10))}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                <option value={0}>No limit (wrap with window)</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>{n} row{n !== 1 ? "s" : ""}</option>
                ))}
              </select>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                When set, metric cards use a fixed grid with at most this many rows. With layout locked, resizing the window won’t change the arrangement.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Columns</label>
              <select
                value={maxColumns}
                onChange={(e) => handleMaxColumnsChange(parseInt(e.target.value, 10))}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                <option value={0}>No limit (wrap with window)</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>{n} column{n !== 1 ? "s" : ""}</option>
                ))}
              </select>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                When set, metric cards use a fixed grid with this many columns. With layout locked, resizing the window won’t change the arrangement.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Row height when locked (px)</label>
              <select
                value={lockedRowHeight}
                onChange={(e) => handleLockedRowHeightChange(parseInt(e.target.value, 10))}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                {[40, 48, 56, 64, 72, 80, 100, 120, 140, 160, 200, 240, 280, 320, 400].map((n) => (
                  <option key={n} value={n}>{n} px</option>
                ))}
              </select>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                Minimum height of each row; use 40–56 px for tighter vertical spacing. You can also drag the bar at the bottom of the grid to adjust.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Split grid (metrics and sections separate)</label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={splitGrid}
                  onChange={(e) => handleSplitGridChange(e.target.checked)}
                  style={{ width: "18px", height: "18px", accentColor: "var(--accent)" }}
                />
                <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>Use separate grids for metrics and sections</span>
              </label>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                When on, metric cards and section blocks (Top Symbols, Strategy Performance, etc.) are in two independent areas so you can size each without affecting the other.
              </div>
              {splitGrid && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Which area on top?</label>
                  <select
                    value={sectionsOnTop ? "sections" : "metrics"}
                    onChange={(e) => handleSectionsOnTopChange(e.target.value === "sections")}
                    style={{
                      padding: "8px 12px",
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      cursor: "pointer",
                    }}
                  >
                    <option value="metrics">Metrics on top</option>
                    <option value="sections">Sections on top</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Spacing: gap between metric cards and sections; section grid options */}
        <div style={{ marginBottom: "24px", padding: "20px", backgroundColor: "var(--bg-tertiary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
          <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px", color: "var(--text-primary)" }}>
            Spacing &amp; section layout
          </h3>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px", lineHeight: "1.5" }}>
            Control spacing between the chart/metric cards, the Trades/Open Positions row, and other dashboard areas.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Space between chart/metric cards and sections below (px)</label>
              <select
                value={metricsToSectionsGap}
                onChange={(e) => handleMetricsToSectionsGap(parseInt(e.target.value, 10))}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                {[0, 8, 12, 16, 20, 24, 30, 40, 48, 60, 80].map((n) => (
                  <option key={n} value={n}>{n === 0 ? "0 (snap to metrics)" : `${n} px`}</option>
                ))}
              </select>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                Use 0 to snap section cards directly under the chart/metric cards with no gap. Same in locked and unlocked layout.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Gap between section cards (Trades, Open Positions, etc.)</label>
              <select
                value={sectionsGridGap}
                onChange={(e) => handleSectionsGridGap(parseInt(e.target.value, 10))}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                {[12, 16, 20, 24, 28, 32, 40, 48].map((n) => (
                  <option key={n} value={n}>{n} px</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Section card min width</label>
              <select
                value={sectionsGridMinWidth}
                onChange={(e) => handleSectionsGridMinWidth(parseInt(e.target.value, 10))}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                {[280, 320, 360, 400, 480].map((n) => (
                  <option key={n} value={n}>{n} px</option>
                ))}
              </select>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                Minimum width of each section card before wrapping to the next row.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Gap between metric cards (locked &amp; unlocked)</label>
              <select
                value={metricsGridGap}
                onChange={(e) => handleMetricsGridGap(parseInt(e.target.value, 10))}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                {[0, 4, 8, 12, 16, 20, 24].map((n) => (
                  <option key={n} value={n}>{n === 0 ? "0 (tight)" : `${n} px`}</option>
                ))}
              </select>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                Use 0 or 4 px for minimal spacing between cards in both locked and unlocked layout.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Space below section cards (Trades, Open Positions row)</label>
              <select
                value={sectionsGridMarginBottom}
                onChange={(e) => handleSectionsGridMarginBottom(parseInt(e.target.value, 10))}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                {[16, 20, 24, 30, 40, 48, 60, 80].map((n) => (
                  <option key={n} value={n}>{n} px</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Dashboard page padding</label>
              <select
                value={dashboardPadding}
                onChange={(e) => handleDashboardPadding(parseInt(e.target.value, 10))}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                {[16, 20, 24, 30, 40, 48].map((n) => (
                  <option key={n} value={n}>{n} px</option>
                ))}
              </select>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                Padding around the entire dashboard content.
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {Object.entries(groupedMetrics).map(([category, categoryMetrics]) => (
            <div key={category}>
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  marginBottom: "12px",
                  color: "var(--text-primary)",
                }}
              >
                {category}
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {categoryMetrics.map((metric) => {
                  const instanceCount = getInstanceCount ? getInstanceCount(metric.id) : 0;
                  const hasInstances = instanceCount > 0;
                  
                  return (
                    <div
                      key={metric.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px",
                        backgroundColor: hasInstances ? "color-mix(in srgb, var(--accent) 8%, var(--bg-tertiary))" : "var(--bg-tertiary)",
                        borderRadius: "6px",
                        border: "1px solid var(--border-color)",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                        <span style={{ color: "var(--text-primary)", flex: 1 }}>{metric.label}</span>
                        {hasInstances && (
                          <span
                            style={{
                              fontSize: "13px",
                              padding: "4px 10px",
                              borderRadius: "6px",
                              backgroundColor: "var(--bg-primary)",
                              color: "var(--accent)",
                              fontWeight: "700",
                              border: "1px solid var(--border-color)",
                              minWidth: "28px",
                              textAlign: "center",
                            }}
                            title={`${instanceCount} instance${instanceCount > 1 ? 's' : ''} on dashboard`}
                          >
                            {instanceCount}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onAddMetricInstance) {
                              onAddMetricInstance(metric.id);
                            }
                          }}
                          style={{
                            background: "transparent",
                            border: "1px solid var(--accent)",
                            borderRadius: "4px",
                            padding: "4px 10px",
                            cursor: "pointer",
                            color: "var(--accent)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "13px",
                            fontWeight: "600",
                            gap: "4px",
                            height: "32px",
                          }}
                          title="Add this metric to the dashboard"
                        >
                          <Plus size={14} />
                          Add
                        </button>
                        {hasInstances && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onRemoveAllInstances) {
                                onRemoveAllInstances(metric.id);
                              }
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid rgba(239, 68, 68, 0.5)",
                              borderRadius: "4px",
                              padding: "4px 8px",
                              cursor: "pointer",
                              color: "#EF4444",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              height: "32px",
                            }}
                            title={`Remove all ${instanceCount} instance${instanceCount > 1 ? 's' : ''} of this metric`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

