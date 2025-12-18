import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Settings,
} from "lucide-react";
import { MetricsConfigPanel, useMetricsConfig } from "../components/MetricsConfig";

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
};

const formatMetricValue = (id: string, value: number, metrics: Metrics | null): string => {
  if (metrics === null) return "0";

  switch (id) {
    case "total_trades":
      return value.toString();
    case "total_volume":
      return `$${((value || 0) / 1000).toFixed(1)}k`;
    case "total_profit_loss":
    case "average_profit":
    case "average_loss":
    case "largest_win":
    case "largest_loss":
      return `$${(value || 0).toFixed(2)}`;
    case "win_rate":
      return `${((value || 0) * 100).toFixed(1)}%`;
    case "winning_trades":
    case "losing_trades":
      return value.toString();
    default:
      return value.toFixed(2);
  }
};

const getMetricColor = (id: string, value: number): string => {
  if (id.includes("profit") || id.includes("win") || (id === "win_rate" && value > 0)) {
    return "var(--profit)";
  }
  if (id.includes("loss") || id.includes("losing") || (id === "win_rate" && value < 0)) {
    return "var(--loss)";
  }
  if (id === "total_profit_loss") {
    return value >= 0 ? "var(--profit)" : "var(--loss)";
  }
  return "var(--accent)";
};

export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMetricsConfig, setShowMetricsConfig] = useState(false);
  const { getEnabledMetrics } = useMetricsConfig();

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      const data = await invoke<Metrics>("get_metrics");
      setMetrics(data);
    } catch (error) {
      console.error("Error loading metrics:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading metrics...</p>
      </div>
    );
  }

  const enabledMetrics = getEnabledMetrics();
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
  };

  return (
    <div style={{ padding: "30px", overflowY: "auto", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "30px",
        }}
      >
        <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Dashboard</h1>
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
          Configure Metrics
        </button>
      </div>

      {/* Metrics Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "20px",
          marginBottom: "30px",
        }}
      >
        {enabledMetrics.map((metric) => {
          const value = metricValues[metric.id] || 0;
          const Icon = metricIcons[metric.id] || Activity;
          const color = getMetricColor(metric.id, value);

          return (
            <div
              key={metric.id}
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "20px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
              }}
            >
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
                }}
              >
                <Icon size={24} />
              </div>
              <div style={{ flex: 1 }}>
                <p
                  style={{
                    fontSize: "14px",
                    color: "var(--text-secondary)",
                    marginBottom: "4px",
                  }}
                >
                  {metric.label}
                </p>
                <p
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: color,
                  }}
                >
                  {formatMetricValue(metric.id, value, metrics)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Additional Stats */}
      {enabledMetrics.some((m) => ["winning_trades", "losing_trades", "average_profit", "average_loss"].includes(m.id)) && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "20px",
          }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "16px" }}>
            Additional Stats
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
            {enabledMetrics
              .filter((m) => ["winning_trades", "losing_trades", "average_profit", "average_loss"].includes(m.id))
              .map((metric) => {
                const value = metricValues[metric.id] || 0;
                const color = getMetricColor(metric.id, value);

                return (
                  <div key={metric.id}>
                    <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "4px" }}>
                      {metric.label}
                    </p>
                    <p style={{ fontSize: "18px", fontWeight: "600", color: color }}>
                      {formatMetricValue(metric.id, value, metrics)}
                    </p>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <MetricsConfigPanel
        isOpen={showMetricsConfig}
        onClose={() => setShowMetricsConfig(false)}
      />
    </div>
  );
}
