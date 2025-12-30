import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";

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

export default function Analytics() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [symbolPnL, setSymbolPnL] = useState<SymbolPnL[]>([]);
  const [equityCurve, setEquityCurve] = useState<EquityCurveData | null>(null);
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

  useEffect(() => {
    loadData();
  }, [timeframe, customStartDate, customEndDate]);

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
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
      const startDate = dateRange.start ? dateRange.start.toISOString() : null;
      const endDate = dateRange.end ? dateRange.end.toISOString() : null;
      
      const [tradesData, pnlData, equityData] = await Promise.all([
        invoke<Trade[]>("get_trades"),
        invoke<SymbolPnL[]>("get_symbol_pnl", { pairingMethod, startDate, endDate }),
        invoke<EquityCurveData>("get_equity_curve", { pairingMethod, startDate, endDate }),
      ]);
      setTrades(tradesData);
      setSymbolPnL(pnlData);
      setEquityCurve(equityData);
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

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading analytics...</p>
      </div>
    );
  }

  const { symbolData, sideData } = processChartData();

  return (
    <div style={{ padding: "30px" }}>
      <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "20px" }}>
        Analytics
      </h1>
      
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
              <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "20px" }}>
                Equity Curve & Drawdown Analysis
              </h2>
              
              {/* Drawdown Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Max Drawdown</div>
                  <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--loss)" }}>
                    ${equityCurve.drawdown_metrics.max_drawdown.toFixed(2)}
                  </div>
                  <div style={{ fontSize: "14px", color: "var(--loss)" }}>
                    {equityCurve.drawdown_metrics.max_drawdown_pct.toFixed(2)}%
                  </div>
                </div>
                <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Avg Drawdown</div>
                  <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>
                    ${equityCurve.drawdown_metrics.avg_drawdown.toFixed(2)}
                  </div>
                </div>
                <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Longest Drawdown</div>
                  <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {equityCurve.drawdown_metrics.longest_drawdown_days} days
                  </div>
                  {equityCurve.drawdown_metrics.longest_drawdown_start && (
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
                      {equityCurve.drawdown_metrics.longest_drawdown_start} - {equityCurve.drawdown_metrics.longest_drawdown_end || "Ongoing"}
                    </div>
                  )}
                </div>
                {equityCurve.best_surge_start && (
                  <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Best Surge</div>
                    <div style={{ fontSize: "18px", fontWeight: "600", color: "var(--profit)" }}>
                      ${equityCurve.best_surge_value.toFixed(2)}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
                      {equityCurve.best_surge_start} - {equityCurve.best_surge_end || "Ongoing"}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Equity Curve Chart */}
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={equityCurve.equity_points.map(point => ({
                  ...point,
                  winning_streak_pnl: point.is_winning_streak ? point.cumulative_pnl : null,
                  losing_streak_pnl: point.is_losing_streak ? point.cumulative_pnl : null,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis 
                    dataKey="date" 
                    stroke="var(--text-secondary)"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis 
                    stroke="var(--text-secondary)"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-primary)",
                    }}
                    formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "Cumulative P&L"]}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Legend />
                  
                  {/* Highlight max drawdown zone */}
                  {equityCurve.drawdown_metrics.max_drawdown_start && equityCurve.drawdown_metrics.max_drawdown_end && (
                    <ReferenceArea
                      x1={equityCurve.drawdown_metrics.max_drawdown_start}
                      x2={equityCurve.drawdown_metrics.max_drawdown_end}
                      stroke="rgba(239, 68, 68, 0.3)"
                      fill="rgba(239, 68, 68, 0.1)"
                      label="Max Drawdown"
                    />
                  )}
                  
                  {/* Highlight best surge zone */}
                  {equityCurve.best_surge_start && equityCurve.best_surge_end && (
                    <ReferenceArea
                      x1={equityCurve.best_surge_start}
                      x2={equityCurve.best_surge_end}
                      stroke="rgba(34, 197, 94, 0.3)"
                      fill="rgba(34, 197, 94, 0.1)"
                      label="Best Surge"
                    />
                  )}
                  
                  {/* Cumulative P&L Line */}
                  <Line
                    type="monotone"
                    dataKey="cumulative_pnl"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                    name="Cumulative P&L"
                  />
                  
                  {/* Winning streak overlay */}
                  <Line
                    type="monotone"
                    dataKey="winning_streak_pnl"
                    stroke="rgba(34, 197, 94, 0.6)"
                    strokeWidth={6}
                    dot={false}
                    name="Winning Streak"
                    connectNulls={false}
                  />
                  
                  {/* Losing streak overlay */}
                  <Line
                    type="monotone"
                    dataKey="losing_streak_pnl"
                    stroke="rgba(239, 68, 68, 0.6)"
                    strokeWidth={6}
                    dot={false}
                    name="Losing Streak"
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
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
                          {pnl.open_position_qty > 0 ? pnl.open_position_qty.toFixed(4) : "—"}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          {pnl.closed_positions > 0 ? (
                            <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
                              {(pnl.win_rate * 100).toFixed(1)}%
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
                          ${pnl.total_gross_pnl.toFixed(2)}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "var(--text-secondary)" }}>
                          ${pnl.total_fees.toFixed(2)}
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
                          ${pnl.total_net_pnl.toFixed(2)}
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
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={symbolData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="symbol" stroke="var(--text-secondary)" />
                <YAxis stroke="var(--text-secondary)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                />
                <Bar dataKey="count" fill="var(--accent)" />
              </BarChart>
            </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sideData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" />
                <YAxis stroke="var(--text-secondary)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                />
                <Bar dataKey="value" fill="var(--accent)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

