import { useState, useEffect } from "react";
import { Settings } from "lucide-react";

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
  { id: "current_win_streak", label: "Current Win Streak", enabled: false, category: "Risk" },
  { id: "current_loss_streak", label: "Current Loss Streak", enabled: false, category: "Risk" },
  
  // Strategy Metrics
  { id: "strategy_win_rate", label: "Strategy Win Rate", enabled: false, category: "Strategy" },
  { id: "strategy_winning_trades", label: "Strategy Winning Trades", enabled: false, category: "Strategy" },
  { id: "strategy_losing_trades", label: "Strategy Losing Trades", enabled: false, category: "Strategy" },
  { id: "strategy_profit_loss", label: "Strategy P&L", enabled: false, category: "Strategy" },
  { id: "strategy_consecutive_wins", label: "Strategy Consecutive Wins", enabled: false, category: "Strategy" },
  { id: "strategy_consecutive_losses", label: "Strategy Consecutive Losses", enabled: false, category: "Strategy" },
  
  // Advanced Metrics
  { id: "total_fees", label: "Total Fees", enabled: false, category: "Advanced" },
  { id: "net_profit", label: "Net Profit (After Fees)", enabled: false, category: "Advanced" },
  { id: "trades_per_day", label: "Trades Per Day", enabled: false, category: "Advanced" },
  { id: "best_day", label: "Best Day", enabled: false, category: "Advanced" },
  { id: "worst_day", label: "Worst Day", enabled: false, category: "Advanced" },
];

const STORAGE_KEY = "tradebutler_metrics_config";

export function useMetricsConfig() {
  const [metrics, setMetrics] = useState<MetricConfig[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return defaultMetrics;
      }
    }
    return defaultMetrics;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
  }, [metrics]);

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
}

export function MetricsConfigPanel({ isOpen, onClose }: MetricsConfigPanelProps) {
  const { metrics, toggleMetric, resetToDefaults } = useMetricsConfig();

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
            Configure Metrics
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

        <div style={{ marginBottom: "16px" }}>
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
                  <label
                    key={metric.id}
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
                    <span style={{ color: "var(--text-primary)" }}>{metric.label}</span>
                    <input
                      type="checkbox"
                      checked={metric.enabled}
                      onChange={() => toggleMetric(metric.id)}
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
          ))}
        </div>
      </div>
    </div>
  );
}

