import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Settings,
  TrendingUp as TrendingUpIcon,
  BarChart3,
  Clock,
} from "lucide-react";
import { MetricsConfigPanel, useMetricsConfig } from "../components/MetricsConfig";
import { format } from "date-fns";

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

interface StrategyPerformance {
  strategy_id: number | null;
  strategy_name: string;
  trade_count: number;
  total_volume: number;
  estimated_pnl: number;
}

interface RecentTrade {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
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
    case "average_trade":
    case "total_fees":
    case "net_profit":
    case "max_drawdown":
    case "best_day":
    case "worst_day":
      // largest_loss is stored as negative, so display it as-is
      return `$${(value || 0).toFixed(2)}`;
    case "win_rate":
      return `${((value || 0) * 100).toFixed(1)}%`;
    case "expectancy":
    case "profit_factor":
    case "sharpe_ratio":
    case "risk_reward_ratio":
    case "trades_per_day":
      return (value || 0).toFixed(2);
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
      return value.toString();
    case "strategy_win_rate":
      return `${((value || 0) * 100).toFixed(1)}%`;
    case "strategy_profit_loss":
      return `$${(value || 0).toFixed(2)}`;
    default:
      return value.toFixed(2);
  }
};

const getMetricColor = (id: string, value: number, colorRange?: { min: number; max: number }): string => {
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
  
  // Dollar-based metrics that should use color range
  const dollarMetrics = [
    "total_profit_loss", "strategy_profit_loss", "average_profit", "average_loss",
    "largest_win", "largest_loss", "average_trade", "total_fees", "net_profit",
    "max_drawdown", "best_day", "worst_day", "expectancy"
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
    if (id.includes("loss") || id.includes("losing") || id.includes("drawdown")) {
      // Loss-related metrics should be red even if positive (like max_drawdown)
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

export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [topSymbols, setTopSymbols] = useState<TopSymbol[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformance[]>([]);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMetricsConfig, setShowMetricsConfig] = useState(false);
  const [configKey, setConfigKey] = useState(0); // Force re-render when config changes
  const metricsConfigHook = useMetricsConfig();
  
  // Re-read enabled metrics from localStorage when config changes
  const [enabledMetrics, setEnabledMetrics] = useState(() => metricsConfigHook.getEnabledMetrics());
  
  useEffect(() => {
    // Re-read from localStorage when configKey changes (includes color range changes)
    const saved = localStorage.getItem("tradebutler_metrics_config");
    if (saved) {
      try {
        const allMetrics = JSON.parse(saved);
        const enabled = allMetrics.filter((m: any) => m.enabled);
        setEnabledMetrics(enabled);
      } catch {
        setEnabledMetrics(metricsConfigHook.getEnabledMetrics());
      }
    } else {
      setEnabledMetrics(metricsConfigHook.getEnabledMetrics());
    }
  }, [configKey, metricsConfigHook]);
  
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
  }, []);

  const loadDashboardData = async () => {
    try {
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const [metricsData, pnlData, strategiesData, tradesData] = await Promise.all([
        invoke<Metrics>("get_metrics", { pairingMethod }),
        invoke<SymbolPnL[]>("get_symbol_pnl", { pairingMethod }),
        invoke<StrategyPerformance[]>("get_strategy_performance"),
        invoke<RecentTrade[]>("get_recent_trades", { limit: 5 }),
      ]);
      setMetrics(metricsData);
      
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
    } catch (error) {
      console.error("Error loading dashboard data:", error);
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
    strategy_win_rate: metrics?.strategy_win_rate || 0,
    strategy_winning_trades: metrics?.strategy_winning_trades || 0,
    strategy_losing_trades: metrics?.strategy_losing_trades || 0,
    strategy_profit_loss: metrics?.strategy_profit_loss || 0,
    strategy_consecutive_wins: metrics?.strategy_consecutive_wins || 0,
    strategy_consecutive_losses: metrics?.strategy_consecutive_losses || 0,
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

      {/* Dashboard Stats Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "20px",
          marginBottom: "30px",
        }}
      >
        {/* Top Symbols */}
        {topSymbols.length > 0 && (
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <BarChart3 size={20} color="var(--accent)" />
              <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Top Symbols</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
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
                      ${symbol.estimated_pnl.toFixed(2)}
                    </p>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {symbol.trade_count} {symbol.trade_count === 1 ? "trade" : "trades"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Strategy Performance */}
        {strategyPerformance.length > 0 && (
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <TrendingUpIcon size={20} color="var(--accent)" />
              <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Strategy Performance</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {strategyPerformance.map((strategy) => (
                <div
                  key={strategy.strategy_id || "unassigned"}
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
                    <p style={{ fontWeight: "600", marginBottom: "4px" }}>{strategy.strategy_name}</p>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {strategy.trade_count} trades
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p
                      style={{
                        fontWeight: "600",
                        color: strategy.estimated_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                      }}
                    >
                      ${strategy.estimated_pnl.toFixed(2)}
                    </p>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      ${(strategy.total_volume / 1000).toFixed(1)}k vol
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Trades */}
        {recentTrades.length > 0 && (
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <Clock size={20} color="var(--accent)" />
              <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Recent Trades</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {recentTrades.map((trade) => (
                <div
                  key={trade.id}
                  style={{
                    padding: "12px",
                    backgroundColor: "var(--bg-tertiary)",
                    borderRadius: "6px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <p style={{ fontWeight: "600" }}>{trade.symbol}</p>
                    <p
                      style={{
                        fontSize: "14px",
                        color: trade.side === "BUY" ? "var(--profit)" : "var(--loss)",
                        fontWeight: "600",
                      }}
                    >
                      {trade.side}
                    </p>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <p style={{ color: "var(--text-secondary)" }}>
                      {trade.quantity} @ ${trade.price.toFixed(2)}
                    </p>
                    <p style={{ color: "var(--text-secondary)" }}>
                      {format(new Date(trade.timestamp), "MMM d, HH:mm")}
                    </p>
                  </div>
                  {trade.strategy_name && (
                    <p style={{ fontSize: "11px", color: "var(--accent)", marginTop: "4px" }}>
                      {trade.strategy_name}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

          <MetricsConfigPanel
            isOpen={showMetricsConfig}
            onClose={() => setShowMetricsConfig(false)}
            onConfigChange={() => setConfigKey(prev => prev + 1)}
          />
    </div>
  );
}
