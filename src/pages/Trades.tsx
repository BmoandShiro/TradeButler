import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
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
  strategy_id: number | null;
}

interface PairedTrade {
  symbol: string;
  entry_trade_id: number;
  exit_trade_id: number;
  quantity: number;
  entry_price: number;
  exit_price: number;
  entry_timestamp: string;
  exit_timestamp: string;
  gross_profit_loss: number;
  entry_fees: number;
  exit_fees: number;
  net_profit_loss: number;
  strategy_id: number | null;
}

interface TradeWithPairing {
  trade: Trade;
  entry_pairs: PairedTrade[]; // Pairs where this trade is the entry (BUY)
  exit_pairs: PairedTrade[];  // Pairs where this trade is the exit (SELL)
}

interface Strategy {
  id: number;
  name: string;
  color: string | null;
}

const PAIRING_STORAGE_KEY = "tradebutler_pairing_method";
const VIEW_MODE_STORAGE_KEY = "tradebutler_view_mode";

interface PositionGroup {
  entry_trade: Trade;
  position_trades: Trade[];
  total_pnl: number;
  final_quantity: number;
}

export default function Trades() {
  const [tradesWithPairing, setTradesWithPairing] = useState<TradeWithPairing[]>([]);
  const [positionGroups, setPositionGroups] = useState<PositionGroup[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairingMethod, setPairingMethod] = useState<"FIFO" | "LIFO">(() => {
    const saved = localStorage.getItem(PAIRING_STORAGE_KEY);
    return (saved === "LIFO" ? "LIFO" : "FIFO") as "FIFO" | "LIFO";
  });
  const [viewMode, setViewMode] = useState<"Individual" | "Pair">(() => {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return (saved === "Pair" ? "Pair" : "Individual") as "Individual" | "Pair";
  });
  const [expandedTrades, setExpandedTrades] = useState<Set<number>>(new Set());
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const saved = localStorage.getItem("tradebutler_trades_timeframe");
    return (saved as Timeframe) || "all";
  });
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_trades_custom_start") || "";
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return localStorage.getItem("tradebutler_trades_custom_end") || "";
  });

  useEffect(() => {
    loadData();
  }, [pairingMethod, viewMode, timeframe, customStartDate, customEndDate]);
  
  useEffect(() => {
    localStorage.setItem("tradebutler_trades_timeframe", timeframe);
  }, [timeframe]);
  
  useEffect(() => {
    if (customStartDate) {
      localStorage.setItem("tradebutler_trades_custom_start", customStartDate);
    } else {
      localStorage.removeItem("tradebutler_trades_custom_start");
    }
    if (customEndDate) {
      localStorage.setItem("tradebutler_trades_custom_end", customEndDate);
    } else {
      localStorage.removeItem("tradebutler_trades_custom_end");
    }
  }, [customStartDate, customEndDate]);

  const loadData = async () => {
    try {
      const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
      const startDate = dateRange.start ? dateRange.start.toISOString() : null;
      const endDate = dateRange.end ? dateRange.end.toISOString() : null;
      
      const [tradesData, positionsData, strategiesData] = await Promise.all([
        invoke<TradeWithPairing[]>("get_trades_with_pairing", { pairing_method: pairingMethod, startDate, endDate }),
        invoke<PositionGroup[]>("get_position_groups", { pairing_method: pairingMethod, startDate, endDate }),
        invoke<Strategy[]>("get_strategies"),
      ]);
      setTradesWithPairing(tradesData);
      setPositionGroups(positionsData);
      setStrategies(strategiesData);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewModeChange = (mode: "Individual" | "Pair") => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  };

  const handlePairingMethodChange = (method: "FIFO" | "LIFO") => {
    setPairingMethod(method);
    localStorage.setItem(PAIRING_STORAGE_KEY, method);
  };

  const toggleTradeExpansion = (tradeId: number) => {
    setExpandedTrades((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(tradeId)) {
        newSet.delete(tradeId);
      } else {
        newSet.add(tradeId);
      }
      return newSet;
    });
  };

  const handleStrategyChange = async (tradeId: number, strategyId: number | null) => {
    try {
      await invoke("update_trade_strategy", { tradeId, strategyId });
      setTradesWithPairing((prev) =>
        prev.map((item) =>
          item.trade.id === tradeId
            ? { ...item, trade: { ...item.trade, strategy_id: strategyId } }
            : item
        )
      );
    } catch (error) {
      console.error("Error updating trade strategy:", error);
      alert("Failed to update strategy: " + error);
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Trades</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>View:</span>
            <div
              style={{
                display: "flex",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "6px",
                padding: "2px",
                border: "1px solid var(--border-color)",
              }}
            >
              <button
                onClick={() => handleViewModeChange("Individual")}
                style={{
                  padding: "6px 12px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  border: "none",
                  backgroundColor: viewMode === "Individual" ? "var(--accent)" : "transparent",
                  color: viewMode === "Individual" ? "white" : "var(--text-primary)",
                  transition: "all 0.2s",
                }}
              >
                Individual
              </button>
              <button
                onClick={() => handleViewModeChange("Pair")}
                style={{
                  padding: "6px 12px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  border: "none",
                  backgroundColor: viewMode === "Pair" ? "var(--accent)" : "transparent",
                  color: viewMode === "Pair" ? "white" : "var(--text-primary)",
                  transition: "all 0.2s",
                }}
              >
                Pair
              </button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Pairing Method:</span>
            <div
              style={{
                display: "flex",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "6px",
                padding: "2px",
                border: "1px solid var(--border-color)",
              }}
            >
              <button
                onClick={() => handlePairingMethodChange("FIFO")}
                style={{
                  padding: "6px 12px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  border: "none",
                  backgroundColor: pairingMethod === "FIFO" ? "var(--accent)" : "transparent",
                  color: pairingMethod === "FIFO" ? "white" : "var(--text-primary)",
                  transition: "all 0.2s",
                }}
              >
                FIFO
              </button>
              <button
                onClick={() => handlePairingMethodChange("LIFO")}
                style={{
                  padding: "6px 12px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  border: "none",
                  backgroundColor: pairingMethod === "LIFO" ? "var(--accent)" : "transparent",
                  color: pairingMethod === "LIFO" ? "white" : "var(--text-primary)",
                  transition: "all 0.2s",
                }}
              >
                LIFO
              </button>
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginBottom: "30px" }}>
        <TimeframeSelector
          value={timeframe}
          onChange={setTimeframe}
          customStartDate={customStartDate}
          customEndDate={customEndDate}
            onCustomDatesChange={(start, end) => {
              // Ensure we save the dates immediately
              setCustomStartDate(start || "");
              setCustomEndDate(end || "");
              // Also save directly to localStorage to ensure persistence
              if (start) {
                localStorage.setItem("tradebutler_trades_custom_start", start);
              } else {
                localStorage.removeItem("tradebutler_trades_custom_start");
              }
              if (end) {
                localStorage.setItem("tradebutler_trades_custom_end", end);
              } else {
                localStorage.removeItem("tradebutler_trades_custom_end");
              }
            }}
        />
      </div>

      {viewMode === "Pair" ? (
        // Pair View Mode - Show only entry trades with position details
        positionGroups.length === 0 ? (
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
              No positions found. Import trades to see position groups.
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
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", width: "40px" }}>
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Entry Date
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Symbol
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Entry Qty
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Entry Price
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Trades
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      P&L
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Strategy
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {positionGroups.map((group) => {
                    const isExpanded = expandedTrades.has(group.entry_trade.id);
                    return (
                      <>
                        <tr
                          key={group.entry_trade.id}
                          style={{
                            borderBottom: "1px solid var(--border-color)",
                            cursor: "pointer",
                          }}
                          onClick={() => toggleTradeExpansion(group.entry_trade.id)}
                        >
                          <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                            {formatDate(group.entry_trade.timestamp)}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px", fontWeight: "600" }}>
                            {group.entry_trade.symbol}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                            {group.entry_trade.quantity.toFixed(4)}
                            {group.entry_trade.side.toUpperCase() === "SELL" && (
                              <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "4px" }}>
                                (Short)
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                            ${group.entry_trade.price.toFixed(2)}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                            {group.position_trades.length}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                            <span
                              style={{
                                fontWeight: "600",
                                color: group.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                              }}
                            >
                              {group.total_pnl >= 0 ? "+" : ""}${group.total_pnl.toFixed(2)}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                            <select
                              value={group.entry_trade.strategy_id || ""}
                              onChange={(e) =>
                                handleStrategyChange(
                                  group.entry_trade.id,
                                  e.target.value ? parseInt(e.target.value) : null
                                )
                              }
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                padding: "6px 10px",
                                backgroundColor: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                fontSize: "13px",
                                cursor: "pointer",
                                minWidth: "120px",
                              }}
                            >
                              <option value="">Unassigned</option>
                              {strategies.map((strategy) => (
                                <option key={strategy.id} value={strategy.id}>
                                  {strategy.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${group.entry_trade.id}-details`}>
                            <td colSpan={9} style={{ padding: "0", backgroundColor: "var(--bg-tertiary)" }}>
                              <div style={{ padding: "20px" }}>
                                <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>
                                  Position Trades ({group.position_trades.length})
                                </h3>
                                <div style={{ overflowX: "auto" }}>
                                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                      <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                                        <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                          Date
                                        </th>
                                        <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                          Side
                                        </th>
                                        <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                          Quantity
                                        </th>
                                        <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                          Price
                                        </th>
                                        <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                          Value
                                        </th>
                                        <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                                          Position Size
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.position_trades.map((trade, idx) => {
                                        // Calculate position size (running quantity)
                                        // BUY adds to position (positive for long), SELL subtracts (can go negative for short)
                                        // Start from 0, then accumulate based on trades in chronological order
                                        let positionSize = 0;
                                        for (let i = 0; i <= idx; i++) {
                                          const t = group.position_trades[i];
                                          // BUY increases position (more long or less short)
                                          // SELL decreases position (less long or more short)
                                          const sideUpper = t.side.toUpperCase();
                                          if (sideUpper === "BUY") {
                                            positionSize += t.quantity;
                                          } else if (sideUpper === "SELL") {
                                            positionSize -= t.quantity;
                                          }
                                        }
                                        
                                        const isLong = positionSize > 0.0001;
                                        const isShort = positionSize < -0.0001;
                                        const isClosed = Math.abs(positionSize) < 0.0001;
                                        
                                        return (
                                          <tr
                                            key={trade.id}
                                            style={{
                                              borderBottom: "1px solid var(--border-color)",
                                              backgroundColor: idx === 0 ? "var(--bg-secondary)" : "transparent",
                                            }}
                                          >
                                            <td style={{ padding: "8px 12px", fontSize: "13px" }}>
                                              {formatDate(trade.timestamp)}
                                            </td>
                                            <td style={{ padding: "8px 12px", fontSize: "13px" }}>
                                              <span
                                                style={{
                                                  padding: "3px 6px",
                                                  borderRadius: "3px",
                                                  fontSize: "11px",
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
                                            <td style={{ padding: "8px 12px", fontSize: "13px", textAlign: "right" }}>
                                              {trade.quantity.toFixed(4)}
                                            </td>
                                            <td style={{ padding: "8px 12px", fontSize: "13px", textAlign: "right" }}>
                                              ${trade.price.toFixed(2)}
                                            </td>
                                            <td style={{ padding: "8px 12px", fontSize: "13px", textAlign: "right" }}>
                                              ${(trade.quantity * trade.price).toFixed(2)}
                                            </td>
                                            <td style={{ 
                                              padding: "8px 12px", 
                                              fontSize: "13px", 
                                              textAlign: "right",
                                              color: isClosed 
                                                ? "var(--text-secondary)" 
                                                : isLong 
                                                  ? "var(--profit)" 
                                                  : "var(--loss)",
                                              fontWeight: isClosed ? "normal" : "600"
                                            }}>
                                              {isClosed ? "0.0000" : (positionSize > 0 ? "+" : "") + positionSize.toFixed(4)}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : tradesWithPairing.length === 0 ? (
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
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", width: "40px" }}>
                  </th>
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
                    P&L
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Type
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Status
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Strategy
                  </th>
                </tr>
              </thead>
              <tbody>
                {tradesWithPairing.map((item) => {
                  const trade = item.trade;
                  // For BUY trades, show pairs where this is the entry (exit_pairs)
                  // For SELL trades, show pairs where this is the exit (entry_pairs)
                  const relevantPairs = trade.side === "BUY" ? item.exit_pairs : item.entry_pairs;
                  const hasPairs = relevantPairs.length > 0;
                  const isExpanded = expandedTrades.has(trade.id);
                  const totalPnL = relevantPairs.reduce((sum, p) => sum + p.net_profit_loss, 0);

                  return (
                    <>
                      <tr
                        key={trade.id}
                        style={{
                          borderBottom: "1px solid var(--border-color)",
                          cursor: hasPairs ? "pointer" : "default",
                        }}
                        onClick={() => hasPairs && toggleTradeExpansion(trade.id)}
                      >
                        <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                          {hasPairs && (
                            isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                          )}
                        </td>
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
                        <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                          {hasPairs && (
                            <span
                              style={{
                                fontWeight: "600",
                                color: totalPnL >= 0 ? "var(--profit)" : "var(--loss)",
                              }}
                            >
                              {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}
                            </span>
                          )}
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
                        <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                          <select
                            value={trade.strategy_id || ""}
                            onChange={(e) =>
                              handleStrategyChange(
                                trade.id,
                                e.target.value ? parseInt(e.target.value) : null
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              padding: "6px 10px",
                              backgroundColor: "var(--bg-tertiary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              color: "var(--text-primary)",
                              fontSize: "13px",
                              cursor: "pointer",
                              minWidth: "120px",
                            }}
                          >
                            <option value="">Unassigned</option>
                            {strategies.map((strategy) => (
                              <option key={strategy.id} value={strategy.id}>
                                {strategy.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                      {isExpanded && hasPairs && relevantPairs.length > 0 && (
                        <tr key={`${trade.id}-details`}>
                          <td colSpan={11} style={{ padding: "0", backgroundColor: "var(--bg-tertiary)" }}>
                            <div style={{ padding: "20px" }}>
                              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>
                                {trade.side === "BUY" ? "Exit Pairs" : "Entry Pairs"} ({relevantPairs.length})
                              </h3>
                              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                {relevantPairs.map((pair, idx) => (
                                  <div
                                    key={idx}
                                    style={{
                                      padding: "16px",
                                      backgroundColor: "var(--bg-secondary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "6px",
                                      display: "grid",
                                      gridTemplateColumns: "1fr 1fr",
                                      gap: "16px",
                                    }}
                                  >
                                    <div>
                                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                                        {trade.side === "BUY" ? "EXIT" : "ENTRY"}
                                      </div>
                                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Date:</span>
                                          <span>{formatDate(trade.side === "BUY" ? pair.exit_timestamp : pair.entry_timestamp)}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Price:</span>
                                          <span>${(trade.side === "BUY" ? pair.exit_price : pair.entry_price).toFixed(2)}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Quantity:</span>
                                          <span>{pair.quantity.toFixed(4)}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Fees:</span>
                                          <span>${(trade.side === "BUY" ? pair.exit_fees : pair.entry_fees).toFixed(2)}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                                        {trade.side === "BUY" ? "ENTRY" : "EXIT"}
                                      </div>
                                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Date:</span>
                                          <span>{formatDate(trade.side === "BUY" ? pair.entry_timestamp : pair.exit_timestamp)}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Price:</span>
                                          <span>${(trade.side === "BUY" ? pair.entry_price : pair.exit_price).toFixed(2)}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Quantity:</span>
                                          <span>{pair.quantity.toFixed(4)}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Fees:</span>
                                          <span>${(trade.side === "BUY" ? pair.entry_fees : pair.exit_fees).toFixed(2)}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div style={{ gridColumn: "1 / -1", paddingTop: "12px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <div>
                                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Net P&L: </span>
                                        <span
                                          style={{
                                            fontSize: "16px",
                                            fontWeight: "600",
                                            color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "4px",
                                          }}
                                        >
                                          {pair.net_profit_loss >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                          {pair.net_profit_loss >= 0 ? "+" : ""}${pair.net_profit_loss.toFixed(2)}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                        Gross: ${pair.gross_profit_loss.toFixed(2)}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
