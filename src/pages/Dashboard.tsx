import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { TrendingUp, TrendingDown, DollarSign, Activity } from "lucide-react";

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

export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

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

  const statCards = [
    {
      title: "Total Trades",
      value: metrics?.total_trades || 0,
      icon: Activity,
      color: "var(--accent)",
    },
    {
      title: "Total Volume",
      value: `$${((metrics?.total_volume || 0) / 1000).toFixed(1)}k`,
      icon: DollarSign,
      color: "var(--accent)",
    },
    {
      title: "Win Rate",
      value: `${((metrics?.win_rate || 0) * 100).toFixed(1)}%`,
      icon: TrendingUp,
      color: "var(--success)",
    },
    {
      title: "P&L",
      value: `$${(metrics?.total_profit_loss || 0).toFixed(2)}`,
      icon: metrics?.total_profit_loss && metrics.total_profit_loss >= 0 ? TrendingUp : TrendingDown,
      color: metrics?.total_profit_loss && metrics.total_profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
    },
  ];

  return (
    <div style={{ padding: "30px" }}>
      <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px" }}>
        Dashboard
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "20px",
          marginBottom: "30px",
        }}
      >
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
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
                  backgroundColor: `${card.color}20`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: card.color,
                }}
              >
                <Icon size={24} />
              </div>
              <div>
                <p
                  style={{
                    fontSize: "14px",
                    color: "var(--text-secondary)",
                    marginBottom: "4px",
                  }}
                >
                  {card.title}
                </p>
                <p
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: "var(--text-primary)",
                  }}
                >
                  {card.value}
                </p>
              </div>
            </div>
          );
        })}
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
          Quick Stats
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
          <div>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "4px" }}>
              Winning Trades
            </p>
            <p style={{ fontSize: "18px", fontWeight: "600", color: "var(--profit)" }}>
              {metrics?.winning_trades || 0}
            </p>
          </div>
          <div>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "4px" }}>
              Losing Trades
            </p>
            <p style={{ fontSize: "18px", fontWeight: "600", color: "var(--loss)" }}>
              {metrics?.losing_trades || 0}
            </p>
          </div>
          <div>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "4px" }}>
              Average Profit
            </p>
            <p style={{ fontSize: "18px", fontWeight: "600", color: "var(--profit)" }}>
              ${(metrics?.average_profit || 0).toFixed(2)}
            </p>
          </div>
          <div>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "4px" }}>
              Average Loss
            </p>
            <p style={{ fontSize: "18px", fontWeight: "600", color: "var(--loss)" }}>
              ${(metrics?.average_loss || 0).toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

