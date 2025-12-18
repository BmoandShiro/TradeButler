import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";

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

export default function Analytics() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [symbolPnL, setSymbolPnL] = useState<SymbolPnL[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const [tradesData, pnlData] = await Promise.all([
        invoke<Trade[]>("get_trades"),
        invoke<SymbolPnL[]>("get_symbol_pnl", { pairingMethod }),
      ]);
      setTrades(tradesData);
      setSymbolPnL(pnlData);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Process trades for charts
  const processChartData = () => {
    const symbolCounts: Record<string, number> = {};
    const sideCounts: Record<string, number> = { BUY: 0, SELL: 0 };

    trades.forEach((trade) => {
      symbolCounts[trade.symbol] = (symbolCounts[trade.symbol] || 0) + 1;
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
      <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px" }}>
        Analytics
      </h1>

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

