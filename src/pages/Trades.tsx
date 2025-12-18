import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";

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

export default function Trades() {
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

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "MMM dd, yyyy HH:mm");
    } catch {
      return dateString;
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading trades...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "30px" }}>
      <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px" }}>
        Trades
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
          <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
            No trades found. Import a CSV file to get started.
          </p>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-color)" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Date
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Symbol
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Side
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Quantity
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Price
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Value
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Type
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr
                    key={trade.id}
                    style={{
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                      {formatDate(trade.timestamp)}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "14px", fontWeight: "600" }}>
                      {trade.symbol}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                      <span
                        style={{
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: "500",
                          backgroundColor:
                            trade.side === "BUY"
                              ? "var(--profit)"
                              : "var(--loss)",
                          color: "white",
                        }}
                      >
                        {trade.side}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                      {trade.quantity.toFixed(4)}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                      ${trade.price.toFixed(2)}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right", fontWeight: "600" }}>
                      ${(trade.quantity * trade.price).toFixed(2)}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "14px", color: "var(--text-secondary)" }}>
                      {trade.order_type}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                      <span
                        style={{
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          backgroundColor: "var(--bg-tertiary)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {trade.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

