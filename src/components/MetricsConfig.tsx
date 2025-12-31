import { useState, useEffect } from "react";
import { Settings, Plus } from "lucide-react";

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
];

const STORAGE_KEY = "tradebutler_metrics_config";
const COLOR_RANGE_KEY = "tradebutler_color_range";
const DASHBOARD_SECTIONS_KEY = "tradebutler_dashboard_sections";

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

interface MetricsConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChange?: () => void; // Callback when config changes
  onAddMetricInstance?: (baseMetricId: string) => void; // Callback to add new metric instance
}

export function MetricsConfigPanel({ isOpen, onClose, onConfigChange, onAddMetricInstance }: MetricsConfigPanelProps) {
  const { metrics, resetToDefaults } = useMetricsConfig();
  
  // Color range state
  const [colorRange, setColorRange] = useState(() => {
    const saved = localStorage.getItem(COLOR_RANGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return { min: -100, max: 100 };
      }
    }
    return { min: -100, max: 100 };
  });
  
  // Dashboard sections state
  const [dashboardSections, setDashboardSections] = useState(() => {
    const saved = localStorage.getItem(DASHBOARD_SECTIONS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return { showTopSymbols: true, showStrategyPerformance: true, showRecentTrades: true, showTrades: true };
      }
    }
    return { showTopSymbols: true, showStrategyPerformance: true, showRecentTrades: true, showTrades: true };
  });
  
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
  }, [colorRange, onConfigChange]);
  
  // Notify parent when config changes
  useEffect(() => {
    if (onConfigChange) {
      onConfigChange();
    }
  }, [metrics, onConfigChange]);

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
            onClick={resetToDefaults}
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
              { id: "showTrades", label: "Trades" },
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
                {categoryMetrics.map((metric) => (
                  <div
                    key={metric.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px",
                      backgroundColor: "var(--bg-tertiary)",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color)",
                      gap: "8px",
                    }}
                  >
                    <span style={{ color: "var(--text-primary)", flex: 1 }}>{metric.label}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onAddMetricInstance) {
                          onAddMetricInstance(metric.id);
                        }
                      }}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        padding: "4px 8px",
                        cursor: "pointer",
                        color: "var(--text-primary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                        minWidth: "32px",
                        height: "32px",
                      }}
                      title="Add new instance"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

