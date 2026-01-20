import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, BarChart3, Lock, Unlock, Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { TradeChart } from "../components/TradeChart";

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
  notes?: string | null;
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
const STRATEGY_LOCK_STORAGE_KEY = "tradebutler_strategy_lock";

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
  const [selectedPairForChart, setSelectedPairForChart] = useState<PairedTrade | null>(null);
  const [selectedPositionTrades, setSelectedPositionTrades] = useState<Trade[] | undefined>(undefined);
  const [strategyLocked, setStrategyLocked] = useState<boolean>(() => {
    const saved = localStorage.getItem(STRATEGY_LOCK_STORAGE_KEY);
    return saved === "true";
  });
  const [positionGroupNotes, setPositionGroupNotes] = useState<Map<string, string>>(new Map());
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"date" | "symbol" | "pnl" | "price" | "quantity" | "trades">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

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
      
      // Load notes for closed position groups from paired trades
      const notesMap = new Map<string, string>();
      for (const group of positionsData) {
        if (group.final_quantity === 0 && group.position_trades.length >= 2) {
          const entryTrade = group.entry_trade;
          const lastTrade = group.position_trades[group.position_trades.length - 1];
          const pairKey = `${entryTrade.id}-${lastTrade.id}`;
          
          // Try to find notes from paired trades
          for (const item of tradesData) {
            for (const pair of [...item.entry_pairs, ...item.exit_pairs]) {
              if (pair.entry_trade_id === entryTrade.id && pair.exit_trade_id === lastTrade.id && pair.notes) {
                notesMap.set(pairKey, pair.notes);
                break;
              }
            }
          }
        }
      }
      setPositionGroupNotes(notesMap);
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
      // Update tradesWithPairing
      setTradesWithPairing((prev) =>
        prev.map((item) =>
          item.trade.id === tradeId
            ? { ...item, trade: { ...item.trade, strategy_id: strategyId } }
            : item
        )
      );
      // Update positionGroups if the trade is an entry trade
      setPositionGroups((prev) =>
        prev.map((group) =>
          group.entry_trade.id === tradeId
            ? {
                ...group,
                entry_trade: { ...group.entry_trade, strategy_id: strategyId },
              }
            : {
                ...group,
                position_trades: group.position_trades.map((trade) =>
                  trade.id === tradeId
                    ? { ...trade, strategy_id: strategyId }
                    : trade
                ),
              }
        )
      );
    } catch (error) {
      console.error("Error updating trade strategy:", error);
      alert("Failed to update strategy: " + error);
    }
  };

  const handleSort = (column: "date" | "symbol" | "pnl" | "price" | "quantity" | "trades") => {
    if (sortBy === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDirection("desc");
    }
  };

  const SortableHeader = ({ column, label, viewMode }: { column: "date" | "symbol" | "pnl" | "price" | "quantity" | "trades", label: string, viewMode: "Individual" | "Pair" }) => {
    const isActive = sortBy === column;
    const showInView = viewMode === "Pair" || column !== "trades";
    
    if (!showInView) return null;
    
    return (
      <th
        onClick={() => handleSort(column)}
        style={{
          padding: "12px 16px",
          textAlign: column === "pnl" || column === "price" || column === "quantity" || column === "trades" ? "right" : "left",
          fontSize: "12px",
          fontWeight: "600",
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          cursor: "pointer",
          userSelect: "none",
          backgroundColor: isActive ? "var(--bg-secondary)" : "var(--bg-tertiary)",
          transition: "background-color 0.2s",
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
          }
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: column === "pnl" || column === "price" || column === "quantity" || column === "trades" ? "flex-end" : "flex-start" }}>
          <span>{label}</span>
          {isActive && (
            sortDirection === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />
          )}
        </div>
      </th>
    );
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "MMM dd, yyyy HH:mm");
    } catch {
      return dateString;
    }
  };

  // Filter and sort trades for Individual view
  const filteredAndSortedTrades = useMemo(() => {
    let filtered = tradesWithPairing.filter((item) => {
      const trade = item.trade;
      const searchLower = searchQuery.toLowerCase();
      return (
        trade.symbol.toLowerCase().includes(searchLower) ||
        trade.side.toLowerCase().includes(searchLower) ||
        trade.order_type.toLowerCase().includes(searchLower) ||
        trade.status.toLowerCase().includes(searchLower) ||
        (trade.strategy_id !== null && strategies.find(s => s.id === trade.strategy_id)?.name.toLowerCase().includes(searchLower))
      );
    });

    // Sort the filtered trades
    filtered.sort((a, b) => {
      const tradeA = a.trade;
      const tradeB = b.trade;
      const relevantPairsA = tradeA.side === "BUY" ? a.exit_pairs : a.entry_pairs;
      const relevantPairsB = tradeB.side === "BUY" ? b.exit_pairs : b.entry_pairs;
      const totalPnLA = relevantPairsA.reduce((sum, p) => sum + p.net_profit_loss, 0);
      const totalPnLB = relevantPairsB.reduce((sum, p) => sum + p.net_profit_loss, 0);

      let comparison = 0;
      switch (sortBy) {
        case "date":
          comparison = new Date(tradeA.timestamp).getTime() - new Date(tradeB.timestamp).getTime();
          break;
        case "symbol":
          comparison = tradeA.symbol.localeCompare(tradeB.symbol);
          break;
        case "pnl":
          comparison = totalPnLA - totalPnLB;
          break;
        case "price":
          comparison = tradeA.price - tradeB.price;
          break;
        case "quantity":
          comparison = tradeA.quantity - tradeB.quantity;
          break;
        default:
          comparison = 0;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [tradesWithPairing, searchQuery, sortBy, sortDirection, strategies]);

  // Filter and sort position groups for Pair view
  const filteredAndSortedPositionGroups = useMemo(() => {
    let filtered = positionGroups.filter((group) => {
      const searchLower = searchQuery.toLowerCase();
      return (
        group.entry_trade.symbol.toLowerCase().includes(searchLower) ||
        group.entry_trade.side.toLowerCase().includes(searchLower) ||
        (group.entry_trade.strategy_id !== null && strategies.find(s => s.id === group.entry_trade.strategy_id)?.name.toLowerCase().includes(searchLower))
      );
    });

    // Sort the filtered position groups
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "date":
          comparison = new Date(a.entry_trade.timestamp).getTime() - new Date(b.entry_trade.timestamp).getTime();
          break;
        case "symbol":
          comparison = a.entry_trade.symbol.localeCompare(b.entry_trade.symbol);
          break;
        case "pnl":
          comparison = a.total_pnl - b.total_pnl;
          break;
        case "price":
          comparison = a.entry_trade.price - b.entry_trade.price;
          break;
        case "quantity":
          comparison = a.entry_trade.quantity - b.entry_trade.quantity;
          break;
        case "trades":
          comparison = a.position_trades.length - b.position_trades.length;
          break;
        default:
          comparison = 0;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [positionGroups, searchQuery, sortBy, sortDirection, strategies]);

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

      {/* Search and Sort Controls */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1", minWidth: "200px", maxWidth: "400px" }}>
          <Search
            size={18}
            style={{
              position: "absolute",
              left: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-secondary)",
            }}
          />
          <input
            type="text"
            placeholder="Search by symbol, side, type, status, or strategy..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px 10px 40px",
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--text-primary)",
              fontSize: "14px",
              outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{
              padding: "10px 12px",
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--text-primary)",
              fontSize: "14px",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="date">Entry Date</option>
            <option value="symbol">Symbol</option>
            <option value="pnl">P&L</option>
            <option value="price">Entry Price</option>
            <option value="quantity">Entry Quantity</option>
            {viewMode === "Pair" && <option value="trades">Trades</option>}
          </select>
          <button
            onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
            style={{
              padding: "10px 12px",
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--text-primary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title={`Sort ${sortDirection === "asc" ? "Ascending" : "Descending"}`}
          >
            <ArrowUpDown size={16} />
          </button>
        </div>
      </div>

      {viewMode === "Pair" ? (
        // Pair View Mode - Show only entry trades with position details
        filteredAndSortedPositionGroups.length === 0 ? (
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
                    <SortableHeader column="date" label="Entry Date" viewMode={viewMode} />
                    <SortableHeader column="symbol" label="Symbol" viewMode={viewMode} />
                    <SortableHeader column="quantity" label="Entry Qty" viewMode={viewMode} />
                    <SortableHeader column="price" label="Entry Price" viewMode={viewMode} />
                    <SortableHeader column="trades" label="Trades" viewMode={viewMode} />
                    <SortableHeader column="pnl" label="P&L" viewMode={viewMode} />
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      %
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>Strategy</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const newLocked = !strategyLocked;
                            setStrategyLocked(newLocked);
                            localStorage.setItem(STRATEGY_LOCK_STORAGE_KEY, String(newLocked));
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: "2px",
                            cursor: "pointer",
                            color: strategyLocked ? "#fbbf24" : "var(--text-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          title={strategyLocked ? "Unlock strategies to allow editing" : "Lock strategies to prevent editing"}
                        >
                          {strategyLocked ? <Lock size={14} /> : <Unlock size={14} />}
                        </button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedPositionGroups.map((group) => {
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
                          <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                            {group.final_quantity === 0 && group.position_trades.length >= 2 && (() => {
                              const entryPrice = group.entry_trade.price;
                              const lastTrade = group.position_trades[group.position_trades.length - 1];
                              const exitPrice = lastTrade.price;
                              const percentage = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
                              return (
                                <span
                                  style={{
                                    fontWeight: "600",
                                    color: percentage >= 0 ? "var(--profit)" : "var(--loss)",
                                  }}
                                >
                                  {percentage >= 0 ? "+" : ""}{percentage.toFixed(2)}%
                                </span>
                              );
                            })()}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px" }}>
                            <select
                              value={group.entry_trade.strategy_id ? String(group.entry_trade.strategy_id) : ""}
                              onChange={(e) => {
                                e.stopPropagation();
                                const newStrategyId = e.target.value ? parseInt(e.target.value, 10) : null;
                                handleStrategyChange(group.entry_trade.id, newStrategyId);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              disabled={strategyLocked && group.entry_trade.strategy_id !== null}
                              style={{
                                padding: "6px 10px",
                                backgroundColor: strategyLocked && group.entry_trade.strategy_id !== null 
                                  ? "var(--bg-secondary)" 
                                  : "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: strategyLocked && group.entry_trade.strategy_id !== null
                                  ? "var(--text-secondary)"
                                  : "var(--text-primary)",
                                fontSize: "13px",
                                cursor: strategyLocked && group.entry_trade.strategy_id !== null 
                                  ? "not-allowed" 
                                  : "pointer",
                                minWidth: "120px",
                                outline: "none",
                                opacity: strategyLocked && group.entry_trade.strategy_id !== null ? 0.6 : 1,
                              }}
                            >
                              <option value="">Unassigned</option>
                              {strategies.map((strategy) => (
                                <option key={strategy.id} value={String(strategy.id)}>
                                  {strategy.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${group.entry_trade.id}-details`}>
                            <td colSpan={10} style={{ padding: "0", backgroundColor: "var(--bg-tertiary)" }}>
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
                                {/* Add View Chart button and Notes for closed positions */}
                                {group.final_quantity === 0 && group.position_trades.length >= 2 && (
                                  <div style={{ marginTop: "16px" }}>
                                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          // Find entry and exit trades
                                          const entryTrade = group.entry_trade;
                                          const lastTrade = group.position_trades[group.position_trades.length - 1];
                                          
                                          // Create a PairedTrade-like object for the chart
                                          const chartPair: PairedTrade = {
                                            symbol: entryTrade.symbol,
                                            entry_trade_id: entryTrade.id,
                                            exit_trade_id: lastTrade.id,
                                            quantity: Math.min(entryTrade.quantity, lastTrade.quantity),
                                            entry_price: entryTrade.price,
                                            exit_price: lastTrade.price,
                                            entry_timestamp: entryTrade.timestamp,
                                            exit_timestamp: lastTrade.timestamp,
                                            gross_profit_loss: 0, // Not needed for chart
                                            entry_fees: entryTrade.fees || 0,
                                            exit_fees: lastTrade.fees || 0,
                                            net_profit_loss: group.total_pnl,
                                            strategy_id: entryTrade.strategy_id,
                                            notes: positionGroupNotes.get(`${entryTrade.id}-${lastTrade.id}`) || null,
                                          };
                                          setSelectedPairForChart(chartPair);
                                          // Pass all position trades for detailed markers
                                          setSelectedPositionTrades(group.position_trades);
                                        }}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "6px",
                                          padding: "8px 16px",
                                          backgroundColor: "var(--accent)",
                                          border: "none",
                                          borderRadius: "4px",
                                          color: "white",
                                          fontSize: "13px",
                                          fontWeight: "500",
                                          cursor: "pointer",
                                          transition: "opacity 0.2s",
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.opacity = "0.8";
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.opacity = "1";
                                        }}
                                      >
                                        <BarChart3 size={16} />
                                        View Chart
                                      </button>
                                    </div>
                                    <div>
                                      <label style={{ display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                                        Notes
                                      </label>
                                      <textarea
                                        value={positionGroupNotes.get(`${group.entry_trade.id}-${group.position_trades[group.position_trades.length - 1].id}`) || ""}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          const newNotes = e.target.value;
                                          const entryTrade = group.entry_trade;
                                          const lastTrade = group.position_trades[group.position_trades.length - 1];
                                          const pairKey = `${entryTrade.id}-${lastTrade.id}`;
                                          
                                          // Update local state
                                          setPositionGroupNotes((prev) => {
                                            const newMap = new Map(prev);
                                            if (newNotes) {
                                              newMap.set(pairKey, newNotes);
                                            } else {
                                              newMap.delete(pairKey);
                                            }
                                            return newMap;
                                          });
                                          
                                          // Save to database
                                          invoke("save_pair_notes", {
                                            entryTradeId: entryTrade.id,
                                            exitTradeId: lastTrade.id,
                                            notes: newNotes || null,
                                          }).catch((err) => {
                                            console.error("Failed to save pair notes:", err);
                                          });
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        placeholder="Add notes for this position..."
                                        style={{
                                          width: "100%",
                                          minHeight: "60px",
                                          padding: "8px",
                                          backgroundColor: "var(--bg-tertiary)",
                                          border: "1px solid var(--border-color)",
                                          borderRadius: "4px",
                                          color: "var(--text-primary)",
                                          fontSize: "13px",
                                          fontFamily: "inherit",
                                          resize: "vertical",
                                          outline: "none",
                                        }}
                                      />
                                    </div>
                                  </div>
                                )}
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
                  <SortableHeader column="date" label="Date" viewMode={viewMode} />
                  <SortableHeader column="symbol" label="Symbol" viewMode={viewMode} />
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Side
                  </th>
                  <SortableHeader column="quantity" label="Quantity" viewMode={viewMode} />
                  <SortableHeader column="price" label="Price" viewMode={viewMode} />
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Value
                  </th>
                  <SortableHeader column="pnl" label="P&L" viewMode={viewMode} />
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Type
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    Status
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>Strategy</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const newLocked = !strategyLocked;
                          setStrategyLocked(newLocked);
                          localStorage.setItem(STRATEGY_LOCK_STORAGE_KEY, String(newLocked));
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "2px",
                          cursor: "pointer",
                          color: strategyLocked ? "var(--accent)" : "var(--text-secondary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        title={strategyLocked ? "Unlock strategies to allow editing" : "Lock strategies to prevent editing"}
                      >
                        {strategyLocked ? <Lock size={14} /> : <Unlock size={14} />}
                      </button>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedTrades.map((item) => {
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
                            value={trade.strategy_id ? String(trade.strategy_id) : ""}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newStrategyId = e.target.value ? parseInt(e.target.value, 10) : null;
                              handleStrategyChange(trade.id, newStrategyId);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            disabled={strategyLocked && trade.strategy_id !== null}
                            style={{
                              padding: "6px 10px",
                              backgroundColor: strategyLocked && trade.strategy_id !== null 
                                ? "var(--bg-secondary)" 
                                : "var(--bg-tertiary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              color: strategyLocked && trade.strategy_id !== null
                                ? "var(--text-secondary)"
                                : "var(--text-primary)",
                              fontSize: "13px",
                              cursor: strategyLocked && trade.strategy_id !== null 
                                ? "not-allowed" 
                                : "pointer",
                              minWidth: "120px",
                              outline: "none",
                              opacity: strategyLocked && trade.strategy_id !== null ? 0.6 : 1,
                            }}
                          >
                            <option value="">Unassigned</option>
                            {strategies.map((strategy) => (
                              <option key={strategy.id} value={String(strategy.id)}>
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
                                    <div style={{ gridColumn: "1 / -1", paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
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
                                          <div>
                                            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Return: </span>
                                            <span
                                              style={{
                                                fontSize: "16px",
                                                fontWeight: "600",
                                                color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                                              }}
                                            >
                                              {(() => {
                                                const percentage = pair.entry_price > 0 ? ((pair.exit_price - pair.entry_price) / pair.entry_price) * 100 : 0;
                                                return `${percentage >= 0 ? "+" : ""}${percentage.toFixed(2)}%`;
                                              })()}
                                            </span>
                                          </div>
                                        </div>
                                        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                                          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                            Gross: ${pair.gross_profit_loss.toFixed(2)}
                                          </div>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedPairForChart(pair);
                                            }}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "6px",
                                              padding: "6px 12px",
                                              backgroundColor: "var(--accent)",
                                              border: "none",
                                              borderRadius: "4px",
                                              color: "white",
                                              fontSize: "12px",
                                              fontWeight: "500",
                                              cursor: "pointer",
                                              transition: "opacity 0.2s",
                                            }}
                                            onMouseEnter={(e) => {
                                              e.currentTarget.style.opacity = "0.8";
                                            }}
                                            onMouseLeave={(e) => {
                                              e.currentTarget.style.opacity = "1";
                                            }}
                                          >
                                            <BarChart3 size={14} />
                                            View Chart
                                          </button>
                                        </div>
                                      </div>
                                      <div style={{ marginTop: "12px" }}>
                                        <label style={{ display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                                          Notes
                                        </label>
                                        <textarea
                                          value={pair.notes || ""}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            const newNotes = e.target.value;
                                            
                                            // Update the trade's pairs
                                            setTradesWithPairing((prev) =>
                                              prev.map((item) => {
                                                if (trade.side === "BUY") {
                                                  return { ...item, exit_pairs: item.exit_pairs.map((p) =>
                                                    p.entry_trade_id === pair.entry_trade_id && p.exit_trade_id === pair.exit_trade_id
                                                      ? { ...p, notes: newNotes }
                                                      : p
                                                  )};
                                                } else {
                                                  return { ...item, entry_pairs: item.entry_pairs.map((p) =>
                                                    p.entry_trade_id === pair.entry_trade_id && p.exit_trade_id === pair.exit_trade_id
                                                      ? { ...p, notes: newNotes }
                                                      : p
                                                  )};
                                                }
                                              })
                                            );
                                            
                                            // Save to database
                                            invoke("save_pair_notes", {
                                              entryTradeId: pair.entry_trade_id,
                                              exitTradeId: pair.exit_trade_id,
                                              notes: newNotes || null,
                                            }).catch((err) => {
                                              console.error("Failed to save pair notes:", err);
                                            });
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          onMouseDown={(e) => e.stopPropagation()}
                                          placeholder="Add notes for this trade pair..."
                                          style={{
                                            width: "100%",
                                            minHeight: "60px",
                                            padding: "8px",
                                            backgroundColor: "var(--bg-tertiary)",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: "4px",
                                            color: "var(--text-primary)",
                                            fontSize: "13px",
                                            fontFamily: "inherit",
                                            resize: "vertical",
                                            outline: "none",
                                          }}
                                        />
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
      {selectedPairForChart && (
        <TradeChart
          symbol={selectedPairForChart.symbol}
          entryTimestamp={selectedPairForChart.entry_timestamp}
          exitTimestamp={selectedPairForChart.exit_timestamp}
          entryPrice={selectedPairForChart.entry_price}
          exitPrice={selectedPairForChart.exit_price}
          onClose={() => {
            setSelectedPairForChart(null);
            setSelectedPositionTrades(undefined);
          }}
          positionTrades={selectedPositionTrades}
        />
      )}
    </div>
  );
}
