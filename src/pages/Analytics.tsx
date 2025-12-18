import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

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

export default function Analytics() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTrades();
  }, []);

  const loadTrades = async () => {
    try {
      const data = await invoke<Trade[]>("get_trades");
      setTrades(data);
    } catch (error) {
      console.error("Error loading trades:", error);
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

