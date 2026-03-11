import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, BarChart3, Lock, Unlock, Search, ArrowUpDown, ArrowUp, ArrowDown, Trash2, Filter } from "lucide-react";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { TradeChart } from "../components/TradeChart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { formatWithCommas } from "../utils/formatCompactNumber";
import {
  loadSandboxState,
  deleteSandboxTrade,
  updateSandboxTradeStrategy,
  updateSandboxTradeNotes,
  getSandboxJournalEntries,
  getSandboxEmotionalStates,
  getSandboxEmotionalStatesForJournal,
  updateSandboxEmotionalState,
  updateSandboxJournalEntry,
} from "../utils/sandboxStore";
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

interface JournalEntryForLink {
  id: number;
  date: string;
  title: string;
  strategy_id: number | null;
  linked_trade_ids?: string | null;
}

interface TradeEmotionalState {
  id: number;
  timestamp: string;
  emotion: string;
  intensity: number;
  notes: string | null;
  trade_id: number | null;
  journal_entry_id?: number | null;
  journal_trade_id?: number | null;
  journal_entry_ids?: string | null;
  trade_ids?: string | null;
}

function getEmotionalStateIdsForRealTrade(tradeId: number, states: TradeEmotionalState[]): number[] {
  const ids: number[] = [];
  for (const s of states) {
    if (s.trade_id === tradeId) {
      ids.push(s.id);
      continue;
    }
    if (s.trade_ids) {
      try {
        const arr = JSON.parse(s.trade_ids) as number[];
        if (Array.isArray(arr) && arr.includes(tradeId)) ids.push(s.id);
      } catch {
        // ignore
      }
    }
  }
  return ids;
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
const JOURNAL_MAP_STORAGE_KEY_BASE = "tradebutler_trade_journal_map_";
const EMO_STATE_MAP_STORAGE_KEY_BASE = "tradebutler_trade_emotional_state_map_";
const JOURNAL_PAIR_MAP_STORAGE_KEY_BASE = "tradebutler_pair_journal_map_";
const EMO_PAIR_MAP_STORAGE_KEY_BASE = "tradebutler_pair_emotional_state_map_";

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
  const [chartCollapsedForPosition, setChartCollapsedForPosition] = useState<Set<number>>(new Set());
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
  const location = useLocation();
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  /** Trade IDs selected for bulk "Mark as paper" / "Remove paper" (checkboxes in Paper column). */
  const [selectedTradeIdsForPaper, setSelectedTradeIdsForPaper] = useState<Set<number>>(new Set());
  const stickyBarRef = useRef<HTMLDivElement>(null);
  const paperSelectAllCheckboxRef = useRef<HTMLInputElement>(null);

  const [journalEntriesForLink, setJournalEntriesForLink] = useState<JournalEntryForLink[]>([]);
  const [journalEntryIdsByTradeId, setJournalEntryIdsByTradeId] = useState<Record<number, number[]>>({});
  const [emotionalStatesForLink, setEmotionalStatesForLink] = useState<TradeEmotionalState[]>([]);
  const [emotionalStateIdsByTradeId, setEmotionalStateIdsByTradeId] = useState<Record<number, number[]>>({});
  const [journalPopoverTradeId, setJournalPopoverTradeId] = useState<number | null>(null);
  const [emotionPopoverTradeId, setEmotionPopoverTradeId] = useState<number | null>(null);
  const journalPopoverRef = useRef<HTMLDivElement>(null);
  const emotionPopoverRef = useRef<HTMLDivElement>(null);
  const [journalEntryIdsByPairKey, setJournalEntryIdsByPairKey] = useState<Record<string, number[]>>({});
  const [emotionalStateIdsByPairKey, setEmotionalStateIdsByPairKey] = useState<Record<string, number[]>>({});
  const [journalPairPopoverKey, setJournalPairPopoverKey] = useState<string | null>(null);
  const [emotionPairPopoverKey, setEmotionPairPopoverKey] = useState<string | null>(null);
  const journalPairPopoverRef = useRef<HTMLDivElement>(null);
  const emotionPairPopoverRef = useRef<HTMLDivElement>(null);

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

  // When navigated from Dashboard "Open Positions" with expandPositionEntryId, switch to Pair view and expand that position
  const expandPositionEntryIdRef = useRef<number | null>(null);
  useEffect(() => {
    const state = location.state as { expandPositionEntryId?: number } | null;
    const entryId = state?.expandPositionEntryId;
    if (entryId != null) {
      expandPositionEntryIdRef.current = entryId;
    }
  }, [location.state]);
  useEffect(() => {
    const entryId = expandPositionEntryIdRef.current;
    if (entryId == null || positionGroups.length === 0) return;
    const hasGroup = positionGroups.some((g) => g.entry_trade.id === entryId);
    if (hasGroup) {
      setViewMode("Pair");
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, "Pair");
      setExpandedTrades((prev) => new Set([...prev, entryId]));
      expandPositionEntryIdRef.current = null;
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [positionGroups, navigate, location.pathname]);

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

  useEffect(() => {
    const tradeIds = tradesWithPairing.map((t) => t.trade.id);
    if (tradeIds.length === 0) {
      setJournalEntriesForLink([]);
      setJournalEntryIdsByTradeId({});
      setEmotionalStatesForLink([]);
      setEmotionalStateIdsByTradeId({});
      return;
    }

    const loadLinks = async () => {
      try {
        if (dataMode === "sandbox") {
          const entries = getSandboxJournalEntries() as unknown as JournalEntryForLink[];
          setJournalEntriesForLink(entries);
          const journalMap: Record<number, number[]> = {};
          for (const tid of tradeIds) journalMap[tid] = [];
          for (const entry of entries) {
            if (!entry.linked_trade_ids) continue;
            try {
              const ids = JSON.parse(entry.linked_trade_ids) as number[];
              if (!Array.isArray(ids)) continue;
              for (const tid of ids) {
                if (tradeIds.includes(tid) && !journalMap[tid].includes(entry.id)) {
                  journalMap[tid].push(entry.id);
                }
              }
            } catch {
              // ignore
            }
          }
          let storedJournal: Record<number, number[]> = {};
          try {
            const raw = localStorage.getItem(`${JOURNAL_MAP_STORAGE_KEY_BASE}${dataMode}`);
            if (raw) {
              const parsed = JSON.parse(raw) as Record<string, number[]>;
              storedJournal = Object.fromEntries(
                Object.entries(parsed).map(([k, v]) => [Number(k), Array.isArray(v) ? v : []])
              );
            }
          } catch {
            storedJournal = {};
          }
          for (const tid of tradeIds) {
            if (storedJournal[tid]?.length) {
              const combined = [...new Set([...journalMap[tid], ...storedJournal[tid]])];
              journalMap[tid] = combined.filter((id) => entries.some((e) => e.id === id));
            }
          }
          saveJournalMapForMode(journalMap, dataMode);
          setJournalEntryIdsByTradeId(journalMap);

          const emoStates = getSandboxEmotionalStates() as unknown as TradeEmotionalState[];
          setEmotionalStatesForLink(emoStates);
          let storedEmo: Record<number, number[]> = {};
          try {
            const raw = localStorage.getItem(`${EMO_STATE_MAP_STORAGE_KEY_BASE}${dataMode}`);
            if (raw) {
              const parsed = JSON.parse(raw) as Record<string, number[]>;
              storedEmo = Object.fromEntries(
                Object.entries(parsed).map(([k, v]) => [Number(k), Array.isArray(v) ? v : []])
              );
            }
          } catch {
            storedEmo = {};
          }
          const emoMap: Record<number, number[]> = {};
          for (const tid of tradeIds) {
            emoMap[tid] = getEmotionalStateIdsForRealTrade(tid, emoStates);
            for (const jeId of journalMap[tid]) {
              const forEntry = (getSandboxEmotionalStatesForJournal(jeId) as unknown as TradeEmotionalState[]).map((s) => s.id);
              for (const id of forEntry) {
                if (!emoMap[tid].includes(id)) emoMap[tid].push(id);
              }
            }
            if (storedEmo[tid]?.length) {
              emoMap[tid] = [...new Set([...emoMap[tid], ...storedEmo[tid]])].filter((id) => emoStates.some((s) => s.id === id));
            }
          }
          saveEmotionalStateMapForMode(emoMap, dataMode);
          setEmotionalStateIdsByTradeId(emoMap);
          return;
        }

        const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
        const [entries, emoStates] = await Promise.all([
          invoke<JournalEntryForLink[]>("get_journal_entries", paperArgs),
          invoke<TradeEmotionalState[]>("get_emotional_states", paperArgs),
        ]);
        setJournalEntriesForLink(entries);
        setEmotionalStatesForLink(emoStates);

        let storedJournalMap: Record<number, number[]> = {};
        try {
          const raw = localStorage.getItem(`${JOURNAL_MAP_STORAGE_KEY_BASE}${dataMode}`);
          if (raw) {
            const parsed = JSON.parse(raw) as Record<string, number[]>;
            storedJournalMap = Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [Number(k), Array.isArray(v) ? v : []])
            );
          }
        } catch {
          storedJournalMap = {};
        }

        const journalMap: Record<number, number[]> = {};
        for (const tid of tradeIds) journalMap[tid] = [];
        for (const entry of entries) {
          if (!entry.linked_trade_ids) continue;
          try {
            const ids = JSON.parse(entry.linked_trade_ids) as number[];
            if (!Array.isArray(ids)) continue;
            for (const tid of ids) {
              if (tradeIds.includes(tid) && !journalMap[tid].includes(entry.id)) {
                journalMap[tid].push(entry.id);
              }
            }
          } catch {
            // ignore
          }
        }
        for (const tid of tradeIds) {
          if (storedJournalMap[tid]?.length) {
            journalMap[tid] = [...new Set([...journalMap[tid], ...storedJournalMap[tid]])].filter((id) => entries.some((e) => e.id === id));
          }
        }
        saveJournalMapForMode(journalMap, dataMode);
        setJournalEntryIdsByTradeId(journalMap);

        let storedEmoMap: Record<number, number[]> = {};
        try {
          const raw = localStorage.getItem(`${EMO_STATE_MAP_STORAGE_KEY_BASE}${dataMode}`);
          if (raw) {
            const parsed = JSON.parse(raw) as Record<string, number[]>;
            storedEmoMap = Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [Number(k), Array.isArray(v) ? v : []])
            );
          }
        } catch {
          storedEmoMap = {};
        }

        const emoMap: Record<number, number[]> = {};
        for (const tid of tradeIds) {
          emoMap[tid] = getEmotionalStateIdsForRealTrade(tid, emoStates);
          for (const jeId of journalMap[tid]) {
            const byEntry = emoStates.filter((s) => {
              if (s.journal_entry_id === jeId) return true;
              if (!s.journal_entry_ids) return false;
              try {
                const arr = JSON.parse(s.journal_entry_ids) as number[];
                return Array.isArray(arr) && arr.includes(jeId);
              } catch {
                return false;
              }
            });
            for (const s of byEntry) {
              if (!emoMap[tid].includes(s.id)) emoMap[tid].push(s.id);
            }
          }
          if (storedEmoMap[tid]?.length) {
            emoMap[tid] = [...new Set([...emoMap[tid], ...storedEmoMap[tid]])].filter((id) => emoStates.some((s) => s.id === id));
          }
        }
        saveEmotionalStateMapForMode(emoMap, dataMode);
        setEmotionalStateIdsByTradeId(emoMap);
      } catch (e) {
        console.error("Failed to load journal / emotional links for trades:", e);
        setJournalEntriesForLink([]);
        setJournalEntryIdsByTradeId({});
        setEmotionalStatesForLink([]);
        setEmotionalStateIdsByTradeId({});
      }
    };

    loadLinks();
  }, [tradesWithPairing, dataMode]);

  // Load journal/emotional links for pairs (Pair view)
  useEffect(() => {
    if (viewMode !== "Pair" || positionGroups.length === 0) {
      return;
    }
    const pairKeys: string[] = [];
    for (const group of positionGroups) {
      if (group.position_trades.length >= 1) {
        const exitId = group.position_trades[group.position_trades.length - 1].id;
        pairKeys.push(`${group.entry_trade.id}_${exitId}`);
      }
    }
    if (pairKeys.length === 0) return;

    const loadPairLinks = async () => {
      try {
        let entries = journalEntriesForLink;
        let emoStates = emotionalStatesForLink;
        if (entries.length === 0 && emoStates.length === 0 && dataMode !== "sandbox") {
          const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
          const [e, s] = await Promise.all([
            invoke<JournalEntryForLink[]>("get_journal_entries", paperArgs),
            invoke<TradeEmotionalState[]>("get_emotional_states", paperArgs),
          ]);
          entries = e;
          emoStates = s;
        }

        let storedJournal: Record<string, number[]> = {};
        let storedEmo: Record<string, number[]> = {};
        try {
          const rj = localStorage.getItem(`${JOURNAL_PAIR_MAP_STORAGE_KEY_BASE}${dataMode}`);
          if (rj) {
            const p = JSON.parse(rj) as Record<string, number[]>;
            storedJournal = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? v : []]));
          }
        } catch {
          storedJournal = {};
        }
        try {
          const re = localStorage.getItem(`${EMO_PAIR_MAP_STORAGE_KEY_BASE}${dataMode}`);
          if (re) {
            const p = JSON.parse(re) as Record<string, number[]>;
            storedEmo = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? v : []]));
          }
        } catch {
          storedEmo = {};
        }

        const journalMap: Record<string, number[]> = {};
        const emoMap: Record<string, number[]> = {};
        for (const key of pairKeys) {
          const [entryId, exitId] = key.split("_").map(Number);
          journalMap[key] = [];
          for (const entry of entries) {
            if (!entry.linked_trade_ids) continue;
            try {
              const ids = JSON.parse(entry.linked_trade_ids) as number[];
              if (Array.isArray(ids) && ids.includes(entryId) && ids.includes(exitId)) {
                journalMap[key].push(entry.id);
              }
            } catch {
              // ignore
            }
          }
          emoMap[key] = [];
          for (const s of emoStates) {
            let tids: number[] = [];
            if (s.trade_ids) {
              try {
                const arr = JSON.parse(s.trade_ids) as number[];
                if (Array.isArray(arr)) tids = arr;
              } catch {
                if (s.trade_id != null) tids = [s.trade_id];
              }
            } else if (s.trade_id != null) {
              tids = [s.trade_id];
            }
            if (tids.includes(entryId) && tids.includes(exitId)) {
              emoMap[key].push(s.id);
            }
          }
          if (storedJournal[key]?.length) {
            journalMap[key] = [...new Set([...journalMap[key], ...storedJournal[key]])].filter((id) => entries.some((e) => e.id === id));
          }
          if (storedEmo[key]?.length) {
            emoMap[key] = [...new Set([...emoMap[key], ...storedEmo[key]])].filter((id) => emoStates.some((s) => s.id === id));
          }
        }
        setJournalEntryIdsByPairKey(journalMap);
        setEmotionalStateIdsByPairKey(emoMap);
      } catch (e) {
        console.error("Failed to load pair links:", e);
      }
    };
    loadPairLinks();
  }, [viewMode, positionGroups, dataMode, journalEntriesForLink.length, emotionalStatesForLink.length]);

  // Close journal/emotion popovers on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (journalPopoverTradeId != null && journalPopoverRef.current && !journalPopoverRef.current.contains(t)) {
        setJournalPopoverTradeId(null);
      }
      if (emotionPopoverTradeId != null && emotionPopoverRef.current && !emotionPopoverRef.current.contains(t)) {
        setEmotionPopoverTradeId(null);
      }
      if (journalPairPopoverKey != null && journalPairPopoverRef.current && !journalPairPopoverRef.current.contains(t)) {
        setJournalPairPopoverKey(null);
      }
      if (emotionPairPopoverKey != null && emotionPairPopoverRef.current && !emotionPairPopoverRef.current.contains(t)) {
        setEmotionPairPopoverKey(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [journalPopoverTradeId, emotionPopoverTradeId, journalPairPopoverKey, emotionPairPopoverKey]);

  const loadData = async () => {
    try {
      if (dataMode === "sandbox") {
        // Use sandbox store data and build position groups + pairs client-side
        let state: { trades?: unknown[]; strategies?: { id: number; name: string; color: string | null }[] };
        try {
          state = loadSandboxState();
        } catch (e) {
          console.error("loadSandboxState failed:", e);
          state = { trades: [], strategies: [] };
        }
        type SandboxTrade = { id: number; symbol: string; side: string; quantity: number; price: number; timestamp: string; order_type?: string; status?: string; fees: number | null; notes: string | null; strategy_id: number | null };
        const tradesList = (Array.isArray(state?.trades) ? state.trades : []) as SandboxTrade[];
        const strategiesList = Array.isArray(state?.strategies) ? state.strategies : [];
        let positionGroupsResult: { positionGroups: PositionGroup[]; pairs: PairedTrade[] };
        try {
          const built = buildPositionGroupsAndPairs(
            tradesList.map((t) => ({
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
          positionGroupsResult = {
            positionGroups: (built.positionGroups ?? []).map((g) => ({
              entry_trade: g.entry_trade as Trade,
              position_trades: (g.position_trades ?? []) as Trade[],
              total_pnl: g.total_pnl ?? 0,
              final_quantity: g.final_quantity ?? 0,
            })),
            pairs: built.pairs ?? [],
          };
        } catch (e) {
          console.error("buildPositionGroupsAndPairs failed:", e);
          positionGroupsResult = { positionGroups: [], pairs: [] };
        }
        const groups = positionGroupsResult.positionGroups;
        const pairs = positionGroupsResult.pairs;
        const entryPairsByTrade = new Map<number, PairedTrade[]>();
        const exitPairsByTrade = new Map<number, PairedTrade[]>();
        for (const p of pairs) {
          const pair: PairedTrade = { ...p };
          if (!entryPairsByTrade.has(p.entry_trade_id)) entryPairsByTrade.set(p.entry_trade_id, []);
          entryPairsByTrade.get(p.entry_trade_id)!.push(pair);
          if (!exitPairsByTrade.has(p.exit_trade_id)) exitPairsByTrade.set(p.exit_trade_id, []);
          exitPairsByTrade.get(p.exit_trade_id)!.push(pair);
        }
        const mappedTrades: TradeWithPairing[] = tradesList.map((t) => ({
          trade: {
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            quantity: t.quantity,
            price: t.price,
            timestamp: t.timestamp,
            order_type: t.order_type ?? "",
            status: t.status ?? "Filled",
            fees: t.fees,
            notes: t.notes,
            strategy_id: t.strategy_id,
          },
          entry_pairs: entryPairsByTrade.get(t.id) ?? [],
          exit_pairs: exitPairsByTrade.get(t.id) ?? [],
        }));
        setTradesWithPairing(mappedTrades);
        setPositionGroups(groups);
        setStrategies(
          strategiesList.map((s) => ({
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

  const saveEmotionalStateMapForMode = (map: Record<number, number[]>, mode: DataMode) => {
    try {
      const key = `${EMO_STATE_MAP_STORAGE_KEY_BASE}${mode}`;
      localStorage.setItem(key, JSON.stringify(map));
    } catch {
      // ignore storage errors
    }
  };

  const saveJournalMapForMode = (map: Record<number, number[]>, mode: DataMode) => {
    try {
      const key = `${JOURNAL_MAP_STORAGE_KEY_BASE}${mode}`;
      localStorage.setItem(key, JSON.stringify(map));
    } catch {
      // ignore storage errors
    }
  };

  const updateEntryLinkedTradeIds = (entry: JournalEntryForLink, tradeId: number, add: boolean): { ids: number[] } => {
    let ids: number[] = [];
    if (entry.linked_trade_ids) {
      try {
        const parsed = JSON.parse(entry.linked_trade_ids) as number[];
        if (Array.isArray(parsed)) ids = parsed;
      } catch {
        ids = [];
      }
    }
    if (add) {
      if (!ids.includes(tradeId)) ids.push(tradeId);
    } else {
      ids = ids.filter((id) => id !== tradeId);
    }
    return { ids };
  };

  // For a given trade, return all trade IDs that belong to the same pair(s)
  // (entry + exit) so that linked journals/emotions stay in sync across the pair.
  const getAllTradeIdsForTrade = (tradeId: number): number[] => {
    const tw = tradesWithPairing.find((t) => t.trade.id === tradeId);
    if (!tw) return [tradeId];
    const ids = new Set<number>([tradeId]);
    tw.entry_pairs.forEach((p) => {
      ids.add(p.entry_trade_id);
      ids.add(p.exit_trade_id);
    });
    tw.exit_pairs.forEach((p) => {
      ids.add(p.entry_trade_id);
      ids.add(p.exit_trade_id);
    });
    return Array.from(ids);
  };

  const handleToggleJournalLink = async (tradeId: number, entryId: number, checked: boolean) => {
    const entry = journalEntriesForLink.find((e) => e.id === entryId);
    if (!entry) return;

    const allTradeIds = getAllTradeIdsForTrade(tradeId);

    // Keep the underlying journal's linked_trade_ids in sync for the whole pair
    let ids: number[] = [];
    if (entry.linked_trade_ids) {
      try {
        const parsed = JSON.parse(entry.linked_trade_ids) as number[];
        if (Array.isArray(parsed)) ids = parsed;
      } catch {
        ids = [];
      }
    }
    if (checked) {
      for (const tid of allTradeIds) {
        if (!ids.includes(tid)) ids.push(tid);
      }
    } else {
      ids = ids.filter((id) => !allTradeIds.includes(id));
    }
    try {
      if (dataMode === "sandbox") {
        updateSandboxJournalEntry(entryId, { linked_trade_ids: ids.length > 0 ? JSON.stringify(ids) : null });
      } else {
        await invoke("update_journal_entry", {
          id: entry.id,
          date: entry.date,
          title: entry.title,
          strategyId: entry.strategy_id,
          linked_trade_ids: ids.length > 0 ? JSON.stringify(ids) : null,
        });
      }
      setJournalEntriesForLink((prev) =>
        prev.map((e) =>
          e.id === entryId ? { ...e, linked_trade_ids: ids.length > 0 ? JSON.stringify(ids) : null } : e
        )
      );
      setJournalEntryIdsByTradeId((prev) => {
        const nextMap: Record<number, number[]> = { ...prev };
        for (const tid of allTradeIds) {
          const current = nextMap[tid] ?? [];
          const next = checked
            ? (current.includes(entryId) ? current : [...current, entryId])
            : current.filter((id) => id !== entryId);
          nextMap[tid] = next;
        }
        saveJournalMapForMode(nextMap, dataMode);
        return nextMap;
      });

      // When linking a journal, auto-link all emotional states linked to that journal to this trade
      if (checked) {
        try {
          let statesForEntry: TradeEmotionalState[] = [];
          if (dataMode === "sandbox") {
            statesForEntry = getSandboxEmotionalStatesForJournal(entryId) as unknown as TradeEmotionalState[];
          } else {
            const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
            statesForEntry = await invoke<TradeEmotionalState[]>("get_emotional_states_for_journal", {
              journalEntryId: entryId,
              ...paperArgs,
            });
          }
          const currentEmoIds = emotionalStateIdsByTradeId[tradeId] ?? [];
          const toAdd = statesForEntry.filter((s) => !currentEmoIds.includes(s.id));
          for (const s of toAdd) {
            let stateTradeIds: number[] = [];
            if (s.trade_ids) {
              try {
                const parsed = JSON.parse(s.trade_ids) as number[];
                if (Array.isArray(parsed)) stateTradeIds = parsed;
              } catch {
                if (s.trade_id != null) stateTradeIds = [s.trade_id];
              }
            } else if (s.trade_id != null) {
              stateTradeIds = [s.trade_id];
            }
            let changed = false;
            for (const tid of allTradeIds) {
              if (!stateTradeIds.includes(tid)) {
                stateTradeIds.push(tid);
                changed = true;
              }
            }
            if (!changed) continue;
            const tradeIdsJson = JSON.stringify(stateTradeIds);
            if (dataMode === "sandbox") {
              updateSandboxEmotionalState(s.id, { trade_ids: tradeIdsJson });
            } else {
              await invoke("update_emotional_state_links", {
                id: s.id,
                journal_entry_ids: s.journal_entry_ids ?? null,
                trade_ids: tradeIdsJson,
              });
            }
            setEmotionalStatesForLink((prev) =>
              prev.map((st) => (st.id === s.id ? { ...st, trade_ids: tradeIdsJson } : st))
            );
          }
          if (toAdd.length > 0) {
            setEmotionalStateIdsByTradeId((prev) => {
              const nextMap: Record<number, number[]> = { ...prev };
              for (const tid of allTradeIds) {
                const next = [...(nextMap[tid] ?? []), ...toAdd.map((s) => s.id)];
                nextMap[tid] = [...new Set(next)];
              }
              saveEmotionalStateMapForMode(nextMap, dataMode);
              return nextMap;
            });
          }
        } catch (e) {
          console.error("Failed to auto-link emotional states for journal:", e);
        }
      }
    } catch (e) {
      console.error("Failed to toggle journal link:", e);
    }
  };

  const handleToggleEmotionalStateLink = async (tradeId: number, stateId: number, checked: boolean) => {
    const state = emotionalStatesForLink.find((s) => s.id === stateId);
    if (!state) return;

    const allTradeIds = getAllTradeIdsForTrade(tradeId);

    let ids: number[] = [];
    if (state.trade_ids) {
      try {
        const parsed = JSON.parse(state.trade_ids) as number[];
        if (Array.isArray(parsed)) ids = parsed;
      } catch {
        ids = [];
      }
    } else if (state.trade_id != null) {
      ids = [state.trade_id];
    }
    if (checked) {
      for (const tid of allTradeIds) {
        if (!ids.includes(tid)) ids.push(tid);
      }
    } else {
      ids = ids.filter((id) => !allTradeIds.includes(id));
    }
    const tradeIdsJson = ids.length > 0 ? JSON.stringify(ids) : null;
    try {
      if (dataMode === "sandbox") {
        updateSandboxEmotionalState(stateId, { trade_ids: tradeIdsJson });
      } else {
        await invoke("update_emotional_state_links", {
          id: stateId,
          journal_entry_ids: state.journal_entry_ids ?? null,
          trade_ids: tradeIdsJson,
        });
      }
      setEmotionalStatesForLink((prev) =>
        prev.map((s) => (s.id === stateId ? { ...s, trade_ids: tradeIdsJson } : s))
      );
      setEmotionalStateIdsByTradeId((prev) => {
        const nextMap: Record<number, number[]> = { ...prev };
        for (const tid of allTradeIds) {
          const current = nextMap[tid] ?? [];
          const next = checked
            ? (current.includes(stateId) ? current : [...current, stateId])
            : current.filter((id) => id !== stateId);
          nextMap[tid] = next;
        }
        saveEmotionalStateMapForMode(nextMap, dataMode);
        return nextMap;
      });

      // When linking an emotional state, auto-link any journals that state is linked to
      if (checked) {
        const journalEntryIdsFromState: number[] = [];
        if (state.journal_entry_id != null) journalEntryIdsFromState.push(state.journal_entry_id);
        if (state.journal_entry_ids) {
          try {
            const arr = JSON.parse(state.journal_entry_ids) as number[];
            if (Array.isArray(arr)) arr.forEach((id) => { if (!journalEntryIdsFromState.includes(id)) journalEntryIdsFromState.push(id); });
          } catch {
            // ignore
          }
        }
        const currentJournalIds = journalEntryIdsByTradeId[tradeId] ?? [];
        const entryIdsToAdd = journalEntryIdsFromState.filter((id) => !currentJournalIds.includes(id));
        for (const entryId of entryIdsToAdd) {
          const entry = journalEntriesForLink.find((e) => e.id === entryId);
          if (!entry) continue;
          let entryTradeIds: number[] = [];
          if (entry.linked_trade_ids) {
            try {
              const parsed = JSON.parse(entry.linked_trade_ids) as number[];
              if (Array.isArray(parsed)) entryTradeIds = parsed;
            } catch {
              entryTradeIds = [];
            }
          }
          let changed = false;
          for (const tid of allTradeIds) {
            if (!entryTradeIds.includes(tid)) {
              entryTradeIds.push(tid);
              changed = true;
            }
          }
          if (!changed) continue;
          const linkedTradeIdsJson = entryTradeIds.length > 0 ? JSON.stringify(entryTradeIds) : null;
          if (dataMode === "sandbox") {
            updateSandboxJournalEntry(entryId, { linked_trade_ids: linkedTradeIdsJson });
          } else {
            await invoke("update_journal_entry", {
              id: entry.id,
              date: entry.date,
              title: entry.title,
              strategyId: entry.strategy_id,
              linked_trade_ids: linkedTradeIdsJson,
            });
          }
          setJournalEntriesForLink((prev) =>
            prev.map((e) =>
              e.id === entryId ? { ...e, linked_trade_ids: linkedTradeIdsJson } : e
            )
          );
        }
        if (entryIdsToAdd.length > 0) {
          setJournalEntryIdsByTradeId((prev) => {
            const nextMap: Record<number, number[]> = { ...prev };
            for (const tid of allTradeIds) {
              const next = [...(nextMap[tid] ?? []), ...entryIdsToAdd];
              nextMap[tid] = [...new Set(next)];
            }
            saveJournalMapForMode(nextMap, dataMode);
            return nextMap;
          });
        }
      }
    } catch (e) {
      console.error("Failed to toggle emotional state link:", e);
    }
  };

  const saveJournalPairMapForMode = (map: Record<string, number[]>, mode: DataMode) => {
    try {
      localStorage.setItem(`${JOURNAL_PAIR_MAP_STORAGE_KEY_BASE}${mode}`, JSON.stringify(map));
    } catch {
      // ignore
    }
  };
  const saveEmotionalStatePairMapForMode = (map: Record<string, number[]>, mode: DataMode) => {
    try {
      localStorage.setItem(`${EMO_PAIR_MAP_STORAGE_KEY_BASE}${mode}`, JSON.stringify(map));
    } catch {
      // ignore
    }
  };

  const handleToggleJournalLinkForPair = async (pairKey: string, entryId: number, checked: boolean) => {
    const [entryTradeId, exitTradeId] = pairKey.split("_").map(Number);
    const entry = journalEntriesForLink.find((e) => e.id === entryId);
    if (!entry) return;
    let ids: number[] = [];
    if (entry.linked_trade_ids) {
      try {
        const parsed = JSON.parse(entry.linked_trade_ids) as number[];
        if (Array.isArray(parsed)) ids = parsed;
      } catch {
        ids = [];
      }
    }
    if (checked) {
      if (!ids.includes(entryTradeId)) ids.push(entryTradeId);
      if (!ids.includes(exitTradeId)) ids.push(exitTradeId);
    } else {
      ids = ids.filter((id) => id !== entryTradeId && id !== exitTradeId);
    }
    const linkedTradeIdsJson = ids.length > 0 ? JSON.stringify(ids) : null;
    try {
      if (dataMode === "sandbox") {
        updateSandboxJournalEntry(entryId, { linked_trade_ids: linkedTradeIdsJson });
      } else {
        await invoke("update_journal_entry", {
          id: entry.id,
          date: entry.date,
          title: entry.title,
          strategyId: entry.strategy_id,
          linked_trade_ids: linkedTradeIdsJson,
        });
      }
      setJournalEntriesForLink((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, linked_trade_ids: linkedTradeIdsJson } : e))
      );
      setJournalEntryIdsByPairKey((prev) => {
        const current = prev[pairKey] ?? [];
        const next = checked ? (current.includes(entryId) ? current : [...current, entryId]) : current.filter((id) => id !== entryId);
        const nextMap = { ...prev, [pairKey]: next };
        saveJournalPairMapForMode(nextMap, dataMode);
        return nextMap;
      });

      if (checked) {
        let statesForEntry: TradeEmotionalState[] = [];
        if (dataMode === "sandbox") {
          statesForEntry = getSandboxEmotionalStatesForJournal(entryId) as unknown as TradeEmotionalState[];
        } else {
          const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
          statesForEntry = await invoke<TradeEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: entryId, ...paperArgs });
        }
        const currentEmoIds = emotionalStateIdsByPairKey[pairKey] ?? [];
        const toAdd = statesForEntry.filter((s) => !currentEmoIds.includes(s.id));
        for (const s of toAdd) {
          let stateTradeIds: number[] = [];
          if (s.trade_ids) {
            try {
              const parsed = JSON.parse(s.trade_ids) as number[];
              if (Array.isArray(parsed)) stateTradeIds = parsed;
            } catch {
              if (s.trade_id != null) stateTradeIds = [s.trade_id];
            }
          } else if (s.trade_id != null) {
            stateTradeIds = [s.trade_id];
          }
          if (!stateTradeIds.includes(entryTradeId)) stateTradeIds.push(entryTradeId);
          if (!stateTradeIds.includes(exitTradeId)) stateTradeIds.push(exitTradeId);
          const tradeIdsJson = JSON.stringify(stateTradeIds);
          if (dataMode === "sandbox") {
            updateSandboxEmotionalState(s.id, { trade_ids: tradeIdsJson });
          } else {
            await invoke("update_emotional_state_links", { id: s.id, journal_entry_ids: s.journal_entry_ids ?? null, trade_ids: tradeIdsJson });
          }
          setEmotionalStatesForLink((prev) => prev.map((st) => (st.id === s.id ? { ...st, trade_ids: tradeIdsJson } : st)));
        }
        if (toAdd.length > 0) {
          setEmotionalStateIdsByPairKey((prev) => {
            const next = [...(prev[pairKey] ?? []), ...toAdd.map((s) => s.id)];
            const nextMap = { ...prev, [pairKey]: [...new Set(next)] };
            saveEmotionalStatePairMapForMode(nextMap, dataMode);
            return nextMap;
          });
        }
      }
    } catch (e) {
      console.error("Failed to toggle journal link for pair:", e);
    }
  };

  const handleToggleEmotionalStateLinkForPair = async (pairKey: string, stateId: number, checked: boolean) => {
    const [entryTradeId, exitTradeId] = pairKey.split("_").map(Number);
    const state = emotionalStatesForLink.find((s) => s.id === stateId);
    if (!state) return;
    let ids: number[] = [];
    if (state.trade_ids) {
      try {
        const parsed = JSON.parse(state.trade_ids) as number[];
        if (Array.isArray(parsed)) ids = parsed;
      } catch {
        ids = [];
      }
    } else if (state.trade_id != null) {
      ids = [state.trade_id];
    }
    if (checked) {
      if (!ids.includes(entryTradeId)) ids.push(entryTradeId);
      if (!ids.includes(exitTradeId)) ids.push(exitTradeId);
    } else {
      ids = ids.filter((id) => id !== entryTradeId && id !== exitTradeId);
    }
    const tradeIdsJson = ids.length > 0 ? JSON.stringify(ids) : null;
    try {
      if (dataMode === "sandbox") {
        updateSandboxEmotionalState(stateId, { trade_ids: tradeIdsJson });
      } else {
        await invoke("update_emotional_state_links", { id: stateId, journal_entry_ids: state.journal_entry_ids ?? null, trade_ids: tradeIdsJson });
      }
      setEmotionalStatesForLink((prev) => prev.map((s) => (s.id === stateId ? { ...s, trade_ids: tradeIdsJson } : s)));
      setEmotionalStateIdsByPairKey((prev) => {
        const current = prev[pairKey] ?? [];
        const next = checked ? (current.includes(stateId) ? current : [...current, stateId]) : current.filter((id) => id !== stateId);
        const nextMap = { ...prev, [pairKey]: next };
        saveEmotionalStatePairMapForMode(nextMap, dataMode);
        return nextMap;
      });

      if (checked) {
        const journalEntryIdsFromState: number[] = [];
        if (state.journal_entry_id != null) journalEntryIdsFromState.push(state.journal_entry_id);
        if (state.journal_entry_ids) {
          try {
            const arr = JSON.parse(state.journal_entry_ids) as number[];
            if (Array.isArray(arr)) arr.forEach((id) => { if (!journalEntryIdsFromState.includes(id)) journalEntryIdsFromState.push(id); });
          } catch {
            // ignore
          }
        }
        const currentJournalIds = journalEntryIdsByPairKey[pairKey] ?? [];
        const entryIdsToAdd = journalEntryIdsFromState.filter((id) => !currentJournalIds.includes(id));
        for (const entryId of entryIdsToAdd) {
          const entry = journalEntriesForLink.find((e) => e.id === entryId);
          if (!entry) continue;
          let entryIds: number[] = [];
          if (entry.linked_trade_ids) {
            try {
              const parsed = JSON.parse(entry.linked_trade_ids) as number[];
              if (Array.isArray(parsed)) entryIds = parsed;
            } catch {
              entryIds = [];
            }
          }
          if (!entryIds.includes(entryTradeId)) entryIds.push(entryTradeId);
          if (!entryIds.includes(exitTradeId)) entryIds.push(exitTradeId);
          const linkedTradeIdsJson = JSON.stringify(entryIds);
          if (dataMode === "sandbox") {
            updateSandboxJournalEntry(entryId, { linked_trade_ids: linkedTradeIdsJson });
          } else {
            await invoke("update_journal_entry", { id: entry.id, date: entry.date, title: entry.title, strategyId: entry.strategy_id, linked_trade_ids: linkedTradeIdsJson });
          }
          setJournalEntriesForLink((prev) => prev.map((e) => (e.id === entryId ? { ...e, linked_trade_ids: linkedTradeIdsJson } : e)));
        }
        if (entryIdsToAdd.length > 0) {
          setJournalEntryIdsByPairKey((prev) => {
            const next = [...(prev[pairKey] ?? []), ...entryIdsToAdd];
            const nextMap = { ...prev, [pairKey]: [...new Set(next)] };
            saveJournalPairMapForMode(nextMap, dataMode);
            return nextMap;
          });
        }
      }
    } catch (e) {
      console.error("Failed to toggle emotional state link for pair:", e);
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

  type FilterSkipDimension = "symbol" | "side" | "type" | "status" | "strategy";

  const applyFiltersToTrade = (
    trade: Trade,
    opts?: { pct?: number | null; pnl?: number; positionSize?: number },
    skipDimension?: FilterSkipDimension
  ): boolean => {
    if (!trade) return false;
    if (skipDimension !== "symbol" && filterSymbol.trim()) {
      const symbols = filterSymbol.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (symbols.length > 0 && !symbols.some((s) => (trade.symbol ?? "").toLowerCase().includes(s))) return false;
    }
    if (skipDimension !== "side" && filterSide.trim()) {
      const sides = filterSide.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (sides.length > 0 && !sides.includes((trade.side ?? "").toUpperCase())) return false;
    }
    if (skipDimension !== "type" && filterType.trim()) {
      const types = filterType.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (types.length > 0 && !types.includes((trade.order_type ?? "").toUpperCase())) return false;
    }
    if (skipDimension !== "status" && filterStatus.trim()) {
      const statuses = filterStatus.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (statuses.length > 0 && !statuses.includes((trade.status ?? "").toUpperCase())) return false;
    }
    if (skipDimension !== "strategy" && filterStrategy.trim()) {
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
    if (!item?.trade) return { pct: null, pnl: 0 };
    const relevantPairs = item.trade.side === "BUY" ? (item.exit_pairs ?? []) : (item.entry_pairs ?? []);
    const totalPnl = relevantPairs.reduce((sum, p) => sum + (p?.net_profit_loss ?? 0), 0);
    let totalCost = 0;
    for (const p of relevantPairs) {
      totalCost += p.entry_price * p.quantity;
    }
    const pct = totalCost !== 0 ? (totalPnl / totalCost) * 100 : null;
    return { pct, pnl: totalPnl };
  };

  const getPercentAndPnlForGroup = (group: PositionGroup): { pct: number | null; pnl: number } => {
    if (!group?.entry_trade || !Array.isArray(group.position_trades)) return { pct: null, pnl: group?.total_pnl ?? 0 };
    const pnl = group.total_pnl;
    if (group.final_quantity === 0 && group.position_trades.length >= 2) {
      const entryPrice = group.entry_trade.price;
      const lastTrade = group.position_trades[group.position_trades.length - 1];
      const exitPrice = lastTrade?.price ?? 0;
      const pct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : null;
      return { pct, pnl };
    }
    return { pct: null, pnl };
  };

  // All trades that appear in the table (with pct/pnl/positionSize for filter logic), for cascading filter options
  const allTradesWithOpts = useMemo(() => {
    const out: { trade: Trade; pct: number | null; pnl: number; positionSize: number }[] = [];
    (tradesWithPairing ?? []).forEach((item) => {
      if (!item?.trade || typeof item.trade.quantity !== "number" || typeof item.trade.price !== "number") return;
      const { pct, pnl } = getPercentAndPnlForTrade(item);
      const positionSize = item.trade.quantity * item.trade.price;
      out.push({ trade: item.trade, pct, pnl, positionSize });
    });
    (positionGroups ?? []).forEach((group) => {
      if (!group?.entry_trade || !Array.isArray(group.position_trades)) return;
      const { pct, pnl } = getPercentAndPnlForGroup(group);
      const positionSizeEntry = (group.entry_trade.quantity ?? 0) * (group.entry_trade.price ?? 0);
      out.push({ trade: group.entry_trade, pct, pnl, positionSize: positionSizeEntry });
      group.position_trades.forEach((t) => {
        if (!t) return;
        const positionSize = (t.quantity ?? 0) * (t.price ?? 0);
        out.push({ trade: t, pct, pnl, positionSize });
      });
    });
    return out;
  }, [tradesWithPairing, positionGroups]);

  // Cascading filter options: each dropdown shows only values that exist when other filters are applied
  const { uniqueSymbols, uniqueOrderTypes, uniqueStatuses, strategiesForFilterOptions, showUnassignedInStrategyFilter } = useMemo(() => {
    const forSymbol = allTradesWithOpts.filter(({ trade, pct, pnl, positionSize }) =>
      applyFiltersToTrade(trade, { pct, pnl, positionSize }, "symbol")
    );
    const forType = allTradesWithOpts.filter(({ trade, pct, pnl, positionSize }) =>
      applyFiltersToTrade(trade, { pct, pnl, positionSize }, "type")
    );
    const forStatus = allTradesWithOpts.filter(({ trade, pct, pnl, positionSize }) =>
      applyFiltersToTrade(trade, { pct, pnl, positionSize }, "status")
    );
    const forStrategy = allTradesWithOpts.filter(({ trade, pct, pnl, positionSize }) =>
      applyFiltersToTrade(trade, { pct, pnl, positionSize }, "strategy")
    );
    const symbols = new Set<string>();
    forSymbol.forEach(({ trade }) => { if (trade.symbol) symbols.add(trade.symbol); });
    const types = new Set<string>();
    forType.forEach(({ trade }) => { if (trade.order_type) types.add(trade.order_type); });
    const statuses = new Set<string>();
    forStatus.forEach(({ trade }) => { if (trade.status) statuses.add(trade.status); });
    const strategyIds = new Set<number | null>();
    forStrategy.forEach(({ trade }) => strategyIds.add(trade.strategy_id));
    const showUnassignedInStrategyFilter = forStrategy.some(({ trade }) => trade.strategy_id === null);
    return {
      uniqueSymbols: Array.from(symbols).sort(),
      uniqueOrderTypes: Array.from(types).sort(),
      uniqueStatuses: Array.from(statuses).sort(),
      strategiesForFilterOptions: (Array.isArray(strategies) ? strategies : []).filter((s) => s?.id != null && strategyIds.has(s.id)),
      showUnassignedInStrategyFilter,
    };
  }, [
    allTradesWithOpts,
    strategies,
    filterSymbol,
    filterSide,
    filterType,
    filterStatus,
    filterStrategy,
    filterPctMin,
    filterPctMax,
    filterPnlMin,
    filterPnlMax,
    filterPositionSizeMin,
    filterPositionSizeMax,
  ]);

  // When options shrink from cascading, remove any selected value that is no longer in the list
  useEffect(() => {
    const symSet = new Set((Array.isArray(uniqueSymbols) ? uniqueSymbols : []).map((s) => String(s).toLowerCase()));
    const typeSet = new Set((Array.isArray(uniqueOrderTypes) ? uniqueOrderTypes : []).map((t) => String(t).toUpperCase()));
    const statusSet = new Set((Array.isArray(uniqueStatuses) ? uniqueStatuses : []).map((s) => String(s).toUpperCase()));
    const stratIds = new Set((Array.isArray(strategiesForFilterOptions) ? strategiesForFilterOptions : []).map((s) => String(s.id)));
    if (showUnassignedInStrategyFilter) stratIds.add("unassigned");
    const symbolList = filterSymbol.split(",").map((s) => s.trim()).filter(Boolean);
    const typeList = filterType.split(",").map((s) => s.trim()).filter(Boolean);
    const statusList = filterStatus.split(",").map((s) => s.trim()).filter(Boolean);
    const strategyList = filterStrategy.split(",").map((s) => s.trim()).filter(Boolean);
    const symbolFiltered = symbolList.filter((s) => symSet.has(s.toLowerCase()));
    const typeFiltered = typeList.filter((t) => typeSet.has((t || "").toUpperCase()));
    const statusFiltered = statusList.filter((s) => statusSet.has((s || "").toUpperCase()));
    const strategyFiltered = strategyList.filter((s) => stratIds.has(s));
    if (symbolFiltered.length !== symbolList.length) setFilterSymbol(symbolFiltered.join(","));
    if (typeFiltered.length !== typeList.length) setFilterType(typeFiltered.join(","));
    if (statusFiltered.length !== statusList.length) setFilterStatus(statusFiltered.join(","));
    if (strategyFiltered.length !== strategyList.length) setFilterStrategy(strategyFiltered.join(","));
  }, [uniqueSymbols, uniqueOrderTypes, uniqueStatuses, strategiesForFilterOptions, showUnassignedInStrategyFilter]);

  const searchMatchesTrade = (trade: Trade): boolean => {
    if (!searchQuery.trim() || !trade) return true;
    const searchLower = searchQuery.toLowerCase();
    const strategyName = trade.strategy_id != null ? strategies.find((s) => s.id === trade.strategy_id)?.name : undefined;
    return (
      (trade.symbol ?? "").toLowerCase().includes(searchLower) ||
      (trade.side ?? "").toLowerCase().includes(searchLower) ||
      (trade.order_type ?? "").toLowerCase().includes(searchLower) ||
      (trade.status ?? "").toLowerCase().includes(searchLower) ||
      (strategyName?.toLowerCase().includes(searchLower) ?? false)
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
                {showUnassignedInStrategyFilter && (
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
                )}
                {strategiesForFilterOptions.map((s) => {
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
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", minWidth: "90px", whiteSpace: "nowrap" }}>Journal</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", minWidth: "90px", whiteSpace: "nowrap" }}>Emotional state</th>
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
                                if (group.position_trades.length >= 1) {
                                  const exitTrade = group.position_trades[group.position_trades.length - 1] as Trade;
                                  if (exitTrade.id !== group.entry_trade.id) {
                                    handleStrategyChange(exitTrade.id, newStrategyId);
                                  }
                                }
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
                          {group.position_trades.length >= 1 ? (() => {
                            const exitId = (group.position_trades[group.position_trades.length - 1] as Trade).id;
                            const pairKey = `${group.entry_trade.id}_${exitId}`;
                            const entryId = group.entry_trade.id;
                            const journalIds = [...new Set([
                              ...(journalEntryIdsByPairKey[pairKey] ?? []),
                              ...(journalEntryIdsByTradeId[entryId] ?? []),
                              ...(journalEntryIdsByTradeId[exitId] ?? []),
                            ])];
                            const emoIds = [...new Set([
                              ...(emotionalStateIdsByPairKey[pairKey] ?? []),
                              ...(emotionalStateIdsByTradeId[entryId] ?? []),
                              ...(emotionalStateIdsByTradeId[exitId] ?? []),
                            ])];
                            return (
                              <>
                                <td style={{ padding: "8px 12px", verticalAlign: "middle" }} onClick={(e) => e.stopPropagation()}>
                                  <div ref={journalPairPopoverKey === pairKey ? journalPairPopoverRef : undefined} style={{ position: "relative", display: "inline-block" }}>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setJournalPairPopoverKey((prev) => (prev === pairKey ? null : pairKey));
                                      }}
                                      style={{
                                        padding: "6px 10px",
                                        fontSize: "12px",
                                        border: "1px solid var(--border-color)",
                                        borderRadius: "6px",
                                        background: "var(--bg-tertiary)",
                                        color: "var(--text-primary)",
                                        cursor: "pointer",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {journalIds.length === 0 ? "Link" : `${journalIds.length} linked`}
                                    </button>
                                    {journalPairPopoverKey === pairKey && (
                                      <div
                                        style={{
                                          position: "absolute",
                                          left: 0,
                                          top: "100%",
                                          marginTop: "4px",
                                          zIndex: 20,
                                          minWidth: "200px",
                                          maxHeight: "280px",
                                          overflowY: "auto",
                                          background: "var(--bg-secondary)",
                                          border: "1px solid var(--border-color)",
                                          borderRadius: "8px",
                                          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                                          padding: "8px",
                                        }}
                                      >
                                        {journalEntriesForLink.length === 0 ? (
                                          <div style={{ padding: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>No journal entries</div>
                                        ) : (
                                          journalEntriesForLink.map((je) => (
                                            <label key={je.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", cursor: "pointer", borderRadius: "4px" }}>
                                              <input
                                                type="checkbox"
                                                checked={journalIds.includes(je.id)}
                                                onChange={(e) => handleToggleJournalLinkForPair(pairKey, je.id, e.target.checked)}
                                              />
                                              <span style={{ fontSize: "13px" }}>{je.title || `Entry ${je.id}`}</span>
                                            </label>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td style={{ padding: "8px 12px", verticalAlign: "middle" }} onClick={(e) => e.stopPropagation()}>
                                  <div ref={emotionPairPopoverKey === pairKey ? emotionPairPopoverRef : undefined} style={{ position: "relative", display: "inline-block" }}>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEmotionPairPopoverKey((prev) => (prev === pairKey ? null : pairKey));
                                      }}
                                      style={{
                                        padding: "6px 10px",
                                        fontSize: "12px",
                                        border: "1px solid var(--border-color)",
                                        borderRadius: "6px",
                                        background: "var(--bg-tertiary)",
                                        color: "var(--text-primary)",
                                        cursor: "pointer",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {emoIds.length === 0 ? "Link" : `${emoIds.length} linked`}
                                    </button>
                                    {emotionPairPopoverKey === pairKey && (
                                      <div
                                        style={{
                                          position: "absolute",
                                          left: 0,
                                          top: "100%",
                                          marginTop: "4px",
                                          zIndex: 20,
                                          minWidth: "200px",
                                          maxHeight: "280px",
                                          overflowY: "auto",
                                          background: "var(--bg-secondary)",
                                          border: "1px solid var(--border-color)",
                                          borderRadius: "8px",
                                          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                                          padding: "8px",
                                        }}
                                      >
                                        {emotionalStatesForLink.length === 0 ? (
                                          <div style={{ padding: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>No emotional states</div>
                                        ) : (
                                          emotionalStatesForLink.map((es) => (
                                            <label key={es.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", cursor: "pointer", borderRadius: "4px" }}>
                                              <input
                                                type="checkbox"
                                                checked={emoIds.includes(es.id)}
                                                onChange={(e) => handleToggleEmotionalStateLinkForPair(pairKey, es.id, e.target.checked)}
                                              />
                                              <span style={{ fontSize: "13px" }}>{es.name || `State ${es.id}`}</span>
                                            </label>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </>
                            );
                          })() : (
                            <>
                              <td style={{ padding: "8px 12px", color: "var(--text-secondary)", fontSize: "12px" }}>—</td>
                              <td style={{ padding: "8px 12px", color: "var(--text-secondary)", fontSize: "12px" }}>—</td>
                            </>
                          )}
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
                            <td colSpan={12 + (hidePnlDollars ? 0 : 1) + (hidePnlPercent ? 0 : 1)} style={{ padding: "0", backgroundColor: "var(--bg-tertiary)" }}>
                              <div style={{ padding: "20px" }}>
                                <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>
                                  Position Trades ({group.position_trades.length})
                                </h3>
                                {group.position_trades.length >= 1 && (() => {
                                  const entryId = group.entry_trade.id;
                                  const isChartCollapsed = chartCollapsedForPosition.has(entryId);
                                  const toggleChart = () => {
                                    setChartCollapsedForPosition((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(entryId)) next.delete(entryId);
                                      else next.add(entryId);
                                      return next;
                                    });
                                  };
                                  let running = 0;
                                  const chartData: { time: string; positionSize: number; label: string }[] = [
                                    { time: group.position_trades[0].timestamp, positionSize: 0, label: format(new Date(group.position_trades[0].timestamp), "MMM d, HH:mm") },
                                  ];
                                  group.position_trades.forEach((t) => {
                                    const side = t.side.toUpperCase();
                                    if (side === "BUY") running += t.quantity;
                                    else if (side === "SELL") running -= t.quantity;
                                    chartData.push({
                                      time: t.timestamp,
                                      positionSize: running,
                                      label: format(new Date(t.timestamp), "MMM d, HH:mm"),
                                    });
                                  });
                                  return (
                                    <div style={{ marginBottom: "20px" }}>
                                      <h4
                                        style={{
                                          fontSize: "13px",
                                          fontWeight: "600",
                                          color: "var(--text-secondary)",
                                          marginBottom: isChartCollapsed ? 0 : "8px",
                                          textTransform: "uppercase",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "8px",
                                          cursor: "pointer",
                                          userSelect: "none",
                                        }}
                                        onClick={toggleChart}
                                        role="button"
                                        aria-expanded={!isChartCollapsed}
                                      >
                                        {isChartCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                        Position size over time
                                      </h4>
                                      {!isChartCollapsed && (
                                        <ResponsiveContainer width="100%" height={200}>
                                          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                                            <XAxis
                                              dataKey="label"
                                              tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                                              stroke="var(--border-color)"
                                            />
                                            <YAxis
                                              tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                                              stroke="var(--border-color)"
                                              tickFormatter={(v) => (v >= 0 ? `+${formatWithCommas(v, { maxDecimals: 2 })}` : formatWithCommas(v, { maxDecimals: 2 }))}
                                            />
                                            <Tooltip
                                              contentStyle={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px" }}
                                              labelStyle={{ color: "var(--text-primary)" }}
                                              formatter={(value: number) => [value >= 0 ? `+${formatWithCommas(value, { minDecimals: 4, maxDecimals: 4 })}` : formatWithCommas(value, { minDecimals: 4, maxDecimals: 4 }), "Position size"]}
                                              labelFormatter={(label) => `Time: ${label}`}
                                            />
                                            <ReferenceLine y={0} stroke="var(--text-secondary)" strokeDasharray="2 2" />
                                            <Line
                                              type="stepAfter"
                                              dataKey="positionSize"
                                              stroke="var(--accent)"
                                              strokeWidth={2}
                                              dot={{ fill: "var(--accent)", r: 3 }}
                                              activeDot={{ r: 5 }}
                                              isAnimationActive={true}
                                            />
                                          </LineChart>
                                        </ResponsiveContainer>
                                      )}
                                    </div>
                                  );
                                })()}
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
                                                    trade.side.toUpperCase() === "BUY"
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
                                {/* Add View Chart button and Notes (closed or open positions) */}
                                {group.position_trades.length >= 1 && (
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
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", minWidth: "120px", whiteSpace: "nowrap" }}>
                    Journal
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", minWidth: "140px", whiteSpace: "nowrap" }}>
                    Emotional state
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
                                trade.side.toUpperCase() === "BUY"
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
                        <td style={{ padding: "12px 16px", fontSize: "14px", verticalAlign: "middle" }} onClick={(e) => e.stopPropagation()}>
                          <div ref={journalPopoverTradeId === trade.id ? journalPopoverRef : undefined} style={{ position: "relative", display: "inline-block" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setJournalPopoverTradeId((prev) => (prev === trade.id ? null : trade.id));
                                setEmotionPopoverTradeId(null);
                              }}
                              style={{
                                padding: "6px 12px",
                                backgroundColor: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                fontSize: "13px",
                                cursor: "pointer",
                                minWidth: "120px",
                                outline: "none",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              <ChevronDown size={14} style={{ opacity: 0.8, flexShrink: 0 }} />
                              {(journalEntryIdsByTradeId[trade.id]?.length ?? 0) === 0
                                ? "0 linked"
                                : `${journalEntryIdsByTradeId[trade.id].length} linked`}
                            </button>
                            {journalPopoverTradeId === trade.id && (
                              <div
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  top: "100%",
                                  marginTop: "4px",
                                  zIndex: 50,
                                  minWidth: "240px",
                                  maxHeight: "280px",
                                  overflowY: "auto",
                                  backgroundColor: "var(--bg-secondary)",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "8px",
                                  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                                  padding: "8px",
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase" }}>
                                  Link to journals
                                </div>
                                {journalEntriesForLink.length === 0 ? (
                                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", padding: "8px 0" }}>No journal entries</div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    {journalEntriesForLink.map((entry) => {
                                      const linked = (journalEntryIdsByTradeId[trade.id] ?? []).includes(entry.id);
                                      return (
                                        <label
                                          key={entry.id}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            padding: "6px 8px",
                                            borderRadius: "4px",
                                            cursor: "pointer",
                                            fontSize: "13px",
                                            color: "var(--text-primary)",
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={linked}
                                            onChange={() => handleToggleJournalLink(trade.id, entry.id, !linked)}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{ cursor: "pointer", flexShrink: 0 }}
                                          />
                                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {entry.title || "Untitled"} · {format(new Date(entry.date), "MMM dd")}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: "14px", verticalAlign: "middle" }} onClick={(e) => e.stopPropagation()}>
                          <div ref={emotionPopoverTradeId === trade.id ? emotionPopoverRef : undefined} style={{ position: "relative", display: "inline-block" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEmotionPopoverTradeId((prev) => (prev === trade.id ? null : trade.id));
                                setJournalPopoverTradeId(null);
                              }}
                              style={{
                                padding: "6px 12px",
                                backgroundColor: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                fontSize: "13px",
                                cursor: "pointer",
                                minWidth: "120px",
                                outline: "none",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              <ChevronDown size={14} style={{ opacity: 0.8, flexShrink: 0 }} />
                              {(emotionalStateIdsByTradeId[trade.id]?.length ?? 0) === 0
                                ? "0 linked"
                                : `${emotionalStateIdsByTradeId[trade.id].length} linked`}
                            </button>
                            {emotionPopoverTradeId === trade.id && (
                              <div
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  top: "100%",
                                  marginTop: "4px",
                                  zIndex: 50,
                                  minWidth: "260px",
                                  maxHeight: "280px",
                                  overflowY: "auto",
                                  backgroundColor: "var(--bg-secondary)",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "8px",
                                  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                                  padding: "8px",
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase" }}>
                                  Link to emotional states
                                </div>
                                {emotionalStatesForLink.length === 0 ? (
                                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", padding: "8px 0" }}>No emotional states</div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    {emotionalStatesForLink
                                      .slice()
                                      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                                      .map((s) => {
                                        const linked = (emotionalStateIdsByTradeId[trade.id] ?? []).includes(s.id);
                                        return (
                                          <label
                                            key={s.id}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: "8px",
                                              padding: "6px 8px",
                                              borderRadius: "4px",
                                              cursor: "pointer",
                                              fontSize: "13px",
                                              color: "var(--text-primary)",
                                            }}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={linked}
                                              onChange={() => handleToggleEmotionalStateLink(trade.id, s.id, !linked)}
                                              onClick={(e) => e.stopPropagation()}
                                              style={{ cursor: "pointer", flexShrink: 0 }}
                                            />
                                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                              {format(new Date(s.timestamp), "MMM dd HH:mm")} · {s.emotion}
                                            </span>
                                          </label>
                                        );
                                      })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
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
