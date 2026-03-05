import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, BarChart3, Lock, Unlock, Search, ArrowUpDown, ArrowUp, ArrowDown, Trash2, Filter } from "lucide-react";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { TradeChart } from "../components/TradeChart";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { formatWithCommas } from "../utils/formatCompactNumber";
import { loadSandboxState, deleteSandboxTrade, updateSandboxTradeStrategy, updateSandboxTradeNotes } from "../utils/sandboxStore";
import { buildPositionGroupsAndPairs } from "../utils/sandboxPairing";

interface JournalEntrySummary {
  id: number;
  date: string;
  title: string;
}

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
const HIDE_PNL_DOLLARS_STORAGE_KEY = "tradebutler_hide_pnl_dollars";
const HIDE_PNL_PERCENT_STORAGE_KEY = "tradebutler_hide_pnl_percent";
const STRATEGY_LOCK_STORAGE_KEY = "tradebutler_strategy_lock";
const DELETE_LOCK_STORAGE_KEY = "tradebutler_delete_lock";
const FILTER_SYMBOL_KEY = "tradebutler_filter_symbol";
const FILTER_SIDE_KEY = "tradebutler_filter_side";
const FILTER_TYPE_KEY = "tradebutler_filter_type";
const FILTER_STATUS_KEY = "tradebutler_filter_status";
const FILTER_STRATEGY_KEY = "tradebutler_filter_strategy";
const FILTER_PCT_MIN_KEY = "tradebutler_filter_pct_min";
const FILTER_PCT_MAX_KEY = "tradebutler_filter_pct_max";
const FILTER_PNL_MIN_KEY = "tradebutler_filter_pnl_min";
const FILTER_PNL_MAX_KEY = "tradebutler_filter_pnl_max";
const FILTER_POSITION_SIZE_MIN_KEY = "tradebutler_filter_position_size_min";
const FILTER_POSITION_SIZE_MAX_KEY = "tradebutler_filter_position_size_max";
const SORT_SECONDARY_KEY = "tradebutler_sort_secondary";

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
  const [deleteLocked, setDeleteLocked] = useState<boolean>(() => {
    const saved = localStorage.getItem(DELETE_LOCK_STORAGE_KEY);
    return saved === "true";
  });
  const [positionGroupNotes, setPositionGroupNotes] = useState<Map<string, string>>(new Map());
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    const saved = localStorage.getItem('trades_search_query');
    return saved || "";
  });
  const [sortBy, setSortBy] = useState<"date" | "symbol" | "pnl" | "price" | "quantity" | "trades" | "type" | "status" | "percent" | "position_size">(() => {
    const saved = localStorage.getItem('trades_sort_by');
    return (saved as "date" | "symbol" | "pnl" | "price" | "quantity" | "trades" | "type" | "status" | "percent" | "position_size") || "date";
  });
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(() => {
    const saved = localStorage.getItem('trades_sort_direction');
    return (saved as "asc" | "desc") || "desc";
  });
  const [sortBySecondary, setSortBySecondary] = useState<"none" | "date" | "symbol" | "pnl" | "price" | "quantity" | "trades" | "type" | "status" | "percent" | "position_size">(() => {
    const saved = localStorage.getItem(SORT_SECONDARY_KEY);
    return (saved as "none" | "date" | "symbol" | "pnl" | "price" | "quantity" | "trades" | "type" | "status" | "percent" | "position_size") || "none";
  });
  const [filterSymbol, setFilterSymbol] = useState<string>(() => localStorage.getItem(FILTER_SYMBOL_KEY) || "");
  const [filterSide, setFilterSide] = useState<string>(() => localStorage.getItem(FILTER_SIDE_KEY) || "");
  const [filterType, setFilterType] = useState<string>(() => localStorage.getItem(FILTER_TYPE_KEY) || "");
  const [filterStatus, setFilterStatus] = useState<string>(() => localStorage.getItem(FILTER_STATUS_KEY) || "");
  const [filterStrategy, setFilterStrategy] = useState<string>(() => localStorage.getItem(FILTER_STRATEGY_KEY) || "");
  const [filterPctMin, setFilterPctMin] = useState<string>(() => localStorage.getItem(FILTER_PCT_MIN_KEY) || "");
  const [filterPctMax, setFilterPctMax] = useState<string>(() => localStorage.getItem(FILTER_PCT_MAX_KEY) || "");
  const [filterPnlMin, setFilterPnlMin] = useState<string>(() => localStorage.getItem(FILTER_PNL_MIN_KEY) || "");
  const [filterPnlMax, setFilterPnlMax] = useState<string>(() => localStorage.getItem(FILTER_PNL_MAX_KEY) || "");
  const [filterPositionSizeMin, setFilterPositionSizeMin] = useState<string>(() => localStorage.getItem(FILTER_POSITION_SIZE_MIN_KEY) || "");
  const [filterPositionSizeMax, setFilterPositionSizeMax] = useState<string>(() => localStorage.getItem(FILTER_POSITION_SIZE_MAX_KEY) || "");
  const [openFilterSymbol, setOpenFilterSymbol] = useState(false);
  const [symbolSearch, setSymbolSearch] = useState("");
  const [openFilterType, setOpenFilterType] = useState(false);
  const [openFilterStatus, setOpenFilterStatus] = useState(false);
  const [openFilterStrategy, setOpenFilterStrategy] = useState(false);
  const [hidePnlDollars, setHidePnlDollars] = useState<boolean>(() => {
    const dollars = localStorage.getItem(HIDE_PNL_DOLLARS_STORAGE_KEY);
    if (dollars !== null) return dollars === "true";
    const legacy = localStorage.getItem("tradebutler_hide_pnl") === "true";
    if (legacy) localStorage.removeItem("tradebutler_hide_pnl");
    return legacy;
  });
  const [hidePnlPercent, setHidePnlPercent] = useState<boolean>(() => {
    const percent = localStorage.getItem(HIDE_PNL_PERCENT_STORAGE_KEY);
    if (percent !== null) return percent === "true";
    const legacy = localStorage.getItem("tradebutler_hide_pnl") === "true";
    return legacy;
  });
  const [openJournalPairKey, setOpenJournalPairKey] = useState<string | null>(null);
  const [journalEntriesByPairKey, setJournalEntriesByPairKey] = useState<Record<string, JournalEntrySummary[]>>({});
  const [journalPairPage, setJournalPairPage] = useState<number>(0);
  const navigate = useNavigate();
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  /** Trade IDs selected for bulk "Mark as paper" / "Remove paper" (checkboxes in Paper column). */
  const [selectedTradeIdsForPaper, setSelectedTradeIdsForPaper] = useState<Set<number>>(new Set());
  const stickyBarRef = useRef<HTMLDivElement>(null);
  const paperSelectAllCheckboxRef = useRef<HTMLInputElement>(null);

  const JOURNAL_ENTRIES_PER_PAGE = 10;

  async function loadJournalEntriesForPair(entryTradeId: number, exitTradeId: number) {
    const key = `${entryTradeId}_${exitTradeId}`;
    if (journalEntriesByPairKey[key] !== undefined) return;
    try {
      const list = await invoke<JournalEntrySummary[]>("get_journal_entries_for_pair", {
        entryTradeId,
        exitTradeId,
      });
      setJournalEntriesByPairKey((prev) => ({ ...prev, [key]: list }));
    } catch (e) {
      console.error("Failed to load journal entries for pair:", e);
      setJournalEntriesByPairKey((prev) => ({ ...prev, [key]: [] }));
    }
  }

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem('trades_search_query', searchQuery);
    localStorage.setItem('trades_sort_by', sortBy);
    localStorage.setItem('trades_sort_direction', sortDirection);
    localStorage.setItem(SORT_SECONDARY_KEY, sortBySecondary);
    localStorage.setItem(FILTER_SYMBOL_KEY, filterSymbol);
    localStorage.setItem(FILTER_SIDE_KEY, filterSide);
    localStorage.setItem(FILTER_TYPE_KEY, filterType);
    localStorage.setItem(FILTER_STATUS_KEY, filterStatus);
    localStorage.setItem(FILTER_STRATEGY_KEY, filterStrategy);
    localStorage.setItem(FILTER_PCT_MIN_KEY, filterPctMin);
    localStorage.setItem(FILTER_PCT_MAX_KEY, filterPctMax);
    localStorage.setItem(FILTER_PNL_MIN_KEY, filterPnlMin);
    localStorage.setItem(FILTER_PNL_MAX_KEY, filterPnlMax);
    localStorage.setItem(FILTER_POSITION_SIZE_MIN_KEY, filterPositionSizeMin);
    localStorage.setItem(FILTER_POSITION_SIZE_MAX_KEY, filterPositionSizeMax);
  }, [searchQuery, sortBy, sortDirection, sortBySecondary, filterSymbol, filterSide, filterType, filterStatus, filterStrategy, filterPctMin, filterPctMax, filterPnlMin, filterPnlMax, filterPositionSizeMin, filterPositionSizeMax]);

  useEffect(() => {
    loadData();
  }, [pairingMethod, viewMode, timeframe, customStartDate, customEndDate, dataMode]);

  useEffect(() => {
    const onTradeAdded = () => loadData();
    window.addEventListener("tradeButlerTradeAdded", onTradeAdded);
    return () => window.removeEventListener("tradeButlerTradeAdded", onTradeAdded);
  }, []);

  // Keep data mode in sync with global setting
  useEffect(() => {
    const unsubscribe = subscribeToDataMode((mode) => {
      setDataMode(mode);
    });
    return () => {
      unsubscribe();
    };
  }, []);

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
      if (dataMode === "sandbox") {
        // Use sandbox store data and build position groups + pairs client-side
        const state = loadSandboxState();
        const { positionGroups: groups, pairs } = buildPositionGroupsAndPairs(
          state.trades.map((t) => ({
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            quantity: t.quantity,
            price: t.price,
            timestamp: t.timestamp,
            fees: t.fees,
            notes: t.notes,
            strategy_id: t.strategy_id,
          })),
          pairingMethod
        );
        const entryPairsByTrade = new Map<number, PairedTrade[]>();
        const exitPairsByTrade = new Map<number, PairedTrade[]>();
        for (const p of pairs) {
          const pair: PairedTrade = { ...p };
          if (!entryPairsByTrade.has(p.entry_trade_id)) entryPairsByTrade.set(p.entry_trade_id, []);
          entryPairsByTrade.get(p.entry_trade_id)!.push(pair);
          if (!exitPairsByTrade.has(p.exit_trade_id)) exitPairsByTrade.set(p.exit_trade_id, []);
          exitPairsByTrade.get(p.exit_trade_id)!.push(pair);
        }
        const mappedTrades: TradeWithPairing[] = state.trades.map((t) => ({
          trade: {
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            quantity: t.quantity,
            price: t.price,
            timestamp: t.timestamp,
            order_type: t.order_type,
            status: t.status,
            fees: t.fees,
            notes: t.notes,
            strategy_id: t.strategy_id,
          },
          entry_pairs: entryPairsByTrade.get(t.id) ?? [],
          exit_pairs: exitPairsByTrade.get(t.id) ?? [],
        }));
        setTradesWithPairing(mappedTrades);
        setPositionGroups(
          groups.map((g) => ({
            entry_trade: g.entry_trade as Trade,
            position_trades: g.position_trades as Trade[],
            total_pnl: g.total_pnl,
            final_quantity: g.final_quantity,
          }))
        );
        setStrategies(
          state.strategies.map((s) => ({
            id: s.id,
            name: s.name,
            color: s.color,
          }))
        );
        setPositionGroupNotes(new Map());
        return;
      }

      const dateRange = getTimeframeDates(timeframe, customStartDate, customEndDate);
      const startDate = dateRange.start ? dateRange.start.toISOString() : null;
      const endDate = dateRange.end ? dateRange.end.toISOString() : null;
      
      const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
      const [tradesData, positionsData, strategiesData] = await Promise.all([
        invoke<TradeWithPairing[]>("get_trades_with_pairing", { pairing_method: pairingMethod, startDate, endDate, ...paperArgs }),
        invoke<PositionGroup[]>("get_position_groups", { pairing_method: pairingMethod, startDate, endDate, ...paperArgs }),
        invoke<Strategy[]>("get_strategies"),
      ]);

      // Backend returns only paper trades when paperOnly; for real mode filter out any [PAPER]-tagged
      if (dataMode === "paper") {
        setTradesWithPairing(tradesData);
      } else {
        const realOnly = tradesData.filter(
          (item) => !(item.trade.notes || "").toUpperCase().includes("[PAPER]")
        );
        setTradesWithPairing(realOnly);
      }

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

  useEffect(() => {
    localStorage.setItem(HIDE_PNL_DOLLARS_STORAGE_KEY, String(hidePnlDollars));
  }, [hidePnlDollars]);
  useEffect(() => {
    localStorage.setItem(HIDE_PNL_PERCENT_STORAGE_KEY, String(hidePnlPercent));
  }, [hidePnlPercent]);
  useEffect(() => {
    if (hidePnlDollars && sortBy === "pnl") setSortBy("date");
    if (hidePnlDollars && sortBySecondary === "pnl") setSortBySecondary("none");
    if (hidePnlPercent && sortBy === "percent") setSortBy("date");
    if (hidePnlPercent && sortBySecondary === "percent") setSortBySecondary("none");
  }, [hidePnlDollars, hidePnlPercent, sortBy, sortBySecondary]);

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
      if (dataMode === "sandbox") {
        updateSandboxTradeStrategy(tradeId, strategyId);
        await loadData();
        return;
      }
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

  const handleDeleteTrade = async (tradeId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteLocked) return;
    if (!window.confirm("Delete this trade? This cannot be undone.")) return;
    try {
      if (dataMode === "sandbox") {
        deleteSandboxTrade(tradeId);
        await loadData();
        return;
      }
      await invoke("delete_trade", { id: tradeId });
      await loadData();
    } catch (error) {
      console.error("Error deleting trade:", error);
      alert("Failed to delete trade: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const togglePaperSelection = (tradeId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTradeIdsForPaper((prev) => {
      const next = new Set(prev);
      if (next.has(tradeId)) next.delete(tradeId);
      else next.add(tradeId);
      return next;
    });
  };

  const markSelectedAsPaper = async () => {
    if (selectedTradeIdsForPaper.size === 0) return;
    try {
      for (const tradeId of selectedTradeIdsForPaper) {
        if (dataMode === "sandbox") {
          const state = loadSandboxState();
          const trade = state.trades.find((t) => t.id === tradeId);
          if (!trade) continue;
          const notes = trade.notes || "";
          const newNotes = notes.trim() ? `${notes.trim()} [PAPER]` : "[PAPER]";
          updateSandboxTradeNotes(tradeId, newNotes);
        } else {
          const trade = await invoke<Trade | null>("get_trade_by_id", { id: tradeId });
          if (!trade) continue;
          const notes = trade.notes || "";
          const newNotes = notes.trim() ? `${notes.trim()} [PAPER]` : "[PAPER]";
          await invoke("update_trade", { id: tradeId, trade: { ...trade, notes: newNotes } });
        }
      }
      setSelectedTradeIdsForPaper(new Set());
      await loadData();
    } catch (error) {
      console.error("Error marking as paper:", error);
      alert("Failed to update trades: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const removePaperFromSelected = async () => {
    if (selectedTradeIdsForPaper.size === 0) return;
    try {
      for (const tradeId of selectedTradeIdsForPaper) {
        if (dataMode === "sandbox") {
          const state = loadSandboxState();
          const trade = state.trades.find((t) => t.id === tradeId);
          if (!trade) continue;
          const notes = (trade.notes || "").replace(/\s*\[PAPER\]\s*/gi, "").trim() || null;
          updateSandboxTradeNotes(tradeId, notes);
        } else {
          const trade = await invoke<Trade | null>("get_trade_by_id", { id: tradeId });
          if (!trade) continue;
          const notes = (trade.notes || "").replace(/\s*\[PAPER\]\s*/gi, "").trim() || null;
          await invoke("update_trade", { id: tradeId, trade: { ...trade, notes } });
        }
      }
      setSelectedTradeIdsForPaper(new Set());
      await loadData();
    } catch (error) {
      console.error("Error removing paper flag:", error);
      alert("Failed to update trades: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleSort = (column: "date" | "symbol" | "pnl" | "price" | "quantity" | "trades" | "type" | "status" | "percent" | "position_size") => {
    if (sortBy === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDirection("desc");
    }
  };

  const uniqueOrderTypes = useMemo(() => {
    const set = new Set<string>();
    tradesWithPairing.forEach(({ trade }) => {
      if (trade.order_type) set.add(trade.order_type);
    });
    return Array.from(set).sort();
  }, [tradesWithPairing]);

  const uniqueStatuses = useMemo(() => {
    const set = new Set<string>();
    tradesWithPairing.forEach(({ trade }) => {
      if (trade.status) set.add(trade.status);
    });
    return Array.from(set).sort();
  }, [tradesWithPairing]);

  const uniqueSymbols = useMemo(() => {
    const set = new Set<string>();
    tradesWithPairing.forEach(({ trade }) => {
      if (trade.symbol) set.add(trade.symbol);
    });
    positionGroups.forEach((g) => {
      if (g.entry_trade.symbol) set.add(g.entry_trade.symbol);
    });
    return Array.from(set).sort();
  }, [tradesWithPairing, positionGroups]);

  const SortableHeader = ({ column, label, viewMode }: { column: "date" | "symbol" | "pnl" | "price" | "quantity" | "trades" | "type" | "status" | "percent" | "position_size", label: string, viewMode: "Individual" | "Pair" }) => {
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
          whiteSpace: "nowrap",
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
        <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: column === "pnl" || column === "price" || column === "quantity" || column === "trades" || column === "percent" || column === "position_size" ? "flex-end" : "flex-start" }}>
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

  const applyFiltersToTrade = (
    trade: Trade,
    opts?: { pct?: number | null; pnl?: number; positionSize?: number }
  ): boolean => {
    if (filterSymbol.trim()) {
      const symbols = filterSymbol.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (symbols.length > 0 && !symbols.some((s) => trade.symbol.toLowerCase().includes(s))) return false;
    }
    if (filterSide.trim()) {
      const sides = filterSide.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (sides.length > 0 && !sides.includes(trade.side.toUpperCase())) return false;
    }
    if (filterType.trim()) {
      const types = filterType.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (types.length > 0 && !types.includes((trade.order_type || "").toUpperCase())) return false;
    }
    if (filterStatus.trim()) {
      const statuses = filterStatus.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (statuses.length > 0 && !statuses.includes((trade.status || "").toUpperCase())) return false;
    }
    if (filterStrategy.trim()) {
      const strategyVals = filterStrategy.split(",").map((s) => s.trim()).filter(Boolean);
      if (strategyVals.length > 0) {
        const match = strategyVals.some((v) => {
          if (v === "unassigned") return trade.strategy_id === null;
          const id = parseInt(v, 10);
          return !isNaN(id) && trade.strategy_id === id;
        });
        if (!match) return false;
      }
    }
    if (filterPctMin !== "" || filterPctMax !== "") {
      if (opts?.pct == null) return false;
      const min = filterPctMin !== "" ? parseFloat(filterPctMin) : null;
      const max = filterPctMax !== "" ? parseFloat(filterPctMax) : null;
      if (min != null && opts.pct < min) return false;
      if (max != null && opts.pct > max) return false;
    }
    if (opts?.pnl != null && (filterPnlMin !== "" || filterPnlMax !== "")) {
      const min = filterPnlMin !== "" ? parseFloat(filterPnlMin) : null;
      const max = filterPnlMax !== "" ? parseFloat(filterPnlMax) : null;
      if (min != null && opts.pnl < min) return false;
      if (max != null && opts.pnl > max) return false;
    }
    if (opts?.positionSize != null && (filterPositionSizeMin !== "" || filterPositionSizeMax !== "")) {
      const min = filterPositionSizeMin !== "" ? parseFloat(filterPositionSizeMin) : null;
      const max = filterPositionSizeMax !== "" ? parseFloat(filterPositionSizeMax) : null;
      if (min != null && opts.positionSize < min) return false;
      if (max != null && opts.positionSize > max) return false;
    }
    return true;
  };

  const getPercentAndPnlForTrade = (item: TradeWithPairing): { pct: number | null; pnl: number } => {
    const relevantPairs = item.trade.side === "BUY" ? item.exit_pairs : item.entry_pairs;
    const totalPnl = relevantPairs.reduce((sum, p) => sum + p.net_profit_loss, 0);
    let totalCost = 0;
    for (const p of relevantPairs) {
      totalCost += p.entry_price * p.quantity;
    }
    const pct = totalCost !== 0 ? (totalPnl / totalCost) * 100 : null;
    return { pct, pnl: totalPnl };
  };

  const getPercentAndPnlForGroup = (group: PositionGroup): { pct: number | null; pnl: number } => {
    const pnl = group.total_pnl;
    if (group.final_quantity === 0 && group.position_trades.length >= 2) {
      const entryPrice = group.entry_trade.price;
      const exitPrice = group.position_trades[group.position_trades.length - 1].price;
      const pct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : null;
      return { pct, pnl };
    }
    return { pct: null, pnl };
  };

  const searchMatchesTrade = (trade: Trade): boolean => {
    if (!searchQuery.trim()) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      trade.symbol.toLowerCase().includes(searchLower) ||
      trade.side.toLowerCase().includes(searchLower) ||
      trade.order_type.toLowerCase().includes(searchLower) ||
      trade.status.toLowerCase().includes(searchLower) ||
      (trade.strategy_id !== null && strategies.find(s => s.id === trade.strategy_id)?.name.toLowerCase().includes(searchLower))
    );
  };

  const compareTradesForSort = (
    a: TradeWithPairing,
    b: TradeWithPairing,
    primary: "date" | "symbol" | "pnl" | "price" | "quantity" | "trades" | "type" | "status" | "percent" | "position_size",
    direction: "asc" | "desc"
  ): number => {
    const tradeA = a.trade;
    const tradeB = b.trade;
    const relevantPairsA = tradeA.side === "BUY" ? a.exit_pairs : a.entry_pairs;
    const relevantPairsB = tradeB.side === "BUY" ? b.exit_pairs : b.entry_pairs;
    const totalPnLA = relevantPairsA.reduce((sum, p) => sum + p.net_profit_loss, 0);
    const totalPnLB = relevantPairsB.reduce((sum, p) => sum + p.net_profit_loss, 0);
    const { pct: pctA } = getPercentAndPnlForTrade(a);
    const { pct: pctB } = getPercentAndPnlForTrade(b);
    let comparison = 0;
    switch (primary) {
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
      case "type":
        comparison = (tradeA.order_type || "").localeCompare(tradeB.order_type || "");
        break;
      case "status":
        comparison = (tradeA.status || "").localeCompare(tradeB.status || "");
        break;
      case "percent":
        comparison = (pctA ?? -Infinity) - (pctB ?? -Infinity);
        break;
      case "position_size":
        comparison = (tradeA.quantity * tradeA.price) - (tradeB.quantity * tradeB.price);
        break;
      default:
        comparison = 0;
    }
    return direction === "asc" ? comparison : -comparison;
  };

  // Filter and sort trades for Individual view
  const filteredAndSortedTrades = useMemo(() => {
    let filtered = tradesWithPairing.filter((item) => {
      const trade = item.trade;
      if (!searchMatchesTrade(trade)) return false;
      const { pct, pnl } = getPercentAndPnlForTrade(item);
      const positionSize = trade.quantity * trade.price;
      if (!applyFiltersToTrade(trade, { pct, pnl, positionSize })) return false;
      return true;
    });

    const dir = sortDirection;
    filtered.sort((a, b) => {
      let comparison = compareTradesForSort(a, b, sortBy, dir);
      if (comparison === 0 && sortBySecondary !== "none") {
        comparison = compareTradesForSort(a, b, sortBySecondary, dir);
      }
      return comparison;
    });

    return filtered;
  }, [tradesWithPairing, searchQuery, sortBy, sortDirection, sortBySecondary, filterSymbol, filterSide, filterType, filterStatus, filterStrategy, filterPctMin, filterPctMax, filterPnlMin, filterPnlMax, filterPositionSizeMin, filterPositionSizeMax, strategies]);

  const compareGroupsForSort = (
    a: PositionGroup,
    b: PositionGroup,
    primary: "date" | "symbol" | "pnl" | "price" | "quantity" | "trades" | "type" | "status" | "percent" | "position_size",
    direction: "asc" | "desc"
  ): number => {
    const { pct: pctA } = getPercentAndPnlForGroup(a);
    const { pct: pctB } = getPercentAndPnlForGroup(b);
    let comparison = 0;
    switch (primary) {
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
      case "type":
        comparison = (a.entry_trade.order_type || "").localeCompare(b.entry_trade.order_type || "");
        break;
      case "status":
        comparison = (a.entry_trade.status || "").localeCompare(b.entry_trade.status || "");
        break;
      case "percent":
        comparison = (pctA ?? -Infinity) - (pctB ?? -Infinity);
        break;
      case "position_size":
        comparison = (a.entry_trade.quantity * a.entry_trade.price) - (b.entry_trade.quantity * b.entry_trade.price);
        break;
      default:
        comparison = 0;
    }
    return direction === "asc" ? comparison : -comparison;
  };

  // Filter and sort position groups for Pair view
  const filteredAndSortedPositionGroups = useMemo(() => {
    let filtered = positionGroups.filter((group) => {
      const t = group.entry_trade;
      if (!searchMatchesTrade(t)) return false;
      const { pct, pnl } = getPercentAndPnlForGroup(group);
      const positionSize = t.quantity * t.price;
      if (!applyFiltersToTrade(t, { pct, pnl, positionSize })) return false;
      return true;
    });

    const dir = sortDirection;
    filtered.sort((a, b) => {
      let comparison = compareGroupsForSort(a, b, sortBy, dir);
      if (comparison === 0 && sortBySecondary !== "none") {
        comparison = compareGroupsForSort(a, b, sortBySecondary, dir);
      }
      return comparison;
    });

    return filtered;
  }, [positionGroups, searchQuery, sortBy, sortDirection, sortBySecondary, filterSymbol, filterSide, filterType, filterStatus, filterStrategy, filterPctMin, filterPctMax, filterPnlMin, filterPnlMax, filterPositionSizeMin, filterPositionSizeMax, strategies]);

  const tableSummary = useMemo(() => {
    const count = viewMode === "Pair" ? filteredAndSortedPositionGroups.length : filteredAndSortedTrades.length;
    const totalPnl = viewMode === "Pair"
      ? filteredAndSortedPositionGroups.reduce((sum, g) => sum + g.total_pnl, 0)
      : null;
    const symbols = viewMode === "Pair"
      ? new Set(filteredAndSortedPositionGroups.map((g) => g.entry_trade.symbol))
      : new Set(filteredAndSortedTrades.map((t) => t.trade.symbol));
    return { count, totalPnl, symbolCount: symbols.size };
  }, [viewMode, filteredAndSortedTrades, filteredAndSortedPositionGroups]);

  const allVisibleIdsForPaperSelection = useMemo(() => {
    const ids = new Set<number>();
    if (viewMode === "Pair") {
      filteredAndSortedPositionGroups.forEach((group) => {
        ids.add(group.entry_trade.id);
        const exitTrade = group.position_trades.length >= 1 ? group.position_trades[group.position_trades.length - 1] : null;
        if (exitTrade) ids.add((exitTrade as Trade).id);
      });
    } else {
      filteredAndSortedTrades.forEach((item) => ids.add(item.trade.id));
    }
    return ids;
  }, [viewMode, filteredAndSortedPositionGroups, filteredAndSortedTrades]);

  const selectAllForPaper = () => setSelectedTradeIdsForPaper(new Set(allVisibleIdsForPaperSelection));
  const clearPaperSelection = () => setSelectedTradeIdsForPaper(new Set());

  const paperSelectAllChecked = allVisibleIdsForPaperSelection.size > 0 && allVisibleIdsForPaperSelection.size === selectedTradeIdsForPaper.size;
  const paperSelectAllIndeterminate = selectedTradeIdsForPaper.size > 0 && selectedTradeIdsForPaper.size < allVisibleIdsForPaperSelection.size;

  useEffect(() => {
    const el = paperSelectAllCheckboxRef.current;
    if (el) el.indeterminate = paperSelectAllIndeterminate;
  }, [paperSelectAllIndeterminate]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading trades...</p>
      </div>
    );
  }

  const stickyHeaderStyle: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 10,
    backgroundColor: "var(--bg-primary)",
    marginLeft: "-30px",
    marginRight: "-30px",
    paddingLeft: "30px",
    paddingRight: "30px",
    paddingBottom: "4px",
  };

  return (
    <div style={{ padding: "30px" }}>
      <div ref={stickyBarRef} style={stickyHeaderStyle}>
      {dataMode === "sandbox" && (
        <p style={{ margin: "0 0 16px 0", padding: "12px 16px", fontSize: "14px", fontWeight: "600", color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "2px solid var(--accent)", borderRadius: "8px" }}>
          Demo mode — you are viewing demo data only.
        </p>
      )}
      {dataMode === "paper" && (
        <p style={{ margin: "0 0 16px 0", padding: "12px 16px", fontSize: "14px", fontWeight: "600", color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "2px solid var(--accent)", borderRadius: "8px" }}>
          Paper mode — you are viewing paper trades only.
        </p>
      )}
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
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "14px",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={hidePnlDollars}
              onChange={(e) => setHidePnlDollars(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span>Hide P&L ($)</span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "14px",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={hidePnlPercent}
              onChange={(e) => setHidePnlPercent(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span>Hide P&L (%)</span>
          </label>
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

      {/* Search, sort & filters — single card */}
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "10px",
          padding: "16px 18px",
          marginBottom: "20px",
        }}
      >
        {/* Row 1: Search + Sort + Summary */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px", rowGap: "12px" }}>
          <div style={{ position: "relative", flex: "1", minWidth: "220px", maxWidth: "360px" }}>
            <Search
              size={16}
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-secondary)",
              }}
            />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "9px 10px 9px 34px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                outline: "none",
              }}
            />
          </div>
          <div
            style={{
              width: "1px",
              alignSelf: "stretch",
              minHeight: "28px",
              backgroundColor: "var(--border-color)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{
                padding: "9px 10px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
                minWidth: "100px",
              }}
            >
              <option value="date">Date</option>
              <option value="symbol">Symbol</option>
              {!hidePnlDollars && <option value="pnl">P&L</option>}
              <option value="price">Price</option>
              <option value="quantity">Qty</option>
              {viewMode === "Pair" && <option value="trades">Trades</option>}
              <option value="type">Type</option>
              <option value="status">Status</option>
              {!hidePnlPercent && <option value="percent">%</option>}
              <option value="position_size">Position size</option>
            </select>
            <button
              onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
              style={{
                padding: "9px 10px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={sortDirection === "asc" ? "Ascending" : "Descending"}
            >
              <ArrowUpDown size={14} />
            </button>
            <select
              value={sortBySecondary}
              onChange={(e) => setSortBySecondary(e.target.value as typeof sortBySecondary)}
              style={{
                padding: "9px 10px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
                minWidth: "88px",
              }}
            >
              <option value="none">Then: none</option>
              <option value="date">Then: date</option>
              <option value="symbol">Then: symbol</option>
              {!hidePnlDollars && <option value="pnl">Then: P&L</option>}
              <option value="price">Then: price</option>
              <option value="quantity">Then: qty</option>
              {viewMode === "Pair" && <option value="trades">Then: trades</option>}
              <option value="type">Then: type</option>
              <option value="status">Then: status</option>
              {!hidePnlPercent && <option value="percent">Then: %</option>}
              <option value="position_size">Then: position size</option>
            </select>
          </div>
          <div
            style={{
              width: "1px",
              alignSelf: "stretch",
              minHeight: "28px",
              backgroundColor: "var(--border-color)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span
              title={viewMode === "Pair" ? "Position groups" : "Trades"}
              style={{
                padding: "6px 10px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                fontSize: "12px",
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
              }}
            >
              <strong style={{ color: "var(--text-primary)", fontWeight: "600" }}>{tableSummary.count}</strong> {viewMode === "Pair" ? "pairs" : "trades"}
            </span>
            <span
              title="Unique symbols"
              style={{
                padding: "6px 10px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                fontSize: "12px",
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
              }}
            >
              <strong style={{ color: "var(--text-primary)", fontWeight: "600" }}>{tableSummary.symbolCount}</strong> symbols
            </span>
            {!hidePnlDollars && viewMode === "Pair" && tableSummary.totalPnl !== null && (
              <span
                title="Total P&L"
                style={{
                  padding: "6px 10px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                }}
              >
                P&L: <strong style={{ color: tableSummary.totalPnl >= 0 ? "var(--profit)" : "var(--loss)", fontWeight: "600" }}>
                  {tableSummary.totalPnl >= 0 ? "+" : ""}${formatWithCommas(tableSummary.totalPnl, { decimals: 2 })}
                </strong>
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setFilterSymbol("");
                setFilterSide("");
                setFilterType("");
                setFilterStatus("");
                setFilterStrategy("");
                setFilterPctMin("");
                setFilterPctMax("");
                setFilterPnlMin("");
                setFilterPnlMax("");
                setFilterPositionSizeMin("");
                setFilterPositionSizeMax("");
                setSortBy("date");
                setSortDirection("desc");
                setSortBySecondary("none");
              }}
              style={{
                padding: "6px 14px",
                fontSize: "13px",
                fontWeight: "600",
                color: "var(--accent)",
                background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                border: "1px solid var(--accent)",
                borderRadius: "8px",
                cursor: "pointer",
                marginLeft: "8px",
              }}
              title="Clear search, all filters, and reset sort to default"
            >
              Reset all
            </button>
          </div>
        </div>

        {/* Row 2: Filters */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "12px",
            marginTop: "14px",
            paddingTop: "14px",
            borderTop: "1px solid var(--border-color)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginRight: "4px" }}>
            <Filter size={14} style={{ color: "var(--text-secondary)" }} />
            <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Filter by</span>
          </div>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => { setOpenFilterSymbol((o) => !o); setOpenFilterType(false); setOpenFilterStatus(false); setOpenFilterStrategy(false); }}
              style={{
                padding: "8px 10px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
                minWidth: "140px",
                textAlign: "left",
              }}
            >
              Symbol: {filterSymbol.trim() ? `${filterSymbol.split(",").map((s) => s.trim()).filter(Boolean).length} selected` : "All"}
            </button>
            {openFilterSymbol && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: "100%",
                  marginTop: "4px",
                  padding: "8px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                  zIndex: 20,
                  minWidth: "200px",
                  maxHeight: "280px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <input
                  type="text"
                  placeholder="Search symbols..."
                  value={symbolSearch}
                  onChange={(e) => setSymbolSearch(e.target.value)}
                  style={{
                    padding: "6px 8px",
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    outline: "none",
                  }}
                />
                <div style={{ overflowY: "auto", maxHeight: "220px" }}>
                  {uniqueSymbols
                    .filter((sym) => !symbolSearch.trim() || sym.toLowerCase().includes(symbolSearch.trim().toLowerCase()))
                    .map((sym) => {
                      const selected = filterSymbol.split(",").map((s) => s.trim()).filter(Boolean).includes(sym);
                      return (
                        <label key={sym} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 0", fontSize: "13px", cursor: "pointer", color: "var(--text-primary)" }}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(e) => {
                              const list = filterSymbol.split(",").map((s) => s.trim()).filter(Boolean);
                              if (e.target.checked) setFilterSymbol([...list, sym].join(","));
                              else setFilterSymbol(list.filter((x) => x !== sym).join(","));
                            }}
                          />
                          {sym}
                        </label>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Side:</span>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", cursor: "pointer", color: "var(--text-primary)" }}>
              <input
                type="checkbox"
                checked={filterSide.split(",").map((s) => s.trim()).filter(Boolean).includes("BUY")}
                onChange={(e) => {
                  const list = filterSide.split(",").map((s) => s.trim()).filter(Boolean);
                  if (e.target.checked) setFilterSide([...list, "BUY"].filter((v, i, a) => a.indexOf(v) === i).join(","));
                  else setFilterSide(list.filter((x) => x !== "BUY").join(","));
                }}
              />
              BUY
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", cursor: "pointer", color: "var(--text-primary)" }}>
              <input
                type="checkbox"
                checked={filterSide.split(",").map((s) => s.trim()).filter(Boolean).includes("SELL")}
                onChange={(e) => {
                  const list = filterSide.split(",").map((s) => s.trim()).filter(Boolean);
                  if (e.target.checked) setFilterSide([...list, "SELL"].filter((v, i, a) => a.indexOf(v) === i).join(","));
                  else setFilterSide(list.filter((x) => x !== "SELL").join(","));
                }}
              />
              SELL
            </label>
          </div>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => { setOpenFilterSymbol(false); setOpenFilterType((o) => !o); setOpenFilterStatus(false); setOpenFilterStrategy(false); }}
              style={{
                padding: "8px 10px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
                minWidth: "100px",
                textAlign: "left",
              }}
            >
              Type: {filterType.trim() ? `${filterType.split(",").map((s) => s.trim()).filter(Boolean).length} selected` : "All"}
            </button>
            {openFilterType && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: "100%",
                  marginTop: "4px",
                  padding: "8px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                  zIndex: 20,
                  minWidth: "140px",
                  maxHeight: "200px",
                  overflowY: "auto",
                }}
              >
                {uniqueOrderTypes.map((t) => {
                  const selected = filterType.split(",").map((s) => s.trim()).filter(Boolean).includes(t);
                  return (
                    <label key={t} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 0", fontSize: "13px", cursor: "pointer", color: "var(--text-primary)" }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          const list = filterType.split(",").map((s) => s.trim()).filter(Boolean);
                          if (e.target.checked) setFilterType([...list, t].join(","));
                          else setFilterType(list.filter((x) => x !== t).join(","));
                        }}
                      />
                      {t}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => { setOpenFilterSymbol(false); setOpenFilterStatus((o) => !o); setOpenFilterType(false); setOpenFilterStrategy(false); }}
              style={{
                padding: "8px 10px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
                minWidth: "100px",
                textAlign: "left",
              }}
            >
              Status: {filterStatus.trim() ? `${filterStatus.split(",").map((s) => s.trim()).filter(Boolean).length} selected` : "All"}
            </button>
            {openFilterStatus && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: "100%",
                  marginTop: "4px",
                  padding: "8px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                  zIndex: 20,
                  minWidth: "140px",
                  maxHeight: "200px",
                  overflowY: "auto",
                }}
              >
                {uniqueStatuses.map((s) => {
                  const selected = filterStatus.split(",").map((x) => x.trim()).filter(Boolean).includes(s);
                  return (
                    <label key={s} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 0", fontSize: "13px", cursor: "pointer", color: "var(--text-primary)" }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          const list = filterStatus.split(",").map((x) => x.trim()).filter(Boolean);
                          if (e.target.checked) setFilterStatus([...list, s].join(","));
                          else setFilterStatus(list.filter((x) => x !== s).join(","));
                        }}
                      />
                      {s}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => { setOpenFilterSymbol(false); setOpenFilterStrategy((o) => !o); setOpenFilterType(false); setOpenFilterStatus(false); }}
              style={{
                padding: "8px 10px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
                minWidth: "110px",
                maxWidth: "160px",
                textAlign: "left",
              }}
            >
              Strategy: {filterStrategy.trim() ? `${filterStrategy.split(",").map((s) => s.trim()).filter(Boolean).length} selected` : "All"}
            </button>
            {openFilterStrategy && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: "100%",
                  marginTop: "4px",
                  padding: "8px",
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                  zIndex: 20,
                  minWidth: "160px",
                  maxHeight: "200px",
                  overflowY: "auto",
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 0", fontSize: "13px", cursor: "pointer", color: "var(--text-primary)" }}>
                  <input
                    type="checkbox"
                    checked={filterStrategy.split(",").map((s) => s.trim()).filter(Boolean).includes("unassigned")}
                    onChange={(e) => {
                      const list = filterStrategy.split(",").map((s) => s.trim()).filter(Boolean);
                      if (e.target.checked) setFilterStrategy([...list, "unassigned"].join(","));
                      else setFilterStrategy(list.filter((x) => x !== "unassigned").join(","));
                    }}
                  />
                  Unassigned
                </label>
                {strategies.map((s) => {
                  const selected = filterStrategy.split(",").map((x) => x.trim()).filter(Boolean).includes(String(s.id));
                  return (
                    <label key={s.id} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 0", fontSize: "13px", cursor: "pointer", color: "var(--text-primary)" }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          const list = filterStrategy.split(",").map((x) => x.trim()).filter(Boolean);
                          const val = String(s.id);
                          if (e.target.checked) setFilterStrategy([...list, val].join(","));
                          else setFilterStrategy(list.filter((x) => x !== val).join(","));
                        }}
                      />
                      {s.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>%:</span>
            <input
              type="number"
              placeholder="Min %"
              value={filterPctMin}
              onChange={(e) => setFilterPctMin(e.target.value)}
              style={{
                width: "70px",
                padding: "8px 8px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                outline: "none",
              }}
              step="any"
            />
            <span style={{ color: "var(--text-secondary)" }}>–</span>
            <input
              type="number"
              placeholder="Max %"
              value={filterPctMax}
              onChange={(e) => setFilterPctMax(e.target.value)}
              style={{
                width: "70px",
                padding: "8px 8px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                outline: "none",
              }}
              step="any"
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>P&L $:</span>
            <input
              type="number"
              placeholder="Min $"
              value={filterPnlMin}
              onChange={(e) => setFilterPnlMin(e.target.value)}
              style={{
                width: "70px",
                padding: "8px 8px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                outline: "none",
              }}
              step="any"
            />
            <span style={{ color: "var(--text-secondary)" }}>–</span>
            <input
              type="number"
              placeholder="Max $"
              value={filterPnlMax}
              onChange={(e) => setFilterPnlMax(e.target.value)}
              style={{
                width: "70px",
                padding: "8px 8px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                outline: "none",
              }}
              step="any"
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Position size $:</span>
            <input
              type="number"
              placeholder="Min $"
              value={filterPositionSizeMin}
              onChange={(e) => setFilterPositionSizeMin(e.target.value)}
              style={{
                width: "70px",
                padding: "8px 8px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                outline: "none",
              }}
              step="any"
            />
            <span style={{ color: "var(--text-secondary)" }}>–</span>
            <input
              type="number"
              placeholder="Max $"
              value={filterPositionSizeMax}
              onChange={(e) => setFilterPositionSizeMax(e.target.value)}
              style={{
                width: "70px",
                padding: "8px 8px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                outline: "none",
              }}
              step="any"
            />
          </div>
          {(filterSymbol || filterSide || filterType || filterStatus || filterStrategy || filterPctMin || filterPctMax || filterPnlMin || filterPnlMax || filterPositionSizeMin || filterPositionSizeMax) && (
            <button
              type="button"
            onClick={() => {
              setFilterSymbol("");
              setFilterSide("");
              setFilterType("");
              setFilterStatus("");
              setFilterStrategy("");
              setFilterPctMin("");
              setFilterPctMax("");
              setFilterPnlMin("");
              setFilterPnlMax("");
              setFilterPositionSizeMin("");
              setFilterPositionSizeMax("");
            }}
              style={{
                padding: "6px 12px",
                fontSize: "12px",
                color: "var(--text-secondary)",
                background: "transparent",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                cursor: "pointer",
                marginLeft: "4px",
              }}
            >
              Clear filters
            </button>
          )}
        </div>
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
            {selectedTradeIdsForPaper.size > 0 && dataMode !== "sandbox" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 16px", backgroundColor: "color-mix(in srgb, var(--accent) 18%, var(--bg-tertiary))", borderBottom: "2px solid var(--accent)" }}>
                <button type="button" onClick={clearPaperSelection} style={{ padding: "6px 12px", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: "pointer" }} title="Clear selection">
                  Deselect all
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {selectedTradeIdsForPaper.size} selected
                  </span>
                  {dataMode === "paper" ? (
                    <button type="button" onClick={removePaperFromSelected} style={{ padding: "8px 18px", fontSize: "13px", fontWeight: "600", border: "none", borderRadius: "8px", background: "var(--accent)", color: "white", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }}>
                      Mark as real ({selectedTradeIdsForPaper.size})
                    </button>
                  ) : (
                    <button type="button" onClick={markSelectedAsPaper} style={{ padding: "8px 18px", fontSize: "13px", fontWeight: "600", border: "none", borderRadius: "8px", background: "var(--accent)", color: "white", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }}>
                      Mark as paper ({selectedTradeIdsForPaper.size})
                    </button>
                  )}
                </div>
              </div>
            )}
            <div style={{ overflowY: "auto", overflowX: "auto", maxHeight: "calc(100vh - 260px)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 9, backgroundColor: "var(--bg-tertiary)", boxShadow: "0 1px 0 0 var(--border-color)" }}>
                  <tr style={{ backgroundColor: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-color)" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", width: "40px" }}>
                    </th>
                    <SortableHeader column="date" label="Entry Date" viewMode={viewMode} />
                    <SortableHeader column="symbol" label="Symbol" viewMode={viewMode} />
                    <SortableHeader column="quantity" label="Entry Qty" viewMode={viewMode} />
                    <SortableHeader column="price" label="Entry Price" viewMode={viewMode} />
                    <SortableHeader column="position_size" label="Position size" viewMode={viewMode} />
                    <SortableHeader column="trades" label="Trades" viewMode={viewMode} />
                    {!hidePnlDollars && <SortableHeader column="pnl" label="P&L" viewMode={viewMode} />}
                    {!hidePnlPercent && <SortableHeader column="percent" label="%" viewMode={viewMode} />}
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", minWidth: "100px", whiteSpace: "nowrap" }}>
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
                    <th style={{ padding: "12px 8px", textAlign: "center", fontSize: "12px", fontWeight: "600", color: "var(--text-primary)", textTransform: "uppercase", minWidth: "90px", whiteSpace: "nowrap", backgroundColor: "var(--bg-secondary)" }} title={dataMode === "paper" ? "Select to mark as real" : "Select to mark as paper"} onClick={(e) => e.stopPropagation()}>
                      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", cursor: "pointer", margin: 0 }}>
                        <input
                          ref={paperSelectAllCheckboxRef}
                          type="checkbox"
                          checked={paperSelectAllChecked}
                          onChange={(e) => (e.target.checked ? selectAllForPaper() : clearPaperSelection())}
                          style={{ cursor: "pointer" }}
                          title={paperSelectAllChecked ? "Deselect all" : "Select all visible"}
                        />
                        <span style={{ marginLeft: "4px" }}>{dataMode === "paper" ? "Real" : "Paper"}</span>
                      </label>
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", width: "56px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                        <span>Delete</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const newLocked = !deleteLocked;
                            setDeleteLocked(newLocked);
                            localStorage.setItem(DELETE_LOCK_STORAGE_KEY, String(newLocked));
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: "2px",
                            cursor: "pointer",
                            color: deleteLocked ? "#fbbf24" : "var(--text-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                          title={deleteLocked ? "Unlock to allow deleting trades" : "Lock to prevent deleting trades"}
                        >
                          {deleteLocked ? <Lock size={14} /> : <Unlock size={14} />}
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
                            {formatWithCommas(group.entry_trade.quantity, { minDecimals: 4, maxDecimals: 4 })}
                            {group.entry_trade.side.toUpperCase() === "SELL" && (
                              <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "4px" }}>
                                (Short)
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                            ${formatWithCommas(group.entry_trade.price, { decimals: 2 })}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                            ${formatWithCommas(group.entry_trade.quantity * group.entry_trade.price, { decimals: 2 })}
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                            {group.position_trades.length}
                          </td>
                          {!hidePnlDollars && (
                            <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                              <span
                                style={{
                                  fontWeight: "600",
                                  color: group.total_pnl >= 0 ? "var(--profit)" : "var(--loss)",
                                }}
                              >
                                {group.total_pnl >= 0 ? "+" : ""}${formatWithCommas(group.total_pnl, { decimals: 2 })}
                              </span>
                            </td>
                          )}
                          {!hidePnlPercent && (
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
                                    {percentage >= 0 ? "+" : ""}{formatWithCommas(percentage, { decimals: 2 })}%
                                  </span>
                                );
                              })()}
                            </td>
                          )}
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
                          <td style={{ padding: "12px 8px", textAlign: "center", fontSize: "12px", width: "52px" }} onClick={(e) => e.stopPropagation()}>
                            <label title="Select this pair for Mark as paper" style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={selectedTradeIdsForPaper.has(group.entry_trade.id)}
                                onChange={() => {}}
                                onClick={(e) => {
                                  const entryId = group.entry_trade.id;
                                  const exitTrade = group.position_trades.length >= 1 ? group.position_trades[group.position_trades.length - 1] : null;
                                  const exitId = exitTrade ? (exitTrade as Trade).id : null;
                                  const isSelected = selectedTradeIdsForPaper.has(entryId);
                                  e.stopPropagation();
                                  setSelectedTradeIdsForPaper((prev) => {
                                    const next = new Set(prev);
                                    if (isSelected) {
                                      next.delete(entryId);
                                      if (exitId != null) next.delete(exitId);
                                    } else {
                                      next.add(entryId);
                                      if (exitId != null) next.add(exitId);
                                    }
                                    return next;
                                  });
                                }}
                                style={{ cursor: "pointer" }}
                              />
                            </label>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "center" }}>
                            {/* Delete per trade is in expanded row */}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${group.entry_trade.id}-details`}>
                            <td colSpan={11} style={{ padding: "0", backgroundColor: "var(--bg-tertiary)" }}>
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
                                        <th style={{ padding: "8px 12px", textAlign: "center", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", width: "48px" }}>
                                          Delete
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
                                              {formatWithCommas(trade.quantity, { minDecimals: 4, maxDecimals: 4 })}
                                            </td>
                                            <td style={{ padding: "8px 12px", fontSize: "13px", textAlign: "right" }}>
                                              ${formatWithCommas(trade.price, { decimals: 2 })}
                                            </td>
                                            <td style={{ padding: "8px 12px", fontSize: "13px", textAlign: "right" }}>
                                              ${formatWithCommas(trade.quantity * trade.price, { decimals: 2 })}
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
                                              {isClosed ? "0.0000" : (positionSize > 0 ? "+" : "") + formatWithCommas(positionSize, { minDecimals: 4, maxDecimals: 4 })}
                                            </td>
                                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                              <button
                                                onClick={(ev) => handleDeleteTrade(trade.id, ev)}
                                                disabled={deleteLocked}
                                                title={deleteLocked ? "Unlock delete to remove this trade" : "Delete this trade"}
                                                style={{
                                                  background: deleteLocked ? "var(--bg-secondary)" : "transparent",
                                                  border: "none",
                                                  padding: "6px",
                                                  cursor: deleteLocked ? "not-allowed" : "pointer",
                                                  color: deleteLocked ? "var(--text-secondary)" : "var(--loss)",
                                                  display: "flex",
                                                  alignItems: "center",
                                                  justifyContent: "center",
                                                  margin: "0 auto",
                                                  borderRadius: "4px",
                                                  opacity: deleteLocked ? 0.6 : 1,
                                                }}
                                              >
                                                <Trash2 size={16} />
                                              </button>
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
                                    <div style={{ marginTop: "12px", position: "relative" }}>
                                      <button
                                        type="button"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          const entryTrade = group.entry_trade;
                                          const lastTrade = group.position_trades[group.position_trades.length - 1];
                                          const key = `${entryTrade.id}_${lastTrade.id}`;
                                          if (openJournalPairKey === key) {
                                            setOpenJournalPairKey(null);
                                            setJournalPairPage(0);
                                            return;
                                          }
                                          await loadJournalEntriesForPair(entryTrade.id, lastTrade.id);
                                          setOpenJournalPairKey(key);
                                          setJournalPairPage(0);
                                        }}
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: "6px",
                                          padding: "6px 12px",
                                          backgroundColor: openJournalPairKey === `${group.entry_trade.id}_${group.position_trades[group.position_trades.length - 1].id}` ? "var(--accent)" : "transparent",
                                          border: "1px solid var(--accent)",
                                          borderRadius: "4px",
                                          color: openJournalPairKey === `${group.entry_trade.id}_${group.position_trades[group.position_trades.length - 1].id}` ? "white" : "var(--accent)",
                                          fontSize: "12px",
                                          fontWeight: "500",
                                          cursor: "pointer",
                                        }}
                                      >
                                        <ChevronDown
                                          size={14}
                                          style={{
                                            transform: openJournalPairKey === `${group.entry_trade.id}_${group.position_trades[group.position_trades.length - 1].id}` ? "rotate(0deg)" : "rotate(-90deg)",
                                            transition: "transform 0.2s",
                                          }}
                                        />
                                        Journal entries
                                        {journalEntriesByPairKey[`${group.entry_trade.id}_${group.position_trades[group.position_trades.length - 1].id}`] !== undefined &&
                                          ` (${journalEntriesByPairKey[`${group.entry_trade.id}_${group.position_trades[group.position_trades.length - 1].id}`].length})`}
                                      </button>
                                      {openJournalPairKey === `${group.entry_trade.id}_${group.position_trades[group.position_trades.length - 1].id}` && (
                                        <div
                                          style={{
                                            position: "absolute",
                                            left: 0,
                                            top: "100%",
                                            marginTop: "4px",
                                            zIndex: 20,
                                            minWidth: "220px",
                                            maxWidth: "320px",
                                            maxHeight: "240px",
                                            overflowY: "auto",
                                            backgroundColor: "var(--bg-secondary)",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: "8px",
                                            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.4)",
                                            padding: "8px",
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {journalEntriesByPairKey[`${group.entry_trade.id}_${group.position_trades[group.position_trades.length - 1].id}`] === undefined ? (
                                            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Loading...</div>
                                          ) : (() => {
                                            const pairKey = `${group.entry_trade.id}_${group.position_trades[group.position_trades.length - 1].id}`;
                                            const entries = journalEntriesByPairKey[pairKey];
                                            const totalPages = Math.max(1, Math.ceil(entries.length / JOURNAL_ENTRIES_PER_PAGE));
                                            const page = Math.min(journalPairPage, totalPages - 1);
                                            const start = page * JOURNAL_ENTRIES_PER_PAGE;
                                            const pageEntries = entries.slice(start, start + JOURNAL_ENTRIES_PER_PAGE);
                                            return (
                                              <>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>
                                                  <span>Linked journal entries</span>
                                                  <button
                                                    type="button"
                                                    onClick={() => { setOpenJournalPairKey(null); setJournalPairPage(0); }}
                                                    style={{ border: "none", background: "transparent", color: "var(--text-secondary)", fontSize: "10px", cursor: "pointer" }}
                                                  >
                                                    Close
                                                  </button>
                                                </div>
                                                {pageEntries.length === 0 ? (
                                                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>No journal entries linked</div>
                                                ) : (
                                                  <>
                                                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                                                      {pageEntries.map((entry) => (
                                                        <li key={entry.id}>
                                                          <button
                                                            type="button"
                                                            onClick={() => navigate("/journal", { state: { openEntryId: entry.id } })}
                                                            style={{
                                                              border: "none",
                                                              background: "transparent",
                                                              padding: 0,
                                                              textAlign: "left",
                                                              fontSize: "11px",
                                                              color: "var(--accent)",
                                                              cursor: "pointer",
                                                              whiteSpace: "nowrap",
                                                              overflow: "hidden",
                                                              textOverflow: "ellipsis",
                                                              width: "100%",
                                                            }}
                                                            title={entry.title}
                                                          >
                                                            {entry.title || "Untitled entry"}
                                                          </button>
                                                        </li>
                                                      ))}
                                                    </ul>
                                                    {totalPages > 1 && (
                                                      <div style={{ marginTop: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", color: "var(--text-secondary)" }}>
                                                        <button
                                                          type="button"
                                                          onClick={() => setJournalPairPage((p) => (p > 0 ? p - 1 : p))}
                                                          disabled={page === 0}
                                                          style={{
                                                            border: "none",
                                                            background: "transparent",
                                                            color: page === 0 ? "var(--text-muted)" : "var(--accent)",
                                                            cursor: page === 0 ? "default" : "pointer",
                                                            padding: 0,
                                                          }}
                                                        >
                                                          ‹ Prev
                                                        </button>
                                                        <span>Page {page + 1} of {totalPages}</span>
                                                        <button
                                                          type="button"
                                                          onClick={() => setJournalPairPage((p) => (p < totalPages - 1 ? p + 1 : p))}
                                                          disabled={page >= totalPages - 1}
                                                          style={{
                                                            border: "none",
                                                            background: "transparent",
                                                            color: page >= totalPages - 1 ? "var(--text-muted)" : "var(--accent)",
                                                            cursor: page >= totalPages - 1 ? "default" : "pointer",
                                                            padding: 0,
                                                          }}
                                                        >
                                                          Next ›
                                                        </button>
                                                      </div>
                                                    )}
                                                  </>
                                                )}
                                              </>
                                            );
                                          })()}
                                        </div>
                                      )}
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
          {selectedTradeIdsForPaper.size > 0 && dataMode !== "sandbox" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 16px", backgroundColor: "color-mix(in srgb, var(--accent) 18%, var(--bg-tertiary))", borderBottom: "2px solid var(--accent)" }}>
              <button type="button" onClick={clearPaperSelection} style={{ padding: "6px 12px", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: "pointer" }} title="Clear selection">
                Deselect all
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>
                  {selectedTradeIdsForPaper.size} selected
                </span>
                {dataMode === "paper" ? (
                  <button type="button" onClick={removePaperFromSelected} style={{ padding: "8px 18px", fontSize: "13px", fontWeight: "600", border: "none", borderRadius: "8px", background: "var(--accent)", color: "white", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }}>
                    Mark as real ({selectedTradeIdsForPaper.size})
                  </button>
                ) : (
                  <button type="button" onClick={markSelectedAsPaper} style={{ padding: "8px 18px", fontSize: "13px", fontWeight: "600", border: "none", borderRadius: "8px", background: "var(--accent)", color: "white", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }}>
                    Mark as paper ({selectedTradeIdsForPaper.size})
                  </button>
                )}
              </div>
            </div>
          )}
          <div style={{ overflowY: "auto", overflowX: "auto", maxHeight: "calc(100vh - 260px)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 9, backgroundColor: "var(--bg-tertiary)", boxShadow: "0 1px 0 0 var(--border-color)" }}>
                <tr style={{ backgroundColor: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-color)" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", width: "40px" }}>
                  </th>
                  <SortableHeader column="date" label="Date" viewMode={viewMode} />
                  <SortableHeader column="symbol" label="Symbol" viewMode={viewMode} />
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                    Side
                  </th>
                  <SortableHeader column="quantity" label="Quantity" viewMode={viewMode} />
                  <SortableHeader column="price" label="Price" viewMode={viewMode} />
                  <SortableHeader column="position_size" label="Position size" viewMode={viewMode} />
                  {!hidePnlDollars && <SortableHeader column="pnl" label="P&L" viewMode={viewMode} />}
                  <SortableHeader column="type" label="Type" viewMode={viewMode} />
                  <SortableHeader column="status" label="Status" viewMode={viewMode} />
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", minWidth: "100px", whiteSpace: "nowrap" }}>
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
                  <th style={{ padding: "12px 8px", textAlign: "center", fontSize: "12px", fontWeight: "600", color: "var(--text-primary)", textTransform: "uppercase", minWidth: "90px", whiteSpace: "nowrap", backgroundColor: "var(--bg-secondary)" }} title={dataMode === "paper" ? "Select to mark as real" : "Select to mark as paper"} onClick={(e) => e.stopPropagation()}>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", cursor: "pointer", margin: 0 }}>
                      <input
                        ref={paperSelectAllCheckboxRef}
                        type="checkbox"
                        checked={paperSelectAllChecked}
                        onChange={(e) => (e.target.checked ? selectAllForPaper() : clearPaperSelection())}
                        style={{ cursor: "pointer" }}
                        title={paperSelectAllChecked ? "Deselect all" : "Select all visible"}
                      />
                      <span style={{ marginLeft: "4px" }}>{dataMode === "paper" ? "Real" : "Paper"}</span>
                    </label>
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", width: "56px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                      <span>Delete</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const newLocked = !deleteLocked;
                          setDeleteLocked(newLocked);
                          localStorage.setItem(DELETE_LOCK_STORAGE_KEY, String(newLocked));
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "2px",
                          cursor: "pointer",
                          color: deleteLocked ? "var(--accent)" : "var(--text-secondary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        title={deleteLocked ? "Unlock to allow deleting trades" : "Lock to prevent deleting trades"}
                      >
                        {deleteLocked ? <Lock size={14} /> : <Unlock size={14} />}
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
                          {formatWithCommas(trade.quantity, { minDecimals: 4, maxDecimals: 4 })}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }}>
                          ${formatWithCommas(trade.price, { decimals: 2 })}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right", fontWeight: "600" }}>
                          ${formatWithCommas(trade.quantity * trade.price, { decimals: 2 })}
                        </td>
                        {!hidePnlDollars && (
                          <td style={{ padding: "12px 16px", fontSize: "14px", textAlign: "right" }} title={hasPairs ? undefined : "Realized P&L when this trade is paired (matched with an opposite leg)"}>
                            {hasPairs ? (
                              <span
                                style={{
                                  fontWeight: "600",
                                  color: totalPnL >= 0 ? "var(--profit)" : "var(--loss)",
                                }}
                              >
                                {totalPnL >= 0 ? "+" : ""}${formatWithCommas(totalPnL, { decimals: 2 })}
                              </span>
                            ) : (
                              <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>—</span>
                            )}
                          </td>
                        )}
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
                        <td style={{ padding: "12px 8px", textAlign: "center", width: "52px" }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                            <label style={{ display: "flex", cursor: "pointer", margin: 0 }} title="Select for Mark as paper">
                              <input type="checkbox" checked={selectedTradeIdsForPaper.has(trade.id)} onChange={() => {}} onClick={(e) => togglePaperSelection(trade.id, e as unknown as React.MouseEvent)} style={{ cursor: "pointer" }} />
                            </label>
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                          <button
                            onClick={(e) => handleDeleteTrade(trade.id, e)}
                            disabled={deleteLocked}
                            title={deleteLocked ? "Unlock delete to remove this trade" : "Delete this trade"}
                            style={{
                              background: deleteLocked ? "var(--bg-secondary)" : "transparent",
                              border: "none",
                              padding: "6px",
                              cursor: deleteLocked ? "not-allowed" : "pointer",
                              color: deleteLocked ? "var(--text-secondary)" : "var(--loss)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              margin: "0 auto",
                              borderRadius: "4px",
                              opacity: deleteLocked ? 0.6 : 1,
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                      {isExpanded && hasPairs && relevantPairs.length > 0 && (
                        <tr key={`${trade.id}-details`}>
                          <td colSpan={12} style={{ padding: "0", backgroundColor: "var(--bg-tertiary)" }}>
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
                                          <span>${formatWithCommas(trade.side === "BUY" ? pair.exit_price : pair.entry_price, { decimals: 2 })}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Quantity:</span>
                                          <span>{formatWithCommas(pair.quantity, { minDecimals: 4, maxDecimals: 4 })}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Fees:</span>
                                          <span>${formatWithCommas(trade.side === "BUY" ? pair.exit_fees : pair.entry_fees, { decimals: 2 })}</span>
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
                                          <span>${formatWithCommas(trade.side === "BUY" ? pair.entry_price : pair.exit_price, { decimals: 2 })}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Quantity:</span>
                                          <span>{formatWithCommas(pair.quantity, { minDecimals: 4, maxDecimals: 4 })}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ color: "var(--text-secondary)" }}>Fees:</span>
                                          <span>${formatWithCommas(trade.side === "BUY" ? pair.entry_fees : pair.exit_fees, { decimals: 2 })}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div style={{ gridColumn: "1 / -1", paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                                          {!hidePnlDollars && (
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
                                                {pair.net_profit_loss >= 0 ? "+" : ""}${formatWithCommas(pair.net_profit_loss, { decimals: 2 })}
                                              </span>
                                            </div>
                                          )}
                                          {!hidePnlPercent && (
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
                                                  return `${percentage >= 0 ? "+" : ""}${formatWithCommas(percentage, { decimals: 2 })}%`;
                                                })()}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                                          {!hidePnlDollars && (
                                            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                              Gross: ${formatWithCommas(pair.gross_profit_loss, { decimals: 2 })}
                                            </div>
                                          )}
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
                                      <div style={{ marginTop: "12px", position: "relative" }}>
                                        <button
                                          type="button"
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            const key = `${pair.entry_trade_id}_${pair.exit_trade_id}`;
                                            if (openJournalPairKey === key) {
                                              setOpenJournalPairKey(null);
                                              setJournalPairPage(0);
                                              return;
                                            }
                                            await loadJournalEntriesForPair(pair.entry_trade_id, pair.exit_trade_id);
                                            setOpenJournalPairKey(key);
                                            setJournalPairPage(0);
                                          }}
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            padding: "6px 12px",
                                            backgroundColor: openJournalPairKey === `${pair.entry_trade_id}_${pair.exit_trade_id}` ? "var(--accent)" : "transparent",
                                            border: "1px solid var(--accent)",
                                            borderRadius: "4px",
                                            color: openJournalPairKey === `${pair.entry_trade_id}_${pair.exit_trade_id}` ? "white" : "var(--accent)",
                                            fontSize: "12px",
                                            fontWeight: "500",
                                            cursor: "pointer",
                                          }}
                                        >
                                          <ChevronDown
                                            size={14}
                                            style={{
                                              transform: openJournalPairKey === `${pair.entry_trade_id}_${pair.exit_trade_id}` ? "rotate(0deg)" : "rotate(-90deg)",
                                              transition: "transform 0.2s",
                                            }}
                                          />
                                          Journal entries
                                          {journalEntriesByPairKey[`${pair.entry_trade_id}_${pair.exit_trade_id}`] !== undefined &&
                                            ` (${journalEntriesByPairKey[`${pair.entry_trade_id}_${pair.exit_trade_id}`].length})`}
                                        </button>
                                        {openJournalPairKey === `${pair.entry_trade_id}_${pair.exit_trade_id}` && (
                                          <div
                                            style={{
                                              position: "absolute",
                                              left: 0,
                                              top: "100%",
                                              marginTop: "4px",
                                              zIndex: 20,
                                              minWidth: "220px",
                                              maxWidth: "320px",
                                              maxHeight: "240px",
                                              overflowY: "auto",
                                              backgroundColor: "var(--bg-secondary)",
                                              border: "1px solid var(--border-color)",
                                              borderRadius: "8px",
                                              boxShadow: "0 8px 20px rgba(0, 0, 0, 0.4)",
                                              padding: "8px",
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {journalEntriesByPairKey[`${pair.entry_trade_id}_${pair.exit_trade_id}`] === undefined ? (
                                              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Loading...</div>
                                            ) : (() => {
                                              const entries = journalEntriesByPairKey[`${pair.entry_trade_id}_${pair.exit_trade_id}`];
                                              const totalPages = Math.max(1, Math.ceil(entries.length / JOURNAL_ENTRIES_PER_PAGE));
                                              const page = Math.min(journalPairPage, totalPages - 1);
                                              const start = page * JOURNAL_ENTRIES_PER_PAGE;
                                              const pageEntries = entries.slice(start, start + JOURNAL_ENTRIES_PER_PAGE);
                                              return (
                                                <>
                                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>
                                                    <span>Linked journal entries</span>
                                                    <button
                                                      type="button"
                                                      onClick={() => { setOpenJournalPairKey(null); setJournalPairPage(0); }}
                                                      style={{ border: "none", background: "transparent", color: "var(--text-secondary)", fontSize: "10px", cursor: "pointer" }}
                                                    >
                                                      Close
                                                    </button>
                                                  </div>
                                                  {pageEntries.length === 0 ? (
                                                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>No journal entries linked</div>
                                                  ) : (
                                                    <>
                                                      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                                                        {pageEntries.map((entry) => (
                                                          <li key={entry.id}>
                                                            <button
                                                              type="button"
                                                              onClick={() => navigate("/journal", { state: { openEntryId: entry.id } })}
                                                              style={{
                                                                border: "none",
                                                                background: "transparent",
                                                                padding: 0,
                                                                textAlign: "left",
                                                                fontSize: "11px",
                                                                color: "var(--accent)",
                                                                cursor: "pointer",
                                                                whiteSpace: "nowrap",
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis",
                                                                width: "100%",
                                                              }}
                                                              title={entry.title}
                                                            >
                                                              {entry.title || "Untitled entry"}
                                                            </button>
                                                          </li>
                                                        ))}
                                                      </ul>
                                                      {totalPages > 1 && (
                                                        <div style={{ marginTop: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", color: "var(--text-secondary)" }}>
                                                          <button
                                                            type="button"
                                                            onClick={() => setJournalPairPage((p) => (p > 0 ? p - 1 : p))}
                                                            disabled={page === 0}
                                                            style={{
                                                              border: "none",
                                                              background: "transparent",
                                                              color: page === 0 ? "var(--text-muted)" : "var(--accent)",
                                                              cursor: page === 0 ? "default" : "pointer",
                                                              padding: 0,
                                                            }}
                                                          >
                                                            ‹ Prev
                                                          </button>
                                                          <span>Page {page + 1} of {totalPages}</span>
                                                          <button
                                                            type="button"
                                                            onClick={() => setJournalPairPage((p) => (p < totalPages - 1 ? p + 1 : p))}
                                                            disabled={page >= totalPages - 1}
                                                            style={{
                                                              border: "none",
                                                              background: "transparent",
                                                              color: page >= totalPages - 1 ? "var(--text-muted)" : "var(--accent)",
                                                              cursor: page >= totalPages - 1 ? "default" : "pointer",
                                                              padding: 0,
                                                            }}
                                                          >
                                                            Next ›
                                                          </button>
                                                        </div>
                                                      )}
                                                    </>
                                                  )}
                                                </>
                                              );
                                            })()}
                                          </div>
                                        )}
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
